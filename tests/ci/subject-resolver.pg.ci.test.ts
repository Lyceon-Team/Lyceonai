/**
 * The subject resolver's REAL decisions, on real rows → real PostgreSQL.
 *
 * @spec [Doc 05B §10.3 path-layer authorization (404-not-403) + RB-05B-V1-05; Doc 01 V8
 *   §35/§38.1, §14 Layer 3 audit logging, §12.1 access metadata only; owner rulings
 *   2026-08-26 R3/R5/R6 and 2026-08-27 OQ1/OQ5] | @implemented [2026-11-02]
 *
 * plain English: SPLIT out of `tests/ci/subject-resolver.contract.test.ts` (deleted in the same
 * change), which mocked `supabaseServer` and therefore asserted on decisions it had typed in
 * itself and on an audit row it had captured from a fake `insert`. Here every decision is the
 * one `public.guardian_view_decision` really returns for the rows in the table, and the audit
 * row is read back out of a real `audit_logs`, so a column the writer names that the table does
 * not have raises 42703 instead of passing.
 *
 * WHAT IS SUBSTITUTED: the database TRANSPORT (`supabaseServer` → SQL through
 * tests/helpers/pg-supabase, with a pass-through counter on `.rpc` so "the derivation was never
 * consulted" is observable) and the auth boundary (a fixed `req.user`). The resolver, the
 * derivation service, the audit writer, the SQL function and the schema are all real.
 *
 * EACH DECISION IS SHOWN ABLE TO COME OUT THE OTHER WAY. ALLOW and UNENTITLED are the same pair
 * of profiles with the same active link, differing ONLY in the student's entitlement row; NOT
 * LINKED is a third profile with no link at all. A resolver that answered one status for every
 * caller cannot pass all three.
 *
 * WHERE THE INJECTED FAILURES WENT. The RPC error, the unknown CASE arm and the failed audit
 * write are in `tests/ci/subject-resolver.faults.pg.ci.test.ts`, also on real Postgres: there
 * the database itself is made to fail (the function replaced, a trigger refusing the insert),
 * which needs a database of its own because those cases rewrite the schema.
 *
 * Every case was observed FAILING once under a plant on the code under test (recorded in the
 * PR body, with the exact line each plant mutated).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Client } from "pg";
import express from "express";
import request from "supertest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import { SUBJECT_ACCESS_ACTION } from "../../server/services/subject-access-audit";

const DB_NAME = "subject_resolver_ci";
const STUDENT = "5a111111-1111-4111-8111-111111111111";
const GUARDIAN = "5a222222-2222-4222-8222-222222222222";
const STRANGER = "5a333333-3333-4333-8333-333333333333";
/** A well-formed uuid no row carries. */
const NOBODY = "5a444444-4444-4444-8444-444444444444";

let pg: Client;

/** Every `.rpc` the code under test makes, in order. The call itself still goes to Postgres. */
const rpcCalls: Array<{
  fn: string;
  args: Record<string, unknown> | undefined;
}> = [];

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    const real = makePgSupabase(pg);
    return {
      from: real.from,
      rpc: (fn: string, args?: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return real.rpc(fn, args);
      },
    };
  },
}));

type Req = express.Request & {
  user?: { id: string; role: string };
  requestId?: string;
};

async function callAs(
  principalId: string,
  studentId: string,
  role = "guardian",
): Promise<{
  status: number;
  body: Record<string, unknown>;
  subject: unknown;
}> {
  const { resolveSubject } =
    await import("../../server/middleware/subject-resolver");
  const app = express();
  app.use((req, _res, next) => {
    const r = req as Req;
    r.user = { id: principalId, role };
    r.requestId = "req-subject";
    next();
  });
  let seen: unknown = undefined;
  app.get(
    "/api/students/:studentId/probe",
    resolveSubject,
    (req: express.Request, res: express.Response) => {
      seen = req.subject;
      res.json({ ok: true, subject: req.subject });
    },
  );
  const res = await request(app).get(`/api/students/${studentId}/probe`);
  return { status: res.status, body: res.body, subject: seen };
}

type AuditRow = {
  actor_profile_id: string | null;
  target_profile_id: string | null;
  action: string;
  changes: unknown;
  context: Record<string, unknown> | null;
};

/** The rows the resolver wrote, read back from the real table. */
async function accessRows(): Promise<AuditRow[]> {
  const r = await pg.query(
    `SELECT actor_profile_id, target_profile_id, action, changes, context
       FROM public.audit_logs WHERE action = $1 ORDER BY created_at, id`,
    [SUBJECT_ACCESS_ACTION],
  );
  return r.rows as AuditRow[];
}

async function linkActive(guardian: string, student: string): Promise<void> {
  // The link as SCL-080's writer produces it.
  await pg.query(
    `INSERT INTO public.guardian_links (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at, accepted_at, accepted_by_profile_id)
     VALUES ($1, $2, 'active', 'student', now(), now(), $2)`,
    [guardian, student],
  );
}

async function entitle(student: string): Promise<void> {
  await pg.query(
    `INSERT INTO public.entitlements (profile_id, tier, status) VALUES ($1, 'premium', 'active')`,
    [student],
  );
}

describe.skipIf(!PG_AVAILABLE)(
  "subject resolver — real decisions on real rows",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,'s@x.test'),($2,'g@x.test'),($3,'x@x.test')`,
        [STUDENT, GUARDIAN, STRANGER],
      );
      await pg.query(
        `INSERT INTO public.profiles (id, email, role) VALUES
         ($1,'s@x.test','student'),($2,'g@x.test','guardian'),($3,'x@x.test','guardian')`,
        [STUDENT, GUARDIAN, STRANGER],
      );
    });

    afterAll(async () => {
      if (pg) await pg.end();
    });

    beforeEach(async () => {
      rpcCalls.length = 0;
      await pg.query(`DELETE FROM public.guardian_links`);
      await pg.query(`DELETE FROM public.entitlements`);
      // audit_logs is append-only by trigger; each case counts only rows it created.
      await pg.query(`ALTER TABLE public.audit_logs DISABLE TRIGGER USER`);
      await pg.query(`DELETE FROM public.audit_logs`);
      await pg.query(`ALTER TABLE public.audit_logs ENABLE TRIGGER USER`);
    });

    it("SELF — the student reads their own data with no link lookup and NO audit row", async () => {
      const out = await callAs(STUDENT, STUDENT, "student");
      expect(out.status).toBe(200);
      expect(out.subject).toEqual({ studentId: STUDENT, via: "self" });
      // The derivation is never consulted for self: there is nothing to derive.
      expect(rpcCalls).toEqual([]);
      // Owner ruling OQ5: recording every student reading their own dashboard buries the
      // guardian accesses that matter.
      expect(await accessRows()).toEqual([]);

      // PRESENCE CONTROL for the two absences above, in the same database: a guardian
      // resolution right after DOES consult the derivation and DOES write a row. Without this,
      // "no rpc, no row" could be a broken counter or an audit writer aimed at nothing.
      await linkActive(GUARDIAN, STUDENT);
      await entitle(STUDENT);
      expect((await callAs(GUARDIAN, STUDENT)).status).toBe(200);
      expect(rpcCalls.map((c) => c.fn)).toEqual(["guardian_view_decision"]);
      expect(await accessRows()).toHaveLength(1);
    });

    it("GUARDIAN ALLOW — 200, via='guardian', and the row the resolver WRITES is read back", async () => {
      await linkActive(GUARDIAN, STUDENT);
      await entitle(STUDENT);

      const out = await callAs(GUARDIAN, STUDENT);
      expect(out.status).toBe(200);
      expect(out.subject).toEqual({ studentId: STUDENT, via: "guardian" });
      expect(rpcCalls).toEqual([
        {
          fn: "guardian_view_decision",
          args: { p_guardian_id: GUARDIAN, p_student_id: STUDENT },
        },
      ]);

      // The row as Postgres holds it — not as a fake `insert` captured it. Access METADATA
      // only (§12.1): the exact context key set is the privacy assertion.
      const rows = await accessRows();
      expect(rows).toEqual([
        {
          actor_profile_id: GUARDIAN,
          target_profile_id: STUDENT,
          action: "guardian_subject_access",
          changes: null,
          context: {
            decision: "allow",
            resource: `/api/students/${STUDENT}/probe`,
            via: "guardian",
            request_id: "req-subject",
          },
        },
      ]);
    });

    it("NOT LINKED — 404, never 403 (Doc 05B §10.3: a 403 confirms the student exists)", async () => {
      // The student is real and entitled; the caller simply has no link to them.
      await entitle(STUDENT);
      const out = await callAs(STRANGER, STUDENT);
      // A 403 here was the live behaviour once (`NO_LINKED_STUDENT`): an enumeration oracle.
      expect(out.status).toBe(404);
      expect(out.subject).toBeUndefined();
    });

    it("UNENTITLED — 402, the ruled deviation from 404-globally", async () => {
      // The ALLOW pair, minus the student's entitlement row and nothing else.
      await linkActive(GUARDIAN, STUDENT);
      const out = await callAs(GUARDIAN, STUDENT);
      // Owner ruling 2026-08-27 OQ1: reaching this requires already being linked, so it
      // discloses nothing; folding it into 404 silently deletes the paywall path.
      expect(out.status).toBe(402);
      expect(out.body.code).toBe("PAYMENT_REQUIRED");
      expect(out.subject).toBeUndefined();
      expect((await accessRows()).map((r) => r.context?.decision)).toEqual([
        "student_unentitled",
      ]);
    });

    it("a DENIED access is audited too — a refused read is what a log exists to reconstruct", async () => {
      await callAs(STRANGER, STUDENT);
      const rows = await accessRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor_profile_id: STRANGER,
        target_profile_id: STUDENT,
        context: expect.objectContaining({ decision: "not_linked" }),
      });
    });

    it("NON-ENUMERABLE — an unrelated real student and a nonexistent one are byte-identical", async () => {
      const real = await callAs(STRANGER, STUDENT);
      const fake = await callAs(STRANGER, NOBODY);
      // Presence first: both really are denials, so "identical" is not two empty bodies.
      expect(real.status).toBe(404);
      expect(real.body.message).toBe(
        "No such student, or you do not have access to them",
      );
      expect(real.status).toBe(fake.status);
      expect(real.body).toEqual(fake.body);
    });

    it("400 for a malformed studentId — it can name no row, so it leaks nothing and asks nothing", async () => {
      const out = await callAs(GUARDIAN, "not-a-uuid");
      expect(out.status).toBe(400);
      expect(rpcCalls).toEqual([]);
      expect(await accessRows()).toEqual([]);
    });

    it("401 when unauthenticated", async () => {
      const { resolveSubject } =
        await import("../../server/middleware/subject-resolver");
      const app = express();
      app.get("/api/students/:studentId/probe", resolveSubject, (_req, res) =>
        res.json({ ok: true }),
      );
      const res = await request(app).get(`/api/students/${STUDENT}/probe`);
      expect(res.status).toBe(401);
      expect(rpcCalls).toEqual([]);
    });

    it("THE SUBJECT CARRIES NO ROLE — a handler cannot learn who is calling", async () => {
      await linkActive(GUARDIAN, STUDENT);
      await entitle(STUDENT);
      const out = await callAs(GUARDIAN, STUDENT);
      expect(out.status).toBe(200);
      // `via` exists for the audit record, not for behaviour. Anything role-shaped beyond it
      // would be a handler's licence to branch — which the chokepoint gate also forbids
      // statically (scripts/ci/subject-resolver-chokepoint-gate.mjs, R2).
      expect(Object.keys(out.subject as object).sort()).toEqual([
        "studentId",
        "via",
      ]);
    });
  },
);
