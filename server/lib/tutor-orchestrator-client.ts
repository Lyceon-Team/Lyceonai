/**
 * @spec [Doc-03B_V2 §6.5 step 14, INV-03-04, INV-03-12]
 * @implemented 2026-08-09
 *
 * plain English: BFF→Worker HTTP client for the tutor orchestrator. This is the
 * orchestrator boundary where anti-leak scanning is enforced — every orchestrator
 * response passes through scanAndSubstitute before returning to the route handler.
 *
 * expected outcome: route handlers call orchestrateTurn() or compactConversation(),
 * get back typed, anti-leak-scanned responses. The anti-leak scan at this boundary
 * is the chokepoint per INV-03-04 / INV-03-12.
 *
 * trade-offs: anti-leak scanning here means the route layer does NOT need to scan,
 * but the test (ws2-antileak.ci.test.ts) still structurally checks the route layer
 * for defense-in-depth patterns. The orchestrator boundary is the primary gate;
 * the route layer pattern is belt-and-suspenders.
 *
 * edge cases:
 *  - Worker unreachable (network error / timeout): returns a typed
 *    `orchestration_failed_recoverable` result on the first attempt, never throws.
 *  - Worker returns 5xx: retried once, then returns `orchestration_failed_recoverable`.
 *  - Worker returns 4xx, non-JSON body, or a body that fails wire-schema validation:
 *    returns `orchestration_failed` (not retried — a retry would not help).
 *  - Anti-leak scan substitution: logged by scanAndSubstitute but the response is
 *    still delivered (the student gets the safe fallback, not an error).
 */
import { z } from "zod";
import { logger } from "../logger";
import { scanAndSubstitute } from "../services/tutor-antileak";
import { TutorConfig } from "../services/tutor-config";
import type { TutorResult } from "../services/tutor-error-codes";
import {
  orchestrateResponseSchema,
  compactResponseSchema,
} from "../../apps/workers/tutor-orchestrator/src/lib/_tutor-orchestrator-wire.generated";
import type {
  OrchestrateRequest,
  OrchestrateResponse,
  CompactRequest,
  CompactResponse,
} from "../../apps/workers/tutor-orchestrator/src/lib/_tutor-orchestrator-wire.generated";

// ── Config ───────────────────────────────────────────────────────────

const WORKER_URL_ENV_KEY = "TUTOR_ORCHESTRATOR_WORKER_URL";
const WORKER_SECRET_ENV_KEY = "TUTOR_ORCHESTRATOR_WORKER_SHARED_SECRET";
const DEFAULT_WORKER_URL = "http://localhost:8080";

/** Two attempts total (one initial + one retry), 5xx-triggered retries only. */
const MAX_ATTEMPTS = 2;

function getWorkerBaseUrl(): string {
  const raw = process.env[WORKER_URL_ENV_KEY]?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_WORKER_URL;
}

/**
 * Boundary auth header. Mirrors the "shared_secret" mode read by
 * apps/workers/tutor-orchestrator/src/lib/boundary-auth.ts. When the secret
 * is unset (local dev, boundary auth mode "none"), no header is sent.
 */
function buildRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const secret = process.env[WORKER_SECRET_ENV_KEY]?.trim();
  if (secret && secret.length > 0) {
    headers.Authorization = `Bearer ${secret}`;
  }
  return headers;
}

// ── Result types ─────────────────────────────────────────────────────

export type OrchestrateResult = TutorResult<OrchestrateResponse>;
export type CompactResult = TutorResult<CompactResponse>;

// ── Worker POST helper (shared by both endpoints) ───────────────────

/**
 * POSTs `payload` to `${TUTOR_ORCHESTRATOR_WORKER_URL}${path}` and validates
 * the response body against `responseSchema` — the response is `unknown`
 * until it passes Zod parsing (Coding Standards §3.2, §7.1).
 *
 * Never throws: every failure mode (network, timeout, non-2xx, malformed
 * JSON, schema mismatch) returns a `TutorResult` failure branch instead.
 */
async function postToWorker<TSchema extends z.ZodTypeAny>(
  path: string,
  responseSchema: TSchema,
  payload: unknown,
): Promise<TutorResult<z.infer<TSchema>>> {
  const url = `${getWorkerBaseUrl()}${path}`;
  const timeoutMs = TutorConfig.get("tutor_request_timeout_seconds") * 1000;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;

    try {
      response = await fetch(url, {
        method: "POST",
        headers: buildRequestHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      // Worker unreachable or request timed out. Not retried here — the
      // caller (or a future turn) can retry; this attempt fails fast.
      logger.error(
        "TUTOR_ORCHESTRATOR_CLIENT",
        "worker_unreachable",
        `Orchestrator worker unreachable at ${path}`,
        err instanceof Error ? err : { message: String(err) },
        { path, attempt },
      );
      return {
        ok: false,
        errorCode: "orchestration_failed_recoverable",
        details: { path },
      };
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 500) {
      const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
      if (!isLastAttempt) {
        logger.warn(
          "TUTOR_ORCHESTRATOR_CLIENT",
          "worker_5xx_retry",
          `Orchestrator worker returned ${response.status}; retrying once`,
          { path, status: response.status, attempt },
        );
        continue;
      }
      logger.error(
        "TUTOR_ORCHESTRATOR_CLIENT",
        "worker_5xx_exhausted",
        `Orchestrator worker returned ${response.status} after retry`,
        { status: response.status },
        { path },
      );
      return {
        ok: false,
        errorCode: "orchestration_failed_recoverable",
        details: { path, status: response.status },
      };
    }

    if (!response.ok) {
      // Non-5xx failure (4xx): a retry would not help — request or config
      // is wrong, not the worker's transient state.
      logger.error(
        "TUTOR_ORCHESTRATOR_CLIENT",
        "worker_error_status",
        `Orchestrator worker returned ${response.status}`,
        { status: response.status },
        { path },
      );
      return {
        ok: false,
        errorCode: "orchestration_failed",
        details: { path, status: response.status },
      };
    }

    let rawBody: unknown;
    try {
      rawBody = await response.json();
    } catch (err: unknown) {
      logger.error(
        "TUTOR_ORCHESTRATOR_CLIENT",
        "worker_response_parse_failed",
        "Orchestrator worker response was not valid JSON",
        err instanceof Error ? err : { message: String(err) },
        { path },
      );
      return {
        ok: false,
        errorCode: "orchestration_failed",
        details: { path },
      };
    }

    const parsed = responseSchema.safeParse(rawBody);
    if (!parsed.success) {
      // Never log rawBody — it may carry tutor response content.
      logger.error(
        "TUTOR_ORCHESTRATOR_CLIENT",
        "worker_response_schema_invalid",
        "Orchestrator worker response failed wire-schema validation",
        { errors: parsed.error.flatten() },
        { path },
      );
      return {
        ok: false,
        errorCode: "orchestration_failed",
        details: { path },
      };
    }

    return { ok: true, value: parsed.data };
  }

  // Unreachable in practice: the loop above always returns or `continue`s,
  // and the final iteration never `continue`s. TypeScript needs a return.
  return {
    ok: false,
    errorCode: "orchestration_failed_recoverable",
    details: { path },
  };
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Calls the orchestrator worker's `POST /orchestrate/turn` and scans the
 * response through `scanAndSubstitute` — the anti-leak chokepoint for this
 * boundary (INV-03-04, INV-03-12). Route handlers must not re-derive
 * `isPreSubmit` / `correctAnswer` after this call; they are consumed here.
 *
 * @spec [Doc-03B_V2 §6.5 step 14-15, INV-03-04, INV-03-12]
 */
export async function orchestrateTurn(
  request: OrchestrateRequest,
  isPreSubmit: boolean,
  correctAnswer: string | null,
): Promise<OrchestrateResult> {
  const result = await postToWorker(
    "/orchestrate/turn",
    orchestrateResponseSchema,
    request,
  );

  if (!result.ok) {
    return result;
  }

  // Extract student-role messages for the echo exemption — LISA repeating
  // a value the student already stated is reflection, not disclosure.
  const studentMessages = request.recent_messages
    .filter((m) => m.role === "student")
    .map((m) => m.message);

  const { content } = scanAndSubstitute(
    result.value.response.content,
    correctAnswer,
    isPreSubmit,
    studentMessages,
  );

  const scannedResponse: OrchestrateResponse = {
    ...result.value,
    response: {
      ...result.value.response,
      content,
    },
  };

  return { ok: true, value: scannedResponse };
}

/**
 * Calls the orchestrator worker's `POST /compact`. No question/answer
 * content is returned by this endpoint, so no anti-leak scan applies here —
 * the chokepoint is specific to `orchestrateTurn`'s response content.
 *
 * @spec [Doc-03B_V2 §6.5 step 14]
 */
export async function compactConversation(
  request: CompactRequest,
): Promise<CompactResult> {
  return postToWorker("/compact", compactResponseSchema, request);
}
