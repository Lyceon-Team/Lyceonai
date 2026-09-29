/**
 * Declarative FK delete actions — real PostgreSQL proof.
 *
 * @spec [Doc 03 §14.2 (LISA tables cascade on hard delete); Doc 03B §29.1 (the
 *        per-table list, which is the only place `tutor_injection_log` is named for
 *        cascade — §14.2's own matrix row gives injection logs a 180-day archival
 *        trigger and does not mention account deletion); Doc 05E §3 Rule 4 + §5
 *        (severance of the identity link, grouping retained under actor_id);
 *        Doc 01 V8 §40.5; owner brief 2026-09-17 "Declarative FK Actions, Not an
 *        Enumerated Cascade" step 4] | @implemented [2026-09-17]
 *
 * plain English: the account-deletion cascade enumerated table names by hand and nine
 * foreign keys into `profiles` were never added to it. `DELETE FROM profiles` therefore
 * raised for any account that had used the tutor, and the nightly job retried forever.
 * These tests drive the REAL schema on a throwaway Postgres built from
 * `supabase/migrations`, so the assertions are about what Postgres actually does with
 * the constraints, not about what a function body says.
 *
 * FK4 is the one that matters most. It adds a brand-new foreign key with no delete
 * action and no allowlist entry, and requires the guard to go red — which is the whole
 * claim of the redesign: the tenth forgotten edge is caught before merge, not in prod.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { bootstrapPgDatabase, PG_AVAILABLE } from "../helpers/pg-supabase";

const DB_NAME = "deletion_fk_actions_ci";

const SUBJECT = "aaaa1111-0000-4000-8000-00000000000a";
const ADMIN = "bbbb2222-0000-4000-8000-00000000000b";
const CONVERSATION = "cccc3333-0000-4000-8000-00000000000c";
const ASSIGNMENT = "dddd4444-0000-4000-8000-00000000000d";

let pg: Client;

/** The guard, read from the file CI runs, so the test cannot drift from the gate. */
const GUARD_SQL = fs.readFileSync(
  path.join(process.cwd(), "scripts/ci/fk-delete-action-guard.sql"),
  "utf-8",
);

/** Run the guard. Resolves to null when it passes, or the error message when it fails. */
async function runGuard(): Promise<string | null> {
  try {
    await pg.query(GUARD_SQL);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function seedProfile(id: string, email: string): Promise<void> {
  await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
    id,
    email,
  ]);
  await pg.query(
    `INSERT INTO public.profiles (id, email, role, display_name)
     VALUES ($1, $2, 'student', 'Seed')`,
    [id, email],
  );
}

/** One row in each of the seven tutor tables, as the brief specifies. */
async function seedTutorRows(): Promise<void> {
  await pg.query(
    `INSERT INTO public.tutor_conversations (id, student_id, entry_mode, source_surface, status)
     VALUES ($1, $2, 'general', 'dashboard', 'active')`,
    [CONVERSATION, SUBJECT],
  );
  await pg.query(
    `INSERT INTO public.tutor_messages (conversation_id, student_id, role, message)
     VALUES ($1, $2, 'student', 'seed message')`,
    [CONVERSATION, SUBJECT],
  );
  await pg.query(
    `INSERT INTO public.tutor_memory_summaries (student_id, summary_type, content_json)
     VALUES ($1, 'teaching_profile', $2::jsonb)`,
    [
      SUBJECT,
      JSON.stringify({
        summary_version: "1.0",
        learning_style_signals: [],
        last_struggled_skill: null,
        last_mastered_skill: null,
        engagement_summary: "seed",
      }),
    ],
  );
  await pg.query(
    `INSERT INTO public.tutor_instruction_assignments
       (id, conversation_id, student_id, policy_variant, policy_version, assignment_mode, reason_snapshot)
     VALUES ($1, $2, $3, 'concise', 'v1', 'deterministic', '{}'::jsonb)`,
    [ASSIGNMENT, CONVERSATION, SUBJECT],
  );
  await pg.query(
    `INSERT INTO public.tutor_instruction_exposures
       (assignment_id, conversation_id, student_id, exposure_type, sequence_ordinal)
     VALUES ($1, $2, $3, 'hint', 1)`,
    [ASSIGNMENT, CONVERSATION, SUBJECT],
  );
  await pg.query(
    `INSERT INTO public.tutor_question_links (conversation_id, student_id, relationship_type, reason_code)
     VALUES ($1, $2, 'current', 'seed')`,
    [CONVERSATION, SUBJECT],
  );
  await pg.query(
    `INSERT INTO public.tutor_injection_log (student_id, conversation_id, detection_layer, action_taken)
     VALUES ($1, $2, 'L1', 'blocked')`,
    [SUBJECT, CONVERSATION],
  );
}

const TUTOR_TABLES = [
  "tutor_conversations",
  "tutor_messages",
  "tutor_memory_summaries",
  "tutor_instruction_assignments",
  "tutor_instruction_exposures",
  "tutor_question_links",
] as const;

async function countBy(
  table: string,
  col: string,
  id: string,
): Promise<number> {
  const r = await pg.query(
    `SELECT count(*)::int AS n FROM public.${table} WHERE ${col} = $1`,
    [id],
  );
  return Number(r.rows[0]?.n ?? -1);
}

describe.skipIf(!PG_AVAILABLE)(
  "declarative FK delete actions — real Postgres",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
    });
    afterAll(async () => {
      if (pg) await pg.end();
    });
    beforeEach(async () => {
      await pg.query(`DELETE FROM public.tutor_injection_log`);
      await pg.query(`DELETE FROM public.tutor_instruction_exposures`);
      await pg.query(`DELETE FROM public.tutor_instruction_assignments`);
      await pg.query(`DELETE FROM public.tutor_question_links`);
      await pg.query(`DELETE FROM public.tutor_messages`);
      await pg.query(`DELETE FROM public.tutor_memory_summaries`);
      await pg.query(`DELETE FROM public.tutor_conversations`);
      await pg.query(`DELETE FROM public.practice_session_items`);
      await pg.query(`DELETE FROM public.practice_sessions`);
      await pg.query(
        `UPDATE public.auth_runtime_config SET updated_by_profile_id = NULL`,
      );
      await pg.query(`DELETE FROM public.auth_runtime_config_history`);
      await pg.query(
        `DELETE FROM public.profiles WHERE email LIKE '%@fk.test'`,
      );
      await pg.query(`DELETE FROM auth.users WHERE email LIKE '%@fk.test'`);
    });

    // ══ FK1 ═══════════════════════════════════════════════════════════════════
    it("FK1 a profile with rows in all seven tutor tables deletes, and the rows go with it", async () => {
      await seedProfile(SUBJECT, "tutor@fk.test");
      await seedTutorRows();

      // every table actually holds a row, or the test proves nothing
      for (const t of TUTOR_TABLES) {
        expect(await countBy(t, "student_id", SUBJECT)).toBe(1);
      }
      expect(await countBy("tutor_injection_log", "student_id", SUBJECT)).toBe(
        1,
      );

      // BEFORE the declarative actions this raised:
      //   update or delete on table "profiles" violates foreign key constraint
      //   "tutor_conversations_student_id_fkey" on table "tutor_conversations"
      await expect(
        pg.query(`DELETE FROM public.profiles WHERE id = $1`, [SUBJECT]),
      ).resolves.toBeDefined();

      // CASCADE, not severance: the rows are GONE, not kept with a nulled column.
      // Counting `WHERE student_id = SUBJECT` cannot tell those two apart — it reads
      // zero either way — so every table is also asserted EMPTY. An earlier version of
      // this test claimed injection-log rows survive with the link severed; that was
      // false (the edge is `c`, proven by FK5) and the count-by-student assertion could
      // not have caught it.
      for (const t of [...TUTOR_TABLES, "tutor_injection_log"]) {
        expect(await countBy(t, "student_id", SUBJECT)).toBe(0);
        const total = await pg.query(
          `SELECT count(*)::int AS n FROM public.${t}`,
        );
        expect(total.rows[0].n).toBe(0);
      }
    });

    // ══ FK2 ═══════════════════════════════════════════════════════════════════
    it("FK2 an admin who changed a config value deletes, and the config row survives with a NULL attributor", async () => {
      await seedProfile(ADMIN, "admin@fk.test");
      await pg.query(
        `UPDATE public.profiles SET role = 'admin' WHERE id = $1`,
        [ADMIN],
      );

      await pg.query(
        `UPDATE public.auth_runtime_config SET updated_by_profile_id = $1`,
        [ADMIN],
      );
      const attributed = await pg.query(
        `SELECT count(*)::int AS n FROM public.auth_runtime_config WHERE updated_by_profile_id = $1`,
        [ADMIN],
      );
      expect(Number(attributed.rows[0].n)).toBeGreaterThan(0);
      const rowsBefore = await pg.query(
        `SELECT count(*)::int AS n FROM public.auth_runtime_config`,
      );

      // Before this change the cascade raised PROFILE_HAS_OPERATIONAL_CONFIG_REFERENCES
      // and refused to delete the admin at all.
      await expect(
        pg.query(`DELETE FROM public.profiles WHERE id = $1`, [ADMIN]),
      ).resolves.toBeDefined();

      const rowsAfter = await pg.query(
        `SELECT count(*)::int AS n FROM public.auth_runtime_config`,
      );
      // the governance row SURVIVES — it loses the name, not the value
      expect(Number(rowsAfter.rows[0].n)).toBe(Number(rowsBefore.rows[0].n));
      const stillAttributed = await pg.query(
        `SELECT count(*)::int AS n FROM public.auth_runtime_config WHERE updated_by_profile_id IS NOT NULL`,
      );
      expect(Number(stillAttributed.rows[0].n)).toBe(0);
    });

    // ══ FK3 ═══════════════════════════════════════════════════════════════════
    it("FK3 activity rows survive with the identity severed and actor_id intact — both halves", async () => {
      await seedProfile(SUBJECT, "activity@fk.test");
      const actor = await pg.query(
        `SELECT actor_id FROM public.profiles WHERE id = $1`,
        [SUBJECT],
      );
      const actorId = actor.rows[0].actor_id as string;
      expect(actorId).toBeTruthy();

      await pg.query(
        `INSERT INTO public.practice_sessions
         (id, user_id, actor_id, status, mode, platform, target_count)
       VALUES (gen_random_uuid(), $1, $2, 'created', 'balanced', 'web', 10)`,
        [SUBJECT, actorId],
      );

      await pg.query(`DELETE FROM public.profiles WHERE id = $1`, [SUBJECT]);

      const row = await pg.query(
        `SELECT user_id, actor_id FROM public.practice_sessions WHERE actor_id = $1`,
        [actorId],
      );
      // BOTH halves, as the brief requires: the row is still there, the link is gone,
      // and the pseudonymous grouping key is untouched.
      expect(row.rowCount).toBe(1);
      expect(row.rows[0].user_id).toBeNull();
      expect(row.rows[0].actor_id).toBe(actorId);
    });

    // ══ FK4 — the one that stops the tenth forgotten edge ══════════════════════
    it("FK4 the guard reddens when a new FK arrives with no delete action and no allowlist entry", async () => {
      expect(await runGuard()).toBeNull(); // green on the committed tree

      await pg.query(`
      CREATE TABLE public._fk_guard_probe (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_profile_id uuid REFERENCES public.profiles(id)
      )`);

      const failure = await runGuard();
      expect(failure).not.toBeNull();
      expect(failure).toContain("FK-DELETE-ACTION FAIL [G1]");
      expect(failure).toContain("_fk_guard_probe.owner_profile_id");
      expect(failure).toContain("NO ACTION");

      await pg.query(`DROP TABLE public._fk_guard_probe`);
      expect(await runGuard()).toBeNull(); // green again once removed
    });

    // ══ FK5 ═══════════════════════════════════════════════════════════════════
    it("FK5 allowlist and handlers agree in both directions", async () => {
      // G2 (every allowlisted edge has a handler) and G3 (no edge is handled both
      // declaratively and procedurally) both run inside the guard; a pass here is a
      // pass of both. The negative direction is proven by the mutation harness, which
      // deletes a handler and requires this test to redden.
      expect(await runGuard()).toBeNull();

      // and the classification is exhaustive by construction — nothing unclassified
      const unclassified = await pg.query(`
      SELECT src.relname AS tbl, a.attname AS col, c.confdeltype AS act
        FROM pg_constraint c
        JOIN pg_class src ON src.oid = c.conrelid
        JOIN pg_namespace sn ON sn.oid = src.relnamespace
        JOIN pg_class tgt ON tgt.oid = c.confrelid
        JOIN pg_namespace tn ON tn.oid = tgt.relnamespace
        JOIN unnest(c.conkey) AS k(attnum) ON true
        JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = k.attnum
       WHERE c.contype = 'f'
         AND sn.nspname = 'public'
         AND ((tn.nspname = 'public' AND tgt.relname = 'profiles')
           OR (tn.nspname = 'auth' AND tgt.relname = 'users'))
         AND c.confdeltype NOT IN ('c','n','r','a')`);
      expect(unclassified.rowCount).toBe(0);

      // the seven tutor edges are CASCADE, not RESTRICT — the defect this closes
      const tutor = await pg.query(`
      SELECT src.relname AS tbl, c.confdeltype AS act
        FROM pg_constraint c
        JOIN pg_class src ON src.oid = c.conrelid
        JOIN pg_namespace sn ON sn.oid = src.relnamespace
        JOIN pg_class tgt ON tgt.oid = c.confrelid
       WHERE c.contype='f' AND sn.nspname='public' AND tgt.relname='profiles'
         AND src.relname LIKE 'tutor\\_%' AND src.relname NOT LIKE '%config%'
       ORDER BY src.relname`);
      expect(tutor.rowCount).toBe(7);
      for (const r of tutor.rows) expect(r.act).toBe("c");
    });

    // ══ FK6 — pins a gap, does not endorse it ═════════════════════════════════
    it("FK6 a crisis-FLAGGED conversation with no case row is cascade-deleted — the SCL-094 gap, pinned", async () => {
      // Doc 03 §14.2 gives crisis-flagged conversations their own retention rule:
      //   "Crisis-flagged conversations | 180 days (extended for safety review)
      //    | Manual purge by safety review queue owner after incident closure"
      // A declarative CASCADE cannot be conditional, so it deletes them with everyone
      // else. Where a `crisis_review_cases` row exists its RESTRICT blocks the delete
      // one level up and the conversation survives — that is the case SCL-094 holds
      // for a ruling. This test covers the OTHER case: flagged with NO case row.
      //
      // That state is reachable. `flagConversationForReview`
      // (server/services/tutor-crisis.ts) writes the flag and creates the case in TWO
      // statements, not one transaction, so a failure between them leaves a flagged
      // conversation with nothing referencing it. Production held 2 flagged
      // conversations and 2 cases with zero orphans when this was written
      // (2026-09-17), so the gap is latent, not live.
      //
      // The assertion below records what the schema DOES, so the gap is visible on
      // every CI run rather than discovered after an erasure. It reddens the moment a
      // ruling changes the behaviour, which is the point.
      await seedProfile(SUBJECT, "crisisflag@fk.test");
      await pg.query(
        `INSERT INTO public.tutor_conversations
           (id, student_id, entry_mode, source_surface, status, crisis_flagged)
         VALUES ($1, $2, 'general', 'dashboard', 'active', true)`,
        [CONVERSATION, SUBJECT],
      );
      const orphan = await pg.query(
        `SELECT count(*)::int AS n FROM public.crisis_review_cases WHERE conversation_id = $1`,
        [CONVERSATION],
      );
      expect(orphan.rows[0].n).toBe(0); // no case row — this is the uncovered shape

      await pg.query(`DELETE FROM public.profiles WHERE id = $1`, [SUBJECT]);

      const left = await pg.query(
        `SELECT count(*)::int AS n FROM public.tutor_conversations WHERE id = $1`,
        [CONVERSATION],
      );
      expect(left.rows[0].n).toBe(0);
    });
  },
);
