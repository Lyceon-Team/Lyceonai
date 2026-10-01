/**
 * CalendarPlanService, the streak service, and the config accessor.
 *
 * @spec [Doc-05F_V1.0 §12.1, §12.7, §14, §15, §18 (failure modes, missing config);
 *        Doc_05F_formula_sheet.md §8 items 11, 19, 20] | @implemented [2026-09-21]
 *
 * The plan service's job is to NOT be a generator: it calls one SQL function and returns
 * what the validator said. So the tests are about what it passes through and what it
 * refuses to paper over — a rejected plan comes back as a rejection with its rule ids,
 * never as a retry with different inputs.
 *
 * The config tests exist because §18 says a missing config is a LOUD failure at the
 * accessor. A default would be a second source of truth for a value the database owns,
 * and the test that a default does NOT appear is the only thing keeping one out.
 */
import { describe, expect, it, vi } from "vitest";
import {
  CONFIG_ROWS,
  errReply,
  makeFakeClient,
  okReply,
  type FakeClient,
} from "./calendar.service-harness";

const STUDENT = "11111111-1111-1111-1111-111111111111";
const BLOCK_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const KEY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const GENERATOR = "20260917140000";

let client: FakeClient;

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return client;
  },
}));

const {
  regeneratePlan,
  regenerateDay,
  editDay,
  doItNow,
  acknowledgeVersion,
} = await import("../../server/services/calendar/plan-service");
const { getStudentActivityStreak } = await import("../../server/services/activity-streak");
const { loadCalendarConfig, CalendarConfigError, CALENDAR_CONFIG_KEYS } = await import(
  "../../server/services/calendar/config"
);

function withRpc(replies: Record<string, unknown>): void {
  client = makeFakeClient({
    tables: {},
    rpcs: Object.fromEntries(
      Object.entries(replies).map(([fn, reply]) => [fn, () => reply as never]),
    ),
  });
}

describe("§12.1 — each trigger reaches its own writer", () => {
  it("routes a horizon trigger to calendar_persist_version", async () => {
    withRpc({
      calendar_persist_version: okReply({ version_no: 4, validator_result: "accepted" }),
    });

    const result = await regeneratePlan({
      student_id: STUDENT,
      trigger: "weekly",
      initiated_by: "system",
      generator_version: GENERATOR,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version_no).toBe(4);
    expect(client.rpcs[0]?.fn).toBe("calendar_persist_version");
    expect(client.rpcs[0]?.args.p_trigger).toBe("weekly");
    expect(client.rpcs[0]?.args.p_initiated_by).toBe("system");
    // No key supplied means no ledger replay, and null is how the RPC is told so.
    expect(client.rpcs[0]?.args.p_idempotency_key).toBeNull();
  });

  it("routes day_regenerate and day_reset to calendar_regenerate_day, differing only in the trigger", async () => {
    withRpc({
      calendar_regenerate_day: okReply({ version_no: 9, validator_result: "accepted" }),
    });

    await regenerateDay({
      student_id: STUDENT,
      date: "2026-09-22",
      trigger: "day_regenerate",
      generator_version: GENERATOR,
    });
    await regenerateDay({
      student_id: STUDENT,
      date: "2026-09-22",
      trigger: "day_reset",
      generator_version: GENERATOR,
    });

    expect(client.rpcs.map((call) => call.fn)).toEqual([
      "calendar_regenerate_day",
      "calendar_regenerate_day",
    ]);
    expect(client.rpcs[0]?.args.p_trigger).toBe("day_regenerate");
    expect(client.rpcs[1]?.args.p_trigger).toBe("day_reset");
    const [first, second] = client.rpcs;
    expect({ ...first?.args, p_trigger: null }).toEqual({ ...second?.args, p_trigger: null });
  });

  it("sends the day-edit member list as jsonb, cleared day included", async () => {
    withRpc({ calendar_edit_day: okReply({ version_no: 2, validator_result: "accepted" }) });

    await editDay({
      student_id: STUDENT,
      date: "2026-09-22",
      members: [],
      generator_version: GENERATOR,
      idempotency_key: KEY,
    });

    expect(client.rpcs[0]?.args.p_members).toBe("[]");
    expect(client.rpcs[0]?.args.p_idempotency_key).toBe(KEY);
  });

  it("routes do-it-now to calendar_do_it_now with the block id", async () => {
    withRpc({ calendar_do_it_now: okReply({ version_no: 6, validator_result: "accepted" }) });

    await doItNow({
      student_id: STUDENT,
      block_id: BLOCK_ID,
      generator_version: GENERATOR,
      idempotency_key: KEY,
    });

    expect(client.rpcs[0]?.fn).toBe("calendar_do_it_now");
    expect(client.rpcs[0]?.args.p_block_id).toBe(BLOCK_ID);
  });
});

/**
 * The shape `calendar_validate_plan` ACTUALLY returns. Verified against the function in
 * a database with the migration pipeline applied, 2026-09-24:
 *
 *   select public.calendar_validate_plan('generated', <input>, <two dates the same>);
 *   {"result":"rejected","violations":[{"date":"2026-09-25","rule":"V-08",
 *     "detail":"the date appears 2 times in the output; display ordinals would collide"}]}
 *
 * The previous fixture here was `violations: ["V-05", "V-10"]` — a list of STRINGS, which
 * the validator has never produced. That is why this suite stayed green through fifteen
 * production rejections that logged `rule_ids=[]`: the code was filtering for strings, and
 * the only strings it ever saw were the ones this file handed it. A fixture invented to
 * match the implementation cannot falsify the implementation.
 */
const V05 = {
  rule: "V-05",
  date: "2026-09-25",
  detail: "planned seconds 5400 exceed the day budget 3600",
} as const;
const V10 = {
  rule: "V-10",
  date: null,
  detail: "the horizon creates 3 full-lengths, above max_full_length_per_horizon 2",
} as const;

describe("§18 — a rejected plan is a rejection, never a retry", () => {
  it("returns the rule ids and writes nothing else", async () => {
    withRpc({
      calendar_persist_version: okReply({
        version_no: 4,
        validator_result: "rejected",
        violations: [V05, V10],
      }),
    });

    const result = await regeneratePlan({
      student_id: STUDENT,
      trigger: "student_refresh",
      initiated_by: "student",
      generator_version: GENERATOR,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("rejected");
    if (result.error.kind !== "rejected") return;
    expect(result.error.violations).toEqual([V05, V10]);
    expect(result.error.unreadable).toBe(0);
    // One call. A second would be a second generator with different inputs.
    expect(client.rpcs).toHaveLength(1);
  });

  it("a day edit is STUDENT-authored; a regeneration is not", async () => {
    withRpc({
      calendar_edit_day: okReply({
        version_no: 5,
        validator_result: "rejected",
        violations: [V05],
      }),
    });

    const edit = await editDay({
      student_id: STUDENT,
      date: "2026-09-25",
      members: [],
      generator_version: GENERATOR,
      idempotency_key: KEY,
    });

    expect(edit.ok).toBe(false);
    if (edit.ok || edit.error.kind !== "rejected") return;
    // The student supplied the member list, so the refusal is about what THEY asked for.
    expect(edit.error.authored).toBe("student");

    withRpc({
      calendar_persist_version: okReply({
        version_no: 6,
        validator_result: "rejected",
        violations: [V05],
      }),
    });
    const weekly = await regeneratePlan({
      student_id: STUDENT,
      trigger: "weekly",
      initiated_by: "system",
      generator_version: GENERATOR,
    });
    expect(weekly.ok).toBe(false);
    if (weekly.ok || weekly.error.kind !== "rejected") return;
    // Nobody asked for anything wrong here — our generator produced an invalid plan.
    expect(weekly.error.authored).toBe("system");
  });

  it("COUNTS a violation it cannot parse instead of dropping it", async () => {
    // The regression guard. Anything unreadable used to vanish; now it is visible, so a
    // future change to the SQL shape surfaces as a number rather than as silence.
    withRpc({
      calendar_persist_version: okReply({
        version_no: 7,
        validator_result: "rejected",
        violations: [V05, "V-05", { rule: "", date: null, detail: "x" }, 42],
      }),
    });

    const result = await regeneratePlan({
      student_id: STUDENT,
      trigger: "weekly",
      initiated_by: "system",
      generator_version: GENERATOR,
    });

    expect(result.ok).toBe(false);
    if (result.ok || result.error.kind !== "rejected") return;
    expect(result.error.violations).toEqual([V05]);
    expect(result.error.unreadable).toBe(3);
  });

  it("PLANT: the old string filter empties a real validator payload", () => {
    // What the code did before, run against what the database actually sends. This is the
    // defect, reproduced in four lines: no error, no warning, just nothing.
    const fromTheDatabase: unknown[] = [V05, V10];
    const asTheOldCodeReadThem = fromTheDatabase.filter(
      (rule): rule is string => typeof rule === "string",
    );
    expect(asTheOldCodeReadThem).toEqual([]);
    expect(fromTheDatabase).toHaveLength(2);
  });

  it("refuses an envelope it does not recognise rather than guessing a version", async () => {
    withRpc({ calendar_persist_version: okReply({ surprise: true }) });

    const result = await regeneratePlan({
      student_id: STUDENT,
      trigger: "setup",
      initiated_by: "student",
      generator_version: GENERATOR,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("write_failed");
  });
});

describe("the writers' own refusals become domain failures, not 500s", () => {
  const cases: { message: string; kind: string }[] = [
    { message: "calendar_regenerate_day: 2026-09-01 is in the past and cannot be regenerated", kind: "past_date" },
    { message: "calendar_regenerate_day: 2027-01-01 is beyond the 14 day horizon and is not planned yet", kind: "beyond_horizon" },
    { message: "calendar_regenerate_day: student x has no study profile; nothing is generated", kind: "no_profile" },
    { message: "calendar_do_it_now: block x does not belong to student y", kind: "not_found" },
    { message: "deadlock detected", kind: "write_failed" },
  ];

  for (const testCase of cases) {
    it(`maps "${testCase.message.slice(0, 44)}…" to ${testCase.kind}`, async () => {
      client = makeFakeClient({
        tables: {},
        rpcs: { calendar_regenerate_day: () => errReply(testCase.message) },
      });

      const result = await regenerateDay({
        student_id: STUDENT,
        date: "2026-09-22",
        trigger: "day_regenerate",
        generator_version: GENERATOR,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe(testCase.kind);
    });
  }
});

describe("§12.7 acknowledgement", () => {
  it("raises the watermark through the monotonic RPC", async () => {
    withRpc({ calendar_acknowledge_version: okReply(5) });

    const result = await acknowledgeVersion(STUDENT, 5);

    expect(result.ok).toBe(true);
    expect(client.rpcs[0]?.fn).toBe("calendar_acknowledge_version");
    expect(client.rpcs[0]?.args.p_version_no).toBe(5);
  });
});

describe("§14 / sheet item 11 — the streak reads 05B and computes nothing", () => {
  it("serves student_overall_kpi's two columns with history_complete false", async () => {
    client = makeFakeClient({
      tables: {
        student_overall_kpi: () =>
          okReply({ current_streak_days: 6, longest_streak_days: 21 }),
      },
    });

    const streak = await getStudentActivityStreak(STUDENT);

    expect(streak).toEqual({ current: 6, longest: 21, history_complete: false });
    // No calendar table is touched: the streak is served without a calendar_access check
    // (INV-08-20), which only holds if it has no calendar dependency.
    expect(client.queries.map((query) => query.table)).toEqual(["student_overall_kpi"]);
  });

  it("reports unknown rather than zero for a student with no KPI row", async () => {
    client = makeFakeClient({ tables: { student_overall_kpi: () => okReply(null) } });

    expect(await getStudentActivityStreak(STUDENT)).toEqual({
      current: null,
      longest: null,
      history_complete: false,
    });
  });

  it("fails open to unknown when the KPI read errors", async () => {
    client = makeFakeClient({
      tables: { student_overall_kpi: () => errReply("connection reset") },
    });

    expect((await getStudentActivityStreak(STUDENT)).current).toBeNull();
  });
});

describe("§18 — a missing config is a loud failure at the accessor", () => {
  it("reads every key it needs in ONE query PER TABLE, never one per key", async () => {
    client = makeFakeClient({ tables: { calendar_runtime_config: () => okReply(CONFIG_ROWS) } });

    const config = await loadCalendarConfig();

    expect(config.bounds.daily_minutes_presets).toEqual([15, 30, 45, 60, 90, 120]);
    expect(config.horizonDays).toBe(14);
    expect(config.generatorVersion).toBe(GENERATOR);
    expect(config.estimates).toEqual({
      practice_seconds_per_unit: 90,
      review_seconds_per_unit: 120,
    });

    // The rule this protects is "one `IN` beats seven round trips", not a literal count of
    // one. §17.1's minute estimate needs practice_runtime_config.target_seconds_per_question
    // — Doc 02B §41 owns practice timing and §20's audit rule says the calendar REFERENCES
    // it rather than restating it, so a second table means a second query; copying the value
    // into calendar_runtime_config to avoid it would be the drift §20 exists to prevent.
    // Asserted PER TABLE, so adding a per-key round trip still reddens this.
    const byTable = client.queries.reduce<Record<string, number>>((counts, query) => {
      counts[query.table] = (counts[query.table] ?? 0) + 1;
      return counts;
    }, {});
    expect(byTable).toEqual({ calendar_runtime_config: 1, practice_runtime_config: 1 });
  });

  for (const key of CALENDAR_CONFIG_KEYS) {
    it(`throws rather than defaulting when ${key} is unseeded`, async () => {
      client = makeFakeClient({
        tables: {
          calendar_runtime_config: () =>
            okReply(CONFIG_ROWS.filter((row) => row.key !== key)),
        },
      });

      await expect(loadCalendarConfig()).rejects.toBeInstanceOf(CalendarConfigError);
    });
  }

  it("throws when the seeded bounds do not form a usable set", async () => {
    client = makeFakeClient({
      tables: {
        calendar_runtime_config: () =>
          okReply(
            CONFIG_ROWS.map((row) =>
              row.key === "daily_minutes_min" ? { key: row.key, value: 999 } : row,
            ),
          ),
      },
    });

    await expect(loadCalendarConfig()).rejects.toBeInstanceOf(CalendarConfigError);
  });

  it("throws on a read failure rather than serving a calendar built on defaults", async () => {
    client = makeFakeClient({
      tables: { calendar_runtime_config: () => errReply("connection reset") },
    });

    await expect(loadCalendarConfig()).rejects.toBeInstanceOf(CalendarConfigError);
  });
});
