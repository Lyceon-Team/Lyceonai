/**
 * @spec [Doc-03A_V1 §11, INV-03-11; CR-03C-V3-01 §3.4]
 * @implemented 2026-08-09
 * @modified 2026-08-20 — added crisisClassifierOutcome to TurnMetricsLog
 *   for Cloud Monitoring log-based metric alerting per CR-03C-V3-01 §3.4.
 *
 * plain English: WRITE-ONLY audit logger for every policy decision made during a
 * LISA tutor turn. Per Doc 03A §11, every policy evaluation (which prompt variant,
 * which tone, which depth, which context window was used) must be recorded with
 * enough detail to replay the decision. Two log targets:
 *   - tutor_context_resolution_log (§11.3 — what context was assembled)
 *   - tutor_turn_metrics (§11.5 — operational telemetry for the turn)
 *
 * expected outcome: callers fire-and-forget into these functions during the turn
 * pipeline; failures are logged but never thrown, so the student-facing turn is
 * never blocked by audit logging.
 *
 * trade-offs / edge cases:
 *  - Fire-and-forget means a sustained DB outage silently drops audit rows.
 *    Acceptable: audit is observability, not business logic. The turn must proceed.
 *  - No student content (messages, answers) is ever written — only metadata and
 *    counts. No PII in any record (INV-03-11 + privacy invariant).
 *  - This service is never exposed to clients and never read for business logic.
 *  - crisisClassifierOutcome is a discriminated string field for Cloud Monitoring
 *    log-based metric extraction. Values: "no_crisis" | "crisis_signature" |
 *    "crisis_model" | "crisis_both" | "classifier_degraded_no_floor" |
 *    "infrastructure_failure" | "classifier_degraded" | null (for turns that
 *    don't reach the classifier, e.g. pre-pipeline guards).
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Types — exported for route-handler / orchestrator consumers
// ---------------------------------------------------------------------------

export type ContextResolutionLog = {
  conversationId: string;
  turnOrdinal: number;
  contextVersion: string;
  memorySummariesCount: number;
  recentMessagesCount: number;
  masterySnapshotPresent: boolean;
  frictionSignalsPresent: boolean;
  scopeType: string;
};

/**
 * @spec [Doc-03A_V1 §11.5, CR-03C-V3-01 §3.4]
 *
 * crisisClassifierOutcome: structured label for Cloud Monitoring alerting.
 * Values: "no_crisis", "crisis_signature", "crisis_model", "crisis_both",
 * "classifier_degraded_no_floor", "infrastructure_failure",
 * "classifier_degraded" (Layer 2 failed, Layer 1 stands), or null (unknown).
 * Cloud Monitoring log-based metric filters on this field for SCL-023
 * alerting — the metric and alert policy are Karl's GCP-console work.
 */
export type TurnMetricsLog = {
  conversationId: string;
  turnOrdinal: number;
  orchestrationDurationMs: number;
  modelName: string;
  tokensIn: number;
  tokensOut: number;
  cacheHit: boolean;
  compactionRecommended: boolean;
  antiLeakTriggered: boolean;
  injectionDetected: boolean;
  crisisTriggered: boolean;
  /**
   * @spec [CR-03C-V3-01 §3.4]
   *
   * Discriminated per-turn crisis classifier outcome for Cloud Monitoring
   * log-based metric alerting. Values:
   *  - "no_crisis"                     — classifier ran, no crisis detected
   *  - "crisis_signature"              — Layer 1 signature match only
   *  - "crisis_model"                  — Layer 2 model inference only
   *  - "crisis_both"                   — both layers flagged crisis
   *  - "classifier_degraded_no_floor"  — Layer 2 failed + Layer 1 empty (B1.5 fail-closed)
   *  - "infrastructure_failure"        — classifier threw unexpected error
   *  - "classifier_degraded"           — Layer 2 failed but Layer 1 had data (force-review)
   *  - null                            — classifier did not run (pre-pipeline exit)
   */
  crisisClassifierOutcome: string | null;
};

// ---------------------------------------------------------------------------
// Audit log functions — fire-and-forget, never throw
// ---------------------------------------------------------------------------

/**
 * Records what context was assembled for a tutor turn.
 *
 * @spec [Doc-03A_V1 §11.3]
 * @implemented 2026-08-09
 * plain English: writes one row to tutor_context_resolution_log capturing the
 * context version, counts of memory summaries and recent messages, and boolean
 * flags for mastery snapshot and friction signals presence. On DB error, logs a
 * warning and returns — never throws.
 */
export async function logContextResolution(
  params: ContextResolutionLog,
): Promise<void> {
  try {
    const { error } = await supabaseServer
      .from("tutor_context_resolution_log")
      .insert({
        conversation_id: params.conversationId,
        turn_ordinal: params.turnOrdinal,
        context_version: params.contextVersion,
        memory_summaries_count: params.memorySummariesCount,
        recent_messages_count: params.recentMessagesCount,
        mastery_snapshot_present: params.masterySnapshotPresent,
        friction_signals_present: params.frictionSignalsPresent,
        scope_type: params.scopeType,
        resolved_at: new Date().toISOString(),
      });

    if (error) {
      logger.warn(
        "TUTOR_POLICY",
        "context_resolution_log_failed",
        "Failed to write context resolution audit row; turn proceeds",
        {
          conversationId: params.conversationId,
          turnOrdinal: params.turnOrdinal,
          dbError: error.message,
          code: error.code,
        },
      );
    }
  } catch (err: unknown) {
    logger.warn(
      "TUTOR_POLICY",
      "context_resolution_log_error",
      "Unexpected error writing context resolution audit row; turn proceeds",
      {
        conversationId: params.conversationId,
        turnOrdinal: params.turnOrdinal,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }
}

/**
 * Records operational telemetry for a tutor turn.
 *
 * @spec [Doc-03A_V1 §11.5, CR-03C-V3-01 §3.4]
 * @implemented 2026-08-19
 * plain English: writes one row to tutor_turn_metrics capturing orchestration
 * duration, model name, token counts, boolean flags for cache hit, compaction
 * recommendation, anti-leak trigger, injection detection, crisis trigger,
 * and crisis classifier outcome string for Cloud Monitoring alerting.
 * On DB error, logs a warning and returns — never throws.
 * The crisisClassifierOutcome field gracefully degrades if the migration
 * (20260819000002) has not yet been applied — the fire-and-forget pattern
 * catches the DB error and proceeds.
 */
export async function logTurnMetrics(params: TurnMetricsLog): Promise<void> {
  try {
    const { error } = await supabaseServer.from("tutor_turn_metrics").insert({
      conversation_id: params.conversationId,
      turn_ordinal: params.turnOrdinal,
      orchestration_duration_ms: params.orchestrationDurationMs,
      model_name: params.modelName,
      tokens_in: params.tokensIn,
      tokens_out: params.tokensOut,
      cache_hit: params.cacheHit,
      compaction_recommended: params.compactionRecommended,
      anti_leak_triggered: params.antiLeakTriggered,
      injection_detected: params.injectionDetected,
      crisis_triggered: params.crisisTriggered,
      crisis_classifier_outcome: params.crisisClassifierOutcome,
      recorded_at: new Date().toISOString(),
    });

    if (error) {
      logger.warn(
        "TUTOR_POLICY",
        "turn_metrics_log_failed",
        "Failed to write turn metrics audit row; turn proceeds",
        {
          conversationId: params.conversationId,
          turnOrdinal: params.turnOrdinal,
          dbError: error.message,
          code: error.code,
        },
      );
    }

    // SCL-023 §3.4: structured log line for Cloud Monitoring log-based metric.
    // Karl creates the metric filter on jsonPayload.crisisClassifierOutcome.
    // This line fires on EVERY turn so the metric can track both crisis and
    // no-crisis rates — the filter expression selects the alertable values.
    logger.info(
      "TUTOR_POLICY",
      "turn_metrics_logged",
      "Turn metrics recorded",
      {
        conversationId: params.conversationId,
        turnOrdinal: params.turnOrdinal,
        modelName: params.modelName,
        orchestrationDurationMs: params.orchestrationDurationMs,
        crisisClassifierOutcome: params.crisisClassifierOutcome,
        crisisTriggered: params.crisisTriggered,
        injectionDetected: params.injectionDetected,
        antiLeakTriggered: params.antiLeakTriggered,
      },
    );
  } catch (err: unknown) {
    logger.warn(
      "TUTOR_POLICY",
      "turn_metrics_log_error",
      "Unexpected error writing turn metrics audit row; turn proceeds",
      {
        conversationId: params.conversationId,
        turnOrdinal: params.turnOrdinal,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }
}
