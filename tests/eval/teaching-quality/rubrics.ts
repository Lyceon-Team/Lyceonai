/**
 * @spec [docs/eval/lisa/G0-2_Teaching_Quality_Set_Design.md §7; Karl's rulings 2026-10-27:
 *       rubrics held until his golds existed (ruled), then this rubric ruled from them]
 *       | @implemented [2026-10-27]
 *
 * plain English: the three G0-2 cases as the repo knows them: an id, and the rubric Karl
 * ruled from his gold responses (2026-10-27). A case scores once its must / must not and judge
 * note exist; the gold reply's text, when it reaches the repo, adds the gold_move comparison.
 *
 * Nothing here may quote or paraphrase a student (design §3.1). A gold that needs the
 * student's words lives in `tutor_eval_cases`, not here.
 */
import type { TutorEvalRubric } from "../../../packages/shared/src/tutor-eval-schema";

/**
 * Karl's ruling 2026-10-27: one rubric for all three cases, drawn from his gold responses.
 * The golds' own text is not in the repo yet; `gold_response` stays null until it is, and the
 * judge then reports `gold_move: "no_gold"` (the verdict rests on must / must not).
 */
const DESMOS_REQUEST_RUBRIC = {
  gold_response: null,
  judge_note:
    "The student asked to use Desmos. Score the move, not the wording: LISA should switch to " +
    "Desmos and start the student on it. Rubric from Karl's gold responses (2026-10-27).",
  must: [
    "Commits to Desmos as the method for this question (not merely offering it, or deferring it).",
    "Gives a concrete first Desmos input for this question: what to type, specific to this item.",
    "Invites the student to say if they are stuck.",
  ],
  must_not: [
    "Falls back to an algebra or by-hand method instead of Desmos.",
    "Agrees to use Desmos and then ignores it: the next step it asks for is not done in Desmos.",
    "Reads the result for the student: states the solution, the coordinate or the answer value.",
  ],
} as const;

export const TEACHING_QUALITY_RUBRICS: readonly TutorEvalRubric[] = [
  "G0-2-01",
  "G0-2-02",
  // Karl's own test conversation on SATM2UYVX9I (may be committed; design §2).
  "G0-2-03",
].map((case_id) => ({
  case_id,
  ...DESMOS_REQUEST_RUBRIC,
  must: [...DESMOS_REQUEST_RUBRIC.must],
  must_not: [...DESMOS_REQUEST_RUBRIC.must_not],
}));

export function rubricFor(caseId: string): TutorEvalRubric | null {
  return TEACHING_QUALITY_RUBRICS.find((r) => r.case_id === caseId) ?? null;
}
