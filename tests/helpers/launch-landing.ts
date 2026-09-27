/**
 * "Where does the student land?" — the launch contract's landing half, for every engine.
 *
 * @spec [Doc-05F_V1.0 §9.1 adapter contract, §15.1 launch step 3 (resume)]
 * @implemented [2026-09-23]
 *
 * WHY THIS EXISTS. The launch contract tests covered create, replay, activity units,
 * progress and launch size, and never asserted WHERE the launch sends the student. So a
 * defect that got every one of those right and the destination wrong shipped: the launch
 * service's resume branch built `/practice/session/<id>` for EVERY engine, and a student
 * resuming a live review block landed on practice's page with a review session id
 * (production 2026-09-22, dep dpl_HzcSpFbn8J58G7rAonUzsNRATch8 —
 * `GET /api/practice/sessions/8f1ccdc5…/state 404`, four times in eighty seconds).
 *
 * BOTH BRANCHES, because only one of them was broken. `create` already asked the adapter
 * for its route, so the FIRST launch of a block always worked and a test that checked only
 * the create path would still pass today while production was failing. The resume branch is
 * the one that ran on every launch after the first.
 *
 * ONE HELPER RATHER THAN A COPY PER ENGINE: the claim is identical for practice and review,
 * and a second copy is the thing that drifts. Each contract file supplies its own engine,
 * its own real session id and its own table, and makes its own assertions on what comes
 * back.
 */
import type { Client } from "pg";
import type { PlanBlock } from "@lyceon/shared";
import {
  launchBlock,
  type LaunchDeps,
  type LaunchResult,
} from "../../server/services/calendar/launch-service";
import type {
  CalendarEngine,
  CalendarEngineAdapter,
} from "../../server/services/calendar/adapters/types";

/**
 * Drives the REAL launch service down its resume branch (§15.1 step 3) with the REAL
 * adapter, and returns what it decided.
 *
 * `progress` is the only thing stubbed, and deliberately: a live session is the
 * PRECONDITION for this branch, not the claim under test — the adapters' own contract
 * tests already prove `progress` reads the right table. Stubbing it here means the branch
 * runs deterministically and the assertion is about `next` alone. Everything that produces
 * `next` — `resumeHref` and the service's choice of which adapter to ask — is real.
 *
 * `linkLaunch` THROWS on purpose. The resume branch must return before recording a new
 * launch, so if this ever fires, the test failed by taking the create path and the error
 * says so rather than the assertion passing for the wrong reason.
 */
export async function launchResumingExistingSession(options: {
  adapter: CalendarEngineAdapter;
  engine: CalendarEngine;
  sessionId: string;
  block: PlanBlock;
  studentId: string;
}): Promise<LaunchResult> {
  const { adapter, engine, sessionId, block, studentId } = options;

  const resumeOnly: CalendarEngineAdapter = {
    ...adapter,
    async progress() {
      return "active";
    },
  };

  const deps: LaunchDeps = {
    async loadBlockContext() {
      return {
        block,
        dayBlocks: [block],
        timezone: "America/Chicago",
        // The block's own date IS today, so §15.1 step 2 lets the launch through.
        localToday: block.scheduled_date,
      };
    },
    async activityUnits() {
      return [];
    },
    async latestLaunch() {
      return { launch_sequence: 1, engine, engine_session_id: sessionId };
    },
    async linkLaunch() {
      throw new Error(
        "linkLaunch ran: the launch took the CREATE path, so this is not the resume branch",
      );
    },
    adapterFor() {
      return resumeOnly;
    },
  };

  return launchBlock(
    {
      student_id: studentId,
      actor_id: studentId,
      role: "student",
      block_id: block.block_id,
      client_instance_id: "ci-landing",
      platform: "web",
    },
    deps,
  );
}

/**
 * The id in `next` resolves in THIS engine's table and in no other engine's.
 *
 * Real SQL against the real schema, because "the route is spelled right" and "the route
 * points at a row that exists" are different claims and only the second one would have
 * caught a session id handed to the wrong engine's page.
 */
export async function assertSessionIdResolves(
  pg: Client,
  sessionId: string,
  ownTable: string,
  foreignTable: string,
): Promise<{ own: number; foreign: number }> {
  const own = await pg.query(
    `SELECT count(*)::int AS n FROM public.${ownTable} WHERE id = $1`,
    [sessionId],
  );
  const foreign = await pg.query(
    `SELECT count(*)::int AS n FROM public.${foreignTable} WHERE id = $1`,
    [sessionId],
  );
  return { own: own.rows[0].n as number, foreign: foreign.rows[0].n as number };
}
