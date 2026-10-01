/**
 * Proves the REAL credential-absent fail-closed path end-to-end.
 *
 * @spec [CR-03C-V3-01 §3.4, Doc-03_V3 §21.2, B1.5; SCL-023]
 * @implemented [2026-09-15 — Codex audit Finding 3]
 *
 * plain English: with GCP_SERVICE_ACCOUNT_JSON unset, the crisis classifier
 * Layer 2 fails through the REAL credential loader (not a mock), and when
 * Layer 1 is empty, runCrisisClassifier returns crisis=true with source
 * "classifier_degraded_no_floor".
 *
 * Unlike crisis-fail-closed.b15.contract.test.ts which mocks
 * getGcpCredentials to return a valid shape, this test leaves the
 * credential ABSENT so the full chain fires:
 *   credential absent → getGcpCredentials() throws
 *   → invokeClassifier catches → classifyCrisis retries → exhausted
 *   → sentinel {isCrisis:false, confidence:0}
 *   → runCrisisClassifier detects layer2MayHaveFailed + layer1Empty
 *   → crisis=true, source=classifier_degraded_no_floor
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const GCP_VAR = "GCP_SERVICE_ACCOUNT_JSON";

vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockSupabaseFrom = vi.fn();
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  },
}));

/**
 * The GenAI SDK is mocked so we can assert it is NEVER CONSTRUCTED.
 * The credential throws first, so no client should be created.
 */
const genAiConstructed = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    constructor(opts: unknown) {
      genAiConstructed(opts);
    }
    models = {
      generateContent: async () => {
        throw new Error("model call must never be reached in this test");
      },
    };
  },
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete process.env[GCP_VAR];
  process.env.VERTEX_CLASSIFIER_CLASS_MODEL = "test-classifier-model";

  mockSupabaseFrom.mockImplementation((table: string) => {
    if (table === "tutor_injection_signatures") {
      return {
        select: vi.fn().mockReturnValue({
          or: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      };
    }
    if (table === "tutor_context_runtime_config") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { value: "classifier_class" },
              error: null,
            }),
          }),
        }),
      };
    }
    return { select: vi.fn() };
  });
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("credential-absent fail-closed through runCrisisClassifier", () => {
  it("returns crisis=true with source classifier_degraded_no_floor", async () => {
    const { _resetGcpCredentialsCache } =
      await import("../../server/lib/gcp-credentials");
    _resetGcpCredentialsCache();

    const { runCrisisClassifier } =
      await import("../../server/services/tutor-crisis");

    const result = await runCrisisClassifier("I need help with algebra");

    expect(result.crisis).toBe(true);
    if (result.crisis) {
      expect(result.source).toBe("classifier_degraded_no_floor");
      expect(result.forceReview).toBe(true);
      expect(result.signatureId).toBeNull();
      expect(result.modelConfidence).toBeNull();
    }
  });

  it("never constructs a model client", async () => {
    const { _resetGcpCredentialsCache } =
      await import("../../server/lib/gcp-credentials");
    _resetGcpCredentialsCache();

    const { runCrisisClassifier } =
      await import("../../server/services/tutor-crisis");

    await runCrisisClassifier("I need help with algebra");

    expect(genAiConstructed).not.toHaveBeenCalled();
  });
});
