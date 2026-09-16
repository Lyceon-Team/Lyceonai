/**
 * @spec [Doc-03C_V3 §5.2, §5.7; Doc-03B_V4.1 §12B.8]
 * @implemented 2026-09-16
 *
 * Vertex client contract tests: safetySettings replaces inline modelArmorConfig
 * while Model Armor is deferred (Google-side TEMPLATE_NOT_FOUND). The two must
 * not coexist (Vertex rejects the combination with INVALID_ARGUMENT).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FinishReason, HarmBlockThreshold, HarmCategory } from "@google/genai";

// ── Mock @google/genai before the module under test is imported ─────────

const mockGenerateContent = vi.fn();

vi.mock("@google/genai", async () => {
  const actual =
    await vi.importActual<typeof import("@google/genai")>("@google/genai");

  class MockGoogleGenAI {
    models = { generateContent: mockGenerateContent };
  }

  return {
    ...actual,
    GoogleGenAI: MockGoogleGenAI,
  };
});

vi.mock("google-auth-library", () => {
  class MockGoogleAuth {
    getAccessToken = vi.fn().mockResolvedValue("mock-token");
  }
  return { GoogleAuth: MockGoogleAuth };
});

// ── Import the module under test AFTER mocks are in place ───────────────

import { generateTutorResponse } from "./vertex-client.js";

// ── Tests ───────────────────────────────────────────────────────────────

describe("vertex-client generateContent config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MODEL_ARMOR_INPUT_TEMPLATE_ID = "lyceon-lisa-input-v1";
    process.env.MODEL_ARMOR_OUTPUT_TEMPLATE_ID = "lyceon-lisa-output-v1";
    process.env.VERTEX_PROJECT_ID = "test-project";
    process.env.VERTEX_LOCATION = "us-central1";
  });

  it("sends safetySettings and does NOT send modelArmorConfig", async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: "mock response" }] },
        },
      ],
      text: "mock response",
    });

    await generateTutorResponse(
      "flash_class",
      [{ role: "user", text: "What is 2+2?" }],
      "You are a tutor.",
      { maxOutputTokens: 1024, timeoutMs: 10000 },
    );

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);

    const callArgs = mockGenerateContent.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    const config = callArgs.config as Record<string, unknown>;

    expect(config).not.toHaveProperty("modelArmorConfig");

    expect(config).toHaveProperty("safetySettings");
    expect(config.safetySettings).toEqual([
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
    ]);
  });

  it("returns vertex_max_tokens_truncated error when finishReason is MAX_TOKENS", async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          finishReason: FinishReason.MAX_TOKENS,
          content: { parts: [{ text: "This response was cut off mid-sen" }] },
        },
      ],
      text: "This response was cut off mid-sen",
    });

    const result = await generateTutorResponse(
      "pro_class",
      [{ role: "user", text: "Explain the quadratic formula step by step." }],
      "You are a tutor.",
      { maxOutputTokens: 1024, timeoutMs: 10000 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("vertex_max_tokens_truncated");
    }
  });

  it("returns success when finishReason is STOP", async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          finishReason: FinishReason.STOP,
          content: { parts: [{ text: "The answer is 4." }] },
        },
      ],
      text: "The answer is 4.",
    });

    const result = await generateTutorResponse(
      "flash_class",
      [{ role: "user", text: "What is 2+2?" }],
      "You are a tutor.",
      { maxOutputTokens: 1024, timeoutMs: 10000 },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe("The answer is 4.");
    }
  });
});
