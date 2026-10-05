/**
 * The Question of the Day scheduler: fill the schedule a few days ahead, deterministically.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R18 (one question per America/Chicago day,
 *       never repeated, enforced by the schedule table), Q1 ("deterministic scheduler on
 *       America/Chicago; eligibility excludes retired, already-scheduled and test_form_items");
 *       Coding Standards §4.1 (no randomness); owner Step 0 decisions 2026-10-05 (Vercel cron ->
 *       this job -> SQL; daily deploy hook rebuilds the archive; candidates screened against the
 *       shared banned-phrase list; questions with assets excluded)] | @implemented [2026-10-05]
 *
 * plain English: for each day from today to today + `daysAhead` that has no question yet:
 *   * the section alternates by day number (even = Math, odd = Reading and Writing, counted from
 *     QOTD_ROTATION_EPOCH), and the domain rotates through that section's four canonical domains
 *     (CANONICAL_DOMAINS_BY_SECTION order), one step every two days;
 *   * candidates come from qotd_schedule_candidates in canonical-id order (eligibility is the
 *     database's: published, no issue flags, no assets, not in a test form, never scheduled);
 *   * MCQs whose explanation names a choice letter (shared/practice/letter-reference.ts) are
 *     skipped: options are shuffled per request (owner ruling 2026-10-05), so "choice B" would
 *     name the wrong option;
 *   * the first candidate whose text matches no banned phrase (shared/seo/banned-phrases.ts) is
 *     inserted through qotd_schedule_insert, which re-checks eligibility and does nothing if the
 *     day is already filled. If a domain has nothing left, the next domain in rotation is tried,
 *     then the other section's domains, in the same fixed order.
 * The same database state always yields the same schedule. A rerun, or two overlapping runs,
 * change nothing: the date PK and the question_id UNIQUE make a second insert a no-op.
 *
 * After filling, it sweeps expired anonymous rate-limit rows (SCL-202: rows expire with their
 * window) and, when VERCEL_DEPLOY_HOOK_URL is set, triggers the production deploy that
 * prerenders yesterday's archive page.
 */
import { CANONICAL_DOMAINS_BY_SECTION } from "../../../shared/canonical-domains";
import { firstBannedPhrase } from "../../../shared/seo/banned-phrases";
import { explanationNamesChoiceLetter } from "../../../shared/practice/letter-reference";
import { parseCanonicalMcOptions } from "../../../shared/question-bank-contract";
import {
  addDaysToLocalDate,
  daysBetweenLocalDates,
} from "../../../packages/shared/src/calendar/time";
import { logger } from "../../logger";
import { qotdToday, type QotdDbClient } from "./qotd-service";

/** Day 0 of the section/domain rotation (a fixed constant: changing it reorders future days). */
export const QOTD_ROTATION_EPOCH = "2026-01-01";
export const QOTD_DAYS_AHEAD = 7;
const CANDIDATE_PAGE = 50;

type Section = "M" | "RW";

export type QotdDayOutcome =
  | {
      date: string;
      outcome: "inserted";
      questionId: string;
      section: Section;
      domain: string;
    }
  | { date: string; outcome: "exists" }
  | { date: string; outcome: "unfilled" };

export type QotdScheduleSummary = {
  today: string;
  days: QotdDayOutcome[];
  skippedBanned: number;
  /** MCQs skipped because the explanation names a choice letter (options are shuffled). */
  skippedLetterReference: number;
  sweptLedgerRows: number;
  deploy: "triggered" | "skipped_no_hook" | "failed";
};

/** The fixed order of (section, domain) pairs to try for a day. Pure. */
export function rotationFor(
  date: string,
): Array<{ section: Section; domain: string }> {
  const dayIndex = daysBetweenLocalDates(QOTD_ROTATION_EPOCH, date);
  const n = ((dayIndex % 2) + 2) % 2;
  const primary: Section = n === 0 ? "M" : "RW";
  const secondary: Section = primary === "M" ? "RW" : "M";
  const step = Math.floor(dayIndex / 2);
  const order: Array<{ section: Section; domain: string }> = [];
  for (const section of [primary, secondary]) {
    const domains = CANONICAL_DOMAINS_BY_SECTION[section];
    const start = ((step % domains.length) + domains.length) % domains.length;
    for (let k = 0; k < domains.length; k += 1) {
      const domain = domains[(start + k) % domains.length];
      if (domain !== undefined) order.push({ section, domain });
    }
  }
  return order;
}

type Candidate = {
  question_id: string;
  stem: string | null;
  passage: string | null;
  options: unknown;
  explanation: string | null;
};

function publicText(c: Candidate): string {
  const options = Array.isArray(c.options)
    ? c.options
        .map((o: unknown) =>
          o && typeof o === "object" && "text" in o ? String(o.text) : "",
        )
        .join(" ")
    : "";
  return [c.stem ?? "", c.passage ?? "", options, c.explanation ?? ""].join(
    " ",
  );
}

async function rpc(
  client: QotdDbClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data;
}

async function fillDay(
  client: QotdDbClient,
  date: string,
  counters: { skippedBanned: number; skippedLetterReference: number },
): Promise<QotdDayOutcome> {
  for (const { section, domain } of rotationFor(date)) {
    const data = await rpc(client, "qotd_schedule_candidates", {
      p_section: section,
      p_domain: domain,
      p_limit: CANDIDATE_PAGE,
    });
    const candidates = (Array.isArray(data) ? data : []) as Candidate[];
    for (const c of candidates) {
      // Today's options are shuffled per request (owner ruling 2026-10-05), so an explanation
      // that says "choice B" would name the wrong option for most visitors: skip the MCQ.
      if (
        parseCanonicalMcOptions(c.options).length > 0 &&
        explanationNamesChoiceLetter(c.explanation)
      ) {
        counters.skippedLetterReference += 1;
        continue;
      }
      if (firstBannedPhrase(publicText(c)) !== null) {
        counters.skippedBanned += 1;
        continue;
      }
      const result = await rpc(client, "qotd_schedule_insert", {
        p_date: date,
        p_question_id: c.question_id,
      });
      if (result === "inserted") {
        return {
          date,
          outcome: "inserted",
          questionId: c.question_id,
          section,
          domain,
        };
      }
      if (result === "exists") return { date, outcome: "exists" };
      // 'taken' or 'ineligible': a concurrent run used it, or it changed; try the next one.
    }
  }
  return { date, outcome: "unfilled" };
}

export async function runQotdSchedule(params: {
  client: QotdDbClient;
  now?: Date;
  daysAhead?: number;
  deployHookUrl?: string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<QotdScheduleSummary> {
  const today = qotdToday(params.now ?? new Date());
  const daysAhead = params.daysAhead ?? QOTD_DAYS_AHEAD;
  const counters = { skippedBanned: 0, skippedLetterReference: 0 };
  const days: QotdDayOutcome[] = [];
  for (let i = 0; i <= daysAhead; i += 1) {
    days.push(
      await fillDay(params.client, addDaysToLocalDate(today, i), counters),
    );
  }

  const swept = Number(
    await rpc(params.client, "sweep_rate_limit_ledger_anon", {}),
  );

  let deploy: QotdScheduleSummary["deploy"] = "skipped_no_hook";
  if (params.deployHookUrl) {
    try {
      const res = await (params.fetchImpl ?? fetch)(params.deployHookUrl, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      });
      deploy = res.ok ? "triggered" : "failed";
    } catch (err: unknown) {
      // The hook URL is a credential: log only the error class, never the URL.
      logger.warn("QOTD", "deploy_hook_failed", "Deploy hook request failed", {
        reason: err instanceof Error ? err.name : "unknown",
      });
      deploy = "failed";
    }
  }

  return {
    today,
    days,
    skippedBanned: counters.skippedBanned,
    skippedLetterReference: counters.skippedLetterReference,
    sweptLedgerRows: Number.isFinite(swept) ? swept : 0,
    deploy,
  };
}
