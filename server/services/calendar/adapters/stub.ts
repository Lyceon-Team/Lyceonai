/**
 * The fail-open engine stub — Doc 05F §9.3, §9.4, sheet §8 item 12.
 *
 * @spec [Doc-05F_V1.0 §9.3 review adapter, §9.4 full-length adapter (G-08-02,
 *        G-08-03); Doc_05F_formula_sheet.md §5A fail-open, §8 item 12]
 * | @implemented [2026-09-18]
 *
 * plain English: review and full-length are rebuild verticals. Until each lands, the
 * calendar still has to render, so their adapters answer "not available" as DATA and
 * never throw. `enabled_block_types` is `["practice"]` at launch, so the generator
 * emits no review or full-length blocks — but a student can still hold one from a
 * hand-edited day, and a stub that threw would take the whole calendar down with it.
 *
 * expected outcome: a launch against a stubbed engine returns
 * `{ok:false, error:{reason:'engine_unavailable'}}` and the route answers 409 with a
 * CTA, not a 500. `activityUnits` returns none, so blocks of that type read as
 * 0 / target rather than as an error.
 *
 * trade-offs: one factory for both engines rather than two near-identical files.
 * The engines differ in what they will DO, not in how they decline, and the contract
 * tests below run against each separately so a real implementation replacing either
 * has to pass them unchanged.
 *
 * WHAT THE REAL ADAPTER MUST NOT CHANGE: these five behaviours are the contract.
 * `tests/ci/calendar.launch-contract.review.test.ts` and `.full-length.test.ts`
 * assert them against the stub, and the rebuilt engine must pass the same tests
 * with `create` succeeding instead of declining.
 */
import {
  err,
  type ActivityUnit,
  type CalendarEngine,
  type PlanBlock,
} from "@lyceon/shared";
import type {
  CalendarEngineAdapter,
  EngineCreateContext,
  EngineCreateResult,
  EngineLifecycle,
} from "./types";

export function makeUnavailableAdapter(
  engine: CalendarEngine,
): CalendarEngineAdapter {
  return {
    engine,

    async create(
      _block: PlanBlock,
      _size: number,
      _ctx: EngineCreateContext,
    ): Promise<EngineCreateResult> {
      // Never a throw, never a 500. The caller decides how to tell the student.
      return err({
        reason: "engine_unavailable",
        detail: `the ${engine} engine has not shipped yet`,
      });
    },

    async activityUnits(
      _studentId: string,
      _localDate: string,
      _timeZone: string,
    ): Promise<ActivityUnit[]> {
      return [];
    },

    /**
     * §9.1. An engine with no sessions has no session route: `create` always refuses with
     * `engine_unavailable` and `progress` always returns `null`, so neither branch of the
     * launch service can reach this. It THROWS rather than returning the landing page
     * (`/full-test`), because a route that does not open the session is the exact lie this
     * method was added to make unrepresentable — a wrong path navigates and 404s quietly,
     * where a throw is a 500 with a stack that names the cause. Coding Standards §3.6:
     * `throw` is for programming errors, and calling this is one.
     */
    resumeHref(_sessionId: string): string {
      throw new Error(
        `the ${engine} engine has no session route: its adapter is a stub`,
      );
    },

    async progress(_sessionId: string): Promise<EngineLifecycle | null> {
      // No session can exist, so there is no lifecycle to report. `null` keeps the
      // block out of `in_progress` rather than inventing a state for it.
      return null;
    },

    async nextLaunchSize(
      _block: PlanBlock,
      remaining: number,
    ): Promise<number> {
      return Math.max(1, remaining);
    },
  };
}

/**
 * FULL-LENGTH ONLY, since 2026-09-22. `reviewAdapter` used to be made here too; review
 * shipped, so its adapter is real and lives in ./review. The factory stays because the
 * exam vertical still needs it, and because the two engines differ in what they will DO
 * rather than in how they decline.
 */
export const fullLengthAdapter = makeUnavailableAdapter("full_length");
