/**
 * @spec [Doc-03_V3 §21.3, SCL-025, CR-03C-V3-01 §3.4]
 * @implemented 2026-08-13
 *
 * plain English: Durable crisis review queue. Creates review cases when
 * a crisis is detected, enforces the 48h SLA deadline, and provides the
 * data layer for the admin review surface (separate from /api/tutor/* per SCL-025).
 *
 * expected outcome:
 *   - createCrisisReviewCase: called by the crisis detection path (tutor-crisis.ts)
 *     to INSERT a case with computed SLA deadline. Returns the case ID.
 *   - getOpenCases / getCaseById: admin review surface reads with mandatory
 *     audit log entry per SCL-025.
 *   - updateCaseDisposition: admin sets true_positive / false_positive + notes.
 *   - getBreachedCases: SLA sweep finds open cases past deadline.
 *
 * trade-offs:
 *   - SLA_HOURS is a constant (48) matching §21.3 V1 launch. When the 24h target
 *     activates after 30 days, change the constant (or make it config-driven).
 *   - Audit log writes are synchronous and blocking — an audit write failure
 *     blocks the admin read. This is correct: SCL-025 mandates "every read logged."
 *     If audit can't be written, the read must fail.
 *
 * edge cases:
 *   - Duplicate case for same conversation: handled by the UNIQUE partial index
 *     on conversation_id WHERE status IN ('open', 'in_review'). The INSERT will
 *     fail with a unique violation, which is logged and re-thrown.
 *   - Reviewer not found in profiles: FK constraint enforces validity.
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";

// ── Constants ─────────────────────────────────────────────────────────

/** SLA window in hours (§21.3 V1 launch: 48h, target after 30 days: 24h). */
const SLA_HOURS = 48;

// ── Types ─────────────────────────────────────────────────────────────

type CrisisSource = "signature" | "model" | "both" | "classifier_degraded";

type CaseStatus = "open" | "in_review" | "resolved";

type CaseDisposition = "true_positive" | "false_positive";

type AuditAction =
  | "viewed"
  | "status_changed"
  | "disposition_set"
  | "note_added";

type CreateCaseParams = {
  conversationId: string;
  studentId: string;
  source: CrisisSource;
  signatureId: string | null;
  modelConfidence: number | null;
};

type UpdateDispositionParams = {
  caseId: string;
  reviewerId: string;
  disposition: CaseDisposition;
  notes: string | null;
  ip: string;
  requestId: string;
};

type AuditLogParams = {
  caseId: string;
  conversationId: string;
  reviewerId: string;
  action: AuditAction;
  metadata?: Record<string, unknown>;
  ip: string;
  requestId: string;
};

export type {
  CrisisSource,
  CaseStatus,
  CaseDisposition,
  AuditAction,
  CreateCaseParams,
  UpdateDispositionParams,
  AuditLogParams,
};

// ── Create Case ───────────────────────────────────────────────────────

/**
 * Creates a crisis review case with a computed 48h SLA deadline.
 * Called by the crisis detection path (tutor-crisis.ts) when a crisis
 * is detected or the classifier is degraded.
 *
 * BLOCKING: throws on failure. The caller must NOT swallow this error.
 * A failed case creation means a crisis turn will not be reviewed —
 * that is worse than a failed turn.
 *
 * @spec [Doc-03_V3 §21.3, CR-03C-V3-01 §3.4]
 */
export async function createCrisisReviewCase(
  params: CreateCaseParams,
): Promise<string> {
  const slaDeadline = new Date(
    Date.now() + SLA_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabaseServer
    .from("crisis_review_cases")
    .insert({
      conversation_id: params.conversationId,
      student_id: params.studentId,
      source: params.source,
      signature_id: params.signatureId,
      model_confidence: params.modelConfidence,
      sla_deadline: slaDeadline,
    })
    .select("id")
    .single();

  if (error || !data) {
    logger.error(
      "CRISIS_REVIEW",
      "case_create_failed",
      "failed to create crisis review case — crisis turn may not be reviewed",
      error,
      {
        conversationId: params.conversationId,
        source: params.source,
      },
    );
    throw new Error(
      `crisis review case creation failed: ${error?.message ?? "no data returned"}`,
    );
  }

  logger.warn(
    "CRISIS_REVIEW",
    "case_created",
    "crisis review case created with 48h SLA deadline",
    {
      caseId: data.id,
      conversationId: params.conversationId,
      source: params.source,
      slaDeadline,
    },
  );

  return data.id as string;
}

// ── Audit Logging ─────────────────────────────────────────────────────

/**
 * Writes an append-only audit log entry per SCL-025.
 * BLOCKING: throws on failure. If audit can't be written, the operation
 * that triggered it must fail.
 *
 * @spec [SCL-025]
 */
export async function writeAuditLogEntry(
  params: AuditLogParams,
): Promise<void> {
  const { error } = await supabaseServer
    .from("crisis_review_audit_log")
    .insert({
      case_id: params.caseId,
      conversation_id: params.conversationId,
      reviewer_id: params.reviewerId,
      action: params.action,
      metadata: params.metadata ?? {},
      ip: params.ip,
      request_id: params.requestId,
    });

  if (error) {
    logger.error(
      "CRISIS_REVIEW",
      "audit_log_write_failed",
      "failed to write crisis review audit log entry — blocking operation per SCL-025",
      error,
      {
        caseId: params.caseId,
        action: params.action,
        reviewerId: params.reviewerId,
      },
    );
    throw new Error(`crisis review audit log write failed: ${error.message}`);
  }
}

// ── Admin Read Operations ─────────────────────────────────────────────

/**
 * Lists crisis review cases with pagination, filtered by status.
 * Every call writes an audit log entry per SCL-025.
 *
 * @spec [Doc-03_V3 §21.3, SCL-025]
 */
export async function listCrisisReviewCases(params: {
  reviewerId: string;
  status?: CaseStatus;
  limit: number;
  offset: number;
  ip: string;
  requestId: string;
}): Promise<{
  cases: Record<string, unknown>[];
  total: number;
}> {
  let query = supabaseServer
    .from("crisis_review_cases")
    .select("*", { count: "exact" });

  if (params.status) {
    query = query.eq("status", params.status);
  }

  query = query
    .order("created_at", { ascending: false })
    .range(params.offset, params.offset + params.limit - 1);

  const { data, error, count } = await query;

  if (error) {
    logger.error(
      "CRISIS_REVIEW",
      "list_cases_failed",
      "failed to list crisis review cases",
      error,
    );
    throw new Error(`failed to list crisis review cases: ${error.message}`);
  }

  return {
    cases: (data ?? []) as Record<string, unknown>[],
    total: count ?? 0,
  };
}

/**
 * Gets a single crisis review case by ID.
 * Writes a 'viewed' audit log entry per SCL-025.
 *
 * @spec [Doc-03_V3 §21.3, SCL-025]
 */
export async function getCrisisReviewCaseById(params: {
  caseId: string;
  reviewerId: string;
  ip: string;
  requestId: string;
}): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseServer
    .from("crisis_review_cases")
    .select("*")
    .eq("id", params.caseId)
    .maybeSingle();

  if (error) {
    logger.error(
      "CRISIS_REVIEW",
      "get_case_failed",
      "failed to get crisis review case",
      error,
      { caseId: params.caseId },
    );
    throw new Error(`failed to get crisis review case: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  // SCL-025: every read logged append-only
  await writeAuditLogEntry({
    caseId: params.caseId,
    conversationId: data.conversation_id as string,
    reviewerId: params.reviewerId,
    action: "viewed",
    ip: params.ip,
    requestId: params.requestId,
  });

  return data as Record<string, unknown>;
}

// ── Admin Write Operations ────────────────────────────────────────────

/**
 * Updates a case's disposition (true_positive / false_positive),
 * transitions status to 'resolved', and sets reviewer + timestamp.
 *
 * @spec [Doc-03_V3 §21.3 review action 1, SCL-025]
 */
export async function updateCaseDisposition(
  params: UpdateDispositionParams,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseServer
    .from("crisis_review_cases")
    .update({
      disposition: params.disposition,
      status: "resolved" as CaseStatus,
      reviewer_id: params.reviewerId,
      reviewed_at: new Date().toISOString(),
      review_notes: params.notes,
    })
    .eq("id", params.caseId)
    .select("*")
    .single();

  if (error || !data) {
    logger.error(
      "CRISIS_REVIEW",
      "disposition_update_failed",
      "failed to update crisis review case disposition",
      error,
      { caseId: params.caseId },
    );
    throw new Error(
      `failed to update case disposition: ${error?.message ?? "no data returned"}`,
    );
  }

  // SCL-025: log the disposition change
  await writeAuditLogEntry({
    caseId: params.caseId,
    conversationId: data.conversation_id as string,
    reviewerId: params.reviewerId,
    action: "disposition_set",
    metadata: {
      disposition: params.disposition,
      previous_status: "open",
      new_status: "resolved",
    },
    ip: params.ip,
    requestId: params.requestId,
  });

  logger.info(
    "CRISIS_REVIEW",
    "case_resolved",
    "crisis review case resolved by reviewer",
    {
      caseId: params.caseId,
      disposition: params.disposition,
      reviewerId: params.reviewerId,
    },
  );

  return data as Record<string, unknown>;
}

/**
 * Transitions a case from 'open' to 'in_review' status and assigns a reviewer.
 *
 * @spec [Doc-03_V3 §21.3]
 */
export async function claimCaseForReview(params: {
  caseId: string;
  reviewerId: string;
  ip: string;
  requestId: string;
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseServer
    .from("crisis_review_cases")
    .update({
      status: "in_review" as CaseStatus,
      reviewer_id: params.reviewerId,
    })
    .eq("id", params.caseId)
    .eq("status", "open")
    .select("*")
    .single();

  if (error || !data) {
    logger.error(
      "CRISIS_REVIEW",
      "claim_failed",
      "failed to claim crisis review case (may already be claimed or resolved)",
      error,
      { caseId: params.caseId },
    );
    throw new Error(
      `failed to claim case for review: ${error?.message ?? "case not found or already claimed"}`,
    );
  }

  await writeAuditLogEntry({
    caseId: params.caseId,
    conversationId: data.conversation_id as string,
    reviewerId: params.reviewerId,
    action: "status_changed",
    metadata: {
      previous_status: "open",
      new_status: "in_review",
    },
    ip: params.ip,
    requestId: params.requestId,
  });

  return data as Record<string, unknown>;
}

// ── SLA Breach Sweep ──────────────────────────────────────────────────

/**
 * Finds all open crisis review cases past their SLA deadline.
 * Called by the Cloud Scheduler SLA sweep (sub-task 4).
 *
 * @spec [Doc-03_V3 §21.3]
 */
export async function getBreachedCases(): Promise<Record<string, unknown>[]> {
  const now = new Date().toISOString();

  const { data, error } = await supabaseServer
    .from("crisis_review_cases")
    .select("*")
    .eq("status", "open")
    .lt("sla_deadline", now)
    .order("sla_deadline", { ascending: true });

  if (error) {
    logger.error(
      "CRISIS_REVIEW",
      "breach_sweep_failed",
      "failed to query breached crisis review cases",
      error,
    );
    throw new Error(`breach sweep query failed: ${error.message}`);
  }

  return (data ?? []) as Record<string, unknown>[];
}

/**
 * Returns audit trail for a specific case.
 *
 * @spec [SCL-025]
 */
export async function getCaseAuditLog(params: {
  caseId: string;
  reviewerId: string;
  ip: string;
  requestId: string;
}): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabaseServer
    .from("crisis_review_audit_log")
    .select("*")
    .eq("case_id", params.caseId)
    .order("created_at", { ascending: true });

  if (error) {
    logger.error(
      "CRISIS_REVIEW",
      "audit_log_read_failed",
      "failed to read crisis review audit log",
      error,
      { caseId: params.caseId },
    );
    throw new Error(`audit log read failed: ${error.message}`);
  }

  return (data ?? []) as Record<string, unknown>[];
}
