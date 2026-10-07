/**
 * The Full-Length home's rows: each test's status line and its action, and which ONE action is
 * the page's primary.
 *
 * @spec [DESIGN.md §4 "Full-Length home" ("the test list with status per test; the single
 *        primary action is the most relevant one (Resume, otherwise Start)"), §1 (one primary
 *        action per screen); prototype FullLength.dc.html (the status wording: "Not started",
 *        "In progress: Reading and Writing, Module 2", "Completed 26 September. Score 1120.");
 *        evidence/wiring-table.md §7; register OQ-31 (owner ruling 2026-10-02: the card shows
 *        the completed test's score, the real exam result from score_runs; this SUPERSEDES E7b
 *        ruling 2, "state words on the card, never a score"), OQ-32 (owner ruling 2026-10-02:
 *        "section, module" is read from the in-progress session's `/state`, no server change),
 *        OQ-51 ("Reading & Writing", the canonical display label)]
 *       [Doc-04C §15.1: a scaled score is never drawn without its disclosure; the caller draws
 *        the row's disclosure beside the status whenever `scored` is set]
 *       [Doc-04C §2.3: Module 2 is named "Module 2" and nothing more]
 *       | @implemented [2026-10-03]
 *
 * plain English: pure functions over the three reads the page makes: `/api/tests/forms` (the
 * forms and each one's latest attempt), `/api/tests/sessions?state=scored` (the score, keyed by
 * session id) and, for the one in-progress attempt, its `/state` (where it is). The primary
 * action is Resume when an attempt is in progress, else Start on the first selectable form never
 * taken, else "Take again" on the first selectable form; everything else is outline.
 *
 * edge cases: a scored attempt whose score is not in the scored list (the list not loaded yet, or
 * past its 50-row cap) shows the state word ("Scored") rather than a score it cannot back with
 * its disclosure. An in-progress attempt whose `/state` is not loaded, not started, or on the
 * break shows "In progress" alone: the prototype words only the in-module case.
 */
import type { ExamFormsResponse } from "@lyceon/shared/exam-report-schema";
import type { ExamScoredSessionRow } from "@lyceon/shared/exam-scored-sessions-schema";
import type { ExamSessionResponse } from "@lyceon/shared/exam-runtime-schema";
import { sectionDisplayLabel } from "@shared/section-display";
import { examPosition } from "./exam-position";
import { formCardStateLabel } from "./labels";

export type ExamForm = ExamFormsResponse["forms"][number];

/** The session states a student can still continue (Doc-04A §5). PaidHome reads this too. */
const EXAM_IN_PROGRESS_STATES: ReadonlySet<string> = new Set([
  "created",
  "active",
  "section_break",
]);

export function isExamInProgress(state: string): boolean {
  return EXAM_IN_PROGRESS_STATES.has(state);
}

/** "26 September" (prototype FullLength.dc.html). */
export function dayMonth(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

/** "26 September 2026" (prototype Report.dc.html's top bar). */
export function dayMonthYear(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

/** OQ-32: "In progress: Reading & Writing, Module 2" from the attempt's own `/state`. */
function inProgressLine(
  session: ExamSessionResponse | undefined,
): string {
  if (session === undefined) return "In progress";
  const position = examPosition(session);
  if (position.kind === "module") {
    return `In progress: ${sectionDisplayLabel(position.section) ?? ""}, Module ${position.module}`;
  }
  if (position.kind === "module2_ready") {
    return `In progress: ${sectionDisplayLabel(position.section) ?? ""}, Module 2`;
  }
  return "In progress";
}

export type RowAction =
  | { kind: "resume"; sessionId: string }
  | { kind: "report"; sessionId: string }
  | { kind: "start" }
  | { kind: "take-again" }
  | { kind: "unavailable" };

export type FormRow = {
  form: ExamForm;
  /** The status line under the test's name. */
  status: string;
  /** Set when the status carries a score: the caller draws its disclosure beside it. */
  scored: ExamScoredSessionRow | null;
  actions: readonly RowAction[];
};

function completedLine(row: ExamScoredSessionRow): string {
  return `Completed ${dayMonth(row.completed_at)}. Score ${row.total_scaled}.`;
}

export function formRow(
  form: ExamForm,
  scoredById: ReadonlyMap<string, ExamScoredSessionRow>,
  inProgressState: ExamSessionResponse | undefined,
): FormRow {
  const latest = form.latest_session;
  if (latest !== null && isExamInProgress(latest.state)) {
    return {
      form,
      status: inProgressLine(inProgressState),
      scored: null,
      actions: [{ kind: "resume", sessionId: latest.session_id }],
    };
  }
  const startKind: RowAction = !form.is_selectable
    ? { kind: "unavailable" }
    : latest === null
      ? { kind: "start" }
      : { kind: "take-again" };
  if (latest === null) {
    return {
      form,
      status: formCardStateLabel(null),
      scored: null,
      actions: [startKind],
    };
  }
  const scored =
    latest.report_state === "scored"
      ? (scoredById.get(latest.session_id) ?? null)
      : null;
  const hasReport = latest.state !== "abandoned_final";
  return {
    form,
    status:
      scored !== null ? completedLine(scored) : formCardStateLabel(latest),
    scored,
    actions: hasReport
      ? [{ kind: "report", sessionId: latest.session_id }, startKind]
      : [startKind],
  };
}

/**
 * The ONE primary action (DESIGN.md §1, §4): Resume, otherwise Start on the first form never
 * taken, otherwise "Take again" on the first selectable form. Returns the form id, or null when
 * the page has nothing to start (every form unavailable).
 */
export function primaryFormId(rows: readonly FormRow[]): string | null {
  const pick = (kind: RowAction["kind"]): string | null =>
    rows.find((r) => r.actions.some((a) => a.kind === kind))?.form
      .test_form_id ?? null;
  return pick("resume") ?? pick("start") ?? pick("take-again");
}

/** The primary action's kind on a row that is the primary one. */
export function primaryKindOf(row: FormRow): RowAction["kind"] | null {
  const order: readonly RowAction["kind"][] = ["resume", "start", "take-again"];
  for (const kind of order) {
    if (row.actions.some((a) => a.kind === kind)) return kind;
  }
  return null;
}

/** "26 September. Reading & Writing 620, Math 500" (prototype score-history row). */
export function historyLine(row: ExamScoredSessionRow): string {
  return `${dayMonth(row.completed_at)}. ${sectionDisplayLabel("RW") ?? ""} ${row.rw_scaled}, ${sectionDisplayLabel("M") ?? ""} ${row.math_scaled}`;
}
