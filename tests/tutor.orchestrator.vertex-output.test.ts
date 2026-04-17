import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateContentMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
}));

function buildRequest(timeoutMs: number) {
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
      timeout_ms: timeoutMs,
    },
  } as const;
}

function buildValidResponse() {
  return {
    response: {
      content: "Try isolating x first.",
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
      model_name: "gemini-2.5-flash",
      cache_used: false,
      compaction_recommended: false,
    },
  };
}

describe("Tutor orchestrator vertex output hardening", () => {
  let generateTutorResponse: (typeof import("../apps/workers/tutor-orchestrator/src/lib/vertex.ts"))["generateTutorResponse"];
  let setGenerateContentForTests: (typeof import("../apps/workers/tutor-orchestrator/src/lib/vertex.ts"))["setGenerateContentForTests"];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const mod = await import("../apps/workers/tutor-orchestrator/src/lib/vertex.ts");
    generateTutorResponse = mod.generateTutorResponse;
    setGenerateContentForTests = mod.setGenerateContentForTests;
    setGenerateContentForTests(generateContentMock);
  });

  afterEach(() => {
    setGenerateContentForTests(null);
  });

  it("parses valid JSON and uses deterministic structured generation config", async () => {
    const validResponse = buildValidResponse();
    generateContentMock.mockResolvedValueOnce({
      response: {
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(validResponse) }],
            },
          },
        ],
      },
    });

    const result = await generateTutorResponse(buildRequest(1000));
    expect(result).toEqual(validResponse);

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    const arg = generateContentMock.mock.calls[0][0];
    expect(arg.generationConfig.temperature).toBe(0);
    expect(arg.generationConfig.topP).toBe(1);
    expect(arg.generationConfig.candidateCount).toBe(1);
    expect(arg.generationConfig.responseMimeType).toBe("application/json");
    expect(arg.generationConfig).toHaveProperty("responseSchema");
  });

  it("fails safely on truncated JSON output", async () => {
    generateContentMock.mockResolvedValueOnce({
      response: {
        candidates: [
          {
            content: {
              parts: [{ text: "{\n  \"response\": {\n    \"content" }],
            },
          },
        ],
      },
    });

    await expect(generateTutorResponse(buildRequest(1000))).rejects.toMatchObject({
      name: "ModelOutputError",
      code: "MODEL_OUTPUT_TRUNCATED",
      message: "Vertex returned truncated JSON output",
    });
  });

  it("fails safely on non-JSON output", async () => {
    generateContentMock.mockResolvedValueOnce({
      response: {
        candidates: [
          {
            content: {
              parts: [{ text: "this is not json" }],
            },
          },
        ],
      },
    });

    await expect(generateTutorResponse(buildRequest(1000))).rejects.toMatchObject({
      name: "ModelOutputError",
      code: "MODEL_OUTPUT_INVALID",
      message: "Vertex returned non-JSON output",
    });
  });

  it("fails safely on malformed JSON output", async () => {
    generateContentMock.mockResolvedValueOnce({
      response: {
        candidates: [
          {
            content: {
              parts: [{ text: "{\"response\": }" }],
            },
          },
        ],
      },
    });

    await expect(generateTutorResponse(buildRequest(1000))).rejects.toMatchObject({
      name: "ModelOutputError",
      code: "MODEL_OUTPUT_INVALID",
      message: "Vertex returned non-JSON output",
    });
  });

  it("fails safely on schema mismatch output", async () => {
    generateContentMock.mockResolvedValueOnce({
      response: {
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ response: { content: "missing required fields" } }) }],
            },
          },
        ],
      },
    });

    await expect(generateTutorResponse(buildRequest(1000))).rejects.toMatchObject({
      name: "ModelOutputError",
      code: "MODEL_OUTPUT_SCHEMA_MISMATCH",
      message: "Vertex returned invalid orchestrator response shape",
    });
  });

});
