/**
 * @spec [Doc-03C_V3 §5.2, §5.7; Doc-03B_V4.1 §12B.8]
 * @implemented 2026-09-15
 *
 * Vertex client contract tests: Model Armor is the sole content-safety
 * enforcement on the generateContent path. safetySettings must never be
 * sent alongside modelArmorConfig (Vertex rejects the combination with
 * INVALID_ARGUMENT).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

  it("sends modelArmorConfig and does NOT send safetySettings", async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: "mock response" }] },
        },
      ],
      text: "mock response",
    });

    // Mock the output sanitize fetch (standalone Model Armor Sanitize API)
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sanitizationResult: { filterMatchState: "NO_MATCH_FOUND" },
      }),
    }) as unknown as typeof fetch;

    try {
      await generateTutorResponse(
        "flash_class",
        [{ role: "user", text: "What is 2+2?" }],
        "You are a tutor.",
        { maxOutputTokens: 1024, timeoutMs: 10000 },
        {
          inputTemplateId: "lyceon-lisa-input-v1",
          outputTemplateId: "lyceon-lisa-output-v1",
        },
      );

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const config = callArgs.config;

      expect(config).toHaveProperty("modelArmorConfig");
      expect(config.modelArmorConfig).toEqual({
        promptTemplateName:
          "projects/test-project/locations/us-central1/templates/lyceon-lisa-input-v1",
      });

      expect(config).not.toHaveProperty("safetySettings");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
