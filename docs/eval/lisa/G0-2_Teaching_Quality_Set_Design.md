# G0-2 — Teaching-Quality Evaluation Set: Step 0 Design

**Spec:** Doc 03D §5.1 (golden set), §5.3 (judge calibration), §3.2.1 (baseline and variance band), §3.1 (tutor act), §8.1 (attribution); Doc 02B §28 (Desmos on every math surface).
**Reuses:** `docs/eval/lisa/LISA_Golden_Set_v2.md` (case format, owner-authored calibration convention, judge notes) and `docs/eval/lisa/harness-phase-a-design.md` (Class 1 / Class 2 split, fixture shape, single-generation replay; semantic "must" assertions deferred to Phase B, the judge).
**Date:** 2026-10-27
**Status:** Design only. No harness code, no exports, no model calls. Spend: $0.
**Revised 2026-10-27 on Karl's corrections:** no student transcript text in the repo, de-identified or not (§3); this design is its own PR, off the book PR (#1304); every rubric is held until Karl's gold responses exist (§7).

---

## 1. What this set measures

One failure, seen three times in real use: **the student asks for Desmos, and LISA either agrees to it or ignores it — then keeps asking algebra questions.** The student's request for the tool that the SAT itself provides is not acted on.

A likely contributing cause, recorded here so the baseline can confirm or rule it out (not fixed in this step):

- **LISA's prompts never mention Desmos, a calculator or graphing.** `git grep -i "desmos\|calculator\|graph"` over `apps/workers/tutor-orchestrator/src/prompts` on `origin/lisa` (`988351ca`) returns nothing.
- Meanwhile, Doc 02B §28 makes Desmos available on every math surface ("the official SAT calculator… table stakes"), and the client renders it (`client/src/components/math/DesmosCalculator.tsx`).

LISA is tutoring next to a tool it has no knowledge of.

## 2. Seed cases

All three are real production conversations. Students are not named anywhere in the repository. Which conversation a student case came from is held only in the server-only table (§3), never in git.

| Case        | Source                      | When (UTC)               | Item          |
| ----------- | --------------------------- | ------------------------ | ------------- |
| **G0-2-01** | Production, student A       | 18 Oct 2026              | from export   |
| **G0-2-02** | Production, student B       | 19 Oct 2026              | from export   |
| **G0-2-03** | Production, Karl's own test | 27 Oct 2026, 04:07–04:10 | `SATM2UYVX9I` |

Each case is one decision point: the conversation up to and including the student's Desmos request, and the reply LISA gave there. Later turns go into the case's notes only; they are not replayed. This follows the Phase A design: "every golden-set case is a single-generation test."

## 3. Storage

### 3.1 The rule (Karl, 2026-10-27)

**No student transcript text goes in the repo, de-identified or not.** The repository is public and the students are minors, and free text can identify someone even with every name removed. So:

| What                                                                                                                                                                 | Where                                                                                             | Why                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Student cases** (G0-2-01, G0-2-02): the conversation prefix, the item, the student's current message, LISA's production reply, and which conversation it came from | **A server-only table** in Supabase, described in §3.2                                            | It is student text                                                                                                                      |
| **Every baseline run record for a student case**: the replayed reply, the judge's quotes, raw model output                                                           | **The same server-only storage** (§3.2, `tutor_eval_runs`)                                        | A replay or a judge quote can echo the student's words                                                                                  |
| **Karl's own case** (G0-2-03, item `SATM2UYVX9I`, 27 Oct 04:07–04:10 UTC)                                                                                            | **May be committed.** It is from Karl's account, not a student's                                  | Owner ruling                                                                                                                            |
| **The repo**                                                                                                                                                         | `docs/eval/lisa/LISA_Teaching_Quality_Set_v1.md` and, from Step 1, `tests/eval/teaching-quality/` | Case ids, rubrics, gold responses, judge notes and harness code only. For student cases, nothing that quotes or paraphrases the student |

The repo copy of a student case therefore reads, for example: `G0-2-01 — source: server-only (tutor_eval_cases); rubric: [held]; gold: [Karl]`. The harness joins it to its text at run time, server-side.

### 3.2 The server-only table

Two tables, following the genesis pattern for service-role primitives: "RLS enabled, deny-all to anon/authenticated (service-role only)", no client grants (`00000000000000_genesis.sql` §3a). The migration is Step 1; nothing is created by this design.

```sql
-- Step 1 sketch, not a migration yet.
CREATE TABLE public.tutor_eval_cases (
  case_id             TEXT PRIMARY KEY,                 -- 'G0-2-01'; the only value the repo uses
  set_version         TEXT NOT NULL,                    -- 'teaching-quality v1'
  student_id          UUID REFERENCES public.profiles(id) ON DELETE CASCADE,   -- NULL for an owner case
  source_conversation_id UUID,                          -- provenance only; no FK, so the case survives the
                                                        -- 7-day sweep of the live conversation
  item_canonical_id   TEXT,
  request             JSONB NOT NULL,                   -- the OrchestrateRequest the replay sends
  production_reply    TEXT NOT NULL,
  captured_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.tutor_eval_runs (
  run_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             TEXT NOT NULL REFERENCES public.tutor_eval_cases(case_id) ON DELETE CASCADE,
  record              JSONB NOT NULL,                   -- the §5.2 record, replies and judge quotes included
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tutor_eval_cases ENABLE ROW LEVEL SECURITY;   -- and no policies at all
ALTER TABLE public.tutor_eval_runs  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tutor_eval_cases, public.tutor_eval_runs FROM PUBLIC, anon, authenticated;
```

- **Access.** Service role only. No client policies and no grants to `anon` or `authenticated`, so no browser session can read a row. `scripts/ci/check_rls_enabled.ts` already gates "RLS enabled"; Step 1 adds a pinned assertion that both tables have **zero** policies and no client grants, so that one added policy fails CI.
- **Deletion follows the student.** `student_id … ON DELETE CASCADE`: deleting the student's profile deletes their case and its runs. This answers what the first draft left open as D2. The case does not follow the 7-day sweep of the live conversation, which is why `source_conversation_id` has no foreign key: the eval copy is deliberately kept, and it is removed with the student.
- **Never in logs.** The harness logs case ids, verdicts and costs. It never logs text from these tables (CLAUDE.md, privacy).

### 3.3 Export: owner-run, into the table

Claude Code does not read production (CLAUDE.md, "ask the catalog"). Karl runs the read-only queries below to find each conversation, then the Step 1 import (service role, server-side) builds the `request` from those turns and inserts the row. The text goes from one production table to another and never passes through git. Placeholders in angle brackets are his to fill.

```sql
-- Read-only. Find the conversation containing the Desmos request.
-- G0-2-01 / G0-2-02: by student and day.
SELECT c.id AS conversation_id, c.entry_mode, c.source_surface,
       c.source_question_canonical_id, c.prompt_version, c.policy_variant
FROM public.tutor_conversations c
JOIN public.profiles p ON p.id = c.student_id
WHERE p.display_name = '<student display name>'          -- Karl fills; never committed
  AND c.created_at >= '<YYYY-MM-DD>' AND c.created_at < '<YYYY-MM-DD +1>';

-- G0-2-03: Karl's test, by item and window.
SELECT c.id AS conversation_id, c.entry_mode, c.source_surface, c.prompt_version
FROM public.tutor_conversations c
JOIN public.tutor_messages m ON m.conversation_id = c.id
WHERE m.source_question_canonical_id = 'SATM2UYVX9I'
  AND m.created_at BETWEEN '2026-10-27 04:07:00+00' AND '2026-10-27 04:10:59+00'
GROUP BY c.id;
```

**Export soon.** The 7-day tier (INV-03-19) deletes a conversation only once it has been soft-deleted for more than 7 days, so the live transcripts should still exist today. But if a seed student's entitlement lapses, the conversation is soft-deleted, and 7 days later it is gone.

## 4. Judge: scoring LISA's reply against Karl's gold

This reuses the golden-set Phase B design as it stands. The Phase A design deferred semantic "must" assertions to Phase B, and v2 provides the calibration convention: owner-authored golds, written blind, with judge notes.

### 4.1 Order of checks, deterministic first

1. **Class 1, in code, no model.**
   - `hasAnswerLeak` (the same scanner as the BFF) on the reply.
   - A case heuristic, `toolRequestUnanswered`: the reply mentions none of _Desmos / calculator / graph_, and it ends in a question. That outcome is REVIEW_NEEDED, not FAIL, because a good reply could defer the tool for a reason.
2. **Class 2, the judge.** It reads:
   - the case setup;
   - the conversation;
   - the student's current message;
   - LISA must / must not;
   - Karl's gold response and judge note;
   - LISA's reply.

### 4.2 The judge reports; the code decides

This is the same split as the book pipeline's example check: the model never returns the verdict itself. The response schema (Zod in `packages/shared`, Step 1):

```ts
{
  must: {
    item: string;
    met: boolean;
    quote: string;
  }
  []; // quote from LISA's reply
  must_not: {
    item: string;
    violated: boolean;
    quote: string;
  }
  [];
  gold_move: "same_move" | "partial" | "different_move"; // vs Karl's gold, by pedagogical move, not wording
  tutor_act: "diagnostic_question" |
    "hint" |
    "worked_step" |
    "explanation" |
    "full_solution" |
    "affirmation" |
    "redirect"; // Doc 03D §3.1
  tool_request_addressed: boolean; // this set's one question
}
```

The code turns that into a verdict:

- **FAIL:** any `must_not` violated, any `must` unmet, or `tool_request_addressed` false.
- **PASS:** all of these clear and `gold_move` is not `different_move`.
- **REVIEW_NEEDED:** everything else.

A leak from Class 1 overrides everything.

### 4.3 Calibration (Doc 03D §5.3)

- **Judge model (Karl, 2026-10-27, D3).** Gemini Pro on Vertex (`gemini-3.1-pro-preview`) judges `gemini-3.5-flash`. There is no other provider key.
  - §5.3 says judges "drawn from the same family share failure modes with the model under test". That sentence describes a risk. The binding parts of §5.3 are calibration against human raters and reported agreement, and both are met below. So this is a ruling with mitigations, not a deviation, and no SCL entry is owed.
  - Mitigations, all in code:
    - a different and stronger model (Pro, not Flash);
    - deterministic checks run first, and a leak fails without the judge;
    - the judge reports and the code decides (`decideTutorEvalVerdict`);
    - a judge quote that is not in LISA's reply is not trusted (REVIEW_NEEDED);
    - agreement with Karl's grades is printed on every calibration run;
    - any change to `JUDGE_MODEL_DEFAULT` means recalibrating.
- **Ground truth.** Karl grades each baseline reply himself, PASS / FAIL / REVIEW, before seeing the judge's verdict. Agreement with the judge is reported per run.
- **Honest limit.** Three cases cannot calibrate a judge statistically; any agreement figure on 3 is anecdote. The judge is calibrated across this set **and** Golden Set v2's ten owner-authored cases, and the report says how many judgements the agreement rests on.
- **Recalibration** on any judge model version change, as §5.3 requires.

## 5. Baseline capture: `lisa-default-v3` at thinking budget 1024

### 5.1 The baseline must be the production configuration, imported, not copied

- **Prompt.** The live `lisa-default-v3` artifact from `prompt-registry.ts`, assembled by the worker's own functions:
  - `buildSystemInstruction`;
  - `renderStateBlocks`;
  - `buildConversationMessages`.
- **Generation config.** The worker's `invokeVertexOnce` settings in `vertex-client.ts`: `TEMPERATURE`, `TOP_P`, `TOP_K`, `maxOutputTokens`, `thinkingConfig: { thinkingBudget: 1024 }` and `SAFETY_SETTINGS`.
  - Step 1 exports the config builder from the worker and the harness imports it.
  - **The existing `tests/eval/lisa-leak-probe.ts` is not baseline-grade.** It runs at temperature 0.3 with no thinking budget. Reusing it as is would measure a configuration production does not run.
- **Model.** Resolved through the same alias routing the worker uses. The resolved model is recorded, not assumed.
- **The visible reply.** Captured after the worker's own post-processing (marker strip) and the BFF scanner, so the judge scores what the student would have seen.

### 5.2 Runs, variance and record

- **Runs.** Each case is replayed 5 times on the unchanged configuration (Karl, 2026-10-27, D4), so that §3.2.1's variance band can be set from observed variance.
- **Per-run record**, a row in `tutor_eval_runs` (§3.2), not a file. A replay or a judge quote can echo the student. Karl's own case may also be written to the eval cache for reading locally:

| Field                        | Value                           |
| ---------------------------- | ------------------------------- |
| set                          | `teaching-quality v1`           |
| case id                      | e.g. `G0-2-01`                  |
| run                          | 1–_n_                           |
| `prompt_version`             | `lisa-default-v3`               |
| context hash                 | see §6                          |
| model                        | the resolved alias              |
| thinking budget              | 1024                            |
| temperature, top-p, top-k    | as sent                         |
| worker git sha               | the commit the harness imported |
| raw reply, visible reply     | full text                       |
| Class 1 result               | scanner and heuristic verdicts  |
| judge response, code verdict | §4.2                            |
| usage and cost               | measured                        |

- **Production reply alongside.** The baseline report shows each case's actual production reply next to the replays. If the replays don't reproduce the failure, the replay is wrong or the failure depended on state the export didn't capture, and that has to be known before any prompt change is measured against the baseline.

### 5.3 Cost (estimate, not measured)

Per run: one LISA turn plus one judge call. 3 cases × 5 runs × (~$0.01 replay + ~$0.02 judge) ≈ **$0.45**. To be measured on the first run; the figure here is a planning number only.

## 6. Attribution

Doc 03D §8.1 requires `prompt_version` and `context_hash` on every turn: "without [them], no outcome can be attributed to any change".

**Today, on `origin/lisa` (`988351ca`):**

| Item                               | Status                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `prompt_version`                   | Exists. On the worker wire, and written per turn (`server/services/tutor-runtime-writer.ts:70`) |
| `context_hash`                     | Exists nowhere in the code                                                                      |
| Model and thinking budget per turn | Not recorded                                                                                    |

**How a run is attributed.** Each result is keyed by:

- set version;
- case id;
- `prompt_version`;
- context hash;
- resolved model;
- thinking budget;
- worker git sha.

Two runs are comparable only when everything except the variable under test matches.

**Dependency: the attribution PR in another lane.**

- It defines the canonical `context_hash`, as Doc 03B §22's emission of the field.
- No such PR is open on `Lyceon-Team/Lyceonai` as of 2026-10-27 (searched: `attribution`, `prompt_version`, `context_hash`).
- Until it merges, the harness computes a **provisional** hash: sha256 of the assembled system instruction plus the message list, labelled `provisional` in every record.
- When the canonical function lands, the harness imports it (never a second implementation) and provisional records are not compared with canonical ones.

**The seed turns themselves predate any `context_hash`.** Their production replies can be attributed to `prompt_version` only, not to the exact context that produced them.

## 7. Gold responses: Karl's, not drafted; rubrics held

The three slots below go into the set file as they stand. Per the v2 convention, Karl writes them blind (setup, conversation and current message only) and in his own voice. He reads the student cases server-side; they are not in the repo. Nothing has been drafted for them.

> **G0-2-01 — Gold response** _(owner-authored)_
> `[KARL — GOLD RESPONSE. NOT DRAFTED. Write blind: setup, conversation, current message only.]`

> **G0-2-02 — Gold response** _(owner-authored)_
> `[KARL — GOLD RESPONSE. NOT DRAFTED. Write blind: setup, conversation, current message only.]`

> **G0-2-03 — Gold response** _(owner-authored)_
> `[KARL — GOLD RESPONSE. NOT DRAFTED. Write blind: setup, conversation, current message only.]`

- **A gold goes in the repo, so for a student case it must not quote or paraphrase the student's own words.** It can name the item, the math and the move. If a gold needs the student's words to make sense, that gold lives in `tutor_eval_cases` instead, and the repo holds its id.
- **Every rubric is held until all three golds exist** (Karl, 2026-10-27). That covers LISA must / must not and the judge note. Writing a rubric first would steer the golds, which v2 avoided by having the owner write blind. Nothing is drafted.

## 8. Decisions for Karl

| #   | Decision                                                                                                                                                    | Proposed                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| D1  | _Settled 2026-10-27:_ a separate versioned set (`teaching-quality v1`)                                                                                      | —                                                                        |
| D2  | _Settled 2026-10-27:_ no student text in the repo, de-identified or not; student cases live in a server-only table (§3); deletion cascades from the student | —                                                                        |
| D3  | _Settled 2026-10-27:_ Gemini Pro on Vertex judges `gemini-3.5-flash`, with the §4.3 mitigations                                                             | —                                                                        |
| D4  | _Settled 2026-10-27:_ 5 runs per case                                                                                                                       | —                                                                        |
| D5  | **Open:** the Doc 03 §14.2 retention period for `tutor_eval_cases` / `tutor_eval_runs` (§10)                                                                | Karl to rule; the migration must not be applied to production until then |

## 9. Step 1 (built 2026-10-27)

| Piece                                                        | Where                                                                                      | State                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Tables, RLS on, zero policies, service role only             | `supabase/migrations/20261117000000_tutor_eval_cases.sql`                                  | Built; CI-checked by `tests/ci/tutor-eval-tables.pg.ci.test.ts`. **Not to be applied to production until D5 is ruled** |
| Worker generation config, exported                           | `buildTutorGenerationConfig` in `apps/workers/tutor-orchestrator/src/lib/vertex-client.ts` | `invokeVertexOnce` builds from it; no behaviour change                                                                 |
| The BFF scan, without IO                                     | `scanTutorOutput` in `server/services/tutor-output-serializer.ts`                          | `serializeTutorOutput` calls it, then logs and dual-writes; no behaviour change                                        |
| Schemas and the verdict                                      | `packages/shared/src/tutor-eval-schema.ts`                                                 | Built                                                                                                                  |
| Server-side import                                           | `tests/eval/teaching-quality/import-case.ts`                                               | Built; owner-run (service-role env). Needs Karl's §3.3 ids                                                             |
| Harness                                                      | `tests/eval/teaching-quality/run-baseline.ts`, `replay.ts`, `judge.ts`                     | Built; proven end to end on a synthetic case (below)                                                                   |
| Rubric slots                                                 | `tests/eval/teaching-quality/rubrics.ts`                                                   | All empty; the judge is not called and runs are `unscored` until Karl's golds and rubrics exist                        |
| Unit tests (planted good / bad / leak replies, mocked judge) | `tests/ci/tutor-eval-teaching-quality.contract.test.ts`                                    | 11 pass                                                                                                                |

**Owner steps, in order:**

1. Rule D5. Then apply the migration.
2. Run the §3.3 queries and run the import, once per case:
   `pnpm exec tsx tests/eval/teaching-quality/import-case.ts --case G0-2-0N --conversation <id> --cutoff <student message id> [--owner-case]`.
3. Run the baseline:
   `NODE_USE_ENV_PROXY=1 DATABASE_URL=… pnpm exec tsx tests/eval/teaching-quality/run-baseline.ts --runs 5`.
   It prints ids, verdicts, flags and cost only.
4. Write the three golds. The rubrics follow, and Karl confirms them. Then re-run step 3 and grade the runs (`owner_grade`, `owner_graded_at`).

**Proof run, 2026-10-27, local Postgres, live Vertex.** The case was synthetic (`G0-2-SYNTH`, written for the test; no student text).

- 5 runs on `gemini-3.5-flash` / `lisa-default-v3` / thinking 1024: all `unscored`, no leak, no tool-request flag. Cost **$0.0237**.
- One unstored live call to the judge (`gemini-3.1-pro-preview`) with a throwaway rubric. It returned a schema-valid report, and the code made the verdict (REVIEW_NEEDED: `different_move` against the throwaway gold). Cost **$0.0072**.
- All five synthetic replies offered to use Desmos. So the real failure is not reproduced by a clean, minimal context. Whether it reproduces on the imported production contexts is the first thing the real baseline answers (§5.2).

**What a replay cannot reproduce** (stated in `import-case.ts`):

- Learning context, friction, KPI and memory are read at import time, not as they were at the turn.
- Offered videos are not replayed.
- Submission state is frozen as of the cut-off, failing closed to pre-submit.

## 10. Spec registration: both stops

Karl asked for the SCL entries that register both tables in Doc 03 §14.2 and in the Doc 05D account-deletion cascade, or a stop if either can't take them additively. **Both stop.** No SCL number was allocated.

- **Doc 05D cascade: not additive.**
  - §10.1 limits 05D to "the derived-row hard-delete across 05A/05B/05C" and the event/audit anonymisation.
  - §10.2 Layer 1 is a closed, numbered list of ten mastery-family tables, and "the migration encodes it exactly".
  - The eval tables are LISA data, not 05A/05B/05C state. Adding them would widen 05D's scope, not extend its list.
  - Deletion is still covered without it. `tutor_eval_cases.student_id → profiles ON DELETE CASCADE`, and `execute_account_deletion_cascade` deletes the profiles row in both modes (pinned by `deletion-fk-actions.pg.ci.test.ts` FK5, now 8 edges, and E4 in the new test).
  - If Karl wants it named in a spec, the natural home is Doc 03 §14.2's "All LISA tables cascade on hard delete", not 05D.
- **Doc 03 §14.2: additive only with a bounded retention period, which is Karl's call.**
  - A row can be added to the matrix additively.
  - But INV-03-19 says "No indefinite retention of student conversation data", so "until account deletion" cannot be the period.
  - Candidates, for Karl to choose from:
    - (a) the conversation's own "Active + 7 days post-entitlement-loss";
    - (b) a fixed term such as 90 days from capture, like `tutor_instruction_assignments`;
    - (c) for the life of `teaching-quality v1`, then deleted.
  - Either (a) or (b) needs a scheduled delete that does not exist yet.
  - Until this is ruled, the migration header says DO NOT APPLY TO PRODUCTION.
