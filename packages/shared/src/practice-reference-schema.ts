/**
 * Practice REFERENCE route response contract — `GET /api/practice/topics` and
 * `GET /api/practice/reference/questions`.
 *
 * @spec [Doc-02B_V4 §14; Coding Standards §5.2, §7.2; owner ruling UI-07 2026-09-29] | @implemented [2026-09-29]
 *
 * plain English: the two bootstrap/filtering routes a student's Practice and Topic
 * Explorer pages read. Both schemas are `.strict()` at every level, so a response that
 * carries a question-bank count (`count`, `total`, a per-domain or per-skill tally) — or
 * any other field this file does not name — fails to parse.
 * expected outcome: owner ruling UI-07, "students never see question-bank counts", is a
 * property of the wire shape rather than of whichever page happens to render it. The
 * route tests parse the REAL handler output against these schemas.
 * trade-offs: adding a field to either route requires adding it here in the same change.
 * That is the intended cost — an unannounced field on a student response is exactly the
 * leak this guards. edge cases: `correct_answer` and `explanation` are `z.null()`, not
 * nullable-optional, so the anti-leak invariant is part of the shape (Coding Standards
 * §5.2); `correct_variants` is absent and therefore rejected by `.strict()`.
 */

import { z } from "zod";

/** Canonical section codes — the only values `questions.section` stores. */
export const practiceSectionCodeSchema = z.enum(["M", "RW"]);

/** One domain of the practice taxonomy: its name and the skill codes published under it. */
export const practiceTopicDomainSchema = z
  .object({
    domain: z.string(),
    skills: z.array(z.string()),
  })
  .strict();

/** `GET /api/practice/topics` — practice-topics-routes.ts `getPracticeTopics`. */
export const practiceTopicsResponseSchema = z
  .object({
    sections: z.array(
      z
        .object({
          section: practiceSectionCodeSchema,
          label: z.string(),
          domains: z.array(practiceTopicDomainSchema),
        })
        .strict(),
    ),
  })
  .strict();

/** A multiple-choice option as the reference route serves it. */
export const practiceReferenceOptionSchema = z
  .object({
    key: z.string(),
    text: z.string(),
  })
  .strict();

/**
 * One question preview — `projectStudentSafeQuestion()` (shared/question-bank-contract.ts)
 * plus the four camelCase aliases the route adds. Pre-submit: no answer, no explanation.
 */
export const practiceReferenceQuestionSchema = z
  .object({
    id: z.string(),
    canonical_id: z.string().nullable(),
    section_code: practiceSectionCodeSchema.nullable(),
    test_code: z.string().nullable(),
    question_type: z.enum(["multiple_choice", "grid_in"]),
    item_type: z.enum(["mcq", "grid_in"]),
    inputMode: z.enum(["choice", "numeric_entry"]),
    stem: z.string(),
    passage: z.string().nullable(),
    options: z.array(practiceReferenceOptionSchema),
    difficulty: z.union([z.string(), z.number(), z.null()]),
    domain: z.string().nullable(),
    skill: z.string().nullable(),
    subskill: z.string().nullable(),
    skill_code: z.string().nullable(),
    tags: z.array(z.string()).nullable(),
    correct_answer: z.null(),
    explanation: z.null(),
    canonicalId: z.string().nullable(),
    sectionCode: practiceSectionCodeSchema.nullable(),
    questionType: z.literal("multiple_choice"),
    type: z.literal("mc"),
  })
  .strict();

/**
 * `GET /api/practice/reference/questions` — practice-topics-routes.ts `getPracticeQuestions`.
 * `filters` echoes the request; `filters.limit` is the requested page size, not a bank count.
 */
export const practiceReferenceQuestionsResponseSchema = z
  .object({
    questions: z.array(practiceReferenceQuestionSchema),
    filters: z
      .object({
        section: z.string().nullable(),
        domain: z.string().nullable(),
        skill: z.string().nullable(),
        limit: z.number().int(),
      })
      .strict(),
  })
  .strict();

export type PracticeTopicsResponse = z.infer<
  typeof practiceTopicsResponseSchema
>;
export type PracticeReferenceQuestion = z.infer<
  typeof practiceReferenceQuestionSchema
>;
export type PracticeReferenceQuestionsResponse = z.infer<
  typeof practiceReferenceQuestionsResponseSchema
>;
