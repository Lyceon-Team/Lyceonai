/**
 * Calendar review adapter — launch contract, against the REAL review engine.
 *
 * @spec [Doc-05F_V1.0 §9.1 adapter contract, §9.3 review adapter (G-08-02),
 *        §13 allocator, §15.1 launch (INV-08-18)]
 *       [review handoff "Calendar <- Review: Seam Changes" H1, H2]
 * | @implemented [2026-09-22]
 *
 * THIS FILE USED TO TEST A STUB. Its own header said so: "the review engine has not
 * shipped… when the real engine lands, it must pass this file with `create` SUCCEEDING
 * instead of declining — every other assertion here stays exactly as written." Review
 * shipped. The stub half is gone and the five contract items are now asserted against the
 * real adapter, with `create` succeeding.
 *
 * TWO HALVES, because the risk has two halves:
 *
 *   A. The adapter hands `startOrReplayReviewSession` exactly the right arguments, with
 *      the idempotency key forwarded UNCHANGED and no field review does not accept.
 *      Proved with a recorder over that one function.
 *   B. Those arguments really do produce a session, against the REAL engine running on a
 *      REAL database with the real migrations applied. No recorder, no stub: the actual
 *      function, the actual queue, the actual insert.
 *
 * Half B is what the earlier version could not do and is the point of this rewrite. It
 * runs only where a PG service container is present (PGHOST set), matching every other
 * *.ci.test.ts here, and is named in `practice-integration` behind `vitest-summary-gate`
 * so a skip cannot pass silently.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Client } from "pg";
import type { PlanBlock } from "@lyceon/shared";
import { bootstrapPgDatabase, makePgSupabase } from "../helpers/pg-supabase";

const PG_AVAILABLE =
  process.env.PGHOST !== undefined && process.env.PGHOST !== "";

const STUDENT = "11111111-1111-1111-1111-111111111111";
const BLOCK_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const BLOCK: PlanBlock = {
  block_id: BLOCK_ID,
  scheduled_date: "2026-09-18",
  block_type: "review",
  section: null,
  scope: { mode: "queue" },
  target_count: 5,
  source: "auto",
  derived_from_block_id: null,
  explanation_key: null,
  display_ordinal: 1,
  membership_type: "created",
};

const CTX = {
  student_id: STUDENT,
  actor_id: STUDENT,
  role: "student",
  client_instance_id: "ci-abc",
  platform: "web" as const,
  idempotency_key: `calendar:block:${BLOCK_ID}:1`,
};

// ── Half A: the adapter asks the engine for the right thing ─────────────────

const recorded: { args: Record<string, unknown> | null } = { args: null };

vi.mock("../../server/routes/review-canonical", () => ({
  startOrReplayReviewSession: vi.fn(async (args: Record<string, unknown>) => {
    recorded.args = args;
    return {
      ok: true as const,
      session: { id: "5f0a6b1c-2d3e-4f50-8a9b-0c1d2e3f4a5b" },
      metadata: {},
      replayed: false,
    };
  }),
}));

// The DATABASE transport, substituted for real SQL. This block sits ABOVE the adapter's
// dynamic import on purpose: a top-level `await import` runs in source order, so an adapter
// imported before this mock was registered would bind the REAL supabase client and read an
// empty database while the test's own connection saw the rows it had just written. That is
// exactly how the first draft of this file failed, and it failed as a silent `[]` rather
// than as an error.
const DB_NAME = "calendar_review_contract";

let testPg: Client | null = null;

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: new Proxy(
    {},
    {
      get(_t, prop) {
        if (!testPg) throw new Error("PG client not initialised");
        return (makePgSupabase(testPg) as Record<string, unknown>)[
          prop as string
        ];
      },
    },
  ),
}));

const { reviewAdapter } =
  await import("../../server/services/calendar/adapters/review");

describe("review adapter — the §9.1 contract", () => {
  it("(1) names its engine, and the name is the block type", () => {
    expect(reviewAdapter.engine).toBe("review");
    expect(reviewAdapter.engine).toBe(BLOCK.block_type);
  });

  it("(2) create SUCCEEDS, and returns the review session route", async () => {
    recorded.args = null;
    const result = await reviewAdapter.create(BLOCK, 5, CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.session_id).toBe(
      "5f0a6b1c-2d3e-4f50-8a9b-0c1d2e3f4a5b",
    );
    // Mirrors `/practice/session/:id`; both are in the route registry.
    expect(result.value.next).toBe(
      "/review/session/5f0a6b1c-2d3e-4f50-8a9b-0c1d2e3f4a5b",
    );
    expect(result.value.resumed).toBe(false);
  });

  it("(2a) passes the QUEUE pool spec — a bare discriminant, nothing else", async () => {
    await reviewAdapter.create(BLOCK, 5, CTX);
    // `filter` mode would be the calendar inventing a selection the plan never made;
    // `session` mode belongs to "review this test". A review block IS the open queue.
    expect(recorded.args?.poolSpec).toEqual({ mode: "queue" });
  });

  it("(2b) forwards the idempotency key UNCHANGED (§9.2's rule, second engine)", async () => {
    await reviewAdapter.create(BLOCK, 5, CTX);
    expect(recorded.args?.idempotencyKey).toBe(CTX.idempotency_key);
    // Not rebuilt, not prefixed, not lowercased — the calendar owns the format and the
    // engine owns what a repeat means.
    expect(recorded.args?.idempotencyKey).toBe(`calendar:block:${BLOCK_ID}:1`);
  });

  it("(2c) sends THIS launch's size, not the block target (§9.1)", async () => {
    await reviewAdapter.create(BLOCK, 3, CTX);
    expect(recorded.args?.targetCount).toBe(3);
    expect(BLOCK.target_count).toBe(5);
  });

  it("(2d) sends NO `platform` — review's signature has no such field", async () => {
    await reviewAdapter.create(BLOCK, 5, CTX);
    // It would be silently dropped, which is exactly why this is asserted: a field that
    // does nothing looks like a field that does something.
    expect(recorded.args).not.toHaveProperty("platform");
    expect(Object.keys(recorded.args ?? {}).sort()).toEqual([
      "actorId",
      "clientInstanceId",
      "idempotencyKey",
      "poolSpec",
      "studentId",
      "targetCount",
    ]);
  });

  it("(2e) sends a non-null clientInstanceId, which the signature requires", async () => {
    await reviewAdapter.create(BLOCK, 5, CTX);
    expect(recorded.args?.clientInstanceId).toBe("ci-abc");
  });

  it("refuses a block of the wrong type as DATA, never a throw", async () => {
    const wrong = { ...BLOCK, block_type: "practice" } as PlanBlock;
    const result = await reviewAdapter.create(wrong, 5, CTX);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("engine_error");
  });

  it("(5) nextLaunchSize answers for work still outstanding, and never zero", async () => {
    await expect(reviewAdapter.nextLaunchSize(BLOCK, 7)).resolves.toBe(7);
    await expect(reviewAdapter.nextLaunchSize(BLOCK, 0)).resolves.toBe(1);
  });
});

// ── Half B: those arguments work against the REAL engine ────────────────────

describe.skipIf(!PG_AVAILABLE)(
  "review adapter → the REAL engine on a REAL database",
  () => {
    beforeAll(async () => {
      testPg = await bootstrapPgDatabase(DB_NAME);

      await testPg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [STUDENT, "review-contract@example.test"],
      );
      await testPg.query(
        `INSERT INTO public.profiles (id, email, role)
         VALUES ($1,$2,'student') ON CONFLICT DO NOTHING`,
        [STUDENT, "review-contract@example.test"],
      );

      // Six servable questions, six active queue entries.
      for (let i = 1; i <= 6; i += 1) {
        const id = `SATM1${String(i).padStart(6, "0")}`;
        await testPg.query(
          `INSERT INTO public.questions
             (id, section, source_type, domain, skill_codes, difficulty, stem, options,
              correct_answer, explanation, status, item_type, published_at)
           VALUES ($1,'M',1,'Algebra',ARRAY['H.C.'],2,$2,$3::jsonb,'B',$4,'published','mcq',now())
           ON CONFLICT (id) DO NOTHING`,
          [
            id,
            `Stem ${i}`,
            JSON.stringify([
              { key: "A", text: "alpha" },
              { key: "B", text: "bravo" },
              { key: "C", text: "charlie" },
              { key: "D", text: "delta" },
            ]),
            `Explanation ${i}`,
          ],
        );
        await testPg.query(
          `INSERT INTO public.review_schedule
             (student_id, question_id, status, queued_at, source_engine,
              source_session_id, source_item_id, source_outcome)
           VALUES ($1,$2,'active',now(),'practice',gen_random_uuid(),gen_random_uuid(),'incorrect')`,
          [STUDENT, id],
        );
      }
    }, 120_000);

    afterAll(async () => {
      await testPg?.end();
      testPg = null;
    });

    it("creates a REAL review session from the adapter's own arguments", async () => {
      // The real function, unmocked, over the real schema. `vi.importActual` is what
      // steps past Half A's recorder — mocking the module and then testing the module
      // would be testing the mock.
      const { startOrReplayReviewSession } = await vi.importActual<
        typeof import("../../server/routes/review-canonical")
      >("../../server/routes/review-canonical");

      const result = await startOrReplayReviewSession({
        studentId: STUDENT,
        actorId: STUDENT,
        poolSpec: { mode: "queue" },
        clientInstanceId: CTX.client_instance_id,
        idempotencyKey: CTX.idempotency_key,
        targetCount: 3,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The block asked for three, so the session holds three of the six queued.
      expect(result.session.target_count).toBe(3);
      expect(result.session.mode).toBe("queue");
      expect(result.replayed).toBe(false);

      const items = await testPg!.query(
        `SELECT count(*)::int AS n FROM public.review_session_items WHERE session_id = $1`,
        [result.session.id],
      );
      expect(items.rows[0].n).toBe(3);
    });

    it("replays on the same idempotency key rather than opening a second session", async () => {
      const { startOrReplayReviewSession } = await vi.importActual<
        typeof import("../../server/routes/review-canonical")
      >("../../server/routes/review-canonical");

      const again = await startOrReplayReviewSession({
        studentId: STUDENT,
        actorId: STUDENT,
        poolSpec: { mode: "queue" },
        clientInstanceId: CTX.client_instance_id,
        idempotencyKey: CTX.idempotency_key,
        targetCount: 3,
      });

      expect(again.ok).toBe(true);
      if (!again.ok) return;
      expect(again.replayed).toBe(true);

      const sessions = await testPg!.query(
        `SELECT count(*)::int AS n FROM public.review_sessions WHERE student_id = $1`,
        [STUDENT],
      );
      // INV-08-18: a retried launch is one session, not two.
      expect(sessions.rows[0].n).toBe(1);
    });

    it("counts an ANSWERED review item as a unit and a SKIPPED one as nothing (H2)", async () => {
      const session = await testPg!.query(
        `SELECT id FROM public.review_sessions WHERE student_id = $1 LIMIT 1`,
        [STUDENT],
      );
      const sessionId = session.rows[0].id;

      // One answered, one skipped, both timestamped inside the same local day. A skip
      // carries answered_at, which is the whole reason the predicate is on `status`.
      //
      // BOTH timestamp columns are set, because the real engine sets both from one `now`
      // and `rsi_resolved_requires_occurred_at` refuses a resolved row without
      // `occurred_at`. The first draft set only `answered_at` and the database rejected
      // it — which is the constraint doing its job, and the reason a fixture built by
      // hand has to match what the writer actually writes. The same applies to
      // `is_correct` and `outcome`: trg_review_item_resolve fires on this UPDATE and
      // writes review_error_attempts from them, so a fixture that sets only `status`
      // trips a NOT NULL there. These are the exact values submitReviewAnswer and
      // submitReviewSkip set.
      await testPg!.query(
        `UPDATE public.review_session_items
            SET status = 'answered',
                selected_answer = 'B',
                is_correct = true,
                outcome = 'correct',
                answered_at = '2026-09-18T15:00:00Z',
                occurred_at = '2026-09-18T15:00:00Z'
          WHERE session_id = $1 AND ordinal = 1`,
        [sessionId],
      );
      await testPg!.query(
        `UPDATE public.review_session_items
            SET status = 'skipped',
                outcome = 'skipped',
                is_correct = NULL,
                answered_at = '2026-09-18T15:05:00Z',
                occurred_at = '2026-09-18T15:05:00Z'
          WHERE session_id = $1 AND ordinal = 2`,
        [sessionId],
      );

      const units = await reviewAdapter.activityUnits(
        STUDENT,
        "2026-09-18",
        "America/Chicago",
      );

      expect(units).toHaveLength(1);
      expect(units[0]).toMatchObject({
        engine: "review",
        occurred_at: "2026-09-18T15:00:00.000Z",
        local_date: "2026-09-18",
        section: "M",
        domain: "Algebra",
      });
    });

    it("counts a resolved row whose answered_at is NULL — THE PLANT", async () => {
      const session = await testPg!.query(
        `SELECT id FROM public.review_sessions WHERE student_id = $1 LIMIT 1`,
        [STUDENT],
      );
      const sessionId = session.rows[0].id;

      // The row the ruling is about, written into the REAL table so the REAL constraint
      // gets a vote: answered, dated by `occurred_at`, with `answered_at` left NULL.
      // `rsi_resolved_requires_occurred_at` accepts it — it constrains `occurred_at` and
      // says nothing about `answered_at` — which is precisely why the window moved.
      await testPg!.query(
        `UPDATE public.review_session_items
            SET status = 'answered',
                selected_answer = 'C',
                is_correct = false,
                outcome = 'incorrect',
                answered_at = NULL,
                occurred_at = '2026-09-19T16:30:00Z'
          WHERE session_id = $1 AND ordinal = 3`,
        [sessionId],
      );

      const units = await reviewAdapter.activityUnits(
        STUDENT,
        "2026-09-19",
        "America/Chicago",
      );

      // Revert the adapter to `answered_at` and this is 0 twice over: the SQL window
      // excludes the row, and the mapping would have nothing to date it by either. A
      // student who answered is reported as having done no work, with no error anywhere.
      expect(units).toHaveLength(1);
      expect(units[0]).toMatchObject({
        engine: "review",
        occurred_at: "2026-09-19T16:30:00.000Z",
        local_date: "2026-09-19",
      });
    });

    it("the constraint really does guarantee only one of the two columns", async () => {
      const session = await testPg!.query(
        `SELECT id FROM public.review_sessions WHERE student_id = $1 LIMIT 1`,
        [STUDENT],
      );
      const sessionId = session.rows[0].id;

      // The asymmetry, exercised rather than quoted. Resolving without `occurred_at` is
      // refused by the database; resolving without `answered_at` was accepted above.
      await expect(
        testPg!.query(
          `UPDATE public.review_session_items
              SET status = 'answered',
                  selected_answer = 'A',
                  is_correct = true,
                  outcome = 'correct',
                  answered_at = '2026-09-19T17:00:00Z',
                  occurred_at = NULL
            WHERE session_id = $1 AND ordinal = 1`,
          [sessionId],
        ),
      ).rejects.toThrow(/rsi_resolved_requires_occurred_at/);
    });

    it("reports the session lifecycle, so §13 can call the block in progress", async () => {
      const session = await testPg!.query(
        `SELECT id FROM public.review_sessions WHERE student_id = $1 LIMIT 1`,
        [STUDENT],
      );
      const sessionId = session.rows[0].id;

      await expect(reviewAdapter.progress(sessionId)).resolves.toBe("active");

      await testPg!.query(
        `UPDATE public.review_sessions SET status = 'completed' WHERE id = $1`,
        [sessionId],
      );
      await expect(reviewAdapter.progress(sessionId)).resolves.toBe(
        "completed",
      );

      // An id that names no session is null, not a throw and not a guessed state.
      await expect(
        reviewAdapter.progress("00000000-0000-0000-0000-000000000000"),
      ).resolves.toBeNull();
    });
  },
);
