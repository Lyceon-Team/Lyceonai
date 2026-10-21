/**
 * The streak's two reads run together, and the values and failure posture are unchanged.
 *
 * @spec [owner ruling (Karl) 2026-10-15 on #1238 ("parallelize independent reads (the streak's
 *        two reads ...)"); Doc-05F_V1.0 §14; SCL-226] | @implemented [2026-10-15]
 *
 * plain English: `getStudentActivityStreak` reads 05B's KPI row (for `longest`) and the daily
 * streak RPC (for `current`). Neither depends on the other, so the RPC must be asked while the
 * KPI read is still outstanding — one wait, not two. The calendar's end-to-end depth no longer
 * shows this (the streak is collected after the plan), so it is pinned here, at the service.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Reply = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

const state: {
  releaseKpi: ((reply: Reply) => void) | null;
  kpiAnswered: boolean;
  rpcCalledWhileKpiPending: boolean | null;
  rpcReply: Reply;
} = {
  releaseKpi: null,
  kpiAnswered: false,
  rpcCalledWhileKpiPending: null,
  rpcReply: {
    data: [{ current_streak: 3, today_done: true, broken: false }],
    error: null,
  },
};

vi.mock("../../apps/api/src/lib/supabase-server", () => {
  const kpiBuilder = {
    select: () => kpiBuilder,
    eq: () => kpiBuilder,
    maybeSingle: () =>
      new Promise<Reply>((resolve) => {
        state.releaseKpi = (reply: Reply) => {
          state.kpiAnswered = true;
          resolve(reply);
        };
      }),
  };
  return {
    supabaseServer: {
      from: (table: string) => {
        if (table !== "student_overall_kpi")
          throw new Error(`unexpected table ${table}`);
        return kpiBuilder;
      },
      rpc: async (fn: string) => {
        if (fn !== "student_streak") throw new Error(`unexpected rpc ${fn}`);
        state.rpcCalledWhileKpiPending = !state.kpiAnswered;
        return state.rpcReply;
      },
    },
  };
});

const { getStudentActivityStreak } =
  await import("../../server/services/activity-streak");

const STUDENT = "11111111-1111-1111-1111-111111111111";
const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  state.releaseKpi = null;
  state.kpiAnswered = false;
  state.rpcCalledWhileKpiPending = null;
});

describe("getStudentActivityStreak — two independent reads, one wait", () => {
  it("asks for the daily streak while the KPI read is still outstanding, and answers as before", async () => {
    const result = getStudentActivityStreak(STUDENT);
    await tick();
    // The KPI read has not been answered yet, and the RPC has already been asked.
    expect(state.releaseKpi).not.toBeNull();
    expect(state.rpcCalledWhileKpiPending).toBe(true);
    state.releaseKpi!({ data: { longest_streak_days: 9 }, error: null });
    await expect(result).resolves.toEqual({
      current: 3,
      longest: 9,
      history_complete: false,
    });
  });

  it("a failed KPI read is still the unknown streak, whatever the RPC said", async () => {
    const result = getStudentActivityStreak(STUDENT);
    await tick();
    state.releaseKpi!({
      data: null,
      error: { message: "boom", code: "XX000" },
    });
    await expect(result).resolves.toEqual({
      current: null,
      longest: null,
      history_complete: false,
    });
  });
});
