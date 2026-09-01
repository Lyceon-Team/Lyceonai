/**
 * @spec [Doc-03B_V2 §16.3-16.5, INV-03-04, INV-03-09, INV-03-10, INV-03-12,
 *        INV-03-13, INV-03-17; Doc-03A_V3 §12.6, §12.8-12.9]
 * @implemented 2026-08-14
 *
 * plain English: THE single mandatory output serializer for every student-facing
 * LISA response. Every response path — normal append, idempotency replay, GET
 * replay, crisis delivery, and list conversations — MUST call
 * `serializeTutorOutput()` before content reaches the client.
 *
 * Runs 5 scan classes per Doc 03B §16.3:
 *   1. Internal metadata cleanup (removeInternalMetadataMentions)
 *   2. Answer leak detection (hasAnswerLeak) — pre-submit only
 *   3. Canonical ID leak (hasCanonicalIdLeak) — INV-03-10, SCL-030
 *   4. System-prompt signature leak (hasSystemPromptLeak) — INV-03-17
 *   5. Persona / identity violation (hasPersonaViolation) — INV-03-09
 *
 * expected outcome: every LISA response is scanned across all 5 classes before
 * delivery. On any blocking detection: substitute with TUTOR_ANTI_LEAK_SUBSTITUTION,
 * log to tutor_injection_log with detection_layer = 'layer_4_output' (§16.4),
 * dual-write to abuse_score_incidents per Doc 03A §12.8.
 * Silent handling per INV-03-13 — no acknowledgment to student.
 *
 * trade-offs:
 *  - Regex-based detection may produce false negatives on novel phrasing. This
 *    is the fast deterministic layer; Model Armor (worker-side) provides model-
 *    backed depth. False positives are preferable to leaks.
 *  - Fail-closed: if any scan throws, substitute rather than deliver. Unresolved
 *    correct_answer on a pre-submit turn is a blocking gate (LISA-FULL-007).
 *  - Server-authored content (crisis resources, system notes) passes through
 *    the serializer for static-gate compliance but skips model-safety scans —
 *    server strings are safe by construction.
 *  - SLI emission via structured JSON logs for Cloud Logging log-based metrics
 *    (no metrics library — per Doc 03B §22, emitted via 01A §15 metrics
 *    interface; structured logs are the current implementation).
 *
 * edge cases:
 *  - List path `last_message_preview` (100-char truncation): scanned for defense-
 *    in-depth even though the full message was already scanned at persist time.
 *  - correctAnswerResolutionFailed=true + isPreSubmit=true → blocking gate.
 *  - Crisis responses: pass through unmodified (isServerAuthored=true).
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import {
  TUTOR_ANTI_LEAK_SUBSTITUTION,
  hasAnswerLeak,
  hasCanonicalIdLeak,
  hasSystemPromptLeak,
  hasPersonaViolation,
  removeInternalMetadataMentions,
} from "../../shared/tutor-safety-constants";

// Re-export for consumers that previously imported from tutor-antileak.ts
// or tutor-runtime.ts — single import path going forward.
export { TUTOR_ANTI_LEAK_SUBSTITUTION };

// ── Types ──────────────────────────────────────────────────────────────

/**
 * Context required by the output serializer to evaluate all 5 scan classes.
 * Assembled by the caller (route handler) from server-authoritative state.
 */
export type OutputScanContext = {
  /** Conversation ID for logging and dual-write. */
  conversationId: string;
  /** Student profile ID for dual-write to abuse_score_incidents. */
  studentId: string;
  /** Server-resolved pre-submit state (from isPreSubmitForSurface). */
  isPreSubmit: boolean;
  /** Server-resolved correct answer. null = no question context or post-submit. */
  correctAnswer: string | null;
  /**
   * True when correctAnswer is null BECAUSE resolution failed (DB error),
   * not because there is no question context. Combined with isPreSubmit=true,
   * this triggers the blocking gate (LISA-FULL-007).
   */
  correctAnswerResolutionFailed: boolean;
  /** Canonical question ID from the conversation scope, for logging. */
  questionCanonicalId: string | null;
  /**
   * True for server-authored content (crisis resources, system notes) that
   * is safe by construction and should skip model-safety scans.
   */
  isServerAuthored?: boolean;
  /**
   * Prior student-role message texts from the conversation. Used for the
   * echo exemption: when the correct-answer value appears VERBATIM in a
   * prior student message, LISA repeating it is reflection, not disclosure.
   * Omitting this field preserves fail-closed behavior (no echo exemption).
   */
  studentMessages?: readonly string[];
};

/**
 * Result of the output serializer. `blocked` is true when the response was
 * substituted — the original content never reaches the student.
 */
export type SerializedOutput = {
  content: string;
  blocked: boolean;
  scanResults: {
    metadataCleaned: boolean;
    answerLeakDetected: boolean;
    canonicalIdLeakDetected: boolean;
    systemPromptLeakDetected: boolean;
    personaViolationDetected: boolean;
    correctAnswerGateBlocked: boolean;
  };
};

// ── Scan class identifiers for logging ──────────────────────────────────

type ScanClass =
  | "answer_leak"
  | "canonical_id_leak"
  | "system_prompt_leak"
  | "persona_violation"
  | "correct_answer_gate";

// ── Dual-write: abuse_score_incidents (Doc 03A §12.8) ───────────────────

/**
 * Records an output-scan detection to abuse_score_incidents for platform-wide
 * scoring (01A Part VI). This is the dual-write companion to the LISA-specific
 * tutor_injection_log write.
 *
 * @spec [Doc-03A_V3 §12.8, §12.9, §12A.8]
 */
async function recordAbuseIncident(
  studentProfileId: string,
  scanClass: ScanClass,
  conversationId: string,
): Promise<void> {
  const { error } = await supabaseServer.from("abuse_score_incidents").insert({
    student_profile_id: studentProfileId,
    incident_type: "output_scan_block",
    severity: scanClass === "answer_leak" ? 4 : 3,
    context: {
      scan_class: scanClass,
      conversation_id: conversationId,
      detection_layer: "layer_4_output",
    },
    source_module: "tutor_output_serializer",
  });

  if (error) {
    logger.error(
      "TUTOR_OUTPUT_SERIALIZER",
      "abuse_incident_write_failed",
      "failed to dual-write to abuse_score_incidents; tutor_injection_log write stands",
      { error: error.message, code: error.code },
      { studentProfileId, scanClass, conversationId },
    );
  }
}

/**
 * Records an output-scan detection to tutor_injection_log for LISA-specific
 * forensic evidence (safety review queue, Doc 03 §21.3).
 *
 * @spec [Doc-03B_V2 §16.4, Doc-03A_V3 §12.8]
 */
async function recordOutputScanLog(
  studentId: string,
  conversationId: string,
  scanClass: ScanClass,
): Promise<void> {
  const { error } = await supabaseServer.from("tutor_injection_log").insert({
    student_id: studentId,
    conversation_id: conversationId,
    detection_layer: "layer_4_output",
    action_taken: "blocked_substituted",
    response_substituted: true,
    signature_matched: null,
  });

  if (error) {
    logger.error(
      "TUTOR_OUTPUT_SERIALIZER",
      "injection_log_write_failed",
      "failed to write output-scan detection to tutor_injection_log",
      { error: error.message, code: error.code },
      { studentId, conversationId, scanClass },
    );
  }
}

// ── SLI Emission (Doc 03B §22.2) ────────────────────────────────────────

/**
 * Emits a structured JSON log for Cloud Logging log-based metrics.
 * `scanner_block_rate` is derived from events with event_id=scanner_block.
 * No metrics library — structured logs are the current implementation per
 * Doc 03B §22 / 01A §15 metrics interface.
 *
 * @spec [Doc-03B_V2 §22.2]
 */
function emitScannerSli(
  blocked: boolean,
  scanClasses: ScanClass[],
  conversationId: string,
): void {
  logger.info(
    "TUTOR_OUTPUT_SERIALIZER",
    "scanner_block",
    blocked
      ? "output scanner blocked response; safe fallback substituted"
      : "output scanner passed response; no detections",
    {
      blocked,
      scan_classes: scanClasses,
      conversation_id: conversationId,
    },
  );
}

// ── The Serializer ──────────────────────────────────────────────────────

/**
 * THE single mandatory output serializer for all student-facing LISA content.
 * Every response path MUST call this before content reaches the client.
 *
 * Scan order:
 *   1. Internal metadata cleanup (always — strips, not blocks)
 *   2. Correct-answer resolution gate (pre-submit only)
 *   3. Answer leak detection (pre-submit only)
 *   4. Canonical ID leak
 *   5. System-prompt signature leak
 *   6. Persona / identity violation
 *
 * Any blocking detection → substitute with TUTOR_ANTI_LEAK_SUBSTITUTION.
 * On scan error → fail closed (substitute).
 * All detections are silent per INV-03-13.
 *
 * @spec [Doc-03B_V2 §16.3-16.5, INV-03-04, INV-03-09, INV-03-10,
 *        INV-03-12, INV-03-13, INV-03-17]
 */
export async function serializeTutorOutput(
  rawText: string,
  context: OutputScanContext,
): Promise<SerializedOutput> {
  const scanResults: SerializedOutput["scanResults"] = {
    metadataCleaned: false,
    answerLeakDetected: false,
    canonicalIdLeakDetected: false,
    systemPromptLeakDetected: false,
    personaViolationDetected: false,
    correctAnswerGateBlocked: false,
  };

  // ── Server-authored shortcut ──────────────────────────────────────
  // Crisis resources, system notes — safe by construction. Pass through
  // for static-gate compliance without running model-safety scans.
  if (context.isServerAuthored) {
    emitScannerSli(false, [], context.conversationId);
    return { content: rawText, blocked: false, scanResults };
  }

  // ── Fail-closed wrapper ───────────────────────────────────────────
  // If any scan throws, substitute rather than deliver. A failed scanner
  // must never allow potentially unsafe content through.
  try {
    return await runAllScans(rawText, context, scanResults);
  } catch (err: unknown) {
    logger.error(
      "TUTOR_OUTPUT_SERIALIZER",
      "serializer_scan_error",
      "output serializer threw during scan; failing closed with substitution",
      {
        error: err instanceof Error ? err.message : String(err),
        conversationId: context.conversationId,
      },
    );
    emitScannerSli(true, ["answer_leak"], context.conversationId);
    return {
      content: TUTOR_ANTI_LEAK_SUBSTITUTION,
      blocked: true,
      scanResults: {
        ...scanResults,
        answerLeakDetected: true, // conservative — we don't know what failed
      },
    };
  }
}

/**
 * Internal: runs all 5 scan classes in sequence on the provided text.
 * Extracted for the try/catch fail-closed wrapper in serializeTutorOutput.
 */
async function runAllScans(
  rawText: string,
  context: OutputScanContext,
  scanResults: SerializedOutput["scanResults"],
): Promise<SerializedOutput> {
  const detectedClasses: ScanClass[] = [];

  // ── 1. Internal metadata cleanup (always applied) ─────────────────
  const cleaned = removeInternalMetadataMentions(rawText);
  scanResults.metadataCleaned = cleaned !== rawText;

  // ── 2. Correct-answer resolution gate (LISA-FULL-007) ─────────────
  // If pre-submit AND correct_answer resolution FAILED, block. We cannot
  // run an answer-aware scan without the answer, and letting content
  // through with only generic detection on a scoped question is fail-open.
  if (context.isPreSubmit && context.correctAnswerResolutionFailed) {
    scanResults.correctAnswerGateBlocked = true;
    detectedClasses.push("correct_answer_gate");
    logger.warn(
      "TUTOR_OUTPUT_SERIALIZER",
      "correct_answer_gate_blocked",
      "pre-submit turn with unresolved correct_answer; blocking per LISA-FULL-007",
      { conversationId: context.conversationId },
    );
  }

  // ── 3. Answer leak detection (pre-submit only) ────────────────────
  if (context.isPreSubmit && !scanResults.correctAnswerGateBlocked) {
    if (
      hasAnswerLeak(cleaned, context.correctAnswer, context.studentMessages)
    ) {
      scanResults.answerLeakDetected = true;
      detectedClasses.push("answer_leak");
    }
  }

  // ── 4. Canonical ID leak (INV-03-10, SCL-030) ────────────────────
  if (hasCanonicalIdLeak(cleaned)) {
    scanResults.canonicalIdLeakDetected = true;
    detectedClasses.push("canonical_id_leak");
  }

  // ── 5. System-prompt signature leak (INV-03-17) ──────────────────
  if (hasSystemPromptLeak(cleaned)) {
    scanResults.systemPromptLeakDetected = true;
    detectedClasses.push("system_prompt_leak");
  }

  // ── 6. Persona / identity violation (INV-03-09) ──────────────────
  if (hasPersonaViolation(cleaned)) {
    scanResults.personaViolationDetected = true;
    detectedClasses.push("persona_violation");
  }

  // ── Evaluate: any blocking detection? ─────────────────────────────
  const blocked = detectedClasses.length > 0;
  const content = blocked ? TUTOR_ANTI_LEAK_SUBSTITUTION : cleaned;

  // ── SLI emission (§22.2) ──────────────────────────────────────────
  emitScannerSli(blocked, detectedClasses, context.conversationId);

  // ── Dual-write on detection (§12.8, §16.4) ────────────────────────
  // Fire-and-forget — logging failures must not block the response.
  if (blocked) {
    for (const scanClass of detectedClasses) {
      logger.warn(
        "TUTOR_OUTPUT_SERIALIZER",
        "scan_class_detected",
        "output scanner detected violation; response substituted (INV-03-13 silent)",
        {
          scan_class: scanClass,
          conversation_id: context.conversationId,
          student_id: context.studentId,
        },
      );
    }

    // Dual-write: tutor_injection_log (LISA forensic) + abuse_score_incidents
    // (platform-wide). Both are fire-and-forget per spec — the substituted
    // response delivery must not be delayed by log writes.
    const primaryClass = detectedClasses[0];
    void recordOutputScanLog(
      context.studentId,
      context.conversationId,
      primaryClass,
    );
    void recordAbuseIncident(
      context.studentId,
      primaryClass,
      context.conversationId,
    );
  }

  return { content, blocked, scanResults };
}
