/**
 * Module summary — the ONE count of answered / unanswered / marked.
 *
 * @spec [E7b brief: navigator, review page and submit dialog; plant "the review
 *        page's counts match the navigator's"] | @implemented [2026-09-25]
 *
 * plain English: the navigator, the review page and the submit dialog all read this
 * function, so they cannot disagree. An item counts as answered when the server holds
 * a non-null answer for it (an explicit omit is unanswered), and as marked from the
 * item's workspace. Nothing here knows or implies correctness.
 */
import type { ExamWorkspaceItem } from "@lyceon/shared/exam-runtime-schema";

export type ModuleCell = {
  ordinal: number;
  /** 1-based number shown to the student. */
  number: number;
  answered: boolean;
  marked: boolean;
};

export type ModuleSummary = {
  total: number;
  answered: number;
  unanswered: number;
  marked: number;
  cells: ModuleCell[];
  firstUnanswered: number | null;
};

export function isAnswered(answer: string | null | undefined): boolean {
  return answer !== null && answer !== undefined && answer.trim() !== "";
}

export function summarizeModule(
  items: ReadonlyArray<{ ordinal: number }>,
  answers: ReadonlyMap<number, string | null>,
  workspace: ReadonlyMap<number, ExamWorkspaceItem>,
): ModuleSummary {
  const cells = [...items]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((item, index) => ({
      ordinal: item.ordinal,
      number: index + 1,
      answered: isAnswered(answers.get(item.ordinal)),
      marked: workspace.get(item.ordinal)?.marked_for_review === true,
    }));
  const answered = cells.filter((c) => c.answered).length;
  return {
    total: cells.length,
    answered,
    unanswered: cells.length - answered,
    marked: cells.filter((c) => c.marked).length,
    cells,
    firstUnanswered: cells.find((c) => !c.answered)?.ordinal ?? null,
  };
}
