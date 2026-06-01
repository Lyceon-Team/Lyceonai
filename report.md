# docs/* Classification Audit Report

## 1. Summary

- **Verdict on whether `docs/*` is currently only spec documents with runtime directions**: `FAIL`

There are active sprint checklists, QA documents, implementation status trackers, security audits, and superseded documents mixed into the canonical docs structure.

## 2. Inventory table

| Path | Doc Type | Status | Primary Classification | Purpose |

|---|---|---|---|---|

| `analytics-event-taxonomy.md` | `MIXED` | Active | `REVIEW_MANUALLY` | Analytics Event Taxonomy |
| `AUTH_SECURITY.md` | `PRODUCT_SPEC` | Active | `KEEP_IN_CANONICAL_DOCS` | Auth and Security Architecture (Server Truth) |
| `entitlements-map.md` | `PRODUCT_SPEC` | Active | `KEEP_IN_CANONICAL_DOCS` | Entitlements Map |
| `ENV.md` | `PRODUCT_SPEC` | Active | `KEEP_IN_CANONICAL_DOCS` | Environment Variables - GitHub Native |
| `FULL_LENGTH_EXAM_IMPLEMENTATION.md` | `MIXED` | Active | `REVIEW_MANUALLY` | Full-Length SAT Exam Implementation Summary |
| `FULL_LENGTH_EXAM_SECURITY_SUMMARY.md` | `MIXED` | Active | `REVIEW_MANUALLY` | Full-Length SAT Exam - Security Summary |
| `OPERATIONS.md` | `WORKFLOW_OR_SPRINT_ARTIFACT` | Active | `MOVE_OUT_OF_CANONICAL_DOCS` | Operations Guide |
| `pr3-hardening-verification.md` | `LEGACY_OR_SUPERSEDED_SPEC` | Archived | `ARCHIVE_SUPERSEDED` | PR #3 Hardening Pass - Final Verification Report (Archived) |
| `route-registry.md` | `LEGACY_OR_SUPERSEDED_SPEC` | Superseded | `ARCHIVE_SUPERSEDED` | Route Registry |
| `SECURITY_RUNBOOK.md` | `WORKFLOW_OR_SPRINT_ARTIFACT` | Active | `MOVE_OUT_OF_CANONICAL_DOCS` | 🔒 Lyceon Security Runbook |
| `SEO_CRAWLABILITY.md` | `COMPLIANCE_OR_POLICY_DOC` | Active | `KEEP_IN_CANONICAL_DOCS` | SEO Crawlability Verification |
| `supabase-auth-setup.md` | `PRODUCT_SPEC` | Active | `KEEP_IN_CANONICAL_DOCS` | Supabase Auth Setup Guide (Current Runtime) |
| `calendar/CALENDAR_RUNTIME_CONTRACT.md` | `MIXED` | Active | `REVIEW_MANUALLY` | Calendar Runtime Contract |
| `calendar/CALENDAR_SOURCE_OF_TRUTH.md` | `SCHEMA_OR_DATA_CONTRACT` | Active | `KEEP_IN_CANONICAL_DOCS` | Calendar Source Of Truth |
| `compliance/04-retention-deletion.md` | `WORKFLOW_OR_SPRINT_ARTIFACT` | Active | `MOVE_OUT_OF_CANONICAL_DOCS` | Retention and Deletion Architecture |
| `content/CANONICAL_QUESTION_SOURCE_OF_TRUTH.md` | `SCHEMA_OR_DATA_CONTRACT` | Draft | `KEEP_IN_CANONICAL_DOCS` | CANONICAL QUESTION SOURCE OF TRUTH |
| `contracts/db-reconciliation-practice-first.md` | `RUNTIME_CONTRACT` | Active | `KEEP_IN_CANONICAL_DOCS` | DB Reconciliation Audit (Practice-First) |
| `contracts/full-length-contract.md` | `RUNTIME_CONTRACT` | Active | `KEEP_IN_CANONICAL_DOCS` | Full-Length Contract |
| `contracts/full-length-smoke.md` | `RUNTIME_CONTRACT` | Active | `KEEP_IN_CANONICAL_DOCS` | Full-Length Deferred Adaptive Smoke (Hard-Kill Remains) |
| `contracts/legacy-canonicalization.md` | `RUNTIME_CONTRACT` | Active | `KEEP_IN_CANONICAL_DOCS` | Legacy Table/Path Canonicalization |
| `contracts/practice-contract.md` | `RUNTIME_CONTRACT` | Active | `KEEP_IN_CANONICAL_DOCS` | Practice Contract |
| `contracts/practice-smoke.md` | `RUNTIME_CONTRACT` | Active | `KEEP_IN_CANONICAL_DOCS` | Practice Post-Unlock Smoke (Canonical Runtime) |
| `contracts/rate-limit-db-truth-contract.md` | `RUNTIME_CONTRACT` | Active | `KEEP_IN_CANONICAL_DOCS` | Rate-Limit DB Truth Contract |
| `contracts/review-contract.md` | `RUNTIME_CONTRACT` | Active | `KEEP_IN_CANONICAL_DOCS` | Review Contract |
| `contracts/review-db-verification.md` | `RUNTIME_CONTRACT` | Active | `KEEP_IN_CANONICAL_DOCS` | Review Live DB Verification Queries |
| `contracts/review-smoke.md` | `RUNTIME_CONTRACT` | Active | `KEEP_IN_CANONICAL_DOCS` | Review Unlock Smoke (Three-Mode Canonical Runtime) |
| `contracts/runtime-law.md` | `RUNTIME_CONTRACT` | Active | `KEEP_IN_CANONICAL_DOCS` | Lyceon Runtime Contract |
| `contracts/runtime-route-coverage.md` | `RUNTIME_CONTRACT` | Active | `KEEP_IN_CANONICAL_DOCS` | Runtime Route Coverage Matrix |
| `docs/architecture/APPS_API_ALLOWLIST.md` | `PRODUCT_SPEC` | Active | `KEEP_IN_CANONICAL_DOCS` | APPS API ALLOWLIST |
| `docs/architecture/APPS_API_DEPRECATION_BACKLOG.md` | `LEGACY_OR_SUPERSEDED_SPEC` | Superseded | `ARCHIVE_SUPERSEDED` | APPS API DEPRECATION BACKLOG |
| `docs/architecture/canonical-question-id.md` | `MIXED` | Active | `REVIEW_MANUALLY` | canonical-question-id.md |
| `exams/EXAM_SOURCE_OF_TRUTH.md` | `LEGACY_OR_SUPERSEDED_SPEC` | Superseded | `ARCHIVE_SUPERSEDED` | EXAM SOURCE OF TRUTH |
| `exams/FULL_TEST_SOURCE_OF_TRUTH.md` | `SCHEMA_OR_DATA_CONTRACT` | Active | `KEEP_IN_CANONICAL_DOCS` | FULL TEST SOURCE OF TRUTH |
| `guardian/GUARDIAN_RUNTIME_CONTRACT.md` | `RUNTIME_CONTRACT` | Active | `KEEP_IN_CANONICAL_DOCS` | Guardian Runtime Contract |
| `guardian/GUARDIAN_SOURCE_OF_TRUTH.md` | `SCHEMA_OR_DATA_CONTRACT` | Active | `KEEP_IN_CANONICAL_DOCS` | Guardian Source Of Truth |
| `guardian/GUARDIAN_TRUST_SOURCE_OF_TRUTH.md` | `LEGACY_OR_SUPERSEDED_SPEC` | Superseded | `ARCHIVE_SUPERSEDED` | Guardian Trust Source of Truth |
| `kpis/KPI_SOURCE_OF_TRUTH.md` | `LEGACY_OR_SUPERSEDED_SPEC` | Superseded | `ARCHIVE_SUPERSEDED` | KPI Source of Truth |
| `mastery/MASTERY_EVENT_TAXONOMY.md` | `PRODUCT_SPEC` | Active | `KEEP_IN_CANONICAL_DOCS` | Mastery Event Taxonomy |
| `mastery/MASTERY_SOURCE_OF_TRUTH.md` | `LEGACY_OR_SUPERSEDED_SPEC` | Superseded | `ARCHIVE_SUPERSEDED` | Mastery Source of Truth |
| `practice/PRACTICE_RUNTIME_CONTRACT.md` | `RUNTIME_CONTRACT` | Active | `KEEP_IN_CANONICAL_DOCS` | Practice Runtime Contract |
| `qa/guardian.md` | `WORKFLOW_OR_SPRINT_ARTIFACT` | Active | `MOVE_OUT_OF_CANONICAL_DOCS` | Guardian/Parent Profile QA Checklist |
| `qa/release-gates.md` | `LEGACY_OR_SUPERSEDED_SPEC` | Superseded | `ARCHIVE_SUPERSEDED` | Guardian Feature Release Gates |
| `runtime/apps-api-runtime.md` | `PRODUCT_SPEC` | Active | `KEEP_IN_CANONICAL_DOCS` | apps/api runtime reality (authoritative) |
| `security/SERVER_AUTHZ_AUDIT_2026-03-11.md` | `PRODUCT_SPEC` | Active | `KEEP_IN_CANONICAL_DOCS` | Server Authorization Audit (Code-Derived) |
| `security/SUPABASE_RLS_AUDIT_2026-03-11.md` | `PRODUCT_SPEC` | Active | `KEEP_IN_CANONICAL_DOCS` | Supabase RLS Audit (Code/Policy-Derived) |
| `security/pen-test/2026-03-02/FINDINGS.md` | `AUDIT_ARTIFACT` | Active | `MOVE_OUT_OF_CANONICAL_DOCS` | FINDINGS.md |
| `security/pen-test/2026-03-02/PROOFS.md` | `AUDIT_ARTIFACT` | Active | `MOVE_OUT_OF_CANONICAL_DOCS` | PROOFS.md |
| `security/pen-test/2026-03-02/SCOPE.md` | `AUDIT_ARTIFACT` | Active | `MOVE_OUT_OF_CANONICAL_DOCS` | SCOPE.md |
| `seo/SEO_SOURCE_OF_TRUTH.md` | `SCHEMA_OR_DATA_CONTRACT` | Active | `KEEP_IN_CANONICAL_DOCS` | SEO Source of Truth |
| `tutor/TUTOR_RUNTIME_CONTRACT.md` | `RUNTIME_CONTRACT` | Active | `KEEP_IN_CANONICAL_DOCS` | Tutor Runtime Contract (Cutover) |

## 3. Canonical keep set

### `AUTH_SECURITY.md`

- **Why it qualifies**: High occurrence of canonical markers (8).

- **Evidence**: Has explicit indicators like `- `profiles` is the only runtime profile source of truth.`

### `entitlements-map.md`

- **Why it qualifies**: High occurrence of canonical markers (10).

- **Evidence**: Has explicit indicators like `**Single source of truth** for entitlement gates across client and server surfaces.`

### `ENV.md`

- **Why it qualifies**: High occurrence of canonical markers (1).

- **Evidence**: Has explicit indicators like `- SUPABASE_URL: SUPABASE_URL must be a valid URL`

### `SEO_CRAWLABILITY.md`

- **Why it qualifies**: High occurrence of canonical markers (5).

- **Evidence**: Has explicit indicators like `For each public route, the initial HTML response must contain:`

### `supabase-auth-setup.md`

- **Why it qualifies**: High occurrence of canonical markers (4).

- **Evidence**: Has explicit indicators like `Canonical runtime modules:`

### `calendar/CALENDAR_SOURCE_OF_TRUTH.md`

- **Why it qualifies**: High occurrence of canonical markers (7).

- **Evidence**: Has explicit indicators like `# Calendar Source Of Truth`

### `content/CANONICAL_QUESTION_SOURCE_OF_TRUTH.md`

- **Why it qualifies**: High occurrence of canonical markers (26).

- **Evidence**: Has explicit indicators like `# CANONICAL QUESTION SOURCE OF TRUTH`

### `contracts/db-reconciliation-practice-first.md`

- **Why it qualifies**: High occurrence of canonical markers (9).

- **Evidence**: Has explicit indicators like `| Chain Step | Runtime Owner | Canonical DB Surface | Status |`

### `contracts/full-length-contract.md`

- **Why it qualifies**: High occurrence of canonical markers (12).

- **Evidence**: Has explicit indicators like `# Full-Length Contract`

### `contracts/full-length-smoke.md`

- **Why it qualifies**: High occurrence of canonical markers (1).

- **Evidence**: Has explicit indicators like `Scope: UI trigger, backend routes, and DB persistence for canonical full-length runtime.`

### `contracts/legacy-canonicalization.md`

- **Why it qualifies**: High occurrence of canonical markers (10).

- **Evidence**: Has explicit indicators like `# Legacy Table/Path Canonicalization`

### `contracts/practice-contract.md`

- **Why it qualifies**: High occurrence of canonical markers (9).

- **Evidence**: Has explicit indicators like `# Practice Contract`

### `contracts/practice-smoke.md`

- **Why it qualifies**: High occurrence of canonical markers (7).

- **Evidence**: Has explicit indicators like `# Practice Post-Unlock Smoke (Canonical Runtime)`

### `contracts/rate-limit-db-truth-contract.md`

- **Why it qualifies**: High occurrence of canonical markers (10).

- **Evidence**: Has explicit indicators like `# Rate-Limit DB Truth Contract`

### `contracts/review-contract.md`

- **Why it qualifies**: High occurrence of canonical markers (8).

- **Evidence**: Has explicit indicators like `# Review Contract`

### `contracts/review-db-verification.md`

- **Why it qualifies**: High occurrence of canonical markers (3).

- **Evidence**: Has explicit indicators like `question_canonical_id,`

### `contracts/review-smoke.md`

- **Why it qualifies**: High occurrence of canonical markers (3).

- **Evidence**: Has explicit indicators like `# Review Unlock Smoke (Three-Mode Canonical Runtime)`

### `contracts/runtime-law.md`

- **Why it qualifies**: High occurrence of canonical markers (22).

- **Evidence**: Has explicit indicators like `# Lyceon Runtime Contract`

### `contracts/runtime-route-coverage.md`

- **Why it qualifies**: High occurrence of canonical markers (2).

- **Evidence**: Has explicit indicators like `This matrix proves contract-disable enforcement coverage for mounted runtime domains.`

### `docs/architecture/APPS_API_ALLOWLIST.md`

- **Why it qualifies**: High occurrence of canonical markers (2).

- **Evidence**: Has explicit indicators like `- `POST /api/questions/validate` is intentionally unmounted (404 runtime contract).`

### `exams/FULL_TEST_SOURCE_OF_TRUTH.md`

- **Why it qualifies**: High occurrence of canonical markers (4).

- **Evidence**: Has explicit indicators like `# FULL TEST SOURCE OF TRUTH`

### `guardian/GUARDIAN_RUNTIME_CONTRACT.md`

- **Why it qualifies**: High occurrence of canonical markers (5).

- **Evidence**: Has explicit indicators like `# Guardian Runtime Contract`

### `guardian/GUARDIAN_SOURCE_OF_TRUTH.md`

- **Why it qualifies**: High occurrence of canonical markers (9).

- **Evidence**: Has explicit indicators like `# Guardian Source Of Truth`

### `mastery/MASTERY_EVENT_TAXONOMY.md`

- **Why it qualifies**: High occurrence of canonical markers (1).

- **Evidence**: Has explicit indicators like `## Locked Canonical Event Set`

### `practice/PRACTICE_RUNTIME_CONTRACT.md`

- **Why it qualifies**: High occurrence of canonical markers (21).

- **Evidence**: Has explicit indicators like `# Practice Runtime Contract`

### `runtime/apps-api-runtime.md`

- **Why it qualifies**: High occurrence of canonical markers (3).

- **Evidence**: Has explicit indicators like `# apps/api runtime reality (authoritative)`

### `security/SERVER_AUTHZ_AUDIT_2026-03-11.md`

- **Why it qualifies**: High occurrence of canonical markers (4).

- **Evidence**: Has explicit indicators like `| Practice canonical protected | `server/index.ts:488` | PASS: `/api/practice` requires `requireSupabaseAuth` + `requireStudentOrAdmin` |`

### `security/SUPABASE_RLS_AUDIT_2026-03-11.md`

- **Why it qualifies**: High occurrence of canonical markers (2).

- **Evidence**: Has explicit indicators like `| Practice core (`practice_sessions`, `answer_attempts`, `practice_events`) | `supabase/migrations/20260110_practice_canonical_plus_events.sql:155-260` | PASS: RLS enabled + own-row policies + explicit service-role policy |`

### `seo/SEO_SOURCE_OF_TRUTH.md`

- **Why it qualifies**: High occurrence of canonical markers (9).

- **Evidence**: Has explicit indicators like `# SEO Source of Truth`

### `tutor/TUTOR_RUNTIME_CONTRACT.md`

- **Why it qualifies**: High occurrence of canonical markers (13).

- **Evidence**: Has explicit indicators like `# Tutor Runtime Contract (Cutover)`


## 4. Move / archive / delete candidates

### `analytics-event-taxonomy.md`

- **Classification**: `REVIEW_MANUALLY`

- **Why it does not qualify**: Mixed content, manual review needed.

- **Evidence**: Contains `**Last Updated:** 2026-02-02 (Sprint 2 Closeout)`

### `FULL_LENGTH_EXAM_IMPLEMENTATION.md`

- **Classification**: `REVIEW_MANUALLY`

- **Why it does not qualify**: Mixed content, manual review needed.

- **Evidence**: Contains `- "Before You Begin" checklist`

### `FULL_LENGTH_EXAM_SECURITY_SUMMARY.md`

- **Classification**: `REVIEW_MANUALLY`

- **Why it does not qualify**: Mixed content, manual review needed.

- **Evidence**: Contains `### Code Review Checklist`

### `OPERATIONS.md`

- **Classification**: `MOVE_OUT_OF_CANONICAL_DOCS`

- **Why it does not qualify**: Predominantly sprint planning, operations, checklists, or audit artifacts.

- **Evidence**: Path context or no canonical markers.

### `pr3-hardening-verification.md`

- **Classification**: `ARCHIVE_SUPERSEDED`

- **Why it does not qualify**: Explicitly marked as superseded or archived.

- **Evidence**: Path context or no canonical markers.

### `route-registry.md`

- **Classification**: `ARCHIVE_SUPERSEDED`

- **Why it does not qualify**: Explicitly marked as superseded or archived.

- **Evidence**: Contains `**Note:** These ingestion-related routes were removed as part of Sprint 2 "Kill ingestion surfaces" initiative.`

### `SECURITY_RUNBOOK.md`

- **Classification**: `MOVE_OUT_OF_CANONICAL_DOCS`

- **Why it does not qualify**: Predominantly sprint planning, operations, checklists, or audit artifacts.

- **Evidence**: Contains `## 6️⃣ Deployment Checklist`

### `calendar/CALENDAR_RUNTIME_CONTRACT.md`

- **Classification**: `REVIEW_MANUALLY`

- **Why it does not qualify**: Mixed content, manual review needed.

- **Evidence**: Contains `- Task ledger truth: `student_study_plan_tasks`.`

### `compliance/04-retention-deletion.md`

- **Classification**: `MOVE_OUT_OF_CANONICAL_DOCS`

- **Why it does not qualify**: Predominantly sprint planning, operations, checklists, or audit artifacts.

- **Evidence**: Contains `- Study calendar profiles and plan tasks`

### `docs/architecture/APPS_API_DEPRECATION_BACKLOG.md`

- **Classification**: `ARCHIVE_SUPERSEDED`

- **Why it does not qualify**: Explicitly marked as superseded or archived.

- **Evidence**: Contains `This document lists `apps/api/**` modules that are NOT imported by `server/index.ts` and must be deprecated/removed in future sprints.`

### `docs/architecture/canonical-question-id.md`

- **Classification**: `REVIEW_MANUALLY`

- **Why it does not qualify**: Mixed content, manual review needed.

- **Evidence**: Path context or no canonical markers.

### `exams/EXAM_SOURCE_OF_TRUTH.md`

- **Classification**: `ARCHIVE_SUPERSEDED`

- **Why it does not qualify**: Explicitly marked as superseded or archived.

- **Evidence**: Path context or no canonical markers.

### `guardian/GUARDIAN_TRUST_SOURCE_OF_TRUTH.md`

- **Classification**: `ARCHIVE_SUPERSEDED`

- **Why it does not qualify**: Explicitly marked as superseded or archived.

- **Evidence**: Path context or no canonical markers.

### `kpis/KPI_SOURCE_OF_TRUTH.md`

- **Classification**: `ARCHIVE_SUPERSEDED`

- **Why it does not qualify**: Explicitly marked as superseded or archived.

- **Evidence**: Path context or no canonical markers.

### `mastery/MASTERY_SOURCE_OF_TRUTH.md`

- **Classification**: `ARCHIVE_SUPERSEDED`

- **Why it does not qualify**: Explicitly marked as superseded or archived.

- **Evidence**: Path context or no canonical markers.

### `qa/guardian.md`

- **Classification**: `MOVE_OUT_OF_CANONICAL_DOCS`

- **Why it does not qualify**: Predominantly sprint planning, operations, checklists, or audit artifacts.

- **Evidence**: Contains `# Guardian/Parent Profile QA Checklist`

### `qa/release-gates.md`

- **Classification**: `ARCHIVE_SUPERSEDED`

- **Why it does not qualify**: Explicitly marked as superseded or archived.

- **Evidence**: Contains `## Pre-Launch Checklist`

### `security/pen-test/2026-03-02/FINDINGS.md`

- **Classification**: `MOVE_OUT_OF_CANONICAL_DOCS`

- **Why it does not qualify**: Predominantly sprint planning, operations, checklists, or audit artifacts.

- **Evidence**: Path context or no canonical markers.

### `security/pen-test/2026-03-02/PROOFS.md`

- **Classification**: `MOVE_OUT_OF_CANONICAL_DOCS`

- **Why it does not qualify**: Predominantly sprint planning, operations, checklists, or audit artifacts.

- **Evidence**: Path context or no canonical markers.

### `security/pen-test/2026-03-02/SCOPE.md`

- **Classification**: `MOVE_OUT_OF_CANONICAL_DOCS`

- **Why it does not qualify**: Predominantly sprint planning, operations, checklists, or audit artifacts.

- **Evidence**: Path context or no canonical markers.


## 5. Supersession and duplication map

- **Older file**: `route-registry.md` -> **Newer replacement**: likely integrated into corresponding Source of Truth or Contract files. (See Evidence: marked superseded/deprecated)

- **Older file**: `docs/architecture/APPS_API_DEPRECATION_BACKLOG.md` -> **Newer replacement**: likely integrated into corresponding Source of Truth or Contract files. (See Evidence: marked superseded/deprecated)

- **Older file**: `exams/EXAM_SOURCE_OF_TRUTH.md` -> **Newer replacement**: likely integrated into corresponding Source of Truth or Contract files. (See Evidence: marked superseded/deprecated)

- **Older file**: `guardian/GUARDIAN_TRUST_SOURCE_OF_TRUTH.md` -> **Newer replacement**: likely integrated into corresponding Source of Truth or Contract files. (See Evidence: marked superseded/deprecated)

- **Older file**: `kpis/KPI_SOURCE_OF_TRUTH.md` -> **Newer replacement**: likely integrated into corresponding Source of Truth or Contract files. (See Evidence: marked superseded/deprecated)

- **Older file**: `mastery/MASTERY_SOURCE_OF_TRUTH.md` -> **Newer replacement**: likely integrated into corresponding Source of Truth or Contract files. (See Evidence: marked superseded/deprecated)

- **Older file**: `qa/release-gates.md` -> **Newer replacement**: likely integrated into corresponding Source of Truth or Contract files. (See Evidence: marked superseded/deprecated)


## 6. Future target docs structure


* `docs/contracts/` - Only locked RUNTIME_CONTRACT and RUNTIME_LAW documents.
* `docs/sources-of-truth/` - Only schema, entitlement, and system SOURCE_OF_TRUTH documents.
* `docs/architecture/` - Specs and cross-cutting capabilities.
* `archive/` or `docs/archive/` - Move all superseded, legacy, and older audit files here.
* `ops/` or `docs/ops/` - Implementation checklists, sprint deliverables, operations runbooks.
* `compliance/` - Trust pages and retention policies.


## 7. Findings

### Finding 1: Mixed Artifacts in Practice

- **Severity**: MEDIUM
- **File**: `analytics-event-taxonomy.md` and others
- **Issue**: Sprint deliverables mixed with canonical rules.
- **Impact**: Makes it difficult to know if the document is an active contract or an old ticket description.
- **Recommended Handling**: Move sprint notes to ops, keep canonical taxonomy.


## 8. Final recommendation

`ARCHIVE_NON_SPEC_DOCS_FIRST_THEN_DELETE`
