# B1.1c Items 9, 10, 11 — Audit Response Report

> PR branch: `claude/lisa-tutor-inventory-27lras`
> Date: 2026-08-09
> Basis: LISA-AUDIT (PR #535 post-merge audit), Doc 03B §1.4, §16

---

## Item 9: Three blocking-write gates — SPEC SAYS NON-BLOCKING

### Karl's question
> Doc 03B §1.4 names policy-audit, question-link, and instruction-exposure writes
> as blocking for turn success. All three currently swallow failure. Make all three
> fail closed. Read §1.4 first and confirm the classification — if it says any of
> them is non-blocking, report that instead of changing it.

### §1.4 text (verbatim, Doc 03B line 137-139)

> ### **1.4 Blocking logs**
>
> Message persistence and policy-assignment persistence are blocking for every turn.
> If either fails, the turn is not treated as successful. The API does not return a
> response claiming success while canonical logs are missing.

### Classification

§1.4 explicitly limits blocking writes to exactly two categories:

1. **Message persistence** — the student and tutor message rows (`tutor_messages`)
2. **Policy-assignment persistence** — the instructional assignment record

The three writes in question are **not listed**:

| Write | File:line | §1.4 status | Current behavior |
|---|---|---|---|
| Policy-audit log | `server/services/tutor-policy-logger.ts:100-124` | NOT LISTED | Swallows; turn proceeds |
| Question links | `server/routes/tutor-runtime.ts:1011-1018` | NOT LISTED | Swallows; turn proceeds |
| Instruction exposures | `server/routes/tutor-runtime.ts:1038-1045` | NOT LISTED | Swallows; turn proceeds |

The spec's wording ("canonical logs") draws a clear line — policy-audit rows,
question-link rows, and instruction-exposure rows are non-canonical telemetry.
Their absence does not make a turn's success claim invalid per §1.4.

### Ruling requested

The code is consistent with the spec as written. **No code change made.**
If the intent is to upgrade these to blocking, that is a spec change —
surfacing to Karl per CLAUDE.md ("If a task seems to require changing a spec,
STOP and surface it to Karl").

---

## Item 10: Mirror drift — one mechanism, four files

### What was done

Created `shared/tutor-safety-constants.ts` as the single canonical source for all
pure safety functions and constants that are consumed by both the BFF
(`server/services/`) and the Cloud Run worker (`apps/workers/tutor-orchestrator/`).

The existing wire-contract pattern was extended:

| Mechanism | Before | After |
|---|---|---|
| Canonical source | `shared/tutor-orchestrator-wire.ts` | + `shared/tutor-safety-constants.ts` |
| Generated copy | `src/lib/_tutor-orchestrator-wire.generated.ts` | + `src/lib/_tutor-safety-constants.generated.ts` |
| Prebuild | `cp` one file | `cp` both files |
| CI gate | one `diff` step | two `diff` steps |

### Mirrors covered by the new gate

All three safety mirrors are now byte-identical copies, enforced by CI:

| Mirror | Was (hand-maintained) | Now (generated + gated) |
|---|---|---|
| Boundary markers (`STUDENT_INPUT_OPEN/CLOSE`) | `orchestrate.ts:196-197` ↔ `tutor-injection-defense.ts:69-70` | Both import from `shared/tutor-safety-constants.ts` |
| Answer-leak patterns + algorithm (`hasAnswerLeak`, `buildMcqPatterns`, `fractionToDecimal`, `hasGridInValueInText`, `GENERIC_LEAK_PATTERNS`, `STRUCTURAL_PREFIXES`) | `orchestrate.ts:207-311` ↔ `tutor-antileak.ts:42-190` | Both consume from `shared/tutor-safety-constants.ts` |
| Substitution text (`TUTOR_ANTI_LEAK_SUBSTITUTION`) | `orchestrate.ts:319-320` ↔ `tutor-antileak.ts:35-36` | Both consume from `shared/tutor-safety-constants.ts` |

### Mirror that CANNOT be byte-identical: TutorResult type

The fourth mirror identified by Codex:

- **Worker:** `apps/workers/tutor-orchestrator/src/lib/vertex-client.ts:66`
  `type Result<T, E> = { ok: true; value: T } | { ok: false; errorCode: E; details?: unknown }`
- **BFF:** `server/services/tutor-error-codes.ts:217`
  `type TutorResult<T, E = TutorErrorCodeKey> = { ok: true; value: T } | { ok: false; errorCode: E; details?: unknown }`

These are structurally identical (same union shape) but **adapted**:
- Different names (`Result` vs `TutorResult`)
- BFF has a default type parameter (`E = TutorErrorCodeKey`) that references a
  BFF-only type union
- Worker uses bare generics (`Result<T, E>`) with no default

A byte-identical copy is not feasible — the BFF's `TutorErrorCodeKey` import
would break the isolated worker build.

**Proposed gate:** A CI script that extracts the structural shape from both files
and asserts equivalence (same number of union branches, same field names and
types when type parameters are substituted away). Something like:

```bash
# Extract the union shape, strip names/defaults, compare
grep -A2 'type.*Result.*<T' server/services/tutor-error-codes.ts | \
  sed 's/TutorResult/Result/;s/, E = [^>]*//' > /tmp/bff-result.txt
grep -A2 'type Result<T' apps/workers/tutor-orchestrator/src/lib/vertex-client.ts \
  > /tmp/worker-result.txt
diff /tmp/bff-result.txt /tmp/worker-result.txt
```

This is a structural assertion, not a byte gate. It catches shape divergence
(e.g., adding a field to one side) while tolerating the naming adaptation.

**Not implemented in this PR** — it requires Karl's ruling on whether the
structural assertion is sufficient, or whether the type should be extracted
into a dependency-free shared file (which would mean renaming `TutorResult`
to `Result` in the BFF and dropping the default type parameter, a larger
refactor).

### Files changed

- `shared/tutor-safety-constants.ts` — **NEW** canonical source
- `apps/workers/tutor-orchestrator/src/lib/_tutor-safety-constants.generated.ts` — **NEW** generated copy
- `server/services/tutor-antileak.ts` — replaced inline definitions with imports from shared
- `server/services/tutor-injection-defense.ts` — imported boundary markers from shared
- `apps/workers/tutor-orchestrator/src/routes/orchestrate.ts` — replaced ~140 lines of inlined safety code with 4-line import from generated copy
- `apps/workers/tutor-orchestrator/package.json` — extended prebuild to copy safety constants
- `.github/workflows/ci.yml` — added safety-constants drift gate

---

## Item 11: Anti-leak scan fail-closed options — REPORT ONLY

### Problem statement

The anti-leak output scan is classified FAIL_OPEN on the MCQ path: if the regex
patterns don't match the model's phrasing, the response passes through to the
student with the correct answer potentially disclosed.

Grid-in containment is effectively fail-closed: any occurrence of the numeric
value at a word boundary (excluding structural prefixes) triggers substitution.
The value space is concrete and finite per question.

MCQ is harder: the answer is a single letter (A/B/C/D), and the model can
reference it in unbounded ways. The current 10-pattern set catches common
phrasings but is a treadmill — `the answer is <letter>` was added by hand
after a test caught it.

### Options

#### Option A: System-instruction constraint

Add an explicit instruction to the Vertex system prompt: "You must NEVER state
which option letter (A, B, C, D) is correct before the student has submitted
their answer. Do not say 'the answer is B', 'choose B', 'option B is correct',
or any equivalent phrasing."

| Dimension | Assessment |
|---|---|
| What it catches | Novel phrasings that bypass regex — the model self-censors |
| False positives | Near zero (instruction is specific) |
| False negatives | Model compliance is probabilistic, not deterministic. Under adversarial prompting, the model may override its own system instruction. Not a hard gate. |
| Cost | Zero runtime cost. ~50 tokens in system prompt. |
| Fail-closed? | **No.** Advisory, not enforced. Defense-in-depth layer only. |

#### Option B: Bare letter detection

Treat ANY standalone occurrence of the correct letter (A/B/C/D) in a pre-submit
response as suspect and substitute. "Standalone" = word boundary on both sides,
not inside a word.

| Dimension | Assessment |
|---|---|
| What it catches | Every possible MCQ leak — if the letter appears, it's caught |
| False positives | **Very high.** "Let's look at part A of the passage", "Section B discusses...", "A good approach...", mathematical uses of single letters. Would substitute ~30-50% of legitimate tutoring responses that happen to contain the correct letter as a standalone word. |
| False negatives | Near zero for the target letter. Zero if applied to all four letters. |
| Cost | High false-positive rate degrades tutoring quality significantly. |
| Fail-closed? | **Yes, but unusably aggressive.** |

#### Option C: Structured output separation

Use Vertex structured output (JSON mode / function calling) to force the model
to return its response in a structured format that separates pedagogical
reasoning from any answer reference. E.g.:

```json
{
  "tutoring_response": "Let's think about what the passage says about...",
  "internal_reasoning": "The student seems confused about inference questions",
  "answer_reference": null  // null = no answer referenced; "B" = referenced
}
```

Strip `answer_reference` and `internal_reasoning` before delivery. Only
`tutoring_response` reaches the student.

| Dimension | Assessment |
|---|---|
| What it catches | Any answer reference the model correctly classifies into the structured field |
| False positives | Low — the model can discuss concepts freely in `tutoring_response` |
| False negatives | Model may embed answer hints in `tutoring_response` despite the structure. Structured output compliance is high but not 100%. |
| Cost | Moderate. Structured output adds ~20-50ms latency. Requires Vertex function-calling setup. Changes the wire contract shape. |
| Fail-closed? | **Partially.** The structural separation is enforced, but content within `tutoring_response` is still unscanned unless combined with regex. |

#### Option D: Hybrid — system instruction + expanded regex + bare-letter heuristic with context window

Combine A + expanded regex patterns + a context-aware bare-letter check:
the bare letter is only flagged if it appears in a "conclusive" context
(sentence-final, after certainty language, in a list of eliminated options
where only one remains, etc.).

| Dimension | Assessment |
|---|---|
| What it catches | Novel phrasings (via instruction), known phrasings (via regex), contextual leaks (via heuristic) |
| False positives | Moderate — better than Option B, worse than Option A alone. Tunable. |
| False negatives | Lower than any single approach. Still not zero — truly novel phrasing in non-conclusive context can slip through. |
| Cost | Most complex to implement and maintain. Each heuristic rule needs testing. |
| Fail-closed? | **Closer but not absolute.** The heuristic layer narrows the gap without the false-positive explosion of Option B. |

### Recommendation (for Karl's ruling)

**Option A (system instruction) is zero-cost and should be added regardless** —
it reduces the surface area the regex needs to cover.

For the hard gate, **Option C (structured output)** is the cleanest path to
fail-closed: it moves answer containment from content scanning (always a
treadmill) to structural separation (architecturally enforceable). It requires
wire contract changes and Vertex function-calling integration, making it a
B1.2+ scope item.

Option D is the pragmatic middle ground if structured output is deferred:
better coverage than today with manageable false positives.

Option B is not viable at the current false-positive rate.
