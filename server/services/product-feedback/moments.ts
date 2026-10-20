/**
 * The review ask's moment checks, verified from data the product already holds.
 *
 * @spec [owner brief "Review ask — in-app prompt + one email, industry standard" (Karl,
 *       2026-10-20); Karl's Step 0 decisions 3 ("7+ days since signup and 3+ completed sessions
 *       (QOTD excluded); retire the 'full week completed' moment") and 7 ("never shows while the
 *       Getting started checklist is active"); owner brief "Student dashboard — Getting started
 *       checklist" (final brief v2, Karl, 2026-10-13) §3] | @implemented [2026-10-20]
 *
 * plain English: two yes/no checks, no new tracking:
 *   - usageMet: `review_ask_usage_met` in SQL, the trigger's one definition — a student 7+ days
 *     after signup with 3+ completed sessions (practice except the daily question, review,
 *     full-length); a guardian with an active link 7+ days old to a student they may see
 *     (`guardian_view_decision` = 'allow', the one visibility rule) who has 3+. It returns a
 *     boolean only: nothing about any student leaves the database through it, so no subject
 *     access is recorded (none is served).
 *   - checklistActive: the student's Getting started checklist still has an open step. Read the
 *     way Home reads it (`getting_started_observe`, then `deriveGettingStarted` for the student's
 *     plan), so the ask and the card can never disagree. A finished card waiting for its Dismiss
 *     is not active: the ask sits below it.
 *
 * Fail closed: an error is "no ask" for usageMet and "active" for the checklist, so a failure
 * never burns one of the two asks.
 */
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { defaultAudience } from "../../routes/getting-started-routes";
import {
  deriveGettingStarted,
  gettingStartedObservationSchema,
} from "../../../packages/shared/src/getting-started-schema";
import { logger } from "../../logger";
import type { FeedbackCaller, MomentChecks } from "./product-feedback-service";

function failClosed<T>(
  check: string,
  result: T,
  error: unknown,
  requestId?: string,
): T {
  logger.warn(
    "PRODUCT_FEEDBACK",
    "moment_check_failed",
    "A review-ask moment check failed; no ask",
    {
      check,
      requestId,
      reason: error instanceof Error ? error.message : "unknown",
    },
  );
  return result;
}

export function liveMomentChecks(requestId?: string): MomentChecks {
  return {
    async usageMet(profileId: string): Promise<boolean> {
      try {
        const { data, error } = await supabaseServer.rpc(
          "review_ask_usage_met",
          { p_profile_id: profileId },
        );
        if (error) throw new Error(error.message);
        return data === true;
      } catch (error) {
        return failClosed("usage", false, error, requestId);
      }
    },

    async checklistActive(caller: FeedbackCaller): Promise<boolean> {
      try {
        const { data, error } = await supabaseServer.rpc(
          "getting_started_observe",
          { p_profile_id: caller.profileId },
        );
        if (error) throw new Error(error.message);
        const obs = gettingStartedObservationSchema.parse(data);
        const view = deriveGettingStarted(
          obs,
          await defaultAudience({
            id: caller.profileId,
            // Only the student moment asks (reviewMomentFitsRole).
            role: "student",
            is_under_13: caller.isUnder13,
          }),
        );
        return !view.dismissed && !view.complete;
      } catch (error) {
        return failClosed("checklist", true, error, requestId);
      }
    },
  };
}
