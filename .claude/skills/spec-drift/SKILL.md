---
name: spec-drift
description: Phase 0 — produce a read-only spec-vs-code drift report for the whole repo or a named area. Invoke with /spec-drift [area]. Makes NO edits. Produces the work backlog for the alignment passes.
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(git status:*), Bash(git diff:*)
---

# /spec-drift $ARGUMENTS — read-only drift report

**Plan mode. Make no edits, run no migrations, change nothing.** Produce a report only.

Scope: `$ARGUMENTS` if given (e.g. `api`, `packages/shared`, `practice-engine`), else the whole repo.

## Steps

1. **Ground state (report, don't act):** repo root, current branch, `git status --porcelain`. State them at the top.
2. **Map the corpus:** list the locked docs under `docs/Spec/` and the area each governs.
3. **Map the code:** for each layout area in scope (`apps/web`, `apps/api`, `apps/workers`, `server`, `client`, `packages/shared`, `infra/supabase`), inventory what exists.
4. **Diff spec vs code.** For each area produce a table:

   | Area | Spec section(s) | State | Gap / Drift | Severity | Invariant at risk |
   |---|---|---|---|---|---|

   - **State** ∈ {missing, partial, present-aligned, present-drifted}.
   - **Severity** by invariant risk: HIGH = an invariant is violable today (anti-leak, server-auth, guardian, determinism/idempotency, privacy/PII, mastery integrity); MEDIUM = structural/standards gap; LOW = cosmetic.
   - Cite the exact `docs/Spec` section. If a behavior has no governing section, say so — don't invent one.
5. **Backlog:** order the gaps into alignment passes following the locked priority:
   **anti-leak → auth/entitlements → determinism/idempotency → billing → mastery → frontend.**
   Within a pass, HIGH before MEDIUM before LOW.
6. **Open questions for Karl:** anything where the spec is ambiguous or two locked docs appear to disagree. Do not resolve these yourself.

## Output

A single markdown report: ground state → per-area tables → ordered backlog → open questions. End with the recommended first pass and the one command to start it (`/new-feature` or a scoped implement prompt). **No edits made.**
