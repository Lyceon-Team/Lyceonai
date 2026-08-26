# CR-STD-01 — Two additions to the coding standards

| Field | Value |
|---|---|
| **CR ID** | `CR-STD-01` |
| **Tags** | `[STRUCTURAL]` `[NO-MIGRATION]` |
| **Target doc** | `docs/Spec/lyceon-coding-standards.md` — §13 Error Handling and §14 Testing Requirements |
| **Raised** | 2026-08-17 |
| **Raised by** | Owner ruling, session-lifecycle workstream |
| **Status** | Ruled by Karl; recorded here because `docs/Spec` is locked and immutable. Fold in when the standards doc is next drafted. |

---

## Why this exists as a CR and not as an edit

`docs/Spec` is canonical and immutable. Both principles below were **ruled by
Karl** on 2026-08-17, so they are not proposals in the usual sense — they are
settled decisions parked in the right format until the standards doc is redrafted.

---

## Principle 1 — never collapse an error into a legitimate empty value

> Empty and failed are different answers. A read that fails must not return the
> value a successful read would have returned for "there is nothing here."

**Add to §13 Error Handling.**

### Why

This is one failure class wearing three costumes, all found in the same codebase
within six weeks:

| Instance | The collapse | What the student or operator saw |
|---|---|---|
| `readDiagnosticBaseline` (`server/services/canonical-runtime-views.ts`) | `if (error \|\| !snapshots) return null` | A transient read failure told a student who had **completed** the diagnostic to go and take one. |
| `captureDiagnosticBaseline` (`server/routes/practice-canonical.ts`) | evidence gate not met → log and `return` | A silently skipped capture is indistinguishable from a student who never sat the diagnostic. Permanent `no_baseline`. |
| Mastery emission (`warn-and-continue`) | RPC failure → warn, continue, return success | `apply_mastery_event` never completed **once** in seven weeks and every request reported 200. |
| `buildScoreEstimateFromCanonical` | missing `events_total` row → `0` | A student with forty answered questions read as zero attempted, because the rollup that feeds it was empty during the outage. |

The shape is always the same: a failure is mapped onto a value that is *valid*,
*plausible*, and *silent*. Nothing downstream can tell the difference, so nothing
downstream can alert, retry, or degrade honestly.

### The rule in practice

- Return `null` / `Result.err` / throw — never the empty-but-valid value.
- `0`, `[]`, `null`-as-"none", and "not found" are **claims about the data**. Only
  make them when the read succeeded.
- A caller that receives "unknown" degrades by **omitting** the surface, not by
  rendering a default. Absent beats wrong.
- Where the distinction cannot be pushed to the caller, log with a stable code and
  make the failure countable.

### Precedent already in the tree

`readAnsweredQuestionCount` and `readDiagnosticState` both return `number | null`
/ `DiagnosticState | null` and never substitute a plausible default;
`/api/progress/projection` omits `totalQuestionsAttempted` when it is `null` rather
than printing a number nobody verified.

---

## Principle 2 — a rule and the query that feeds it are two different things to prove

> A unit test on a pure rule cannot catch a narrowed predicate upstream. The seam
> between the query and the rule needs its own proof.

**Add to §14 Testing Requirements.**

### Why

`resolveDiagnosticStartDecision` is a pure function with exhaustive unit coverage.
It is correct. It was still possible to reintroduce the "student can take a second
diagnostic" defect **without failing a single one of those tests**, by narrowing
the handler's query from `['created','active','completed']` back to
`['created','active']`: the completed row never reaches the rule, the rule returns
`allow`, and all 35 shared tests stay green.

The rule answers *"given these sessions, may they start?"*. The query answers
*"which sessions count as these sessions?"*. Proving the first says nothing about
the second.

### The rule in practice

For any decision that reads state and then applies logic to it, the test suite
must cover **both**:

1. the rule, over every input shape — a pure-function unit test; and
2. the seam, that the query actually hands the rule the rows the rule needs —
   a gate over the call site, or a test against a real database.

A source grep is the weakest acceptable form of (2) and should be a last resort:
it passes whether or not the matched call is on the chain that runs. Prefer a
recording client (see `tests/ci/stale-session-sweep.contract.test.ts`, which
records the real query chain the real function builds) or a real-Postgres gate
(see `scripts/ci/session-lifecycle-db-gate.sh`).

### Precedent already in the tree

`scripts/ci/diagnostic-once-only-gate.mjs` exists solely to cover this seam, and
was written after the unit suite was shown unable to catch the mutation.
