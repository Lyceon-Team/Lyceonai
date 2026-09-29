/**
 * Guardian dashboard views are recorded in `audit_logs` → real PostgreSQL.
 *
 * @spec [Guardian_Closure_Plan G1-04; audit G-AUD-07; Doc 01 V8 §14 Layer 3 audit logging,
 *        §12.1 access metadata only] | @implemented [2026-09-29]
 *
 * plain English: `GET /api/guardian/students` used to write its access event to
 * `system_event_logs`, a table no migration creates and production does not have (owner check
 * 2026-09-28), inside an empty `catch` — so every record was lost, silently. This drives the
 * REAL route against a database with every migration applied and reads the row back.
 *
 * The row must have the SAME shape the link and revoke events already use
 * (`guardian_link_audit` → `audit_logs(actor_profile_id, target_profile_id, action, changes,
 * context{request_id, ...})`), and its context may carry IDs and counts only: no email, no
 * name, no answer, nothing about the student beyond how many are linked.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { Client } from "pg";
import express from "express";
import request from "supertest";
import {
  makePgSupabase,
  bootstrapPgDatabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "guardian_access_audit_ci";
const GUARDIAN = "c1111111-1111-4111-8111-111111111111";
const STUDENT = "c2222222-2222-4222-8222-222222222222";

let pg: Client;

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pg);
  },
  supabaseAdmin: {
    get from() {
      return makePgSupabase(pg).from;
    },
  },
}));

vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    requireSupabaseAuth: (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      (req as express.Request & { user?: unknown }).user = {
        id: GUARDIAN,
        email: "g@example.test",
        role: "guardian",
      };
      next();
    },
  };
});

async function buildApp(): Promise<express.Express> {
  const router = (await import("../../server/routes/guardian-routes")).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { requestId?: string }).requestId = "g1-04-req";
    next();
  });
  app.use("/api/guardian", router);
  return app;
}

async function viewedRows(): Promise<
  Array<{
    id: string;
    actor_profile_id: string | null;
    target_profile_id: string | null;
    action: string;
    changes: unknown;
    context: Record<string, unknown>;
  }>
> {
  const r = await pg.query(
    `SELECT id, actor_profile_id, target_profile_id, action, changes, context
       FROM public.audit_logs WHERE action = 'guardian_dashboard_viewed'`,
  );
  return r.rows;
}

describe.skipIf(!PG_AVAILABLE)(
  "G1-04 guardian access events → audit_logs",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4)`,
        [GUARDIAN, "g@example.test", STUDENT, "s@example.test"],
      );
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, display_name) VALUES
         ($1,$2,'guardian','Gia Guardian'),($3,$4,'student','Sam Student')`,
        [GUARDIAN, "g@example.test", STUDENT, "s@example.test"],
      );
    });

    afterAll(async () => {
      if (pg) await pg.end();
    });

    beforeEach(async () => {
      await pg.query(`DELETE FROM public.guardian_links`);
      // audit_logs is append-only by trigger; each case counts only rows it created.
      await pg.query(`ALTER TABLE public.audit_logs DISABLE TRIGGER USER`);
      await pg.query(`DELETE FROM public.audit_logs`);
      await pg.query(`ALTER TABLE public.audit_logs ENABLE TRIGGER USER`);
    });

    it("one dashboard view writes exactly one audit_logs row, shaped like the link events", async () => {
      await pg.query(
        `INSERT INTO public.guardian_links (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at, accepted_at)
       VALUES ($1, $2, 'active', 'student', now(), now())`,
        [GUARDIAN, STUDENT],
      );

      const res = await request(await buildApp()).get("/api/guardian/students");
      expect(res.status).toBe(200);
      expect(res.body.students).toHaveLength(1);

      const rows = await viewedRows();
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.actor_profile_id).toBe(GUARDIAN);
      expect(row.target_profile_id).toBeNull();
      expect(row.changes).toBeNull();
      // IDs and counts only. The exact key set is the privacy assertion.
      expect(row.context).toEqual({
        request_id: "g1-04-req",
        linked_student_count: 1,
      });
      expect(JSON.stringify(row)).not.toContain("@example.test");
      expect(JSON.stringify(row)).not.toContain("Sam Student");
    });

    it("a guardian with no linked students is recorded too", async () => {
      const res = await request(await buildApp()).get("/api/guardian/students");
      expect(res.status).toBe(200);
      expect(res.body.students).toEqual([]);

      const rows = await viewedRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.context).toEqual({
        request_id: "g1-04-req",
        linked_student_count: 0,
      });
    });
  },
);
