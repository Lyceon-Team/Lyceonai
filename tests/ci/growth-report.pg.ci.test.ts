/**
 * The growth report's numbers against real Postgres: every metric from fixtures that can disprove it.
 *
 * @spec [owner brief "One funnel for every social post: /start + CTAs + weekly growth report"
 *       (Karl, 2026-10-28) items 3-4; supabase/migrations/20261122000000_growth_report.sql;
 *       Doctrine 7 (no under-13 data)] | @implemented [2026-10-28]
 *
 * plain English: one small world, built through the real migration pipeline. The reported week is
 * Mon 2026-10-26 to Sun 2026-11-01 in Chicago, which ends on the night US clocks go back
 * (Nov 1): Sunday 23:30 Chicago counts, Monday 00:30 Chicago does not. Students who must NOT count
 * do everything a counted student does: an under-13 student, a guardian, a deleted student and an
 * internal account (passed as excluded) all sign up, answer and upgrade in the week. Each
 * expected number is worked out in the comments next to the fixture.
 */
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { growthReportSchema } from "../../packages/shared/src/growth-report-schema";
import { bootstrapPgDatabase, PG_AVAILABLE } from "../helpers/pg-supabase";

const DB_NAME = "growth_report_ci";
let pg: Client;

const id = (n: number): string =>
  `9a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = id(1); // new this week via reddit; answers within 24 h; one long answer (capped)
const B = id(2); // older; active both weeks (returning, Dec 5); review session; upgraded last week
const C = id(3); // UNDER 13: everything in the week — never counted
const D = id(4); // GUARDIAN created in the week — never counted
const E = id(5); // DELETED student active in the week — never counted
const F = id(6); // INTERNAL account (excluded) — never counted
const G = id(7); // older; active both weeks, no test date; answers at the week's two edges
const H = id(8); // new this week via tiktok; first answer after 30 h; upgraded this week
const I = id(9); // new LAST week, untagged, no activity
const J = id(10); // older; only activity this week is one LISA message

const WEEK = "2026-10-26";

async function profile(
  pid: string,
  role: "student" | "guardian",
  createdAt: string,
  extra: { dob?: string; channel?: string; deleted?: boolean } = {},
): Promise<void> {
  await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
    pid,
    `${pid}@ci.test`,
  ]);
  await pg.query(
    `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth, created_at,
                                  signup_channel, deleted_at)
     VALUES ($1, $2, $3, 'CI', $4::date, $5::timestamptz, $6, CASE WHEN $7 THEN now() END)`,
    [
      pid,
      `${pid}@ci.test`,
      role,
      extra.dob ?? "2010-01-01",
      createdAt,
      extra.channel ?? null,
      extra.deleted ?? false,
    ],
  );
}

async function practice(
  pid: string,
  answeredAt: string,
  timeMs: number | null,
  status: "answered" | "skipped" = "answered",
): Promise<void> {
  const s = randomUUID();
  await pg.query(
    `INSERT INTO public.practice_sessions (id, user_id, actor_id, mode, target_count, platform, status)
     VALUES ($1, $2, $2, 'balanced', 1, 'web', 'completed')`,
    [s, pid],
  );
  await pg.query(
    `INSERT INTO public.practice_session_items
       (id, session_id, user_id, actor_id, ordinal, question_id, question_stem, question_options,
        question_correct_answer, question_explanation, question_domain, question_skill,
        question_difficulty, question_section, question_item_type, status, is_correct,
        selected_answer, time_spent_ms, occurred_at, answered_at)
     VALUES ($1, $2, $3, $3, 1, 'SATM1Q90001', 's', '[]'::jsonb, 'B', 'e', 'Algebra', 'ALG.D01', 2,
             'M', 'mcq', $4, true, 'B', $5, $6::timestamptz, $6::timestamptz)`,
    [randomUUID(), s, pid, status, timeMs, answeredAt],
  );
}

async function review(
  pid: string,
  answeredAt: string,
  completedAt: string | null,
): Promise<void> {
  const s = randomUUID();
  await pg.query(
    `INSERT INTO public.review_sessions (id, student_id, actor_id, mode, target_count, platform,
                                         status, completed_at)
     VALUES ($1, $2, $2, 'queue', 1, 'web', $3, $4::timestamptz)`,
    [s, pid, completedAt ? "completed" : "active", completedAt],
  );
  await pg.query(
    `INSERT INTO public.review_session_items
       (id, session_id, student_id, actor_id, ordinal, question_id, question_stem, question_options,
        question_correct_answer, question_explanation, question_domain, question_skill,
        question_difficulty, question_section, question_item_type, status, is_correct,
        selected_answer, occurred_at, answered_at)
     VALUES ($1, $2, $3, $3, 1, 'SATM1Q90001', 's', '[]'::jsonb, 'B', 'e', 'Algebra', 'ALG.D01', 2,
             'M', 'mcq', 'answered', true, 'B', $4::timestamptz, $4::timestamptz)`,
    [randomUUID(), s, pid, answeredAt],
  );
}

async function premium(pid: string, createdAt: string): Promise<void> {
  await pg.query(
    `INSERT INTO public.entitlements (profile_id, tier, status, created_at)
     VALUES ($1, 'premium', 'active', $2::timestamptz)`,
    [pid, createdAt],
  );
}

/** Both columns, as study_profile_exam_dates_sync leaves them (its trigger is off in the seed). */
async function testDate(pid: string, date: string): Promise<void> {
  await pg.query(
    `INSERT INTO public.student_study_profile (student_id, timezone, target_exam_dates, target_exam_date)
     VALUES ($1, 'America/Chicago', ARRAY[$2]::date[], $2::date)`,
    [pid, date],
  );
}

/** A full-length session started at `at`: one answer saved at `at`, one left blank. */
async function fullLength(pid: string, at: string): Promise<void> {
  const s = randomUUID();
  await pg.query(
    `INSERT INTO public.test_sessions (id, student_id, actor_id, test_form_id, state, mode,
                                       active_section, grace_expires_at, attempt_number_for_form,
                                       is_first_seen_form_attempt, created_at, started_at)
     VALUES ($1, $2, $2, $3, 'active', 'strict', 'M', $4::timestamptz, 1, true, $4::timestamptz,
             $4::timestamptz)`,
    [s, pid, randomUUID(), at],
  );
  for (const [ordinal, answer] of [
    [1, "B"],
    [2, null],
  ] as const) {
    await pg.query(
      `INSERT INTO public.test_session_answers (test_session_id, section, module, ordinal,
                                                question_id, answer, last_submission_id, updated_at)
       VALUES ($1, 'M', '1', $2, 'SATM1Q90001', $3, $4, $5::timestamptz)`,
      [s, ordinal, answer, randomUUID(), at],
    );
  }
}

async function lisaMessage(pid: string, at: string): Promise<void> {
  const conv = randomUUID();
  await pg.query(
    `INSERT INTO public.tutor_conversations (id, student_id, entry_mode, source_surface)
     VALUES ($1, $2, 'general', 'dashboard')`,
    [conv, pid],
  );
  await pg.query(
    `INSERT INTO public.tutor_messages (conversation_id, student_id, role, message, created_at)
     VALUES ($1, $2, 'student', 'hi', $3::timestamptz)`,
    [conv, pid, at],
  );
}

async function report(excluded: string[]): Promise<unknown> {
  const res = await pg.query<{ r: unknown }>(
    `SELECT public.growth_report_weekly($1::date, $2::uuid[]) AS r`,
    [WEEK, excluded],
  );
  return res.rows[0]?.r;
}

describe.skipIf(!PG_AVAILABLE)("growth report numbers (real Postgres)", () => {
  beforeAll(async () => {
    pg = await bootstrapPgDatabase(DB_NAME);

    // Accounts first, with their triggers on (profiles_set_age sets is_under_13 from the DOB).
    await profile(A, "student", "2026-10-27T15:00:00Z", { channel: "reddit" });
    await profile(B, "student", "2026-10-01T12:00:00Z");
    await profile(G, "student", "2026-09-01T12:00:00Z");
    await profile(H, "student", "2026-10-27T12:00:00Z", { channel: "tiktok" });
    await profile(I, "student", "2026-10-21T12:00:00Z"); // previous week, untagged
    await profile(J, "student", "2026-08-01T12:00:00Z");
    const NEVER = [
      [C, "student", { dob: "2015-06-01", channel: "reddit" }], // under 13
      [D, "guardian", { dob: "1980-01-01", channel: "reddit" }],
      [E, "student", { channel: "reddit", deleted: true }],
      [F, "student", { channel: "reddit" }], // internal: passed as excluded
    ] as const;
    for (const [pid, role, extra] of NEVER) {
      await profile(pid, role, "2026-10-27T13:00:00Z", extra);
    }

    // Activity as each source stores it, without the side effects (queues, mastery, the
    // question FK) that are not what this test is about. CHECK constraints still apply.
    await pg.query(`SET session_replication_role = replica`);
    await practice(A, "2026-10-27T17:00:00Z", 60_000); // 1 min, within 24 h
    await practice(A, "2026-10-28T09:00:00Z", 3_600_000); // capped to 5 min
    await practice(A, "2026-10-28T10:00:00Z", 30_000, "skipped"); // active, not answered
    await testDate(B, "2026-12-05");
    await practice(B, "2026-10-20T12:00:00Z", 30_000); // previous week
    await review(B, "2026-10-28T12:00:00Z", "2026-10-29T12:00:00Z"); // this week; review done
    await fullLength(B, "2026-10-30T12:00:00Z"); // one answer saved, one blank
    await premium(B, "2026-10-22T12:00:00Z"); // upgrade, previous week
    await practice(G, "2026-10-21T12:00:00Z", 30_000); // previous week
    // Sunday Nov 1 23:30 CST (clocks went back at 2:00) = Mon 05:30 UTC: IN the week.
    await practice(G, "2026-11-02T05:30:00Z", 120_000); // 2 min
    // Monday Nov 2 00:30 CST = 06:30 UTC: the NEXT week.
    await practice(G, "2026-11-02T06:30:00Z", 120_000);
    await practice(H, "2026-10-28T18:00:00Z", null); // 30 h after sign-up; untimed
    await premium(H, "2026-10-30T12:00:00Z"); // upgrade, this week
    await lisaMessage(J, "2026-10-29T12:00:00Z");
    // Never counted: each does everything a counted student does, in both weeks.
    for (const [pid] of NEVER) {
      await practice(pid, "2026-10-27T14:00:00Z", 60_000);
      await practice(pid, "2026-10-20T14:00:00Z", 60_000);
      await review(pid, "2026-10-28T12:00:00Z", "2026-10-29T12:00:00Z");
      await fullLength(pid, "2026-10-30T12:00:00Z");
      await lisaMessage(pid, "2026-10-29T12:00:00Z");
      await premium(pid, "2026-10-30T12:00:00Z");
    }
    await pg.query(`RESET session_replication_role`);
  }, 240_000);

  afterAll(async () => {
    await pg?.end();
  });

  it("the fixture is there (presence before absence)", async () => {
    const rows = await pg.query<{ n: string }>(
      `SELECT count(*) AS n FROM public.practice_session_items`,
    );
    // A 3, B 1, G 3, H 1, and 2 each for the four accounts that never count.
    expect(Number(rows.rows[0]?.n)).toBe(16);
  });

  it("the reported week is the last complete Monday–Sunday in Chicago", async () => {
    const at = async (ts: string): Promise<string> => {
      const r = await pg.query<{ d: string }>(
        `SELECT public.growth_report_week_start($1::timestamptz)::text AS d`,
        [ts],
      );
      return r.rows[0]?.d ?? "";
    };
    expect(await at("2026-11-02T14:00:00Z")).toBe("2026-10-26"); // the first Monday run
    expect(await at("2026-11-02T05:30:00Z")).toBe("2026-10-19"); // still Sunday in Chicago
    expect(await at("2026-11-02T06:30:00Z")).toBe("2026-10-26"); // Monday in Chicago
  });

  it("this week: every number from the fixture, with under-13, guardian, deleted and internal accounts excluded", async () => {
    const r = growthReportSchema.parse(await report([F]));
    expect(r.week).toEqual({
      week_start: "2026-10-26",
      signups: 2, // A, H
      signups_by_channel: { reddit: 1, tiktok: 1 },
      active_students: 5, // A, B, G, H, J (LISA)
      returning_students: 2, // B, G
      returning_by_test_date: [
        { test_date: "2026-12-05", students: 1 },
        { test_date: null, students: 1 },
      ],
      questions_answered: 5, // A 2 (skip not counted), B review 1, G Sunday 1, H 1
      full_length_answers: 1, // B: one saved, one blank
      reviews_done: 1, // B
      study_minutes_estimate: 8, // A 1 + 5 (capped), G 2; H untimed, B review untimed
      signups_answered_24h: 1, // A (H answered after 30 h)
      upgrades: 1, // H
    });
  });

  it("the week before, for the comparison", async () => {
    const r = growthReportSchema.parse(await report([F]));
    expect(r.previous).toMatchObject({
      week_start: "2026-10-19",
      signups: 1, // I
      signups_by_channel: { untagged: 1 },
      active_students: 2, // B, G
      returning_students: 0,
      questions_answered: 2,
      upgrades: 1, // B
    });
  });

  it("the internal account counts when it is not passed as excluded (the list is what excludes it)", async () => {
    const r = growthReportSchema.parse(await report([]));
    expect(r.week.signups).toBe(3);
    expect(r.week.signups_by_channel).toEqual({ reddit: 2, tiktok: 1 });
  });

  it("refuses a week that does not start on a Monday", async () => {
    await expect(
      pg.query(`SELECT public.growth_report_weekly('2026-10-27'::date, '{}')`),
    ).rejects.toThrow(/must be a Monday/);
  });

  it("the ledger: claim once, a second claim refused, a release lets it be claimed again", async () => {
    const claim = async (): Promise<boolean | undefined> =>
      (
        await pg.query<{ c: boolean }>(
          `SELECT public.growth_report_claim('2026-10-26'::date) AS c`,
        )
      ).rows[0]?.c;
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false);
    await pg.query(`SELECT public.growth_report_release('2026-10-26'::date)`);
    expect(await claim()).toBe(true);
    await pg.query(
      `SELECT public.growth_report_mark_posted('2026-10-26'::date)`,
    );
    // A posted week is never claimed again, and release leaves it alone.
    await pg.query(`SELECT public.growth_report_release('2026-10-26'::date)`);
    await pg.query(
      `UPDATE public.growth_report_posts SET claimed_at = now() - interval '1 day'`,
    );
    expect(await claim()).toBe(false);
  });

  it("a claim left by a crashed run is taken over after 15 minutes", async () => {
    const week = "2026-10-19";
    await pg.query(`SELECT public.growth_report_claim($1::date)`, [week]);
    const again = await pg.query<{ c: boolean }>(
      `SELECT public.growth_report_claim($1::date) AS c`,
      [week],
    );
    expect(again.rows[0]?.c).toBe(false);
    await pg.query(
      `UPDATE public.growth_report_posts SET claimed_at = now() - interval '16 minutes'
        WHERE week_start = $1::date`,
      [week],
    );
    const later = await pg.query<{ c: boolean }>(
      `SELECT public.growth_report_claim($1::date) AS c`,
      [week],
    );
    expect(later.rows[0]?.c).toBe(true);
  });

  it("no client role can run the functions or read the ledger", async () => {
    const fns = await pg.query<{
      fn: string;
      anon: boolean;
      authed: boolean;
      svc: boolean;
    }>(
      `SELECT p.proname AS fn,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname LIKE 'growth_report_%'
        ORDER BY 1`,
    );
    expect(fns.rows.map((r) => r.fn)).toEqual([
      "growth_report_claim",
      "growth_report_mark_posted",
      "growth_report_release",
      "growth_report_week_start",
      "growth_report_weekly",
    ]);
    for (const r of fns.rows) {
      expect([r.fn, r.anon, r.authed, r.svc]).toEqual([
        r.fn,
        false,
        false,
        true,
      ]);
    }
    const table = await pg.query<{
      anon: boolean;
      authed: boolean;
      rls: boolean;
    }>(
      `SELECT has_table_privilege('anon', 'public.growth_report_posts', 'SELECT') AS anon,
              has_table_privilege('authenticated', 'public.growth_report_posts', 'SELECT') AS authed,
              (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.growth_report_posts'::regclass) AS rls`,
    );
    expect(table.rows[0]).toEqual({ anon: false, authed: false, rls: true });
  });
});
