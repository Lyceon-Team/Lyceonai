/**
 * An activity unit is RETRIEVAL. A skip is not retrieval.
 *
 * @spec [Doc-05F_V1.0 §9.2 practice adapter, §13 progress]
 *       [review handoff, "Calendar ← Review: Seam Changes" H2]
 * | @implemented [2026-09-23]
 *
 * WHY THIS FILE EXISTS. The practice adapter used to select activity with
 * `answered_at IS NOT NULL`. That reads like a synonym for "answered" and is not one: a
 * SKIPPED item also carries a non-null `answered_at`. Review's production data has two such
 * rows today — `status='skipped'`, `outcome='skipped'`, `answered_at` set — and review's
 * handoff says practice skips now enter the queue as well. On the old predicate every skip
 * would have counted toward a block's progress, so a student could clear a day's work by
 * skipping through it and §13 would report it done.
 *
 * Practice has no skips YET, which is exactly why the predicate was changed now: the first
 * one turns this from a latent defect into silent, mastery-adjacent bad data, with no error
 * anywhere to notice.
 *
 * TWO HALVES, because the claim has two halves:
 *
 *   A. The adapter ASKS for `status = 'answered'` and no longer asks for
 *      `answered_at IS NOT NULL`. The filter is what does the excluding, so the filter is
 *      what gets asserted — proved against the recording fake client.
 *   B. The two predicates really do disagree on a skipped row. Proved in real PostgreSQL
 *      against the real `practice_session_items` shape, because "a skip carries
 *      `answered_at`" is a claim about the database, not about TypeScript.
 *
 * Half B runs ONLY where a PG service container is present (PGHOST set), matching every
 * other *.ci.test.ts here.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import {
  CONFIG_ROWS,
  makeFakeClient,
  okReply,
  type FakeClient,
} from "./calendar.service-harness";

const STUDENT = "11111111-1111-1111-1111-111111111111";
const LOCAL_DATE = "2026-09-21";
const TIMEZONE = "America/Chicago";

let client: FakeClient;

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return client;
  },
}));

vi.mock("../../server/routes/practice-canonical", () => ({
  startOrReplaySession: vi.fn(),
  loadPracticeConfig: vi.fn(async () => ({ maxSessionCountPremium: 30 })),
}));

const { practiceAdapter } =
  await import("../../server/services/calendar/adapters/practice");

// ── Half A: the adapter asks the right question ─────────────────────────────

describe("the practice adapter counts retrieval, never skips (H2)", () => {
  it("filters on status = 'answered', not on answered_at being present", async () => {
    client = makeFakeClient({
      tables: {
        calendar_runtime_config: () => okReply(CONFIG_ROWS),
        practice_session_items: () => okReply([]),
      },
    });

    await practiceAdapter.activityUnits(STUDENT, LOCAL_DATE, TIMEZONE);

    const query = client.queries.find(
      (entry) => entry.table === "practice_session_items",
    );
    expect(query).toBeDefined();
    if (query === undefined) return;

    const statusFilter = query.filters.find(
      (filter) => filter.column === "status",
    );
    expect(statusFilter).toEqual({
      kind: "eq",
      column: "status",
      value: "answered",
    });

    // THE PLANT TARGET. Reverting to the old predicate reintroduces exactly this filter
    // and drops the one above, so both assertions move together.
    const nullnessFilter = query.filters.find(
      (filter) =>
        filter.column === "answered_at" && filter.kind.startsWith("not."),
    );
    expect(nullnessFilter).toBeUndefined();
  });

  it("still WINDOWS on answered_at — it was the wrong filter, not the wrong timestamp", async () => {
    client = makeFakeClient({
      tables: {
        calendar_runtime_config: () => okReply(CONFIG_ROWS),
        practice_session_items: () => okReply([]),
      },
    });

    await practiceAdapter.activityUnits(STUDENT, LOCAL_DATE, TIMEZONE);

    const query = client.queries.find(
      (entry) => entry.table === "practice_session_items",
    );
    const bounds = (query?.filters ?? []).filter(
      (filter) => filter.column === "answered_at",
    );
    // A lower and an upper bound: the local day, resolved in the plan date's own zone.
    expect(bounds.map((filter) => filter.kind).sort()).toEqual(["gte", "lt"]);
  });

  it("maps an answered row to a unit dated by answered_at", async () => {
    client = makeFakeClient({
      tables: {
        calendar_runtime_config: () => okReply(CONFIG_ROWS),
        practice_session_items: () =>
          okReply([
            {
              id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
              question_section: "M",
              question_domain: "Algebra",
              answered_at: "2026-09-21T15:00:00.000Z",
              status: "answered",
            },
          ]),
      },
    });

    const units = await practiceAdapter.activityUnits(
      STUDENT,
      LOCAL_DATE,
      TIMEZONE,
    );

    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      engine: "practice",
      unit_id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      occurred_at: "2026-09-21T15:00:00.000Z",
      local_date: LOCAL_DATE,
      section: "M",
      domain: "Algebra",
    });
  });
});

// ── Half B: the two predicates really do disagree ───────────────────────────

const PG = process.env.PGHOST !== undefined && process.env.PGHOST !== "";
const maybe = PG ? describe : describe.skip;

maybe("in real PostgreSQL, a skipped item carries answered_at (H2)", () => {
  let pg: Client;
  const SCHEMA = "calendar_skip_predicate_probe";

  beforeAll(async () => {
    pg = new Client();
    await pg.connect();
    await pg.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pg.query(`CREATE SCHEMA ${SCHEMA}`);
    // The two columns the predicate turns on, with the real CHECK. Not the whole table:
    // this proves a claim about the STATUS/answered_at relationship, and a faithful copy
    // of forty unrelated columns would not make it more true.
    await pg.query(`
      CREATE TABLE ${SCHEMA}.practice_session_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        answered_at timestamptz,
        status text NOT NULL CHECK (status IN ('pending','served','answered','skipped'))
      )`);
    await pg.query(`
      INSERT INTO ${SCHEMA}.practice_session_items (answered_at, status) VALUES
        ('2026-09-21T15:00:00Z', 'answered'),
        -- The row that broke the old predicate: a SKIP, timestamped.
        ('2026-09-21T15:05:00Z', 'skipped'),
        (NULL, 'served')`);
  });

  afterAll(async () => {
    await pg.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pg.end();
  });

  it("the OLD predicate counts the skip and the NEW one does not", async () => {
    const oldWay = await pg.query(
      `SELECT count(*)::int AS n FROM ${SCHEMA}.practice_session_items
       WHERE answered_at IS NOT NULL`,
    );
    const newWay = await pg.query(
      `SELECT count(*)::int AS n FROM ${SCHEMA}.practice_session_items
       WHERE status = 'answered'`,
    );

    // 2 vs 1 — and the difference is exactly the skip. If these were ever equal the
    // predicate change would be pointless, so the inequality is the point.
    expect(oldWay.rows[0].n).toBe(2);
    expect(newWay.rows[0].n).toBe(1);
  });

  it("a skipped row with answered_at set produces ZERO units under the new predicate", async () => {
    const result = await pg.query(
      `SELECT count(*)::int AS n FROM ${SCHEMA}.practice_session_items
       WHERE status = 'answered' AND answered_at = '2026-09-21T15:05:00Z'`,
    );
    expect(result.rows[0].n).toBe(0);
  });
});
