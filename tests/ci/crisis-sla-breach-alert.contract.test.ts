/**
 * @spec [Doc-03_V3 §21.3; closure plan W2-2a] | @implemented 2026-09-24
 *
 * plain English: the hourly SLA sweep detected breaches and logged ERROR
 * `sla_breach_detected` — and stopped. Nothing reached #lyceon-crisis. This
 * pins the alert that closes that gap:
 *   - notifySlaBreaches enqueues ONE Cloud Tasks task to the same crisis queue
 *     and Slack target a new case uses, naming every breached case with its
 *     claimed/unclaimed state and hours overdue — metadata only
 *   - the sweep route calls it with every breached case
 *   - "breached" includes claimed (in_review) cases, not only open ones
 *   - an unconfigured target logs ERROR with the case ids (never silent)
 *
 * The real credential and enqueue modules run; only google-auth-library,
 * fetch, the OIDC guard and the database are replaced.
 */
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loggerError = vi.fn();
vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
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

// The OIDC guard is covered by crisis-sla-sweep.schedule.contract.test.ts;
// here it is a pass-through so the handler itself runs.
vi.mock("../../packages/shared/internal-auth/verify-oidc-middleware", () => ({
  oidcAuthMiddlewareWithConfigGuard:
    () =>
    (_req: unknown, _res: unknown, next: () => void): void =>
      next(),
}));

// The database behind getBreachedCases: records the status filter it is given.
const statusFilter: { value: unknown } = { value: undefined };
const breachedRows: { value: Array<Record<string, unknown>> } = { value: [] };
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => {
      const q = {
        select: () => q,
        in: (_col: string, vals: unknown) => {
          statusFilter.value = vals;
          return q;
        },
        eq: (_col: string, val: unknown) => {
          statusFilter.value = val;
          return q;
        },
        lt: () => q,
        order: async () => ({ data: breachedRows.value, error: null }),
      };
      return q;
    },
  },
}));

import internalCronRoutes from "../../server/routes/internal-cron-routes";
import { notifySlaBreaches } from "../../server/services/crisis-notification";
import { _resetGcpCredentialsCache } from "../../server/lib/gcp-credentials";

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
const NOW = new Date("2026-09-24T12:00:00.000Z");

const fetchMock = vi.fn();
const savedEnv = { ...process.env };

function decodedSlackText(): string {
  const call = fetchMock.mock.calls[0] as [string, { body: string }];
  const task = JSON.parse(call[1].body) as {
    task: { httpRequest: { url: string; body: string } };
  };
  expect(task.task.httpRequest.url).toBe(SLACK_TARGET);
  const slack = JSON.parse(
    Buffer.from(task.task.httpRequest.body, "base64").toString("utf8"),
  ) as { text: string };
  return slack.text;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetGcpCredentialsCache();
  process.env = { ...savedEnv };
  process.env.GCP_SERVICE_ACCOUNT_JSON = FAKE_SERVICE_ACCOUNT;
  process.env.LYCEON_CRISIS_ALERTS = SLACK_TARGET;
  process.env.PUBLIC_SITE_URL = "https://lyceon.ai";
  getAccessToken.mockResolvedValue({ token: "fake-access-token" });
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  statusFilter.value = undefined;
  breachedRows.value = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...savedEnv };
});

describe("W2-2a — SLA breaches reach #lyceon-crisis", () => {
  it("one task to the crisis queue, naming every case with state and hours overdue, metadata only", async () => {
    await notifySlaBreaches(
      [
        {
          caseId: "e0819662-0000-4000-8000-000000000001",
          status: "open",
          slaDeadline: "2026-09-19T12:00:00.000Z",
        },
        {
          caseId: "6ffc13ff-0000-4000-8000-000000000003",
          status: "in_review",
          slaDeadline: "2026-09-24T09:30:00.000Z",
        },
      ],
      NOW,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    // Same queue and region as a new-case alert.
    expect(url).toBe(
      "https://cloudtasks.googleapis.com/v2/projects/replit-cop/locations/us-central1/queues/lisa-crisis-notification/tasks",
    );

    const text = decodedSlackText();
    expect(text).toContain("SLA breached — 2 case(s)");
    expect(text).toContain(
      "<https://lyceon.ai/admin/crisis-review/e0819662-0000-4000-8000-000000000001|e0819662-0000-4000-8000-000000000001> — unclaimed, 120h past SLA",
    );
    expect(text).toContain("6ffc13ff-0000-4000-8000-000000000003");
    expect(text).toContain("claimed, unresolved, 2h past SLA");
    // Metadata only: no conversation id field, no content.
    expect(text).not.toMatch(/Conversation/i);
    expect(loggerError).not.toHaveBeenCalled();
  });

  it("nothing breached → nothing enqueued", async () => {
    await notifySlaBreaches([], NOW);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unset LYCEON_CRISIS_ALERTS is an ERROR naming the breached cases, not silence", async () => {
    delete process.env.LYCEON_CRISIS_ALERTS;
    await notifySlaBreaches(
      [
        {
          caseId: "case-a",
          status: "open",
          slaDeadline: "2026-09-20T00:00:00Z",
        },
      ],
      NOW,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith(
      "CRISIS_NOTIFICATION",
      "missing_target_url",
      expect.any(String),
      undefined,
      expect.objectContaining({ alert: "sla_breach", caseIds: ["case-a"] }),
    );
  });

  it("the sweep route alerts on what it finds, and 'breached' includes claimed cases", async () => {
    breachedRows.value = [
      {
        id: "3cc599af-0000-4000-8000-000000000002",
        status: "open",
        sla_deadline: "2026-09-19T00:00:00.000Z",
      },
      {
        id: "6ffc13ff-0000-4000-8000-000000000003",
        status: "in_review",
        sla_deadline: "2026-09-19T01:00:00.000Z",
      },
    ];
    const app = express();
    app.use(express.json());
    app.use("/api/internal", internalCronRoutes);

    const res = await request(app).post("/api/internal/crisis-sla-sweep");

    expect(res.status).toBe(200);
    expect(res.body.breachedCount).toBe(2);
    // The query covers unresolved cases, not only unclaimed ones.
    expect(statusFilter.value).toEqual(["open", "in_review"]);
    // The ERROR log stays, and one Slack task names both cases.
    expect(loggerError).toHaveBeenCalledWith(
      "CRISIS_SLA",
      "sla_breach_detected",
      expect.any(String),
      undefined,
      expect.objectContaining({ breachedCount: 2 }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const text = decodedSlackText();
    expect(text).toContain("3cc599af-0000-4000-8000-000000000002");
    expect(text).toContain("6ffc13ff-0000-4000-8000-000000000003");
    expect(text).toContain("claimed, unresolved");
  });
});
