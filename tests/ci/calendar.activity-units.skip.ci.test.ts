/**
 * An activity unit is RETRIEVAL, and it is dated by the column the schema guarantees.
 *
 * @spec [Doc-05F_V1.0 §9.1 adapter contract, §9.2 practice adapter, §13 progress, §22.4]
 *       [review handoff, "Calendar ← Review: Seam Changes" H2 — superseded, see below]
 * | @implemented [2026-09-23] | @amended [2026-09-22, owner ruling: occurred_at]
 *
 * TWO CLAIMS LIVE HERE, and they are the two halves of the same defect: an activity read
 * that quietly returns the wrong set of rows.
 *
 * ONE — WHICH ROWS. The practice adapter used to select activity with
 * `answered_at IS NOT NULL`. That reads like a synonym for "answered" and is not one: a
 * SKIPPED item is resolved too, so it carries a timestamp exactly as an answered one does.
 * Review's production data has two such rows today — `status='skipped'`,
 * `outcome='skipped'`, timestamps set — and review's handoff says practice skips now enter
 * the queue as well. On a nullness predicate every skip would have counted toward a block's
 * progress, so a student could clear a day's work by skipping through it and §13 would
 * report it done. The predicate is `status = 'answered'`, and it is a nullness test on no
 * column at all.
 *
 * TWO — WHICH TIMESTAMP (owner ruling 2026-09-22, superseding both the 2026-09-17 mapping
 * and H2's `answered_at`). The window used to run on `answered_at`. It now runs on
 * `occurred_at`, because that is the column both tables actually guarantee:
 *
 *     CONSTRAINT psi_resolved_requires_occurred_at
 *       CHECK (status <> ALL (ARRAY['answered','skipped']) OR occurred_at IS NOT NULL)
 *
 * and `rsi_resolved_requires_occurred_at` is the same CHECK on review's table. `answered_at`
 * is plain nullable `timestamptz` on both, with nothing enforcing it. The two agree on every
 * resolved row in production today only because the writers set both from one `now` — a
 * property of today's writers, not of the schema. A resolved row that ever lands without
 * `answered_at` falls out of the old window in silence and is reported as "the student did
 * nothing today", which is the same shape of failure as counting a skip, pointing the other
 * way.
 *
 * THREE HALVES, because the claims are provable at different depths:
 *
 *   A. The adapter ASKS the right question — `status = 'answered'`, windowed on
 *      `occurred_at`, with `answered_at` absent from the filters AND from the select list.
 *      Proved against the recording fake client, which is the layer that sees the query.
 *   B. THE PLANT. A resolved `answered` row carrying `occurred_at` and a NULL `answered_at`
 *      yields exactly one unit. Under the reverted adapter this row is dropped by the
 *      `typeof row.answered_at !== "string"` guard and the assertion goes red on length 0.
 *   C. The database really does disagree with itself between the two columns — the skip
 *      carries both, and the CHECK constrains only one. Proved in real PostgreSQL against
 *      the real constraint, because "nothing guarantees `answered_at`" is a claim about the
 *      schema, not about TypeScript.
 *
 * Half C runs ONLY where a PG service container is present (PGHOST set), matching every
 * other *.ci.test.ts here. The review adapter's own end-to-end version of the plant — real
 * engine, real SQL filter, real constraint — is in calendar.launch-contract.review.test.ts.
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

function emptyItems(): FakeClient {
  return makeFakeClient({
    tables: {
      calendar_runtime_config: () => okReply(CONFIG_ROWS),
      practice_session_items: () => okReply([]),
    },
  });
}

// ── Half A: the adapter asks the right question ─────────────────────────────

describe("the practice adapter counts retrieval, never skips (H2)", () => {
  it("filters on status = 'answered', not on a timestamp being present", async () => {
    client = emptyItems();

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

    // THE PLANT TARGET for claim one. Reverting to the old predicate reintroduces exactly
    // this filter and drops the one above, so both assertions move together. Neither
    // timestamp column may carry it: a nullness test on `occurred_at` would count skips
    // just as readily, and more reliably, since the CHECK guarantees a skip has one.
    const nullnessFilter = query.filters.find(
      (filter) =>
        (filter.column === "answered_at" || filter.column === "occurred_at") &&
        filter.kind.startsWith("not."),
    );
    expect(nullnessFilter).toBeUndefined();
  });

  it("windows on occurred_at — the column the CHECK guarantees", async () => {
    client = emptyItems();

    await practiceAdapter.activityUnits(STUDENT, LOCAL_DATE, TIMEZONE);

    const query = client.queries.find(
      (entry) => entry.table === "practice_session_items",
    );
    const bounds = (query?.filters ?? []).filter(
      (filter) => filter.column === "occurred_at",
    );
    // A lower and an upper bound: the local day, resolved in the plan date's own zone.
    expect(bounds.map((filter) => filter.kind).sort()).toEqual(["gte", "lt"]);

    // `answered_at` is not merely unused for the window — it is not asked for at all.
    // Asserting the SELECT list as well as the filters is what makes a half-reverted
    // adapter (column back in the projection, window left on occurred_at) fail here
    // rather than pass and drift.
    expect(
      (query?.filters ?? []).some((filter) => filter.column === "answered_at"),
    ).toBe(false);
    expect(query?.columns ?? "").not.toContain("answered_at");
    expect(query?.columns ?? "").toContain("occurred_at");
  });

  it("maps an answered row to a unit dated by occurred_at", async () => {
    client = makeFakeClient({
      tables: {
        calendar_runtime_config: () => okReply(CONFIG_ROWS),
        practice_session_items: () =>
          okReply([
            {
              id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
              question_section: "M",
              question_domain: "Algebra",
              occurred_at: "2026-09-21T15:00:00.000Z",
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

  // ── Half B: the plant ─────────────────────────────────────────────────────

  it("counts a resolved row whose answered_at is NULL — THE PLANT", async () => {
    client = makeFakeClient({
      tables: {
        calendar_runtime_config: () => okReply(CONFIG_ROWS),
        practice_session_items: () =>
          okReply([
            {
              id: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
              question_section: "RW",
              question_domain: "Information and Ideas",
              // The schema permits exactly this row: the CHECK constrains `occurred_at`
              // and says nothing about `answered_at`. It is not a row today's writers
              // produce — it is a row nothing STOPS them producing, which is the whole
              // reason the window moved.
              occurred_at: "2026-09-21T16:30:00.000Z",
              answered_at: null,
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

    // Revert the adapter to `answered_at` and this is 0: the old guard
    // (`typeof row.answered_at !== "string"`) drops the row, `activityUnits` returns
    // nothing, and §13 reports a student who answered as having done no work.
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      unit_id: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
      occurred_at: "2026-09-21T16:30:00.000Z",
      local_date: LOCAL_DATE,
    });
  });

  it("still drops a row it cannot date at all", async () => {
    client = makeFakeClient({
      tables: {
        calendar_runtime_config: () => okReply(CONFIG_ROWS),
        practice_session_items: () =>
          okReply([
            {
              id: "cccccccc-3333-4333-8333-cccccccccccc",
              question_section: "M",
              question_domain: "Algebra",
              occurred_at: null,
              status: "answered",
            },
          ]),
      },
    });

    // The CHECK makes this unreachable in the real table, so this asserts the posture and
    // not a live case: a row with no usable instant is skipped, never dated by a guess.
    await expect(
      practiceAdapter.activityUnits(STUDENT, LOCAL_DATE, TIMEZONE),
    ).resolves.toEqual([]);
  });
});

// ── Half C: the database disagrees with itself between the two columns ──────

const PG = process.env.PGHOST !== undefined && process.env.PGHOST !== "";
const maybe = PG ? describe : describe.skip;

maybe("in real PostgreSQL, only occurred_at is guaranteed (H2)", () => {
  let pg: Client;
  const SCHEMA = "calendar_skip_predicate_probe";

  beforeAll(async () => {
    pg = new Client();
    await pg.connect();
    await pg.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pg.query(`CREATE SCHEMA ${SCHEMA}`);
    // The three columns the read turns on, with the REAL constraint copied verbatim from
    // genesis. Not the whole table: this proves a claim about the relationship between
    // `status` and the two timestamps, and a faithful copy of forty unrelated columns
    // would not make it more true.
    await pg.query(`
      CREATE TABLE ${SCHEMA}.practice_session_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        answered_at timestamptz,
        occurred_at timestamptz,
        status text NOT NULL CHECK (status IN ('pending','served','answered','skipped')),
        CONSTRAINT psi_resolved_requires_occurred_at
          CHECK (((status <> ALL (ARRAY['answered'::text, 'skipped'::text]))
                  OR (occurred_at IS NOT NULL)))
      )`);
    await pg.query(`
      INSERT INTO ${SCHEMA}.practice_session_items
        (answered_at, occurred_at, status) VALUES
        ('2026-09-21T15:00:00Z', '2026-09-21T15:00:00Z', 'answered'),
        -- The row that broke the nullness predicate: a SKIP, timestamped.
        ('2026-09-21T15:05:00Z', '2026-09-21T15:05:00Z', 'skipped'),
        -- The row that breaks windowing on answered_at: resolved, answered, undated by
        -- the column nothing enforces.
        (NULL, '2026-09-21T16:30:00Z', 'answered'),
        (NULL, NULL, 'served')`);
  });

  afterAll(async () => {
    await pg.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pg.end();
  });

  it("the nullness predicate counts the skip and the status predicate does not", async () => {
    const oldWay = await pg.query(
      `SELECT count(*)::int AS n FROM ${SCHEMA}.practice_session_items
       WHERE answered_at IS NOT NULL`,
    );
    const newWay = await pg.query(
      `SELECT count(*)::int AS n FROM ${SCHEMA}.practice_session_items
       WHERE status = 'answered'`,
    );

    // 2 vs 2 by count, but not the same two rows — the old predicate takes the skip and
    // loses the answered row with no `answered_at`, which is both failures at once.
    expect(oldWay.rows[0].n).toBe(2);
    expect(newWay.rows[0].n).toBe(2);

    const disagreement = await pg.query(
      `SELECT count(*)::int AS n FROM ${SCHEMA}.practice_session_items
        WHERE (answered_at IS NOT NULL) <> (status = 'answered')`,
    );
    expect(disagreement.rows[0].n).toBe(2);
  });

  it("the CHECK rejects a resolved row with no occurred_at, and accepts one with no answered_at", async () => {
    // The guarantee, exercised rather than quoted.
    await expect(
      pg.query(
        `INSERT INTO ${SCHEMA}.practice_session_items
           (answered_at, occurred_at, status)
         VALUES ('2026-09-21T17:00:00Z', NULL, 'answered')`,
      ),
    ).rejects.toThrow(/psi_resolved_requires_occurred_at/);

    const permitted = await pg.query(
      `SELECT count(*)::int AS n FROM ${SCHEMA}.practice_session_items
        WHERE status = 'answered' AND answered_at IS NULL`,
    );
    // Nothing in the schema stops this row existing. That asymmetry IS the ruling.
    expect(permitted.rows[0].n).toBe(1);
  });

  it("a skipped row produces ZERO units under the status predicate", async () => {
    const result = await pg.query(
      `SELECT count(*)::int AS n FROM ${SCHEMA}.practice_session_items
       WHERE status = 'answered' AND occurred_at = '2026-09-21T15:05:00Z'`,
    );
    expect(result.rows[0].n).toBe(0);
  });
});
