/**
 * @spec [Doc 01 V8 §35 guardian-student linkage, §38.1 aggregate-only access;
 *   Doc 05B §10.3 path-layer authorization (404-not-403); owner rulings 2026-08-26
 *   R3/R6 and 2026-08-27 OQ1] | @implemented [2026-08-27]
 *
 * plain English: the vocabulary shared by the database gate, the resolver
 * middleware, and every route that reads a student's data. Zod first; the types
 * are inferred, never declared alongside (Coding Standards §7.2).
 *
 * WHY A DECISION AND NOT A BOOLEAN. Guardian visibility has two terms — an active
 * link AND an active student entitlement — and the caller must answer each
 * differently. An unrelated caller gets 404, because a 403 confirms the student
 * exists (Doc 05B §10.3). A caller who IS linked, to a student whose subscription
 * lapsed, gets 402: that answer tells them nothing they do not already know, and
 * it is the paywall path. A boolean collapses the two, and the distinction then
 * gets reinvented in TypeScript — a second derivation, which is the defect class
 * this rebuild exists to remove.
 */
import { z } from "zod";

/**
 * What `public.guardian_view_decision(guardian, student)` may return.
 *
 * This list mirrors the SQL CASE arms exactly. The SQL is the derivation; this is
 * the wire vocabulary for it. If a future arm is added there, parsing here fails
 * closed rather than passing an unrecognised string to a caller that will treat
 * anything non-'allow' as a denial — which is the safe direction, but silently.
 */
export const GUARDIAN_VIEW_DECISIONS = [
  "allow",
  "not_linked",
  "student_unentitled",
] as const;

export const guardianViewDecisionSchema = z.enum(GUARDIAN_VIEW_DECISIONS);
export type GuardianViewDecision = z.infer<typeof guardianViewDecisionSchema>;

/**
 * How the principal reached the subject. Present for the audit record, NOT for
 * behaviour: no handler below the resolver branches on it, and the chokepoint
 * gate enforces that no handler can even see the caller's role.
 */
export const SUBJECT_VIA = ["self", "guardian"] as const;
export const subjectViaSchema = z.enum(SUBJECT_VIA);
export type SubjectVia = z.infer<typeof subjectViaSchema>;

/**
 * The ONLY thing a subject-scoped handler reads to know whose data it is serving.
 */
export const subjectSchema = z.object({
  studentId: z.string().uuid(),
  via: subjectViaSchema,
});
export type Subject = z.infer<typeof subjectSchema>;

/** Path parameter shape for every `/api/students/:studentId/...` route. */
export const studentIdParamSchema = z.object({
  studentId: z.string().uuid(),
});
