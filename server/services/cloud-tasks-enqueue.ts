/**
 * @spec [Doc-03C_V3 §8, CLAUDE.md managed-service-first rule]
 * @implemented 2026-08-14
 *
 * plain English: Shared Cloud Tasks enqueue utility. Wraps the Cloud Tasks
 * REST API to enqueue jobs for async LISA workers. Uses the same pattern as
 * crisis-notification.ts: fetch() against the REST API with GCP Application
 * Default Credentials from the metadata server. No @google-cloud/tasks SDK
 * (pnpm dependency changes require approval).
 *
 * expected outcome: `enqueueCloudTask(queueName, targetUrl, payload)` enqueues
 * a Cloud Tasks HTTP task. Fire-and-forget: errors are logged but never thrown.
 * The enqueue is NOT blocking — the conversation-close response is already sent
 * before the compaction job runs.
 *
 * trade-offs:
 *  - Uses the same GCP ADC pattern as crisis-notification.ts. On Cloud Run, the
 *    metadata server provides access tokens. In local dev, the metadata server
 *    is unreachable and the call silently degrades (logged at debug level).
 *  - The Cloud Tasks REST API is used directly rather than the SDK to avoid
 *    adding a dependency.
 *  - Requires the Express server identity to have `roles/cloudtasks.enqueuer`
 *    on the target queue (IAM provisioned by Karl).
 *
 * edge cases:
 *  - No GCP credentials (local dev): skip silently.
 *  - Cloud Tasks API failure: log error, do not throw.
 *  - Missing env vars (GCP_PROJECT_ID): log warning, skip.
 */
import { logger } from "../logger";

// ── Config ─────────────────────────────────────────────────────────────

const GCP_PROJECT_ID =
  process.env.VERTEX_PROJECT_ID ?? process.env.GCP_PROJECT_ID;

const GCP_LOCATION = process.env.VERTEX_LOCATION ?? "us-central1";

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

// ── Types ─────────────────────────────────────────────────────────────

export type CloudTaskPayload = {
  job_type: string;
  conversation_id?: string;
  student_id: string;
  trigger_reason: string;
  request_id: string;
};

// ── Enqueue ───────────────────────────────────────────────────────────

/**
 * Enqueue a Cloud Tasks HTTP task targeting the BFF's internal endpoint.
 *
 * @spec [Doc-03C_V3 §8.2, §8.3]
 *
 * Fire-and-forget: logs errors but never throws. The enqueue is best-effort;
 * if it fails, the conversation is still closed and the summary can be
 * generated on the next compaction sweep (stale trigger per §8.3).
 *
 * @param queueName  Cloud Tasks queue name (e.g. "lisa-compaction")
 * @param targetUrl  Full URL of the HTTP handler (e.g. https://lyceon.ai/api/internal/memory/compact-writeback)
 * @param payload    Task payload (JSON-serializable)
 */
export async function enqueueCloudTask(
  queueName: string,
  targetUrl: string,
  payload: CloudTaskPayload,
): Promise<void> {
  if (!GCP_PROJECT_ID) {
    logger.warn(
      "CLOUD_TASKS",
      "missing_project_id",
      "GCP_PROJECT_ID not set; Cloud Tasks enqueue skipped",
      { queueName },
    );
    return;
  }

  const accessToken = await getGcpAccessToken();
  if (!accessToken) {
    logger.debug(
      "CLOUD_TASKS",
      "no_gcp_credentials",
      "GCP credentials not available (local dev); Cloud Tasks enqueue skipped",
      { queueName },
    );
    return;
  }

  const queuePath = `projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/queues/${queueName}`;
  const apiUrl = `https://cloudtasks.googleapis.com/v2/${queuePath}/tasks`;

  const taskBody = {
    task: {
      httpRequest: {
        httpMethod: "POST",
        url: targetUrl,
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
        "CLOUD_TASKS",
        "enqueue_failed",
        "Cloud Tasks enqueue failed; async job may be delayed",
        { statusCode: response.status, errorText },
        { queueName, jobType: payload.job_type },
      );
      return;
    }

    logger.info(
      "CLOUD_TASKS",
      "enqueued",
      `Cloud Tasks job enqueued to ${queueName}`,
      { queueName, jobType: payload.job_type, requestId: payload.request_id },
    );
  } catch (err: unknown) {
    logger.error(
      "CLOUD_TASKS",
      "enqueue_error",
      "Failed to enqueue Cloud Tasks job",
      err instanceof Error ? err : undefined,
      { queueName, jobType: payload.job_type },
    );
    // Fire-and-forget: do not throw
  }
}
