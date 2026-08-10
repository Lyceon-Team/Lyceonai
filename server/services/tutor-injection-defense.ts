/**
 * @spec [Doc-03_V3 §18.2 Layers 3-5, INV-03-12, INV-03-13, Doc-03A_V3 §12]
 * @implemented 2026-08-09
 *
 * plain English: Input sanitization, injection signature scanning, and Model Armor
 * integration for the LISA tutor runtime. Implements Layers 3-5 of the injection
 * defense stack: input content isolation (Layer 3), output scanning (Layer 4 —
 * complement to tutor-antileak.ts), and rate limiting on injection attempts (Layer 5).
 *
 * expected outcome: every student message is sanitized (length-bounded, HTML-escaped,
 * boundary-marked) before entering the prompt pipeline. Known injection signatures
 * are matched against the tutor_injection_signatures table. Detected attempts are
 * logged to tutor_injection_log for forensic review but NEVER acknowledged to the
 * student (INV-03-13).
 *
 * trade-offs: heuristic pattern scanning has inherent false-positive/negative rates.
 * The deterministic layer catches known attacks; Model Armor provides the depth layer.
 * We err on the side of detection (false positives logged, not blocked) to avoid
 * giving attackers telemetry about what bypassed.
 *
 * edge cases:
 *  - Signature table unreadable: fails closed (INV-03-16 parallel — Layer 1 table
 *    unreadable = fail closed).
 *  - Model Armor template IDs loaded from config, never hardcoded literals.
 *  - Injection logging never leaks back to student (INV-03-13: logged, not acknowledged).
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";

// ── Types ──────────────────────────────────────────────────────────────

type SanitizeResult = {
  sanitized: string;
  truncated: boolean;
};

type BoundaryContentType =
  | "student_input"
  | "question_content"
  | "memory_content";

type InjectionScanResult = {
  detected: boolean;
  patterns: string[];
};

type SignatureCheckResult = {
  matched: boolean;
  signatureId: string | null;
};

type ModelArmorConfig = {
  templateId: string;
};

// ── Constants ──────────────────────────────────────────────────────────

import {
  STUDENT_INPUT_OPEN,
  STUDENT_INPUT_CLOSE,
} from "../../shared/tutor-safety-constants";

/** Default max input length from tutor_context_runtime_config (injection_length_bound_chars). */
const DEFAULT_MAX_INPUT_LENGTH = 4000;

/**
 * Boundary marker templates per Doc 03A §12.3.
 * Content wrapped in these markers is treated as data, not instructions.
 *
 * student_input open/close are imported from the shared safety constants
 * (single source of truth — same file is copied into the worker at prebuild).
 * question_content and memory_content are BFF-only (not mirrored to worker).
 */
const BOUNDARY_MARKERS: Readonly<
  Record<BoundaryContentType, { open: string; close: string }>
> = {
  student_input: {
    open: STUDENT_INPUT_OPEN,
    close: STUDENT_INPUT_CLOSE,
  },
  question_content: {
    open: "<<<QUESTION_CONTENT>>>",
    close: "<<<END_QUESTION_CONTENT>>>",
  },
  memory_content: {
    open: "<<<MEMORY_CONTENT>>>",
    close: "<<<END_MEMORY_CONTENT>>>",
  },
};

/**
 * Heuristic injection patterns with pattern names for logging.
 * @spec [Doc-03_V3 §18.2 Layer 3, §18.3]
 */
const INJECTION_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  {
    name: "ignore_instructions",
    pattern: /ignore\s+(all\s+)?previous\s+instructions/i,
  },
  { name: "ignore_all_instructions", pattern: /ignore\s+all\s+instructions/i },
  { name: "role_override_you_are", pattern: /you\s+are\s+now/i },
  { name: "role_override_act_as", pattern: /act\s+as\b/i },
  { name: "role_override_pretend", pattern: /pretend\s+to\s+be/i },
  { name: "role_injection_system", pattern: /\bsystem\s*:/i },
  { name: "role_injection_assistant", pattern: /\bassistant\s*:/i },
  { name: "prompt_extraction_reveal", pattern: /reveal\s+your/i },
  { name: "prompt_extraction_show", pattern: /show\s+me\s+your/i },
  { name: "forget_everything", pattern: /forget\s+everything/i },
  { name: "disregard", pattern: /\bdisregard\b/i },
];

// ── Input Sanitization (Layer 3) ───────────────────────────────────────

/**
 * Sanitizes student input: length-bounds and HTML-escapes.
 *
 * @spec [Doc-03_V3 §18.2 Layer 3, Doc-03A_V3 §12]
 */
export function sanitizeInput(
  text: string,
  maxLength: number = DEFAULT_MAX_INPUT_LENGTH,
): SanitizeResult {
  let sanitized = text;
  let truncated = false;

  // Length check
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
    truncated = true;
    logger.info(
      "TUTOR_INJECTION_DEFENSE",
      "input_truncated",
      "student input exceeded max length; truncated",
      { originalLength: text.length, maxLength },
    );
  }

  // HTML tag escaping — prevent injection via HTML/XML-like structures
  sanitized = sanitized
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return { sanitized, truncated };
}

/**
 * Wraps content in distinctive boundary markers per Doc 03A §12.3.
 * Gemini is instructed that content inside these markers is data, not instructions.
 *
 * @spec [Doc-03A_V3 §12.3]
 */
export function wrapWithBoundaryMarkers(
  content: string,
  contentType: BoundaryContentType,
): string {
  const markers = BOUNDARY_MARKERS[contentType];
  return `${markers.open}\n${content}\n${markers.close}`;
}

// ── Injection Pattern Scanning (Layer 4 input side) ────────────────────

/**
 * Heuristic scan for nested instruction / injection patterns.
 * Returns detected flag + list of matched pattern names (for logging, never for student).
 *
 * @spec [Doc-03_V3 §18.2 Layer 4, §18.3, INV-03-13]
 */
export function scanForInjectionPatterns(text: string): InjectionScanResult {
  const matchedPatterns: string[] = [];

  for (const entry of INJECTION_PATTERNS) {
    if (entry.pattern.test(text)) {
      matchedPatterns.push(entry.name);
    }
  }

  return {
    detected: matchedPatterns.length > 0,
    patterns: matchedPatterns,
  };
}

// ── Signature Table Check ──────────────────────────────────────────────

/**
 * Queries tutor_injection_signatures table for known attack signatures.
 * Fails closed if table is unreadable (INV-03-16 parallel: Layer 1 table
 * unreadable = fail closed).
 *
 * @spec [Doc-03_V3 §18.2, Doc-03A_V3 §12.3, INV-03-16]
 */
export async function checkSignatureTable(
  text: string,
): Promise<SignatureCheckResult> {
  const { data, error } = await supabaseServer
    .from("tutor_injection_signatures")
    .select("id, signature_pattern, signature_type");

  if (error) {
    logger.error(
      "TUTOR_INJECTION_DEFENSE",
      "signature_table_read_failed",
      "tutor_injection_signatures table unreadable; failing closed",
      error,
    );
    // Fail closed — treat as matched when table is unreadable
    return { matched: true, signatureId: null };
  }

  if (!data || data.length === 0) {
    return { matched: false, signatureId: null };
  }

  const lowerText = text.toLowerCase();

  for (const row of data) {
    const pattern = row.signature_pattern as string;
    const sigType = row.signature_type as string;

    let matched = false;
    if (sigType === "regex") {
      try {
        const re = new RegExp(pattern, "i");
        matched = re.test(text);
      } catch {
        // Invalid regex in signature table — log and skip this pattern
        logger.warn(
          "TUTOR_INJECTION_DEFENSE",
          "invalid_signature_regex",
          "invalid regex in tutor_injection_signatures; skipping",
          { signatureId: row.id },
        );
      }
    } else {
      // Default: substring match (case-insensitive)
      matched = lowerText.includes(pattern.toLowerCase());
    }

    if (matched) {
      return { matched: true, signatureId: row.id as string };
    }
  }

  return { matched: false, signatureId: null };
}

// ── Injection Logging (INV-03-13: logged, NEVER acknowledged) ──────────

/**
 * Writes injection attempt to tutor_injection_log for forensic evidence.
 * Per INV-03-13: logged but NEVER acknowledged to the student.
 *
 * @spec [INV-03-13, Doc-03_V3 §18.2 Layer 5]
 */
export async function logInjectionAttempt(
  studentId: string,
  conversationId: string,
  patterns: string[],
  signatureId: string | null,
): Promise<void> {
  const { error } = await supabaseServer.from("tutor_injection_log").insert({
    student_id: studentId,
    conversation_id: conversationId,
    signature_matched: signatureId,
    detection_layer:
      patterns.length > 0 ? "layer_3_sanitization" : "layer_4_output",
    action_taken: "logged",
    response_substituted: null,
  });

  if (error) {
    // Log failure to write injection log — do not propagate to student
    logger.error(
      "TUTOR_INJECTION_DEFENSE",
      "injection_log_write_failed",
      "failed to write injection attempt to tutor_injection_log",
      error,
      { studentId, conversationId },
    );
    return;
  }

  logger.info(
    "TUTOR_INJECTION_DEFENSE",
    "injection_attempt_logged",
    "injection attempt recorded in tutor_injection_log",
    {
      studentId,
      conversationId,
      patternCount: patterns.length,
      hasSignatureMatch: signatureId !== null,
    },
  );
}

// ── Model Armor Config ─────────────────────────────────────────────────

/**
 * Returns Model Armor template ID from runtime config.
 * Template IDs are NEVER hardcoded literals — they are loaded from
 * tutor_context_runtime_config.
 *
 * Input: inline modelArmorConfig on generateContent call.
 * Output: standalone Sanitize API call.
 *
 * @spec [Doc-03_V3 §18.2, Doc-03C_V3 GCP Orchestration]
 */
export async function getModelArmorConfig(
  configType: "input" | "output",
): Promise<ModelArmorConfig> {
  const configKey =
    configType === "input"
      ? "model_armor_input_template_id"
      : "model_armor_output_template_id";

  const { data, error } = await supabaseServer
    .from("tutor_context_runtime_config")
    .select("value")
    .eq("key", configKey)
    .single();

  if (error || !data) {
    logger.error(
      "TUTOR_INJECTION_DEFENSE",
      "model_armor_config_missing",
      "Model Armor template ID not found in tutor_context_runtime_config; failing closed",
      error,
      { configKey },
    );
    // Fail closed — return empty template ID so the caller knows config is missing
    // and can block the request rather than proceeding unarmored
    return { templateId: "" };
  }

  const templateId =
    typeof data.value === "string" ? data.value : String(data.value);

  if (!templateId) {
    logger.error(
      "TUTOR_INJECTION_DEFENSE",
      "model_armor_config_empty",
      "Model Armor template ID is empty in tutor_context_runtime_config",
      undefined,
      { configKey },
    );
    return { templateId: "" };
  }

  return { templateId };
}
