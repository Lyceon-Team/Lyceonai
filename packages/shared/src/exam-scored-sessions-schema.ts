/**
 * Full-length exam — the student's scored sessions (score history), as it goes on the wire.
 *
 * @spec [Doc-04C_V1.0 §16.3 (multi-session listing, "a projection over the same canonical
 *        data"; deferred there to V1.1, brought into V1.0 by SCL-207, owner ruling (Karl)
 *        2026-10-03, register OQ-40), §8.1/§8.2 (field meanings), §8.3 (forbidden
 *        fields), §15.1 (every payload carrying a scaled score carries the three-field
 *        disclosure block), §16.8 (envelope)]
 *       [Owner ruling (Karl) 2026-10-02, student-ui register §9 OQ-30: "approved. A read of
 *        the student's completed full-length results (date, total, sections)."; OQ-31: the
 *        score is the real exam result from score_runs; Step 2 ruling 7 / UI-19: no domain
 *        correct or total in a student payload]
 * @implemented [2026-10-03]
 *
 * plain English: `GET /api/tests/sessions?state=scored` answers `{ sessions: Row[] }`, one row
 * per scored session of the caller's, newest first. A row is exactly: `session_id`,
 * `test_form_name`, `completed_at`, `total_scaled`, `rw_scaled`, `math_scaled` and
 * `disclosure`. Every field is DERIVED from the scored report schema
 * (`examReportScoredSchema`), so the history row and the report it links to cannot disagree
 * on a range or a type. Both objects are `.strict()`: an answer, explanation, item, domain
 * count, module path or any other key fails the parse instead of shipping.
 *
 * trade-offs:
 *  - `disclosure` is the full §15.1 block (`disclosure_version`, `summary`, `full_text_url`),
 *    not `summary` alone as the OQ-30 brief listed it: §15.1 says every payload containing a
 *    scaled score MUST carry all three, and the spec outranks a brief.
 *  - `state` accepts only `scored` today (400 otherwise). §16.3 names no other listing.
 *  - No cursor: §16.3 gives no pagination rule. The list is capped at
 *    `EXAM_SCORED_SESSIONS_LIMIT` newest rows; a student reaching it is logged server-side.
 */
import { z } from "zod";
import {
  examDisclosureSchema,
  examReportScoredSchema,
} from "./exam-report-schema";

/** The cap on one response (no cursor: Doc 04C §16.3 specifies none). SQL refuses > 100. */
export const EXAM_SCORED_SESSIONS_LIMIT = 50;

export const examScoredSessionsQuerySchema = z
  .object({ state: z.literal("scored") })
  .strict();
export type ExamScoredSessionsQuery = z.infer<
  typeof examScoredSessionsQuerySchema
>;

const scored = examReportScoredSchema.shape;

export const examScoredSessionRowSchema = z
  .object({
    session_id: scored.session_id,
    test_form_name: scored.test_form_name,
    completed_at: scored.completed_at,
    total_scaled: scored.score.shape.total_scaled,
    rw_scaled: scored.score.shape.rw_scaled,
    math_scaled: scored.score.shape.math_scaled,
    disclosure: examDisclosureSchema,
  })
  .strict();
export type ExamScoredSessionRow = z.infer<typeof examScoredSessionRowSchema>;

export const examScoredSessionsPayloadSchema = z
  .object({
    sessions: z
      .array(examScoredSessionRowSchema)
      .max(EXAM_SCORED_SESSIONS_LIMIT),
  })
  .strict();
export type ExamScoredSessionsPayload = z.infer<
  typeof examScoredSessionsPayloadSchema
>;
