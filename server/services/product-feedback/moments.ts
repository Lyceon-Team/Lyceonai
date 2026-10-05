/**
 * The review prompt's success moments, verified from data the product already reads.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R30 ("success moments only"); owner Step 0
 *       answers 3 and 4 (2026-10-05): "previous week had ≥1 block and all were completed, shown
 *       on /calendar"; "the dashboard with ≥1 completed block this week"] | @implemented [2026-10-05]
 *
 * plain English: three yes/no checks, each built on an existing read, with no new tracking:
 *   - exam_report: `readExamReport` — the same ownership and entitlement path the report page
 *     uses — says the caller's session is `scored` or `partial_scored`. A report still scoring,
 *     unavailable or someone else's is no.
 *   - study_week: the student's calendar for LAST week (Monday-anchored, in their own time zone,
 *     the plan's R-08-30 week) has blocks_total >= 1 and blocks_completed === blocks_total. Needs
 *     calendar_access, as the calendar does.
 *   - guardian_week: the guardian passes the guardian visibility rule for this student (active
 *     link AND student entitlement — `resolveGuardianViewDecision`, the one derivation), the
 *     access is recorded like every guardian read of a student, and the student's calendar for
 *     THIS week has blocks_completed >= 1.
 *
 * Fail closed: an error, a missing profile, an unentitled or unlinked student is "no moment".
 * The answer never leaves the server except as show / don't show, so nothing about the student
 * reaches the guardian through it.
 */
import { readExamReport } from "../exam-report-service";
import { EXAM_FEATURE_KEY } from "../exam-runtime-service";
import { EntitlementService } from "../entitlement-service";
import { readCalendar, readGuardianCalendar } from "../calendar/read-service";
import { readStudyProfile } from "../calendar/profile-service";
import { localTodayIn } from "../calendar/adapters/local-day";
import { resolveGuardianViewDecision } from "../guardian-subject";
import { recordSubjectAccess } from "../subject-access-audit";
import { CALENDAR_FEATURE_KEY } from "../../routes/calendar-routes";
import {
  addDaysToLocalDate,
  startOfLocalWeek,
} from "../../../packages/shared/src/calendar/time";
import { logger } from "../../logger";
import type { MomentChecks } from "./product-feedback-service";

const WEEK_DAYS = 7;

function failClosed(check: string, error: unknown, requestId?: string): false {
  logger.warn(
    "PRODUCT_FEEDBACK",
    "moment_check_failed",
    "A review-prompt moment check failed; no prompt",
    {
      check,
      requestId,
      reason: error instanceof Error ? error.message : "unknown",
    },
  );
  return false;
}

/** The Monday..Sunday week containing `today`, shifted by `weeksBack`. */
function weekRange(
  today: string,
  weeksBack: number,
): { from: string; to: string } {
  const from = addDaysToLocalDate(
    startOfLocalWeek(today),
    -WEEK_DAYS * weeksBack,
  );
  return { from, to: addDaysToLocalDate(from, WEEK_DAYS - 1) };
}

export function liveMomentChecks(requestId?: string): MomentChecks {
  return {
    async examReportReady(studentId, sessionId) {
      try {
        const read = await readExamReport(studentId, sessionId, () =>
          EntitlementService.canAccessFeature(studentId, EXAM_FEATURE_KEY),
        );
        return (
          read.kind === "report" &&
          (read.state === "scored" || read.state === "partial_scored")
        );
      } catch (error) {
        return failClosed("exam_report", error, requestId);
      }
    },

    async studyWeekCompleted(studentId) {
      try {
        if (
          !(await EntitlementService.canAccessFeature(
            studentId,
            CALENDAR_FEATURE_KEY,
          ))
        ) {
          return false;
        }
        const profile = await readStudyProfile(studentId, requestId);
        if (profile === null) return false;
        const lastWeek = weekRange(localTodayIn(profile.timezone), 1);
        const result = await readCalendar({
          student_id: studentId,
          query: lastWeek,
          ...(requestId === undefined ? {} : { request_id: requestId }),
        });
        if (!result.ok || result.value.status !== "ready") return false;
        const { blocks_total, blocks_completed } = result.value.facts;
        return blocks_total >= 1 && blocks_completed === blocks_total;
      } catch (error) {
        return failClosed("study_week", error, requestId);
      }
    },

    async guardianWeekProgress(guardianId, studentId) {
      try {
        const decision = await resolveGuardianViewDecision(
          guardianId,
          studentId,
          requestId,
        );
        const recorded = await recordSubjectAccess({
          principalId: guardianId,
          studentId,
          decision,
          resource: "/api/feedback/prompt#guardian_week",
          ...(requestId === undefined ? {} : { requestId }),
        });
        if (decision !== "allow" || !recorded) return false;
        if (
          !(await EntitlementService.canAccessFeature(
            studentId,
            CALENDAR_FEATURE_KEY,
          ))
        ) {
          return false;
        }
        const profile = await readStudyProfile(studentId, requestId);
        if (profile === null) return false;
        const thisWeek = weekRange(localTodayIn(profile.timezone), 0);
        const result = await readGuardianCalendar({
          student_id: studentId,
          query: thisWeek,
          ...(requestId === undefined ? {} : { request_id: requestId }),
        });
        if (!result.ok || result.value.status !== "ready") return false;
        return result.value.facts.blocks_completed >= 1;
      } catch (error) {
        return failClosed("guardian_week", error, requestId);
      }
    },
  };
}
