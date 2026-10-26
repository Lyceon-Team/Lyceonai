/**
 * @spec [CC Brief "Book Ingestion into the Knowledge Base" (Karl, 2026-10-22) §2.2 (one complete
 *       teachable idea per chunk; each chunk stands alone), §2.3 (direct instructional prose;
 *       keep worked examples concrete; strip exercises, answer keys, cross-references), §2.4
 *       (tags from the 29 taxonomy names only; drop a chunk that teaches nothing SAT-specific;
 *       content_type; surface_gate), §7 (the failure that matters: a chunk that starts mid-rule
 *       and teaches half of it), §8 (drop what cannot stand alone; report taxonomy gaps)]
 *       | @implemented [2026-10-22]
 *
 * plain English: the three prompts of the book pipeline and their response schemas, in one
 * place so they can be read and reviewed together.
 *  1. SEGMENT: one window of book text → its units, in order, each named by its first and last
 *     words, each marked with whether it finishes inside the window. The model only says where
 *     ideas begin and end; the code cuts the text (scripts/rag/book.ts).
 *  2. REWRITE: one unit (with the text around it for reference) → a self-contained instructional
 *     chunk, or a drop with its reason; skills from the enumerated taxonomy only; content type;
 *     surface gate.
 *  3. AUDIT: a second, independent call that reads the source, the surrounding text and the
 *     chunk, and checks the three ways a chunk is wrong in use while reading fine alone:
 *     incomplete (part of the rule lives outside it), unfaithful (it says something the book
 *     does not), or dependent (it leans on context it does not carry). Any failure drops it.
 * The model never sees provenance (brief §5). `BOOK_PROMPT_VERSION` is stamped on every cached
 * result; changing any prompt changes it and invalidates the cache.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CONTENT_TYPES,
  SURFACE_GATES,
  UNIT_KINDS,
  proposedUnitSchema,
} from "./book";

export const SEGMENT_SYSTEM = `You divide one window of text from an SAT preparation book into units, for Lyceon, an SAT practice platform. Each teaching unit will later become one entry in a knowledge base that a tutor retrieves from with no surrounding context, so a unit must hold ONE COMPLETE teachable idea:
- a rule together with its explanation and its examples;
- a worked example together with all of its reasoning, from the problem to the answer;
- a trap together with why it is a trap and what the right move is;
- a strategy (how to approach or pace a question type) together with how to apply it.

Never split a rule from its explanation, its exceptions or its examples: a rule that needs a long explanation stays in one unit. Two unrelated rules go in separate units even when each is short. A heading usually starts a new unit, but a sub-heading inside one rule's explanation (for example "Exceptions" or "Example") does not.

Units must cover the window in order without overlapping. Classify every stretch of text, including what is not teaching:
- kind: rule, worked_example, strategy (teaching), or exercises (practice questions or drills for the reader), answer_key (answers or solutions to exercises), front_or_back_matter (title pages, contents, introductions about the book itself, indexes, about-the-author), other (anything else that teaches nothing).
- start_quote: the first 8 to 15 words of the unit, copied exactly from the window.
- end_quote: the last 8 to 15 words of the unit, copied exactly from the window.
- ends_in_window: false only for the LAST unit, and only if the idea it holds continues past the end of the window (the window may stop mid-idea). Every other unit ends inside the window.
- chapter_number: the number of the chapter the unit is in, as printed in the book (null if the book does not number its chapters); chapter_title and section_title: the headings the unit sits under, as printed (use the nearest heading for section_title; repeat the chapter title if there is no section heading).

The text marks where each page of the book begins with "[page n]"; never quote those markers.

The text may be a markdown transcription of the book. Then "## " starts a numbered rule, "### " a lettered subsection of it, and "#### " a minor heading; a paragraph that opens with a bold label such as "**Correct:**" or "**Incorrect:**" is a labelled example, and "**...**" inside it marks the grammar point. Use that structure: a lettered subsection with its explanation and its labelled examples is usually one unit, and labelled examples always stay in the same unit as the rule they illustrate, never in a unit of their own. In quotes you may leave out the markdown symbols (#, *, <u>); copy the words exactly.`;

export function segmentResponseSchema(): Record<string, unknown> {
  return {
    type: "OBJECT",
    properties: {
      units: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            chapter_number: { type: "INTEGER", nullable: true },
            chapter_title: { type: "STRING" },
            section_title: { type: "STRING" },
            kind: { type: "STRING", enum: [...UNIT_KINDS] },
            start_quote: { type: "STRING" },
            end_quote: { type: "STRING" },
            ends_in_window: { type: "BOOLEAN" },
          },
          required: [
            "chapter_number",
            "chapter_title",
            "section_title",
            "kind",
            "start_quote",
            "end_quote",
            "ends_in_window",
          ],
        },
      },
    },
    required: ["units"],
  };
}
export const segmentSchema = z.object({ units: z.array(proposedUnitSchema) });

export const DROP_REASONS = [
  "not_sat_specific",
  "cannot_stand_alone",
  "exercise_or_answer_key",
] as const;

export const REWRITE_SYSTEM = `You turn one unit of an SAT preparation book into one entry of Lyceon's tutoring knowledge base. A tutor retrieves the entry, with nothing around it, to help a student who is stuck on an SAT question. Rewrite the unit into direct instructional prose addressed to that student.

Write:
- The rule or method, stated completely and precisely, with every condition and exception the unit gives.
- The trap: the common wrong answer and why students pick it, but ONLY where the unit itself says so. Never supply a reason, a trap or an explanation of your own.
- Worked examples kept concrete: keep the sentences, numbers and steps exactly as the unit gives them, so the student sees the method applied. Never make up an example sentence or number.
- 150 to 400 words is the usual length; a rule that genuinely needs more keeps it, and a short rule may be shorter. Never pad.
- Plain text paragraphs only: no markdown headings, bold, italics or bullet symbols.

Never write:
- Anything addressed to a reader working through a book: "as we saw above", "in this chapter", "the next section", "try the exercises", "turn to page", "the author".
- A reference with no antecedent ("this rule", "the example above"): name the rule or include the example.
- Anything the unit does not support. You may use the surrounding text ONLY to understand what a reference in the unit points to; never import a rule, example or claim that is not in the unit itself. Do not add rules, exceptions, examples or numbers of your own.
- Exercises, answer choices for practice questions, or answer keys.

Drop the unit instead of rewriting it (keep = false) when:
- not_sat_specific: it teaches nothing a student would use on the SAT (book introductions, study motivation, admissions, general advice);
- cannot_stand_alone: making it self-contained would mean inventing content the unit does not have, or it is a fragment of an idea whose other part is not in the unit;
- exercise_or_answer_key: it is practice material or answers rather than teaching.

Tag the entry:
- skill_codes: the SAT skills it teaches, chosen only from the list in the response schema, most central first. Tag every skill it really teaches and no other. A rule about punctuation between independent clauses, for example, is Boundaries; agreement, tense, pronoun and modifier rules are Form, Structure, and Sense.
- content_type: textbook for rules and explanation, worked_example for a worked problem, strategy for how to approach or pace a question type.
- surface_gate: pre_and_post when the entry teaches a rule or method a student may read before answering. post_only when the entry gives away how to answer a specific SAT question type without learning the underlying rule (an answer-choice elimination shortcut, a pattern for spotting the right option, a "pick the shortest answer" heuristic), so reading it before submitting would let the student answer without learning. When in doubt between the two, choose post_only.
- surface_gate_reason: one short sentence, at most 20 words.
- taxonomy_gap: if the unit teaches something worthwhile for the SAT that none of the listed skills covers, name it in a few words; otherwise null. Do not stretch a skill to cover it.`;

export function rewriteResponseSchema(
  skills: readonly string[],
): Record<string, unknown> {
  return {
    type: "OBJECT",
    properties: {
      keep: { type: "BOOLEAN" },
      drop_reason: { type: "STRING", enum: [...DROP_REASONS], nullable: true },
      content: { type: "STRING", nullable: true },
      skill_codes: {
        type: "ARRAY",
        items: { type: "STRING", enum: [...skills] },
      },
      content_type: { type: "STRING", enum: [...CONTENT_TYPES] },
      surface_gate: { type: "STRING", enum: [...SURFACE_GATES] },
      surface_gate_reason: { type: "STRING" },
      taxonomy_gap: { type: "STRING", nullable: true },
    },
    required: [
      "keep",
      "drop_reason",
      "content",
      "skill_codes",
      "content_type",
      "surface_gate",
      "surface_gate_reason",
      "taxonomy_gap",
    ],
  };
}
export function rewriteSchemaFor(skills: readonly [string, ...string[]]) {
  return z.object({
    keep: z.boolean(),
    drop_reason: z.enum(DROP_REASONS).nullable(),
    content: z.string().nullable(),
    skill_codes: z.array(z.enum(skills)),
    content_type: z.enum(CONTENT_TYPES),
    surface_gate: z.enum(SURFACE_GATES),
    surface_gate_reason: z.string(),
    taxonomy_gap: z.string().nullable(),
  });
}

export const AUDIT_SYSTEM = `You check one entry of Lyceon's SAT tutoring knowledge base against the book passage it was written from. A tutor will show the entry to a student with nothing around it. An entry can read well on its own and still be wrong in use; find out whether this one is.

You are given the SOURCE (the passage the entry was written from), the CONTEXT BEFORE and CONTEXT AFTER (the book text around the source), and the ENTRY. Answer:
- complete: true only if the entry teaches the whole rule, method or example. False if the source or the context shows that a condition, exception, step or the conclusion of the idea is missing from the entry, for example because the idea started before the source or continues after it.
- starts_mid_idea: true if the source begins partway through an idea that started in the context before it.
- faithful: true only if every rule, claim, example and number in the entry is supported by the SOURCE itself. False if the entry adds a rule, an exception, an example or a number the source does not contain, or states a rule differently from the source. Material that appears only in the CONTEXT BEFORE or CONTEXT AFTER, and not in the SOURCE, makes the entry unfaithful even when it is correct.
- self_contained: true only if a student could understand the entry with nothing else: no reference to an example, rule, page, chapter or exercise that the entry does not itself include.
- correct: true only if the entry is correct about the SAT and standard English or mathematics. False if it states something wrong, even if the source says it.
- issues: one or two short sentences naming any problem, or an empty string.`;

export const auditResponseSchema = {
  type: "OBJECT",
  properties: {
    complete: { type: "BOOLEAN" },
    starts_mid_idea: { type: "BOOLEAN" },
    faithful: { type: "BOOLEAN" },
    self_contained: { type: "BOOLEAN" },
    correct: { type: "BOOLEAN" },
    issues: { type: "STRING" },
  },
  required: [
    "complete",
    "starts_mid_idea",
    "faithful",
    "self_contained",
    "correct",
    "issues",
  ],
} as const;
export const auditSchema = z.object({
  complete: z.boolean(),
  starts_mid_idea: z.boolean(),
  faithful: z.boolean(),
  self_contained: z.boolean(),
  correct: z.boolean(),
  issues: z.string(),
});
export type Audit = z.infer<typeof auditSchema>;

/** The audit drop reason for a failed audit, or null when every check passed. */
export function auditFailure(a: Audit): string | null {
  if (a.starts_mid_idea) return "audit_starts_mid_idea";
  if (!a.complete) return "audit_incomplete";
  if (!a.faithful) return "audit_unfaithful";
  if (!a.correct) return "audit_incorrect";
  if (!a.self_contained) return "audit_not_self_contained";
  return null;
}

export const BOOK_PROMPT_VERSION = createHash("sha256")
  .update(
    [
      SEGMENT_SYSTEM,
      JSON.stringify(segmentResponseSchema()),
      REWRITE_SYSTEM,
      JSON.stringify(rewriteResponseSchema(["x"])),
      AUDIT_SYSTEM,
      JSON.stringify(auditResponseSchema),
    ].join("\n"),
  )
  .digest("hex")
  .slice(0, 12);
