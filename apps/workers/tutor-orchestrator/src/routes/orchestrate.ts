/**
 * @spec [Doc-03C_V3 §5.3 (Model Routing), §4.3 (Prompt Artifacts),
 *        Doc-03D_V1.2 §7.2 (Late Block Placement), §7.4 (Fact-Directive Pairing),
 *        Doc-03B_V4.1 §6.5 step 14]
 * @implemented 2026-08-09
 * @updated 2026-08-17 — WS-L5: prompt template artifact system replaces the
 *   static placeholder. System instruction now comes from a versioned, immutable
 *   prompt artifact (§4.3) loaded at bootstrap via the prompt registry. Context
 *   blocks (mastery, friction, memory, style) are rendered as late-placed
 *   [system note] messages per §7.2, with fact-directive pairing per §7.4.
 *   SCL-034 through SCL-039 behavioral directives are encoded in the artifact
 *   and in the paired state-block directives.
 *
 * plain English: Worker route for tutor turn orchestration. Receives the assembled
 * context envelope (OrchestrateRequest), invokes the appropriate Vertex model via
 * the model routing table, and returns the tutor response (OrchestrateResponse).
 *
 * expected outcome: POST /orchestrate/turn accepts a validated OrchestrateRequest,
 * routes to the correct model alias (flash_class or pro_class per the 9-rule routing
 * table), builds a system instruction from the prompt artifact and injects
 * context-aware state blocks, invokes Vertex with Model Armor input scanning,
 * and returns the response with Model Armor output scanning applied.
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
 *  - State blocks are late-placed per Doc 03D §7.2: injected as a [system note]
 *    immediately before the final student turn, not adjacent to the system
 *    instruction. This preserves prompt-cache stability (system instruction is
 *    invariant across turns) and improves adherence (proximity to current turn).
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
 *  - prompt_version is read from the envelope (policy_assignment.prompt_version)
 *    to select the artifact, and logged for observability. The wire-contract
 *    response schema (orchestration_meta) does not carry prompt_version — the BFF
 *    already knows which version it sent and can log it from its own context.
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
 * table in Doc 03C V3 §4.2: student -> user, tutor -> model, system -> user
 * (Gemini has no native system role inside contents[]; system-level notes
 * are tagged and folded into a user turn).
 *
 * State blocks from the context envelope are injected as a late-placed
 * [system note] immediately before the final student turn (Doc 03D §7.2).
 * This preserves prompt-cache stability (system instruction is invariant)
 * and improves model adherence (proximity to current turn).
 *
 * @spec [Doc-03C_V3 §4.2; Doc-03D_V1.2 §7.2 (late block placement)]
 */
export function buildConversationMessages(
  request: OrchestrateRequest,
): VertexMessage[] {
  const mapped: VertexMessage[] = request.recent_messages.map((message) => {
    if (message.role === "tutor") {
      return { role: "model", text: message.message };
    }
    if (message.role === "system") {
      return { role: "user", text: `[system note] ${message.message}` };
    }
    // Student messages are wrapped in boundary markers so the model treats
    // them as data, not instructions (Doc 03A §12.3 Layer 3 injection defense).
    const wrapped = `${STUDENT_INPUT_OPEN}\n${message.message}\n${STUDENT_INPUT_CLOSE}`;
    return { role: "user", text: wrapped };
  });

  // Late block placement (§7.2): inject state blocks immediately before the
  // final student turn. This places context data near where the model attends
  // most, and keeps the system instruction invariant for prompt-cache stability.
  const stateBlockText = renderStateBlocks(request);
  if (stateBlockText) {
    // Find the position of the last user message (the current student turn)
    // and insert the state block just before it.
    let lastUserIndex = -1;
    for (let i = mapped.length - 1; i >= 0; i--) {
      if (mapped[i].role === "user") {
        lastUserIndex = i;
        break;
      }
    }

    const stateBlockMessage: VertexMessage = {
      role: "user",
      text: `[system note] ${stateBlockText}`,
    };

    if (lastUserIndex > 0) {
      // Insert before the last user message
      mapped.splice(lastUserIndex, 0, stateBlockMessage);
    } else {
      // No prior user messages or only one — prepend the state block
      // so it still appears before any student content.
      mapped.unshift(stateBlockMessage);
    }
  }

  return mapped;
}

/**
 * Builds the system instruction sent to Vertex from the versioned prompt
 * artifact resolved by the prompt registry (Doc 03C V3 §4.3).
 *
 * The artifact is selected by (policy_variant, prompt_version) from the
 * envelope. The render function receives typed PromptFields for field
 * substitution — no runtime prompt generation, no string interpolation
 * of untrusted data.
 *
 * @spec [Doc-03C_V3 §4.3 (prompt artifact system); SCL-034–SCL-039]
 */
export function buildSystemInstruction(request: OrchestrateRequest): string {
  const artifact = resolvePromptArtifact(
    request.policy_assignment.policy_variant,
    request.policy_assignment.prompt_version,
  );

  return artifact.renderSystemInstruction({
    entryMode: request.entry_mode,
    sourceSurface: request.source_surface,
    policyVariant: request.policy_assignment.policy_variant,
    isPostSubmit: request.correct_answer !== null,
  });
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
 * @spec [Doc-03C_V3 §7.1, INV-03-04]
 */
export function buildOrchestrateResponse(
  vertexResponse: VertexResponse,
  request: OrchestrateRequest,
): OrchestrateResponse {
  // Worker-side anti-leak scan: if correct_answer is present (pre-submit
  // implied) and the response leaks it, substitute with the safe pedagogical
  // fallback. This is the first anti-leak layer; BFF-side scanAndSubstitute
  // is defense-in-depth.
  let content = vertexResponse.text;
  if (request.correct_answer !== null) {
    const leaked = hasAnswerLeak(content, request.correct_answer);
    if (leaked) {
      logEvent(
        "warn",
        "orchestrate_route",
        "worker_antileak_substituted",
        "Worker-side anti-leak scan detected answer leak in pre-submit response; substituting",
        {
          conversationId: request.conversation_id,
          hasCorrectAnswer: request.correct_answer !== null,
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

  // Log prompt_version for observability (§4.3). The BFF already knows
  // which version it sent; this log confirms which artifact the worker
  // actually resolved and used.
  const resolvedArtifact = resolvePromptArtifact(
    request.policy_assignment.policy_variant,
    request.policy_assignment.prompt_version,
  );
  logEvent(
    "info",
    "orchestrate_route",
    "prompt_artifact_resolved",
    "Resolved prompt artifact for tutor turn",
    {
      conversationId: request.conversation_id,
      policyVariant: request.policy_assignment.policy_variant,
      requestedPromptVersion: request.policy_assignment.prompt_version,
      resolvedPromptVersion: resolvedArtifact.version,
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

  const response = buildOrchestrateResponse(result.value, request);
  res.status(200).json(response);
});
