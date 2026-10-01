/**
 * Full-length exam — the student's report as it goes on the wire.
 *
 * @spec [Doc-04C_V1.0 §8.1 (scored), §9.1 (partial_scored), §11.3 (one serializer per
 *        state), §11.7 (redaction), §16.1 (/report)]
 *       [SCL-180 (amended 2026-09-29): owner ruling 7 — the student sees seven segments per
 *        domain and never a correct or total count, in the UI or in the payload]
 * @implemented [2026-09-29]
 *
 * plain English: `exam-report-schema.ts` describes the server-side report — the one read
 * the report service builds, carrying the per-domain correct/total counts. Two projections
 * leave the server: the guardian's (`exam-guardian-report-schema.ts`, unchanged: it keeps
 * correct/total per SCL-180) and this one, the student's. For the four states without a
 * breakdown the student schema IS the server-side schema. For `scored` and
 * `partial_scored`, `domain_breakdown` is replaced by `domain_segments` +
 * `omitted_domains` (see `exam-domain-segments.ts`), and both objects are `.strict()`, so
 * a `domain_breakdown`, `correct` or `total` key anywhere in them fails the parse.
 *
 * trade-offs: the scored/partial student schemas are derived with `.omit().extend()` from
 * the server-side ones, so a new server-side field reaches the student too — deliberate: the
 * student report is the full report (04C §2.6), and the per-field reveal rules for it live
 * in `exam-report-schema.ts`. Only the breakdown is re-shaped here.
 */
import { z } from "zod";
import {
  examReportFailedSchema,
  examReportNotCompletedSchema,
  examReportPartialSchema,
  examReportScoredSchema,
  examReportScoringPendingSchema,
  examReportUnavailableSchema,
  type ExamReportPayload,
} from "./exam-report-schema";
import {
  examDomainSegmentsSchema,
  examOmittedDomainsSchema,
  toDomainSegments,
} from "./exam-domain-segments";

const studentBreakdown = {
  domain_segments: examDomainSegmentsSchema,
  omitted_domains: examOmittedDomainsSchema,
};

export const examStudentReportScoredSchema = examReportScoredSchema
  .omit({ domain_breakdown: true })
  .extend(studentBreakdown)
  .strict();

export const examStudentReportPartialSchema = examReportPartialSchema
  .omit({ domain_breakdown: true })
  .extend(studentBreakdown)
  .strict();

export const examStudentReportPayloadSchema = z.discriminatedUnion(
  "report_state",
  [
    examReportNotCompletedSchema,
    examReportScoringPendingSchema,
    examStudentReportScoredSchema,
    examStudentReportPartialSchema,
    examReportFailedSchema,
    examReportUnavailableSchema,
  ],
);
export type ExamStudentReportPayload = z.infer<
  typeof examStudentReportPayloadSchema
>;

/**
 * @spec [Doc-04C §8.1/§9.1, §11.3; SCL-180 (amended 2026-09-29), owner ruling 7]
 *   | @implemented [2026-09-29]
 * plain English: the server-side report in, the student's out. Pure. `domain_breakdown`
 * is taken out by name and never spread onward; the segments are computed from it against
 * the sections that have a score (both for scored, `completed_sections` for partial). The
 * result is parsed against the strict student schema, so a count that slipped through
 * throws here instead of reaching the student.
 */
export function toStudentExamReport(
  report: ExamReportPayload,
): ExamStudentReportPayload {
  switch (report.report_state) {
    case "scored": {
      const { domain_breakdown, ...rest } = report;
      return examStudentReportScoredSchema.parse({
        ...rest,
        ...toDomainSegments(domain_breakdown, ["RW", "M"]),
      });
    }
    case "partial_scored": {
      const { domain_breakdown, ...rest } = report;
      return examStudentReportPartialSchema.parse({
        ...rest,
        ...toDomainSegments(domain_breakdown, report.completed_sections),
      });
    }
    case "not_completed":
    case "scoring_pending":
    case "failed_requires_review":
    case "unavailable":
      return report;
  }
}
