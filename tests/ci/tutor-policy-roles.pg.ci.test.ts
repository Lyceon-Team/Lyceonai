/**
 * The tutor write policies name `authenticated`, never PUBLIC → real PostgreSQL.
 *
 * @spec [Guardian_Closure_Plan G1-09; audit G-AUD-12; Doc 03 INV-03-05 (zero guardian LISA
 *        access), Doc 03A §16 (tutor RLS is `student_id = auth.uid()`)] | @implemented [2026-09-29]
 *
 * plain English: `tutor_conversations_insert_own`, `tutor_conversations_update_own` and
 * `tutor_messages_insert_own` were created with no `TO` clause, so they apply to PUBLIC —
 * anon included. They are inert today only because no client role holds INSERT/UPDATE on the
 * tutor tables (owner check: production grants none to `authenticated`). This pins them to
 * `authenticated`, so a future grant cannot quietly hand anon a write path. Hardening only.
 *
 * Read from `pg_policies` on a database built by the real migration pipeline. The other tutor
 * write policies (`*_runtime_*`, `*_archival_*`) already name dedicated roles
 * (20260806010000_tutor_dedicated_roles.sql) and are not touched.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { bootstrapPgDatabase, PG_AVAILABLE } from "../helpers/pg-supabase";

const DB_NAME = "tutor_policy_roles_ci";
let pg: Client;

describe.skipIf(!PG_AVAILABLE)(
  "G1-09 tutor write policies are scoped to authenticated",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
    });

    afterAll(async () => {
      if (pg) await pg.end();
    });

    it("each tutor INSERT/UPDATE policy applies to authenticated only, with its predicate unchanged", async () => {
      const r = await pg.query(
        `SELECT policyname, cmd, roles::text[] AS roles, qual, with_check
         FROM pg_policies
        WHERE schemaname = 'public'
          AND policyname IN ('tutor_conversations_insert_own',
                             'tutor_conversations_update_own',
                             'tutor_messages_insert_own')
        ORDER BY policyname`,
      );
      // Presence first: the three policies exist, so the role check below is about real rows.
      expect(
        r.rows.map((row: { policyname: string }) => row.policyname),
      ).toEqual([
        "tutor_conversations_insert_own",
        "tutor_conversations_update_own",
        "tutor_messages_insert_own",
      ]);
      for (const row of r.rows as Array<{
        policyname: string;
        roles: string[];
        qual: string | null;
        with_check: string | null;
      }>) {
        expect({ policy: row.policyname, roles: row.roles }).toEqual({
          policy: row.policyname,
          roles: ["authenticated"],
        });
        const predicate = row.with_check ?? row.qual ?? "";
        expect(predicate).toContain("auth.uid()");
        expect(predicate).toContain("student_id");
      }
    });
  },
);
