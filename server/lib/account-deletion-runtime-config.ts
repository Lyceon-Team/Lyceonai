import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { classifyError } from "./redact";

/**
 * Reader for `account_deletion_runtime_config` — the one owner of that config read.
 *
 * @spec [Doc-01_V8 App A.5 (grace_period_days 7, min 1, max 30); Doc-01_V8 §40 (the 7-day
 *        soft-delete window); owner brief 2026-09-17 "Deletion Vertical: Phases 2, 3, 5" §5.3]
 *        | @implemented [2026-09-17]
 *
 * plain English: how long an account sits recoverable before the hard delete is an operator
 * decision, not a deploy. The table has existed since genesis holding nothing and read by
 * nobody; migration 20260917120000 seeds it and this is its first consumer.
 *
 * WHY IT MIRRORS `auth-runtime-config.ts` RATHER THAN GENERALISING. Every config domain in this
 * repo has its own reader, with the table name as a constant rather than a parameter, because a
 * generic reader turns a typo into a silent empty read. Extending the pattern is the established
 * shape; a second, generic mechanism would be the fork.
 *
 * WHY THE FALLBACK IS THE SPEC DEFAULT AND NOT `null`. `auth-runtime-config.ts` returns null and
 * lets the caller fail closed, because an unreadable link-code TTL should kill the code. The
 * fail-closed direction here is the opposite: a missing config row must never SHORTEN the
 * window, because that deletes an account earlier than the date the person was promised in
 * writing. So an unreadable or out-of-range value falls back to App A.5's 7 days, loudly.
 *
 * WHY THE BOUNDS ARE CHECKED HERE TOO. The column CHECK constrains value_type, not the value;
 * App A.5's min/max live in the seeded row as data. A row edited to 0 would schedule the hard
 * delete for the same instant as the request, destroying the recovery window the lifecycle is
 * built around — so a value outside 1..30 is refused in favour of the default.
 */
export const DELETION_GRACE_DAYS_KEY = "grace_period_days";

/** App A.5's launch value. The floor the reader falls back to, never silently. */
export const DELETION_GRACE_DAYS_DEFAULT = 7;
const DELETION_GRACE_DAYS_MIN = 1;
const DELETION_GRACE_DAYS_MAX = 30;

export async function getDeletionGraceDays(): Promise<number> {
  const { data, error } = await supabaseServer
    .from("account_deletion_runtime_config")
    .select("value")
    .eq("key", DELETION_GRACE_DAYS_KEY)
    .maybeSingle();

  if (error) {
    logger.error(
      "DELETION",
      "grace_period_read_failed",
      "Could not read the deletion grace period; using the App A.5 default so the window cannot shorten",
      undefined,
      { key: DELETION_GRACE_DAYS_KEY, ...classifyError(error) },
    );
    return DELETION_GRACE_DAYS_DEFAULT;
  }

  const raw = (data as { value?: unknown } | null)?.value;
  const days = typeof raw === "number" ? raw : Number(raw);
  if (
    !Number.isInteger(days) ||
    days < DELETION_GRACE_DAYS_MIN ||
    days > DELETION_GRACE_DAYS_MAX
  ) {
    logger.error(
      "DELETION",
      "grace_period_out_of_range",
      "The configured deletion grace period is missing or outside App A.5's bounds; using the default",
      undefined,
      {
        key: DELETION_GRACE_DAYS_KEY,
        min: DELETION_GRACE_DAYS_MIN,
        max: DELETION_GRACE_DAYS_MAX,
      },
    );
    return DELETION_GRACE_DAYS_DEFAULT;
  }
  return days;
}
