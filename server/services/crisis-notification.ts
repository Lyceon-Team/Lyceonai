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
 *   - notifyCrisisEvent: enqueues a Cloud Tasks task with crisis metadata.
 *     The task target is a Cloud Run endpoint (or webhook) that delivers
 *     the notification to the ops channel (email, Slack, PagerDuty — TBD
 *     by ops setup).
 *   - Fire-and-forget: the notification is NOT blocking. The crisis flag
 *     write (flagConversationForReview) is the blocking gate. Notification
 *     failure is logged but does not fail the turn.
 *
 * trade-offs:
 *   - Uses fetch() against Cloud Tasks REST API rather than @google-cloud/tasks
 *     SDK to avoid adding a dependency (pnpm dependency changes require approval).
 *   - Requires GCP Application Default Credentials (ADC) at runtime, obtained
 *     via the metadata server on Cloud Run.
 *   - The target endpoint is configured via CRISIS_NOTIFICATION_TARGET_URL env var.
 *     If not set, notification is skipped with a warning.
 *
 * edge cases:
 *   - No GCP credentials available (local dev): skip silently.
 *   - Cloud Tasks API failure: log error, do not throw.
 *   - Missing env vars: log warning on first call, skip.
 *
 * IAM requirements (report only — Karl provisions):
 *   - Service account: needs `roles/cloudtasks.enqueuer` on the crisis queue.
 *   - Queue: `lisa-crisis-notification` in the project's Cloud Tasks.
 *   - Target: CRISIS_NOTIFICATION_TARGET_URL must be a Cloud Run service or
 *     HTTPS endpoint reachable from Cloud Tasks.
 */
import { logger } from "../logger";

// ── Types ─────────────────────────────────────────────────────────────

type CrisisNotificationPayload = {
  caseId: string;
  conversationId: string;
  studentId: string;
  source: "signature" | "model" | "both" | "classifier_degraded";
  signatureId: string | null;
  modelConfidence: number | null;
  timestamp: string;
};

export type { CrisisNotificationPayload };

// ── Config ────────────────────────────────────────────────────────────

const CLOUD_TASKS_QUEUE_NAME =
  process.env.CRISIS_CLOUD_TASKS_QUEUE ?? "lisa-crisis-notification";

const GCP_PROJECT_ID =
  process.env.VERTEX_PROJECT_ID ?? process.env.GCP_PROJECT_ID;

const GCP_LOCATION = process.env.VERTEX_LOCATION ?? "us-central1";

const NOTIFICATION_TARGET_URL = process.env.CRISIS_NOTIFICATION_TARGET_URL;

// ── GCP Auth Helper ───────────────────────────────────────────────────

/**
 * Gets an access token from the GCP metadata server (Cloud Run environment).
 * Returns null if not running on GCP (local dev).
 */
async function getGcpAccessToken(): Promise<string | null> {
  try {
    const response = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      {
        headers: { "Metadata-Flavor": "Google" },
        signal: AbortSignal.timeout(2000),
      },
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    // Not running on GCP — expected in local dev
    return null;
  }
}

// ── Cloud Tasks Enqueue ───────────────────────────────────────────────

/**
 * Enqueues a crisis notification task via Cloud Tasks REST API.
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
  if (!GCP_PROJECT_ID) {
    logger.warn(
      "CRISIS_NOTIFICATION",
      "missing_project_id",
      "GCP_PROJECT_ID not set; crisis notification skipped",
    );
    return;
  }

  if (!NOTIFICATION_TARGET_URL) {
    logger.warn(
      "CRISIS_NOTIFICATION",
      "missing_target_url",
      "CRISIS_NOTIFICATION_TARGET_URL not set; crisis notification skipped",
    );
    return;
  }

  const accessToken = await getGcpAccessToken();
  if (!accessToken) {
    logger.debug(
      "CRISIS_NOTIFICATION",
      "no_gcp_credentials",
      "GCP credentials not available (local dev); crisis notification skipped",
    );
    return;
  }

  const queuePath = `projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/queues/${CLOUD_TASKS_QUEUE_NAME}`;
  const apiUrl = `https://cloudtasks.googleapis.com/v2/${queuePath}/tasks`;

  const taskBody = {
    task: {
      httpRequest: {
        httpMethod: "POST",
        url: NOTIFICATION_TARGET_URL,
        headers: {
          "Content-Type": "application/json",
        },
        body: Buffer.from(JSON.stringify(payload)).toString("base64"),
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
