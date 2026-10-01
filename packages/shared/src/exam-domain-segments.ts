/**
 * Full-length exam — the student's per-domain breakdown as seven segments.
 *
 * @spec [Doc-04C_V1.0 §8.1 (scored), §9.1 (partial_scored); SCL-180 (amended 2026-09-29):
 *        owner ruling 7 — "seven segmented bars per domain, like the official SAT score
 *        report"; the student report returns `segments_filled` (0-7) per domain and never
 *        returns correct or total] | @implemented [2026-09-29]
 *
 * plain English: turns the server-side per-domain counts (`exam_domain_breakdown`'s
 * `{section, domain, correct, total}`) into the ONLY per-domain figure a student sees: how
 * many of seven segments are filled. Computed at read time, pure, nothing stored.
 *
 * RULE. `segments_filled = round_half_up(correct × 7 / total)`, clamped to 0..7. Done in
 * integers so no float error can move a boundary: round_half_up(x) = floor(x + 1/2), and
 * floor(7c/t + 1/2) = floor((14c + t) / (2t)). The exhaustive test proves it against exact
 * rational comparison for every total 1..60 and every correct 0..total.
 *
 * OMISSION. A domain with nothing to divide by is not drawn; the payload says why, in
 * `omitted_domains`, with one of two machine-readable reasons (`domainOmissionReasonSchema`):
 *   - `section_not_scored`: the domain's section has no scaled score on this attempt (a
 *     partial or abandoned test). Nothing is counted beside a score that does not exist.
 *   - `no_items_served`: the section is scored, but no item in this domain was served
 *     (total = 0, or no row at all). Defensive: `exam_domain_breakdown` counts served items
 *     and published forms carry every domain, so today's SQL cannot produce it.
 *
 * trade-offs: the omitted list names canonical domains only (public taxonomy); it carries
 * no count, module, path, skill or question id. Rows are emitted in canonical domain order
 * within RW then M, so output order never depends on the SQL's ordering.
 */
import { z } from "zod";
import { examSectionSchema, type ExamSection } from "./exam-runtime-schema";
import {
  CANONICAL_DOMAINS,
  canonicalDomainSchema,
  sectionOfDomain,
  type CanonicalDomain,
} from "./calendar/scope";

/** Seven segments per domain, as on the official SAT score report (owner ruling 7). */
export const DOMAIN_SEGMENT_COUNT = 7;

export const domainOmissionReasonSchema = z.enum([
  "section_not_scored",
  "no_items_served",
]);
export type DomainOmissionReason = z.infer<typeof domainOmissionReasonSchema>;

/**
 * One drawn domain. `.strict()`: a `correct` or `total` key fails the parse, so a raw
 * count cannot ride along on a student row.
 */
export const examDomainSegmentRowSchema = z
  .object({
    section: examSectionSchema,
    domain: canonicalDomainSchema,
    segments_filled: z.number().int().min(0).max(DOMAIN_SEGMENT_COUNT),
  })
  .strict()
  .refine((r) => sectionOfDomain(r.domain) === r.section, {
    message: "domain does not belong to section",
  });
export type ExamDomainSegmentRow = z.infer<typeof examDomainSegmentRowSchema>;

export const examOmittedDomainSchema = z
  .object({
    section: examSectionSchema,
    domain: canonicalDomainSchema,
    reason: domainOmissionReasonSchema,
  })
  .strict()
  .refine((r) => sectionOfDomain(r.domain) === r.section, {
    message: "domain does not belong to section",
  });
export type ExamOmittedDomain = z.infer<typeof examOmittedDomainSchema>;

const noDuplicateDomain = (rows: ReadonlyArray<{ domain: string }>): boolean =>
  new Set(rows.map((r) => r.domain)).size === rows.length;

export const examDomainSegmentsSchema = z
  .array(examDomainSegmentRowSchema)
  .refine(noDuplicateDomain, { message: "duplicate domain row" });

export const examOmittedDomainsSchema = z
  .array(examOmittedDomainSchema)
  .refine(noDuplicateDomain, { message: "duplicate omitted domain" });

/**
 * @spec [SCL-180 (amended 2026-09-29), owner ruling 7] | @implemented [2026-09-29]
 * plain English: round_half_up(correct × 7 / total), clamped to 0..7, in integer
 * arithmetic. `total` must be a positive integer (the caller omits total = 0); a
 * non-integer or non-positive total is a programming error and throws.
 */
export function segmentsFilled(correct: number, total: number): number {
  if (!Number.isInteger(correct) || !Number.isInteger(total) || total <= 0) {
    throw new RangeError("segmentsFilled needs integer correct and total > 0");
  }
  const raw = Math.floor(
    (2 * DOMAIN_SEGMENT_COUNT * correct + total) / (2 * total),
  );
  return Math.min(DOMAIN_SEGMENT_COUNT, Math.max(0, raw));
}

/** The server-side count row, as `exam_domain_breakdown` emits it. Never sent to a student. */
export type DomainCountRow = {
  readonly section: ExamSection;
  readonly domain: CanonicalDomain;
  readonly correct: number;
  readonly total: number;
};

export type StudentDomainSegments = {
  domain_segments: ExamDomainSegmentRow[];
  omitted_domains: ExamOmittedDomain[];
};

const SECTION_ORDER: ReadonlyArray<ExamSection> = ["RW", "M"];

/**
 * @spec [Doc-04C §8.1/§9.1; SCL-180 (amended 2026-09-29), owner ruling 7]
 *   | @implemented [2026-09-29]
 * plain English: every canonical domain of both sections lands in exactly one of the two
 * lists. A domain of an unscored section is omitted as `section_not_scored`; a domain of a
 * scored section with total = 0 (or no row) is omitted as `no_items_served`; every other
 * domain becomes `{section, domain, segments_filled}`. Pure and deterministic.
 */
export function toDomainSegments(
  rows: ReadonlyArray<DomainCountRow>,
  scoredSections: ReadonlyArray<ExamSection>,
): StudentDomainSegments {
  const byDomain = new Map<CanonicalDomain, DomainCountRow>();
  for (const r of rows) byDomain.set(r.domain, r);
  const scored = new Set(scoredSections);
  const out: StudentDomainSegments = {
    domain_segments: [],
    omitted_domains: [],
  };
  for (const section of SECTION_ORDER) {
    for (const domain of CANONICAL_DOMAINS) {
      if (sectionOfDomain(domain) !== section) continue;
      if (!scored.has(section)) {
        out.omitted_domains.push({
          section,
          domain,
          reason: "section_not_scored",
        });
        continue;
      }
      const row = byDomain.get(domain);
      if (row === undefined || row.total === 0) {
        out.omitted_domains.push({
          section,
          domain,
          reason: "no_items_served",
        });
        continue;
      }
      out.domain_segments.push({
        section,
        domain,
        segments_filled: segmentsFilled(row.correct, row.total),
      });
    }
  }
  return out;
}
