/**
 * QOTD resilience: the horizon, the owner alerts (Slack + email, once per condition per day),
 * the recovery message, the independent check, the no-question skip of the 17:00 reminder, and
 * the logs — against real Postgres (genesis + every migration).
 *
 * @spec [owner brief "QOTD resilience (no-question state, error logging, alerting)" (Karl,
 *       2026-10-09) §1-§3, "Alert delivery" and "Tests"] | @implemented [2026-10-09]
 *
 * plain English: the REAL SQL (qotd_servable, qotd_horizon, the ops alert ledger), the REAL
 * services (runMonitoredQotdSchedule, checkQotdHealth, runQotdEmailJob, sendOpsAlert); only the
 * two outside services are fakes — the Slack webhook (a fetch that records or fails) and the
 * Resend transport (records or fails). Every scenario runs on its own America/Chicago day, far
 * from the real calendar, so the once-per-day ledger is exercised per scenario.
 */
import type { Client } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "qotd_resilience_ci";
const STUDENT = "a8000000-0000-4000-8000-000000000001";
const STEM = "If 5y - 4 = 21, what is the value of y?";
const EXPLANATION = "Add 4 then divide by 5: y = 5.";
const WEBHOOK = "https://hooks.slack.test/services/T000/B000/XXXX";
const OWNER = "owner@example.test";

let pg: Client;
const logs: { level: string; line: string }[] = [];

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pg);
  },
}));
vi.mock("../../server/logger", () => {
  const at =
    (level: string) =>
    (...args: unknown[]): void => {
      logs.push({
        level,
        line: args
          .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
          .join(" "),
      });
    };
  return {
    logger: {
      info: at("info"),
      warn: at("warn"),
      error: at("error"),
      debug: at("debug"),
    },
  };
});

type SlackPost = { url: string; text: string };
type Mail = { to: string; subject: string; text: string; key: string };

function harness(opts: {
  slack?: "ok" | "fail" | "unset";
  mail?: "ok" | "fail" | "unset";
}) {
  const slackPosts: SlackPost[] = [];
  const mails: Mail[] = [];
  const fetchImpl = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { text: string };
    slackPosts.push({ url: String(url), text: body.text });
    return new Response("", { status: opts.slack === "fail" ? 500 : 200 });
  }) as typeof fetch;
  const transport = async (input: {
    to: string;
    subject: string;
    text: string;
    idempotencyKey: string;
  }) => {
    mails.push({
      to: input.to,
      subject: input.subject,
      text: input.text,
      key: input.idempotencyKey,
    });
    return opts.mail === "fail"
      ? {
          ok: false as const,
          error: { kind: "network" as const, message: "down" },
        }
      : { ok: true as const, value: { providerMessageId: "re_1" } };
  };
  return { slackPosts, mails, fetchImpl, transport };
}

async function sendAlertFor(
  now: Date,
  h: ReturnType<typeof harness>,
  opts: { slack?: "ok" | "fail" | "unset"; mail?: "ok" | "fail" | "unset" },
) {
  const { sendOpsAlert } = await import("../../server/lib/ops-alerts");
  return (alert: Parameters<typeof sendOpsAlert>[0]) =>
    sendOpsAlert(alert, {
      db: makePgSupabase(pg),
      now,
      slackWebhookUrl: opts.slack === "unset" ? undefined : WEBHOOK,
      emailTo: opts.mail === "unset" ? undefined : OWNER,
      transport: h.transport,
      fetchImpl: h.fetchImpl,
    });
}

let seeded = 0;
async function seedQuestion(): Promise<string> {
  seeded += 1;
  const id = `SATM1Q9${String(seeded).padStart(4, "0")}`;
  await pg.query(
    `INSERT INTO public.questions
       (id, section, source_type, domain, skill_codes, difficulty, stem, options,
        correct_answer, explanation, option_metadata, status, item_type, published_at)
     VALUES ($1,'M',1,'Algebra',ARRAY['ALG.D01'],2,$2,
       '[{"key":"A","text":"2"},{"key":"B","text":"5"},{"key":"C","text":"4"},{"key":"D","text":"6"}]'::jsonb,
       'B',$3,
       '{"A":{"role":"distractor"},"B":{"role":"correct"},"C":{"role":"distractor"},"D":{"role":"distractor"}}'::jsonb,
       'published','mcq', now())`,
    [id, STEM, EXPLANATION],
  );
  return id;
}

/** Schedules a published question on each of `days` (YYYY-MM-DD). */
async function schedule(days: string[]): Promise<void> {
  for (const d of days) {
    const q = await seedQuestion();
    await pg.query(
      `INSERT INTO public.qotd_schedule (qotd_date, question_id) VALUES ($1::date, $2)`,
      [d, q],
    );
  }
}

/** `n` consecutive days from `start` (YYYY-MM-DD) inclusive. */
function days(start: string, n: number): string[] {
  const out: string[] = [];
  const base = new Date(`${start}T12:00:00Z`);
  for (let i = 0; i < n; i += 1) {
    out.push(
      new Date(base.getTime() + i * 86_400_000).toISOString().slice(0, 10),
    );
  }
  return out;
}

async function ledger(): Promise<
  { condition: string; channel: string; status: string }[]
> {
  const r = await pg.query<{
    condition: string;
    channel: string;
    status: string;
  }>(
    `SELECT condition, channel, status FROM public.ops_alert_deliveries ORDER BY created_at, channel`,
  );
  return r.rows;
}

function errors(event: string): string[] {
  return logs
    .filter((l) => l.level === "error" && l.line.includes(event))
    .map((l) => l.line);
}

describe.skipIf(!PG_AVAILABLE)("QOTD resilience — real Postgres", () => {
  beforeAll(async () => {
    pg = await bootstrapPgDatabase(DB_NAME);
    await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
      STUDENT,
      "s@example.test",
    ]);
    await pg.query(
      `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth)
       VALUES ($1, 's@example.test', 'student', 'Someone', '2008-01-01')`,
      [STUDENT],
    );
  }, 180_000);

  afterAll(async () => {
    await pg?.end();
  });

  beforeEach(async () => {
    logs.length = 0;
    await pg.query(`DELETE FROM public.ops_alert_deliveries`);
  });

  // ── The horizon ──────────────────────────────────────────────────────────────
  it("horizon 6 → one alert on each channel; horizon 7 → no alert; then ONE recovery message", async () => {
    const { checkQotdHealth } =
      await import("../../server/services/qotd/qotd-health");
    // Today 2027-02-10 (noon Chicago) and the 6 days after it: horizon 6.
    await schedule(days("2027-02-10", 7));
    const now = new Date("2027-02-10T18:00:00Z");
    const h = harness({});
    const sendAlert = await sendAlertFor(now, h, {});
    const first = await checkQotdHealth({
      db: makePgSupabase(pg),
      now,
      sendAlert,
      checks: { noQuestionToday: true, horizon: true },
      source: "schedule_job",
    });
    expect(first.horizon).toEqual({
      today: "2027-02-10",
      today_covered: true,
      runs_out_on: "2027-02-17",
      horizon: 6,
    });
    expect(first.raised).toEqual(["qotd_horizon_low"]);
    expect(h.slackPosts).toHaveLength(1);
    expect(h.mails).toHaveLength(1);
    // The alert says what is wrong, the horizon and the date questions run out.
    for (const text of [h.slackPosts[0]?.text ?? "", h.mails[0]?.text ?? ""]) {
      expect(text).toContain("6 day(s)");
      expect(text).toContain("run out on 2027-02-17");
    }
    expect(errors("qotd_horizon_low")).toHaveLength(1);

    // A second check the same day: nothing more on either channel.
    await checkQotdHealth({
      db: makePgSupabase(pg),
      now: new Date("2027-02-10T22:00:00Z"),
      sendAlert,
      checks: { noQuestionToday: true, horizon: true },
      source: "daily_job",
    });
    expect(h.slackPosts).toHaveLength(1);
    expect(h.mails).toHaveLength(1);

    // The schedule is topped up to 7: no alert, and ONE recovery message.
    await schedule(["2027-02-17"]);
    const later = new Date("2027-02-10T23:00:00Z");
    const h2 = harness({});
    const recovered = await checkQotdHealth({
      db: makePgSupabase(pg),
      now: later,
      sendAlert: await sendAlertFor(later, h2, {}),
      checks: { noQuestionToday: true, horizon: true },
      source: "daily_job",
    });
    expect(recovered.horizon.horizon).toBe(7);
    expect(recovered.raised).toEqual([]);
    expect(recovered.recovered).toBe(true);
    expect(h2.slackPosts.map((p) => p.text.split("\n")[0])).toEqual([
      "Lyceon ops: Question of the Day schedule recovered: 7 day(s) ahead",
    ]);
    expect(h2.mails).toHaveLength(1);

    // Healthy again the next day: no second recovery.
    const nextDay = new Date("2027-02-11T18:00:00Z");
    await schedule(["2027-02-18"]);
    const h3 = harness({});
    const quiet = await checkQotdHealth({
      db: makePgSupabase(pg),
      now: nextDay,
      sendAlert: await sendAlertFor(nextDay, h3, {}),
      checks: { noQuestionToday: true, horizon: true },
      source: "daily_job",
    });
    expect(quiet.recovered).toBe(false);
    expect(h3.slackPosts).toHaveLength(0);
    expect(h3.mails).toHaveLength(0);
  });

  it("horizon 7 → no alert", async () => {
    const { checkQotdHealth } =
      await import("../../server/services/qotd/qotd-health");
    await schedule(days("2027-03-10", 8));
    const now = new Date("2027-03-10T18:00:00Z");
    const h = harness({});
    const r = await checkQotdHealth({
      db: makePgSupabase(pg),
      now,
      sendAlert: await sendAlertFor(now, h, {}),
      checks: { noQuestionToday: true, horizon: true },
      source: "schedule_job",
    });
    expect(r.horizon.horizon).toBe(7);
    expect(r.raised).toEqual([]);
    expect(h.slackPosts).toHaveLength(0);
    expect(h.mails).toHaveLength(0);
    expect(await ledger()).toEqual([]);
  });

  it("an unpublished question does not count: the horizon stops at it", async () => {
    await schedule(days("2027-04-10", 8));
    await pg.query(
      `UPDATE public.questions q SET status = 'draft'
         FROM public.qotd_schedule s WHERE s.question_id = q.id AND s.qotd_date = '2027-04-13'`,
    );
    const r = await pg.query<{ h: { horizon: number; runs_out_on: string } }>(
      `SELECT public.qotd_horizon('2027-04-10T18:00:00Z'::timestamptz) AS h`,
    );
    expect(r.rows[0]?.h.horizon).toBe(2);
    expect(r.rows[0]?.h.runs_out_on).toBe("2027-04-13");
  });

  // ── The schedule job ─────────────────────────────────────────────────────────
  it("schedule job failure → ERROR log and one alert; a second failure the same day → no second alert", async () => {
    const { runMonitoredQotdSchedule } =
      await import("../../server/services/qotd/qotd-health");
    const now = new Date("2027-05-10T07:15:00Z");
    const h = harness({});
    const sendAlert = await sendAlertFor(now, h, {});
    const boom = async () => {
      throw new Error("qotd_schedule_candidates failed: connection reset");
    };
    await expect(
      runMonitoredQotdSchedule({
        client: makePgSupabase(pg),
        now,
        sendAlert,
        run: boom,
      }),
    ).rejects.toThrow("connection reset");
    expect(errors("qotd_schedule_failed")).toHaveLength(1);
    expect(h.slackPosts).toHaveLength(1);
    expect(h.mails).toHaveLength(1);
    expect(h.slackPosts[0]?.text).toContain("schedule job failed");

    await expect(
      runMonitoredQotdSchedule({
        client: makePgSupabase(pg),
        now: new Date("2027-05-10T09:00:00Z"),
        sendAlert,
        run: boom,
      }),
    ).rejects.toThrow();
    // The failure is still logged; the alert is not repeated.
    expect(errors("qotd_schedule_failed")).toHaveLength(2);
    expect(h.slackPosts).toHaveLength(1);
    expect(h.mails).toHaveLength(1);
  });

  it("an unfilled day → ERROR with the date and reason, one alert, and the run's summary line", async () => {
    const { runMonitoredQotdSchedule } =
      await import("../../server/services/qotd/qotd-health");
    await schedule(days("2027-06-10", 7));
    const now = new Date("2027-06-10T07:15:00Z");
    const h = harness({});
    const { health } = await runMonitoredQotdSchedule({
      client: makePgSupabase(pg),
      now,
      sendAlert: await sendAlertFor(now, h, {}),
      run: async () => ({
        today: "2027-06-10",
        days: [
          ...days("2027-06-10", 7).map((date) => ({
            date,
            outcome: "exists" as const,
          })),
          { date: "2027-06-17", outcome: "unfilled" as const },
        ],
        skippedBanned: 0,
        skippedLetterReference: 0,
        skippedStemRepeatsPassage: 0,
        sweptLedgerRows: 0,
        deploy: "skipped_no_hook" as const,
      }),
    });
    const unfilled = errors("qotd_schedule_day_unfilled");
    expect(unfilled).toHaveLength(1);
    expect(unfilled[0]).toContain("2027-06-17");
    expect(unfilled[0]).toContain("no_eligible_candidate");
    expect(health.horizon.horizon).toBe(6);
    // Two conditions, each once on each channel: the unfilled day, and the short horizon.
    expect(
      (await ledger())
        .map((r) => `${r.condition}:${r.channel}:${r.status}`)
        .sort(),
    ).toEqual([
      "qotd_horizon_low:email:sent",
      "qotd_horizon_low:slack:sent",
      "qotd_schedule_failed:email:sent",
      "qotd_schedule_failed:slack:sent",
    ]);
    const summary = logs.find((l) => l.line.includes("qotd_schedule_run"));
    expect(summary?.line).toContain('"datesAttempted":8');
    expect(summary?.line).toContain('"alreadyExisted":7');
    expect(summary?.line).toContain('"unfilled":1');
    expect(summary?.line).toContain('"horizon":6');
    expect(summary?.line).toContain('"durationMs"');
  });

  // ── The independent check (the daily-email job) ──────────────────────────────
  it("the scheduler never runs: the daily job's evening check finds horizon 6 and alerts; its 06:05 run does not", async () => {
    const { runQotdEmailJob } =
      await import("../../server/services/qotd/qotd-email-job");
    const { checkQotdHealth } =
      await import("../../server/services/qotd/qotd-health");
    // Filled up to 2027-07-16 by an earlier run; the 07:15 fill on 2027-07-10 never ran.
    await schedule(days("2027-07-09", 8));
    const run = async (iso: string, h: ReturnType<typeof harness>) => {
      const now = new Date(iso);
      const sendAlert = await sendAlertFor(now, h, {});
      return runQotdEmailJob({
        db: makePgSupabase(pg),
        dispatch: async () => ({
          selected: 0,
          sent: 0,
          failed: 0,
          deferred: 0,
          selectFailed: false,
        }),
        now,
        health: (checks) =>
          checkQotdHealth({
            db: makePgSupabase(pg),
            now,
            sendAlert,
            checks,
            source: "daily_job",
          }),
      });
    };
    // 06:05 UTC = 01:05 CDT: today has a question; the horizon (6) is not checked yet.
    const early = harness({});
    await run("2027-07-10T06:05:00Z", early);
    expect(early.slackPosts).toHaveLength(0);
    // 22:00 UTC = 17:00 CDT: the horizon check runs and finds 6.
    const evening = harness({});
    await run("2027-07-10T22:00:00Z", evening);
    expect(evening.slackPosts.map((p) => p.text.split("\n")[0])).toEqual([
      "Lyceon ops: Question of the Day schedule is short: 6 day(s) ahead",
    ]);
    expect(evening.mails).toHaveLength(1);
  });

  it("no row today: the 06:05 run alerts 'no question today', and the 17:00 reminder is skipped", async () => {
    const { runQotdEmailJob } =
      await import("../../server/services/qotd/qotd-email-job");
    const { checkQotdHealth } =
      await import("../../server/services/qotd/qotd-health");
    // 2027-08-10 has no row; the days after it do.
    await schedule(days("2027-08-11", 7));
    const run = async (iso: string, h: ReturnType<typeof harness>) => {
      const now = new Date(iso);
      const sendAlert = await sendAlertFor(now, h, {});
      return runQotdEmailJob({
        db: makePgSupabase(pg),
        dispatch: async () => ({
          selected: 0,
          sent: 0,
          failed: 0,
          deferred: 0,
          selectFailed: false,
        }),
        now,
        health: (checks) =>
          checkQotdHealth({
            db: makePgSupabase(pg),
            now,
            sendAlert,
            checks,
            source: "daily_job",
          }),
      });
    };
    const early = harness({});
    await run("2027-08-10T06:05:00Z", early);
    expect(early.slackPosts.map((p) => p.text.split("\n")[0])).toEqual([
      "Lyceon ops: No Question of the Day for today (2027-08-10)",
    ]);
    const evening = harness({});
    const summary = await run("2027-08-10T22:00:00Z", evening);
    expect(summary.skipped).toBe("no_question");
    expect(summary.emitted).toBe(0);
    expect(
      Number(
        (
          await pg.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM public.notification_events
              WHERE event_type = 'qotd_daily' AND payload->>'qotd_date' = '2027-08-10'`,
          )
        ).rows[0]?.n,
      ),
    ).toBe(0);
    const line = logs.find(
      (l) =>
        l.line.includes("qotd_daily_rule_done") &&
        l.line.includes("skippedNoQuestion"),
    );
    expect(line?.line).toContain('"skippedNoQuestion":true');
  });

  it("a scheduled but withdrawn question is no question: the 17:00 reminder is skipped too", async () => {
    const { runQotdEmailJob } =
      await import("../../server/services/qotd/qotd-email-job");
    await schedule(days("2027-09-10", 8));
    await pg.query(
      `UPDATE public.questions q SET status = 'draft'
         FROM public.qotd_schedule s WHERE s.question_id = q.id AND s.qotd_date = '2027-09-10'`,
    );
    const summary = await runQotdEmailJob({
      db: makePgSupabase(pg),
      dispatch: async () => ({
        selected: 0,
        sent: 0,
        failed: 0,
        deferred: 0,
        selectFailed: false,
      }),
      now: new Date("2027-09-10T22:00:00Z"),
      health: async () => undefined,
    });
    expect(summary.skipped).toBe("no_question");
    expect(
      Number(
        (
          await pg.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM public.notification_events
              WHERE event_type = 'qotd_daily' AND payload->>'qotd_date' = '2027-09-10'`,
          )
        ).rows[0]?.n,
      ),
    ).toBe(0);
  });

  // ── Channels ─────────────────────────────────────────────────────────────────
  it("a Slack failure still sends the email, logged at ERROR; no duplicates on a second run", async () => {
    const now = new Date("2027-10-10T18:00:00Z");
    const h = harness({ slack: "fail" });
    const send = await sendAlertFor(now, h, { slack: "fail" });
    const alert = {
      condition: "ops_test" as const,
      title: "Test",
      lines: ["x"],
    };
    expect(await send(alert)).toEqual({ slack: "failed", email: "sent" });
    expect(h.mails).toHaveLength(1);
    expect(errors("slack_failed")).toHaveLength(1);
    expect(await send(alert)).toEqual({
      slack: "already_sent",
      email: "already_sent",
    });
    expect(h.slackPosts).toHaveLength(1);
    expect(h.mails).toHaveLength(1);
  });

  it("an email failure still posts to Slack, logged at ERROR; no duplicates on a second run", async () => {
    const now = new Date("2027-10-11T18:00:00Z");
    const h = harness({ mail: "fail" });
    const send = await sendAlertFor(now, h, { mail: "fail" });
    const alert = {
      condition: "ops_test" as const,
      title: "Test",
      lines: ["x"],
    };
    expect(await send(alert)).toEqual({ slack: "sent", email: "failed" });
    expect(h.slackPosts).toHaveLength(1);
    expect(errors("email_failed")).toHaveLength(1);
    expect(await send(alert)).toEqual({
      slack: "already_sent",
      email: "already_sent",
    });
    expect(h.slackPosts).toHaveLength(1);
    expect(h.mails).toHaveLength(1);
  });

  it("webhook unset: no Slack, the email goes, and ONE warning a day", async () => {
    const now = new Date("2027-10-12T18:00:00Z");
    const h = harness({ slack: "unset" });
    const send = await sendAlertFor(now, h, { slack: "unset" });
    expect(
      await send({ condition: "ops_test", title: "Test", lines: ["x"] }),
    ).toEqual({ slack: "skipped_unconfigured", email: "sent" });
    expect(
      await send({
        condition: "qotd_horizon_low",
        title: "Short",
        lines: ["x"],
      }),
    ).toEqual({ slack: "skipped_unconfigured", email: "sent" });
    expect(h.slackPosts).toHaveLength(0);
    expect(h.mails).toHaveLength(2);
    expect(
      logs.filter(
        (l) => l.level === "warn" && l.line.includes("ops_slack_unconfigured"),
      ),
    ).toHaveLength(1);
  });

  // ── Privacy ──────────────────────────────────────────────────────────────────
  it("no log line and no alert carries question content, an address or the webhook", async () => {
    const { checkQotdHealth } =
      await import("../../server/services/qotd/qotd-health");
    await schedule(days("2027-11-10", 3));
    const now = new Date("2027-11-10T18:00:00Z");
    const h = harness({});
    await checkQotdHealth({
      db: makePgSupabase(pg),
      now,
      sendAlert: await sendAlertFor(now, h, {}),
      checks: { noQuestionToday: true, horizon: true },
      source: "daily_job",
    });
    // Presence first: there were log lines and alerts.
    expect(logs.length).toBeGreaterThan(0);
    expect(h.slackPosts.length).toBeGreaterThan(0);
    const everything = [
      ...logs.map((l) => l.line),
      ...h.slackPosts.map((p) => p.text),
      ...h.mails.map((m) => m.text),
    ];
    for (const text of everything) {
      expect(text).not.toContain(STEM);
      expect(text).not.toContain(EXPLANATION);
      expect(text).not.toContain("s@example.test");
    }
    for (const l of logs) {
      expect(l.line).not.toContain(OWNER);
      expect(l.line).not.toContain("hooks.slack.test");
    }
  });
});
