/**
 * Server-side funnel events — real Postgres, real emitEvent, run as service_role.
 *
 * @spec [owner brief "Server-side funnel events" (Karl, 2026-10-21) "Acceptance"; Karl's answers
 *       of 2026-10-21 (onboarding ~10s after completion, plan_created = first plan generated,
 *       upgraded `alpha` = a 100%-off discount)] | @implemented [2026-10-21]
 *
 * plain English: every function under test is the production one. The funnel module claims its
 * milestones through the real `analytics_funnel_claim` / `analytics_funnel_release`, run as a role
 * holding exactly service_role's grants (plus BYPASSRLS, which Supabase's service_role has), and
 * sends through the real `emitEventWith`, which derives the salted analytics_user_id, validates the
 * payload against the registry and redacts it. Only the final PostHog call is captured.
 *   F1  each of the six fires once, and never again (retries, reloads, second sessions)
 *   F2  concurrent first answers send once
 *   F3  the properties are exactly the listed ones, never content or identity
 *   F4  the distinct id is user_signed_up's (the salted id, never the profile id)
 *   F5  an analytics failure never throws into the caller; a failed send releases the claim
 *   F6  under-13 and age-unknown: never sent, claim kept (emitEvent's user_signed_up rule)
 *   F7  analytics switched off: nothing claimed, nothing sent
 *   F8  onboarding_completed: waits ~10s, then reports age band and the SAT goal as stored
 *   F9  answer sources: QOTD counts for first_answer only; practice/diagnostic for both
 *   F10 upgraded `via`: 100%-off → alpha (whoever paid), guardian payer → guardian_paid, else paid
 *   F11 grants: service_role can claim and release; authenticated cannot
 *   F12 backfill: milestones passed before the migration are claimed and never sent
 */
import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  applyMigrationsFrom,
  bootstrapPgDatabase,
  pgConnConfig,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import type { EmitDeps } from "../../server/lib/analytics/emit-event";
import { emitEventWith } from "../../server/lib/analytics/emit-event";
import { deriveAnalyticsUserId } from "../../server/lib/analytics/analytics-user-id";
import {
  classifyUpgradeVia,
  ONBOARDING_EVENT_DELAY_MS,
  runAnswerMilestones,
  runDiagnosticCompleted,
  runOnboardingCompleted,
  runPlanCreated,
  runUpgraded,
  type FunnelDeps,
} from "../../server/lib/analytics/funnel-events";

const captured = vi.hoisted(() => ({
  waitUntil: [] as Array<Promise<unknown>>,
  rpcFails: true,
}));
vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => {
    captured.waitUntil.push(p);
  },
}));
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    rpc: async () => {
      throw new Error("database unreachable");
    },
    from: () => {
      throw new Error("database unreachable");
    },
  },
}));
vi.mock("../../server/logger", () => {
  const noop = (): void => undefined;
  return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
});

const DB_NAME = "funnel_events_ci";
const SALT = "test-analytics-salt-at-least-32-characters-long";
const PROBE = "funnel_service_role_probe";
const NOW = new Date("2026-10-21T12:00:00Z");
const BASE = ["analytics_user_id", "event_name", "schema_version", "timestamp"];

type Sent = {
  distinctId: string;
  event: string;
  properties: Record<string, unknown>;
};

let pg: Client;
let pool: Pool;

/** One statement as service_role (the probe role inherits exactly its grants). */
async function asService<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SET LOCAL ROLE ${PROBE}`);
    const r = await c.query<T>(sql, params);
    await c.query("COMMIT");
    return r.rows;
  } catch (err: unknown) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

async function ensureProbe(): Promise<void> {
  await pg.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PROBE}') THEN
        CREATE ROLE ${PROBE} NOLOGIN BYPASSRLS INHERIT;
      END IF;
    END $$;
    GRANT service_role TO ${PROBE};
  `);
}

function harness(
  options: { env?: Record<string, string>; sendFails?: () => boolean } = {},
): { deps: FunnelDeps; sent: Sent[]; slept: number[] } {
  const sent: Sent[] = [];
  const slept: number[] = [];
  const emit: EmitDeps = {
    env: options.env ?? { POSTHOG_API_KEY: "phc_test", ANALYTICS_SALT: SALT },
    async loadProfile(profileId) {
      const rows = await asService<{
        analytics_user_id: string | null;
        is_under_13: boolean | null;
        profile_completed_at: string | null;
      }>(
        `SELECT analytics_user_id, is_under_13, profile_completed_at FROM public.profiles WHERE id = $1`,
        [profileId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        analyticsUserId: row.analytics_user_id,
        isUnder13: row.is_under_13,
        onboarded: row.profile_completed_at !== null,
      };
    },
    async persistAnalyticsUserId(profileId, derived) {
      const written = await asService(
        `UPDATE public.profiles SET analytics_user_id = $2
          WHERE id = $1 AND analytics_user_id IS NULL RETURNING id`,
        [profileId, derived],
      );
      const rows = await asService<{ analytics_user_id: string }>(
        `SELECT analytics_user_id FROM public.profiles WHERE id = $1`,
        [profileId],
      );
      return {
        stored: rows[0]!.analytics_user_id,
        wroteNow: written.length === 1,
      };
    },
    async send(message) {
      if (options.sendFails?.()) throw new Error("posthog down");
      sent.push({
        distinctId: message.distinctId,
        event: message.event,
        properties: message.properties,
      });
    },
    now: () => NOW,
  };
  const deps: FunnelDeps = {
    emit,
    async claim(profileId, milestone) {
      const rows = await asService<{ claimed: boolean }>(
        `SELECT public.analytics_funnel_claim($1, $2) AS claimed`,
        [profileId, milestone],
      );
      return rows[0]!.claimed;
    },
    async release(profileId, milestone) {
      await asService(`SELECT public.analytics_funnel_release($1, $2)`, [
        profileId,
        milestone,
      ]);
    },
    async loadSignupFacts(profileId) {
      const rows = await asService<{
        created_at: Date;
        role: string | null;
        date_of_birth: Date | null;
      }>(
        `SELECT created_at, role, date_of_birth::text AS date_of_birth FROM public.profiles WHERE id = $1`,
        [profileId],
      );
      const r = rows[0];
      if (!r) return null;
      return {
        created_at: new Date(r.created_at).toISOString(),
        role: r.role,
        date_of_birth:
          r.date_of_birth === null ? null : String(r.date_of_birth),
      };
    },
    async loadGoalFacts(profileId) {
      const rows = await asService<{ n: number; score: number | null }>(
        `SELECT coalesce(cardinality(target_exam_dates), 0) AS n, target_score AS score
           FROM public.student_study_profile WHERE student_id = $1`,
        [profileId],
      );
      const r = rows[0];
      return { hasTestDate: (r?.n ?? 0) > 0, hasTargetScore: r?.score != null };
    },
    async sleep(ms) {
      slept.push(ms);
    },
    now: () => NOW,
  };
  return { deps, sent, slept };
}

// ── Seeds: the rows the product writes ─────────────────────────────────────────────────────

const id = (n: number): string =>
  `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function seedProfile(
  pid: string,
  opts: {
    role?: "student" | "guardian";
    dob?: string | null;
    onboarded?: boolean;
    hoursAgo?: number;
  } = {},
): Promise<void> {
  const created = new Date(NOW.getTime() - (opts.hoursAgo ?? 50) * 3_600_000);
  await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
    pid,
    `${pid}@example.test`,
  ]);
  await pg.query(
    `INSERT INTO public.profiles
       (id, email, role, display_name, date_of_birth, profile_completed_at, created_at)
     VALUES ($1, $2, $3, 'Secret Name', $4::date, $5, $6)`,
    [
      pid,
      `${pid}@example.test`,
      opts.role ?? "student",
      opts.dob === undefined ? "2009-03-01" : opts.dob,
      opts.onboarded === false ? null : created.toISOString(),
      created.toISOString(),
    ],
  );
}

async function replica<T>(work: () => Promise<T>): Promise<T> {
  await pg.query(`SET session_replication_role = replica`);
  try {
    return await work();
  } finally {
    await pg.query(`SET session_replication_role = origin`);
  }
}

async function seedAnswer(
  pid: string,
  mode: "balanced" | "qotd" | "diagnostic",
  status: "completed" | "active" = "completed",
): Promise<void> {
  await replica(async () => {
    const s = randomUUID();
    await pg.query(
      `INSERT INTO public.practice_sessions (id, user_id, actor_id, mode, target_count, platform, status)
       VALUES ($1, $2, $2, $3, 1, 'web', $4)`,
      [s, pid, mode, status],
    );
    await pg.query(
      `INSERT INTO public.practice_session_items
         (id, session_id, user_id, actor_id, ordinal, question_id, question_stem, question_options,
          question_correct_answer, question_explanation, question_domain, question_skill,
          question_difficulty, question_section, question_item_type, status, is_correct,
          selected_answer, occurred_at, answered_at)
       VALUES ($1, $2, $3, $3, 1, 'SATM1Q90001', 's', '[]'::jsonb, 'B', 'e', 'Algebra', 'ALG.D01', 2,
               'M', 'mcq', 'answered', true, 'B', now(), now())`,
      [randomUUID(), s, pid],
    );
  });
}

async function milestones(pid: string): Promise<string[]> {
  const r = await pg.query<{ milestone: string }>(
    `SELECT milestone FROM public.analytics_funnel_milestones WHERE profile_id = $1 ORDER BY milestone`,
    [pid],
  );
  return r.rows.map((x) => x.milestone);
}

const keysOf = (s: Sent): string[] => Object.keys(s.properties).sort();

describe.skipIf(!PG_AVAILABLE)(
  "Server-side funnel events — real Postgres",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      pool = new Pool({ ...pgConnConfig(DB_NAME), max: 6 });
      await ensureProbe();
    }, 180_000);

    afterAll(async () => {
      await pool?.end();
      await pg?.end();
    });

    it("F1: each of the six fires once, and a retry, reload or second session sends nothing", async () => {
      const s = id(1);
      await seedProfile(s);
      const { deps, sent } = harness();
      const plan = [
        () => runOnboardingCompleted(deps, s),
        () => runAnswerMilestones(deps, s, "balanced"),
        () => runDiagnosticCompleted(deps, s),
        () => runPlanCreated(deps, s),
        () => runUpgraded(deps, s, async () => "paid"),
      ];
      for (const step of plan) {
        await step();
        await step();
        await step();
      }
      expect(sent.map((x) => x.event).sort()).toEqual([
        "diagnostic_completed",
        "first_answer",
        "first_practice",
        "onboarding_completed",
        "plan_created",
        "upgraded",
      ]);
      expect(await milestones(s)).toHaveLength(6);
      // A second "session" (fresh harness) still sends nothing.
      const again = harness();
      expect(await runAnswerMilestones(again.deps, s, "diagnostic")).toEqual({
        firstAnswer: "already_sent",
        firstPractice: "already_sent",
      });
      expect(again.sent).toEqual([]);
    });

    it("F2: concurrent first answers send first_answer once", async () => {
      const s = id(2);
      await seedProfile(s);
      const { deps, sent } = harness();
      await Promise.all(
        Array.from({ length: 5 }, () => runAnswerMilestones(deps, s, "qotd")),
      );
      expect(sent.filter((x) => x.event === "first_answer")).toHaveLength(1);
      expect(sent.filter((x) => x.event === "first_practice")).toHaveLength(0);
    });

    it("F3: the properties are exactly the listed ones, never content or identity", async () => {
      const s = id(3);
      await seedProfile(s, { hoursAgo: 50 });
      await pg.query(
        `INSERT INTO public.student_study_profile (student_id, timezone, target_exam_dates, target_score)
       VALUES ($1, 'America/Chicago', ARRAY['2026-12-05']::date[], 1400)`,
        [s],
      );
      const { deps, sent } = harness();
      await runOnboardingCompleted(deps, s);
      await runAnswerMilestones(deps, s, "diagnostic");
      await runDiagnosticCompleted(deps, s);
      await runPlanCreated(deps, s);
      await runUpgraded(deps, s, async () => "alpha");
      // Presence first: all six were sent.
      expect(sent).toHaveLength(6);
      const by = Object.fromEntries(sent.map((x) => [x.event, x]));
      expect(keysOf(by.onboarding_completed!)).toEqual(
        [
          ...BASE,
          "age_band",
          "has_target_score",
          "has_test_date",
          "role",
        ].sort(),
      );
      expect(keysOf(by.first_answer!)).toEqual(
        [...BASE, "hours_since_signup", "source"].sort(),
      );
      expect(keysOf(by.first_practice!)).toEqual(
        [...BASE, "hours_since_signup", "source"].sort(),
      );
      expect(keysOf(by.diagnostic_completed!)).toEqual(
        [...BASE, "days_since_signup"].sort(),
      );
      expect(keysOf(by.plan_created!)).toEqual(
        [...BASE, "days_since_signup"].sort(),
      );
      expect(keysOf(by.upgraded!)).toEqual(
        [...BASE, "days_since_signup", "via"].sort(),
      );
      expect(by.first_answer!.properties.hours_since_signup).toBe(50);
      expect(by.diagnostic_completed!.properties.days_since_signup).toBe(2);
      // No identity and no content anywhere in what leaves.
      const wire = JSON.stringify(sent);
      for (const forbidden of [
        s,
        `${s}@example.test`,
        "Secret Name",
        "2009-03-01",
        "2026-12-05",
        "1400",
        "SATM1Q90001",
      ]) {
        expect(wire).not.toContain(forbidden);
      }
    });

    it("F4: the distinct id is user_signed_up's: the salted id, never the profile id", async () => {
      const s = id(4);
      await seedProfile(s);
      const { deps, sent } = harness();
      const signedUp = await emitEventWith(
        {
          ...deps.emit,
          async send(m) {
            sent.push({
              distinctId: m.distinctId,
              event: m.event,
              properties: m.properties,
            });
          },
        },
        s,
        "user_signed_up",
        { signup_source: "unknown" },
        { requireFirstIdentity: true },
      );
      expect(signedUp.ok).toBe(true);
      await runAnswerMilestones(deps, s, "balanced");
      await runPlanCreated(deps, s);
      expect(sent.map((x) => x.event)).toEqual([
        "user_signed_up",
        "first_answer",
        "first_practice",
        "plan_created",
      ]);
      const expected = deriveAnalyticsUserId(s, SALT);
      expect(new Set(sent.map((x) => x.distinctId))).toEqual(
        new Set([expected]),
      );
      expect(expected).not.toBe(s);
    });

    it("F5: a failed send never throws, releases the claim, and the next moment sends once", async () => {
      const s = id(5);
      await seedProfile(s);
      let down = true;
      const { deps, sent } = harness({ sendFails: () => down });
      expect(await runPlanCreated(deps, s)).toBe("failed");
      expect(await milestones(s)).toEqual([]);
      down = false;
      expect(await runPlanCreated(deps, s)).toBe("sent");
      expect(await runPlanCreated(deps, s)).toBe("already_sent");
      expect(sent.filter((x) => x.event === "plan_created")).toHaveLength(1);

      // A claim that cannot be written is a failure, not a throw.
      const broken = harness();
      broken.deps.claim = async () => {
        throw new Error("db down");
      };
      await expect(runDiagnosticCompleted(broken.deps, s)).resolves.toBe(
        "failed",
      );
    });

    it("F5b: the fire-and-forget entry points return at once and never reject, even when everything fails", async () => {
      const { fireAnswerMilestones, fireUpgraded } =
        await import("../../server/lib/analytics/funnel-events");
      const saved = {
        key: process.env.POSTHOG_API_KEY,
        salt: process.env.ANALYTICS_SALT,
      };
      process.env.POSTHOG_API_KEY = "phc_test";
      process.env.ANALYTICS_SALT = SALT;
      try {
        captured.waitUntil.length = 0;
        expect(fireAnswerMilestones(id(55), "balanced")).toBeUndefined();
        expect(
          fireUpgraded(id(55), async () => {
            throw new Error("stripe down");
          }),
        ).toBeUndefined();
        expect(captured.waitUntil).toHaveLength(2);
        await expect(Promise.all(captured.waitUntil)).resolves.toBeDefined();
      } finally {
        if (saved.key === undefined) delete process.env.POSTHOG_API_KEY;
        else process.env.POSTHOG_API_KEY = saved.key;
        if (saved.salt === undefined) delete process.env.ANALYTICS_SALT;
        else process.env.ANALYTICS_SALT = saved.salt;
      }
    });

    it("F6: under-13 and age-unknown are never sent; the claim is kept so they are not re-tried", async () => {
      const young = id(6);
      const unknown = id(7);
      await seedProfile(young, { dob: "2015-06-01" });
      await seedProfile(unknown, { dob: null });
      const { deps, sent } = harness();
      expect(
        (await runAnswerMilestones(deps, young, "balanced")).firstAnswer,
      ).toBe("skipped");
      expect(await runOnboardingCompleted(deps, young)).toBe("skipped");
      expect(
        (await runAnswerMilestones(deps, unknown, "qotd")).firstAnswer,
      ).toBe("skipped");
      expect(sent).toEqual([]);
      expect(await milestones(young)).toEqual([
        "first_answer",
        "first_practice",
        "onboarding_completed",
      ]);
    });

    it("F7: analytics switched off claims nothing and sends nothing", async () => {
      const s = id(8);
      await seedProfile(s);
      const { deps, sent } = harness({ env: {} });
      expect(await runPlanCreated(deps, s)).toBe("skipped");
      expect(sent).toEqual([]);
      expect(await milestones(s)).toEqual([]);
    });

    it("F8: onboarding_completed waits ~10s, then reports the age band and the stored SAT goal", async () => {
      const teen = id(9);
      const parent = id(10);
      const adultStudent = id(11);
      await seedProfile(teen, { dob: "2009-03-01" });
      await seedProfile(parent, { role: "guardian", dob: "1980-01-01" });
      await seedProfile(adultStudent, { dob: "2006-01-01" });
      await pg.query(
        `INSERT INTO public.student_study_profile (student_id, timezone, target_exam_dates, target_score)
       VALUES ($1, 'America/Chicago', ARRAY['2026-12-05']::date[], NULL)`,
        [teen],
      );
      const { deps, sent, slept } = harness();
      await runOnboardingCompleted(deps, teen);
      await runOnboardingCompleted(deps, parent);
      await runOnboardingCompleted(deps, adultStudent);
      expect(slept).toEqual([
        ONBOARDING_EVENT_DELAY_MS,
        ONBOARDING_EVENT_DELAY_MS,
        ONBOARDING_EVENT_DELAY_MS,
      ]);
      expect(ONBOARDING_EVENT_DELAY_MS).toBe(10_000);
      const props = sent.map((x) => {
        const { role, age_band, has_test_date, has_target_score } =
          x.properties;
        return { role, age_band, has_test_date, has_target_score };
      });
      expect(props).toEqual([
        {
          role: "student",
          age_band: "13-17",
          has_test_date: true,
          has_target_score: false,
        },
        {
          role: "guardian",
          age_band: "18+",
          has_test_date: false,
          has_target_score: false,
        },
        {
          role: "student",
          age_band: "18+",
          has_test_date: false,
          has_target_score: false,
        },
      ]);
    });

    it("F9: QOTD counts for first_answer only; a later practice answer is the first practice", async () => {
      const q = id(12);
      const d = id(13);
      await seedProfile(q);
      await seedProfile(d);
      const { deps, sent } = harness();
      // A QOTD answer never attempts first_practice: no claim, no send.
      expect(await runAnswerMilestones(deps, q, "qotd")).toEqual({
        firstAnswer: "sent",
        firstPractice: null,
      });
      expect(sent.map((x) => [x.event, x.properties.source])).toEqual([
        ["first_answer", "qotd"],
      ]);
      expect(await milestones(q)).toEqual(["first_answer"]);
      await runAnswerMilestones(deps, q, "balanced");
      await runAnswerMilestones(deps, d, "diagnostic");
      expect(sent.map((x) => [x.event, x.properties.source])).toEqual([
        ["first_answer", "qotd"],
        ["first_practice", "practice"],
        ["first_answer", "diagnostic"],
        ["first_practice", "diagnostic"],
      ]);
    });

    it("F10: upgraded via — 100%-off is alpha whoever paid; a guardian payer is guardian_paid; else paid; unreadable is not guessed", async () => {
      const student = id(14);
      const guardian = id(15);
      const off = (pct: number | null) => [
        { source: { coupon: { percent_off: pct } } },
      ];
      expect(
        classifyUpgradeVia({
          discounts: off(100),
          payerProfileId: guardian,
          studentProfileId: student,
        }),
      ).toBe("alpha");
      expect(
        classifyUpgradeVia({
          discounts: off(100),
          payerProfileId: null,
          studentProfileId: student,
        }),
      ).toBe("alpha");
      expect(
        classifyUpgradeVia({
          discounts: off(50),
          payerProfileId: guardian,
          studentProfileId: student,
        }),
      ).toBe("guardian_paid");
      expect(
        classifyUpgradeVia({
          discounts: [],
          payerProfileId: student,
          studentProfileId: student,
        }),
      ).toBe("paid");
      expect(
        classifyUpgradeVia({
          discounts: off(null),
          payerProfileId: null,
          studentProfileId: student,
        }),
      ).toBe("paid");
      expect(
        classifyUpgradeVia({
          discounts: [{ source: { coupon: "coupon_id_unexpanded" } }],
          payerProfileId: null,
          studentProfileId: student,
        }),
      ).toBeNull();

      await seedProfile(student);
      const { deps, sent } = harness();
      expect(await runUpgraded(deps, student, async () => null)).toBe("failed");
      expect(await milestones(student)).toEqual([]);
      expect(
        await runUpgraded(deps, student, async () => "guardian_paid"),
      ).toBe("sent");
      expect(sent.map((x) => x.properties.via)).toEqual(["guardian_paid"]);
    });

    it("F11: grants — service_role claims and releases; authenticated is refused", async () => {
      const s = id(16);
      await seedProfile(s);
      const first = await asService<{ c: boolean }>(
        `SELECT public.analytics_funnel_claim($1, 'plan_created') AS c`,
        [s],
      );
      const second = await asService<{ c: boolean }>(
        `SELECT public.analytics_funnel_claim($1, 'plan_created') AS c`,
        [s],
      );
      expect([first[0]!.c, second[0]!.c]).toEqual([true, false]);
      await asService(
        `SELECT public.analytics_funnel_release($1, 'plan_created')`,
        [s],
      );
      expect(await milestones(s)).toEqual([]);
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SET LOCAL ROLE authenticated");
        await expect(
          c.query(`SELECT public.analytics_funnel_claim($1, 'plan_created')`, [
            s,
          ]),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });
  },
);

const FIX_MIGRATION = "20261109000000_analytics_funnel_milestones.sql";

describe.skipIf(!PG_AVAILABLE)(
  "Server-side funnel events — the backfill",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(`${DB_NAME}_backfill`, {
        stopBefore: FIX_MIGRATION,
      });
      pool = new Pool({ ...pgConnConfig(`${DB_NAME}_backfill`), max: 4 });
      await ensureProbe();
    }, 180_000);

    afterAll(async () => {
      await pool?.end();
      await pg?.end();
    });

    it("F12: milestones passed before the migration are claimed and never sent; new students still are", async () => {
      const veteran = id(21);
      const qotdOnly = id(22);
      const fresh = id(23);
      await seedProfile(veteran);
      await seedProfile(qotdOnly);
      await seedProfile(fresh, { onboarded: false });
      await seedAnswer(veteran, "balanced");
      await seedAnswer(veteran, "diagnostic", "completed");
      await pg.query(
        "INSERT INTO public.entitlements (profile_id, tier, status) VALUES ($1, 'premium', 'canceled')",
        [veteran],
      );
      await seedAnswer(qotdOnly, "qotd");

      await applyMigrationsFrom(pg, FIX_MIGRATION);

      expect(await milestones(veteran)).toEqual([
        "diagnostic_completed",
        "first_answer",
        "first_practice",
        "onboarding_completed",
        "upgraded",
      ]);
      expect(await milestones(qotdOnly)).toEqual([
        "first_answer",
        "onboarding_completed",
      ]);
      expect(await milestones(fresh)).toEqual([]);

      const { deps, sent } = harness();
      await runAnswerMilestones(deps, veteran, "balanced");
      await runDiagnosticCompleted(deps, veteran);
      await runUpgraded(deps, veteran, async () => "paid");
      await runAnswerMilestones(deps, qotdOnly, "balanced");
      expect(sent.map((x) => x.event)).toEqual(["first_practice"]);
    });
  },
);
