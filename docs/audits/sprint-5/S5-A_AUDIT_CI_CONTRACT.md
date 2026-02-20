# S5-A: `audit:ci` contract for CI gating

## Problem observed
`pnpm run audit:ci` was exiting non-zero whenever **any** vulnerability existed, because `pnpm audit` returns exit code `1` in that case, even when JSON output is redirected to `audit-output.json`.

## Intended Sprint 5 behavior
CI should:
1. Always collect the audit report JSON.
2. Fail only when **high/critical** vulnerabilities are present (enforced by the dedicated CI parsing step).

This matches the workflow design where `Security Audit` generates `audit-output.json` and `Fail on High/Critical Vulnerabilities` performs severity-based gating.

## Deterministic script contract
`audit:ci` now uses:

```json
"audit:ci": "pnpm audit --json > audit-output.json || test -s audit-output.json"
```

Meaning:
- If `pnpm audit` succeeds, script succeeds.
- If `pnpm audit` exits non-zero due to vulnerabilities, script still succeeds **only** if `audit-output.json` was produced.
- If report generation fails (empty/missing file), script fails.

This keeps report collection deterministic while preserving CI failure policy in the high/critical gate step.
