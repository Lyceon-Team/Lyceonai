# LISA help-level engine

Owner brief "Help-level engine" (Karl, 2026-11-05). SCL-275.

## Why

Students were looping on "Got it, next step": 32 taps on Nov 4, and one student tapped 21 times on
one problem and never saw the answer. The worker never read the tap, so nothing moved them on.

## What

The server decides how much help each turn gives, with no model call, and passes it to the worker.
The logic is in `packages/shared/src/tutor-help-level.ts`.

| Level | Help |
|---|---|
| 1 `ask` | a guiding question |
| 2 `hint` | the idea or first move, no step done |
| 3 `worked_step` | one worked step: step 1, step 2, then step 3 (the final one before submission) |
| 4 `full_solution` | the whole solution with the answer (after submission only) |

The ladder has five rungs: ask, hint, worked step 1, worked step 2, and a final rung. The final
rung is worked step 3 before submission and the full solution after, so the ceiling is level 3
before submission and level 4 after.

| Signal | Move |
|---|---|
| "Walk me through it" | to the hint |
| "Got it, next step" | up one rung, so the final rung arrives within 3 taps |
| "idk" / "I'm stuck" (typed or tapped), or a skipped item | up one; two in a row, up two |
| "just solve it" / "show me" | to the final rung |
| after submission, a typed message stating the keyed answer | down one level |
| anything else | no move |

- **Typed signals** come from the runtime-config keyword map `tutor_help_keywords` (version 1 is
  seeded by the migration). It uses the same whole-word matcher as `video_method_keywords`
  (`packages/shared/src/keyword-match.ts`).
- **The answer key** never leaves the server, and is compared with typed text **after submission
  only**. Before submission, a level that moved because a guess matched the key would tell the
  student the guess was right: an answer oracle, which the anti-leak invariant forbids. So the
  brief's "a correct typed step moves down one" applies after submission (flagged for Karl).
- **A previous level that can't be read** gives the turn no level: it is sent without one (v7 then
  renders exactly as v3) and records none, so the ladder's memory is never overwritten.
- **Where the level lives:** each turn's `tutor_turn_metrics` row (`help_level`,
  `help_worked_step`, `help_signal`). The next turn starts from the latest row that has one.
- **What the worker gets:** `help_level`, `submit_state` and `worked_step` on the request, all
  optional.
- **The prompt:** `lisa-default-v7`, which is v3's rules byte for byte, plus one rule for the
  level. It is named v7 because PR #1449 claims v6 for the voice work.
- **Video choices:** `GET /api/tutor/guided-choices` hides a video choice when tapping it would
  serve no video.

## Weekly metrics

`weekly-metrics.sql` is read-only and covers:

- median taps to resolution;
- longest tap streak, flagged over 5;
- walkthrough completion;
- dead-end rate.

It is keyed on `intent`, so the weeks before the engine are the baseline.

## Deploy order

1. Karl applies `supabase/migrations/20261201000000_lisa_help_level.sql`. The server writes the new
   columns on every model turn, so they must exist first.
2. Deploy the worker from `lisa`: it must accept the three fields, and it carries v7.
3. Merge to `main`, which deploys the server.
