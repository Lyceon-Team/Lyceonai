import { Request, Response, Router } from "express";
import { requireSupabaseAuth } from "../middleware/supabase-auth";
import { requireGuardianEntitlement } from "../middleware/guardian-entitlement";
// Q7 denials reuse the resolver's 404 body verbatim. A second "not found" shape would let a
// caller tell the two surfaces apart, which is the whole thing the shared body prevents.
import { sendNotFound } from "../middleware/subject-resolver";
import { requireGuardianRole } from "../middleware/guardian-role";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { auditGuardianLink } from "../services/guardian-link-audit";
import { guardianLinkRateLimit } from "../middleware/guardian-link-rate-limit";
import { z } from "zod";
import {
  createGuardianLink,
  acceptGuardianLink,
  revokeGuardianLink,
  isGuardianLinkedToStudent,
  getAllGuardianStudentLinks,
  getGuardianLinkById,
  getAnyGuardianLinkForPair,
} from "../lib/account";
// The error contract comes from the contract module, NOT from `../lib/account`: a route
// that imports its error mapping from the module it also imports its functions from loses
// that mapping whenever the module is substituted, and reports 500 instead of the specified
// status. See packages/shared/src/guardian-link-schema.ts.
import {
  GUARDIAN_LINK_ERROR,
  guardianLinkRequestSchema,
} from "../../packages/shared/src/guardian-link-schema";
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
      const parsed = guardianLinkRequestSchema.safeParse(req.body);

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

      // @spec [owner ruling 2026-08-27 Q7] | @implemented [2026-08-28]
      //
      // PARTY-HOOD DECIDES 404-VERSUS-409, AND ONLY A READ CAN ANSWER IT.
      // `accept_guardian_link_audited` raises the SAME `WRONG_ACCEPTOR` (LY002) for the party
      // who must wait and for a stranger who guessed a link id, so the error alone cannot tell
      // them apart. This route used to answer 403 to both, which confirmed to a stranger that
      // the link exists. Now: not named on the link → 404, indistinguishable from a link id
      // that does not exist; named on it → the informative answer, as 409, because being asked
      // to wait for the other party is a STATE CONFLICT and not an authorization failure.
      //
      // Identical to the student-side route's handling (`student-resources.ts`), deliberately
      // and by reusing the same reader: two routes serving the two halves of one flow must not
      // answer the same question differently, which is the divergence class this whole vertical
      // exists to remove.
      let existing;
      try {
        existing = await getGuardianLinkById(linkId);
      } catch (readError: unknown) {
        logger.error("GUARDIAN", "accept_link", "Failed to read link", {
          reason: readError instanceof Error ? readError.message : "unknown",
          requestId,
        });
        return res
          .status(500)
          .json({ error: { message: "Failed to accept link" }, requestId });
      }

      if (!existing || existing.guardian_profile_id !== guardianId) {
        return sendNotFound(res, requestId);
      }

      let link;
      try {
        link = await acceptGuardianLink(linkId, guardianId);
      } catch (acceptError: unknown) {
        const code = errorCode(acceptError);

        // The caller is a party (checked above), so both of these are state conflicts.
        if (
          code === GUARDIAN_LINK_ERROR.WRONG_ACCEPTOR ||
          code === GUARDIAN_LINK_ERROR.NOT_PENDING
        ) {
          return res.status(409).json({
            error: {
              message: "This link is not awaiting your acceptance",
              code,
            },
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

      // @spec [owner ruling 2026-08-27 Q7] | @implemented [2026-08-28]
      //
      // Was a flat 403 on "no ACTIVE link", which conflated two different callers: a guardian
      // whose link to this student was already revoked, and a guardian with no connection to
      // this student at all. The second learns from a 403 that the student exists; the first
      // learns nothing they did not already know. Q7 splits them on PARTY-HOOD.
      const existing = await getAnyGuardianLinkForPair(guardianId, studentId);

      if (!existing) {
        logger.warn(
          "GUARDIAN",
          "unlink_denied",
          "Guardian tried to unlink a student they are not a party to",
          { guardianId, studentId, requestId },
        );
        return sendNotFound(res, requestId);
      }

      if (existing.status !== "active") {
        // A party, so the real state is safe to name — and useful, because the most likely
        // cause is a link already revoked from the student's side or in another tab.
        logger.warn(
          "GUARDIAN",
          "unlink_conflict",
          "Guardian tried to unlink a link that is not active",
          { guardianId, studentId, requestId },
        );
        return res.status(409).json({
          error: {
            message: "This link is not active",
            code: GUARDIAN_LINK_ERROR.NOT_ACTIVE,
          },
          requestId,
        });
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
      const { studentId } = req.params;

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
  // RENAMED 2026-08-27 to match Doc 04C §895, which specifies
  // `GET /api/guardian/students/:student_id/tests/:session_id/report`. The live path was
  // the exams/full-length report path — same resource, a path the spec does not name.
  // 04C keeps this as a SEPARATE guardian route on purpose; its invariant #7 is about the
  // payload being a projected subset of the student's, which #645 delivered, not about
  // folding it into the student topology.
  "/students/:studentId/tests/:sessionId/report",
  requireSupabaseAuth,
  requireGuardianAccess,
  requireGuardianEntitlement,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    try {
      const guardianId = req.user!.id;
      const { studentId, sessionId } = req.params;

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
      const { studentId } = req.params;
      const start = req.query.start as string | undefined;
      const end = req.query.end as string | undefined;

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

export default router;
