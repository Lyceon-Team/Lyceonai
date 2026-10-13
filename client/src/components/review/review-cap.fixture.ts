import { startOrReplayReviewSession } from "../../../../server/routes/review-canonical";

/**
 * @spec [CLAUDE.md "derive the fixture from real output"; "one scenario, shared"; owner re-test
 *       (Karl, 2026-10-08) item A, the review cap] | @implemented [2026-10-08]
 *
 * plain English: test-only. The review cap's refusal body is the REAL
 * `startOrReplayReviewSession` output (server/routes/review-canonical.ts, the function both
 * `POST /api/review/sessions` and the calendar's review adapter create through), not a
 * hand-written `{ code: "SESSION_LIMIT_EXCEEDED" }`. The tests fake only the two database reads
 * under it: the student's open review sessions (`review_sessions`, `CAP_OPEN` rows) and practice's
 * runtime config (`practice_runtime_config`, `max_concurrent_sessions` = `CAP_OPEN`, the value
 * production runs with). The real function then counts, compares and builds the refusal.
 *
 * Each page test mocks `apps/api/src/lib/supabase-server` with a `from` that delegates to
 * `capTables` while the refusal is computed, and throws otherwise.
 *
 * trade-offs: the status is the producer's (403 today); the tests also serve the same body under
 * 409, the status the review vertical is moving the cap to, since the client must key on the code.
 * Imported by tests only; nothing in the app bundle reaches it.
 */

/** The cap production runs with, and the number of open sessions that reach it. */
export const CAP_OPEN = 5;

/** Builds an object that resolves like a supabase query at any point of the chain. */
function query(result: { data: unknown; error: null }): unknown {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: typeof result) => unknown) => resolve(result),
  };
  for (const step of ["select", "eq", "in", "order"]) {
    chain[step] = () => chain;
  }
  return chain;
}

/** `supabaseServer.from` for the two tables the cap reads. */
export function capTables(table: string): unknown {
  if (table === "review_sessions")
    return query({
      data: Array.from({ length: CAP_OPEN }, (_, i) => ({
        id: `cap-open-${i + 1}`,
        filters: {},
        status: "active",
      })),
      error: null,
    });
  if (table === "practice_runtime_config")
    return query({
      data: [
        { key: "max_concurrent_sessions", value: CAP_OPEN },
        { key: "default_session_count_web", value: 10 },
        { key: "max_session_count_premium", value: 50 },
        { key: "target_seconds_per_question", value: 90 },
        { key: "answer_rate_limit_window_ms", value: 60000 },
        { key: "answer_rate_limit_max", value: 60 },
      ],
      error: null,
    });
  throw new Error(`the review cap reads no table ${table}`);
}

/** The refusal, as the real producer builds it for a student at the cap. */
export async function reviewCapRefusal(): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const result = await startOrReplayReviewSession({
    studentId: "00000000-0000-4000-8000-0000000000ca",
    actorId: "00000000-0000-4000-8000-0000000000cb",
    poolSpec: { mode: "queue" },
    clientInstanceId: "tab-cap",
    idempotencyKey: "cap-key",
    targetCount: null,
  });
  if (result.ok) throw new Error("the producer did not refuse at the cap");
  if (result.body.code !== "SESSION_LIMIT_EXCEEDED")
    throw new Error(
      `the producer refused for another reason: ${String(result.body.code)}`,
    );
  return { status: result.status, body: result.body };
}
