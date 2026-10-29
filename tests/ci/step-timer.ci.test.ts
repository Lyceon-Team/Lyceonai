/**
 * The per-request step timer — one line per request, steps in order, overlap visible, nothing
 * else on the line.
 *
 * @spec [owner brief 2026-10-13 "first-run activation fixes" item 2 ("ONE structured log line per
 *        request (route, ordered step names with ms, total ms, requestId) ... No content, no ids
 *        beyond requestId"); Doc-01A_V1.0 §10; Coding Standards §12.1] | @implemented [2026-10-13]
 *
 * plain English: mounts a toy route under `timedRoute` whose steps run nested, in parallel and
 * outside any timed request, and asserts on the exact `logger.info` call. The same property
 * through the four real routes and the real logger's JSON sink is in
 * `hot-paths.timing.pg.ci.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const info = vi.fn();
vi.mock("../../server/logger", () => ({
  logger: { info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { beginParallelGroup, timedRoute, timedStep } =
  await import("../../server/lib/step-timer");

const SECRET_BODY_VALUE = "student-answer-C-and-a-stem";

function timingCalls(): Array<{ data: Record<string, unknown>; ctx: unknown }> {
  return info.mock.calls
    .filter((c) => c[0] === "PERF" && c[1] === "route_timing")
    .map((c) => ({ data: c[3] as Record<string, unknown>, ctx: c[4] }));
}

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function app(): express.Express {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.requestId = "req-timer-test";
    req.requestStartedAt = performance.now();
    next();
  });
  a.post(
    "/timed",
    timedRoute("practice.session_start", async (req, res) => {
      await timedStep("first", () => pause(5));
      await Promise.all([
        timedStep("left", () => pause(20)),
        timedStep("right", () => pause(20)),
      ]);
      res.status(201).json({ echoed: (req.body as { v: string }).v });
    }),
  );
  a.post(
    "/fails",
    timedRoute("calendar.read", async (_req, res) => {
      await timedStep("doomed", async () => {
        throw new Error("x");
      }).catch(() => res.status(500).json({ error: "x" }));
    }),
  );
  a.post(
    "/short-circuit",
    timedRoute("practice.answer_submit", async (_req, res) => {
      // Started in parallel, never awaited by the branch that answers.
      const early = timedStep("speculative", () => pause(40));
      res.status(404).json({ error: "not_found" });
      await early;
    }),
  );
  a.post(
    "/many",
    timedRoute("review.session_start", async (_req, res) => {
      for (let i = 0; i < 134; i += 1) await timedStep("loop", () => i);
      res.json({ ok: true });
    }),
  );
  return a;
}

describe("timedRoute / timedStep", () => {
  beforeEach(() => info.mockClear());

  it("emits exactly one route_timing line with ordered steps, overlap visible", async () => {
    const res = await request(app())
      .post("/timed")
      .send({ v: SECRET_BODY_VALUE });
    expect(res.status).toBe(201);

    const calls = timingCalls();
    expect(calls).toHaveLength(1);
    const { data, ctx } = calls[0]!;
    expect(ctx).toEqual({ requestId: "req-timer-test" });
    expect(Object.keys(data).sort()).toEqual(
      [
        "pre_handler_ms",
        "pre_steps",
        "route",
        "status",
        "step_count",
        "steps",
        "steps_dropped",
        "total_ms",
      ].sort(),
    );
    expect(data.route).toBe("practice.session_start");
    expect(data.status).toBe(201);
    expect(data.step_count).toBe(3);
    const steps = data.steps as Array<{
      step: string;
      ms: number;
      at_ms: number;
    }>;
    // Listed in START order, and every step finished before the response.
    expect(steps.map((s) => s.step)).toEqual(["first", "left", "right"]);
    for (const s of steps)
      expect(Object.keys(s).sort()).toEqual(["at_ms", "ms", "step"]);
    // The two parallel steps started together: their windows overlap.
    const [, left, right] = steps;
    expect(Math.abs(left!.at_ms - right!.at_ms)).toBeLessThan(10);
    expect(data.total_ms as number).toBeGreaterThanOrEqual(
      left!.at_ms + left!.ms - 1,
    );
    expect(typeof data.pre_handler_ms).toBe("number");
  });

  it("carries nothing from the request or the response", async () => {
    await request(app()).post("/timed").send({ v: SECRET_BODY_VALUE });
    const serialised = JSON.stringify(timingCalls());
    expect(serialised).not.toContain(SECRET_BODY_VALUE);
    expect(serialised).not.toContain("echoed");
  });

  it("records a step that throws, and still emits once with the final status", async () => {
    const res = await request(app()).post("/fails").send({});
    expect(res.status).toBe(500);
    const calls = timingCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.data.status).toBe(500);
    expect(calls[0]!.data.steps).toEqual([
      { step: "doomed", ms: expect.any(Number), at_ms: expect.any(Number) },
    ]);
  });

  it("a step still running when the response finished is listed with ms: null", async () => {
    const res = await request(app()).post("/short-circuit").send({});
    expect(res.status).toBe(404);
    await pause(60);
    const calls = timingCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.data.steps).toEqual([
      { step: "speculative", ms: null, at_ms: expect.any(Number) },
    ]);
  });

  it("caps the steps on one line and counts the overflow", async () => {
    await request(app()).post("/many").send({});
    const { data } = timingCalls()[0]!;
    expect(data.step_count).toBe(128);
    expect(data.steps_dropped).toBe(6);
  });

  it("outside a timed route, timedStep is a plain call and logs nothing", async () => {
    expect(await timedStep("solo", () => 42)).toBe(42);
    expect(timingCalls()).toHaveLength(0);
  });
});

/**
 * @spec [owner brief "H3: parallelise the pre-model work" (Karl, 2026-10-29): "route_timing keeps
 *        every step, adds a parallel-group marker, and records each step's own duration plus the
 *        group's wall time"] | @implemented [2026-10-29]
 */
describe("beginParallelGroup", () => {
  beforeEach(() => info.mockClear());

  function groupApp(): express.Express {
    const a = express();
    a.use((req, _res, next) => {
      req.requestId = "req-group-test";
      req.requestStartedAt = performance.now();
      next();
    });
    a.get(
      "/group",
      timedRoute("tutor.message", async (_req, res) => {
        await timedStep("before", () => pause(2));
        const group = beginParallelGroup("pre_model");
        const fast = group.step("fast", () => pause(10));
        const slow = group.step("slow", () => pause(40));
        // A member that waits for another before it starts: its own ms excludes the wait.
        const after = fast.then(() =>
          group.step("after_fast", () => pause(10)),
        );
        const failing = group.step("failing", async () => {
          await pause(5);
          throw new Error("member failed");
        });
        const failed = failing.then(
          () => false,
          () => true,
        );
        group.closeWhen([fast, slow, after, failing]);
        await Promise.all([fast, slow, after, failed]);
        await pause(1);
        res.status(200).json({ ok: true });
      }),
    );
    return a;
  }

  it("one group record with its wall time; members keep their own name, ms and start, tagged", async () => {
    const res = await request(groupApp()).get("/group");
    expect(res.status).toBe(200);
    await pause(5);
    const [call] = timingCalls();
    expect(call).toBeDefined();
    const steps = call!.data.steps as Array<Record<string, unknown>>;
    const byName = new Map(steps.map((s) => [s.step as string, s]));
    const group = byName.get("pre_model")!;
    expect(group.kind).toBe("parallel_group");
    expect("group" in group).toBe(false);
    for (const name of ["fast", "slow", "after_fast", "failing"]) {
      expect(byName.get(name)?.group).toBe("pre_model");
    }
    // Ordinary steps are untouched.
    expect(Object.keys(byName.get("before")!).sort()).toEqual([
      "at_ms",
      "ms",
      "step",
    ]);
    const ms = (name: string): number => byName.get(name)!.ms as number;
    const at = (name: string): number => byName.get(name)!.at_ms as number;
    // Offsets and durations are each rounded to 0.1 ms, so a comparison of two of them, or of a
    // sum, may be off by up to that much.
    const ROUNDING = 0.1;
    // Wall time: from the group's start to the last member's end — at least the slowest member,
    // and less than the members' sum (they overlapped).
    expect(ms("pre_model")).toBeGreaterThanOrEqual(ms("slow") - ROUNDING);
    expect(ms("pre_model")).toBeLessThan(
      ms("fast") + ms("slow") + ms("after_fast") + ms("failing"),
    );
    // The dependent member started after the one it waited for, and its ms is its own (~10).
    expect(at("after_fast")).toBeGreaterThanOrEqual(
      at("fast") + ms("fast") - ROUNDING,
    );
    expect(ms("after_fast")).toBeLessThan(ms("slow"));
    // A member that failed is recorded with its real duration.
    expect(typeof ms("failing")).toBe("number");
  });

  it("outside a timed route, members simply run and nothing is logged", async () => {
    const group = beginParallelGroup("pre_model");
    const value = group.step("solo", () => 7);
    group.closeWhen([value]);
    expect(await value).toBe(7);
    expect(timingCalls()).toHaveLength(0);
  });
});
