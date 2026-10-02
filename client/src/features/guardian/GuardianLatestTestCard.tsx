/**
 * The guardian Dashboard's compact latest-test card (G5-04, G5-08).
 *
 * @spec [Guardian_Closure_Plan G5-04, G5-08; ruling R13 (Karl, 2026-10-02); the canvas boards
 *       "Wave 5 — BUILD TARGET"; SCL-199 (scores on the guardian list item); SCL-192 (the
 *       latest test by its instant); SCL-182 (the disclosure summary beside every score);
 *       SCL-189 (no counts on the guardian surface); R12 (16px floor); owner decisions
 *       2026-10-02 (a partial score is compared section to section; "you/your" names the
 *       student; the failed state shows its title only)] | @implemented [2026-10-02]
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
 * WHICH TEST (`pickCardExam`): the attempt that ended most recently — completed, or abandoned
 * (a partial score is abandoned, never completed) — by `completed_at ?? abandoned_at`; if none
 * has ended, an attempt in progress, which the student's own card calls "In progress".
 *
 * THE CHANGE (`changeSinceLast`) compares the card's scored outcome with the previous scored
 * outcome (the newest one that ended before it), like with like: total with total when both have
 * one; otherwise the section they share ("▲ 20 in Reading and Writing since last test"), because
 * a partial score has no total (the student's own sentence says so) and a section score and a
 * total are different scales. No earlier attempt at all: "First test". Earlier attempts but none
 * scored, or no shared section: no chip. A drop wears the rust tone, a rise the blue —
 * `levelTone("L1")` and `levelTone("L3")`, borders dropped as the mastery pill drops them; zero is
 * the neutral tone. Every number comes from the list (SCL-199), so it costs no second report.
 *
 * NOT HERE: question counts and the per-domain bars (detail page), and no control but the link.
 * The score lines sit behind `DisclosedScore`, the report's gate: no disclosure, no score.
 */
import { Link } from "wouter";
import type {
  GuardianExamList,
  GuardianExamReport,
} from "@lyceon/shared/exam-guardian-report-schema";
import { EXAM_SECTION_LABEL } from "@lyceon/shared/exam-report-schema";
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
 * @spec [Guardian_Closure_Plan G5-08; SCL-192; SCL-199] | @implemented [2026-10-02]
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

type Outcome = {
  total: number | null;
  RW: number | null;
  M: number | null;
};

/** The scored outcome as the student's report shows it, or null when there is no score. */
function outcomeOf(t: ExamListItem): Outcome | null {
  if (t.report_state !== "scored" && t.report_state !== "partial_scored") {
    return null;
  }
  return { total: t.total_scaled, RW: t.rw_scaled, M: t.math_scaled };
}

/**
 * @spec [Guardian_Closure_Plan G5-04, G5-08; SCL-199; owner decision 2026-10-02 (a partial
 *       score is compared section to section)] | @implemented [2026-10-02]
 * plain English: the card's scored outcome minus the previous scored outcome, like with like —
 * total with total, else the one section both have; "first" with no earlier attempt; "none"
 * when there is nothing comparable. Pure; every number from the list.
 */
export function changeSinceLast(
  tests: readonly ExamListItem[],
  latest: ExamListItem,
): ScoreChange {
  const now = outcomeOf(latest);
  const at = endedAt(latest);
  if (now === null || at === null) return { kind: "none" };
  const earlier = tests.filter((t) => {
    const e = endedAt(t);
    return t.session_id !== latest.session_id && e !== null && e < at;
  });
  if (earlier.length === 0) return { kind: "first" };
  let previous: ExamListItem | null = null;
  for (const t of earlier) {
    if (outcomeOf(t) === null) continue;
    if (previous === null || (endedAt(t) ?? 0) > (endedAt(previous) ?? 0)) {
      previous = t;
    }
  }
  const before = previous === null ? null : outcomeOf(previous);
  if (before === null) return { kind: "none" };
  if (now.total !== null && before.total !== null) {
    return { kind: "delta", delta: now.total - before.total, section: null };
  }
  const shared = (["RW", "M"] as const).filter(
    (s) => now[s] !== null && before[s] !== null,
  );
  if (shared.length !== 1) return { kind: "none" };
  const section = shared[0]!;
  return {
    kind: "delta",
    delta: (now[section] ?? 0) - (before[section] ?? 0),
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
  children,
}: {
  meta?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section
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
  studentName,
  href,
}: {
  report: GuardianExamReport;
  endedAt: string | null;
  change: ScoreChange;
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
      <LatestTestShell meta={meta}>
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
      <LatestTestShell meta={meta}>
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
    <LatestTestShell meta={meta}>
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
