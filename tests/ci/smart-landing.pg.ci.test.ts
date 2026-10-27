/**
 * Smart landing on real Postgres: the real `openLanding` over the real migration
 * (`landing_claim_open`, `landing_record_escape`, `landing_claim_summaries`), the real practice
 * start (`startOrReplaySession` with its composition), the real entitlement and quota reads, and
 * the real `emitEventWith` with only PostHog replaced by a recorder.
 *
 * @spec [owner brief "Smart landing" (Karl, 2026-10-26) Acceptance; Karl's rulings A–E on Step 0;
 *        Karl's change the same day: `set_math_5` replaces `set_mixed` and `set_math_first`, and
 *        "5 more?" is 5 Math] | @implemented [2026-10-26]
 *
 * plain English (each case names the brief's acceptance line it proves):
 *   P1  deterministic per (student, window): the window's arm is stored once; later opens keep it
 *   P2  first open of the Chicago day only: a second open the same day lands nowhere; the next
 *       Chicago day in the same window lands again with the same arm; a new window re-draws
 *   P3  eligibility at window start: a student entitled after the window's first open keeps the
 *       frozen free arms for the rest of that window
 *   P4  precedence: an in-progress session resumes, and no show is claimed
 *   P5  students only: a guardian and an admin get nothing and no row
 *   P6  under 13 and unknown age: nothing and no row (ruling D)
 *   P7  kill switch off: nothing and no row; the seeded switch is OFF
 *   P8  each arm routes correctly (dashboard, qotd_then_more, set_math_5, session_today,
 *       plan_builder), and a set from earlier in the window resumes (ruling B)
 *   P9  `set_math_5`: 5 Math items, the first 2 easy/medium, on a session whose own section is
 *       Math (the session page runs a practice session in one section)
 *   P10 fallback: a free student with no quota left gets Home, with `fallback_reason`
 *   P11 the events fire with exactly the listed properties
 *   P12 escape: within 30 s of a non-dashboard landing, once, by the server's clock
 *   P13 the nightly summary counts questions answered until the next landing or the day's end
 *   P14 "5 more": only after a qotd_then_more landing; 5 Math items, the first 2 easy/medium
 *   P15 deletion cascade
 *   P16 grants, checked as a service_role probe
 *   P17 session_today re-checks the entitlement at launch (not_entitled)
 *   P18 a window stored with a retired arm shows Home (`arm_retired`), creates no set, and its
 *       events still carry the stored arm
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import pg from "pg";
import {
  PG_AVAILABLE,
  bootstrapPgDatabase,
  pgConnConfig,
} from "../helpers/pg-supabase";

const h = vi.hoisted(() => ({ pool: null as unknown }));

vi.mock("../../apps/api/src/lib/supabase-server", async () => {
  const { makePgSupabase: make } = await import("../helpers/pg-supabase");
  return {
    supabaseServer: new Proxy(
      {},
      {
        get(_t, prop) {
          if (h.pool === null)
            throw new Error("smart landing harness not booted");
          const sb = make(h.pool as import("pg").Client) as unknown as Record<
            string,
            unknown
          >;
          return sb[prop as string];
        },
      },
    ),
  };
});

const DB = "smart_landing_ci";
const PROBE = "sl_service_role_probe";
/** Window 0 starts 2026-10-26 00:00 UTC. 15:00 UTC is 10:00 in Chicago (CDT). */
const W0_DAY1 = new Date("2026-10-26T15:00:00.000Z");
const W0_DAY2 = new Date("2026-10-27T15:00:00.000Z");
const W1_DAY1 = new Date("2026-10-28T15:00:00.000Z");
const SALT = "x".repeat(40);

const DOMAINS = [
  { section: "M", domain: "Algebra", code: "ALG" },
  { section: "M", domain: "Advanced Math", code: "ADV" },
  { section: "RW", domain: "Craft and Structure", code: "CRS" },
  { section: "RW", domain: "Information and Ideas", code: "INF" },
] as const;

type Svc = typeof import("../../server/services/landing/landing-service");
type Deps = import("../../server/services/landing/landing-service").LandingDeps;
type Caller =
  import("../../server/services/landing/landing-service").LandingCaller;
type Arm = import("../../packages/shared/src/smart-landing-schema").LandingArm;
type Config =
  import("../../packages/shared/src/smart-landing-schema").LandingConfig;

const ROUND1: Config = {
  enabled: true,
  dashboardShare: 1 / 3,
  weights: {
    qotd_then_more: 1,
    set_math_5: 1,
    session_today: 1,
    plan_builder: 1,
    calendar_today: 0,
  },
  salt: "smart-landing-r1",
};

/** Only this arm (and dashboard at share 0): forces the draw. */
function only(arm: Arm): Config {
  if (arm === "dashboard") return { ...ROUND1, dashboardShare: 0, weights: {} };
  return { ...ROUND1, dashboardShare: 0, weights: { [arm]: 1 } };
}

describe.skipIf(!PG_AVAILABLE)("smart landing → real PG", () => {
  let admin: pg.Client;
  let svc: Svc;
  let live: Deps;
  let n = 0;
  const sent: { event: string; properties: Record<string, unknown> }[] = [];
  let clock = W0_DAY1;
  let config: Config = ROUND1;
  let qotdToday = true;
  let launchTodayPath: string | null =
    "/practice/session/plan-session?from=landing";

  function deps(overrides: Partial<Deps> = {}): Deps {
    return {
      ...live,
      now: () => clock,
      loadConfig: async () => config,
      qotdAvailable: async () => qotdToday,
      launchToday: async () =>
        launchTodayPath === null
          ? { ok: false, reason: "no_block_today" }
          : { ok: true, path: launchTodayPath },
      emit: {
        ...live.emit,
        env: { POSTHOG_API_KEY: "phc_test", ANALYTICS_SALT: SALT },
        send: async (m) => {
          sent.push({ event: m.event, properties: m.properties });
        },
        now: () => clock,
      },
      ...overrides,
    };
  }

  async function person(
    opts: {
      role?: "student" | "guardian" | "admin";
      dob?: string | null;
      pro?: boolean;
    } = {},
  ): Promise<Caller> {
    n += 1;
    const id = `5b000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    await admin.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
      id,
      `sl${n}@school.example`,
    ]);
    await admin.query(
      `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth, profile_completed_at)
       VALUES ($1, $2, $3, 'Sam Lee', $4::date, now())`,
      [
        id,
        `sl${n}@school.example`,
        opts.role ?? "student",
        opts.dob === undefined ? "2010-01-01" : opts.dob,
      ],
    );
    if (opts.pro === true) await entitle(id);
    const row = await admin.query<{
      is_under_13: boolean | null;
      actor_id: string | null;
    }>(`SELECT is_under_13, actor_id FROM public.profiles WHERE id = $1`, [id]);
    return {
      id,
      actorId: row.rows[0]?.actor_id ?? id,
      role: opts.role ?? "student",
      isUnder13: row.rows[0]?.is_under_13 ?? undefined,
    };
  }

  async function entitle(id: string): Promise<void> {
    await admin.query(
      `INSERT INTO public.entitlements
         (profile_id, tier, status, stripe_subscription_id, stripe_subscription_item_id, current_period_end)
       VALUES ($1, 'premium', 'active', 'sub_' || $2, 'si_' || $2, now() + interval '20 days')`,
      [id, id.slice(-6)],
    );
  }

  async function rows(table: "landing_windows" | "landing_shows", id: string) {
    const r = await admin.query(
      `SELECT * FROM public.${table} WHERE profile_id = $1 ORDER BY 1`,
      [id],
    );
    return r.rows as Record<string, unknown>[];
  }

  async function open(
    caller: Caller,
    d: Deps = deps(),
    device: "phone" | "tablet" | "desktop" = "phone",
  ) {
    return svc.openLanding(d, caller, {
      deviceClass: device,
      clientInstanceId: `ci-${caller.id}`,
    });
  }

  async function itemsOf(path: string | null) {
    const id = /\/practice\/session\/([0-9a-f-]{36})/.exec(path ?? "")?.[1];
    expect(id, String(path)).toBeDefined();
    const r = await admin.query<{
      ordinal: number;
      question_difficulty: number;
      section: string;
    }>(
      `SELECT i.ordinal, i.question_difficulty, q.section
         FROM public.practice_session_items i JOIN public.questions q ON q.id = i.question_id
        WHERE i.session_id = $1 ORDER BY i.ordinal`,
      [id],
    );
    return r.rows;
  }

  /**
   * The sections the session persists (`filters->session_spec->sections`), which the state route
   * resolves into the one `section` the session page runs: one section, or none at all.
   */
  async function sessionSection(path: string | null) {
    const id = /\/practice\/session\/([0-9a-f-]{36})/.exec(path ?? "")?.[1];
    expect(id, String(path)).toBeDefined();
    const r = await admin.query<{ sections: unknown }>(
      `SELECT filters->'session_spec'->'sections' AS sections
         FROM public.practice_sessions WHERE id = $1`,
      [id],
    );
    return r.rows[0];
  }

  /** One answered item, snapshotted from the bank as the practice start would. */
  async function answered(
    sessionId: string | undefined,
    studentId: string,
    questionId: string,
    ordinal: number,
    at: string,
  ): Promise<void> {
    await admin.query(
      `INSERT INTO public.practice_session_items
         (session_id, user_id, actor_id, question_id, ordinal, status, answered_at, occurred_at,
          question_stem, question_options, question_correct_answer, question_explanation,
          question_domain, question_skill, question_difficulty, question_section, question_item_type)
       SELECT $1, $2, $2, q.id, $4, 'answered', $5::timestamptz, $5::timestamptz,
              q.stem, q.options, q.correct_answer, q.explanation,
              q.domain, q.skill_codes[1], q.difficulty, q.section, 'mcq'
         FROM public.questions q WHERE q.id = $3`,
      [sessionId, studentId, questionId, ordinal, at],
    );
  }

  beforeAll(async () => {
    admin = await bootstrapPgDatabase(DB);
    await admin.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PROBE}') THEN
          CREATE ROLE ${PROBE} NOLOGIN BYPASSRLS INHERIT;
        END IF;
      END $$;
      GRANT service_role TO ${PROBE};
    `);
    await admin.query(
      `UPDATE public.entitlement_features SET enabled = true WHERE feature_key = 'calendar_access'`,
    );
    for (const d of DOMAINS) {
      for (let i = 0; i < 12; i += 1) {
        const id = `SAT${d.section}1${d.code}${String(i).padStart(3, "0")}`;
        await admin.query(
          `INSERT INTO public.questions
             (id, section, source_type, domain, skill_codes, difficulty, stem, options,
              correct_answer, explanation, option_metadata, status, item_type, published_at)
           VALUES ($1,$2,1,$3,$4,$5,$6,
             '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
             'C',$7,
             '{"A":{"role":"distractor"},"B":{"role":"distractor"},"C":{"role":"correct"},"D":{"role":"distractor"}}'::jsonb,
             'published','mcq', now())`,
          [
            id,
            d.section,
            d.domain,
            [`${d.code}.S${i % 2}`],
            (i % 3) + 1,
            `Stem ${id}`,
            `Expl ${id}`,
          ],
        );
      }
    }
    h.pool = new pg.Pool({ ...pgConnConfig(DB), max: 8 });
    svc = await import("../../server/services/landing/landing-service");
    live = (await import("../../server/services/landing/landing-deps"))
      .liveLandingDeps;
  }, 300_000);

  afterAll(async () => {
    await (h.pool as pg.Pool | null)?.end();
    await admin?.end();
  });

  beforeEach(() => {
    sent.length = 0;
    clock = W0_DAY1;
    config = ROUND1;
    qotdToday = true;
    launchTodayPath = "/practice/session/plan-session?from=landing";
  });

  it("P1/P2 one stored arm per window; first open of each Chicago day lands; a new window re-draws", async () => {
    const s = await person();
    const first = await open(s);
    expect(first.show_id).not.toBeNull();
    const [w] = await rows("landing_windows", s.id);
    expect(w?.arm).toBe(first.arm);

    // Same Chicago day, an hour later (a different instant, so a per-instant key cannot pass).
    clock = new Date(W0_DAY1.getTime() + 3_600_000);
    expect(await open(s)).toEqual(svc.NO_LANDING);
    clock = W0_DAY2;
    const day2 = await open(s);
    expect(day2.show_id).not.toBeNull();
    expect(day2.arm).toBe(first.arm); // same window, same arm
    expect((await rows("landing_windows", s.id)).length).toBe(1);
    expect((await rows("landing_shows", s.id)).length).toBe(2);

    clock = W1_DAY1;
    const next = await open(s);
    expect(next.show_id).not.toBeNull();
    expect((await rows("landing_windows", s.id)).length).toBe(2);
    // The stored arm is the deterministic draw for that window.
    const { landingArmFor } =
      await import("../../server/services/landing/assignment");
    expect(next.arm).toBe(
      landingArmFor(s.id, 1, { isPro: false, hasPlan: false }, ROUND1).arm,
    );
  });

  it("P3 eligibility is frozen at the window's first open", async () => {
    const s = await person(); // free at window start
    await open(s);
    const [w] = await rows("landing_windows", s.id);
    expect(w?.eligible_arms).toEqual([
      "dashboard",
      "qotd_then_more",
      "set_math_5",
    ]);
    await entitle(s.id); // Pro mid-window
    // A set the day-1 landing opened would resume on day 2 (ruling B); finish it first.
    await admin.query(
      `UPDATE public.practice_sessions SET status = 'completed', completed_at = now() WHERE user_id = $1`,
      [s.id],
    );
    clock = W0_DAY2;
    const day2 = await open(
      s,
      deps({ loadConfig: async () => only("plan_builder") }),
    );
    // The window keeps its free arm set; plan_builder (now eligible) is never drawn in it.
    expect(day2.arm).toBe(w?.arm);
    expect((await rows("landing_windows", s.id))[0]?.eligible_arms).toEqual(
      w?.eligible_arms,
    );
  });

  it("P4 an in-progress session resumes, and no show is claimed", async () => {
    const s = await person();
    const session = await admin.query<{ id: string }>(
      `INSERT INTO public.practice_sessions (user_id, actor_id, mode, filters, target_count, platform, status)
       VALUES ($1, $1, 'balanced', '{}'::jsonb, 10, 'web', 'active') RETURNING id`,
      [s.id],
    );
    const res = await open(s);
    expect(res).toEqual({
      path: `/practice/session/${session.rows[0]?.id}`,
      show_id: null,
      arm: null,
    });
    expect(await rows("landing_shows", s.id)).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("P5 students only: a guardian and an admin get nothing and no row", async () => {
    for (const role of ["guardian", "admin"] as const) {
      const p = await person({ role, dob: "1980-01-01" });
      expect(await open(p)).toEqual(svc.NO_LANDING);
      expect(await rows("landing_windows", p.id)).toEqual([]);
    }
  });

  it("P6 under 13 and unknown age: nothing and no row", async () => {
    const child = await person({ dob: "2016-01-01" });
    expect(child.isUnder13).toBe(true);
    const unknown = await person({ dob: null });
    for (const p of [child, unknown]) {
      expect(await open(p)).toEqual(svc.NO_LANDING);
      expect(await rows("landing_windows", p.id)).toEqual([]);
    }
    expect(sent).toEqual([]);
  });

  it("P7 kill switch off: nothing and no row; the seeded switch is OFF", async () => {
    const s = await person();
    config = { ...ROUND1, enabled: false };
    expect(await open(s)).toEqual(svc.NO_LANDING);
    expect(await rows("landing_windows", s.id)).toEqual([]);
    const { loadLandingConfig, invalidateLandingConfigCache } =
      await import("../../server/services/landing/landing-config");
    invalidateLandingConfigCache();
    const seeded = await loadLandingConfig();
    expect(seeded).toMatchObject({ enabled: false, salt: "smart-landing-r1" });
    expect(seeded.dashboardShare).toBeCloseTo(1 / 3, 6);
    expect(seeded.weights.calendar_today).toBe(0);
    // 20261114000000_smart_landing_math5.sql: set_math_5 and qotd_then_more at 1, retired gone.
    expect(seeded.weights).toEqual({
      qotd_then_more: 1,
      set_math_5: 1,
      session_today: 1,
      plan_builder: 1,
      calendar_today: 0,
    });
    // And the live open with the seeded config does nothing.
    expect(await open(s, deps({ loadConfig: loadLandingConfig }))).toEqual(
      svc.NO_LANDING,
    );
  });

  it("P8 each arm routes correctly; a set from earlier in the window resumes", async () => {
    const cases: [Arm, { pro?: boolean }, RegExp | null][] = [
      ["dashboard", {}, null],
      ["qotd_then_more", {}, /^\/qotd\?from=landing$/],
      ["set_math_5", {}, /^\/practice\/session\/[0-9a-f-]{36}\?from=landing$/],
      [
        "session_today",
        { pro: true },
        /^\/practice\/session\/plan-session\?from=landing$/,
      ],
      ["plan_builder", { pro: true }, /^\/calendar$/],
    ];
    for (const [arm, who, path] of cases) {
      const s = await person(who);
      config = only(arm);
      // A plan: calendar_current_plan is the generator's output; the eligibility fact stands in.
      const res = await open(
        s,
        arm === "session_today"
          ? deps({ readFacts: async () => ({ isPro: true, hasPlan: true }) })
          : deps(),
      );
      expect(res.arm, arm).toBe(arm);
      if (path === null) expect(res.path, arm).toBeNull();
      else expect(res.path, arm).toMatch(path);
    }
    // Ruling B: the set from day 1 is still open on day 2, so it resumes (no second set).
    const s = await person({ pro: true });
    config = only("set_math_5");
    const day1 = await open(s);
    clock = W0_DAY2;
    const day2 = await open(s);
    expect(day2.show_id).toBeNull();
    expect(day2.path).toBe(day1.path?.replace("?from=landing", ""));
  });

  it("P9 set_math_5: 5 Math items, the first 2 easy/medium, on a Math session", async () => {
    for (let k = 0; k < 6; k += 1) {
      const s = await person(k % 2 === 0 ? {} : { pro: true });
      config = only("set_math_5");
      const path = (await open(s)).path;
      const items = await itemsOf(path);
      expect(items.length).toBe(5);
      expect(items.map((i) => i.section)).toEqual(Array(5).fill("M"));
      expect(
        items.slice(0, 2).every((i) => Number(i.question_difficulty) <= 2),
        JSON.stringify(items),
      ).toBe(true);
      // The session itself names one section, which is what the session page resolves.
      expect(await sessionSection(path)).toEqual({ sections: ["M"] });
    }
  });

  it("P10 a free student with no quota left gets Home, with fallback_reason", async () => {
    const s = await person();
    const done = await admin.query<{ id: string }>(
      `INSERT INTO public.practice_sessions (user_id, actor_id, mode, filters, target_count, platform, status, completed_at)
       VALUES ($1, $1, 'balanced', '{}'::jsonb, 40, 'web', 'completed', now()) RETURNING id`,
      [s.id],
    );
    const qids = (
      await admin.query<{ id: string }>(
        `SELECT id FROM public.questions ORDER BY id LIMIT 40`,
      )
    ).rows;
    for (const [i, q] of qids.entries()) {
      await answered(
        done.rows[0]?.id,
        s.id,
        q.id,
        i + 1,
        new Date().toISOString(),
      );
    }
    config = only("set_math_5");
    const res = await open(s);
    expect(res.path).toBeNull();
    expect(res.arm).toBe("set_math_5");
    expect((await rows("landing_shows", s.id))[0]?.fallback_reason).toBe(
      "quota_exhausted",
    );
    const shown = sent.find((e) => e.event === "landing_shown");
    expect(shown?.properties.fallback_reason).toBe("quota_exhausted");

    // qotd_then_more with no question today falls back too.
    const t = await person();
    config = only("qotd_then_more");
    qotdToday = false;
    expect((await open(t)).path).toBeNull();
    expect((await rows("landing_shows", t.id))[0]?.fallback_reason).toBe(
      "qotd_unavailable",
    );
  });

  it("P11 the events fire with exactly the listed properties", async () => {
    const BASE = [
      "analytics_user_id",
      "event_name",
      "schema_version",
      "timestamp",
    ];
    const s = await person({ pro: true });
    config = only("set_math_5");
    const res = await open(s, deps(), "tablet");
    expect(sent.map((e) => e.event)).toEqual([
      "landing_assigned",
      "landing_shown",
    ]);
    expect(Object.keys(sent[0]!.properties).sort()).toEqual(
      [...BASE, "arm", "device_class", "window_index"].sort(),
    );
    expect(sent[0]!.properties).toMatchObject({
      window_index: 0,
      arm: "set_math_5",
      device_class: "tablet",
    });
    expect(Object.keys(sent[1]!.properties).sort()).toEqual(
      [
        ...BASE,
        "arm",
        "device_class",
        "fallback_reason",
        "window_index",
      ].sort(),
    );
    expect(sent[1]!.properties.fallback_reason).toBeNull();
    // No identity: the analytics id is the derived opaque one, never the profile id.
    expect(JSON.stringify(sent)).not.toContain(s.id);

    sent.length = 0;
    clock = new Date(W0_DAY1.getTime() + 5_000);
    expect(await svc.recordLandingEscape(deps(), s, res.show_id!)).toBe(true);
    expect(sent.map((e) => e.event)).toEqual(["landing_escaped"]);
    expect(Object.keys(sent[0]!.properties).sort()).toEqual(
      [...BASE, "arm", "device_class", "window_index"].sort(),
    );

    // A later day's open is landing_shown only (assigned is once per window).
    sent.length = 0;
    clock = W0_DAY2;
    await admin.query(
      `UPDATE public.practice_sessions SET status = 'completed', completed_at = now() WHERE user_id = $1`,
      [s.id],
    );
    await open(s);
    expect(sent.map((e) => e.event)).toEqual(["landing_shown"]);
  });

  it("P12 escape counts once, within 30 s, by the server's clock; never for dashboard", async () => {
    const s = await person();
    config = only("qotd_then_more");
    const res = await open(s);
    clock = new Date(W0_DAY1.getTime() + 31_000);
    expect(await svc.recordLandingEscape(deps(), s, res.show_id!)).toBe(false);
    clock = new Date(W0_DAY1.getTime() + 29_000);
    expect(await svc.recordLandingEscape(deps(), s, res.show_id!)).toBe(true);
    expect(await svc.recordLandingEscape(deps(), s, res.show_id!)).toBe(false); // once
    // Another student cannot record it.
    const other = await person();
    expect(await svc.recordLandingEscape(deps(), other, res.show_id!)).toBe(
      false,
    );

    const d = await person();
    config = only("dashboard");
    clock = W0_DAY1;
    const home = await open(d);
    clock = new Date(W0_DAY1.getTime() + 2_000);
    expect(await svc.recordLandingEscape(deps(), d, home.show_id!)).toBe(false);
  });

  it("P13 the nightly summary counts answers until the next landing or the day's end, once", async () => {
    const s = await person();
    config = only("dashboard");
    await open(s); // day 1 show at 15:00Z
    clock = W0_DAY2;
    await open(s); // day 2 show at 15:00Z on Oct 27
    const session = await admin.query<{ id: string }>(
      `INSERT INTO public.practice_sessions (user_id, actor_id, mode, filters, target_count, platform, status, completed_at)
       VALUES ($1, $1, 'balanced', '{}'::jsonb, 10, 'web', 'completed', now()) RETURNING id`,
      [s.id],
    );
    const qids = (
      await admin.query<{ id: string }>(
        `SELECT id FROM public.questions ORDER BY id LIMIT 6`,
      )
    ).rows;
    // Day 1 (Oct 26 Chicago): 3 answers after the show, 1 before it; Day 2: 2 answers.
    const at = [
      "2026-10-26T14:00:00Z", // before the day-1 show: not counted
      "2026-10-26T16:00:00Z",
      "2026-10-26T20:00:00Z",
      "2026-10-27T03:00:00Z", // still Oct 26 in Chicago (22:00 CDT)
      "2026-10-27T16:00:00Z", // day 2
      "2026-10-27T18:00:00Z", // day 2
    ];
    for (const [i, q] of qids.entries()) {
      await answered(session.rows[0]?.id, s.id, q.id, i + 1, at[i] ?? "");
    }
    sent.length = 0;
    clock = new Date("2026-10-28T07:00:00Z"); // after Chicago midnight ending Oct 27
    const run = await svc.runLandingSummaries(deps());
    const mine = sent.filter((e) => e.event === "landing_session_summary");
    expect(run.claimed).toBeGreaterThanOrEqual(2);
    // Only this student's two shows are matched by their questions_answered pattern.
    const counts = (
      await admin.query<{ chicago_day: string; summarized_at: Date | null }>(
        `SELECT chicago_day::text, summarized_at FROM public.landing_shows WHERE profile_id = $1 ORDER BY chicago_day`,
        [s.id],
      )
    ).rows;
    expect(counts.every((r) => r.summarized_at !== null)).toBe(true);
    const answeredCounts = mine.map((e) => e.properties.questions_answered);
    expect(answeredCounts).toContain(3);
    expect(answeredCounts).toContain(2);
    expect(Object.keys(mine[0]!.properties).sort()).toEqual([
      "analytics_user_id",
      "arm",
      "device_class",
      "event_name",
      "questions_answered",
      "schema_version",
      "timestamp",
      "window_index",
    ]);
    sent.length = 0;
    const again = await svc.runLandingSummaries(deps());
    expect(again.claimed).toBe(0);
  });

  it("P14 '5 more' only after a qotd_then_more landing: 5 Math items, first 2 easy/medium", async () => {
    const s = await person({ pro: true });
    config = only("set_math_5");
    await open(s);
    expect(await svc.startLandingMore(deps(), s, `ci-${s.id}`)).toEqual({
      path: null,
    });

    const q = await person({ pro: true });
    config = only("qotd_then_more");
    await open(q);
    const more = await svc.startLandingMore(deps(), q, `ci-${q.id}`);
    const items = await itemsOf(more.path);
    expect(items.length).toBe(5);
    expect(items.map((i) => i.section)).toEqual(Array(5).fill("M"));
    expect(
      items.slice(0, 2).every((i) => Number(i.question_difficulty) <= 2),
    ).toBe(true);
    expect(await sessionSection(more.path)).toEqual({ sections: ["M"] });
    // Replayed, not doubled.
    expect((await svc.startLandingMore(deps(), q, `ci-${q.id}`)).path).toBe(
      more.path,
    );
  });

  it("P15 deleting the profile removes its windows and shows", async () => {
    const s = await person();
    await open(s);
    expect((await rows("landing_shows", s.id)).length).toBe(1);
    await admin.query(`DELETE FROM public.profiles WHERE id = $1`, [s.id]);
    expect(await rows("landing_windows", s.id)).toEqual([]);
    expect(await rows("landing_shows", s.id)).toEqual([]);
  });

  it("P16 grants: anon and authenticated have nothing; service_role runs the claim", async () => {
    const tables = await admin.query(
      `SELECT t, r, has_table_privilege(r, 'public.' || t, 'SELECT') AS sel,
              has_table_privilege(r, 'public.' || t, 'INSERT') AS ins
         FROM unnest(ARRAY['landing_windows','landing_shows']) t,
              unnest(ARRAY['anon','authenticated','service_role']) r
        ORDER BY t, r`,
    );
    expect(tables.rows).toEqual([
      { t: "landing_shows", r: "anon", sel: false, ins: false },
      { t: "landing_shows", r: "authenticated", sel: false, ins: false },
      { t: "landing_shows", r: "service_role", sel: true, ins: true },
      { t: "landing_windows", r: "anon", sel: false, ins: false },
      { t: "landing_windows", r: "authenticated", sel: false, ins: false },
      { t: "landing_windows", r: "service_role", sel: true, ins: true },
    ]);
    const fns = [
      "landing_claim_open(uuid, integer, text, text[], text, timestamptz)",
      "landing_record_escape(uuid, uuid, timestamptz, integer)",
      "landing_claim_summaries(timestamptz, integer)",
    ];
    const exec = await admin.query(
      `SELECT has_function_privilege('anon', ('public.' || f)::regprocedure, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'EXECUTE') AS authd,
              has_function_privilege('service_role', ('public.' || f)::regprocedure, 'EXECUTE') AS svc
         FROM unnest($1::text[]) f`,
      [fns],
    );
    expect(exec.rows).toEqual(
      fns.map(() => ({ anon: false, authd: false, svc: true })),
    );
    // As the probe: the real claim runs; RLS is on with no policies for clients.
    const s = await person();
    await admin.query(`SET ROLE ${PROBE}`);
    try {
      const r = await admin.query(
        `SELECT * FROM public.landing_claim_open($1, 0, 'dashboard', ARRAY['dashboard'], 'desktop', $2)`,
        [s.id, W0_DAY1.toISOString()],
      );
      expect(r.rows.length).toBe(1);
    } finally {
      await admin.query("RESET ROLE");
    }
    const rls = await admin.query(
      `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('landing_windows','landing_shows') ORDER BY relname`,
    );
    expect(rls.rows).toEqual([
      { relname: "landing_shows", relrowsecurity: true },
      { relname: "landing_windows", relrowsecurity: true },
    ]);
  });

  it("P17 session_today re-checks the entitlement at launch", async () => {
    const s = await person(); // not entitled
    const out = await live.launchToday({
      caller: s,
      clientInstanceId: "c",
      now: W0_DAY1,
    });
    expect(out).toEqual({ ok: false, reason: "not_entitled" });
  });

  it("P18 a window stored with a retired arm shows Home (arm_retired) and builds no set", async () => {
    const s = await person();
    // As production holds it: a window assigned before set_math_5 replaced the multi-section sets.
    await admin.query(
      `INSERT INTO public.landing_windows (profile_id, window_index, arm, eligible_arms, assigned_at, device_class)
       VALUES ($1, 0, 'set_mixed', ARRAY['dashboard','qotd_then_more','set_mixed','set_math_first'], $2, 'desktop')`,
      [s.id, W0_DAY1.toISOString()],
    );
    config = ROUND1;
    const res = await open(s);
    expect(res.path).toBeNull();
    expect(res.arm).toBe("set_mixed");
    expect(res.show_id).not.toBeNull();
    expect((await rows("landing_shows", s.id))[0]?.fallback_reason).toBe(
      "arm_retired",
    );
    const sessions = await admin.query(
      `SELECT id FROM public.practice_sessions WHERE user_id = $1`,
      [s.id],
    );
    expect(sessions.rows).toEqual([]);
    // The event is sent (the registry still admits the stored name) and says why.
    const shown = sent.find((e) => e.event === "landing_shown");
    expect(shown?.properties).toMatchObject({
      arm: "set_mixed",
      fallback_reason: "arm_retired",
    });
  });
});
