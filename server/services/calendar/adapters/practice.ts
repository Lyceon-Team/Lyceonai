/**
 * The practice engine adapter — Doc 05F §9.2.
 *
 * @spec [Doc-05F_V1.0 §9.1 contract, §9.2 practice adapter, §13 allocator,
 *        §15.1 launch (INV-08-18); Doc-02B_V4 §14 session create]
 * | @implemented [2026-09-18]
 *
 * plain English: turns a calendar practice block into a real practice session, and
 * reads back the answered items that block can count. It creates through the SAME
 * function the practice page uses, so the session limit, the client-instance binding
 * and the idempotency replay all behave identically — a second create path would be
 * a second contract, and only one of them would get fixed.
 *
 * expected outcome: pressing Start on an Algebra 20 block opens a structured
 * practice session filtered to Math/Algebra with 20 questions, and a retry of the
 * same launch returns that same session rather than a second one.
 *
 * trade-offs: `mode` is `structured` (§9.2). It is a client-requestable mode, so the
 * calendar is not claiming a privilege the practice page lacks — and it is NOT
 * `diagnostic`, which decides how answers land in mastery and is server-assigned by
 * one route only.
 *
 * edge cases: a section-level block (cold start, every fallback plan) carries no
 * domains, so it filters on section alone and the whole section is in scope. That is
 * the shape the generator emits before any mastery exists, not a degenerate case.
 */
import { supabaseServer } from "../../../../apps/api/src/lib/supabase-server";
import {
  startOrReplaySession,
  loadPracticeConfig,
} from "../../../routes/practice-canonical";
import { logger } from "../../../logger";
import { err, ok, type ActivityUnit, type PlanBlock } from "@lyceon/shared";
import { localDayWindowUtc, toIsoTimestamp } from "./local-day";
import type {
  CalendarEngineAdapter,
  EngineCreateContext,
  EngineCreateResult,
  EngineLifecycle,
} from "./types";

/** The domains a practice block's scope names, or none for a section-level block. */
function domainsOf(block: PlanBlock): string[] {
  if (block.block_type !== "practice") return [];
  if (block.scope.level === "section") return [];
  return block.scope.mix.map((entry) => entry.domain);
}

async function create(
  block: PlanBlock,
  size: number,
  ctx: EngineCreateContext,
): Promise<EngineCreateResult> {
  if (block.block_type !== "practice" || block.section === null) {
    return err({
      reason: "engine_error",
      detail: `practice adapter was handed a ${block.block_type} block`,
    });
  }

  const result = await startOrReplaySession({
    userId: ctx.student_id,
    actorId: ctx.actor_id,
    role: ctx.role,
    section: block.section,
    mode: "structured",
    clientInstanceId: ctx.client_instance_id,
    // §9.2: forwarded UNCHANGED. The calendar owns the key format, the engine
    // owns what a repeated key means, and neither rewrites the other's half.
    idempotencyKey: ctx.idempotency_key,
    targetQuestionCount: size,
    sessionSpec: {
      sections: [block.section],
      domains: domainsOf(block),
      skills: [],
      difficulties: [],
      target_minutes: null,
      target_question_count: size,
      mode: "structured",
    },
  });

  if (!result.ok) {
    logger.error(
      "CALENDAR_ADAPTER",
      "practice_create_failed",
      "practice session create refused a calendar launch",
      {
        status: result.status,
        // The engine's own error CODE, never its prose and never the block scope.
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
    next: `/practice/session/${result.session.id}`,
    resumed: result.replayed,
  });
}

/**
 * §9.2: one unit per ANSWERED item on the local date, carrying its section and domain.
 * `occurred_at` is the timestamp — the moment of retrieval — and the local date is
 * resolved through the plan date's OWN timezone, which arrives as `timeZone`.
 *
 * AN ACTIVITY UNIT IS RETRIEVAL, AND A SKIP IS NOT RETRIEVAL. The predicate is
 * `status = 'answered'`, NOT `occurred_at IS NOT NULL`. Those read as synonyms and are not:
 * a SKIPPED item is resolved too, so the CHECK guarantees it an `occurred_at` exactly as it
 * guarantees one to an answered item — review's live data has two such rows right now
 * (`status='skipped'`, `outcome='skipped'`, both timestamps set), and review's handoff says
 * practice skips now enter the queue too. On a nullness predicate every skip would count as
 * a unit, so a student could clear a block by skipping through it and §13's progress would
 * say they had done the work. The predicate is on `status` for that reason and no other.
 *
 * WHICH TIMESTAMP, AND WHY IT CHANGED (owner ruling 2026-09-22). This windowed on
 * `answered_at` until now. `occurred_at` is the column the table actually guarantees:
 *
 *     CONSTRAINT psi_resolved_requires_occurred_at
 *       CHECK (status <> ALL (ARRAY['answered','skipped']) OR occurred_at IS NOT NULL)
 *
 * `answered_at` is plain nullable `timestamptz` with nothing enforcing it. The two agree on
 * every resolved row in production today because `submitPracticeAnswer` and the skip path
 * write both from one `now` — but that is a property of today's writers, not of the schema,
 * and a resolved row that ever lands without `answered_at` falls out of this window with no
 * error anywhere. Under-reporting a student's work silently is the same failure mode the
 * skip predicate had; this closes the other half of it.
 *
 * 20260921000000 made exactly this argument about mastery's read of the same table —
 * "occurred_at, not answered_at: psi_resolved_requires_occurred_at guarantees the former on
 * every resolved row, and nothing guarantees the latter" — and the calendar now dates a unit
 * by the same instant mastery does rather than by a column that merely agrees with it.
 */
async function activityUnits(
  studentId: string,
  localDate: string,
  timeZone: string,
): Promise<ActivityUnit[]> {
  const window = localDayWindowUtc(localDate, timeZone);

  const { data, error } = await supabaseServer
    .from("practice_session_items")
    .select("id, question_section, question_domain, occurred_at, status")
    .eq("user_id", studentId)
    // See the note above: retrieval, never a skip.
    .eq("status", "answered")
    .gte("occurred_at", window.startUtc)
    .lt("occurred_at", window.endUtc);

  if (error) {
    // Fail OPEN. A read that cannot see today's activity must show a plan with no
    // progress, never a 500 — Doc 05F §5A, and the same posture as the stubs.
    logger.error(
      "CALENDAR_ADAPTER",
      "practice_activity_read_failed",
      "practice activity units could not be read",
      { code: error.code, localDate },
    );
    return [];
  }

  const rows = data ?? [];
  const units: ActivityUnit[] = [];
  for (const row of rows) {
    if (typeof row.id !== "string") continue;
    // Normalised rather than type-guarded, for the same reason the review adapter does it:
    // the same column is a STRING over PostgREST and a Date over node-postgres, and a
    // `typeof === "string"` guard silently drops every row under the second. See
    // `toIsoTimestamp`. This adapter carried that guard until now and was correct only
    // because nothing had yet read it through a pg-backed harness.
    const occurredAt = toIsoTimestamp(row.occurred_at);
    if (occurredAt === null) continue;
    const section = row.question_section;
    units.push({
      engine: "practice",
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
    .from("practice_sessions")
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
 * §9.2: the practice create contract decides valid sizes, not the calendar. The
 * ceiling is `max_session_count_premium` from practice's own config, read at call
 * time rather than cached here — one owner, one value.
 */
async function nextLaunchSize(
  _block: PlanBlock,
  remaining: number,
): Promise<number> {
  const config = await loadPracticeConfig();
  return Math.max(1, Math.min(remaining, config.maxSessionCountPremium));
}

export const practiceAdapter: CalendarEngineAdapter = {
  engine: "practice",
  create,
  activityUnits,
  progress,
  nextLaunchSize,
};
