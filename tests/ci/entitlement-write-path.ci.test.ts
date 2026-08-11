/**
 * Entitlement write-path → real PostgreSQL proof
 *
 * @spec [Doc-01_V8 §20–§24; genesis.sql:168–181 | STRIPE-001] | @implemented [2026-08-09]
 *
 * Proves the ENTITLEMENT WRITE PATH works against the REAL genesis schema:
 *   1. Applies all migrations to an ephemeral PG16 database (same image as CI)
 *   2. Calls upsertEntitlement(profileId, ...) through the real function
 *      against the real schema — which has profile_id + UNIQUE(profile_id),
 *      NO account_id column
 *   3. Asserts the entitlement row is PERSISTED with correct profile_id + status
 *   4. Asserts entitlement_active(profile_id) returns true
 *   5. Asserts upsert is idempotent (second call updates, does not insert a second row)
 *   6. Asserts the schema has NO account_id column on entitlements
 *   7. Asserts the UNIQUE(profile_id) constraint exists
 *
 * CRITICAL: this test WOULD FAIL against the old account_id code because:
 *   - The real schema has NO account_id column on entitlements
 *   - onConflict: "account_id" would error (no such column / no such constraint)
 *   - The upsert payload with account_id key would error (column does not exist)
 *
 * Runs ONLY in CI jobs with PG16 service container (PGHOST set).
 * Skipped silently in the regular `ci` job (no PG available).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// PG availability gate
// ---------------------------------------------------------------------------
const CAN_RUN = !!process.env.PGHOST;
const PG_HOST = process.env.PGHOST ?? "localhost";
const PG_PORT = process.env.PGPORT ?? "5432";
const PG_USER = process.env.PGUSER ?? "postgres";
const PG_PASSWORD = process.env.PGPASSWORD ?? "postgres";
const DB_NAME = "entitlement_write_path_ci";

const TEST_USER_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

// ---------------------------------------------------------------------------
// PG-backed Supabase query builder — extended to support upsert + insert
// ---------------------------------------------------------------------------

/**
 * Minimal PG-backed Supabase-like query builder.
 * Supports the chain patterns used by upsertEntitlement, getEntitlementForProfile,
 * tryInsertWebhookEventGate, and rollbackWebhookEventGate.
 */
class PgQueryBuilder {
  private pgClient: Client;
  private table: string;
  private selectCols = "*";
  private whereClauses: { col: string; val: unknown }[] = [];
  private upsertData: Record<string, unknown> | null = null;
  private upsertConflict: string | null = null;
  private insertData: Record<string, unknown> | null = null;
  private deleteMode = false;

  constructor(pgClient: Client, table: string) {
    this.pgClient = pgClient;
    this.table = table;
  }

  select(cols?: string): this {
    if (cols) this.selectCols = cols;
    return this;
  }

  eq(col: string, val: unknown): this {
    this.whereClauses.push({ col, val });
    return this;
  }

  upsert(data: Record<string, unknown>, opts?: { onConflict?: string }): this {
    this.upsertData = data;
    this.upsertConflict = opts?.onConflict ?? null;
    return this;
  }

  insert(data: Record<string, unknown>): this {
    this.insertData = data;
    return this;
  }

  delete(): this {
    this.deleteMode = true;
    return this;
  }

  async single(): Promise<{
    data: Record<string, unknown> | null;
    error: { message: string; code?: string } | null;
  }> {
    try {
      if (this.upsertData && this.upsertConflict) {
        return await this.execUpsert();
      }
      // SELECT ... WHERE ... LIMIT 1
      const { sql: whereSql, params } = this.buildWhere(1);
      const cols = this.selectCols === "*" ? "*" : this.selectCols;
      const sql = `SELECT ${cols} FROM public."${this.table}"${whereSql} LIMIT 1`;
      const result = await this.pgClient.query(sql, params);
      if (result.rows.length === 0) {
        return { data: null, error: { message: "Row not found" } };
      }
      return { data: result.rows[0], error: null };
    } catch (err: unknown) {
      const e = err as Error & { code?: string };
      return { data: null, error: { message: e.message, code: e.code } };
    }
  }

  async maybeSingle(): Promise<{
    data: Record<string, unknown> | null;
    error: { message: string; code?: string } | null;
  }> {
    try {
      const { sql: whereSql, params } = this.buildWhere(1);
      const cols = this.selectCols === "*" ? "*" : this.selectCols;
      const sql = `SELECT ${cols} FROM public."${this.table}"${whereSql} LIMIT 1`;
      const result = await this.pgClient.query(sql, params);
      return { data: result.rows[0] ?? null, error: null };
    } catch (err: unknown) {
      const e = err as Error & { code?: string };
      return { data: null, error: { message: e.message, code: e.code } };
    }
  }

  /**
   * Thenable resolution — handles bare .insert() / .delete().eq() chains.
   */
  then(
    resolve: (v: {
      data: unknown;
      error: { message: string; code?: string } | null;
    }) => void,
  ): void {
    (async () => {
      try {
        if (this.insertData) {
          const cols = Object.keys(this.insertData);
          const vals = Object.values(this.insertData);
          const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
          const colNames = cols.map((c) => `"${c}"`).join(", ");
          const sql = `INSERT INTO public."${this.table}" (${colNames}) VALUES (${placeholders})`;
          await this.pgClient.query(sql, vals);
          resolve({ data: null, error: null });
          return;
        }
        if (this.deleteMode) {
          const { sql: whereSql, params } = this.buildWhere(1);
          const sql = `DELETE FROM public."${this.table}"${whereSql}`;
          await this.pgClient.query(sql, params);
          resolve({ data: null, error: null });
          return;
        }
        // Bare select
        const { sql: whereSql, params } = this.buildWhere(1);
        const sql = `SELECT * FROM public."${this.table}"${whereSql}`;
        const result = await this.pgClient.query(sql, params);
        resolve({ data: result.rows, error: null });
      } catch (err: unknown) {
        const pgErr = err as Error & { code?: string };
        resolve({
          data: null,
          error: { message: pgErr.message, code: pgErr.code },
        });
      }
    })();
  }

  private async execUpsert(): Promise<{
    data: Record<string, unknown> | null;
    error: { message: string; code?: string } | null;
  }> {
    const data = this.upsertData!;
    const conflict = this.upsertConflict!;
    const cols = Object.keys(data);
    const vals = Object.values(data);
    const colNames = cols.map((c) => `"${c}"`).join(", ");
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const updateSet = cols
      .filter((c) => c !== conflict)
      .map((c) => `"${c}" = EXCLUDED."${c}"`)
      .join(", ");

    const returnCols = this.selectCols === "*" ? "*" : this.selectCols;
    const sql = `INSERT INTO public."${this.table}" (${colNames}) VALUES (${placeholders})
      ON CONFLICT ("${conflict}") DO UPDATE SET ${updateSet}
      RETURNING ${returnCols}`;

    const result = await this.pgClient.query(sql, vals);
    return { data: result.rows[0] ?? null, error: null };
  }

  private buildWhere(startIdx: number): { sql: string; params: unknown[] } {
    const parts: string[] = [];
    const params: unknown[] = [];
    let idx = startIdx;
    for (const w of this.whereClauses) {
      if (w.val === null) {
        parts.push(`"${w.col}" IS NULL`);
      } else {
        parts.push(`"${w.col}" = $${idx}`);
        params.push(w.val);
        idx++;
      }
    }
    return {
      sql: parts.length > 0 ? " WHERE " + parts.join(" AND ") : "",
      params,
    };
  }
}

function createPgBackedSupabase(pgClient: Client): Record<string, unknown> {
  return {
    from: (table: string) => new PgQueryBuilder(pgClient, table),
    rpc: async (fnName: string, params: Record<string, unknown>) => {
      try {
        const keys = Object.keys(params);
        const placeholders = keys.map((k, i) => `${k} := $${i + 1}`).join(", ");
        const values = keys.map((k) => params[k]);
        const sql = `SELECT * FROM public.${fnName}(${placeholders})`;
        const result = await pgClient.query(sql, values);
        return { data: result.rows[0] ?? null, error: null };
      } catch (err: unknown) {
        return { data: null, error: { message: (err as Error).message } };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Module-level PG client
// ---------------------------------------------------------------------------
let testPg: Client | null = null;

// ---------------------------------------------------------------------------
// Mock supabase-server to use PG-backed adapter
// ---------------------------------------------------------------------------
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: new Proxy(
    {},
    {
      get(_target, prop) {
        if (!testPg) throw new Error("PG client not initialised");
        const adapter = createPgBackedSupabase(testPg);
        return (adapter as Record<string, unknown>)[prop as string];
      },
    },
  ),
}));

vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe.skipIf(!CAN_RUN)("Entitlement write-path → real PG proof", () => {
  let adminPg: Client;

  beforeAll(async () => {
    // 1. Create throwaway database
    adminPg = new Client({
      host: PG_HOST,
      port: Number(PG_PORT),
      user: PG_USER,
      password: PG_PASSWORD,
      database: "postgres",
    });
    await adminPg.connect();
    await adminPg.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await adminPg.query(`CREATE DATABASE ${DB_NAME}`);

    // 2. Connect to test database
    testPg = new Client({
      host: PG_HOST,
      port: Number(PG_PORT),
      user: PG_USER,
      password: PG_PASSWORD,
      database: DB_NAME,
    });
    await testPg.connect();

    // 3. Stub Supabase auth schema (same as genesis-fresh-apply.sh)
    await testPg.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon')
            THEN CREATE ROLE anon NOLOGIN; END IF;
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated')
            THEN CREATE ROLE authenticated NOLOGIN; END IF;
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role')
            THEN CREATE ROLE service_role NOLOGIN; END IF;
        END $$;
        CREATE SCHEMA IF NOT EXISTS auth;
        CREATE TABLE IF NOT EXISTS auth.users (
          id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb
        );
        CREATE OR REPLACE FUNCTION auth.uid()
          RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
      `);

    // 4. Apply all migrations
    const migrationsDir = path.resolve(__dirname, "../../supabase/migrations");
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      await testPg.query(sql);
    }

    // 5. Create test user (triggers handle_new_user → auto-creates profile)
    await testPg.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data)
         VALUES ($1, 'entitlement-ci@example.com',
                 '{"display_name":"Entitlement CI","role":"student"}'::jsonb)`,
      [TEST_USER_ID],
    );
  }, 120_000);

  afterAll(async () => {
    await testPg?.end();
    testPg = null;
    if (adminPg) {
      await adminPg.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
      await adminPg.end();
    }
  });

  // ---------------------------------------------------------------
  // Schema structure proof — the write path CANNOT work with account_id
  // ---------------------------------------------------------------

  it("entitlements table has profile_id column, NOT account_id", async () => {
    const cols = await testPg!.query(
      `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'entitlements'
         ORDER BY ordinal_position`,
    );
    const colNames = cols.rows.map(
      (r: Record<string, unknown>) => r.column_name,
    );

    expect(colNames).toContain("profile_id");
    expect(colNames).not.toContain("account_id");
  });

  it("UNIQUE(profile_id) constraint exists on entitlements", async () => {
    const idx = await testPg!.query(
      `SELECT indexname, indexdef FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'entitlements'
           AND indexdef LIKE '%profile_id%'`,
    );
    expect(idx.rows.length).toBeGreaterThan(0);

    const uniqueIdx = idx.rows.find(
      (r: Record<string, unknown>) =>
        (r.indexname as string).includes("profile_id") &&
        (r.indexdef as string).includes("UNIQUE"),
    );
    expect(uniqueIdx).toBeDefined();
  });

  // ---------------------------------------------------------------
  // Write-path proof — upsertEntitlement against real PG
  // ---------------------------------------------------------------

  it("upsertEntitlement persists an entitlement row with profile_id and correct status", async () => {
    const { upsertEntitlement } = await import("../../server/lib/account");

    const result = await upsertEntitlement(TEST_USER_ID, {
      tier: "premium",
      status: "active",
      stripe_subscription_id: "sub_ci_test_001",
      current_period_start: "2026-08-09T00:00:00Z",
      current_period_end: "2026-09-09T00:00:00Z",
      cancel_at_period_end: false,
    });

    // Function returned the upserted row
    expect(result).toBeDefined();
    expect(result.profile_id).toBe(TEST_USER_ID);
    expect(result.tier).toBe("premium");
    expect(result.status).toBe("active");
    expect(result.stripe_subscription_id).toBe("sub_ci_test_001");

    // Verify it was actually persisted in PG (not just mocked)
    const pgResult = await testPg!.query(
      `SELECT profile_id, tier, status, stripe_subscription_id,
                current_period_start, current_period_end, cancel_at_period_end
         FROM public.entitlements WHERE profile_id = $1`,
      [TEST_USER_ID],
    );
    expect(pgResult.rows.length).toBe(1);
    expect(pgResult.rows[0].profile_id).toBe(TEST_USER_ID);
    expect(pgResult.rows[0].tier).toBe("premium");
    expect(pgResult.rows[0].status).toBe("active");
    expect(pgResult.rows[0].stripe_subscription_id).toBe("sub_ci_test_001");
  });

  it("entitlement_active(profile_id) returns true for active entitlement", async () => {
    const rpcResult = await testPg!.query(
      `SELECT public.entitlement_active($1) AS active`,
      [TEST_USER_ID],
    );
    expect(rpcResult.rows[0].active).toBe(true);
  });

  it("upsertEntitlement is idempotent — second call updates, does not duplicate", async () => {
    const { upsertEntitlement } = await import("../../server/lib/account");

    // Upsert again with changed status (simulating subscription update webhook)
    const result = await upsertEntitlement(TEST_USER_ID, {
      tier: "premium",
      status: "past_due",
      stripe_subscription_id: "sub_ci_test_001",
      current_period_start: "2026-08-09T00:00:00Z",
      current_period_end: "2026-09-09T00:00:00Z",
      cancel_at_period_end: true,
    });

    expect(result.profile_id).toBe(TEST_USER_ID);
    expect(result.status).toBe("past_due");
    expect(result.cancel_at_period_end).toBe(true);

    // Still exactly one row — upsert, not insert
    const countResult = await testPg!.query(
      `SELECT count(*)::integer AS cnt FROM public.entitlements
         WHERE profile_id = $1`,
      [TEST_USER_ID],
    );
    expect(countResult.rows[0].cnt).toBe(1);
  });

  it("entitlement_active returns true for past_due (grace-inclusive entitled set)", async () => {
    // past_due was set in the previous test — the canonical entitled set is
    // {active, past_due, trialing} per ENTITLEMENT-001 / SP-25 ruling.
    // past_due is grace-inclusive: student keeps access while payment retries.
    const rpcResult = await testPg!.query(
      `SELECT public.entitlement_active($1) AS active`,
      [TEST_USER_ID],
    );
    expect(rpcResult.rows[0].active).toBe(true);
  });

  it("entitlement_active returns false for canceled status", async () => {
    // Set status to 'canceled' — NOT in the entitled set
    await testPg!.query(
      `UPDATE public.entitlements SET status = 'canceled' WHERE profile_id = $1`,
      [TEST_USER_ID],
    );
    const rpcResult = await testPg!.query(
      `SELECT public.entitlement_active($1) AS active`,
      [TEST_USER_ID],
    );
    expect(rpcResult.rows[0].active).toBe(false);

    // Restore to past_due for subsequent tests
    await testPg!.query(
      `UPDATE public.entitlements SET status = 'past_due' WHERE profile_id = $1`,
      [TEST_USER_ID],
    );
  });

  it("getEntitlementForProfile reads back the persisted row", async () => {
    const { getEntitlementForProfile } =
      await import("../../server/lib/account");

    const result = await getEntitlementForProfile(TEST_USER_ID);
    expect(result).not.toBeNull();
    expect(result!.profile_id).toBe(TEST_USER_ID);
    expect(result!.status).toBe("past_due");
    expect(result!.stripe_subscription_id).toBe("sub_ci_test_001");
  });

  // ---------------------------------------------------------------
  // Webhook idempotency gate — stripe_webhook_events against real PG
  // ---------------------------------------------------------------

  it("stripe_webhook_events table exists with RLS and correct columns", async () => {
    const cols = await testPg!.query(
      `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'stripe_webhook_events'
         ORDER BY ordinal_position`,
    );
    const colNames = cols.rows.map(
      (r: Record<string, unknown>) => r.column_name,
    );
    expect(colNames).toContain("id");
    expect(colNames).toContain("type");
    expect(colNames).toContain("created_at");

    // RLS enabled
    const rls = await testPg!.query(
      `SELECT rowsecurity FROM pg_tables
         WHERE schemaname = 'public' AND tablename = 'stripe_webhook_events'`,
    );
    expect(rls.rows[0].rowsecurity).toBe(true);

    // No policies (service-role-only via BYPASSRLS)
    const policies = await testPg!.query(
      `SELECT count(*)::integer AS cnt FROM pg_policy
         WHERE polrelid = 'public.stripe_webhook_events'::regclass`,
    );
    expect(policies.rows[0].cnt).toBe(0);
  });

  it("webhook event insert + 23505 replay detection works against real PG", async () => {
    // First insert — succeeds
    const firstInsert = await testPg!.query(
      `INSERT INTO public.stripe_webhook_events (id, type) VALUES ($1, $2)`,
      ["evt_ci_proof_001", "customer.subscription.created"],
    );
    expect(firstInsert.command).toBe("INSERT");

    // Replay insert — 23505 unique_violation
    try {
      await testPg!.query(
        `INSERT INTO public.stripe_webhook_events (id, type) VALUES ($1, $2)`,
        ["evt_ci_proof_001", "customer.subscription.created"],
      );
      // Should not reach here
      expect.fail("Expected unique_violation on replay");
    } catch (err: unknown) {
      const pgErr = err as Error & { code?: string };
      expect(pgErr.code).toBe("23505");
    }
  });

  // ---------------------------------------------------------------
  // Negative proof — account_id would fail
  // ---------------------------------------------------------------

  it("upsert targeting account_id column FAILS (column does not exist)", async () => {
    // This is the negative proof: the old code used onConflict: "account_id"
    // and set account_id in the payload. Against the real schema, this MUST fail.
    try {
      await testPg!.query(
        `INSERT INTO public.entitlements (account_id, tier, status)
           VALUES ($1, $2, $3)
           ON CONFLICT (account_id) DO UPDATE SET status = EXCLUDED.status`,
        [TEST_USER_ID, "premium", "active"],
      );
      expect.fail(
        "Expected error — account_id column does not exist on entitlements",
      );
    } catch (err: unknown) {
      const pgErr = err as Error & { code?: string };
      // 42703 = undefined_column
      expect(pgErr.code).toBe("42703");
      expect(pgErr.message).toMatch(/account_id/);
    }
  });
});
