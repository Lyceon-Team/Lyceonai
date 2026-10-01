/**
 * @spec [brief R3 §2.4 (newest first, unknown dates last); register UI-16]
 * | @implemented [2026-09-29]
 *
 * plain English: the past-session picker's paging over DATED rows. The route
 * suite (review.routes.pg.ci.test.ts A16) seeds no parent session rows, so every
 * created_at there is null and only the tie-break is exercised; the date half of
 * the sort key is pinned here, on the real functions: newest first, undated rows
 * last, and a cursor walk that visits each row once.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {},
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  compareSourceSessions,
  decodeSourceSessionsCursor,
  pageSourceSessions,
} from "../../server/services/review-pool";
import type { ReviewPoolSummaryResponse } from "@lyceon/shared";

type Row = ReviewPoolSummaryResponse["sessions"][number];

function row(id: string, createdAt: string | null): Row {
  return {
    source_engine: "practice",
    source_session_id: id,
    created_at: createdAt,
    local_date: null,
    local_time: null,
    mode: null,
    filters: null,
    open_count: 1,
  };
}

// 45 rows: 40 dated (two per day, so dates tie), 5 undated.
const ROWS: Row[] = [];
for (let i = 0; i < 40; i += 1) {
  const day = String(1 + Math.floor(i / 2)).padStart(2, "0");
  ROWS.push(row(`s-${String(i).padStart(2, "0")}`, `2026-09-${day}T10:00:00Z`));
}
for (let i = 40; i < 45; i += 1) ROWS.push(row(`s-${i}`, null));
const SORTED = [...ROWS].sort(compareSourceSessions);

describe("past-session picker order and paging (UI-16)", () => {
  it("newest first, same-date rows by id, undated rows last", () => {
    expect(SORTED[0]?.created_at).toBe("2026-09-20T10:00:00Z");
    expect(SORTED[0]?.source_session_id).toBe("s-38");
    expect(SORTED[1]?.source_session_id).toBe("s-39");
    expect(SORTED.slice(-5).every((r) => r.created_at === null)).toBe(true);
  });

  it("a cursor walk visits every row once, in order, 20 at a time", () => {
    const seen: Row[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const anchor = cursor ? decodeSourceSessionsCursor(cursor) : null;
      const page = pageSourceSessions(SORTED, anchor, 20);
      sizes.push(page.rows.length);
      seen.push(...page.rows);
      cursor = page.nextCursor;
    } while (cursor && sizes.length < 10);
    expect(sizes).toEqual([20, 20, 5]);
    expect(seen).toEqual(SORTED);
  });

  it("exactly one page has no cursor; empty has no rows and no cursor", () => {
    expect(pageSourceSessions(SORTED.slice(0, 20), null, 20).nextCursor).toBe(
      null,
    );
    expect(pageSourceSessions([], null, 20)).toEqual({
      rows: [],
      nextCursor: null,
    });
  });
});
