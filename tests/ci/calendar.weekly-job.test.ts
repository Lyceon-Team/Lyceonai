/**
 * The §12.5 weekly job — the predicate's outcomes, isolation, and idempotency.
 *
 * @spec [Doc-05F_V1.0 §12.5 (R-08-30), §12.1, §7.8 `calendar_job_runs`, §18;
 *        lyceon-coding-standards §4.2] | @implemented [2026-09-21]
 *
 * The three that matter:
 *   - every student the job considered gets a `calendar_job_runs` row, INCLUDING the ones it
 *     skipped. A job that filters silently is a job nobody can explain afterwards, and the
 *     `outcome` CHECK already enumerates the three skips, so filtering them away would make
 *     three of its five values unreachable.
 *   - one student's failure does not stop the loop. The mutation this catches is a `throw`
 *     where the `catch` is, which would leave everybody after that student unplanned.
 *   - the idempotency key is derived from (student, local week), so a rerun the same day is
 *     a replay and not a second plan.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONFIG_ROWS,
  errReply,
  makeFakeClient,
  okReply,
  type FakeClient,
} from "./calendar.service-harness";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const D = "44444444-4444-4444-4444-444444444444";
const MONDAY = "2026-09-21";

let client: FakeClient;
const jobRuns: Record<string, unknown>[] = [];
const regenerateMock = vi.fn();

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return client;
  },
}));

vi.mock("../../server/services/calendar/plan-service", () => ({
  regeneratePlan: (...args: unknown[]) => regenerateMock(...args),
}));

const { runWeeklyRegeneration, weeklyIdempotencyKey, JOB_OUTCOMES, WEEKLY_JOB } =
  await import("../../server/services/calendar/weekly-job");

type Candidate = { student_id: string; period_key: string; outcome: string | null };

// `regenerateMock` is module-scoped, so without this every assertion on its call count
// reads the whole file's history and passes or fails by test order.
beforeEach(() => {
  vi.clearAllMocks();
});

function scenario(candidates: Candidate[], options?: { candidatesFail?: boolean }): void {
  jobRuns.length = 0;
  client = makeFakeClient({
    tables: {
      calendar_runtime_config: () => okReply(CONFIG_ROWS),
      calendar_job_runs: (state) => {
        if (state.op === "insert") {
          jobRuns.push(state.payload as Record<string, unknown>);
        }
        return okReply(null);
      },
    },
    rpcs: {
      calendar_weekly_candidates: () =>
        options?.candidatesFail === true
          ? errReply("connection reset")
          : okReply(candidates),
    },
  });
}

describe("§12.5 — every student considered is recorded, skips included", () => {
  it("records one row per candidate, with the outcome the SQL decided", async () => {
    regenerateMock.mockResolvedValue({ ok: true, value: { version_no: 9 } });
    scenario([
      { student_id: A, period_key: MONDAY, outcome: null },
      { student_id: B, period_key: MONDAY, outcome: "skipped_fresh" },
      { student_id: C, period_key: MONDAY, outcome: "skipped_custom" },
      { student_id: D, period_key: MONDAY, outcome: "skipped_no_entitlement" },
    ]);

    const summary = await runWeeklyRegeneration();

    expect(summary).toEqual({
      considered: 4,
      ok: 1,
      skipped_fresh: 1,
      skipped_custom: 1,
      skipped_no_entitlement: 1,
      failed: 0,
    });
    expect(jobRuns).toHaveLength(4);
    expect(jobRuns.map((row) => row.outcome)).toEqual([
      "ok",
      "skipped_fresh",
      "skipped_custom",
      "skipped_no_entitlement",
    ]);
    expect(new Set(jobRuns.map((row) => row.job))).toEqual(new Set([WEEKLY_JOB]));
    expect(new Set(jobRuns.map((row) => row.period_key))).toEqual(new Set([MONDAY]));
  });

  it("generates only for the candidates the SQL left as null", async () => {
    regenerateMock.mockResolvedValue({ ok: true, value: { version_no: 9 } });
    scenario([
      { student_id: A, period_key: MONDAY, outcome: null },
      { student_id: B, period_key: MONDAY, outcome: "skipped_fresh" },
      { student_id: C, period_key: MONDAY, outcome: "skipped_custom" },
    ]);

    await runWeeklyRegeneration();

    expect(regenerateMock).toHaveBeenCalledTimes(1);
    expect(regenerateMock.mock.calls[0]?.[0].student_id).toBe(A);
  });

  it("every outcome it writes is one the calendar_job_runs CHECK admits", async () => {
    regenerateMock.mockResolvedValue({ ok: false, error: { kind: "rejected", violations: [] } });
    scenario([
      { student_id: A, period_key: MONDAY, outcome: null },
      { student_id: B, period_key: MONDAY, outcome: "skipped_fresh" },
    ]);

    await runWeeklyRegeneration();

    for (const row of jobRuns) {
      expect(JOB_OUTCOMES).toContain(row.outcome);
    }
  });
});

describe("§12.1 — the weekly run is system-initiated, so it raises the §17.4 banner", () => {
  it("sends trigger `weekly` and initiated_by `system`", async () => {
    regenerateMock.mockResolvedValue({ ok: true, value: { version_no: 9 } });
    scenario([{ student_id: A, period_key: MONDAY, outcome: null }]);

    await runWeeklyRegeneration();

    const request = regenerateMock.mock.calls[0]?.[0];
    expect(request.trigger).toBe("weekly");
    // `system`, not `student`: §12.7 only counts non-student versions as unacknowledged, so
    // sending `student` here would silently suppress the plan-updated banner.
    expect(request.initiated_by).toBe("system");
    expect(request.generator_version).toBe("20260917140000");
  });
});

describe("§4.2 — a rerun in the same local week is a replay", () => {
  it("derives the key from (student, period_key) and nothing else", () => {
    expect(weeklyIdempotencyKey(A, MONDAY)).toBe(weeklyIdempotencyKey(A, MONDAY));
    expect(weeklyIdempotencyKey(A, MONDAY)).not.toBe(weeklyIdempotencyKey(B, MONDAY));
    expect(weeklyIdempotencyKey(A, MONDAY)).not.toBe(weeklyIdempotencyKey(A, "2026-09-28"));
  });

  it("produces a well-formed uuid, because the ledger column is one", () => {
    expect(weeklyIdempotencyKey(A, MONDAY)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("sends that exact key to the writer", async () => {
    regenerateMock.mockResolvedValue({ ok: true, value: { version_no: 9 } });
    scenario([{ student_id: A, period_key: MONDAY, outcome: null }]);

    await runWeeklyRegeneration();

    expect(regenerateMock.mock.calls[0]?.[0].idempotency_key).toBe(
      weeklyIdempotencyKey(A, MONDAY),
    );
  });
});

describe("per-student isolation — one bad row does not unplan everybody after it", () => {
  it("continues the loop past a student whose regeneration THREW", async () => {
    regenerateMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ ok: true, value: { version_no: 9 } });
    scenario([
      { student_id: A, period_key: MONDAY, outcome: null },
      { student_id: B, period_key: MONDAY, outcome: null },
      { student_id: C, period_key: MONDAY, outcome: null },
    ]);

    const summary = await runWeeklyRegeneration();

    expect(summary.considered).toBe(3);
    expect(summary.failed).toBe(1);
    expect(summary.ok).toBe(2);
    expect(jobRuns).toHaveLength(3);
    expect(jobRuns[0]?.outcome).toBe("failed");
  });

  it("continues past a student the writer REFUSED, and records why", async () => {
    regenerateMock
      .mockResolvedValueOnce({ ok: false, error: { kind: "rejected", violations: ["V-05"] } })
      .mockResolvedValue({ ok: true, value: { version_no: 9 } });
    scenario([
      { student_id: A, period_key: MONDAY, outcome: null },
      { student_id: B, period_key: MONDAY, outcome: null },
    ]);

    const summary = await runWeeklyRegeneration();

    expect(summary.failed).toBe(1);
    expect(summary.ok).toBe(1);
    expect(jobRuns[0]?.detail).toEqual({ reason: "rejected" });
  });

  it("keeps running when the calendar_job_runs write itself fails", async () => {
    regenerateMock.mockResolvedValue({ ok: true, value: { version_no: 9 } });
    client = makeFakeClient({
      tables: {
        calendar_runtime_config: () => okReply(CONFIG_ROWS),
        calendar_job_runs: () => errReply("insert failed"),
      },
      rpcs: {
        calendar_weekly_candidates: () =>
          okReply([
            { student_id: A, period_key: MONDAY, outcome: null },
            { student_id: B, period_key: MONDAY, outcome: null },
          ]),
      },
    });

    // The plan may already be written when the bookkeeping row fails, so a bookkeeping
    // failure must not undo or abort the run.
    const summary = await runWeeklyRegeneration();

    expect(summary.ok).toBe(2);
  });
});

describe("the population read", () => {
  it("throws rather than reporting a clean pass it did not make", async () => {
    scenario([], { candidatesFail: true });

    await expect(runWeeklyRegeneration()).rejects.toThrow(/calendar_weekly_candidates/);
    expect(regenerateMock).not.toHaveBeenCalled();
  });

  it("bounds one invocation, and honours an explicit limit", async () => {
    regenerateMock.mockResolvedValue({ ok: true, value: { version_no: 9 } });
    scenario([]);

    await runWeeklyRegeneration({ limit: 25 });

    expect(client.rpcs[0]?.args.p_limit).toBe(25);
  });

  it("defaults the limit rather than leaving it unbounded", async () => {
    regenerateMock.mockResolvedValue({ ok: true, value: { version_no: 9 } });
    scenario([]);

    await runWeeklyRegeneration();

    expect(client.rpcs[0]?.args.p_limit).toBe(500);
  });
});
