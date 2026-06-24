# WS-2 Anti-Leak Pair: EX-05 + TU-04 — Implementation Plan

> **Spec authority:** Doc 02 Preamble §12 Reveal Matrix, INV-02-08, INV-02-09;
> Doc 03 Main §17 Anti-Leak Rules; Doc 03A §6 Context Restrictions;
> Doc 03B §16 Anti-Leak at the API Boundary, INV-03-04, INV-03-12.

## Principle

These are ONE surface: the pre-submit/client-facing serialization boundary. Anti-leak
is a property of the **serialization chokepoint**, not individual fields or per-route
checks (CLAUDE.md anti-leak chokepoint rule, learned MA-07 #419). The fix is structural:
strip at the serializer, not upstream in the data path.

## GAP-EX-05 — Module-2 adaptive-bucket disclosure (INV-02-09)

### Spec ground

Doc 02 Preamble §12 Reveal Matrix:
- Pre-submit: "Stem, options, assets only"
- Post-submit review: "Answer + explanation"
- INV-02-09: "Internal option metadata and distractor taxonomy must never appear in
  client-facing responses."

`difficultyBucket` is internal adaptive-routing metadata — it is NOT stem, options,
assets, answer, or explanation. It must never reach the client on any surface.

### Disclosure sites (exhaustive catalogue)

**CLIENT-SERIALIZATION (STRIP):**
1. `apps/api/src/services/fullLengthExam.ts:280` — `SubmitModuleResult.nextModule.difficultyBucket`
2. `apps/api/src/services/fullLengthExam.ts:2665,2679` — `buildSubmittedReplayResult` populates it
3. `apps/api/src/services/fullLengthExam.ts:2769,2783` — `submitModule` primary path populates it
4. `apps/api/src/services/fullLengthExam.ts:3239` — `ExamReviewModule.difficultyBucket`
5. `apps/api/src/services/fullLengthExam.ts:3548` — review mapping `difficultyBucket: m.difficulty_bucket`
6. `server/routes/full-length-exam-routes.ts:549` — `res.json(result)` (submitModule, unstripped)
7. `server/routes/full-length-exam-routes.ts:739` — `res.json(review)` (review, unstripped)

**CLIENT-UI (REMOVE):**
8. `client/src/components/full-length-exam/FullLengthReviewView.tsx:11` — `ReviewModule.difficultyBucket`
9. `client/src/components/full-length-exam/FullLengthReviewView.tsx:125` — Badge render
10. `client/src/components/full-length-exam/ExamRunner.tsx:98` — `SubmitModuleResult.nextModule.difficultyBucket`

**SERVER-SIDE INTERNAL (KEEP):**
- `fullLengthExam.ts` adaptive selection, DB writes, materialization — all internal
- `adaptiveSelector.ts` — pool filtering, selection logic
- `exam-form-builder.ts`, `exam-form-write.ts` — form construction
- `review-session-routes.ts` — `question_difficulty_bucket` for mastery emission only
  (NOT in the buildState client response — verified)
- `practice-canonical.ts` — `resolveDifficultyBucketStrict` for mastery emission only

### Fix approach (dual-use trap avoidance)

**Do NOT remove difficultyBucket from the server's internal `submitModule` / review
return value** — the adaptive selector and other server-side consumers may read it.
Instead, strip at the **serialization boundary**:

1. Remove `difficultyBucket` from `SubmitModuleResult.nextModule` type (line 280)
2. Stop populating `difficultyBucket` in `nextModule` at lines 2665/2679 and 2769/2783
3. Remove `difficultyBucket` from `ExamReviewModule` type (line 3239)
4. Stop populating `difficultyBucket` in the review module mapping at line 3548
5. Remove `difficultyBucket` from client types and badge in `FullLengthReviewView.tsx`
   and `ExamRunner.tsx`

Wait — checking dual-use. Does any server-side code read `submitModule().nextModule.difficultyBucket`
after the call returns? Need to verify. If yes, keep it internally and strip at the route
handler. If no, removing from the return value IS the serialization boundary.

**Verified:** `submitModule` is called ONLY from `full-length-exam-routes.ts:543` and
the result goes directly to `res.json(result)`. No server-side code reads the return value's
`nextModule.difficultyBucket`. Same for `getExamReviewAfterCompletion` — called ONLY from
`full-length-exam-routes.ts:734`, result goes to `res.json(review)`. Safe to strip from
the return types and population sites.

## GAP-TU-04 — Pre-submit leak filter scoped to practice only (INV-03-04, INV-03-12)

### Spec ground

Doc 03B §16.3: Output scanning after orchestration — scans for answer-leak patterns on
ALL pre-submit contexts, not just practice.

INV-03-04: "LISA never reveals correct answers pre-submit, under any framing, for any
question type, on any surface."

INV-03-12: "Every LISA response passes through anti-leak and injection-pattern scanning
before delivery to client."

Doc 03A §6.1: Practice pre-submit — `correct_answer = null`, `explanation = null` in context.
Doc 03A §6.2: Review — always post-submit. Doc 03A §6.3: Test review — always post-submit.

### Current state

- `hasDirectAnswerLeak()` at `tutor-runtime.ts:528-541` — regex patterns detecting direct answer reveals
- Called ONLY when `source_surface === "practice"` (line 1365)
- Gate: `const isPreSubmit = itemStatus !== "answered" && itemStatus !== "skipped"` (line 1367)
- If leak detected: sends `422 TUTOR_ANTI_LEAK_BLOCKED` (line 1369-1377)

### Surface analysis

| Surface | Pre-submit possible? | Filter needed? | Currently filtered? |
|---------|---------------------|----------------|-------------------|
| practice | Yes (before answer submit) | YES | YES (line 1365) |
| review | No (always post-submit) | No | N/A |
| test_review | No (always post-submit) | No | N/A |
| dashboard | No (no question context) | No | N/A |

**Replay (GET /conversations/:id):** Returns `message: row.message` verbatim (line 915).
Per INV-03-12, scanning must occur before delivery. However, the persisted message was
already scanned before persistence (step 15 in Doc 03B §6.5). The replay returns the
already-scanned-and-persisted content. Replay is defense-in-depth — we should apply the
same filter to replay output for the practice surface.

### Fix approach (ONE structural chokepoint)

The spec says the scanner is at the orchestration output boundary — Doc 03B §16.3 step 15
fires AFTER generation, BEFORE persistence. The current filter at line 1365 is correctly
placed at this boundary. What's needed:

1. **Make the filter structurally unconditional on surface** — currently gated to practice
   only. While practice is the only surface with pre-submit state, the filter should be
   structural: check pre-submit state for ANY surface, not hard-code the surface name.
   If a new surface with pre-submit is added in the future, it's automatically covered.

2. **Add defense-in-depth to replay:** Apply `hasDirectAnswerLeak` to the `message` field
   on replay for practice conversations where the scoped item is still pre-submit.

3. **Make the filter a structural chokepoint:** Extract it so that ALL tutor message
   delivery paths (append-turn response AND replay) go through the same filter function.
   This is the "ONE chokepoint, not per-route" principle.

### Structural approach

Create a `sanitizeTutorMessageForClient` function that:
- For any surface + pre-submit: applies `hasDirectAnswerLeak` to the message text
- For all surfaces: strips any fields from `content_json` that shouldn't reach the client
  (already done by `publicTutorMessageContentJson`, fold it in)

Apply this to:
1. The append-turn response path (currently line 1365-1378)
2. The conversation replay path (currently line 911-918)

### Pre-submit state resolution by surface

| Surface | How to determine pre-submit | Implementation |
|---------|---------------------------|----------------|
| practice | `getPracticeItemStatus(userId, itemId)` — if not "answered"/"skipped" | Already exists (line 1366) |
| review | Always post-submit by definition (student already answered) | Return false |
| test_review | Gated by completion (already enforced at line 1092-1104) | Return false |
| dashboard | No question context | Return false |

### §16.4-5 silent substitution (CLOSED IN-PR — scope ruling 2026-06-24)

**Doc 03B §16.4-5 + INV-03-13:** scanner-blocked responses must be **silently substituted**
with a pedagogical fallback ("From the student's perspective, a scanner-blocked response looks
like a normal LISA turn"). The append-turn path previously returned a `422
TUTOR_ANTI_LEAK_BLOCKED` — a violation. Folded into TU-04: both block paths (append-turn
delivery + conversation replay) now emit ONE shared `TUTOR_ANTI_LEAK_SUBSTITUTION` constant the
same way (parallel-paths rule). No caller branched on the 422 (client only special-cases
`TUTOR_RECOVERABLE_RETRY_REQUIRED`), so the contract change is safe. The CI gate asserts silent
substitution on every pre-submit block path; the runtime contract test asserts the delivered +
persisted turn carries the fallback, never the leaking content.

## Six-Axis Self-Audit

| Axis | Assessment |
|------|-----------|
| **Correctness** | Removes ALL difficultyBucket from client responses; widens leak filter to replay. Both are behavioral fixes, not refactors. |
| **Determinism** | No randomness introduced. Stripping is deterministic. |
| **Scale** | No new DB queries, no new loops. Filter regex is O(n) on message length (already exists). |
| **Lyceon-compat** | Server-side adaptive selection, DB writes, mastery emission all untouched. Dual-use fields preserved server-side. |
| **Compliance** | Directly closes INV-02-09 (difficultyBucket) and strengthens INV-03-12 (replay filtering). |
| **Boring-industry-standard** | Allowlist projection at serialization boundary. Regex output scanning. Standard patterns. |

## Anti-leak chokepoint check (CLAUDE.md rule)

- EX-05: Not adding any new fields to spread objects. Removing a field from response types.
  No chokepoint risk — this is the fix direction.
- TU-04: The replay endpoint at line 900-921 builds an explicit response object (not a spread).
  The filter function will be applied to the message text. No spread risk.

## CI Gate (anti-leak probe)

New test file: anti-leak probe asserting:
1. `POST /sessions/:id/module/submit` response does NOT contain `difficultyBucket`
2. `GET /sessions/:id/review` response does NOT contain `difficultyBucket`
3. Tutor replay for practice pre-submit conversation does NOT contain leaked answer text
4. `FullLengthReviewView` does NOT render any adaptive/difficulty badge

## Files to modify

### EX-05:
- `apps/api/src/services/fullLengthExam.ts` — remove difficultyBucket from types and population
- `client/src/components/full-length-exam/FullLengthReviewView.tsx` — remove badge + type field
- `client/src/components/full-length-exam/ExamRunner.tsx` — remove type field

### TU-04:
- `server/routes/tutor-runtime.ts` — extract structural chokepoint filter, apply to replay

### Tests:
- New anti-leak CI gate test for EX-05 + TU-04 surfaces
