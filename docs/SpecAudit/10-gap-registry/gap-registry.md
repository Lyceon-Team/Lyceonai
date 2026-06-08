# Lyceon Unified Gap Registry — V1.1 (Verification Pass applied)

Governance, rulings (R1: Doc 05 family controls; R2: guardian grace-period carve-out), severity scheme, status legend, dispositions: `README.md`.
**V1.1 changes:** all six VERIFY entries finalized from the dual-agent Verification Pass (Claude Code + Codex, independent, corroborating on all items); constants dump (`mastery_constants` 25 rows, `kpi_constants` 2 rows — owner confirms these are the only constants tables) analyzed and folded in; 3 new gaps (MA-10, MA-11, ID-12); TU-08 reclassified CRITICAL→HIGH (broad claim refuted, narrow defect confirmed); ID-11 elevated HIGH→CRITICAL (consent forgery). This registry is self-contained: decisive evidence is inline; raw auditor reports are not committed to the repo.

**Totals:** 66 gap entries — **7 CRITICAL, 24 HIGH, 23 MEDIUM, 12 LOW** — plus 5 spec-revision items and 9 conformant verifications. Zero entries remain in VERIFY status.

**The 7 CRITICALs:** GAP-TB-01, GAP-TB-02, GAP-TB-03, GAP-MA-01, GAP-EX-02, GAP-TU-03, GAP-ID-11.

Execution view (workstreams, sequencing, exit criteria): `closure-plan.md` in this directory.

---

## Zone TB — Database Trust Boundary

| ID | Sev | Tag | Gap | Disposition | Status |
|---|---|---|---|---|---|
| GAP-TB-01 | CRITICAL | DRIFT | `anon` can `SELECT correct_answer, explanation FROM questions` (280 rows) directly via PostgREST — policy `questions_select_accessible :: roles={anon,authenticated} :: USING true`; grant `questions | anon | SELECT`; both columns NOT NULL | FIX-DB | CLOSED (applied 2026-06-07; probe PASS; PRs #342/#343/#344) |
| GAP-TB-02 | CRITICAL | DRIFT | Denormalized `question_correct_answer`/`question_explanation` on `practice_session_items`, `review_session_items`, `full_length_exam_questions` readable by the row-owning student pre-submit via PostgREST self-select policies — a direct self-cheat vector that bypasses the (correct) app serializers | FIX-DB | CLOSED (applied 2026-06-07; probe PASS; PRs #342/#343/#344) |
| GAP-TB-03 | CRITICAL | DRIFT | Nine RLS-disabled tables with full `anon`/`authenticated` INSERT/UPDATE/DELETE grants: `test_forms`, `constants_audit_log`, `documents`, `embeddings`, `question_classification_updates`, `question_embeddings`, `sat_math_topics_ref`, `sat_rw_skills_ref`, `sat_sections_ref` | FIX-DB | CLOSED (applied 2026-06-07; probe PASS; PRs #342/#343/#344) |
| GAP-TB-04 | MEDIUM | DRIFT | 14 RLS-enabled zero-policy (deny-all) tables; classify intentional service-role-only lockdowns (`stripe_webhook_events`, `account_deletion_requests`, …) vs broken access (reference tables the product reads) and fix the broken set | FIX-DB | OPEN |

---

## Zone MA — Mastery, KPI, Projections *(R1: rebuild to the Doc 05 generation)*

| ID | Sev | Tag | Gap | Disposition | Status |
|---|---|---|---|---|---|
| GAP-MA-01 | CRITICAL | DRIFT+MISSING | Mastery engine is the superseded Doc 02C generation end-to-end. Runtime drives `apply_learning_event_to_mastery` (delta/alpha EMA); Doc 05A canonical `apply_mastery_event`, `mastery_events`, `student_skill_weekly_snapshot`, `mastery_event_audit_log` all absent. **Constants dump confirms at the config layer:** `mastery_constants` carries `alpha=0.20`, per-source signed deltas (`new_score = clamp(old + α·(base_delta·difficulty_multiplier))`), difficulty multipliers 1.0/1.1/1.3 (vs Doc 05's 0.79/1.0/1.20 in a different mathematical role); no `POSITION_HALF_LIFE`, no `MIN_EVENTS_FOR_MASTERY`, no source weights 0.50/0.30/0.20 exist anywhere. Owner-confirmed: the Doc 05 constants are new implementations | BUILD | OPEN |
| GAP-MA-02 | HIGH | DRIFT | Second formula family (`upsert_skill_mastery`/`upsert_cluster_mastery`, Bayesian half-life) remains installed and callable by privileged roles against the same tables | RETIRE (after MA-01) | OPEN |
| GAP-MA-03 | HIGH | DRIFT | The sole runtime mastery RPC has no SQL definition anywhere in the repo — unversioned live-DB object, unreviewable, unreproducible | PROCESS (with OP-05) | OPEN |
| GAP-MA-04 | HIGH | DRIFT+MISSING | Projections nonconformant vs Doc 05C: no all-domain/min-event gates, no SAT-score blend, no snapshots, no `projection_refresh_outbox`/`student_projection_refresh_state`, no refresh cadence. **Constants dump confirms numerically:** deployed `projection_max_delta 60 / projection_min_delta 20` vs locked Doc 05C range MAX 100 → MIN 25 | BUILD | OPEN |
| GAP-MA-05 | HIGH | DRIFT | Domain mastery/KPI layer is the Doc 02C shape (attempts-weighted average of skill mastery) — the shape Doc 05B explicitly forbids; Doc 05B refreshers/audit tables absent | BUILD | OPEN |
| GAP-MA-06 | HIGH | DRIFT | Literal mastery/scoring constants hardcoded in app code (`mastery-constants.ts` — 42d half-life vs DB 21d; also `canonical-runtime-views.ts`, `calendar.ts`, `mastery.ts`), violating the unconditional constants-from-DB rule | FIX-CODE | OPEN |
| GAP-MA-07 | HIGH | MISSING | `mastery_outbox` seam (ADR-001 §5 / Doc 05) does not exist; review writes mastery synchronously via direct RPC; no outbox table, enqueue, or consumer | BUILD | OPEN |
| GAP-MA-08 | MEDIUM | DRIFT | `rebuild_mastery_and_kpis` destructively replays legacy events — not the Doc 05D deterministic recompute; retired by the MA-01 rebuild | RETIRE (after MA-01) | OPEN |
| GAP-MA-09 | MEDIUM | DRIFT | Constants-governance triggers are origin-enabled, not `ENABLE ALWAYS` (replica-mode bypass open); the audit log they write is itself anon-writable (TB-03) | FIX-DB | CLOSED (applied 2026-06-07; probe PASS; PRs #342/#343/#344) |
| GAP-MA-10 | MEDIUM | DRIFT | `DIAGNOSTIC_TOTAL_QUESTIONS = 20` deployed vs locked **40** (8 domains × 5) — a discrete, product-visible 2× divergence independent of the engine rebuild | FIX-DB (with MA-01 constants seed) | OPEN |
| GAP-MA-11 | MEDIUM | DRIFT+UNSPECED | `kpi_constants` has **two rows both flagged `{active: true}`** (`kpi_truth_v1`, `live`) with different weight semantics — no single active version; `kpi_truth_v1` also carries an UNSPECED `flowcard: 0.75` weight (concept absent from the corpus) | FIX-DB | OPEN |

**Notes.** One root cause, one CRITICAL: CX2 rated several MA components CRITICAL individually; normalized under MA-01 with components HIGH/MEDIUM. Conformant fragment: deployed level boundaries 0.19/0.39/0.59/0.79 match Doc 05 exactly (C-9). Capture A1's "14 rows" for `mastery_constants` vs the dump's 25 is a `reltuples` estimate artifact; the dump is content ground truth.

---

## Zone EX — Full-Length Exams & Scoring *(R1 applied)*

| ID | Sev | Tag | Gap | Disposition | Status |
|---|---|---|---|---|---|
| GAP-EX-01 | HIGH | MISSING | Doc 04 canonical exam schema absent (`test_sessions`, `test_session_answers`, `score_runs`, `scoring_model_versions`, `score_run_event_ledger`, `exam_runtime_outbox`, `exam_failure_ledger`); engine runs on the UNSPECED `full_length_exam_*` family; every `score_runs`-anchored guarantee unimplemented | BUILD | OPEN |
| GAP-EX-02 | CRITICAL | DRIFT | Deployed scoring is a 55/45-entry linear lookup array in TypeScript (`fullLengthScoreTables.ts:7-52`, called from `fullLengthExam.ts:1672,2911`) using NONE of Doc 04B V4.3's closed-form formula or 13 constants — no banded ceiling, no D_e/m/h deductions, no floors, no module-2 path, no partial scoring; `is_correct` computed in app code against denormalized answers (`:2485-2491`), contra §5.12. The canonical formula has never been deployed in any form | BUILD (the moat) | OPEN |
| GAP-EX-03 | HIGH | DRIFT | Full-length path emits mastery events directly after responses, bypassing the Doc 04B scoring-transaction boundary (events must emit from scoring via outbox) | BUILD (with EX-02 + MA-07) | OPEN |
| GAP-EX-04 | MEDIUM | DRIFT | Review unlock gated on `session.status`, not the spec-required completed scoring row; safe only while scoring is synchronous | FIX-CODE (after EX-01) | OPEN |
| GAP-EX-05 | MEDIUM | DRIFT | Module-2 adaptive bucket disclosed: review UI renders "Adaptive: {bucket}" badge (`FullLengthReviewView.tsx:125`); `submitModule` response carries `nextModule.difficultyBucket` (`fullLengthExam.ts:2808-2814`). DB-layer latent-SAFE (no browser PostgREST client) | FIX-CODE | OPEN |
| GAP-EX-06 | MEDIUM | DRIFT | No at-rest `CHECK (difficulty BETWEEN 1 AND 3)`; `questions.difficulty` is a bare nullable integer; 1–3 enforced only at write time on one path | FIX-DB | OPEN |
| GAP-EX-07 | MEDIUM | MISSING | No question-retirement mechanism (`active_status` absent); six CASCADE FKs to `questions(id)` mean a privileged delete silently erases attempt history | FIX-DB | OPEN |
| GAP-EX-08 | MEDIUM | MISSING | SM-2 / `review_schedule` / `review_runtime_config` entirely absent — even the simplified launch target; review is a flat unresolved-mistakes queue | BUILD | OPEN |

---

## Zone TU — Tutor / LISA / Privacy

| ID | Sev | Tag | Gap | Disposition | Status |
|---|---|---|---|---|---|
| GAP-TU-01 | HIGH | DRIFT | Verbatim tutor conversation store grows without the bounded-retention guarantee ADR-001 §6 conditions it on (worker-side GCP boundary CONFORMANT) | BUILD (via TU-02 + OP-01) | OPEN |
| GAP-TU-02 | HIGH | MISSING | LISA retention/pseudonymization lifecycle unbuilt: no 7-day soft-delete, no 90/180/365 archival, no `deleted_at` substrate, no purge worker, zero cron jobs | BUILD | OPEN |
| GAP-TU-03 | CRITICAL | DRIFT+MISSING | `deidentify_user` does not reach the live tutor store (`tutor_conversations/messages/memory_summaries/instruction_*/question_links`) — it deletes from the dead `tutor_interactions` table; also misses `student_domain_mastery`, `student_section_projections`, `student_kpi_rollups_current`, `usage_rate_limit_ledger`, `guardian_link_audit`, `system_event_logs`. FK cascades never fire (profile scrubbed, not deleted; auth row only disabled). Verbatim minor–AI conversations survive de-identification | FIX-DB | OPEN |
| GAP-TU-04 | MEDIUM | DRIFT | Tutor leak filter scoped to `source_surface === "practice"` only; review pre-submit unfiltered; conversation replay endpoint unfiltered | FIX-CODE | OPEN |
| GAP-TU-05 | HIGH | DRIFT | Tutor limit structure mismatched vs Doc 03 §13 (deployed 5-min density windows vs spec per-min/hour/day/week/month caps; day/week/month caps unimplemented); all values SQL-hardcoded | FIX-DB | OPEN |
| GAP-TU-06 | HIGH | DRIFT | **VP-CONFIRMED (both agents): student-injectable LISA memory.** Policy `tutor_memory_summaries_student_insert :: roles={authenticated} :: WITH CHECK (student_id = auth.uid())` lets students self-insert; **no server-side writer exists anywhere** (sole reference is a service-role `.select` at `tutor-runtime.ts:1278-1284`); rows flow `content_json → orchestratorPayload.memory_summaries → Vertex prompt` (`vertex.ts:402`). Self-scoped injection vector contra Doc 03A INV-03-06 and the §512-519 trusted-writer requirement | FIX-DB (drop student INSERT; reserve writes for the trusted compaction path) | CLOSED (applied 2026-06-07; probe PASS; PRs #342/#343/#344) |
| GAP-TU-07 | LOW | DRIFT | RAG v2 student sanitizer is denylist key-deletion, not the canonical allowlist projection | FIX-CODE | OPEN |
| GAP-TU-08 | HIGH | DRIFT | **VP-PARTIAL (both agents) — reclassified from CRITICAL-pending.** Tutor gating enforces auth + guardian-exclusion + paid entitlement + the under-13-without-consent COPPA composite (`supabase-auth.ts:578`) — the broad "no gating" claim is refuted. Confirmed absent: the **absolute age-≥13 floor** (Doc 03 §12.2/§12.5: under-13 has no LISA access *regardless of consent*) and the **Tier-1 country gate** (INV-03-08) — an under-13 student with `guardian_consent=true` and paid access reaches all five tutor routes. Also: entitlement checked via ad-hoc paid-KPI helper (`kpi-access.ts:52-68`) rather than the spec'd `canAccessFeature('tutor_access')` gate; `requireConsentCompliance` exists but is never mounted | FIX-CODE | OPEN |
| GAP-TU-09 | LOW | DRIFT | **VP-resolved (conflict → finding):** deployed `tutor_interactions` **still carries** verbatim `message` (col 8, NOT NULL) and `answer` (col 9, NOT NULL); 0 rows, latent. The "verbatim-stripped" characterization came from an unapplied repo migration (datapoint for OP-05) | FIX-DB (drop with HY cleanup) | OPEN |
| GAP-TU-10 | LOW | DRIFT | Tutor budget exhaustion returns 402/payment UX instead of 429/rate-limit semantics | FIX-CODE | OPEN |

**Notes.** TU-03 CRITICAL (auditors said HIGH): failure of the deletion commitment on minors' verbatim AI conversations is a direct GDPR/COPPA/Privacy-Policy exposure. If TU-06's fix lands before any real users, the injection vector never becomes exploitable — sequence it in the stop-the-bleed workstream.

---

## Zone ID — Identity, Guardian, Entitlement *(R2 applied)*

| ID | Sev | Tag | Gap | Disposition | Status |
|---|---|---|---|---|---|
| GAP-ID-01 | HIGH | DRIFT | `is_guardian_of` checks only `profiles.guardian_profile_id` linkage — no link-active/revoked check, no grace-window bound. Post-R2, the defect is the missing link-status condition and unbounded grace, not entitlement omission | FIX-DB | OPEN |
| GAP-ID-02 | HIGH | DRIFT | Guardian RLS grants row-level SELECT on per-attempt tables and internal `student_skill_mastery` incl. `mastery_score` — aggregate-only invariant and mastery-score non-exposure rule violated | FIX-DB | OPEN |
| GAP-ID-03 | MEDIUM | DRIFT | Two guardian-derivation mechanisms in RLS (`profiles.guardian_profile_id` dominant vs canonical `guardian_links`); divergence risk | FIX-DB | OPEN |
| GAP-ID-04 | HIGH | DRIFT | Account split-brain: RPC writes `lyceon_accounts/lyceon_account_members` (19 rows) while runtime TS reads `accounts/account_members` (13 rows). Arbitration: CC evidence controls; the deep-pass writer map was blind to RPC-mediated writes | FIX (consolidate) | OPEN |
| GAP-ID-05 | HIGH | DRIFT | `profiles` has 4+ writers across three route files and a lib; spec names single-writer consolidation in scope | FIX-CODE | OPEN |
| GAP-ID-06 | HIGH | DRIFT | Practice quota: spec 40/calendar-day (America/Chicago reset) vs deployed 20/rolling-24h — limit value and window semantics both wrong; values are literals | FIX-DB | OPEN |
| GAP-ID-07 | MEDIUM | UNSPECED+MISSING | Dead plaintext-auth columns on `users` (`password`, `two_factor_secret`, `password_reset_token`); MFA for privileged roles (Doc 01 §11) unimplemented | CLEANUP + BUILD(MFA) | OPEN |
| GAP-ID-08 | MEDIUM | DRIFT | `audit_logs` (the mandated identity-event audit table) has 0 rows; audit writes scattered to `system_event_logs`/`guardian_link_audit` | FIX-CODE | OPEN |
| GAP-ID-09 | HIGH | DRIFT | **VP-CONFIRMED (both agents): entitlement absent on premium routes.** Per Doc 02B §12 (full-length, review-queue, skill/domain breakdowns = Premium-only) and Doc 01's feature-contract seeds: full-length `current`/`:id/start`/`answer`/`module/submit`/`review` carry NO entitlement check (only `POST /sessions` create is gated, `full-length-exam-routes.ts:184`; lapse-mid-exam continues uninterrupted); `/api/me/weakness/{skills,clusters}` serve premium-only mastery breakdowns to any authenticated student with no precondition — the cleanest gaps. `POST /api/rag/v2` ungated but spec-silent on standalone-RAG tier → SP-05. Pattern note: gating uses ad-hoc premium helpers, not the spec'd `EntitlementService.canAccessFeature` contracts | FIX-CODE | OPEN |
| GAP-ID-10 | MEDIUM | DRIFT | **VP-CONFIRMED (both agents): serve-before-reserve.** Session creation materializes item[0] as `served` (`practice-canonical.ts:1284`) with no quota call anywhere in session start; resume branch returns served items with no reservation (`:1470-1566`); reservation fires only on 2nd+ queued→served promotion (`:1637`, mutate-then-reserve with best-effort rollback). First item of every session bypasses quota | FIX-CODE | OPEN |
| GAP-ID-11 | CRITICAL | DRIFT | **VP-CONFIRMED (both agents); elevated HIGH→CRITICAL: guardian-consent forgery vector.** `POST .../verify-session` (`guardian-consent-routes.ts:110`) has **no auth middleware**; reads `requestId` + `sessionId` from the body; verifies only that the Stripe session is paid; **never compares** `session.metadata.requestId` (set at checkout `:84`) to the body `requestId`; then sets `guardian_consent_requests.status='approved'` (`:149`) and `profiles.guardian_consent=true` on the request's `child_id` (`:157`). Any caller with a known/leaked `requestId` plus any paid session can flip consent for an arbitrary child. Consent integrity is the COPPA linchpin → CRITICAL per the registry's minors-privacy criterion | FIX-CODE (auth + metadata binding + ownership re-derivation) | CLOSED (applied 2026-06-07; probe PASS; PRs #342/#343/#344) |
| GAP-ID-12 | MEDIUM | DRIFT | **VP-PARTIAL (both agents): tutor conversation scope pollution.** Conversation creation binds `student_id: user.id` correctly (`tutor-runtime.ts:844`) but persists client-supplied scope IDs (`source_session_id`, `source_question_*`) verbatim, unvalidated, and echoes them as `resolved_scope`; ownership validation (`resolveScope`) only runs later at message-append (`:1085`). Cross-student references can be persisted; content not surfaced until validated resolution | FIX-CODE (validate scope at create) | OPEN |

**Notes.** GAP-ID-11 residual (WS-0, PR #342): WS-0 binds `verify-session` to `session.metadata.requestId` (server-authoritative selection), rejects body mismatch/absent metadata with no state change, gates on expiry + pending state, makes approval idempotent, Zod-parses, rate-limits, and sets Stripe `customer_email` server-side from the stored guardian email (hijack→receipt to victim = detection). No HMAC token (the `create-checkout-session` mint is unauthenticated, so a signature adds nothing). **By design, `requestId` remains an email-delivered bearer capability** — anyone who already knows a victim's `requestId` can still mint a metadata-matching $0.50 session. Full guardian-identity binding of the consent flow is **deferred to WS-3** and must be revisited there.

---

## Zone OP — Scheduling, Operations, Provenance

| ID | Sev | Tag | Gap | Disposition | Status |
|---|---|---|---|---|---|
| GAP-OP-01 | HIGH | MISSING | Zero scheduling infrastructure (pg_cron installed, 0 jobs; no Vercel cron, no GHA schedule, no node-cron/BullMQ). Unscheduled dependents: T+7 deletion, under-13 birthday transition, consent-expiry deletion, LISA retention, weekly mastery snapshot, projection sweep, constants reconciliation | BUILD | OPEN |
| GAP-OP-02 | HIGH | MISSING | Constants-in-DB doctrine unimplemented: all `*_runtime_config` tables absent; constants live as code/SQL literals | BUILD | OPEN |
| GAP-OP-03 | HIGH | PARTIAL | Account deletion never auto-executes: correct endpoint + RPC exist with no autonomous caller; grace window expires silently (GDPR/CCPA exposure) | BUILD (depends OP-01; pairs with TU-03) | OPEN |
| GAP-OP-04 | MEDIUM | MISSING | Canonical IdempotencyService / `idempotency_records` absent; idempotency is per-domain ad-hoc | BUILD | OPEN |
| GAP-OP-05 | HIGH | DRIFT | Deployed-schema provenance broken: 0 applied migrations recorded; live objects (incl. the sole mastery writer) have no repo SQL; repo migrations exist that were never applied (e.g. `20260606_tutor_interactions_drop_verbatim.sql` — see TU-09); two migration systems in-tree | PROCESS (baseline capture + single pipeline) | OPEN |

---

## Zone AR — Architecture & Layering

| ID | Sev | Tag | Gap | Disposition | Status |
|---|---|---|---|---|---|
| GAP-AR-01 | HIGH | DRIFT | Route handlers write the DB directly across practice/review/tutor/calendar (+ profile/consent/notifications/deletion/auth/webhook/guardian); no service layer owns the writes | FIX-CODE (refactor) | OPEN |
| GAP-AR-02 | MEDIUM | DRIFT | Three concurrent service-role (RLS-bypassing) Supabase clients + a fourth legacy singleton | FIX-CODE | OPEN |
| GAP-AR-03 | MEDIUM | DRIFT | Multi-writer shared tables without canonical owner: `system_event_logs` (3 writers), `guardian_consent_requests` (2) | FIX-CODE | OPEN |
| GAP-AR-04 | LOW | AMBIGUITY | `server/` vs `apps/api/` are one deployed unit with divergent conventions; corpus doesn't name the canonical tree | SPEC-REVISION (SP-03) then FIX-CODE | OPEN |
| GAP-AR-05 | LOW | DRIFT | Inconsistent response envelope shapes across question and full-length routes | FIX-CODE | OPEN |

---

## Zone HY — Hygiene & Legacy

| ID | Sev | Tag | Gap | Disposition | Status |
|---|---|---|---|---|---|
| GAP-HY-01 | MEDIUM | UNSPECED | Legacy parallel tables: `users`, account-family remainder (after ID-04), `attempts`/`answer_attempts`/`exam_*` families, `chat_messages`, LMS scaffolding | CLEANUP | OPEN |
| GAP-HY-02 | MEDIUM | UNSPECED | Orphaned function families, zero callers: `ingestion_v4_*`/`v4_*` (10), `vectors`/`match_vectors`/`create_vectors_table_if_not_exists`, `enqueue_render_pages_*` | CLEANUP | OPEN |
| GAP-HY-03 | LOW | DRIFT | Duplicate indexes across 11 tables | CLEANUP | OPEN |
| GAP-HY-04 | MEDIUM | DRIFT | `NOT VALID` FKs on `usage_daily.account_id`, `usage_rate_limit_ledger.account_id` | FIX-DB (VALIDATE) | OPEN |
| GAP-HY-05 | LOW | DRIFT | Double-firing `updated_at` triggers on `practice_sessions`, `usage_daily` | CLEANUP | OPEN |
| GAP-HY-06 | LOW | UNSPECED | `v_half_life_days`: one-column TABLE with view-style name and broad grants | CLEANUP | OPEN |
| GAP-HY-07 | LOW | DRIFT | `vector` extension installed in `public` | CLEANUP | OPEN |
| GAP-HY-08 | MEDIUM | MISSING | Reference tables empty (`difficulty_levels_ref`, `sat_*_ref` — 0 rows) while RLS-off (TB-03) or deny-all; the implied taxonomy has no seeded source of truth | FIX-DB (seed or retire) | OPEN |
| GAP-HY-09 | LOW | DRIFT | Overlapping CHECKs: `answer_attempts_outcome_check` + `_v2` | CLEANUP | OPEN |
| GAP-HY-10 | LOW | DRIFT | `stripe_webhook_events` has no purge/retention policy | FIX-DB | OPEN |
| GAP-HY-11 | LOW | UNSPECED | Repo sprawl: ~30 root-level audit artifacts, two migration systems, `deprecated/` + `attached_assets/` dumps | CLEANUP | CLOSED (PR #348: 30 root audit artifacts + `deprecated/` removed, zero-ref proven via git grep; `attached_assets/` already absent; the "two migration systems"/Drizzle-journal sub-item carried to GAP-OP-05/WS-1 — empty but still wired to drizzle.config.ts) |

---

## Zone SP — Spec-Revision Items (lock-cycle only)

| ID | Item | Origin | Status |
|---|---|---|---|
| GAP-SP-01 | Mark Doc 02C V4 superseded by the Doc 05 family for mastery/domain/KPI/projection formulas, constants, difficulty scale, RPC names | Ruling R1 | OPEN |
| GAP-SP-02 | Amend coding-standards §6.2: guardian visibility persists through the Doc 01-defined entitlement grace window (bounded); link-active remains mandatory | Ruling R2 | OPEN |
| GAP-SP-03 | Name the canonical route/service tree (`server/` vs `apps/api/`) and migration target | GAP-AR-04 | OPEN |
| GAP-SP-04 | Candidate review: Doc 01 V8 §0.6 RLS-bypass-at-launch posture vs live RLS-enabled reality | CC SUMMARY | OPEN |
| GAP-SP-05 | Lock the pending values: Doc 02B Appendix A quota/budget set (full-length/calendar limits, tutor token/cost budgets, cooldowns, TTLs) **and assign a tier to standalone RAG retrieval** (spec-silent per VP-04) | CC2-002, VP-04 | OPEN |

---

## Conformant Register (verified correct — keep enforced)

| # | Verified behavior |
|---|---|
| C-1 | App-layer anti-leak serializers: `projectStudentSafeQuestion` allowlist consistent across all pre-submit paths |
| C-2 | Idempotent practice/review submit replay + Stripe webhook dedup ledger |
| C-3 | `student_skill_mastery` write-lockdown (service-role-only) |
| C-4 | Exam timer fully server-authoritative; no client time trusted |
| C-5 | Review jsonb difficulty normalized to 1–3 before mastery |
| C-6 | GCP worker stateless — no Supabase client, no durable LISA state |
| C-7 | Tutor never writes mastery |
| C-8 | TS-layer mastery write choke-point + grep-guard tests |
| C-9 | Mastery level boundaries 0.19/0.39/0.59/0.79 match Doc 05 exactly (the one constant that survived the generation gap) |

---

## Appendix A — Source Map

Unchanged from V1.0 except: TU-06/TU-08/TU-09/ID-09/ID-10/ID-11 finalized by the dual-agent Verification Pass (VP-01..06, corroborated); ID-12 split from ID-11(b); MA-10/MA-11 from the owner-supplied constants dump (VP-07). Raw-ID mapping: CC P1-001→OP-02 · P1-002→OP-04 · P1-003→EX-01 · P1-004→MA-01 · P1-005→MA-04 · P1-006→OP-01 · P1-007→OP-03 · P1-008→TU-02 · P1-009→EX-02 · P1-010→HY-02 · P1-011→HY-01 · P1-012→ID-07 · P1-013→ID-08 · P2-001→TB-01 · P2-002→TB-03 · P2-003→MA-01 · P2-004→MA-03 · P2-005→MA-02 · P2-006→MA-06 · P2-007→ID-01+SP-02 · P2-008→ID-02 · P2-009→ID-03 · P2-010→ID-04 · P2-011→EX-04 · P2-012→TU-04 · P2-013→TU-07 · P2-014→C-2(+HY-10) · P2-015→C-3 · P2-016→R1(→SP-01) · P3-001→AR-01 · P3-002→ID-05 · P3-003→AR-02 · P3-004/005→AR-03 · P3-006→TU-01(+C-6) · P3-007→MA-07 · P3-008→MA-02(+C-7,C-8) · P3-009→AR-04+SP-03 ‖ CC2-001→EX-02 · CC2-002→ID-06+TU-05(+SP-05) · CC2-003→TU-03 · CC2-004→EX-05 · CC2-005→EX-06 · CC2-006→EX-07 · CC2-007→EX-08 · CC2-008→MA-05(R1) · CC2-D→C-4 · CC2-F(jsonb)→C-5 ‖ CX P1-001→TB-01 · P1-002→TB-02 · P1-003→TB-03 · P1-004→HY-01/ID-04 · P2-001→MA-01 · P2-002→OP-01 · P2-003→TU-02 · P2-004→ID-07 · P2-005→ID-05 · P3-001→OP-03 · P3-002→C-6 ‖ CX2 C-001→ID-09 · C-002→ID-10 · C-003→ID-11+ID-12 · C-004→AR-01 · C-005→AR-05 · D-001→TB-01 · D-002→TB-02 · E-001→MA-01 · E-002→MA-05 · E-003→MA-04 · E-004→MA-08 · E-005→EX-01+MA-07 · E-006→EX-03 · E-007→MA-06 · E-008→MA-03 · F-001→TU-03 · F-002→TU-09 · F-003→TU-08 · F-004→TU-02 · F-005→TU-06 · F-006→TU-05 · F-007→TU-10 · G-001→TB-04 · G-002→HY-03 · G-003→HY-04 · G-004→HY-05 · G-005→HY-06 · G-006→HY-07 · G-007→HY-08 · G-008→HY-09 · "CX2-A-003"→nonexistent ‖ VP-01→TU-08 · VP-02→TU-06 · VP-03→TU-09 · VP-04→ID-09(+SP-05) · VP-05→ID-10 · VP-06→ID-11+ID-12 · VP-07→MA-01/MA-04 notes + MA-10 + MA-11 (+C-9).

**Residual open data:** `full_length_adaptive_config` (2 rows) and `test_forms.blueprint` (1 row) not yet dumped — low value (EX-02 established the scoring path never consults them); attach to the EX-01 build ticket as an input rather than a registry gap.

---

## WS-1 execution log — discovered debt (2026-06-08)

Logged during WS-1 implementation so each item has an owner and a closing wave (logged, not silently carried). Not numbered GAPs; the V1.1 66-count is unchanged.

- **Pre-existing `tsc` errors** (present on `cleanup` before WS-1; D1 proven tsc-neutral by diff). (a) `apps/api/src/services/fullLengthExam.ts:2267` (TS2322) + `client/src/components/full-length-exam/ExamRunner.tsx:720` (TS2353) — full-length question shape missing `section` → **close in WS-5** (EX-01 canonical exam schema/types rebuild owns these shapes). (b) `apps/workers/tutor-orchestrator/src/lib/vertex.ts:4` (TS2307) — missing `@google-cloud/vertexai` dependency → **WS-2 (tutor) / hygiene** dependency reconciliation. *Owner to confirm wave assignment.*
- **`tests/ci/rate-limit-sql.contract.test.ts` migration-path coupling** (surfaced by WS-1 D2 archival). The test asserts the content of the now-archived `20260408_rate_limit_ledger_truth.sql`; those objects (`usage_rate_limit_ledger`, `check_and_reserve_*`, `finalize_tutor_usage`) exist in prod (capture B1) and are reproduced by the D3 baseline `0000`. **Closer:** re-point the test at baseline `0000` once D3 lands (fold into D4, or a WS-1 follow-up). Until then its 5 assertions are red by design. *Owner to assign.* (The parallel `tutor-interactions.no-verbatim` coupling is already owned by D4's full-table-drop rewrite.)
