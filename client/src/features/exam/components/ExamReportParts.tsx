/**
 * The guardian exam report's building blocks: title, fact, tabs, section card, panel, date.
 *
 * @spec [Doc-04C_V1.0 §8.1/§9.1; G1 (the Score breakdown tab), G4-05/G4-06 (the guardian page
 *        body)] | @implemented [2026-09-25; moved here 2026-10-03, UI-54]
 *
 * plain English: these lived in the student's `ExamReportPage.tsx` and were shared with
 * `GuardianExamResultsPage`. UI-54 rebuilt the student report on the student tokens (DESIGN.md
 * §4 "Exam report": a score card and "Knowledge and skills", no tabs), so the student page no
 * longer draws them; they moved here UNCHANGED for the guardian page, whose look is the guardian
 * vertical's (register §8 F-08), not this row's.
 */
import { useRef, useState } from "react";

export function formatDate(iso: string | null): string {
  if (iso === null) return "";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export function Title({ name, line }: { name: string; line: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 text-sm text-[var(--exam-muted)]">{line}</p>
      <h1 className="m-0 font-serif text-[30px] font-semibold">{name}</h1>
    </div>
  );
}

export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--exam-muted)]">
        {label}
      </dt>
      <dd className="m-0 text-[15px] font-medium">{value}</dd>
    </div>
  );
}

type ScoreTab = "sections" | "breakdown";
const TABS: ReadonlyArray<{ id: ScoreTab; label: string }> = [
  { id: "sections", label: "Section scores" },
  { id: "breakdown", label: "Score breakdown" },
];

/**
 * WAI-ARIA tabs: the selected tab is the only one in the tab order; Left/Right/Home/End
 * move selection and focus. Only the selected panel is rendered. `breakdown` is the
 * already-rendered breakdown panel: the guardian passes `DomainBreakdown` (a bar per domain,
 * no counts, SCL-189).
 */
export function ScoreTabs({
  children,
  breakdown,
}: {
  children: React.ReactNode;
  breakdown: React.ReactNode;
}) {
  const [tab, setTab] = useState<ScoreTab>("sections");
  const refs = useRef<Record<ScoreTab, HTMLButtonElement | null>>({
    sections: null,
    breakdown: null,
  });
  const select = (next: ScoreTab): void => {
    setTab(next);
    refs.current[next]?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent): void => {
    const i = TABS.findIndex((t) => t.id === tab);
    const last = TABS.length - 1;
    const to =
      e.key === "ArrowRight"
        ? i === last
          ? 0
          : i + 1
        : e.key === "ArrowLeft"
          ? i === 0
            ? last
            : i - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (to === null) return;
    e.preventDefault();
    select(TABS[to]!.id);
  };
  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Score views"
        className="flex gap-1 rounded-[10px] bg-[#EAE7E0] p-1"
        onKeyDown={onKeyDown}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`exam-tab-${t.id}`}
            aria-selected={tab === t.id}
            // Only the selected panel is rendered, so only its tab names one.
            aria-controls={tab === t.id ? `exam-tabpanel-${t.id}` : undefined}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={`min-h-[44px] flex-1 rounded-lg text-sm ${tab === t.id ? "bg-[var(--exam-surface)] font-semibold shadow-sm" : "font-medium text-[var(--exam-muted)]"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`exam-tabpanel-${tab}`}
        aria-labelledby={`exam-tab-${tab}`}
      >
        {tab === "sections" ? children : breakdown}
      </div>
    </div>
  );
}

export function SectionCard({
  label,
  scaled,
}: {
  label: string;
  scaled: number | null;
}) {
  return (
    <div
      className="flex flex-1 flex-col gap-1 rounded-xl border border-[var(--exam-line)] bg-[var(--exam-surface)] p-5"
      data-testid="exam-section-score"
    >
      <span className="text-sm font-medium text-[var(--exam-muted)]">
        {label}
      </span>
      {scaled === null ? (
        <span className="text-[15px] font-medium">Not completed</span>
      ) : (
        <>
          <span className="font-serif text-[34px] font-semibold leading-none">
            {scaled}
          </span>
          <span className="text-[12px] text-[var(--exam-muted)]">200–800</span>
        </>
      )}
    </div>
  );
}

export function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-[var(--exam-line)] bg-[var(--exam-surface)] p-7">
      <h2 className="m-0 font-serif text-[24px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}
