/**
 * The student's practice quota for today, as `GET /api/practice/quota` returns it.
 *
 * @spec [student-UI register OQ-21, owner ruling (Karl) 2026-10-02: a read-only
 *        `GET /api/practice/quota`, computed by the same function as the 402
 *        (`checkAndReservePracticeQuota`, dry run); Doc 02B §12 Entitlement Matrix ("Practice
 *        questions per day": free `daily_quota_free`, premium unlimited); Doc 01A §40
 *        (`getUsage`: the read-only usage/limit/reset of a bucket, `practice_daily_free` per
 *        §46)] | @implemented [2026-10-03]
 *
 * plain English: what the free quota line and ruler on Home and Practice draw ("N of 40 left
 * today"). Two shapes, told apart by `unlimited`:
 *   - a free student: `{unlimited: false, limit, remaining, resetAt}`, the numbers the 402 body
 *     carries when the quota runs out (`remaining` 0 exactly when the serve route answers 402);
 *   - a paid student: `{unlimited: true, limit: null, remaining: null, resetAt: null}`. The
 *     enforcement skips the daily cap for an active entitlement, so there is no number to show.
 * "Today" is the local day of `practice_runtime_config.quota_reset_timezone` (America/Chicago),
 * and `resetAt` its next midnight as an absolute instant; the count is answers submitted, not
 * questions served (owner ruling OQ-43 / F-61, Karl, 2026-10-03; Doc 02B §13).
 * A display hint only: the serving routes still decide on every request.
 */
import { z } from "zod";

export const practiceQuotaLimitedSchema = z
  .object({
    unlimited: z.literal(false),
    limit: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    resetAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const practiceQuotaUnlimitedSchema = z
  .object({
    unlimited: z.literal(true),
    limit: z.null(),
    remaining: z.null(),
    resetAt: z.null(),
  })
  .strict();

export const practiceQuotaSchema = z.discriminatedUnion("unlimited", [
  practiceQuotaLimitedSchema,
  practiceQuotaUnlimitedSchema,
]);
export type PracticeQuota = z.infer<typeof practiceQuotaSchema>;
