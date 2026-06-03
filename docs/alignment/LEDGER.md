# Alignment Ledger

Append-only record of `spec-align` passes. Newest at the bottom. One row per pass.
Columns: Date · Pass · Scope · Spec basis · PR · Notes.

| Date | Pass | Scope | Spec basis | PR | Notes |
|------|------|-------|------------|----|-------|
| 2026-06-03 | Pass 0 | CI baseline reset (green pipeline) | Coding Standards §14 (CI/verification) + spec-align "Pass 0" | _pending_ | Replaced dead `ci`/CodeQL workflows (startup-failure, zero coverage) with a verified-green required `ci` job + a non-blocking `ci-known-gaps` visibility job. Node pinned via `.nvmrc` (22); pnpm 10. CodeQL advanced quarantined to manual-only; **admin must enable CodeQL default setup**. Pre-existing red areas catalogued in `KNOWN-GAPS.md` (not hidden). Deferred to Wave 0: `package.json` `engines.node`. No app source / dependency / lockfile changes. |
