/**
 * A missing GCP credential fails at the point of use, naming itself — and
 * never invents a crisis classification.
 *
 * @spec [SCL-023 / Doc-03_V3 §21.2 Layer 2 failure semantics; CR-03C-V3-01
 *        §3.4; Doc-06B §3] | @implemented [2026-09-11]
 *
 * plain English: with `GCP_SERVICE_ACCOUNT_JSON` absent, the LISA crisis
 * classifier's Layer 2 fails loudly and the error names the variable. Expected
 * outcome: no fabricated classifier verdict, no synthetic model response, and
 * SCL-023's turn-proceeds path exactly as it was.
 *
 * WHAT THIS DELIBERATELY DOES NOT ASSERT. It does not assert that the turn is
 * blocked. SCL-023 rules the opposite on purpose — quoting `tutor-crisis.ts`:
 * "This is a DELIBERATE narrow exception to fail-closed — blocking returns an
 * error to a student who may be the person the gate exists for." Removing the
 * boot guard does not touch that, and this file exists partly to pin it: a
 * future change that starts blocking the turn should have to argue with a
 * failing test, not slip through.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const GCP_VAR = "GCP_SERVICE_ACCOUNT_JSON";

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

/**
 * The SDK is mocked so the test can assert it is NEVER CONSTRUCTED. That is
 * the "no synthetic model response" proof: the credential throws first, so no
 * client exists to produce one.
 */
const genAiConstructed = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    constructor(opts: unknown) {
      genAiConstructed(opts);
    }
    models = {
      generateContent: async () => {
        throw new Error("a model call must never be reached in this test");
      },
    };
  },
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env[GCP_VAR];
  process.env.VERTEX_CLASSIFIER_CLASS_MODEL = "test-classifier-model";
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("the credential loader names itself when absent", () => {
  it("throws an error containing the variable name", async () => {
    const { getGcpCredentials } =
      await import("../../server/lib/gcp-credentials");
    expect(() => getGcpCredentials()).toThrowError(new RegExp(GCP_VAR));
  });
});

describe("crisis Layer 2 with the credential absent", () => {
  it("returns the non-crisis sentinel rather than a fabricated verdict", async () => {
    const { classifyCrisis } =
      await import("../../server/services/tutor-crisis");

    const result = await classifyCrisis("I need help with algebra");

    // The sentinel, exactly. A fabricated verdict would carry a confidence
    // the model never produced — `confidence: 0` with `isCrisis: false` IS
    // the documented "could not run" signal that the caller reads to force a
    // review case.
    expect(result).toEqual({ isCrisis: false, confidence: 0 });
  });

  it("never constructs a model client, so no synthetic response exists", async () => {
    const { classifyCrisis } =
      await import("../../server/services/tutor-crisis");

    await classifyCrisis("I need help with algebra");

    expect(genAiConstructed).not.toHaveBeenCalled();
  });

  /**
   * The failure is LOUD and it NAMES THE CREDENTIAL. Without this the operator
   * sees "Layer 2 failed" and has to guess why.
   */
  it("logs the failure once, naming the variable, and does not retry it", async () => {
    const { classifyCrisis } =
      await import("../../server/services/tutor-crisis");

    await classifyCrisis("I need help with algebra");

    // H4 (owner ruling 2026-11-02, "BFF only"): an absent credential fails the same way on a
    // second try, so the classifier no longer retries it — no attempt warning, no model step.
    expect(loggerWarn).not.toHaveBeenCalled();

    // The one error line is the one that must not be silent, and it names the credential.
    const exhausted = loggerError.mock.calls.filter(
      (c) => c[1] === "classifier_retry_exhausted",
    );
    expect(exhausted).toHaveLength(1);
    const cause = exhausted[0]?.[3];
    expect(cause).toBeInstanceOf(Error);
    expect(cause instanceof Error ? cause.message : "").toContain(GCP_VAR);
  });
});
