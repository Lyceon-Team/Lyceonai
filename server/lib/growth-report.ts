/**
 * The Monday growth report: last week's numbers, compared with the week before, posted once to
 * Slack #social.
 *
 * @spec [owner brief "One funnel for every social post: /start + CTAs + weekly growth report"
 *       (Karl, 2026-10-28) item 3 ("Monday growth report to #social at 14:00 UTC, from the
 *       database, with week and change from last week": sign-ups by signup_channel, active
 *       students, students returning week over week by test date, questions answered, reviews
 *       done, estimated study time, sign-ups answering within 24h, upgrades (ALPHA/paid)) and item 4
 *       ("Karl checks the first Monday report"); .claude/skills/cmo/references/03-data-sources.md
 *       §4 (canonical metrics, internal accounts excluded); Doctrine 7 (no under-13 data);
 *       CLAUDE.md "Managed-service first" (a Vercel cron, as every other scheduled job here)]
 *       | @implemented [2026-10-28]
 *
 * plain English: `runGrowthReport` takes the last complete Monday–Sunday week in America/Chicago
 * (`growth_report_week_start`), claims it in the ledger (a week already claimed or posted is
 * skipped, so a double-fired cron posts once), works out which student accounts are internal or
 * test accounts with the lifecycle email rule (`isDenylisted`: LIFECYCLE_EMAIL_DENYLIST, or "test"
 * in the address — one definition, not a second list), reads the aggregates
 * (`growth_report_weekly`, counts only), formats them (`formatGrowthReport`, pure) and posts them
 * with the Lyceon Social bot to SOCIAL_SLACK_CHANNEL_ID. Posted → the ledger records it. Slack
 * refused or failed → the claim is released, so re-running the cron by hand posts it; the run
 * answers 500 so it shows as failed.
 *
 * Privacy: the email addresses read to apply the denylist stay in this function and are never
 * logged or posted; the message carries counts only. Logs carry the week, counts of excluded
 * accounts and Slack's error code, never an id, an address, the token or the text.
 *
 * Edge cases: an empty week posts zeros (a quiet week is news too). A change against a previous
 * week of 0 shows the difference only, never a percentage.
 */
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { feedbackSlackEnvSchema } from "../../packages/shared/src/env";
import {
  growthReportSchema,
  type GrowthReport,
  type GrowthReportWeek,
} from "../../packages/shared/src/growth-report-schema";
import { formatSatTestDate } from "../../shared/sat-test-dates";
import {
  escapeMrkdwn,
  postMessage,
  SlackCallError,
  slackConfig,
  type FetchLike,
} from "../../shared/slack/client";
import { redactChannel } from "./feedback-slack";
import { isDenylisted, parseDenylist } from "./lifecycle-email";
import { logger } from "../logger";

const SLACK_TIMEOUT_MS = 10_000;
const PROFILE_PAGE = 1000;

// ---------------------------------------------------------------------------------------------
// Formatting (pure)
// ---------------------------------------------------------------------------------------------

function utcDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

function shortDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** "Oct 26 – Nov 1" for the Monday that starts the week. */
export function weekLabel(weekStart: string): string {
  const start = utcDate(weekStart);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return `${shortDate(start)} – ${shortDate(end)}`;
}

function n(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * The change against the week before: "+3 (+33%)", "−2 (−5%)", "no change", or, when the
 * previous week was 0, the difference alone ("+3"): a percentage of nothing says nothing.
 */
export function change(current: number, previous: number): string {
  const diff = current - previous;
  if (diff === 0) return "no change";
  const sign = diff > 0 ? "+" : "−";
  const abs = Math.abs(diff);
  const amount = Number.isInteger(abs) ? n(abs) : abs.toFixed(1);
  if (previous === 0) return `${sign}${amount}`;
  const pct = Math.round((Math.abs(diff) / previous) * 100);
  return `${sign}${amount} (${sign}${pct}%)`;
}

function line(
  label: string,
  current: number,
  previous: number,
  shown: (v: number) => string = n,
): string {
  return `• ${label}: *${shown(current)}* (${change(current, previous)} vs ${shown(previous)})`;
}

function channelBreakdown(week: GrowthReportWeek): string {
  const entries = Object.entries(week.signups_by_channel).sort(
    ([a, x], [b, y]) => y - x || a.localeCompare(b),
  );
  return entries.length === 0
    ? "none"
    : entries.map(([channel, count]) => `${channel} ${n(count)}`).join(" · ");
}

function testDateBreakdown(week: GrowthReportWeek): string {
  return week.returning_by_test_date.length === 0
    ? "none"
    : week.returning_by_test_date
        .map(
          (row) =>
            `${row.test_date === null ? "no test date" : formatSatTestDate(row.test_date)} ${n(row.students)}`,
        )
        .join(" · ");
}

function hours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

/** The Slack message. Counts only; every label is our own text. */
export function formatGrowthReport(report: GrowthReport): string {
  const w = report.week;
  const p = report.previous;
  const lines = [
    `*Weekly growth* · ${weekLabel(w.week_start)} (Mon–Sun, Chicago time) vs ${weekLabel(p.week_start)}`,
    line("Sign-ups", w.signups, p.signups),
    `    by channel: ${channelBreakdown(w)}`,
    line("Active students", w.active_students, p.active_students),
    line(
      "Students back from the week before",
      w.returning_students,
      p.returning_students,
    ),
    `    by test date: ${testDateBreakdown(w)}`,
    line("Questions answered", w.questions_answered, p.questions_answered),
    line(
      "Full-length test answers",
      w.full_length_answers,
      p.full_length_answers,
    ),
    line("Reviews done", w.reviews_done, p.reviews_done),
    line(
      "Study time, estimated (hours)",
      hours(w.study_minutes_estimate),
      hours(p.study_minutes_estimate),
      (v) => v.toFixed(1),
    ),
    `• Sign-ups who answered a question within 24 h: *${n(w.signups_answered_24h)} of ${n(w.signups)}* (week before: ${n(p.signups_answered_24h)} of ${n(p.signups)})`,
    line("Upgrades", w.upgrades, p.upgrades),
    "    ALPHA and paid are not split here: only Stripe records the code.",
    "_Students only; under-13, deleted, internal and test accounts excluded._",
  ];
  return escapeMrkdwn(lines.join("\n"));
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

export type GrowthPostOutcome = "posted" | "misconfigured" | "failed";

export type GrowthReportDeps = {
  now: () => Date;
  weekStart: (now: Date) => Promise<string>;
  claim: (weekStart: string) => Promise<boolean>;
  markPosted: (weekStart: string) => Promise<void>;
  release: (weekStart: string) => Promise<void>;
  excludedProfileIds: () => Promise<string[]>;
  report: (weekStart: string, excluded: string[]) => Promise<unknown>;
  post: (text: string) => Promise<GrowthPostOutcome>;
};

export type GrowthReportSummary =
  | { status: "posted"; week_start: string; excluded_accounts: number }
  | { status: "already_claimed"; week_start: string }
  | {
      status: "not_posted";
      week_start: string;
      reason: "misconfigured" | "failed";
    };

export async function runGrowthReport(
  deps: GrowthReportDeps,
): Promise<GrowthReportSummary> {
  const weekStart = await deps.weekStart(deps.now());
  if (!(await deps.claim(weekStart))) {
    logger.info(
      "GROWTH_REPORT",
      "growth_report_already_claimed",
      "This week's growth report is already posted or in progress",
      { week_start: weekStart },
    );
    return { status: "already_claimed", week_start: weekStart };
  }
  let outcome: GrowthPostOutcome = "failed";
  try {
    const excluded = await deps.excludedProfileIds();
    const report = growthReportSchema.parse(
      await deps.report(weekStart, excluded),
    );
    outcome = await deps.post(formatGrowthReport(report));
    if (outcome === "posted") {
      await deps.markPosted(weekStart);
      logger.info(
        "GROWTH_REPORT",
        "growth_report_posted",
        "Weekly growth report posted to Slack",
        { week_start: weekStart, excluded_accounts: excluded.length },
      );
      return {
        status: "posted",
        week_start: weekStart,
        excluded_accounts: excluded.length,
      };
    }
  } finally {
    if (outcome !== "posted") await deps.release(weekStart);
  }
  return {
    status: "not_posted",
    week_start: weekStart,
    reason: outcome === "misconfigured" ? "misconfigured" : "failed",
  };
}

// ---------------------------------------------------------------------------------------------
// Live dependencies
// ---------------------------------------------------------------------------------------------

async function rpc(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await supabaseServer.rpc(name, args);
  if (error) {
    logger.error(
      "GROWTH_REPORT",
      "growth_report_rpc_failed",
      `${name} failed`,
      {
        code: error.code,
      },
    );
    throw new Error(`${name} failed (${error.code ?? "unknown"})`);
  }
  return data;
}

const studentRowsSchema = z.array(
  z.object({ id: z.string().uuid(), email: z.string().nullable() }),
);

/** Student accounts the lifecycle rule calls internal or test (ids only leave this function). */
async function liveExcludedProfileIds(): Promise<string[]> {
  const denylist = parseDenylist(process.env.LIFECYCLE_EMAIL_DENYLIST);
  const excluded: string[] = [];
  for (let from = 0; ; from += PROFILE_PAGE) {
    const { data, error } = await supabaseServer
      .from("profiles")
      .select("id, email")
      .eq("role", "student")
      .order("id")
      .range(from, from + PROFILE_PAGE - 1);
    if (error) {
      logger.error(
        "GROWTH_REPORT",
        "growth_report_profiles_failed",
        "Reading student accounts for the exclusion list failed",
        { code: error.code },
      );
      throw new Error("profiles read failed");
    }
    const rows = studentRowsSchema.parse(data ?? []);
    for (const row of rows) {
      if (row.email !== null && isDenylisted(row.email, denylist)) {
        excluded.push(row.id);
      }
    }
    if (rows.length < PROFILE_PAGE) return excluded;
  }
}

async function liveSlackPost(text: string): Promise<GrowthPostOutcome> {
  const env = feedbackSlackEnvSchema.safeParse(process.env);
  if (!env.success) {
    logger.warn(
      "GROWTH_REPORT",
      "growth_report_slack_misconfigured",
      "No growth report posted (SLACK_BOT_TOKEN / SOCIAL_SLACK_CHANNEL_ID unusable)",
      { reason: "env_invalid" },
    );
    return "misconfigured";
  }
  const config = slackConfig({
    SLACK_BOT_TOKEN: env.data.SLACK_BOT_TOKEN,
    SLACK_CHANNEL_ID: env.data.SOCIAL_SLACK_CHANNEL_ID,
  });
  if (!config.ok) {
    logger.warn(
      "GROWTH_REPORT",
      "growth_report_slack_misconfigured",
      "No growth report posted (SLACK_BOT_TOKEN / SOCIAL_SLACK_CHANNEL_ID unusable)",
      {
        reason: config.reason,
        ...(config.reason === "channel_invalid"
          ? { channel: redactChannel(env.data.SOCIAL_SLACK_CHANNEL_ID) }
          : {}),
      },
    );
    return "misconfigured";
  }
  const fetchImpl: FetchLike = (url, init) =>
    fetch(url, {
      method: init.method,
      ...(init.headers === undefined ? {} : { headers: init.headers }),
      ...(typeof init.body === "string" ? { body: init.body } : {}),
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    });
  try {
    await postMessage(config.value, text, fetchImpl);
    return "posted";
  } catch (error) {
    logger.warn(
      "GROWTH_REPORT",
      "growth_report_slack_failed",
      "The growth report's Slack post failed; the week was released for a re-run",
      error instanceof SlackCallError
        ? { reason: "slack_error", slack_error: error.code }
        : {
            reason: "request_failed",
            error_name: error instanceof Error ? error.name : "unknown",
          },
    );
    return "failed";
  }
}

const weekStartSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function liveGrowthReportDeps(): GrowthReportDeps {
  return {
    now: () => new Date(),
    weekStart: async (now) =>
      weekStartSchema.parse(
        await rpc("growth_report_week_start", { p_now: now.toISOString() }),
      ),
    claim: async (week) =>
      z
        .boolean()
        .parse(await rpc("growth_report_claim", { p_week_start: week })),
    markPosted: async (week) => {
      await rpc("growth_report_mark_posted", { p_week_start: week });
    },
    release: async (week) => {
      await rpc("growth_report_release", { p_week_start: week });
    },
    excludedProfileIds: liveExcludedProfileIds,
    report: (week, excluded) =>
      rpc("growth_report_weekly", {
        p_week_start: week,
        p_excluded: excluded,
      }),
    post: liveSlackPost,
  };
}
