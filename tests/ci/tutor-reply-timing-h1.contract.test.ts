/**
 * @spec [owner brief "P2 Revised: Cut the Wait Without Streaming" (Karl, 2026-10-23) §2 H1: "Extend
 *        route_timing across the whole reply path: every model call, every safety check, every
 *        database round trip, time-to-first-visible-text, total ... No message content in logs";
 *        server/lib/step-timer.ts; Coding Standards §12.1] | @implemented [2026-10-23]
 *
 * plain English: the H1 additions to the one `route_timing` line, each through its real producer.
 *  - Database round trips: a REAL supabase-js client, built with `timedFetch` exactly as
 *    `apps/api/src/lib/supabase-server.ts` builds it, issues a filtered read, an insert and an rpc
 *    under a timed route that opted in. Each becomes `db.<op>.<target>`; the filter value, the
 *    inserted value and the rpc argument (all in the URL or body supabase-js produced) never
 *    reach the line. A route that did not opt in records no db steps.
 *  - The worker: the REAL worker response builder, given a REAL `VertexAttemptTimings`, produces
 *    the body; the REAL BFF client parses and scans it under a timed route. The line carries
 *    `worker_token`, `worker_request`, `worker_response_read`, `worker_handler`, one
 *    `worker_vertex_attempt` per attempt and `antileak_scan`; the reply's text is not in it, and
 *    the response the route receives no longer carries `timing` (stripped at the client).
 *  - The turn-timing beacon's server side: a valid report logs exactly its three fields; an extra
 *    field, a non-uuid id or an out-of-range number is refused and logs nothing; no user is 401;
 *    and the mount in server/index.ts carries the tutor mount's gates with its own limiter. (The
 *    client side, end to end, is client/src/pages/chat.turn-timing.contract.test.tsx.)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import request from "supertest";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => ({ info: [] as unknown[][] }));
vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn((...args: unknown[]) => {
      logged.info.push(args);
    }),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("../../server/services/tutor-config", () => ({
  TutorConfig: { get: vi.fn().mockReturnValue(30) },
}));

import {
  databaseTripStepName,
  timedFetch,
  timedRoute,
} from "../../server/lib/step-timer";
import { buildOrchestrateResponse } from "../../apps/workers/tutor-orchestrator/src/routes/orchestrate";
import { VertexAttemptTimings } from "../../apps/workers/tutor-orchestrator/src/lib/vertex-client";
import { orchestrateTurn } from "../../server/lib/tutor-orchestrator-client";
import { postTutorTurnTiming } from "../../server/routes/tutor-turn-timing";
import { orchestrateRequestSchema } from "../../shared/tutor-orchestrator-wire";
import { CASE_36 } from "./lisa-golden-set-fixtures";

type Step = { step: string; ms: number | null; at_ms: number };

function timingLine(): { steps: Step[]; serialised: string } {
  const lines = logged.info.filter(
    (args) => args[0] === "PERF" && args[1] === "route_timing",
  );
  expect(lines).toHaveLength(1);
  const data = lines[0]![3] as { steps: Step[] };
  return { steps: data.steps, serialised: JSON.stringify(data) };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  logged.info.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("databaseTripStepName: a step name is an operation and a schema identifier, never a value", () => {
  const BASE = "https://proj.supabase.co";
  it.each([
    [
      "GET",
      "/rest/v1/tutor_messages?select=*&id=eq.secret",
      "db.read.tutor_messages",
    ],
    ["HEAD", "/rest/v1/questions?id=eq.x", "db.read.questions"],
    ["POST", "/rest/v1/tutor_messages", "db.insert.tutor_messages"],
    [
      "PATCH",
      "/rest/v1/tutor_conversations?id=eq.x",
      "db.update.tutor_conversations",
    ],
    ["DELETE", "/rest/v1/tutor_messages?id=eq.x", "db.delete.tutor_messages"],
    ["POST", "/rest/v1/rpc/entitlement_active", "db.rpc.entitlement_active"],
    ["GET", "/rest/v1/Robert%27);DROP", "db.read.other"],
    ["GET", "/rest/v1/a/b", "db.other.other"],
    ["POST", "/auth/v1/token?grant_type=refresh_token", "db.auth.other"],
    ["GET", "/storage/v1/object/x", "db.other.other"],
  ])("%s %s → %s", (method, path, expected) => {
    expect(databaseTripStepName(`${BASE}${path}`, method)).toBe(expected);
  });
  it("an unparseable URL is `db.other.other`", () => {
    expect(databaseTripStepName("not a url", "GET")).toBe("db.other.other");
  });
});

describe("database round trips through a real supabase-js client", () => {
  const SECRET_FILTER = "student-answer-SECRET-FILTER";
  const SECRET_ROW = "student-message-SECRET-ROW";
  const SECRET_ARG = "SECRET-RPC-ARG";

  function app(databaseTrips: boolean): express.Express {
    const calls: string[] = [];
    const stub = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input instanceof Request ? input.url : input));
      return new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const client = createClient("https://proj.supabase.co", "service-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: timedFetch((input, init) => stub(input, init)) },
    });
    const a = express();
    a.post(
      "/turn",
      timedRoute(
        "tutor.message",
        async (_req, res) => {
          await client
            .from("tutor_messages")
            .select("id")
            .eq("message", SECRET_FILTER);
          await client.from("tutor_messages").insert({ message: SECRET_ROW });
          await client.rpc("entitlement_active", { p_note: SECRET_ARG });
          // Presence: supabase-js really put the values on the wire.
          expect(calls.join(" ")).toContain(SECRET_FILTER);
          res.json({ ok: true });
        },
        { databaseTrips },
      ),
    );
    return a;
  }

  it("opted in: one step per trip, by operation and table/function, values absent", async () => {
    const res = await request(app(true)).post("/turn").send({});
    expect(res.status).toBe(200);
    await settle();
    const { steps, serialised } = timingLine();
    expect(steps.map((s) => s.step)).toEqual([
      "db.read.tutor_messages",
      "db.insert.tutor_messages",
      "db.rpc.entitlement_active",
    ]);
    for (const s of steps) expect(typeof s.ms).toBe("number");
    for (const value of [
      SECRET_FILTER,
      SECRET_ROW,
      SECRET_ARG,
      "service-key",
    ]) {
      expect(serialised).not.toContain(value);
    }
  });

  it("not opted in: the same trips record no steps", async () => {
    await request(app(false)).post("/turn").send({});
    await settle();
    expect(timingLine().steps).toEqual([]);
  });
});

describe("the worker's timings, through the real worker builder and the real BFF client", () => {
  const savedEnv = { ...process.env };
  const REPLY = "Think about what undoes multiplying both sides by three.";
  const req = orchestrateRequestSchema.parse(CASE_36.request);

  beforeEach(() => {
    process.env = {
      ...savedEnv,
      TUTOR_ORCHESTRATOR_WORKER_URL: "http://localhost:9",
    };
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  function workerReplies(attempts: number): void {
    const origin = performance.now();
    const timings = new VertexAttemptTimings(origin);
    for (let i = 0; i < attempts; i += 1) timings.record(performance.now());
    const body = buildOrchestrateResponse(
      { text: REPLY, providerModel: "test-model" } as Parameters<
        typeof buildOrchestrateResponse
      >[0],
      req,
      "lisa-default-v3",
      {
        worker_ms: performance.now() - origin,
        vertex_attempts: timings.attempts,
      },
    );
    // Presence: the real builder put the timing on the wire.
    expect(body.orchestration_meta.timing?.vertex_attempts).toHaveLength(
      attempts,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
  }

  function app(seen: {
    meta?: Record<string, unknown>;
    content?: string;
  }): express.Express {
    const a = express();
    a.post(
      "/turn",
      timedRoute("tutor.message", async (_req, res) => {
        const result = await orchestrateTurn(req, false, null);
        if (result.ok) {
          seen.meta = result.value.orchestration_meta;
          seen.content = result.value.response.content;
        }
        res.json({ ok: result.ok });
      }),
    );
    return a;
  }

  it("the line carries the worker, every Vertex attempt and the anti-leak scan; not the reply", async () => {
    workerReplies(2);
    const seen: { meta?: Record<string, unknown>; content?: string } = {};
    await request(app(seen)).post("/turn").send({});
    await settle();

    expect(seen.content).toBe(REPLY);
    const { steps, serialised } = timingLine();
    expect(steps.map((s) => s.step)).toEqual([
      "worker_token",
      "worker_request",
      "worker_handler",
      "worker_vertex_attempt",
      "worker_vertex_attempt",
      "worker_response_read",
      "antileak_scan",
    ]);
    for (const s of steps) expect(typeof s.ms).toBe("number");
    // The worker's steps sit inside the request that carried them.
    const sent = steps.find((s) => s.step === "worker_request")!;
    const handler = steps.find((s) => s.step === "worker_handler")!;
    expect(handler.at_ms).toBeGreaterThanOrEqual(sent.at_ms);
    expect(serialised).not.toContain(REPLY);
    expect(serialised).not.toContain("lisa-default-v3");
  });

  it("the response the route receives no longer carries `timing`", async () => {
    workerReplies(1);
    const seen: { meta?: Record<string, unknown>; content?: string } = {};
    await request(app(seen)).post("/turn").send({});
    expect(seen.meta).toBeDefined();
    expect(seen.meta).not.toHaveProperty("timing");
    expect(seen.meta).toMatchObject({ model_name: "test-model" });
  });
});

describe("POST /api/perf/tutor-turn: numbers only, refused otherwise", () => {
  const BODY = {
    request_id: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b",
    post_ms: 5123.4,
    visible_ms: 5390.1,
  };

  function beaconApp(user: boolean): express.Express {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      if (user) {
        (req as unknown as { user: { id: string } }).user = { id: "student" };
      }
      next();
    });
    a.post("/api/perf/tutor-turn", postTutorTurnTiming);
    return a;
  }

  function beaconLines(): unknown[][] {
    return logged.info.filter(
      (args) => args[0] === "PERF" && args[1] === "tutor_turn_visible",
    );
  }

  it("a valid report → 204 and one line with exactly the three parsed fields", async () => {
    const res = await request(beaconApp(true))
      .post("/api/perf/tutor-turn")
      .send(BODY);
    expect(res.status).toBe(204);
    expect(beaconLines()).toHaveLength(1);
    expect(beaconLines()[0]![3]).toEqual({
      turn_request_id: BODY.request_id,
      post_ms: BODY.post_ms,
      visible_ms: BODY.visible_ms,
    });
  });

  it.each([
    [
      "an extra field (content cannot ride along)",
      { ...BODY, message: "my answer is B" },
    ],
    ["a non-uuid request id", { ...BODY, request_id: "my answer is B" }],
    ["a negative number", { ...BODY, post_ms: -1 }],
    ["an absurd number", { ...BODY, visible_ms: 600_001 }],
  ])("%s → 400 and nothing logged", async (_name, body) => {
    const res = await request(beaconApp(true))
      .post("/api/perf/tutor-turn")
      .send(body);
    expect(res.status).toBe(400);
    expect(beaconLines()).toHaveLength(0);
  });

  it("no authenticated user → 401 and nothing logged", async () => {
    const res = await request(beaconApp(false))
      .post("/api/perf/tutor-turn")
      .send(BODY);
    expect(res.status).toBe(401);
    expect(beaconLines()).toHaveLength(0);
  });

  it("the mount carries auth, the student-only gate and CSRF, and its own limiter — not the tutor one", () => {
    const index = readFileSync(
      resolve(__dirname, "../../server/index.ts"),
      "utf8",
    );
    const mount = /app\.use\(\s*"\/api\/perf",([^)]*)\)/.exec(index);
    expect(mount).not.toBeNull();
    const gates = mount![1]!
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean);
    expect(gates).toEqual([
      "perfBeaconLimiter",
      "requireSupabaseAuth",
      "requireStudentOnly",
      "doubleCsrfProtection",
      "tutorTurnTimingRouter",
    ]);
  });
});
