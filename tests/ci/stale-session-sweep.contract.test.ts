/**
 * @spec [Doc-02B_V4 §14 session lifecycle; Doc-01A_V1.0 §18; owner rulings Q1,
 *        Q2 + Q4, 2026-08-17] | @implemented [2026-08-17]
 *
 * plain English: proves the two scheduled jobs added by steps 10 and 8 — the
 * stale practice-session sweep and the baseline_pending staleness alert.
 *
 * WHY A RECORDING CLIENT AND NOT A REGEX OVER THE SOURCE
 *   The property that matters for the sweep is a query PREDICATE, and the only
 *   thing that proves a predicate was issued is issuing it. A source grep for
 *   `.neq("mode", "diagnostic")` passes whether or not that call is on the chain
 *   that actually runs. The fake client below records the real chain the real
 *   function builds, so removing the exclusion fails the test for the same reason
 *   it would break production.
 */
import { describe, it, expect } from "vitest";
import {
  sweepStalePracticeSessions,
  staleSessionCutoff,
  STALE_PRACTICE_SESSION_TTL_DAYS,
} from "../../server/lib/stale-session-sweep";
import {
  selectStaleBaselinePending,
  BASELINE_PENDING_STALE_SECONDS,
  type BaselinePendingRow,
} from "../../server/lib/baseline-pending";

type Call = { fn: string; args: unknown[] };

function recordingClient(rows: Array<{ id: string }>) {
  const calls: Call[] = [];
  let table = "";
  const chain: Record<string, unknown> = {};
  for (const fn of ["update", "in", "neq", "lt", "eq"]) {
    chain[fn] = (...args: unknown[]) => {
      calls.push({ fn, args });
      return chain;
    };
  }
  chain.select = (...args: unknown[]) => {
    calls.push({ fn: "select", args });
    return Promise.resolve({ data: rows, error: null });
  };
  return {
    calls,
    table: () => table,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double for SupabaseClient
    client: {
      from: (t: string) => {
        table = t;
        return chain;
      },
    } as any,
  };
}

const NOW = new Date("2026-08-17T12:00:00.000Z");

describe("stale practice-session sweep (step 10)", () => {
  it("uses a seven-day window on last_activity_at", () => {
    expect(STALE_PRACTICE_SESSION_TTL_DAYS).toBe(7);
    expect(staleSessionCutoff(NOW)).toBe("2026-08-10T12:00:00.000Z");
  });

  /**
   * THE SAFETY PROPERTY (ruling Q1). A diagnostic is taken once; sweeping an
   * in-flight one would take a student's single baseline attempt away for being
   * idle. MUTATION: delete the .neq("mode", "diagnostic") line — this reds.
   */
  it("excludes diagnostics from the sweep", async () => {
    const rec = recordingClient([{ id: "s1" }]);
    await sweepStalePracticeSessions(rec.client, { now: NOW });

    const neq = rec.calls.find((c) => c.fn === "neq");
    expect(neq, "the sweep issued no mode exclusion at all").toBeDefined();
    expect(neq?.args).toEqual(["mode", "diagnostic"]);
  });

  it("touches only resumable sessions, idle past the cutoff", async () => {
    const rec = recordingClient([{ id: "s1" }, { id: "s2" }]);
    const result = await sweepStalePracticeSessions(rec.client, { now: NOW });

    expect(rec.table()).toBe("practice_sessions");
    expect(rec.calls.find((c) => c.fn === "in")?.args).toEqual([
      "status",
      ["created", "active"],
    ]);
    expect(rec.calls.find((c) => c.fn === "lt")?.args).toEqual([
      "last_activity_at",
      "2026-08-10T12:00:00.000Z",
    ]);
    expect(result.sweptCount).toBe(2);
  });

  /**
   * BUG-4 must not come back through the side door. The sweep is the second
   * writer of status='abandoned'; if it stamped completed_at it would reintroduce
   * the defect step 9 just removed — and the CHECK constraint would reject the
   * whole statement, so the sweep would silently never work.
   */
  it("writes abandoned_at and clears completed_at", async () => {
    const rec = recordingClient([]);
    await sweepStalePracticeSessions(rec.client, { now: NOW });

    const patch = rec.calls.find((c) => c.fn === "update")?.args[0] as Record<
      string,
      unknown
    >;
    expect(patch.status).toBe("abandoned");
    expect(patch.abandoned_at).toBe("2026-08-17T12:00:00.000Z");
    expect(patch.completed_at).toBeNull();
  });

  it("surfaces a database error rather than reporting a clean run", async () => {
    const failing = {
      from: () => {
        const chain: Record<string, unknown> = {};
        for (const fn of ["update", "in", "neq", "lt"]) {
          chain[fn] = () => chain;
        }
        chain.select = () =>
          Promise.resolve({ data: null, error: { message: "boom" } });
        return chain;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double
    } as any;

    await expect(
      sweepStalePracticeSessions(failing, { now: NOW }),
    ).rejects.toThrow(/stale_session_sweep_failed/);
  });
});

describe("baseline_pending staleness (step 8)", () => {
  const row = (
    student_id: string,
    pending_seconds: number | null,
  ): BaselinePendingRow => ({
    student_id,
    diagnostic_finished_at: "2026-08-10T00:00:00.000Z",
    baseline_scored_sections: 0,
    pending_seconds,
  });

  it("uses a 24-hour threshold", () => {
    expect(BASELINE_PENDING_STALE_SECONDS).toBe(86_400);
  });

  /**
   * The alert must not fire on a healthy completion. Every student is pending for
   * the seconds between their last answer and the projection refresh; an alert on
   * count > 0 is an alert that gets muted.
   */
  it("does not flag a freshly-completed diagnostic", () => {
    const report = selectStaleBaselinePending([row("fresh", 30)]);
    expect(report.pendingCount).toBe(1);
    expect(report.staleCount).toBe(0);
  });

  it("flags a student pending past the threshold, oldest first", () => {
    const report = selectStaleBaselinePending([
      row("a", 90_000),
      row("fresh", 5),
      row("b", 900_000),
    ]);
    expect(report.staleCount).toBe(2);
    expect(report.stale.map((r) => r.student_id)).toEqual(["b", "a"]);
    expect(report.oldestPendingSeconds).toBe(900_000);
  });

  it("treats an unknown age as not stale", () => {
    const report = selectStaleBaselinePending([row("unknown", null)]);
    expect(report.staleCount).toBe(0);
    expect(report.pendingCount).toBe(1);
  });

  it("reports a clean platform as clean", () => {
    const report = selectStaleBaselinePending([]);
    expect(report).toMatchObject({
      pendingCount: 0,
      staleCount: 0,
      oldestPendingSeconds: null,
    });
  });
});

describe("both jobs are scheduled by the existing Vercel cron", () => {
  it("vercel.json drives them — no second scheduler", async () => {
    const { readFileSync } = await import("node:fs");
    const cfg = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const paths = cfg.crons.map((c) => c.path);
    expect(paths).toContain("/api/internal/stale-session-sweep");
    expect(paths).toContain("/api/internal/baseline-pending-sweep");
  });

  it("both endpoints are cron-authorized and fail closed", async () => {
    const src = (await import("node:fs")).readFileSync(
      "server/routes/internal-cron-routes.ts",
      "utf8",
    );
    for (const route of ["stale-session-sweep", "baseline-pending-sweep"]) {
      const at = src.indexOf(`"/${route}"`);
      expect(at, `${route} route not found`).toBeGreaterThan(-1);
      const body = src.slice(at, at + 400);
      expect(body).toContain("cronAuthorized(req)");
      expect(body).toContain("404");
    }
  });
});
