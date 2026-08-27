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
import {
  sweep7d,
  sweep90d,
  sweep180d,
  sweep365d,
  retentionCutoff,
  CRISIS_STATUS,
} from "../../server/services/retention-sweep";

import type { ArchiveClient } from "../../server/services/retention-archive";

// ── Mock logger ──────────────────────────────────────────────────────

vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Mock archive client ─────────────────────────────────────────────

/**
 * Recording mock for ArchiveClient. Records every insertRows call and
 * can be configured to succeed or fail.
 */
function mockArchiveClient(
  opts: { shouldFail?: boolean; failMessage?: string } = {},
): ArchiveClient & {
  calls: Array<{
    datasetId: string;
    tableId: string;
    rows: Record<string, unknown>[];
  }>;
} {
  const calls: Array<{
    datasetId: string;
    tableId: string;
    rows: Record<string, unknown>[];
  }> = [];

  return {
    calls,
    async insertRows(
      datasetId: string,
      tableId: string,
      rows: Record<string, unknown>[],
    ): Promise<{ insertedCount: number }> {
      calls.push({ datasetId, tableId, rows });
      if (opts.shouldFail) {
        throw new Error(
          opts.failMessage ?? "BigQuery insert failed (mock error)",
        );
      }
      return { insertedCount: rows.length };
    },
  };
}

// ── Archive module mock ──────────────────────────────────────────────
// archiveRows reads BIGQUERY_ARCHIVE_DATASET from process.env. Set it
// for the test process so archiveRows doesn't short-circuit.
process.env.BIGQUERY_ARCHIVE_DATASET = "lyceon_analytics_archive_test";

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

describe("7d tier — negative control", () => {
  it("deletes expired row, preserves unexpired row", async () => {
    const client = filteringMockClient({
      tutor_conversations: [
        { id: "conv-expired", student_id: "s1", deleted_at: daysAgo(8) },
        { id: "conv-fresh", student_id: "s2", deleted_at: daysAgo(6) },
      ],
      tutor_memory_summaries: [],
    });

    const result = await sweep7d(client, false, { now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted_count).toBe(1);
      expect(result.dry_run).toBe(false);
    }

    // Negative control: unexpired row survives
    const remaining = client._store.tutor_conversations;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("conv-fresh");
  });

  it("does not delete conversations with null deleted_at (active)", async () => {
    const client = filteringMockClient({
      tutor_conversations: [
        { id: "conv-active", student_id: "s1", deleted_at: null },
        { id: "conv-expired", student_id: "s1", deleted_at: daysAgo(8) },
      ],
      tutor_memory_summaries: [],
    });

    const result = await sweep7d(client, false, { now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deleted_count).toBe(1);

    // Active conversation (null deleted_at) must survive
    const remaining = client._store.tutor_conversations;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("conv-active");
  });

  it("dry-run deletes nothing — both rows survive", async () => {
    const client = filteringMockClient({
      tutor_conversations: [
        { id: "conv-expired", student_id: "s1", deleted_at: daysAgo(8) },
        { id: "conv-fresh", student_id: "s2", deleted_at: daysAgo(6) },
      ],
      tutor_memory_summaries: [],
    });

    const result = await sweep7d(client, true, { now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted_count).toBe(1); // count only
      expect(result.dry_run).toBe(true);
    }

    // BOTH rows survive — dry-run performed no DELETE
    expect(client._store.tutor_conversations).toHaveLength(2);
  });

  it("cross-student: another student's unexpired row survives", async () => {
    const client = filteringMockClient({
      tutor_conversations: [
        { id: "conv-s1-expired", student_id: "s1", deleted_at: daysAgo(10) },
        { id: "conv-s2-fresh", student_id: "s2", deleted_at: daysAgo(3) },
        { id: "conv-s3-active", student_id: "s3", deleted_at: null },
      ],
      tutor_memory_summaries: [],
    });

    await sweep7d(client, false, { now: NOW });

    const remaining = client._store.tutor_conversations;
    expect(remaining).toHaveLength(2);
    const ids = remaining.map((r: Row) => r.id);
    expect(ids).toContain("conv-s2-fresh");
    expect(ids).toContain("conv-s3-active");
    expect(ids).not.toContain("conv-s1-expired");
  });

  it("purges memory summaries when student has zero remaining active conversations", async () => {
    const client = filteringMockClient({
      tutor_conversations: [
        // s1 has only one conversation and it's expired — after sweep, s1 has zero active
        { id: "conv-s1", student_id: "s1", deleted_at: daysAgo(8) },
        // s2 has one expired, one active — s2 keeps memory summaries
        { id: "conv-s2-expired", student_id: "s2", deleted_at: daysAgo(8) },
        { id: "conv-s2-active", student_id: "s2", deleted_at: null },
      ],
      tutor_memory_summaries: [
        { id: "mem-s1", student_id: "s1", summary_type: "weekly" },
        { id: "mem-s2", student_id: "s2", summary_type: "weekly" },
      ],
    });

    await sweep7d(client, false, { now: NOW });

    // s1 memory summaries should be purged (zero remaining active conversations)
    // s2 memory summaries should survive (still has an active conversation)
    const memRows = client._store.tutor_memory_summaries;
    expect(memRows).toHaveLength(1);
    expect(memRows[0].student_id).toBe("s2");
  });

  it("memory summaries survive when student has soft-deleted conversations inside recovery window (BLOCKER 1)", async () => {
    // LISA-GCP-001: student s1 has two soft-deleted conversations:
    //   - conv-past-window: deleted 8 days ago (past 7-day recovery window, swept)
    //   - conv-in-window:   deleted 3 days ago (inside 7-day recovery window, retained)
    //
    // After sweep, s1 has zero active conversations BUT one conversation still
    // inside the recovery window. Memory summaries MUST survive because §14.2
    // promises "LISA data is recovered with conversation history intact" during
    // the 7-day window — summaries are per-student, not per-conversation.
    const client = filteringMockClient({
      tutor_conversations: [
        { id: "conv-past-window", student_id: "s1", deleted_at: daysAgo(8) },
        { id: "conv-in-window", student_id: "s1", deleted_at: daysAgo(3) },
      ],
      tutor_memory_summaries: [
        { id: "mem-s1", student_id: "s1", summary_type: "weekly" },
      ],
    });

    await sweep7d(client, false, { now: NOW });

    // The 8-day-old conversation is swept
    expect(client._store.tutor_conversations).toHaveLength(1);
    expect(client._store.tutor_conversations[0].id).toBe("conv-in-window");

    // CRITICAL: memory summaries SURVIVE because conv-in-window is still
    // within the 7-day recovery window. Without the BLOCKER 1 fix, this
    // would be empty (summaries deleted prematurely).
    expect(client._store.tutor_memory_summaries).toHaveLength(1);
    expect(client._store.tutor_memory_summaries[0].id).toBe("mem-s1");
  });

  it("memory summaries purged when ALL soft-deleted conversations are past recovery window", async () => {
    // Companion to the recovery window test above: when ALL of a student's
    // conversations are past the 7-day window AND none are active, summaries
    // are properly purged.
    const client = filteringMockClient({
      tutor_conversations: [
        { id: "conv-old-1", student_id: "s1", deleted_at: daysAgo(10) },
        { id: "conv-old-2", student_id: "s1", deleted_at: daysAgo(8) },
      ],
      tutor_memory_summaries: [
        { id: "mem-s1", student_id: "s1", summary_type: "weekly" },
      ],
    });

    await sweep7d(client, false, { now: NOW });

    // Both conversations swept (both past window)
    expect(client._store.tutor_conversations).toHaveLength(0);

    // Memory summaries purged — no active, no recoverable conversations
    expect(client._store.tutor_memory_summaries).toHaveLength(0);
  });

  it("exact boundary: row at exactly 7 days is NOT expired (strictly less than)", async () => {
    // The cutoff is now - 7d. A row with deleted_at exactly at the cutoff
    // should NOT be deleted because the condition is lt (strictly less than).
    const exactBoundary = retentionCutoff(NOW, 7);
    const client = filteringMockClient({
      tutor_conversations: [
        { id: "conv-exact", student_id: "s1", deleted_at: exactBoundary },
      ],
      tutor_memory_summaries: [],
    });

    const result = await sweep7d(client, false, { now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deleted_count).toBe(0);

    // Row at exact boundary survives
    expect(client._store.tutor_conversations).toHaveLength(1);
  });
});

// ── 90-day tier ──────────────────────────────────────────────────────

describe("90d tier — archive-before-delete", () => {
  it("archives and deletes expired rows, preserves unexpired rows", async () => {
    const archive = mockArchiveClient();
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

    const result = await sweep90d(client, false, {
      now: NOW,
      archiveClient: archive,
    });

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

    // Archive was called for both tables with the expired rows
    expect(archive.calls).toHaveLength(2);
    expect(archive.calls[0].tableId).toBe(
      "retention__tutor_instruction_assignments",
    );
    expect(archive.calls[0].rows).toHaveLength(1);
    expect(archive.calls[0].rows[0]._source_table).toBe(
      "tutor_instruction_assignments",
    );
    expect(archive.calls[1].tableId).toBe(
      "retention__tutor_instruction_exposures",
    );
    expect(archive.calls[1].rows).toHaveLength(1);
  });

  it("archive failure blocks delete — no data loss", async () => {
    const archive = mockArchiveClient({ shouldFail: true });
    const client = filteringMockClient({
      tutor_instruction_assignments: [
        { id: "assign-expired", created_at: daysAgo(91) },
      ],
      tutor_instruction_exposures: [],
    });

    const result = await sweep90d(client, false, {
      now: NOW,
      archiveClient: archive,
    });

    // Archive failed → sweep returns ok: false
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("archive_blocked_delete");
      expect(result.tier).toBe("90d");
    }

    // CRITICAL: ALL rows survive — delete was blocked by archive failure
    expect(client._store.tutor_instruction_assignments).toHaveLength(1);
  });

  it("no archive client returns ok: false (safe default)", async () => {
    const client = filteringMockClient({
      tutor_instruction_assignments: [
        { id: "assign-expired", created_at: daysAgo(91) },
      ],
      tutor_instruction_exposures: [],
    });

    // No archiveClient in opts — safe default
    const result = await sweep90d(client, false, { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("archive_client_not_configured");
      expect(result.reason).toContain("LISA-RET-001");
    }

    // ALL rows survive
    expect(client._store.tutor_instruction_assignments).toHaveLength(1);
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

  it("empty tables: returns ok: true, deleted_count: 0 (no archive calls)", async () => {
    const archive = mockArchiveClient();
    const client = filteringMockClient({
      tutor_instruction_assignments: [],
      tutor_instruction_exposures: [],
    });

    const result = await sweep90d(client, false, {
      now: NOW,
      archiveClient: archive,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted_count).toBe(0);
      expect(result.dry_run).toBe(false);
    }

    // No archive calls for empty tables
    expect(archive.calls).toHaveLength(0);
  });
});

// ── 180-day tier ─────────────────────────────────────────────────────

describe("180d tier — archive-before-delete", () => {
  it("archives and deletes expired resolved crisis cases + injection logs", async () => {
    const archive = mockArchiveClient();
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

    const result = await sweep180d(client, false, {
      now: NOW,
      archiveClient: archive,
    });

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

    // Archive was called for both tables
    expect(archive.calls).toHaveLength(2);
    expect(archive.calls[0].tableId).toBe("retention__crisis_review_cases");
    expect(archive.calls[0].rows).toHaveLength(1);
    expect(archive.calls[0].rows[0]._source_table).toBe("crisis_review_cases");
    expect(archive.calls[1].tableId).toBe("retention__tutor_injection_log");
    expect(archive.calls[1].rows).toHaveLength(1);
  });

  it("open/in-review crisis cases retained regardless of age", async () => {
    const archive = mockArchiveClient();
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

    const result = await sweep180d(client, false, {
      now: NOW,
      archiveClient: archive,
    });

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

    // Archive was called only for crisis (resolved), not injection (empty)
    expect(archive.calls).toHaveLength(1);
    expect(archive.calls[0].tableId).toBe("retention__crisis_review_cases");
  });

  it("archive failure blocks delete — no data loss", async () => {
    const archive = mockArchiveClient({ shouldFail: true });
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

    const result = await sweep180d(client, false, {
      now: NOW,
      archiveClient: archive,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("archive_blocked_delete");
      expect(result.tier).toBe("180d");
    }

    // CRITICAL: ALL rows survive — delete was blocked
    expect(client._store.crisis_review_cases).toHaveLength(1);
    expect(client._store.tutor_injection_log).toHaveLength(1);
  });

  it("no archive client returns ok: false (safe default)", async () => {
    const client = filteringMockClient({
      crisis_review_cases: [
        {
          id: "crisis-expired",
          status: CRISIS_STATUS.RESOLVED,
          created_at: daysAgo(200),
        },
      ],
      tutor_injection_log: [],
    });

    const result = await sweep180d(client, false, { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("archive_client_not_configured");
      expect(result.reason).toContain("LISA-RET-002");
    }

    // ALL rows survive
    expect(client._store.crisis_review_cases).toHaveLength(1);
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
  it("7d sweep does not touch 90d tables", async () => {
    const client = filteringMockClient({
      tutor_conversations: [
        { id: "conv-expired", student_id: "s1", deleted_at: daysAgo(8) },
      ],
      tutor_memory_summaries: [],
      tutor_instruction_assignments: [
        { id: "assign-old", created_at: daysAgo(100) },
      ],
      tutor_instruction_exposures: [
        { id: "expose-old", created_at: daysAgo(100) },
      ],
    });

    await sweep7d(client, false, { now: NOW });

    // 7d sweep deleted the conversation
    expect(client._store.tutor_conversations).toHaveLength(0);

    // 90d tables are untouched
    expect(client._store.tutor_instruction_assignments).toHaveLength(1);
    expect(client._store.tutor_instruction_exposures).toHaveLength(1);
  });

  it("7d sweep does not touch 180d tables", async () => {
    const client = filteringMockClient({
      tutor_conversations: [
        { id: "conv-expired", student_id: "s1", deleted_at: daysAgo(8) },
      ],
      tutor_memory_summaries: [],
      crisis_review_cases: [
        {
          id: "crisis-old",
          status: CRISIS_STATUS.RESOLVED,
          created_at: daysAgo(200),
        },
      ],
      tutor_injection_log: [{ id: "inj-old", detected_at: daysAgo(200) }],
    });

    await sweep7d(client, false, { now: NOW });

    // 180d tables untouched
    expect(client._store.crisis_review_cases).toHaveLength(1);
    expect(client._store.tutor_injection_log).toHaveLength(1);
  });

  it("90d sweep does not touch 7d or 180d tables", async () => {
    const archive = mockArchiveClient();
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

    const result = await sweep90d(client, false, {
      now: NOW,
      archiveClient: archive,
    });

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
  it("7d returns ok: true, deleted_count: 0 on empty table", async () => {
    const client = filteringMockClient({
      tutor_conversations: [],
      tutor_memory_summaries: [],
    });

    const result = await sweep7d(client, false, { now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted_count).toBe(0);
      expect(result.dry_run).toBe(false);
    }
  });

  it("90d returns ok: true, deleted_count: 0 on empty tables", async () => {
    const archive = mockArchiveClient();
    const client = filteringMockClient({
      tutor_instruction_assignments: [],
      tutor_instruction_exposures: [],
    });

    const result = await sweep90d(client, false, {
      now: NOW,
      archiveClient: archive,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted_count).toBe(0);
      expect(result.dry_run).toBe(false);
    }

    // No archive calls for empty tables
    expect(archive.calls).toHaveLength(0);
  });

  it("180d returns ok: true, deleted_count: 0 on empty tables", async () => {
    const archive = mockArchiveClient();
    const client = filteringMockClient({
      crisis_review_cases: [],
      tutor_injection_log: [],
    });

    const result = await sweep180d(client, false, {
      now: NOW,
      archiveClient: archive,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted_count).toBe(0);
      expect(result.dry_run).toBe(false);
    }

    // No archive calls for empty tables
    expect(archive.calls).toHaveLength(0);
  });
});
