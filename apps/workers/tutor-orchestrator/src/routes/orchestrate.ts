/**
 * @spec [Doc-03C_V3 §5.3 (Model Routing), §4.3 (Prompt Artifacts),
 *        Doc-03D_V1.2 §7.4 (Fact-Directive Pairing),
 *        SCL-041 (systemInstruction placement, supersedes §7.2),
 *        Doc-03B_V4.1 §6.5 step 14, Doc-03D_V1.2 §8.1 (prompt_version attribution)]
 * @implemented 2026-08-09
 * @updated 2026-08-18 — WS-L7: production port of ablation-proven prompt
 *   architecture (SCL-041). State blocks appended to systemInstruction instead
 *   of injected as [system note] user turns. Conversation messages carry only
 *   student/tutor turns with consecutive same-role merging. prompt_version
 *   returned on the wire per §8.1. System-role conversation messages mapped to
 *   user without [system note] wrapper.
 *
 * plain English: Worker route for tutor turn orchestration. Receives the assembled
 * context envelope (OrchestrateRequest), invokes the appropriate Vertex model via
 * the model routing table, and returns the tutor response (OrchestrateResponse).
 *
 * expected outcome: POST /orchestrate/turn accepts a validated OrchestrateRequest,
 * routes to the correct model alias (flash_class or pro_class per the 9-rule routing
 * table), builds a system instruction from the prompt artifact with state blocks
 * appended (SCL-041), builds conversation contents with same-role merging,
 * invokes Vertex with Model Armor input scanning, and returns the response with
 * Model Armor output scanning applied and prompt_version on the wire.
 *
 * trade-offs:
 *  - Model routing rules are hardcoded in the 9-rule precedence table (Doc 03C V3
 *    §5.3.1). Pro-to-Flash fallback on 5xx/429/timeout is handled by the vertex
 *    client. The routing table is deterministic — no A/B testing or randomness.
 *  - Routing rule 1 (`runtime_limits.model_override`, for debug/A-B) is implemented
 *    as an optional input to `resolveModelAlias`, but `orchestrateRequestSchema`
 *    (packages/shared, single source of truth) does not currently carry a
 *    `model_override` field — so this route never passes one. The rule is wired
 *    and unit-testable now; it activates with zero changes here once the shared
 *    wire schema grows the field.
 *  - Rule 2 (pro budget circuit breaker, Doc 03C V3 §5.3.3) needs daily Pro spend
 *    tracked centrally (03A V3 §18.7 runtime config); this stateless worker has no
 *    DB or cost-observability access. `isProBudgetCircuitBreakerTripped` reads a
 *    single ops-settable env var (`VERTEX_PRO_BUDGET_CIRCUIT_BREAKER_TRIPPED`) as
 *    the enforceable manual-override lever the spec explicitly calls out ("ops can
 *    disable the circuit breaker"); automatic spend-based tripping is a separate,
 *    cost-observability-pipeline concern, not implemented here.
 *  - Prompt artifact system (§4.3): prompt artifacts are versioned TypeScript
 *    modules loaded at import time (bootstrap). The registry resolves by
 *    (policy_variant, prompt_version) from the envelope. Only the "default"
 *    variant is authored in this pass. §4.3 references "03A V3 §11 (policy
 *    prompt artifacts)" for artifact authoring, but Doc 03A §11 is actually
 *    "Policy Decision Logging" — see SCL-040. The artifact format implemented
 *    here (TypeScript const with a render function) is the pragmatic resolution.
 *  - State blocks are appended to systemInstruction per SCL-041. §7.2's
 *    late-placement in user turns was falsified for Flash-class models (25/25
 *    non-compliance vs immediate compliance in systemInstruction). State blocks
 *    are separated from behavioral rules by a `--- CONTEXT FOR CURRENT QUESTION ---`
 *    separator.
 *  - Consecutive same-role messages are merged into a single entry with multiple
 *    parts. The @google/genai SDK silently merges consecutive same-role Content
 *    entries, which corrupts message boundaries. Explicit merging preserves
 *    message ordering and boundary markers (Doc 03D §7.3).
 *  - The deterministic PII guard (§4.2.2), content safety pre-pass (§4.5), and
 *    candidate-slot resolution for similar-question links (§5.9) are NOT
 *    implemented in this file — each is a distinct subsystem beyond this route's
 *    stated scope and needs its own dedicated pass before production traffic.
 *  - `question_links` and `instruction_exposures` are returned empty; structured
 *    output enforcement via Vertex `responseSchema` (§5.4 hybrid strictness) is
 *    not wired up in this pass — the model call is plain-text only.
 *  - Idempotency: per Doc 03C V3 §3.6, 03C is deliberately NOT idempotent — the
 *    BFF (Doc 03B V4.1 §13.7) owns the idempotency guard before this endpoint is
 *    ever called. No idempotency_key handling belongs here.
 *  - prompt_version is returned on the wire per Doc 03D §8.1 (attribution
 *    requirement: every turn must carry the prompt version that produced it).
 */
import { Router } from "express";
import type { Request, Response } from "express";
import {
  orchestrateRequestSchema,
  type OrchestrateRequest,
  type OrchestrateResponse,
} from "../lib/schema.js";
import {
  generateTutorResponse,
  logEvent,
  type ModelAlias,
  type VertexErrorCode,
  type VertexMessage,
  type VertexResponse,
} from "../lib/vertex-client.js";
import { resolvePromptArtifact } from "../prompts/prompt-registry.js";
import { renderStateBlocks } from "../prompts/render-state-blocks.js";

export const orchestrateRouter: Router = Router();

// ── Pure domain logic ───────────────────────────────────────────────────

type ModelRoutingInput = {
  sourceSurface: OrchestrateRequest["source_surface"];
  entryMode: OrchestrateRequest["entry_mode"];
  policyVariant: string;
  proBudgetCircuitBreakerTripped: boolean;
  modelOverride?: ModelAlias;
};

const PRO_VARIANT_ENTRY_MODES: ReadonlySet<string> = new Set([
  "scaffolded",
  "socratic",
]);
const FLASH_VARIANT_ENTRY_MODES: ReadonlySet<string> = new Set([
  "concise",
  "strategy_first",
]);

/**
 * Deterministic model routing per Doc 03C V3 §5.3.1's ordered 9-rule
 * precedence table. First matching rule wins.
 *
 * @spec [Doc-03C_V3 §5.3.1]
 */
export function resolveModelAlias(input: ModelRoutingInput): ModelAlias {
  // Priority 1: explicit override (debug/A-B). See file header trade-offs —
  // the current wire schema never populates this field yet.
  if (input.modelOverride) {
    return input.modelOverride;
  }
  // Priority 2: Pro budget circuit breaker tripped.
  if (input.proBudgetCircuitBreakerTripped) {
    return "flash_class";
  }
  // Priority 3-4: review surfaces always warrant Pro-class reasoning.
  if (
    input.sourceSurface === "test_review" ||
    input.sourceSurface === "review"
  ) {
    return "pro_class";
  }
  // Priority 5-6: dashboard coaching / session-level reflection.
  if (input.entryMode === "general" || input.entryMode === "scoped_session") {
    return "pro_class";
  }
  // Priority 7-8: scoped_question, split by policy variant.
  if (input.entryMode === "scoped_question") {
    if (PRO_VARIANT_ENTRY_MODES.has(input.policyVariant)) {
      return "pro_class";
    }
    if (FLASH_VARIANT_ENTRY_MODES.has(input.policyVariant)) {
      return "flash_class";
    }
  }
  // Priority 9: default fallback.
  return "flash_class";
}

/**
 * Reads the ops-settable manual override for the Pro budget circuit breaker
 * (Doc 03C V3 §5.3.3). See file header trade-offs for why automatic
 * spend-based tripping is out of scope for this worker.
 */
function isProBudgetCircuitBreakerTripped(): boolean {
  return (
    (process.env.VERTEX_PRO_BUDGET_CIRCUIT_BREAKER_TRIPPED ?? "")
      .trim()
      .toLowerCase() === "true"
  );
}

/**
 * Maps envelope recent_messages to Gemini-compatible messages per the role
 * table in Doc 03C V3 §4.2: student → user, tutor → model, system → user.
 *
 * SCL-041: state blocks are NOT placed in contents — they are appended to
 * systemInstruction by buildSystemInstruction. contents[] carries only the
 * conversation (student/tutor/system turns).
 *
 * Same-role merging: consecutive messages that map to the same Gemini role
 * are merged into a single VertexMessage. The @google/genai SDK silently
 * merges consecutive same-role Content entries, corrupting message boundaries.
 * Explicit merging preserves ordering and boundary markers (Doc 03D §7.3).
 *
 * System messages are mapped to user role without a [system note] wrapper —
 * the model receives the message content directly.
 *
 * @spec [Doc-03C_V3 §4.2; Doc-03D_V1.2 §7.3; SCL-041]
 */
export function buildConversationMessages(
  request: OrchestrateRequest,
): VertexMessage[] {
  // Step 1: map each message to its Gemini role and text.
  const raw: VertexMessage[] = request.recent_messages.map((message) => {
    if (message.role === "tutor") {
      return { role: "model", text: message.message };
    }
    if (message.role === "system") {
      // System messages become user-role (Gemini has no native system role
      // inside contents[]). No [system note] wrapper — directives are in
      // systemInstruction per SCL-041.
      return { role: "user", text: message.message };
    }
    // Student messages are wrapped in boundary markers so the model treats
    // them as data, not instructions (Doc 03A §12.3 Layer 3 injection defense).
    const wrapped = `${STUDENT_INPUT_OPEN}\n${message.message}\n${STUDENT_INPUT_CLOSE}`;
    return { role: "user", text: wrapped };
  });

  // Step 2: merge consecutive same-role messages into a single entry with
  // multiple parts (newline-separated). Prevents the @google/genai SDK from
  // silently merging and corrupting boundaries.
  const merged: VertexMessage[] = [];
  for (const msg of raw) {
    const prev = merged.length > 0 ? merged[merged.length - 1] : null;
    if (prev && prev.role === msg.role) {
      prev.text = `${prev.text}\n\n${msg.text}`;
    } else {
      merged.push({ role: msg.role, text: msg.text });
    }
  }

  return merged;
}

/**
 * Builds the full system instruction sent to Vertex: behavioral rules from
 * the versioned prompt artifact (Doc 03C V3 §4.3) + state blocks appended
 * after a separator (SCL-041).
 *
 * The artifact is selected by (policy_variant, prompt_version) from the
 * envelope. The render function receives typed PromptFields for field
 * substitution — no runtime prompt generation, no string interpolation
 * of untrusted data.
 *
 * State blocks are appended (not late-placed in contents) per SCL-041.
 * The separator `--- CONTEXT FOR CURRENT QUESTION ---` marks the boundary
 * between invariant behavioral rules and per-turn context. Each state block
 * pairs a fact with a directive (§7.4).
 *
 * @spec [Doc-03C_V3 §4.3; Doc-03D_V1.2 §7.4; SCL-041]
 */
export function buildSystemInstruction(request: OrchestrateRequest): string {
  const artifact = resolvePromptArtifact(
    request.policy_assignment.policy_variant,
    request.policy_assignment.prompt_version,
  );

  const behavioralRules = artifact.renderSystemInstruction({
    entryMode: request.entry_mode,
    sourceSurface: request.source_surface,
    policyVariant: request.policy_assignment.policy_variant,
    isPostSubmit: request.is_post_submit,
  });

  // SCL-041: append state blocks to systemInstruction. Flash-class models
  // attend to systemInstruction directives; the same directives placed in
  // user turns (§7.2's original placement) were consistently ignored.
  const stateBlocks = renderStateBlocks(request);
  if (stateBlocks) {
    return `${behavioralRules}\n\n--- CONTEXT FOR CURRENT QUESTION ---\n\n${stateBlocks}`;
  }

  return behavioralRules;
}

/** Per Doc 03C V3 §8.1: compaction is recommended once a conversation reaches
 * 20+ turns. Computed here (deterministically, from data already on the
 * envelope) so `orchestration_meta.compaction_recommended` is never guessed. */
function isCompactionRecommended(request: OrchestrateRequest): boolean {
  return request.recent_messages.length >= 20;
}

// ── Shared safety constants (single source of truth) ──────────────────
// All pure functions and constants are defined in shared/tutor-safety-constants.ts
// and COPIED into the worker at prebuild (byte-identical). CI enforces drift.
// The worker can't import from server/services/ (it drags in supabase-server
// and breaks the isolated Cloud Run buildpack), so the shared file has zero
// imports and is safe for both build contexts.
// @see shared/tutor-safety-constants.ts
// @see .github/workflows/ci.yml — "Safety-constants drift gate"

import {
  STUDENT_INPUT_OPEN,
  STUDENT_INPUT_CLOSE,
  TUTOR_ANTI_LEAK_SUBSTITUTION as WORKER_ANTI_LEAK_SUBSTITUTION,
  hasAnswerLeak,
} from "../lib/_tutor-safety-constants.generated";

/**
 * Maps a successful Vertex generation into the wire-contract OrchestrateResponse
 * shape. Applies worker-side anti-leak scan (LISA-FULL-001) when the request
 * carries a non-null correct_answer (pre-submit implied). `question_links` /
 * `instruction_exposures` are empty (see file header trade-offs — candidate-slot
 * resolution is not implemented in this pass).
 *
 * prompt_version is included in orchestration_meta per Doc 03D §8.1 (attribution
 * requirement: every turn must carry the prompt version that produced it).
 *
 * @spec [Doc-03C_V3 §7.1, INV-03-04, Doc-03D_V1.2 §8.1]
 */
export function buildOrchestrateResponse(
  vertexResponse: VertexResponse,
  request: OrchestrateRequest,
  promptVersion: string,
): OrchestrateResponse {
  // Worker-side anti-leak scan: fires PRE-SUBMIT ONLY (defense-in-depth).
  // Post-submit the model is EXPECTED to discuss the answer — suppressing it
  // would break the explanation flow. Gate on is_post_submit (server-derived
  // boolean), never on correct_answer presence — a caller-supplied field
  // gating a safety decision is a field an attacker sets (Doc 03D §6.3).
  // The primary pre-submit chokepoint is BFF-side scanAndSubstitute (INV-03-04).
  // @spec [Doc-03D_V1.2 §6.3, INV-03-04, Doc-03B_V4.1 §6.5 step 15]
  let content = vertexResponse.text;
  if (!request.is_post_submit && request.correct_answer !== null) {
    const leaked = hasAnswerLeak(content, request.correct_answer);
    if (leaked) {
      logEvent(
        "warn",
        "orchestrate_route",
        "worker_antileak_substituted",
        "Worker-side anti-leak scan detected answer leak in pre-submit response; substituting",
        {
          conversationId: request.conversation_id,
          isPostSubmit: request.is_post_submit,
        },
      );
      content = WORKER_ANTI_LEAK_SUBSTITUTION;
    }
  }

  return {
    response: {
      content,
      content_kind: "message",
      suggested_action: { type: "none", label: null },
      ui_hints: {
        show_accept_decline: false,
        allow_freeform_reply: true,
        suggested_chip: null,
      },
    },
    question_links: [],
    instruction_exposures: [],
    orchestration_meta: {
      model_name: vertexResponse.providerModel,
      prompt_version: promptVersion,
      cache_used: false,
      compaction_recommended: isCompactionRecommended(request),
    },
    learner_observation: null,
  };
}

/**
 * Maps a Vertex error classification to an HTTP status. 429 is mapped to 503
 * (not 429) so the BFF's existing retry logic in
 * server/lib/tutor-orchestrator-client.ts — which only retries on status
 * >= 500 — treats a Vertex quota exhaustion as transient/retriable, matching
 * Doc 03C V3 §5.3.2's intent even though the BFF's retry classifier predates
 * that nuance.
 *
 * @spec [Doc-03B_V4.1 §7.3 / Doc-03C_V3 §5.3.2, §5.8; Coding Standards §8.3]
 */
function mapVertexErrorToStatus(code: VertexErrorCode): number {
  switch (code) {
    case "vertex_400_invalid_request":
      return 400;
    case "vertex_422_safety_blocked":
      return 422;
    case "vertex_5xx_retriable":
    case "vertex_429_quota":
    case "vertex_timeout":
      return 503;
    case "vertex_403_auth":
    case "vertex_model_armor_unconfigured":
    case "vertex_unknown":
      return 500;
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}

// ── Route handler ────────────────────────────────────────────────────────
// Auth is enforced upstream by createWorkerBoundaryAuthMiddleware (index.ts
// mounts it before this router — Doc 03C V3 §9.1 BFF->worker boundary auth).
// Entitlement/role checks are the BFF's job (Doc 03B V4.1 §6.5 steps 1-4);
// this worker trusts the boundary, never re-derives role/entitlement state.

orchestrateRouter.post("/turn", async (req: Request, res: Response) => {
  const parsed = orchestrateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        message: "Invalid OrchestrateRequest",
        details: parsed.error.flatten(),
      },
    });
    return;
  }
  const request = parsed.data;

  const modelAlias = resolveModelAlias({
    sourceSurface: request.source_surface,
    entryMode: request.entry_mode,
    policyVariant: request.policy_assignment.policy_variant,
    proBudgetCircuitBreakerTripped: isProBudgetCircuitBreakerTripped(),
  });

  const messages = buildConversationMessages(request);
  const systemInstruction = buildSystemInstruction(request);

  // Resolve prompt version for attribution (§8.1) and observability (§4.3).
  const resolvedArtifact = resolvePromptArtifact(
    request.policy_assignment.policy_variant,
    request.policy_assignment.prompt_version,
  );
  const promptVersion = resolvedArtifact.version;

  logEvent(
    "info",
    "orchestrate_route",
    "prompt_artifact_resolved",
    "Resolved prompt artifact for tutor turn",
    {
      conversationId: request.conversation_id,
      policyVariant: request.policy_assignment.policy_variant,
      requestedPromptVersion: request.policy_assignment.prompt_version,
      resolvedPromptVersion: promptVersion,
      modelAlias,
    },
  );

  const result = await generateTutorResponse(
    modelAlias,
    messages,
    systemInstruction,
    {
      maxOutputTokens: request.runtime_limits.max_output_tokens,
      timeoutMs: request.runtime_limits.timeout_ms,
    },
    {
      inputTemplateId: request.model_armor_input_template_id,
      outputTemplateId: request.model_armor_output_template_id,
    },
  );

  if (!result.ok) {
    logEvent(
      "error",
      "orchestrate_route",
      "orchestration_failed",
      "Vertex generation failed for a tutor turn",
      {
        errorCode: result.errorCode,
        conversationId: request.conversation_id,
        modelAlias,
      },
    );
    res.status(mapVertexErrorToStatus(result.errorCode)).json({
      error: { message: "Orchestration failed", code: result.errorCode },
    });
    return;
  }

  const response = buildOrchestrateResponse(
    result.value,
    request,
    promptVersion,
  );
  res.status(200).json(response);
});
