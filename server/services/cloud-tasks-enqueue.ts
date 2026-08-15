/**
 * @spec [Doc-03C_V3 §8; Doc-01A Part VII §62, §70; CLAUDE.md managed-service-first rule]
 * @implemented 2026-08-14
 *
 * plain English: Shared Cloud Tasks enqueue utility. Wraps the Cloud Tasks
 * REST API to enqueue jobs for async LISA workers. Requests are signed with
 * HMAC-SHA256 per Doc 01A Part VII before enqueuing — the Cloud Tasks HTTP
 * target receives the three HMAC headers alongside the payload so the
 * receiver can verify the caller (§62, §63).
 *
 * expected outcome: `enqueueCloudTask(queueName, targetUrl, payload)` enqueues
 * a Cloud Tasks HTTP task with HMAC headers. Fire-and-forget: errors are
 * logged but never thrown.
 *
 * trade-offs:
 *  - HMAC timestamp is set at ENQUEUE time, not delivery time. Cloud Tasks
 *    first delivery is within seconds (well within the 5-min §66 tolerance).
 *    Retries after 5min fail on timestamp — acceptable because the stale-
 *    summary sweep (§8.3) catches orphaned conversations.
 *  - Uses the same GCP ADC pattern as crisis-notification.ts. On Cloud Run, the
 *    metadata server provides access tokens. In local dev, the metadata server
 *    is unreachable and the call silently degrades (logged at debug level).
 *  - No @google-cloud/tasks SDK (pnpm dependency changes require approval).
 *
 * edge cases:
 *  - No GCP credentials (local dev): skip silently.
 *  - Cloud Tasks API failure: log error, do not throw.
 *  - Missing env vars (GCP_PROJECT_ID): log warning, skip.
 *  - HMAC signing failure (no provisioned secret): log error, skip enqueue.
 *    The conversation is already closed; the summary can be retried on the
 *    next stale-summary sweep.
 */
import { logger } from "../logger";
import { signInternalRequest } from "../../packages/shared/internal-auth/sign-request";

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
 * @param queueName      Cloud Tasks queue name (e.g. "lisa-compaction")
 * @param targetUrl      Full URL of the HTTP handler (e.g. https://lyceon.ai/api/internal/memory/compact-writeback)
 * @param payload        Task payload (JSON-serializable)
 * @param callerService  Calling service identifier for HMAC (e.g. "compaction-worker")
 * @param calleeService  Receiving service identifier for HMAC (e.g. "main-api")
 */
export async function enqueueCloudTask(
  queueName: string,
  targetUrl: string,
  payload: CloudTaskPayload,
  callerService: string = "compaction-worker",
  calleeService: string = "main-api",
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

  // ── Sign the request with HMAC (01A Part VII §62) ──────────────
  // HMAC timestamp is set NOW at enqueue time. Cloud Tasks delivers
  // within seconds (well within 5-min tolerance). Retries >5min fail
  // on timestamp — acceptable per stale-summary sweep (§8.3).
  const payloadJson = JSON.stringify(payload);
  let hmacHeaders: Record<string, string> = {};
  try {
    const signResult = await signInternalRequest(
      "POST",
      targetUrl,
      payloadJson,
      callerService,
      calleeService,
    );
    hmacHeaders = signResult.headers;
  } catch (err: unknown) {
    logger.error(
      "CLOUD_TASKS",
      "hmac_sign_failed",
      "Failed to sign Cloud Tasks request with HMAC; enqueue skipped (stale-summary sweep will catch)",
      err instanceof Error ? err : undefined,
      { queueName, callerService, calleeService },
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
          ...hmacHeaders,
        },
        body: Buffer.from(payloadJson).toString("base64"),
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
