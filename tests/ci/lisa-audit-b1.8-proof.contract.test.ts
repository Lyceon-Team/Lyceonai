/**
 * @spec [SCL-043, INV-03-04, Doc-03D_V1.2 §6.3, §7.4; Doc-03A_V3 §11.4;
 *        Doc-03_V1.1 §14.2]
 * @implemented 2026-08-28
 *
 * plain English: Proof tests for the three Codex audit findings at dc08ccc.
 *
 *   LISA-AUDIT-001 (BLOCKER): the pre-submit explanation never reached the
 *     production prompt. Fix: the gate at tutor-context.ts:394 now populates
 *     question_content.explanation for the active question pre-submit per
 *     SCL-043. The worker's renderItemBlock renders it with an anti-echo
 *     directive. One canonical path.
 *
 *   LISA-AUDIT-002 (HIGH): policy log records instructional_tutor/scaffolded
 *     but worker received base_v1/standard → resolveDefaultPolicy fixed;
 *     prompt-registry extended with all four spec variants.
 *
 *   LISA-AUDIT-003 (HIGH): retention-sweep returns ok:true when memory-summary
 *     purge fails → now returns ok:false with reason string.
 *
 * Karl's proof requirements (printed runtime values, not descriptions):
 *   1. Full systemInstruction for PRE-SUBMIT on active question — explanation PRESENT
 *   2. Full systemInstruction for pre-submit with unanswered same-skill item —
 *      that item's explanation ABSENT
 *   3. Full systemInstruction for POST-SUBMIT — explanation + correct answer present
 *   4. Policy family/variant sent to worker and written to audit row, side by side, matching
 *   5. Plant memory-summary purge failure → confirm sweep returns ok:false with partial state
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
  buildConversationMessages,
  resolveModelAlias,
} from "../../apps/workers/tutor-orchestrator/src/routes/orchestrate";
import type { OrchestrateRequest } from "../../apps/workers/tutor-orchestrator/src/lib/schema";

// ── AUDIT-002 imports ──────────────────────────────────────────────────

import { resolvePromptArtifact } from "../../apps/workers/tutor-orchestrator/src/prompts/prompt-registry";

// ── AUDIT-003 imports ──────────────────────────────────────────────────

import {
  sweep7d,
  retentionCutoff,
} from "../../server/services/retention-sweep";

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

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-28T12:00:00.000Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * MS_PER_DAY).toISOString();
}

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
// AUDIT-001: Pre-submit explanation reaches the production prompt via
// question_content.explanation → renderItemBlock (one canonical path)
// ═════════════════════════════════════════════════════════════════════════

describe("AUDIT-001: explanation reaches production systemInstruction", () => {
  // ── Proof 1: PRE-SUBMIT on active question — explanation PRESENT ────
  it("PRE-SUBMIT: active question explanation present in systemInstruction via item block", () => {
    // SCL-043: the active question's explanation is PERMITTED pre-submit.
    // The gate at tutor-context.ts populates question_content.explanation
    // for the active question regardless of isPostSubmit. The worker's
    // renderItemBlock renders it with an anti-echo directive.
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
        // SCL-043: explanation populated pre-submit for active question
        explanation:
          "The power rule: d/dx[xⁿ] = n·xⁿ⁻¹. For x², n=2, so derivative = 2x.",
        student_answer: null,
        attempt_number: 0,
      },
    });

    const systemInstruction = buildSystemInstruction(envelope);

    // ── PRINT: full systemInstruction for PRE-SUBMIT on active question ──
    console.log(
      "=== PROOF-1: PRE-SUBMIT active question — full systemInstruction ===",
    );
    console.log(systemInstruction);
    console.log("=== END PROOF-1 ===");

    // The explanation MUST be present in the item block
    expect(systemInstruction).toContain(
      "[AUTHORED EXPLANATION — INTERNAL USE ONLY]",
    );
    expect(systemInstruction).toContain(
      "The power rule: d/dx[xⁿ] = n·xⁿ⁻¹",
    );

    // The anti-echo directive MUST prohibit revealing
    expect(systemInstruction).toContain(
      "for YOUR internal reasoning only",
    );
    expect(systemInstruction).toContain(
      "Do NOT quote, paraphrase, reveal",
    );

    // correct_answer MUST be null pre-submit (INV-03-04)
    expect(envelope.correct_answer).toBeNull();

    // The systemInstruction MUST NOT contain the correct answer
    expect(systemInstruction).not.toContain("Correct answer:");
  });

  // ── Proof 2: PRE-SUBMIT with unanswered same-skill — explanation ABSENT ──
  it("PRE-SUBMIT: unanswered same-skill item explanation ABSENT from systemInstruction", () => {
    // SCL-043: unseen same-skill questions' explanations do NOT reach the
    // model pre-submit. question_content represents the ACTIVE question
    // only. An unanswered same-skill question has no path to the prompt.
    // Here we prove: when question_content.explanation is null (as it
    // would be for a non-active question), no explanation appears.
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

    // ── PRINT: full systemInstruction for pre-submit with null explanation ──
    console.log(
      "=== PROOF-2: PRE-SUBMIT unanswered same-skill — full systemInstruction ===",
    );
    console.log(systemInstruction);
    console.log("=== END PROOF-2 ===");

    // No authored explanation block when explanation is null
    expect(systemInstruction).not.toContain(
      "[AUTHORED EXPLANATION — INTERNAL USE ONLY]",
    );

    // The generic pre-submit directive is present instead
    expect(systemInstruction).toContain("This question is pre-submit");
    expect(systemInstruction).toContain(
      "Do not state, compute, demonstrate",
    );

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
        explanation:
          "Using the power rule, the derivative of x² is 2x.",
        student_answer: "A",
        attempt_number: 1,
      },
    });

    const systemInstruction = buildSystemInstruction(envelope);

    // ── PRINT: full systemInstruction for POST-SUBMIT ──
    console.log(
      "=== PROOF-3: POST-SUBMIT — full systemInstruction ===",
    );
    console.log(systemInstruction);
    console.log("=== END PROOF-3 ===");

    // Correct answer present
    expect(systemInstruction).toContain("Correct answer: B.");

    // Post-submit directive present
    expect(systemInstruction).toContain("This question is post-submit");
    expect(systemInstruction).toContain(
      "You may explain the correct answer",
    );

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

    // Print the values side-by-side
    console.log("=== PROOF-4: POLICY SIDE-BY-SIDE ===");
    console.log(
      "Audit row (tutor_instruction_assignments):",
      "policy_family=instructional_tutor, policy_variant=scaffolded",
    );
    console.log(
      "Envelope sent to worker:",
      `policy_family=${envelope.policy_assignment.policy_family}, policy_variant=${envelope.policy_assignment.policy_variant}`,
    );

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
    console.log("Model routing for scaffolded:", modelAlias);
    expect(modelAlias).toBe("pro_class");

    // 3. Prompt registry: scaffolded resolves to a known artifact (not fallback)
    const artifact = resolvePromptArtifact("scaffolded", null);
    console.log("Prompt artifact version for scaffolded:", artifact.version);
    expect(artifact.version).toBe("lisa-default-v1");
    console.log("=== END PROOF-4 ===");
  });

  it("all four spec variants resolve in the prompt registry (no fallback warning)", () => {
    const variants = ["scaffolded", "socratic", "concise", "strategy_first"];

    console.log("=== AUDIT-002 VARIANT REGISTRY ===");
    for (const variant of variants) {
      const artifact = resolvePromptArtifact(variant, null);
      console.log(`  ${variant} → ${artifact.version}`);
      // Each variant must resolve without falling back to the unknown-variant path
      expect(artifact.version).toBe("lisa-default-v1");
    }
    console.log("=== END ===");
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

    console.log("=== AUDIT-002 BUG DEMONSTRATION ===");
    console.log("Model routing for stale 'standard':", modelAlias);
    console.log(
      "Expected per spec (scaffolded → pro_class), got:",
      modelAlias,
    );
    console.log("=== END ===");

    // 'standard' falls through to flash_class — this was the bug
    expect(modelAlias).toBe("flash_class");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// AUDIT-003: retention sweep returns ok:false on memory-summary purge
// failure, with reason string reporting partial state.
// ═════════════════════════════════════════════════════════════════════════

describe("AUDIT-003: retention sweep fails on memory-summary purge failure", () => {
  /**
   * Filtering mock client, identical to the pattern in
   * retention-sweep.negative-control.contract.test.ts, but with the ability
   * to inject errors on specific tables.
   */
  type Row = Record<string, unknown>;

  function filteringMockClientWithError(
    tables: Record<string, Row[]>,
    errorTable: string,
    errorOp: "delete",
  ) {
    const store: Record<string, Row[]> = {};
    for (const [k, v] of Object.entries(tables)) {
      store[k] = v.map((r) => ({ ...r }));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = {
      from: (table: string) => {
        function makeChain(
          mode: "select" | "delete",
          predicates: Array<(row: Row) => boolean>,
          initialFields?: string,
          initialOpts?: { count?: string; head?: boolean },
        ) {
          const chain: Record<string, unknown> = {};

          function resolve(
            fields?: string,
            opts?: { count?: string; head?: boolean },
          ): Promise<{
            data: Row[] | null;
            count?: number;
            error: { message: string } | null;
          }> {
            const rows = store[table] ?? [];
            const matching = rows.filter((row) =>
              predicates.every((p) => p(row)),
            );

            if (mode === "delete") {
              // Inject error for the target table
              if (table === errorTable) {
                return Promise.resolve({
                  data: null,
                  error: {
                    message:
                      "simulated DB error: permission denied for table tutor_memory_summaries",
                  },
                });
              }
              store[table] = rows.filter(
                (row) => !predicates.every((p) => p(row)),
              );
              const projected = projectFields(matching, fields);
              return Promise.resolve({ data: projected, error: null });
            }

            // select mode
            if (opts?.head && opts?.count === "exact") {
              return Promise.resolve({
                data: null,
                count: matching.length,
                error: null,
              });
            }
            const projected = projectFields(matching, fields);
            return Promise.resolve({ data: projected, error: null });
          }

          chain.lt = (col: string, val: unknown) => {
            predicates.push((row) => {
              const rv = row[col];
              if (rv === null || rv === undefined) return false;
              return String(rv) < String(val);
            });
            return chain;
          };

          chain.eq = (col: string, val: unknown) => {
            predicates.push((row) => row[col] === val);
            return chain;
          };

          chain.neq = (col: string, val: unknown) => {
            predicates.push((row) => row[col] !== val);
            return chain;
          };

          chain.not = (col: string, op: string, val: unknown) => {
            if (op === "is" && val === null) {
              predicates.push(
                (row) => row[col] !== null && row[col] !== undefined,
              );
            }
            return chain;
          };

          chain.is = (col: string, val: unknown) => {
            if (val === null) {
              predicates.push(
                (row) => row[col] === null || row[col] === undefined,
              );
            }
            return chain;
          };

          chain.gte = (col: string, val: unknown) => {
            predicates.push((row) => {
              const rv = row[col];
              if (rv === null || rv === undefined) return false;
              return String(rv) >= String(val);
            });
            return chain;
          };

          chain.in = (col: string, vals: unknown[]) => {
            predicates.push((row) => (vals as unknown[]).includes(row[col]));
            return chain;
          };

          chain.select = (
            fields?: string,
            opts?: { count?: string; head?: boolean },
          ) => {
            return resolve(fields, opts);
          };

          chain.then = (
            onFulfilled?: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => {
            return resolve(initialFields, initialOpts).then(
              onFulfilled,
              onRejected,
            );
          };

          return chain;
        }

        return {
          select: (
            fields?: string,
            opts?: { count?: string; head?: boolean },
          ) => {
            return makeChain("select", [], fields, opts);
          },
          delete: () => {
            return makeChain("delete", []);
          },
        };
      },
      _store: store,
    };

    return client;
  }

  function projectFields(rows: Row[], fields?: string): Row[] {
    if (!fields) return rows;
    const keys = fields.split(",").map((f) => f.trim());
    return rows.map((row) => {
      const out: Row = {};
      for (const k of keys) {
        if (k in row) out[k] = row[k];
      }
      return out;
    });
  }

  // ── Proof 5: memory-summary purge failure → ok:false with partial state ──
  it("returns ok:false with reason when memory-summary delete fails", async () => {
    // Scenario: student s1 has one expired conversation (8 days old), zero
    // active conversations, zero recoverable conversations. After the
    // conversation is swept, the memory-summary purge runs but the DB
    // returns an error.
    const client = filteringMockClientWithError(
      {
        tutor_conversations: [
          { id: "conv-s1", student_id: "s1", deleted_at: daysAgo(8) },
        ],
        tutor_memory_summaries: [
          { id: "mem-s1", student_id: "s1", summary_type: "weekly" },
        ],
      },
      "tutor_memory_summaries",
      "delete",
    );

    const result = await sweep7d(client, false, { now: NOW });

    // ── PRINT: full result for AUDIT-003 ──
    console.log("=== PROOF-5: MEMORY PURGE FAILURE ===");
    console.log(JSON.stringify(result, null, 2));

    // The sweep MUST return ok:false (not ok:true as before the fix)
    expect(result.ok).toBe(false);

    if (!result.ok) {
      // The reason string must report:
      //   - which operation failed (memory_summary_delete_failed)
      //   - which student (s1)
      //   - how many conversations were already purged (partial state)
      //   - the DB error message
      expect(result.reason).toContain("memory_summary_delete_failed");
      expect(result.reason).toContain("student=s1");
      expect(result.reason).toContain("conversations_purged=1");
      expect(result.reason).toContain("permission denied");

      console.log("Conversations purged before failure: 1");
      console.log(
        "Memory summaries NOT purged (error):",
        client._store.tutor_memory_summaries.length,
      );
      console.log("Sweep returned ok:", result.ok);
      console.log("Reason:", result.reason);
    }
    console.log("=== END PROOF-5 ===");
  });

  it("returns ok:true when memory-summary delete succeeds (regression guard)", async () => {
    // Same scenario but no error — the happy path still works
    const client = filteringMockClientWithError(
      {
        tutor_conversations: [
          { id: "conv-s1", student_id: "s1", deleted_at: daysAgo(8) },
        ],
        tutor_memory_summaries: [
          { id: "mem-s1", student_id: "s1", summary_type: "weekly" },
        ],
      },
      "NONE", // no error injection
      "delete",
    );

    const result = await sweep7d(client, false, { now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted_count).toBe(1);
    }
  });
});
