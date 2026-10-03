/**
 * The guardian Dashboard's compact latest-test card (G5-04, G5-08).
 *
 * @spec [Guardian_Closure_Plan G5-04, G5-08; ruling R13 (Karl, 2026-10-02); the canvas boards
 *       "Wave 5 — BUILD TARGET"; G5-09 (owner brief 2026-10-03: scores reach a guardian only
 *       through the report route); SCL-192/SCL-199 (the instants that pick the tests); SCL-182 (the disclosure summary beside every score);
 *       SCL-189 (no counts on the guardian surface); R12 (16px floor); owner decisions
 *       2026-10-02 (a partial score is compared section to section; "you/your" names the
 *       student; the failed state shows its title only)]
 *       | @implemented [2026-10-02; chip from two reports 2026-10-03]
 *
 * plain English: the student's latest full-length test at a glance, in the student's own words
 * — its name and date; for a scored test the total, the change since the previous scored
 * outcome, the Reading and Writing and Math scores; for a partial score the student's "Partial
 * score", the section scores as the student's report shows them ("Not completed" for the other)
 * and the student's sentence on why there is no total; for any other state the student's report
 * title and sentence (`guardianOutcomeCopy`, shared with the detail page). Then the disclosure
 * summary where there is a score, and "See full report →" to the detail page. Phone: every line
 * centred and stacked. Presentational: it is handed the item's report and the change.
 *
 * WHICH TESTS — list fields only, never a score (G5-09). `pickCardExam`: the attempt that ended
 * most recently — completed, or abandoned (a partial score is abandoned, never completed) — by
 * `completed_at ?? abandoned_at`; if none has ended, an attempt in progress, which the student's
 * own card calls "In progress". `pickPreviousExam`: the newest attempt that ended before it with
 * a scored outcome by its `report_state` (scored or partial-scored).
 *
 * THE CHANGE (`changeBetween`) is computed from the two REPORTS, read through the guardian
 * report route with its schema — the latest's and the previous's, at most two report calls. Like
 * with like: total with total when both have one; otherwise the section they share ("▲ 20 in
 * Reading and Writing since last test"), because a partial score has no total (the student's own
 * sentence says so) and a section score and a total are different scales. No earlier attempt at
 * all: "First test". Earlier attempts but none scored, no shared section, or a previous report
 * that failed, is withheld (no valid disclosure, so no score may be drawn from it) or no longer
 * scored: no chip. A drop wears the rust tone, a rise the blue — `levelTone("L1")` and
 * `levelTone("L3")`, borders dropped as the mastery pill drops them; zero is the neutral tone.
 *
 * NOT HERE: question counts and the per-domain bars (detail page), and no control but the link.
 * The score lines sit behind `DisclosedScore`, the report's gate: no disclosure, no score.
 */
import { Link } from "wouter";
import type {
  GuardianExamList,
  GuardianExamReport,
} from "@lyceon/shared/exam-guardian-report-schema";
import {
  EXAM_SECTION_LABEL,
  examDisclosureSchema,
} from "@lyceon/shared/exam-report-schema";
import type { ExamSection } from "@lyceon/shared/exam-runtime-schema";
import { levelTone } from "@/components/mastery/LevelPill";
import { DisclosedScore } from "@/features/exam/components/DisclosedScore";
import {
  guardianOutcomeCopy,
  guardianWithheldCopy,
} from "@/features/exam/pages/GuardianExamResultsPage";

type ExamListItem = GuardianExamList["tests"][number];

type ScoreChange =
  | { kind: "first" }
  | { kind: "none" }
  | { kind: "delta"; delta: number; section: ExamSection | null };

const IN_PROGRESS: ReadonlySet<ExamListItem["session_state"]> = new Set([
  "created",
  "active",
  "section_break",
]);

/** When the attempt ended: completed, or abandoned (a partial score is never completed). */
function endedAt(t: ExamListItem): number | null {
  const at = t.completed_at ?? t.abandoned_at;
  return at === null ? null : Date.parse(at);
}

/**
 * @spec [Guardian_Closure_Plan G5-08, G5-09; SCL-192; SCL-199] | @implemented [2026-10-02]
 * plain English: the attempt the card shows — the newest that ended (completed or abandoned);
 * else one still in progress; null when the student has none. Pure.
 */
export function pickCardExam(
  tests: readonly ExamListItem[],
): ExamListItem | null {
  let latest: ExamListItem | null = null;
  for (const t of tests) {
    const at = endedAt(t);
    if (at === null) continue;
    if (latest === null || at > (endedAt(latest) ?? -Infinity)) latest = t;
  }
  return latest ?? tests.find((t) => IN_PROGRESS.has(t.session_state)) ?? null;
}

const SCORED_STATES: ReadonlySet<ExamListItem["report_state"]> = new Set([
  "scored",
  "partial_scored",
]);

/** Which earlier attempt the chip compares with, chosen from list fields alone. */
export type PreviousExam =
  | { kind: "first" }
  | { kind: "none" }
  | { kind: "previous"; item: ExamListItem };

/**
 * @spec [Guardian_Closure_Plan G5-04, G5-08, G5-09; SCL-192; SCL-199] | @implemented [2026-10-03]
 * plain English: the attempt the chip compares the card's with — the newest that ended before it
 * with a scored outcome (`report_state` scored or partial-scored); "first" when no attempt ended
 * before it; "none" when the card's own attempt has no score or nothing earlier was scored. List
 * fields only (states and instants), never a score: the scores come from the reports. Pure.
 */
export function pickPreviousExam(
  tests: readonly ExamListItem[],
  latest: ExamListItem,
): PreviousExam {
  const at = endedAt(latest);
  if (!SCORED_STATES.has(latest.report_state) || at === null) {
    return { kind: "none" };
  }
  const earlier = tests.filter((t) => {
    const e = endedAt(t);
    return t.session_id !== latest.session_id && e !== null && e < at;
  });
  if (earlier.length === 0) return { kind: "first" };
  let previous: ExamListItem | null = null;
  for (const t of earlier) {
    if (!SCORED_STATES.has(t.report_state)) continue;
    if (previous === null || (endedAt(t) ?? 0) > (endedAt(previous) ?? 0)) {
      previous = t;
    }
  }
  return previous === null
    ? { kind: "none" }
    : { kind: "previous", item: previous };
}

type Outcome = {
  total: number | null;
  RW: number | null;
  M: number | null;
};

/**
 * A report's scored outcome as the student's report shows it, or null when it has no score a
 * guardian may be shown — another state, or a disclosure that fails its schema (the gate
 * `DisclosedScore` applies before drawing any score).
 */
function outcomeOf(report: GuardianExamReport): Outcome | null {
  if (
    report.report_state !== "scored" &&
    report.report_state !== "partial_scored"
  ) {
    return null;
  }
  if (!examDisclosureSchema.safeParse(report.disclosure).success) return null;
  return {
    total: report.report_state === "scored" ? report.score.total_scaled : null,
    RW: report.score.rw_scaled,
    M: report.score.math_scaled,
  };
}

/**
 * @spec [Guardian_Closure_Plan G5-04, G5-08, G5-09; owner decision 2026-10-02 (a partial score
 *       is compared section to section)] | @implemented [2026-10-03]
 * plain English: the card's report minus the previous report, like with like — total with total,
 * else the one section both have. `previous` is what `pickPreviousExam` chose; `before` is its
 * report, undefined while it is loading or when the read failed or was refused. Anything not
 * comparable is "none": no chip. Pure; every number from the two reports.
 */
export function changeBetween(
  latest: GuardianExamReport,
  previous: PreviousExam,
  before: GuardianExamReport | undefined,
): ScoreChange {
  const now = outcomeOf(latest);
  if (now === null || previous.kind === "none") return { kind: "none" };
  if (previous.kind === "first") return { kind: "first" };
  if (before === undefined || before.session_id !== previous.item.session_id) {
    return { kind: "none" };
  }
  const then = outcomeOf(before);
  if (then === null) return { kind: "none" };
  if (now.total !== null && then.total !== null) {
    return { kind: "delta", delta: now.total - then.total, section: null };
  }
  const shared = (["RW", "M"] as const).filter(
    (s) => now[s] !== null && then[s] !== null,
  );
  if (shared.length !== 1) return { kind: "none" };
  const section = shared[0]!;
  return {
    kind: "delta",
    delta: (now[section] ?? 0) - (then[section] ?? 0),
    section,
  };
}

/** "Sep 30" in the viewer's own time zone. */
function monthDay(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

const pillTone = (tone: string): string =>
  tone
    .split(" ")
    .filter((c) => !c.startsWith("border-"))
    .join(" ");

const CHIP =
  "whitespace-nowrap rounded-full px-3 py-[5px] text-base font-semibold";

function Change({ change }: { change: ScoreChange }): JSX.Element | null {
  if (change.kind === "none") return null;
  if (change.kind === "first") {
    return (
      <span
        className={`${CHIP} ${pillTone(levelTone("unmeasured"))}`}
        data-testid="latest-test-first"
      >
        First test
      </span>
    );
  }
  const { delta, section } = change;
  const direction = delta < 0 ? "down" : delta > 0 ? "up" : "none";
  const tone =
    direction === "down"
      ? pillTone(levelTone("L1"))
      : direction === "up"
        ? pillTone(levelTone("L3"))
        : pillTone(levelTone("unmeasured"));
  const where = section === null ? "" : ` in ${EXAM_SECTION_LABEL[section]}`;
  const text =
    direction === "none"
      ? `No change${where} since last test`
      : `${direction === "down" ? "▼" : "▲"} ${Math.abs(delta)}${where} since last test`;
  return (
    <span
      className={`${CHIP} ${tone}`}
      data-testid="latest-test-change"
      data-direction={direction}
    >
      {text}
    </span>
  );
}

/** A section score as the student's report shows it: the number, or "Not completed". */
function SectionTile({
  section,
  scaled,
}: {
  section: ExamSection;
  scaled: number | null;
}): JSX.Element {
  return (
    <div
      className="rounded-[14px] bg-card px-4 py-3.5"
      data-testid={`latest-test-section-${section}`}
    >
      <div className="text-base text-muted-foreground">
        {EXAM_SECTION_LABEL[section]}
      </div>
      {scaled === null ? (
        <div className="text-base font-medium">Not completed</div>
      ) : (
        <div className="text-[26px] font-bold">{scaled}</div>
      )}
    </div>
  );
}

/** The card's frame and heading; the Dashboard's loading and error states sit in it too. */
export function LatestTestShell({
  meta,
  changeSettled,
  children,
}: {
  meta?: string;
  /** False while the previous test's report is still being read (the chip may yet appear). */
  changeSettled?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section
      data-change-settled={
        changeSettled === undefined ? undefined : String(changeSettled)
      }
      className="flex flex-col items-center gap-[18px] rounded-[22px] border border-[color:var(--cream-300)] bg-white px-[30px] py-7 text-center sm:items-stretch sm:text-left"
      data-testid="latest-test-card"
    >
      <div className="flex w-full flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <h2 className="m-0 text-xl font-bold">Latest full-length test</h2>
        {meta === undefined ? null : (
          <span
            className="text-base text-muted-foreground"
            data-testid="latest-test-meta"
          >
            {meta}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

const STATE_TITLE = "text-[28px] font-bold leading-tight";

export function GuardianLatestTestCard({
  report,
  endedAt: ended,
  change,
  changeSettled,
  studentName,
  href,
}: {
  report: GuardianExamReport;
  endedAt: string | null;
  change: ScoreChange;
  changeSettled: boolean;
  studentName: string;
  href: string;
}): JSX.Element {
  const meta =
    ended === null
      ? report.test_form_name
      : `${report.test_form_name} · ${monthDay(ended)}`;
  const link = (
    <Link
      href={href}
      className="whitespace-nowrap text-base font-semibold underline"
    >
      See full report →
    </Link>
  );
  const withheld = guardianWithheldCopy(studentName);
  if (report.report_state === "scored") {
    return (
      <LatestTestShell meta={meta} changeSettled={changeSettled}>
        <DisclosedScore disclosure={report.disclosure} withheldCopy={withheld}>
          <div className="flex flex-col items-center gap-2.5 sm:flex-row sm:gap-4">
            <span
              className="text-[56px] font-bold leading-none"
              data-testid="latest-test-total"
            >
              {report.score.total_scaled}
            </span>
            <Change change={change} />
          </div>
          <div className="grid w-full grid-cols-2 gap-3">
            <SectionTile section="RW" scaled={report.score.rw_scaled} />
            <SectionTile section="M" scaled={report.score.math_scaled} />
          </div>
        </DisclosedScore>
        <Footer summary={report.disclosure.summary} link={link} />
      </LatestTestShell>
    );
  }
  if (report.report_state === "partial_scored") {
    return (
      <LatestTestShell meta={meta} changeSettled={changeSettled}>
        <DisclosedScore disclosure={report.disclosure} withheldCopy={withheld}>
          <div className="flex flex-col items-center gap-2.5 sm:flex-row sm:gap-4">
            {/* The student's own panel title for this state (ReportBody). */}
            <span className={STATE_TITLE} data-testid="latest-test-state-title">
              Partial score
            </span>
            <Change change={change} />
          </div>
          <div className="grid w-full grid-cols-2 gap-3">
            <SectionTile section="RW" scaled={report.score.rw_scaled} />
            <SectionTile section="M" scaled={report.score.math_scaled} />
          </div>
          <p
            className="m-0 text-base leading-relaxed"
            data-testid="latest-test-status"
          >
            {report.partial_disclosure.summary}
          </p>
        </DisclosedScore>
        <Footer summary={report.disclosure.summary} link={link} />
      </LatestTestShell>
    );
  }
  const copy = guardianOutcomeCopy(report, studentName);
  return (
    <LatestTestShell meta={meta} changeSettled={changeSettled}>
      <div className="flex flex-col gap-1.5">
        <span className={STATE_TITLE} data-testid="latest-test-state-title">
          {copy.title}
        </span>
        {copy.body === null ? null : (
          <p
            className="m-0 text-base leading-relaxed"
            role="status"
            data-testid="latest-test-status"
          >
            {copy.body}
          </p>
        )}
      </div>
      <div className="flex w-full justify-center sm:justify-end">{link}</div>
    </LatestTestShell>
  );
}

function Footer({
  summary,
  link,
}: {
  summary: string;
  link: JSX.Element;
}): JSX.Element {
  return (
    <div className="flex w-full flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <span
        className="text-base text-muted-foreground"
        data-testid="latest-test-disclosure"
      >
        {summary}
      </span>
      {link}
    </div>
  );
}
