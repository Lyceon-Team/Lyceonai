/**
 * @spec [Doc-03_V3 §21.2 step 5, Doc-03C_V3 §8]
 * @implemented 2026-08-13
 *
 * plain English: Cloud Tasks notification for crisis events. When a crisis
 * is detected, enqueues a task to the LISA crisis notification queue so
 * ops is alerted per Doc 03 §21.2 step 5 ("Ops team is notified via
 * monitoring alert"). Uses Cloud Tasks REST API directly per the
 * managed-service-first rule (no hand-rolled queue).
 *
 * expected outcome:
 *   - notifyCrisisEvent: enqueues a Cloud Tasks task with a Slack-compatible
 *     payload. The task target is a Slack incoming webhook (LYCEON_CRISIS_ALERTS).
 *   - Payload is METADATA ONLY: case ID, conversation ID, source, SLA deadline,
 *     and admin review link. No conversation content, no student name, no message
 *     text. SCL-025(c) and ADR-001 §3 forbid conversation content leaving Supabase.
 *   - Fire-and-forget: the notification is NOT blocking. The crisis flag write
 *     (flagConversationForReview) is the blocking gate. Notification failure is
 *     logged but does not fail the turn.
 *
 * trade-offs:
 *   - Uses fetch() against Cloud Tasks REST API rather than @google-cloud/tasks
 *     SDK to avoid adding a dependency (pnpm dependency changes require approval).
 *   - Requires GCP Application Default Credentials (ADC) at runtime, obtained
 *     via the metadata server on Cloud Run.
 *   - The target is a Slack incoming webhook configured via LYCEON_CRISIS_ALERTS
 *     env var. If not set, notification is skipped with a warning.
 *   - The Express server (LISA tutor runtime) enqueues the task. Karl grants
 *     roles/cloudtasks.enqueuer to that service identity.
 *
 * edge cases:
 *   - No GCP credentials, or the token mint fails: log ERROR with the reason,
 *     skip. Never throws (the mint used to throw into the turn's catch-all).
 *   - Cloud Tasks API failure: log error, do not throw.
 *   - LYCEON_CRISIS_ALERTS unset: log ERROR, skip.
 *   - Queue region is CLOUD_TASKS_LOCATION (Terraform `var.region`), never
 *     VERTEX_LOCATION.
 *
 * IAM requirements (report only — Karl provisions):
 *   - Service account: Express server identity needs `roles/cloudtasks.enqueuer`
 *     on the crisis queue.
 *   - Queue: `lisa-crisis-notification` in the project's Cloud Tasks.
 *   - Target: LYCEON_CRISIS_ALERTS must be a Slack incoming webhook URL.
 */
import { logger } from "../logger";
import {
  cloudTasksApiUrl,
  resolveCloudTasksAccess,
} from "./cloud-tasks-enqueue";
import type { CrisisSource } from "../../packages/shared/src/crisis-flag-schema";

// ── Types ─────────────────────────────────────────────────────────────

type CrisisNotificationPayload = {
  caseId: string;
  conversationId: string;
  // The shared enum, not a hand-written copy: a copy here is how a new
  // database source value reaches the alert with no label.
  source: CrisisSource;
  slaDeadline: string;
  timestamp: string;
};

export type { CrisisNotificationPayload };

// ── Config ────────────────────────────────────────────────────────────

const CLOUD_TASKS_QUEUE_NAME =
  process.env.CRISIS_CLOUD_TASKS_QUEUE ?? "lisa-crisis-notification";

// ── Source Labels ─────────────────────────────────────────────────────

const SOURCE_LABELS: Readonly<
  Record<CrisisNotificationPayload["source"], string>
> = {
  signature: "Signature match (Layer 1)",
  model: "Model classification (Layer 2)",
  both: "Signature + Model (both layers)",
  classifier_degraded: "Classifier degraded — force review",
  classifier_degraded_no_floor:
    "Classifier degraded, no crisis signatures — fail closed",
  infrastructure_failure: "Infrastructure failure — fail closed",
  model_armor_dangerous:
    "Model Armor blocked input (dangerous) — not a clinical signal; review",
};

// ── Slack Payload Builder ─────────────────────────────────────────────

/**
 * Builds a Slack-compatible JSON payload from crisis metadata.
 * Metadata only — no conversation content, no student name, no message text.
 * The reviewer clicks through to the audited in-product admin surface.
 *
 * @spec [SCL-025(c), ADR-001 §3]
 */
function buildSlackPayload(payload: CrisisNotificationPayload): string {
  const siteUrl = (process.env.PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  const reviewUrl = `${siteUrl}/admin/crisis-review/${payload.caseId}`;

  const reason = SOURCE_LABELS[payload.source];

  const slaDate = new Date(payload.slaDeadline);
  const slaFormatted =
    slaDate.toISOString().replace("T", " ").slice(0, 19) + " UTC";

  const linkLine = siteUrl
    ? `<${reviewUrl}|Review this case →>`
    : `(PUBLIC_SITE_URL not configured — no review link)`;

  // @spec [SCL-025(c); closure plan W2-6] | @implemented [2026-09-24]
  // The case id is printed in full, as the SLA breach alert already does: it
  // is the key an operator looks up in the admin surface and the database.
  // Before this it appeared only inside the review link's URL, while the
  // visible id was the conversation's — the wrong row to look up. Both are
  // opaque UUIDs (metadata, not PII); the conversation id stays for context.
  const slackBody = {
    text: [
      `🚨 *Crisis Review Case*`,
      ``,
      `*Case:* \`${payload.caseId}\``,
      `*Reason:* ${reason}`,
      `*SLA Deadline:* ${slaFormatted}`,
      `*Conversation:* \`${payload.conversationId}\``,
      ``,
      linkLine,
    ].join("\n"),
  };

  return JSON.stringify(slackBody);
}

// ── Cloud Tasks Enqueue ───────────────────────────────────────────────

/**
 * Enqueues a crisis notification task via Cloud Tasks REST API.
 * The task body is a Slack-compatible JSON payload (metadata only).
 *
 * Fire-and-forget: logs errors but never throws. The crisis flag write
 * (in tutor-crisis.ts) is the blocking safety gate. This notification
 * is a supplementary ops alert — its failure does not jeopardize the
 * safety review queue.
 *
 * @spec [Doc-03_V3 §21.2 step 5, Doc-03C_V3 §8]
 */
export async function notifyCrisisEvent(
  payload: CrisisNotificationPayload,
): Promise<void> {
  logger.info(
    "CRISIS_NOTIFICATION",
    "dispatch_entered",
    "crisis notification dispatch entered",
    { caseId: payload.caseId, source: payload.source },
  );
  await enqueueSlackAlert(buildSlackPayload(payload), {
    caseId: payload.caseId,
  });
}

// ── SLA breach alert (W2-2a) ──────────────────────────────────────────

/** Metadata-only view of a breached case — no conversation content. */
export type BreachedCaseSummary = {
  caseId: string;
  status: "open" | "in_review";
  slaDeadline: string;
};

/** Cases listed individually in one breach message; the rest are counted. */
const BREACH_ALERT_MAX_LISTED = 20;

function buildSlaBreachSlackPayload(
  cases: readonly BreachedCaseSummary[],
  now: Date,
): string {
  const siteUrl = (process.env.PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  const lines = cases.slice(0, BREACH_ALERT_MAX_LISTED).map((c) => {
    const overdueHours = Math.max(
      0,
      Math.floor(
        (now.getTime() - new Date(c.slaDeadline).getTime()) / 3_600_000,
      ),
    );
    const state =
      c.status === "in_review" ? "claimed, unresolved" : "unclaimed";
    const ref = siteUrl
      ? `<${siteUrl}/admin/crisis-review/${c.caseId}|${c.caseId}>`
      : `\`${c.caseId}\``;
    return `• ${ref} — ${state}, ${overdueHours}h past SLA`;
  });
  const extra = cases.length - BREACH_ALERT_MAX_LISTED;
  if (extra > 0) lines.push(`• …and ${extra} more`);

  return JSON.stringify({
    text: [
      `⏰ *Crisis review SLA breached — ${cases.length} case(s)*`,
      ``,
      ...lines,
    ].join("\n"),
  });
}

/**
 * @spec [Doc-03_V3 §21.3; closure plan W2-2a] | @implemented [2026-09-24]
 *
 * plain English: posts ONE Slack message per sweep naming every breached
 * case, through the same Cloud Tasks → LYCEON_CRISIS_ALERTS path a new case
 * uses. Before this the sweep logged `sla_breach_detected` at ERROR and
 * stopped, so escalation ended in a log line.
 *
 * Policy (owner view, 2026-09-24): a breach notifies on every sweep while it
 * stands, claimed or not — a claimed-but-unresolved case past its deadline is
 * exactly what a breach means. The turn-path throttle
 * (evaluateNotificationPolicy) is NOT applied: it suppresses repeat SIGNALS
 * within two minutes, and an hourly sweep is not a signal.
 *
 * Metadata only: case id, claimed/unclaimed, hours overdue, admin link. Never
 * throws; every skip logs ERROR (see enqueueSlackAlert).
 */
export async function notifySlaBreaches(
  cases: readonly BreachedCaseSummary[],
  now: Date = new Date(),
): Promise<void> {
  if (cases.length === 0) return;
  await enqueueSlackAlert(buildSlaBreachSlackPayload(cases, now), {
    alert: "sla_breach",
    caseIds: cases.map((c) => c.caseId),
  });
}

// ── The one enqueue path ──────────────────────────────────────────────

/**
 * Enqueues a Slack message to LYCEON_CRISIS_ALERTS via Cloud Tasks. Shared by
 * the new-case alert and the SLA breach alert so there is one delivery path.
 * `context` is metadata only (case ids); it is attached to every log line.
 */
async function enqueueSlackAlert(
  slackPayload: string,
  context: Record<string, unknown>,
): Promise<void> {
  // @spec [Doc-03_V3 §21.2 step 5; CC Brief "Close the LISA Vertical" PR 2.1]
  // Every skip below is ERROR, not WARN: a crisis alert that is not sent is an
  // operator-facing failure, and only error-level entries reach the error
  // monitor (server/logger.ts). These guards used to log at WARN, which is why
  // the queue could receive zero tasks without anyone being told.
  const targetUrl = process.env.LYCEON_CRISIS_ALERTS;
  if (!targetUrl) {
    logger.error(
      "CRISIS_NOTIFICATION",
      "missing_target_url",
      "LYCEON_CRISIS_ALERTS not set; crisis notification NOT sent",
      undefined,
      context,
    );
    return;
  }

  const access = await resolveCloudTasksAccess();
  if (!access.ok) {
    logger.error(
      "CRISIS_NOTIFICATION",
      "gcp_access_unavailable",
      "GCP credentials or access token unavailable; crisis notification NOT sent",
      { reason: access.reason, detail: access.detail },
      context,
    );
    return;
  }

  const apiUrl = cloudTasksApiUrl(access.projectId, CLOUD_TASKS_QUEUE_NAME);

  const taskBody = {
    task: {
      httpRequest: {
        httpMethod: "POST",
        url: targetUrl,
        headers: {
          "Content-Type": "application/json",
        },
        body: Buffer.from(slackPayload).toString("base64"),
      },
    },
  };

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(taskBody),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown");
      logger.error(
        "CRISIS_NOTIFICATION",
        "enqueue_failed",
        "Cloud Tasks enqueue failed; ops notification may be delayed",
        { statusCode: response.status, errorText },
        context,
      );
      return;
    }

    logger.info(
      "CRISIS_NOTIFICATION",
      "enqueued",
      "crisis notification task enqueued to Cloud Tasks",
      { ...context, queue: CLOUD_TASKS_QUEUE_NAME },
    );
  } catch (err: unknown) {
    logger.error(
      "CRISIS_NOTIFICATION",
      "enqueue_error",
      "failed to enqueue crisis notification task",
      err instanceof Error ? err : undefined,
      context,
    );
    // Fire-and-forget: do not throw
  }
}
