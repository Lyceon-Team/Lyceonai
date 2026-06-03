# Alignment Ledger

Append-only record of `spec-align` passes. Newest at the bottom. One row per pass.
Columns: Date · Pass · Scope · Spec basis · PR · Notes.

| Date | Pass | Scope | Spec basis | PR | Notes |
|------|------|-------|------------|----|-------|
| 2026-06-03 | Pass 0 | CI baseline reset (green pipeline) | Coding Standards §14 (CI/verification) + spec-align "Pass 0" | #325 | Root cause of "dead CI" was org-level disabling of GitHub-hosted runners (every run startup-failed, no runner) — re-enabled by Karl, not a workflow bug. Replaced the dead `ci`/CodeQL workflows with a verified-green required `ci` job (install → route:validate → test:security → test:ci → build → dist-check) + a slim non-blocking `ci-known-gaps` job (source typecheck + audit). **Deleted 8 stale CI contract test files wholesale** (Karl's call: clean delete + rebuild later; catalogued in `KNOWN-GAPS.md`). Node pinned via `.nvmrc` (22); pnpm 10. CodeQL advanced quarantined to manual-only; **admin must enable CodeQL default setup** + set branch-protection required check to `ci`. Deferred to Wave 0: `package.json` `engines.node`, npm-shelling typecheck script, ESLint. No app source / dependency / lockfile changes. |
