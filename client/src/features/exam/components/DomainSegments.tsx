/**
 * The student report's "Knowledge and skills": seven segments per domain, like the official SAT
 * score report.
 *
 * @spec [Doc-04C §8.1/§9.1; SCL-180 (amended 2026-09-29), owner ruling 7: "Seven
 *        segmented bars per domain … No 'N of M correct' anywhere in the student UI"; register
 *        §2 ("A domain with total = 0 … is omitted, and the report says why")]
 *       [DESIGN.md §3 "Report segments" ("Seven flat navy segments per domain from
 *        segmentsFilled. Deliberately not the mastery colors."), §4 "Exam report" (domain
 *        weight lines from College Board's published specification); prototype
 *        Report.dc.html; OQ-45 (the report uses report segments, not the mastery row); OQ-51
 *        ("Reading & Writing")]
 *   | @implemented [2026-09-29; restyled on the student tokens 2026-10-03, UI-54]
 *
 * plain English: one column per section (Reading & Writing, then Math) with a row per domain:
 * its name, College Board's weight line for it (`domain-weights.ts`, a fact about the SAT, not
 * about this student), and a bar of seven segments, `segments_filled` of them filled in the ink
 * colour (`--ink-strong`), the rest outlined. The accessible name is "N of 7 segments filled";
 * no question count is drawn or announced, because the payload carries none. Domains the server
 * omitted are named in a short note with the reason in words.
 *
 * Guardians do not use this component: their view draws a bar per domain with no counts
 * (`DomainBreakdown`, SCL-189).
 */
import type {
  DomainOmissionReason,
  ExamDomainSegmentRow,
  ExamOmittedDomain,
} from "@lyceon/shared/exam-domain-segments";
import { DOMAIN_SEGMENT_COUNT } from "@lyceon/shared/exam-domain-segments";
import { sectionDisplayLabel } from "@shared/section-display";
import { domainWeightLine } from "../lib/domain-weights";

const SECTION_ORDER = ["RW", "M"] as const;
const SEGMENT_INDEXES = Array.from(
  { length: DOMAIN_SEGMENT_COUNT },
  (_, i) => i,
);

function omissionNote(
  section: "RW" | "M",
  reason: DomainOmissionReason,
  domains: ReadonlyArray<string>,
): string {
  if (reason === "section_not_scored") {
    return `${sectionDisplayLabel(section) ?? ""} wasn't completed, so its domains aren't shown.`;
  }
  return `${domains.join(", ")} ${domains.length === 1 ? "isn't" : "aren't"} shown because this test had no questions from ${domains.length === 1 ? "it" : "them"}.`;
}

function OmittedNotes({
  section,
  omitted,
}: {
  section: "RW" | "M";
  omitted: ReadonlyArray<ExamOmittedDomain>;
}) {
  const reasons: ReadonlyArray<DomainOmissionReason> = [
    "section_not_scored",
    "no_items_served",
  ];
  return (
    <>
      {reasons.map((reason) => {
        const domains = omitted
          .filter((o) => o.section === section && o.reason === reason)
          .map((o) => o.domain);
        if (domains.length === 0) return null;
        return (
          <p
            key={reason}
            className="m-0 text-lyc-meta-lg leading-normal text-lyc-muted"
            data-testid="exam-domain-omitted"
          >
            {omissionNote(section, reason, domains)}
          </p>
        );
      })}
    </>
  );
}

export function DomainSegments({
  segments,
  omitted,
}: {
  segments: ReadonlyArray<ExamDomainSegmentRow>;
  omitted: ReadonlyArray<ExamOmittedDomain>;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-10 md:grid-cols-2"
      data-testid="exam-domain-breakdown"
    >
      {SECTION_ORDER.map((section) => {
        const own = segments.filter((r) => r.section === section);
        const skipped = omitted.filter((o) => o.section === section);
        if (own.length === 0 && skipped.length === 0) return null;
        return (
          <section key={section} className="flex flex-col gap-[22px]">
            <h3 className="m-0 border-b border-lyc-rule pb-2.5 font-lyc-serif text-[21px] font-semibold text-lyc-ink-strong">
              {sectionDisplayLabel(section)}
            </h3>
            {own.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-[22px] p-0">
                {own.map((r) => {
                  const weight = domainWeightLine(r.section, r.domain);
                  return (
                    <li
                      key={r.domain}
                      className="flex flex-col gap-2"
                      data-testid="exam-domain-row"
                    >
                      <span
                        className="text-[17px] font-semibold text-lyc-ink"
                        data-testid="exam-domain-name"
                      >
                        {r.domain}
                      </span>
                      {weight !== null ? (
                        <span
                          className="text-lyc-meta text-lyc-muted"
                          data-testid="exam-domain-weight"
                        >
                          {weight}
                        </span>
                      ) : null}
                      <div
                        role="img"
                        aria-label={`${r.domain}: ${r.segments_filled} of ${DOMAIN_SEGMENT_COUNT} segments filled`}
                        className="flex gap-1"
                        data-testid="exam-domain-segments"
                        data-filled={r.segments_filled}
                      >
                        {SEGMENT_INDEXES.map((i) => (
                          <span
                            key={i}
                            data-testid="exam-domain-segment"
                            data-filled={
                              i < r.segments_filled ? "true" : "false"
                            }
                            className={`h-3.5 flex-1 rounded-[2px] border ${
                              i < r.segments_filled
                                ? "border-lyc-ink-strong bg-lyc-ink-strong"
                                : "border-lyc-rule-strong bg-transparent"
                            }`}
                          />
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <OmittedNotes section={section} omitted={skipped} />
          </section>
        );
      })}
    </div>
  );
}
