/**
 * A question's difficulty as the student reads it: Easy, Medium or Hard.
 *
 * @spec [owner brief "Question metadata header" (Karl, 2026-10-13) §1 ("domain · skill ·
 *        difficulty (Easy/Medium/Hard)"); questions.difficulty smallint CHECK 1..3 (the bank's
 *        and the session-item snapshot's `question_difficulty`)] | @implemented [2026-10-13]
 *
 * plain English: the bank stores difficulty as 1, 2 or 3, and the pre-submit question payload
 * carries that value as served (`difficulty: string | number | null`). This maps it to the word
 * shown on the runner's question header. The words the filter bar already uses for the same
 * three buckets ("easy" | "medium" | "hard") are accepted too, case-insensitively.
 * expected outcome: 1 → "Easy", 2 → "Medium", 3 → "Hard"; anything else → null, and the header
 * then shows no difficulty rather than a guessed one.
 * trade-offs: browser-safe and dependency-free, so the client imports it directly.
 * edge cases: a numeric string ("2") reads as its bucket; 0, 4, 2.5, "" and null read null.
 */
import { z } from "zod";

export const QUESTION_DIFFICULTY_LABELS = ["Easy", "Medium", "Hard"] as const;

export const questionDifficultyLabelSchema = z.enum(QUESTION_DIFFICULTY_LABELS);
export type QuestionDifficultyLabel = z.infer<
  typeof questionDifficultyLabelSchema
>;

const BY_TOKEN: Readonly<Record<string, QuestionDifficultyLabel>> = {
  "1": "Easy",
  "2": "Medium",
  "3": "Hard",
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

export function questionDifficultyLabel(
  value: unknown,
): QuestionDifficultyLabel | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const token = String(value).trim().toLowerCase();
  return BY_TOKEN[token] ?? null;
}
