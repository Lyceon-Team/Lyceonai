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
import {
  getGcpAccessTokenResult,
  getGcpCredentials,
} from "../lib/gcp-credentials";

// ── Config ─────────────────────────────────────────────────────────────

/**
 * @spec [Doc-03C_V3 §8; infra/terraform/cloud-tasks.tf, variables.tf `region`;
 *        CC Brief "Close the LISA Vertical" PR 2.1]
 * @implemented 2026-09-23
 *
 * Region of every LISA Cloud Tasks queue: `var.region` in Terraform
 * (us-central1), where `lisa-crisis-notification` is provisioned and
 * imported (imports.tf). This was previously read from VERTEX_LOCATION, a
 * VERTEX setting whose worker value is `global` — a queue path under
 * `locations/global` does not exist, so any runtime that copied the worker's
 * value would fail every enqueue. The queue region is infrastructure, not a
 * model setting, so it is a constant tied to the Terraform variable.
 */
export const CLOUD_TASKS_LOCATION = "us-central1";

/** Everything needed to call the Cloud Tasks REST API, or why it is missing. */
export type CloudTasksAccess =
  | { ok: true; projectId: string; accessToken: string }
  | {
      ok: false;
      reason: "credentials_unavailable" | "token_mint_failed";
      detail: string;
    };

/**
 * @spec [Doc-06B §3; Coding Standards §3.6; CC Brief "Close the LISA Vertical" PR 2.1]
 * @implemented 2026-09-23
 *
 * plain English: the ONE credential source for Cloud Tasks calls in the BFF —
 * project id and access token both come from GCP_SERVICE_ACCOUNT_JSON via
 * `server/lib/gcp-credentials.ts`, the same source as the orchestrator OIDC
 * client and the crisis classifier. No env-var fallback for the project: a
 * fallback only let the call proceed to a token mint that needs the same
 * missing credential, turning one clear failure into a second, vaguer one.
 * Never throws.
 */
export async function resolveCloudTasksAccess(): Promise<CloudTasksAccess> {
  let projectId: string;
  try {
    projectId = getGcpCredentials().project_id;
  } catch (err: unknown) {
    return {
      ok: false,
      reason: "credentials_unavailable",
      detail: err instanceof Error ? err.message : "unknown",
    };
  }
  const token = await getGcpAccessTokenResult();
  if (!token.ok) return token;
  return { ok: true, projectId, accessToken: token.token };
}

/** `projects/{p}/locations/{region}/queues/{q}/tasks` REST endpoint. */
export function cloudTasksApiUrl(projectId: string, queueName: string): string {
  return `https://cloudtasks.googleapis.com/v2/projects/${projectId}/locations/${CLOUD_TASKS_LOCATION}/queues/${queueName}/tasks`;
}

/**
 * Service account email for Cloud Tasks OIDC token.
 * Format: `lisa-cloud-tasks@PROJECT.iam.gserviceaccount.com`
 *
 * @spec [Doc-03C_V3 §2.4, §9.3; Operations Runbook §5.1]
 */
const CLOUD_TASKS_SERVICE_ACCOUNT =
  process.env.CLOUD_TASKS_SERVICE_ACCOUNT ?? "";

// ── Types ─────────────────────────────────────────────────────────────

export type CloudTaskPayload = {
  job_type: string;
  conversation_id?: string;
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
  if (!CLOUD_TASKS_SERVICE_ACCOUNT) {
    logger.warn(
      "CLOUD_TASKS",
      "missing_oidc_config",
      "CLOUD_TASKS_SERVICE_ACCOUNT not set; Cloud Tasks enqueue skipped (stale-summary sweep will catch)",
      { queueName },
    );
    return;
  }

  const access = await resolveCloudTasksAccess();
  if (!access.ok) {
    logger.warn(
      "CLOUD_TASKS",
      "gcp_access_unavailable",
      "GCP credentials or access token unavailable; Cloud Tasks enqueue skipped",
      { queueName, reason: access.reason, detail: access.detail },
    );
    return;
  }

  const payloadJson = JSON.stringify(payload);

  const apiUrl = cloudTasksApiUrl(access.projectId, queueName);

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
        Authorization: `Bearer ${access.accessToken}`,
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
