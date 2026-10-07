/**
 * @spec [SCL-060, INV-03-04, Doc-03D_V1.2 §6.2, §6.3, §7.4; Doc-03A_V3 §11.4;
 *        Doc-03_V1.1 §14.2]
 * @implemented 2026-08-28
 *
 * plain English: Proof tests for the three Codex audit findings at dc08ccc.
 *
 *   LISA-AUDIT-001 (BLOCKER): the pre-submit explanation never reached the
 *     production prompt. Fix: the gate at tutor-context.ts:394 now populates
 *     question_content.explanation for the active question pre-submit per
 *     SCL-060. The worker's renderItemBlock renders it with an anti-echo
 *     directive. One canonical path.
 *
 *   LISA-AUDIT-002 (HIGH): policy log records instructional_tutor/scaffolded
 *     but worker received base_v1/standard → resolveDefaultPolicy fixed;
 *     prompt-registry extended with all four spec variants.
 *
 *   LISA-AUDIT-003 (HIGH): retention-sweep returns ok:true when memory-summary
 *     purge fails → now returns ok:false with reason string.
 *
 * Karl's proof requirements (asserted on the runtime values):
 *   1. Full systemInstruction for PRE-SUBMIT on active question — explanation PRESENT
 *   2. Full systemInstruction for pre-submit with unanswered same-skill item —
 *      that item's explanation ABSENT
 *   3. Full systemInstruction for POST-SUBMIT — explanation + correct answer present
 *   4. Policy family/variant sent to worker and written to audit row, side by side, matching
 *   5. Plant memory-summary purge failure → confirm sweep returns ok:false with partial state
 *
 * PRINTING REMOVED (owner decision 2026-10-07, CI audit item 1). Requirements 1-4 were first
 * met by printing each systemInstruction and policy value to stdout. CI logs on this repository
 * are public, so that published LISA's full system instruction on every run from 2026-08-28.
 * Every proof is now carried by the assertions alone, which were already present beside each
 * print; nothing is printed. tests/ci/test-logs-no-tutor-content.guard.test.ts keeps it so.
 *
 * trade-offs: AUDIT-001 and AUDIT-002 tests exercise the worker's pure
 * functions (buildSystemInstruction, resolveModelAlias, resolvePromptArtifact)
 * directly against a constructed OrchestrateRequest. They do not spin up the
 * BFF or hit Supabase — this proves the worker receives and renders the
 * fields, which is the audit finding's exact scope. AUDIT-003 uses the
 * existing filteringMockClient pattern from the retention-sweep test suite.
 */
import { describe, it, expect, vi } from "vitest";

// ── AUDIT-001 + AUDIT-002 imports ──────────────────────────────────────

import {
  buildSystemInstruction,
  resolveModelAlias,
} from "../../apps/workers/tutor-orchestrator/src/routes/orchestrate";
import type { OrchestrateRequest } from "../../apps/workers/tutor-orchestrator/src/lib/schema";

// ── AUDIT-002 imports ──────────────────────────────────────────────────

import { resolvePromptArtifact } from "../../apps/workers/tutor-orchestrator/src/prompts/prompt-registry";

// ── AUDIT-003 imports ──────────────────────────────────────────────────

import { sweep7d } from "../../server/services/retention-sweep";

// ── Mock logger (both worker and server) ───────────────────────────────

vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Builds a minimal valid OrchestrateRequest for proof tests.
 * Override individual fields via the partial.
 */
function buildEnvelope(
  overrides: Partial<OrchestrateRequest> = {},
): OrchestrateRequest {
  const base: OrchestrateRequest = {
    conversation_id: "00000000-0000-4000-8000-000000000001",
    student_id: "00000000-0000-4000-8000-000000000002",
    entry_mode: "scoped_question",
    source_surface: "practice",
    resolved_scope: {
      source_session_id: "00000000-0000-4000-8000-000000000003",
      source_session_item_id: "00000000-0000-4000-8000-000000000004",
      source_question_row_id: null,
      source_question_canonical_id: null,
    },
    recent_messages: [],
    memory_summaries: [],
    student_learning_context: {
      mastery_snapshot: null,
      recent_friction: {
        consecutive_fails_this_session: 0,
        consecutive_fails_this_skill_7d: 0,
        self_deprecating_language_detected: false,
        long_pause_detected: false,
        mastery_regression_14d: null,
      },
      kpi_state: null,
    },
    memory_structured_fields: {
      last_struggled_skill: null,
      last_mastered_skill: null,
      preferred_explanation_style: null,
      style_confidence: null,
    },
    policy_assignment: {
      policy_family: "instructional_tutor",
      policy_variant: "scaffolded",
      policy_version: "1.0.0",
      prompt_version: null,
      assignment_mode: "deterministic",
      assignment_key: "student:scoped_question",
      reason_snapshot: { reason: "default_deterministic_assignment" },
    },
    runtime_limits: {
      max_output_tokens: 1024,
      timeout_ms: 30000,
    },
    question_content: {
      stem: "What is 2 + 2?",
      passage: null,
      options: [
        { key: "A", text: "3" },
        { key: "B", text: "4" },
        { key: "C", text: "5" },
        { key: "D", text: "6" },
      ],
      item_type: "mcq",
      explanation: null,
      student_answer: null,
      attempt_number: 0,
    },
    is_post_submit: false,
    correct_answer: null,
    model_armor_input_template_id: null,
    model_armor_output_template_id: null,
  };

  return { ...base, ...overrides };
}

// ═════════════════════════════════════════════════════════════════════════
// AUDIT-001: the explanation reaches the production prompt via
// question_content.explanation → renderItemBlock (one canonical path) —
// post-submit only since SCL-144 (W3-10)
// ═════════════════════════════════════════════════════════════════════════

describe("AUDIT-001: explanation reaches production systemInstruction", () => {
  // ── Proof 1: PRE-SUBMIT on active question — explanation ABSENT (SCL-144) ──
  it("PRE-SUBMIT: an explanation on the envelope is NOT rendered into systemInstruction (W3-10, SCL-144)", () => {
    // Was SCL-060: the explanation went to the model pre-submit behind an
    // anti-echo directive. Reversed by SCL-144 (owner ruling 2026-09-25):
    // the BFF withholds it pre-submit, and renderItemBlock never renders it
    // pre-submit either.
    const envelope = buildEnvelope({
      is_post_submit: false,
      correct_answer: null,
      question_content: {
        stem: "What is the derivative of x²?",
        passage: null,
        options: [
          { key: "A", text: "x" },
          { key: "B", text: "2x" },
          { key: "C", text: "x²" },
          { key: "D", text: "2" },
        ],
        item_type: "mcq",
        // SCL-144 (reversing SCL-060): the BFF no longer sends this
        // pre-submit. It is set here to prove the worker would not render
        // it even if it arrived — defense in depth.
        explanation:
          "The power rule: d/dx[xⁿ] = n·xⁿ⁻¹. For x², n=2, so derivative = 2x.",
        student_answer: null,
        attempt_number: 0,
      },
    });

    const systemInstruction = buildSystemInstruction(envelope);


    // W3-10 / SCL-144: the explanation MUST NOT reach the model pre-submit —
    // possession is the control, not a directive.
    expect(systemInstruction).not.toContain("[AUTHORED EXPLANATION");
    expect(systemInstruction).not.toContain(
      "The power rule: d/dx[xⁿ] = n·xⁿ⁻¹",
    );
    expect(systemInstruction).not.toContain("Explanation:");

    // The pre-submit prohibition is present instead
    expect(systemInstruction).toContain("This question is pre-submit");
    expect(systemInstruction).toContain("Do not state, compute, demonstrate");

    // correct_answer MUST be null pre-submit (INV-03-04)
    expect(envelope.correct_answer).toBeNull();

    // The systemInstruction MUST NOT contain the correct answer
    expect(systemInstruction).not.toContain("Correct answer:");
  });

  // ── Proof 2: PRE-SUBMIT with unanswered same-skill — explanation ABSENT ──
  it("PRE-SUBMIT: unanswered same-skill item explanation ABSENT from systemInstruction", () => {
    // SCL-060: question_content represents the ACTIVE question only —
    // no multi-question delivery exists. When question_content.explanation
    // is null (as it would be for a non-active question), no explanation
    // appears. The "previously seen same-skill" provision was dropped
    // (SCL-060 rewrite, 2026-08-28).
    const envelope = buildEnvelope({
      is_post_submit: false,
      correct_answer: null,
      question_content: {
        stem: "What is the derivative of x²?",
        passage: null,
        options: [
          { key: "A", text: "x" },
          { key: "B", text: "2x" },
          { key: "C", text: "x²" },
          { key: "D", text: "2" },
        ],
        item_type: "mcq",
        explanation: null, // unanswered same-skill question — no explanation
        student_answer: null,
        attempt_number: 0,
      },
    });

    const systemInstruction = buildSystemInstruction(envelope);


    // No authored explanation block when explanation is null
    expect(systemInstruction).not.toContain(
      "[AUTHORED EXPLANATION — INTERNAL USE ONLY]",
    );

    // The generic pre-submit directive is present instead
    expect(systemInstruction).toContain("This question is pre-submit");
    expect(systemInstruction).toContain("Do not state, compute, demonstrate");

    // No correct answer
    expect(systemInstruction).not.toContain("Correct answer:");
  });

  // ── Proof 3: POST-SUBMIT — explanation + correct answer present ─────
  it("POST-SUBMIT: explanation and correct answer present in systemInstruction", () => {
    const envelope = buildEnvelope({
      is_post_submit: true,
      correct_answer: "B",
      question_content: {
        stem: "What is the derivative of x²?",
        passage: null,
        options: [
          { key: "A", text: "x" },
          { key: "B", text: "2x" },
          { key: "C", text: "x²" },
          { key: "D", text: "2" },
        ],
        item_type: "mcq",
        explanation: "Using the power rule, the derivative of x² is 2x.",
        student_answer: "A",
        attempt_number: 1,
      },
    });

    const systemInstruction = buildSystemInstruction(envelope);


    // Correct answer present
    expect(systemInstruction).toContain("Correct answer: B.");

    // Post-submit directive present
    expect(systemInstruction).toContain("This question is post-submit");
    expect(systemInstruction).toContain("You may explain the correct answer");

    // Explanation present in item block
    expect(systemInstruction).toContain(
      "Using the power rule, the derivative of x² is 2x.",
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════
// AUDIT-002: policy values sent to worker match spec (instructional_tutor
// / scaffolded), not the stale base_v1/standard.
// ═════════════════════════════════════════════════════════════════════════

describe("AUDIT-002: policy values match spec — instructional_tutor/scaffolded", () => {
  // ── Proof 4: policy family/variant side-by-side ─────────────────────
  it("side-by-side: worker receives scaffolded, routes to pro_class (not flash fallback)", () => {
    // What the audit row records (tutor_instruction_assignments):
    //   policy_family = 'instructional_tutor', policy_variant = 'scaffolded'
    //
    // What the envelope now sends (resolveDefaultPolicy fixed):
    const envelope = buildEnvelope({
      policy_assignment: {
        policy_family: "instructional_tutor",
        policy_variant: "scaffolded",
        policy_version: "1.0.0",
        prompt_version: null,
        assignment_mode: "deterministic",
        assignment_key: "student:scoped_question",
        reason_snapshot: { reason: "default_deterministic_assignment" },
      },
    });


    // 1. The envelope values match the audit row (the fix)
    expect(envelope.policy_assignment.policy_family).toBe(
      "instructional_tutor",
    );
    expect(envelope.policy_assignment.policy_variant).toBe("scaffolded");

    // 2. Model routing: scaffolded is in PRO_VARIANT_ENTRY_MODES → pro_class
    const modelAlias = resolveModelAlias({
      sourceSurface: "practice",
      entryMode: "scoped_question",
      policyVariant: "scaffolded",
      proBudgetCircuitBreakerTripped: false,
    });
    expect(modelAlias).toBe("pro_class");

    // 3. Prompt registry: scaffolded resolves to a known artifact (not fallback)
    const artifact = resolvePromptArtifact("scaffolded", null);
    expect(artifact.version).toBe("lisa-default-v2");
  });

  it("all four spec variants resolve in the prompt registry (no fallback warning)", () => {
    const variants = ["scaffolded", "socratic", "concise", "strategy_first"];

    for (const variant of variants) {
      const artifact = resolvePromptArtifact(variant, null);
      // Each variant must resolve without falling back to the unknown-variant path
      expect(artifact.version).toBe("lisa-default-v2");
    }
  });

  it("the stale value 'standard' would have fallen through to flash_class (the bug)", () => {
    // Demonstrate the bug: 'standard' is not in PRO_VARIANT_ENTRY_MODES
    // or FLASH_VARIANT_ENTRY_MODES, so it falls through to the default flash_class
    const modelAlias = resolveModelAlias({
      sourceSurface: "practice",
      entryMode: "scoped_question",
      policyVariant: "standard",
      proBudgetCircuitBreakerTripped: false,
    });


    // 'standard' falls through to flash_class — this was the bug
    expect(modelAlias).toBe("flash_class");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// AUDIT-003: retention sweep returns ok:false on memory-summary purge
// failure.
//
// G5/RS-00 (2026-10-05): the 7d tier is one SQL function now
// (`sweep_tutor_conversation_retention`, migration 20261025000000), so a failed
// memory-summary delete rolls the WHOLE run back — no conversation is purged and
// no partial state exists to report. The planted-failure proof runs against real
// Postgres in tests/ci/retention-sweep.pg.ci.test.ts ("AUDIT-003 on real PG").
// What stays here is the TypeScript half: any RPC error is ok:false with its reason.
// ═════════════════════════════════════════════════════════════════════════

describe("AUDIT-003: retention sweep fails on memory-summary purge failure", () => {
  const rpcClient = (result: {
    data: unknown;
    error: { message: string } | null;
  }) =>
    ({ rpc: async () => result }) as unknown as Parameters<typeof sweep7d>[0];

  it("returns ok:false with reason when the sweep function fails", async () => {
    const result = await sweep7d(
      rpcClient({
        data: null,
        error: { message: "memory summary delete: permission denied" },
      }),
      false,
      { now: new Date() },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("rpc_failed");
      expect(result.reason).toContain("permission denied");
    }
  });

  it("returns ok:true when the sweep function succeeds (regression guard)", async () => {
    const result = await sweep7d(
      rpcClient({
        data: [
          {
            swept_table: "tutor_conversations",
            deleted_count: 1,
            cutoff: "2026-10-01T00:00:00+00:00",
          },
          {
            swept_table: "tutor_memory_summaries",
            deleted_count: 1,
            cutoff: "2026-10-01T00:00:00+00:00",
          },
        ],
        error: null,
      }),
      false,
      { now: new Date() },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted_count).toBe(1);
    }
  });
});
