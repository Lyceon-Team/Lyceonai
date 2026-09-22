/**
 * CalendarLaunchService — the §15.1 sequence.
 *
 * @spec [Doc-05F_V1.0 §15.1 (INV-08-18), §13, §12.2] | @implemented [2026-09-21]
 *
 * The three guarantees §15.1 names, plus the refusals. The crash-retry case is the
 * one that matters: a failure between creating the engine session and recording the
 * launch must heal on retry into ONE session and ONE launch row, and it does that by
 * recomputing the SAME idempotency key — which only holds because `seq` is derived
 * from the stored launch rows rather than from a counter the crash took with it.
 */
import { describe, expect, it } from "vitest";
import { ok, err, type ActivityUnit, type PlanBlock } from "@lyceon/shared";
import {
  launchBlock,
  launchIdempotencyKey,
  type ExistingLaunch,
  type LaunchDeps,
} from "../../server/services/calendar/launch-service";
import type { CalendarEngineAdapter } from "../../server/services/calendar/adapters/types";

const STUDENT = "11111111-1111-1111-1111-111111111111";
const BLOCK_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TODAY = "2026-09-21";

const BLOCK: PlanBlock = {
  block_id: BLOCK_ID,
  scheduled_date: TODAY,
  block_type: "practice",
  section: "M",
  scope: { level: "domain", mix: [{ domain: "Algebra", count: 20, explanation_key: "weak" }] },
  target_count: 20,
  source: "auto",
  derived_from_block_id: null,
  explanation_key: "weighted",
  display_ordinal: 1,
  membership_type: "created",
};

function unit(n: number): ActivityUnit {
  return {
    engine: "practice",
    unit_id: `u-${n}`,
    occurred_at: `2026-09-21T1${n % 10}:00:00Z`,
    local_date: TODAY,
    section: "M",
    domain: "Algebra",
    form_id: null,
  };
}

type Harness = {
  deps: LaunchDeps;
  createCalls: { size: number; key: string }[];
  linkCalls: { sessionId: string }[];
  launches: ExistingLaunch[];
  sessions: Map<string, "active" | "completed" | "abandoned">;
};

function harness(options: {
  block?: PlanBlock;
  units?: ActivityUnit[];
  localToday?: string;
  createFails?: "unavailable" | "error";
  /** Throw after the engine session exists but before the link is recorded. */
  crashBeforeLink?: boolean;
} = {}): Harness {
  const block = options.block ?? BLOCK;
  const launches: ExistingLaunch[] = [];
  const sessions = new Map<string, "active" | "completed" | "abandoned">();
  const createCalls: { size: number; key: string }[] = [];
  const linkCalls: { sessionId: string }[] = [];

  // One engine session per idempotency key — the engine's own replay contract.
  const sessionsByKey = new Map<string, string>();

  const adapter: CalendarEngineAdapter = {
    engine: "practice",
    async create(_b, size, ctx) {
      createCalls.push({ size, key: ctx.idempotency_key });
      if (options.createFails === "unavailable") {
        return err({ reason: "engine_unavailable", detail: "not shipped" });
      }
      if (options.createFails === "error") {
        return err({ reason: "engine_error", status: 403, detail: "session_limit_exceeded" });
      }
      const existing = sessionsByKey.get(ctx.idempotency_key);
      if (existing !== undefined) {
        return ok({ session_id: existing, next: `/practice/session/${existing}`, resumed: true });
      }
      const id = `sess-${sessionsByKey.size + 1}`;
      sessionsByKey.set(ctx.idempotency_key, id);
      sessions.set(id, "active");
      return ok({ session_id: id, next: `/practice/session/${id}`, resumed: false });
    },
    async activityUnits() { return []; },
    async progress(sessionId) { return sessions.get(sessionId) ?? null; },
    async nextLaunchSize(_b, remaining) { return remaining; },
  };

  const deps: LaunchDeps = {
    async loadBlockContext() {
      return {
        block,
        dayBlocks: [block],
        timezone: "America/Chicago",
        localToday: options.localToday ?? TODAY,
      };
    },
    async activityUnits() { return options.units ?? []; },
    async latestLaunch() {
      return launches.length === 0 ? null : (launches[launches.length - 1] ?? null);
    },
    async linkLaunch(_s, blockId, engine, sessionId) {
      linkCalls.push({ sessionId });
      if (options.crashBeforeLink === true) throw new Error("crash between create and link");
      const replayed = launches.find((l) => l.engine_session_id === sessionId);
      if (replayed !== undefined) {
        return ok({ launch_sequence: replayed.launch_sequence, replayed: true });
      }
      const seq = launches.length + 1;
      launches.push({ launch_sequence: seq, engine, engine_session_id: sessionId });
      void blockId;
      return ok({ launch_sequence: seq, replayed: false });
    },
    adapterFor() { return adapter; },
  };

  return { deps, createCalls, linkCalls, launches, sessions };
}

const REQ = {
  student_id: STUDENT,
  actor_id: STUDENT,
  role: "student",
  block_id: BLOCK_ID,
  client_instance_id: "ci-1",
  platform: "web" as const,
};

describe("§15.1 — the happy path", () => {
  it("creates one session and records one launch", async () => {
    const h = harness();
    const result = await launchBlock(REQ, h.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resumed).toBe(false);
    expect(result.value.next).toBe("/practice/session/sess-1");
    expect(h.launches).toHaveLength(1);
    expect(h.createCalls).toHaveLength(1);
  });

  it("builds the key as calendar:block:<block_id>:<seq>, and owns that format", async () => {
    const h = harness();
    await launchBlock(REQ, h.deps);
    expect(h.createCalls[0]?.key).toBe(`calendar:block:${BLOCK_ID}:1`);
    expect(h.createCalls[0]?.key).toBe(launchIdempotencyKey(BLOCK_ID, 1));
  });

  it("asks the engine for the OUTSTANDING work, not the block target", async () => {
    const h = harness({ units: [unit(1), unit(2), unit(3), unit(4), unit(5)] });
    await launchBlock(REQ, h.deps);
    // 20 planned, 5 answered -> 15 outstanding.
    expect(h.createCalls[0]?.size).toBe(15);
  });
});

describe("§15.1 step 3 — a live session is handed back", () => {
  it("returns resumed:true and never touches the engine's create", async () => {
    const h = harness();
    await launchBlock(REQ, h.deps);
    const second = await launchBlock(REQ, h.deps);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.resumed).toBe(true);
    expect(second.value.session_id).toBe("sess-1");
    expect(h.createCalls).toHaveLength(1);
    expect(h.launches).toHaveLength(1);
  });

  it("a finished session does NOT resume — it launches the next sequence", async () => {
    const h = harness();
    await launchBlock(REQ, h.deps);
    h.sessions.set("sess-1", "completed");
    const second = await launchBlock(REQ, h.deps);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.resumed).toBe(false);
    expect(h.createCalls[1]?.key).toBe(`calendar:block:${BLOCK_ID}:2`);
    expect(h.launches).toHaveLength(2);
  });
});

describe("§15.1 — the crash between create and link heals on retry", () => {
  it("one engine session and one launch row, because the key is recomputed", async () => {
    const crashing = harness({ crashBeforeLink: true });
    await expect(launchBlock(REQ, crashing.deps)).rejects.toThrow("crash between create and link");
    // The engine session exists; the launch row does not.
    expect(crashing.createCalls).toHaveLength(1);
    expect(crashing.launches).toHaveLength(0);
    const keyBefore = crashing.createCalls[0]?.key;

    // The retry runs against the same state: still no launch row, so seq is still 1.
    const retry = harness();
    await launchBlock(REQ, retry.deps);
    expect(retry.createCalls[0]?.key).toBe(keyBefore);
    expect(retry.launches).toHaveLength(1);
    expect(retry.launches[0]?.launch_sequence).toBe(1);
  });

  it("the same key returns the SAME engine session rather than a second one", async () => {
    const h = harness();
    const first = await launchBlock(REQ, h.deps);
    // Simulate the link never having landed: drop the row, keep the session.
    h.launches.length = 0;
    const second = await launchBlock(REQ, h.deps);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.session_id).toBe(first.value.session_id);
    expect(h.createCalls[0]?.key).toBe(h.createCalls[1]?.key);
    expect(h.launches).toHaveLength(1);
  });
});

describe("§15.1 — refusals", () => {
  it("404 when the block is not this student's", async () => {
    const deps = { ...harness().deps, loadBlockContext: async () => null };
    const result = await launchBlock(REQ, deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not_found");
  });

  it("409 for a past date — that routes to Do it now, not to a launch", async () => {
    const h = harness({ localToday: "2026-09-22" });
    const result = await launchBlock(REQ, h.deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ kind: "not_today", when: "past" });
    expect(h.createCalls).toHaveLength(0);
  });

  it("409 for a future date — view-only, because studying ahead is not a launch", async () => {
    const h = harness({ localToday: "2026-09-20" });
    const result = await launchBlock(REQ, h.deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ kind: "not_today", when: "future" });
  });

  it("409 already_complete when the allocator says nothing is outstanding", async () => {
    const h = harness({ units: Array.from({ length: 20 }, (_, i) => unit(i)) });
    const result = await launchBlock(REQ, h.deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ kind: "already_complete", target: 20, actual: 20 });
    expect(h.createCalls).toHaveLength(0);
  });

  it("a stubbed engine fails OPEN — engine_unavailable, never a throw", async () => {
    const h = harness({ createFails: "unavailable" });
    const result = await launchBlock(REQ, h.deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ kind: "engine_unavailable", engine: "practice" });
    expect(h.launches).toHaveLength(0);
  });

  it("an engine refusal carries its status through for the route to mirror", async () => {
    const h = harness({ createFails: "error" });
    const result = await launchBlock(REQ, h.deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ kind: "engine_error", status: 403 });
    expect(h.launches).toHaveLength(0);
  });

  it("progress is the allocator's, never the launch rows — a launch is not progress", async () => {
    // Two launches recorded, nothing answered: still 20 outstanding.
    const h = harness();
    await launchBlock(REQ, h.deps);
    h.sessions.set("sess-1", "abandoned");
    await launchBlock(REQ, h.deps);
    expect(h.launches).toHaveLength(2);
    expect(h.createCalls[1]?.size).toBe(20);
  });
});
