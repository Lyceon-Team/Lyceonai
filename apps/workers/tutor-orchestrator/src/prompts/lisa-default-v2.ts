/**
 * @spec [Doc-03C_V3 §4.3 — versioned prompt artifact; Doc-02B_V4 §21
 *        (Question Awareness), CR-02B-29; INV-03-04; closure plan W3-2
 *        (owner ruling 2026-09-25: LISA never grades, never invents questions,
 *        never asserts computed answers; general mode hands off to practice)]
 * @implemented 2026-09-25
 *
 * plain English: v1's rules, unchanged, plus the lines that keep LISA a tutor
 * and not a second, ungoverned question bank:
 *
 *   - LISA does not grade. It never tells a student an answer is right or
 *     wrong unless the platform has given it that question's correct answer
 *     post-submit.
 *   - LISA never writes a question. Asked for one, it offers a practice
 *     question that counts — practice owns selection, serving, anti-leak,
 *     grading and mastery — and marks the offer so the client can render a
 *     "Start a practice question" action (the worker strips the marker).
 *   - LISA never states the computed result of a problem it was not given.
 *   - Owner copy, verbatim: checking an answer with no bank item; and, in
 *     review before submit, "Submit it and we'll go through it together."
 *
 * expected outcome: in general mode, a request for a question produces no
 * invented item and no computed answer, only the offer. A request to check an
 * answer with no item produces the owner's copy.
 *
 * trade-offs:
 *  - v1 is immutable once published (§4.3). v2 composes it: v1's rendered
 *    text is reproduced byte-for-byte, and the v2 rules follow. Nothing in
 *    v1 is edited, and a turn attributed to v1 still renders exactly as it
 *    did.
 *  - The handoff marker is a plain token rather than a structured-output
 *    field: the worker has no response schema today (see orchestrate.ts
 *    header), and a token the worker always strips is deterministic to parse
 *    and never reaches the student.
 */

import type { PromptArtifact, PromptFields } from "./types.js";
import { LISA_DEFAULT_V1 } from "./lisa-default-v1.js";

/**
 * The token LISA ends a message with when it offers a practice question.
 * Stripped by the worker in every mode; honoured (as a suggested action) only
 * when no bank item is attached — see `extractPracticeHandoff`.
 */
export const PRACTICE_HANDOFF_MARKER = "[OFFER_PRACTICE]";

/** Owner copy, 2026-09-25 — verbatim. */
export const NO_BANK_ITEM_CHECK_COPY =
  "I can't check that one — I don't grade, and I only have answers for " +
  "questions in Lyceon's bank. Walk me through how you got it and we'll " +
  "check your reasoning, or I can start you on a practice question that counts.";

/** Owner copy, 2026-09-25 — verbatim. */
export const REVIEW_PRE_SUBMIT_COPY =
  "Submit it and we'll go through it together.";

export const LISA_DEFAULT_V2: PromptArtifact = {
  version: "lisa-default-v2",
  policyVariant: "default",

  renderSystemInstruction: (fields: PromptFields): string => {
    const sections: string[] = [
      LISA_DEFAULT_V1.renderSystemInstruction(fields),
    ];

    // ── No grading, no invented questions, no computed answers (W3-2) ──
    sections.push(
      `You do not grade. Never tell the student an answer is right or wrong ` +
        `unless the context blocks give you that question's correct answer ` +
        `post-submit. ` +
        `Never write, invent, or pose an SAT question, practice problem, or ` +
        `quiz — not even a "similar" or "quick" one. Questions come only from ` +
        `Lyceon's bank, through practice. ` +
        `Never state the computed result of a problem that is not in the ` +
        `context blocks; work on the student's reasoning instead.`,
    );

    // ── Handoff to practice (general mode) ─────────────────────────────
    sections.push(
      `When the student asks for a question, a problem, or a quiz, do not write ` +
        `one. Offer to start them on a practice question that counts, in one ` +
        `short sentence, and end your message with ${PRACTICE_HANDOFF_MARKER} ` +
        `on its own line. Use ${PRACTICE_HANDOFF_MARKER} whenever you offer a ` +
        `practice question, and never otherwise.`,
    );

    // ── Checking an answer with no bank item ───────────────────────────
    sections.push(
      `When the student asks you to check their answer to a question that is ` +
        `not in the context blocks, reply with exactly: "${NO_BANK_ITEM_CHECK_COPY}" ` +
        `and then ${PRACTICE_HANDOFF_MARKER} on its own line.`,
    );

    // ── Review, before submit (CR-02B-29) ──────────────────────────────
    if (fields.sourceSurface === "review" && !fields.isPostSubmit) {
      sections.push(
        `This is a review question the student has not submitted yet. When they ` +
          `ask for the answer, or whether their choice is right, reply with ` +
          `exactly: "${REVIEW_PRE_SUBMIT_COPY}" Otherwise, tutor as usual — ` +
          `the answer is still never given.`,
      );
    }

    return sections.join("\n\n");
  },
};

/** The client's label for the handoff action. */
export const PRACTICE_HANDOFF_LABEL = "Start a practice question";

const PRACTICE_HANDOFF_PATTERN = /\[\s*OFFER_PRACTICE\s*\]/gi;

export type PracticeHandoff = {
  /** The model's text with every marker removed — what the student reads. */
  content: string;
  /** The model offered a practice question this turn. */
  offered: boolean;
};

/**
 * Pure. Strips the handoff marker from the model's text in every case — the
 * student never sees it — and reports whether it was there. Whether the offer
 * becomes a suggested action is the caller's decision (only when no bank item
 * is attached: inside practice or review, LISA stays on the item).
 */
export function extractPracticeHandoff(text: string): PracticeHandoff {
  const offered = text.search(PRACTICE_HANDOFF_PATTERN) !== -1;
  if (!offered) return { content: text, offered: false };
  const content = text
    .replace(PRACTICE_HANDOFF_PATTERN, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { content, offered: true };
}
