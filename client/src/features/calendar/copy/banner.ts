/**
 * @spec [Doc_05F_Study_Calendar, §17.4 plan-updated banner (INV-08-13), §12.1 triggers]
 * @implemented [2026-09-23]
 *
 * plain English: the sentence in the banner that appears when something OTHER than the
 * student changed their plan. Expected outcome: the banner names what happened, and
 * dismissing it acknowledges that exact version.
 *
 * §17.4 gives three sentences — "Your plan was refreshed for the week", "…after your exam",
 * "…was restored by support" — but never says which `trigger` literal maps to which. The
 * mapping below is the only reading that fits: `weekly` is the week refresh, `post_exam` is
 * the one after an exam, `rollback` is support restoring a plan. It is written here, once,
 * rather than inline in the banner component, so the day the owner rules on the wording
 * there is one file to change.
 *
 * WHY THE STUDENT'S OWN TRIGGERS RETURN NULL. §12.7 only surfaces a version with
 * `initiated_by <> 'student'`, so `day_edit`, `student_refresh` and the rest can never reach
 * this in practice. They return null anyway rather than falling through to a default
 * sentence: telling students their plan was "refreshed for the week" because they moved a
 * block would be a lie the server never asked us to tell.
 */
import type { PlanTrigger } from "@lyceon/shared/calendar";

const BANNER_COPY: Partial<Readonly<Record<PlanTrigger, string>>> = {
  weekly: "Your plan was refreshed for the week.",
  post_exam: "Your plan was updated after your practice test.",
  rollback: "Your plan was restored by support.",
  // `setup` and `profile_change` are student-initiated and never surface here; listing them
  // with copy would imply they can.
};

/**
 * The banner sentence for a trigger, or null when there is nothing to say. A null means the
 * banner does not render at all — never an empty bar.
 */
export function bannerCopy(trigger: PlanTrigger): string | null {
  return BANNER_COPY[trigger] ?? null;
}

/** Exported for the test that pins the three §17.4 sentences. */
export const BANNER_COPY_TABLE = BANNER_COPY;
