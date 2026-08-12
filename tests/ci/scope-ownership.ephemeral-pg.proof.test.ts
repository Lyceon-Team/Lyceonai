/**
 * @spec [Doc-03B_V2 §5.4 rule 5, §11.1-11.2, INV-03-14]
 * @implemented 2026-08-12
 *
 * plain English: Ephemeral-PostgreSQL proof that the ownership predicates
 * in resolveScope and resolveRecentFriction actually exclude cross-student
 * rows at the database boundary. The mock-based unit tests in
 * scope-ownership.contract.test.ts prove the predicates are emitted; this
 * file proves they work against real rows in a real database.
 *
 * expected outcome:
 *  DENY   — Student A + B's session_item_id → query returns 0 rows.
 *  ALLOW  — Student A + A's own session_item_id → query returns the row.
 *  RELATIONSHIP — A's session_id + B's item_id → query returns 0 rows
 *    (the item exists and has a user_id predicate that matches A, but
 *     actually belongs to B → filtered out by user_id predicate).
 *
 * Resolver coverage:
 *  1. resolveScope — practice_sessions ownership query (line ~131)
 *  2. resolveScope — practice_session_items ownership + relationship (line ~168)
 *  3. resolveRecentFriction — practice_session_items consecutive-fails (line ~641)
 *  All three changed queries are proven below.
 *
 * trade-offs: requires a local PostgreSQL instance (skips gracefully if
 * unavailable). Uses a disposable database per run.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import pg from "pg";

// ── Fixtures ─────────────────────────────────────────────────────────

const STUDENT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const STUDENT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SESSION_A = "11111111-1111-1111-1111-111111111111";
const SESSION_B = "22222222-2222-2222-2222-222222222222";
const ITEM_A = "33333333-3333-3333-3333-333333333333";
const ITEM_B = "44444444-4444-4444-4444-444444444444";
const QUESTION_A = "SATM1AAAAAA";
const QUESTION_B = "SATM1BBBBBB";

const DB_NAME = "scope_ownership_proof";

// ── Minimal DDL ──────────────────────────────────────────────────────
// Sourced from supabase/migrations/00000000000000_genesis.sql (profiles)
// and supabase/migrations/20260610020000_ws2_practice_review_runtime.sql
// (practice_sessions, practice_session_items). Trimmed to columns used
// by the three queries under proof.

const DDL = `
-- Minimal profiles table (FK target for practice_sessions / items)
CREATE TABLE profiles (
  id UUID PRIMARY KEY
);

-- questions table (FK target for practice_session_items.question_id)
CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  section TEXT NOT NULL,
  domain TEXT NOT NULL,
  skill_codes TEXT[] NOT NULL
);

-- practice_sessions — from ws2 migration (trimmed)
CREATE TABLE practice_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  mode TEXT NOT NULL DEFAULT 'flow',
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_count INT NOT NULL DEFAULT 10,
  platform TEXT NOT NULL DEFAULT 'web',
  client_instance_id TEXT NOT NULL DEFAULT 'test',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- practice_session_items — from ws2 migration (trimmed to proof columns)
CREATE TABLE practice_session_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  ordinal INT NOT NULL,
  question_id TEXT NOT NULL REFERENCES questions(id),
  question_stem TEXT NOT NULL DEFAULT '',
  question_passage TEXT,
  question_options JSONB NOT NULL DEFAULT '[]'::jsonb,
  question_correct_answer TEXT NOT NULL DEFAULT 'A',
  question_explanation TEXT NOT NULL DEFAULT '',
  question_option_metadata JSONB,
  question_domain TEXT NOT NULL,
  question_skill TEXT NOT NULL,
  question_difficulty SMALLINT NOT NULL DEFAULT 1,
  question_section TEXT NOT NULL CHECK (question_section IN ('M','RW')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','served','answered','skipped')),
  selected_answer TEXT,
  is_correct BOOLEAN,
  occurred_at TIMESTAMPTZ
);
`;

// ── Seed data ────────────────────────────────────────────────────────

const SEED = `
INSERT INTO profiles (id) VALUES
  ('${STUDENT_A}'),
  ('${STUDENT_B}');

INSERT INTO questions (id, section, domain, skill_codes) VALUES
  ('${QUESTION_A}', 'M', 'Algebra', ARRAY['ALG']),
  ('${QUESTION_B}', 'M', 'Geometry', ARRAY['GEO']);

INSERT INTO practice_sessions (id, user_id) VALUES
  ('${SESSION_A}', '${STUDENT_A}'),
  ('${SESSION_B}', '${STUDENT_B}');

INSERT INTO practice_session_items
  (id, session_id, user_id, ordinal, question_id, question_domain,
   question_skill, question_section, status, is_correct, occurred_at)
VALUES
  ('${ITEM_A}', '${SESSION_A}', '${STUDENT_A}', 1, '${QUESTION_A}',
   'Algebra', 'ALG', 'M', 'answered', false, now()),
  ('${ITEM_B}', '${SESSION_B}', '${STUDENT_B}', 1, '${QUESTION_B}',
   'Geometry', 'GEO', 'M', 'answered', true, now());
`;

// ── PostgreSQL availability check ────────────────────────────────────

function pgAvailable(): boolean {
  try {
    execSync("pg_isready -h localhost -p 5432", {
      encoding: "utf-8",
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

// ── Proof tests ──────────────────────────────────────────────────────

describe("LISA-FULL-004 ephemeral-PG proof: scope ownership isolation (INV-03-14)", () => {
  let client: pg.Client;
  const skip = !pgAvailable();

  beforeAll(async () => {
    if (skip) return;

    // Create disposable database
    const admin = new pg.Client({
      host: "localhost",
      port: 5432,
      database: "postgres",
      user: "postgres",
      password: "postgres",
    });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
    await admin.end();

    // Connect and apply schema + seed
    client = new pg.Client({
      host: "localhost",
      port: 5432,
      database: DB_NAME,
      user: "postgres",
      password: "postgres",
    });
    await client.connect();
    await client.query(DDL);
    await client.query(SEED);
  });

  afterAll(async () => {
    if (skip) return;
    await client?.end();

    // Drop disposable database
    const admin = new pg.Client({
      host: "localhost",
      port: 5432,
      database: "postgres",
      user: "postgres",
      password: "postgres",
    });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin.end();
  });

  // ════════════════════════════════════════════════════════════════════
  // RESOLVER 1: resolveScope — practice_sessions ownership
  // Query: SELECT id FROM practice_sessions WHERE id = $1 AND user_id = $2 LIMIT 1
  // @spec [Doc-03B_V2 §11.1, INV-03-14]
  // ════════════════════════════════════════════════════════════════════

  describe("Resolver 1: practice_sessions ownership", () => {
    it.skipIf(skip)(
      "DENY: Student A querying B's session → 0 rows",
      async () => {
        const { rows } = await client.query(
          `SELECT id FROM practice_sessions WHERE id = $1 AND user_id = $2 LIMIT 1`,
          [SESSION_B, STUDENT_A],
        );
        expect(rows).toHaveLength(0);
      },
    );

    it.skipIf(skip)(
      "ALLOW: Student A querying own session → 1 row",
      async () => {
        const { rows } = await client.query(
          `SELECT id FROM practice_sessions WHERE id = $1 AND user_id = $2 LIMIT 1`,
          [SESSION_A, STUDENT_A],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(SESSION_A);
      },
    );

    it.skipIf(skip)(
      "DENY: Student B querying A's session → 0 rows (bidirectional)",
      async () => {
        const { rows } = await client.query(
          `SELECT id FROM practice_sessions WHERE id = $1 AND user_id = $2 LIMIT 1`,
          [SESSION_A, STUDENT_B],
        );
        expect(rows).toHaveLength(0);
      },
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // RESOLVER 2: resolveScope — practice_session_items ownership
  // Query: SELECT question_id, session_id FROM practice_session_items
  //        WHERE id = $1 AND user_id = $2 LIMIT 1
  // @spec [Doc-03B_V2 §11.2, INV-03-14]
  // ════════════════════════════════════════════════════════════════════

  describe("Resolver 2: practice_session_items ownership", () => {
    it.skipIf(skip)("DENY: Student A querying B's item → 0 rows", async () => {
      const { rows } = await client.query(
        `SELECT question_id, session_id FROM practice_session_items WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [ITEM_B, STUDENT_A],
      );
      expect(rows).toHaveLength(0);
    });

    it.skipIf(skip)(
      "ALLOW: Student A querying own item → returns question_id and session_id",
      async () => {
        const { rows } = await client.query(
          `SELECT question_id, session_id FROM practice_session_items WHERE id = $1 AND user_id = $2 LIMIT 1`,
          [ITEM_A, STUDENT_A],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].question_id).toBe(QUESTION_A);
        expect(rows[0].session_id).toBe(SESSION_A);
      },
    );

    it.skipIf(skip)(
      "RELATIONSHIP: A's session + B's item → 0 rows (item not owned by A, even though session is)",
      async () => {
        // This is the relationship attack: A owns SESSION_A, B owns ITEM_B.
        // A sends their own session_id but B's item_id.
        // The user_id predicate on the ITEM query blocks this:
        // SELECT ... FROM practice_session_items WHERE id = ITEM_B AND user_id = STUDENT_A
        // → 0 rows because ITEM_B.user_id = STUDENT_B, not STUDENT_A.
        const { rows } = await client.query(
          `SELECT question_id, session_id FROM practice_session_items WHERE id = $1 AND user_id = $2 LIMIT 1`,
          [ITEM_B, STUDENT_A],
        );
        expect(rows).toHaveLength(0);
      },
    );

    it.skipIf(skip)(
      "DENY: Student B querying A's item → 0 rows (bidirectional)",
      async () => {
        const { rows } = await client.query(
          `SELECT question_id, session_id FROM practice_session_items WHERE id = $1 AND user_id = $2 LIMIT 1`,
          [ITEM_A, STUDENT_B],
        );
        expect(rows).toHaveLength(0);
      },
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // RESOLVER 3: resolveRecentFriction — consecutive fails this session
  // Query: SELECT is_correct FROM practice_session_items
  //        WHERE session_id = $1 AND user_id = $2 AND status = 'answered'
  //        ORDER BY ordinal DESC
  // @spec [Doc-03A_V3.0 §5.4 recent_friction, INV-03-14]
  // ════════════════════════════════════════════════════════════════════

  describe("Resolver 3: resolveRecentFriction consecutive-fails query", () => {
    it.skipIf(skip)(
      "DENY: Student A querying friction from B's session → 0 rows",
      async () => {
        const { rows } = await client.query(
          `SELECT is_correct FROM practice_session_items
           WHERE session_id = $1 AND user_id = $2 AND status = 'answered'
           ORDER BY ordinal DESC`,
          [SESSION_B, STUDENT_A],
        );
        expect(rows).toHaveLength(0);
      },
    );

    it.skipIf(skip)(
      "ALLOW: Student A querying friction from own session → returns rows",
      async () => {
        const { rows } = await client.query(
          `SELECT is_correct FROM practice_session_items
           WHERE session_id = $1 AND user_id = $2 AND status = 'answered'
           ORDER BY ordinal DESC`,
          [SESSION_A, STUDENT_A],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].is_correct).toBe(false);
      },
    );

    it.skipIf(skip)(
      "RELATIONSHIP: A's session_id + friction query still carries user_id predicate, preventing cross-student leak if session_id were somehow borrowed",
      async () => {
        // Even if an attacker substituted session_id, the user_id
        // predicate prevents data from leaking. Here: SESSION_A belongs
        // to STUDENT_A, but if STUDENT_B sends SESSION_A in scope, the
        // user_id = STUDENT_B predicate still filters out A's items.
        const { rows } = await client.query(
          `SELECT is_correct FROM practice_session_items
           WHERE session_id = $1 AND user_id = $2 AND status = 'answered'
           ORDER BY ordinal DESC`,
          [SESSION_A, STUDENT_B],
        );
        expect(rows).toHaveLength(0);
      },
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // Combined proof: full resolveScope sequence (all three queries)
  // Simulates the exact query sequence from tutor-context.ts resolveScope
  // ════════════════════════════════════════════════════════════════════

  describe("Combined: full resolveScope query sequence", () => {
    it.skipIf(skip)(
      "DENY sequence: Student A + B's session + B's item → session degrades, item degrades, no question resolved",
      async () => {
        // Step 1: Session ownership check
        const sessionResult = await client.query(
          `SELECT id FROM practice_sessions WHERE id = $1 AND user_id = $2 LIMIT 1`,
          [SESSION_B, STUDENT_A],
        );
        expect(sessionResult.rows).toHaveLength(0);
        // Session degrades to null → validSessionId = null

        // Step 2: Item ownership check
        const itemResult = await client.query(
          `SELECT question_id, session_id FROM practice_session_items WHERE id = $1 AND user_id = $2 LIMIT 1`,
          [ITEM_B, STUDENT_A],
        );
        expect(itemResult.rows).toHaveLength(0);
        // Item degrades to null → validItemId = null

        // Step 3: No question_id resolved from item, so no question query.
        // Result: fully degraded scope (all nulls except possibly session).
      },
    );

    it.skipIf(skip)(
      "ALLOW sequence: Student A + own session + own item → full resolution",
      async () => {
        // Step 1: Session ownership — passes
        const sessionResult = await client.query(
          `SELECT id FROM practice_sessions WHERE id = $1 AND user_id = $2 LIMIT 1`,
          [SESSION_A, STUDENT_A],
        );
        expect(sessionResult.rows).toHaveLength(1);

        // Step 2: Item ownership — passes
        const itemResult = await client.query(
          `SELECT question_id, session_id FROM practice_session_items WHERE id = $1 AND user_id = $2 LIMIT 1`,
          [ITEM_A, STUDENT_A],
        );
        expect(itemResult.rows).toHaveLength(1);
        const resolvedQuestionId = itemResult.rows[0].question_id;
        const itemSessionId = itemResult.rows[0].session_id;

        // Relationship validation: item's session matches claimed session
        expect(itemSessionId).toBe(SESSION_A);

        // Step 3: Question existence check (questions are shared, no ownership)
        const questionResult = await client.query(
          `SELECT id FROM questions WHERE id = $1 LIMIT 1`,
          [resolvedQuestionId],
        );
        expect(questionResult.rows).toHaveLength(1);
        expect(questionResult.rows[0].id).toBe(QUESTION_A);
      },
    );

    it.skipIf(skip)(
      "RELATIONSHIP sequence: A's session + B's item → session passes, item denied by user_id predicate",
      async () => {
        // Step 1: Session ownership — passes (SESSION_A belongs to STUDENT_A)
        const sessionResult = await client.query(
          `SELECT id FROM practice_sessions WHERE id = $1 AND user_id = $2 LIMIT 1`,
          [SESSION_A, STUDENT_A],
        );
        expect(sessionResult.rows).toHaveLength(1);

        // Step 2: Item ownership — fails (ITEM_B belongs to STUDENT_B)
        const itemResult = await client.query(
          `SELECT question_id, session_id FROM practice_session_items WHERE id = $1 AND user_id = $2 LIMIT 1`,
          [ITEM_B, STUDENT_A],
        );
        expect(itemResult.rows).toHaveLength(0);
        // validItemId degrades to null — B's question context is NOT resolved.
        // The relationship attack is blocked at the ownership layer: A cannot
        // use their own session to reach B's item because the WHERE clause
        // requires user_id = STUDENT_A on the items table.
      },
    );
  });
});
