# Pass 0 — CI Baseline Reset (kickoff prompt)

This is the first pass, run **before** any scope cleanup. It replaces the dead, always-red CI with a minimal **green** baseline so later passes can actually go green. Paste the block below into your Claude Code session (it's written to use plan mode and to ground in the repo, not guess).

---

```
We're doing Pass 0 — the CI baseline reset — per the spec-align skill. Use PLAN MODE:
explore and propose a plan, and do NOT make any edits until I approve the plan.

Context: our `ci` and CodeQL checks fail at startup in ~2 seconds on every commit,
including main. They provide zero real coverage today — they're dead noise, not
protection. Goal: replace them with a minimal, REAL, GREEN pipeline on the current
tree, so from the next pass on every PR can go green. Never leave the repo without a
CI gate — replace, don't just delete.

PLAN STAGE (read-only — show me findings, then a plan, then stop):
1. Inspect `.github/workflows/` — list every workflow and job, and for each, identify
   exactly why it fails at startup (wrong/missing node or pnpm setup, missing
   `--frozen-lockfile`, stale action version, missing lockfile, wrong working dir, etc.).
   Quote the offending lines. If logs aren't available, diagnose from the YAML.
2. Inventory what can actually be checked today: read `package.json` (root + each
   workspace) for real scripts (build, typecheck, lint, test), confirm the package
   manager/lockfile (pnpm), and note which packages have tests vs none.
3. Propose a minimal green pipeline — only jobs that have something real to run:
   install (`pnpm install --frozen-lockfile`) → typecheck (`tsc --noEmit` where
   configured) → lint (if defined) → test (only packages that have tests). Pin the
   Node and pnpm versions to what the repo uses.
4. Make a clear recommendation on CodeQL/security scanning: fix it if the startup
   issue is trivial and it has something to scan; otherwise QUARANTINE it (remove from
   required checks / disable the workflow) with a TODO, rather than carry a red job.
   Tell me which and why.
5. List any clarifying questions where the repo is ambiguous (target Node version,
   whether to keep CodeQL now, whether any branch-protection "required checks" must be
   updated to match the new job names). Ask me — do NOT guess.

Hard rules: do not edit `docs/Spec`. Do not change app source, dependencies, or the
lockfile in this pass — this is CI/workflow config only. Reference, don't restate.

After I approve the plan, IMPLEMENT: write the replacement workflow, run it logically
against the current tree (and locally where possible: `pnpm install --frozen-lockfile`
then the chosen checks) and SHOW me the output proving it's green. Then open a draft PR
into `main` titled "Pass 0: CI baseline reset (green pipeline)" with a body that lists
what was removed/replaced and why, the new job set, and the local green evidence.
Append a row to `docs/alignment/LEDGER.md`. Note in the PR that branch-protection
"required checks" may need updating to the new job names — that part is mine to do in
GitHub settings.
```

---

## What to expect / your part

- It will come back with a **plan and questions first** (Node version, keep-or-quarantine CodeQL, required-checks). Answer in your normal style; it won't touch anything until you approve.
- After it opens the PR, you may need to **update branch protection** in GitHub (repo → Settings → Rules/Branches) so the *required checks* point at the new job names — otherwise the old required-check names linger and block merges. The prompt flags this; it's an admin action only you can do.
- Once Pass 0 is merged and green, run `/spec-align-plan` to lay out the domain waves, then start the scope cleanup with `anti-leak`.
