/**
 * @spec [Doc-03_V1.1 §14.2, INV-03-19]
 * @implemented 2026-08-21
 *
 * plain English: Negative-control contract tests for the four LISA retention
 * sweep tiers. For each tier, rows are seeded on BOTH sides of the retention
 * boundary. After the sweep, expired rows must be gone and unexpired rows
 * must survive — the survival check is the negative control.
 *
 * Without the negative control, a sweep that truncates the table passes every
 * "expired row is deleted" assertion perfectly.
 *
 * trade-offs:
 *  - Uses a filtering mock client rather than an ephemeral Postgres instance.
 *    The mock evaluates real PostgREST-style predicates against in-memory
 *    rows, so an incorrect .lt() / .eq() / .not() boundary will fail the test
 *    for the same reason it would mis-delete production data. This is one
 *    level above a recording mock (which only proves the chain was issued) and
 *    one level below an ephemeral-PG proof (which would also cover RLS, FK
 *    cascades, and CHECK constraints).
 *  - 365d tier is a structured no-op (tables not provisioned) — tested as such.
 *  - 90d and 180d DELETE OUTRIGHT. They used to archive to BigQuery first and
 *    refuse to delete if the archive was unreachable. Owner ruling 2026-09-22
 *    (Doc 07B §5.4) reversed that: the archive tables carried `student_id`,
 *    `reviewer_id` and free-text notes about minors in crisis, which §5.4
 *    forbids in any warehouse dataset. Nothing had ever been archived, so
 *    there was nothing to migrate. The tests below pin the reversal: the
 *    tiers delete with no archive of any kind configured, and the sweep
 *    module carries no archive path at all.
 *
 * edge cases:
 *  - 180d crisis: only RESOLVED cases are swept. Open/in-review cases older
 *    than 180 days are retained regardless of age (safety review ongoing).
 *    This is the spec's "hard delete at 180 days or on closure, whichever is
 *    later." Status values are derived from CRISIS_STATUS (which traces to the
 *    CHECK constraint), never hardcoded — LISA-GCP-002.
 *  - 7d memory summaries: only purged when a student has zero remaining active
 *    conversations (conservative — spec says "cascade from account/entitlement").
 *  - Cross-table isolation: 7d sweep must not touch 90d/180d tables.
 *  - Cross-student: a sweep must not delete another student's unexpired rows.
 */
import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "./lib/strip-comments";
import {
  sweep90d,
  sweep180d,
  sweep365d,
  retentionCutoff,
  CRISIS_STATUS,
} from "../../server/services/retention-sweep";

// ── Mock logger ──────────────────────────────────────────────────────

vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Constants ────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Fixed "now" for all tests — makes boundary arithmetic deterministic. */
const NOW = new Date("2026-08-21T12:00:00.000Z");

/**
 * Helper: produce an ISO timestamp N days before NOW.
 */
function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * MS_PER_DAY).toISOString();
}

// ── Filtering mock client ────────────────────────────────────────────

/**
 * A mock SupabaseClient that maintains in-memory tables and evaluates
 * PostgREST-style predicate chains against them. This is the core
 * mechanism: the sweep's .lt() / .eq() / .not() / .is() calls are applied
 * as actual filters, so an incorrect predicate changes which rows get
 * deleted — and the test fails.
 *
 * Supports: .from().select() / .delete() chains with .lt(), .eq(),
 * .not("col", "is", null), .is("col", null), and count mode.
 */
type Row = Record<string, unknown>;

function filteringMockClient(tables: Record<string, Row[]>) {
  // Deep-clone so mutations don't leak between tests
  const store: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(tables)) {
    store[k] = v.map((r) => ({ ...r }));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double
  const client: any = {
    from: (table: string) => {
      /**
       * Supabase's PostgrestFilterBuilder is both chainable AND thenable.
       * Each filter method returns `this`, and `this` implements PromiseLike.
       * The mock must replicate this: .lt() / .eq() return the chain, and
       * awaiting the chain resolves the query. An explicit .select() on a
       * delete chain also resolves as a terminal.
       */
      function makeChain(
        mode: "select" | "delete",
        predicates: Array<(row: Row) => boolean>,
        initialFields?: string,
        initialOpts?: { count?: string; head?: boolean },
      ) {
        const chain: Record<string, unknown> = {};

        /** Apply predicates against the current table state and resolve. */
        function resolve(
          fields?: string,
          opts?: { count?: string; head?: boolean },
        ): Promise<{
          data: Row[] | null;
          count?: number;
          error: null;
        }> {
          // Read table at resolution time — not from() time — so a second
          // from() call on the same table after a delete sees the update.
          const rows = store[table] ?? [];
          const matching = rows.filter((row) =>
            predicates.every((p) => p(row)),
          );

          if (mode === "delete") {
            store[table] = rows.filter(
              (row) => !predicates.every((p) => p(row)),
            );
            const projected = projectFields(matching, fields);
            return Promise.resolve({ data: projected, error: null });
          }

          // select mode
          if (opts?.head && opts?.count === "exact") {
            return Promise.resolve({
              data: null,
              count: matching.length,
              error: null,
            });
          }
          const projected = projectFields(matching, fields);
          return Promise.resolve({ data: projected, error: null });
        }

        // ── Predicate methods — return the chain for further chaining ──

        chain.lt = (col: string, val: unknown) => {
          predicates.push((row) => {
            const rv = row[col];
            if (rv === null || rv === undefined) return false;
            return String(rv) < String(val);
          });
          return chain;
        };

        chain.eq = (col: string, val: unknown) => {
          predicates.push((row) => row[col] === val);
          return chain;
        };

        chain.neq = (col: string, val: unknown) => {
          predicates.push((row) => row[col] !== val);
          return chain;
        };

        chain.not = (col: string, op: string, val: unknown) => {
          if (op === "is" && val === null) {
            predicates.push(
              (row) => row[col] !== null && row[col] !== undefined,
            );
          }
          return chain;
        };

        chain.is = (col: string, val: unknown) => {
          if (val === null) {
            predicates.push(
              (row) => row[col] === null || row[col] === undefined,
            );
          }
          return chain;
        };

        chain.gte = (col: string, val: unknown) => {
          predicates.push((row) => {
            const rv = row[col];
            if (rv === null || rv === undefined) return false;
            return String(rv) >= String(val);
          });
          return chain;
        };

        chain.in = (col: string, vals: unknown[]) => {
          predicates.push((row) => (vals as unknown[]).includes(row[col]));
          return chain;
        };

        // ── Terminal: explicit .select() on a delete chain ──
        chain.select = (
          fields?: string,
          opts?: { count?: string; head?: boolean },
        ) => {
          return resolve(fields, opts);
        };

        // ── Thenable: makes the chain awaitable ──
        // Supabase's PostgrestFilterBuilder is PromiseLike; the mock must
        // be too, so `await client.from().select().lt()` resolves correctly.
        chain.then = (
          onFulfilled?: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => {
          return resolve(initialFields, initialOpts).then(
            onFulfilled,
            onRejected,
          );
        };

        return chain;
      }

      return {
        select: (
          fields?: string,
          opts?: { count?: string; head?: boolean },
        ) => {
          return makeChain("select", [], fields, opts);
        },
        delete: () => {
          return makeChain("delete", []);
        },
      };
    },

    /** Expose store for assertions */
    _store: store,
  };

  return client;
}

/**
 * Project row fields from a comma-separated field list.
 * "id, student_id" → pick only those keys.
 */
function projectFields(rows: Row[], fields?: string): Row[] {
  if (!fields) return rows;
  const keys = fields.split(",").map((f) => f.trim());
  return rows.map((row) => {
    const out: Row = {};
    for (const k of keys) {
      if (k in row) out[k] = row[k];
    }
    return out;
  });
}

// ── retentionCutoff unit tests ───────────────────────────────────────

describe("retentionCutoff (pure boundary function)", () => {
  it("returns ISO timestamp exactly N days before now", () => {
    expect(retentionCutoff(NOW, 7)).toBe("2026-08-14T12:00:00.000Z");
    expect(retentionCutoff(NOW, 90)).toBe("2026-05-23T12:00:00.000Z");
    expect(retentionCutoff(NOW, 180)).toBe("2026-02-22T12:00:00.000Z");
    expect(retentionCutoff(NOW, 365)).toBe("2025-08-21T12:00:00.000Z");
  });

  it("is deterministic — same inputs, same output", () => {
    const a = retentionCutoff(NOW, 7);
    const b = retentionCutoff(NOW, 7);
    expect(a).toBe(b);
  });
});

// ── 7-day tier ───────────────────────────────────────────────────────

// 7d tier: moved to real Postgres (RS-00, 2026-10-05). The tier is one SQL function now
// (`sweep_tutor_conversation_retention`), which a filtering mock cannot execute, so every 7d case
// that lived here — expired vs unexpired, active rows, dry run, cross-student, the memory-summary
// recovery rules, the boundary, isolation from the 90d/180d tables, the empty table — runs in
// tests/ci/retention-sweep.pg.ci.test.ts against the real function.

describe("90d tier — delete outright", () => {
  it("deletes expired rows, preserves unexpired rows", async () => {
    const client = filteringMockClient({
      tutor_instruction_assignments: [
        { id: "assign-expired", created_at: daysAgo(91) },
        { id: "assign-fresh", created_at: daysAgo(89) },
      ],
      tutor_instruction_exposures: [
        { id: "expose-expired", created_at: daysAgo(100) },
        { id: "expose-fresh", created_at: daysAgo(30) },
      ],
    });

    const result = await sweep90d(client, false, { now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted_count).toBe(2);
      expect(result.dry_run).toBe(false);
    }

    // Negative control: unexpired rows survive
    expect(client._store.tutor_instruction_assignments).toHaveLength(1);
    expect(client._store.tutor_instruction_assignments[0].id).toBe(
      "assign-fresh",
    );
    expect(client._store.tutor_instruction_exposures).toHaveLength(1);
    expect(client._store.tutor_instruction_exposures[0].id).toBe(
      "expose-fresh",
    );
  });

  it("deletes with no archive configuration of any kind (Doc 07B §5.4 reversal)", async () => {
    // This is the assertion the reversal turns on. Before the 2026-09-22
    // ruling this exact call returned ok: false / archive_client_not_configured
    // and deleted nothing, which is why the tier could never be scheduled.
    // Unset the env var the retired archive client used to read, so a
    // reintroduced env-gated path cannot make this pass by accident.
    const saved = process.env.BIGQUERY_ARCHIVE_DATASET;
    delete process.env.BIGQUERY_ARCHIVE_DATASET;
    try {
      const client = filteringMockClient({
        tutor_instruction_assignments: [
          { id: "assign-expired", created_at: daysAgo(91) },
          { id: "assign-fresh", created_at: daysAgo(89) },
        ],
        tutor_instruction_exposures: [],
      });

      const result = await sweep90d(client, false, { now: NOW });

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.deleted_count).toBe(1);

      // Expired row is gone; the unexpired one is the negative control.
      expect(client._store.tutor_instruction_assignments).toHaveLength(1);
      expect(client._store.tutor_instruction_assignments[0].id).toBe(
        "assign-fresh",
      );
    } finally {
      if (saved === undefined) delete process.env.BIGQUERY_ARCHIVE_DATASET;
      else process.env.BIGQUERY_ARCHIVE_DATASET = saved;
    }
  });

  it("dry-run still counts expired rows (monitoring path preserved)", async () => {
    const client = filteringMockClient({
      tutor_instruction_assignments: [
        { id: "assign-expired", created_at: daysAgo(91) },
        { id: "assign-fresh", created_at: daysAgo(89) },
      ],
      tutor_instruction_exposures: [
        { id: "expose-expired", created_at: daysAgo(100) },
      ],
    });

    const result = await sweep90d(client, true, { now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted_count).toBe(2);
      expect(result.dry_run).toBe(true);
    }

    // Both survive — no DELETE was issued
    expect(client._store.tutor_instruction_assignments).toHaveLength(2);
    expect(client._store.tutor_instruction_exposures).toHaveLength(1);
  });

  it("exact boundary: dry-run at exactly 90 days reports 0 expired", async () => {
    const exactBoundary = retentionCutoff(NOW, 90);
    const client = filteringMockClient({
      tutor_instruction_assignments: [
        { id: "assign-exact", created_at: exactBoundary },
      ],
      tutor_instruction_exposures: [],
    });

    const result = await sweep90d(client, true, { now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deleted_count).toBe(0);

    expect(client._store.tutor_instruction_assignments).toHaveLength(1);
  });

  it("empty tables: returns ok: true, deleted_count: 0", async () => {
    const client = filteringMockClient({
      tutor_instruction_assignments: [],
      tutor_instruction_exposures: [],
    });

    const result = await sweep90d(client, false, { now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted_count).toBe(0);
      expect(result.dry_run).toBe(false);
    }
  });
});

// ── 180-day tier ─────────────────────────────────────────────────────

describe("180d tier — delete outright", () => {
  it("deletes expired resolved crisis cases + injection logs", async () => {
    const client = filteringMockClient({
      crisis_review_cases: [
        {
          id: "crisis-expired",
          status: CRISIS_STATUS.RESOLVED,
          created_at: daysAgo(200),
        },
        {
          id: "crisis-fresh",
          status: CRISIS_STATUS.RESOLVED,
          created_at: daysAgo(90),
        },
      ],
      tutor_injection_log: [
        { id: "inj-expired", detected_at: daysAgo(181) },
        { id: "inj-fresh", detected_at: daysAgo(179) },
      ],
    });

    const result = await sweep180d(client, false, { now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted_count).toBe(2);
      expect(result.dry_run).toBe(false);
    }

    // Negative control: unexpired rows survive
    expect(client._store.crisis_review_cases).toHaveLength(1);
    expect(client._store.crisis_review_cases[0].id).toBe("crisis-fresh");
    expect(client._store.tutor_injection_log).toHaveLength(1);
    expect(client._store.tutor_injection_log[0].id).toBe("inj-fresh");
  });

  it("open/in-review crisis cases retained regardless of age", async () => {
    const client = filteringMockClient({
      crisis_review_cases: [
        // Open case, 200 days old — NOT swept (safety review ongoing)
        {
          id: "crisis-open-old",
          status: CRISIS_STATUS.OPEN,
          created_at: daysAgo(200),
        },
        // In-review case, 190 days old — NOT swept
        {
          id: "crisis-review-old",
          status: CRISIS_STATUS.IN_REVIEW,
          created_at: daysAgo(190),
        },
        // Resolved case, 200 days old — swept
        {
          id: "crisis-resolved-old",
          status: CRISIS_STATUS.RESOLVED,
          created_at: daysAgo(200),
        },
      ],
      tutor_injection_log: [],
    });

    const result = await sweep180d(client, false, { now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted_count).toBe(1); // only the resolved one
    }

    // Open + in-review survive
    expect(client._store.crisis_review_cases).toHaveLength(2);
    const ids = client._store.crisis_review_cases.map((r: Row) => r.id);
    expect(ids).toContain("crisis-open-old");
    expect(ids).toContain("crisis-review-old");
    expect(ids).not.toContain("crisis-resolved-old");
  });

  it("deletes with no archive configuration of any kind (Doc 07B §5.4 reversal)", async () => {
    // The 180d counterpart of the 90d assertion above. This tier carried the
    // worst of the §5.4 violation — `reviewer_id` and `review_notes`, human
    // free text about a minor in crisis — so the reversal matters most here.
    const saved = process.env.BIGQUERY_ARCHIVE_DATASET;
    delete process.env.BIGQUERY_ARCHIVE_DATASET;
    try {
      const client = filteringMockClient({
        crisis_review_cases: [
          {
            id: "crisis-expired",
            status: CRISIS_STATUS.RESOLVED,
            created_at: daysAgo(200),
          },
          {
            id: "crisis-fresh",
            status: CRISIS_STATUS.RESOLVED,
            created_at: daysAgo(90),
          },
        ],
        tutor_injection_log: [],
      });

      const result = await sweep180d(client, false, { now: NOW });

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.deleted_count).toBe(1);

      expect(client._store.crisis_review_cases).toHaveLength(1);
      expect(client._store.crisis_review_cases[0].id).toBe("crisis-fresh");
    } finally {
      if (saved === undefined) delete process.env.BIGQUERY_ARCHIVE_DATASET;
      else process.env.BIGQUERY_ARCHIVE_DATASET = saved;
    }
  });

  it("dry-run still counts expired rows (monitoring path preserved)", async () => {
    const client = filteringMockClient({
      crisis_review_cases: [
        {
          id: "crisis-expired",
          status: CRISIS_STATUS.RESOLVED,
          created_at: daysAgo(200),
        },
      ],
      tutor_injection_log: [{ id: "inj-expired", detected_at: daysAgo(181) }],
    });

    const result = await sweep180d(client, true, { now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted_count).toBe(2);
      expect(result.dry_run).toBe(true);
    }

    // Both survive — no DELETE
    expect(client._store.crisis_review_cases).toHaveLength(1);
    expect(client._store.tutor_injection_log).toHaveLength(1);
  });

  it("dry-run: open/in-review crisis cases not counted", async () => {
    const client = filteringMockClient({
      crisis_review_cases: [
        { id: "crisis-open-old", status: "open", created_at: daysAgo(200) },
        {
          id: "crisis-review-old",
          status: "in_review",
          created_at: daysAgo(190),
        },
        {
          id: "crisis-closed-old",
          status: CRISIS_STATUS.RESOLVED,
          created_at: daysAgo(200),
        },
      ],
      tutor_injection_log: [],
    });

    const result = await sweep180d(client, true, { now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted_count).toBe(1); // only the resolved one counted
      expect(result.dry_run).toBe(true);
    }

    // ALL survive — dry-run
    expect(client._store.crisis_review_cases).toHaveLength(3);
  });

  it("exact boundary: dry-run at 180 days reports 0 expired", async () => {
    const exactBoundary = retentionCutoff(NOW, 180);
    const client = filteringMockClient({
      crisis_review_cases: [
        {
          id: "crisis-exact",
          status: CRISIS_STATUS.RESOLVED,
          created_at: exactBoundary,
        },
      ],
      tutor_injection_log: [],
    });

    const result = await sweep180d(client, true, { now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deleted_count).toBe(0);

    expect(client._store.crisis_review_cases).toHaveLength(1);
  });
});

// ── 365-day tier ─────────────────────────────────────────────────────

describe("365d tier — structured no-op", () => {
  it("returns ok: false with reason 365d_tables_not_provisioned", async () => {
    const client = filteringMockClient({});

    const result = await sweep365d(client, false, { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("365d_tables_not_provisioned");
      expect(result.tier).toBe("365d");
    }
  });

  it("dry-run also returns the same no-op", async () => {
    const client = filteringMockClient({});

    const result = await sweep365d(client, true, { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("365d_tables_not_provisioned");
    }
  });
});

// ── Cross-table isolation ────────────────────────────────────────────

describe("cross-table isolation", () => {
  it("90d sweep does not touch 7d or 180d tables", async () => {
    const client = filteringMockClient({
      tutor_instruction_assignments: [
        { id: "assign-expired", created_at: daysAgo(91) },
      ],
      tutor_instruction_exposures: [],
      tutor_conversations: [
        { id: "conv-expired", student_id: "s1", deleted_at: daysAgo(8) },
      ],
      crisis_review_cases: [
        {
          id: "crisis-old",
          status: CRISIS_STATUS.RESOLVED,
          created_at: daysAgo(200),
        },
      ],
      tutor_injection_log: [],
    });

    const result = await sweep90d(client, false, { now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deleted_count).toBe(1);

    // 90d table: expired row swept
    expect(client._store.tutor_instruction_assignments).toHaveLength(0);

    // 7d and 180d tables untouched
    expect(client._store.tutor_conversations).toHaveLength(1);
    expect(client._store.crisis_review_cases).toHaveLength(1);
  });
});

// ── Empty tables ─────────────────────────────────────────────────────

describe("empty tables — no rows to sweep", () => {
  it("90d returns ok: true, deleted_count: 0 on empty tables", async () => {
    const client = filteringMockClient({
      tutor_instruction_assignments: [],
      tutor_instruction_exposures: [],
    });

    const result = await sweep90d(client, false, { now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted_count).toBe(0);
      expect(result.dry_run).toBe(false);
    }
  });

  it("180d returns ok: true, deleted_count: 0 on empty tables", async () => {
    const client = filteringMockClient({
      crisis_review_cases: [],
      tutor_injection_log: [],
    });

    const result = await sweep180d(client, false, { now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted_count).toBe(0);
      expect(result.dry_run).toBe(false);
    }
  });
});

// ── The archive path is gone, not just unused ────────────────────────

describe("Doc 07B §5.4 — no archive path survives in the sweep module", () => {
  /**
   * The tests above prove the tiers delete when no archive is configured.
   * That is satisfied equally by "the archive path is gone" and by "the
   * archive path is still there but this test didn't take it" — and the
   * second is how the §5.4 violation comes back. This reads the module
   * source so the absence itself is the assertion.
   */
  it("retention-sweep.ts references no archive, BigQuery, or warehouse path", () => {
    // Comment-stripped. The module's own header explains at length WHY the
    // archive is gone, and that prose contains every banned term — reading
    // raw source here would assert nothing at all.
    const code = stripComments(
      readFileSync(
        resolve(__dirname, "../../server/services/retention-sweep.ts"),
        "utf-8",
      ),
    ).toLowerCase();
    const banned = ["archive", "bigquery", "retention__", "warehouse"];
    expect(banned.filter((t) => code.includes(t))).toEqual([]);
  });

  it("the retired archive module and its generated schemas are deleted", () => {
    const gone = [
      "server/services/retention-archive.ts",
      "scripts/retention/generate-bq-archive-schemas.mjs",
      "scripts/ci/retention-archive-drift-check.mjs",
      "scripts/retention/schemas",
    ];
    const survivors = gone.filter((p) =>
      existsSync(resolve(__dirname, "../..", p)),
    );
    expect(survivors).toEqual([]);
  });

  it("the internal retention route constructs no archive client", () => {
    const code = stripComments(
      readFileSync(
        resolve(__dirname, "../../server/routes/internal-retention-routes.ts"),
        "utf-8",
      ),
    );
    expect(code.toLowerCase()).not.toContain("archive");
    expect(code).not.toContain("BIGQUERY_ARCHIVE_DATASET");
  });
});
