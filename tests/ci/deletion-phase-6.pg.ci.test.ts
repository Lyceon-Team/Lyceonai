/**
 * Deletion Phase 6 — crisis severance, and the deletion verification record.
 *
 * @spec [Doc 03 §21 + §14.2 via owner ruling A6 2026-09-17 (crisis records survive
 *        pseudonymously); Doc 06D §6.2/§6.3/§6.5 INV-06-08 as amended by owner rulings
 *        A2/A4/B2/B3 2026-09-17; Doc 05E §3 Rule 4 + §5; owner brief 2026-09-17
 *        "Deletion Vertical — Owner Rulings + Phase 6"] | @implemented [2026-09-18]
 *
 * plain English: two things that were true before this phase and must stop being true.
 *
 * ONE — a student whose tutor conversation was ever flagged for crisis review could not be
 * deleted. `tutor_conversations` CASCADEs from `profiles` since the declarative-FK pass, but
 * `crisis_review_cases.conversation_id` was ON DELETE RESTRICT, so the cascade hit a wall one
 * level up and `DELETE FROM profiles` raised. Two of 117 production profiles are in exactly
 * that state. P6.1 is that account, and it FAILS on the tree before the migration — observed,
 * not assumed.
 *
 * TWO — nothing recorded that a deletion had been verified. Doc 06D §6.2 asks for a
 * verification record; there was no table. P6.3 and P6.4 pin the one built here, including the
 * property that makes it safe to keep: it is written in T3, so it shares a transaction id with
 * nothing on the `actor_id` side.
 *
 * P6.6 is the one that earns the dead-profile-uuid carve-out rather than asserting it. The
 * verification record keeps the deleted profile's uuid so the conformance job can re-scan for
 * it and confirm absence — which is the difference between recording a pass and being able to
 * re-derive one. That is only sound if no RETAINED row still carries that uuid, so the test
 * sweeps every uuid column in the schema and proves it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { bootstrapPgDatabase, PG_AVAILABLE } from "../helpers/pg-supabase";

const DB_NAME = "deletion_phase_6_ci";

const SUBJECT = "a6a6a6a6-0000-4000-8000-00000000000a";
const REVIEWER = "b6b6b6b6-0000-4000-8000-00000000000b";
const CONVERSATION = "c6c6c6c6-0000-4000-8000-00000000000c";
const CASE_ID = "d6d6d6d6-0000-4000-8000-00000000000d";

let pg: Client;

const GUARD_SQL = fs.readFileSync(
  path.join(process.cwd(), "scripts/ci/fk-delete-action-guard.sql"),
  "utf-8",
);

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

/**
 * A student with a crisis-flagged conversation and an open review case — the exact shape
 * that cannot be deleted before this phase, and the shape production holds twice.
 */
async function seedFlaggedStudentWithCase(): Promise<void> {
  await seedProfile(SUBJECT, "flagged@p6.test");
  await seedProfile(REVIEWER, "reviewer@p6.test");
  await pg.query(
    `INSERT INTO public.tutor_conversations
       (id, student_id, entry_mode, source_surface, status, crisis_flagged)
     VALUES ($1, $2, 'general', 'dashboard', 'active', true)`,
    [CONVERSATION, SUBJECT],
  );
  await pg.query(
    `INSERT INTO public.crisis_review_cases
       (id, conversation_id, student_id, source, status, sla_deadline)
     VALUES ($1, $2, $3, 'signature', 'open', now() + interval '48 hours')`,
    [CASE_ID, CONVERSATION, SUBJECT],
  );
  // The reviewer looked at it. This row carries the DENORMALIZED conversation_id — the copy
  // that walks around the severance on the case row if nothing severs it too.
  await pg.query(
    `INSERT INTO public.crisis_review_audit_log
       (case_id, conversation_id, reviewer_id, action)
     VALUES ($1, $2, $3, 'viewed')`,
    [CASE_ID, CONVERSATION, REVIEWER],
  );
}

describe.skipIf(!PG_AVAILABLE)(
  "deletion phase 6 — crisis severance + verification record",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
    }, 180_000);

    afterAll(async () => {
      await pg?.end();
    });

    beforeEach(async () => {
      await pg.query(`DELETE FROM public.crisis_review_audit_log`);
      await pg.query(`DELETE FROM public.crisis_review_cases`);
      await pg.query(`DELETE FROM public.tutor_conversations`);
      await pg.query(
        `DELETE FROM public.profiles WHERE email LIKE '%@p6.test'`,
      );
      await pg.query(`DELETE FROM auth.users WHERE email LIKE '%@p6.test'`);
    });

    // ══ P6.1 — the production blocker ══════════════════════════════════════════
    it("P6.1 a student with a crisis-flagged conversation and an open case deletes", async () => {
      await seedFlaggedStudentWithCase();

      // BEFORE this phase this raised, observed on the tree at 12:26 UTC 2026-09-18:
      //   update or delete on table "profiles" violates foreign key constraint
      //   "crisis_review_cases_student_id_fkey" on table "crisis_review_cases"
      // `student_id` RESTRICT is simply hit first; `conversation_id` RESTRICT is the second
      // wall behind it, reached once the first is cleared, because the tutor CASCADE tries to
      // take the conversation the case still points at. Both had to go.
      await expect(
        pg.query(`DELETE FROM public.profiles WHERE id = $1`, [SUBJECT]),
      ).resolves.toBeDefined();

      const profile = await pg.query(
        `SELECT count(*)::int AS n FROM public.profiles WHERE id = $1`,
        [SUBJECT],
      );
      expect(profile.rows[0].n).toBe(0);
    });

    // ══ P6.2 — the record survives, every link to it severed ═══════════════════
    it("P6.2 the crisis case survives the deletion with BOTH links severed, and the denormalized copy with it", async () => {
      await seedFlaggedStudentWithCase();
      await pg.query(`DELETE FROM public.profiles WHERE id = $1`, [SUBJECT]);

      const kase = await pg.query(
        `SELECT student_id, conversation_id, status, source, sla_deadline
           FROM public.crisis_review_cases WHERE id = $1`,
        [CASE_ID],
      );
      // The safety record is still here — severity, status and SLA intact.
      expect(kase.rowCount).toBe(1);
      expect(kase.rows[0].student_id).toBeNull();
      expect(kase.rows[0].conversation_id).toBeNull();
      expect(kase.rows[0].status).toBe("open");
      expect(kase.rows[0].source).toBe("signature");
      expect(kase.rows[0].sla_deadline).not.toBeNull();

      // THE CHOKEPOINT. `crisis_review_audit_log.conversation_id` is a denormalized uuid with
      // no foreign key, so no declarative action can reach it. Left alone, the value nulled on
      // the case row is recoverable with one join on case_id, and the severance above is
      // decoration. It must be severed procedurally, the way the device fingerprint is.
      const auditRows = await pg.query(
        `SELECT case_id, conversation_id, reviewer_id FROM public.crisis_review_audit_log`,
      );
      expect(auditRows.rowCount).toBe(1);
      expect(auditRows.rows[0].case_id).toBe(CASE_ID);
      expect(auditRows.rows[0].conversation_id).toBeNull();
      // the reviewer is a different identity and was NOT deleted — their attribution stays
      expect(auditRows.rows[0].reviewer_id).toBe(REVIEWER);

      // and the conversation itself is gone, cascaded with the profile
      const convo = await pg.query(
        `SELECT count(*)::int AS n FROM public.tutor_conversations`,
      );
      expect(convo.rows[0].n).toBe(0);
    });

    // ══ P6.3 — deleting a REVIEWER severs admin attribution, keeps the trail ═══
    it("P6.3 deleting the reviewer severs their attribution and leaves the audit trail standing", async () => {
      await seedFlaggedStudentWithCase();
      await pg.query(`DELETE FROM public.profiles WHERE id = $1`, [REVIEWER]);

      const auditRows = await pg.query(
        `SELECT case_id, reviewer_id FROM public.crisis_review_audit_log`,
      );
      expect(auditRows.rowCount).toBe(1);
      expect(auditRows.rows[0].reviewer_id).toBeNull();
      expect(auditRows.rows[0].case_id).toBe(CASE_ID);

      // the student is untouched — deleting an admin must not disturb a live account
      const kase = await pg.query(
        `SELECT student_id FROM public.crisis_review_cases WHERE id = $1`,
        [CASE_ID],
      );
      expect(kase.rows[0].student_id).toBe(SUBJECT);
    });

    // ══ P6.4 — the guard, with crisis no longer allowlisted ════════════════════
    it("P6.4 the FK guard passes with the crisis tables OUT of the allowlist", async () => {
      expect(await runGuard()).toBeNull();

      // and no crisis edge is RESTRICT any more — the reason they were allowlisted is gone
      const edges = await pg.query(`
        SELECT src.relname AS tbl, a.attname AS col, c.confdeltype::text AS act
          FROM pg_constraint c
          JOIN pg_class src ON src.oid = c.conrelid
          JOIN pg_namespace sn ON sn.oid = src.relnamespace
          JOIN unnest(c.conkey) AS k(attnum) ON true
          JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = k.attnum
         WHERE c.contype = 'f' AND sn.nspname = 'public'
           AND src.relname LIKE 'crisis_review%'
         ORDER BY 1, 2`);
      const byKey = Object.fromEntries(
        edges.rows.map((r) => [`${r.tbl}.${r.col}`, r.act]),
      );
      expect(byKey["crisis_review_cases.student_id"]).toBe("n");
      expect(byKey["crisis_review_cases.conversation_id"]).toBe("n");
      expect(byKey["crisis_review_cases.reviewer_id"]).toBe("n");
      expect(byKey["crisis_review_audit_log.reviewer_id"]).toBe("n");
      // case_id stays RESTRICT on purpose: the case survives, so nothing should cascade
      // the audit trail away with it.
      expect(byKey["crisis_review_audit_log.case_id"]).toBe("r");

      // the three columns had to lose NOT NULL, or SET NULL raises at delete time
      const nullability = await pg.query(`
        SELECT table_name, column_name, is_nullable
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND (table_name, column_name) IN (
             ('crisis_review_cases','student_id'),
             ('crisis_review_cases','conversation_id'),
             ('crisis_review_audit_log','reviewer_id'))`);
      expect(nullability.rowCount).toBe(3);
      for (const r of nullability.rows) expect(r.is_nullable).toBe("YES");
    });

    // ══ P6.5 — the verification record, written in T3 ══════════════════════════
    it("P6.5 a verification record is written, keyed on log_id, terminal, with a content hash", async () => {
      const log = await pg.query(
        `INSERT INTO public.deletion_request_log
           (subject_email, requester_email, request_channel, requested_on, status)
         VALUES ('p6@p6.test', 'p6@p6.test', 'self_service_web', current_date, 'completed')
         RETURNING log_id`,
      );
      const logId = log.rows[0].log_id as string;
      const deadProfile = SUBJECT;

      const layers = {
        identity: { verified: true, out_of_scope: false },
        mastery: { verified: true, out_of_scope: false },
        lisa: { verified: true, out_of_scope: false },
        analytics: {
          verified: false,
          out_of_scope: true,
          out_of_scope_reason: "Doc 07 forward-ref",
        },
      };

      const res = await pg.query(
        `SELECT public.record_deletion_verification($1, $2::jsonb, $3, $4) AS r`,
        [logId, JSON.stringify(layers), "pass", deadProfile],
      );
      expect(res.rows[0].r).toBe(logId);

      const row = await pg.query(
        `SELECT log_id, verification_outcome, layers_verified::text AS layers_text,
                proof_manifest_ref, deleted_profile_id
           FROM public.deletion_verification_records WHERE log_id = $1`,
        [logId],
      );
      expect(row.rowCount).toBe(1);
      expect(row.rows[0].verification_outcome).toBe("pass");
      expect(row.rows[0].deleted_profile_id).toBe(deadProfile);

      // B3 as ruled: the manifest IS this record, and proof_manifest_ref is a SHA-256 over
      // its canonicalised form. Recomputing it here proves the hash is derived, not decorative.
      // jsonb's own text rendering, not a re-serialisation: jsonb normalises key order and
      // whitespace, so the digest is stable whatever order the caller wrote the layers in.
      const canonical = [
        row.rows[0].log_id,
        row.rows[0].verification_outcome,
        row.rows[0].layers_text,
        row.rows[0].deleted_profile_id,
      ].join("\n");
      const expected =
        "sha256:" +
        crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
      expect(row.rows[0].proof_manifest_ref).toBe(expected);
    });

    // ══ P6.6 — the carve-out, proven rather than asserted ══════════════════════
    it("P6.6 the deleted profile's uuid survives ONLY on the evidence side — every retained uuid column swept", async () => {
      await seedFlaggedStudentWithCase();

      // `audit_logs` is the case this sweep exists for, and it has to be SEEDED or the sweep
      // passes vacuously. Its two profile columns lost their foreign keys (SCL-002 Q6), so
      // nothing declarative severs them — only `apply_audit_logs_retention('strip_identity')`,
      // called from the cascade, does. An earlier version of this test deleted the profile and
      // swept without ever writing an audit row, so it was green while proving nothing; the
      // mutation harness caught that (M32 planted a broken strip and this test stayed green).
      await pg.query(
        `INSERT INTO public.audit_logs (actor_profile_id, target_profile_id, action)
         VALUES ($1, $1, 'profile_soft_deleted')`,
        [SUBJECT],
      );

      await pg.query(`DELETE FROM public.profiles WHERE id = $1`, [SUBJECT]);
      // the same call the cascade makes — the only path that clears those two columns
      await pg.query(
        `SELECT public.apply_audit_logs_retention('strip_identity', $1)`,
        [SUBJECT],
      );

      const log = await pg.query(
        `INSERT INTO public.deletion_request_log
           (subject_email, requester_email, request_channel, requested_on, status)
         VALUES ('sweep@p6.test', 'sweep@p6.test', 'self_service_web', current_date, 'completed')
         RETURNING log_id`,
      );
      await pg.query(
        `SELECT public.record_deletion_verification($1, $2::jsonb, 'pass', $3)`,
        [
          log.rows[0].log_id,
          JSON.stringify({ identity: { verified: true, out_of_scope: false } }),
          SUBJECT,
        ],
      );

      // Every uuid column in the public schema, swept for the dead profile's id. The carve-out
      // is sound only if the answer is "the verification record, and nothing else".
      const uuidCols = await pg.query(`
        SELECT c.table_name, c.column_name
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         WHERE c.table_schema = 'public' AND c.data_type = 'uuid'
           AND t.table_type = 'BASE TABLE'
         ORDER BY 1, 2`);
      expect(uuidCols.rowCount).toBeGreaterThan(20);

      const holders: string[] = [];
      for (const { table_name, column_name } of uuidCols.rows) {
        const hit = await pg.query(
          `SELECT count(*)::int AS n FROM public."${table_name}" WHERE "${column_name}" = $1`,
          [SUBJECT],
        );
        if (hit.rows[0].n > 0) holders.push(`${table_name}.${column_name}`);
      }
      expect(holders).toEqual([
        "deletion_verification_records.deleted_profile_id",
      ]);
    });
  },
);
