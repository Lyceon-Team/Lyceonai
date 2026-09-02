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

type CrisisSource =
  | "signature"
  | "model"
  | "both"
  | "classifier_degraded"
  | "classifier_degraded_no_floor"
  | "infrastructure_failure";

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
  caseId: string | null;
  conversationId: string | null;
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

// ── Schema-drift tolerance ────────────────────────────────────────────

/**
 * Source values that were added after the initial CHECK constraint and
 * may not be present in production if the migration hasn't been applied.
 * Each maps to the coarser value that the original schema accepts.
 *
 * @spec [WS-L8 Item 4b — narrow crisis-path tolerance]
 */
const SOURCE_FALLBACK: Partial<Record<CrisisSource, CrisisSource>> = {
  classifier_degraded_no_floor: "classifier_degraded",
  infrastructure_failure: "classifier_degraded",
};

/** PostgreSQL error code for check_violation (23514). */
const PG_CHECK_VIOLATION = "23514";

/** PostgreSQL error code for unique_violation (23505). */
const PG_UNIQUE_VIOLATION = "23505";

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
 * Schema-drift tolerance (WS-L8 Item 4b): if the INSERT fails with a
 * CHECK violation (PG code 23514) AND the source value is one of the
 * newer values that may not be in production's CHECK constraint yet,
 * the function retries once with a coarser source value that the old
 * schema accepts. The case still persists — only its precision degrades.
 * This does NOT reverse B1.1d's blocking-write ruling: a real failure
 * (FK violation, connection error, anything other than an identifiable
 * schema-version CHECK mismatch) still blocks the turn.
 *
 * @spec [Doc-03_V3 §21.3, CR-03C-V3-01 §3.4, WS-L8 Item 4b]
 */
export async function createCrisisReviewCase(
  params: CreateCaseParams,
): Promise<{ id: string; slaDeadline: string }> {
  const slaDeadline = new Date(
    Date.now() + SLA_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const insertPayload = {
    conversation_id: params.conversationId,
    student_id: params.studentId,
    source: params.source,
    signature_id: params.signatureId,
    model_confidence: params.modelConfidence,
    sla_deadline: slaDeadline,
  };

  const { data, error } = await supabaseServer
    .from("crisis_review_cases")
    .insert(insertPayload)
    .select("id")
    .single();

  // ── Schema-drift retry (WS-L8 Item 4b) ──────────────────────────
  // Narrow: only when (1) the error is a CHECK violation, (2) the source
  // has a known fallback, and (3) the retry with the coarser value
  // succeeds. All other errors propagate immediately.
  if (error && error.code === PG_CHECK_VIOLATION) {
    const fallbackSource = SOURCE_FALLBACK[params.source];
    if (fallbackSource) {
      logger.warn(
        "CRISIS_REVIEW",
        "case_create_schema_drift",
        "CHECK violation on crisis_review_cases.source — production schema " +
          "may not include the newer value. Retrying with coarser source. " +
          "Apply the pending migration to restore full precision.",
        {
          conversationId: params.conversationId,
          originalSource: params.source,
          fallbackSource,
          pgCode: error.code,
        },
      );

      const { data: retryData, error: retryError } = await supabaseServer
        .from("crisis_review_cases")
        .insert({ ...insertPayload, source: fallbackSource })
        .select("id")
        .single();

      if (retryError || !retryData) {
        // Retry also failed — this is a real failure, not schema drift.
        logger.error(
          "CRISIS_REVIEW",
          "case_create_failed",
          "failed to create crisis review case even with fallback source — " +
            "crisis turn may not be reviewed",
          retryError,
          {
            conversationId: params.conversationId,
            source: fallbackSource,
          },
        );
        throw new Error(
          `crisis review case creation failed (with fallback): ${retryError?.message ?? "no data returned"}`,
        );
      }

      logger.warn(
        "CRISIS_REVIEW",
        "case_created_degraded",
        "crisis review case created with degraded source precision " +
          "(schema drift — apply pending migration)",
        {
          caseId: retryData.id,
          conversationId: params.conversationId,
          originalSource: params.source,
          persistedSource: fallbackSource,
          slaDeadline,
        },
      );

      return { id: retryData.id as string, slaDeadline };
    }
  }

  // ── Duplicate crisis case (Defect 2 — WS-T1) ─────────────────────
  // idx_crisis_review_cases_conversation_active allows one active case per
  // conversation. A second crisis turn on the same conversation hits 23505.
  // That is a redundant write, not a failed write: the case already exists
  // and will be reviewed. Return the existing case ID so the caller can
  // proceed (B1.1d: case already durable → safety obligation met).
  if (
    error &&
    error.code === PG_UNIQUE_VIOLATION &&
    error.message.includes("conversation_active")
  ) {
    logger.info(
      "CRISIS_REVIEW",
      "case_already_open",
      "crisis review case already open for this conversation — " +
        "redundant write treated as success (B1.1d)",
      {
        conversationId: params.conversationId,
        source: params.source,
        pgCode: error.code,
      },
    );

    // Fetch the existing active case to return its ID.
    const { data: existing } = await supabaseServer
      .from("crisis_review_cases")
      .select("id, sla_deadline")
      .eq("conversation_id", params.conversationId)
      .is("resolved_at", null)
      .single();

    if (existing) {
      return {
        id: existing.id as string,
        slaDeadline: existing.sla_deadline as string,
      };
    }

    // Race: case was resolved between the INSERT and the SELECT.
    // Extremely unlikely, but we still need a case. Fall through to the
    // generic error handler, which will throw and block the turn — correct
    // per B1.1d (better to fail loudly than to lose a case silently).
  }

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

  return { id: data.id as string, slaDeadline };
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
      case_id: params.caseId ?? undefined,
      conversation_id: params.conversationId ?? undefined,
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
 * Every call writes a durable audit log entry per SCL-025.
 *
 * @spec [Doc-03_V3 §21.3, SCL-025]
 * @implemented 2026-08-14
 *
 * plain English: paginated list of crisis review cases for the admin surface.
 * SCL-025 mandates every read is logged append-only with reviewer identity,
 * timestamp, and action. The audit write is BLOCKING — if it fails, the read
 * fails (audit-before-data per SCL-025 §c). A logger.adminAction call is NOT
 * a durable audit row and does not satisfy SCL-025.
 *
 * trade-offs: the list endpoint does not have a single case_id/conversation_id
 * to log against. We log a "list_viewed" action with the query parameters
 * and result count in metadata, with case_id and conversation_id set to NULL.
 * Requires 20260814000000_crisis_audit_log_nullable_case_id.sql migration.
 *
 * edge cases: if no cases match the filter, the audit log still records the
 * read attempt (result_count: 0).
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

  const cases = (data ?? []) as Record<string, unknown>[];
  const total = count ?? 0;

  // SCL-025: every read logged append-only — durable audit row, not just logger.
  // case_id and conversation_id are null for aggregate operations (list has no
  // single case). Requires 20260814000000_crisis_audit_log_nullable_case_id.sql.
  await writeAuditLogEntry({
    caseId: null,
    conversationId: null,
    reviewerId: params.reviewerId,
    action: "viewed",
    metadata: {
      surface: "list_cases",
      filter_status: params.status ?? "all",
      limit: params.limit,
      offset: params.offset,
      result_count: cases.length,
      total,
    },
    ip: params.ip,
    requestId: params.requestId,
  });

  return { cases, total };
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
 * Called by the Cloud Scheduler SLA sweep (sub-task 4) and the admin
 * review surface. Writes a durable audit log entry per SCL-025.
 *
 * @spec [Doc-03_V3 §21.3, SCL-025]
 * @implemented 2026-08-14
 *
 * plain English: returns all open cases past their 48h SLA deadline,
 * ordered oldest-first. The audit write uses a sentinel case_id because
 * this is a sweep across all cases, not a single-case view.
 *
 * trade-offs: the SLA sweep may be called by Cloud Scheduler (no human
 * reviewer) or by the admin review surface (human reviewer). Audit params
 * are optional: when provided, a durable audit row is written per SCL-025.
 * When omitted (cron sweep), no audit row — the cron sweep is a system
 * operation, not an admin surface read. SCL-025's mandate applies to
 * human reviewers accessing crisis content.
 *
 * edge cases: zero breached cases still writes an audit row when called
 * from the admin surface.
 */
export async function getBreachedCases(params?: {
  reviewerId: string;
  ip: string;
  requestId: string;
}): Promise<Record<string, unknown>[]> {
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

  const cases = (data ?? []) as Record<string, unknown>[];

  // SCL-025: durable audit row when called from admin surface (params provided).
  // Cron sweep (no params) skips audit — system operation, not admin surface read.
  if (params) {
    await writeAuditLogEntry({
      caseId: null,
      conversationId: null,
      reviewerId: params.reviewerId,
      action: "viewed",
      metadata: {
        surface: "sla_breach_sweep",
        breached_count: cases.length,
        sweep_timestamp: now,
      },
      ip: params.ip,
      requestId: params.requestId,
    });
  }

  return cases;
}

/**
 * Returns audit trail for a specific case. Writes a durable audit log
 * entry for the read itself per SCL-025 (reading the audit trail is
 * itself an auditable action).
 *
 * @spec [SCL-025]
 * @implemented 2026-08-14
 *
 * plain English: fetches all audit log entries for a case, ordered
 * chronologically. The read is itself audit-logged — an admin viewing
 * the audit trail is a reviewable event per SCL-025.
 *
 * edge cases: the audit row written by this function will appear in
 * future reads of the same case's audit trail. This is intentional —
 * the trail shows who looked at it and when.
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

  // SCL-025: reading the audit trail is itself an auditable action.
  // This write appears in future reads of the same case's trail.
  // conversation_id is null here — the case_id is sufficient to identify
  // the access, and the conversation_id is derivable from the case.
  await writeAuditLogEntry({
    caseId: params.caseId,
    conversationId: null,
    reviewerId: params.reviewerId,
    action: "viewed",
    metadata: {
      surface: "audit_trail_view",
      entries_returned: (data ?? []).length,
    },
    ip: params.ip,
    requestId: params.requestId,
  });

  return (data ?? []) as Record<string, unknown>[];
}
