import { isValidGridInFormat } from "@/components/practice/NumericEntryInput";

type SubmittableQuestion = {
  questionType?: "multiple_choice" | "grid_in" | null;
  itemType?: "mcq" | "grid_in" | null;
};

function isGridIn(q: SubmittableQuestion): boolean {
  return q.questionType === "grid_in" || q.itemType === "grid_in";
}

function isMultipleChoice(q: SubmittableQuestion): boolean {
  return q.questionType === "multiple_choice";
}

export function isSubmittableAnswer(
  question: SubmittableQuestion | null,
  answer: string | null,
): boolean {
  if (!question) return false;

  if (isMultipleChoice(question)) {
    return typeof answer === "string" && answer.trim().length > 0;
  }

  if (isGridIn(question)) {
    return typeof answer === "string" && isValidGridInFormat(answer.trim());
  }

  return false;
}
