# G0-2 — Teaching-Quality Evaluation Set: Step 0 Design

**Spec:** Doc 03D §5.1 (golden set), §5.3 (judge calibration), §3.2.1 (baseline and variance band), §3.1 (tutor act), §8.1 (attribution); Doc 02B §28 (Desmos on every math surface).
**Reuses:** `docs/eval/lisa/LISA_Golden_Set_v2.md` (case format, owner-authored calibration convention, judge notes) and `docs/eval/lisa/harness-phase-a-design.md` (Class 1 / Class 2 split, fixture shape, single-generation replay; semantic "must" assertions deferred to Phase B, the judge).
**Date:** 2026-10-27
**Status:** Design only. No harness code, no exports, no model calls. Spend: $0.

---

## 1. What this set measures

One failure, seen three times in real use: **the student asks for Desmos, and LISA either agrees to it or ignores it — then keeps asking algebra questions.** The student's request for the tool that the SAT itself provides is not acted on.

A likely contributing cause, recorded here so the baseline can confirm or rule it out (not fixed in this step):

- **LISA's prompts never mention Desmos, a calculator or graphing.** `git grep -i "desmos\|calculator\|graph"` over `apps/workers/tutor-orchestrator/src/prompts` on `origin/lisa` (`988351ca`) returns nothing.
- Meanwhile, Doc 02B §28 makes Desmos available on every math surface ("the official SAT calculator… table stakes"), and the client renders it (`client/src/components/math/DesmosCalculator.tsx`).

LISA is tutoring next to a tool it has no knowledge of.

## 2. Seed cases

All three are real production conversations. Students are not named anywhere in the repository; the mapping from case to conversation is Karl's and stays out of git.

| Case | Source | When (UTC) | Item |
|---|---|---|---|
| **G0-2-01** | Production, student A | 18 Oct 2026 | from export |
| **G0-2-02** | Production, student B | 19 Oct 2026 | from export |
| **G0-2-03** | Production, Karl's own test | 27 Oct 2026, 04:07–04:10 | `SATM2UYVX9I` |

Each case is one decision point: the conversation up to and including the student's Desmos request, and the reply LISA gave there. Later turns go into the case's notes only; they are not replayed. This follows the Phase A design: "every golden-set case is a single-generation test."

## 3. Storage

### 3.1 Two files, as the golden set already does

| What | Where | Holds |
|---|---|---|
| The human-readable set | `docs/eval/lisa/LISA_Teaching_Quality_Set_v1.md` (new, versioned) | Per case, in the golden-set v2 layout: **Setup**, **Conversation so far**, **Student's current message**, **LISA must**, **LISA must not**, **Gold response** *(owner-authored)*, **Judge note**, plus **Production reply**: what LISA actually said |
| The machine fixtures | `tests/eval/teaching-quality/cases.ts` (Step 1) | One `GoldenFixture` per case (Phase A shape), with `request: OrchestrateRequest` built by `buildGoldenEnvelope()` from the exported turns and item |

**A separate set, not CASE-37+ in Golden Set v2.** Doc 03D §5.1 says a change to the golden set "invalidates cross-version comparison". Adding cases to v2 would break every v2 comparison already made. A separate, versioned set measures this failure without touching v2. *(Decision D1.)*

### 3.2 Export: owner-run, read-only

Claude Code does not read production (CLAUDE.md, "ask the catalog"). Karl runs this once per case and hands over the result. Placeholders in angle brackets are his to fill; nothing identifying goes into the repo.

```sql
-- Read-only. One case: the conversation containing the Desmos request.
-- G0-2-01 / G0-2-02: find the conversation by student and day.
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

-- Then, per conversation: the turns, in order.
SELECT role, content_kind, message, source_question_canonical_id, created_at
FROM public.tutor_messages
WHERE conversation_id = '<conversation_id>'
ORDER BY created_at;
```

### 3.3 Privacy and retention: decisions before any real text is committed

- **De-identification.** Student turns are kept word for word, apart from names, emails, schools, places and any other personal detail, which are replaced with `[redacted]`. No `student_id`, `conversation_id` or display name appears in a committed file. Karl reads and approves each excerpt before it is committed.
- **Retention.** The 7-day tier (INV-03-19) deletes a conversation only once it has been soft-deleted for more than 7 days. Live conversations stay, so the three transcripts should still exist today. But a copy committed to git is outside that deletion and outside a deletion request. Doc 03D §5.1 anticipates replacing hand-authored cases "with real conversations once production traffic exists". It does not say how a copied excerpt is treated when its student is deleted. *(Decision D2.)*
- **Export soon.** If a seed student's entitlement lapses, their conversation is soft-deleted, and 7 days later it is gone.

## 4. Judge: scoring LISA's reply against Karl's gold

This reuses the golden-set Phase B design as it stands. The Phase A design deferred semantic "must" assertions to Phase B, and v2 provides the calibration convention: owner-authored golds, written blind, with judge notes.

### 4.1 Order of checks, deterministic first

1. **Class 1, in code, no model.**
   - `hasAnswerLeak` (the same scanner as the BFF) on the reply.
   - A case heuristic, `toolRequestUnanswered`: the reply mentions none of *Desmos / calculator / graph*, and it ends in a question. That outcome is REVIEW_NEEDED, not FAIL, because a good reply could defer the tool for a reason.
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
  must:     { item: string; met: boolean;      quote: string }[];  // quote from LISA's reply
  must_not: { item: string; violated: boolean; quote: string }[];
  gold_move: "same_move" | "partial" | "different_move";           // vs Karl's gold, by pedagogical move, not wording
  tutor_act: "diagnostic_question" | "hint" | "worked_step" | "explanation"
           | "full_solution" | "affirmation" | "redirect";         // Doc 03D §3.1
  tool_request_addressed: boolean;                                 // this set's one question
}
```

The code turns that into a verdict:
- **FAIL:** any `must_not` violated, any `must` unmet, or `tool_request_addressed` false.
- **PASS:** all of these clear and `gold_move` is not `different_move`.
- **REVIEW_NEEDED:** everything else.

A leak from Class 1 overrides everything.

### 4.3 Calibration (Doc 03D §5.3)

- **Judge family.** LISA runs on Gemini (`gemini-3.5-flash`). §5.3: judges "drawn from the same family share failure modes with the model under test". So the judge should not be Gemini. *(Decision D3: which model, and the key for it.)*
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

- **Runs.** Each case is replayed *n* times on the unchanged configuration, so that §3.2.1's variance band can be set from observed variance. *(Decision D4: n; 5 is proposed.)*
- **Per-run record**, as a JSONL row in the gitignored eval cache, since it holds case text:

| Field | Value |
|---|---|
| set | `teaching-quality v1` |
| case id | e.g. `G0-2-01` |
| run | 1–*n* |
| `prompt_version` | `lisa-default-v3` |
| context hash | see §6 |
| model | the resolved alias |
| thinking budget | 1024 |
| temperature, top-p, top-k | as sent |
| worker git sha | the commit the harness imported |
| raw reply, visible reply | full text |
| Class 1 result | scanner and heuristic verdicts |
| judge response, code verdict | §4.2 |
| usage and cost | measured |

- **Production reply alongside.** The baseline report shows each case's actual production reply next to the replays. If the replays don't reproduce the failure, the replay is wrong or the failure depended on state the export didn't capture, and that has to be known before any prompt change is measured against the baseline.

### 5.3 Cost (estimate, not measured)

Per run: one LISA turn plus one judge call. 3 cases × 5 runs × (~$0.01 replay + ~$0.02 judge) ≈ **$0.45**. To be measured on the first run; the figure here is a planning number only.

## 6. Attribution

Doc 03D §8.1 requires `prompt_version` and `context_hash` on every turn: "without [them], no outcome can be attributed to any change".

**Today, on `origin/lisa` (`988351ca`):**

| Item | Status |
|---|---|
| `prompt_version` | Exists. On the worker wire, and written per turn (`server/services/tutor-runtime-writer.ts:70`) |
| `context_hash` | Exists nowhere in the code |
| Model and thinking budget per turn | Not recorded |

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

## 7. Gold responses: Karl's, not drafted

The three slots below go into the set file as they stand. Per the v2 convention, Karl writes them blind (setup, conversation and current message only) and in his own voice. Nothing has been drafted for them.

> **G0-2-01 — Gold response** *(owner-authored)*
> `[KARL — GOLD RESPONSE. NOT DRAFTED. Write blind: setup, conversation, current message only.]`

> **G0-2-02 — Gold response** *(owner-authored)*
> `[KARL — GOLD RESPONSE. NOT DRAFTED. Write blind: setup, conversation, current message only.]`

> **G0-2-03 — Gold response** *(owner-authored)*
> `[KARL — GOLD RESPONSE. NOT DRAFTED. Write blind: setup, conversation, current message only.]`

**Must / must not** for each case is the rubric the judge scores against. It is drafted after the export and after the golds, and confirmed by Karl. Writing it first would steer the golds, which v2 avoided by having the owner write blind.

## 8. Decisions for Karl

| # | Decision | Proposed |
|---|---|---|
| D1 | A separate versioned set, or CASE-37+ in Golden Set v2 | Separate: v2 comparisons stay valid |
| D2 | How committed excerpts of minors' real conversations are de-identified, and what happens to one when its student is deleted | Redact as in §3.3; remove the case on that student's deletion, and record the removal as a set version change |
| D3 | Judge model | A non-Gemini model, per §5.3; needs a key |
| D4 | Runs per case for the variance band | 5 |

## 9. Step 1 (not started)

1. Karl runs the §3.2 exports and approves the de-identified excerpts.
2. Karl writes the three golds; the rubrics follow and Karl confirms them.
3. Build:
   - export the worker's generation config;
   - build the fixtures from the real export;
   - add the `toolRequestUnanswered` heuristic;
   - write the judge schema and code verdict;
   - plant a known-bad reply (one that ignores the Desmos request and asks an algebra question) and confirm the judge and code fail it, then plant the gold and confirm it passes.
4. Run the baseline (*n* × 3) with the measured cost, then report.
