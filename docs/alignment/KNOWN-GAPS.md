# Known Gaps Register

Pre-existing red areas on `main`, surfaced (not hidden) by Pass 0. Each runs in the
non-blocking `ci-known-gaps` job so its output stays visible in CI. **Nothing here is
excluded silently or faked green.** Each gap is re-armed into the required `ci` job by
the domain pass that fixes it — then its quarantine line is deleted from `.github/workflows/ci.yml`.

Status legend: 🔴 broken · 🟡 nondeterministic/external · ✅ fixed (remove the row).

---

## Typecheck — `tsc -p tsconfig.ci.json` 🔴
Two real type errors (pre-existing drift), exam domain:

- `apps/api/src/services/fullLengthExam.ts:2268` — returned question object is missing the
  required `section` field on the exam `Question` type.
- `client/src/components/full-length-exam/ExamRunner.tsx:720` — assigns `section`, which the
  `Question` type does not declare.

(Also seen under the root `tsconfig.json` only, excluded by the CI config:
`apps/workers/tutor-orchestrator/src/lib/vertex.ts:4` — missing `@google-cloud/vertexai` dep.)

**Re-arm:** move the `TypeScript Check` step back into the required `ci` job once the exam
`section` typing is reconciled. Owner: exam / full-length domain pass.

---

## Quarantined CI tests — 18 failures / 8 files 🔴
Dominant cause is **stale Supabase test mocks**: production routes (notably
`server/routes/practice-canonical.ts`) call query-builder methods the test doubles never
implemented (`.is(...)`, deeper `.select(...)` chains), so mocked queries return empty/throw
and cascade into length/equality mismatches. **No anti-leak breach is demonstrated** — e.g.
`practice-reference.contract.test.ts` fails at `toHaveLength(1)` on an *empty* payload (fails safe),
never reaching the `correct_answer`/`explanation` null assertions.

| File | Fails | Likely cause | Owner pass |
|------|-------|--------------|------------|
| `tests/ci/practice-contract.test.ts` | 9 | Stale Supabase mock (`.is`/`.select` missing) | practice-engine |
| `tests/ci/practice-reference.contract.test.ts` | 1 | Stale mock → empty payload (anti-leak fails safe) | practice-engine / anti-leak |
| `tests/ci/auth.ci.test.ts` | 2 | Public-endpoint / cookie assertions — needs individual triage | auth-entitlements |
| `tests/ci/routes.ci.test.ts` | 1 | Public `/api/questions/recent` access — needs triage | auth-entitlements |
| `tests/ci/csrf-route-family.contract.test.ts` | 1 | CSRF route-family — needs triage | auth-entitlements |
| `tests/ci/canonical-content.publish.contract.test.ts` | 2 | Publish/versioning lifecycle — needs triage | practice-engine / content |
| `tests/ci/full-length-deferred-materialization.contract.test.ts` | 1 | Materialization count ("got 2") — likely stale mock | practice-engine |
| `tests/ci/destructive-usage.audit.test.ts` | 1 | Static destructive-usage allowlist drift | testing-audit |

**Re-arm:** as each domain pass repairs its file(s), delete the matching `--exclude` line in the
required `ci` job's "green subset" step (and drop the file from the `ci-known-gaps` list).
The un-triaged rows (auth/routes/csrf/canonical-publish/destructive-audit) still need a
mock-rot-vs-real classification inside their domain pass before re-arming.

---

## Security audit — `pnpm audit` high/critical gate 🟡
Result depends on the live advisory DB, so it can flip red without any code change. Kept
non-blocking for now (Pass 0 verified 0 high/critical locally). **Re-arm:** promote to a
blocking step in the required `ci` job once a stable policy (allowlist / severity threshold)
is set. Owner: security / testing-audit pass.

---

## CodeQL advanced workflow 🟡
`.github/workflows/codeql.yml` quarantined to `workflow_dispatch` only (it failed at startup,
likely conflicting with CodeQL default setup). **Action:** a repo admin enables CodeQL
**default setup** (Settings → Code security → Code scanning) so scanning coverage is not zero.
**Re-arm:** the security pass either re-enables the advanced workflow with the conflict resolved,
or standardizes on default setup and deletes the file.

---

## Deferred to Wave 0
- `package.json` `engines.node: "22"` — completes the Node single-source-of-truth trio
  (`.nvmrc` + CI `node-version-file` + `engines`). Held out of Pass 0 to keep the
  "no `package.json` changes" boundary.
- `typecheck` script shells to `npm run check` (pnpm-only violation) — change to call `tsc`/pnpm.
- No real ESLint (the `lint` script is an `echo` stub) though Coding Standards §16/§3.2/§11
  mandate machine-enforced rules (no `any`, no `@ts-ignore`, no `useEffect`-derived-state).
  Stand up ESLint + wire it into the required `ci` job in an early dedicated pass.
