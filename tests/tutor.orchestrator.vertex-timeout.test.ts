import { describe, expect, it, vi } from "vitest";

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

describe("Tutor orchestrator vertex timeout", () => {
  it("enforces runtime_limits.timeout_ms", async () => {
    const { generateTutorResponse, OrchestratorTimeoutError, setGenerateContentForTests } = await import("../apps/workers/tutor-orchestrator/src/lib/vertex.ts");
    setGenerateContentForTests(generateContentMock);

    try {
      generateContentMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                response: {
                  candidates: [
                    {
                      content: {
                        parts: [{ text: "{\"response\":{\"content\":\"ok\",\"content_kind\":\"message\",\"suggested_action\":{\"type\":\"none\",\"label\":null},\"ui_hints\":{\"show_accept_decline\":false,\"allow_freeform_reply\":true,\"suggested_chip\":null}},\"question_links\":[],\"instruction_exposures\":[],\"orchestration_meta\":{\"model_name\":\"m\",\"cache_used\":false,\"compaction_recommended\":false}}" }],
                      },
                    },
                  ],
                },
              });
            }, 35);
          }),
      );

      await expect(generateTutorResponse(buildRequest(5))).rejects.toBeInstanceOf(OrchestratorTimeoutError);
    } finally {
      setGenerateContentForTests(null);
    }
  });
});
