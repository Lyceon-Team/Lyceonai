/**
 * Does an explanation refer to an answer choice by its letter?
 *
 * @spec [Feature-8 option_order (options are shuffled at serve, so a letter in an explanation
 *       names the wrong choice); owner ruling 2026-10-05 (QOTD follow-up, item 1): the QOTD
 *       scheduler skips MCQs whose explanation names a choice letter] | @implemented [2026-10-05]
 *
 * plain English: the ONE pattern for "this explanation says 'choice B' / '(C)' / 'answer is D'".
 * Moved verbatim from scripts/assemble-batch.ts (where it is a review tripwire on authored
 * batches) so the QOTD scheduler screens with the same rule rather than a second copy.
 *
 * trade-offs: capital A-D also appear as maths variables, geometric labels and articles, so the
 * pattern only matches a letter in an answer-choice context (after "option", "choice" or
 * "answer", in parentheses, or "answer is X"). The batch tool treats a match as "review"; the
 * scheduler treats it as "skip", which costs at most an eligible question.
 */
export const EXPLANATION_LETTER_REFERENCE =
  /(?:Option|option|Choice|choice|Answer|answer)\s+[A-D]\b|\([A-D]\)|answer is [A-D]\b/;

export function explanationNamesChoiceLetter(
  explanation: string | null | undefined,
): boolean {
  return (
    typeof explanation === "string" &&
    EXPLANATION_LETTER_REFERENCE.test(explanation)
  );
}
