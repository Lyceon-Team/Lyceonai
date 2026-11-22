/**
 * The attribution path end to end: turn ordinal, prompt version, context hash, outcome, exposures
 * and the guided-choice pick, on a 3-turn conversation through the REAL route and the REAL worker.
 *
 * @spec [owner brief "attribution", Karl 2026-11-22: "turnOrdinal is hardcoded 0 … Make it the
 *       real turn count per conversation, write tutor_conversations.prompt_version, write
 *       tutor_instruction_exposures rows, and record guided-choice picks as codes. Close
 *       W4-12/13/14 … Contract test on a 3-turn conversation: ordinals 0, 1, 2, prompt_version
 *       set, exposures written."; Doc-03A_V3 §18.4, §18.6, §21.1; Doc-03D_V1.2 §8.1; LISA closure
 *       plan W4-12, W4-13, W4-14] | @implemented [2026-11-22]
 *
 * plain English: "Walk me through it", then "Got it, next step", then a typed question, on one
 * review conversation. Replaced: the Google SDK (one mock for the classifier and the tutor model),
 * the database (in memory), entitlement and the envelope's content (the golden-set case, so the
 * real worker accepts it; its policy assignment is the BFF's real `resolveDefaultPolicy`). The
 * instruction-assignment writer is the REAL one, so its rows and their ids are what the exposures
 * reference.
 *   A1 turn ordinals 0, 1, 2 on the metrics and context-resolution rows; a retried turn (same
 *      client_turn_id) keeps its ordinal.
 *   A2 W4-13: the worker is sent the BFF's prompt version, and the assignment row, the metrics
 *      row and the conversation all carry it; the worker registry's default is the same.
 *   A3 W4-14: each metrics row's context_hash is the hash of exactly the request that worker
 *      received (recomputed here from the worker's own body).
 *   A4 W4-12: model_name is the provider model and the outcome is its own column; a replay's
 *      model_name is null.
 *   A5 exposures: one row per delivered turn, each with its assignment_id, student_id and the
 *      help level as a code; the pick is a code on the assignment row (null when typed).
 *   A6 every column the exposures and metrics rows are written with exists in the migrations
 *      (the in-memory database does not check), and the outcome codes are the CHECK's exactly.
 * Synthetic ids and text only.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
vi.mock("../../server/services/tutor-context", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/services/tutor-context")
  >("../../server/services/tutor-context");
  return {
    ...actual,
    resolveFullEnvelope: vi.fn(
      async (p: { studentId: string; entryMode: string }) => ({
        ...structuredClone(CASE_36.request),
        policy_assignment: actual.resolveDefaultPolicy(
          p.studentId,
          p.entryMode,
        ),
      }),
    ),
  };
});
vi.mock("../../server/services/tutor-memory", () => ({
  getRecentMessages: vi.fn(async () => []),
}));
vi.mock("../../server/services/cloud-tasks-enqueue", () => ({
  enqueueCloudTask: vi.fn(async () => undefined),
}));
vi.mock("../../server/lib/gcp-credentials", () => ({
  getGcpCredentials: () => ({
    project_id: "test-project",
    client_email: "x@test-project.iam.gserviceaccount.com",
    private_key: "test",
  }),
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
import { resolvePromptArtifact } from "../../apps/workers/tutor-orchestrator/src/prompts/prompt-registry";
import { CRISIS_CLASSIFIER_SYSTEM_PROMPT } from "../../server/services/crisis-classifier-prompt";
import { TutorConfig } from "../../server/services/tutor-config";
import {
  TURN_OUTCOMES,
  contextHash,
  exposuresForTurn,
} from "../../server/services/tutor-attribution";
import { TUTOR_DEFAULT_PROMPT_VERSION } from "../../shared/tutor-orchestrator-wire";
import { DEFAULT_PROMPT_VERSION } from "./lisa-golden-set-helpers";
import {
  REVIEW_INTENT_LABELS,
  type ReviewIntent,
} from "../../packages/shared/src/tutor-guided-choices";

const STUDENT_ID = "55555555-5555-4555-8555-555555555555";
const Q_MATH = "M-EQX-0001";
const PROVIDER_MODEL = "gemini-3-flash-preview";
const REPLY = "Which side of the equation would you undo first?";
const savedEnv = { ...process.env };
const workerBodies: Array<Record<string, unknown>> = [];

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

function workerBehindFetch(): void {
  const worker = express();
  worker.use(express.json());
  worker.use("/orchestrate", orchestrateRouter);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body ?? "{}");
      workerBodies.push(JSON.parse(body) as Record<string, unknown>);
      const res = await request(worker)
        .post(new URL(String(input)).pathname)
        .set("Content-Type", "application/json")
        .send(body);
      return new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

function answerModels(): void {
  generateContent.mockImplementation(
    async (params: {
      config?: { systemInstruction?: { parts?: Array<{ text?: string }> } };
    }) => {
      if (
        params.config?.systemInstruction?.parts?.[0]?.text ===
        CRISIS_CLASSIFIER_SYSTEM_PROMPT
      ) {
        return { text: '{"isCrisis":false,"confidence":0.05}' };
      }
      return {
        candidates: [
          {
            finishReason: "STOP",
            index: 0,
            content: { role: "model", parts: [{ text: REPLY }] },
          },
        ],
        modelVersion: PROVIDER_MODEL,
        text: REPLY,
        usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 20 },
      };
    },
  );
}

function seedConversation(): string {
  db.current.seed("questions", {
    id: Q_MATH,
    section: "M",
    domain: "Advanced Math",
    skill_codes: ["H.C.1"],
    correct_answer: "B",
  });
  return db.current.seed("tutor_conversations", {
    student_id: STUDENT_ID,
    entry_mode: "scoped_question",
    source_surface: "review",
    surface: "review",
    source_session_id: null,
    source_session_item_id: null,
    source_question_row_id: Q_MATH,
    source_question_canonical_id: Q_MATH,
    status: "active",
    crisis_flagged: false,
    deleted_at: null,
    updated_at: "2026-11-22T00:00:00.000Z",
    closed_at: null,
    title: "New session",
    crisis_paused_at: null,
    ended_at: null,
    prompt_version: null,
  }).id as string;
}

async function send(
  conversationId: string,
  message: string,
  intent: ReviewIntent | undefined,
  clientTurnId: string,
): Promise<request.Response> {
  const res = await request(app())
    .post("/api/tutor/messages")
    .send({
      conversation_id: conversationId,
      message,
      client_turn_id: clientTurnId,
      ...(intent !== undefined ? { intent } : {}),
    });
  await new Promise((resolve) => setTimeout(resolve, 3));
  return res;
}

/** Keys the in-memory database adds to every insert itself; the route never writes them. */
const FAKE_ADDED = new Set(["id", "created_at", "updated_at"]);

/** The columns a migration's CREATE TABLE and later ADD COLUMNs give a table. */
function migrationColumns(table: string): Set<string> {
  const dir = join(import.meta.dirname, "../../supabase/migrations");
  const cols = new Set<string>();
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".sql")) continue;
    const sql = readFileSync(join(dir, f), "utf8").replace(/--.*$/gm, "");
    const create = new RegExp(
      `CREATE TABLE (?:IF NOT EXISTS )?public\\.${table} \\(([\\s\\S]*?)\\n\\);`,
    ).exec(sql);
    if (create?.[1] !== undefined) {
      for (const line of create[1].split("\n")) {
        const m = /^\s*([a-z_]+)\s+[A-Z]/.exec(line);
        if (m?.[1] !== undefined && !["CONSTRAINT", "PRIMARY"].includes(m[1]))
          cols.add(m[1]);
      }
    }
    for (const m of sql.matchAll(
      new RegExp(`ALTER TABLE public\\.${table}[\\s\\S]*?;`, "g"),
    )) {
      for (const a of m[0].matchAll(/ADD COLUMN (?:IF NOT EXISTS )?([a-z_]+)/g))
        if (a[1] !== undefined) cols.add(a[1]);
    }
  }
  return cols;
}

beforeEach(async () => {
  db.current = new FakeTutorDb();
  workerBodies.length = 0;
  process.env = {
    ...savedEnv,
    TUTOR_ORCHESTRATOR_WORKER_URL: "http://worker.test",
    VERTEX_PROJECT_ID: "test-project",
    VERTEX_LOCATION: "global",
    VERTEX_CLASSIFIER_CLASS_MODEL: "test-classifier",
  };
  generateContent.mockReset();
  answerModels();
  workerBehindFetch();
  await TutorConfig.loadAll();
});
afterEach(() => {
  process.env = { ...savedEnv };
  vi.unstubAllGlobals();
});

describe("the attribution path on a 3-turn conversation (owner brief 2026-11-22)", () => {
  async function threeTurns(): Promise<{ conv: string; turnIds: string[] }> {
    const conv = seedConversation();
    const turnIds = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    const steps: Array<[string, ReviewIntent | undefined]> = [
      [REVIEW_INTENT_LABELS.walkthrough, "walkthrough"],
      [REVIEW_INTENT_LABELS.step_understood, "step_understood"],
      ["why does that work", undefined],
    ];
    for (const [i, [message, intent]] of steps.entries()) {
      const res = await send(conv, message, intent, turnIds[i] ?? "");
      expect(res.status).toBe(200);
    }
    expect(workerBodies).toHaveLength(3);
    return { conv, turnIds };
  }
  const metrics = (conv: string): Array<Record<string, unknown>> =>
    db.current
      .rows("tutor_turn_metrics")
      .filter((r) => r.conversation_id === conv);

  it("A1 ordinals 0, 1, 2 on both logs; a retried turn keeps its ordinal", async () => {
    const { conv, turnIds } = await threeTurns();
    expect(metrics(conv).map((r) => r.turn_ordinal)).toEqual([0, 1, 2]);
    expect(
      db.current
        .rows("tutor_context_resolution_log")
        .filter((r) => r.conversation_id === conv)
        .map((r) => r.turn_ordinal),
    ).toEqual([0, 1, 2]);
    // The second turn, sent again with its own client_turn_id: a replay, still turn 1.
    const res = await send(
      conv,
      REVIEW_INTENT_LABELS.step_understood,
      "step_understood",
      turnIds[1] ?? "",
    );
    expect(res.status).toBe(200);
    const replay = metrics(conv)[3];
    expect(replay).toMatchObject({
      turn_ordinal: 1,
      turn_outcome: "idempotency_replay",
      model_name: null,
    });
    expect(workerBodies).toHaveLength(3);
  });

  it("A2 the BFF's prompt version reaches the worker, the assignment, the metrics and the conversation", async () => {
    const { conv } = await threeTurns();
    expect(TUTOR_DEFAULT_PROMPT_VERSION).toMatch(/^lisa-default-v\d+$/);
    for (const body of workerBodies) {
      expect(
        (body.policy_assignment as { prompt_version: unknown }).prompt_version,
      ).toBe(TUTOR_DEFAULT_PROMPT_VERSION);
    }
    const assignments = db.current
      .rows("tutor_instruction_assignments")
      .filter((r) => r.conversation_id === conv);
    expect(assignments.map((r) => r.prompt_version)).toEqual([
      TUTOR_DEFAULT_PROMPT_VERSION,
      TUTOR_DEFAULT_PROMPT_VERSION,
      TUTOR_DEFAULT_PROMPT_VERSION,
    ]);
    // W4-13's proof: the version decided before the call is the version the worker ran.
    expect(metrics(conv).map((r) => r.prompt_version)).toEqual(
      assignments.map((r) => r.prompt_version),
    );
    expect(
      db.current.rows("tutor_conversations").find((r) => r.id === conv)
        ?.prompt_version,
    ).toBe(TUTOR_DEFAULT_PROMPT_VERSION);
    // One prompt default: the worker's registry and the tests' constant agree with the BFF's.
    expect(resolvePromptArtifact("default", null).version).toBe(
      TUTOR_DEFAULT_PROMPT_VERSION,
    );
    expect(DEFAULT_PROMPT_VERSION).toBe(TUTOR_DEFAULT_PROMPT_VERSION);
  });

  it("A3 each context_hash is the hash of the request that worker received", async () => {
    const { conv } = await threeTurns();
    const hashes = metrics(conv).map((r) => r.context_hash);
    expect(hashes).toEqual(workerBodies.map((b) => contextHash(b)));
    for (const h of hashes) expect(h).toMatch(/^[0-9a-f]{64}$/);
    // The same assembled envelope gives the same hash, whatever its key order.
    const body = workerBodies[0] ?? {};
    const reversed = Object.fromEntries(Object.entries(body).reverse());
    expect(contextHash(reversed)).toBe(contextHash(body));
    // Different turns, different requests.
    expect(new Set(hashes).size).toBe(3);
  });

  it("A4 model_name is the provider model; the outcome is its own column", async () => {
    const { conv } = await threeTurns();
    for (const r of metrics(conv)) {
      expect(r.turn_outcome).toBe("completed");
      expect(r.model_name).not.toBeNull();
      expect(TURN_OUTCOMES as readonly unknown[]).not.toContain(r.model_name);
    }
  });

  it("A5 exposures per delivered turn, with assignment and student; the pick is a code", async () => {
    const { conv } = await threeTurns();
    const assignments = db.current
      .rows("tutor_instruction_assignments")
      .filter((r) => r.conversation_id === conv);
    expect(assignments).toHaveLength(3);
    expect(
      assignments.map((r) => (r.reason_snapshot as { intent: unknown }).intent),
    ).toEqual(["walkthrough", "step_understood", null]);
    const exposures = db.current
      .rows("tutor_instruction_exposures")
      .filter((r) => r.conversation_id === conv);
    // Presence first: one reply exposure per turn, each tied to that turn's assignment.
    expect(exposures).toHaveLength(3);
    expect(exposures.map((r) => r.assignment_id)).toEqual(
      assignments.map((r) => r.id),
    );
    for (const r of exposures) {
      expect(r.student_id).toBe(STUDENT_ID);
      expect(r.sequence_ordinal).toBe(0);
      expect(r.content_version).toBe(TUTOR_DEFAULT_PROMPT_VERSION);
    }
    const help = metrics(conv).map((m) => [m.help_level, m.help_worked_step]);
    expect(
      exposures.map((r) => [
        r.exposure_type,
        r.hint_depth,
        r.content_variant_key,
      ]),
    ).toEqual(
      help.map(([level, step]) => [
        level === "ask" || level === "hint" ? "hint" : "explanation",
        { ask: 1, hint: 2, worked_step: 3, full_solution: 4 }[String(level)],
        `help:${String(level)}${step === null || step === undefined ? "" : `:${String(step)}`}`,
      ]),
    );
    expect(exposures[0]).toMatchObject({
      exposure_type: "hint",
      content_variant_key: "help:hint",
    });
    // No message text anywhere in the attribution rows.
    expect(JSON.stringify([assignments, exposures])).not.toContain(
      "why does that work",
    );
  });

  it("A6 every written column exists in the migrations; the outcome codes are the CHECK's", async () => {
    const { conv } = await threeTurns();
    const exposureCols = migrationColumns("tutor_instruction_exposures");
    expect(exposureCols.has("assignment_id")).toBe(true);
    for (const r of db.current.rows("tutor_instruction_exposures")) {
      for (const k of Object.keys(r)) {
        if (FAKE_ADDED.has(k)) continue;
        expect(exposureCols, `tutor_instruction_exposures.${k}`).toContain(k);
      }
    }
    const metricCols = migrationColumns("tutor_turn_metrics");
    for (const r of metrics(conv)) {
      for (const k of Object.keys(r)) {
        if (FAKE_ADDED.has(k)) continue;
        expect(metricCols, `tutor_turn_metrics.${k}`).toContain(k);
      }
    }
    const sql = readFileSync(
      join(
        import.meta.dirname,
        "../../supabase/migrations/20261208000000_lisa_turn_attribution.sql",
      ),
      "utf8",
    );
    const check =
      /tutor_turn_metrics_turn_outcome_check CHECK \(([\s\S]*?)\);/.exec(
        sql,
      )?.[1];
    expect(check).toBeDefined();
    expect([...(check ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([
      ...TURN_OUTCOMES,
    ]);
  });

  it("A7 an offer the reply carries is its own exposure; a typed turn with no level is a code too", () => {
    const base = {
      assignmentId: "assignment-1",
      conversationId: "conversation-1",
      studentId: STUDENT_ID,
      promptVersion: TUTOR_DEFAULT_PROMPT_VERSION,
      policyVariant: "scaffolded",
      workerExposures: [],
    };
    expect(
      exposuresForTurn({
        ...base,
        intent: null,
        help: null,
        suggestedAction: "start_practice",
      }).map((r) => [
        r.exposure_type,
        r.content_variant_key,
        r.sequence_ordinal,
      ]),
    ).toEqual([
      ["explanation", "typed", 0],
      ["similar_question_offer", "start_practice", 1],
    ]);
    expect(
      exposuresForTurn({
        ...base,
        intent: "explain_rule",
        help: null,
        suggestedAction: "offer_broader_coaching",
      }).map((r) => [r.exposure_type, r.content_variant_key]),
    ).toEqual([
      ["explanation", "pick:explain_rule"],
      ["broader_coaching_offer", "offer_broader_coaching"],
    ]);
  });

  it("A8 a failed exposure write does not fail the turn (§21: non-blocking)", async () => {
    const conv = seedConversation();
    db.current.failNext("tutor_instruction_exposures", "insert", {
      message: "boom",
      code: "XX000",
    });
    const res = await send(
      conv,
      "how do I start",
      undefined,
      crypto.randomUUID(),
    );
    expect(res.status).toBe(200);
    expect(db.current.rows("tutor_instruction_exposures")).toHaveLength(0);
    expect(metrics(conv)).toHaveLength(1);
    expect(metrics(conv)[0]).toMatchObject({
      turn_ordinal: 0,
      turn_outcome: "completed",
    });
  });
});
