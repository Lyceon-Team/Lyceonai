/**
 * @spec [CR-03C-V3-01 §3.4, Doc-03_V3 §21.2, B1.5]
 * @implemented 2026-08-19
 *
 * plain English: Contract tests for B1.5 — crisis Layer 1 fail-closed behavior.
 * Proves four runtime cases via unit-level mocking of the classifier layers
 * and one deployment readiness assertion against the signature set.
 *
 *   CASE_A — Layer 1 empty + Layer 2 fails  → crisis-safe response
 *   CASE_B — Layer 1 empty + Layer 2 OK (no crisis) → normal tutoring
 *   CASE_C — Layer 1 populated + Layer 2 fails → Layer 1 stands, forceReview
 *   CASE_D — Layer 1 table unreadable → fail closed (crisis=true)
 *   DEPLOYMENT_READINESS — zero crisis signatures is a fail condition
 *   SOURCE_ACCEPTED — DB CHECK constraint accepts new source values
 *
 * trade-offs: mocks Supabase and Vertex to isolate the decision logic in
 * runCrisisClassifier / checkCrisisSignatures. The ephemeral-PG proof tests
 * (crisis-review-queue.ephemeral-pg.proof.test.ts) cover the DB layer.
 *
 * edge cases:
 *   - Case A is the B1.5 fix: previously returned crisis=false (fail open).
 *   - Case D already existed but is re-proven for completeness.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock setup ──────────────────────────────────────────────────────

// We mock supabaseServer to control what checkCrisisSignatures sees
// and stub the classifier to control Layer 2 outcomes.

const mockSupabaseFrom = vi.fn();

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  },
}));

// Mock the logger to suppress output in tests
vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Creates a mock Supabase query chain for tutor_injection_signatures.
 * Simulates: supabaseServer.from("tutor_injection_signatures").select(...).eq(...)
 */
function mockSignatureQuery(result: {
  data: Array<{
    id: string;
    signature_pattern: string;
    signature_type: string;
  }> | null;
  error: { message: string; code: string } | null;
}): void {
  const chain = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue(result),
    }),
  };
  mockSupabaseFrom.mockImplementation((table: string) => {
    if (table === "tutor_injection_signatures") return chain;
    // Classifier config query
    if (table === "tutor_context_runtime_config") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "not found", code: "PGRST116" },
            }),
          }),
        }),
      };
    }
    return chain;
  });
}

/**
 * Mocks where Layer 2 succeeds (returns no-crisis).
 */
function mockSignatureAndClassifierQueries(
  signatureResult: {
    data: Array<{
      id: string;
      signature_pattern: string;
      signature_type: string;
    }> | null;
    error: { message: string; code: string } | null;
  },
  classifierOk: boolean,
  classifierConfidence: number,
): void {
  mockSupabaseFrom.mockImplementation((table: string) => {
    if (table === "tutor_injection_signatures") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue(signatureResult),
        }),
      };
    }
    if (table === "tutor_context_runtime_config") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { value: "gemini-crisis-v1" },
              error: null,
            }),
          }),
        }),
      };
    }
    return { select: vi.fn() };
  });

  // Mock the dynamic import of @google/genai for Layer 2
  vi.doMock("@google/genai", () => ({
    GoogleGenAI: class {
      models = {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            isCrisis: classifierOk,
            confidence: classifierConfidence,
          }),
        }),
      };
    },
  }));
}

// ── Tests ────────────────────────────────────────────────────────────

describe("B1.5 — crisis Layer 1 fail-closed", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Set required env vars for Layer 2
    process.env.VERTEX_CLASSIFIER_CLASS_MODEL = "gemini-crisis-v1";
    process.env.VERTEX_PROJECT_ID = "test-project";
    process.env.VERTEX_LOCATION = "us-central1";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.VERTEX_CLASSIFIER_CLASS_MODEL;
    delete process.env.VERTEX_PROJECT_ID;
    delete process.env.VERTEX_LOCATION;
  });

  it("CASE_A: empty signatures + Layer 2 fails → crisis=true, source=classifier_degraded_no_floor", async () => {
    // Layer 1: empty signature set (zero rows)
    // Layer 2: fails (classifier_config_missing → returns isCrisis=false, confidence=0)
    mockSignatureQuery({
      data: [],
      error: null,
    });

    const { runCrisisClassifier } =
      await import("../../server/services/tutor-crisis");

    const result = await runCrisisClassifier("any student message");

    // B1.5: MUST return crisis=true to route into §4.6 crisis-safe response
    expect(result.crisis).toBe(true);
    if (result.crisis) {
      expect(result.source).toBe("classifier_degraded_no_floor");
      expect(result.forceReview).toBe(true);
      expect(result.signatureId).toBeNull();
      expect(result.modelConfidence).toBeNull();
    }
  });

  it("CASE_B: empty signatures + Layer 2 OK (no crisis) → crisis=false, normal tutoring", async () => {
    // Layer 1: empty signature set
    // Layer 2: succeeds, says no crisis
    mockSignatureAndClassifierQueries({ data: [], error: null }, false, 0.92);

    const { runCrisisClassifier } =
      await import("../../server/services/tutor-crisis");

    const result = await runCrisisClassifier("what is 2+2");

    // Layer 2 succeeded with a real classification → normal path
    expect(result.crisis).toBe(false);
    expect(result.forceReview).toBe(false);
  });

  it("CASE_C: populated signatures (no match) + Layer 2 fails → crisis=false, forceReview=true (Layer 1 stands)", async () => {
    // Layer 1: has signatures but none match
    // Layer 2: fails (no config → returns isCrisis=false, confidence=0)
    mockSignatureQuery({
      data: [
        {
          id: "sig-001",
          signature_pattern: "SYNTHETIC_TEST_PATTERN_NEVER_MATCH_12345",
          signature_type: "crisis",
        },
      ],
      error: null,
    });

    const { runCrisisClassifier } =
      await import("../../server/services/tutor-crisis");

    const result = await runCrisisClassifier("what is the quadratic formula");

    // Layer 1 has a floor — its result stands. Turn proceeds, force-reviewed.
    expect(result.crisis).toBe(false);
    expect(result.forceReview).toBe(true);
  });

  it("CASE_D: signature table unreadable → crisis=true (fail closed)", async () => {
    // Layer 1: table read error
    // Layer 2: irrelevant — the table error triggers fail-closed in checkCrisisSignatures
    mockSignatureQuery({
      data: null,
      error: { message: "relation does not exist", code: "42P01" },
    });

    const { runCrisisClassifier } =
      await import("../../server/services/tutor-crisis");

    const result = await runCrisisClassifier("hello");

    // SCL-023: "Layer 1 signature table unreadable: fail closed on the turn"
    expect(result.crisis).toBe(true);
    if (result.crisis) {
      // Layer 1 returned triggered=true (fail closed), which makes this a
      // Layer 1 positive → source is "signature" in the existing logic.
      // (The table-unreadable case is handled in checkCrisisSignatures,
      // not as a separate source in runCrisisClassifier.)
      expect(result.forceReview).toBe(true);
    }
  });

  it("DEPLOYMENT_READINESS: checkCrisisSignatures reports layer1Empty=true when signature set has zero crisis rows", async () => {
    // This test proves the signal that B1.5 depends on: when there are no
    // crisis signatures seeded, the function must report layer1Empty=true
    // so the orchestrator can decide to fail closed on Layer 2 failure.
    mockSignatureQuery({
      data: [],
      error: null,
    });

    const { checkCrisisSignatures } =
      await import("../../server/services/tutor-crisis");

    const result = await checkCrisisSignatures("any text");

    expect(result.triggered).toBe(false);
    expect(result.layer1Empty).toBe(true);
    expect(result.signatureId).toBeNull();
  });

  it("DEPLOYMENT_READINESS: checkCrisisSignatures reports layer1Empty=false when signatures exist", async () => {
    mockSignatureQuery({
      data: [
        {
          id: "sig-001",
          signature_pattern: "SYNTHETIC_TEST_PATTERN_NEVER_MATCH_12345",
          signature_type: "crisis",
        },
      ],
      error: null,
    });

    const { checkCrisisSignatures } =
      await import("../../server/services/tutor-crisis");

    const result = await checkCrisisSignatures("normal homework question");

    expect(result.triggered).toBe(false);
    expect(result.layer1Empty).toBe(false);
    expect(result.signatureId).toBeNull();
  });

  it("SOURCE_ACCEPTED: CrisisResult type accepts classifier_degraded_no_floor and infrastructure_failure", async () => {
    // Type-level proof: these source values compile and are valid
    // crisis result shapes. If the type didn't accept them, this file
    // would not compile.
    const noFloor: Awaited<
      ReturnType<
        typeof import("../../server/services/tutor-crisis").runCrisisClassifier
      >
    > = {
      crisis: true,
      source: "classifier_degraded_no_floor",
      signatureId: null,
      modelConfidence: null,
      forceReview: true,
    };

    const infraFailure: Awaited<
      ReturnType<
        typeof import("../../server/services/tutor-crisis").runCrisisClassifier
      >
    > = {
      crisis: true,
      source: "infrastructure_failure",
      signatureId: null,
      modelConfidence: null,
      forceReview: true,
    };

    expect(noFloor.crisis).toBe(true);
    expect(infraFailure.crisis).toBe(true);
  });
});

describe("B1.5 — new source values accepted by CHECK constraint", () => {
  /**
   * This test validates the migration SQL for the widened CHECK constraint
   * by parsing the constraint values from the migration file. The actual
   * DB proof is in the ephemeral-PG test suite.
   */
  it("migration 20260819 includes classifier_degraded_no_floor and infrastructure_failure in CHECK", async () => {
    const fs = await import("fs");
    const path = await import("path");

    const migrationPath = path.resolve(
      __dirname,
      "../../supabase/migrations/20260819000000_crisis_source_no_floor_and_infra.sql",
    );
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toContain("'classifier_degraded_no_floor'");
    expect(sql).toContain("'infrastructure_failure'");
    expect(sql).toContain("crisis_review_cases_source_check");
  });
});
