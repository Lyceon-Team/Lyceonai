/**
 * The calendar engine adapter contract — Doc 05F §9.1.
 *
 * @spec [Doc-05F_V1.0 §9.1 adapter contract (INV-08-02, R-08-15), §9.2–§9.4;
 *        Doc_05F_formula_sheet.md §8 item 12 (enabled_block_types launches as
 *        practice only, the other two ship as fail-open stubs)]
 * | @implemented [2026-09-18]
 *
 * plain English: one shape per engine, so the calendar can launch a block and read
 * back what the student did without knowing anything about how that engine works.
 * All three are real: practice, review (2026-09-22) and full-length (E9b, 2026-09-25).
 * An engine that is not built yet fails OPEN — it answers "not available" as data, and
 * the calendar renders a plan around it rather than a 500.
 *
 * WHAT IS DELIBERATELY NOT HERE. §9.1 also lists `matches` and `scopeOf`. Those are
 * served by `unitMatchesBlock` in `@lyceon/shared` calendar/allocate, which the §13
 * allocator already uses: an adapter with its own copy would be a second answer to
 * "did this item count", and the two would drift. `allowedPlanSizes` and
 * `estimateSeconds` are not here either — the generator does that budgeting in
 * PL/pgSQL from the snapshot's `engine_planning`, and the formula lives there only.
 *
 * trade-offs: `create` returns the canonical `Result` from `@lyceon/shared` rather
 * than the `{ok:false, reason}` shape the brief sketched. Same discriminated union,
 * one fewer result type in the codebase — CLAUDE.md's single-source rule outranks
 * the sketch. The reason is `result.error.reason`.
 */
import type {
  ActivityUnit,
  CalendarDayInput,
  CalendarEngine,
  PlanBlock,
  Result,
} from "@lyceon/shared";

/** What a launch needs from the request, plus the key `CalendarLaunchService` owns. */
export type EngineCreateContext = {
  student_id: string;
  actor_id: string;
  role: string | undefined;
  client_instance_id: string;
  platform: "web" | "mobile";
  /**
   * `calendar:block:<block_id>:<seq>`. Forwarded to the engine UNCHANGED (§9.2).
   * Adapters never construct it — `CalendarLaunchService` is its sole owner (§15.1),
   * and that ownership is what makes two concurrent first launches one session.
   */
  idempotency_key: string;
};

export type EngineLaunch = {
  session_id: string;
  /**
   * Where the client navigates. ALWAYS `adapter.resumeHref(session_id)` — never a
   * template written at the call site. See `resumeHref` for why that is a contract rule
   * rather than a style preference.
   */
  next: string;
  /** True when an already-live session was handed back rather than a new one made. */
  resumed: boolean;
};

export const ENGINE_FAILURE_REASONS = [
  /** The engine is not built yet. Fail OPEN: the calendar still renders. */
  "engine_unavailable",
  /** The engine is built and refused or errored. Carries its own detail. */
  "engine_error",
] as const;
export type EngineFailureReason = (typeof ENGINE_FAILURE_REASONS)[number];

export type EngineFailure = {
  reason: EngineFailureReason;
  /** Operator-facing only. Never rendered to a student, never a leak surface. */
  detail?: string;
  /** The engine's own HTTP status when it produced one, for the route to mirror. */
  status?: number;
};

export type EngineCreateResult = Result<EngineLaunch, EngineFailure>;

/** §9.1 `progress(session_id)` — the lifecycle half only. */
export const ENGINE_LIFECYCLES = ["active", "completed", "abandoned"] as const;
export type EngineLifecycle = (typeof ENGINE_LIFECYCLES)[number];

/**
 * One plan date whose activity is wanted, in that date's OWN zone (§8.2). The two fields the
 * read model's `CalendarDayInput` already carries, picked rather than re-declared, so a day the
 * read service assembled can be handed to an adapter as it is.
 */
export type ActivityDay = Pick<CalendarDayInput, "local_date" | "timezone">;

export type CalendarEngineAdapter = {
  engine: CalendarEngine;

  /**
   * Start or resume the engine session for one launch of `block`, at `size` units.
   * `size` is THIS launch's size, not the block target (§9.1).
   */
  create(
    block: PlanBlock,
    size: number,
    ctx: EngineCreateContext,
  ): Promise<EngineCreateResult>;

  /**
   * The atomic units the §13 allocator consumes, for a SET of student-local dates, each in its
   * own zone — in ONE engine read (§9.1 as amended by SCL-233).
   *
   * @spec [Doc-05F_V1.0 §9.1 as amended by SCL-233, §13 `units = ∪ activityUnits(student, D,
   *        tz_D)`, §8.2] | @implemented [2026-10-15]
   *
   * WHY A SET OF DAYS, NOT ONE. §9.1 as locked took one `localDate`, and the read asked every
   * engine once per day: a fortnight with all three engines was 42 queries, two thirds of the
   * calendar read's round trips (owner ruling on #1232, 2026-10-13). The result is unchanged —
   * the union §13 takes over the days is exactly what comes back — but it is one round trip per
   * engine: the adapter reads the span from the earliest window's start to the latest window's
   * end and files each row under EVERY requested day whose own half-open window contains it.
   * "Every", because windows in different zones can overlap (a Chicago day and a Tokyo day share
   * fourteen hours), and the per-day reads counted such a row on both days; a row in a GAP
   * between windows belongs to none, as before. `local_date` on each unit is the requested day
   * it was filed under. An empty `days` returns `[]` without a query.
   *
   * `occurred_at` IS THE `occurred_at` COLUMN, for both real engines — the column both
   * tables actually guarantee. `psi_resolved_requires_occurred_at` and
   * `rsi_resolved_requires_occurred_at` are the same CHECK on each:
   *
   *     CHECK (status <> ALL (ARRAY['answered','skipped']) OR occurred_at IS NOT NULL)
   *
   * so every row this contract can return HAS one. `answered_at` is plain nullable
   * `timestamptz` on both tables with nothing enforcing it, and a row that resolves
   * without it would be dropped from the window silently and reported as "the student
   * did nothing today" — the same shape of failure as counting a skip.
   *
   * The two columns agree on every resolved row in production today (owner's count:
   * 156 of 156), because
   * `submitPracticeAnswer`, `submitReviewAnswer` and both skip paths write them from one
   * `now`. That equality is a fact about today's writers, not an invariant; the CHECK is
   * the invariant, so the CHECK is what the calendar reads. (Owner ruling 2026-09-22,
   * superseding "`occurred_at` is `answered_at` for both real engines".)
   *
   * It is also the column review's own mastery trigger feeds from — `trg_review_item_resolve`
   * copies `occurred_at` into `review_error_attempts`, which is what orders
   * `canonical_mastery_events`. The calendar now dates a unit by the same instant
   * mastery does, rather than by a column that merely agrees with it.
   *
   * Neither engine's `served_at` is used: §22.4's midnight split is defined on the moment
   * of RETRIEVAL, not the moment the question was shown.
   */
  activityUnits(
    studentId: string,
    days: readonly ActivityDay[],
  ): Promise<ActivityUnit[]>;

  /**
   * The same units, selected by SESSION instead of by date (§9.1 as amended by R-08-34).
   *
   * WHY A SECOND SELECTOR RATHER THAN A WIDER FIRST ONE. `activityUnits` is keyed on a
   * student-local date, and the whole point of an any-day launch is that the work and the
   * block need not share one: a student who works a Saturday block on Thursday has produced
   * units no date-keyed read of Saturday will ever return. The launch service needs them to
   * compute `remaining`, because otherwise a block already finished ahead of time reads
   * 0/target and pressing Start opens a second session for work that is done.
   *
   * `timeZone` is the OWNING PLAN DATE's (§8.2), the same rule `activityUnits` follows, so a
   * unit's `local_date` is the day the calendar would have filed it under. It is the block's
   * zone rather than the unit's own because the block is what the unit is being attributed
   * to, and one of the two has to win.
   *
   * An empty `sessionIds` returns `[]` without a query.
   */
  unitsForSessions(
    studentId: string,
    sessionIds: readonly string[],
    timeZone: string,
  ): Promise<ActivityUnit[]>;

  /**
   * §9.1: the client route that opens ONE session of this engine.
   *
   * THIS EXISTS SO A HARDCODED TEMPLATE IS UNREPRESENTABLE, NOT MERELY DISCOURAGED.
   * `create` and the launch service's resume branch both have to answer "where does the
   * student go now", and until 2026-09-23 only `create` asked the adapter. The resume
   * branch built its own string — `/practice/session/<id>` — for EVERY engine, so a
   * student resuming a live REVIEW session from a calendar block was sent to the practice
   * page with a review session id, which 404s (production 2026-09-22, dep
   * dpl_HzcSpFbn8J58G7rAonUzsNRATch8). The first launch worked, because that one goes
   * through `create`; every launch after it took the broken branch.
   *
   * Changing that one string would have fixed review and left the next engine free to
   * repeat it. Making the route an adapter method means the launch service CANNOT know a
   * path: it has nothing to build one from. A new engine supplies its own route or it
   * does not compile. (Owner ruling 2026-09-23.)
   *
   * Pure and synchronous: it is a route, not a lookup. It must agree with the `next` this
   * adapter's own `create` returns, and the launch contract tests assert that for every
   * engine on both branches.
   */
  resumeHref(sessionId: string): string;

  /**
   * The lifecycle of each engine session asked about, for Resume and for `in_progress` (§13),
   * in ONE engine read (§9.1 as amended by SCL-233).
   *
   * A session the engine has no row for, or a status outside its lifecycle, is simply absent
   * from the map — the per-session `null` it was before. A failed read is an empty map: the
   * blocks then read `scheduled` rather than `in_progress`, the cosmetic loss the read service
   * has always accepted for an unread lifecycle. An empty `sessionIds` returns an empty map
   * without a query.
   */
  progress(
    sessionIds: readonly string[],
  ): Promise<ReadonlyMap<string, EngineLifecycle>>;

  /** A size this engine's create contract accepts for the work still outstanding. */
  nextLaunchSize(block: PlanBlock, remaining: number): Promise<number>;
};
