/**
 * @spec [Doc-03_V3 §21.2 step 5; Doc-03C_V3 §8; CC Brief "Close the LISA Vertical" PR 2.1]
 * @implemented 2026-09-23
 *
 * plain English: `notifyCrisisEvent` is the only path from a crisis turn to the
 * ops Slack channel. These tests pin the four ways it used to fail without
 * anyone being told:
 *   - the queue region came from VERTEX_LOCATION (worker value `global`), so the
 *     Cloud Tasks path pointed at a queue that does not exist;
 *   - every skip logged at WARN, which never reaches the error monitor;
 *   - the access-token mint could throw out of the function into the turn's
 *     catch-all, turning a crisis response into a 500;
 *   - the project id fell back to env vars instead of the one credential source.
 * The real `server/lib/gcp-credentials.ts` and `cloud-tasks-enqueue.ts` run; only
 * google-auth-library (the network token mint) and fetch (the Cloud Tasks API)
 * are replaced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loggerError = vi.fn();
const loggerWarn = vi.fn();
vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: (...a: unknown[]) => loggerWarn(...a),
    error: (...a: unknown[]) => loggerError(...a),
  },
}));

const getAccessToken = vi.fn();
vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    async getClient(): Promise<{ getAccessToken: typeof getAccessToken }> {
      return { getAccessToken };
    }
  },
}));

import { notifyCrisisEvent } from "../../server/services/crisis-notification";
import { _resetGcpCredentialsCache } from "../../server/lib/gcp-credentials";

// Same fake shape as tests/ci/gcp-credentials.ci.test.ts — not a real key.
const FAKE_SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account",
  project_id: "replit-cop",
  private_key_id: "fake-key-id-000",
  private_key: "-----BEGIN FAKE-----\nnotreal\n-----END FAKE-----\n",
  client_email: "lyceon-server-sa@replit-cop.iam.gserviceaccount.com",
  client_id: "000",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
});
const SLACK_TARGET = "https://hooks.slack.test/services/T0/B0/fake";

const payload = {
  caseId: "case-1",
  conversationId: "conv-1",
  source: "signature" as const,
  slaDeadline: "2026-09-25T10:00:00.000Z",
  timestamp: "2026-09-23T10:00:00.000Z",
};

const fetchMock = vi.fn();
const savedEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  _resetGcpCredentialsCache();
  process.env = { ...savedEnv };
  process.env.GCP_SERVICE_ACCOUNT_JSON = FAKE_SERVICE_ACCOUNT;
  process.env.LYCEON_CRISIS_ALERTS = SLACK_TARGET;
  // The worker's value. It must NOT leak into the queue path.
  process.env.VERTEX_LOCATION = "global";
  delete process.env.VERTEX_PROJECT_ID;
  delete process.env.GCP_PROJECT_ID;
  getAccessToken.mockResolvedValue({ token: "fake-access-token" });
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...savedEnv };
});

describe("PR 2.1 — crisis notification dispatch", () => {
  it("enqueues to the us-central1 queue even when VERTEX_LOCATION=global, targeting the Slack webhook", async () => {
    await notifyCrisisEvent(payload);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://cloudtasks.googleapis.com/v2/projects/replit-cop/locations/us-central1/queues/lisa-crisis-notification/tasks",
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer fake-access-token",
    );
    const body = JSON.parse(String(init.body)) as {
      task: { httpRequest: { url: string } };
    };
    expect(body.task.httpRequest.url).toBe(SLACK_TARGET);
    expect(loggerError).not.toHaveBeenCalled();
  });

  it("credentials absent: logs at ERROR with the reason and sends nothing (no env-var project fallback)", async () => {
    delete process.env.GCP_SERVICE_ACCOUNT_JSON;
    process.env.GCP_PROJECT_ID = "replit-cop"; // must not rescue the call

    await notifyCrisisEvent(payload);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith(
      "CRISIS_NOTIFICATION",
      "gcp_access_unavailable",
      expect.any(String),
      expect.objectContaining({
        reason: "credentials_unavailable",
        detail: "GCP_SERVICE_ACCOUNT_JSON is not set",
      }),
      expect.objectContaining({ caseId: "case-1" }),
    );
  });

  it("token mint throws: resolves (does not throw) and logs at ERROR", async () => {
    getAccessToken.mockRejectedValue(new TypeError("token endpoint down"));

    await expect(notifyCrisisEvent(payload)).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith(
      "CRISIS_NOTIFICATION",
      "gcp_access_unavailable",
      expect.any(String),
      expect.objectContaining({
        reason: "token_mint_failed",
        detail: "TypeError",
      }),
      expect.objectContaining({ caseId: "case-1" }),
    );
  });

  it("LYCEON_CRISIS_ALERTS unset: logs at ERROR and sends nothing", async () => {
    delete process.env.LYCEON_CRISIS_ALERTS;

    await notifyCrisisEvent(payload);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith(
      "CRISIS_NOTIFICATION",
      "missing_target_url",
      expect.any(String),
      undefined,
      expect.objectContaining({ caseId: "case-1" }),
    );
    expect(loggerWarn).not.toHaveBeenCalled();
  });
});
