/**
 * The Score breakdown tab: per-domain correct-of-total for each scored section.
 *
 * @spec [Doc-04C §8.1/§9.1 as amended by SCL-180; E7b owner ruling (the tab strip exists
 *        so the breakdown fills it); G1 brief ("the same eight domains and correct-of-total
 *        counts the student sees")] | @implemented [2026-09-27]
 *
 * plain English: one list per section, each row "Domain — N of M correct" with a bar of the
 * same fraction. It draws exactly the rows it is given; the server sends rows only for
 * scored sections, so a section with no score has no breakdown here either. Shared by the
 * student report and the guardian's view (R11: one component, read-only for the guardian).
 *
 * G3-02 (R4, SCL-189): a guardian row carries `bar_pct` and no counts, so it draws the same
 * bar with no "N of M correct" beside it. The row shape decides, not a prop: a component
 * handed counts shows them, and one handed a bar has nothing else to show.
 */
import type { ExamDomainBreakdownRow } from "@lyceon/shared/exam-report-schema";
import { EXAM_SECTION_LABEL } from "@lyceon/shared/exam-report-schema";
import type { GuardianDomainBarRow } from "@lyceon/shared/exam-guardian-report-schema";

export type DomainBreakdownRow = ExamDomainBreakdownRow | GuardianDomainBarRow;

function barPercent(r: DomainBreakdownRow): number {
  return "bar_pct" in r ? r.bar_pct : (r.correct / r.total) * 100;
}

const SECTION_ORDER = ["RW", "M"] as const;

export function DomainBreakdown({
  rows,
}: {
  rows: ReadonlyArray<DomainBreakdownRow>;
}) {
  return (
    <div className="flex flex-col gap-5" data-testid="exam-domain-breakdown">
      {SECTION_ORDER.map((section) => {
        const own = rows.filter((r) => r.section === section);
        if (own.length === 0) return null;
        return (
          <section
            key={section}
            className="flex flex-col gap-3 rounded-xl border border-[var(--exam-line)] bg-[var(--exam-surface)] p-5"
          >
            <h3 className="m-0 text-sm font-semibold text-[var(--exam-muted)]">
              {EXAM_SECTION_LABEL[section]}
            </h3>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {own.map((r) => (
                <li
                  key={r.domain}
                  className="flex flex-col gap-1.5"
                  data-testid="exam-domain-row"
                >
                  <div className="flex items-baseline justify-between gap-3 text-[15px]">
                    <span className="font-medium">{r.domain}</span>
                    {"correct" in r && (
                      <span className="shrink-0 tabular-nums text-[var(--exam-muted)]">
                        {r.correct} of {r.total} correct
                      </span>
                    )}
                  </div>
                  <div
                    aria-hidden="true"
                    className="h-2 overflow-hidden rounded-full bg-[#EAE7E0]"
                  >
                    <div
                      className="h-full rounded-full bg-[var(--exam-accent)]"
                      style={{ width: `${barPercent(r)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
