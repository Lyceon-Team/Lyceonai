---
name: spec-align
description: The end-to-end spec-alignment pipeline for cleaning up the repo against docs/Spec. Invoke with /spec-align [scope]. Runs six gated stages — read-only audit → pull spec truth → implement → independent subagent audit → QA & edge cases → Codex-ready PR — for ONE coherent invariant domain or module at a time. Use this for every cleanup/alignment pass. Orchestrates spec-drift, new-feature, grill-me, and the spec-auditor subagent; does not duplicate them.
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(pnpm:*), Bash(git:*), Bash(gh:*), AskUserQuestion
---

# /spec-align — gated spec-alignment pipeline $ARGUMENTS

Align the codebase to `docs/Spec` for the scope given ($ARGUMENTS — an invariant domain like `anti-leak`, or a named module). Run the six stages **in order**. Each stage has a **gate**: do not advance until the gate passes. Produce the named artifact at each stage so the pass is auditable end to end.

## Operating rules (read first, every run)

- **Process-deterministic, not magic.** Same stages, same gates, same evidence every run. The *code* must satisfy Lyceon's determinism/idempotency invariants. Do not claim the generation itself is bit-deterministic.
- **Scope = ONE coherent unit.** One invariant domain (e.g. all of `anti-leak`) or one module — a real "big swing," but bounded and shippable as one reviewable PR. **If the work would span multiple invariant domains, or balloon past a few hundred lines / many unrelated files, STOP and split it into separate passes/PRs.** A diff a human can't review in one sitting is too big.
- **`docs/Spec` is canonical and read-only.** Code conforms to spec, never the reverse. Never edit `docs/Spec`. If the spec seems wrong, HALT and surface it.
- **HALT on ambiguity — never guess.** If the spec is silent or two locked docs appear to disagree, stop and ask the user (numbered options). A wrong guess propagated through code is worse than a pause.
- **The audit is independent.** Stage 4 hands the diff to the `spec-auditor` subagent, which sees only the diff and the spec — not your reasoning. Treat anything short of APPROVE as a hard loop-back.
- **Proof, not assertion.** Every gate is cleared with shown evidence (command output, file:line, the auditor's JSON), never "looks right."
- **No dead CI.** Never carry a check that always fails. CI is reset to a green baseline (Pass 0), then grows incrementally: each pass wires its own tests into CI, and from Pass 1 on the PR must be **green**. A red `main` is fixed, not tolerated.
- **Parallel swings must stay coherent.** Multiple passes may run at once. Overlap isn't forbidden — *divergence* is. Shared primitives (`packages/shared` schemas, the logger, DB utils, identity helpers, CI) land first and serially; parallel domain passes then **consume those canonical primitives rather than reinventing them**. When a pass needs a shared surface, it extends the canonical definition (or flags that it must be added to foundations) — it never forks a second version. Coordinate via `/spec-align-plan`; integration-review each merge for reuse/consistency.

---

## Stage 1 — Read-only audit  ·  gate: scope is one bounded unit

Run the drift analysis for the scope (reuse `/spec-drift [scope]` logic). **Make no edits.** Produce a short brief listing, for this unit:
- the exact `docs/Spec` file(s) + section numbers that govern it,
- the current code state (files, what exists, what's missing or drifted),
- the specific gaps, each tagged with the invariant at risk.

**Gate:** the scope is a single coherent invariant domain/module. If it spans domains or is oversized → split, tell the user the proposed split, and stop.

## Stage 2 — Pull the source of truth  ·  gate: every requirement traces to a cited section

Read the governing `docs/Spec` section(s) **in full** (not from memory). Extract into an **alignment brief** (`docs/alignment/<scope>-<date>.md`, never under `docs/Spec`):
- the invariants and contracts this unit must satisfy, each with `Doc-ID vX §Y`,
- the stated edge cases and boundary conditions the spec itself names,
- the canonical mechanisms/names to *reference* (reference-not-restate: cite values, don't transcribe them).

**Gate:** every planned behavior maps to a cited spec requirement; nothing is invented. If the spec is silent/ambiguous on something the unit needs → HALT and ask.

## Stage 3 — Implement (the code diff)  ·  gate: builds + happy-path green + annotated

Implement atomically, following `/new-feature`'s locked order: **schema (Zod in packages/shared) → pure domain logic → thin handler (auth → entitlement → parse → domain → serialize) → tests → redacted observability.** Annotate every changed unit:
`@spec [Doc-ID_version, §section] | @implemented [YYYY-MM-DD] | plain English: what it does, expected outcome, trade-offs, edge cases`.

**Gate:** `pnpm -s run build && pnpm test` green on the happy path; annotations present; no `docs/Spec` write attempted; no hard-stop invariant violated.

## Stage 4 — Independent subagent audit  ·  gate: APPROVE (hard)

Hand the diff to the **`spec-auditor` subagent** (fresh context; it reads only the diff + the cited spec, not your reasoning). It returns the JSON verdict, with each finding triaged by severity using the Lyceon framework:

- **Blocker** — violates a spec invariant, a hard-stop, or required functionality. Must be fixed.
- **SWE-improvement** — correct but below the bar (clarity, structure, missing edge handling, determinism risk). Push back and fix unless there's a real reason not to.
- **Ambiguity** — the spec is unclear or two docs disagree. Do **not** guess — HALT and ask the user.
- **Nice-to-Have** — optional polish. Log in the alignment brief; do not block on it.

**This is a hard gate, and a REJECT/PARTIAL loops back to Stage 3 — not an inline patch.** Re-enter Stage 3 and *re-implement* to address every Blocker and every legitimate SWE-improvement (the auditor's pushback drives a better implementation, not a spot-fix). Then re-run Stage 4 fresh.

- Loop Stage 3 ↔ Stage 4 until the auditor returns **APPROVE** with zero Blockers and zero auto-fails.
- **Loop cap: 3 round-trips.** If it still isn't APPROVE after three re-implementations, STOP and escalate to the user with the standing findings and your read — do not keep looping or force it through. (You may reject a specific SWE-improvement, but say why, in writing, for the user to adjudicate.)
- Keep the final APPROVE JSON and the triage history — both go in the PR body.

**Gate:** auditor returns APPROVE; zero Blockers; zero auto-fails. Ambiguities resolved by the user, not guessed.

## Stage 5 — QA & edge-case tests  ·  gate: edge tests present + green + grill-me clean

Derive edge cases from (a) the spec's stated edge cases captured in Stage 2 and (b) the invariant boundaries for this unit — e.g. for `anti-leak`: pre-submit payload, exam mid-test vs review-unlock, resume/refresh, tutor-in-review. Add the required invariant-class tests (anti-leak route / idempotency replay / auth denial / redaction, as applicable). Run the **full** suite and show output. Then run `/grill-me` on the diff as the adversarial self-review and fix every HIGH/auto-fail.

**Gate:** edge-case + invariant tests present and green; `/grill-me` returns clean.

## Stage 6 — Codex-ready PR  ·  gate: PR open + CI green (post-Pass-0) + ledger updated

Create a scoped `claude/*` branch, commit with an annotated message, push, and open a **draft PR** into the correct integration branch per the three-branch rule in `CLAUDE.md` (`questions` for question-bank work, `lisa` for LISA/tutor work, `cleanup` for everything else — **never `main`**) using the template below. Append a row to the alignment ledger (`docs/alignment/LEDGER.md`): date · scope · spec sections · PR # · auditor verdict.

**CI gate (per pass).** Ensure this unit's tests run in CI. If the CI workflow has no job covering this unit's test type, add/extend it in this PR. After Pass 0 (the CI baseline reset), **the PR must show green CI** — a red check is a real failure to fix, not noise to explain away. Do not merge a red PR.

**Pass 0 — CI baseline reset (do this before any domain pass).** The project's current `ci`/CodeQL checks fail at startup in ~2s and provide zero coverage. Treat CI/CD as the first alignment unit: replace the dead workflow with a minimal, real, **green** pipeline on the current tree — install (`pnpm --frozen-lockfile`) → typecheck → lint → test — and quarantine or remove any job that fails at startup without providing coverage. Never leave a gateless repo: replace, don't merely delete. From Pass 1 on, every PR is green.

**Gate:** draft PR open with the full body; CI green (after Pass 0); ledger row appended.

**Gate:** draft PR open with the full body; ledger row appended.

### PR body template (feeds Codex's audit)

```
## Spec alignment: <scope>

**Spec source of truth:** <Doc-ID vX §Y>, <…>  (canonical, read-only)
**Scope:** one invariant domain / module — <one line>

### What changed
- <file:line> — <behavior>, per <Doc-ID §Y>
- …  (schema → domain → handler → tests → observability)

### Invariants enforced
- <anti-leak / server-auth / determinism-idempotency / guardian / mastery-from-events / privacy> — proven by <test>

### Independent audit (spec-auditor subagent)
<paste the APPROVE JSON: compliance, findings, recommendation>

### Test evidence
<pnpm build+test summary; the edge-case tests added; grill-me result>

### For Codex review
Audit against <Doc-ID §Y>. Checklist: signatures match spec · invariants intact · no restated constants (reference-only) · edge cases covered · annotations present.

### CI
<green after Pass 0 | Pass 0 establishes the baseline>. This diff is <docs/config | scoped code>; CI job for its test type is <added | already present>.
```

---

## Definition of done (per pass)

- [ ] Scope was one bounded invariant domain/module (split if not).
- [ ] Alignment brief written; every behavior traces to a cited `docs/Spec` section.
- [ ] Implemented in the locked order; annotated; reference-not-restate held.
- [ ] `spec-auditor` returned **APPROVE** (independent, diff-only); reloop history kept.
- [ ] Edge-case + invariant tests present and green; `/grill-me` clean.
- [ ] Draft PR open with the full body; CI green (post-Pass-0); ledger row appended.
- [ ] No `docs/Spec` edit; no hard-stop invariant violated.

Then `/clear` and start the next unit. Recommended order: **Pass 0 = CI baseline reset → anti-leak → auth-entitlements → determinism-idempotency → stripe-billing → mastery-kpi → frontend** (highest-risk invariants first). For parallel execution across disjoint domains, run `/spec-align-plan` first.
