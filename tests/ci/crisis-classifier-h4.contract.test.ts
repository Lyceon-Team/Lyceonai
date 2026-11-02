/**
 * H4 cheap wins in the crisis classifier (Layer 2): no config read, one Vertex client per
 * process, a bounded attempt, and no retry of a failure that repeats identically.
 *
 * @spec [owner brief H4 "database cheap wins" (Karl, 2026-11-02); rulings of 2026-11-02
 *        ("3000 ms (Recommended)", "BFF only"); SCL-023; CR-03C-V3-01 §3.4]
 *       | @implemented [2026-11-02]
 *
 * plain English: drives the real `classifyCrisis` with the SDK and the credential mocked.
 *  - It never touches the database (the `crisis_classifier_model_alias` read is gone).
 *  - Two classifications construct ONE client.
 *  - An attempt that never answers ends at CRISIS_CLASSIFIER_TIMEOUT_MS, aborts its request,
 *    gets the one retry, and then the "could not classify" sentinel (SCL-023 semantics unchanged).
 *  - A missing model env var is not retried: no model call, no attempt warning, one error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loggerWarn = vi.fn();
const loggerError = vi.fn();
vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: (...a: unknown[]) => loggerWarn(...a),
    error: (...a: unknown[]) => loggerError(...a),
  },
}));

const supabaseFrom = vi.fn();
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...a: unknown[]) => supabaseFrom(...a),
  },
}));

vi.mock("../../server/lib/gcp-credentials", () => ({
  getGcpCredentials: () => ({
    type: "service_account",
    project_id: "test-project",
    private_key_id: "fake",
    private_key: "-----BEGIN FAKE-----\nnotreal\n-----END FAKE-----\n",
    client_email: "test@test.iam.gserviceaccount.com",
    client_id: "000",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
  }),
}));

const constructed = vi.fn();
const generateContent = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    constructor(opts: unknown) {
      constructed(opts);
    }
    models = { generateContent: (p: unknown) => generateContent(p) };
  },
}));

const NO_CRISIS = {
  text: JSON.stringify({ isCrisis: false, confidence: 0.9 }),
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.VERTEX_CLASSIFIER_CLASS_MODEL = "test-classifier-model";
  process.env.VERTEX_CLASSIFIER_LOCATION = "global";
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.VERTEX_CLASSIFIER_CLASS_MODEL;
  delete process.env.VERTEX_CLASSIFIER_LOCATION;
});

describe("crisis classifier, H4", () => {
  it("classifies without reading the database", async () => {
    generateContent.mockResolvedValue(NO_CRISIS);
    const { classifyCrisis } =
      await import("../../server/services/tutor-crisis");

    const result = await classifyCrisis("what is a slope?");

    // Presence first: the model really ran and answered.
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ isCrisis: false, confidence: 0.9 });
    expect(supabaseFrom).not.toHaveBeenCalled();
  });

  it("builds one Vertex client for many classifications", async () => {
    generateContent.mockResolvedValue(NO_CRISIS);
    const { classifyCrisis } =
      await import("../../server/services/tutor-crisis");

    await classifyCrisis("first message");
    await classifyCrisis("second message");
    await classifyCrisis("third message");

    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(constructed).toHaveBeenCalledTimes(1);
  });

  it("ends a hung attempt at the timeout, retries once, then returns the sentinel", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    generateContent.mockImplementation(
      (p: { config: { abortSignal: AbortSignal } }) => {
        signals.push(p.config.abortSignal);
        return new Promise(() => {
          /* never answers */
        });
      },
    );
    const { classifyCrisis, CRISIS_CLASSIFIER_TIMEOUT_MS } =
      await import("../../server/services/tutor-crisis");
    expect(CRISIS_CLASSIFIER_TIMEOUT_MS).toBe(3000);

    let settled = false;
    const pending = classifyCrisis("a message").then((r) => {
      settled = true;
      return r;
    });

    // Just short of the first timeout: still waiting on attempt 1.
    await vi.advanceTimersByTimeAsync(CRISIS_CLASSIFIER_TIMEOUT_MS - 1);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    // Attempt 1 times out and aborts its request; attempt 2 starts.
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(settled).toBe(false);

    // Attempt 2 times out: the SCL-023 sentinel, after one retry and no more.
    await vi.advanceTimersByTimeAsync(CRISIS_CLASSIFIER_TIMEOUT_MS);
    expect(await pending).toEqual({ isCrisis: false, confidence: 0 });
    expect(signals[1]?.aborted).toBe(true);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(loggerWarn.mock.calls.map((c) => c[1])).toEqual([
      "classifier_attempt_failed",
    ]);
    expect(loggerError.mock.calls.map((c) => c[1])).toEqual([
      "classifier_retry_exhausted",
    ]);
  });

  it("an attempt that answers in time is not cut off", async () => {
    vi.useFakeTimers();
    generateContent.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(NO_CRISIS), 2999);
        }),
    );
    const { classifyCrisis } =
      await import("../../server/services/tutor-crisis");

    const pending = classifyCrisis("a message");
    await vi.advanceTimersByTimeAsync(2999);

    expect(await pending).toEqual({ isCrisis: false, confidence: 0.9 });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it("does not retry a missing model env var", async () => {
    delete process.env.VERTEX_CLASSIFIER_CLASS_MODEL;
    const { classifyCrisis } =
      await import("../../server/services/tutor-crisis");

    const result = await classifyCrisis("a message");

    expect(result).toEqual({ isCrisis: false, confidence: 0 });
    expect(generateContent).not.toHaveBeenCalled();
    expect(constructed).not.toHaveBeenCalled();
    expect(loggerWarn).not.toHaveBeenCalled();
    expect(loggerError.mock.calls.map((c) => c[1])).toEqual([
      "classifier_retry_exhausted",
    ]);
  });

  it("still retries a Vertex failure once", async () => {
    generateContent
      .mockRejectedValueOnce(new Error("vertex 503 (test)"))
      .mockResolvedValueOnce(NO_CRISIS);
    const { classifyCrisis } =
      await import("../../server/services/tutor-crisis");

    const result = await classifyCrisis("a message");

    expect(result).toEqual({ isCrisis: false, confidence: 0.9 });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(loggerWarn.mock.calls.map((c) => c[1])).toEqual([
      "classifier_attempt_failed",
    ]);
  });

  it("a timed-out Layer 2 with no Layer 1 floor still fails closed (B1.5)", async () => {
    vi.useFakeTimers();
    // Layer 1: the signature table reads fine and holds no crisis rows.
    const empty = { data: [], error: null };
    supabaseFrom.mockImplementation(() => ({
      select: () => ({
        or: () => ({ eq: async () => empty }),
        eq: () => ({ eq: async () => empty }),
      }),
    }));
    generateContent.mockImplementation(
      () =>
        new Promise(() => {
          /* never answers */
        }),
    );
    const { runCrisisClassifier, CRISIS_CLASSIFIER_TIMEOUT_MS } =
      await import("../../server/services/tutor-crisis");

    const pending = runCrisisClassifier("a message");
    await vi.advanceTimersByTimeAsync(2 * CRISIS_CLASSIFIER_TIMEOUT_MS);
    const result = await pending;

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(result.crisis).toBe(true);
    if (result.crisis) {
      expect(result.source).toBe("classifier_degraded_no_floor");
      expect(result.forceReview).toBe(true);
    }
  });
});
