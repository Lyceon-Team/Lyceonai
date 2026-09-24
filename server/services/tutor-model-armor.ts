/**
 * @spec [closure plan W3-1 + owner ruling 2026-09-24 (fail open); Doc-03B_V4.1 §12B.8 (template IDs from runtime config)]
 *        | @implemented 2026-09-24
 *
 * SPEC STATUS: Model Armor is NOT in the locked docs/Spec corpus. Its
 * authority is the closure plan (W3-1) and the owner's brief, including the
 * fail-open ruling. It is an ADDITIONAL, model-backed layer on top of — not a
 * replacement for — Doc 03 §18.2 Layer 4 / INV-03-12, which are the
 * deterministic output scans in tutor-output-serializer.ts. Those still run on
 * every reply, including when a Model Armor scan is skipped, and still fail
 * CLOSED. So a skipped Model Armor scan never leaves a reply without the
 * INV-03-12 scans. Recording Model Armor in Doc 03 is an open SCL question
 * for Karl, not settled here.
 *
 * plain English: the BFF's Model Armor client. Two scan points around the
 * worker call — `sanitizeUserPrompt` on the student's message against the
 * input template, `sanitizeModelResponse` on LISA's reply against the output
 * template — using the standalone Sanitize REST API in the region where the
 * Terraform templates live.
 *
 * expected outcome: every scan returns exactly one verdict and emits exactly
 * one log line:
 *   clean   → INFO  `model_armor_scan_clean`   (scan point, verdict, template)
 *   blocked → WARN  `model_armor_scan_blocked` (scan point, matched filters, template)
 *   skipped → ERROR `model_armor_scan_skipped` (scan point, reason)
 * No log line carries message text — filter names, verdicts, template IDs,
 * HTTP status and latency only.
 *
 * trade-offs:
 *  - FAIL OPEN (owner ruling: minimize fail-closed except where compliance or
 *    integrity requires it). Unconfigured, no credential, token failure,
 *    timeout, network error, non-2xx, unparseable body, incomplete invocation:
 *    all return `skipped` and the caller proceeds with the turn. A student
 *    never loses a tutoring turn because a scanner was down; the ERROR line is
 *    how the gap is seen.
 *  - Clean scans log at INFO, not DEBUG: `server/logger.ts` drops debug lines
 *    outside development, and "scanned clean" is the only production evidence
 *    that a scan ran at all. Two short lines per turn.
 *  - Endpoint region is a constant tied to Terraform `var.region`, NOT derived
 *    from VERTEX_LOCATION (which is `global` — there is no
 *    `modelarmor.global.rep.googleapis.com`, which is what made the worker's
 *    old sanitizeOutput unusable). Same rule as CLOUD_TASKS_LOCATION.
 *  - Credentials: the one BFF resolver (`server/lib/gcp-credentials.ts`). No
 *    second credential path. The BFF service account needs
 *    `roles/modelarmor.user`.
 *  - Timeout 1500 ms per scan, covering token + request. Measured 0.18–0.42 s
 *    per call from Cloud Shell (2026-09-24); Vercel's default region (iad1)
 *    to us-central1 adds roughly 25–40 ms RTT, and a cold function pays a TLS
 *    handshake and a first token mint. 1500 ms is ~3.5× the slowest measured
 *    call — a slow-but-working scanner is not cut off, and a dead one costs a
 *    bounded 1.5 s per scan point before the turn proceeds unscanned.
 *
 * edge cases:
 *  - A template ID stored as a full resource name (`projects/…`) is used as-is.
 *  - `invocationResult: PARTIAL` with no match → skipped/ERROR
 *    (`invocation_incomplete`): some filter did not run, so "clean" would
 *    overstate it. A MATCH_FOUND blocks regardless of invocation state.
 *  - MATCH_FOUND with no identifiable inner filter → matched `["unknown"]`,
 *    still blocked.
 *  - The Zod failure path logs issue PATHS only — never received values,
 *    which for this API can include echoed message items and matched URIs.
 */
import { z } from "zod";
import { logger } from "../logger";
import {
  getGcpAccessTokenResult,
  getGcpCredentials,
} from "../lib/gcp-credentials";
import { TutorConfig } from "./tutor-config";

// ── Constants ─────────────────────────────────────────────────────────

/**
 * Region of `google_model_armor_template.input` / `.output`: `var.region` in
 * infra/terraform (us-central1). Infrastructure, not a model setting.
 */
export const MODEL_ARMOR_LOCATION = "us-central1";

/** Regional Model Armor endpoint for MODEL_ARMOR_LOCATION. */
export const MODEL_ARMOR_ENDPOINT = `https://modelarmor.${MODEL_ARMOR_LOCATION}.rep.googleapis.com`;

/** Per-scan budget, token mint + request. See header for the reasoning. */
export const MODEL_ARMOR_TIMEOUT_MS = 1500;

/**
 * What the student sees in place of a reply when Model Armor blocks the
 * student's message or LISA's response. Neutral: not an error, not a safety
 * lecture, and it does not say what was matched (INV-03-13 silent handling).
 */
export const MODEL_ARMOR_SUBSTITUTION =
  "I can't help with that one. Let's get back to your SAT prep — what would you like to work on next?";

const LOG_COMPONENT = "TUTOR_MODEL_ARMOR";

// ── Types ─────────────────────────────────────────────────────────────

export type ModelArmorScanPoint = "input" | "output";

export type ModelArmorSkipReason =
  | "template_unconfigured"
  | "credentials_unavailable"
  | "token_mint_failed"
  | "timeout"
  | "unreachable"
  | "http_error"
  | "invalid_response"
  | "invocation_incomplete";

export type ModelArmorVerdict =
  | { kind: "clean"; templateId: string; latencyMs: number }
  | {
      kind: "blocked";
      templateId: string;
      matchedFilters: string[];
      latencyMs: number;
    }
  | { kind: "skipped"; reason: ModelArmorSkipReason; latencyMs: number };

// ── Response schema (google.cloud.modelarmor.v1 SanitizationResult) ─────
// Field names per the v1 proto (JSON camelCase). Loose on purpose: only the
// fields that decide the verdict are read; unknown fields pass through.

const innerFilterSchema = z
  .object({
    matchState: z.string().optional(),
    executionState: z.string().optional(),
  })
  .passthrough();

const raiFilterSchema = innerFilterSchema.extend({
  raiFilterTypeResults: z
    .record(z.object({ matchState: z.string().optional() }).passthrough())
    .optional(),
});

const sdpInspectSchema = innerFilterSchema.extend({
  findings: z
    .array(z.object({ infoType: z.string().optional() }).passthrough())
    .optional(),
});

const filterResultSchema = z
  .object({
    raiFilterResult: raiFilterSchema.optional(),
    sdpFilterResult: z
      .object({
        inspectResult: sdpInspectSchema.optional(),
        deidentifyResult: innerFilterSchema.optional(),
        redactResult: innerFilterSchema.optional(),
      })
      .passthrough()
      .optional(),
    piAndJailbreakFilterResult: innerFilterSchema.optional(),
    maliciousUriFilterResult: innerFilterSchema.optional(),
    csamFilterFilterResult: innerFilterSchema.optional(),
    virusScanFilterResult: innerFilterSchema.optional(),
  })
  .passthrough();

export const sanitizeResponseSchema = z.object({
  sanitizationResult: z
    .object({
      filterMatchState: z.string(),
      filterResults: z.record(filterResultSchema).optional(),
      invocationResult: z.string().optional(),
    })
    .passthrough(),
});

type SanitizeResponse = z.infer<typeof sanitizeResponseSchema>;
type FilterResult = z.infer<typeof filterResultSchema>;

const MATCH_FOUND = "MATCH_FOUND";

// ── Pure evaluation ─────────────────────────────────────────────────────

/**
 * Names of the filters that matched, e.g. `rai:sexually_explicit`,
 * `pi_and_jailbreak`, `sdp:US_SOCIAL_SECURITY_NUMBER`. Names only — never
 * matched text, URIs or message items.
 */
function matchedNamesFor(key: string, result: FilterResult): string[] {
  const rai = result.raiFilterResult;
  if (rai?.matchState === MATCH_FOUND) {
    const types = Object.entries(rai.raiFilterTypeResults ?? {})
      .filter(([, r]) => r.matchState === MATCH_FOUND)
      .map(([name]) => `rai:${name.toLowerCase()}`);
    return types.length > 0 ? types : [key];
  }
  const inspect = result.sdpFilterResult?.inspectResult;
  if (inspect?.matchState === MATCH_FOUND) {
    const infoTypes = [
      ...new Set(
        (inspect.findings ?? [])
          .map((f) => f.infoType)
          .filter((t): t is string => typeof t === "string" && t.length > 0),
      ),
    ].map((t) => `sdp:${t}`);
    return infoTypes.length > 0 ? infoTypes : [key];
  }
  const others = [
    result.sdpFilterResult?.deidentifyResult,
    result.sdpFilterResult?.redactResult,
    result.piAndJailbreakFilterResult,
    result.maliciousUriFilterResult,
    result.csamFilterFilterResult,
    result.virusScanFilterResult,
  ];
  return others.some((r) => r?.matchState === MATCH_FOUND) ? [key] : [];
}

export type SanitizationEvaluation =
  | { kind: "clean" }
  | { kind: "blocked"; matchedFilters: string[] }
  | { kind: "incomplete"; invocationResult: string };

/**
 * Pure: decides the verdict from a parsed Sanitize response. Exported for
 * tests. A match blocks whatever the invocation state; no match on an
 * invocation that did not fully succeed is `incomplete`, not clean.
 */
export function evaluateSanitization(
  response: SanitizeResponse,
): SanitizationEvaluation {
  const result = response.sanitizationResult;
  if (result.filterMatchState === MATCH_FOUND) {
    const names = Object.entries(result.filterResults ?? {}).flatMap(
      ([key, r]) => matchedNamesFor(key, r),
    );
    return {
      kind: "blocked",
      matchedFilters: names.length > 0 ? names : ["unknown"],
    };
  }
  const invocation = result.invocationResult ?? "SUCCESS";
  if (invocation !== "SUCCESS") {
    return { kind: "incomplete", invocationResult: invocation };
  }
  return { kind: "clean" };
}

// ── Network ─────────────────────────────────────────────────────────────

function templateResourceName(projectId: string, templateId: string): string {
  if (templateId.startsWith("projects/")) return templateId;
  return `projects/${projectId}/locations/${MODEL_ARMOR_LOCATION}/templates/${templateId}`;
}

/** The request URL for one scan. Exported so a test can pin the region. */
export function modelArmorSanitizeUrl(
  point: ModelArmorScanPoint,
  projectId: string,
  templateId: string,
): string {
  const method =
    point === "input" ? "sanitizeUserPrompt" : "sanitizeModelResponse";
  return `${MODEL_ARMOR_ENDPOINT}/v1/${templateResourceName(projectId, templateId)}:${method}`;
}

type RawOutcome =
  | { ok: true; evaluation: SanitizationEvaluation }
  | {
      ok: false;
      reason: ModelArmorSkipReason;
      fields: Record<string, unknown>;
    };

async function callSanitize(
  point: ModelArmorScanPoint,
  templateId: string,
  text: string,
  signal: AbortSignal,
): Promise<RawOutcome> {
  let projectId: string;
  try {
    projectId = getGcpCredentials().project_id;
  } catch (err: unknown) {
    // getGcpCredentials throws fixed-vocabulary messages only.
    return {
      ok: false,
      reason: "credentials_unavailable",
      fields: { detail: err instanceof Error ? err.message : "unknown" },
    };
  }

  const token = await getGcpAccessTokenResult();
  if (!token.ok) {
    return {
      ok: false,
      reason: token.reason,
      fields: { detail: token.detail },
    };
  }

  const body =
    point === "input"
      ? { userPromptData: { text } }
      : { modelResponseData: { text } };

  let response: Response;
  try {
    response = await fetch(
      modelArmorSanitizeUrl(point, projectId, templateId),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      },
    );
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : "unknown";
    if (name === "AbortError" || name === "TimeoutError") {
      return { ok: false, reason: "timeout", fields: {} };
    }
    // Class name only: a fetch error message can carry request detail.
    return { ok: false, reason: "unreachable", fields: { error_class: name } };
  }

  if (!response.ok) {
    // Status only — never the body.
    return {
      ok: false,
      reason: "http_error",
      fields: { http_status: response.status },
    };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : "unknown";
    if (name === "AbortError" || name === "TimeoutError") {
      return { ok: false, reason: "timeout", fields: {} };
    }
    return {
      ok: false,
      reason: "invalid_response",
      fields: { error_class: name },
    };
  }

  const parsed = sanitizeResponseSchema.safeParse(raw);
  if (!parsed.success) {
    // Issue paths only — received values can echo content.
    return {
      ok: false,
      reason: "invalid_response",
      fields: {
        schema_paths: parsed.error.issues.map((i) => i.path.join(".")),
      },
    };
  }

  return { ok: true, evaluation: evaluateSanitization(parsed.data) };
}

// ── Entry point ─────────────────────────────────────────────────────────

/**
 * Scans one piece of text at one scan point. Never throws, never rejects.
 * Exactly one log line per call; none of them contains `text`.
 *
 * @param point   "input" (student message, input template) or "output"
 *                (LISA's reply, output template).
 * @param text    The text to scan. Sent to Model Armor; never logged.
 * @param conversationId For log correlation only.
 */
export async function scanWithModelArmor(
  point: ModelArmorScanPoint,
  text: string,
  conversationId: string,
): Promise<ModelArmorVerdict> {
  const startedAt = Date.now();
  const configKey =
    point === "input"
      ? "model_armor_input_template_id"
      : "model_armor_output_template_id";
  const templateId = (TutorConfig.get(configKey) ?? "").trim();

  const skip = (
    reason: ModelArmorSkipReason,
    fields: Record<string, unknown>,
  ): ModelArmorVerdict => {
    const latencyMs = Date.now() - startedAt;
    logger.error(
      LOG_COMPONENT,
      "model_armor_scan_skipped",
      "Model Armor scan did not run; turn proceeds unscanned at this point (fail open)",
      undefined,
      {
        scan_point: point,
        verdict: "skipped",
        reason,
        template_id: templateId || null,
        latency_ms: latencyMs,
        conversation_id: conversationId,
        ...fields,
      },
    );
    return { kind: "skipped", reason, latencyMs };
  };

  if (!templateId) {
    return skip("template_unconfigured", { config_key: configKey });
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RawOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, reason: "timeout", fields: {} });
    }, MODEL_ARMOR_TIMEOUT_MS);
  });

  let outcome: RawOutcome;
  try {
    // The race also bounds the token mint, which takes no abort signal.
    outcome = await Promise.race([
      callSanitize(point, templateId, text, controller.signal),
      timeout,
    ]);
  } catch (err: unknown) {
    // callSanitize guards every await; this is the backstop that keeps the
    // fail-open promise if something unforeseen throws.
    outcome = {
      ok: false,
      reason: "unreachable",
      fields: { error_class: err instanceof Error ? err.name : "unknown" },
    };
  } finally {
    clearTimeout(timer);
  }

  if (!outcome.ok) {
    return skip(outcome.reason, {
      ...outcome.fields,
      ...(outcome.reason === "timeout"
        ? { timeout_ms: MODEL_ARMOR_TIMEOUT_MS }
        : {}),
    });
  }

  const evaluation = outcome.evaluation;
  if (evaluation.kind === "incomplete") {
    return skip("invocation_incomplete", {
      invocation_result: evaluation.invocationResult,
    });
  }

  const latencyMs = Date.now() - startedAt;
  if (evaluation.kind === "blocked") {
    logger.warn(
      LOG_COMPONENT,
      "model_armor_scan_blocked",
      "Model Armor matched; content replaced with the neutral substitution",
      {
        scan_point: point,
        verdict: "blocked",
        matched_filters: evaluation.matchedFilters,
        template_id: templateId,
        latency_ms: latencyMs,
        conversation_id: conversationId,
      },
    );
    return {
      kind: "blocked",
      templateId,
      matchedFilters: evaluation.matchedFilters,
      latencyMs,
    };
  }

  logger.info(
    LOG_COMPONENT,
    "model_armor_scan_clean",
    "Model Armor scan clean",
    {
      scan_point: point,
      verdict: "clean",
      template_id: templateId,
      latency_ms: latencyMs,
      conversation_id: conversationId,
    },
  );
  return { kind: "clean", templateId, latencyMs };
}
