/**
 * The student's Score breakdown tab: seven segments per domain, like the official SAT
 * score report.
 *
 * @spec [Doc-04C §8.1/§9.1; SCL-180 (amended 2026-09-29), owner ruling 7: "Seven
 *        segmented bars per domain … No 'N of M correct' anywhere in the student UI"]
 *   | @implemented [2026-09-29]
 *
 * plain English: one list per section with a row per domain — the domain name and a bar of
 * seven segments, `segments_filled` of them filled. The accessible name is "N of 7
 * segments filled"; no question count is drawn or announced, because the payload carries
 * none. Domains the server omitted are named in a short note with the reason in words.
 * Guardians do not use this component: their view keeps correct-of-total
 * (`DomainBreakdown`, SCL-180).
 */
import type {
  DomainOmissionReason,
  ExamDomainSegmentRow,
  ExamOmittedDomain,
} from "@lyceon/shared/exam-domain-segments";
import { DOMAIN_SEGMENT_COUNT } from "@lyceon/shared/exam-domain-segments";
import { EXAM_SECTION_LABEL } from "@lyceon/shared/exam-report-schema";

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
    return `${EXAM_SECTION_LABEL[section]} wasn't completed, so its domains aren't shown.`;
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
            className="m-0 text-[13px] text-[var(--exam-muted)]"
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
    <div className="flex flex-col gap-5" data-testid="exam-domain-breakdown">
      {SECTION_ORDER.map((section) => {
        const own = segments.filter((r) => r.section === section);
        const skipped = omitted.filter((o) => o.section === section);
        if (own.length === 0 && skipped.length === 0) return null;
        return (
          <section
            key={section}
            className="flex flex-col gap-3 rounded-xl border border-[var(--exam-line)] bg-[var(--exam-surface)] p-5"
          >
            <h3 className="m-0 text-sm font-semibold text-[var(--exam-muted)]">
              {EXAM_SECTION_LABEL[section]}
            </h3>
            {own.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {own.map((r) => (
                  <li
                    key={r.domain}
                    className="flex flex-col gap-1.5"
                    data-testid="exam-domain-row"
                  >
                    <span className="text-[15px] font-medium">{r.domain}</span>
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
                          data-filled={i < r.segments_filled ? "true" : "false"}
                          className={`h-2.5 flex-1 rounded-sm ${
                            i < r.segments_filled
                              ? "bg-[var(--exam-accent)]"
                              : "bg-[var(--exam-line)]"
                          }`}
                        />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <OmittedNotes section={section} omitted={skipped} />
          </section>
        );
      })}
    </div>
  );
}
