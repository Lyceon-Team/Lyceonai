/**
 * Calendar practice adapter — launch contract, against real PostgreSQL.
 *
 * @spec [Doc-05F_V1.0 §9.1 adapter contract, §9.2 practice adapter, §15.1 launch
 *        (INV-08-18); Doc-02B_V4 §14 session create]
 * | @implemented [2026-09-18]
 *
 * This is the seam the whole launch path rests on: a calendar block becomes a
 * practice session, and the FILTER and the IDEMPOTENCY KEY have to arrive intact.
 * Two halves, because the risk has two halves:
 *
 *   A. The adapter hands `startOrReplaySession` exactly the right spec, with the
 *      key forwarded UNCHANGED. Proved with a recorder over that one function.
 *   B. That spec is a filter the real database accepts and honours. Proved by
 *      calling `select_practice_pool_random` — the RPC `startOrReplaySession`
 *      itself calls — against a real schema with real rows.
 *
 * WHAT THIS DOES NOT DO, stated rather than implied: it does not drive
 * `startOrReplaySession` end to end through PostgREST. That needs the PostgREST
 * binary the `mastery-pipeline` job installs, and reproducing supabase-js's wire
 * behaviour with a hand-written shim would prove the shim, not the seam. Half B
 * runs the same RPC with the same arguments against the same schema, which is the
 * part that can actually be wrong.
 *
 * Half B runs ONLY where a PG service container is present (PGHOST set) and is
 * skipped in the plain `ci` job, matching every other *.ci.test.ts here.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import type { PlanBlock } from "@lyceon/shared";

const recorded: { args: Record<string, unknown> | null } = { args: null };

vi.mock("../../server/routes/practice-canonical", () => ({
  startOrReplaySession: vi.fn(async (args: Record<string, unknown>) => {
    recorded.args = args;
    return {
      ok: true as const,
      session: { id: "5f0a6b1c-2d3e-4f50-8a9b-0c1d2e3f4a5b" },
      metadata: {},
      replayed: false,
    };
  }),
  loadPracticeConfig: vi.fn(async () => ({ maxSessionCountPremium: 30 })),
}));

const { practiceAdapter } = await import(
  "../../server/services/calendar/adapters/practice"
);

const CTX = {
  student_id: "11111111-1111-1111-1111-111111111111",
  actor_id: "11111111-1111-1111-1111-111111111111",
  role: "student",
  client_instance_id: "ci-abc",
  platform: "web" as const,
  idempotency_key: "calendar:block:7c9e6679-7425-40de-944b-e07fc1f90ae7:1",
};

const DOMAIN_BLOCK: PlanBlock = {
  block_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  scheduled_date: "2026-09-18",
  block_type: "practice",
  section: "M",
  scope: {
    level: "domain",
    mix: [
      { domain: "Algebra", count: 15, explanation_key: "weak" },
      { domain: "Geometry and Trigonometry", count: 5, explanation_key: "balanced" },
    ],
  },
  target_count: 20,
  source: "auto",
  derived_from_block_id: null,
  explanation_key: "weighted",
  display_ordinal: 1,
  membership_type: "created",
};

const SECTION_BLOCK: PlanBlock = {
  ...DOMAIN_BLOCK,
  block_id: "8d0f7780-8536-41ef-a55c-f18fd2f01bf8",
  section: "RW",
  scope: { level: "section", count: 20, explanation_key: "cold_start" },
};

// ── Half A ──────────────────────────────────────────────────────────────────

describe("the adapter hands the engine the right spec", () => {
  it("forwards the idempotency key UNCHANGED — the calendar owns the format", async () => {
    recorded.args = null;
    await practiceAdapter.create(DOMAIN_BLOCK, 20, CTX);
    expect(recorded.args?.idempotencyKey).toBe(CTX.idempotency_key);
    // Not merely equal by luck: it is the block id and sequence the service built.
    expect(recorded.args?.idempotencyKey).toBe(
      "calendar:block:7c9e6679-7425-40de-944b-e07fc1f90ae7:1",
    );
  });

  it("filters to the block's section and the domains in its mix", async () => {
    recorded.args = null;
    await practiceAdapter.create(DOMAIN_BLOCK, 20, CTX);
    const spec = recorded.args?.sessionSpec as Record<string, unknown>;
    expect(spec.sections).toEqual(["M"]);
    expect(spec.domains).toEqual(["Algebra", "Geometry and Trigonometry"]);
    expect(spec.target_question_count).toBe(20);
    expect(spec.mode).toBe("structured");
    expect(recorded.args?.section).toBe("M");
    expect(recorded.args?.targetQuestionCount).toBe(20);
  });

  it("sends THIS launch's size, not the block target (§9.1)", async () => {
    recorded.args = null;
    await practiceAdapter.create(DOMAIN_BLOCK, 8, CTX);
    expect(recorded.args?.targetQuestionCount).toBe(8);
    expect((recorded.args?.sessionSpec as Record<string, unknown>).target_question_count).toBe(8);
    expect(DOMAIN_BLOCK.target_count).toBe(20);
  });

  it("a section-level block filters on section alone — the whole section is in scope", async () => {
    recorded.args = null;
    await practiceAdapter.create(SECTION_BLOCK, 20, CTX);
    const spec = recorded.args?.sessionSpec as Record<string, unknown>;
    expect(spec.sections).toEqual(["RW"]);
    expect(spec.domains).toEqual([]);
  });

  it("never asks for the diagnostic mode, which decides how answers reach mastery", async () => {
    recorded.args = null;
    await practiceAdapter.create(DOMAIN_BLOCK, 20, CTX);
    expect(recorded.args?.mode).not.toBe("diagnostic");
  });

  it("returns the resume URL and mirrors the engine's replay flag", async () => {
    const result = await practiceAdapter.create(DOMAIN_BLOCK, 20, CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.next).toBe(
      "/practice/session/5f0a6b1c-2d3e-4f50-8a9b-0c1d2e3f4a5b",
    );
    expect(result.value.resumed).toBe(false);
  });

  it("declines a block that is not practice, as data rather than a throw", async () => {
    const review = { ...DOMAIN_BLOCK, block_type: "review", section: null } as unknown as PlanBlock;
    const result = await practiceAdapter.create(review, 5, CTX);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("engine_error");
  });

  it("caps the next launch size at practice's own ceiling, never the calendar's", async () => {
    expect(await practiceAdapter.nextLaunchSize(DOMAIN_BLOCK, 12)).toBe(12);
    expect(await practiceAdapter.nextLaunchSize(DOMAIN_BLOCK, 400)).toBe(30);
    expect(await practiceAdapter.nextLaunchSize(DOMAIN_BLOCK, 0)).toBe(1);
  });
});

// ── Half B — the same filter, against the real schema ───────────────────────

const CAN_RUN = !!process.env.PGHOST;
const DB_NAME = "calendar_launch_contract_ci";

describe.skipIf(!CAN_RUN)("the database accepts and honours that filter", () => {
  let admin: Client;
  let client: Client;

  beforeAll(async () => {
    const base = {
      host: process.env.PGHOST ?? "localhost",
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER ?? "postgres",
      password: process.env.PGPASSWORD ?? "postgres",
    };
    admin = new Client({ ...base, database: "postgres" });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin.query(`CREATE DATABASE ${DB_NAME}`);

    client = new Client({ ...base, database: DB_NAME });
    await client.connect();
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN; END IF;
      END $$;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
    `);

    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(process.cwd(), "supabase/migrations");
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await client.query(fs.readFileSync(path.join(dir, file), "utf8"));
    }

    // Four published questions: three Math (two Algebra, one Geometry) and one R&W.
    // Enough to prove the filter SELECTS rather than merely returns rows.
    //
    // The ids satisfy questions_id_check, ^SAT(M|RW)[12][A-Z0-9]{6}$ — the canonical
    // format is locked, and a fixture that invented its own would be testing against
    // a schema production does not have.
    await client.query(`
      INSERT INTO public.questions
        (id, section, source_type, domain, skill_codes, difficulty, stem, options,
         correct_answer, explanation, status, published_at)
      VALUES
        ('SATM1ALG001','M',1,'Algebra','{LIN}',2,'stem','["A","B","C","D"]'::jsonb,'A','e','published', now()),
        ('SATM1ALG002','M',1,'Algebra','{LIN}',2,'stem','["A","B","C","D"]'::jsonb,'A','e','published', now()),
        ('SATM1GEO001','M',1,'Geometry and Trigonometry','{TRI}',2,'stem','["A","B","C","D"]'::jsonb,'A','e','published', now()),
        ('SATRW1CST001','RW',1,'Craft and Structure','{CS}',2,'stem','["A","B","C","D"]'::jsonb,'A','e','published', now());
    `);
  }, 240_000);

  afterAll(async () => {
    await client?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin?.end();
  });

  /** The arguments startOrReplaySession builds from the adapter's spec (:1529-1541). */
  async function pool(sections: string[], domains: string[], limit: number) {
    const { rows } = await client.query(
      "SELECT id, section, domain FROM public.select_practice_pool_random($1,$2,$3,$4,$5,$6)",
      [
        sections.length > 0 ? sections : null,
        domains.length > 0 ? domains : null,
        null,
        null,
        null,
        limit,
      ],
    );
    return rows as { id: string; section: string; domain: string }[];
  }

  it("the domain filter selects — an Algebra block never serves Geometry", async () => {
    const rows = await pool(["M"], ["Algebra"], 10);
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.domain === "Algebra")).toBe(true);
  });

  it("the block's whole mix is in scope, and nothing outside it", async () => {
    const rows = await pool(["M"], ["Algebra", "Geometry and Trigonometry"], 10);
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.section === "M")).toBe(true);
  });

  it("a section-level block serves that section and no other", async () => {
    const rows = await pool(["RW"], [], 10);
    expect(rows.length).toBe(1);
    expect(rows[0]?.domain).toBe("Craft and Structure");
  });

  it("the launch size is the limit the database honours", async () => {
    expect((await pool(["M"], ["Algebra"], 1)).length).toBe(1);
  });

  it("the canonical domain strings match the column exactly — no mapping layer", async () => {
    // The whole class of bug the parity gate's short-code mapping used to hide.
    expect((await pool(["M"], ["ALG"], 10)).length).toBe(0);
    expect((await pool(["M"], ["Algebra"], 10)).length).toBe(2);
  });
});
