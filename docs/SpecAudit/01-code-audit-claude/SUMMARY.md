# SUMMARY — Claude State-Assessment Audit

**HEAD audited:** `be91469fb7e9cd3847d5fa54cc31b4bb46dc97ac` (`2026-06-06 22:37:46 -0500`, Merge PR #339 from `cleanup`)
**Live-state ground truth:** `docs/SpecAudit/00-supabase-live-state.csv` (generated `2026-06-07 03:03:35+00`; Postgres 17.6; **H1: 0 applied migrations recorded**; **G1: 0 pg_cron jobs**)
**Spec corpus:** `docs/Spec/` (44 documents, read-only)
**Method:** Modified-A, three passes (Existence → Correctness → Cross-doc), read-only. Findings only; no remediation ordering.

Two intake notes affecting reproducibility:
- The live-state capture was committed as a **single CSV file** (`00-supabase-live-state.csv`), not the `00-supabase-live-state/` directory the brief names. Section markers (`A1`, `A7`, `B1`, `C1`, `D1`, `G1`, `H1`…) are embedded as `==== FILE: … ====` blocks; findings cite those.
- The brief's "**seven** RLS-disabled tables with full write grants" is an **undercount** — the capture shows **nine** (CC-P2-002).
- The unsuffixed `Document 01` file is **V8** (2026-04-23), which supersedes the `(V6)` file; Doc 04C §2.6 (V-family) independently confirms the guardian "link AND entitlement" rule cited in CC-P2-007.

---

## Counts by severity

| Severity | Count | IDs |
|---|---|---|
| **CRITICAL** | 4 | CC-P1-004, CC-P2-001, CC-P2-002, CC-P2-003 |
| **HIGH** | 15 | CC-P1-001, CC-P1-003, CC-P1-006, CC-P1-007, CC-P1-008, CC-P2-004, CC-P2-005, CC-P2-007, CC-P2-008, CC-P2-010, CC-P2-016, CC-P3-001, CC-P3-002, CC-P3-006, CC-P3-007 |
| **MEDIUM** | 14 | CC-P1-002, CC-P1-005, CC-P1-009, CC-P1-010, CC-P1-011, CC-P1-012, CC-P1-013, CC-P2-006, CC-P2-009, CC-P2-011, CC-P2-012, CC-P3-003, CC-P3-004, CC-P3-008 |
| **LOW** | 5 | CC-P2-013, CC-P2-014 *(conformant)*, CC-P2-015 *(conformant)*, CC-P3-005, CC-P3-009 |
| **Total** | **38** | (2 of the LOW entries are verified-conformant positives, not defects) |

## Counts by tag

| Tag | Count | Notes |
|---|---|---|
| **DRIFT** | 20 | Code/DB exists but disagrees with spec (or repo disagrees with live DB) |
| **MISSING** | 11 | Capability or canonical object absent (includes 3 PARTIAL-status: CC-P1-005/007/013) |
| **UNSPECED** | 3 | CC-P1-010 (orphaned fns), CC-P1-011 (legacy parallel tables), CC-P1-012 (dead auth cols) |
| **AMBIGUITY** | 2 | CC-P2-016 (Doc 02C vs Doc 05 formula conflict), CC-P3-009 (`server/` vs `apps/api/`) |
| **Conformant (positive)** | 2 | CC-P2-014 (idempotency/Stripe dedup), CC-P2-015 (mastery write-lockdown) |
| **SPEC-REVISION-CANDIDATE** | 0 | Candidate area flagged in-line (Doc 01 V8 §0.6 RLS-bypass-at-launch vs live RLS-enabled Supabase), not raised as a discrete finding this pass |

---

## Ten most consequential findings

1. **CC-P2-001 (CRITICAL)** — `anon` can `SELECT correct_answer, explanation FROM questions` directly (policy `questions_select_accessible :: roles={anon,authenticated} :: USING true`, C1; column NOT NULL, A2). The anti-leak invariant — the platform's #1 rule — holds in the API serializers but is broken at the database trust boundary, where the public key bypasses the API entirely.
2. **CC-P2-003 + CC-P1-004 (CRITICAL)** — The mastery engine runs `apply_learning_event_to_mastery` (delta/alpha), which Doc 05A §13 explicitly declares **not a V1.0 contract**; the V1.0 canonical RPC `apply_mastery_event` and its `mastery_events`/`student_skill_weekly_snapshot`/`mastery_event_audit_log` tables are **absent** (presence check = 0). The product's core "earned-from-observed-events" math does not match the controlling spec.
3. **CC-P2-002 (CRITICAL)** — **Nine** RLS-disabled tables (`test_forms`, `constants_audit_log`, `documents`, `embeddings`, `question_classification_updates`, `question_embeddings`, `sat_*_ref` ×3) grant `anon`/`authenticated` full INSERT/UPDATE/DELETE (A1 + A7), including the exam form bank and the append-only constants audit log.
4. **CC-P1-003 (HIGH)** — The entire Doc 04/04A/04B canonical exam schema (`test_sessions`, `test_session_answers`, `score_runs`, `scoring_model_versions`, `score_run_event_ledger`, `exam_runtime_outbox`) is absent; the exam engine runs on the UNSPECED `full_length_exam_*` family. Every guarantee anchored on insert-once `score_runs` is unimplemented as specified.
5. **CC-P2-007 (HIGH)** — `is_guardian_of` (B1:6165) derives visibility from the link alone, omitting the **entitlement-active** condition required by coding-standards §6.2 and Doc 04C §2.6. A lapsed student's guardian still reads all linked learning state.
6. **CC-P2-008 (HIGH)** — Guardian RLS grants SELECT on per-attempt tables and the internal `student_skill_mastery` row (including `mastery_score`), contradicting the aggregate-only invariant (Doc 01 §16, INV-02-06) and the mastery-score non-exposure rule (Doc 05P-033).
7. **CC-P1-006 (HIGH)** — **Zero scheduling infrastructure** (G1/G2 empty; no Vercel/GitHub-Actions cron; no node-cron/BullMQ). Retention purges, account-deletion execution, projection/mastery snapshots, birthday/consent-expiry transitions are all unscheduled.
8. **CC-P2-010 (HIGH)** — Account/membership split-brain: the RPC writes `lyceon_accounts`/`lyceon_account_members` (19 rows) while runtime TS reads `accounts`/`account_members` (13 rows) — divergent row counts, no single source of truth (A1; `server/lib/account.ts:141,165,183`).
9. **CC-P2-004 (HIGH)** — The sole runtime mastery RPC has **no SQL definition anywhere in the repo**; it exists only as a live-DB object. Combined with H1 (0 applied migrations), the deployed mastery write path is not reproducible from source.
10. **CC-P3-006 + CC-P3-007 (HIGH)** — LISA seam defects: the ADR-001 `mastery_outbox` cross-platform path does not exist (review writes mastery by direct RPC), and verbatim tutor content is retained with **no expiry job**, so the ADR §6 permission to store verbatim (conditioned on enforced retention) is unmet.

*Honorable mentions:* CC-P2-016 (Doc 02C V4 vs Doc 05 define incompatible mastery/domain formulas — a spec-internal conflict the owner must resolve); CC-P1-007 (account deletion never auto-executes — a GDPR/CCPA exposure); CC-P1-001 (constants-in-DB doctrine unimplemented).

---

## Overall spec-alignment estimate (honest)

Lyceon is a **substantially-built, exercised pre-production platform** — practice, review, full-length exam, tutor, guardian, billing, calendar, and mastery all have live tables carrying real data, and two of the hardest disciplines are genuinely well executed: the application-layer anti-leak serializers (`projectStudentSafeQuestion` allowlist) are consistent across every surface, and the mastery write-lockdown (service-role-only, `skill_mastery_no_direct_write`) is correctly enforced. But **alignment to the locked corpus is low-to-moderate**, and the gap is structural rather than cosmetic. The deployed schema is not traceable to the repo (0 applied migrations; the canonical mastery writer has no SQL in-tree) and pervasively uses **parallel, differently-named table/function families** instead of the spec's canonical objects (`full_length_exam_*` vs `score_runs`/`test_sessions`; `apply_learning_event_to_mastery` vs `apply_mastery_event`; `accounts` vs `lyceon_accounts`), with legacy predecessors left in place beside them. The **core mastery formula is an explicitly-superseded shape**; the **constants-in-DB and all scheduling doctrines are essentially absent**; and — most seriously — two **CRITICAL data-boundary exposures** (anon read of the answer key, anon writes to nine RLS-off tables) violate the platform's stated #1 invariants at the database layer even though the API layer is clean. Net assessment: a working product with a **large, concentrated spec-vs-reality delta** in three zones — (a) the database trust boundary (anti-leak / RLS / grants), (b) the mastery & exam-scoring canonical contracts (wrong/absent objects, untraceable provenance, an unresolved spec-internal formula conflict), and (c) operational behaviors that depend on scheduling that does not exist. The application code is frequently *more* correct than the database it sits on; closing the delta is mostly DB-and-schema work plus a spec-owner ruling on the Doc 02C↔Doc 05 conflict, not a rewrite of the runtime.

---

*Outputs in this directory:* `pass1-existence.md` (coverage matrix + UNSPECED inventory + 13 findings), `pass2-correctness.md` (16 findings), `pass3-cross-doc.md` (9 findings), `SUMMARY.md` (this file). All evidence cites `file:line` (repo) or capture section + object (DB). No files outside `docs/SpecAudit/01-code-audit-claude/` were modified.
