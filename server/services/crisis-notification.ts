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
 *   - No GCP credentials available (local dev): skip silently.
 *   - Cloud Tasks API failure: log error, do not throw.
 *   - Missing env vars: log warning on first call, skip.
 *
 * IAM requirements (report only — Karl provisions):
 *   - Service account: Express server identity needs `roles/cloudtasks.enqueuer`
 *     on the crisis queue.
 *   - Queue: `lisa-crisis-notification` in the project's Cloud Tasks.
 *   - Target: LYCEON_CRISIS_ALERTS must be a Slack incoming webhook URL.
 */
import { logger } from "../logger";
import { getGcpAccessToken, getGcpCredentials } from "../lib/gcp-credentials";

// ── Types ─────────────────────────────────────────────────────────────

type CrisisNotificationPayload = {
  caseId: string;
  conversationId: string;
  source:
    | "signature"
    | "model"
    | "both"
    | "classifier_degraded"
    | "classifier_degraded_no_floor"
    | "infrastructure_failure";
  slaDeadline: string;
  timestamp: string;
};

export type { CrisisNotificationPayload };

// ── Config ────────────────────────────────────────────────────────────

const CLOUD_TASKS_QUEUE_NAME =
  process.env.CRISIS_CLOUD_TASKS_QUEUE ?? "lisa-crisis-notification";

function resolveGcpProjectId(): string | null {
  try {
    return getGcpCredentials().project_id;
  } catch {
    return process.env.VERTEX_PROJECT_ID ?? process.env.GCP_PROJECT_ID ?? null;
  }
}

const GCP_LOCATION = process.env.VERTEX_LOCATION ?? "us-central1";

const NOTIFICATION_TARGET_URL = process.env.LYCEON_CRISIS_ALERTS;

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
  const reviewUrl = siteUrl
    ? `${siteUrl}/admin/crisis-review/${payload.caseId}`
    : `(PUBLIC_SITE_URL not configured — case ID: ${payload.caseId})`;

  const reason = SOURCE_LABELS[payload.source];

  const slaDate = new Date(payload.slaDeadline);
  const slaFormatted =
    slaDate.toISOString().replace("T", " ").slice(0, 19) + " UTC";

  const linkLine = siteUrl
    ? `<${reviewUrl}|Review this case →>`
    : `Case ID: \`${payload.caseId}\``;

  const slackBody = {
    text: [
      `🚨 *Crisis Review Case*`,
      ``,
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

  const gcpProjectId = resolveGcpProjectId();
  if (!gcpProjectId) {
    logger.warn(
      "CRISIS_NOTIFICATION",
      "missing_project_id",
      "GCP project ID not available (no credentials and no GCP_PROJECT_ID env var); crisis notification skipped",
      { caseId: payload.caseId },
    );
    return;
  }

  if (!NOTIFICATION_TARGET_URL) {
    logger.warn(
      "CRISIS_NOTIFICATION",
      "missing_target_url",
      "LYCEON_CRISIS_ALERTS not set; crisis notification skipped",
      { caseId: payload.caseId },
    );
    return;
  }

  const accessToken = await getGcpAccessToken();
  if (!accessToken) {
    logger.warn(
      "CRISIS_NOTIFICATION",
      "no_gcp_credentials",
      "GCP credentials not available; crisis notification skipped",
      { caseId: payload.caseId },
    );
    return;
  }

  const queuePath = `projects/${gcpProjectId}/locations/${GCP_LOCATION}/queues/${CLOUD_TASKS_QUEUE_NAME}`;
  const apiUrl = `https://cloudtasks.googleapis.com/v2/${queuePath}/tasks`;

  const slackPayload = buildSlackPayload(payload);

  const taskBody = {
    task: {
      httpRequest: {
        httpMethod: "POST",
        url: NOTIFICATION_TARGET_URL,
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
        Authorization: `Bearer ${accessToken}`,
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
        { caseId: payload.caseId },
      );
      return;
    }

    logger.info(
      "CRISIS_NOTIFICATION",
      "enqueued",
      "crisis notification task enqueued to Cloud Tasks",
      { caseId: payload.caseId, queue: CLOUD_TASKS_QUEUE_NAME },
    );
  } catch (err: unknown) {
    logger.error(
      "CRISIS_NOTIFICATION",
      "enqueue_error",
      "failed to enqueue crisis notification task",
      err instanceof Error ? err : undefined,
      { caseId: payload.caseId },
    );
    // Fire-and-forget: do not throw
  }
}
