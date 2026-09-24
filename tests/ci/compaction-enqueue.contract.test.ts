/**
 * @spec [Doc-03C_V3 §8.2, §8.3; CC Brief "Close the LISA Vertical" PR 3.2]
 * @implemented 2026-09-23
 *
 * plain English: memory compaction had never run from a session end. Two of
 * the three breaks are in code and are pinned here:
 *   - the payload POST /conversations/:id/end enqueues must be one the
 *     writeback handler accepts (it sent trigger_reason "end"; §8.3 and the
 *     handler allow close | threshold | stale);
 *   - the enqueue must complete before /end responds (it was `void`, and a
 *     Vercel function may be frozen once the response is sent).
 * The third break — the queue did not exist — is infrastructure
 * (infra/terraform/cloud-tasks.tf), pinned structurally below.
 */
import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const STUDENT_ID = "44444444-4444-4444-8444-444444444444";
const CONV_ID = "55555555-5555-4555-8555-555555555555";

const conversationRow = {
  id: CONV_ID,
  student_id: STUDENT_ID,
  entry_mode: "general",
  source_surface: "dashboard",
  source_session_id: null,
  source_session_item_id: null,
  source_question_row_id: null,
  source_question_canonical_id: null,
  status: "active",
  crisis_flagged: false,
  deleted_at: null,
  created_at: "2026-09-23T10:00:00.000Z",
  updated_at: "2026-09-23T10:00:00.000Z",
  closed_at: null,
  title: "t",
  surface: "standalone",
  crisis_paused_at: null,
  ended_at: null,
};

/** Minimal chain: select…eq…eq…is…maybeSingle and update…eq. */
function chain(result: {
  data: unknown;
  error: null;
}): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "update"]) c[m] = () => c;
  c.maybeSingle = async () => result;
  c.then = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
  return c;
}

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => chain({ data: conversationRow, error: null }),
  },
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: {
    isEntitlementActiveForProfile: vi.fn(async () => true),
  },
}));

let enqueueCompleted = false;
const enqueueCloudTask = vi.fn(async () => {
  await new Promise((r) => setTimeout(r, 25));
  enqueueCompleted = true;
});
vi.mock("../../server/services/cloud-tasks-enqueue", () => ({
  enqueueCloudTask: (...a: unknown[]) => enqueueCloudTask(...(a as [])),
}));

import tutorRuntimeRouter from "../../server/routes/tutor-runtime";
import { compactionTaskSchema } from "../../server/routes/internal-memory-routes";

function app(): express.Express {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as unknown as { user: { id: string; role: string } }).user = {
      id: STUDENT_ID,
      role: "student",
    };
    next();
  });
  a.use("/api/tutor", tutorRuntimeRouter);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  enqueueCompleted = false;
});

describe("PR 3.2 — session end enqueues a compaction task the handler accepts", () => {
  it("the enqueued payload parses against the writeback handler's schema", async () => {
    const res = await request(app())
      .post(`/api/tutor/conversations/${CONV_ID}/end`)
      .send({});
    expect(res.status).toBe(200);

    expect(enqueueCloudTask).toHaveBeenCalledOnce();
    const [queue, target, payload] = enqueueCloudTask.mock
      .calls[0] as unknown as [string, string, unknown];
    expect(queue).toBe("lisa-compaction");
    expect(target).toMatch(/\/api\/internal\/memory\/compact-writeback$/);
    const parsed = compactionTaskSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.trigger_reason).toBe("close");
  });

  it("the enqueue has completed before /end responds", async () => {
    await request(app())
      .post(`/api/tutor/conversations/${CONV_ID}/end`)
      .send({});
    expect(enqueueCompleted).toBe(true);
  });

  it("Terraform provisions lisa-compaction with §8.2's policy and the actAs grant", () => {
    const tf = fs.readFileSync(
      path.resolve(__dirname, "../../infra/terraform/cloud-tasks.tf"),
      "utf-8",
    );
    const start = tf.indexOf(
      'resource "google_cloud_tasks_queue" "compaction"',
    );
    expect(start).toBeGreaterThan(-1);
    const q = tf.slice(start, tf.indexOf("\n}\n", start));
    expect(q).toContain('name     = "lisa-compaction"');
    expect(q).toMatch(/max_dispatches_per_second = 100/);
    expect(q).toMatch(/max_attempts\s+= 6/);
    expect(q).toMatch(/min_backoff\s+= "5s"/);
    expect(q).toMatch(/max_backoff\s+= "300s"/);
    expect(tf).toContain('role               = "roles/iam.serviceAccountUser"');
  });
});
