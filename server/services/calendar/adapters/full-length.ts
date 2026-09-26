/**
 * The full-length engine adapter — Doc 05F §9.4 (G-08-02).
 *
 * @spec [Doc-05F_V1.0 §9.1 contract, §9.4 full-length adapter, §13 allocator, §15.1 launch
 *        (INV-08-18); Doc-04A §7.3 session create, §14 terminal states; SCL-167 (scope),
 *        SCL-168 (the next test, the missing idempotency key)]
 * | @implemented [2026-09-25]
 *
 * plain English: turns a calendar full-length block into a real exam session, and reads back
 * the exams the student finished. Replaces the fail-open stub that stood here while the exam
 * engine was being built (E6-E9).
 *
 * IT CREATES THROUGH THE EXAM'S OWN FUNCTION, NOT ITS ROUTE — the rule the practice and
 * review adapters follow and say so in as many words. `createExamSession` is what
 * `POST /api/tests/sessions` calls; the live-session lock, the "same form resumes, a different
 * form is refused" rule and the timing all live in `exam_create_session`, and a second create
 * path would be a second contract.
 *
 * ENTITLEMENT IS CHECKED HERE, because the exam route checks it in its HANDLER
 * (`authorizeExamCaller`, `exam_full_length`) rather than inside `createExamSession`. The
 * calendar route has already checked `calendar_access`, but that is a different feature key,
 * and a calendar launch must not be a way around the exam's own gate (server-authoritative
 * entitlement, Coding Standards §6). A refusal is an engine refusal like any other.
 *
 * WHICH TEST. The block's `form_id` when it names one; otherwise `exam_next_form_for_student`
 * (SCL-168): the live session's form if one is live — so the launch RESUMES it — else the first
 * selectable form never completed, else the least recently completed. Deterministic; no
 * randomness anywhere in selection.
 *
 * IDEMPOTENCY, STATED PLAINLY (SCL-168). `exam_create_session` takes NO idempotency key, so
 * `ctx.idempotency_key` is not forwarded — there is nothing to forward it to, and passing it
 * somewhere it is ignored would imply a guarantee that does not exist. What de-duplicates is
 * the exam's own rule of one live session per student: a launch with no form named resolves
 * to the live session's form and the engine answers 200 with that session, so a retry after a
 * crash between create and `calendar_link_launch` gets the SAME session, which is what the
 * forwarded key buys the other two engines (§15.1).
 *
 * expected outcome: pressing Start on a full-length block opens a test-day-timed exam on the
 * next unused test; pressing it again resumes that exam; a block naming a different test while
 * one is live is refused, as every engine's refusal is (502 at the route).
 *
 * edge cases: no selectable published form -> refused, with the reason in `detail`. A block
 * naming a form that is no longer selectable -> the engine's own `form_not_available`.
 */
import { supabaseServer } from "../../../../apps/api/src/lib/supabase-server";
import {
  EXAM_FEATURE_KEY,
  createExamSession,
} from "../../exam-runtime-service";
import { EntitlementService } from "../../entitlement-service";
import { logger } from "../../../logger";
import { err, ok, type ActivityUnit, type PlanBlock } from "@lyceon/shared";
import { localDayWindowUtc, toIsoTimestamp } from "./local-day";
import type {
  CalendarEngineAdapter,
  EngineCreateContext,
  EngineCreateResult,
  EngineLifecycle,
} from "./types";

/**
 * `exam_next_form_for_student` (SCL-168). `form_id` null when no selectable published form
 * exists. A failed lookup is returned as data, never thrown: §9.1 makes every refusal data.
 */
async function nextFormFor(
  studentId: string,
): Promise<{ ok: true; form_id: string | null } | { ok: false; code: string }> {
  const { data, error } = await supabaseServer.rpc(
    "exam_next_form_for_student",
    {
      p_student_id: studentId,
    },
  );
  if (error) {
    logger.error(
      "CALENDAR_ADAPTER",
      "full_length_next_form_failed",
      "the next-test lookup failed",
      { code: error.code },
    );
    return { ok: false, code: error.code };
  }
  return { ok: true, form_id: typeof data === "string" ? data : null };
}

async function create(
  block: PlanBlock,
  _size: number,
  ctx: EngineCreateContext,
): Promise<EngineCreateResult> {
  if (block.block_type !== "full_length") {
    return err({
      reason: "engine_error",
      detail: `full-length adapter was handed a ${block.block_type} block`,
    });
  }

  if (
    !(await EntitlementService.canAccessFeature(
      ctx.student_id,
      EXAM_FEATURE_KEY,
    ))
  ) {
    logger.info(
      "CALENDAR_ADAPTER",
      "full_length_entitlement_denied",
      "a calendar full-length launch was refused: no exam_full_length",
      {},
    );
    return err({ reason: "engine_error", status: 403, detail: "forbidden" });
  }

  let formId = block.scope.form_id;
  if (formId === null) {
    const next = await nextFormFor(ctx.student_id);
    if (!next.ok) return err({ reason: "engine_error", detail: next.code });
    if (next.form_id === null) {
      return err({
        reason: "engine_error",
        status: 409,
        detail: "no_selectable_form",
      });
    }
    formId = next.form_id;
  }

  const result = await createExamSession(
    ctx.student_id,
    formId,
    block.scope.exam_mode,
  );
  if (!result.ok) {
    logger.error(
      "CALENDAR_ADAPTER",
      "full_length_create_failed",
      "exam session create refused a calendar launch",
      // The engine's own status and CODE, never its prose.
      { status: result.error.status, code: result.error.code },
    );
    return err({
      reason: "engine_error",
      status: result.error.status,
      detail: result.error.code,
    });
  }

  return ok({
    session_id: result.value.session_id,
    // From `resumeHref`, not a template: create and resume must not be able to disagree.
    next: resumeHref(result.value.session_id),
    // 201 is a new session; 200 is the live one handed back (exam_create_session).
    resumed: result.status === 200,
  });
}

/**
 * §9.4: one unit per exam Doc 04 reports complete on the local date, carrying its `form_id`.
 *
 * "Complete" is `test_sessions.state = 'completed'` — Doc 04A's terminal state for a sitting
 * that ran to the end — and the unit is dated by `completed_at`, the moment it became so. An
 * abandoned or partially scored sitting is not a completed exam and is not a unit, for the
 * same reason a skipped item is not one in the other two engines: the unit is the work, not
 * the attempt at it.
 */
async function activityUnits(
  studentId: string,
  localDate: string,
  timeZone: string,
): Promise<ActivityUnit[]> {
  const window = localDayWindowUtc(localDate, timeZone);

  const { data, error } = await supabaseServer
    .from("test_sessions")
    .select("id, test_form_id, completed_at, state")
    .eq("student_id", studentId)
    .eq("state", "completed")
    .gte("completed_at", window.startUtc)
    .lt("completed_at", window.endUtc);

  if (error) {
    // Fail OPEN, exactly as practice and review do (§5A).
    logger.error(
      "CALENDAR_ADAPTER",
      "full_length_activity_read_failed",
      "full-length activity units could not be read",
      { code: error.code, localDate },
    );
    return [];
  }

  const units: ActivityUnit[] = [];
  for (const row of data ?? []) {
    if (typeof row.id !== "string" || typeof row.test_form_id !== "string")
      continue;
    // Normalised, not type-guarded: a string over PostgREST, a Date over node-postgres.
    const occurredAt = toIsoTimestamp(row.completed_at);
    if (occurredAt === null) continue;
    units.push({
      engine: "full_length",
      unit_id: row.id,
      occurred_at: occurredAt,
      local_date: localDate,
      section: null,
      domain: null,
      form_id: row.test_form_id,
    });
  }
  return units;
}

/**
 * §13 lifecycle from `test_sessions.state` (Doc 04A §14): the three live states are active;
 * `completed` is completed; `abandoned_final` and `partial_scored_abandoned` both ended
 * without the sitting running to the end, so both are abandoned.
 */
async function progress(sessionId: string): Promise<EngineLifecycle | null> {
  const { data, error } = await supabaseServer
    .from("test_sessions")
    .select("state")
    .eq("id", sessionId)
    .maybeSingle();

  if (error || data === null) return null;
  switch (data.state) {
    case "created":
    case "active":
    case "section_break":
      return "active";
    case "completed":
      return "completed";
    case "abandoned_final":
    case "partial_scored_abandoned":
      return "abandoned";
    default:
      return null;
  }
}

/** §9.4: a full-length block is one sitting. Not the stub's `remaining`. */
async function nextLaunchSize(
  _block: PlanBlock,
  _remaining: number,
): Promise<number> {
  return 1;
}

/**
 * §9.1: the exam's own session route. The route registry lists `/tests/:id` (E7b's session
 * hub), which reads the session's state and sends the student to the active module, the break
 * or the Module 2 hand-off — the same place the Tests page's "Resume" goes.
 */
function resumeHref(sessionId: string): string {
  return `/tests/${sessionId}`;
}

export const fullLengthAdapter: CalendarEngineAdapter = {
  engine: "full_length",
  create,
  activityUnits,
  resumeHref,
  progress,
  nextLaunchSize,
};
