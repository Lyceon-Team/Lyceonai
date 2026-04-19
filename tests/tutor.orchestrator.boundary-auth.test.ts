import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateTutorResponseMock } = vi.hoisted(() => ({
  generateTutorResponseMock: vi.fn(),
}));

vi.mock("../apps/workers/tutor-orchestrator/src/lib/vertex.js", () => {
  class OrchestratorTimeoutError extends Error {
    timeoutMs: number;

    constructor(timeoutMs: number) {
      super(`Vertex orchestration timed out after ${timeoutMs}ms`);
      this.name = "OrchestratorTimeoutError";
      this.timeoutMs = timeoutMs;
    }
  }

  return {
    generateTutorResponse: generateTutorResponseMock,
    OrchestratorTimeoutError,
  };
});

const { createWorkerBoundaryAuthMiddleware } = await import("../apps/workers/tutor-orchestrator/src/lib/boundary-auth.ts");
const { orchestrateRouter } = await import("../apps/workers/tutor-orchestrator/src/routes/orchestrate.ts");
const { compactRouter } = await import("../apps/workers/tutor-orchestrator/src/routes/compact.ts");
const { OrchestratorTimeoutError } = await import("../apps/workers/tutor-orchestrator/src/lib/vertex.js");

function validPayload() {
  return {
    conversation_id: "11111111-1111-4111-8111-111111111111",
    student_id: "22222222-2222-4222-8222-222222222222",
    entry_mode: "scoped_question",
    source_surface: "practice",
    resolved_scope: {
      source_session_id: null,
      source_session_item_id: null,
      source_question_row_id: null,
      source_question_canonical_id: "q1",
    },
    recent_messages: [],
    memory_summaries: [],
    student_context: {},
    policy_assignment: {
      policy_family: "tutor_v1",
      policy_variant: "default",
      policy_version: "1",
      prompt_version: "1",
      assignment_mode: "deterministic",
      assignment_key: "default",
      reason_snapshot: {},
    },
    runtime_limits: {
      max_output_tokens: 100,
      timeout_ms: 10,
    },
  };
}

function validOrchestratorResponse() {
  return {
    response: {
      content: "Tutor response",
      content_kind: "message",
      suggested_action: {
        type: "none",
        label: null,
      },
      ui_hints: {
        show_accept_decline: false,
        allow_freeform_reply: true,
        suggested_chip: null,
      },
    },
    question_links: [],
    instruction_exposures: [],
    orchestration_meta: {
      model_name: "vertex-test",
      cache_used: false,
      compaction_recommended: false,
    },
  };
}

function buildApp(env: NodeJS.ProcessEnv) {
  const app = express();
  app.use(express.json());
  app.use("/orchestrate", createWorkerBoundaryAuthMiddleware(env), orchestrateRouter);
  app.use("/compact", createWorkerBoundaryAuthMiddleware(env), compactRouter);
  return app;
}

describe("Tutor orchestrator worker boundary auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows local dev default mode when auth mode is unset", async () => {
    generateTutorResponseMock.mockRejectedValueOnce(new OrchestratorTimeoutError(10));
    const app = buildApp({
      NODE_ENV: "development",
    });

    const res = await request(app).post("/orchestrate").send(validPayload());
    expect(res.status).toBe(504);
    expect(res.body.error.message).toBe("Vertex orchestration timed out");
  });

  it("fails closed in production when auth mode is unset", async () => {
    const app = buildApp({
      NODE_ENV: "production",
    });

    const res = await request(app).post("/orchestrate").send(validPayload());
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("ORCHESTRATOR_AUTH_CONFIG_ERROR");
    expect(generateTutorResponseMock).not.toHaveBeenCalled();
  });

  it("rejects missing bearer token in require_bearer mode", async () => {
    const app = buildApp({
      NODE_ENV: "development",
      TUTOR_ORCHESTRATOR_WORKER_AUTH_MODE: "require_bearer",
    });

    const res = await request(app).post("/orchestrate").send(validPayload());
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("ORCHESTRATOR_AUTH_REQUIRED");
  });

  it("accepts bearer token in require_bearer mode and preserves route behavior", async () => {
    generateTutorResponseMock.mockRejectedValueOnce(new OrchestratorTimeoutError(10));
    const app = buildApp({
      NODE_ENV: "development",
      TUTOR_ORCHESTRATOR_WORKER_AUTH_MODE: "require_bearer",
    });

    const res = await request(app)
      .post("/orchestrate")
      .set("Authorization", "Bearer local-internal-token")
      .send(validPayload());
    expect(res.status).toBe(504);
    expect(res.body.error.message).toBe("Vertex orchestration timed out");
  });

  it("rejects invalid token in shared_secret mode", async () => {
    const app = buildApp({
      NODE_ENV: "development",
      TUTOR_ORCHESTRATOR_WORKER_AUTH_MODE: "shared_secret",
      TUTOR_ORCHESTRATOR_WORKER_SHARED_SECRET: "expected-secret",
    });

    const res = await request(app)
      .post("/orchestrate")
      .set("Authorization", "Bearer wrong-secret")
      .send(validPayload());
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("ORCHESTRATOR_AUTH_INVALID");
  });

  it("accepts valid token in shared_secret mode and keeps response contract", async () => {
    generateTutorResponseMock.mockResolvedValueOnce(validOrchestratorResponse());
    const app = buildApp({
      NODE_ENV: "development",
      TUTOR_ORCHESTRATOR_WORKER_AUTH_MODE: "shared_secret",
      TUTOR_ORCHESTRATOR_WORKER_SHARED_SECRET: "expected-secret",
    });

    const res = await request(app)
      .post("/orchestrate")
      .set("Authorization", "Bearer expected-secret")
      .send(validPayload());
    expect(res.status).toBe(200);
    expect(res.body.response.content_kind).toBe("message");
    expect(res.body).toHaveProperty("question_links");
    expect(res.body).toHaveProperty("instruction_exposures");
    expect(res.body).toHaveProperty("orchestration_meta");
  });

  it("applies boundary auth to compact route and allows authorized requests", async () => {
    const app = buildApp({
      NODE_ENV: "development",
      TUTOR_ORCHESTRATOR_WORKER_AUTH_MODE: "require_bearer",
    });

    const denied = await request(app).post("/compact").send({
      conversation_id: "11111111-1111-4111-8111-111111111111",
      student_id: "22222222-2222-4222-8222-222222222222",
    });
    expect(denied.status).toBe(401);
    expect(denied.body.error.code).toBe("ORCHESTRATOR_AUTH_REQUIRED");

    const allowed = await request(app)
      .post("/compact")
      .set("Authorization", "Bearer internal-token")
      .send({
        conversation_id: "11111111-1111-4111-8111-111111111111",
        student_id: "22222222-2222-4222-8222-222222222222",
      });
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({ ok: true });
  });
});
