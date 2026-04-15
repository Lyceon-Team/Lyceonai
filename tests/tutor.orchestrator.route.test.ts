import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

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

const { orchestrateRouter } = await import("../apps/workers/tutor-orchestrator/src/routes/orchestrate.ts");
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

describe("Tutor orchestrate route", () => {
  it("maps timeout errors to safe timeout failure", async () => {
    generateTutorResponseMock.mockRejectedValueOnce(new OrchestratorTimeoutError(10));

    const app = express();
    app.use(express.json());
    app.use("/orchestrate", orchestrateRouter);

    const res = await request(app).post("/orchestrate").send(validPayload());
    expect(res.status).toBe(504);
    expect(res.body.error.message).toBe("Vertex orchestration timed out");
  });
});
