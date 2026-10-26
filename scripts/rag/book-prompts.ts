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
 *     chunk, and checks the ways a chunk is wrong in use while reading fine alone: incomplete
 *     (part of the rule lives outside it), unfaithful (it says something the book does not),
 *     dependent (it leans on context it does not carry), or ACT advice un-scoped (it tells an
 *     SAT student something the book says only of the ACT; Karl, 2026-10-23: worse than a
 *     missing chunk, because the student cannot tell). Any failure drops it.
 * The book contradicting itself: a rewrite that left both sides out, with the audit verifying
 * the contradiction, was built and reverted on Karl's ruling of 2026-10-26. On the Meltzer book
 * it failed both ways: it let a false "contradiction" (printed page 3) drop a teaching example,
 * and passed rule 6 repeating the real one. A rule the book gets wrong is dropped (the audit's
 * "incorrect"), never corrected and never kept with the error; a missing rule is recoverable,
 * a wrong one taught confidently is not.
 * An entry that contradicts itself (describes its example one way while the example shows
 * another: Meltzer chunk 6:1, "a comma before a close parenthesis" over an example with the
 * comma after it, passed the audit five times out of five) is caught by EXAMPLE CHECK, a
 * separate call: the model lists each statement that describes an example with the example,
 * quoted, and whether the example shows it; the code drops the chunk on any mismatch
 * (exampleCheckFailure). Drop-only, never repaired, the entry judged only against itself: its
 * failure mode is a lost correct rule, which is counted (Karl, 2026-10-26).
 * NOT AS AN AUDIT FIELD: a "self_consistent" yes/no in the audit was built first and removed
 * on Karl's ruling of 2026-10-26. On the real 6:1 it said consistent on 3 runs of 3 (and on
 * 0 of 96 correct-chunk audits did it flag anything): it catches nothing. Asked one question
 * among six, the model does not compare the description with the example; made to quote each
 * pair, it does (6:1 caught 3 of 3 in the prototype).
 * ONLY WHAT THE CHARACTERS SHOW: the check lists statements about where a mark sits and which
 * word or form appears, never about grammatical category (part of speech, voice, tense, clause
 * type). Its first version took every description, and on the one-run proof of 2026-10-26 it
 * dropped 2 of 32 correct chunks, both by judging the grammar itself instead of comparing the
 * statement with the example: 12:5 ("they are concerned" as the active-voice fix, "still
 * passive") and 13:1 ("profitability"/"influence", which the book labels nouns, "prepositional
 * phrases, not nouns"). 6:1 is a claim about position, which the characters settle (Karl,
 * 2026-10-26).
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

The text may be a markdown transcription of the book. Then "## " starts a numbered rule, "### " a lettered subsection of it, and "#### " a minor heading; a paragraph that opens with a bold label such as "**Correct:**" or "**Incorrect:**" is a labelled example, and "**...**" inside it marks the grammar point. Use that structure. The lettered subsections of one numbered rule ("### A. ...", "### B. ...") usually share the rule's opening explanation and continue one idea (two commas, two dashes and two parentheses are all non-essential punctuation), so a numbered rule under 400 words is ONE unit, with its opening explanation and all of its lettered subsections. A numbered rule of 400 words or more is split at EVERY one of its lettered-subsection headings, never inside a subsection: one unit per lettered subsection, and the rule's opening explanation goes in the unit of its first subsection. Both limits are checked: an answer that splits a short rule is returned to you, and a long rule is cut at its subsection headings for you. Labelled examples always stay in the same unit as the rule they illustrate, never in a unit of their own. A unit far over 400 words almost always holds more than one idea and must be split at the idea boundary; keep it whole only when it is a single rule that genuinely needs the length. In quotes you may leave out the markdown symbols (#, *, <u>); copy the words exactly.`;

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
- Advice the unit limits to the ACT, stated as general or as true of the SAT. The student is taking the SAT. ACT-scoped advice is a test-taking tip, shortcut or answer pattern that the unit ties to the ACT ("if there is an OMIT/DELETE option on the ACT", "when the ACT tests it's vs. its, the answer is almost always its", "more applicable to the ACT than the SAT"): leave it out of the entry entirely, and never restate it without the ACT, as "the test", or as "usually" or "always" true. A paragraph marked "[ACT NOTE]" mentions the ACT; it is not ACT-only. Judge each sentence by what it says: a rule of standard English (where a comma goes, which form is correct) is never ACT-scoped, even under the marker and even when the unit adds that the ACT tests it often; keep the rule and leave out the mention of the ACT. When the unit says a method works less well on the SAT, either keep that limitation in the entry or leave the method out. Never write the marker "[ACT NOTE]" into the entry.

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

You are given the SOURCE (the passage the entry was written from), the CONTEXT BEFORE and CONTEXT AFTER (the book text around the source), and the ENTRY. When the source is one lettered subsection of a longer numbered rule you are also given the RULE OPENING: the rule's opening explanation, which is part of the source (it is not context). Answer:
- complete: true only if the entry teaches the whole rule, method or example. False if the source or the context shows that a condition, exception, step or the conclusion of the idea is missing from the entry, for example because the idea started before the source or continues after it. When a RULE OPENING is given, the source is one subsection of the rule: judge completeness on that subsection; the entry need not teach the rule's other subsections, even where the opening names them. ACT-scoped advice (defined under act_scope_respected) that the entry leaves out is not missing: leaving it out is required.
- starts_mid_idea: true if the source begins partway through an idea that started in the context before it. A source that begins at a lettered subsection, with its RULE OPENING given, does not start mid-idea.
- faithful: true only if every rule, claim, example and number in the entry is supported by the SOURCE itself (the RULE OPENING, when given, is part of it). False if the entry adds a rule, an exception, an example or a number the source does not contain, or states a rule differently from the source. Material that appears only in the CONTEXT BEFORE or CONTEXT AFTER, and not in the SOURCE, makes the entry unfaithful even when it is correct.
- self_contained: true only if a student could understand the entry with nothing else: no reference to an example, rule, page, chapter or exercise that the entry does not itself include.
- correct: true only if the entry is correct about the SAT and standard English or mathematics. False if it states something wrong, even if the source says it.
- act_scope_respected: the student is taking the SAT. ACT-scoped advice is a test-taking tip, shortcut or answer pattern that the SOURCE ties to the ACT ("if there is an OMIT/DELETE option on the ACT", "when the ACT tests it's vs. its, the answer is almost always its", "more applicable to the ACT than the SAT"). False if the entry states any ACT-scoped advice as general, as true of the SAT or of "the test", or as "usually" or "always" true; or if the entry gives a method the source says works less well on the SAT without that limitation. True if the entry leaves the ACT-scoped advice out, or if the source has none. A paragraph marked "[ACT NOTE]" mentions the ACT; it is not ACT-only, so judge each sentence by what it says: a rule of standard English (where a comma goes, which form is correct) is never ACT-scoped, even under the marker and even when the source adds that the ACT tests it often, and stating that rule is correct.
- issues: one or two short sentences naming any problem, or an empty string.`;

/** The audit's user message; one function so the pipeline and the plant runner send the same. */
export function auditUserMessage(m: {
  source: string;
  before: string;
  after: string;
  entry: string;
  /** The numbered rule's opening when the source is one piece of it (book.ts ruleOpening). */
  ruleOpening?: string | null;
}): string {
  const opening =
    m.ruleOpening === undefined || m.ruleOpening === null
      ? ""
      : `RULE OPENING (part of the source):\n${m.ruleOpening}\n\n`;
  return `${opening}SOURCE:\n${m.source}\n\nCONTEXT BEFORE:\n${m.before}\n\nCONTEXT AFTER:\n${m.after}\n\nENTRY:\n${m.entry}`;
}

/** The rewrite's note on a rule opening, placed before the unit (same rule as the audit's). */
export function rewriteRuleOpening(opening: string | null): string {
  return opening === null
    ? ""
    : `RULE OPENING (the numbered rule's opening explanation; it is part of the unit's source, so you may use and restate it; the unit teaches one subsection of the rule and need not cover the others):\n${opening}\n\n`;
}

export const auditResponseSchema = {
  type: "OBJECT",
  properties: {
    complete: { type: "BOOLEAN" },
    starts_mid_idea: { type: "BOOLEAN" },
    faithful: { type: "BOOLEAN" },
    self_contained: { type: "BOOLEAN" },
    correct: { type: "BOOLEAN" },
    act_scope_respected: { type: "BOOLEAN" },
    issues: { type: "STRING" },
  },
  required: [
    "complete",
    "starts_mid_idea",
    "faithful",
    "self_contained",
    "correct",
    "act_scope_respected",
    "issues",
  ],
} as const;
export const auditSchema = z.object({
  complete: z.boolean(),
  starts_mid_idea: z.boolean(),
  faithful: z.boolean(),
  self_contained: z.boolean(),
  correct: z.boolean(),
  act_scope_respected: z.boolean(),
  issues: z.string(),
});
export type Audit = z.infer<typeof auditSchema>;

/** The audit drop reason for a failed audit, or null when every check passed. */
export function auditFailure(a: Audit): string | null {
  if (a.starts_mid_idea) return "audit_starts_mid_idea";
  if (!a.complete) return "audit_incomplete";
  if (!a.act_scope_respected) return "audit_act_generalised";
  if (!a.faithful) return "audit_unfaithful";
  if (!a.correct) return "audit_incorrect";
  if (!a.self_contained) return "audit_not_self_contained";
  return null;
}

export const EXAMPLE_CHECK_SYSTEM = `You check one entry of an SAT grammar knowledge base for one thing only: whether it describes its own examples correctly, in what can be seen by reading the example's characters. Go through the entry and find every statement that describes a specific example sentence the entry gives in one of these two ways only:
- where a mark sits in the example: a punctuation mark before, after or between particular words, or before or after a parenthesis or a dash ("a comma before the close parenthesis", "no comma after that", "a semicolon between the two clauses");
- which word or form appears in the example ("uses its", "the verb is have", "has no apostrophe").
Do NOT list statements about grammatical category: part of speech (noun, adjective, prepositional phrase), voice (active, passive), tense, or clause type. Those are not checked here, whatever you think of them.
For each statement you do list, quote the statement and the example exactly as the entry gives them, then look at the example character by character and say whether it actually shows what the statement says. Judge only the entry against itself, never the book and never your own view of the grammar.`;

export const exampleCheckResponseSchema = {
  type: "OBJECT",
  properties: {
    pairs: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          statement: { type: "STRING" },
          example: { type: "STRING" },
          example_shows_it: { type: "BOOLEAN" },
          why: { type: "STRING" },
        },
        required: ["statement", "example", "example_shows_it", "why"],
      },
    },
  },
  required: ["pairs"],
} as const;
export const exampleCheckSchema = z.object({
  pairs: z.array(
    z.object({
      statement: z.string(),
      example: z.string(),
      example_shows_it: z.boolean(),
      why: z.string(),
    }),
  ),
});
export type ExampleCheck = z.infer<typeof exampleCheckSchema>;

/** The example check's user message: the entry alone, never the book. */
export function exampleCheckUserMessage(entry: string): string {
  return `ENTRY:\n${entry}`;
}

/**
 * Pure. Why the entry contradicts itself, or null: the first statement whose example does not
 * show what it says. The model only reports pairs; this decides, and any mismatch drops the
 * chunk (audit_self_contradictory, never repaired).
 */
export function exampleCheckFailure(c: ExampleCheck): string | null {
  const bad = c.pairs.find((p) => !p.example_shows_it);
  return bad === undefined ? null : `"${bad.statement}": ${bad.why}`;
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
      EXAMPLE_CHECK_SYSTEM,
      JSON.stringify(exampleCheckResponseSchema),
    ].join("\n"),
  )
  .digest("hex")
  .slice(0, 12);
