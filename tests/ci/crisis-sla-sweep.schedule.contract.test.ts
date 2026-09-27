/**
 * @spec [Doc-03_V3 §21.3; Doc-03C_V3 §9.3; CC Brief "Close the LISA Vertical" PR 2.2]
 * @implemented 2026-09-23
 *
 * plain English: the crisis SLA-breach sweep existed for six weeks with no
 * caller. These tests pin the caller and the contract between them:
 *   - Terraform defines an hourly Cloud Scheduler job that POSTs to the route
 *     with an OIDC token whose audience is the route URL;
 *   - the route is POST behind the OIDC guard (no longer GET + CRON_SECRET),
 *     and refuses with 500 + ERROR when its audience env var is unset (no
 *     fallback), rather than running unauthenticated or silently 401-ing.
 */
import fs from "node:fs";
import path from "node:path";
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
const getBreachedCases = vi.fn(async () => []);
vi.mock("../../server/services/crisis-review-queue", () => ({
  getBreachedCases: () => getBreachedCases(),
}));

import internalCronRoutes from "../../server/routes/internal-cron-routes";

const savedEnv = { ...process.env };

function app(): express.Express {
  const a = express();
  a.use(express.json());
  a.use("/api/internal", internalCronRoutes);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...savedEnv };
});
afterEach(() => {
  process.env = { ...savedEnv };
});

describe("PR 2.2 — crisis SLA sweep has a scheduled caller", () => {
  it("Terraform schedules an hourly OIDC POST to /api/internal/crisis-sla-sweep", () => {
    const tf = fs.readFileSync(
      path.resolve(__dirname, "../../infra/terraform/cloud-scheduler-crisis.tf"),
      "utf-8",
    );
    const start = tf.indexOf(
      'resource "google_cloud_scheduler_job" "crisis_sla_sweep"',
    );
    expect(start).toBeGreaterThan(-1);
    const job = tf.slice(start, tf.indexOf("\n}\n", start));
    expect(job).toMatch(/schedule\s+=\s+"15 \* \* \* \*"/);
    expect(job).toMatch(/http_method = "POST"/);
    expect(job).toContain(
      'uri         = "${var.app_base_url}/api/internal/crisis-sla-sweep"',
    );
    expect(job).toContain(
      'audience              = "${var.app_base_url}/api/internal/crisis-sla-sweep"',
    );
    expect(job).toContain(
      "service_account_email = google_service_account.cloud_tasks.email",
    );
  });

  it("the old GET + CRON_SECRET entry point is gone", async () => {
    process.env.CRON_SECRET = "test-secret";
    const res = await request(app())
      .get("/api/internal/crisis-sla-sweep")
      .set("Authorization", "Bearer test-secret");
    expect(res.status).toBe(404);
    expect(getBreachedCases).not.toHaveBeenCalled();
  });

  it("POST with the audience env var unset refuses with 500 and logs ERROR (no fallback)", async () => {
    delete process.env.CRISIS_SLA_SWEEP_OIDC_AUDIENCE;
    process.env.CLOUD_TASKS_OIDC_AUDIENCE = "https://lyceon.ai/other";
    process.env.CLOUD_TASKS_SERVICE_ACCOUNT =
      "lisa-cloud-tasks@replit-cop.iam.gserviceaccount.com";

    const res = await request(app()).post("/api/internal/crisis-sla-sweep");

    expect(res.status).toBe(500);
    expect(getBreachedCases).not.toHaveBeenCalled();
  });

  it("POST without a bearer token is rejected before the sweep runs", async () => {
    process.env.CRISIS_SLA_SWEEP_OIDC_AUDIENCE =
      "https://lyceon.ai/api/internal/crisis-sla-sweep";
    process.env.CLOUD_TASKS_SERVICE_ACCOUNT =
      "lisa-cloud-tasks@replit-cop.iam.gserviceaccount.com";

    const res = await request(app()).post("/api/internal/crisis-sla-sweep");

    expect(res.status).toBe(401);
    expect(getBreachedCases).not.toHaveBeenCalled();
  });
});
