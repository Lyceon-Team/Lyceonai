/**
 * The subject resolver FAILS CLOSED when the database fails → real PostgreSQL, real faults.
 *
 * @spec [Doc 05B §10.1 absence-of-policy denial, §10.3; Doc 01 V8 §14 Layer 3 audit logging;
 *   owner rulings 2026-08-26 R6 and 2026-08-27 OQ5 / owner question 1 (an unrecorded access
 *   does not happen)] | @implemented [2026-11-02]
 *
 * plain English: the second half of the split of `tests/ci/subject-resolver.contract.test.ts`.
 * That file proved three fail-closed paths by having a MOCKED `supabaseServer` return an RPC
 * error, a decision value no build recognises, and a failed audit insert. The gate's comment
 * (scripts/ci/guardian-schema-truth-gate.mjs) called these "decisions a real database cannot
 * produce". That was true of the mock's way of producing them, not of the failures themselves:
 * each one is a thing a real database does, and here a real database does it.
 *
 *   RPC ERROR       `guardian_view_decision` is replaced by a body that RAISEs (XX000), so the
 *                   call reaches Postgres and Postgres refuses it.
 *   UNKNOWN ARM     the function is replaced by one whose CASE returns a value the shared enum
 *                   does not carry — literally "a future CASE arm in the SQL nobody wired".
 *   AUDIT REFUSED   a BEFORE INSERT trigger on `audit_logs` rejects the resolver's row, so the
 *                   real writer's real insert comes back with a real error.
 *
 * The resolver, the derivation service and the audit writer run unmodified over the real
 * transport. The faults live in the SCHEMA, which is why this file has its own database
 * (`subject_resolver_faults_ci`) rather than sharing the decisions file's: every case restores
 * what it replaced in a `finally`, but a suite that rewrites functions must not be able to leak
 * a rewrite into another suite's assertions.
 *
 * THE SEED WOULD ALLOW. Each case uses the same pair — an active link and an entitled student,
 * the rows that produce `allow` — and first shows the request answering 200 before the fault is
 * injected. So the 404 / 500 that follows is the fault's doing, not a fixture that denied
 * anyway.
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

const DB_NAME = "subject_resolver_faults_ci";
const STUDENT = "5b111111-1111-4111-8111-111111111111";
const GUARDIAN = "5b222222-2222-4222-8222-222222222222";
const DECISION_FN = "public.guardian_view_decision(uuid,uuid)";
/** The same function, as CREATE OR REPLACE must spell it (argument names cannot change). */
const DECISION_SIG =
  "public.guardian_view_decision(p_guardian_id uuid, p_student_id uuid)";

let pg: Client;
/** The live definition of the derivation, captured once, re-applied after every rewrite. */
let decisionFnDef = "";

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pg);
  },
}));

type Req = express.Request & {
  user?: { id: string; role: string };
  requestId?: string;
};

async function callAsGuardian(): Promise<{
  status: number;
  subject: unknown;
}> {
  const { resolveSubject } =
    await import("../../server/middleware/subject-resolver");
  const app = express();
  app.use((req, _res, next) => {
    const r = req as Req;
    r.user = { id: GUARDIAN, role: "guardian" };
    r.requestId = "req-subject-fault";
    next();
  });
  let seen: unknown = undefined;
  app.get(
    "/api/students/:studentId/probe",
    resolveSubject,
    (req: express.Request, res: express.Response) => {
      seen = req.subject;
      res.json({ ok: true });
    },
  );
  const res = await request(app).get(`/api/students/${STUDENT}/probe`);
  return { status: res.status, subject: seen };
}

async function decisionsRecorded(): Promise<unknown[]> {
  const r = await pg.query(
    `SELECT context->>'decision' AS decision FROM public.audit_logs
      WHERE action = $1 ORDER BY created_at, id`,
    [SUBJECT_ACCESS_ACTION],
  );
  return r.rows.map((row: { decision: unknown }) => row.decision);
}

/** Run `body` with the derivation replaced by `replacement`; always put the real one back. */
async function withDecisionFunction(
  replacement: string,
  body: () => Promise<void>,
): Promise<void> {
  await pg.query(replacement);
  try {
    await body();
  } finally {
    await pg.query(decisionFnDef);
  }
}

describe.skipIf(!PG_AVAILABLE)(
  "subject resolver — fails closed on real database faults",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,'s@x.test'),($2,'g@x.test')`,
        [STUDENT, GUARDIAN],
      );
      await pg.query(
        `INSERT INTO public.profiles (id, email, role) VALUES ($1,'s@x.test','student'),($2,'g@x.test','guardian')`,
        [STUDENT, GUARDIAN],
      );
      // The rows that make the real derivation answer `allow`.
      await pg.query(
        `INSERT INTO public.guardian_links (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at, accepted_at, accepted_by_profile_id)
         VALUES ($1, $2, 'active', 'student', now(), now(), $2)`,
        [GUARDIAN, STUDENT],
      );
      await pg.query(
        `INSERT INTO public.entitlements (profile_id, tier, status) VALUES ($1, 'premium', 'active')`,
        [STUDENT],
      );
      const def = await pg.query(
        `SELECT pg_get_functiondef($1::regprocedure) AS def`,
        [DECISION_FN],
      );
      decisionFnDef = String(def.rows[0]?.def ?? "");
      expect(decisionFnDef).toContain("'student_unentitled'");
    });

    afterAll(async () => {
      if (pg) await pg.end();
    });

    beforeEach(async () => {
      await pg.query(`ALTER TABLE public.audit_logs DISABLE TRIGGER USER`);
      await pg.query(`DELETE FROM public.audit_logs`);
      await pg.query(`ALTER TABLE public.audit_logs ENABLE TRIGGER USER`);
      // CONTROL, every case: with nothing injected, this exact seed is served.
      expect((await callAsGuardian()).status).toBe(200);
      await pg.query(`ALTER TABLE public.audit_logs DISABLE TRIGGER USER`);
      await pg.query(`DELETE FROM public.audit_logs`);
      await pg.query(`ALTER TABLE public.audit_logs ENABLE TRIGGER USER`);
    });

    it("FAILS CLOSED when the derivation RPC errors — 404, and the denial is still recorded", async () => {
      await withDecisionFunction(
        `CREATE OR REPLACE FUNCTION ${DECISION_SIG}
           RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
         AS $f$ BEGIN RAISE EXCEPTION 'injected derivation failure' USING ERRCODE = 'XX000'; END $f$`,
        async () => {
          const out = await callAsGuardian();
          expect(out.status).toBe(404);
          expect(out.subject).toBeUndefined();
          expect(await decisionsRecorded()).toEqual(["not_linked"]);
        },
      );
    });

    it("FAILS CLOSED on a decision value this build does not recognise", async () => {
      // A future CASE arm in the SQL that nobody wired here must deny, not pass through.
      await withDecisionFunction(
        `CREATE OR REPLACE FUNCTION ${DECISION_SIG}
           RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
         AS $f$ SELECT 'some_new_arm'::text $f$`,
        async () => {
          const out = await callAsGuardian();
          expect(out.status).toBe(404);
          expect(out.subject).toBeUndefined();
        },
      );
    });

    it("AN UNRECORDED ACCESS DOES NOT HAPPEN — a refused audit write is a 500, not a served read", async () => {
      await pg.query(`
        CREATE OR REPLACE FUNCTION public.ci_refuse_subject_access_audit() RETURNS trigger
        LANGUAGE plpgsql AS $f$
        BEGIN RAISE EXCEPTION 'injected audit refusal' USING ERRCODE = 'XX000'; END $f$;
        CREATE TRIGGER ci_refuse_subject_access_audit BEFORE INSERT ON public.audit_logs
          FOR EACH ROW WHEN (NEW.action = '${SUBJECT_ACCESS_ACTION}')
          EXECUTE FUNCTION public.ci_refuse_subject_access_audit();
      `);
      try {
        const out = await callAsGuardian();
        // Owner question 1: months later nobody could tell "no guardian read this child's
        // data" from "the write failed". The derivation said allow; the read is still refused.
        expect(out.status).toBe(500);
        expect(out.subject).toBeUndefined();
        expect(await decisionsRecorded()).toEqual([]);
      } finally {
        await pg.query(`
          DROP TRIGGER IF EXISTS ci_refuse_subject_access_audit ON public.audit_logs;
          DROP FUNCTION IF EXISTS public.ci_refuse_subject_access_audit();
        `);
      }
    });
  },
);
