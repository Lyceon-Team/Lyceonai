/**
 * The guardian Dashboard's compact latest-test card (G5-04).
 *
 * @spec [Guardian_Closure_Plan G5-04; ruling R13 (Karl, 2026-10-02); the canvas boards "Wave 5 —
 *       BUILD TARGET"; SCL-199 (`total_scaled` on the guardian list item); SCL-192 (the latest
 *       test is the newest `completed_at`); SCL-182 (the disclosure summary beside every score);
 *       SCL-189 (no counts on the guardian surface); R12 (16px floor)] | @implemented [2026-10-02]
 *
 * plain English: the latest completed full-length test at a glance — its name and date, its
 * total, the change since the previous completed test, the Reading and Writing and Math scores,
 * the disclosure summary and "See full report →" to the existing detail page. Phone: every
 * line centred and stacked. Presentational: it is handed the latest item's report and the change.
 *
 * THE CHANGE (`changeSinceLast`) is the latest item's total minus the previous completed item's
 * total, both from the list (SCL-199) — so it costs no second report read. "Previous" is the
 * newest `completed_at` before the latest's, not the list's form order. No previous test: "First
 * test", no chip. A previous test whose total is not known (still being scored, delayed): no
 * chip and no "First test" — there was a test, and its score is not one to subtract. A drop wears
 * the rust tone, a rise the blue: `levelTone("L1")` and `levelTone("L3")`, the live pill tones,
 * borders dropped as the mastery pill drops them. A change of zero is the neutral tone.
 *
 * NOT HERE: question counts and the per-domain bars — they stay on the detail page. A latest
 * test with no score yet shows its name, date and the report's own sentence for its state.
 * The score lines sit behind `DisclosedScore`, the report's gate: no disclosure, no score.
 */
import { Link } from "wouter";
import type {
  GuardianExamList,
  GuardianExamReport,
} from "@lyceon/shared/exam-guardian-report-schema";
import { EXAM_SECTION_LABEL } from "@lyceon/shared/exam-report-schema";
import { levelTone } from "@/components/mastery/LevelPill";
import { DisclosedScore } from "@/features/exam/components/DisclosedScore";
import {
  GUARDIAN_DELAYED_COPY,
  GUARDIAN_SCORING_COPY,
  guardianWithheldCopy,
} from "@/features/exam/pages/GuardianExamResultsPage";

type ExamListItem = GuardianExamList["tests"][number];

type ScoreChange =
  | { kind: "first" }
  | { kind: "unknown" }
  | { kind: "delta"; delta: number };

/** The latest item's total minus the previous completed item's, both from the list. */
export function changeSinceLast(
  tests: readonly ExamListItem[],
  latest: ExamListItem,
): ScoreChange {
  if (latest.completed_at === null) return { kind: "unknown" };
  const latestAt = Date.parse(latest.completed_at);
  let previous: ExamListItem | null = null;
  for (const t of tests) {
    if (t.session_id === latest.session_id || t.completed_at === null) continue;
    const at = Date.parse(t.completed_at);
    if (at >= latestAt) continue;
    if (previous === null || at > Date.parse(previous.completed_at ?? "")) {
      previous = t;
    }
  }
  if (previous === null) return { kind: "first" };
  if (previous.total_scaled === null || latest.total_scaled === null) {
    return { kind: "unknown" };
  }
  return { kind: "delta", delta: latest.total_scaled - previous.total_scaled };
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
  if (change.kind === "unknown") return null;
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
  const { delta } = change;
  const direction = delta < 0 ? "down" : delta > 0 ? "up" : "none";
  const tone =
    direction === "down"
      ? pillTone(levelTone("L1"))
      : direction === "up"
        ? pillTone(levelTone("L3"))
        : pillTone(levelTone("unmeasured"));
  const text =
    direction === "none"
      ? "No change since last test"
      : `${direction === "down" ? "▼" : "▲"} ${Math.abs(delta)} since last test`;
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

function SectionTile({
  section,
  scaled,
}: {
  section: "RW" | "M";
  scaled: number;
}): JSX.Element {
  return (
    <div
      className="rounded-[14px] bg-card px-4 py-3.5"
      data-testid={`latest-test-section-${section}`}
    >
      <div className="text-base text-muted-foreground">
        {EXAM_SECTION_LABEL[section]}
      </div>
      <div className="text-[26px] font-bold">{scaled}</div>
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

export function GuardianLatestTestCard({
  report,
  completedAt,
  change,
  studentName,
  href,
}: {
  report: GuardianExamReport;
  completedAt: string;
  change: ScoreChange;
  studentName: string;
  href: string;
}): JSX.Element {
  const meta = `${report.test_form_name} · ${monthDay(completedAt)}`;
  const link = (
    <Link
      href={href}
      className="whitespace-nowrap text-base font-semibold underline"
    >
      See full report →
    </Link>
  );
  if (report.report_state !== "scored") {
    const line =
      report.report_state === "scoring_pending"
        ? GUARDIAN_SCORING_COPY
        : report.report_state === "failed_requires_review"
          ? GUARDIAN_DELAYED_COPY
          : guardianWithheldCopy(studentName);
    return (
      <LatestTestShell meta={meta}>
        <p
          className="m-0 text-base leading-relaxed"
          role="status"
          data-testid="latest-test-status"
        >
          {line}
        </p>
        <div className="flex w-full justify-center sm:justify-end">{link}</div>
      </LatestTestShell>
    );
  }
  return (
    <LatestTestShell meta={meta}>
      <DisclosedScore
        disclosure={report.disclosure}
        withheldCopy={guardianWithheldCopy(studentName)}
      >
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
      <div className="flex w-full flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <span
          className="text-base text-muted-foreground"
          data-testid="latest-test-disclosure"
        >
          {report.disclosure.summary}
        </span>
        {link}
      </div>
    </LatestTestShell>
  );
}
