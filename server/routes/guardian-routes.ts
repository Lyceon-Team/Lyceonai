import { Request, Response, Router } from "express";
import {
  getSupabaseAdmin,
  requireSupabaseAuth,
} from "../middleware/supabase-auth";
import { requireGuardianEntitlement } from "../middleware/guardian-entitlement";
import { requireGuardianRole } from "../middleware/guardian-role";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { createDurableRateLimiter } from "../lib/durable-rate-limiter";
import {
  createGuardianLink,
  revokeGuardianLink,
  isGuardianLinkedToStudent,
  getAllGuardianStudentLinks,
  ensureAccountForUser,
} from "../lib/account";
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
  projectGuardianKpiView,
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

/**
 * `catch (e: any)` then `e?.code` / `e.message` is a §3.2 hard stop that also reads
 * properties off a value of unknown shape. `unknown` at the boundary, narrowed here.
 *
 * These return null / a fallback rather than throwing: a thrown error whose shape surprises
 * us must still reach the error branch it belongs to, not replace it with a second failure.
 */
function errorCode(value: unknown): string | null {
  if (typeof value === "object" && value !== null && "code" in value) {
    const code = (value as { code: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "object" && value !== null && "message" in value) {
    const message = (value as { message: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return "unknown error";
}

const router = Router();

const durableRateLimiter = createDurableRateLimiter(10, 15 * 60 * 1000);
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

async function auditLog(
  guardianId: string,
  action: "link_attempt" | "link_success" | "unlink_success",
  outcome: "success" | "failure" | "rate_limited",
  studentId?: string,
  reason?: string,
  codePrefix?: string,
  requestId?: string,
) {
  try {
    const { error } = await supabaseServer.from("guardian_link_audit").insert({
      guardian_profile_id: guardianId,
      student_profile_id: studentId || null,
      action,
      outcome,
      student_code_prefix: codePrefix || null,
      request_id: requestId || null,
      metadata: reason ? { reason } : null,
    });
    if (error) {
      logger.error("GUARDIAN", "audit_log", "Failed to write audit log", {
        error,
        requestId,
      });
    }
  } catch (err) {
    logger.error("GUARDIAN", "audit_log", "Failed to write audit log", {
      err,
      requestId,
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

      const studentIds = links.map((l) => l.student_user_id);
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

router.post(
  "/link",
  requireSupabaseAuth,
  requireGuardianAccess,
  durableRateLimiter,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    try {
      const guardianId = req.user!.id;
      const { code } = req.body;

      if (!code || typeof code !== "string") {
        return res
          .status(400)
          .json({ error: "Student link code is required", requestId });
      }

      const trimmedCode = code
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      if (trimmedCode.length !== 8) {
        await auditLog(
          guardianId,
          "link_attempt",
          "failure",
          undefined,
          "invalid_format",
          trimmedCode.substring(0, 2),
          requestId,
        );
        return res
          .status(400)
          .json({ error: "Invalid code format", requestId });
      }

      const { data: student, error: lookupError } = await supabaseServer
        .from("profiles")
        .select("id, email, display_name")
        .eq("student_link_code", trimmedCode)
        .eq("role", "student")
        .single();

      if (lookupError || !student) {
        await auditLog(
          guardianId,
          "link_attempt",
          "failure",
          undefined,
          "code_not_found",
          trimmedCode.substring(0, 2),
          requestId,
        );
        logger.warn("GUARDIAN", "link_attempt_failed", "Invalid code attempt", {
          guardianId,
          requestId,
        });
        return res
          .status(404)
          .json({ error: "Invalid or unavailable student code", requestId });
      }

      // CANONICAL: Check guardian_links for existing link
      const alreadyLinked = await isGuardianLinkedToStudent(
        guardianId,
        student.id,
      );
      if (alreadyLinked) {
        await auditLog(
          guardianId,
          "link_attempt",
          "success",
          student.id,
          "already_linked",
          undefined,
          requestId,
        );
        return res.json({
          ok: true,
          message: "Already linked",
          student: { id: student.id, display_name: student.display_name },
          requestId,
        });
      }

      // CANONICAL: Create link in guardian_links with resolved student account_id
      try {
        const studentAccountId = await ensureAccountForUser(
          getSupabaseAdmin(),
          student.id,
          "student",
        );
        await createGuardianLink(guardianId, student.id, studentAccountId);
      } catch (linkError: unknown) {
        if (errorCode(linkError) === "GUARDIAN_ALREADY_LINKED") {
          await auditLog(
            guardianId,
            "link_attempt",
            "failure",
            student.id,
            "guardian_already_linked_other",
            trimmedCode.substring(0, 2),
            requestId,
          );
          return res.status(409).json({
            error:
              "Guardian already linked to another student. Unlink before linking a new student.",
            code: "GUARDIAN_ALREADY_LINKED",
            requestId,
          });
        }

        if (errorCode(linkError) === "STUDENT_ALREADY_LINKED") {
          await auditLog(
            guardianId,
            "link_attempt",
            "failure",
            student.id,
            "already_linked_other",
            trimmedCode.substring(0, 2),
            requestId,
          );
          return res
            .status(404)
            .json({ error: "Invalid or unavailable student code", requestId });
        }

        await auditLog(
          guardianId,
          "link_attempt",
          "failure",
          student.id,
          "update_failed",
          undefined,
          requestId,
        );
        logger.error("GUARDIAN", "link_student", "Failed to link student", {
          error: errorMessage(linkError),
          requestId,
        });
        return res
          .status(500)
          .json({ error: "Failed to link student", requestId });
      }

      await auditLog(
        guardianId,
        "link_success",
        "success",
        student.id,
        undefined,
        undefined,
        requestId,
      );
      logger.info("GUARDIAN", "link_student", "Student linked successfully", {
        guardianId,
        studentId: student.id,
        requestId,
      });

      res.json({
        ok: true,
        student: { id: student.id, display_name: student.display_name },
        requestId,
      });
    } catch (err) {
      logger.error("GUARDIAN", "link_student", "Error", { err, requestId });
      res.status(500).json({ error: "Internal server error", requestId });
    }
  },
);

router.delete(
  "/link/:studentId",
  requireSupabaseAuth,
  requireGuardianAccess,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    try {
      const guardianId = req.user!.id;
      const { studentId } = req.params;

      // CANONICAL: Verify link exists in guardian_links
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

      // CANONICAL: Revoke link in guardian_links
      try {
        await revokeGuardianLink(guardianId, studentId);
      } catch (revokeError: unknown) {
        if (errorCode(revokeError) === "LINK_NOT_ACTIVE") {
          logger.warn(
            "GUARDIAN",
            "unlink_conflict",
            "Guardian link no longer active at revoke time",
            { guardianId, studentId, requestId },
          );
          return res.status(409).json({
            error: "Link is no longer active",
            code: "LINK_NOT_ACTIVE",
            requestId,
          });
        }
        logger.error("GUARDIAN", "unlink_student", "Failed to unlink student", {
          error: errorMessage(revokeError),
          requestId,
        });
        return res
          .status(500)
          .json({ error: "Failed to unlink student", requestId });
      }

      await auditLog(
        guardianId,
        "unlink_success",
        "success",
        studentId,
        undefined,
        undefined,
        requestId,
      );
      logger.info(
        "GUARDIAN",
        "unlink_student",
        "Student unlinked successfully",
        { guardianId, studentId, requestId },
      );

      // Return updated student list from canonical source
      const links = await getAllGuardianStudentLinks(guardianId);
      const studentIds = links.map((l) => l.student_user_id);
      let students: LinkedStudentRow[] = [];
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

      // Same builder the student KPI route calls (server/routes/legacy/progress.ts),
      // then a PURE projection to the guardian-granted metric set. No second derivation
      // and no coercion — see projectGuardianKpiView.
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
      const projected = projectGuardianKpiView(studentView);

      await emitGuardianAccessEvent({
        eventType: "guardian_report_viewed",
        guardianId,
        studentId,
        requestId,
        details: { surface: "summary" },
      });

      // The guardian body IS the student envelope, metrics narrowed. No `student` block:
      // it was a guardian-only addition, and the dashboard already knows which student it
      // selected — it does not need the server to name them back inside a KPI payload.
      return res.json({
        ...projected,
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
