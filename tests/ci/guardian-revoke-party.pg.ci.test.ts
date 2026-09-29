/**
 * The revoke function refuses a non-party, and every client role's EXECUTE is revoked by name.
 *
 * @spec [Guardian_Closure_Plan G1-07 named proof (PG half); audit G-AUD-10; Doc-01 V8 §36.3]
 * | @implemented [2026-09-29]
 *
 * plain English: calls `revoke_guardian_link_audited` directly, on a real database with every
 * migration applied, as the service role would. A caller that is neither the guardian nor the
 * student on the link must be refused BEFORE anything is written — no status change, no audit
 * row, no notification. The two real parties still revoke normally.
 *
 * GRANTS. A throwaway Postgres has no platform default privileges, so "REVOKE ... FROM PUBLIC"
 * alone already reads f/f/f/t here — which is exactly why it looked safe and was not in
 * production. So the grants case first SIMULATES the platform default (EXECUTE granted to
 * anon and authenticated on all six functions), re-applies the migration under test, and only
 * then reads `has_function_privilege`. Only the migration's explicit per-role REVOKEs can make
 * that pass.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bootstrapPgDatabase, PG_AVAILABLE } from "../helpers/pg-supabase";

const DB_NAME = "guardian_revoke_party_ci";
const GUARDIAN = "f1111111-1111-4111-8111-111111111111";
const STUDENT = "f2222222-2222-4222-8222-222222222222";
const OUTSIDER = "f3333333-3333-4333-8333-333333333333";
const MIGRATION = resolve(
  __dirname,
  "../../supabase/migrations/20261013000000_guardian_revoke_party_check.sql",
);

const SIGNATURES = [
  "public.guardian_view_decision(uuid,uuid)",
  "public.guardian_can_view_student_as(uuid,uuid)",
  "public.guardian_can_view_student(uuid)",
  "public.guardian_link_audit(text,uuid,uuid,jsonb,uuid,text)",
  "public.create_active_guardian_link_audited(uuid,uuid,text)",
  "public.revoke_guardian_link_audited(uuid,uuid,uuid,text,text)",
] as const;

let pg: Client;

async function linkStatus(): Promise<string> {
  const r = await pg.query(
    `SELECT status FROM public.guardian_links WHERE guardian_profile_id=$1 AND student_profile_id=$2`,
    [GUARDIAN, STUDENT],
  );
  return r.rows[0].status as string;
}

async function count(sql: string): Promise<number> {
  const r = await pg.query(sql);
  return r.rows[0].c as number;
}

describe.skipIf(!PG_AVAILABLE)(
  "G1-07 revoke party check and explicit grants",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,'g@x.test'),($2,'s@x.test'),($3,'o@x.test')`,
        [GUARDIAN, STUDENT, OUTSIDER],
      );
      await pg.query(
        `INSERT INTO public.profiles (id, email, role) VALUES
         ($1,'g@x.test','guardian'),($2,'s@x.test','student'),($3,'o@x.test','guardian')`,
        [GUARDIAN, STUDENT, OUTSIDER],
      );
    });

    afterAll(async () => {
      if (pg) await pg.end();
    });

    beforeEach(async () => {
      await pg.query(`DELETE FROM public.guardian_links`);
      await pg.query(`DELETE FROM public.notification_events`);
      await pg.query(
        `INSERT INTO public.guardian_links (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at, accepted_at)
       VALUES ($1, $2, 'active', 'student', now(), now())`,
        [GUARDIAN, STUDENT],
      );
    });

    it("a non-party revoke is refused (LY005) and writes nothing", async () => {
      const auditBefore = await count(
        `SELECT count(*)::int AS c FROM public.audit_logs WHERE action='guardian_link_revoked'`,
      );

      await expect(
        pg.query(
          `SELECT public.revoke_guardian_link_audited($1, $2, $3, 'not mine', 'g1-07')`,
          [GUARDIAN, STUDENT, OUTSIDER],
        ),
      ).rejects.toMatchObject({ code: "LY005" });

      expect(await linkStatus()).toBe("active");
      expect(
        await count(
          `SELECT count(*)::int AS c FROM public.audit_logs WHERE action='guardian_link_revoked'`,
        ),
      ).toBe(auditBefore);
      expect(
        await count(
          `SELECT count(*)::int AS c FROM public.notification_events WHERE event_type='guardian_unlinked'`,
        ),
      ).toBe(0);
    });

    it("a NULL revoker is not a party", async () => {
      await expect(
        pg.query(`SELECT public.revoke_guardian_link_audited($1, $2, NULL)`, [
          GUARDIAN,
          STUDENT,
        ]),
      ).rejects.toMatchObject({ code: "LY005" });
      expect(await linkStatus()).toBe("active");
    });

    it.each([
      ["the guardian", GUARDIAN],
      ["the student", STUDENT],
    ])("%s may still revoke", async (_who, revoker) => {
      await pg.query(`SELECT public.revoke_guardian_link_audited($1, $2, $3)`, [
        GUARDIAN,
        STUDENT,
        revoker,
      ]);
      expect(await linkStatus()).toBe("revoked");
    });

    it("grants read f/f/f/t (guardian_can_view_student: f/f/t/t) even after a platform-style default grant", async () => {
      // Simulate Supabase's default privileges on new functions in `public`.
      for (const sig of SIGNATURES) {
        await pg.query(
          `GRANT EXECUTE ON FUNCTION ${sig} TO anon, authenticated`,
        );
      }
      await pg.query(readFileSync(MIGRATION, "utf8"));

      const r = await pg.query(
        `SELECT sig,
              has_function_privilege('public',        sig::regprocedure, 'EXECUTE') AS p,
              has_function_privilege('anon',          sig::regprocedure, 'EXECUTE') AS a,
              has_function_privilege('authenticated', sig::regprocedure, 'EXECUTE') AS u,
              has_function_privilege('service_role',  sig::regprocedure, 'EXECUTE') AS s
         FROM unnest($1::text[]) AS sig`,
        [SIGNATURES as unknown as string[]],
      );
      const got = Object.fromEntries(
        r.rows.map(
          (row: {
            sig: string;
            p: boolean;
            a: boolean;
            u: boolean;
            s: boolean;
          }) => [
            row.sig,
            [row.p, row.a, row.u, row.s].map((b) => (b ? "t" : "f")).join("/"),
          ],
        ),
      );
      expect(got).toEqual({
        "public.guardian_view_decision(uuid,uuid)": "f/f/f/t",
        "public.guardian_can_view_student_as(uuid,uuid)": "f/f/f/t",
        "public.guardian_can_view_student(uuid)": "f/f/t/t",
        "public.guardian_link_audit(text,uuid,uuid,jsonb,uuid,text)": "f/f/f/t",
        "public.create_active_guardian_link_audited(uuid,uuid,text)": "f/f/f/t",
        "public.revoke_guardian_link_audited(uuid,uuid,uuid,text,text)":
          "f/f/f/t",
      });
    });
  },
);
