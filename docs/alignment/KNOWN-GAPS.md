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

## Deferred to Wave 0 ✅ RESOLVED 2026-06-05 via #332
All three items shipped in Wave 0 (#332): `package.json` `engines.node: "22"` added (completing
the `.nvmrc` + CI `node-version-file` + `engines` Node SSOT trio); the `typecheck` script de-npm'd
to pnpm; ESLint stood up (flat config, §17 hard-stops at error — BLOCKING for `packages/shared`,
ADVISORY for the legacy tree via `ci-known-gaps`).

---

# Codex audit 2026-06-06 — open findings & fast-follows (priority order)

## TUTOR-VERBATIM-PERSIST (P0 — URGENT — BLOCKS BUNDLE PUBLICATION)

**Status:** Stop-the-bleed feature flag applied via PR #335
(2026-06-06). Production has `TUTOR_VERBATIM_PERSIST` unset; no new
verbatim exchanges persist. Existing rows in `tutor_interactions.message`
and `.answer` predating PR #335 remain in the table.

**Origin:** Codex audit 2026-06-06, F-006.

**Outstanding work:**
- **Backfill:** existing verbatim rows in `tutor_interactions.message` and
  `.answer` predating the stop-the-bleed PR must be redacted, summarized,
  or hard-deleted per the tutor-runtime unit's retention design
- **Replacement design:** non-verbatim summarization layer that preserves
  operational value (debugging tutor performance, mastery signal
  correlation, safety review) without persisting raw exchanges
- **Schema change:** the `message` and `answer` columns must be dropped or
  repurposed per the tutor-runtime unit's design
- **Retention enforcement:** implement Doc 03 Main §14.2 retention horizons
  on the replacement schema (7-day soft-delete, 90/180/365-day archival
  cron)
- **Stop-the-bleed flag removal:** once the replacement schema lands and
  the column drop migration ships, the `TUTOR_VERBATIM_PERSIST` flag and
  its conditional logic are removed (the flag was a transition aid, not a
  long-term config)

**Spec citations:**
- Privacy Policy V1.0 §3.4 — Tutor conversations are ephemeral and
  non-verbatim
- Privacy Policy V1.0 §9.7 — LISA 7+90-day retention model
- Coding Standards §12.2 — Tutor conversations are ephemeral; do not
  store raw exchanges verbatim
- Doc 03 Main V1.1 §14.2 — LISA Data Retention Matrix (10 LISA tables,
  7-day soft-delete, 90/180/365-day archival crons)

**Owner:** `tutor-runtime` unit (Wave 2 P0)

**Blocks:**
- Privacy Policy V1.0 bundle publication (RP-LC-04 across all 8 artifacts)
- EU/UK/Ireland launch (GDPR Article 5(1)(c) data minimization principle
  compounds Privacy Policy violation)

**Reactivation trigger:** N/A — this is the gap itself. Resolved when:
1. Backfill of existing rows complete (operational evidence)
2. Replacement schema deployed and serving traffic
3. `tutor_interactions.message` / `.answer` columns dropped via migration
4. Stop-the-bleed flag removed from `tutor-log.ts`
5. Doc 03 §14.2 retention crons running and proving via 06D INV-06-09
   restore-test pattern

---

## IDEMPOTENCY-KEY-API-CONTRACT (P0 — Wave 2 owns)

**Status:** Open. Practice answer submit and full-length test answer submit
endpoints accept `clientAttemptId` / `client_attempt_id` instead of the
spec-required `idempotency_key`. Behavior may be functionally idempotent
via the existing field, but a spec-conformant client following Coding
Standards §4.2 would send `idempotency_key` and receive no replay
protection (Zod schemas strip unknown keys by default).

**Origin:** Codex audit 2026-06-06, F-003 + F-004.

**Outstanding work:**
- Practice answer submit (`server/routes/practice-canonical.ts:168-177`):
  accept `idempotency_key` as an additional accepted field; normalize
  internally to the same idempotency path `clientAttemptId` uses;
  **maintain `clientAttemptId` as a back-compat alias for one release
  cycle**, then remove in the next release
- Full-length test answer submit
  (`server/routes/full-length-exam-routes.ts:41-46`): same fix pattern;
  rename downstream to consume `idempotency_key` canonically; alias
  `client_attempt_id` for one release cycle
- Contract test for each endpoint asserting that both `idempotency_key`
  and the legacy field name produce equivalent idempotent behavior (same
  replay key produces same response without double-processing)
- Update OpenAPI / client SDK / docs to reference `idempotency_key` only
  after the back-compat period ends

**Spec citations:**
- Coding Standards §4.2 — Idempotency Is Required for Mutations (lists
  `idempotency_key` as the field name for practice and test answer submit)
- Coding Standards §7.2 — Single source of truth for API contracts (the
  schema is the contract; field-name divergence is a contract violation)

**Owner:** `determinism-idempotency` unit (Wave 2)

**Fix style decision (Karl, 2026-06-06):** back-compat alias for one
release cycle, then hard-rename.

---

## MATH-RANDOM-QUESTIONS-RUNTIME (P1 — Wave 2 owns)

**Status:** Open. `server/routes/questions-runtime.ts:157-158` uses
`Math.random()` for question ordering in the random-question endpoint.
Selection is non-deterministic across identical inputs.

**Origin:** Codex audit 2026-06-06, F-001. Pre-existing drift documented
in the original spec-alignment plan as a HIGH determinism finding.

**Outstanding work:**
- Replace `[...data].sort(() => Math.random() - 0.5).slice(0, limit)` with
  `@lyceon/shared` seeded RNG `seededShuffle` + `deriveSelectionSeed`
- Derive seed from stable inputs: profile_id (or auth user_id for
  unauthenticated) + filter_hash + session_id (or request_id where session
  is not applicable)
- Add deterministic-replay test: same seed + same input set → same output
  ordering

**Spec citations:**
- Coding Standards §4.1 — Selection must be stable and explainable
- Coding Standards §4.3 — Server is source of truth for state and time
- Doc 02B §684 — Seeded Fisher-Yates contract

**Owner:** `determinism-idempotency` unit (Wave 2)

---

## UNSEEDED-FISHER-YATES-PRACTICE (P1 — Wave 2 owns)

**Status:** Open. `server/routes/practice-canonical.ts:364-368` defines
`fisherYates` helper using `crypto.randomInt(0, i + 1)` — cryptographically
random but unseeded. Used at line 1208 for fresh practice question
ordering. Practice selection varies across identical inputs and refreshes.

**Origin:** Codex audit 2026-06-06, F-002. Pre-existing drift documented
in the original spec-alignment plan as a HIGH determinism finding.

**Outstanding work:**
- Replace local `fisherYates` helper with `@lyceon/shared` `seededShuffle`
- Derive selection seed via
  `deriveSelectionSeed(profileId, filterHash, sessionId)` per Doc 02B §684
- Add deterministic-replay test: same session_id + same filter + same
  profile → same ordering

**Spec citations:**
- Coding Standards §4.1 — Selection must be stable and explainable
- Doc 02B §684 — Seeded Fisher-Yates contract

**Owner:** `determinism-idempotency` unit (Wave 2)

---

## SIGNIN-MISSING-SAFEPARSE (P2 — auth-entitlements fast-follow)

**Status:** Open. `server/routes/supabase-auth-routes.ts:347-355` `/signin`
handler reads `req.body` directly without a Zod `safeParse` boundary.
Other handlers in the same file (signup, admin provisioning) use the
Zod-first pattern. Signin is inconsistent.

**Origin:** Codex audit 2026-06-06, F-005.

**Outstanding work:**
- Define `signinSchema` in `packages/shared` per §7.2 SSOT
- Replace `const { email, password } = req.body` + manual validation with
  `signinSchema.safeParse(req.body)` and the standard error response path
- Verify the existing `!email || !password` defensive check is functionally
  equivalent to the Zod parse (it is, but Zod gives structured error
  details and locks the schema for future additions)

**Spec citations:**
- Coding Standards §7.1 — All external inputs must be safeParse'd before
  entering business logic
- Coding Standards §7.2 — Single source of truth lives in
  `packages/shared`

**Owner:** `auth-entitlements` unit (fast-follow PR off cleanup) — small
enough to ship as a standalone PR without queueing behind a Wave

---

## TSCONFIG-STRICTNESS-INCOMPLETE (P2 — platform fast-follow)

**Status:** Open. `tsconfig.json` and `tsconfig.ci.json` enable
`strict: true` but omit the three additional flags Coding Standards §3.1
requires:
- `noUncheckedIndexedAccess`
- `noImplicitReturns`
- `exactOptionalPropertyTypes`

**Origin:** Codex audit 2026-06-06, F-007. Missed by Wave 0 spec-auditor.

**Outstanding work:**
- Add the three flags to `tsconfig.json` and `tsconfig.ci.json`
- Resolve resulting type errors throughout the codebase (significant
  effort — could surface many small fixes)
- If full resolution is too large for one PR, baseline the new errors in
  `tsconfig.ci.json` exclusions and track each remaining error as a
  sub-gap with a target unit owner

**Spec citations:**
- Coding Standards §3.1 — `tsconfig.json` must include `strict`,
  `noUncheckedIndexedAccess`, `noImplicitReturns`, `exactOptionalPropertyTypes`

**Owner:** `platform` (could be a dedicated `tsconfig-hardening` unit or
rolled into the next Wave touching platform config)

**Sub-risk:** Enabling `exactOptionalPropertyTypes` is particularly
disruptive — it changes the semantics of `{ x?: T }` versus
`{ x?: T | undefined }`. Plan accordingly; this may surface incompatible
API shapes that need refactoring.

---

## SHARED-TYPES-VALIDATE-SHADOW (P2 — platform fast-follow)

**Status:** Open. `packages/shared/src/types.ts` hand-defines types
(`AnswerKey`, `SectionCode`, `QuestionType`, `Difficulty`, `SourceType`,
`QuestionOption`) that shadow Zod schemas in `validate.ts`
(`answerKeySchema`, `sectionCodeSchema`, etc.). Coding Standards §7.2
requires types to be inferred from Zod schemas, not hand-defined.

**Origin:** Codex audit 2026-06-06, F-008. Pre-existing; flagged by Wave 0's
own spec-auditor; previously tracked only in LEDGER.md.

**Outstanding work:**
- Delete hand-defined types in `types.ts` for any concept that has a
  corresponding Zod schema in `validate.ts`
- Replace with `export type X = z.infer<typeof xSchema>`
- Verify all importers continue to type-check (the inferred types should
  be identical to the hand-defined ones)
- Where a type has no corresponding schema and a schema would be
  appropriate, add the schema and infer

**Spec citations:**
- Coding Standards §7.2 — Define Zod schema first; infer TypeScript types
  from it; never define both separately

**Owner:** `platform` (could be a small standalone PR or rolled into a
broader `packages/shared` consolidation pass)

---

## AUDIT-PAYLOAD-CONTRACT-DRIFT (P2 — auth-entitlements fast-follow)

**Status:** RESOLVED 2026-06-06 via PR #335 (D3). The contract test
`tests/ci/guardian-entitlement.admin-audit.contract.test.ts` now locks BOTH
surfaces with exact-equality: payload `{ method, path, studentId }` and logger
context `{ userId, requestId }`. PR #334's 5-key emission claim was correct in
substance (split across payload + context); the test was loose and now matches.

Original finding: PR #334 claimed the admin audit emission has exact
key-set `{ studentId, path, method, userId, requestId }`. The contract
test asserted only `{ method, path, studentId }` for the payload
(`dataArg`). `userId` and `requestId` are passed as logger context, not
as payload keys. The test did not lock the full claimed emission.

**Origin:** Codex audit 2026-06-06, F-009.

**Outstanding work (per Karl's lean — split payload-from-context):**
- Strengthen the contract test in
  `tests/ci/guardian-entitlement.admin-audit.contract.test.ts`:
  - Assert `Object.keys(dataArg).sort()` equals exactly
    `['method', 'path', 'studentId']` (payload is locked)
  - Add a separate assertion that the logger context contains `userId`
    and `requestId` (logger metadata is locked)
- Update `LEDGER.md` row for PR #334 to clarify the audit structure:
  "structured audit log with payload `{ studentId, path, method }` and
  logger context `{ userId, requestId }`"

**Spec citations:**
- Doc 01 V6 §1229 — Admin support-purpose audit
- Doc 01 V6 §272 / §561 — All admin actions audited
- Coding Standards §12.1 — No logging of sensitive content
  (access-metadata only)

**Owner:** `auth-entitlements` unit (fast-follow PR; ~30 minutes of work)

**Note:** This entry is closed by D3 (contract test strengthening), which
lands in the same combined audit-response PR. Marked RESOLVED at D3.

---

## CI-PULLREQUEST-BRANCH-FILTER (P3 — trivial)

**Status:** RESOLVED 2026-06-06 via PR #335 (D2 corrected the
LEDGER Wave-0 row to state `pull_request` is unscoped). PR #332 claimed
`pull_request: [main, cleanup]`; actual config has `pull_request:`
unscoped (triggers on PRs to any branch) — functionally broader than
claimed (more CI coverage, not less). The actual config was NOT tightened
(broader trigger is preferable); only the ledger claim was corrected.

**Origin:** Codex audit 2026-06-06, F-010.

**Spec citations:** N/A (claim-accuracy issue, not a spec violation)

**Owner:** `platform` (trivial ledger edit)

---

## LEDGER-AUTH-ROW-MISSING (P3 — trivial)

**Status:** RESOLVED 2026-06-06 via PR #335 (D2 appended the
missing PR #334 row). The row was lost during the Wave 1 merge
(append-conflict resolution between #334 and #333).

**Origin:** Codex audit 2026-06-06, F-011.

**Spec citations:** N/A (ledger hygiene)

**Owner:** `platform` (trivial append)

---

## LOGGER-RELOCATION (P3 — Wave 2 or later)

**Status:** Open. Logger currently lives in a non-canonical location;
should be relocated to `packages/shared` (or canonical platform module)
and migrated to `@lyceon/shared` import path. Previously tracked only in
`LEDGER.md` fast-follow.

**Origin:** Wave 0 fast-follow.

**Outstanding work:**
- Identify current logger module location and the set of importers
- Relocate to `packages/shared/src/logger.ts`
- Migrate importers to `@lyceon/shared`
- Verify no second logger / redaction implementation survives

**Spec citations:**
- Coding Standards §2 — Monorepo Layout (single source of truth for
  cross-cutting modules)
- Coding Standards §12.1 — Logging must be structured and redact by
  default (single canonical implementation)

**Owner:** TBD (probably `platform` or rolled into a Wave that needs to
touch the logger anyway)

---

## SHARED-IMPORT-MIGRATION (P3 — ongoing)

**Status:** Open. Legacy code imports use `@shared/*` paths. Wave 0
introduced `@lyceon/shared` as the canonical alias. Wave 0 standing rule:
migrate `@shared/*` imports of touched files only; no NEW `@shared/*`
imports anywhere. Bulk migration of remaining legacy imports is
fast-follow. Previously tracked only in `LEDGER.md` fast-follow.

**Origin:** Wave 0 fast-follow.

**Outstanding work:**
- Enumerate remaining `@shared/*` imports
- Migrate in batches grouped by domain or by file co-location
- Each batch is a small PR; not a single mega-migration
- Verify no NEW `@shared/*` imports introduced during the migration
  period (lint rule could help)

**Spec citations:**
- Coding Standards §2 — Monorepo Layout (single canonical alias)

**Owner:** Distributed across Wave 2+ units (each unit migrates the
imports of files it touches)

---

## ENV-RECONCILIATION (P3 — blocked on Doc 06A/06B)

**Status:** Open. `packages/shared/src/env.ts` Zod schema is PROVISIONAL —
observed contract, not yet reconciled against Doc 06A
(Infrastructure/Environments) and Doc 06B (Security Ops/Secrets/Access).
No consumer migrates onto the schema until reconciliation completes.
Previously tracked only in `LEDGER.md` fast-follow.

**Origin:** Wave 0 fast-follow.

**Outstanding work:**
- Compare current PROVISIONAL env shape against Doc 06A V1.0 env-management
  and Doc 06B V1.0 secrets-management sections
- Reconcile any divergences (rename, restructure, add missing required
  fields)
- Once reconciled, lock the schema and migrate consumers off ad-hoc
  `process.env.X` reads onto `env.X` validated reads
- Until then, the schema is informational only

**Spec citations:**
- Coding Standards §7.3 — Validate environment variables at startup
- Doc 06A V1.0 (env management section)
- Doc 06B V1.0 (secrets management section)

**Owner:** `platform` (likely coordinated with the first Wave that consumes
env validation)

---

## LINT-GRADUATION (P3 — ongoing)

**Status:** Open. ESLint config has `packages/shared` as BLOCKING (errors
fail CI) and legacy tree as ADVISORY (runs in `ci-known-gaps` job,
surfaces warnings but does not block). Goal is to graduate the legacy
tree to BLOCKING over time as files are cleaned up. Previously tracked
only in `LEDGER.md` fast-follow.

**Origin:** Wave 0 fast-follow.

**Outstanding work:**
- As each Wave 2+ unit touches files in the legacy tree, the files become
  subject to lint-clean discipline (Wave 0 standing rule)
- Track which directories have been promoted from advisory to blocking
- Eventually flip the legacy-advisory job to blocking once advisory output
  is consistently clean

**Spec citations:**
- Coding Standards §16 — Linter (ESLint + `@typescript-eslint`)
- Coding Standards §17 — Hard stops (no `any`, no `@ts-ignore`, no silent
  catch)

**Owner:** Distributed across Wave 2+ units (each cleans up the files it
touches)

---

## CODING-STANDARDS-FILENAME (P3 — trivial)

**Status:** Open. The canonical Coding Standards file lives at
`docs/Spec/lyceon-coding-standards (1).md`. The `(1)` suffix suggests an
upload duplication or rename artifact. Audit reproducibility benefits from
a clean filename.

**Origin:** Codex audit 2026-06-06, out-of-scope observation.

**Outstanding work:**
- Rename `docs/Spec/lyceon-coding-standards (1).md` →
  `docs/Spec/Coding_Standards.md` (content-preserving `git mv`, not delete+add)
- Update the live references to the old filename: `CLAUDE.md` `@import`
  (line ~72) and this entry. (The `skill-drafts/anti-leak-workspace/.../response.md`
  hit is a frozen eval transcript — leave it.)

**Spec citations:** N/A (file hygiene)

**Owner:** `platform` (trivial rename)

**Note:** D4 (the rename) was **DEFERRED** (Karl, 2026-06-06, option c). The
`git mv` of a `docs/Spec` file is denied by the docs/Spec immutability boundary
(the permission system blocks it to keep the "never edit/move/improve docs/Spec"
rule intact), so the rename was NOT performed in PR #335. **Remains Open (P3)** —
resolved when the owner performs the content-preserving `git mv` and the live
references above are updated. Not blocking.
