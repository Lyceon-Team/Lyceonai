/**
 * The end-of-session summary for practice and review.
 *
 * @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13) P0 item 3: "Practice session
 *        summary screen after the last question: score, streak kept, items sent to review, mastery
 *        change if any; actions 'Review misses' and 'Another 5'. Same pattern for review
 *        sessions."; Coding Standards §7.2 (schema first, types inferred), §10 (mastery from
 *        observed events only; no predicted score or confidence), §5 (anti-leak); Doc 05 Parent
 *        RULE 1/RULE 3 (levels are named by `mastery_levels`; unmeasured is not level 0)]
 *        | @implemented [2026-10-13]
 *
 * plain English: `GET /api/practice/sessions/:id/summary` and `GET /api/review/sessions/:id/summary`
 * answer `{ data: SessionSummary }` for a COMPLETED session the student owns. Every number is read
 * from what the server recorded for that session:
 *   - `answered`, `correct`, `skipped`: the session's resolved items (a skip is not an answer).
 *   - `sent_to_review`: queue entries whose source is this session (`review_schedule` rows with
 *     this engine and session id), i.e. the misses and skips the database queued.
 *   - `streak`: the one daily streak (`student_streak`), or null if it could not be read.
 *   - `mastery`: `{ access: "granted", changes }` lists, for each skill this session's answers
 *     moved to a different level, the level before the session's first event and after its last
 *     one, read from the mastery engine's own audit rows (`mastery_event_audit_log`, keyed by the
 *     session's item ids); empty when no level changed. `{ access: "locked" }` when the student's
 *     plan has no mastery detail (the `mastery_detail` feature the Mastery page needs, decided by
 *     the server's `canAccessFeature`): the summary then shows the locked line and no level at all
 *     (owner ruling, Karl, 2026-10-15, on #1233: "Track how this moves your mastery — included
 *     with paid plans", linking to the plans page).
 *   - `again`: what "Another 5" starts: practice's criteria; review's pool (queue, a past session,
 *     or the chosen filters), as the session was created.
 *
 * Anti-leak: no question content, no answer, no explanation, no item ids: counts and labels only.
 * No score is computed here and nothing is estimated: a level change is shown only when the
 * mastery engine recorded one.
 */
import { z } from "zod";
import { streakSchema } from "./home-qotd-schema.js";
import {
  masteryLevelKeySchema,
  masteryLevelSchema,
  masterySectionSchema,
} from "./mastery-levels.js";
import { reviewSessionSourceSchema } from "./review-schema.js";
import { sessionCriteriaSchema } from "./session-criteria.js";

/** A level as the student sees it: its key, number (null = unmeasured) and server name. */
export const sessionSummaryLevelSchema = z
  .object({
    levelKey: masteryLevelKeySchema,
    level: masteryLevelSchema,
    displayName: z.string().min(1),
  })
  .strict()
  .refine((v) => (v.levelKey === "unmeasured") === (v.level === null), {
    message: "levelKey 'unmeasured' must carry level null, and only it",
  });

/** One skill whose level this session's recorded answers changed. */
export const sessionMasteryChangeSchema = z
  .object({
    section: masterySectionSchema,
    domain: z.string().min(1),
    skill: z.string().min(1),
    before: sessionSummaryLevelSchema,
    after: sessionSummaryLevelSchema,
  })
  .strict();
export type SessionMasteryChange = z.infer<typeof sessionMasteryChangeSchema>;

/** The summary's mastery part: the recorded changes, or locked (no `mastery_detail`). */
export const sessionSummaryMasterySchema = z.discriminatedUnion("access", [
  z
    .object({
      access: z.literal("granted"),
      changes: z.array(sessionMasteryChangeSchema),
    })
    .strict(),
  z.object({ access: z.literal("locked") }).strict(),
]);
export type SessionSummaryMastery = z.infer<typeof sessionSummaryMasterySchema>;

const countsShape = {
  sessionId: z.string().uuid(),
  state: z.literal("completed"),
  /** Items answered (not skipped). */
  answered: z.number().int().min(0),
  /** Of those, answered correctly. */
  correct: z.number().int().min(0),
  skipped: z.number().int().min(0),
  /** Queue entries this session created (misses and skips). */
  sent_to_review: z.number().int().min(0),
  /** The daily streak now; null when it could not be read (unknown, never zero). */
  streak: streakSchema.nullable(),
  /** Level changes the mastery engine recorded, or locked when the plan has no mastery detail. */
  mastery: sessionSummaryMasterySchema,
};

/** Review's three pools, as `POST /api/review/sessions` takes them. */
export const sessionSummaryReviewAgainSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("queue") }).strict(),
  z
    .object({
      mode: z.literal("session"),
      filters: reviewSessionSourceSchema.strict(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("filter"),
      filters: z
        .object({
          sections: z.array(z.string()),
          domains: z.array(z.string()),
          skills: z.array(z.string()),
          difficulties: z.array(z.string()),
        })
        .strict(),
    })
    .strict(),
]);
export type SessionSummaryReviewAgain = z.infer<
  typeof sessionSummaryReviewAgainSchema
>;

export const sessionSummarySchema = z.discriminatedUnion("engine", [
  z
    .object({
      engine: z.literal("practice"),
      ...countsShape,
      again: z.object({ criteria: sessionCriteriaSchema }).strict(),
    })
    .strict(),
  z
    .object({
      engine: z.literal("review"),
      ...countsShape,
      again: sessionSummaryReviewAgainSchema,
    })
    .strict(),
]);
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

/** How many questions "Another 5" asks for. */
export const ANOTHER_SESSION_SIZE = 5;
