/**
 * @spec [Doc-03C_V3 §8.1, §8.3 (Compaction)]
 * @implemented 2026-08-09
 *
 * plain English: Worker route for conversation compaction (memory summarization).
 * Receives CompactRequest with conversation messages, generates a summary via
 * the flash_class model, and returns CompactResponse with the generated summary.
 *
 * expected outcome: POST /compact accepts a validated CompactRequest, invokes
 * Vertex flash_class (per Doc 03A V3 §14.5 model choice) to produce a compact
 * summary of the conversation, runs it through Model Armor output scanning, and
 * returns { ok, summary }.
 *
 * trade-offs:
 *  - Doc 03C V3 §8.3's full algorithm is: (1) load tutor_messages from Supabase,
 *    (2) invoke Vertex flash_class, (3) write the summary to tutor_memory_summaries,
 *    (4) emit a cache-invalidation NOTIFY. This worker has no Supabase client
 *    (index.ts / package.json — stateless per §1.2) and no HMAC signing for the
 *    compaction-worker -> main-api write-back callback described in
 *    "Doc 03A — LISA Context & Memory Runtime.md" §7 (`loadActiveSecret(
 *    'compaction-worker', 'main-api')`, 01A Part VII). Steps 1/3/4 are therefore
 *    NOT implemented here — only step 2 (the Vertex call) is in scope for this
 *    file. The caller (main-api / BFF) is responsible for supplying
 *    `recent_messages` in the request and persisting the returned `summary`.
 *  - `compactRequestSchema`/`compactResponseSchema` (packages/shared, single
 *    source of truth) were extended additively on 2026-08-09 to carry
 *    `recent_messages` in and `summary` out — see shared/tutor-orchestrator-wire.ts
 *    for the exact diff. The existing BFF caller
 *    (server/lib/tutor-orchestrator-client.ts `compactConversation()`) still
 *    posts only {conversation_id, student_id} today and only reads `.ok` back;
 *    it needs a follow-up change (out of this file's scope) to actually pass
 *    `recent_messages` and consume `summary` for the feature to do real work
 *    end-to-end. Until that follow-up lands, this route validates input,
 *    degrades gracefully (returns { ok: true, summary: null }, NOT an error —
 *    "no messages to compact" is not a failure) when no messages are supplied,
 *    and never fabricates a summary from absent data.
 *  - No idempotency guard here, matching orchestrate.ts's posture (Doc 03C V3
 *    §3.6: 03C is not idempotent; the caller owns retry/dedup semantics). A
 *    caller invoking /compact twice for the same conversation gets two
 *    independently-generated summaries — acceptable per Doc 03C V3 §8.3
 *    ("duplicate (conversation_id, trigger_reason) produces same summary
 *    (overwrite previous); no harm from duplicate execution").
 */
import { Router } from "express";
import type { Request, Response } from "express";
import {
  compactRequestSchema,
  type CompactRequest,
  type CompactResponse,
} from "../lib/schema.js";
import {
  generateTutorResponse,
  logEvent,
  type VertexErrorCode,
  type VertexMessage,
} from "../lib/vertex-client.js";

export const compactRouter: Router = Router();

// ── Pure domain logic ───────────────────────────────────────────────────

/** Per Doc 03A V3 §14.5: compaction always uses the flash_class model —
 * summarization is not a high-reasoning task. */
const COMPACTION_MODEL_ALIAS = "flash_class" as const;

/** Bounds per Doc 03A V3 §10.2 chat_compaction schema field-length limits —
 * a compact summary is a short artifact, not a full transcript. */
const COMPACTION_MAX_OUTPUT_TOKENS = 512;
const COMPACTION_TIMEOUT_MS = 8000;

const COMPACTION_SYSTEM_INSTRUCTION = [
  "You summarize a tutoring conversation between an SAT student and a tutor.",
  "Write a short, neutral summary (a few sentences) covering: topics discussed,",
  "any skills the student struggled with, and any skills the student showed",
  "mastery of. Do not invent facts not present in the conversation. Do not",
  "restate correct answers to specific questions. Do not estimate a score or",
  "confidence level.",
].join(" ");

/**
 * Maps CompactRequest.recent_messages to Vertex messages, same role mapping
 * as orchestrate.ts (Doc 03C V3 §4.2): student -> user, tutor -> model,
 * system -> user (tagged).
 *
 * @spec [Doc-03C_V3 §4.2]
 */
export function buildCompactionMessages(
  request: CompactRequest,
): VertexMessage[] {
  const recentMessages = request.recent_messages ?? [];
  return recentMessages.map((message) => {
    if (message.role === "tutor") {
      return { role: "model", text: message.message };
    }
    if (message.role === "system") {
      return { role: "user", text: `[system note] ${message.message}` };
    }
    return { role: "user", text: message.message };
  });
}

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

compactRouter.post("/", async (req: Request, res: Response) => {
  const parsed = compactRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        message: "Invalid CompactRequest",
        details: parsed.error.flatten(),
      },
    });
    return;
  }
  const request = parsed.data;
  const messages = buildCompactionMessages(request);

  if (messages.length === 0) {
    // No conversation content supplied — see file header trade-offs (current
    // BFF caller does not yet populate recent_messages). Not a failure: there
    // is nothing to compact, so we say so rather than fabricate a summary.
    const response: CompactResponse = { ok: true, summary: null };
    res.status(200).json(response);
    return;
  }

  const result = await generateTutorResponse(
    COMPACTION_MODEL_ALIAS,
    messages,
    COMPACTION_SYSTEM_INSTRUCTION,
    {
      maxOutputTokens: COMPACTION_MAX_OUTPUT_TOKENS,
      timeoutMs: COMPACTION_TIMEOUT_MS,
    },
  );

  if (!result.ok) {
    logEvent(
      "error",
      "compact_route",
      "compaction_failed",
      "Vertex generation failed for conversation compaction",
      {
        errorCode: result.errorCode,
        conversationId: request.conversation_id,
      },
    );
    res.status(mapVertexErrorToStatus(result.errorCode)).json({
      error: { message: "Compaction failed", code: result.errorCode },
    });
    return;
  }

  const response: CompactResponse = {
    ok: true,
    summary: result.value.text,
  };
  res.status(200).json(response);
});
