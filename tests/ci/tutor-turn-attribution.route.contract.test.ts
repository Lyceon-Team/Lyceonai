/**
 * @spec [owner brief "Per-turn attribution: tokens, thinking, cache and prompt version" (Karl,
 *        2026-10-27) items 2–3 and rulings 2–5; SCL-246; Doc 03 §24; Doc 03D §8.1]
 *        | @implemented [2026-10-27]
 *
 * plain English: one LISA turn end to end — the REAL tutor route, the REAL orchestrator client,
 * the REAL worker `/turn` handler (reached through the client's `fetch`) — with only the Google SDK,
 * the database (in memory) and the crisis classifier replaced. What lands in `tutor_turn_metrics`:
 *  - a model-call turn writes the turn's summed tokens, thinking tokens, the thinking budget, the
 *    resolved prompt version and cache_hit = (cached tokens > 0);
 *  - a safety-blocked turn (billed, no reply) writes its billed usage too (ruling 5, reversed);
 *  - a crisis-bypass turn (no model call) writes null counts, never 0;
 *  - `tutor_instruction_assignments` is written exactly as before: prompt_version null
 *    (ruling 3 — it stays as written).
 */
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTutorDb } from "../helpers/fake-tutor-db";
import { CASE_36 } from "./lisa-golden-set-fixtures";

const db = { current: new FakeTutorDb() };
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return db.current.client();
  },
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: {
    isEntitlementActiveForProfile: vi.fn(async () => true),
  },
}));
// A schema-valid envelope (the golden-set case), so the real worker accepts it.
vi.mock("../../server/services/tutor-context", () => ({
  resolveFullEnvelope: vi.fn(async () => structuredClone(CASE_36.request)),
}));
vi.mock("../../server/services/tutor-memory", () => ({
  getRecentMessages: vi.fn(async () => []),
}));
const runCrisisClassifier = vi.fn();
vi.mock("../../server/services/tutor-crisis", () => ({
  runCrisisClassifier: (...args: unknown[]) => runCrisisClassifier(...args),
  getCrisisResponse: vi.fn(() => "crisis resources"),
  flagConversationForReview: vi.fn(async () => ({ ok: true })),
  notifyCrisisEvent: vi.fn(async () => undefined),
  evaluateNotificationPolicy: vi.fn(() => ({
    shouldNotify: false,
    suppressionReason: "test",
  })),
}));
const persistInstructionAssignment = vi.fn();
vi.mock("../../server/services/tutor-runtime-writer", () => ({
  persistInstructionAssignment: (...args: unknown[]) =>
    persistInstructionAssignment(...args),
}));
vi.mock("../../server/services/cloud-tasks-enqueue", () => ({
  enqueueCloudTask: vi.fn(async () => undefined),
}));
const generateContent = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", async () => {
  const actual =
    await vi.importActual<typeof import("@google/genai")>("@google/genai");
  return {
    ...actual,
    GoogleGenAI: class {
      models = { generateContent };
    },
  };
});

import tutorRuntimeRouter from "../../server/routes/tutor-runtime";
import { orchestrateRouter } from "../../apps/workers/tutor-orchestrator/src/routes/orchestrate";

const STUDENT_ID = "55555555-5555-4555-8555-555555555555";
const REPLY = "Which side of the equation would you undo first?";
const savedEnv = { ...process.env };

function app(): express.Express {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as unknown as { user: { id: string; role: string } }).user = {
      id: STUDENT_ID,
      role: "student",
    };
    next();
  });
  a.use("/api/tutor", tutorRuntimeRouter);
  return a;
}

/** The real worker, reached through the orchestrator client's own `fetch`. */
function workerBehindFetch(): void {
  const worker = express();
  worker.use(express.json());
  worker.use("/orchestrate", orchestrateRouter);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const res = await request(worker)
        .post(url.pathname)
        .set("Content-Type", "application/json")
        .send(String(init?.body ?? "{}"));
      return new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

function seedConversation(): string {
  return db.current.seed("tutor_conversations", {
    student_id: STUDENT_ID,
    entry_mode: "general",
    source_surface: "dashboard",
    surface: "standalone",
    source_session_id: null,
    source_session_item_id: null,
    source_question_row_id: null,
    source_question_canonical_id: null,
    status: "active",
    crisis_flagged: false,
    deleted_at: null,
    updated_at: "2026-10-27T00:00:00.000Z",
    closed_at: null,
    title: "New session",
    crisis_paused_at: null,
    ended_at: null,
  }).id as string;
}

async function oneTurn(): Promise<request.Response> {
  const convId = seedConversation();
  return request(app()).post("/api/tutor/messages").send({
    conversation_id: convId,
    message: "how do I start this one",
    client_turn_id: crypto.randomUUID(),
  });
}

function metricsRows(): Array<Record<string, unknown>> {
  return db.current.rows("tutor_turn_metrics");
}

beforeEach(() => {
  db.current = new FakeTutorDb();
  process.env = {
    ...savedEnv,
    TUTOR_ORCHESTRATOR_WORKER_URL: "http://worker.test",
    VERTEX_PROJECT_ID: "test-project",
    VERTEX_LOCATION: "global",
  };
  generateContent.mockReset();
  runCrisisClassifier.mockReset();
  runCrisisClassifier.mockResolvedValue({ crisis: false, forceReview: false });
  persistInstructionAssignment.mockReset();
  persistInstructionAssignment.mockResolvedValue({
    ok: true,
    assignmentId: "assignment-1",
  });
  workerBehindFetch();
});
afterEach(() => {
  process.env = { ...savedEnv };
  vi.unstubAllGlobals();
});

describe("tutor_turn_metrics attribution", () => {
  it("a model-call turn writes summed tokens, thinking, budget, prompt version and cache_hit from Vertex", async () => {
    generateContent.mockResolvedValueOnce({
      candidates: [
        {
          finishReason: "STOP",
          index: 0,
          content: { role: "model", parts: [{ text: REPLY }] },
        },
      ],
      text: REPLY,
      usageMetadata: {
        promptTokenCount: 1843,
        candidatesTokenCount: 27,
        thoughtsTokenCount: 612,
        cachedContentTokenCount: 1024,
      },
    });
    const res = await oneTurn();
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(REPLY);

    const rows = metricsRows();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      tokens_in: 1843,
      tokens_out: 27,
      thinking_tokens: 612,
      thinking_budget: 1024,
      cache_hit: true,
    });
    expect(typeof row.prompt_version).toBe("string");
    expect((row.prompt_version as string).length).toBeGreaterThan(0);
    // Nothing from the conversation is stored in the metrics row.
    expect(JSON.stringify(row)).not.toContain(REPLY);

    // Ruling 3: the instruction assignment is written as before — prompt_version null.
    expect(persistInstructionAssignment).toHaveBeenCalledTimes(1);
    expect(persistInstructionAssignment.mock.calls[0]?.[0]).toMatchObject({
      promptVersion: null,
    });
  });

  it("no cached tokens reported: cache_hit false", async () => {
    generateContent.mockResolvedValueOnce({
      candidates: [
        {
          finishReason: "STOP",
          index: 0,
          content: { role: "model", parts: [{ text: REPLY }] },
        },
      ],
      text: REPLY,
      usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 20 },
    });
    expect((await oneTurn()).status).toBe(200);
    expect(metricsRows()[0]).toMatchObject({
      tokens_in: 900,
      tokens_out: 20,
      thinking_tokens: null,
      cache_hit: false,
    });
  });

  it("a safety-blocked turn is billed: its usage is written on the error turn's row", async () => {
    generateContent.mockResolvedValueOnce({
      candidates: [{ finishReason: "SAFETY", index: 0 }],
      usageMetadata: { promptTokenCount: 1500, thoughtsTokenCount: 300 },
    });
    const res = await oneTurn();
    expect(res.status).toBeGreaterThanOrEqual(400);
    const rows = metricsRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      model_name: "error:orchestration_failed",
      tokens_in: 1500,
      tokens_out: null,
      thinking_tokens: 300,
      thinking_budget: 1024,
    });
    expect(rows[0]?.prompt_version).toBeTruthy();
  });

  it("a crisis-bypass turn makes no model call: null tokens, budget and prompt version", async () => {
    runCrisisClassifier.mockResolvedValue({
      crisis: true,
      source: "layer1_signature",
      category: "crisis",
      signatureId: null,
      modelConfidence: null,
      forceReview: true,
    });
    const res = await oneTurn();
    expect(res.status).toBe(200);
    expect(generateContent).not.toHaveBeenCalled();
    const rows = metricsRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toMatchObject({
        crisis_triggered: true,
        tokens_in: null,
        tokens_out: null,
        thinking_tokens: null,
        thinking_budget: null,
        prompt_version: null,
      });
    }
  });
});
