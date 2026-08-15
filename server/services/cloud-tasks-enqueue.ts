/**
 * @spec [Doc-03C_V3 §8, §9.3; CLAUDE.md managed-service-first rule]
 * @implemented 2026-08-15
 *
 * plain English: Shared Cloud Tasks enqueue utility. Wraps the Cloud Tasks
 * REST API to enqueue jobs for async LISA workers. Cloud Tasks is configured
 * to attach an OIDC token at DELIVERY time per Doc 03C §9.3 — the handler
 * validates the token (audience, issuer, service account) rather than relying
 * on HMAC headers frozen at enqueue time.
 *
 * expected outcome: `enqueueCloudTask(queueName, targetUrl, payload)` enqueues
 * a Cloud Tasks HTTP task with OIDC token configuration. Fire-and-forget:
 * errors are logged but never thrown.
 *
 * trade-offs:
 *  - OIDC tokens are minted by Cloud Tasks at DELIVERY time. Unlike HMAC
 *    (timestamp frozen at enqueue), OIDC retries get a fresh token every time.
 *    This eliminates the 5-min staleness window that previously caused
 *    permanent 401s on Cloud Tasks retries.
 *  - Uses the same GCP ADC pattern as crisis-notification.ts. On Cloud Run, the
 *    metadata server provides access tokens. In local dev, the metadata server
 *    is unreachable and the call silently degrades (logged at debug level).
 *  - No @google-cloud/tasks SDK (pnpm dependency changes require approval).
 *  - The service account email and OIDC audience are configured via env vars.
 *    Karl must provision the SA and IAM grants per the Operations Runbook §5.
 *
 * edge cases:
 *  - No GCP credentials (local dev): skip silently.
 *  - Cloud Tasks API failure: log error, do not throw.
 *  - Missing env vars (GCP_PROJECT_ID): log warning, skip.
 *  - Missing OIDC env vars (CLOUD_TASKS_SERVICE_ACCOUNT): log warning, skip.
 *    The conversation is already closed; the summary can be retried on the
 *    next stale-summary sweep.
 */
import { logger } from "../logger";

// ── Config ─────────────────────────────────────────────────────────────

const GCP_PROJECT_ID =
  process.env.VERTEX_PROJECT_ID ?? process.env.GCP_PROJECT_ID;

const GCP_LOCATION = process.env.VERTEX_LOCATION ?? "us-central1";

/**
 * Service account email for Cloud Tasks OIDC token.
 * Format: `lisa-cloud-tasks@PROJECT.iam.gserviceaccount.com`
 *
 * @spec [Doc-03C_V3 §2.4, §9.3; Operations Runbook §5.1]
 */
const CLOUD_TASKS_SERVICE_ACCOUNT =
  process.env.CLOUD_TASKS_SERVICE_ACCOUNT ?? "";

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
 * Enqueue a Cloud Tasks HTTP task with OIDC token authentication.
 *
 * @spec [Doc-03C_V3 §8.2, §8.3, §9.3]
 *
 * Cloud Tasks mints an OIDC token at DELIVERY time using the specified
 * service account. The handler validates the token per §9.3 (audience,
 * issuer, service account email). This replaces the previous HMAC approach
 * where the timestamp was frozen at enqueue time — OIDC tokens are fresh
 * on every delivery attempt, eliminating permanent 401s on retries.
 *
 * Fire-and-forget: logs errors but never throws. The enqueue is best-effort;
 * if it fails, the conversation is still closed and the summary can be
 * generated on the next compaction sweep (stale trigger per §8.3).
 *
 * @param queueName  Cloud Tasks queue name (e.g. "lisa-compaction")
 * @param targetUrl  Full URL of the HTTP handler — also used as the OIDC audience
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

  if (!CLOUD_TASKS_SERVICE_ACCOUNT) {
    logger.warn(
      "CLOUD_TASKS",
      "missing_oidc_config",
      "CLOUD_TASKS_SERVICE_ACCOUNT not set; Cloud Tasks enqueue skipped (stale-summary sweep will catch)",
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

  const payloadJson = JSON.stringify(payload);

  const queuePath = `projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/queues/${queueName}`;
  const apiUrl = `https://cloudtasks.googleapis.com/v2/${queuePath}/tasks`;

  // ── Cloud Tasks task body with OIDC token (§9.3) ──────────────
  // Cloud Tasks mints the OIDC token at DELIVERY time using the
  // specified service account. The `audience` is the handler URL —
  // the handler validates that the token's audience matches.
  const taskBody = {
    task: {
      httpRequest: {
        httpMethod: "POST",
        url: targetUrl,
        headers: {
          "Content-Type": "application/json",
        },
        body: Buffer.from(payloadJson).toString("base64"),
        oidcToken: {
          serviceAccountEmail: CLOUD_TASKS_SERVICE_ACCOUNT,
          audience: targetUrl,
        },
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
