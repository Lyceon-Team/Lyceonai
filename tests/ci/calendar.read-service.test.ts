/**
 * CalendarReadService — R-08-04 first open, §15's default range, §16's guardian read.
 *
 * @spec [Doc-05F_V1.0 §7.6, §8.2, §12.7, §13, §14, §15, §16, §17.3, R-08-04;
 *        Doc_05F_formula_sheet.md §8 items 14, 18] | @implemented [2026-09-21]
 *
 * Two tests carry the weight. R-08-04: a student whose setup is complete and who owns no
 * accepted version gets one generated ON THIS OPEN, once — the read has to generate
 * before it reads the plan, or the first open returns an empty fortnight. And §16: the
 * guardian payload must contain no `explanation_key` ANYWHERE, including inside a
 * practice mix, which is the leak the shared layer's own test caught and which a
 * spread-based projection would reopen one layer up.
 */
import { describe, expect, it, vi } from "vitest";
import {
  PROFILE_ROW,
  SCENARIO_NOW,
  SCENARIO_STUDENT,
  SCENARIO_TODAY,
  makeScenarioClient,
  type ScenarioOptions,
  type FakeClient,
} from "./calendar.service-harness";

const STUDENT = SCENARIO_STUDENT;
const TODAY = SCENARIO_TODAY;
const NOW = SCENARIO_NOW;
const PROFILE = PROFILE_ROW;

let client: FakeClient;

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return client;
  },
}));

// Doc 05C's band is optional (§15) and its own vertical. Empty here keeps this file
// about the calendar.
vi.mock("../../apps/api/src/services/projection-read", () => ({
  readSectionProjections: vi.fn(async () => []),
}));

// The adapters have their own contract tests (`calendar.launch-contract.*`). Here they
// only have to answer, so the read model has activity to allocate.
let answeredUnits = 0;
vi.mock("../../server/services/calendar/adapters", () => ({
  adapterFor: () => ({
    engine: "practice" as const,
    create: vi.fn(),
    nextLaunchSize: vi.fn(),
    progress: vi.fn(async () => null),
    activityUnits: vi.fn(async (_s: string, localDate: string) =>
      localDate !== TODAY
        ? []
        : Array.from({ length: answeredUnits }, (_value, index) => ({
            engine: "practice" as const,
            unit_id: `u-${index}`,
            occurred_at: `2026-09-21T1${index % 10}:00:00Z`,
            local_date: TODAY,
            section: "M" as const,
            domain: "Algebra",
            form_id: null,
          })),
    ),
  }),
}));

const { readCalendar, readGuardianCalendar } =
  await import("../../server/services/calendar/read-service");

type LocalScenarioOptions = ScenarioOptions & { units?: number };

function scenario(options: LocalScenarioOptions = {}): void {
  answeredUnits = options.units ?? 0;
  client = makeScenarioClient(options);
}

const read = () => readCalendar({ student_id: STUDENT, query: {}, now: NOW });

describe("R-08-04 — the first entitled open generates the first plan", () => {
  it("generates with trigger `setup` when setup is complete and no accepted version exists", async () => {
    scenario({ acceptedVersions: 0 });

    const result = await read();

    expect(result.ok).toBe(true);
    const persist = client.rpcs.find(
      (call) => call.fn === "calendar_persist_version",
    );
    expect(persist?.args.p_trigger).toBe("setup");
    expect(persist?.args.p_initiated_by).toBe("student");
  });

  it("generates BEFORE reading the plan, so the first open returns the plan it just made", async () => {
    scenario({ acceptedVersions: 0 });

    await read();

    // Queries and RPCs share one counter, so this is a real ordering assertion: the
    // generate must have completed before the plan was read, or the first open would
    // render the empty fortnight that existed a moment earlier.
    const persist = client.rpcs.find(
      (call) => call.fn === "calendar_persist_version",
    );
    const planRead = client.queries.find(
      (query) => query.table === "calendar_current_plan",
    );
    expect(persist).toBeDefined();
    expect(planRead).toBeDefined();
    expect(persist?.seq).toBeLessThan(planRead?.seq ?? -1);
  });

  it("generates nothing when an accepted version already exists", async () => {
    scenario({ acceptedVersions: 1 });

    await read();

    expect(
      client.rpcs.some((call) => call.fn === "calendar_persist_version"),
    ).toBe(false);
  });

  it("generates nothing before setup completes", async () => {
    scenario({
      acceptedVersions: 0,
      profile: { ...PROFILE, setup_completed_at: null },
    });

    await read();

    expect(
      client.rpcs.some((call) => call.fn === "calendar_persist_version"),
    ).toBe(false);
  });

  it("answers a 200-shaped `setup_required` for a student with no profile row", async () => {
    // Owner ruling on addendum item 26: pre-setup is a STATE, not a failure. It comes back
    // as an ok value so the route can serve 200 and the client can branch on `status`.
    scenario({ profile: null });

    const result = await read();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("setup_required");
  });

  it("fills the setup defaults from CONFIG, with no literal in the service", async () => {
    scenario({ profile: null });

    const result = await read();

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "setup_required") return;
    // Every value traces to a `calendar_runtime_config` row in the harness's CONFIG_ROWS. Change a row
    // and this changes with it, which is the property that keeps the setup sheet's chips
    // and the server's own validation from disagreeing.
    expect(result.value.defaults.daily_minutes_presets).toEqual([
      15, 30, 45, 60, 90, 120,
    ]);
    expect(result.value.defaults.daily_minutes_min).toBe(15);
    expect(result.value.defaults.daily_minutes_max).toBe(180);
    expect(result.value.defaults.target_exam_date_max_days).toBe(540);
  });

  it("suggests the device zone when the database recognises it", async () => {
    scenario({ profile: null, knownZones: ["Asia/Tokyo"] });

    const result = await readCalendar({
      student_id: STUDENT,
      query: { device_timezone: "Asia/Tokyo" },
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "setup_required") return;
    expect(result.value.defaults.timezone).toBe("Asia/Tokyo");
  });

  it("falls back to Chicago for a device zone the database does not know", async () => {
    scenario({ profile: null, knownZones: [] });

    const result = await readCalendar({
      student_id: STUDENT,
      query: { device_timezone: "Mars/Olympus" },
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "setup_required") return;
    expect(result.value.defaults.timezone).toBe("America/Chicago");
  });

  it("falls back to Chicago when the client sends no device zone at all", async () => {
    scenario({ profile: null });

    const result = await read();

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "setup_required") return;
    expect(result.value.defaults.timezone).toBe("America/Chicago");
  });

  it("gives the GUARDIAN the same status and NO defaults — a guardian cannot run setup", async () => {
    scenario({ profile: null });

    const result = await readGuardianCalendar({
      student_id: STUDENT,
      query: {},
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("setup_required");
    expect(Object.keys(result.value)).toEqual(["status"]);
    expect(JSON.stringify(result.value)).not.toContain("daily_minutes");
  });
});

describe("§15 default range", () => {
  it("defaults to today … today + horizon_days − 1, which is fourteen days", async () => {
    scenario({ acceptedVersions: 1 });

    const result = await read();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.days).toHaveLength(14);
    expect(result.value.days[0]?.local_date).toBe(TODAY);
    expect(result.value.days[13]?.local_date).toBe("2026-10-04");
  });

  it("honours an explicit from/to", async () => {
    scenario({ acceptedVersions: 1 });

    const result = await readCalendar({
      student_id: STUDENT,
      query: { from: TODAY, to: "2026-09-23" },
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.days.map((day) => day.local_date)).toEqual([
      TODAY,
      "2026-09-22",
      "2026-09-23",
    ]);
  });

  it("refuses a range whose `from` is after its `to`", async () => {
    scenario({ acceptedVersions: 1 });

    const result = await readCalendar({
      student_id: STUDENT,
      query: { from: "2026-09-25", to: TODAY },
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_query");
  });
});

describe("§13 progress is allocated, not counted from launches", () => {
  it("reports the block's actual from the engine's units", async () => {
    scenario({ acceptedVersions: 1, units: 12 });

    const result = await read();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const today = result.value.days[0];
    expect(today?.blocks[0]?.actual).toBe(12);
    expect(today?.blocks[0]?.status).toBe("partial");
    expect(today?.status).toBe("partial");
    expect(result.value.facts.questions_completed).toBe(12);
  });

  it("counts activity beyond the target as extra work, never as over-completion", async () => {
    scenario({ acceptedVersions: 1, units: 25 });

    const result = await read();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.days[0]?.blocks[0]?.actual).toBe(20);
    expect(result.value.days[0]?.extra_count).toBe(5);
    expect(result.value.facts.extra_questions).toBe(5);
  });
});

describe("§17.3 / sheet item 18 — the timezone prompt is never silent", () => {
  it("reports a mismatch when the client names a different device zone", async () => {
    scenario({ acceptedVersions: 1 });

    const result = await readCalendar({
      student_id: STUDENT,
      query: { device_timezone: "America/New_York" },
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.device_timezone_mismatch).toEqual({
      profile_timezone: "America/Chicago",
      device_timezone: "America/New_York",
    });
  });

  it("omits the field entirely when the client sends no device zone", async () => {
    scenario({ acceptedVersions: 1 });

    const result = await read();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.device_timezone_mismatch).toBeUndefined();
  });

  it("omits it when the two zones agree", async () => {
    scenario({ acceptedVersions: 1 });

    const result = await readCalendar({
      student_id: STUDENT,
      query: { device_timezone: "America/Chicago" },
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.device_timezone_mismatch).toBeUndefined();
  });
});

describe("§12.7 acknowledgement state", () => {
  it("carries the highest accepted non-student version above the watermark", async () => {
    scenario({
      acceptedVersions: 1,
      unacknowledged: {
        version_no: 5,
        trigger: "weekly",
        created_at: "2026-09-20T00:00:00Z",
      },
    });

    const result = await read();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.value.latest_unacknowledged_nonstudent_change?.version_no,
    ).toBe(5);
    expect(result.value.latest_unacknowledged_nonstudent_change?.trigger).toBe(
      "weekly",
    );
  });

  it("is null when there is nothing to acknowledge", async () => {
    scenario({ acceptedVersions: 1, unacknowledged: null });

    const result = await read();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.latest_unacknowledged_nonstudent_change).toBeNull();
  });
});

describe("§16 — the guardian read", () => {
  it("serves the same facts", async () => {
    scenario({ acceptedVersions: 1, units: 12 });
    const student = await read();
    scenario({ acceptedVersions: 1, units: 12 });
    const guardian = await readGuardianCalendar({
      student_id: STUDENT,
      query: {},
      now: NOW,
    });

    expect(student.ok && guardian.ok).toBe(true);
    if (!student.ok || !guardian.ok) return;
    expect(guardian.value.facts).toEqual(student.value.facts);
  });

  /**
   * A1, owner ruling 2026-09-22. §16's exclusions are controls, explanation copy and the
   * target score; a minute estimate is none of them. Asserted as EQUALITY with the
   * student's rather than as mere presence — two payloads that both had estimates but
   * disagreed would be worse than one that withheld them, because a parent and a student
   * would be reading different numbers off the same plan.
   */
  it("serves the SAME estimates the student gets (§17.1)", async () => {
    scenario({ acceptedVersions: 1 });
    const student = await read();
    scenario({ acceptedVersions: 1 });
    const guardian = await readGuardianCalendar({
      student_id: STUDENT,
      query: {},
      now: NOW,
    });

    expect(student.ok && guardian.ok).toBe(true);
    if (!student.ok || !guardian.ok) return;
    if (student.value.status !== "ready" || guardian.value.status !== "ready") {
      throw new Error(
        "both reads must be ready for this comparison to mean anything",
      );
    }
    expect(guardian.value.estimates).toEqual(student.value.estimates);
    // And they trace to the seeded config rows, not to a default someone wrote in code.
    expect(guardian.value.estimates).toEqual({
      practice_seconds_per_unit: 90,
      review_seconds_per_unit: 120,
    });
  });

  it("carries the two admitted profile fields and the band — and no other profile key, no version_no, no override flag", async () => {
    scenario({ acceptedVersions: 1 });

    const result = await readGuardianCalendar({
      student_id: STUDENT,
      query: {},
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value).sort()).toEqual([
      "days",
      // §17.1's minute estimate, added by the owner ruling of 2026-09-22. Listed here
      // EXPLICITLY rather than by loosening the assertion: this list is the guardian
      // chokepoint, and a key that arrives without someone naming it here is the leak
      // this test exists to catch.
      "estimates",
      "facts",
      // NO "projection" HERE, and that is correct rather than an omission. This file mocks
      // Doc 05C's read as empty (see the top), and the field is optional on the wire — an
      // empty band omits the key instead of serving an empty array, exactly as the student
      // payload does. Its PRESENCE is proved where the rows are real:
      // `tests/ci/calendar.wire-contract.test.ts`, which drives this same serializer with
      // two section rows and asserts the band arrives 1:1.
      "status",
      "streak",
      // The TWO profile fields §16 now admits, and the reason this test's name changed.
      // R-08-22 is reversed and the "no profile" clause is narrowed to exactly these — so
      // the assertion is no longer "no profile" but "no profile BEYOND these two", and the
      // list below is where that boundary is enforced. `timezone`, `study_days_mask`,
      // `daily_minutes`, `full_length_weekday`, `planner_mode` and `setup_completed_at` are
      // still withheld, and their absence from this array is what says so.
      "target_exam_date",
      "target_score",
    ]);
    // Said outright, so a future reader does not take the gap above for a leak: with no
    // Doc 05C rows the key is ABSENT, not null and not [].
    expect(result.value).not.toHaveProperty("projection");
    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain("version_no");
    expect(serialized).not.toContain("is_user_override");
    // The remaining profile columns, by name. NOT a sweep for "timezone": that string is a
    // legitimate per-DAY field of the guardian read model, naming the zone `local_date`
    // belongs to, so sweeping for it fails against a correct payload.
    expect(serialized).not.toContain("study_days_mask");
    expect(serialized).not.toContain("daily_minutes");
    expect(serialized).not.toContain("planner_mode");
    expect(serialized).not.toContain("setup_completed_at");
    // And the two that ARE served now carry the profile's own values, not defaults.
    expect(result.value.target_score).toBe(PROFILE_ROW.target_score);
    expect(result.value.target_exam_date).toBe(PROFILE_ROW.target_exam_date);
  });

  it("carries no explanation_key ANYWHERE — not on the block, not inside the mix", async () => {
    scenario({ acceptedVersions: 1 });

    const result = await readGuardianCalendar({
      student_id: STUDENT,
      query: {},
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The student payload has both, so this is a difference and not an empty assertion.
    scenario({ acceptedVersions: 1 });
    const student = await read();
    expect(student.ok).toBe(true);
    if (!student.ok) return;
    expect(JSON.stringify(student.value)).toContain("explanation_key");

    expect(JSON.stringify(result.value)).not.toContain("explanation_key");
    expect(JSON.stringify(result.value)).not.toContain("weighted");
    expect(JSON.stringify(result.value)).not.toContain('"weak"');
  });

  it("never generates a plan — a guardian open is not the student's first open", async () => {
    scenario({ acceptedVersions: 0 });

    await readGuardianCalendar({ student_id: STUDENT, query: {}, now: NOW });

    expect(
      client.rpcs.some((call) => call.fn === "calendar_persist_version"),
    ).toBe(false);
  });
});
