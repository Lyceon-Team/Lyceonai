/**
 * @spec [Doc-03C_V3 §5.2-§5.3, §5.7-§5.9; Doc-03B_V4.1 §12B.8]
 * @implemented 2026-08-09
 *
 * plain English: Vertex AI client for the tutor orchestrator worker. Handles model
 * invocation with Model Armor integration: inline modelArmorConfig on generateContent
 * for input scanning, standalone Sanitize API for output scanning. Template IDs loaded
 * from environment variables (originally from runtime config, passed through at deploy;
 * see trade-offs).
 *
 * expected outcome: generateTutorResponse() sends a request to Vertex AI with Model
 * Armor input scanning enabled, then runs the response through the Model Armor
 * Sanitize API for output scanning.
 *
 * trade-offs:
 *  - Model Armor template IDs come from env vars (MODEL_ARMOR_INPUT_TEMPLATE_ID,
 *    MODEL_ARMOR_OUTPUT_TEMPLATE_ID), NOT hardcoded literals, per Doc 03B §12B.8
 *    ("Runtime config cache... event-driven refresh"). This worker has no Supabase
 *    client (see index.ts / package.json — deliberately thin/stateless per Doc 03C V3
 *    §1.2 "Stateless orchestrator"), so unlike server/services/tutor-injection-defense.ts
 *    (which reads tutor_context_runtime_config directly), template IDs here are baked
 *    into the Cloud Run env at deploy time from the same runtime-config source of truth.
 *    Both call sites fail CLOSED identically when a template ID is unconfigured —
 *    same posture, different transport, per "Unified code across agents".
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
 *  - Missing/empty Model Armor template ID → fails closed (`vertex_model_armor_unconfigured`)
 *    before ever calling Vertex; never proceeds unarmored.
 *  - Sanitize API network/parse/schema failure → fails closed (`vertex_model_armor_unconfigured`)
 *    rather than passing raw model output through unscanned.
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
  type ModelArmorConfig,
  type SafetySetting,
} from "@google/genai";
import { GoogleAuth } from "google-auth-library";
import { z } from "zod";

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
  armorOutputBlocked: boolean;
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
  | "vertex_model_armor_unconfigured"
  | "vertex_unknown";

// ── Constants ────────────────────────────────────────────────────────────

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/** Generation parameters per Doc 03C V3 §5.7. Low temperature: tutor is informative,
 * not creative; topK/topP bound structured-output drift. */
const TEMPERATURE = 0.3;
const TOP_P = 0.95;
const TOP_K = 40;

/** Safety settings per Doc 03C V3 §5.7. Sexually-explicit is tighter
 * (BLOCK_LOW_AND_ABOVE) given the minor audience; other categories at
 * BLOCK_MEDIUM_AND_ABOVE to avoid over-triggering on legitimate SAT content. */
const SAFETY_SETTINGS: SafetySetting[] = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
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

/**
 * Safe substitution text mirrored from the canonical constant
 * `TUTOR_ANTI_LEAK_SUBSTITUTION` in server/services/tutor-antileak.ts (defined
 * there "exactly once" for the BFF's regex-based anti-leak layer). This worker
 * cannot import that module — it drags in `apps/api/src/lib/supabase-server`
 * and breaks the isolated Cloud Run buildpack compile (see schema.ts). The
 * literal wording is kept identical for a consistent student-facing message;
 * update both locations together if the wording ever changes.
 * @spec [Doc-03_V3 §17.5, INV-03-04]
 */
const MODEL_ARMOR_SAFE_SUBSTITUTION =
  "Let me think about this differently. What approach would you take to solve this? Try working through it step by step.";

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
  return raw.length > 0 ? raw : "us-central1";
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
      "gemini-2.5-pro"
    );
  }
  return (
    (process.env.VERTEX_MODEL_FLASH_CLASS_ALIAS ?? "").trim() ||
    "gemini-2.5-flash"
  );
}

function resolveModelArmorTemplateName(
  rawId: string,
  project: string,
  location: string,
): string {
  if (rawId.startsWith("projects/")) {
    return rawId;
  }
  return `projects/${project}/locations/${location}/templates/${rawId}`;
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

/** Lazy singleton: token minting for the standalone Model Armor Sanitize API
 * call. Vertex calls themselves are authenticated internally by @google/genai
 * via Application Default Credentials; this is only for the REST call that
 * has no SDK coverage (see sanitizeOutput). */
let cachedAuth: GoogleAuth | null = null;

function getGoogleAuth(): GoogleAuth {
  if (cachedAuth) {
    return cachedAuth;
  }
  cachedAuth = new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
  return cachedAuth;
}

// ── Model Armor input config (inline on generateContent) ─────────────────

/**
 * Builds the inline `modelArmorConfig` for prompt (input) scanning. Fails
 * closed (Result error) when the template ID env var is unset — the caller
 * must not proceed to Vertex unarmored.
 *
 * @spec [Doc-03B_V4.1 §12B.8, Doc-03C_V3 §5]
 */
function buildInputModelArmorConfig(): Result<
  ModelArmorConfig,
  VertexErrorCode
> {
  const rawTemplateId = (
    process.env.MODEL_ARMOR_INPUT_TEMPLATE_ID ?? ""
  ).trim();
  if (!rawTemplateId) {
    return {
      ok: false,
      errorCode: "vertex_model_armor_unconfigured",
      details: { reason: "MODEL_ARMOR_INPUT_TEMPLATE_ID is not set" },
    };
  }
  const promptTemplateName = resolveModelArmorTemplateName(
    rawTemplateId,
    getVertexProjectId(),
    getVertexLocation(),
  );
  return { ok: true, value: { promptTemplateName } };
}

// ── Standalone Model Armor Sanitize API (output scanning) ────────────────

const modelArmorSanitizeResponseSchema = z.object({
  sanitizationResult: z
    .object({
      filterMatchState: z.string().optional(),
    })
    .optional(),
});

export type SanitizeOutcome = {
  blocked: boolean;
  sanitizedText: string;
};

/**
 * Calls the standalone Model Armor `sanitizeModelResponse` REST API
 * (no SDK coverage for this — see @google/genai's ModelArmorConfig, which
 * only supports inline prompt/response template names on generateContent,
 * not a standalone sanitize call). Fails closed: any network, auth, parse,
 * or schema failure returns a `vertex_model_armor_unconfigured`-equivalent
 * error rather than letting unscanned text through.
 *
 * @spec [Doc-03B_V4.1 §12B.8, Doc-03C_V3 §5]
 */
export async function sanitizeOutput(
  text: string,
  templateId: string,
): Promise<Result<SanitizeOutcome, VertexErrorCode>> {
  const rawTemplateId = templateId.trim();
  if (!rawTemplateId) {
    return {
      ok: false,
      errorCode: "vertex_model_armor_unconfigured",
      details: { reason: "output template ID is empty" },
    };
  }

  const templateName = resolveModelArmorTemplateName(
    rawTemplateId,
    getVertexProjectId(),
    getVertexLocation(),
  );
  const location = getVertexLocation();
  const url = `https://modelarmor.${location}.rep.googleapis.com/v1/${templateName}:sanitizeModelResponse`;

  let accessToken: string | null | undefined;
  try {
    accessToken = await getGoogleAuth().getAccessToken();
  } catch (err: unknown) {
    logEvent(
      "error",
      "vertex_client",
      "model_armor_token_failed",
      "failed to acquire access token for Model Armor Sanitize API",
      { err: err instanceof Error ? err.message : String(err) },
    );
    return { ok: false, errorCode: "vertex_model_armor_unconfigured" };
  }
  if (!accessToken) {
    logEvent(
      "error",
      "vertex_client",
      "model_armor_token_empty",
      "GCP access token unavailable for Model Armor Sanitize API",
    );
    return { ok: false, errorCode: "vertex_model_armor_unconfigured" };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ modelResponseData: { text } }),
    });
  } catch (err: unknown) {
    logEvent(
      "error",
      "vertex_client",
      "model_armor_sanitize_unreachable",
      "Model Armor Sanitize API request failed",
      { err: err instanceof Error ? err.message : String(err) },
    );
    return { ok: false, errorCode: "vertex_model_armor_unconfigured" };
  }

  if (!response.ok) {
    logEvent(
      "error",
      "vertex_client",
      "model_armor_sanitize_error_status",
      "Model Armor Sanitize API returned a non-2xx status",
      { status: response.status },
    );
    return { ok: false, errorCode: "vertex_model_armor_unconfigured" };
  }

  let rawBody: unknown;
  try {
    rawBody = await response.json();
  } catch (err: unknown) {
    logEvent(
      "error",
      "vertex_client",
      "model_armor_sanitize_parse_failed",
      "Model Armor Sanitize API response was not valid JSON",
      { err: err instanceof Error ? err.message : String(err) },
    );
    return { ok: false, errorCode: "vertex_model_armor_unconfigured" };
  }

  const parsed = modelArmorSanitizeResponseSchema.safeParse(rawBody);
  if (!parsed.success) {
    logEvent(
      "error",
      "vertex_client",
      "model_armor_sanitize_schema_invalid",
      "Model Armor Sanitize API response failed schema validation",
      { errors: parsed.error.flatten() },
    );
    return { ok: false, errorCode: "vertex_model_armor_unconfigured" };
  }

  const matchState =
    parsed.data.sanitizationResult?.filterMatchState ?? "NO_MATCH_FOUND";
  const blocked = matchState === "MATCH_FOUND";

  return {
    ok: true,
    value: {
      blocked,
      sanitizedText: blocked ? MODEL_ARMOR_SAFE_SUBSTITUTION : text,
    },
  };
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
  armorInputConfig: ModelArmorConfig,
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
    safetySettings: SAFETY_SETTINGS,
    modelArmorConfig: armorInputConfig,
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
  armorInputConfig: ModelArmorConfig,
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
      armorInputConfig,
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

// ── Public entry point: fallback + retry + Model Armor output scan ───────

/**
 * Generates a tutor turn response from Vertex AI. Applies Model Armor input
 * scanning inline, retries transient failures per §5.8, falls back
 * pro_class → flash_class per §5.3.2 on fallback-eligible errors, and runs
 * the model's raw text through the standalone Model Armor Sanitize API for
 * output scanning before returning.
 *
 * @spec [Doc-03C_V3 §5.2, §5.3, §5.7, §5.8; Doc-03B_V4.1 §12B.8]
 */
export async function generateTutorResponse(
  modelAlias: ModelAlias,
  messages: VertexMessage[],
  systemInstruction: string,
  config: VertexGenerationLimits,
): Promise<Result<VertexResponse, VertexErrorCode>> {
  const armorInputConfig = buildInputModelArmorConfig();
  if (!armorInputConfig.ok) {
    logEvent(
      "error",
      "vertex_client",
      "model_armor_input_unconfigured",
      "Model Armor input template is not configured; refusing to call Vertex unarmored",
    );
    return armorInputConfig;
  }

  const primary = await invokeWithRetry(
    modelAlias,
    messages,
    systemInstruction,
    config,
    armorInputConfig.value,
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
      armorInputConfig.value,
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

  const outputTemplateId = (
    process.env.MODEL_ARMOR_OUTPUT_TEMPLATE_ID ?? ""
  ).trim();
  const sanitized = await sanitizeOutput(generation.text, outputTemplateId);
  if (!sanitized.ok) {
    logEvent(
      "error",
      "vertex_client",
      "model_armor_output_unconfigured",
      "Model Armor output scan failed or is unconfigured; refusing to return unscanned text",
    );
    return sanitized;
  }

  return {
    ok: true,
    value: {
      text: sanitized.value.sanitizedText,
      modelAliasUsed,
      providerModel: resolveProviderModel(modelAliasUsed),
      fallbackApplied,
      armorOutputBlocked: sanitized.value.blocked,
      finishReason: generation.finishReason,
    },
  };
}
