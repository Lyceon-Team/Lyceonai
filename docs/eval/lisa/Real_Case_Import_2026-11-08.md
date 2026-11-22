# Real-case import, 2026-11-08: the case list

Owner brief "Prepare the real-case import" (Karl, 2026-11-08). **Stopped here, for Karl to run the
import.** Production is never read or written by Claude.

| Doc                                      | What it holds |
| ---------------------------------------- | ------------- |
| `G0-2_Owner_Run_Steps.md`                | The steps     |
| `real-case-finders.sql`                  | The SQL       |
| `tests/eval/teaching-quality/rubrics.ts` | The rubrics   |

## Why the ids are blank

The analysis team's Nov 3-5 review is in no doc on any branch and in no meeting note. The help-level
README (#1456) has only aggregates: 32 "Got it" taps on Nov 4, and one student who tapped 21 times on
one problem.

So each case below comes with a **read-only finder query** that returns the conversation and the
cut-off message deterministically. Karl runs it and confirms the candidate is the one the analysis
team reviewed, using the per-conversation listing at the end of the SQL file. Then he records both
ids here, or keeps them in the SQL editor: no student text and no ids need to reach the repo.

The finders were run against a local database built from the migrations. They were checked against
one synthetic conversation, inside a rolled-back transaction, and each returned the intended cut-off
message:

- the third tap of a "Got it" run;
- the second of two "stuck" messages in a row;
- the first Desmos request;
- the first self-deprecating message.

## The cases

| Case    | What it tests        | Source                                                  | Finder (`real-case-finders.sql`)                                                                                    | Cut-off rule                          | Rubric                                                    | Conversation id | Cut-off message id |
| ------- | -------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------- | --------------- | ------------------ |
| G0-2-01 | Desmos request       | Student A, 18 Oct                                       | by student and day                                                                                                  | the student message asking for Desmos | Karl's Desmos rubric + gold (2026-10-27)                  |                 |                    |
| G0-2-02 | Desmos request       | Student B, 19 Oct                                       | by student and day                                                                                                  | same                                  | same                                                      |                 |                    |
| G0-2-03 | Desmos request       | Karl's own test on SATM2UYVX9I, 27 Oct (`--owner-case`) | by item and minute                                                                                                  | same                                  | same                                                      |                 |                    |
| G0-2-04 | The "Got it" loop    | analysis team, Nov 3-5 (the 21-tap run of Nov 4)        | runs of `step_understood`, longest first                                                                            | the **third** tap of the run          | reaches the worked step; no smaller question; no restart  |                 |                    |
| G0-2-05 | The "idk" escalation | analysis team, Nov 3-5                                  | two "stuck" messages in a row (`step_stuck`, or typed idk / I don't know / I'm stuck / no idea)                     | the **second** of the two             | reaches the worked step; no smaller question; no restart  |                 |                    |
| G0-2-06 | A Desmos request     | analysis team, Nov 3-5                                  | first Desmos request per conversation (`desmos_walkthrough`, or typed "desmos"; the Desmos _video_ tap is excluded) | that message                          | Karl's Desmos rubric + no restart; no gold yet            |                 |                    |
| G0-2-07 | Frustration          | analysis team, Nov 3-5                                  | first message matching the friction detector's self-deprecation patterns                                            | that message                          | frustration acknowledged; no smaller question; no restart |                 |                    |

**Karl's items as rubric text** (`rubrics.ts`, shared wording, so every case scores a behaviour the
same way):

| Item                                      | Kind     | Rubric text                                                                                                                            |
| ----------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Reaches the worked step by tap 3          | must     | "Carries out the next step of the solution itself, as a worked step the student can see done, instead of asking the student to do it." |
| No question smaller than the current step | must not | "Asks the student a question smaller than the step the walkthrough has already reached (re-asks an earlier, easier sub-step)."         |
| No restart                                | must not | "Restarts the problem: goes back to the beginning, or re-explains steps the student has already completed."                            |
| Frustration acknowledged                  | must     | "Acknowledges the student's frustration briefly and kindly before teaching, without dwelling on it or lecturing."                      |

**How the cases score:**

- G0-2-04 to G0-2-07 have no gold reply yet. The judge then reports `no_gold`, and the verdict
  rests on the must and must-not items alone (`tutor-eval-schema.ts`).
- G0-2-06 keeps the full Desmos rubric of cases 01-03 and adds "no restart".
- The set version stays `teaching-quality v1`. No case has ever been imported under it (production
  had 0 rows on 2026-11-05), so the set is these seven cases from its first import.

## What this evaluates, and the release order it implies

**The import builds each case's request with the BFF's own `resolveFullEnvelope`.** So the
evaluated request carries both fixes in this change:

- **W4-15, friction.** The friction signals now read the case's conversation, bounded at the
  cut-off (`frictionAsOf`). G0-2-07 is the case that exercises it: at its cut-off, the
  self-deprecation signal is true in the envelope, where before the fix it was always false.
- **W4-16, memory.** Memory written after the cut-off, or compacting the case's own conversation,
  is dropped. Only v5 renders the compaction fields, so the v5 runs are where the memory fix is
  evaluated. The last finder query says whether a case's student has memory from before the
  cut-off. A case without it evaluates v5 with no memory block.

**Release order.** W4-15 is BFF code: once it reaches `main`, every prompt version sees real friction
signals, including production's v3. It is evaluated through these same runs, because the v3
runs carry fixed friction too.

So, to keep "evaluated before deploy":

- This change merges into `lisa`.
- `lisa` does not go to `main` until Karl has read the v3, v4 and v5 results.
- The W4-16 change is worker code that only v5 reaches. It changes nothing in production until v5
  is selected.

## Karl's next steps

1. Run `real-case-finders.sql`, confirm each candidate, and note the two ids per case.
2. Import the seven cases, then run v3, v4 and v5 (`G0-2_Owner_Run_Steps.md` steps 3-4). This costs
   about $1.80.
3. Grade, then run `--report` (step 5).
4. Rule on:
   - the line (v3, v4 or v5);
   - when `lisa` goes to `main` with W4-15.
