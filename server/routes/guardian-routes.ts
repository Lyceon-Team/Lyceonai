import { Request, Response, Router } from "express";
import { requireSupabaseAuth } from "../middleware/supabase-auth";
import { requireGuardianEntitlement } from "../middleware/guardian-entitlement";
import { requireGuardianRole } from "../middleware/guardian-role";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { guardianLinkRateLimit } from "../middleware/guardian-link-rate-limit";
import { z } from "zod";
import {
  createGuardianLink,
  acceptGuardianLink,
  revokeGuardianLink,
  isGuardianLinkedToStudent,
  getAllGuardianStudentLinks,
} from "../lib/account";
// The error contract comes from the contract module, NOT from `../lib/account`: a route
// that imports its error mapping from the module it also imports its functions from loses
// that mapping whenever the module is substituted, and reports 500 instead of the specified
// status. See packages/shared/src/guardian-link-schema.ts.
import { GUARDIAN_LINK_ERROR } from "../../packages/shared/src/guardian-link-schema";
import {
  normaliseEmail,
  subjectDigest,
  DIGEST_LEN_LOG,
} from "../../packages/shared/src/services/subject-digest";
// Intentional cross-boundary imports: guardian runtime routes reuse canonical apps/api services for shared exam/mastery reads.
import * as fullLengthExamService from "../../apps/api/src/services/fullLengthExam";
import {
  parseSectionFilter,
  readDomainMasteryView,
} from "../../apps/api/src/services/mastery-view";
import {
  buildStudentKpiViewFromCanonical,
  buildStudentFullLengthReportView,
  projectGuardianFullLengthReportView,
  projectGuardianExamSessionList,
} from "../services/canonical-runtime-views";
import { buildCalendarMonthView } from "../../apps/api/src/services/calendar-month-view";
import {
  resolveHistoricalTrendsAccess,
  resolvePaidKpiAccessForStudent,
} from "../services/kpi-access";

/**
 * The calendar day shape, DERIVED from the builder's own return type rather than restated.
 * `payload.days.map((day: any) => ...)` meant a renamed field in buildCalendarMonthView
 * silently became `undefined` on a parent's screen — an unchecked read wearing the face of
 * "no data". Deriving it here makes that rename a compile error instead.
 */
type CalendarMonthDay = Awaited<
  ReturnType<typeof buildCalendarMonthView>
>["days"][number];

/** The exact column list the linked-student queries select. Not `any[]`. */
type LinkedStudentRow = {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
};

const router = Router();

const requireGuardianAccess = requireGuardianRole({
  message: "You do not have permission to access guardian resources",
});

type GuardianAccessEventType =
  | "guardian_dashboard_viewed"
  | "guardian_calendar_viewed"
  | "guardian_report_viewed"
  | "guardian_access_denied";

async function emitGuardianAccessEvent(args: {
  eventType: GuardianAccessEventType;
  guardianId: string;
  studentId?: string;
  requestId?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await supabaseServer.from("system_event_logs").insert({
      event_type: args.eventType,
      level: "info",
      source: "guardian_routes",
      message: args.eventType,
      user_id: args.guardianId,
      session_id: args.studentId ?? null,
      details: {
        request_id: args.requestId ?? null,
        student_id: args.studentId ?? null,
        ...(args.details ?? {}),
      },
    });
  } catch {
    // Best effort only.
  }
}

/**
 * @spec [Doc-01_V8, §36.1 Initiation step 1 — "Guardian enters student's email";
 *        lyceon-coding-standards.md §7.1 (Zod at every boundary)] | @implemented [2026-08-26]
 * plain English: the only shape `POST /api/guardian/link` accepts. `.strict()` so an extra
 * field is a 400 rather than something silently ignored; `.email()` so the per-student-email
 * rate bucket in §36.2 is keyed on something that is actually an address.
 */
const linkRequestSchema = z
  .object({ email: z.string().trim().min(3).max(320).email() })
  .strict();

/** Route params are strings; a link id must be a UUID before it reaches the data layer. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @spec [lyceon-coding-standards.md §3.2 (unknown at boundaries), §13 (expected failures)]
 * | @implemented [2026-08-26]
 * plain English: read the `code` off a thrown value, or null if it has none. Expected
 * outcome: the route branches on the CONTRACT the data layer publishes, not on the identity
 * of a class. Trade-off: `instanceof GuardianLinkError` is tempting and is what this replaced,
 * but it silently stops matching whenever the throwing module is a different instance from the
 * importing one — which is true under a test module mock and true again under any bundler that
 * duplicates the module. A missed match there is a 500 where a 409 was specified, so the check
 * is made on the property instead. Edge case: a non-object throw (a string, undefined) yields
 * null and falls through to the 500 path, which is correct — it carries no contract.
 */
function errorCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * @spec [Doc-01_V8, §35 Guardian-student linkage — "Additional audit table … captures every
 *        status change for traceability"] | @implemented [2026-08-26]
 *
 * plain English: record a guardian-link status change in `audit_logs`. What it does: writes
 * one row naming who acted, who it was about, what happened, and the before/after status.
 * Expected outcome: a durable trail of every link transition, queryable by actor or target.
 * Trade-off: this is best-effort — a failed audit write is logged and does not fail the
 * request, because refusing a successful link because its audit row would not write is the
 * worse outcome. Edge case: `changes` carries only status values and never an email, a code,
 * or any student content (§12.1).
 *
 * REPLACES the `guardian_link_audit` writer this file used to hold. That table does not exist
 * in production (`WS-GL_Stage1_Audit.md` §0), so every one of those inserts failed silently
 * inside its own try/catch. `audit_logs` does exist, is empty, and had no writer at all —
 * owner ruling 2026-08-24 chose it over creating the missing table, since `rate_limit_ledger`
 * already covers the rate-limiting half of what `guardian_link_audit` was doing.
 */
type GuardianLinkAuditAction =
  | "guardian_link_initiated"
  | "guardian_link_accepted"
  | "guardian_link_revoked"
  | "guardian_link_denied";

async function auditGuardianLink(args: {
  action: GuardianLinkAuditAction;
  actorProfileId: string;
  targetProfileId?: string | null;
  changes?: Record<string, unknown>;
  context?: Record<string, unknown>;
  requestId?: string;
}): Promise<void> {
  try {
    const { error } = await supabaseServer.from("audit_logs").insert({
      actor_profile_id: args.actorProfileId,
      target_profile_id: args.targetProfileId ?? null,
      action: args.action,
      changes: args.changes ?? null,
      context: { request_id: args.requestId ?? null, ...(args.context ?? {}) },
    });
    if (error) {
      logger.error("GUARDIAN", "audit_log", "Failed to write audit_logs row", {
        requestId: args.requestId,
        action: args.action,
        reason: error.message,
      });
    }
  } catch (err: unknown) {
    logger.error("GUARDIAN", "audit_log", "Failed to write audit_logs row", {
      requestId: args.requestId,
      action: args.action,
      reason: err instanceof Error ? err.message : "unknown",
    });
  }
}

router.get(
  "/students",
  requireSupabaseAuth,
  requireGuardianAccess,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    try {
      const guardianId = req.user!.id;

      // CANONICAL: Read from guardian_links, join profiles for display info
      const links = await getAllGuardianStudentLinks(guardianId);
      if (links.length === 0) {
        await emitGuardianAccessEvent({
          eventType: "guardian_dashboard_viewed",
          guardianId,
          requestId,
          details: { linked_student_count: 0 },
        });
        return res.json({ students: [], requestId });
      }

      const studentIds = links.map((l) => l.student_profile_id);
      const { data: students, error } = await supabaseServer
        .from("profiles")
        .select("id, email, display_name, created_at")
        .in("id", studentIds)
        .eq("role", "student");

      if (error) {
        logger.error(
          "GUARDIAN",
          "list_students",
          "Failed to fetch linked students",
          { error, requestId },
        );
        return res
          .status(500)
          .json({ error: "Failed to fetch students", requestId });
      }

      await emitGuardianAccessEvent({
        eventType: "guardian_dashboard_viewed",
        guardianId,
        requestId,
        details: { linked_student_count: (students || []).length },
      });
      res.json({ students: students || [], requestId });
    } catch (err) {
      logger.error("GUARDIAN", "list_students", "Error", { err, requestId });
      res.status(500).json({ error: "Internal server error", requestId });
    }
  },
);

/**
 * POST /api/guardian/link — §36.1's guardian-initiated path, step 1 and 2.
 *
 * @spec [Doc-01_V8, §36.1 Initiation (guardian-initiated, steps 1–2); §36.2 Rate limiting
 *        and abuse controls] | @implemented [2026-08-26]
 *
 * plain English: a guardian enters a student's email; the server creates a link request in
 * `pending_student_accept` and tells the guardian it is awaiting the student. Expected
 * outcome: 202 with the link id and status — NOT an active link, because §36.1 makes the
 * student's acceptance the only route to `active`. Trade-off: the response is deliberately
 * uninformative about whether the address belongs to a Lyceon student. §36.1 step 3 emails
 * the student, so the guardian never needs to be told; telling them would turn this endpoint
 * into an account-enumeration oracle. Edge case: a pair that already has an active or pending
 * link returns 409 rather than creating a second row.
 *
 * WHAT CHANGED, AND WHY IT IS NOT A NARROWING. This route used to take an 8-character
 * `student_link_code`. §36.1 step 1 reads "Guardian enters student's email on their
 * dashboard", and `student_link_code` appears NOWHERE in the locked spec corpus
 * (verified: `grep -rn "student_link_code\|link code\|link_code" docs/Spec/` → no matches).
 * The code mechanism was a pre-spec invention. The owner has ruled spec canonical without
 * exception, so the input is the email §36.1 names. This also gives §36.2's per-student-email
 * control a subject: with a code, the address is not known until after the lookup.
 *
 * §36.1 step 3 — "Student receives email with acceptance link" — is NOT sent here. The
 * `notification_outbox` emission contract governs that surface and no dispatcher exists yet;
 * emitting into it is a separate, declared piece of work. Reported in the phase report rather
 * than half-built.
 */
router.post(
  "/link",
  requireSupabaseAuth,
  requireGuardianAccess,
  guardianLinkRateLimit,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    try {
      const guardianId = req.user!.id;
      const parsed = linkRequestSchema.safeParse(req.body);

      if (!parsed.success) {
        await auditGuardianLink({
          action: "guardian_link_denied",
          actorProfileId: guardianId,
          changes: { reason: "invalid_input" },
          requestId,
        });
        return res.status(400).json({
          error: { message: "A student email address is required" },
          requestId,
        });
      }

      const email = normaliseEmail(parsed.data.email);

      const { data: student, error: lookupError } = await supabaseServer
        .from("profiles")
        .select("id, display_name")
        .eq("email", email)
        .eq("role", "student")
        .maybeSingle();

      if (lookupError && lookupError.code !== "PGRST116") {
        logger.error("GUARDIAN", "link_student", "Student lookup failed", {
          reason: lookupError.message,
          requestId,
        });
        return res.status(500).json({
          error: { message: "Failed to create link request" },
          requestId,
        });
      }

      // Anti-enumeration: an address with no student account gets the SAME 202 shape as one
      // that has. §36.1 step 3 reaches the student by email either way, so the guardian
      // learns nothing from this response that they are entitled to learn from it.
      if (!student) {
        await auditGuardianLink({
          action: "guardian_link_denied",
          actorProfileId: guardianId,
          // The address itself is never written to a retained row — only its digest.
          changes: {
            reason: "no_matching_student",
            email_digest: subjectDigest(email, DIGEST_LEN_LOG),
          },
          requestId,
        });
        logger.warn(
          "GUARDIAN",
          "link_attempt_no_match",
          "Link requested against an address with no student account",
          { guardianId, requestId },
        );
        return res.status(202).json({
          data: { status: "pending_student_accept" },
          requestId,
        });
      }

      let link;
      try {
        link = await createGuardianLink(guardianId, student.id, "guardian");
      } catch (linkError: unknown) {
        const code = errorCode(linkError);

        if (code === GUARDIAN_LINK_ERROR.ALREADY_EXISTS) {
          await auditGuardianLink({
            action: "guardian_link_denied",
            actorProfileId: guardianId,
            targetProfileId: student.id,
            changes: { reason: "link_already_exists" },
            requestId,
          });
          return res.status(409).json({
            error: {
              message: "A link with this student already exists",
              code: GUARDIAN_LINK_ERROR.ALREADY_EXISTS,
            },
            requestId,
          });
        }

        logger.error("GUARDIAN", "link_student", "Failed to create link", {
          reason: linkError instanceof Error ? linkError.message : "unknown",
          requestId,
        });
        return res.status(500).json({
          error: { message: "Failed to create link request" },
          requestId,
        });
      }

      await auditGuardianLink({
        action: "guardian_link_initiated",
        actorProfileId: guardianId,
        targetProfileId: student.id,
        changes: { from: null, to: link.status, initiated_by: "guardian" },
        context: { link_id: link.id },
        requestId,
      });

      logger.info("GUARDIAN", "link_student", "Link request created", {
        guardianId,
        studentId: student.id,
        status: link.status,
        requestId,
      });

      res.status(202).json({
        data: {
          link_id: link.id,
          status: link.status,
          student: { id: student.id, display_name: student.display_name },
        },
        requestId,
      });
    } catch (err) {
      logger.error("GUARDIAN", "link_student", "Error", { err, requestId });
      res
        .status(500)
        .json({ error: { message: "Internal server error" }, requestId });
    }
  },
);

/**
 * POST /api/guardian/link/:linkId/accept — §36.1's acceptance step.
 *
 * @spec [Doc-01_V8, §36.1 Initiation (student-initiated, step 5: "Guardian confirms →
 *        `status = 'active'`")] | @implemented [2026-08-26]
 *
 * plain English: the guardian confirms a link a student started, and it goes live. Expected
 * outcome: `status='active'`, `accepted_at` and `accepted_by_profile_id` set, and an
 * `audit_logs` row recording the transition. Trade-off: the server checks that THIS guardian
 * is the party the pending status is waiting on — a guardian cannot self-accept a link they
 * initiated, which is the entire content of the two-step flow. Edge case: accepting an
 * already-active or revoked link returns 409, not a second acceptance.
 *
 * The student-side counterpart (a student accepting a guardian-initiated link) belongs on the
 * student profile surface, not the guardian router. `acceptGuardianLink` is party-agnostic
 * and serves both; only this half is mounted here. Reported, not silently omitted.
 */
router.post(
  "/link/:linkId/accept",
  requireSupabaseAuth,
  requireGuardianAccess,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    try {
      const guardianId = req.user!.id;
      const { linkId } = req.params;

      if (!UUID_RE.test(linkId ?? "")) {
        return res
          .status(400)
          .json({ error: { message: "Invalid link id" }, requestId });
      }

      let link;
      try {
        link = await acceptGuardianLink(linkId, guardianId);
      } catch (acceptError: unknown) {
        const code = errorCode(acceptError);

        if (code === GUARDIAN_LINK_ERROR.WRONG_ACCEPTOR) {
          return res.status(403).json({
            error: {
              message: "This link is awaiting acceptance by the other party",
              code,
            },
            requestId,
          });
        }
        if (code === GUARDIAN_LINK_ERROR.NOT_PENDING) {
          return res.status(409).json({
            error: { message: "This link is not awaiting acceptance", code },
            requestId,
          });
        }

        logger.error("GUARDIAN", "accept_link", "Failed to accept link", {
          reason:
            acceptError instanceof Error ? acceptError.message : "unknown",
          requestId,
        });
        return res
          .status(500)
          .json({ error: { message: "Failed to accept link" }, requestId });
      }

      await auditGuardianLink({
        action: "guardian_link_accepted",
        actorProfileId: guardianId,
        targetProfileId: link.student_profile_id,
        changes: { from: "pending_guardian_accept", to: link.status },
        context: { link_id: link.id },
        requestId,
      });

      logger.info("GUARDIAN", "accept_link", "Guardian link accepted", {
        guardianId,
        studentId: link.student_profile_id,
        requestId,
      });

      res.json({
        data: { link_id: link.id, status: link.status },
        requestId,
      });
    } catch (err) {
      logger.error("GUARDIAN", "accept_link", "Error", { err, requestId });
      res
        .status(500)
        .json({ error: { message: "Internal server error" }, requestId });
    }
  },
);

/**
 * DELETE /api/guardian/link/:studentId — §36.3 revocation, guardian side.
 *
 * @spec [Doc-01_V8, §36.3 Revocation] | @implemented [2026-08-26]
 *
 * plain English: the guardian removes a student. What it does: flips the active link to
 * `revoked` and records when, by whom, and (optionally) why. Expected outcome: revocation is
 * immediate — every guardian read gate requires `status='active'`, so visibility is gone on
 * the next request. Trade-off: §36.3 lets either party revoke and this is only the guardian's
 * half; the student's "Remove guardian" control belongs on the student profile surface and
 * `revokeGuardianLink` is written party-agnostically to serve it. Edge case: revoking a link
 * that is already inactive returns 409 rather than writing a second revocation.
 *
 * §36.4's "you are still paying for this student — keep or cancel?" prompt is NOT implemented
 * here: it is the billing surface, out of WS-GL's edit scope (Charter §0). §36.5's NOTIFY is
 * deferred with a reason (`WS-GL_Stage2_Closure_Plan.md` §4 — no listener exists, grounding
 * audit G-07). Both are reported, not silently dropped.
 */
router.delete(
  "/link/:studentId",
  requireSupabaseAuth,
  requireGuardianAccess,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    try {
      const guardianId = req.user!.id;
      const { studentId } = req.params;

      // CANONICAL: verify an ACTIVE link exists before revealing anything about it.
      const linked = await isGuardianLinkedToStudent(guardianId, studentId);

      if (!linked) {
        logger.warn(
          "GUARDIAN",
          "unlink_denied",
          "Guardian tried to unlink non-linked student",
          { guardianId, studentId, requestId },
        );
        return res
          .status(403)
          .json({ error: "Not authorized to unlink this student", requestId });
      }

      const reason =
        typeof req.body?.reason === "string" && req.body.reason.trim()
          ? req.body.reason.trim().slice(0, 200)
          : undefined;

      let revoked;
      try {
        revoked = await revokeGuardianLink(
          guardianId,
          studentId,
          guardianId,
          reason,
        );
      } catch (revokeError: unknown) {
        const code = errorCode(revokeError);

        if (code === GUARDIAN_LINK_ERROR.NOT_ACTIVE) {
          logger.warn(
            "GUARDIAN",
            "unlink_conflict",
            "Guardian link no longer active at revoke time",
            { guardianId, studentId, requestId },
          );
          return res.status(409).json({
            error: "Link is no longer active",
            code: GUARDIAN_LINK_ERROR.NOT_ACTIVE,
            requestId,
          });
        }

        logger.error("GUARDIAN", "unlink_student", "Failed to unlink student", {
          reason:
            revokeError instanceof Error ? revokeError.message : "unknown",
          requestId,
        });
        return res
          .status(500)
          .json({ error: "Failed to unlink student", requestId });
      }

      await auditGuardianLink({
        action: "guardian_link_revoked",
        actorProfileId: guardianId,
        targetProfileId: studentId,
        changes: {
          from: "active",
          to: revoked.status,
          revoked_by: "guardian",
          // The reason is guardian-authored free text about the link, not student content,
          // and is recorded as present/absent rather than verbatim.
          revocation_reason_present: reason !== undefined,
        },
        context: { link_id: revoked.id },
        requestId,
      });

      logger.info(
        "GUARDIAN",
        "unlink_student",
        "Student unlinked successfully",
        { guardianId, studentId, requestId },
      );

      // Return the updated student list from the canonical source.
      const links = await getAllGuardianStudentLinks(guardianId);
      const studentIds = links.map((l) => l.student_profile_id);
      let students: unknown[] = [];
      if (studentIds.length > 0) {
        const { data } = await supabaseServer
          .from("profiles")
          .select("id, email, display_name, created_at")
          .in("id", studentIds)
          .eq("role", "student");
        students = data || [];
      }

      res.json({ ok: true, students, requestId });
    } catch (err) {
      logger.error("GUARDIAN", "unlink_student", "Error", { err, requestId });
      res.status(500).json({ error: "Internal server error", requestId });
    }
  },
);

router.get(
  "/students/:studentId/summary",
  requireSupabaseAuth,
  requireGuardianAccess,
  requireGuardianEntitlement,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    try {
      const guardianId = req.user!.id;
      const { studentId } = req.params;

      const linked = await isGuardianLinkedToStudent(guardianId, studentId);
      if (!linked && req.user!.role !== "admin") {
        logger.warn(
          "GUARDIAN",
          "summary_access_denied",
          "Student not found or not linked to guardian",
          { guardianId, studentId, requestId },
        );
        await emitGuardianAccessEvent({
          eventType: "guardian_access_denied",
          guardianId,
          studentId,
          requestId,
          details: { surface: "summary", reason: "not_linked" },
        });
        return res.status(404).json({ error: "Student not found", requestId });
      }

      const { data: student, error: studentError } = await supabaseServer
        .from("profiles")
        // `display_name` is no longer selected: it is no longer serialised, and Doc 05B
        // §10.5 is explicit that the handler projects the columns it needs rather than
        // reading wide and trimming at the edge.
        .select("id")
        .eq("id", studentId)
        .eq("role", "student")
        .single();

      if (studentError || !student) {
        return res.status(404).json({ error: "Student not found", requestId });
      }

      // Same builder the student KPI route calls (server/routes/legacy/progress.ts).
      // ONE derivation, no projection: the guardian body IS the student view.
      //
      // THE METRIC ALLOWLIST IS GONE (owner ruling 2026-08-26).
      //   `projectGuardianKpiView` filtered `metrics` to a hardcoded
      //   {week_questions, week_accuracy, current_streak}. That set was not read from a
      //   spec constant, an entitlement, or the database — it was the field list of the
      //   guardian-only `progress` block (bf544c8, 2026-08-21), and it outlived the block
      //   that needed it. It is exactly the base set `buildStudentMetrics` emits
      //   unconditionally, so it was a STATIC restatement of the gate
      //   `resolveHistoricalTrendsAccess` already makes DYNAMICALLY one line below.
      //
      //   Live consequence while it stood: for a student WITH paid access the builder
      //   emitted `recency_accuracy` and the filter stripped it back out, so the guardian
      //   of a paying student saw LESS than the student — the "no less" half of the rule,
      //   broken by the remnant. It also left `measurementModel.diagnostic` (built from
      //   the student's full metric list) naming a metric the payload no longer carried.
      //   Deleting the filter closes both; the mismatch was the filter, not the diagnostic.
      //
      // THE SECOND ARGUMENT USED TO BE A HARDCODED `true`.
      //   The student route derives it from the student's own entitlement, fail-closed. So
      //   a guardian saw historical trends the student's entitlement denied the student —
      //   the payer's view more permissive than the learner's, which inverts the trust
      //   model and violates Doc 04C invariant #7 ("Guardians MUST NOT see fields the
      //   student does not see") outright. Both paths now call ONE resolver, and the
      //   subject is the student on both.
      //
      //   No admin escape here: this is the guardian surface, and the owner ruling is that
      //   it shows exactly what the student sees, no more and no less. An admin who needs
      //   more uses an admin route.
      const includeHistoricalTrends =
        await resolveHistoricalTrendsAccess(studentId);
      const studentView = await buildStudentKpiViewFromCanonical(
        studentId,
        includeHistoricalTrends,
      );

      await emitGuardianAccessEvent({
        eventType: "guardian_report_viewed",
        guardianId,
        studentId,
        requestId,
        details: { surface: "summary" },
      });

      // The guardian body IS the student envelope. Not a subset of it, not a reshaping of
      // it — the same object, gated only by the shared entitlement derivation above. No
      // `student` block: it was a guardian-only addition, and the dashboard already knows
      // which student it selected.
      //
      // The student route additionally attaches an `entitlement` block, which this builder
      // does not produce and this route does not add. Under Doc 05B §10.3 there is ONE
      // route and therefore one response, so nothing decides what reaches "the guardian
      // version" — the question is moot at the topology change and is not answered here
      // (owner ruling 2026-08-26, Q1).
      return res.json({
        ...studentView,
        requestId,
      });
    } catch (err) {
      logger.error("GUARDIAN", "student_summary", "Error", { err, requestId });
      return res
        .status(500)
        .json({ error: "Internal server error", requestId });
    }
  },
);
function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// ============================================================================
// GUARDIAN FULL-LENGTH EXAM REPORTING
// ============================================================================
router.get(
  "/students/:studentId/exams/full-length/sessions",
  requireSupabaseAuth,
  requireGuardianAccess,
  requireGuardianEntitlement,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    try {
      const guardianId = req.user!.id;
      const isAdmin = req.user!.role === "admin";
      const { studentId } = req.params;

      if (!isAdmin) {
        const linked = await isGuardianLinkedToStudent(guardianId, studentId);
        if (!linked) {
          logger.warn(
            "GUARDIAN",
            "full_length_history_denied",
            "Guardian tried to view non-linked student full-length history",
            {
              guardianId,
              studentId,
              requestId,
            },
          );
          await emitGuardianAccessEvent({
            eventType: "guardian_access_denied",
            guardianId,
            studentId,
            requestId,
            details: { surface: "full_length_history", reason: "not_linked" },
          });
          return res
            .status(403)
            .json({ error: "Not authorized to view this student", requestId });
        }
      }

      const rawLimit = Number(req.query.limit ?? 20);
      const limit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(Math.trunc(rawLimit), 50))
        : 20;
      const includeIncompleteRaw = String(
        req.query.include_incomplete ?? "",
      ).toLowerCase();
      const includeIncomplete =
        includeIncompleteRaw === "1" || includeIncompleteRaw === "true";

      // Canonical projection: guardian history reuses the same student truth model.
      const sessions = await fullLengthExamService.listExamSessions({
        userId: studentId,
        limit,
        includeIncomplete,
      });

      // The STUDENT's paid access, resolved for the student — not the guardian's, and not
      // skipped. The inline map this replaced computed `reportAvailable` with no
      // entitlement gate at all, so a guardian could be told a report was available when
      // the student's own entitlement said otherwise (Doc 04C invariant #7).
      const studentAccess = await resolvePaidKpiAccessForStudent(studentId);
      const projected = projectGuardianExamSessionList(sessions, {
        hasPaidAccess: studentAccess.hasPaidAccess,
      });

      logger.info(
        "GUARDIAN",
        "full_length_history_view",
        "Guardian viewed student full-length history",
        {
          guardianId,
          studentId,
          count: projected.length,
          requestId,
        },
      );
      await emitGuardianAccessEvent({
        eventType: "guardian_report_viewed",
        guardianId,
        studentId,
        requestId,
        details: { surface: "full_length_history", count: projected.length },
      });

      return res.json({
        studentId,
        sessions: projected,
        requestId,
      });
    } catch (err) {
      logger.error("GUARDIAN", "full_length_history", "Error", {
        err,
        requestId,
      });
      return res
        .status(500)
        .json({ error: "Internal server error", requestId });
    }
  },
);

router.get(
  "/students/:studentId/exams/full-length/:sessionId/report",
  requireSupabaseAuth,
  requireGuardianAccess,
  requireGuardianEntitlement,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    try {
      const guardianId = req.user!.id;
      const isAdmin = req.user!.role === "admin";
      const { studentId, sessionId } = req.params;

      if (!isAdmin) {
        const linked = await isGuardianLinkedToStudent(guardianId, studentId);
        if (!linked) {
          logger.warn(
            "GUARDIAN",
            "full_length_report_denied",
            "Guardian tried to view non-linked student full-length report",
            {
              guardianId,
              studentId,
              sessionId,
              requestId,
            },
          );
          await emitGuardianAccessEvent({
            eventType: "guardian_access_denied",
            guardianId,
            studentId,
            requestId,
            details: {
              surface: "full_length_report",
              session_id: sessionId,
              reason: "not_linked",
            },
          });
          return res
            .status(403)
            .json({ error: "Not authorized to view this student", requestId });
        }
      }

      const report = await fullLengthExamService.getExamReport({
        sessionId,
        userId: studentId,
      });
      const studentView = buildStudentFullLengthReportView(report);

      logger.info(
        "GUARDIAN",
        "full_length_report_view",
        "Guardian viewed full-length exam report",
        {
          guardianId,
          studentId,
          sessionId,
          requestId,
        },
      );
      await emitGuardianAccessEvent({
        eventType: "guardian_report_viewed",
        guardianId,
        studentId,
        requestId,
        details: { surface: "full_length_report", session_id: sessionId },
      });

      return res.json({
        studentId,
        sessionId,
        report: projectGuardianFullLengthReportView(studentView),
        requestId,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "";

      if (message.includes("not found") || message.includes("access denied")) {
        return res.status(404).json({ error: "Session not found", requestId });
      }

      if (message.includes("Results locked until completion")) {
        return res
          .status(423)
          .json({ error: "Results locked until completion", requestId });
      }

      logger.error("GUARDIAN", "full_length_report", "Error", {
        err,
        requestId,
      });
      return res
        .status(500)
        .json({ error: "Internal server error", requestId });
    }
  },
);
// Guardian calendar endpoint is read-only by contract.
router.get(
  "/students/:studentId/calendar/month",
  requireSupabaseAuth,
  requireGuardianAccess,
  requireGuardianEntitlement,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    try {
      const guardianId = req.user!.id;
      const isAdmin = req.user!.role === "admin";
      const { studentId } = req.params;
      const start = req.query.start as string | undefined;
      const end = req.query.end as string | undefined;

      if (!isAdmin) {
        // CANONICAL: Verify link via guardian_links
        const linked = await isGuardianLinkedToStudent(guardianId, studentId);
        if (!linked) {
          logger.warn(
            "GUARDIAN",
            "calendar_access_denied",
            "Student not found or not linked",
            { guardianId, studentId, requestId },
          );
          await emitGuardianAccessEvent({
            eventType: "guardian_access_denied",
            guardianId,
            studentId,
            requestId,
            details: { surface: "calendar", reason: "not_linked" },
          });
          return res
            .status(404)
            .json({ error: "Student not found", requestId });
        }
      }

      if (!start || !isIsoDate(start)) {
        return res
          .status(400)
          .json({ error: "start query param must be YYYY-MM-DD", requestId });
      }
      if (!end || !isIsoDate(end)) {
        return res
          .status(400)
          .json({ error: "end query param must be YYYY-MM-DD", requestId });
      }

      const { data: profile, error: profileError } = await supabaseServer
        .from("student_study_profile")
        .select("timezone")
        .eq("user_id", studentId)
        .maybeSingle();

      if (profileError) {
        logger.error(
          "GUARDIAN",
          "calendar_profile_fetch_failed",
          "Failed to load student timezone for calendar",
          {
            error: profileError,
            requestId,
          },
        );
        return res
          .status(500)
          .json({ error: "Failed to load calendar data", requestId });
      }

      const timezone = profile?.timezone || "America/Chicago";
      const payload = await buildCalendarMonthView(
        studentId,
        start,
        end,
        timezone,
      );
      const projectedDays = payload.days.map((day: CalendarMonthDay) => ({
        day_date: day.day_date,
        planned_minutes: day.planned_minutes,
        completed_minutes: day.completed_minutes,
        status: day.status,
        attempt_count: day.attempt_count,
        accuracy: day.accuracy,
        avg_seconds_per_question: day.avg_seconds_per_question,
      }));

      logger.info(
        "GUARDIAN",
        "calendar_view",
        "Guardian viewed student calendar",
        { guardianId, studentId, start, end, requestId },
      );
      await emitGuardianAccessEvent({
        eventType: "guardian_calendar_viewed",
        guardianId,
        studentId,
        requestId,
        details: {
          surface: "calendar",
          start,
          end,
          day_count: projectedDays.length,
        },
      });

      return res.json({
        days: projectedDays,
        streak: payload.streak,
        requestId,
      });
    } catch (err) {
      logger.error("GUARDIAN", "calendar_month", "Error", { err, requestId });
      res.status(500).json({ error: "Internal server error", requestId });
    }
  },
);

// ============================================================================
// GUARDIAN WEAKNESS ROLLUPS - Domain-grain only (AC#19: no per-skill mastery for guardians)
// ============================================================================
/**
 * @spec [Parent AC#19 — guardian surfaces expose domain-grain only, never per-skill mastery;
 *   Doc 05B §5.4 — student_domain_mastery is student-readable] | @implemented [2026-06-23]
 * plain English: returns domain-level mastery tiers for a linked student. Per-skill rows and
 * accuracyPercent are removed (AC#19 violation closure). mastery_score/mastery_pct never cross
 * to the guardian surface.
 */
router.get(
  "/weaknesses/:studentId",
  requireSupabaseAuth,
  requireGuardianAccess,
  requireGuardianEntitlement,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    try {
      const guardianId = req.user!.id;
      const { studentId } = req.params;
      const section =
        typeof req.query.section === "string" ? req.query.section : undefined;

      const linked = await isGuardianLinkedToStudent(guardianId, studentId);
      if (!linked && req.user!.role !== "admin") {
        logger.warn(
          "GUARDIAN",
          "weaknesses_denied",
          "Guardian tried to view non-linked student",
          { guardianId, studentId, requestId },
        );
        await emitGuardianAccessEvent({
          eventType: "guardian_access_denied",
          guardianId,
          studentId,
          requestId,
          details: { surface: "weaknesses", reason: "not_linked" },
        });
        return res
          .status(403)
          .json({ error: "Not authorized to view this student", requestId });
      }

      // EVERYTHING ABOVE THIS LINE IS THE GATE. Everything below is the student read,
      // unmodified (owner standing rule 2026-08-21). The guardian path does not parse
      // differently, does not query differently, and does not shape differently — it
      // calls `readDomainMasteryView`, which is the same function
      // GET /api/me/mastery/domains calls, with the linked student's id.
      //
      // The domain-only narrowing (Doc 05 Parent AC#19 / RULE 7) is the ABSENCE of a
      // skill call, not a second derivation: there is no guardian skill endpoint.
      const parsedSection = parseSectionFilter(section);
      if (!parsedSection.ok) {
        return res.status(400).json({
          error: {
            message: "Invalid section",
            code: "INVALID_SECTION",
            details: parsedSection.details,
          },
          requestId,
        });
      }

      const { domains } = await readDomainMasteryView({
        studentId,
        section: parsedSection.section,
      });

      logger.info(
        "GUARDIAN",
        "weaknesses_view",
        "Guardian viewed student domain mastery",
        { guardianId, studentId, count: domains.length, requestId },
      );
      await emitGuardianAccessEvent({
        eventType: "guardian_report_viewed",
        guardianId,
        studentId,
        requestId,
        details: { surface: "weaknesses", count: domains.length },
      });

      // The body is the student body plus `requestId`. `count` is gone: it was a second
      // shape of `domains.length`, and it is the field the broken client branched on —
      // `weaknessData.count === 0` is precisely what hid the `.map` of undefined.
      return res.json({
        ok: true,
        domains,
        requestId,
      });
    } catch (err) {
      logger.error("GUARDIAN", "weaknesses", "Error", { err, requestId });
      res.status(500).json({ error: "Internal server error", requestId });
    }
  },
);

export default router;
