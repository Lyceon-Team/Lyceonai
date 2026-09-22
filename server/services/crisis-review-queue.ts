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
import type {
  CrisisSource,
  CrisisCategory,
} from "../../packages/shared/src/crisis-flag-schema";

// ── Constants ─────────────────────────────────────────────────────────
// `SLA_HOURS` was here. It is `public.crisis_review_sla_hours()` now — the
// write that uses it is SQL (migration 20260922100000), and a TypeScript copy
// of a number the database applies is a second definition waiting to drift.
// `tests/ci/crisis-flag-atomic.pg.ci.test.ts` holds the SQL function to Doc 03
// §21.3's published 48.

// ── Types ─────────────────────────────────────────────────────────────
// `CrisisSource` and `CrisisCategory` are inferred from the Zod schemas in
// packages/shared and re-exported here so existing import sites keep working.
// They were hand-written unions in three files; three copies of one enum drift
// the moment the database CHECK gains a value (Coding Standards §7.2 / §17).

type CaseStatus = "open" | "in_review" | "resolved";

type CaseDisposition = "true_positive" | "false_positive";

type AuditAction =
  | "viewed"
  | "status_changed"
  | "disposition_set"
  | "note_added";

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
  CrisisCategory,
  CaseStatus,
  CaseDisposition,
  AuditAction,
  UpdateDispositionParams,
  AuditLogParams,
};

// ── Schema-drift tolerance: MOVED INTO SQL ────────────────────────────
// `SOURCE_FALLBACK` (WS-L8 Item 4b) is `public.crisis_source_fallback()`, and
// the two PG error codes it was matched against are `unique_violation` and
// `check_violation` conditions in the PL/pgSQL handler. Matching a driver's
// error code string in TypeScript was always the weaker form: it depended on
// the message text as well as the code, and the code did not survive
// createCrisisReviewCase wrapping the error in a new Error.

// ── Create Case: MOVED INTO SQL (owner ruling D1, 2026-09-22) ─────────
//
// `createCrisisReviewCase` lived here and had exactly one caller,
// `flagConversationForReview`. That caller did two writes in sequence — flag
// the conversation, then insert the case — and between them sat a state the
// system must never be in: a conversation MARKED as a crisis with NOTHING in
// the review queue. Both writes are now
// `public.flag_conversation_for_crisis_review` (migration
// 20260922100000_crisis_flag_atomic.sql), which is one transaction.
//
// The function is DELETED rather than kept, because a second write path to
// `crisis_review_cases` is how the two drift. Everything it did is in the SQL:
// the 48h deadline (`crisis_review_sla_hours()`), the WS-L8 Item 4b
// source fallback (`crisis_source_fallback()`), and the
// unique-violation-is-success-equivalent rule.
//
// ONE BUG DIED WITH IT, AND IT IS WORTH NAMING. The duplicate-case lookup
// queried `.is("resolved_at", null)`. `crisis_review_cases` has no
// `resolved_at` column — it has `reviewed_at` and `status`. That lookup could
// not succeed, so the "race: case was resolved between the INSERT and the
// SELECT" comment described the ONLY path it ever took: every duplicate fell
// through to the generic handler and threw. The SQL matches on
// `status IN ('open','in_review')`, which is what the partial unique index
// itself uses.

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
