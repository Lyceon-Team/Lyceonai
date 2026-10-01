/**
 * The score-report surface's domain layer: what the student is being asked, what they answered,
 * and what that does to the subscription.
 *
 * @spec [Doc-01_V8 §36.4 (the payer decides), §928 (the Customer Portal is the self-service
 *        path), §955 (canceled at period end);
 *        Doc-05F_V1.0 §7.1 (`target_exam_date`, written by the calendar's own writer);
 *        contracts/notifications.contract.md §8.1;
 *        lyceon-coding-standards §8.1 (thin handlers — the workflow is here, not in the route);
 *        SCL-191; owner rulings 2026-09-30 #4 (last write wins), #6 (Stripe, never our column)]
 * | @implemented [2026-09-30]
 *
 * plain English: reads the prompt the student was sent, stores the score they report, and records
 * the retake answer — setting `cancel_at_period_end` on Stripe when, and only when, the person
 * answering is the person being charged.
 *
 * THE PROMPT IS THE AUTHORISATION. There is no entitlement key on this surface and that is
 * deliberate: it is not a paid feature, it is a question we asked. A student with no
 * `notification_events` row of either post-exam type has nothing to answer and gets a 404, which
 * is server-authoritative in the strictest sense — the caller cannot name an occasion we did not
 * raise. It also means a student whose entitlement lapsed between the prompt and the answer can
 * still answer, which is the only humane behaviour: refusing to let somebody tell us they have
 * stopped studying would be perverse.
 *
 * THE GUARDIAN HAS NO WRITE ROUTE HERE, and that is the answer to edge case 4's second half.
 * Doc 01 §928 already gives a paying guardian the Customer Portal, which is the self-service
 * cancellation path this product has chosen; adding a second one over a student's occasion would
 * fork it. So a guardian is TOLD (the `renewal_decision_requested` email) and acts in the portal
 * they already have, and if they do nothing the no-answer sweep protects them anyway. The
 * student's own answer still counts for what it is evidence of: "retaking" is a fact about
 * studying and it blocks the cancellation whoever says it, while "not retaking" from somebody
 * else's payer cannot spend their money — it is recorded with `action: 'none'` and the guardian's
 * silence decides.
 */
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { logger } from "../../logger";
import { classifyError } from "../../lib/redact";
import { err, ok, type Result } from "../../../packages/shared/src/result";
import {
  examScoreReportSubmitSchema,
  renewalDecisionSubmitSchema,
  type ExamRenewalAnchor,
  type ProjectionPairing,
  type RenewalAction,
  type RenewalDeciderRole,
  type RenewalPromptView,
} from "../../../packages/shared/src/exam-score-renewal-schema";
import { setCancelAtPeriodEnd } from "../../lib/stripe/renewal-cancellation";
import { notificationEventId } from "../../lib/notifications/event-id";
import { upsertStudyProfile } from "../calendar/profile-service";

export type ScoreRenewalFailure =
  | { kind: "no_prompt" }
  | { kind: "invalid"; details: unknown }
  | { kind: "occasion_mismatch" }
  | { kind: "stripe_failed" }
  | { kind: "read_failed" }
  | { kind: "write_failed" };

/** The occasion the student was asked about, with who they are relative to the money. */
type Occasion = {
  readonly anchor: ExamRenewalAnchor;
  readonly occasionKey: string;
  readonly promptedAt: string;
  readonly viewerRole: RenewalDeciderRole;
  readonly stripeSubscriptionId: string | null;
};

function isAnchor(value: unknown): value is ExamRenewalAnchor {
  return value === "exam_date" || value === "billing_cycle";
}

/**
 * The most recent post-exam prompt raised for this student, or `no_prompt`.
 *
 * WHY THE EVENT ROW IS THE SOURCE and not a recomputation of the candidate predicate. The
 * predicate answers "who should be asked today"; this answers "what was this student asked",
 * which is a different question with a different answer the moment the config changes or the
 * student edits their profile. The event row is the durable record of the asking, and reading it
 * back is what makes the surface agree with the email.
 */
async function readOccasion(
  studentId: string,
  requestId?: string,
): Promise<Result<Occasion, ScoreRenewalFailure>> {
  const { data, error } = await supabaseServer
    .from("notification_events")
    .select("event_type, payload, created_at")
    .eq("subject_profile_id", studentId)
    .in("event_type", [
      "exam_score_report_requested",
      "renewal_decision_requested",
    ])
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    logger.error(
      "BILLING",
      "score_report_prompt_read_failed",
      "the post-exam prompt could not be read",
      { ...classifyError(error), requestId },
    );
    return err({ kind: "read_failed" });
  }

  const row = Array.isArray(data) ? data[0] : undefined;
  if (row === undefined) return err({ kind: "no_prompt" });

  const payload: unknown = row.payload;
  const anchor =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>).anchor
      : undefined;
  const occasionKey =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>).occasion_key
      : undefined;

  if (!isAnchor(anchor) || typeof occasionKey !== "string") {
    // A payload that does not match its own schema is a contract break, not a user error.
    logger.error(
      "BILLING",
      "score_report_prompt_malformed",
      "a post-exam notification payload did not carry an anchor and an occasion",
      { requestId },
    );
    return err({ kind: "read_failed" });
  }

  const entitlement = await supabaseServer
    .from("entitlements")
    .select("payer_profile_id, stripe_subscription_id")
    .eq("profile_id", studentId)
    .maybeSingle();

  if (entitlement.error) {
    logger.error(
      "BILLING",
      "score_report_entitlement_read_failed",
      "the entitlement behind a post-exam prompt could not be read",
      { ...classifyError(entitlement.error), requestId },
    );
    return err({ kind: "read_failed" });
  }

  const payerProfileId = entitlement.data?.payer_profile_id ?? null;
  // NULL means self-paid — including every row written before `payer_profile_id` existed. See the
  // column's own comment for why that direction is the safe one.
  const viewerRole: RenewalDeciderRole =
    payerProfileId === null || payerProfileId === studentId
      ? "payer"
      : "student";

  return ok({
    anchor,
    occasionKey,
    promptedAt: String(row.created_at),
    viewerRole,
    stripeSubscriptionId: entitlement.data?.stripe_subscription_id ?? null,
  });
}

function pairingOf(row: Record<string, unknown>): ProjectionPairing {
  return {
    section: row.section === "M" ? "M" : "RW",
    projection_status:
      row.projection_status === "snapshot"
        ? "snapshot"
        : row.projection_status === "gated"
          ? "gated"
          : "none",
    snapshot_id: typeof row.snapshot_id === "number" ? row.snapshot_id : null,
    snapshot_at: row.snapshot_at == null ? null : String(row.snapshot_at),
    projected_score_mid:
      typeof row.projected_score_mid === "number"
        ? row.projected_score_mid
        : null,
    projected_score_low:
      typeof row.projected_score_low === "number"
        ? row.projected_score_low
        : null,
    projected_score_high:
      typeof row.projected_score_high === "number"
        ? row.projected_score_high
        : null,
  };
}

/**
 * The surface's read: what we asked, what has been answered, and the score already reported.
 *
 * LAST WRITE WINS ON THE READ TOO (owner ruling 2026-09-30 #4). Both tables are append-only and
 * both are ordered newest-first with `limit(1)`, so a student who corrected a typo sees their
 * correction and a student who changed their mind sees their current answer. The earlier versions
 * are still there; nothing on this surface shows them, because a form that shows you two
 * contradictory past answers is a form nobody can use.
 */
export async function readScoreReportSurface(
  studentId: string,
  requestId?: string,
): Promise<Result<RenewalPromptView, ScoreRenewalFailure>> {
  const occasion = await readOccasion(studentId, requestId);
  if (!occasion.ok) return err(occasion.error);

  const decision = await supabaseServer
    .from("exam_renewal_decisions")
    .select("decision")
    .eq("student_id", studentId)
    .eq("occasion_key", occasion.value.occasionKey)
    .order("decided_at", { ascending: false })
    .limit(1);

  const report = await supabaseServer
    .from("exam_score_reports")
    .select(
      "report_id, occasion_key, total_score, rw_score, math_score, reported_at",
    )
    .eq("student_id", studentId)
    .eq("occasion_key", occasion.value.occasionKey)
    .order("reported_at", { ascending: false })
    .limit(1);

  if (decision.error || report.error) {
    logger.error(
      "BILLING",
      "score_report_surface_read_failed",
      "the score report surface could not be assembled",
      {
        ...classifyError(decision.error ?? report.error),
        requestId,
      },
    );
    return err({ kind: "read_failed" });
  }

  const decisionRow = Array.isArray(decision.data)
    ? decision.data[0]
    : undefined;
  const reportRow = Array.isArray(report.data) ? report.data[0] : undefined;

  let projections: ProjectionPairing[] = [];
  if (reportRow !== undefined) {
    const paired = await supabaseServer
      .from("exam_score_report_projections")
      .select(
        "section, projection_status, snapshot_id, snapshot_at, projected_score_mid, projected_score_low, projected_score_high",
      )
      .eq("report_id", reportRow.report_id);
    if (paired.error) {
      logger.error(
        "BILLING",
        "score_report_pairing_read_failed",
        "the projection pairing behind a reported score could not be read",
        { ...classifyError(paired.error), requestId },
      );
      return err({ kind: "read_failed" });
    }
    projections = (Array.isArray(paired.data) ? paired.data : []).map((row) =>
      pairingOf(row as Record<string, unknown>),
    );
  }

  return ok({
    anchor: occasion.value.anchor,
    occasion_key: occasion.value.occasionKey,
    prompted_at: occasion.value.promptedAt,
    viewer_role: occasion.value.viewerRole,
    decision:
      decisionRow?.decision === "retaking"
        ? "retaking"
        : decisionRow?.decision === "not_retaking"
          ? "not_retaking"
          : null,
    report:
      reportRow === undefined
        ? null
        : {
            report_id: String(reportRow.report_id),
            occasion_key: String(reportRow.occasion_key),
            total_score: Number(reportRow.total_score),
            rw_score: Number(reportRow.rw_score),
            math_score: Number(reportRow.math_score),
            reported_at: String(reportRow.reported_at),
            projections,
          },
  });
}

/**
 * Store a reported score and its projection pairing.
 *
 * THE OCCASION MUST MATCH THE ONE WE ASKED ABOUT. A body naming any other date is refused rather
 * than stored: the pairing is resolved against the occasion, so accepting an arbitrary date would
 * let a caller choose which projection their score is compared with — which is the one thing a
 * validation dataset must not allow.
 *
 * THE SCORE PROMPT ONLY EXISTS ON THE EXAM ANCHOR, so a student whose prompt is a billing-cycle
 * reminder has no sitting to report and is refused. Owner ruling 2026-09-30 #1: "no score prompt"
 * on that path.
 */
export async function submitScoreReport(
  studentId: string,
  body: unknown,
  requestId?: string,
): Promise<Result<{ reportId: string }, ScoreRenewalFailure>> {
  const parsed = examScoreReportSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return err({ kind: "invalid", details: parsed.error.flatten() });
  }

  const occasion = await readOccasion(studentId, requestId);
  if (!occasion.ok) return err(occasion.error);
  if (
    occasion.value.anchor !== "exam_date" ||
    occasion.value.occasionKey !== parsed.data.occasion_key
  ) {
    return err({ kind: "occasion_mismatch" });
  }

  const { data, error } = await supabaseServer.rpc("record_exam_score_report", {
    p_student_id: studentId,
    p_occasion_key: parsed.data.occasion_key,
    p_total_score: parsed.data.total_score,
    p_rw_score: parsed.data.rw_score,
    p_math_score: parsed.data.math_score,
  });

  if (error || typeof data !== "string") {
    logger.error(
      "BILLING",
      "score_report_write_failed",
      "a reported score could not be stored",
      { ...classifyError(error), requestId },
    );
    return err({ kind: "write_failed" });
  }

  // Counts and ids only. A reported SAT score is the student's own result and does not belong in
  // a log line (standards §12.1).
  logger.info(
    "BILLING",
    "score_report_recorded",
    "a student reported their SAT scores",
    { requestId, anchor: occasion.value.anchor },
  );
  return ok({ reportId: data });
}

/**
 * Record the retake answer and, when the answerer is the payer, act on it.
 *
 * THE ORDER IS STRIPE FIRST, THEN THE ROW, and it is the only safe order. A decision row saying
 * `cancel_at_period_end` that Stripe was never told is a promise we cannot keep and one that
 * reads exactly like a kept one; a Stripe flag with no decision row is a subscription in the
 * state the student asked for, missing only a note about who asked. The webhook mirrors the flag
 * onto `entitlements.cancel_at_period_end` either way (owner ruling 2026-09-30 #6) — this
 * function never writes that column.
 *
 * A NEW EXAM DATE GOES THROUGH THE CALENDAR'S OWN WRITER. `upsertStudyProfile` is the single
 * writer of `student_study_profile`, and it validates the date against the student's local today
 * and the calendar's configured bounds. Writing the column from here would be a second writer of
 * one column and would skip those bounds — and it is also what regenerates the plan, which is
 * what a student retaking actually needs.
 */
export async function submitRenewalDecision(
  studentId: string,
  body: unknown,
  requestId?: string,
): Promise<
  Result<
    { decision: "retaking" | "not_retaking"; action: RenewalAction },
    ScoreRenewalFailure
  >
> {
  const parsed = renewalDecisionSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return err({ kind: "invalid", details: parsed.error.flatten() });
  }

  const occasion = await readOccasion(studentId, requestId);
  if (!occasion.ok) return err(occasion.error);
  if (occasion.value.occasionKey !== parsed.data.occasion_key) {
    return err({ kind: "occasion_mismatch" });
  }

  // "YES → NEW `target_exam_date`" (§5 of the brief), and only on the exam anchor. A `retaking`
  // answer is what keeps a subscription alive, so it has to be an observed fact rather than an
  // assertion: "I'm taking it again" with no date is indistinguishable from "I haven't decided",
  // and the difference between those two is a charge. The billing-cycle anchor has no sitting to
  // name, so it requires nothing — there the answer means "still preparing".
  if (
    occasion.value.anchor === "exam_date" &&
    parsed.data.decision === "retaking" &&
    parsed.data.new_target_exam_date === undefined
  ) {
    return err({
      kind: "invalid",
      details: {
        fieldErrors: {
          new_target_exam_date: [
            "Tell us when you're sitting it, so your plan can be rebuilt around the new date.",
          ],
        },
      },
    });
  }

  let action: RenewalAction = "none";

  if (occasion.value.viewerRole === "payer") {
    const wantCancel = parsed.data.decision === "not_retaking";
    if (occasion.value.stripeSubscriptionId === null) {
      // An entitlement with no subscription behind it (a comp, a manual grant). There is nothing
      // to cancel; the answer is still worth recording, with `action: 'none'` saying so.
      logger.warn(
        "BILLING",
        "renewal_decision_no_subscription",
        "a renewal decision was made on an entitlement with no Stripe subscription",
        { requestId },
      );
    } else if (wantCancel) {
      const applied = await setCancelAtPeriodEnd(
        occasion.value.stripeSubscriptionId,
        true,
        requestId === undefined ? {} : { requestId },
      );
      if (applied.kind === "failed") return err({ kind: "stripe_failed" });
      action = "cancel_at_period_end";
    } else {
      // Edge case 5 applied to the decision: a student who said "not retaking" and changed their
      // mind must be able to undo it, and the undo has to reach Stripe or the subscription still
      // ends. `setCancelAtPeriodEnd` reads first, so this is a no-op when nothing was set.
      const cleared = await setCancelAtPeriodEnd(
        occasion.value.stripeSubscriptionId,
        false,
        requestId === undefined ? {} : { requestId },
      );
      if (cleared.kind === "failed") return err({ kind: "stripe_failed" });
      action = cleared.kind === "applied" ? "cancel_cleared" : "none";
    }
  }

  if (parsed.data.new_target_exam_date !== undefined) {
    const written = await upsertStudyProfile(
      studentId,
      {
        target_exam_date: parsed.data.new_target_exam_date,
        // §4.2: the calendar's own writer requires an `idempotency_key` and requires it to be a
        // uuid. DERIVED, never random, so a retried request writes the same profile update once —
        // a random key here would make the retry a second mutation, which is the thing the field
        // exists to prevent.
        //
        // `notificationEventId` is this repo's ONE sha256→uuid-v5 derivation and is consumed here
        // rather than forked; its first argument is a namespace, and a namespace of
        // `renewal_decision_exam_date` cannot collide with any notification event type. Writing a
        // second uuid-v5 helper for this one call site is the duplication CLAUDE.md forbids by
        // name, and the alternative — `crypto.randomUUID()` — would be a correctness bug rather
        // than a style one.
        idempotency_key: notificationEventId(
          "renewal_decision_exam_date",
          `${studentId}:${parsed.data.occasion_key}:${parsed.data.new_target_exam_date}`,
        ),
      },
      requestId,
    );
    if (!written.ok) {
      // The date is the student's, and a rejected date must not silently become a recorded
      // decision with no date behind it. Refused as the validation error it is.
      return err({ kind: "invalid", details: written.error });
    }
  }

  const { error } = await supabaseServer.from("exam_renewal_decisions").insert({
    student_id: studentId,
    occasion_key: parsed.data.occasion_key,
    anchor: occasion.value.anchor,
    decided_by_profile_id: studentId,
    decider_role: occasion.value.viewerRole,
    decision: parsed.data.decision,
    action,
  });

  if (error) {
    logger.error(
      "BILLING",
      "renewal_decision_write_failed",
      "a renewal decision could not be recorded; the subscription state is whatever Stripe holds",
      { ...classifyError(error), requestId, action },
    );
    return err({ kind: "write_failed" });
  }

  logger.info(
    "BILLING",
    "renewal_decision_recorded",
    "a renewal decision was recorded",
    {
      requestId,
      anchor: occasion.value.anchor,
      decision: parsed.data.decision,
      action,
      deciderRole: occasion.value.viewerRole,
    },
  );
  return ok({ decision: parsed.data.decision, action });
}
