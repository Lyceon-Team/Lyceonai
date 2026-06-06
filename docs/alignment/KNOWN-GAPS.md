# Known Gaps Register

Pre-existing red areas on `main`, surfaced (not hidden) by Pass 0. Each runs in the
non-blocking `ci-known-gaps` job so its output stays visible in CI. **Nothing here is
excluded silently or faked green.** Each gap is re-armed into the required `ci` job by
the domain pass that fixes it — then its quarantine line is deleted from `.github/workflows/ci.yml`.

Status legend: 🔴 broken · 🟡 nondeterministic/external · ✅ fixed (remove the row).

---

## Exam review unlock not gated on `score_runs` 🔴 (HIGH spec-conformance — no exploitable leak today)
**Spec:** Doc 04C §2.5 / §2.7 — review reveal (`correct_answer` / `explanation` / `domain` /
`skill_code` / `difficulty`) MUST unlock only after 04B writes a successful `score_runs` row
(chain: 04A completion outbox → 04B `score_runs` → 04C gates unlock). Completion alone must NOT unlock.

**Code:** `apps/api/src/services/fullLengthExam.ts` gates reveal on `session.status === 'completed'`
(`getExamReview` `isCompleted`; `getExamReviewAfterCompletion`) with **no `score_runs` lookup** (see the
inline `@gap` note at `isCompleted`).

**Why this is deferred (Karl, Wave 1), not a hidden miss:** the async 04B / `score_runs` /
`exam_failure_ledger` pipeline is **not built** in this codebase — `score_runs` does not exist as a
table, so the spec-auditor's suggested "query `score_runs`" fix is impossible without building it.
Scoring here is **synchronous** (per-response `is_correct` is written at answer time; the report is
computed on demand), so a `completed` session is always fully scored and the spec's `scoring_pending`
leak window **cannot occur**. Gating on status is therefore **safe today but not spec-conformant**. The
anti-leak spec-auditor flagged this HIGH; it was consciously **accepted as a deferral** so Codex and
future auditors can see the reasoning rather than re-discovering it.

**Owner / re-arm:** a dedicated **exam-scoring unit** builds 04B `score_runs` + 04C state derivation
(`scored` / `partial_scored` / `scoring_pending` / `failed_requires_review`) + 04D failure ledger, then
replaces the status gate with the real `score_runs` gate. Until then, do not treat status-gating as
spec-conformant.

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

## Deleted CI contract tests — rebuild later 🔴 (decided: clean delete + rebuild)
Pass 0 **deleted** 8 stale CI contract files wholesale (Karl's call: "clean delete and
rebuild"). They were red predominantly from **stale Supabase test mocks**: production routes
(notably `server/routes/practice-canonical.ts`) call query-builder methods the test doubles never
implemented (`.is(...)`, deeper `.select(...)` chains), so mocked queries returned empty/threw.
**No anti-leak breach was demonstrated** — e.g. `practice-reference` failed at `toHaveLength(1)`
on an *empty* payload (fails safe), never reaching the `correct_answer`/`explanation` null checks.

Each deleted file must be **rebuilt** against the current routes (with a corrected Supabase mock
or a real test DB) by the owning domain pass. The ~84 passing tests inside these files were
deleted too and need re-coverage.

| Deleted file | Coverage to rebuild | Owner pass |
|--------------|---------------------|------------|
| `tests/ci/practice-contract.test.ts` | practice runtime contract (skip/replay determinism, entitlement-loss progression, anti-leak on `/next`) | practice-engine |
| `tests/ci/practice-reference.contract.test.ts` | published-MC student-safe anti-leak payloads | practice-engine / anti-leak |
| `tests/ci/auth.ci.test.ts` | auth cookie security + public-endpoint access (26 were passing) | auth-entitlements |
| `tests/ci/routes.ci.test.ts` | public route access incl. `/api/questions/recent` (20 were passing) | auth-entitlements |
| `tests/ci/csrf-route-family.contract.test.ts` | CSRF route-family enforcement | auth-entitlements |
| `tests/ci/canonical-content.publish.contract.test.ts` | publish/versioning lifecycle | practice-engine / content |
| `tests/ci/full-length-deferred-materialization.contract.test.ts` | RW1/Math1-only materialization gates | practice-engine |
| `tests/ci/destructive-usage.audit.test.ts` | static destructive-SQL allowlist guard (governance) | testing-audit |

**Re-arm:** each domain pass rebuilds its file(s) under `tests/ci/`; once green they are picked up
automatically by the required `ci` job's `pnpm run test:ci` (no exclusion list to maintain).

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
