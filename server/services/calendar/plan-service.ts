/**
 * CalendarPlanService — the four plan writers, and nothing else.
 *
 * @spec [Doc-05F_V1.0 §12.1 (triggers), §12.3 (version allocation, INV-08-17),
 *        §12.4 (day edit), §12.6 ("do it now"), §15 (API surface), §18 (failure
 *        modes); Doc_05F_formula_sheet.md §8 item 20 (`calendar_regenerate_day`);
 *        lyceon-coding-standards §3.6, §4.2, §13]
 * | @implemented [2026-09-21]
 *
 * plain English: every way the plan changes, as four function calls. Each one calls one
 * SQL function, checks whether the validator accepted, and returns the version number.
 *
 * THIS LAYER NEVER COMPUTES A PLAN, AND NEVER RESHAPES ONE. The formula lives in
 * PL/pgSQL (`calendar_compute_plan`, its fallback, and `calendar_validate_plan`), and the
 * RPC returns `{ plan_version_id, version_no, generator, validator_result, violations? }`.
 * This file reads three of those fields and discards the rest. It does not fill a gap,
 * retry with different inputs, or pick a different date — any of which would be a second
 * generator, and the second one is the one nobody audits.
 *
 * expected outcome: `POST /api/calendar/plan/regenerate` twice with the same
 * `idempotency_key` writes one version and returns the same `version_no` both times,
 * because the ledger inside the RPC returns the stored response and this layer passes it
 * through unchanged.
 *
 * trade-offs: a rejected plan is a `Result` failure, not a throw. §18 says a `generated`
 * rejection PAGES and the prior plan stands — so the route answers 500 with a correlation
 * id and the student keeps the plan they had. Modelling it as data rather than an
 * exception is what lets the route log the rule ids (§18 `calendar.plan_rejected
 * {rule_ids}`) before it answers.
 *
 * edge cases: `calendar_regenerate_day` raises rather than returns for a past date
 * (23514), a date beyond the horizon (22023) and a student with no profile (22023).
 * Those arrive as PostgREST errors and are classified back into the union here, because
 * "yesterday cannot be regenerated" is a 409 the student can act on and not a 500.
 */
import {
  err,
  moveRefusalReasonSchema,
  ok,
  type MoveRefusalReason,
  type PlanTrigger,
  type Result,
} from "@lyceon/shared";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { logger } from "../../logger";
import { classifyError } from "../../lib/redact";

export type PlanInitiator = "student" | "system" | "admin";

/**
 * Every way a plan write can legitimately not happen. As with `LaunchFailure`, a
 * discriminated union rather than a status code: this service does not own HTTP.
 */
export type PlanFailure =
  /** The validator refused the plan the generator produced. §18: page, prior plan stands. */
  | { kind: "rejected"; violations: readonly string[] }
  /** §12.2: a past date is never owned and never edited. */
  | { kind: "past_date"; date: string }
  /** Beyond the planning horizon — there is no plan there to regenerate yet. */
  | { kind: "beyond_horizon"; date: string }
  /** R-08-04: no study profile, so setup has not happened. */
  | { kind: "no_profile" }
  /** The block named does not belong to this student. */
  | { kind: "not_found" }
  /**
   * §12.2: the move was refused as DATA by `calendar_move_block` — a started block, a past
   * date at either end, or a drop back on the day it was already on. Not an error: each is
   * reachable by ordinary use of a drag handle, so the reason travels to the client.
   */
  | { kind: "move_refused"; reason: MoveRefusalReason }
  /** Anything else the database refused. Operator-facing detail only. */
  | { kind: "write_failed"; detail: string };

export type PlanWriteResult = Result<{ version_no: number }, PlanFailure>;

// ── The RPC envelope ────────────────────────────────────────────────────────

type RpcEnvelope = {
  version_no: unknown;
  validator_result: unknown;
  violations: unknown;
};

/**
 * `{ version_no, validator_result }` out of whatever the RPC returned.
 *
 * Narrowed with explicit guards rather than a Zod schema on purpose: this is the SAME
 * envelope from four call sites, the two fields are primitives, and a schema here would
 * become a fifth place the RPC's contract is written down. The violations list is read
 * only to log which rules fired — the route never renders it, because a rule id is
 * internal and a student cannot act on one.
 */
function readEnvelope(
  data: unknown,
): { versionNo: number; accepted: boolean; violations: string[] } | null {
  if (typeof data !== "object" || data === null) return null;
  const envelope = data as RpcEnvelope;
  if (typeof envelope.version_no !== "number") return null;
  if (typeof envelope.validator_result !== "string") return null;
  const violations = Array.isArray(envelope.violations)
    ? envelope.violations.filter(
        (rule): rule is string => typeof rule === "string",
      )
    : [];
  return {
    versionNo: envelope.version_no,
    accepted: envelope.validator_result === "accepted",
    violations,
  };
}

/**
 * PostgREST hands a `RAISE EXCEPTION` back as `{ code, message }`. The writers raise with
 * deliberate SQLSTATEs and messages, and this is the one place they become domain
 * failures — so a new refusal in SQL is one arm here rather than a 500 in three routes.
 */
function classifyRpcError(
  error: { code?: string; message: string },
  context: { date?: string },
): PlanFailure {
  const message = error.message;
  if (message.includes("has no study profile")) return { kind: "no_profile" };
  if (message.includes("cannot be regenerated") && context.date !== undefined) {
    return { kind: "past_date", date: context.date };
  }
  if (message.includes("beyond the") && context.date !== undefined) {
    return { kind: "beyond_horizon", date: context.date };
  }
  if (message.includes("does not belong to student"))
    return { kind: "not_found" };
  return { kind: "write_failed", detail: message };
}

/**
 * A writer that can refuse AS DATA returns `{ "refused": "<reason>" }` and no `version_no`.
 * Read here, before `readEnvelope`, because that function correctly rejects any shape
 * without a `version_no` — without this the refusal would surface as `envelope_unexpected`,
 * which is a 500 and an ERROR log for something the student did on purpose.
 */
function readRefusal(data: unknown): MoveRefusalReason | null {
  if (typeof data !== "object" || data === null) return null;
  const refused = (data as { refused?: unknown }).refused;
  if (typeof refused !== "string") return null;
  const parsed = moveRefusalReasonSchema.safeParse(refused);
  return parsed.success ? parsed.data : null;
}

async function callWriter(
  operation: string,
  fn: string,
  args: Record<string, string | number | null>,
  context: {
    studentId: string;
    date?: string;
    requestId?: string;
    refusable?: boolean;
  },
): Promise<PlanWriteResult> {
  const { data, error } = await supabaseServer.rpc(fn, args);

  if (error) {
    const failure = classifyRpcError(error, {
      ...(context.date === undefined ? {} : { date: context.date }),
    });
    // A refusal the student caused is a decision and logs at warn; anything else is an
    // operational failure and logs at error. Neither is silent, and neither carries the
    // plan scope, the timezone or the body (§18 "never logged").
    const level = failure.kind === "write_failed" ? "error" : "warn";
    logger[level](
      "CALENDAR_PLAN",
      `${operation}_refused`,
      `${fn} refused the write`,
      {
        operation,
        reason: failure.kind,
        ...classifyError(error),
        requestId: context.requestId,
      },
    );
    return err(failure);
  }

  if (context.refusable === true) {
    const refusal = readRefusal(data);
    if (refusal !== null) {
      logger.warn(
        "CALENDAR_PLAN",
        `${operation}_refused`,
        `${fn} declined the write`,
        { operation, reason: refusal, requestId: context.requestId },
      );
      return err({ kind: "move_refused", reason: refusal });
    }
  }

  const envelope = readEnvelope(data);
  if (envelope === null) {
    logger.error(
      "CALENDAR_PLAN",
      `${operation}_envelope_unexpected`,
      `${fn} returned a shape this build does not recognise`,
      { operation, requestId: context.requestId },
    );
    return err({ kind: "write_failed", detail: "envelope_unexpected" });
  }

  if (!envelope.accepted) {
    // §18: a `generated` rejection PAGES and the prior plan stands. The rule ids are the
    // whole point of the alert (§18 `calendar.plan_rejected {rule_ids}`), so they are
    // logged here even though nothing renders them.
    logger.error(
      "CALENDAR_PLAN",
      "plan_rejected",
      "the validator rejected the generated plan; the prior plan stands",
      {
        operation,
        rule_ids: envelope.violations,
        requestId: context.requestId,
      },
    );
    return err({ kind: "rejected", violations: envelope.violations });
  }

  logger.info(
    "CALENDAR_PLAN",
    "plan_generated",
    "a calendar plan version was accepted",
    { operation, version_no: envelope.versionNo, requestId: context.requestId },
  );
  return ok({ version_no: envelope.versionNo });
}

// ── §12.1 horizon-scoped triggers ───────────────────────────────────────────

/**
 * The triggers `calendar_persist_version` serves: every one whose dates are "the horizon"
 * or "future, non-overridden". `day_edit`, `day_regenerate`, `day_reset` and `do_it_now`
 * are date-scoped and have their own writers, so they are not in this type — the compiler
 * refuses to route one here rather than the database refusing it at runtime.
 */
export type HorizonTrigger = Extract<
  PlanTrigger,
  | "setup"
  | "profile_change"
  | "weekly"
  | "student_refresh"
  | "post_exam"
  | "rollback"
>;

export type RegenerateRequest = {
  student_id: string;
  trigger: HorizonTrigger;
  initiated_by: PlanInitiator;
  generator_version: string;
  /** §4.2. `calendar_persist_version` takes it as the ledger key; absent means no replay. */
  idempotency_key?: string;
};

export async function regeneratePlan(
  request: RegenerateRequest,
  requestId?: string,
): Promise<PlanWriteResult> {
  return callWriter(
    request.trigger,
    "calendar_persist_version",
    {
      p_student_id: request.student_id,
      p_trigger: request.trigger,
      p_initiated_by: request.initiated_by,
      p_generator_version: request.generator_version,
      p_idempotency_key: request.idempotency_key ?? null,
    },
    {
      studentId: request.student_id,
      ...(requestId === undefined ? {} : { requestId }),
    },
  );
}

// ── §12.1 date-scoped triggers ──────────────────────────────────────────────

export type DayRegenerateRequest = {
  student_id: string;
  date: string;
  /** `day_regenerate` and `day_reset` differ ONLY in the trigger recorded (sheet item 20). */
  trigger: Extract<PlanTrigger, "day_regenerate" | "day_reset">;
  generator_version: string;
  idempotency_key?: string;
};

export async function regenerateDay(
  request: DayRegenerateRequest,
  requestId?: string,
): Promise<PlanWriteResult> {
  return callWriter(
    request.trigger,
    "calendar_regenerate_day",
    {
      p_student_id: request.student_id,
      p_date: request.date,
      p_trigger: request.trigger,
      p_generator_version: request.generator_version,
      p_idempotency_key: request.idempotency_key ?? null,
    },
    {
      studentId: request.student_id,
      date: request.date,
      ...(requestId === undefined ? {} : { requestId }),
    },
  );
}

export type DayEditRequest = {
  student_id: string;
  date: string;
  /** §12.4: the FULL desired member list. An empty array is a cleared day, not a no-op. */
  members: unknown;
  generator_version: string;
  idempotency_key: string;
};

export async function editDay(
  request: DayEditRequest,
  requestId?: string,
): Promise<PlanWriteResult> {
  return callWriter(
    "day_edit",
    "calendar_edit_day",
    {
      p_student_id: request.student_id,
      p_date: request.date,
      // The members arrive already parsed against `dayEditBodySchema` at the route and are
      // forwarded to the RPC as jsonb. Serialising them here rather than at the route keeps
      // the wire shape of the RPC in this file, which is the only file that calls it.
      p_members: JSON.stringify(request.members),
      p_generator_version: request.generator_version,
      p_idempotency_key: request.idempotency_key,
    },
    {
      studentId: request.student_id,
      date: request.date,
      ...(requestId === undefined ? {} : { requestId }),
    },
  );
}

export type DoItNowRequest = {
  student_id: string;
  block_id: string;
  generator_version: string;
  idempotency_key: string;
};

export async function doItNow(
  request: DoItNowRequest,
  requestId?: string,
): Promise<PlanWriteResult> {
  return callWriter(
    "do_it_now",
    "calendar_do_it_now",
    {
      p_student_id: request.student_id,
      p_block_id: request.block_id,
      p_generator_version: request.generator_version,
      p_idempotency_key: request.idempotency_key,
    },
    {
      studentId: request.student_id,
      ...(requestId === undefined ? {} : { requestId }),
    },
  );
}

// ── §12.2/§12.4 move ────────────────────────────────────────────────────────

export type MoveBlockRequest = {
  student_id: string;
  block_id: string;
  to_date: string;
  generator_version: string;
  idempotency_key: string;
};

/**
 * @spec [Doc_05F_Study_Calendar, §12.2 protected state, §12.4 day edit]
 * @implemented [2026-09-23]
 * plain English: hands one block and a target date to `calendar_move_block`, which writes a
 * single version owning both the old and the new date. Expected outcome: `{ version_no }`.
 * Trade-off: this is `refusable`, so three outcomes reach the route as a `move_refused`
 * failure rather than as a thrown error — the route turns each into a 409 the client can
 * act on. Edge case: the past-date and same-date refusals are decided against the SERVER's
 * local today, which is why the client mirroring them is an optimisation and not the check.
 */
export async function moveBlock(
  request: MoveBlockRequest,
  requestId?: string,
): Promise<PlanWriteResult> {
  return callWriter(
    "move_block",
    "calendar_move_block",
    {
      p_student_id: request.student_id,
      p_block_id: request.block_id,
      p_to_date: request.to_date,
      p_generator_version: request.generator_version,
      p_idempotency_key: request.idempotency_key,
    },
    {
      studentId: request.student_id,
      date: request.to_date,
      refusable: true,
      ...(requestId === undefined ? {} : { requestId }),
    },
  );
}

// ── §12.7 acknowledgement ───────────────────────────────────────────────────

/**
 * Monotonic in SQL: `GREATEST(current, LEAST(requested, highest accepted))`, so
 * acknowledging an older version never lowers the watermark and the same body twice is
 * the same outcome — which is why §15 gives this route no `idempotency_key`.
 *
 * An RPC rather than a client-side read-then-write for exactly that reason: two
 * concurrent acknowledgements that each read the old value would lose the later one, and
 * the clamp to the student's highest accepted version stops a client suppressing the
 * banner for a rollback it has never been shown (§17.4).
 *
 * The returned watermark is discarded here: `{ ok: true }` is the whole of §15's response
 * shape, and a route that returned the clamped number would be inventing a field.
 */
export async function acknowledgeVersion(
  studentId: string,
  versionNo: number,
  requestId?: string,
): Promise<Result<true, PlanFailure>> {
  const { error } = await supabaseServer.rpc("calendar_acknowledge_version", {
    p_student_id: studentId,
    p_version_no: versionNo,
  });

  if (error) {
    logger.error(
      "CALENDAR_PLAN",
      "acknowledge_failed",
      "the plan acknowledgement watermark could not be raised",
      { ...classifyError(error), requestId },
    );
    return err(classifyRpcError(error, {}));
  }

  logger.info(
    "CALENDAR_PLAN",
    "plan_acknowledged",
    "the student acknowledged a plan version",
    { version_no: versionNo, requestId },
  );
  return ok(true);
}
