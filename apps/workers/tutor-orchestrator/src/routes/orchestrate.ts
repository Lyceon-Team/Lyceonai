/**
 * @spec [Doc-03C_V3 §5.3 (Model Routing), Doc-03B_V4.1 §6.5 step 14]
 * @implemented 2026-08-09
 *
 * plain English: Worker route for tutor turn orchestration. Receives the assembled
 * context envelope (OrchestrateRequest), invokes the appropriate Vertex model via
 * the model routing table, and returns the tutor response (OrchestrateResponse).
 *
 * expected outcome: POST /orchestrate/turn accepts a validated OrchestrateRequest,
 * routes to the correct model alias (flash_class or pro_class per the 9-rule routing
 * table), invokes Vertex with Model Armor input scanning, and returns the response
 * with Model Armor output scanning applied.
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
 *  - Prompt assembly implemented here is intentionally minimal: `recent_messages`
 *    are mapped to Gemini `Content[]` per the role table in Doc 03C V3 §4.2, and
 *    `systemInstruction` is a neutral, bounded placeholder. The full prompt
 *    template artifact system (§4.3 versioned policy prompts), the deterministic
 *    PII guard (§4.2.2), content safety pre-pass (§4.5), and candidate-slot
 *    resolution for similar-question links (§5.9) are NOT implemented in this
 *    file — each is a distinct subsystem beyond this route's stated scope
 *    (validate → route → call Vertex → return) and needs its own dedicated pass
 *    before production traffic.
 *  - `question_links` and `instruction_exposures` are returned empty; structured
 *    output enforcement via Vertex `responseSchema` (§5.4 hybrid strictness) is
 *    not wired up in this pass — the model call is plain-text only.
 *  - Idempotency: per Doc 03C V3 §3.6, 03C is deliberately NOT idempotent — the
 *    BFF (Doc 03B V4.1 §13.7) owns the idempotency guard before this endpoint is
 *    ever called. No idempotency_key handling belongs here.
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
 * @spec [Doc-03C_V3 §4.2]
 */
export function buildConversationMessages(
  request: OrchestrateRequest,
): VertexMessage[] {
  return request.recent_messages.map((message) => {
    if (message.role === "tutor") {
      return { role: "model", text: message.message };
    }
    if (message.role === "system") {
      return { role: "user", text: `[system note] ${message.message}` };
    }
    return { role: "user", text: message.message };
  });
}

/**
 * Builds the system instruction sent to Vertex. This is a bounded, neutral
 * placeholder — NOT the policy-authored prompt artifact system of Doc 03A V3
 * §11 / Doc 03C V3 §4.3. See file header trade-offs.
 *
 * @spec [Doc-03C_V3 §4.1 (division of concerns) — placeholder pending §4.3]
 */
export function buildSystemInstruction(request: OrchestrateRequest): string {
  return [
    "You are LISA, an SAT tutor for a student aged 13-18.",
    `Entry mode: ${request.entry_mode}. Source surface: ${request.source_surface}.`,
    "Be concise, encouraging, and never reveal a correct answer or explanation",
    "unless the platform has already told you the question is post-submit.",
    "Never claim to know a predicted score or confidence level that was not",
    "explicitly provided to you.",
  ].join(" ");
}

/** Per Doc 03C V3 §8.1: compaction is recommended once a conversation reaches
 * 20+ turns. Computed here (deterministically, from data already on the
 * envelope) so `orchestration_meta.compaction_recommended` is never guessed. */
function isCompactionRecommended(request: OrchestrateRequest): boolean {
  return request.recent_messages.length >= 20;
}

/**
 * Maps a successful Vertex generation into the wire-contract OrchestrateResponse
 * shape. `question_links` / `instruction_exposures` are empty (see file header
 * trade-offs — candidate-slot resolution is not implemented in this pass).
 *
 * @spec [Doc-03C_V3 §7.1]
 */
export function buildOrchestrateResponse(
  vertexResponse: VertexResponse,
  request: OrchestrateRequest,
): OrchestrateResponse {
  return {
    response: {
      content: vertexResponse.text,
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

  const result = await generateTutorResponse(
    modelAlias,
    messages,
    systemInstruction,
    {
      maxOutputTokens: request.runtime_limits.max_output_tokens,
      timeoutMs: request.runtime_limits.timeout_ms,
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
