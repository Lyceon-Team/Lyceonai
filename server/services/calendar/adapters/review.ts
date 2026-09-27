/**
 * The review engine adapter — Doc 05F §9.3.
 *
 * @spec [Doc-05F_V1.0 §9.1 contract, §9.3 review adapter (G-08-02), §13 allocator,
 *        §15.1 launch (INV-08-18); review handoff "Calendar <- Review: Seam Changes"]
 * | @implemented [2026-09-22]
 *
 * plain English: turns a calendar review block into a real review session, and reads back
 * the answered items that block can count. Replaces the fail-open stub that stood here
 * while review was being built.
 *
 * IT CREATES THROUGH REVIEW'S OWN FUNCTION, NOT THROUGH REVIEW'S ROUTE. `startOrReplayReviewSession`
 * is where the concurrent-session cap, the idempotency replay and the client-instance
 * binding live. Posting to `POST /api/review/sessions` from here would be a second create
 * path -- a second contract, of which only one would get fixed -- and it would also mean
 * the server making an HTTP call to itself to reach a function it can import. The practice
 * adapter made the same choice for the same reason and says so in as many words.
 *
 * THE POOL SPEC IS THE BLOCK'S SCOPE, TRANSLATED. An ordinary review block is
 * `{ mode: "queue" }`, a bare discriminant: "the work you owe", the student's open queue in
 * `review_due_by_date` order -- the same queue the generator sized the block against
 * (`calendar_build_plan_input`, joined to `servable_questions` since H5). The exam review the
 * generator places after a completed full-length is `{ mode: "session" }` naming that exam
 * (E9b, SCL-170): "review this test", which §9.4 names as the exam-review seam. `filter` mode
 * would be the calendar inventing a selection the plan never made, and is never sent.
 *
 * NO `platform` FIELD. `startOrReplayReviewSession` does not take one; review sets
 * `platform: 'web'` itself on the row. Passing one would be silently dropped.
 *
 * expected outcome: pressing Start on a Review 15 block opens a review session over the
 * fifteen oldest outstanding mistakes, and a retry of the same launch returns that same
 * session rather than a second one.
 *
 * edge cases: an EMPTY queue is not an error the student caused. Review answers
 * `REVIEW_POOL_EMPTY` with a 409, which is forwarded as `engine_error` carrying that code,
 * so the route can say "nothing to review" rather than "something went wrong". A review
 * block is section-less by design (§10.2), so nothing here reads `block.section`.
 */
import { supabaseServer } from "../../../../apps/api/src/lib/supabase-server";
import { startOrReplayReviewSession } from "../../../routes/review-canonical";
import { logger } from "../../../logger";
import {
  err,
  ok,
  type ActivityUnit,
  type PlanBlock,
  type ReviewPoolSpec,
  type ReviewScope,
} from "@lyceon/shared";
import { localDayWindowUtc, toIsoTimestamp } from "./local-day";
import type {
  CalendarEngineAdapter,
  EngineCreateContext,
  EngineCreateResult,
  EngineLifecycle,
} from "./types";

/**
 * The block's scope, as review's pool spec (E9b / SCL-170, Doc 05F §9.4).
 *
 * A queue block is the open queue, as before. A SESSION block — the exam review the generator
 * places after a completed full-length — reviews that one exam: `{ mode: "session", source }`,
 * the shape `POST /api/review/sessions` accepts for "review this test". Completing it is what
 * sets `exams.reviewed` in the plan input, which is what lets the block clear; a queue session
 * is sourced from nothing and could never do that.
 *
 * The scope already passed `calendar_scope_is_valid` and the shared schema on its way here, so
 * this is a translation, not a validation. Nothing about it is chosen by the adapter.
 */
function poolSpecOf(scope: ReviewScope): ReviewPoolSpec {
  if (scope.mode === "queue") return { mode: "queue" };
  return {
    mode: "session",
    source: {
      source_engine: scope.source_engine,
      source_session_id: scope.source_session_id,
    },
  };
}

async function create(
  block: PlanBlock,
  size: number,
  ctx: EngineCreateContext,
): Promise<EngineCreateResult> {
  if (block.block_type !== "review") {
    return err({
      reason: "engine_error",
      detail: `review adapter was handed a ${block.block_type} block`,
    });
  }

  const result = await startOrReplayReviewSession({
    studentId: ctx.student_id,
    actorId: ctx.actor_id,
    // See the module note: the pool is what the block's own scope says, never a choice made
    // here. A queue block is the open queue; a session block is that one session.
    poolSpec: poolSpecOf(block.scope),
    // Required and non-nullable on this signature, unlike `idempotencyKey`. The launch
    // service always has one; there is no branch here that could pass null.
    clientInstanceId: ctx.client_instance_id,
    // §9.2's rule, applied to the second engine: forwarded UNCHANGED. The calendar owns
    // the key format, the engine owns what a repeated key means.
    idempotencyKey: ctx.idempotency_key,
    // THIS launch's size, not the block target (§9.1).
    targetCount: size,
  });

  if (!result.ok) {
    logger.error(
      "CALENDAR_ADAPTER",
      "review_create_failed",
      "review session create refused a calendar launch",
      {
        status: result.status,
        // The engine's own error CODE, never its prose: the prose is student-facing copy
        // and the block's scope is the plan, and neither belongs in a log line.
        code:
          typeof result.body.error === "string" ? result.body.error : "unknown",
      },
    );
    return err({
      reason: "engine_error",
      status: result.status,
      detail:
        typeof result.body.error === "string" ? result.body.error : undefined,
    });
  }

  return ok({
    session_id: result.session.id,
    // From `resumeHref`, not a template: create and resume must not be able to disagree.
    next: resumeHref(result.session.id),
    resumed: result.replayed,
  });
}

/**
 * §9.3: one unit per ANSWERED review item on the local date.
 *
 * `status = 'answered'`, never a nullness test on a timestamp. A SKIPPED review item is
 * resolved, so it carries both timestamps too -- production has such rows today -- and a
 * skip is not retrieval. This is the same predicate the practice adapter uses and for the
 * same reason; the two are deliberately identical so neither can drift into counting skips
 * as work.
 *
 * `occurred_at` is the `occurred_at` COLUMN, the moment of retrieval, which is what §22.4's
 * midnight split is defined on. `served_at` is not used.
 *
 * WHICH TIMESTAMP — RESOLVED (owner ruling 2026-09-22). This adapter shipped windowing on
 * `answered_at` with a note saying `occurred_at` was the stronger column and that changing
 * both adapters was a contract decision, not this change's to make. It has now been made,
 * and both adapters window on `occurred_at`.
 *
 * `rsi_resolved_requires_occurred_at` CHECKs that every answered or skipped row carries an
 * `occurred_at`; `answered_at` is plain nullable `timestamptz` with nothing enforcing it.
 * 20260921000000's own comment makes the identical point about practice's constraint --
 * "occurred_at, not answered_at: psi_resolved_requires_occurred_at guarantees the former on
 * every resolved row, and nothing guarantees the latter" -- and review's own
 * `trg_review_item_resolve` feeds `review_error_attempts` from `occurred_at`, which is what
 * orders `canonical_mastery_events`. A review unit is now dated by the same instant mastery
 * is, rather than by a column that merely agrees with it on today's writers.
 */
async function activityUnits(
  studentId: string,
  localDate: string,
  timeZone: string,
): Promise<ActivityUnit[]> {
  const window = localDayWindowUtc(localDate, timeZone);

  const { data, error } = await supabaseServer
    .from("review_session_items")
    .select("id, question_section, question_domain, occurred_at, status")
    .eq("student_id", studentId)
    .eq("status", "answered")
    .gte("occurred_at", window.startUtc)
    .lt("occurred_at", window.endUtc);

  if (error) {
    // Fail OPEN, exactly as practice does: a read that cannot see today's activity shows
    // a plan with no progress, never a 500 (§5A).
    logger.error(
      "CALENDAR_ADAPTER",
      "review_activity_read_failed",
      "review activity units could not be read",
      { code: error.code, localDate },
    );
    return [];
  }

  const rows = data ?? [];
  const units: ActivityUnit[] = [];
  for (const row of rows) {
    if (typeof row.id !== "string") continue;
    // Normalised rather than type-guarded: the same column is a STRING over PostgREST and
    // a Date over node-postgres, and a `typeof === "string"` guard silently drops every
    // row under the second. See `toIsoTimestamp`.
    const occurredAt = toIsoTimestamp(row.occurred_at);
    if (occurredAt === null) continue;
    const section = row.question_section;
    units.push({
      engine: "review",
      unit_id: row.id,
      occurred_at: occurredAt,
      local_date: localDate,
      section: section === "M" || section === "RW" ? section : null,
      domain:
        typeof row.question_domain === "string" ? row.question_domain : null,
      form_id: null,
    });
  }
  return units;
}

/** §13 `in_progress` needs a live session. `created` and `active` are both live. */
async function progress(sessionId: string): Promise<EngineLifecycle | null> {
  const { data, error } = await supabaseServer
    .from("review_sessions")
    .select("status")
    .eq("id", sessionId)
    .maybeSingle();

  if (error || data === null) return null;
  if (data.status === "completed") return "completed";
  if (data.status === "abandoned") return "abandoned";
  if (data.status === "created" || data.status === "active") return "active";
  return null;
}

/**
 * §9.3: review takes whatever is outstanding. There is no engine-side ceiling to read --
 * `startOrReplayReviewSession` slices the pool to `targetCount` and a queue shorter than
 * the ask simply yields a shorter session, which is the honest outcome. The floor of 1
 * matches practice's, so a block with nothing remaining still asks for a session rather
 * than for zero questions.
 */
async function nextLaunchSize(
  _block: PlanBlock,
  remaining: number,
): Promise<number> {
  return Math.max(1, remaining);
}

/**
 * §9.1: review's own session route. Mirrors practice's `/practice/session/:id`; the route
 * registry lists both, and `/review/session/:sessionId` mounts `resume-review.tsx`, which
 * reads `GET /api/review/sessions/:id/state`. Sending a review id to practice's page is
 * what the 2026-09-22 production defect did.
 */
function resumeHref(sessionId: string): string {
  return `/review/session/${sessionId}`;
}

export const reviewAdapter: CalendarEngineAdapter = {
  engine: "review",
  create,
  activityUnits,
  resumeHref,
  progress,
  nextLaunchSize,
};
