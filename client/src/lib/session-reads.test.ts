/**
 * QA item 6 (owner QA list, Karl, 2026-10-07): `invalidateSessionReads` marks the right reads stale.
 *
 * @spec [owner QA list item 6; session-reads.ts] | @implemented [2026-10-07]
 *
 * plain English: over a real QueryClient with the app's defaults (`staleTime: Infinity`), each
 * read is held by a live observer, as a mounted page holds it. A list on screen is refetched at
 * once; the review pool is matched by its real `?tz=` key; the runner's own state read is marked
 * stale but NOT refetched under the runner (a refetch would swap it for "Session complete").
 */
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { reviewPoolPath } from "@/hooks/useReview";
import { invalidateSessionReads } from "./session-reads";

const SESSION = "55555555-5555-4555-8555-555555555555";

function harness(): {
  client: QueryClient;
  calls: Map<string, number>;
  watch: (key: readonly unknown[]) => () => void;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const calls = new Map<string, number>();
  const watch = (key: readonly unknown[]): (() => void) => {
    const id = JSON.stringify(key);
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: async () => {
        calls.set(id, (calls.get(id) ?? 0) + 1);
        return { n: calls.get(id) };
      },
    });
    return observer.subscribe(() => undefined);
  };
  return { client, calls, watch };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let stop: Array<() => void> = [];
afterEach(() => {
  for (const s of stop) s();
  stop = [];
});

describe("invalidateSessionReads (QA item 6)", () => {
  it("refetches the lists on screen, matching the review pool by its ?tz= key", async () => {
    const { client, calls, watch } = harness();
    const pool = [reviewPoolPath("America/Chicago")];
    const keys = [
      ["/api/practice/sessions/open"],
      ["/api/review/sessions/open"],
      pool,
      ["calendar", "range", "2026-09-28", "2026-10-04", "UTC"],
      ["/api/students/s-1/mastery/domains"],
    ];
    stop = keys.map(watch);
    await settle();
    // Presence: each read was fetched once by its observer.
    expect(keys.map((k) => calls.get(JSON.stringify(k)))).toEqual([
      1, 1, 1, 1, 1,
    ]);
    expect(pool[0]).toContain("?tz=");
    invalidateSessionReads(client, { engine: "practice", sessionId: SESSION });
    await settle();
    expect(keys.map((k) => calls.get(JSON.stringify(k)))).toEqual([
      2, 2, 2, 2, 2,
    ]);
  });

  it("marks this session's state stale without refetching it under the runner", async () => {
    const { client, calls, watch } = harness();
    const state = [
      `/api/review/sessions/${SESSION}/state?client_instance_id=c-1`,
    ];
    const other = [
      `/api/review/sessions/66666666-6666-4666-8666-666666666666/state?client_instance_id=c-1`,
    ];
    stop = [watch(state), watch(other)];
    await settle();
    expect(calls.get(JSON.stringify(state))).toBe(1);
    invalidateSessionReads(client, { engine: "review", sessionId: SESSION });
    await settle();
    expect(client.getQueryState(state)?.isInvalidated).toBe(true);
    expect(calls.get(JSON.stringify(state))).toBe(1);
    // Another session's state is not this session's business.
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  });
});
