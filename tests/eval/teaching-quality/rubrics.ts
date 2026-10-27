/**
 * @spec [docs/eval/lisa/G0-2_Teaching_Quality_Set_Design.md §7; Karl's ruling 2026-10-27:
 *       every rubric is held until his gold responses exist] | @implemented [2026-10-27]
 *
 * plain English: the three G0-2 cases as the repo knows them: an id, and Karl's gold, judge
 * note and must / must not. All empty: Karl writes the golds blind, and the rubrics follow.
 * Until a case's four slots are filled the harness replays it and runs the deterministic
 * checks, but the judge is not called and the run is `unscored`.
 *
 * Nothing here may quote or paraphrase a student (design §3.1). A gold that needs the
 * student's words lives in `tutor_eval_cases`, not here.
 */
import type { TutorEvalRubric } from "../../../packages/shared/src/tutor-eval-schema";

export const TEACHING_QUALITY_RUBRICS: readonly TutorEvalRubric[] = [
  // [KARL — GOLD RESPONSE. NOT DRAFTED. Write blind: setup, conversation, current message only.]
  {
    case_id: "G0-2-01",
    gold_response: null,
    judge_note: null,
    must: null,
    must_not: null,
  },
  // [KARL — GOLD RESPONSE. NOT DRAFTED. Write blind: setup, conversation, current message only.]
  {
    case_id: "G0-2-02",
    gold_response: null,
    judge_note: null,
    must: null,
    must_not: null,
  },
  // Karl's own test conversation on SATM2UYVX9I (may be committed; design §2).
  // [KARL — GOLD RESPONSE. NOT DRAFTED. Write blind: setup, conversation, current message only.]
  {
    case_id: "G0-2-03",
    gold_response: null,
    judge_note: null,
    must: null,
    must_not: null,
  },
];

export function rubricFor(caseId: string): TutorEvalRubric | null {
  return TEACHING_QUALITY_RUBRICS.find((r) => r.case_id === caseId) ?? null;
}
