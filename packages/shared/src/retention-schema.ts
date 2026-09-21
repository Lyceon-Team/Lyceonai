/**
 * @spec [Privacy Policy v3 §6.7 (the 90-day operational-record ceiling);
 *        Doc-06D_V1.0 §9 (a retention rule without a mechanism is retention
 *        drift); lyceon-coding-standards §7.2 (Zod first, types inferred);
 *        SCL-101 (the catch-all recorded as a build commitment)]
 * @implemented 2026-09-21
 *
 * plain English: the boundary contract for the operational-log retention
 * sweep. The SQL function owns the RULE — how long, which tables, which time
 * column — and this file owns only the shape of what it hands back, so the
 * server can parse it instead of trusting it.
 *
 * expected outcome: one row per swept table per run, including tables that
 * deleted nothing.
 *
 * trade-offs:
 *  - The window is deliberately NOT here. It lives in
 *    `public.operational_log_retention_days()` and nowhere else; a constant in
 *    TypeScript would be a second place for 90 to be written down, and the
 *    first one to drift. Only the per-call batch bound lives here, because
 *    that is a caller's concern rather than a policy one.
 *  - `swept_table` is a plain string, not an enum of the four table names.
 *    The set is the SQL function's array; duplicating it as a TS union would
 *    make adding a fifth table a two-file change and let the two lists
 *    disagree silently.
 */
import { z } from "zod";

/**
 * Per-table, per-call bound. Not the retention window — see the note above.
 * Sized so a day's worth of any one of these tables clears in a single run
 * while still bounding a runaway backfill.
 */
export const OPERATIONAL_LOG_SWEEP_BATCH_SIZE = 5000;

/** Row shape returned by `public.sweep_operational_log_retention(p_batch_size)`. */
export const operationalLogSweepRowSchema = z.object({
  swept_table: z.string().min(1),
  deleted_count: z.number().int().min(0),
  cutoff: z.string().datetime({ offset: true }),
});
export type OperationalLogSweepRow = z.infer<
  typeof operationalLogSweepRowSchema
>;
