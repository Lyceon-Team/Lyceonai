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
 *   * a question whose stem repeats its passage (no prompt; shared/qotd/projection.ts
 *     stemRepeatsPassage, owner 2026-10-08) is skipped;
 *   * MCQs whose explanation names a choice letter (shared/practice/letter-reference.ts) are
 *     skipped: options are shuffled per request (owner ruling 2026-10-05), so "choice B" would
 *     name the wrong option;
 *   * the first candidate whose text matches no banned phrase (shared/seo/banned-phrases.ts) is
 *     inserted through qotd_schedule_insert, which re-checks eligibility and does nothing if the
 *     day is already filled. If a domain has nothing left, the next domain in rotation is tried,
 *     then the other section's domains, in the same fixed order.
 *   * READABILITY (owner brief "QOTD — readability filter (Karl's option B)", Karl 2026-10-09):
 *     a question is skipped unless it is quick to read — multiple choice, no "Text 1 / Text 2"
 *     paired passage, Math passage + question text <= 400 characters, Reading and Writing
 *     passage <= 300 characters (shared/qotd/readability.ts: the thresholds and the one
 *     predicate, which the social generator shares). Candidates are read a page at a time
 *     (keyset on the id), so a domain whose first page is all long items is still searched to
 *     the end; only a domain with NO readable question left moves on to the next domain.
 *   * Before filling, already-scheduled UPCOMING days (after today, within the window) whose
 *     question fails the readability rules are released (`qotd_schedule_release`, which refuses
 *     today and the past on the database's own clock) and refilled by the same selection. The
 *     summary lists every replaced date. Today and past days never change.
 * The same database state always yields the same schedule. A rerun, or two overlapping runs,
 * change nothing: the date PK and the question_id UNIQUE make a second insert a no-op.
 *
 * After filling, it sweeps expired anonymous rate-limit rows (SCL-202: rows expire with their
 * window) and, when VERCEL_DEPLOY_HOOK_URL is set, triggers the production deploy that
 * prerenders yesterday's archive page.
 */
import { CANONICAL_DOMAINS_BY_SECTION } from "../../../shared/canonical-domains";
import {
  firstBannedPhrase,
  firstUnapprovedOutcome,
} from "../../../shared/seo/banned-phrases";
import { explanationNamesChoiceLetter } from "../../../shared/practice/letter-reference";
import { stemRepeatsPassage } from "../../../shared/qotd/projection";
import {
  qotdReadabilityProblem,
  type QotdReadabilityProblem,
} from "../../../shared/qotd/readability";
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
  /** Questions skipped because the stem repeats the passage (no question prompt). */
  skippedStemRepeatsPassage: number;
  /** Questions skipped as not quick to read (shared/qotd/readability.ts). */
  skippedUnreadable: number;
  /** Upcoming days whose scheduled question failed the readability rules and was replaced. */
  replaced: Array<{
    date: string;
    previousQuestionId: string;
    reason: QotdReadabilityProblem;
  }>;
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
  item_type: string;
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

type Counters = {
  skippedBanned: number;
  skippedLetterReference: number;
  skippedStemRepeatsPassage: number;
  skippedUnreadable: number;
};

/** True (and counted) when a candidate is skipped; false when it may be scheduled. */
function skipReason(
  c: Candidate,
  section: Section,
  counters: Counters,
): boolean {
  // Owner 2026-10-09 (option B): quick-to-read questions only.
  if (
    qotdReadabilityProblem({
      section,
      itemType: c.item_type,
      stem: c.stem,
      passage: c.passage,
    }) !== null
  ) {
    counters.skippedUnreadable += 1;
    return true;
  }
  // Owner 2026-10-08: a stem that repeats its passage has no question prompt (17 published
  // questions, the 2026-10-07 QOTD among them). The bank repair is the questions vertical's;
  // until then the scheduler never picks one.
  if (stemRepeatsPassage(c.stem ?? "", c.passage)) {
    counters.skippedStemRepeatsPassage += 1;
    return true;
  }
  // Today's options are shuffled per request (owner ruling 2026-10-05), so an explanation
  // that says "choice B" would name the wrong option for most visitors: skip the MCQ.
  if (
    parseCanonicalMcOptions(c.options).length > 0 &&
    explanationNamesChoiceLetter(c.explanation)
  ) {
    counters.skippedLetterReference += 1;
    return true;
  }
  // F13 (owner ruling 2026-10-05): "score higher" and "real progress" moved from BANNED to
  // the outcome guard; a scheduled question becomes a public archive page, so it is screened
  // by both, as every other public page is.
  if (
    firstBannedPhrase(publicText(c)) !== null ||
    firstUnapprovedOutcome(publicText(c)) !== null
  ) {
    counters.skippedBanned += 1;
    return true;
  }
  return false;
}

async function fillDay(
  client: QotdDbClient,
  date: string,
  counters: Counters,
): Promise<QotdDayOutcome> {
  for (const { section, domain } of rotationFor(date)) {
    // Page through the domain (keyset on the id): readable questions may sit behind a page of
    // long ones. A domain with none left is not an error: the next domain is tried.
    let afterId: string | null = null;
    for (;;) {
      const data = await rpc(client, "qotd_schedule_candidate_page", {
        p_section: section,
        p_domain: domain,
        p_after_id: afterId,
        p_limit: CANDIDATE_PAGE,
      });
      const candidates = (Array.isArray(data) ? data : []) as Candidate[];
      for (const c of candidates) {
        if (skipReason(c, section, counters)) continue;
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
      const last = candidates[candidates.length - 1];
      if (candidates.length < CANDIDATE_PAGE || last === undefined) break;
      afterId = last.question_id;
    }
  }
  return { date, outcome: "unfilled" };
}

type UpcomingRow = {
  qotd_date: string;
  question_id: string;
  section: string;
  item_type: string;
  stem: string | null;
  passage: string | null;
};

/**
 * Releases each upcoming day (after `today`, up to `lastDate`) whose scheduled question fails the
 * readability rules, so the fill below gives it a readable one. Today and past days are never
 * touched: the window starts after today, and `qotd_schedule_release` itself refuses anything
 * not strictly after the database's today.
 */
async function releaseUnreadableUpcoming(
  client: QotdDbClient,
  today: string,
  lastDate: string,
): Promise<QotdScheduleSummary["replaced"]> {
  const data = await rpc(client, "qotd_schedule_upcoming", { p_after: today });
  const rows = (Array.isArray(data) ? data : []) as UpcomingRow[];
  const released: QotdScheduleSummary["replaced"] = [];
  for (const row of rows) {
    const date = String(row.qotd_date).slice(0, 10);
    if (date <= today || date > lastDate) continue;
    if (row.section !== "M" && row.section !== "RW") continue;
    const reason = qotdReadabilityProblem({
      section: row.section,
      itemType: row.item_type,
      stem: row.stem,
      passage: row.passage,
    });
    if (reason === null) continue;
    const ok = await rpc(client, "qotd_schedule_release", {
      p_date: date,
      p_question_id: row.question_id,
    });
    if (ok === true) {
      released.push({ date, previousQuestionId: row.question_id, reason });
    }
  }
  return released;
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
  const counters: Counters = {
    skippedBanned: 0,
    skippedLetterReference: 0,
    skippedStemRepeatsPassage: 0,
    skippedUnreadable: 0,
  };
  const replaced = await releaseUnreadableUpcoming(
    params.client,
    today,
    addDaysToLocalDate(today, daysAhead),
  );
  if (replaced.length > 0) {
    // Which upcoming days changed (dates and reasons only; never question text).
    logger.info(
      "QOTD",
      "qotd_schedule_replaced",
      "Upcoming QOTD days replaced",
      {
        dates: replaced.map((r) => r.date),
        reasons: replaced.map((r) => r.reason),
      },
    );
  }
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
    skippedStemRepeatsPassage: counters.skippedStemRepeatsPassage,
    skippedUnreadable: counters.skippedUnreadable,
    replaced,
    sweptLedgerRows: Number.isFinite(swept) ? swept : 0,
    deploy,
  };
}
