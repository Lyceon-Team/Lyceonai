/**
 * The §9.1 fold — one engine read for many days, one for many sessions (SCL-233).
 *
 * @spec [Doc-05F_V1.0 §9.1 as amended by SCL-233 (`activityUnits(student, days)`,
 *        `progress(sessionIds)`), §8.2 (each date in its own zone), §13 (the union over the
 *        days), INV-08-23; owner ruling (Karl) 2026-10-13 on #1232] | @implemented [2026-10-15]
 *
 * plain English: the end-to-end proof that the fold changed no response is the PG golden
 * (`calendar-read.golden.pg.ci.test.ts`). This file pins the two pieces it rests on, where a
 * defect would be cheapest to see:
 *   1. the window arithmetic — the covering span (min start, max end, which is NOT always the
 *      first and last day's when zones differ), half-open membership exact to the microsecond,
 *      a row counted on every overlapping day and on no day in a gap;
 *   2. each adapter asks ONE question per call — one activity query for all the days, one
 *      lifecycle query for all the sessions — and files the answer the way the per-day and
 *      per-session reads did.
 * The fake client returns whatever rows it is given (it evaluates no filter), so the filing
 * here is the adapter's own JavaScript, which is the part the fold added.
 */
import { describe, expect, it, vi } from "vitest";
import {
  errReply,
  makeFakeClient,
  okReply,
  type FakeClient,
} from "./calendar.service-harness";
import {
  dayWindowSpan,
  localDatesContaining,
} from "../../server/services/calendar/adapters/local-day";
import type {
  ActivityDay,
  CalendarEngineAdapter,
} from "../../server/services/calendar/adapters/types";

let client: FakeClient;

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return client;
  },
}));
vi.mock("../../server/routes/practice-canonical", () => ({
  startOrReplaySession: vi.fn(),
  loadPracticeConfig: vi.fn(async () => ({ maxSessionCountPremium: 30 })),
}));
vi.mock("../../server/routes/review-canonical", () => ({
  startOrReplayReviewSession: vi.fn(),
}));
vi.mock("../../server/services/exam-runtime-service", () => ({
  EXAM_FEATURE_KEY: "exam_full_length",
  createExamSession: vi.fn(),
}));
vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: { canAccessFeature: vi.fn(async () => true) },
}));

const { practiceAdapter } =
  await import("../../server/services/calendar/adapters/practice");
const { reviewAdapter } =
  await import("../../server/services/calendar/adapters/review");
const { fullLengthAdapter } =
  await import("../../server/services/calendar/adapters/full-length");

const STUDENT = "11111111-1111-1111-1111-111111111111";

/**
 * Chicago 09-15 = [09-15T05:00Z, 09-16T05:00Z); Tokyo 09-16 = [09-15T15:00Z, 09-16T15:00Z)
 * (fourteen hours of overlap); LA 09-21 = [09-21T07:00Z, 09-22T07:00Z) (a gap after Tokyo).
 */
const DAYS: ActivityDay[] = [
  { local_date: "2026-09-15", timezone: "America/Chicago" },
  { local_date: "2026-09-16", timezone: "Asia/Tokyo" },
  { local_date: "2026-09-21", timezone: "America/Los_Angeles" },
];

/** Instant → the days a correct fold files it under. */
const CASES: Array<[string, string[]]> = [
  // Exactly at Chicago 09-15's start: inclusive.
  ["2026-09-15T05:00:00Z", ["2026-09-15"]],
  // One microsecond before it: no requested day.
  ["2026-09-15T04:59:59.999999Z", []],
  // The overlap: BOTH days, in the order they were asked for.
  ["2026-09-15T20:00:00Z", ["2026-09-15", "2026-09-16"]],
  // One microsecond before Chicago 09-15 ends: still both.
  ["2026-09-16T04:59:59.999999Z", ["2026-09-15", "2026-09-16"]],
  // Exactly at Chicago 09-15's end: exclusive, so Tokyo only.
  ["2026-09-16T05:00:00Z", ["2026-09-16"]],
  // The gap between Tokyo 09-16 and LA 09-21: none.
  ["2026-09-18T12:00:00Z", []],
  // One microsecond before LA 09-21 ends: LA.
  ["2026-09-22T06:59:59.999999Z", ["2026-09-21"]],
];

describe("window arithmetic (local-day.ts)", () => {
  it("covers every requested window with one span: the earliest start, the latest end", () => {
    const span = dayWindowSpan(DAYS);
    expect(span).not.toBeNull();
    expect(span?.startUtc).toBe("2026-09-15T05:00:00.000Z");
    expect(span?.endUtc).toBe("2026-09-22T07:00:00.000Z");
  });

  it("takes the MAX end, which is not always the last day's: zones 26 hours apart", () => {
    // 09-15 in UTC-12 ends at 09-16T12:00Z; 09-16 in UTC+14 ends at 09-16T10:00Z. A span
    // that took the last day's end would cut two hours off the first day.
    const span = dayWindowSpan([
      { local_date: "2026-09-15", timezone: "Etc/GMT+12" },
      { local_date: "2026-09-16", timezone: "Pacific/Kiritimati" },
    ]);
    expect(span?.endUtc).toBe("2026-09-16T12:00:00.000Z");
    // And the MIN start, which is not always the first day's for the same reason.
    expect(span?.startUtc).toBe("2026-09-15T10:00:00.000Z");
  });

  it("files an instant under every window that holds it, exact at the microsecond", () => {
    const span = dayWindowSpan(DAYS);
    if (span === null) throw new Error("span");
    for (const [instant, expected] of CASES) {
      // The adapters normalise through `toIsoTimestamp` first, which truncates to the ms.
      const normalised = new Date(Date.parse(instant)).toISOString();
      expect({ instant, days: localDatesContaining(span, normalised) }).toEqual(
        { instant, days: expected },
      );
    }
  });

  it("no days → no span, so the adapter makes no query", () => {
    expect(dayWindowSpan([])).toBeNull();
  });
});

type ItemTable = "practice_session_items" | "review_session_items";

function itemRows(table: ItemTable): FakeClient {
  return makeFakeClient({
    tables: {
      [table]: () =>
        okReply(
          CASES.map(([instant], index) => ({
            id: `item-${index}`,
            session_id: `sess-${index}`,
            question_section: "M",
            question_domain: "Algebra",
            occurred_at: instant,
            status: "answered",
          })),
        ),
    },
  });
}

/** What every engine's fold must produce from `CASES`: `[unit_id, local_date]`, in order. */
function expectedFiling(prefix: string): Array<[string, string]> {
  return CASES.flatMap(([, days], index) =>
    days.map((day): [string, string] => [`${prefix}-${index}`, day]),
  );
}

function rangeFilters(
  table: string,
  column: string,
): Array<{ kind: string; column: string; value: unknown }> {
  const reads = client.queries.filter((query) => query.table === table);
  // ONE read for all three days — not one per day.
  expect(reads).toHaveLength(1);
  return (reads[0]?.filters ?? []).filter((filter) => filter.column === column);
}

describe.each<[string, CalendarEngineAdapter, ItemTable]>([
  ["practice", practiceAdapter, "practice_session_items"],
  ["review", reviewAdapter, "review_session_items"],
])("%s adapter: activityUnits over several days", (engine, adapter, table) => {
  it("asks once, over the covering span, and files each row under every day that holds it", async () => {
    client = itemRows(table);
    const units = await adapter.activityUnits(STUDENT, DAYS);

    expect(rangeFilters(table, "occurred_at")).toEqual([
      { kind: "gte", column: "occurred_at", value: "2026-09-15T05:00:00.000Z" },
      { kind: "lt", column: "occurred_at", value: "2026-09-22T07:00:00.000Z" },
    ]);
    expect(units.map((unit) => [unit.unit_id, unit.local_date])).toEqual(
      expectedFiling("item"),
    );
    expect(new Set(units.map((unit) => unit.engine))).toEqual(
      new Set([engine]),
    );
  });

  it("no days → no query and no units", async () => {
    client = itemRows(table);
    await expect(adapter.activityUnits(STUDENT, [])).resolves.toEqual([]);
    expect(client.queries).toHaveLength(0);
  });

  it("a failed read fails OPEN to no units, never a throw", async () => {
    client = makeFakeClient({
      tables: { [table]: () => errReply("boom", "XX000") },
    });
    await expect(adapter.activityUnits(STUDENT, DAYS)).resolves.toEqual([]);
  });
});

describe("full-length adapter: activityUnits over several days", () => {
  it("asks once, over the covering span, and files each sitting under every day that holds it", async () => {
    client = makeFakeClient({
      tables: {
        test_sessions: () =>
          okReply(
            CASES.map(([instant], index) => ({
              id: `exam-${index}`,
              test_form_id: "form-1",
              completed_at: instant,
              state: "completed",
            })),
          ),
      },
    });
    const units = await fullLengthAdapter.activityUnits(STUDENT, DAYS);

    expect(rangeFilters("test_sessions", "completed_at")).toEqual([
      {
        kind: "gte",
        column: "completed_at",
        value: "2026-09-15T05:00:00.000Z",
      },
      { kind: "lt", column: "completed_at", value: "2026-09-22T07:00:00.000Z" },
    ]);
    expect(units.map((unit) => [unit.unit_id, unit.local_date])).toEqual(
      expectedFiling("exam"),
    );
  });
});

describe.each<
  [string, CalendarEngineAdapter, string, string, Record<string, string>]
>([
  [
    "practice",
    practiceAdapter,
    "practice_sessions",
    "status",
    {
      created: "active",
      active: "active",
      completed: "completed",
      abandoned: "abandoned",
    },
  ],
  [
    "review",
    reviewAdapter,
    "review_sessions",
    "status",
    {
      created: "active",
      active: "active",
      completed: "completed",
      abandoned: "abandoned",
    },
  ],
  [
    "full_length",
    fullLengthAdapter,
    "test_sessions",
    "state",
    {
      created: "active",
      active: "active",
      section_break: "active",
      completed: "completed",
      abandoned_final: "abandoned",
      partial_scored_abandoned: "abandoned",
    },
  ],
])(
  "%s adapter: progress over several sessions",
  (_engine, adapter, table, column, mapping) => {
    it("asks once for every session, de-duplicated, and maps each lifecycle", async () => {
      const stored = Object.keys(mapping);
      client = makeFakeClient({
        tables: {
          [table]: () =>
            okReply([
              ...stored.map((value, index) => ({
                id: `s-${index}`,
                [column]: value,
              })),
              // A value outside the lifecycle is absent, as its `null` was.
              { id: "s-odd", [column]: "something_else" },
            ]),
        },
      });
      const ids = [
        ...stored.map((_value, index) => `s-${index}`),
        "s-odd",
        "s-0",
      ];
      const lifecycles = await adapter.progress(ids);

      const reads = client.queries.filter((query) => query.table === table);
      expect(reads).toHaveLength(1);
      expect(reads[0]?.filters).toEqual([
        {
          kind: "in",
          column: "id",
          value: [...stored.map((_value, index) => `s-${index}`), "s-odd"],
        },
      ]);
      expect(Object.fromEntries(lifecycles)).toEqual(
        Object.fromEntries(
          stored.map((value, index) => [`s-${index}`, mapping[value]]),
        ),
      );
    });

    it("no sessions → no query; a failed read → an empty map, never a throw", async () => {
      client = makeFakeClient({
        tables: { [table]: () => errReply("boom", "XX000") },
      });
      expect((await adapter.progress([])).size).toBe(0);
      expect(client.queries).toHaveLength(0);
      expect((await adapter.progress(["s-1"])).size).toBe(0);
    });
  },
);
