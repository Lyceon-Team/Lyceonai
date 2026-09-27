/**
 * @spec [Doc-03C_V3 §5.2-§5.3, §5.7-§5.9; Doc-03B_V4.1 §12B.8]
 * @implemented 2026-08-09
 *
 * plain English: Vertex AI client for the tutor orchestrator worker. Handles model
 * invocation with safetySettings on generateContent.
 *
 * expected outcome: generateTutorResponse() sends a request to Vertex AI with
 * safetySettings (four harm categories, thresholds mirroring the Model Armor
 * templates).
 *
 * trade-offs:
 *  - Model Armor is NOT called from this worker. Both scan points (input and
 *    output) run in the BFF — server/services/tutor-model-armor.ts, closure
 *    plan W3-1, 2026-09-24 — against the regional Sanitize API. The worker's
 *    inline-config builder and its sanitizeOutput (which derived the Model
 *    Armor region from VERTEX_LOCATION=global, an endpoint that does not
 *    exist) were deleted then, with no callers. The orchestrate request still
 *    carries model_armor_*_template_id for wire compatibility; the worker
 *    ignores them.
 *  - Pro-to-Flash fallback on 5xx/429/timeout only (Doc 03C V3 §5.3.2). Fallback does
 *    NOT trigger for 400/403/422 — those indicate a bug or a real safety block, not a
 *    transient condition, and retrying/falling back would not help.
 *  - Retry (Doc 03C V3 §5.8): up to 2 retries with jitter, but ONLY for 5xx and
 *    timeout — never for 429/400/403/422 (matches the BFF's own non-retry posture
 *    for those codes in server/lib/tutor-orchestrator-client.ts).
 *  - Daily budget circuit breaker for pro_class (Doc 03C V3 §5.3.3) is a ROUTING
 *    decision (which alias to pick), not a Vertex-call concern — it lives in
 *    routes/orchestrate.ts, not here.
 *  - Streaming anti-leak chunk gate (Doc 03C V3 §7.4.9): NOT implemented in this file.
 *    The wire protocol (orchestrateRequestSchema/orchestrateResponseSchema) is
 *    sync-only today — no SSE event types exist in the shared schema — and V3 §7.4
 *    itself ships streaming disabled by default at V1 launch (`vertex.streaming.enabled
 *    = false`). Adding the chunk gate now, ahead of a streaming wire contract, would be
 *    unused/untestable code. This is the same worker-scope boundary applied everywhere
 *    else in this file: build what the current wire contract can exercise.
 *
 * edge cases:
 *  - Vertex response blocked by safety filter (finishReason SAFETY/PROHIBITED_CONTENT/
 *    BLOCKLIST/SPII, or promptFeedback.blockReason set) → classified as
 *    `vertex_422_safety_blocked`, not fallback-eligible, per Doc 03C V3 §5.3.2.
 */

import {
  ApiError,
  FinishReason,
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  type Content,
  type GenerateContentConfig,
  type SafetySetting,
} from "@google/genai";

// ── Result type (mirrors server/services/tutor-error-codes.ts TutorResult
//    shape — Coding Standards §3.6 "single canonical Result shape") ────────

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; errorCode: E; details?: unknown };

// ── Public types ─────────────────────────────────────────────────────────

export type ModelAlias = "flash_class" | "pro_class";

export type VertexMessageRole = "user" | "model";

export type VertexMessage = {
  role: VertexMessageRole;
  text: string;
};

export type VertexGenerationLimits = {
  maxOutputTokens: number;
  timeoutMs: number;
};

export type VertexResponse = {
  text: string;
  modelAliasUsed: ModelAlias;
  providerModel: string;
  fallbackApplied: boolean;
  finishReason: string | null;
};

export type VertexRequest = {
  modelAlias: ModelAlias;
  messages: VertexMessage[];
  systemInstruction: string;
  limits: VertexGenerationLimits;
};

export type VertexErrorCode =
  | "vertex_5xx_retriable"
  | "vertex_429_quota"
  | "vertex_timeout"
  | "vertex_400_invalid_request"
  | "vertex_403_auth"
  | "vertex_422_safety_blocked"
  | "vertex_max_tokens_truncated"
  | "vertex_unknown";

// ── Constants ────────────────────────────────────────────────────────────

/** Generation parameters per Doc 03C V3 §5.7. Low temperature: tutor is informative,
 * not creative; topK/topP bound structured-output drift. */
const TEMPERATURE = 0.3;
const TOP_P = 0.95;
const TOP_K = 40;

// Thresholds mirror the Model Armor templates (infra/terraform/model-armor.tf); change both together.
const SAFETY_SETTINGS: SafetySetting[] = [
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
];

/** finishReason values that indicate the model's own output was safety-blocked. */
const SAFETY_BLOCKED_FINISH_REASONS: ReadonlySet<FinishReason> = new Set([
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.SPII,
]);

/** Retry schedule per Doc 03C V3 §5.8: null = no pre-delay (first attempt),
 * then 200ms/800ms base with jitter before the 1st/2nd retry. */
const RETRY_SCHEDULE: ReadonlyArray<{
  baseMs: number;
  jitterMs: number;
} | null> = [
  null,
  { baseMs: 200, jitterMs: 50 },
  { baseMs: 800, jitterMs: 200 },
];

// ── Structured logging (task-sanctioned exception to Coding Standards §16
//    "no console.log": this Cloud Run worker is a separate process with no
//    access to server/logger.ts; console.error + structured JSON is the
//    agreed worker convention). Never logs student answers, tutor content,
//    secrets, or tokens — only metadata (Coding Standards §12.1). ─────────

export type LogLevel = "info" | "warn" | "error";

export function logEvent(
  level: LogLevel,
  component: string,
  event: string,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const record: Record<string, unknown> = {
    ...fields,
    severity: level.toUpperCase(),
    component,
    event,
    message,
    timestamp: new Date().toISOString(),
  };
  console.error(JSON.stringify(record));
}

// ── Env-sourced config ───────────────────────────────────────────────────

/** @spec [Doc-03C_V3 §2.5] project/location are per-environment runtime config. */
function getVertexProjectId(): string {
  return (
    process.env.VERTEX_PROJECT_ID ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    ""
  ).trim();
}

function getVertexLocation(): string {
  const raw = (process.env.VERTEX_LOCATION ?? "").trim();
  return raw.length > 0 ? raw : "global";
}

/**
 * Resolves a spec-level model alias (`flash_class` | `pro_class`, Doc 03C V3
 * §5.2) to the provider-specific model string. The alias is the routing
 * decision (owned by routes/orchestrate.ts); resolution to a literal provider
 * string happens here, at the Vertex call site, from env var runtime config —
 * never hardcoded in routing logic.
 *
 * @spec [Doc-03C_V3 §5.2]
 */
export function resolveProviderModel(alias: ModelAlias): string {
  if (alias === "pro_class") {
    return (
      (process.env.VERTEX_MODEL_PRO_CLASS_ALIAS ?? "").trim() ||
      "gemini-3.5-flash"
    );
  }
  return (
    (process.env.VERTEX_MODEL_FLASH_CLASS_ALIAS ?? "").trim() ||
    "gemini-3.5-flash"
  );
}

let cachedGenAiClient: GoogleGenAI | null = null;

function getGenAiClient(): GoogleGenAI {
  if (cachedGenAiClient) {
    return cachedGenAiClient;
  }
  cachedGenAiClient = new GoogleGenAI({
    vertexai: true,
    project: getVertexProjectId(),
    location: getVertexLocation(),
  });
  return cachedGenAiClient;
}

// ── Error classification ─────────────────────────────────────────────────

function classifyVertexError(err: unknown, timedOut: boolean): VertexErrorCode {
  if (timedOut) {
    return "vertex_timeout";
  }
  if (err instanceof ApiError) {
    const status = err.status;
    if (status === 429) return "vertex_429_quota";
    if (status === 400) return "vertex_400_invalid_request";
    if (status === 403) return "vertex_403_auth";
    if (status === 422) return "vertex_422_safety_blocked";
    if (status >= 500) return "vertex_5xx_retriable";
    return "vertex_unknown";
  }
  if (err instanceof Error && err.name === "AbortError") {
    return "vertex_timeout";
  }
  return "vertex_unknown";
}

/** Only 5xx and timeout are retried at the same model alias (Doc 03C V3 §5.8). */
function isRetriable(code: VertexErrorCode): boolean {
  return code === "vertex_5xx_retriable" || code === "vertex_timeout";
}

/** Only these classes fall back from pro_class to flash_class (Doc 03C V3 §5.3.2). */
function isFallbackEligible(code: VertexErrorCode): boolean {
  return (
    code === "vertex_5xx_retriable" ||
    code === "vertex_429_quota" ||
    code === "vertex_timeout"
  );
}

function isSafetyBlockedFinish(
  reason: FinishReason | null | undefined,
): boolean {
  return reason != null && SAFETY_BLOCKED_FINISH_REASONS.has(reason);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Single Vertex invocation (no retry, no fallback) ──────────────────────

type SingleInvocationResult = Result<
  { text: string; finishReason: string | null },
  VertexErrorCode
>;

async function invokeVertexOnce(
  providerModel: string,
  messages: VertexMessage[],
  systemInstruction: string,
  limits: VertexGenerationLimits,
): Promise<SingleInvocationResult> {
  const client = getGenAiClient();
  const contents: Content[] = messages.map((message) => ({
    role: message.role,
    parts: [{ text: message.text }],
  }));

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, limits.timeoutMs);

  const config: GenerateContentConfig = {
    systemInstruction,
    temperature: TEMPERATURE,
    topP: TOP_P,
    topK: TOP_K,
    maxOutputTokens: limits.maxOutputTokens,
    thinkingConfig: { thinkingBudget: 1024 },
    safetySettings: SAFETY_SETTINGS,
    abortSignal: controller.signal,
  };

  try {
    const response = await client.models.generateContent({
      model: providerModel,
      contents,
      config,
    });

    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason ?? null;

    if (
      isSafetyBlockedFinish(finishReason) ||
      response.promptFeedback?.blockReason
    ) {
      return {
        ok: false,
        errorCode: "vertex_422_safety_blocked",
        details: { finishReason },
      };
    }

    if (finishReason === FinishReason.MAX_TOKENS) {
      logEvent(
        "error",
        "vertex_client",
        "vertex_max_tokens_truncated",
        "Vertex response truncated at maxOutputTokens — model hit token budget",
        { providerModel, finishReason },
      );
      return {
        ok: false,
        errorCode: "vertex_max_tokens_truncated",
        details: {
          finishReason,
          truncatedLength: (response.text ?? "").length,
        },
      };
    }

    return {
      ok: true,
      value: { text: response.text ?? "", finishReason },
    };
  } catch (err: unknown) {
    const code = classifyVertexError(err, timedOut);
    logEvent(
      "error",
      "vertex_client",
      "vertex_call_failed",
      "Vertex generateContent call failed",
      {
        errorCode: code,
        providerModel,
        err: err instanceof Error ? err.message : String(err),
      },
    );
    return { ok: false, errorCode: code, details: { providerModel } };
  } finally {
    clearTimeout(timer);
  }
}

// ── Retry wrapper (same model alias) ──────────────────────────────────────

async function invokeWithRetry(
  modelAlias: ModelAlias,
  messages: VertexMessage[],
  systemInstruction: string,
  limits: VertexGenerationLimits,
): Promise<
  Result<{ text: string; finishReason: string | null }, VertexErrorCode>
> {
  const providerModel = resolveProviderModel(modelAlias);
  let lastResult: SingleInvocationResult = {
    ok: false,
    errorCode: "vertex_unknown",
  };

  for (const delaySpec of RETRY_SCHEDULE) {
    if (delaySpec) {
      const jitterOffset = Math.floor(
        (Math.random() * 2 - 1) * delaySpec.jitterMs,
      );
      const delayMs = Math.max(0, delaySpec.baseMs + jitterOffset);
      logEvent(
        "warn",
        "vertex_client",
        "vertex_retry",
        `retrying ${modelAlias} after ${lastResult.ok ? "n/a" : lastResult.errorCode}`,
        { modelAlias, delayMs },
      );
      await sleep(delayMs);
    }

    const result = await invokeVertexOnce(
      providerModel,
      messages,
      systemInstruction,
      limits,
    );
    if (result.ok) {
      return result;
    }
    lastResult = result;
    if (!isRetriable(result.errorCode)) {
      return result;
    }
  }

  return lastResult;
}

// ── Public entry point: fallback + retry ─────────────────────────────────

/**
 * Generates a tutor turn response from Vertex AI. Retries transient failures
 * per §5.8 and falls back pro_class → flash_class per §5.3.2 on
 * fallback-eligible errors. Model Armor scanning is the BFF's
 * (server/services/tutor-model-armor.ts).
 *
 * @spec [Doc-03C_V3 §5.2, §5.3, §5.7, §5.8]
 */
export async function generateTutorResponse(
  modelAlias: ModelAlias,
  messages: VertexMessage[],
  systemInstruction: string,
  config: VertexGenerationLimits,
): Promise<Result<VertexResponse, VertexErrorCode>> {
  const primary = await invokeWithRetry(
    modelAlias,
    messages,
    systemInstruction,
    config,
  );

  let generation: { text: string; finishReason: string | null };
  let modelAliasUsed: ModelAlias = modelAlias;
  let fallbackApplied = false;

  if (primary.ok) {
    generation = primary.value;
  } else if (
    modelAlias === "pro_class" &&
    isFallbackEligible(primary.errorCode)
  ) {
    logEvent(
      "warn",
      "vertex_client",
      "vertex_pro_fallback_applied",
      "pro_class failed with a fallback-eligible error; retrying with flash_class",
      { errorCode: primary.errorCode },
    );
    const fallback = await invokeWithRetry(
      "flash_class",
      messages,
      systemInstruction,
      config,
    );
    if (!fallback.ok) {
      return fallback;
    }
    generation = fallback.value;
    modelAliasUsed = "flash_class";
    fallbackApplied = true;
  } else {
    return primary;
  }

  return {
    ok: true,
    value: {
      text: generation.text,
      modelAliasUsed,
      providerModel: resolveProviderModel(modelAliasUsed),
      fallbackApplied,
      finishReason: generation.finishReason,
    },
  };
}
