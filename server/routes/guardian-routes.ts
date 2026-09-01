import { Request, Response, Router } from "express";
import { requireSupabaseAuth } from "../middleware/supabase-auth";
// Q7 denials reuse the resolver's 404 body verbatim. A second "not found" shape would let a
// caller tell the two surfaces apart, which is the whole thing the shared body prevents.
import { sendNotFound } from "../middleware/subject-resolver";
import { requireGuardianRole } from "../middleware/guardian-role";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { guardianLinkCodeEntryRateLimit } from "../middleware/guardian-link-rate-limit";

/**
 * ONE code for every refusal a redemption can give: malformed, expired, already used, never
 * real, or the caller's own. Four distinct codes would let a caller binary-search the
 * keyspace; one tells them the only actionable thing, which is to ask for a current code.
 */
const GUARDIAN_LINK_CODE_REFUSED = "GUARDIAN_LINK_CODE_REFUSED";
import {
  createActiveGuardianLink,
  revokeGuardianLink,
  isGuardianLinkedToStudent,
  getAllGuardianStudentLinks,
  getAnyGuardianLinkForPair,
} from "../lib/account";
// The error contract comes from the contract module, NOT from `../lib/account`: a route
// that imports its error mapping from the module it also imports its functions from loses
// that mapping whenever the module is substituted, and reports 500 instead of the specified
// status. See packages/shared/src/guardian-link-schema.ts.
import {
  GUARDIAN_LINK_ERROR,
  GuardianLinkError,
} from "../../packages/shared/src/guardian-link-schema";
import { redeemLinkCodeRequestSchema } from "../../packages/shared/src/student-link-code-schema";
import { redeemStudentLinkCode } from "../lib/student-link-code";
import { getStudentLinkCodeTtlSeconds } from "../lib/auth-runtime-config";

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
 * POST /api/guardian/link/redeem — a guardian enters a student's code.
 *
 * @spec [SCL-080 — the code replaces §36.1's two email-addressed initiation paths and its
 *        acceptance step; Doc 01 V8 §35 Guardian-student linkage; §36.2 abuse controls]
 *       | @implemented [2026-09-01]
 *
 * plain English: the guardian types six characters and the link is live. Expected outcome:
 * one `active` row, one audit record, one outbox notification to the student, and the code
 * spent so it cannot be used again.
 *
 * REACHABLE WITHOUT AN ENTITLEMENT, deliberately. A guardian has no entitlement of their own
 * (§31.1) and derives access from a linked student (§31.3) — so requiring one here would
 * demand the very thing linking is a precondition for. `requireGuardianAccess` gates the
 * ROLE; nothing gates payment.
 *
 * ONE RESPONSE FOR USED, EXPIRED AND NEVER-REAL (edge case 1). `redeemStudentLinkCode`
 * cannot distinguish them by construction — its conditional UPDATE matches nothing in all
 * three cases — and the handler must not reintroduce the distinction. Telling a caller that
 * a code "has already been used" confirms it was real, which is an oracle for guessing.
 *
 * THE RACE IS THE DATABASE'S (edge case 4). Two guardians submitting the same code both
 * reach one conditional UPDATE against one row; the first spends it, the second matches
 * nothing and gets the standard refusal.
 *
 * A STUDENT CANNOT REACH THIS ROUTE (edge case 3): `requireGuardianAccess` answers first, so
 * `guardian_not_self` is never the thing that refuses. The explicit identity check below is
 * defence in depth for an account holding both roles, and it runs BEFORE the write.
 */
router.post(
  "/link/redeem",
  requireSupabaseAuth,
  requireGuardianAccess,
  guardianLinkCodeEntryRateLimit,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    const guardianId = req.user!.id;

    const parsed = redeemLinkCodeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      // A malformed code is not distinguishable from a wrong one, for the same reason a used
      // one is not: both answers would tell the caller something about the keyspace.
      return res.status(400).json({
        error: {
          message: "That code is not valid. Ask your student for a current one.",
          code: GUARDIAN_LINK_CODE_REFUSED,
        },
        requestId,
      });
    }

    const ttlSeconds = await getStudentLinkCodeTtlSeconds();
    if (ttlSeconds === null) {
      return res.status(503).json({
        error: {
          message: "Link codes are not configured.",
          code: "LINK_CODE_UNCONFIGURED",
        },
        requestId,
      });
    }

    const outcome = await redeemStudentLinkCode(parsed.data.code, ttlSeconds);

    if (!outcome.ok && outcome.reason === "unavailable") {
      return res.status(503).json({
        error: { message: "Could not redeem that code. Please try again." },
        requestId,
      });
    }

    if (!outcome.ok) {
      return res.status(400).json({
        error: {
          message: "That code is not valid. Ask your student for a current one.",
          code: GUARDIAN_LINK_CODE_REFUSED,
        },
        requestId,
      });
    }

    const studentProfileId = outcome.studentProfileId;

    // Edge case 3, before any write. The code has already been spent at this point — which
    // is harmless, it was this account's own code rotating — but no link is created.
    if (studentProfileId === guardianId) {
      return res.status(400).json({
        error: {
          message: "That is your own code. Ask your guardian for theirs.",
          code: GUARDIAN_LINK_CODE_REFUSED,
        },
        requestId,
      });
    }

    try {
      const link = await createActiveGuardianLink(
        guardianId,
        studentProfileId,
        requestId,
      );

      // §36.1 step 6 in the shape SCL-080 leaves: the student is told, because they are the
      // party whose data just became visible. Emission only — there is no dispatcher, so
      // this is a row, not a message (CLAUDE.md, notification-outbox contract).
      const { error: outboxError } = await supabaseServer
        .from("notification_outbox")
        .insert({
          // Deterministic and insert-once: one notification per link, so a retry of this
          // request cannot produce a second.
          event_id: link.id,
          event_type: "guardian_linked",
          recipient_kind: "student",
          recipient_profile_id: studentProfileId,
          payload: { link_id: link.id, via: "student_link_code" },
        });
      if (outboxError && outboxError.code !== "23505") {
        // Never swallowed, never fatal: the link is real and the student's access is
        // unaffected by a missing notification row.
        logger.warn(
          "GUARDIAN",
          "link_notify",
          "Guardian link created but the outbox emission failed",
          { requestId, reason: outboxError.message },
        );
      }

      return res.status(201).json({
        data: { link_id: link.id, student_profile_id: studentProfileId },
        requestId,
      });
    } catch (err: unknown) {
      // LY004 — the pair is already linked. The guardian is a party to that link, so telling
      // them it exists discloses nothing they do not already know (edge case 2).
      if (
        err instanceof GuardianLinkError &&
        err.code === GUARDIAN_LINK_ERROR.ALREADY_EXISTS
      ) {
        return res.status(409).json({
          error: {
            message: "You are already linked to that student.",
            code: GUARDIAN_LINK_ERROR.ALREADY_EXISTS,
          },
          requestId,
        });
      }
      throw err;
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
export default router;
