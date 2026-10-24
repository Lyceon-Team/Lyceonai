/**
 * Calendar read — golden equivalence over a fixture that can disprove it.
 *
 * @spec [owner ruling (Karl) 2026-10-13 on #1232: "the calendar read's ~58 round trips. Plan the
 *        Doc 05F §9.1 adapter change ... target under 10 round trips, same byte-identical response
 *        proof"; Doc-05F_V1.0 §8.2 (a date is read in its OWN plan zone), §9.1 (adapter contract,
 *        as amended by SCL-233), §13 (allocator), §14 (derived state), §15 (GET /api/calendar),
 *        §16 (guardian view model), INV-08-21, INV-08-23] | @implemented [2026-10-15]
 *
 * plain English: seeds one student's plan and engine activity BY HAND, at fixed dates, then runs
 * the three readers that share `assembleRange` — the student read, the guardian read and the
 * accountability read — at a fixed `now`, and pins each payload to a JSON file. The files were
 * RECORDED ON origin/cleanup's source (d605204d's tree, before the §9.1 fold) and this branch must
 * reproduce them byte for byte.
 *
 * WHY THIS FIXTURE AND NOT THE HOT-PATH ONE. The hot-path calendar read is one Chicago plan with
 * no activity, no launches and today's date in it: a fold that dropped an engine, shifted a day
 * boundary or attributed a unit to the wrong zone would pass it. This fixture is shaped so each
 * of those can show:
 *   - THREE ZONES IN ONE WINDOW. v1 plans in America/Chicago, v2 in Asia/Tokyo, v3 in
 *     America/Los_Angeles. Chicago's 09-15 and Tokyo's 09-16 OVERLAP by fourteen hours, so one
 *     item counts on BOTH days, as the per-day reads always made it; Tokyo's 09-20 and LA's 09-21
 *     leave a GAP, so an item there counts on NEITHER. A single-range fold that forgets either
 *     reddens this file.
 *   - BOUNDARY INSTANTS. An item exactly at a day's start (inclusive) and one a microsecond before
 *     it (the previous day): an off-by-one in a half-open window moves a unit between days.
 *   - EVERY ENGINE. Practice, review and full-length blocks and activity, so a dropped engine
 *     empties a block. Skipped items in both item tables, which must stay out (INV-08-23).
 *   - LAUNCHES WITH EVERY LIFECYCLE. Completed, abandoned and active practice sessions, an active
 *     review session (`in_progress`), a completed full-length sitting launched from its block, and
 *     a work-ahead session launched from a FUTURE block (R-08-34), so a lifecycle read that is
 *     wrong, or missing, changes a status.
 *   - EMPTY AND UNOWNED DAYS. Rest days with and without activity, a blocked-out override day, and
 *     dates no version owns (they fall back to the profile's zone and mask). A second window with
 *     no blocks at all takes the "practice only" engine default.
 *   - GUARDIAN-VISIBLE STATE. The guardian view model over the same assembly.
 *
 * Round trips are counted through the hot-path harness's transport, and the budget is asserted
 * here so a fan-out cannot come back unnoticed.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { PG_AVAILABLE } from "../helpers/pg-supabase";
import {
  bootHarness,
  harness,
  sequentialDepth,
  shutdownHarness,
} from "../perf/hot-paths.harness";

vi.mock("../../apps/api/src/lib/supabase-server", async () => {
  const h = await import("../perf/hot-paths.harness");
  return { supabaseServer: h.transportProxy() };
});
vi.mock("../../apps/api/src/lib/supabase-admin", async () => {
  const h = await import("../perf/hot-paths.harness");
  return { getSupabaseAdmin: () => h.transport() };
});

const S = "c0c0c0c0-0000-4000-8000-000000000001";
const V1 = "c0c0c0c0-0000-4000-8001-000000000001";
const V2 = "c0c0c0c0-0000-4000-8001-000000000002";
const V3 = "c0c0c0c0-0000-4000-8001-000000000003";
const FORM = "c0c0c0c0-0000-4000-8002-000000000001";

/** Blocks, by the day they sit on. */
const B = {
  alg14: "c0c0c0c0-0000-4000-8003-000000000001",
  mix14: "c0c0c0c0-0000-4000-8003-000000000002",
  rev14: "c0c0c0c0-0000-4000-8003-000000000003",
  rw15: "c0c0c0c0-0000-4000-8003-000000000004",
  alg16v1: "c0c0c0c0-0000-4000-8003-000000000005",
  alg16: "c0c0c0c0-0000-4000-8003-000000000006",
  fl17: "c0c0c0c0-0000-4000-8003-000000000007",
  rev18: "c0c0c0c0-0000-4000-8003-000000000008",
  crs19: "c0c0c0c0-0000-4000-8003-000000000009",
  m20: "c0c0c0c0-0000-4000-8003-00000000000a",
  alg21: "c0c0c0c0-0000-4000-8003-00000000000b",
  rev23: "c0c0c0c0-0000-4000-8003-00000000000c",
  rev15: "c0c0c0c0-0000-4000-8003-00000000000d",
  rw23: "c0c0c0c0-0000-4000-8003-00000000000e",
} as const;

/** Engine sessions. */
const P = {
  // practice: completed (launched from rw15, seq 1), abandoned (rw15, seq 2), active (crs19),
  // completed work-ahead (m20, launched on 09-19), and one unlinked free-practice session.
  rwDone: "c0c0c0c0-0000-4000-8004-000000000001",
  rwAbandoned: "c0c0c0c0-0000-4000-8004-000000000002",
  crsActive: "c0c0c0c0-0000-4000-8004-000000000003",
  ahead: "c0c0c0c0-0000-4000-8004-000000000004",
  free: "c0c0c0c0-0000-4000-8004-000000000005",
  // review: active (rev18), and one unlinked completed session.
  revActive: "c0c0c0c0-0000-4000-8004-000000000006",
  revFree: "c0c0c0c0-0000-4000-8004-000000000007",
  // full-length: completed sitting launched from fl17.
  exam: "c0c0c0c0-0000-4000-8004-000000000008",
} as const;

/** Saturday 2026-09-19, 12:00 in Chicago. The student's today is 2026-09-19. */
const NOW = new Date("2026-09-19T17:00:00.000Z");

function q(sql: string, params: unknown[] = []): Promise<unknown> {
  if (!harness.setup) throw new Error("harness not booted");
  return harness.setup.query(sql, params);
}

const DOMAIN_SCOPE = (mix: Array<[string, number]>): string =>
  JSON.stringify({
    level: "domain",
    mix: mix.map(([domain, count]) => ({
      domain,
      count,
      explanation_key: "weak",
    })),
  });
const SECTION_SCOPE = (count: number): string =>
  JSON.stringify({ level: "section", count, explanation_key: "cold_start" });

async function seedFixture(): Promise<void> {
  await q(
    `INSERT INTO auth.users (id, email) VALUES ($1, 'cal-golden@example.test')`,
    [S],
  );
  await q(
    `INSERT INTO public.profiles (id, email, role) VALUES ($1, 'cal-golden@example.test', 'student')`,
    [S],
  );
  await q(
    `INSERT INTO public.student_study_profile
       (student_id, timezone, target_exam_date, target_score, study_days_mask, daily_minutes,
        full_length_weekday, full_length_interval_weeks, setup_completed_at,
        last_acknowledged_nonstudent_version_no)
     VALUES ($1, 'America/Chicago', '2026-11-07', 1400, 62, 60, 6, 2,
             '2026-09-10T12:00:00Z', 1)`,
    [S],
  );

  // ── Versions ──────────────────────────────────────────────────────────────
  const version = (
    id: string,
    no: number,
    trigger: string,
    initiatedBy: string,
    snapshot: unknown,
    createdAt: string,
  ): Promise<unknown> =>
    q(
      `INSERT INTO public.calendar_plan_versions
         (plan_version_id, student_id, version_no, generator_version, trigger, initiated_by,
          input_snapshot, input_snapshot_hash, constants_snapshot, validator_result, created_at)
       VALUES ($1, $2, $3, 'v1', $4, $5, $6::jsonb, 'h', '{}', 'accepted', $7)`,
      [id, S, no, trigger, initiatedBy, JSON.stringify(snapshot), createdAt],
    );
  await version(
    V1,
    1,
    "setup",
    "student",
    { profile: { study_days_mask: 62 } },
    "2026-09-10T12:00:00Z",
  );
  await version(
    V2,
    2,
    "weekly",
    "system",
    {
      profile: { study_days_mask: 127 },
      degraded: [
        "mastery",
        { kind: "full_length_suppressed", date: "2026-09-27" },
        { kind: "full_length_suppressed", date: "2026-09-26" },
      ],
    },
    "2026-09-16T12:00:00Z",
  );
  await version(
    V3,
    3,
    "day_edit",
    "student",
    { profile: { study_days_mask: 31 } },
    "2026-09-18T12:00:00Z",
  );

  const date = (
    v: string,
    d: string,
    tz: string,
    override = false,
  ): Promise<unknown> =>
    q(
      `INSERT INTO public.calendar_plan_dates
         (plan_version_id, student_id, scheduled_date, timezone, is_user_override)
       VALUES ($1, $2, $3, $4, $5)`,
      [v, S, d, tz, override],
    );
  // v1: 09-12..09-16 in Chicago (09-16 is then re-owned by v2).
  for (const d of [
    "2026-09-12",
    "2026-09-13",
    "2026-09-14",
    "2026-09-15",
    "2026-09-16",
  ])
    await date(V1, d, "America/Chicago");
  // v2: 09-16..09-20 in Tokyo. Chicago 09-15 and Tokyo 09-16 overlap by 14 hours.
  for (const d of [
    "2026-09-16",
    "2026-09-17",
    "2026-09-18",
    "2026-09-19",
    "2026-09-20",
  ])
    await date(V2, d, "Asia/Tokyo");
  // v3: 09-21..09-23 in Los Angeles; 09-22 is a blocked-out override day. Tokyo 09-20 ends at
  // 09-20T15:00Z and LA 09-21 starts at 09-21T07:00Z: a sixteen-hour gap.
  await date(V3, "2026-09-21", "America/Los_Angeles");
  await date(V3, "2026-09-22", "America/Los_Angeles", true);
  await date(V3, "2026-09-23", "America/Los_Angeles");

  // ── Blocks and memberships ────────────────────────────────────────────────
  const block = async (
    id: string,
    v: string,
    d: string,
    type: string,
    section: string | null,
    scope: string,
    target: number,
    ordinal: number,
    key: string,
  ): Promise<void> => {
    await q(
      `INSERT INTO public.calendar_blocks
         (block_id, student_id, created_in_version_id, scheduled_date, block_type, section,
          scope, target_count, source, explanation_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'auto', $9)`,
      [id, S, v, d, type, section, scope, target, key],
    );
    await q(
      `INSERT INTO public.calendar_plan_block_memberships
         (plan_version_id, student_id, scheduled_date, block_id, display_ordinal, membership_type)
       VALUES ($1, $2, $3, $4, $5, 'created')`,
      [v, S, d, id, ordinal],
    );
  };
  const REVIEW = JSON.stringify({ mode: "queue" });
  const FULL = JSON.stringify({ form_id: null, exam_mode: "strict" });
  await block(
    B.alg14,
    V1,
    "2026-09-14",
    "practice",
    "M",
    DOMAIN_SCOPE([["Algebra", 4]]),
    4,
    1,
    "weighted",
  );
  await block(
    B.mix14,
    V1,
    "2026-09-14",
    "practice",
    "M",
    DOMAIN_SCOPE([
      ["Algebra", 2],
      ["Advanced Math", 2],
    ]),
    4,
    2,
    "weighted",
  );
  await block(
    B.rev14,
    V1,
    "2026-09-14",
    "review",
    null,
    REVIEW,
    3,
    3,
    "review_due",
  );
  await block(
    B.rw15,
    V1,
    "2026-09-15",
    "practice",
    "RW",
    SECTION_SCOPE(3),
    3,
    1,
    "cold_start",
  );
  // A past review block with no review activity on its day: `missed`.
  await block(
    B.rev15,
    V1,
    "2026-09-15",
    "review",
    null,
    REVIEW,
    2,
    2,
    "review_due",
  );
  await block(
    B.alg16v1,
    V1,
    "2026-09-16",
    "practice",
    "M",
    DOMAIN_SCOPE([["Algebra", 3]]),
    3,
    1,
    "weighted",
  );
  await block(
    B.alg16,
    V2,
    "2026-09-16",
    "practice",
    "M",
    DOMAIN_SCOPE([["Algebra", 3]]),
    3,
    1,
    "weighted",
  );
  await block(
    B.fl17,
    V2,
    "2026-09-17",
    "full_length",
    null,
    FULL,
    1,
    1,
    "exam_cadence",
  );
  await block(
    B.rev18,
    V2,
    "2026-09-18",
    "review",
    null,
    REVIEW,
    2,
    1,
    "review_due",
  );
  await block(
    B.crs19,
    V2,
    "2026-09-19",
    "practice",
    "RW",
    DOMAIN_SCOPE([["Craft and Structure", 2]]),
    2,
    1,
    "weighted",
  );
  await block(
    B.m20,
    V2,
    "2026-09-20",
    "practice",
    "M",
    SECTION_SCOPE(2),
    2,
    1,
    "cold_start",
  );
  await block(
    B.alg21,
    V3,
    "2026-09-21",
    "practice",
    "M",
    DOMAIN_SCOPE([["Algebra", 2]]),
    2,
    1,
    "weighted",
  );
  // A future block with no activity: `scheduled`.
  await block(
    B.rw23,
    V3,
    "2026-09-23",
    "practice",
    "RW",
    SECTION_SCOPE(2),
    2,
    2,
    "cold_start",
  );
  await block(
    B.rev23,
    V3,
    "2026-09-23",
    "review",
    null,
    REVIEW,
    2,
    1,
    "review_due",
  );

  // ── Engine sessions ───────────────────────────────────────────────────────
  const practiceSession = (
    id: string,
    status: string,
    section: string,
  ): Promise<unknown> =>
    q(
      `INSERT INTO public.practice_sessions
         (id, user_id, actor_id, mode, target_count, platform, status, filters,
          completed_at, abandoned_at)
       VALUES ($1, $2, $2, 'structured', 3, 'web', $3::text,
               jsonb_build_object('sections', jsonb_build_array($4::text)),
               CASE WHEN $3::text = 'completed' THEN '2026-09-15T20:00:00Z'::timestamptz END,
               CASE WHEN $3::text = 'abandoned' THEN '2026-09-15T20:00:00Z'::timestamptz END)`,
      [id, S, status, section],
    );
  await practiceSession(P.rwDone, "completed", "RW");
  await practiceSession(P.rwAbandoned, "abandoned", "RW");
  await practiceSession(P.crsActive, "active", "RW");
  await practiceSession(P.ahead, "completed", "M");
  await practiceSession(P.free, "completed", "M");

  const reviewSession = (id: string, status: string): Promise<unknown> =>
    q(
      `INSERT INTO public.review_sessions
         (id, student_id, actor_id, mode, target_count, platform, status, completed_at)
       VALUES ($1, $2, $2, 'queue', 3, 'web', $3::text,
               CASE WHEN $3::text = 'completed' THEN '2026-09-14T20:00:00Z'::timestamptz END)`,
      [id, S, status],
    );
  await reviewSession(P.revActive, "active");
  await reviewSession(P.revFree, "completed");

  await q(
    `INSERT INTO public.test_forms
       (id, name, test_kind, status, score_table_version, routing_threshold_rw,
        routing_threshold_m, break_duration_ms, rw_module1_ms, rw_module2_ms, m_module1_ms,
        m_module2_ms)
     VALUES ($1, 'Golden form', 'full_length', 'draft', 'v1.0', 10, 10, 600000, 1920000,
             1920000, 2100000, 2100000)`,
    [FORM],
  );
  await q(
    `INSERT INTO public.test_sessions
       (id, student_id, actor_id, test_form_id, state, mode, grace_expires_at,
        attempt_number_for_form, is_first_seen_form_attempt, completed_at)
     VALUES ($1, $2, $2, $3, 'completed', 'strict', '2026-09-17T09:00:00Z', 1, true,
             '2026-09-17T06:00:00Z')`,
    [P.exam, S, FORM],
  );
  // A second completed sitting, unlinked, on Chicago 09-11 (an unowned date): extra work in the
  // second window only if full-length were asked there (it is not: that window has no blocks).
  await q(
    `INSERT INTO public.test_sessions
       (id, student_id, actor_id, test_form_id, state, mode, grace_expires_at,
        attempt_number_for_form, is_first_seen_form_attempt, completed_at)
     VALUES (gen_random_uuid(), $1, $1, $2, 'completed', 'strict', '2026-09-11T23:00:00Z', 2,
             false, '2026-09-11T20:00:00Z')`,
    [S, FORM],
  );

  // ── Launch rows ───────────────────────────────────────────────────────────
  const launch = (
    blockId: string,
    seq: number,
    engine: string,
    sid: string,
  ): Promise<unknown> =>
    q(
      `INSERT INTO public.calendar_block_launches
         (block_id, student_id, launch_sequence, engine, engine_session_id, launched_at)
       VALUES ($1, $2, $3, $4, $5, '2026-09-15T12:00:00Z')`,
      [blockId, S, seq, engine, sid],
    );
  await launch(B.rw15, 1, "practice", P.rwDone);
  await launch(B.rw15, 2, "practice", P.rwAbandoned);
  await launch(B.crs19, 1, "practice", P.crsActive);
  await launch(B.m20, 1, "practice", P.ahead);
  await launch(B.rev18, 1, "review", P.revActive);
  await launch(B.fl17, 1, "full_length", P.exam);

  // ── Activity ──────────────────────────────────────────────────────────────
  // [session, question id, section, domain, status, occurred_at]
  type Item = [
    string,
    string,
    "M" | "RW",
    string,
    "answered" | "skipped",
    string,
  ];
  const practiceItems: Item[] = [
    // Chicago 09-12 (a Saturday, a rest day under mask 62): extra work on a rest day.
    [P.free, "SATM1ALG000", "M", "Algebra", "answered", "2026-09-12T15:00:00Z"],
    // One microsecond before Chicago 09-14 begins: Chicago 09-13 (rest day, extra work).
    [
      P.free,
      "SATM1ALG001",
      "M",
      "Algebra",
      "answered",
      "2026-09-14T04:59:59.999999Z",
    ],
    // EXACTLY at Chicago 09-14's start: 09-14 (the window is inclusive at its start).
    [P.free, "SATM1ALG002", "M", "Algebra", "answered", "2026-09-14T05:00:00Z"],
    [P.free, "SATM1ALG003", "M", "Algebra", "answered", "2026-09-14T14:00:00Z"],
    [P.free, "SATM1ALG004", "M", "Algebra", "answered", "2026-09-14T14:01:00Z"],
    [P.free, "SATM1ALG005", "M", "Algebra", "answered", "2026-09-14T14:02:00Z"],
    [P.free, "SATM1ALG006", "M", "Algebra", "answered", "2026-09-14T14:03:00Z"],
    [
      P.free,
      "SATM1ADV000",
      "M",
      "Advanced Math",
      "answered",
      "2026-09-14T14:04:00Z",
    ],
    // A skip on 09-14: never a unit (INV-08-23).
    [P.free, "SATM1ALG007", "M", "Algebra", "skipped", "2026-09-14T14:05:00Z"],
    // A Reading & Writing item on 09-14 that no block there matches: extra work.
    [
      P.free,
      "SATRW1INF000",
      "RW",
      "Information and Ideas",
      "answered",
      "2026-09-14T14:06:00Z",
    ],
    // Launched from rw15 (completed session): three units on Chicago 09-15.
    [
      P.rwDone,
      "SATRW1CRS000",
      "RW",
      "Craft and Structure",
      "answered",
      "2026-09-15T13:00:00Z",
    ],
    [
      P.rwDone,
      "SATRW1CRS001",
      "RW",
      "Craft and Structure",
      "answered",
      "2026-09-15T13:01:00Z",
    ],
    // THE OVERLAP: Chicago 09-15 AND Tokyo 09-16 both contain 09-15T20:00Z.
    [
      P.rwDone,
      "SATRW1CRS002",
      "RW",
      "Craft and Structure",
      "answered",
      "2026-09-15T20:00:00Z",
    ],
    // The abandoned second launch of rw15 left one answered item, in the overlap too.
    [
      P.rwAbandoned,
      "SATRW1INF001",
      "RW",
      "Information and Ideas",
      "answered",
      "2026-09-15T21:00:00Z",
    ],
    // Free Algebra in the overlap: counts toward BOTH Chicago 09-15 (extra) and Tokyo 09-16.
    [P.free, "SATM1ALG008", "M", "Algebra", "answered", "2026-09-15T22:00:00Z"],
    // Tokyo 09-16 only (after Chicago 09-15 ended at 09-16T05:00Z).
    [P.free, "SATM1ALG009", "M", "Algebra", "answered", "2026-09-16T06:00:00Z"],
    // One microsecond before Tokyo 09-17 begins (09-16T15:00Z): Tokyo 09-16.
    [
      P.free,
      "SATM1ADV001",
      "M",
      "Advanced Math",
      "answered",
      "2026-09-16T14:59:59.999999Z",
    ],
    // crs19 (active session): one answered, one skipped, on Tokyo 09-19.
    [
      P.crsActive,
      "SATRW1CRS003",
      "RW",
      "Craft and Structure",
      "answered",
      "2026-09-19T01:00:00Z",
    ],
    [
      P.crsActive,
      "SATRW1CRS004",
      "RW",
      "Craft and Structure",
      "skipped",
      "2026-09-19T01:01:00Z",
    ],
    // Work ahead: launched from m20 (Tokyo 09-20), done on Tokyo 09-19. Counts on 09-20.
    [
      P.ahead,
      "SATM1ADV002",
      "M",
      "Advanced Math",
      "answered",
      "2026-09-19T02:00:00Z",
    ],
    [
      P.ahead,
      "SATM1ADV003",
      "M",
      "Advanced Math",
      "answered",
      "2026-09-19T02:01:00Z",
    ],
    [
      P.ahead,
      "SATM1ADV004",
      "M",
      "Advanced Math",
      "answered",
      "2026-09-19T02:02:00Z",
    ],
    // THE GAP: after Tokyo 09-20 ends (09-20T15:00Z), before LA 09-21 starts (09-21T07:00Z).
    [P.free, "SATM1ALG001", "M", "Algebra", "answered", "2026-09-20T20:00:00Z"],
    // LA 09-21: one Algebra unit, exactly at its start.
    [P.free, "SATM1ALG002", "M", "Algebra", "answered", "2026-09-21T07:00:00Z"],
    // LA 09-22 (blocked-out override day): extra work.
    [P.free, "SATM1ALG003", "M", "Algebra", "answered", "2026-09-22T18:00:00Z"],
    // Chicago 09-11 (unowned; second window only).
    [
      P.free,
      "SATRW1INF002",
      "RW",
      "Information and Ideas",
      "answered",
      "2026-09-11T15:00:00Z",
    ],
    // Chicago 09-10 (unowned): a skip, never a unit.
    [
      P.free,
      "SATRW1INF003",
      "RW",
      "Information and Ideas",
      "skipped",
      "2026-09-10T15:00:00Z",
    ],
  ];
  for (const [
    index,
    [sid, qid, section, domain, status, at],
  ] of practiceItems.entries()) {
    await q(
      `INSERT INTO public.practice_session_items
         (session_id, user_id, actor_id, ordinal, question_id, question_stem, question_options,
          question_correct_answer, question_explanation, question_domain, question_skill,
          question_difficulty, question_section, status, occurred_at, answered_at)
       VALUES ($1, $2, $2, $3, $4, 'stem', '[]'::jsonb, 'A', 'e', $5, 'S', 1, $6, $7, $8, $8)`,
      [sid, S, index + 1, qid, domain, section, status, at],
    );
  }

  const reviewItems: Item[] = [
    // Two review units on Chicago 09-14, one skip.
    [
      P.revFree,
      "SATM1ALG000",
      "M",
      "Algebra",
      "answered",
      "2026-09-14T16:00:00Z",
    ],
    [
      P.revFree,
      "SATRW1CRS000",
      "RW",
      "Craft and Structure",
      "answered",
      "2026-09-14T16:01:00Z",
    ],
    [
      P.revFree,
      "SATM1ALG001",
      "M",
      "Algebra",
      "skipped",
      "2026-09-14T16:02:00Z",
    ],
    // Tokyo 09-17, a full-length day: review extra work. (Tokyo 09-18's review block has only
    // the active session's served item, so it reads `in_progress`.)
    [
      P.revFree,
      "SATRW1INF000",
      "RW",
      "Information and Ideas",
      "answered",
      "2026-09-17T03:00:00Z",
    ],
    // LA 09-23: one unit, exactly a microsecond before LA 09-24 would begin, so the review block
    // there is partial (1 of 2).
    [
      P.revFree,
      "SATM1ADV000",
      "M",
      "Advanced Math",
      "answered",
      "2026-09-24T06:59:59.999999Z",
    ],
  ];
  for (const [
    index,
    [sid, qid, section, domain, status, at],
  ] of reviewItems.entries()) {
    await q(
      `INSERT INTO public.review_session_items
         (session_id, student_id, actor_id, ordinal, question_id, question_stem, question_options,
          question_correct_answer, question_explanation, question_domain, question_skill,
          question_difficulty, question_section, status, occurred_at, answered_at)
       VALUES ($1, $2, $2, $3, $4, 'stem', '[]'::jsonb, 'A', 'e', $5, 'S', 1, $6, $7, $8, $8)`,
      [sid, S, index + 1, qid, domain, section, status, at],
    );
  }
  // The active review session's one served (unresolved) item: no unit.
  await q(
    `INSERT INTO public.review_session_items
       (session_id, student_id, actor_id, ordinal, question_id, question_stem, question_options,
        question_correct_answer, question_explanation, question_domain, question_skill,
        question_difficulty, question_section, status)
     VALUES ($1, $2, $2, 1, 'SATM1ALG004', 'stem', '[]'::jsonb, 'A', 'e', 'Algebra', 'S', 1,
             'M', 'served')`,
    [P.revActive, S],
  );
}

function goldenJson(record: unknown): string {
  return JSON.stringify(record, null, 2) + "\n";
}

/** Round trips one call makes through the counted transport. */
async function counted<T>(fn: () => Promise<T>): Promise<{
  value: T;
  roundTrips: number;
  byTarget: Record<string, number>;
}> {
  const before = harness.roundTrips;
  const beforeByTarget = new Map(harness.calls);
  const value = await fn();
  const byTarget: Record<string, number> = {};
  for (const [target, calls] of harness.calls) {
    const delta = calls - (beforeByTarget.get(target) ?? 0);
    if (delta > 0) byTarget[target] = delta;
  }
  return { value, roundTrips: harness.roundTrips - before, byTarget };
}

/**
 * The engine reads one service-level student read makes over this fixture (SCL-233): ONE
 * activity read per engine in the window and ONE lifecycle read per engine with a launched
 * session — not one per day, not one per launched block. `test_sessions` serves both halves for
 * full-length, so it is read twice. Before the fold this fixture made 42 activity reads and 5
 * lifecycle reads here (61 round trips in all); after it, 20.
 *
 * WARM, since 2026-10-15 (owner ruling on #1238 item (b)): the two config reads are cached for
 * 60 s, so the counted read is the second of two and makes 18 — the 20 above less the two config
 * reads. The first (cold) read makes 21: the 20 plus the cache's own lifetime row
 * (`caching_runtime_config`), read alongside the load on a miss.
 */
const ENGINE_READS = {
  practice_session_items: 1,
  review_session_items: 1,
  test_sessions: 2,
  practice_sessions: 1,
  review_sessions: 1,
} as const;
const STUDENT_READ_ROUND_TRIPS = 18;
const COLD_CONFIG_ROUND_TRIPS = 3;
const STUDENT_READ_DEPTH = 5;

describe.skipIf(!PG_AVAILABLE)(
  "calendar read: golden equivalence over a three-zone, three-engine fixture (real PG)",
  () => {
    beforeAll(async () => {
      await bootHarness("calendar_read_golden_ci");
      await seedFixture();
    }, 240_000);

    afterAll(async () => {
      await shutdownHarness();
    });

    it("student read, 09-10..09-23: every day shape, pinned byte for byte", async () => {
      const { readCalendar } =
        await import("../../server/services/calendar/read-service");
      const { invalidateCalendarConfigCache } =
        await import("../../server/services/calendar/config");
      // A cold read first, so the counted read below is the steady state (config cached).
      invalidateCalendarConfigCache();
      harness.latencyMs = 10;
      const coldIntervalsFrom = harness.intervals.length;
      const cold = await counted(() =>
        readCalendar({
          student_id: S,
          query: {
            from: "2026-09-10",
            to: "2026-09-23",
            device_timezone: "America/New_York",
          },
          now: NOW,
        }),
      ).finally(() => {
        harness.latencyMs = 0;
      });
      // Cold, the two config reads (and the cache's lifetime row) run TOGETHER and alongside the
      // probe/streak/diagnostic/projection wave, so a cold read is no deeper than a warm one.
      expect(sequentialDepth(harness.intervals.slice(coldIntervalsFrom))).toBe(
        STUDENT_READ_DEPTH,
      );
      expect(
        (cold.byTarget.calendar_runtime_config ?? 0) +
          (cold.byTarget.practice_runtime_config ?? 0) +
          (cold.byTarget.caching_runtime_config ?? 0),
      ).toBe(COLD_CONFIG_ROUND_TRIPS);
      // The warm read runs with 10 ms per round trip so its dependency depth can be measured.
      harness.latencyMs = 10;
      const intervalsFrom = harness.intervals.length;
      const {
        value: result,
        roundTrips,
        byTarget,
      } = await counted(() =>
        readCalendar({
          student_id: S,
          query: {
            from: "2026-09-10",
            to: "2026-09-23",
            device_timezone: "America/New_York",
          },
          now: NOW,
        }),
      ).finally(() => {
        harness.latencyMs = 0;
      });
      const depth = sequentialDepth(harness.intervals.slice(intervalsFrom));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const body = result.value;
      // Presence before absence: a ready payload with blocks on several days, progress, extra
      // work and an in-progress block, so the pinned file is not a vacuous empty plan.
      expect(body.status).toBe("ready");
      if (body.status !== "ready") return;
      expect(body.days).toHaveLength(14);
      const statuses = body.days.flatMap((d) => d.blocks.map((b) => b.status));
      expect(new Set(statuses)).toEqual(
        new Set(["completed", "partial", "in_progress", "missed", "scheduled"]),
      );
      expect(body.days.some((d) => d.extra_work.length > 0)).toBe(true);
      // The round-trip budget (owner ruling on #1232; SCL-233). Every engine-owned table, one
      // by one, then the total, so a fan-out that returns on any of them is named.
      for (const [target, calls] of Object.entries(ENGINE_READS)) {
        expect({ target, calls: byTarget[target] ?? 0 }).toEqual({
          target,
          calls,
        });
      }
      expect(roundTrips).toBe(STUDENT_READ_ROUND_TRIPS);
      // Dependency depth (owner ruling 2026-10-15 on #1238). This service-level call reads the
      // profile itself (the route hands it in): profile; then probe, streak (its two reads
      // together), diagnostic and projection in one wave, config cached; then the plan; then
      // blocks, launch rows and snapshots; then activity alongside the lifecycle reads. Was 8.
      expect(depth).toBe(STUDENT_READ_DEPTH);
      expect(cold.roundTrips).toBe(
        STUDENT_READ_ROUND_TRIPS + COLD_CONFIG_ROUND_TRIPS,
      );
      // The cold and warm reads answer identically: the cache changes waiting, never bytes.
      expect(JSON.stringify(cold.value)).toBe(JSON.stringify(result));
      await expect(goldenJson(body)).toMatchFileSnapshot(
        "./__golden__/calendar-read.student.json",
      );
    });

    it("student read, 09-01..09-11: no blocks anywhere (the practice-only default)", async () => {
      const { readCalendar } =
        await import("../../server/services/calendar/read-service");
      const result = await readCalendar({
        student_id: S,
        query: { from: "2026-09-01", to: "2026-09-11" },
        now: NOW,
      });
      expect(result.ok).toBe(true);
      if (!result.ok || result.value.status !== "ready") return;
      expect(result.value.days.some((d) => d.extra_work.length > 0)).toBe(true);
      await expect(goldenJson(result.value)).toMatchFileSnapshot(
        "./__golden__/calendar-read.student-unplanned.json",
      );
    });

    it("guardian read: the guardian view model over the same assembly", async () => {
      const { readGuardianCalendar } =
        await import("../../server/services/calendar/read-service");
      const result = await readGuardianCalendar({
        student_id: S,
        query: { from: "2026-09-10", to: "2026-09-23" },
        now: NOW,
      });
      expect(result.ok).toBe(true);
      if (!result.ok || result.value.status !== "ready") return;
      expect(result.value.days.some((d) => d.blocks.length > 0)).toBe(true);
      await expect(goldenJson(result.value)).toMatchFileSnapshot(
        "./__golden__/calendar-read.guardian.json",
      );
    });

    it("accountability read: the evening job's days over the same assembly", async () => {
      const { readAccountabilityDays } =
        await import("../../server/services/calendar/read-service");
      const result = await readAccountabilityDays({
        student_id: S,
        from: "2026-09-12",
        to: "2026-09-19",
        now: NOW,
      });
      expect(result).not.toBeNull();
      await expect(goldenJson(result)).toMatchFileSnapshot(
        "./__golden__/calendar-read.accountability.json",
      );
    });
  },
);
