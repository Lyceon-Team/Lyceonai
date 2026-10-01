/**
 * Reader for `entitlement_runtime_config` — the one owner of that config read.
 *
 * @spec [Doc 01 V6 §1705 "All identity/access constants live in DB per
 *        cross-cutting constants doctrine (INV-02B-15 extended to Doc 01
 *        scope)... `entitlement_runtime_config`"; INV-03-08 Tier 1 country
 *        gating; SCL-046] | @implemented [2026-08-28]
 *
 * plain English: reads operator-tunable entitlement constants out of the
 * database instead of hard-coding them. Expected outcome: the Tier-1 country
 * list is an operator action, not a deploy. Trade-off: a database read on the
 * checkout-completion path, which is a webhook and not a user request, so the
 * latency is Stripe's retry budget rather than a student's page load — and a
 * read failure must therefore be handled, not assumed away. Edge cases: an
 * absent row, a row whose JSON is not an array of strings, and a read error all
 * return `null`, which `evaluateCountryEligibility` turns into `unknown` and
 * `deniesEntitlement` turns into a denial. That chain is the fail-closed
 * default the owner ruled on 2026-08-27 and is deliberately NOT short-circuited
 * here.
 *
 * WHY NO CACHE. Doc 01 specifies `entitlement_hard_staleness_seconds` for the
 * entitlement decision itself; nothing specifies a TTL for this list, and
 * inventing one would be a second unreviewed constant. The call site is a
 * webhook, not a hot path.
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { classifyError } from "./redact";
import { err, ok, type Result } from "../../packages/shared/src/result";
import { TIER1_CONFIG_KEY } from "./stripe/country-eligibility";

/**
 * The Tier-1 country list, or `null` when it cannot be read as a list of
 * strings.
 *
 * `null` and `[]` are deliberately NOT distinguished by the caller: both mean
 * "the configuration has not been made", and `evaluateCountryEligibility`
 * already treats an absent-or-empty list as `unknown`. Returning `null` rather
 * than throwing keeps the fail-closed decision in the eligibility rule, which
 * is the one place it is written down.
 */
export async function getTier1Countries(): Promise<readonly string[] | null> {
  const { data, error } = await supabaseServer
    .from("entitlement_runtime_config")
    .select("value")
    .eq("key", TIER1_CONFIG_KEY)
    .maybeSingle();

  if (error) {
    logger.error(
      "ENTITLEMENT",
      "tier1_config_read_failed",
      `${TIER1_CONFIG_KEY} read failed; the country gate will DENY until this is resolved`,
      classifyError(error),
    );
    return null;
  }

  const value: unknown = data?.value;
  if (!Array.isArray(value)) {
    // Covers the unseeded case (no row) and a malformed row. Both are
    // configuration that has not been made correctly, and neither is a fact
    // about any user.
    return null;
  }

  const codes = value.filter((v): v is string => typeof v === "string");
  if (codes.length !== value.length) {
    logger.warn(
      "ENTITLEMENT",
      "tier1_config_malformed",
      `${TIER1_CONFIG_KEY} contains non-string entries; ignoring them`,
      { total: value.length, usable: codes.length },
    );
  }

  return codes;
}

// ── Post-exam score report and renewal decision (SCL-191) ───────────────────

/**
 * The four keys this flow reads, with the defaults that are also seeded into
 * `entitlement_runtime_config` by `20261015000000_exam_score_renewal_decision.sql`.
 *
 * WHY THE DEFAULTS ARE HERE AS WELL AS IN THE SEED, which looks like the duplication this
 * codebase forbids and is not. The seed is what an operator tunes; these are what the job uses
 * when a row is absent — a fresh environment, a seed that has not been applied, a key an operator
 * deleted. The alternative is a job that silently does nothing on a database that is missing one
 * row, and "nothing" here means nobody is ever prompted and nobody's subscription ever stops,
 * which is the failure this flow exists to prevent. Fail forward on a missing config row, fail
 * closed on an incoherent one (below).
 *
 * THE OFFSET IS 18, AND THE JUNE 2027 EXCEPTION IS WHY IT IS NOT 13 + 2 (owner ruling 2026-09-30
 * #2). College Board publishes "approximately 10 business days after test day" for SAT Weekend
 * (satsuite.collegeboard.org/scores/sat), which from a Saturday sitting lands on the Friday 13
 * CALENDAR days later — the pattern the brief observed, and the reason it is almost always a
 * Friday. 18 is that plus five days, so the score has been in the student's hands over a weekend
 * before we ask for it. The June 2027 administration releases at 16 days, on a MONDAY (owner's
 * figure, ruling #2): the 13-day pattern is a habit, not a rule, and anyone reading 18 as
 * "13 plus a buffer" and tightening it would break that administration.
 */
export const EXAM_RENEWAL_CONFIG_KEYS = {
  offsetDays: "score_prompt_offset_days",
  maxExamAgeDays: "score_prompt_max_exam_age_days",
  reminderLeadDays: "renewal_reminder_lead_days",
  noAnswerWindowDays: "renewal_no_answer_window_days",
} as const;

export const EXAM_RENEWAL_CONFIG_DEFAULTS = {
  offsetDays: 18,
  maxExamAgeDays: 45,
  reminderLeadDays: 21,
  noAnswerWindowDays: 14,
} as const;

export type ExamRenewalConfig = {
  readonly offsetDays: number;
  readonly maxExamAgeDays: number;
  readonly reminderLeadDays: number;
  readonly noAnswerWindowDays: number;
};

function positiveIntOr(value: unknown, fallback: number): number {
  // jsonb integers arrive as numbers over PostgREST and as numbers over node-pg; a string is a
  // malformed row, which is configuration that has not been made correctly rather than a fact
  // about anybody, so it takes the default rather than throwing.
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return fallback;
}

/**
 * The four thresholds, read once per job pass and passed into the SQL predicates as parameters.
 *
 * WHY THE JOB PASSES THEM IN RATHER THAN THE SQL READING THEM. This module is "the one owner of
 * that config read" (see the header). A second reader inside
 * `exam_score_renewal_candidates` would be a second source for the same four numbers, which is
 * the divergence CLAUDE.md's unified-code rule exists to prevent — and it would make every
 * threshold untestable without writing config rows.
 *
 * FAIL CLOSED ON AN INCOHERENT PAIR. `reminderLeadDays` must exceed `noAnswerWindowDays`, or the
 * no-answer cancellation is applied AFTER the invoice it exists to stop — the exact charge this
 * flow was built to prevent, arrived at through the config table. An operator who configures that
 * gets a refusal here rather than a flow that looks like it is working.
 */
export async function getExamRenewalConfig(): Promise<
  Result<ExamRenewalConfig, "RENEWAL_CONFIG_INCOHERENT">
> {
  const keys = Object.values(EXAM_RENEWAL_CONFIG_KEYS);
  const { data, error } = await supabaseServer
    .from("entitlement_runtime_config")
    .select("key, value")
    .in("key", keys);

  if (error) {
    logger.error(
      "ENTITLEMENT",
      "renewal_config_read_failed",
      "the post-exam renewal config could not be read; the seeded defaults are used",
      classifyError(error),
    );
  }

  const rows: readonly { key?: unknown; value?: unknown }[] = Array.isArray(
    data,
  )
    ? data
    : [];
  const byKey = new Map<string, unknown>();
  for (const row of rows) {
    if (typeof row.key === "string") byKey.set(row.key, row.value);
  }

  const resolved: ExamRenewalConfig = {
    offsetDays: positiveIntOr(
      byKey.get(EXAM_RENEWAL_CONFIG_KEYS.offsetDays),
      EXAM_RENEWAL_CONFIG_DEFAULTS.offsetDays,
    ),
    maxExamAgeDays: positiveIntOr(
      byKey.get(EXAM_RENEWAL_CONFIG_KEYS.maxExamAgeDays),
      EXAM_RENEWAL_CONFIG_DEFAULTS.maxExamAgeDays,
    ),
    reminderLeadDays: positiveIntOr(
      byKey.get(EXAM_RENEWAL_CONFIG_KEYS.reminderLeadDays),
      EXAM_RENEWAL_CONFIG_DEFAULTS.reminderLeadDays,
    ),
    noAnswerWindowDays: positiveIntOr(
      byKey.get(EXAM_RENEWAL_CONFIG_KEYS.noAnswerWindowDays),
      EXAM_RENEWAL_CONFIG_DEFAULTS.noAnswerWindowDays,
    ),
  };

  if (resolved.reminderLeadDays <= resolved.noAnswerWindowDays) {
    logger.error(
      "ENTITLEMENT",
      "renewal_config_incoherent",
      "renewal_reminder_lead_days must exceed renewal_no_answer_window_days, or the no-answer cancellation lands after the invoice; the job will not run",
      {
        reminderLeadDays: resolved.reminderLeadDays,
        noAnswerWindowDays: resolved.noAnswerWindowDays,
      },
    );
    return err("RENEWAL_CONFIG_INCOHERENT");
  }

  // The exam-age bound must leave room for the offset, or the exam anchor has an empty window and
  // every student silently falls to the billing-cycle path.
  if (resolved.maxExamAgeDays <= resolved.offsetDays) {
    logger.error(
      "ENTITLEMENT",
      "renewal_config_incoherent",
      "score_prompt_max_exam_age_days must exceed score_prompt_offset_days, or the exam anchor can never fire; the job will not run",
      {
        offsetDays: resolved.offsetDays,
        maxExamAgeDays: resolved.maxExamAgeDays,
      },
    );
    return err("RENEWAL_CONFIG_INCOHERENT");
  }

  return ok(resolved);
}
