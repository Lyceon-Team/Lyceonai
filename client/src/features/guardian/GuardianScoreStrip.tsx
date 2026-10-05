/**
 * The guardian Dashboard's score strip (G5-01).
 *
 * @spec [Guardian_Closure_Plan G5-01; ruling R13 (Karl, 2026-10-02: the guardian Dashboard tab
 *       is guardian-only and follows the design, superseding R11 for this tab); the canvas
 *       boards "Wave 5 — BUILD TARGET" desktop 1440 / phone 390; R12 (16px floor)]
 *       | @implemented [2026-10-02]
 *
 * plain English: four tiles from ONE ready calendar payload, the same read the Calendar tab
 * makes. Desktop (≥640px): the projected tile — navy, two of the grid's five parts (2fr to
 * the others' 1fr each) — then target, test date and streak. Phone: the projected tile full
 * width, then three compact tiles, everything centred.
 *   - Projected: the composite band from `projectedRange` (Doc 05C's two section rows summed,
 *     nothing else) and each section's own low–high beneath it, read straight off the rows.
 *   - Target: the student's target, "Set by <student>".
 *   - Test date: the date and how many days away it is.
 *   - Streak: the current streak, and "Longest: N" from `streak.longest`.
 * Every number can be absent, and absence never renders as a zero: a missing band, target or
 * date shows "—" with the calendar's own guardian absence copy (`ABSENT_COPY.guardian`), and a
 * `null` streak (the student's zone was unreadable, SCL-193) shows "—".
 *
 * Colours are the brand tokens (`primary` navy, `card`, `muted-foreground`) and the shared
 * token layer's `--cream-300` for the tile edge; there is no hex here. Sizes are the boards'.
 */
import type { GuardianCalendarReadyResponse } from "@lyceon/shared/calendar";
import { ABSENT_COPY } from "@/features/calendar/components/Chrome";
import { daysBetween } from "@/features/calendar/lib/dates";
import { projectedRange } from "@/features/calendar/lib/projection";

const DASH = "—";
const SECTION_LABEL = {
  RW: { long: "Reading & Writing", short: "R&W" },
  M: { long: "Math", short: "Math" },
} as const;

function count(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** "2026-12-05" → "Dec 5", read as a calendar date (no zone shift). */
function shortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", timeZone: "UTC" },
  );
}

type StripFacts = {
  band: string | null;
  sections: { long: string; short: string } | null;
  target: number | null;
  testDate: string | null;
  daysAway: number | null;
  streak: number | null;
  longest: number | null;
};

function factsOf(
  data: GuardianCalendarReadyResponse,
  today: string,
): StripFacts {
  const range = projectedRange(data.projection);
  // An absent `projection` (no Doc 05C rows yet) is the same answer as no band.
  const row = (section: "RW" | "M") =>
    (data.projection ?? []).find((p) => p.section === section);
  const rw = row("RW");
  const m = row("M");
  // `projectedRange` is non-null only when both rows carry a low and a high, so the
  // per-section line is drawn exactly when the band is.
  const sections =
    range === null ||
    rw === undefined ||
    rw.projectedScoreLow === null ||
    rw.projectedScoreHigh === null ||
    m === undefined ||
    m.projectedScoreLow === null ||
    m.projectedScoreHigh === null
      ? null
      : {
          long: `${SECTION_LABEL.RW.long} ${rw.projectedScoreLow}–${rw.projectedScoreHigh} · ${SECTION_LABEL.M.long} ${m.projectedScoreLow}–${m.projectedScoreHigh}`,
          short: `${SECTION_LABEL.RW.short} ${rw.projectedScoreLow}–${rw.projectedScoreHigh} · ${SECTION_LABEL.M.short} ${m.projectedScoreLow}–${m.projectedScoreHigh}`,
        };
  return {
    band: range === null ? null : `${range.low}–${range.high}`,
    sections,
    target: data.target_score,
    testDate: data.target_exam_date,
    daysAway:
      data.target_exam_date === null
        ? null
        : Math.max(0, daysBetween(today, data.target_exam_date)),
    streak: data.streak.current,
    longest: data.streak.longest,
  };
}

const TILE =
  "flex flex-col gap-1.5 rounded-[22px] border border-[color:var(--cream-300)] bg-card px-6 py-[26px]";
const LABEL = "text-base font-medium text-muted-foreground";
const VALUE = "text-4xl font-bold leading-[1.1]";
const SUB = "text-base text-muted-foreground";

function DesktopStrip({
  facts,
  studentName,
}: {
  facts: StripFacts;
  studentName: string;
}): JSX.Element {
  return (
    <div
      className="hidden grid-cols-[2fr_1fr_1fr_1fr] gap-4 sm:grid"
      data-testid="score-strip"
    >
      <div
        className="flex flex-col gap-1.5 rounded-[22px] bg-primary px-[30px] py-[26px] text-primary-foreground"
        data-testid="score-tile-projected"
      >
        <span className="text-base font-medium opacity-[0.85]">
          Projected SAT score
        </span>
        <span
          className="text-5xl font-bold leading-[1.05]"
          data-testid="score-value"
        >
          {facts.band ?? DASH}
        </span>
        <span className="text-base opacity-[0.85]">
          {facts.sections?.long ?? ABSENT_COPY.guardian.projection}
        </span>
      </div>
      <div className={TILE} data-testid="score-tile-target">
        <span className={LABEL}>Target</span>
        <span className={VALUE} data-testid="score-value">
          {facts.target ?? DASH}
        </span>
        <span className={SUB}>
          {facts.target === null
            ? ABSENT_COPY.guardian.target
            : `Set by ${studentName}`}
        </span>
      </div>
      <div className={TILE} data-testid="score-tile-test-date">
        <span className={LABEL}>SAT test date</span>
        <span className={VALUE} data-testid="score-value">
          {facts.testDate === null ? DASH : shortDate(facts.testDate)}
        </span>
        <span className={SUB}>
          {facts.daysAway === null
            ? ABSENT_COPY.guardian.testDate
            : `${count(facts.daysAway, "day")} away`}
        </span>
      </div>
      <div className={TILE} data-testid="score-tile-streak">
        <span className={LABEL}>Study streak</span>
        <span className={VALUE} data-testid="score-value">
          {facts.streak === null ? DASH : count(facts.streak, "day")}
        </span>
        {facts.longest === null ? null : (
          <span className={SUB}>Longest: {facts.longest}</span>
        )}
      </div>
    </div>
  );
}

const COMPACT =
  "rounded-2xl border border-[color:var(--cream-300)] bg-card px-1.5 py-3.5";

function PhoneStrip({ facts }: { facts: StripFacts }): JSX.Element {
  return (
    <div
      className="flex flex-col gap-4 sm:hidden"
      data-testid="score-strip-phone"
    >
      <div
        className="flex flex-col items-center gap-1.5 rounded-[20px] bg-primary px-[18px] py-[22px] text-center text-primary-foreground"
        data-testid="score-tile-projected"
      >
        <span className="text-base opacity-[0.85]">Projected SAT score</span>
        <span
          className="text-[40px] font-bold leading-[1.1]"
          data-testid="score-value"
        >
          {facts.band ?? DASH}
        </span>
        <span className="text-base opacity-[0.85]">
          {facts.sections?.short ?? ABSENT_COPY.guardian.projection}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2.5 text-center">
        <div className={COMPACT} data-testid="score-tile-target">
          <div className="text-base text-muted-foreground">Target</div>
          <div className="text-[22px] font-bold">{facts.target ?? DASH}</div>
        </div>
        <div className={COMPACT} data-testid="score-tile-test-date">
          <div className="text-base text-muted-foreground">Test</div>
          <div className="text-[22px] font-bold">
            {facts.daysAway === null ? DASH : count(facts.daysAway, "day")}
          </div>
        </div>
        <div className={COMPACT} data-testid="score-tile-streak">
          <div className="text-base text-muted-foreground">Streak</div>
          <div className="text-[22px] font-bold">
            {facts.streak === null ? DASH : count(facts.streak, "day")}
          </div>
        </div>
      </div>
    </div>
  );
}

export function GuardianScoreStrip({
  data,
  studentName,
  today,
}: {
  data: GuardianCalendarReadyResponse;
  studentName: string;
  today: string;
}): JSX.Element {
  const facts = factsOf(data, today);
  return (
    <div data-testid="dashboard-score-strip">
      <DesktopStrip facts={facts} studentName={studentName} />
      <PhoneStrip facts={facts} />
    </div>
  );
}
