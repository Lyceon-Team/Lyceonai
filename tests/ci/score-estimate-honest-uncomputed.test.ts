// @spec [Doc-05A_V1 §10.1 mastery-from-observed-events-only; Lane-C contract LC-AM3-001]
// @implemented [2026-06-13]
// plain English: proves the weighted score estimate reads as UNCOMPUTED (estimate: null) whenever
//   the 05C section projections are absent (the AM-3-deferred state) — never a fabricated 200/400
//   baseline. A `computed` result requires BOTH section projections to be real. Honest-signal
//   regression guard: a minor-facing surface must never emit an invented score.
import { afterEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.fn();
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: { from: (...args: unknown[]) => fromMock(...args) },
}));

import { buildScoreEstimateFromCanonical } from "../../server/services/canonical-runtime-views";

type SupabaseQueryResult = { data: unknown; error: null };

function mockTables(tables: Record<string, unknown[]>): void {
  // Two read shapes (genesis Doc-05 vocabulary):
  //   student_section_projections: from(t).select(cols).eq(col, val) — awaited, resolves { data: rows[], error }.
  //   student_overall_kpi:         from(t).select(cols).eq(col, val).maybeSingle() — resolves { data: row|null, error }.
  fromMock.mockImplementation((table: string) => {
    const rows = tables[table] ?? [];
    // .eq() is both awaitable (array result) AND chainable into .maybeSingle() (single row).
    const eqResult = Object.assign(
      Promise.resolve<SupabaseQueryResult>({ data: rows, error: null }),
      {
        // .maybeSingle() yields the single row object (or null) — the events_total carrier.
        maybeSingle: (): Promise<SupabaseQueryResult> =>
          Promise.resolve({ data: rows[0] ?? null, error: null }),
      },
    );
    return {
      select: () => ({
        eq: () => eqResult,
      }),
    };
  });
}

describe("buildScoreEstimateFromCanonical — honest uncomputed (LC-AM3-001)", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns UNCOMPUTED (estimate null) when projections are absent, even with attempts > 0", async () => {
    mockTables({
      student_section_projections: [],
      student_overall_kpi: [{ events_total: 25 }],
    });
    const result = await buildScoreEstimateFromCanonical("u1");
    expect(result.status).toBe("uncomputed");
    expect(result.estimate).toBeNull();
    expect(result.totalQuestionsAttempted).toBe(25); // real count preserved; no fabricated score
  });

  it("returns COMPUTED only when BOTH section projections are real", async () => {
    mockTables({
      student_section_projections: [
        {
          section: "M",
          projected_score_mid: 600,
          projected_score_low: 560,
          projected_score_high: 640,
          relevant_question_count: 30,
        },
        {
          section: "RW",
          projected_score_mid: 580,
          projected_score_low: 540,
          projected_score_high: 620,
          relevant_question_count: 30,
        },
      ],
      student_overall_kpi: [{ events_total: 60 }],
    });
    const result = await buildScoreEstimateFromCanonical("u2");
    expect(result.status).toBe("computed");
    expect(result.estimate).not.toBeNull();
    expect(result.estimate?.composite).toBe(1180);
  });

  it("returns UNCOMPUTED when only one section projection exists (no fabricated other half)", async () => {
    mockTables({
      student_section_projections: [
        { section: "M", projected_score_mid: 600, relevant_question_count: 30 },
      ],
      student_overall_kpi: [{ events_total: 30 }],
    });
    const result = await buildScoreEstimateFromCanonical("u3");
    expect(result.status).toBe("uncomputed");
    expect(result.estimate).toBeNull();
  });
});
