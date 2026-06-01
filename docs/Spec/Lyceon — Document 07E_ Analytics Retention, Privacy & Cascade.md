# **Lyceon — Document 07E: Analytics Retention, Privacy & Cascade**

**Version:** V1.0 **Status:** LOCKED 2026-05-26 (R1–R5 cleanup applied in-lock-cycle per CR-07E-04..08; R6 SWE verdict \= LOCK-CONDITIONAL grade A, no further 07E rewrite required; LOCK-CONDITIONAL cleared by applying the sole pre-lock dependency — Doc 06D `RB-06D-V1-19` Stage 1 schema extension per CR-06D-06 — \+ stale-header fix \+ clean re-audit per CR-07E-09; no version bump; W7 \+ W9 remain post-lock launch gates, not lock blockers) **Last updated:** 2026-05-26 **Owners:** Founder / CTO review \+ Privacy/Compliance gate-keeper for §10.4 conditional resolution (per RB-07E-V1-01 — gate resolves only after W7 \+ W9 closure) **Governed by:** Doc 00 (Authoritative Platform Directive) \+ Doc 07 Parent V1.0 (LOCKED 2026-05-23) \+ Doc 05D V1.0 (LOCKED — §10 cascade base, §10.4 BLOCKING\_PRIVACY\_GAP that 07E V1.0 PROPOSES the compliance posture for — formal resolution conditional on W7 \+ W9 per RB-07E-V1-01) \+ Doc 06D V1.0 (LOCKED — §9 retention registry that 07E populates, §11 privacy-incident sub-class that 07E surfaces are producers of) \+ Doc 07A V1.0 (LOCKED 2026-05-25 — event-time PII redaction joint with 07E warehouse-side).

**Depends on:** Doc 00 (server-authoritative, deterministic, auditable, decision 5 reference-not-restate); Doc 01 V6.0 / V8 (identity model, opaque user\_id semantics, canonical user-activity timestamp field declaration — referenced via project memory pending V8 upload); Doc 01A V1.0 (CANONICAL — §3 config doctrine for the 12-month inactivity-threshold parameter; §14 PII inventory referenced); Doc 03 Main V1.1 (LISA retention matrix §14.2 — referenced; LISA prompt-template-version archive is 07E system-state-archive registry indexed entry); Doc 04B V4.3 (LOCKED — `scoring_model_versions` table with `constants_snapshot` is 07E system-state-archive registry indexed entry); Doc 05D V1.0 (LOCKED 2026-05-14 — §10 cascade base orchestration is the canonical authority that 07E layer-4 analytics body extends; §10.4 BLOCKING\_PRIVACY\_GAP is the privacy/compliance gate for which 07E V1.0 defines the proposed compliance posture — formal resolution requires W7 privacy policy publication \+ W9 legal counsel sign-off per RB-07E-V1-01; until W7 \+ W9 close, Doc 05D fallback hard-delete mode remains active; `mastery_constants_change_log` from §5.2 is 07E system-state-archive registry indexed entry); Doc 06C V1.0 (LOCKED — §7 alert registry not used at V1 per INV-07-09 negative invariant; §10 incident lifecycle base referenced by Doc 06D §11 sidecar; §8 scheduled-job registry referenced for V1.1+ inactivity-detection job registration); Doc 06D V1.0 (LOCKED — §9 retention policy registry is the canonical substrate 07E registers analytics-layer entries against; §11 privacy-incident sub-class is the canonical mechanism 07E analytics-surface failures consume; §11.3 `attach_privacy_class_to_incident` RPC is the canonical write path); Doc 07 Parent V1.0 (LOCKED 2026-05-23 — INV-07-03 retention policy registered \+ INV-07-04 cascade target declared are the family invariants 07E proves; §4 launch-vs-target framing adopted; §8 cross-doc seam table grounds 07E's seam entries); Doc 07A V1.0 (LOCKED 2026-05-25 — §8 PII redaction contract event-time half; 07E owns warehouse-side V1.1+ half via joint `ci/pii-redaction-conformance`; `analytics_user_id` is the opaque identifier 07E cascade body operates against).

**Forward-references (bounded, sanctioned):** Doc 07B BigQuery aggregated store (FWD-07E-01 — V1.1+ infrastructure; 07E registers placeholder retention-policy entry and warehouse-side `ci/pii-redaction-conformance` half is V1.1+-active when BigQuery activates per W-07-PostHog-BQ); Doc 08 multi-vertical (FWD-07E-02 — when international launches activate India DPDP / Brazil ECA jurisdictional overrides to the 12-month inactivity threshold; V1 ships US-only); Doc 08 B2B / school-district FERPA-coupled retention (FWD-07E-03 — when Lyceon partners with schools, FERPA "School Official Exception" applies and retention is school-coupled, not Lyceon-D2C-12-month-inactivity); Doc 09 financial-records retention for Stripe-side payment data (FWD-07E-04 — financial records 7-year compliance is Doc 09 territory, NOT 07E; 07E cascade does NOT extend to Stripe customer records); Doc 10 privacy-policy disclosure text (FWD-07E-05 — privacy policy must disclose the **12-month-inactivity → pseudonymized-retention model, with legal-anonymization upgrade only after W5 (cardinality bucketing) \+ W9 (legal counsel sign-off) closure** per RB-07E-R3-05; Doc 10 owns the disclosure text; 07E declares the dependency); Doc 01 V8.1+ canonical user-activity timestamp field declaration (FWD-07E-06 — 07E references "the field declared canonical by Doc 01 for user-activity tracking"; V1 of 07E ships with the field documented-but-undeclared; V1.1+ when Doc 01 V8.1+ adds the declaration, 07E aligns retroactively without further edit).

**Bundled cross-doc additives owed by 07E:** **W-07E-PARENT-CASCADE-CLARIFY** post-07E-LOCK additive to Doc 07 Parent V1.0 (`RB-07-Parent-V1-08`) clarifying Parent §1 deliverable \#5 "Hits PostHog's delete-person API at launch" — 07E V1.0 supersedes this simple framing with the age-stratified pattern (under-13 hard-delete-everywhere including PostHog `bulk_delete` by `distinct_ids` with `delete_events: true` \+ `delete_recordings: true` per RB-07E-R2-03 canonical V1 path; 13+ leaves events as orphaned-`analytics_user_id` for keep-forever-pseudonymized retention). The Parent statement is not factually wrong (under-13 hits PostHog deletion API at launch); it is incomplete; the additive amends Parent §1 deliverable \#5 to reflect the 07E age-stratified design.

**Applies to:** the canonical retention policy declaration for the analytics layer registered against Doc 06D §9 (§5 retention class taxonomy \+ §6 06D §9 entries); the Doc 05D §10 cascade Layer-4 analytics target body extending the 05D cascade across PostHog \+ BigQuery \+ every other analytics surface (§7 cascade body \+ age-stratified behavior); the **proposed compliance posture declaration** for Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP via 07E V1.0 lock (§8 privacy/compliance proposed-posture declaration — per RB-07E-V1-01 \+ RB-07E-R3-01 — formal resolution requires W7 \+ W9 closure post-lock; 07E lock alone is NOT the formal resolution); the V1.1+ inactivity-trigger mechanism that fires the cascade for 12-month-inactive accounts via the canonical Supabase user-activity timestamp (§9 inactivity-detection \+ §9.2 48-hour DPDP-style pre-deletion notification); the under-13 hard-delete-everywhere variant that overrides the default pseudonymized-retention path for under-13 users (§10 age-stratified cascade); the unified system-state archive registry that indexes every Lyceon-authored versioned-artifact archive across the locked doc corpus for indefinite retention as ML training corpus (§11 archive registry); the joint warehouse-side `ci/pii-redaction-conformance` half (Doc 07A V1.0 owns event-time half; 07E owns warehouse-side V1.1+ half when BigQuery activates per W-07-PostHog-BQ); the privacy-incident sub-class trigger conditions for analytics-surface failures (cascade failures, redaction failures detected post-emission, unauthorized analytics data access events) wired to Doc 06D §11 `attach_privacy_class_to_incident` standard mechanism; the four V1 owned proving mechanisms (§12 — `ci/analytics-retention-policy-registered` \+ `ci/analytics-cascade-target-declared` \+ `ci/historical-pii-conformance` placeholder \+ `ci/ml-training-under13-exclusion` V1-declared-invariant per RB-07E-V1-04; the V1.1+ `ops/inactivity-cascade-conformance` activation hook); the §13 audit profile inheriting 30 passes from Parent plus P31 vocabulary-consistency pass per RB-07E-R3-04 (07E is the body site for P29, P30, and P31); the §14 acceptance criteria covering all 07E-owned launch-required mechanisms \+ the W-07E-PARENT-CASCADE-CLARIFY post-lock additive obligation.

**Explicitly excludes:** the Doc 05D §10 cascade orchestration base (canonical to Doc 05D §10 — Layer 1 hard-delete order \+ Doc 05D's locked Layer 2 one-way transformation (Doc 05D's internal vocabulary calls this "Layer 2 anonymization"; 07E classifies the V1 state as pseudonymized per RB-07E-V1-02) \+ irreversibility-by-construction `gen_random_uuid()` surrogate \+ transactional guarantees — referenced, never restated per Decision 5); the mastery-event canonical tables and audit tables (canonical to Doc 05A \+ Doc 05B \+ Doc 05D §4.1 \+ §4.2 — referenced); the 7-day soft-delete envelope at the account level (canonical to Doc 01 V6.0 §19 and Doc 05D §10.1 — 07E cascade fires immediately upon user-initiated deletion request within this 7-day envelope at the Doc-05D-defined trigger point); the Supabase canonical user-activity timestamp field name (canonical to Doc 01 V8.1+ when declared; FWD-07E-06 forward-ref); the privacy policy disclosure text (canonical to Doc 10 / legal counsel; FWD-07E-05); the under-13 age verification mechanism at signup (canonical to Doc 01 family / guardian trust model — 07E receives the under-13 detection signal and applies hard-delete-everywhere; Doc 01 owns the detection); the 48-hour pre-deletion notification delivery mechanism (V1.1+ — declared shape only at V1; built when V1.1+ inactivity-detection scheduled job activates); the alert-registry registration for analytics surfaces (Doc 06C §7 — none at V1 per INV-07-09 negative invariant); the scheduled-job heartbeat substrate (Doc 06C §8 — V1.1+ when inactivity-detection job activates); the financial-records 7-year retention for Stripe customer data (Doc 09 — FWD-07E-04); the FERPA-coupled retention overrides for school-district partnerships (Doc 08 — FWD-07E-03); the per-jurisdiction overrides for India DPDP 3-year-post-last-interaction / Brazil ECA Digital under-16 obligations (V1.1+ when international launches activate per FWD-07E-02); the cardinality-aware bucketing on cascade for high-cardinality property combinations (V1.1+ pending legal counsel review of bucketing depth per EDPS v SRB CJEU Sept 2025 contextual-risk-based interpretation); the LISA tutor conversation retention (canonical to Doc 03 Main §14.2 — 10 LISA tables with their own retention windows; referenced, never restated); the LISA prompt-template-version archive (canonical to Doc 03 family — 07E indexes the archive in §11 registry; 07E does not own the archive itself); the mastery constants change log (canonical to Doc 05D §5.2 — 07E indexes); the scoring constants archive (canonical to Doc 04B §scoring\_model\_versions — 07E indexes); the per-engine version archives across Doc 02 / 04 / 05 (canonical to each engine's owning doc — 07E indexes if/when each declares its archive canonical, registered as V1.1+ stubs in §11 registry).

---

# **§1 — Purpose & Position in the Doc 07 Family**

Doc 07E V1.0 is the **second launch-required-content sub-doc** in the Doc 07 family per Q-07-6=β drafting order (after 07A which is LOCKED). 07E delivers the analytics-side retention, privacy, and deletion-cascade contracts that Doc 06D §9 retention registry \+ Doc 05D §10 deletion cascade reference as their analytics-layer resolution targets.

**The fundamental design decision 07E codifies:** Lyceon retains data **forever in pseudonymized form** (a personal-data safeguard, not legal anonymization at V1 — see §5.2 \+ RB-07E-V1-02) for ML training and historical system-state reconstruction; user-identifying data has a defined inactivity-based lifecycle (12 months); under-13 users are hard-deleted everywhere per COPPA strict; system-state archives (prompt templates, formula constants, tool behaviors) are retained indefinitely as Lyceon-authored artifacts (non-user system-state archives; no pseudonymization-vs-anonymization question because they carry no user-identifying data).

This is the explicit resolution of three previously-deferred load-bearing obligations:

1. **Doc 06D §9 retention policy registry** has an analytics-layer row deferred to Doc 07 (the FWD-06-01 forward-ref). 07E V1.0 resolves it by registering two retention class entries (one for user-identifying personal data; one for pseudonymized indefinite retention) against the Doc 06D §9 standard schema.

2. **Doc 05D §10 deletion cascade** has a Layer-4 analytics target body deferred to Doc 07 (the Parent §1 deliverable \#5). 07E V1.0 resolves it by specifying the analytics-side cascade body for PostHog \+ BigQuery \+ every analytics surface, age-stratified (under-13 hard-delete-everywhere; 13+ pseudonymized-retention via 05D's irreversibility-by-construction pattern extended to PostHog as orphaned-`analytics_user_id`).

3. **Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP** is the privacy/compliance gate that blocks production enablement of Doc 05D's pseudonymized-retention path. 05D §10.4 explicitly names "privacy/compliance has explicitly confirmed, in a privacy/compliance-owned document, that one-way-anonymized retention of this tuple from minor users is permissible." **07E V1.0 defines the proposed compliance posture; formal resolution requires W7 privacy policy publication \+ W9 legal counsel sign-off** per RB-07E-V1-01. Until W7 \+ W9 close, Doc 05D fallback hard-delete mode remains active; pseudonymized-retention is permitted only post-sign-off; under-13 fallback hard-delete is mandatory regardless of W7/W9 status (COPPA-strict bar applies independently).

**Four V1 owned proving mechanisms:**

1. `ci/analytics-retention-policy-registered` — INV-07-03 proving mechanism. Verifies Doc 06D §9 `infra/retention-policy-registry.yaml` contains analytics-layer entries that resolve to Doc 07E by exact §. Launch-required: true (hard-fail at V1).

2. `ci/analytics-cascade-target-declared` — INV-07-04 proving mechanism. Verifies Doc 05D §10 cascade has a resolvable Doc 07E layer-4 target body declaration. Launch-required: true (hard-fail at V1).

3. `ci/historical-pii-conformance` — joint-with-07A INV-07-02 warehouse-side half. **V1.1+** — placeholder mechanism declared at V1; activates when PostHog → BigQuery warehouse export is live per W-07-PostHog-BQ. Verifies that historical events in BigQuery (across all schema versions ever emitted) do not contain PII fields per the 07A registry's `pii_redaction` contract. The "we kept everything forever and never leaked PII" audit trail.

4. `ci/ml-training-under13-exclusion` — RB-07E-V1-04 invariant-enforcement mechanism. V1-declared invariant \+ V1.1+-runtime-active when ML training pipeline is built. Verifies that ML training input manifests exclude any row traceable to a user ever marked `under_13_detected = true` AND any row with unknown age provenance (conservative default). The algorithmic-disgorgement defense per FTC Edmodo/Kurbo precedent \+ amended COPPA Rule 2026 AI-training-consent requirement.

**One V1.1+ mechanism declared:**

5. `ops/inactivity-cascade-conformance` — V1.1+ activation hook. The runtime mechanism that fires the cascade for 12-month-inactive accounts. **V1 declares the mechanism shape; V1.1+ activates when scheduled jobs activate (per Doc 06E precedent \+ project memory pattern \+ Q-07A-7=δ hybrid trigger).** At V1, user-initiated deletion (via Doc 05D §10 cascade entry point) is the only path that fires the cascade. **Hard activation deadline (RB-07E-V1-07):** the mechanism MUST ship at least 90 days before the earliest possible user expiration (computed as: earliest Supabase user\_row creation timestamp \+ 12 months − 90 days; approximately 2027-02-26 for a May-2026 launch).

**Applies to:**

The `infra/retention-policy-registry.yaml` analytics-layer entries (§6 — two policy entries per the §5 retention class taxonomy); the canonical retention class taxonomy declaration (§5 — `personal_data_with_inactivity_expiry` \+ `pseudonymized_indefinite_retention_pending_anonymization_review`); the Doc 05D §10 cascade Layer-4 body covering PostHog, BigQuery V1.1+, and every other analytics surface (§7 — analytics-side cascade body with age-stratified behavior \+ irreversibility-by-construction continuity from 05D §10.3 extended to PostHog); the Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP **proposed compliance posture declaration** (§8 — privacy/compliance proposed-posture declaration per RB-07E-R3-01; formal resolution requires W7 \+ W9 closure post-lock); the V1.1+ inactivity-trigger mechanism that fires cascade for 12-month-inactive accounts (§9 — inactivity-detection scheduled job \+ 48-hour pre-deletion notification — both V1.1+); the under-13 hard-delete-everywhere variant overriding the default pseudonymized-retention path (§10 — age-stratified cascade); the unified system-state archive registry indexing every Lyceon-authored versioned-artifact archive (§11 — archive registry with V1-bodied \+ V1.1+-stub entries per Q-07E-V2-2=γ lock); the four V1 owned proving mechanisms with six-element §6.13 implemented-definition tables (§12 — three V1-active CI passes \+ one V1-declared-invariant \+ V1.1+-runtime mechanism `ci/ml-training-under13-exclusion` per RB-07E-V1-04); the audit profile inheriting 30 passes from Parent with P29 and P30 implementation-site notes plus the 07E-introduced P31 vocabulary-consistency pass per RB-07E-R3-04 (§13 — 31-pass suite); the §14 acceptance criteria; the §15 change records; the §16 cleanup register \+ closing.

**Decision 5 holds end-to-end in 07E:** the Doc 05D §10 cascade orchestration body is referenced by exact § anchors and never restated; the Doc 06D §9 retention policy registry schema is consumed via the standard schema and never re-declared; the Doc 06D §11 privacy-incident sub-class mechanism is consumed via the standard `attach_privacy_class_to_incident` RPC and never re-declared; the Doc 03 Main §14.2 LISA retention matrix is referenced for the LISA-tutor-conversation surface and never restated; the Doc 01A §3 config doctrine governs the 12-month inactivity threshold parameter and 07E does not re-declare config primitives; the Doc 07A V1.0 §7.1 `analytics_user_id` HMAC-derivation algorithm is referenced as the opaque identifier the cascade operates against and never restated; the Doc 07A V1.0 §8.1 split-enum PII redaction contract is referenced and never restated; the Doc 04B V4.3 `scoring_model_versions` table \+ Doc 05D §5.2 `mastery_constants_change_log` table \+ Doc 03 LISA prompt-template archive (when declared) are referenced as system-state archive entries and never restated.

---

# **§2 — Scope and Boundary**

## **2.1 07E owns**

| Surface | Body location | Status |
| ----- | ----- | ----- |
| Retention class taxonomy (`personal_data_with_inactivity_expiry` \+ `pseudonymized_indefinite_retention_pending_anonymization_review`) | §5 | V1-bodied |
| Doc 06D §9 retention policy registry analytics-layer entries (2 entries) | §6 | V1-bodied |
| Doc 05D §10 cascade Layer-4 analytics target body | §7 | V1-bodied; age-stratified |
| Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP proposed compliance posture (per RB-07E-V1-01 \+ RB-07E-R3-01 \+ RB-07E-R4-01 — 07E V1.0 lock declares the proposed posture; formal resolution requires W7 \+ W9 closure post-lock) | §8 | V1-bodied |
| V1.1+ inactivity-detection scheduled job declaration (shape only at V1) | §9 | V1-declared; V1.1+-active |
| 48-hour pre-deletion notification declaration (shape only at V1) | §9.2 | V1-declared; V1.1+-active |
| Under-13 hard-delete-everywhere cascade variant | §10 | V1-bodied |
| Unified system-state archive registry (3 V1-bodied entries \+ V1.1+ stubs per Q-07E-V2-2=γ) | §11 | V1-bodied \+ stubs |
| `ci/analytics-retention-policy-registered` proving mechanism | §12.1 | V1-active |
| `ci/analytics-cascade-target-declared` proving mechanism | §12.2 | V1-active |
| `ci/historical-pii-conformance` proving mechanism (warehouse-side `ci/pii-redaction-conformance` half) | §12.3 | V1.1+-active (placeholder at V1) |
| `ops/inactivity-cascade-conformance` declaration | §12.4 | V1-declared; V1.1+-active |
| `ci/ml-training-under13-exclusion` (RB-07E-V1-04 — invariant declaration \+ V1.1+ runtime enforcement) | §12.5 | V1-declared invariant; V1.1+-runtime-active |
| Privacy-incident sub-class trigger conditions for analytics-surface failures (06D §11 consumer) | §7.6 | V1-bodied |
| Cross-doc seam table grounding | §15 | V1-bodied |

## **2.2 07E explicitly does NOT own (Decision 5 — referenced, never restated)**

| Surface | Canonical owner | Citation |
| ----- | ----- | ----- |
| Doc 05D §10 cascade orchestration base (Layer 1 hard-delete order \+ Doc 05D's locked Layer 2 one-way transformation — Doc 05D's internal vocabulary calls this "Layer 2 anonymization", 07E classifies the V1 state as pseudonymized per RB-07E-V1-02 — \+ irreversibility-by-construction \+ transactional guarantees) | Doc 05D V1.0 §10 | §7.1 / §7.2 / §7.3 |
| `gen_random_uuid()` surrogate pattern \+ INV-05D-16 irreversibility | Doc 05D V1.0 §10.3 | §7.3 |
| Mastery-event canonical tables \+ `mastery_event_audit_log` \+ `mastery_domain_refresh_audit_log` | Doc 05D V1.0 §4.1 / §4.2 | §7.2 |
| 7-day soft-delete envelope at account level | Doc 01 V6.0 §19 / Doc 05D §10.1 | §7.5 |
| Supabase canonical user-activity timestamp field name | Doc 01 V8.1+ (FWD-07E-06) | §9.1 |
| Privacy policy disclosure text | Doc 10 (FWD-07E-05) | §8.3 |
| Under-13 age verification at signup | Doc 01 family (guardian trust model) | §10.1 |
| 48-hour pre-deletion notification delivery mechanism (delivery channels, templates) | V1.1+ build territory | §9.2 |
| Doc 06D §9 retention policy registry schema | Doc 06D V1.0 §9.1 | §6.1 |
| Doc 06D §11 privacy-incident sub-class mechanism \+ `attach_privacy_class_to_incident` RPC | Doc 06D V1.0 §11.3 | §7.6 |
| Doc 07A V1.0 `analytics_user_id` HMAC-derivation algorithm | Doc 07A V1.0 §7.1 | §7.3 |
| Doc 07A V1.0 split-enum PII redaction contract | Doc 07A V1.0 §8.1 | §12.3 |
| `analytics_user_id` storage \+ propagation | Doc 07A V1.0 §7.1 \+ §9.2 | §7.3 |
| Stripe customer record retention (7-year financial records) | Doc 09 (FWD-07E-04) | §7.4 |
| FERPA-coupled retention for school-district partnerships | Doc 08 (FWD-07E-03) | §15 W3 |
| India DPDP / Brazil ECA jurisdictional override mechanisms | V1.1+ (FWD-07E-02) | §15 W4 |
| Cardinality-aware bucketing on cascade | V1.1+ pending legal counsel | §15 W5 |
| LISA tutor conversation retention (10 LISA tables) | Doc 03 Main V1.1 §14.2 | §11.5 |
| LISA prompt-template-version archive (when declared canonical) | Doc 03 family | §11.5 |
| Mastery constants change log | Doc 05D V1.0 §5.2 | §11.3 |
| Scoring constants archive (`scoring_model_versions` \+ `constants_snapshot`) | Doc 04B V4.3 | §11.4 |
| Per-engine version archives (practice/exam/tutor/mastery engines) | Each engine's owning doc | §11.6 (V1.1+ stubs) |
| Alert-registry registration for analytics surfaces | Doc 06C V1.0 §7 (none at V1 per INV-07-09) | n/a |
| Scheduled-job heartbeat substrate | Doc 06C V1.0 §8 (V1.1+ when inactivity-detection job activates) | §9.1 |
| Alert routing tiers \+ severity crosswalk | Doc 01A §18 via Doc 06C §6 | n/a (no V1 alerts) |
| Incident lifecycle base | Doc 06C V1.0 §10 | §7.6 |
| `analytics_user_id` HMAC salt management | Doc 07A V1.0 §7.1 \+ Doc 01A §61 secret-config | §7.3 |
| `infra/retention-policy-registry.yaml` substrate | Doc 06D V1.0 §9.1 | §6.1 |
| `infra/sat-test-calendar.yaml` (cohort assignment) | Doc 07A V1.0 §10 | n/a |
| `event-schema-registry-parity` event-time CI | Doc 07A V1.0 §11.1 | §12.3 |
| `pii-redaction-conformance` event-time half | Doc 07A V1.0 §11.2 | §12.3 (joint) |
| 25 V1 events \+ 8 event classes catalog | Doc 07A V1.0 §6 | n/a |
| 4 V1 Person Properties (`analytics_user_id`, `exam_date`, `exam_date_cohort_id`, `exam_date_source`) | Doc 07A V1.0 §7 | n/a |

## **2.3 03C boundary (inherited family-wide from 06C/06D/06E \+ Doc 07 Parent §2.3)**

Doc 03C V3.0 LISA GCP orchestration substrate is owned by Doc 03C — Cloud Run service config, Vertex AI Gemini client wrapper, Cloud Tasks queue config, compaction-job orchestration. Doc 07E does NOT extend Doc 03C's substrate; if 07E V1.1+ adds warehouse-side mechanisms that touch GCP (e.g., BigQuery export pipeline orchestrated by Cloud Run), the substrate addition is owned by Doc 03C as a 03C V1.1+ amendment, not by 07E. 07E only specifies the analytics-layer contracts that those substrates serve.

## **2.4 Doc 05 family boundary (mastery KPI canonical split — inherited family-wide)**

Doc 05B owns mastery KPI body math (formula, blend, range, level boundaries) canonically. 07E references 05B for any retention-policy-adjacent mastery surfaces (e.g., the `mastery_event_audit_log` table per §11.3 is on the 07E system-state-archive registry but the table's row contents are 05A/05D canonical — 07E does not restate). 07E never restates a mastery KPI body, threshold, or formula.

## **2.5 Inheritance (Parent \+ 07A consumer)**

07E inherits the Doc 07 Parent V1.0 framing — the "spec-locked, infrastructure-target-state" doctrine, the 30-pass audit suite with 5 family-new passes (P26-P30) inherited from Parent, the INV-07-01..09 family invariants applied at 07E grain, the launch-required-vs-target-state annotation discipline. **07E V1.0 additionally introduces P31 (vocabulary-consistency pass per RB-07E-R3-04) bringing the 07E-applied audit suite to 31 passes total.** 07E is a consumer of Doc 07A V1.0 — the event-time PII redaction contract is 07A-owned and joint-with-07E for warehouse-side; the `analytics_user_id` HMAC-derived opaque identifier is 07A-owned and consumed-by-07E for cascade operations.

---

# **§3 — Threat Model (Operational \+ Privacy)**

The threat model identifies the load-bearing failure modes 07E V1.0 defends against. Each threat names a defense mechanism \+ cites the § where the defense is bodied.

1. **Anonymization-overclaim risk: V1 retained data fails the legal-anonymization bar.** Per EDPS v SRB CJEU Sept 4 2025 judgment, pseudonymized data may fall outside GDPR ONLY when "the risk of a third-party recipient having reasonable means to reidentify pseudonymised data is insignificant" — assessed contextually. If 07E claims "we anonymized the data" but the retained tuple contains high-cardinality combinations (e.g., specific cohort \+ specific score \+ specific exam date) that re-identify individuals through joinability against retained-active-user data, the claim is false in fact and exposes Lyceon to GDPR Article 5(1)(e) storage-limitation violation \+ algorithmic disgorgement risk per FTC enforcement pattern (Edmodo / Kurbo precedent). The defense at V1 is to NOT make the legal-anonymization claim — class 2 is named `pseudonymized_indefinite_retention_pending_anonymization_review` per RB-07E-V1-02, and privacy policy (W7) uses "pseudonymized" vocabulary. *Defense:* §7.3 cascade body extends Doc 05D §10.3 irreversibility-by-construction (no reverse-mapping table; `gen_random_uuid()` surrogate one-way) to PostHog/BigQuery surfaces; the retained tuple per Doc 05D §10.2 step 11 is `(difficulty, source_family, correct, position-or-ordinal, occurred_at-as-relative-offset, domain, skill, section, outcome)` — explicitly excludes identifying free-text \+ bucket-able cohort/exam-date fields; §15 W5 watch item flags cardinality-aware bucketing as V1.1+ work pending legal counsel review of bucketing depth per jurisdiction. The path to potentially upgrading the legal status from pseudonymized to anonymized requires W5 \+ W9 closure.

2. **Algorithmic disgorgement risk for under-13 data.** Per amended COPPA Rule (in force 2025-06-23, compliance deadline 2026-04-22 — past as of the working date 2026-05-25) and FTC enforcement precedent (Edmodo 2023 $6M penalty \+ algorithm deletion order; Kurbo/WW 2022 $1.5M penalty \+ algorithmic disgorgement requirement), "indefinite retention to improve algorithms does not override legal bans on indefinite retention" — direct FTC Commissioner statement. If Lyceon retains pseudonymized under-13 user event data for ML training, the FTC may require deletion of all ML models trained on that data ("algorithmic disgorgement"). *Defense:* §10 age-stratified cascade variant — under-13 hard-delete-everywhere (Supabase \+ PostHog \+ BigQuery \+ every surface) with NO pseudonymized-retention path; §10.3 mechanism extends Doc 05D §10.4 fallback mode ("privacy-conservative fallback: hard-delete the Layer-2 rows") to all surfaces for under-13; under-13 detection signal from Doc 01 family triggers immediately on age-verification confirmation. PLUS the §10.6 \+ §12.5 executable ML-training-exclusion invariant (RB-07E-V1-04) — runtime enforcement, not policy-only.

3. **Inactivity-cascade false-positive deletes active users.** If the 12-month-inactivity timer mistakenly fires for an active user (Supabase activity timestamp stale, data corruption, scheduled job bug), the wrong user's PII is deleted and their account becomes unrecoverable. *Defense:* §9.1 Supabase-as-primary-and-only activity signal per Q-07E-V3-3=γ-revised-to-Supabase-only (PostHog `$last_seen_at` is analytics-side and becomes pseudonymized after cascade per RB-07E-V1-02, so it is the wrong signal); §9.2 48-hour pre-deletion notification gives user a recovery window (per DPDP 48-hour rule); §9.3 user can reset the timer by signing in during the notification window; cascade fires only if user remains inactive through the 48-hour window.

4. **Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP unresolved → 05D's pseudonymized-retention path stays disabled in production.** If 07E V1.0 doesn't define a proposed compliance posture for the privacy/compliance gate that 05D §10.4 names, then 05D ships with the fallback hard-delete-everything mode indefinitely and Lyceon loses the keep-forever-pseudonymized ML training corpus from day 1 — and even if 07E does declare the posture, formal resolution still depends on external sign-offs. *Defense:* §8 privacy/compliance gate proposed-posture declaration — 07E V1.0 lock is the privacy/compliance-owned document 05D §10.4 names, but **per RB-07E-V1-01 the lock alone is NOT the formal resolution**; lock declares the proposed compliance posture, and formal resolution requires W7 (Doc 10 privacy policy publication) \+ W9 (legal counsel sign-off) post-lock. Cross-doc seam to Doc 05D §10.4 explicit; 05D's pseudonymized-retention path can be enabled in production only after W7 \+ W9 close (subject to deploy-coordination cross-doc gate per §15). Until then, Doc 05D fallback hard-delete mode remains active.

5. **PII leak through cascade orphan-event window.** If the cascade fires Layer 1 (hard-delete derived state) and Layer 2 (pseudonymize event/audit) at Supabase but the PostHog-side pseudonymization is asynchronous (PostHog deletion is async per PostHog docs — "processed asynchronously during non-peak hours"), there is a window during which Supabase shows the user deleted but PostHog still has events with the original `analytics_user_id`. If an analytics surface query runs during this window, it sees orphaned events still keyed to a deleted user. *Defense:* §7.3 cascade design — at V1, PostHog-side cascade is "leave events under original `analytics_user_id`" for 13+ users (post-W7+W9), so there is no pseudonymization async to wait for; the events ARE the pseudonymized form (a personal-data safeguard, not legal anonymization at V1 — see §5.2 \+ RB-07E-V1-02) because the bridge from `analytics_user_id` to real student is hard-deleted at Supabase. For under-13, §10 mechanism: fire PostHog `bulk_delete` with `distinct_ids: [analytics_user_id]` \+ `delete_events: true` (canonical V1 path per RB-07E-R2-03) AND record the deletion request in Doc 05D §10 cascade audit; the V1.1+ status-poll mechanism per §9.4 verifies async deletion completion — but at V1, the fire-and-forget pattern is accepted as the documented constraint of PostHog's async deletion API; the under-13 cohort is small enough at launch (Lyceon's SAT-prep demographic is 15-18) that the operational risk is bounded.

6. **Privacy policy disclosure misalignment.** GDPR Article 5(1)(b) purpose-limitation \+ amended COPPA Rule \+ India DPDP \+ Brazil ECA all require that the purposes of data retention be disclosed at collection. If Lyceon's privacy policy (owned by Doc 10\) doesn't disclose "we retain pseudonymized records of platform interactions indefinitely for product improvement and AI model training" \+ "personal information retained 12 months from last activity then deleted" \+ "pseudonymized retained records are subject to safeguards under personal-data protections; cardinality-aware bucketing is V1.1+ work pending legal counsel review of post-EDPB anonymization guidelines, after which the legal status may be upgraded to anonymized," then the entire retention model is non-compliant regardless of how well 07E specifies the mechanism. *Defense:* §8.3 privacy-policy disclosure obligation declaration — 07E declares the dependency on Doc 10 / legal counsel disclosure text using **pseudonymized** vocabulary per RB-07E-V1-02; §15 W7 watch item flags Doc 10 \+ legal counsel review as a V1 launch gate (privacy policy must be drafted \+ reviewed before launch); 07E specifies the disclosure obligation shape (what must be disclosed) but does not author the disclosure text.

7. **Per-jurisdiction compliance gap on international launch.** Lyceon's V1 launch is US-only per project memory. When international launches activate (UK / Canada / India / Brazil per the launch sequence), per-jurisdiction retention overrides may be needed — India DPDP requires deletion within 3 years of last interaction (less strict than our 12 months — compatible) and 48-hour pre-deletion notification (operationally enforced by §9.2); Brazil ECA Digital requires age-assurance for under-16 (handled at Doc 01 family signup gate); EU GDPR may require stronger pseudonymization or transition to legal anonymization per post-SRB EDPB guidelines that are still in development as of 2026-05-26. *Defense:* §15 W4 watch item flags per-jurisdiction overrides as V1.1+ work activating on international launch; FWD-07E-02 forward-ref to Doc 08 for multi-vertical expansion; V1 ships US-only with US-COPPA-strict under-13 handling \+ general 13+ keep-forever-pseudonymized model.

8. **System-state archive drift.** If the system-state archive registry (§11) becomes stale (registered archives change shape without updating the registry; new versioned-artifact archives are added in other docs without registering in 07E), a future LLM trained on the historical corpus may have gaps or temporal inconsistencies. *Defense:* §11.7 staleness check shape declaration — `ci/system-state-archive-registry-parity` placeholder (V1.1+ activates when warehouse export is live to validate archive entries exist and are populated); §15 W6 watch item flags archive-registry maintenance as ongoing discipline; V1 ships the registered set at lock-time; subsequent archive additions are bundled cross-doc additives by the archive-owning doc to 07E (similar pattern to W-07A-PARENT-ADDITIVE).

## **3.4 Doc 03 Main citation path (carried family-wide from 06C/06D/06E \+ Doc 07 Parent §3.4)**

Doc 03 Main V1.1 is not present in this session's source tree. Citations to §11 (usage caps), §14.2 (retention matrix), §24 (LISA cost metrics), and to the LISA prompt-template-version archive (when/if declared canonical) are made per the project handoff record. On Doc 03 Main upload, 07E's §11.5 LISA prompt archive entry \+ §11 LISA retention cross-references gain parsed reconciliation as additional input to audit; until then, cited section names are recorded in proof artifacts as `cited_per_project_handoff_record`. Registered as W1 in §15 (non-blocking).

## **3.5 Doc 05D / Doc 05B citation paths**

Doc 05D V1.0 IS present in this session's source tree (uploaded 2026-05-26 per Final-2=β pre-draft decision). Citations to §10 cascade, §10.3 irreversibility, §10.4 BLOCKING\_PRIVACY\_GAP, §10.5 idempotency, §5.2 mastery\_constants\_change\_log, §4.1 mastery\_event\_audit\_log, §4.2 mastery\_domain\_refresh\_audit\_log are direct parsed citations. Doc 05B V1.0 is not present — citations to 05B mastery-KPI body math are per project memory per Doc 07 Parent §3.5; non-blocking (07E does not body any mastery KPI math).

---

# **§4 — The "Spec-Locked, Infrastructure-Target-State" Framing (07E-Specific Application)**

Doc 07E V1.0 inherits the Doc 07 Parent V1.0 §4 framing. Applied at 07E grain:

* **Launch-required at V1:** the retention class taxonomy declaration (§5 — two classes locked \+ populated against Doc 06D §9 standard schema in §6); the Doc 05D §10 Layer-4 cascade target body declaration (§7 — analytics-side cascade body with age-stratified behavior — the body is "spec-locked"; the user-initiated path is V1-active via Doc 05D §10 cascade entry point); the Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP **proposed-compliance-posture declaration** (§8 — 07E V1.0 lock declares the proposed posture; formal resolution conditional on W7 \+ W9 closure per RB-07E-V1-01); the under-13 hard-delete-everywhere variant (§10 — V1-active because under-13 signups happen day-1 even though the target demographic is 15-18); the unified system-state archive registry (§11 — V1-bodied for 3 entries \+ V1.1+ stubs per Q-07E-V2-2=γ lock); `ci/analytics-retention-policy-registered` hard-fail at V1 (§12.1); `ci/analytics-cascade-target-declared` hard-fail at V1 (§12.2); the bundled cross-doc additive W-07E-PARENT-CASCADE-CLARIFY clarifying Parent §1 deliverable \#5 (post-07E-LOCK; `RB-07-Parent-V1-08`).

* **Target-state V1.1+:** the inactivity-detection scheduled job that fires the cascade for 12-month-inactive accounts (§9 — declared shape only at V1; activates when scheduled jobs activate per Doc 06E precedent \+ project memory pattern); the 48-hour pre-deletion notification delivery mechanism (§9.2 — declared shape only; built when V1.1+ inactivity job activates); the warehouse-side `ci/historical-pii-conformance` (§12.3 — placeholder mechanism declared at V1; activates when BigQuery warehouse export is live per W-07-PostHog-BQ); the `ops/inactivity-cascade-conformance` runtime mechanism (§12.4 — declared shape only at V1; runtime body activates V1.1+); cardinality-aware bucketing on cascade for high-cardinality property combinations (§15 W5 — V1.1+ pending legal counsel review of bucketing depth); per-jurisdiction overrides for India DPDP / Brazil ECA / EU GDPR (§15 W4 — V1.1+ on international launch activation); FERPA-coupled retention for school-district partnerships (§15 W3 — V1.1+ on Doc 08 B2B activation).

## **4.1 What "spec-locked" means for 07E specifically**

The Doc 06D §9 retention registry needs Lyceon's analytics-layer retention class declarations as a deploy-time substrate. The Doc 05D §10 cascade orchestration needs Lyceon's analytics-layer cascade body as a deploy-time substrate. Both are blocked on Doc 07E V1.0 spec lock (the SPEC\_CONTRACT\_GATE class from Doc 07 Parent §4.4). 07E V1.0 delivers the substantive spec — the retention class names, the Doc 06D §9 row contents, the Layer-4 cascade body behavior, the age-stratified variant — without requiring all the V1.1+ infrastructure (inactivity-detection scheduled job, BigQuery warehouse, cardinality bucketing) to be built. The spec is the deliverable; infrastructure follows.

## **4.2 Acceptance criteria for 07E V1.0 launch-required state**

At V1 lock:

* Doc 06D §9 `infra/retention-policy-registry.yaml` populates two analytics-layer entries pointing at 07E §6 (`ci/analytics-retention-policy-registered` passes against this)  
* Doc 05D §10 cascade Layer-4 has a resolvable analytics-target reference pointing at 07E §7 (`ci/analytics-cascade-target-declared` passes against this)  
* Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP has its **proposed compliance posture** declared in §8 (RB-07E-V1-01 reframe) — formal RESOLUTION is conditional on W7 \+ W9 closure post-lock  
* Under-13 hard-delete-everywhere variant is V1-active (deploys with Doc 05D §10 cascade activation)  
* System-state archive registry has 3 V1-bodied entries (mastery constants log, scoring constants, PostHog event stream) \+ named stubs per Q-07E-V2-2=γ  
* W-07E-PARENT-CASCADE-CLARIFY is queued for post-lock Parent additive  
* 31-pass audit suite passes clean (30 inherited from Parent \+ P31 introduced by 07E per RB-07E-R3-04)

The V1.1+ activations enumerated above are NOT required at V1 lock — they are declared but not built.

## **4.3 What 07E V1 does NOT do**

* Does NOT body the inactivity-detection scheduled job (V1.1+ build)  
* Does NOT body the 48-hour pre-deletion notification delivery (V1.1+ build)  
* Does NOT body the cardinality bucketing logic (V1.1+ pending legal counsel)  
* Does NOT body the warehouse-side `ci/historical-pii-conformance` (V1.1+ when BigQuery activates)  
* Does NOT body per-jurisdiction overrides (V1.1+ on international launch)  
* Does NOT author the privacy policy disclosure text (Doc 10 / legal counsel)  
* Does NOT extend the Doc 05D §10 cascade orchestration base — only adds the analytics-layer body that 05D §10 referenced  
* Does NOT add new event types, schemas, or registry entries (Doc 07A V1.0 territory)  
* Does NOT add new KPI registry entries (Doc 07B V1.1+ territory)

---

# **§5 — Retention Class Taxonomy (Q-07E-1 / Q-07E-V2 / Q-07E-V3 Locks)**

Per the locked design overrides from Karl during pre-draft Q\&A (specifically Q-07E-1=keep-forever / Q-07E-V3 12-month inactivity / under-13 hard-delete-everywhere), 07E declares **two retention classes** for the analytics layer.

## **5.1 Class 1 — `personal_data_with_inactivity_expiry`**

**Definition:** User-identifying personal data and the join bridges that link analytics events back to a real student. This class covers Supabase identity-side PII tables (`auth.users`, `profiles`, related). 07E does not enumerate these tables — the canonical owner is Doc 01 V6.0 §19 / V8 (the existing identity model). What 07E declares is the **retention horizon** and **trigger mechanism** that apply to this class.

**Retention horizon:** 12 months from last activity (canonical signal: the Supabase-canonical user-activity timestamp field, declared by Doc 01 V8.1+ per FWD-07E-06). 12 months is hard-locked at V1; the value is stored as a Doc 01A §3 config primitive (`USER_INACTIVITY_RETENTION_MONTHS = 12`); V1.1+ may extend to 24 months via config-change pending legal counsel review, with no 07E spec change required (per Doc 01A config doctrine).

**12-month rationale:** the value tracks FTC Kurbo/WW settlement precedent (12-months-post-last-use as the FTC-validated retention bar — see §3 threat 2 citation). Conservative against amended COPPA Rule 2026 "no indefinite retention" requirement for under-13 (though under-13 are hard-delete-everywhere per §10, not subject to this class). Stricter than India DPDP's 3-year-post-last-interaction obligation. GDPR Article 5(1)(e) compatible (purpose-limited, defined lifecycle).

**Trigger mechanism:** at V1, user-initiated deletion only (via Doc 05D §10 cascade entry point — which fires at 7-day soft-delete expiry per Doc 05D §10.1). V1.1+ adds inactivity-based trigger per §9 — when Supabase-canonical user-activity timestamp shows 12 months elapsed, the inactivity-detection scheduled job sends 48-hour pre-deletion notification per §9.2; if user remains inactive through the 48-hour window, the cascade fires.

**Cascade outcome:** the Doc 05D §10 cascade fires per its locked specification — Layer 1 hard-deletes the 10 derived state tables (05A `student_skill_mastery`, 05B `student_domain_mastery` \+ KPIs, 05C projections \+ snapshots \+ refresh state \+ outbox); Doc 05D's Layer 2 applies its locked one-way transformation to the canonical event source tables \+ `mastery_event_audit_log` \+ `mastery_domain_refresh_audit_log` using `gen_random_uuid()` surrogate per INV-05D-16 irreversibility-by-construction (Doc 05D's internal vocabulary calls this "Layer 2 anonymization"; 07E classifies the resulting V1 state as pseudonymized per RB-07E-V1-02 \+ RB-07E-R5-04 — engineering mechanism identical, legal label differs). **07E's Layer-4 analytics body** (§7) additionally handles the PostHog \+ BigQuery surfaces age-stratified per §10.

**Surface inventory:** the canonical surfaces in this class are owned by Doc 01 V6.0 §19 (identity PII) \+ Doc 05D §10 (Lyceon-side derived state); 07E does NOT re-enumerate them. 07E adds the analytics-side surfaces that 05D §10 explicitly does not cover (PostHog person records keyed to `analytics_user_id`; future BigQuery V1.1+ records keyed to `analytics_user_id`).

## **5.2 Class 2 — `pseudonymized_indefinite_retention_pending_anonymization_review`**

**Definition:** **Pseudonymized** (not legally anonymized at V1) records of platform interactions \+ Lyceon-authored versioned-artifact archives that constitute the system-state-archive ML training corpus. After cascade execution removes the bridge from `analytics_user_id` to real identity, the surviving event-stream data falls into this class; system-state archives (mastery constants log, scoring constants, prompt templates, etc.) are in this class from creation.

**RB-07E-V1-02 naming correction (SWE R1 finding accepted):** The class was originally named `anonymized_indefinite_retention` in the V1.0 DRAFT. SWE R1 review correctly flagged this as overclaim. The legally honest V1 name is `pseudonymized_indefinite_retention_pending_anonymization_review` — the engineering mechanism is structurally pseudonymizing (the bridge is destroyed; `gen_random_uuid()` surrogate; no reverse-mapping table) but the **legal classification as anonymized vs pseudonymized requires post-EDPB-guidelines counsel review \+ W5 cardinality bucketing closure**.

**Retention horizon:** indefinite. No expiry. The data does not have a defined deletion lifecycle except via manual operator deletion for compliance response (e.g., regulator-ordered deletion of specific records that turn out to contain identifying information despite the pseudonymization design).

**Pseudonymization standard:** the retained tuple per Doc 05D §10.2 step 11 (referenced, not restated): `(difficulty, source_family, correct, position-or-ordinal, occurred_at-as-relative-offset, domain, skill, section, outcome)`. For PostHog-side analytics events at 13+ cascade time, the pseudonymization is structural: the bridge from `analytics_user_id` → Supabase user\_id is severed at Layer 1 (hard-delete of the Supabase user row); the events themselves remain under their original `analytics_user_id` per §7.3 — they ARE pseudonymized (still identifiable via the high-cardinality property combinations that W5 addresses; only structurally re-identification-resistant via bridge severance). This honors INV-05D-16 irreversibility-by-construction (no reverse-mapping table; no salt-recoverable derivation) at the **pseudonymization safeguard level**, NOT at the GDPR-anonymized level.

**Legal posture — pseudonymization, not anonymization (RB-07E-V1-02):**

Per the EDPS v SRB CJEU judgment (4 September 2025, Case C-413/23 P), pseudonymized data may fall outside GDPR's scope when "the risk of a third-party recipient having reasonable means to reidentify pseudonymised data is insignificant" — assessed contextually. **CRITICAL CAVEAT (RB-07E-V1-02 correction):** the CJEU did NOT say pseudonymized data is automatically anonymous; it said pseudonymized data is not personal data **in all cases and for every person**, and identifiability must be assessed contextually \+ the controller-side perspective matters at collection. The EDPB's own pseudonymization guidance (EDPB 01/2025 in development; carried as W8) treats pseudonymization as a safeguard within personal-data processing, not as automatic anonymization release.

**The honest V1 posture:**

* Lyceon's design satisfies the structural-safeguard bar for the post-cascade state: the salt exists in Supabase env secrets but the Supabase user\_id input has been hard-deleted, making the HMAC un-invertible at fact regardless of salt access.  
* Lyceon's design does NOT satisfy the legal-anonymization bar at V1 because the high-cardinality re-identification vector (cohort \+ score combinations identifying small groups) remains. The post-EDPB anonymization guidelines (W8) may impose stronger requirements that V1 doesn't meet.  
* Therefore: class 2 is **pseudonymized** (a safeguard) at V1 — not anonymized in the legal sense. Privacy policy disclosure (W7) must use "pseudonymized" or equivalent legally-honest language, not "anonymized."  
* W5 V1.1+ cardinality bucketing closure is the path to potentially upgrade class 2 to legally-anonymized status. Counsel review (W9) determines whether the engineering proof is sufficient for the upgrade.

**Trigger mechanism:** N/A — class 2 has no deletion trigger except manual operator intervention. The transition INTO class 2 fires at cascade execution per class 1's trigger (user-initiated OR V1.1+ inactivity-based).

**Surface inventory:** PostHog person records \+ events for 13+ post-cascade users (orphaned `analytics_user_id`); BigQuery aggregated derived data V1.1+; the 6 system-state archives enumerated in §11 (3 V1-bodied \+ 3 V1.1+ stubs). **System-state archives are inherently not user-identifying (they are Lyceon-authored configuration, not user-event-stream data) so they sit in class 2 from creation without raising the pseudonymization-vs-anonymization question.**

## **5.3 Why two classes, not three or more**

The keep-forever-pseudonymized design rationale (Karl pre-draft override) collapses what could have been more granular retention classes (e.g., `standard_analytics_24mo`, `extended_analytics_7yr` for revenue-tied data, separate classes per event class, etc.) into a single pseudonymized-indefinite class. The simplification is intentional: there is no business need at V1 to distinguish "events retained for 24 months" from "events retained for 7 years" — once pseudonymized, the data has no per-class lifecycle distinction. Class 1 carries the only lifecycle (inactivity-based expiry of user-identifying data); class 2 carries everything that survives.

Future V1.1+ extensions if needed:

* Split class 2 if specific event types (e.g., billing events) require active hard-delete on a financial-records-7-year schedule per Doc 09 (FWD-07E-04 boundary)  
* Add jurisdictional-override classes for India DPDP / Brazil ECA (V1.1+ on international launch per §15 W4)

V1 ships with the two-class minimum.

## **5.4 Class boundaries and overlaps**

Class 1 (`personal_data_with_inactivity_expiry`) and class 2 (`pseudonymized_indefinite_retention_pending_anonymization_review`) are **mutually exclusive** for any individual data row at any time — a row is in exactly one class. The cascade execution is the transition event:

* Pre-cascade: rows containing `analytics_user_id` are in class 1 (because the bridge to identity exists via Supabase). System-state archives are in class 2 from creation (no individual identity attached).  
* During cascade: Layer 1 hard-deletes class 1 derived state; Doc 05D's Layer 2 applies its locked one-way transformation to Lyceon-side event tables — transition to class 2 (Doc 05D vocabulary calls this "Layer 2 anonymization"; 07E classifies the resulting V1 state as pseudonymized per RB-07E-V1-02 \+ RB-07E-R5-04); §7.3 PostHog-side body leaves events in place (the bridge is removed, not the events — events transition to class 2 by Layer 1 severing the bridge).  
* Post-cascade: surviving events are in class 2 (pseudonymized at V1 per RB-07E-V1-02; potentially anonymized only after W5 \+ W9 closure per RB-07E-R3-02). System-state archives continue in class 2\.

There is no "in transit" state per Doc 05D §10.2 transactional guarantees ("Layers 1 and 2 commit together: there is never a window where derived rows are deleted but event/audit rows still carry the real `student_id`"). 07E's analytics-side body (§7.3) is in the same transaction for Lyceon-side surfaces; PostHog-side is async by PostHog API constraint but **the class transition happens at Supabase commit** (the bridge is gone; PostHog events are pseudonymized at fact by virtue of the broken bridge, regardless of when PostHog-side state actually settles — pseudonymized is a safeguard within personal-data processing per EDPB guidance, not legal anonymization at V1 — see §5.2 \+ RB-07E-V1-02).

---

# **§6 — Doc 06D §9 Retention Policy Registry Entries (FWD-06-01 Resolution)**

Per Doc 07 Parent INV-07-03 \+ Doc 06D §9 standard schema (line 422-435 of `Doc_06D_V10.md`), 07E V1.0 registers two analytics-layer entries against `infra/retention-policy-registry.yaml`. These entries resolve the `out_of_scope: true` placeholder that Doc 06D V1.0 §9.1 line 443 declared as `pending Doc 07 (FWD-06-01)`.

## **6.1 Entry 1 — `RPOL-ANALYTICS-01`**

\- policy\_id: RPOL-ANALYTICS-01  
  pii\_surface\_name: 'analytics.user\_identifying\_data.lifecycle\_class\_1'  
  canonical\_owner\_doc\_and\_section: 'Doc 07E V1.0 §5.1'  
  classification: pii  
  retention\_horizon\_months: 12                                \# Q-07E-V3-2 \= β; hard-locked at V1; Doc 01A §3 config primitive \`USER\_INACTIVITY\_RETENTION\_MONTHS \= 12\`  
  calendar\_month\_semantics: true                              \# RB-07E-V1-05 corrected: retention is calendar-month based, not 365-day-based; computation: now() \- INTERVAL '12 months' against canonical activity timestamp  
  retention\_horizon\_seconds: null                             \# Retired per RB-07E-V1-05; the legacy 31536000 value was 365 days (12×30×24×3600 \= 31,104,000, not 31,536,000) — encoding retention in seconds for calendar-month intent was wrong; retention\_horizon\_months \+ calendar\_month\_semantics is the canonical encoding  
  partial\_provable\_until: null  
  purge\_substrate: doc05d\_cascade  
  purge\_lag\_allowance\_seconds: 604800                         \# 7 days (Doc 05D §10.1 7-day-soft-delete envelope; aligns with Doc 06D §9 substrate convention for cascade-substrate policies)  
  purge\_alert\_id: null                                        \# INV-07-09 negative invariant: no V1 alerts; V1.1+ when inactivity-detection scheduled job activates this may register an alert via Doc 06C §7 standard mechanism  
  out\_of\_scope: false  
  out\_of\_scope\_reason: null  
  last\_reviewed\_at: 2026-05-26

**Notes:**

* `pii_surface_name` is a logical name pointing at the lifecycle class; the actual underlying surfaces are enumerated per Doc 01 V6.0 §19 \+ Doc 05D §10 (canonical owners), not in 07E.  
* `canonical_owner_doc_and_section` points at 07E §5.1 — the canonical owner of the retention horizon \+ trigger declaration for this class. Doc 01 V6.0 §19 \+ Doc 05D §10 own the surface-level substrate behavior; 07E owns the lifecycle policy declaration.  
* **`retention_horizon_months = 12` \+ `calendar_month_semantics: true` (RB-07E-V1-05 correction)** — the legacy seconds-based encoding (`31536000`) was wrong twice: (a) `31536000` is 365 days, not 12 × 30 \= 360 days; (b) encoding calendar-month retention as a fixed-second count produces month-length drift across the year. The canonical encoding uses calendar-month arithmetic: cascade trigger fires when `(now() - canonical_activity_timestamp) >= INTERVAL '12 months'` (PostgreSQL native interval arithmetic respects calendar months and leap years).  
* `purge_substrate: doc05d_cascade` — the substrate is Doc 05D §10's cascade orchestration, which is the canonical mechanism that hard-deletes the user-identifying-data lifecycle when triggered (user-initiated at V1; inactivity-based at V1.1+).  
* `purge_lag_allowance_seconds = 604800` \= 7 days aligns with Doc 05D §10.1's 7-day soft-delete envelope. Doc 06D §9.4 `ops/retention-policy-conformance` will use this value for staleness checks against Doc 05D D20/D21 fixture results (per Doc 06D §9.4 line 469 substrate convention for `doc05d_cascade` policies).  
* `purge_alert_id: null` is permitted at V1 per INV-07-09 negative invariant; V1.1+ activation may register an alert when scheduled-job substrate activates.

**Doc 06D §9 schema-extension (`W-07E-DOC06D-REGISTRY` Stage 1 — APPLIED 2026-05-26 per Doc 06D CR-06D-06 / RB-06D-V1-19):** The Doc 06D §9.1 schema now includes `retention_horizon_months` \+ `calendar_month_semantics` fields (applied via Doc 06D in-lock-cycle additive RB-06D-V1-19). The schema accepts either `retention_horizon_seconds` (existing field; for non-calendar substrates like fixed-TTL caches) OR `retention_horizon_months + calendar_month_semantics: true` (new fields; for calendar-month-aligned retention substrates like doc05d\_cascade). Doc 06D §9.3 `ci/retention-policy-registry-parity` was updated to accept either encoding. (Note: Doc 06D's actual Stage 1 tag is `RB-06D-V1-19` — the `RB-06D-V1-13` tag was already in use in Doc 06D for an unrelated R2 fix; 07E references the correct `RB-06D-V1-19` tag.)

## **6.2 Entry 2 — `RPOL-ANALYTICS-02`**

\- policy\_id: RPOL-ANALYTICS-02  
  pii\_surface\_name: 'analytics.pseudonymized\_indefinite\_retention.lifecycle\_class\_2'  
  canonical\_owner\_doc\_and\_section: 'Doc 07E V1.0 §5.2'  
  classification: pseudonymized\_personal\_data                  \# RB-07E-V1-02 corrected: not 'analytics' (which implies non-personal); pseudonymized data is still personal data with safeguards per EDPB pseudonymization guidance \+ EDPS v SRB CJEU. V1.1+ may upgrade to 'anonymized' if W5 cardinality bucketing closes \+ W9 legal counsel confirms post-EDPB-guidelines.  
  retention\_horizon\_months: null                              \# indefinite retention; permitted because partial\_provable\_until is set per RB-06D-V1-12  
  calendar\_month\_semantics: null                              \# n/a for indefinite-retention class  
  retention\_horizon\_seconds: null  
  partial\_provable\_until: 'FWD-07E-V1.1-CARDINALITY-BUCKETING' \# forward-ref to V1.1+ cardinality-aware bucketing per §15 W5; until W5 closes \+ W9 legal counsel confirms post-EDPB-guidelines anonymization-status, this class is legally pseudonymized (a safeguard), not legally anonymized.  
  purge\_substrate: manual                                     \# operator-initiated deletion only for compliance response (e.g., regulator-ordered deletion); no scheduled purge  
  purge\_lag\_allowance\_seconds: 86400                          \# 24 hours for manual purges (Doc 06D §9.2 line 449 requires manual substrate to have a documented purge\_alert\_id; INV-07-09 V1 negative invariant overrides — V1.1+ adds alert when alert-class activates)  
  purge\_alert\_id: null                                        \# INV-07-09 V1 negative invariant; V1.1+ may register  
  out\_of\_scope: false  
  out\_of\_scope\_reason: null  
  last\_reviewed\_at: 2026-05-26

**Notes (RB-07E-V1-02 \+ RB-07E-V1-06 corrections):**

* `classification: pseudonymized_personal_data` (NOT `analytics`) — the legal classification is pseudonymized-personal-data (per EDPB pseudonymization guidance — pseudonymized data is still personal data with safeguards). The V1.0 DRAFT classified it as `analytics` (implying non-personal) which was the overclaim SWE R1 caught. Doc 06D §9 schema-extension required (`W-07E-DOC06D-REGISTRY` bundled additive) to accept `pseudonymized_personal_data` as a classification value.  
* `partial_provable_until` skip mechanism per Doc 06D §9.4 line 470 RB-06D-V1-12: this policy is reported as `partial_provable_skipped` with the forward-ref token in the proof artifact; numeric staleness checks are excluded. **The partial-provable token explicitly carries the legal-status caveat:** the class is pseudonymized at V1; W5 \+ W9 closure may upgrade to anonymized; until upgrade, prose surrounding this class consistently uses "pseudonymized" terminology (NOT "anonymized") per RB-07E-V1-06.  
* `purge_substrate: manual` reflects that there is no automated purge mechanism for class 2 data at any version; deletion only fires for compliance response (regulator order, mistakenly-emitted PII recovery, etc.) via operator intervention.  
* `partial_provable_until` skip mechanism per Doc 06D §9.4 line 470 RB-06D-V1-12: this policy is reported as `partial_provable_skipped` with the forward-ref token in the proof artifact; numeric staleness checks are excluded.

## **6.3 Doc 06D §9 reconciliation impact**

Adding these two entries resolves the `out_of_scope: true with out_of_scope_reason: 'pending Doc 07 (FWD-06-01)'` placeholder that Doc 06D V1.0 §9.1 line 443 currently shows. **Reconciliation Stage 1 (schema) is APPLIED** via Doc 06D RB-06D-V1-19 (CR-06D-06); Stage 2 (placeholder removal \+ resolved-entry population) is the post-07E-lock additive owned by this lock event.

This is a bundled cross-doc additive `W-07E-DOC06D-REGISTRY` registered in §15 watch items, applied post-07E-LOCK in standard cross-doc cleanup pattern (analogous to W-07-PostHog-BQ pattern that 07A V1.0 carries to Doc 06E).

## **6.4 What 06D §9 inherits from 07E (consumer relationship)**

Doc 06D §9.3 `ci/retention-policy-registry-parity` validates (Stage 1 schema applied per RB-06D-V1-19; runtime validation activates when Stage 2 populates the entries) that:

* `RPOL-ANALYTICS-01` resolves `canonical_owner_doc_and_section` to 'Doc 07E V1.0 §5.1' (citation parity check)  
* `RPOL-ANALYTICS-02` resolves `canonical_owner_doc_and_section` to 'Doc 07E V1.0 §5.2' (citation parity check)  
* Both entries' `purge_alert_id: null` is permitted at V1 (INV-07-09 family-level rule applies)  
* `RPOL-ANALYTICS-02`'s `partial_provable_until` token resolves to the §15 W5 V1.1+ forward-ref

Doc 06D §9.4 `ops/retention-policy-conformance` will (V1.1+ activation):

* For `RPOL-ANALYTICS-01`: validate that Doc 05D D20/D21 cascade fixture tests pass at acceptable cadence (cited per project handoff record at V1; reconciled when D20/D21 results are available)  
* For `RPOL-ANALYTICS-02`: skip numeric staleness check per partial-provable rule; report as `partial_provable_skipped` with the V1.1+ forward-ref token in proof artifact

---

# **§7 — Doc 05D §10 Cascade Layer-4 Body (Analytics Side)**

Per Doc 07 Parent INV-07-04 \+ Doc 05D §10 cascade base orchestration (referenced, never restated per Decision 5), 07E V1.0 declares the Layer-4 analytics-side cascade body. This section extends Doc 05D §10's cascade to cover the analytics surfaces (PostHog at V1; BigQuery at V1.1+) that 05D §10 explicitly scopes out of its body.

## **7.1 Relationship to Doc 05D §10 (referenced, not restated)**

Doc 05D §10 is the canonical cascade orchestration authority. Per Doc 05D §10.1: the cascade fires at 7-day soft-delete expiry (user-initiated path). Per Doc 05D §10.2: Layer 1 hard-deletes 10 derived state tables in FK-safe order; Layer 2 one-way-anonymizes event source \+ audit tables in the same transaction using `gen_random_uuid()` surrogate (note: Doc 05D's internal vocabulary calls this "anonymization"; 07E classifies the result as **pseudonymized** per RB-07E-V1-02 \+ RB-07E-R2-02 — pseudonymized is a personal-data safeguard per EDPB guidance, not legal anonymization at V1; the engineering mechanism is identical). Per Doc 05D §10.3: irreversibility is by construction (no reverse-mapping table). Per Doc 05D §10.4: the BLOCKING\_PRIVACY\_GAP must be resolved by a privacy/compliance-owned document before the pseudonymized-retention path enables in production — **07E V1.0 is that privacy/compliance-owned document, and §8 below declares the proposed compliance posture; formal resolution requires W7 \+ W9 closure post-lock per RB-07E-V1-01**.

07E §7 specifies what happens to **PostHog data \+ BigQuery data \+ future analytics surfaces** in the cascade. Doc 05D §10 does NOT cover these surfaces — Layer 1 \+ Layer 2 are scoped to Supabase-side Lyceon data. 07E §7 is "Layer 4" in Doc 05D §10 parlance (the analytics-layer extension). The naming "Layer 4" is the Parent §1 deliverable \#5 framing; 07E V1.0 adopts it for cross-doc clarity even though Doc 05D §10 itself uses "Layer 1" and "Layer 2" naming.

## **7.2 Cascade scope at 07E Layer 4**

The Layer-4 analytics-side cascade applies to:

1. **PostHog person records keyed to the deleted user's `analytics_user_id`** (Doc 07A V1.0 §7.1 — HMAC-derived from Supabase user\_id)  
2. **PostHog events keyed to the deleted user's `analytics_user_id` as their `distinct_id`** (Doc 07A V1.0 §9.3.1 — server-side `posthog.capture({distinctId: analyticsUserId, ...})`)  
3. **PostHog person properties on the user's profile** (Doc 07A V1.0 §7 — `exam_date`, `exam_date_cohort_id`, `exam_date_source`)  
4. **BigQuery records keyed to `analytics_user_id`** (V1.1+ when warehouse export activates per W-07-PostHog-BQ)  
5. **Future analytics surfaces** keyed to `analytics_user_id` (any V1.1+ analytics integration that consumes the event stream — Tier-2 BI tools, ML model training inputs, etc.)

Out of scope for Layer 4:

* Lyceon-side data (Doc 05D §10 Layer 1 \+ Layer 2 — referenced, not re-bodied)  
* Stripe customer records (Doc 09 — FWD-07E-04 financial records 7-year compliance)  
* LISA tutor conversation logs (Doc 03 Main §14.2 — separate retention matrix)  
* System-state archives (§11 — kept indefinitely by design; never cascaded)

## **7.3 Cascade behavior — 13+ users (default pseudonymized-retention path)**

When Doc 05D §10 cascade fires for a 13+ user (the default case for Lyceon's SAT-prep target demographic of 15-18 students), 07E Layer 4 executes:

**PostHog side:**

* **Do NOT call PostHog `bulk_delete` for 13+ users** — the events remain in PostHog under their original `analytics_user_id` as `distinct_id`. (Per RB-07E-R3-03 canonical V1 path: bulk\_delete is reserved for under-13 cascade per §10.2; 13+ pseudonymization happens by Supabase bridge severance only, not by any PostHog API call.)  
* **Do NOT call `posthog.identify(...)` to update properties** — the person profile properties remain as-is.  
* **The transition to pseudonymized state happens by virtue of Doc 05D §10 Layer 1 hard-deleting the Supabase user\_row.** Once the Supabase user\_id is gone, the `analytics_user_id` HMAC input is unrecoverable. PostHog events become structurally pseudonymized at fact (a personal-data safeguard, not legal anonymization at V1 — see §5.2 \+ RB-07E-V1-02), even though no PostHog API call modified them.  
* The `analytics_user_id` was already opaque (HMAC-derived per Doc 07A V1.0 §7.1 — server-generated, no email/phone/name derivation, no cross-system stable hash); Doc 05D §10 Layer 1 hard-delete completes the bridge severance by destroying the only Lyceon-side record that could reverse the HMAC.

**BigQuery side (V1.1+):**

* When V1.1+ warehouse export activates per W-07-PostHog-BQ, the BigQuery records inherit the same structural pseudonymization: BigQuery rows are keyed to `analytics_user_id` (Doc 07A V1.0 §9 emission contract); the Supabase user\_row is gone; the HMAC is uninvertible; BigQuery rows are pseudonymized at fact.

**Audit trail:**

* The cascade execution event is logged in Doc 05D §10 cascade audit (per Doc 05D §10.5 idempotency mechanism — re-running the cascade for an already-deleted student is a no-op).  
* 07E does NOT add a separate cascade audit log — Doc 05D §10 owns the cascade audit.  
* The proof artifact for cascade execution lives in Doc 05D fixture D21 (Doc 05D's locked fixture name uses the phrase "anonymized-retention mode"; 07E classifies the resulting state as pseudonymized per RB-07E-V1-02) which §10.4 \+ §13 mandate.

**Why this works for GDPR per EDPS v SRB CJEU Sept 4 2025:** The CJEU held (Case C-413/23 P para 86\) that "Pseudonymisation may, depending on the circumstances of the case, effectively prevent persons other than the controller from identifying the data subject, in such a way that, for them, the data subject is not or is no longer identifiable." For the post-cascade state: the controller (Lyceon) has destroyed the additional information (the Supabase user\_id row) needed to reidentify; the HMAC salt continues to exist in Lyceon's environment but the input is gone; therefore the retained event data is — at fact — un-reidentifiable even by Lyceon. The CJEU's contextual "means reasonably likely to be used" test is satisfied because no means reasonably exist to reverse the HMAC without the Supabase user\_id, which has been hard-deleted.

**Residual high-cardinality risk:** if specific event payloads contain high-cardinality property combinations (e.g., cohort \+ score \+ exam\_date) that identify individuals through joinability against retained-active-user data, the legal anonymization bar may not be fully satisfied. §15 W5 watch item flags this as V1.1+ work pending legal counsel review of cardinality bucketing depth.

## **7.4 Cascade behavior — Stripe customer records (Doc 09 boundary — referenced, not bodied)**

Stripe customer records (payment history, subscription state, billing artifacts) are governed by Doc 09 (Finance) — financial records retention is typically 7-year-financial-compliance, longer than 12-month-inactivity PII. **07E Layer 4 does NOT extend to Stripe-side records.** When a 13+ user's Doc 05D §10 cascade fires, the Stripe-side data is NOT touched — Doc 09 governs that lifecycle independently (FWD-07E-04 forward-ref).

This means that for a deleted 13+ user, there is a window where Stripe-side records persist while Lyceon-side records are gone. This is the documented and intentional design: Stripe customer records are not joined back to Lyceon user identity post-cascade (because the Lyceon user row is hard-deleted), so the Stripe data is itself orphaned and serves only Stripe-side financial-records compliance.

If V1.1+ Doc 09 adds a cascade extension that also deletes Stripe customer records on Lyceon user deletion, that would be a Doc 09 V1.1+ addition, not a 07E change.

## **7.5 Cascade trigger — 7-day soft-delete envelope (Doc 01 \+ Doc 05D — referenced)**

Doc 01 V6.0 §19 \+ Doc 05D §10.1 specify the user-deletion request lifecycle:

1. User clicks "delete my account" → Doc 01 V6.0 §19 marks the account as soft-deleted; subscription is immediately canceled per project memory  
2. 7-day soft-delete window: user can recover the account (recovery path is Doc 01 territory)  
3. At 7-day expiry: Doc 05D §10 cascade fires

**07E does NOT re-litigate this envelope.** 07E Layer 4 fires at the same trigger point as Doc 05D §10 — the 7-day soft-delete expiry. There is no separate 07E trigger for user-initiated deletion.

For V1.1+ inactivity-based trigger per §9, the trigger point is different (no 7-day envelope; instead a 48-hour pre-deletion notification per §9.2) and the cascade fires through the same Doc 05D §10 entry point at the notification window expiry.

## **7.6 Privacy-incident sub-class wiring (Doc 06D §11 consumer)**

If the cascade execution encounters a failure that potentially exposes PII (PostHog API failure leaving partial state; cascade transaction abort with Supabase committed but PostHog API not called; unauthorized access to retained pseudonymized data revealing it was actually re-identifiable), 07E surfaces this as a privacy-class incident via Doc 06D §11.3 `attach_privacy_class_to_incident` RPC.

Trigger conditions for analytics-surface privacy incidents:

| Trigger | `pii_exposure_scope` | `affected_compliance_gates` |
| ----- | ----- | ----- |
| PostHog API failure during cascade leaving Supabase committed but PostHog uncontacted (under-13 case only — 13+ cascade has no PostHog API call) | `identifier_only` (the `analytics_user_id` would be the exposed identifier; no content exposure) | `[CGATE-COPPA-RETENTION, CGATE-DPDP-DELETION]` |
| Cardinality-aware re-identification confirmed against retained pseudonymized data (legal counsel finding) | `identifier_plus_content` (the event content is exposed once re-identification is achieved) | `[CGATE-GDPR-ANONYMIZATION, CGATE-EDPS-V-SRB-PRECEDENT]` |
| Unauthorized access to retained pseudonymized PostHog or BigQuery data | `identifier_plus_content` (analytics\_user\_id \+ event properties) | `[CGATE-GDPR-CONFIDENTIALITY, CGATE-CCPA-SECURITY]` |
| Discovery that 07A redaction failed historically (events emitted with PII despite the registry contract — caught by V1.1+ `ci/historical-pii-conformance`) | `identifier_plus_content` (depends on the leaked PII type) | `[CGATE-GDPR-DATA-MINIMIZATION, CGATE-COPPA-PII]` |

Each trigger fires Doc 06D §11.3's `attach_privacy_class_to_incident` RPC against an existing Doc 06C §10 incident; 07E does NOT introduce a separate analytics-incident lifecycle (Decision 5 — Doc 06D §11 owns the privacy-class attachment; 07E is a consumer).

The compliance-gate registry references (CGATE-\* IDs above) are 06D §10 compliance-evidence-process territory; 07E flags them as required-to-exist watch items for Doc 06D §10 registry population (`W-07E-DOC06D-CGATES` in §15).

## **7.7 Cascade idempotency (extending Doc 05D §10.5)**

Doc 05D §10.5 specifies cascade idempotency for Lyceon-side surfaces (re-running for an already-deleted student is a no-op). 07E Layer 4 is also idempotent:

* For 13+ users: no PostHog API call is made, so there is nothing to retry on cascade re-execution. The cascade's effect on PostHog is implicit (bridge severance at Supabase); no PostHog state change to re-attempt.  
* For under-13 users (per §10): PostHog `bulk_delete` by `distinct_ids` with `delete_events: true` \+ `delete_recordings: true` is called (canonical V1 path per RB-07E-R2-03 \+ RB-07E-R3-03); PostHog's async deletion-status endpoint is documented in Doc 07A V1.0 §10.5 context (referenced from PostHog docs). Re-running the cascade for an under-13 user already deleted: **Lyceon-side idempotency** comes from the Doc 05D §10 cascade audit record — the cascade-execution audit log records that the PostHog bulk\_delete request was already issued for this `analytics_user_id`; re-execution checks the audit record \+ (V1.1+ per §9.4) PostHog's deletion-status endpoint to determine `complete | pending | not_found`. **The implementation MUST NOT rely on undocumented PostHog idempotency** (per RB-07E-R3-03): PostHog's published behavior on duplicate bulk\_delete requests for an already-deleted `distinct_id` is not contractually specified, so Lyceon's own deletion-request audit record is the source of truth for "this request was already issued; do not re-issue."

Failure recovery: if the cascade fails partway (Supabase transaction commits but PostHog API call fails for under-13), the cascade is re-tried per Doc 05D §10.5 retry pattern. Re-execution is safe because Lyceon's cascade audit log records the deletion-request lineage \+ (V1.1+) the deletion-status check resolves vendor-side state; re-attempts that succeed where the previous attempt failed correctly transition the audit-log entry from `attempt_pending` to `request_issued`. The implementation does NOT depend on vendor-side idempotency guarantees.

---

# **§8 — Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP — Proposed Compliance Posture (Conditional Resolution Pending W7 \+ W9)**

This section declares the **proposed compliance architecture** that Doc 05D §10.4 names as the gating requirement. **07E V1.0 lock does NOT, by itself, constitute the formal resolution** — the resolution depends on two external sign-offs (W7 Doc 10 privacy policy publication \+ W9 legal counsel review per RB-07E-V1-01).

**Status (launch product state at 07E V1.0 lock):** COMPLIANCE POSTURE PROPOSED — pending W7 \+ W9 closure. **Status (target state after W7 \+ W9 closure):** Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP formally RESOLVED.

## **8.1 The gate as stated in Doc 05D §10.4 (verbatim, referenced not restated)**

Doc 05D §10.4 line 901: "The Layer-2 anonymized-retention path MUST NOT be enabled in production until privacy/compliance has explicitly confirmed, **in a privacy/compliance-owned document**, that one-way-anonymized retention of this tuple from minor users is permissible for the intended modeling use. Until that confirmation, the implementation MUST treat Layer 2 as **hard-delete the event/audit rows too** (the privacy-conservative fallback), not retain-anonymized."

Doc 05D §10.4 also flags the gate as `BLOCKING_PRIVACY_GAP` recorded in §11 and §14, with the fallback (hard-delete everything) always safe to ship.

## **8.2 07E V1.0 is the privacy/compliance-owned spec; counsel signoff \+ privacy policy publication are required for actual resolution**

Per the canonical document map in project memory \+ Doc 07 Parent V1.0 §1, Doc 07E is the analytics-side retention, privacy, and cascade body. 07E is owned by "Founder / CTO review \+ Privacy/Compliance gate-keeper for §10.4 posture" (per the header). **07E V1.0 lock proposes the compliance posture; the formal resolution Doc 05D §10.4 names requires both (a) legal counsel sign-off on §8.2 reasoning per W9 \+ (b) Doc 10 privacy policy publication per W7.** Until both close, Doc 05D's **anonymized-retention path** (Doc 05D's internal vocabulary; 07E classifies the resulting state as "pseudonymized" per RB-07E-V1-02 \+ RB-07E-R3-02 — the engineering mechanism is identical, only the legal label differs) MUST NOT enable in production — Doc 05D's fallback hard-delete mode is the active mode. This honors Doc 05D §10.4's own framing ("Until that confirmation, the implementation MUST treat Layer 2 as hard-delete the event/audit rows too").

**The proposed posture (conditional, pending sign-off):**

**For 13+ users:** Doc 07E V1.0 PROPOSES that one-way **pseudonymized** retention of the modeling tuple per Doc 05D §10.2 step 11 is permissible for Lyceon's intended modeling use (ML training corpus, historical system-state reconstruction, product improvement, analytics) — pending legal counsel confirmation that this proposal aligns with the post-EDPS-v-SRB regulatory environment. The legal basis CLAIMED is the EDPS v SRB CJEU judgment (4 September 2025, Case C-413/23 P) which establishes that pseudonymized data may fall outside GDPR scope when reidentification is not reasonably likely. **CRITICAL CAVEAT:** the CJEU judgment does NOT say pseudonymized data is automatically anonymous; it says identifiability must be assessed contextually \+ the controller-side perspective matters at collection. The EDPB's own pseudonymization guidance treats pseudonymization as a safeguard within personal-data processing, not as automatic anonymization (see §3 threat 1 \+ W8 EDPB post-SRB anonymization guidelines). Therefore: at V1, the retained tuple is treated as **pseudonymized**, not legally anonymized; W5 cardinality bucketing review is required to potentially upgrade to legally-anonymized status; class 2 retention is named `pseudonymized_indefinite_retention_pending_anonymization_review` per the §5 retention class taxonomy.

**For under-13 users:** Doc 07E V1.0 PROPOSES that pseudonymized retention (what Doc 05D's internal vocabulary calls "one-way-anonymized retention" — same engineering mechanism, 07E vocabulary per RB-07E-V1-02) of the modeling tuple is **NOT permissible** for under-13 users (the COPPA-strict bar per Edmodo/Kurbo FTC enforcement precedent: algorithmic disgorgement risk \+ FTC Commissioner Bedoya's direct statement that "indefinite retention to improve algorithms does not override legal bans on indefinite retention" \+ amended COPPA Rule 16 CFR 312.10's explicit prohibition: "Personal information collected online from a child may not be retained indefinitely"). For under-13 users, 07E V1.0 PROPOSES the **hard-delete-everywhere** variant per §10 — the §10.4 fallback mode extended to all analytics surfaces (Lyceon-side \+ PostHog \+ BigQuery \+ everything) AND an executable ML-training-exclusion invariant per §10.6 \+ §12.5.

**For both age cohorts:** the 12-month inactivity threshold per §5.1 \+ §9 V1.1+ mechanism PROPOSES that user-identifying data has a defined lifecycle (satisfying amended COPPA Rule "no indefinite retention" per 16 CFR 312.10 \+ Kurbo settlement 12-month-post-last-use precedent \+ GDPR Article 5(1)(e) storage limitation).

**The proposal becomes the formal resolution ONLY upon both W7 \+ W9 closure.** If either is rejected, 07E V1.1+ amends the proposed posture. This is the load-bearing change from the V1.0 DRAFT: the spec defines the architecture; counsel \+ published privacy policy convert proposal to resolution.

## **8.3 Privacy policy disclosure obligation (Doc 10 dependency)**

The resolution per §8.2 is conditional on the privacy policy disclosing the retention model. 07E V1.0 declares the disclosure obligation; Doc 10 (Brand / Reputation, not yet drafted) or legal counsel authors the policy text.

**Required disclosure elements (07E specifies the obligation shape; Doc 10 owns the text):**

1. **Personal information retention:** "We retain your personal information until you delete your account OR until 12 months have elapsed since your last use of the platform, whichever comes first. Upon either trigger, your personal information is permanently deleted."

2. **Pseudonymized retention (RB-07E-V1-02 corrected language):** "We retain pseudonymized records of your platform interactions indefinitely for the purposes of product improvement, AI model training, and historical analysis. These retained records have had the identifying bridge (your Supabase account record) permanently deleted, making it structurally infeasible for us or any third party to link the records back to your identity. The legal basis is GDPR Article 6(1)(f) legitimate interests \+ post-EDPS v SRB CJEU pseudonymization framework. **Note:** because pseudonymization is a safeguard within personal-data processing rather than full legal anonymization, we continue to treat these records with personal-data-grade protections; cardinality-aware bucketing is V1.1+ work pending legal counsel review of post-EDPB anonymization guidelines, after which the legal status of these records may be upgraded to anonymized."

3. **48-hour pre-deletion notification:** "If your account becomes inactive for 12 months, you will receive notification 48 hours before deletion. You may reactivate your account by signing in during that window."

4. **Under-13 strict deletion:** "If you are under 13, we will not retain any records of your platform interactions after account deletion or inactivity expiry — all data including pseudonymized records is permanently deleted in compliance with the Children's Online Privacy Protection Act. Additionally, no under-13 user data will be used for AI model training, even if anonymized."

5. **System-state archives:** "We retain historical system-state archives indefinitely — including prompt templates, formula constants, and tool configuration — to enable product improvement, AI model training, and historical reconstruction. These archives contain no personal information about individual users."

6. **User rights:** "You may request deletion of your account at any time. You may request information about what data we retain about you. You may withdraw consent for AI training use of your data (V1.1+ jurisdictional opt-out mechanism)."

7. **Jurisdictional addenda (V1.1+):** "Residents of EU/UK have additional rights under GDPR. Residents of California have additional rights under CCPA. Residents of India have additional rights under DPDP. Residents of Brazil have additional rights under LGPD and ECA Digital." — V1.1+ on international launch per §15 W4.

The disclosure text MUST be drafted \+ reviewed by legal counsel \+ published before V1 launch. **This is a V1 launch gate** registered as §15 W7.

## **8.4 What 07E V1.0 lock changes in production**

Pre-07E-V1.0-lock state (the current state as of 07E DRAFT):

* Doc 05D §10 cascade ships with `BLOCKING_PRIVACY_GAP` recorded in §11.  
* Doc 05D's anonymized-retention path (Doc 05D's internal vocabulary; same engineering mechanism as 07E's pseudonymized-retention naming per RB-07E-V1-02) is DISABLED in production.  
* Doc 05D D20 (privacy-conservative fallback hard-delete) is the active mode; D21 (Doc 05D's locked fixture name; in Doc 05D's vocabulary this is "anonymized-retention" mode — same engineering mechanism as 07E's pseudonymized-retention naming per RB-07E-V1-02) is fixture-tested but not deployable.

Post-07E-V1.0-lock state (07E V1.0 lock alone):

* Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP remains **gated** (the gate is NOT resolved by 07E V1.0 lock alone — see §8.2 \+ RB-07E-V1-01); however the proposed compliance architecture is locked \+ ready for legal counsel review.  
* Doc 05D's fallback hard-delete mode remains the active mode in production until W7 \+ W9 closure.  
* 07E §7 PostHog-side body is **spec-locked** but its execution against the pseudonymized-retention path waits on W7 \+ W9 (under-13 hard-delete-everywhere per §10 is V1-active because the COPPA-strict bar applies independently — see §8.2 framing).

Post-W7-and-W9-closure state (target state — the actual formal resolution):

* Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP is RESOLVED for 13+ users (pseudonymized-retention path permitted, per legal counsel sign-off \+ published privacy policy).  
* Doc 05D D21 (anonymized-retention mode — note: per RB-07E-V1-02, this is named "anonymized" in 05D's vocabulary but 07E classifies the post-cascade state as **pseudonymized** until W5 closes; the engineering mechanism is identical, only the legal label differs) is deployable for 13+ user deletions.  
* Doc 05D's mastery-event canonical tables \+ audit tables under the pseudonymized-retention path retain post-cascade rows with `student_id` replaced by `gen_random_uuid()` surrogate per Doc 05D §10.2 step 11/12, providing the Lyceon-side data for the ML training corpus.  
* 07E §7 PostHog-side body activates against the V1 mode (for 13+: leave events in place under orphaned `analytics_user_id` per the §7.3 pseudonymized-retention pattern).  
* Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP is RESOLVED for under-13 users via the §10 fallback-hard-delete-everywhere carve-out (note: under-13 PostHog deletion is a separate launch-required mechanism per §10.2 — see RB-07E-V1-03 verified PostHog API contract).

The change is implementation-deployment-coordinated AND external-sign-off-coordinated. Doc 05D V1.0 has the deploy gate; **two external sign-offs (W7 \+ W9)** remove it.

## **8.5 Audit trail of the proposed posture \+ future resolution**

07E V1.0 lock is the **proposed-posture-declaration event** (per RB-07E-V1-01 reframe — NOT the resolution event itself; the resolution event is W7 \+ W9 closure post-lock). Subsequent changes to the proposed posture (e.g., legal counsel rejecting the EDPS v SRB-based reasoning during W9 review; EDPB issuing post-SRB guidelines that supersede; jurisdiction-specific overrides per §15 W4) trigger a 07E version bump or in-lock-cycle amendment. The proposed posture is not unilaterally revocable post-lock — any change requires 07E in-lock-cycle additive or version increment. When W7 \+ W9 close, the resolution itself is auditable via the privacy policy publication record \+ legal counsel sign-off artifact (those external artifacts are the resolution record; 07E references them but does not store them).

The §15 watch items include:

* **W8:** EDPB post-SRB anonymization guidelines (pending as of 2026-05-26; cited per §3 threat 1\) — when published, 07E reviews for impact on §8.2 resolution  
* **W9:** Legal counsel review confirmation of §8.2 reasoning \+ §8.3 disclosure text — required before launch

---

# **§9 — V1.1+ Inactivity-Detection Mechanism (Shape Only at V1; Body V1.1+)**

Per Q-07E-V3 locks (12 months across the board; Supabase-canonical user-activity timestamp as primary signal; V1.1+ activation), 07E V1.0 declares the inactivity-detection mechanism shape. The mechanism body activates V1.1+ when scheduled-job infrastructure activates per Doc 06E precedent \+ project memory pattern.

## **9.1 Activity signal — Supabase canonical user-activity timestamp**

Per Q-07E-V3-3=γ revised to Supabase-only (Karl Final-5 lock): the activity signal is **Supabase-side only**, not PostHog. PostHog `$last_seen_at` is analytics-side data that becomes pseudonymized after cascade (per RB-07E-V1-02 — a personal-data safeguard, not legal anonymization at V1) — using it as a retention trigger inverts the dependency direction (the retention mechanism would depend on data that the retention mechanism deletes).

**Canonical field declaration:** 07E references "the field declared canonical by Doc 01 for user-activity tracking" — V1 of 07E ships with the field documented-but-undeclared (FWD-07E-06 forward-ref to Doc 01 V8.1+). The candidate fields per Supabase platform conventions are `auth.users.last_sign_in_at` (Supabase Auth built-in; updated on token refresh per Supabase auth defaults) or a Lyceon-declared DB-side `profiles.last_active_at` (custom column updated by application code on authenticated session activity).

**07E does NOT pick the field name.** Per Decision 5 \+ the Karl Final-3 lock \+ FWD-07E-06: Doc 01 V8.1+ declares the canonical field; 07E references the declaration. The V1.1+ inactivity-detection scheduled job per §9.3 reads from that declared field.

**Bundled cross-doc additive owed by 07E:** `W-07E-DOC01-ACTIVITY-FIELD` — registered in §15 watch items, applied when Doc 01 V8.1+ ships the declaration. Until then, 07E V1.0 declares the *mechanism shape* (12-month threshold against a canonical field) without binding to a specific column name.

## **9.2 48-hour pre-deletion notification (DPDP-aligned)**

When the V1.1+ inactivity-detection scheduled job identifies a user whose canonical-activity-timestamp shows ≥12 months elapsed, the user receives a 48-hour pre-deletion notification before the cascade fires. This aligns with India DPDP's 48-hour-before-erasure obligation (per project memory \+ research per §3 threat 7\) and provides a recovery window for false-positive inactivity detection.

**Notification mechanism — V1.1+ build (declared shape only at V1):**

* **Delivery channel:** email to the registered account email (the primary contact channel per Doc 01 V6.0 identity model). V1.1+ may extend to in-app notification \+ SMS for jurisdictions where additional channels are required (e.g., Brazil ECA Digital may have notification-channel requirements; per §15 W4).  
* **Template requirements:** notification template MUST disclose: (a) the account will be deleted at a specific timestamp (48 hours from notification send time), (b) the user can prevent deletion by signing in to the platform during the window, (c) the user can request immediate deletion to skip the window, (d) what data will be deleted vs pseudonymized-and-retained (matching the privacy policy disclosure per §8.3 using pseudonymized vocabulary per RB-07E-V1-02 \+ RB-07E-R5-02).  
* **Idempotency:** the notification is sent exactly once per inactivity-detection cycle for a given user. Re-detection on a subsequent inactivity-detection-job run does not re-send if a prior notification exists within the 48-hour window. Notification idempotency tracking is Doc 06C §8 scheduled-job-substrate territory.  
* **Notification log:** the notification send \+ delivery confirmation (when delivery infrastructure provides one) is recorded in an audit log. The log shape is V1.1+ build territory; 07E specifies the log existence \+ minimum fields (`user_id`, `notification_sent_at`, `notification_window_expires_at`, `cancellation_signin_observed_at_if_any`).  
* **Window cancellation:** if the user signs in during the 48-hour window, the inactivity timer resets per §9.3 — the next inactivity-detection cycle on that user starts fresh from the new activity timestamp.

**V1 stance:** 07E V1.0 ships the mechanism shape; V1.1+ activation builds the notification template \+ delivery mechanism \+ log substrate. **At V1, no notification fires because no inactivity-detection scheduled job exists** — the only cascade trigger at V1 is user-initiated deletion (Doc 05D §10 cascade entry point), which has its own 7-day soft-delete envelope per §7.5, not a 48-hour notification.

## **9.3 V1.1+ inactivity-detection scheduled job (`JOB-INACTIVITY-DETECTION`)**

Per Doc 06C §8 scheduled-job-substrate convention, the V1.1+ inactivity-detection scheduled job is registered when scheduled-job infrastructure activates.

**Declared shape (V1; built V1.1+):**

| Element | Value |
| ----- | ----- |
| Job ID | `JOB-INACTIVITY-DETECTION` (V1.1+ registration in Doc 06C §8.2 `infra/scheduled-job-registry.yaml`) |
| Execution location | Vercel Cron per Doc 06C §8.2 substrate convention (V1.1+; matches `JOB-DATA-RETENTION` pattern from Doc 06D §9.4) |
| Trigger cadence | Daily at low-traffic window (specific time TBD V1.1+ build) |
| Input | Doc 01 V8.1+ canonical user-activity-timestamp field; `USER_INACTIVITY_RETENTION_MONTHS` config primitive (Doc 01A §3 — locked at 12 at V1) |
| Behavior per user | (1) Compute `inactive_for_months = now() - canonical_activity_timestamp` (months); (2) IF `inactive_for_months >= 12` AND no prior pending notification in last 48 hours: send 48-hour pre-deletion notification per §9.2 and record in audit log; (3) IF `inactive_for_months >= 12` AND prior pending notification \> 48 hours ago AND no subsequent activity observed: trigger Doc 05D §10 cascade for this user |
| Heartbeat substrate | Doc 06C §8.3 `scheduled_job_heartbeats` table per substrate convention |
| Failure mode at V1.1+ | per `ops/inactivity-cascade-conformance` §12.4 |
| Activation trigger (V1.1+ per Q-07A-7=δ hybrid) | (a) sustained user-base age \> 12 months \[time — first user signups must be 12+ months old before any user can become inactive-expired\] OR (b) \>100 users expected to expire in the next 90 days \[volume\] OR (c) compliance audit demand for active inactivity-purge \[demand\] — first-to-trigger wins |
| Launch-required at V1 | false (V1.1+ activation) |

**Rationale for V1.1+ deferral:** at Lyceon V1 launch (May 2026 working date per project memory), no user can have 12 months of inactivity because the platform is new. The earliest possible inactivity expiration is ≥12 months post-launch. This gives a real V1.1+ window to build the scheduled-job infrastructure. The mechanism shape is locked at V1; the build deadline is "before any user actually expires" (volume trigger naturally aligns with time trigger).

## **9.4 V1.1+ PostHog deletion-status verification (under-13 only)**

For the under-13 case per §10, when PostHog `bulk_delete` by `distinct_ids` with `delete_events: true` \+ `delete_recordings: true` is called (canonical V1 path per RB-07E-R2-03), PostHog's deletion is async per their documented contract (referenced in Doc 07A V1.0 §10.5 PostHog provenance fields). At V1, the deletion is fire-and-forget (the under-13 case is rare for Lyceon's SAT-prep demographic and the V1 operational risk is bounded); the Lyceon-side cascade audit record is the source of truth for "deletion was requested" per RB-07E-R3-03 audit-record-idempotency framing.

**V1.1+ deletion-status verification mechanism:**

A V1.1+ scheduled job (`JOB-POSTHOG-DELETION-VERIFICATION`) periodically queries PostHog's deletion-status endpoint to confirm async deletion completion for under-13 users. If a deletion request is older than PostHog's documented SLA ("processed asynchronously during non-peak hours" — typically hours to days, not weeks) and still shows incomplete, the system surfaces a privacy-class incident via Doc 06D §11.3 (per §7.6 trigger conditions).

**Declared shape (V1; built V1.1+):**

| Element | Value |
| ----- | ----- |
| Job ID | `JOB-POSTHOG-DELETION-VERIFICATION` (V1.1+) |
| Execution location | Vercel Cron per Doc 06C §8.2 |
| Trigger cadence | Daily |
| Input | Under-13 deletion request audit log (Doc 05D §10 cascade audit \+ 07E under-13 deletion record per §10.4); PostHog deletion-status endpoint |
| Behavior | For each under-13 deletion request older than 72 hours (3× the typical PostHog async SLA window): query PostHog deletion-status; if status \!= 'completed', record audit entry; if status still incomplete after 7 days, surface privacy-class incident per §7.6 |
| Activation trigger | (a) any under-13 deletion request occurs \[demand\] OR (b) V1.1+ when scheduled-job infrastructure activates \[time\], whichever first |
| Launch-required at V1 | false (V1.1+ activation) |

**V1 stance:** at V1, under-13 deletion is fire-and-forget per the PostHog API constraint. The lack of verification is the documented V1 trade-off; the operational risk is bounded by (a) the under-13 cohort being small/rare in Lyceon's target demographic, (b) the 07A V1.0 signup-gate at age verification preventing most under-13 accounts from being created, (c) any post-detection identifies the under-13 case quickly enough that the data window is short.

---

# **§10 — Under-13 Hard-Delete-Everywhere Variant**

Per Q-07E-V3-1=γ \+ Karl's lock ("hard delete all under 13 student info, analytics and data across supabase, posthog, bigquery and everywhere else"), 07E V1.0 declares an age-stratified cascade variant that overrides the default pseudonymized-retention path for under-13 users.

## **10.1 Under-13 detection signal (Doc 01 family — referenced, not owned by 07E)**

The under-13 detection signal is owned by Doc 01 family (guardian trust model \+ age verification at signup). 07E does NOT own age verification mechanisms. 07E receives the under-13 signal at three possible trigger points:

1. **At signup:** if Doc 01's age-verification flow detects an under-13 user (per amended COPPA Rule 2026 age-verification provisions — the FTC encourages technology-based age verification), the user account is marked `under_13_detected = true` on the Supabase profile row.

2. **Post-signup parental-consent flow:** if a user enters parental-consent flow and the parent provides age information indicating the student is under 13, the account is marked.

3. **Any later detection:** if at any point during the user's interaction with the platform, evidence emerges that the user is under 13 (e.g., birth date in self-reported profile update; school grade information indicating elementary school; etc.), the account is flagged for under-13 review by Doc 01 family \+ admin tools; on confirmation, marked.

**07E does NOT body any of these detection mechanisms.** 07E specifies what happens *after* the under\_13\_detected signal fires.

## **10.2 Under-13 cascade — immediate hard-delete-everywhere**

When `under_13_detected = true` is set on a Supabase profile, the under-13 hard-delete-everywhere cascade fires immediately (no 7-day soft-delete envelope; no 48-hour notification; no inactivity timer). Per Karl Final-2 lock: "user initiated is immediate" — but the user-initiated path uses Doc 05D §10.1's 7-day soft-delete envelope for account-recovery reasons. The **under-13 detection-initiated cascade is even more immediate** because the legal posture (COPPA strict \+ algorithmic disgorgement risk) requires no delay window.

**Cascade sequence — under-13:**

1. **Lyceon-side hard-delete (Doc 05D §10 cascade, fallback mode per §10.4):** Doc 05D §10.4 specifies the fallback mode behavior: "Layer-2 instead hard-DELETEs the audit rows for the deleted student." Under-13 cascade activates this fallback mode (NOT the default pseudonymized-retention mode), so Layer 2 hard-deletes the event/audit rows instead of pseudonymizing them. **No user-event, analytics, mastery, tutor, or training data from under-13 users is retained after the hard-delete cascade.** Minimal non-PII deletion-proof metadata may be retained solely to prove deletion occurred (e.g., cascade execution audit-log entry per Doc 05D §10 cascade audit; under\_13\_detected flag history in the §12.5 ML-training-exclusion ancestry registry per RB-07E-V1-04). All such retained metadata is **subject to Doc 06D §8.7 no-PII proof-artifact rules** — only counts, decisions, hashes, and non-identifying timestamps; never raw `analytics_user_id`, never event payload data, never user identifiers of any form. The deletion-proof metadata exists to *prove the deletion happened*, not to retain any aspect of the under-13 user's data. Per RB-07E-R2-06 — earlier "no retained data of any kind" framing was correctly flagged as too broad; the corrected framing distinguishes user-data (forbidden) from deletion-proof metadata (permitted under §8.7 rules).

**PostHog-side hard-delete — verified PostHog API contract (RB-07E-V1-03 \+ RB-07E-R2-03 corrections):**

 **Canonical V1 path — bulk\_delete by `distinct_ids` (NO UUID lookup required):**

 Per RB-07E-R2-03: bulk\_delete is the canonical V1 under-13 deletion path because it avoids the UUID-lookup ambiguity that the single-person DELETE path requires. Child-data deletion MUST NOT depend on a 2-step path we have not proven end-to-end.

 POST https://us.posthog.com/api/projects/\<project\_id\>/persons/bulk\_delete  
Authorization: Bearer \<PERSON\_WRITE\_PERSONAL\_API\_KEY\>  
Body: {  
  "distinct\_ids": \["\<analytics\_user\_id\>"\],  
  "delete\_events": true,  
  "delete\_recordings": true  
}

2.   
   * **Required scope:** `person:write` (verified per PostHog Persons API docs).  
   * **Body parameters (verified per PostHog Persons-4 API docs accessed 2026-05-26):**  
     * `distinct_ids` — list of distinct IDs (max 1000 per call); accepts the `analytics_user_id` directly with no UUID-resolution step.  
     * `delete_events` — boolean; defaults to `false`; setting `true` queues an async event-deletion task. **Critical for under-13: must be set to `true` to satisfy COPPA hard-delete requirement.**  
     * `delete_recordings` — boolean; defaults to `false`; setting `true` queues session-recording deletion. Lyceon does not currently use PostHog session recordings (Doc 07A V1.0 §6 event taxonomy excludes session recordings) but the parameter is set defensively to `true` so any future PostHog config that enables recordings doesn't leave under-13 recordings behind.  
   * **Expected response:** HTTP 202 (or 200 per current API docs); response body contains `persons_found`, `persons_deleted`, `events_queued_for_deletion: true`, `recordings_queued_for_deletion: true`, `deletion_errors: []` (per RB-07E-V1-03 verified `Bulk delete response` schema from `https://posthog.com/docs/privacy/data-storage`).  
   * **Caveat (verified):** "Only events captured before the request will be deleted" — per PostHog Persons-4 API docs. This means any events emitted post-deletion-request for the same `distinct_id` would survive — which is why PostHog explicitly warns "Avoid reusing deleted distinct IDs." Lyceon must NOT reuse a deleted `analytics_user_id` for a new user, and structurally cannot: `analytics_user_id` is HMAC-derived from a deleted Supabase user\_id, so a new user gets a new Supabase user\_id and therefore a new `analytics_user_id`.

**Optional alternative path (pending integration proof — V1.1+ optional):**

 Single-person DELETE by UUID is documented in PostHog's API but requires a 2-step path: (a) GET to resolve `person_uuid` from `distinct_id`, (b) DELETE the resolved UUID. This path is **explicitly NOT the canonical V1 under-13 path** because the 2-step pattern adds a failure-mode surface (UUID resolution can fail or return ambiguous results) that bulk\_delete by distinct\_id avoids. The single-person path is reserved for V1.1+ optional use after integration proof, if ever needed for admin tooling that operates on resolved person UUIDs.

 For reference (NOT V1 canonical):

 GET https://us.posthog.com/api/projects/\<project\_id\>/persons?distinct\_id=\<analytics\_user\_id\>  
DELETE https://us.posthog.com/api/projects/\<project\_id\>/persons/\<person\_uuid\>?delete\_events=true  
 **Async-deletion verification (V1.1+ per §9.4):**

 GET https://us.posthog.com/api/projects/\<project\_id\>/persons/deletion\_status?status=pending  
Authorization: Bearer \<PERSON\_WRITE\_PERSONAL\_API\_KEY\>

3.  Returns per-person `{person_uuid, created_at, status, delete_verified_at}`. Status is `pending` or `completed`. Per PostHog docs: "Event deletions run asynchronously during non-peak hours (weekends on PostHog Cloud)" — verification window is up to one week post-request.

    **Vendor-contract source of truth:** `https://posthog.com/docs/privacy/data-storage` (canonical privacy guide) \+ `https://posthog.com/docs/api/persons-4` (bulk\_delete endpoint reference, verified 2026-05-26). 07E V1.0 references the live docs URLs; the contract is owned by PostHog, not Lyceon — if PostHog changes the API, 07E in-lock-cycle additive reconciles.

4. **BigQuery-side hard-delete (V1.1+):** when BigQuery warehouse export activates per W-07-PostHog-BQ, the under-13 cascade additionally deletes BigQuery rows keyed to `analytics_user_id`. V1.1+ build territory; declared at V1.

5. **Any other analytics surfaces (V1.1+):** any V1.1+ analytics integration that consumes the event stream gets the same hard-delete treatment for under-13 cascade. V1.1+ build territory.

6. **ML training corpus exclusion (RB-07E-V1-04 — runtime invariant \+ proving mechanism):** per §10.6 \+ §12.5 — even if any under-13-derived rows survived the cascade (e.g., backups, downstream copies), the executable invariant `ML_TRAINING_INPUTS MUST exclude any row whose source user was ever marked under_13_detected = true` blocks them from entering ML training manifests. Proving mechanism: `ci/ml-training-under13-exclusion` per §12.5.

**Audit trail:** the under-13 cascade execution is logged in Doc 05D §10 cascade audit (per Doc 05D §10.5 idempotency mechanism). Additionally, 07E adds an **under-13 cascade audit record** (V1.1+ table — at V1, the Doc 05D cascade audit suffices; if V1.1+ analytics expansion adds more surfaces, a separate under-13 audit may be needed for deletion-verification of all surfaces).

## **10.3 Under-13 cascade — relationship to Doc 05D §10.4 fallback mode**

Doc 05D §10.4 specifies two modes for the Layer-2 one-way transformation (Doc 05D's internal vocabulary calls this "Layer-2 anonymization"; 07E classifies the resulting V1 state as pseudonymized per RB-07E-V1-02 \+ RB-07E-R5-04 — engineering mechanism identical):

* **Pseudonymized-retention mode (default for 13+; what Doc 05D's locked vocabulary calls "anonymized-retention mode" per RB-07E-V1-02 \+ RB-07E-R5-04 — engineering mechanism identical):** Layer 2 UPDATEs `student_id` to surrogate UUID, never DELETEs (INV-05D-15 holds).  
* **Privacy-conservative fallback mode (under-13; gate-not-yet-cleared cases):** Layer 2 hard-DELETEs the rows; INV-05D-15 deliberately relaxes for this single documented exception per RB-05D-V1-B.

Under-13 cascade activates **Doc 05D §10.4 fallback mode** universally, regardless of whether the W7 \+ W9 sign-offs have cleared the §10.4 gate for 13+ users. This is age-stratified: 13+ users get pseudonymized-retention mode (post-W7+W9; until then, fallback applies to both cohorts); under-13 users always get fallback hard-delete mode regardless of W7/W9 status (COPPA-strict bar applies independently).

**The mode selector** is the `under_13_detected` flag from Doc 01 family. Doc 05D §10 cascade orchestration receives this flag as a cascade-mode parameter; 07E specifies the parameter shape; Doc 05D's cascade orchestration consumes it.

This needs a bundled cross-doc additive `W-07E-DOC05D-MODE-PARAM` registered in §15 to add the mode parameter to Doc 05D §10 cascade entry signature. The parameter shape: `cascade_mode: 'pseudonymized_retention' | 'hard_delete_fallback'`, defaulting to `'pseudonymized_retention'` for backward compatibility with 13+ default. (Naming note per RB-07E-R2-02: Doc 05D V1.0 internally uses "anonymized" vocabulary; 07E uses "pseudonymized" per the EDPB-pseudonymization-as-safeguard legal posture. The enum value uses the 07E-consistent label since 07E owns this cross-doc seam.)

## **10.4 Under-13 deletion record**

Beyond the Doc 05D §10 cascade audit, 07E specifies that under-13 deletions are recorded in a 07E-owned audit surface (V1.1+ table; at V1, the Doc 05D cascade audit \+ the Doc 06D §11 privacy-class incident attachment for under-13 cascade events is sufficient).

**Declared shape (V1.1+ build):**

\-- V1.1+ — Under-13 deletion audit (placeholder shape; canonical schema declared at V1.1+ build time)  
CREATE TABLE under\_13\_cascade\_audit (  
  id                              uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  cascade\_fired\_at                timestamptz NOT NULL,  
  detection\_trigger\_kind          text NOT NULL,  \-- 'signup\_age\_verification' | 'parental\_consent\_flow' | 'post\_hoc\_detection'  
  surfaces\_purged                 text\[\] NOT NULL, \-- e.g., \['supabase', 'posthog', 'bigquery'\]  
  posthog\_async\_completion\_at     timestamptz,    \-- nullable; populated by V1.1+ JOB-POSTHOG-DELETION-VERIFICATION  
  CHECK (cascade\_fired\_at \<= now()),  
  CHECK (detection\_trigger\_kind IN ('signup\_age\_verification', 'parental\_consent\_flow', 'post\_hoc\_detection'))  
);

**V1 stance:** at V1, the under-13 cascade fires through Doc 05D §10 cascade entry; the Doc 05D §10 cascade audit captures the cascade execution. The 07E under-13 audit table is V1.1+ build territory — added when analytics-surface expansion creates the need for per-surface deletion verification beyond what Doc 05D's audit covers.

## **10.5 Under-13 prevention at signup (Doc 01 family — referenced)**

The most effective under-13 mitigation is preventing under-13 signups in the first place. Per amended COPPA Rule 2026 \+ Doc 01 family signup-gate provisions, Lyceon implements age verification at signup. 07E does NOT body the signup-gate; that's Doc 01 family territory. 07E references the signup-gate as the primary defense, and the under-13 cascade variant per this §10 as the secondary defense (for cases where the signup-gate is bypassed or under-13 status is detected post-signup).

**Lyceon's target demographic is high school students (15-18); under-13 signups should be rare.** The §10 mechanism is defense-in-depth, not primary-line.

## **10.6 No pseudonymized-retention for under-13 — executable invariant (RB-07E-V1-04 \+ RB-07E-R5-03)**

Per §8.2 proposed posture: "For under-13 users: Doc 07E V1.0 PROPOSES that pseudonymized retention of the modeling tuple is NOT permissible for under-13 users." (Doc 05D's locked vocabulary calls this "one-way-anonymized retention"; 07E classifies it as pseudonymized at V1 per RB-07E-V1-02 — same engineering mechanism, different legal label.) The V1.0 DRAFT declared this as policy only; **SWE R1 RB-07E-V1-04 correctly identified that the algorithmic-disgorgement defense requires a runtime-enforced invariant, not just prose policy.** 07E V1.0 lock declares the executable invariant \+ names the proving mechanism (`ci/ml-training-under13-exclusion` per §12.5):

**Executable invariant (declared at V1; runtime-enforced when ML pipeline activates V1.1+):**

`ML_TRAINING_INPUTS MUST exclude any row whose source user was ever marked under_13_detected = true. ML_TRAINING_INPUTS MUST ALSO exclude any row whose age provenance is unknown (cannot be definitively shown to come from a 13+ user at the time of event emission).`

**The two-prong test:**

1. **Positive exclusion:** every row in the ML training input manifest must trace back (via `analytics_user_id` ancestry, or via system-state archive metadata) to a Supabase user\_row that was NEVER marked `under_13_detected = true` at any point in the user's lifecycle. Rows from cascaded users still trace back via the audit log of the cascade execution.

2. **Unknown-provenance exclusion:** if age provenance cannot be definitively established (e.g., system-state archives that don't carry per-event age metadata; pre-V1-emitted rows that lack the age-verification audit trail), the row is excluded from training. This is the conservative default — **age-unknown is treated as potentially-under-13 for ML training purposes**.

**Why this matters legally:** Per FTC/Kurbo settlement precedent \+ amended COPPA Rule (16 CFR 312.10 as in force 2026-04-22): if any under-13-derived row enters ML training, the FTC may require deletion of all ML models trained on that data (algorithmic disgorgement). The amended COPPA Rule additionally introduces **a separate consent requirement for using under-13 data in AI training** (per the FTC's 2025 commentary; carried as part of W8). The executable invariant is the runtime enforcement of this legal bar.

**Operational implications:**

* Lyceon's V1 launch does not have a running ML training pipeline; the invariant is V1-declared / V1.1+-runtime-active.  
* When V1.1+ ML training pipeline is built, the `ci/ml-training-under13-exclusion` proving mechanism (§12.5) hard-fails any training-input-manifest PR that doesn't certify the exclusion against the canonical user-age-status registry.  
* Doc 01 family owns the `under_13_detected` flag on Supabase profile rows; cascade-completed under-13 users' flag is preserved in Doc 05D §10 cascade audit log (per Doc 05D §10.5 idempotency) — the exclusion check can resolve historical under-13 status even after the Lyceon-side data is hard-deleted.  
* For system-state archives (§11) that don't carry per-event age metadata, the conservative default applies: those archives are excluded from training corpus that mixes with user-event data, OR are restricted to non-mixed system-only training tasks (e.g., training on prompt-template evolution alone, not joined with user event data). The exact ML-pipeline architecture is V1.1+ Doc 07B territory; 07E only declares the invariant.

**The under-13 cohort is excluded from the ML training corpus by design \+ by runtime enforcement.** This is the price of COPPA-strict compliance per Edmodo/Kurbo precedent \+ amended COPPA Rule 2026 \+ the separate AI-training-consent FTC commentary.

---

# **§11 — Unified System-State Archive Registry**

Per Q-07E-V2-2=γ lock (comprehensive name-only stubs \+ bodied V1-live entries), 07E V1.0 declares the unified system-state archive registry. The registry indexes every Lyceon-authored versioned-artifact archive that is retained indefinitely for ML training corpus \+ historical system-state reconstruction.

**Important:** 07E does NOT own the archives themselves — each archive's canonical owner is the doc that owns that artifact (e.g., Doc 05D owns mastery constants log). 07E owns the *index* — the manifest that says "this archive exists, lives at this location, is retained per this policy, joinable on timestamp for ML training purposes."

## **11.1 Registry purpose**

When a future LLM is trained on "what made Lyceon work in 2026," it needs system-state context — what were the prompts, what were the formula constants, what were the engine behaviors, what was the event stream — all timestamped and joinable. The 07E registry is the central manifest of these system-state archives.

**Joinable on timestamp:** every archive entry in the registry declares the timestamp field that allows cross-archive joining. This is the load-bearing design principle — without consistent timestamp semantics, the archives cannot be joined for ML training.

**Indefinite retention:** every registry entry is in retention class 2 (`pseudonymized_indefinite_retention_pending_anonymization_review`) per §5.2. The archives are Lyceon-authored artifacts and contain no user-identifying data by design; their retention is unaffected by user cascade events.

## **11.2 Registry schema**

\# infra/system-state-archive-registry.yaml  
\# Canonical manifest of Lyceon-authored versioned-artifact archives retained for ML training corpus.  
\# Owner: Doc 07E V1.0 §11

schema\_version: "1.0.0"  
last\_updated: "2026-05-26"

archives:  
  \- archive\_id: \<stable ID; format 'SSA-\<area\>-\<NN\>'\>  
    canonical\_owner\_doc\_and\_section: \<e.g. 'Doc 05D V1.0 §5.2'\>  
    archive\_storage\_location: \<table name or storage system reference\>  
    timestamp\_field: \<the field that makes this archive joinable temporally\>  
    content\_description: \<human-readable description of what's in this archive\>  
    retention\_class: pseudonymized\_indefinite\_retention\_pending\_anonymization\_review  \# always class 2 per §5.2  
    status\_at\_07e\_v1\_0\_lock: \<'V1-bodied' | 'V1.1+ stub'\>  
    v1\_1\_activation\_trigger: \<hybrid trigger description; null for V1-bodied entries\>  
    notes: \<free-text\>

## **11.3 Archive entry — `SSA-MASTERY-CONSTANTS`**

\- archive\_id: SSA-MASTERY-CONSTANTS  
  canonical\_owner\_doc\_and\_section: 'Doc 05D V1.0 §5.2'  
  archive\_storage\_location: 'mastery\_constants\_change\_log'  \# Doc 05D §5.2 table  
  timestamp\_field: 'changed\_at'  \# per Doc 05D §5.2 schema (referenced, not restated)  
  content\_description: 'Every change to mastery\_constants table (formula constants \+ operational constants) captured append-only per Doc 05D §6 ENABLE ALWAYS trigger. The archive captures op (INSERT/UPDATE/DELETE), old/new values, affects\_formula\_hash flag, actor, txid, resulting\_state\_hash. Vintage history of Lyceons mastery formula constants.'  
  retention\_class: pseudonymized\_indefinite\_retention\_pending\_anonymization\_review  
  status\_at\_07e\_v1\_0\_lock: V1-bodied  
  v1\_1\_activation\_trigger: null  
  notes: 'Per Doc 05D INV-05D-15 \+ §10 cascade behavior, this table is append-only with no UPDATE/DELETE except the §10 cascade for student\_id columns (which this table does not contain — actor\_user\_id is operator identity, not student). The archive is unaffected by user cascade events. Contains no PII (mastery constants are operational parameters, not user data).'

## **11.4 Archive entry — `SSA-SCORING-CONSTANTS`**

\- archive\_id: SSA-SCORING-CONSTANTS  
  canonical\_owner\_doc\_and\_section: 'Doc 04B V4.3 (LOCKED 2026-05-12)'  
  archive\_storage\_location: 'scoring\_model\_versions \+ scoring\_constants (via constants\_snapshot JSONB on score\_runs)'  \# Doc 04B V4.3 canonical schema  
  timestamp\_field: 'published\_at (on scoring\_model\_versions); started\_at (on score\_runs for vintage hash linkage)'  
  content\_description: 'Per-version scoring formula constants captured in scoring\_model\_versions table with constants\_sha256 evidence hash; per-score-run constants\_snapshot JSONB capturing the exact constants used. Vintage history of Lyceons exam scoring formula at every score-run.'  
  retention\_class: pseudonymized\_indefinite\_retention\_pending\_anonymization\_review  
  status\_at\_07e\_v1\_0\_lock: V1-bodied  
  v1\_1\_activation\_trigger: null  
  notes: 'Per Doc 04B V4.3 insert-once score\_runs \+ immutable scoring\_model\_versions, this archive is append-only by design. Contains no PII (scoring constants are formula parameters). The v1.0 evidence packet hash 29c3e0fd362b6f5c3c90c50a49b49fa55ebc03e1518f8ab1922408329b88651b is referenced in scoring\_model\_versions.v1.0.constants\_sha256 per Doc 04B V4.3 lock.'

## **11.5 Archive entry — `SSA-LISA-PROMPT-TEMPLATES`**

\- archive\_id: SSA-LISA-PROMPT-TEMPLATES  
  canonical\_owner\_doc\_and\_section: 'Doc 03 Main V1.1 — LISA prompt-template-version archive (canonical archive declaration pending W-07E-DOC03-PROMPT-ARCHIVE)'  
  archive\_storage\_location: 'TBD — Doc 03 family ownership; specific table/storage TBD'  
  timestamp\_field: 'TBD'  
  content\_description: 'Versioned LISA tutor prompt templates (system prompts, persona prompts, configuration prompts that define LISAs behavior at any point in time). Lyceon-authored artifacts (NOT student conversation transcripts; per Karl pre-draft clarification: prompts means prompt templates, not student inputs).'  
  retention\_class: pseudonymized\_indefinite\_retention\_pending\_anonymization\_review  
  status\_at\_07e\_v1\_0\_lock: V1.1+ stub  
  v1\_1\_activation\_trigger: 'Doc 03 family V1.1+ declares prompt-template-version archive canonical with specific storage location \+ timestamp field schema'  
  notes: 'Doc 03 Main V1.1 is not in this sessions source tree; the prompt-template-version archive is referenced per project handoff record. Per §15 W11 watch item: when Doc 03 family declares the archive canonical (Doc 03 V1.1+), 07E receives the canonical owner \+ location \+ timestamp field via bundled additive W-07E-DOC03-PROMPT-ARCHIVE. Until then, this is a V1.1+ stub.'

## **11.6 Archive entries — V1.1+ stubs**

\- archive\_id: SSA-POSTHOG-EVENT-STREAM  
  canonical\_owner\_doc\_and\_section: 'Doc 07A V1.0 §6 (event registry) \+ Doc 07E §5.2 (retention class 2)'  
  archive\_storage\_location: 'PostHog Cloud (Tier-1 launch-required vendor per W-07-PostHog-BQ)'  
  timestamp\_field: 'timestamp (per Doc 07A V1.0 §6 base required field)'  
  content\_description: 'Lyceon platform event stream — 25 V1 events across 8 canonical classes (auth/cohort/billing/practice/exam/tutor/mastery/system) emitted from V1 application code per Doc 07A V1.0 emission contract. Post-cascade for 13+ users: events remain in PostHog as orphaned analytics\_user\_id, structurally pseudonymized per §7.3 (a personal-data safeguard, not legal anonymization at V1 per RB-07E-V1-02).'  
  retention\_class: pseudonymized\_indefinite\_retention\_pending\_anonymization\_review  
  status\_at\_07e\_v1\_0\_lock: V1-bodied  \# PostHog is Tier-1 launch-required; the event stream exists from V1 launch  
  v1\_1\_activation\_trigger: null  
  notes: 'The PostHog event stream is V1-live as Lyceons primary analytics substrate buffer per Doc 07 Parent §6.1. Per §7.3, the 13+ cascade transition is by Supabase user\_row hard-delete (not by PostHog API call) — the events become pseudonymized at fact via bridge severance (a personal-data safeguard, not legal anonymization at V1 per RB-07E-V1-02).'

\- archive\_id: SSA-BIGQUERY-AGGREGATES  
  canonical\_owner\_doc\_and\_section: 'Doc 07B V1.1+ (warehouse models — pending draft per Q-07-6=β order)'  
  archive\_storage\_location: 'BigQuery (Tier-1 target-state vendor per W-07-PostHog-BQ)'  
  timestamp\_field: 'TBD per Doc 07B V1.1+'  
  content\_description: 'Aggregated derived analytics data — fact/dimension tables, KPI rollups, cohort analyses, longitudinal learning trajectory aggregates. Populated by V1.1+ warehouse ingestion pipeline from PostHog event stream \+ Doc 05D §10.2 step 11 retained modeling tuple.'  
  retention\_class: pseudonymized\_indefinite\_retention\_pending\_anonymization\_review  
  status\_at\_07e\_v1\_0\_lock: V1.1+ stub  
  v1\_1\_activation\_trigger: 'Doc 07B V1.1+ ships warehouse-model spec \+ W-07-PostHog-BQ BigQuery Tier-1 substrate activates'  
  notes: 'BigQuery is target-state V1.1+ per Doc 07 Parent §6.2; this archive activates when warehouse export from PostHog goes live. Per §12.3, the warehouse-side ci/historical-pii-conformance mechanism also activates here.'

\- archive\_id: SSA-PRACTICE-ENGINE-VERSIONS  
  canonical\_owner\_doc\_and\_section: 'Doc 02B (practice engine — version archive canonical declaration pending)'  
  archive\_storage\_location: 'TBD'  
  timestamp\_field: 'TBD'  
  content\_description: 'Versioned practice engine behavior (question selection algorithm, mastery weighting, retry logic). Versioned Lyceon-authored configuration.'  
  retention\_class: pseudonymized\_indefinite\_retention\_pending\_anonymization\_review  
  status\_at\_07e\_v1\_0\_lock: V1.1+ stub  
  v1\_1\_activation\_trigger: 'Doc 02B V1.1+ declares practice engine version archive canonical'  
  notes: 'Per §15 W12 watch item: practice engine version archive canonical declaration is owed by Doc 02B; until declared, this is a V1.1+ stub. Per project memory, Doc 02 series is locked but the version-archive surface is not enumerated in current 07E session context.'

\- archive\_id: SSA-EXAM-ENGINE-VERSIONS  
  canonical\_owner\_doc\_and\_section: 'Doc 04A V2.2 (exam runtime) \+ Doc 04B V4.3 (scoring) — version archive canonical declarations pending'  
  archive\_storage\_location: 'TBD'  
  timestamp\_field: 'TBD'  
  content\_description: 'Versioned exam runtime behavior (timing rules, routing logic, accommodation handling) \+ versioned scoring behavior (cited per SSA-SCORING-CONSTANTS for the constants archive; the engine behavior archive captures non-constant logic).'  
  retention\_class: pseudonymized\_indefinite\_retention\_pending\_anonymization\_review  
  status\_at\_07e\_v1\_0\_lock: V1.1+ stub  
  v1\_1\_activation\_trigger: 'Doc 04 family V1.1+ declares exam engine version archive canonical (beyond scoring constants which are already V1-bodied at SSA-SCORING-CONSTANTS)'  
  notes: 'Per §15 W13 watch item.'

\- archive\_id: SSA-TUTOR-ROUTER-VERSIONS  
  canonical\_owner\_doc\_and\_section: 'Doc 03A / Doc 03B / Doc 03C — tutor router \+ orchestrator version archive declarations pending'  
  archive\_storage\_location: 'TBD'  
  timestamp\_field: 'TBD'  
  content\_description: 'Versioned LISA tutor router behavior (escalation thresholds, model selection rules, retry policies) — system-state context complementary to the SSA-LISA-PROMPT-TEMPLATES prompt archive.'  
  retention\_class: pseudonymized\_indefinite\_retention\_pending\_anonymization\_review  
  status\_at\_07e\_v1\_0\_lock: V1.1+ stub  
  v1\_1\_activation\_trigger: 'Doc 03 family V1.1+ declares tutor router version archive canonical'  
  notes: 'Per §15 W14 watch item.'

## **11.7 Registry parity check (V1.1+ activation hook)**

`ci/system-state-archive-registry-parity` — placeholder mechanism declared at V1; activates V1.1+ when warehouse export is live. Validates that registry entries point at canonical-owner § anchors that resolve \+ the underlying archives are populated as expected.

Declared shape only at V1; build V1.1+. Tracks the §15 W6 archive-registry-staleness watch item.

## **11.8 What's NOT in the registry (intentional exclusions)**

* **Doc 03 LISA tutor conversation logs** — per Doc 03 Main §14.2 retention matrix; subject to 10-table retention windows; NOT a Lyceon-authored artifact (it's user-conversation data); NOT eligible for indefinite retention. Excluded from registry per Doc 03 family canonical retention.

* **Supabase auth logs** — Doc 01 V6.0 \+ Doc 01A §14 territory; NOT a Lyceon-authored versioned-artifact archive; identifying data with its own retention horizon.

* **Stripe webhook logs** — Doc 09 \+ Stripe-side retention; Lyceon does not own retention here.

* **Vertex AI request/response logs** — Doc 03C / Vertex AI vendor-side retention; not Lyceon-authored.

* **CI/CD build logs** — operational telemetry, not system-state archive; Doc 06 family territory.

These exclusions are deliberate: the system-state archive is specifically the *Lyceon-authored versioned-artifact archives* that explain *Lyceon's own behavior* at time T. Operational telemetry, vendor-side logs, and user-conversation data are out of scope.

---

# **§12 — V1 Owned Mechanisms (Six-Element §6.13 Implemented-Definition Tables)**

Per Doc 06 Parent §6.13 \+ Doc 07 Parent §6.13 convention, every Doc 07 mechanism declares a six-element implemented-definition table. 07E V1.0 owns three V1 mechanisms (two V1-active, one V1.1+-placeholder) plus one V1.1+-declared mechanism.

## **12.1 `ci/analytics-retention-policy-registered` (INV-07-03 proving mechanism)**

| Element | Value |
| ----- | ----- |
| **execution\_location** | GitHub Actions, on PRs touching `infra/retention-policy-registry.yaml` or any referenced canonical owner doc; plus nightly. Same execution surface as Doc 06D §9.3 `ci/retention-policy-registry-parity` (07E's check is layered as an additional pass within that CI run). |
| **trigger\_cadence** | Per PR \+ nightly (inherited from `ci/retention-policy-registry-parity`) |
| **input\_registry** | `infra/retention-policy-registry.yaml` (Doc 06D §9.1 canonical) — specifically the analytics-layer entries `RPOL-ANALYTICS-01` \+ `RPOL-ANALYTICS-02` (§6.1 \+ §6.2 above); the Doc 07E V1.0 spec doc itself (cited as `canonical_owner_doc_and_section`); the Doc 06D §10 compliance-gate registry (when populated post-`W-07E-DOC06D-CGATES` watch item — for `CGATE-*` references in §7.6 trigger conditions). |
| **failure\_mode\_at\_V1** | **Hard-fail at V1.** Specific fail conditions: (a) `RPOL-ANALYTICS-01` missing from registry; (b) `RPOL-ANALYTICS-02` missing from registry; (c) either entry's `canonical_owner_doc_and_section` does not resolve to a Doc 07E V1.0 § anchor (citation parity); (d) `RPOL-ANALYTICS-01` has `retention_horizon_months != 12` OR `calendar_month_semantics != true` (the 12-month calendar-aware value is V1-hard-locked per RB-07E-V1-05; V1.1+ may extend via config-change but the CI value is V1 acceptance); (e) `RPOL-ANALYTICS-01` has `purge_substrate != 'doc05d_cascade'` (substrate-correctness check); (f) `RPOL-ANALYTICS-02` has `partial_provable_until` not resolving to a registered forward-ref token. |
| **proof\_artifact\_shape** | `analytics-retention-policy-registered` record per Parent §10.5 standard envelope \+ 07E extras: `entries_checked[]` per entry `{policy_id, canonical_owner_resolution, retention_horizon_check, purge_substrate_check, partial_provable_check, decision}` \+ `boundary_check: {ci_event_schema_registry_parity_integration_status, ci_retention_policy_registry_parity_integration_status}`. **Subject to §8.7 no-PII rule** (per Doc 06D §8.7 family-wide canonical statement) — no analytics\_user\_id, no event payload data, no user identifier of any form in the proof artifact. |
| **owner\_paging\_owner** | Platform/CTO; PR-blocking; **no Page alert at V1 per INV-07-09 negative invariant** (CI failure surfaces as PR-block message only). V1.1+ when Doc 07-class alerts activate, may add Page routing per Doc 06C §7 standard mechanism. |

**Launch-required at V1:** true (hard-fail at V1).

**Activation:** V1-active. Runs immediately upon 07E V1.0 lock (the spec is the trigger for Doc 06D §9 registry update via `W-07E-DOC06D-REGISTRY` bundled additive; once Doc 06D §9 registry is updated, the CI runs against it).

## **12.2 `ci/analytics-cascade-target-declared` (INV-07-04 proving mechanism)**

| Element | Value |
| ----- | ----- |
| **execution\_location** | GitHub Actions, on PRs touching Doc 07E V1.0 source file (`Doc_07E_V10.md`) OR Doc 05D V1.0 source file OR any future doc that references the cascade Layer-4 surface; plus nightly. |
| **trigger\_cadence** | Per PR \+ nightly |
| **input\_registry** | Doc 05D V1.0 §10 cascade orchestration spec (parsed for "Layer 4" \+ "analytics" references); Doc 07E V1.0 §7 cascade body declaration (the canonical target); Doc 07 Parent V1.0 §1 deliverable \#5 \+ Parent INV-07-04 (the family invariant statement). |
| **failure\_mode\_at\_V1** | **Hard-fail at V1.** Specific fail conditions: (a) Doc 05D §10 cascade does not contain a resolvable reference to Doc 07E §7 (or the equivalent — Doc 05D §10 itself does not need to be modified post-07E-lock; what's required is that 07E §7 is the declared canonical body for the Layer-4 analytics target and the citation parity is mechanically verifiable); (b) Doc 07E §7 does not declare both age-stratified cases (13+ and under-13); (c) Doc 07E §7 does not declare both surfaces (PostHog at V1 \+ BigQuery at V1.1+); (d) the `W-07E-DOC05D-MODE-PARAM` bundled additive (§10.3) is not registered in §15 watch items (07E owes Doc 05D the mode-selector parameter shape declaration); (e) the §8 BLOCKING\_PRIVACY\_GAP **proposed compliance posture declaration** is missing or does not formally cite Doc 05D §10.4 (per RB-07E-R3-01 — 07E V1.0 lock declares the proposed posture; formal resolution requires W7 \+ W9 closure post-lock; the proof field is `privacy_gate_proposed_posture_check`, NOT `privacy_gate_resolution_check`). |
| **proof\_artifact\_shape** | `analytics-cascade-target-declared` record per Parent §10.5 standard envelope \+ 07E extras: `cascade_target_declaration_check: {layer_4_declared, 13_plus_path_declared, under_13_path_declared, posthog_v1_declared, bigquery_v1_1_plus_declared}` \+ `privacy_gate_proposed_posture_check: {doc05d_10_4_proposed_posture_declared, proposed_posture_basis_cited, edps_v_srb_cited, age_stratification_explicit, formal_resolution_pending_w7_w9_acknowledged}` (per RB-07E-R3-01 — field renamed from `privacy_gate_resolution_check` to `privacy_gate_proposed_posture_check`; sub-field `doc05d_10_4_resolved` retired and replaced with `doc05d_10_4_proposed_posture_declared` \+ `formal_resolution_pending_w7_w9_acknowledged`) \+ `bundled_additives_check: {w_07e_doc05d_mode_param_registered, w_07e_parent_cascade_clarify_registered, w_07e_doc06d_registry_registered}`. **Subject to §8.7 no-PII rule.** |
| **owner\_paging\_owner** | Platform/CTO; PR-blocking; **no Page alert at V1 per INV-07-09 negative invariant**. |

**Launch-required at V1:** true (hard-fail at V1).

**Activation:** V1-active. Runs against the locked 07E V1.0 \+ Doc 05D V1.0 spec text.

## **12.3 `ci/historical-pii-conformance` (joint with Doc 07A V1.0 `ci/pii-redaction-conformance` — warehouse-side half)**

| Element | Value |
| ----- | ----- |
| **execution\_location** | V1.1+ — GitHub Actions on PRs touching `infra/event-schema-registry.yaml` (Doc 07A V1.0 §5 canonical) once warehouse export is live; plus nightly query against BigQuery `historical_events` table (when V1.1+ warehouse export activates). At V1, the mechanism is **placeholder only** — declared shape but not running because BigQuery is not live. |
| **trigger\_cadence** | V1.1+: per PR (static check against registry) \+ nightly (runtime sampled query against BigQuery). V1: not triggered. |
| **input\_registry** | V1.1+: `infra/event-schema-registry.yaml` (Doc 07A V1.0 §5 canonical) — every event entry's `pii_redaction` map; BigQuery `historical_events` table (V1.1+) — every event row ever stored, including events from prior schema versions. V1: not consumed (mechanism is placeholder). |
| **failure\_mode\_at\_V1** | V1: not applicable (mechanism is placeholder; declared shape only). **V1.1+ failure conditions** (declared shape at V1; built V1.1+): (a) any BigQuery event row whose property set contains a field not declared in the corresponding `event-schema-registry.yaml` entry's `json_schema.properties` (schema-drift detection); (b) any BigQuery event row whose property values match a forbidden-identifier-types pattern per Doc 07A V1.0 §8.1.1 runtime enum (real-time-property-value PII detection); (c) any historical event row from a deprecated schema version whose redaction posture does not match the current registry (schema-version-history reconciliation). |
| **proof\_artifact\_shape** | V1: minimal placeholder artifact declaring `v1_1_plus_activation_pending: true` \+ `activation_trigger: 'W-07-PostHog-BQ BigQuery Tier-1 substrate activation'`. V1.1+ shape: `historical-pii-conformance` record per Parent §10.5 envelope \+ extras: `events_sampled[]`, per-event `{event_name, schema_version_observed, schema_version_current_registry, property_set_diff, forbidden_identifier_value_check, decision}`. **Subject to §8.7 no-PII rule** — proof artifact stores only field-name metadata \+ sample-count statistics; never the actual property values that triggered a violation. |
| **owner\_paging\_owner** | Platform/CTO; V1.1+ when activated: alert routing TBD per Doc 06C §7 standard mechanism registration. V1: no paging (placeholder). |

**Launch-required at V1:** true (mechanism shape declaration is launch-required per Doc 07 Parent INV-07-02 joint-with-07A; the V1.1+ activation is target-state).

**Activation trigger (V1.1+ per Q-07A-7=δ hybrid):** (a) PostHog → BigQuery export goes live per W-07-PostHog-BQ BigQuery Tier-1 activation \[infrastructure\] OR (b) sustained PostHog event volume \> 1M events/month \[volume\] OR (c) compliance audit demand for historical PII attestation \[demand\] — first-to-trigger wins.

## **12.4 `ops/inactivity-cascade-conformance` (V1.1+ runtime mechanism — declared shape only at V1)**

| Element | Value |
| ----- | ----- |
| **execution\_location** | V1.1+: Vercel Cron per Doc 06C §8.2 substrate convention; registered as `JOB-INACTIVITY-DETECTION` (see §9.3 declaration). At V1, the mechanism is **declared shape only** — no scheduled job runs at V1 because Lyceon V1 has zero users old enough to trigger 12-month-inactivity. |
| **trigger\_cadence** | V1.1+: daily |
| **input\_registry** | V1.1+: Doc 01 V8.1+ canonical user-activity timestamp field (per FWD-07E-06; V1 of 07E ships with the field documented-but-undeclared); `USER_INACTIVITY_RETENTION_MONTHS` config primitive (Doc 01A §3 — 12 at V1); Doc 05D §10 cascade entry point. |
| **failure\_mode\_at\_V1** | V1: not applicable. **V1.1+ failure conditions** (declared shape at V1; built V1.1+): (a) inactivity-detection scheduled job heartbeat missing for \> 25 hours (Doc 06C §8.3 substrate convention — daily cadence \+ 1-hour grace); (b) inactivity-detection scheduled job fired but Doc 05D §10 cascade did not subsequently fire for an identified user within 48 hours \+ notification window expiry (cascade-orchestration failure detection); (c) inactivity-detection scheduled job identified a user as inactive but the user signed in during the 48-hour notification window AND the cascade fired anyway (false-positive-protection failure — cascade should have been canceled). |
| **proof\_artifact\_shape** | V1: minimal placeholder artifact declaring `v1_1_plus_activation_pending: true` \+ activation trigger. V1.1+ shape: `inactivity-cascade-conformance` record per Parent §10.5 envelope \+ extras: `users_evaluated_count`, `users_notified_count`, `users_signed_in_during_window_count`, `users_cascade_fired_count`, per-cascade `{user_id_redacted_for_artifact, inactivity_duration_months, notification_sent_at, cascade_fired_at, sign_in_observed_at_if_any, decision}` (field renamed from `user_id_anonymized_for_artifact` per P31 conformance — the field carries a hashed/redacted user\_id specifically for proof-artifact purposes; "redacted" is the precise operation name avoiding the anonymized/pseudonymized legal distinction). **Subject to §8.7 no-PII rule** — `user_id_redacted_for_artifact` is hashed per proof-artifact-redaction-method per Doc 07A V1.0 §8.1.2; never raw user\_id. |
| **owner\_paging\_owner** | V1.1+: Platform/CTO; alert routing per Doc 06C §7 standard mechanism registration; V1.1+ activation may relax INV-07-09 per family-level extension. V1: no paging (placeholder). |

**Launch-required at V1:** true (mechanism shape declaration is launch-required per Doc 07E §9.3 declaration; the V1.1+ activation is target-state).

**Activation trigger (V1.1+ per Q-07A-7=δ hybrid):** (a) earliest possible user expiration approaches — first user signup \+ 12 months elapses \[time, naturally aligned with platform age\] OR (b) \> 100 users approaching expiration in next 90 days \[volume\] OR (c) compliance audit demand \[demand\] — first-to-trigger wins.

**Hard activation deadline (RB-07E-V1-07):** `JOB-INACTIVITY-DETECTION` MUST ship and activate **no later than 90 days before the earliest possible 12-month inactivity expiration** (computed as: earliest Supabase user\_row creation timestamp \+ 12 months − 90 days). For Lyceon V1 launch in late-May 2026, this means the V1.1+ activation deadline is approximately **2027-02-26** (= 2026-05-26 \+ 12 months − 90 days). The 90-day buffer gives engineering operational time to validate the mechanism \+ 48-hour notification delivery before any user is actually expired. Beyond this deadline without activation, the open-ended-deferral risk per RB-07E-V1-07 SWE R1 finding becomes a real compliance gap (the 12-month inactivity threshold is published in the privacy policy per W7; failing to enforce it after the deadline is a deceptive-practice exposure under FTC Section 5).

## **12.5 `ci/ml-training-under13-exclusion` (RB-07E-V1-04 — V1.1+ runtime mechanism, V1 invariant declaration)**

| Element | Value |
| ----- | ----- |
| **execution\_location** | V1.1+ — GitHub Actions on PRs touching ML training manifests, training input data references, or training pipeline configuration files (specific paths TBD when V1.1+ ML pipeline is built); plus nightly. At V1, the mechanism is **declared invariant only** — no ML training pipeline exists at V1 (per §10.6 \+ §11.6 V1 inventory: no ML training pipeline V1; BigQuery is V1.1+; ML training is V1.2+ or later). |
| **trigger\_cadence** | V1.1+: per PR (static check against training manifest) \+ per-training-run (runtime check at training-job-start). V1: not triggered. |
| **input\_registry** | V1.1+: training input manifest declaring source `analytics_user_id`s \+ age provenance per row; Doc 01 family `under_13_detected` flag history (canonical owner — may also be served by Doc 05D §10 cascade audit log for cascade-completed under-13 users); training pipeline configuration. V1: not consumed (mechanism is V1-declared invariant). |
| **failure\_mode\_at\_V1** | V1: not applicable (mechanism is invariant declaration only). **V1.1+ failure conditions** (declared shape at V1; runtime-active V1.1+): (a) any training-input-manifest row references an `analytics_user_id` that traces (via Doc 01 family or Doc 05D §10 cascade audit) to a Supabase user\_row where `under_13_detected = true` was ever set; (b) any training-input-manifest row has age provenance `unknown` (cannot be definitively shown to come from a 13+ user — conservative-default exclusion per §10.6 two-prong test); (c) any training pipeline configuration references a data source that includes mixed age-provenance data without explicit age-filter declaration. |
| **proof\_artifact\_shape** | V1: minimal placeholder artifact declaring `v1_1_plus_activation_pending: true` \+ activation trigger. V1.1+ shape: `ml-training-under13-exclusion` record per Parent §10.5 envelope \+ extras: `training_run_id`, `manifest_path`, `rows_checked_count`, `rows_excluded_under13_count`, `rows_excluded_unknown_provenance_count`, `rows_admitted_count`, `under13_exclusion_check_passed: bool`, `decision`. **Subject to §8.7 no-PII rule** — never logs raw `analytics_user_id`; only count statistics \+ hash digests. |
| **owner\_paging\_owner** | V1.1+: Platform/CTO \+ ML lead; PR-blocking; V1.1+ activation may register alert routing per Doc 06C §7 standard mechanism. V1: no paging (placeholder). |

**Launch-required at V1:** true (the invariant declaration is launch-required per §10.6 \+ INV-07 family invariant extension; the V1.1+ runtime enforcement is target-state). **The invariant is the substantive content of "launch-required" here — it's a binding contract that the V1.1+ ML pipeline MUST implement, registered in the spec so it cannot be quietly omitted.**

**Activation trigger (V1.1+ per Q-07A-7=δ hybrid):** (a) Lyceon ML training pipeline is built and the first training run occurs \[demand\] OR (b) V1.1+ BigQuery aggregated store activates with intent to consume for ML training \[infrastructure\] — first-to-trigger wins. **Hard deadline:** the mechanism MUST be runtime-active **before** any ML training job consumes any row that could possibly trace to a user-event-stream source (NOT just system-state-archives-only training, which is exempted per §10.6 mixed-vs-unmixed framing).

**Why this mechanism exists (RB-07E-V1-04 rationale):** SWE R1 review correctly identified that prose-only policy ("under-13 users are excluded from ML training") provides no enforcement at runtime. The FTC's algorithmic-disgorgement enforcement pattern (Edmodo 2023; Kurbo/WW 2022\) penalizes prose-only commitments. The runtime mechanism is the algorithmic-disgorgement defense.

---

# **§13 — Audit Profile**

07E inherits the 30-pass audit suite from Doc 07 Parent V1.0 §9 \+ family carry-forward (12 base \+ 18 Doc 06 family extensions \+ 5 Doc 07 Parent extensions). **07E V1.0 additionally introduces P31 (vocabulary-consistency pass per RB-07E-R3-04) bringing the 07E-applied audit suite to 31 passes total.** 07E is the **implementation site** for three passes (P29 \+ P30 inherited from Parent; P31 introduced by 07E):

## **13.1 P29 — retention-policy-cross-ref to Doc 06D §9 (07E implementation site)**

Doc 07 Parent declares P29: "07E retention-policy-cross-ref to Doc 06D §9 — verifies that 07E retention policy declaration is registered with Doc 06D §9 retention registry as FWD-06-01 resolution." 07E V1.0 implements P29 via:

* §5 retention class taxonomy declaration (two classes)  
* §6 Doc 06D §9 registry entry declarations (`RPOL-ANALYTICS-01` \+ `RPOL-ANALYTICS-02`)  
* §12.1 `ci/analytics-retention-policy-registered` mechanism that runtime-validates the registry contains the entries  
* §15 W-07E-DOC06D-REGISTRY bundled additive that triggers Doc 06D `RB-06D-V1-19` to actually populate the registry post-07E-lock

P29 audit pass behavior: parses Doc 07E V1.0 §5 \+ §6 \+ §12.1; cross-references Doc 06D V1.0 §9.1 schema; verifies entry shape conformance (every required field present; every cited `canonical_owner_doc_and_section` resolves). At V1 (before `RB-06D-V1-19` lands), the registry doesn't yet contain the entries — P29 audit passes against the declared spec, not the populated registry. Post-`RB-06D-V1-19`, the runtime check via `ci/analytics-retention-policy-registered` (§12.1) verifies the actual registry.

## **13.2 P30 — deletion-cascade-target-cross-ref to Doc 05D §10 (07E implementation site)**

Doc 07 Parent declares P30: "07E deletion-cascade-target cross-ref to Doc 05D §10 — verifies that 07E cascade target body is declared as the canonical resolution for Doc 05D §10 Layer-4 analytics target." 07E V1.0 implements P30 via:

* §7 cascade Layer-4 body declaration  
* §7.1 explicit reference to Doc 05D §10 as canonical orchestration base (Decision 5 compliance)  
* §8 Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP **proposed compliance posture declaration** (per RB-07E-R3-01 — NOT "formal resolution declaration"; 07E V1.0 lock declares the proposed posture, formal resolution requires W7 \+ W9 closure post-lock)  
* §10 under-13 hard-delete-everywhere age-stratified variant  
* §12.2 `ci/analytics-cascade-target-declared` mechanism that runtime-validates the cross-ref

P30 audit pass behavior: parses Doc 07E V1.0 §7 \+ §8 \+ §10 \+ §12.2; cross-references Doc 05D V1.0 §10 (specifically §10.4 BLOCKING\_PRIVACY\_GAP); verifies citation parity (Doc 07E §7 cites Doc 05D §10; Doc 07E §8 cites Doc 05D §10.4; Doc 07E §10 cites Doc 05D §10.4 fallback mode); verifies the age-stratified split is explicit (13+ vs under-13); verifies the W-07E-DOC05D-MODE-PARAM bundled additive is registered in §15.

## **13.3 P29 \+ P30 \+ P31 implementation summary**

P29, P30, and P31 are 07E-implementation-site passes. The Parent-level declaration says "the family invariant requires this declaration"; the 07E-level body says "here is the declaration." P29 \+ P30 are bodied per §13.1 \+ §13.2; P31 is bodied per §13.6 below (RB-07E-R3-04 — vocabulary-consistency pass added in R3 cleanup).

## **13.4 Passes 07E inherits without extension (carry-forward from family)**

P1-P12 base \+ P13-P18 from Doc 06C \+ P19-P22 from Doc 06D \+ P23-P25 from Doc 06E \+ P26-P28 from Doc 07 Parent. 07E inherits all 25 carry-forward passes plus implements P29 \+ P30 \+ P31. The 31-pass audit suite (was 30; \+1 per RB-07E-R3-04) is family-wide-plus-07E-introduced; P31 re-runs against 07E V1.0 on each audit cycle.

Specifically called out: **P28 (PII-redaction-contract conformance)** — Doc 07A V1.0 owns the event-time half (registry split-enum contract); 07E owns the warehouse-side half (V1.1+ `ci/historical-pii-conformance` per §12.3). At V1, 07E's P28 contribution is the placeholder mechanism declaration; V1.1+ activation extends P28's body.

## **13.5 Pre-delivery audit discipline (07A precedent extension)**

Per the patterns 07A V1.0 carried forward through CR-07A-04 \+ CR-07A-05:

1. **Trace at least one synthetic call through any spec'd sequential procedure** before delivery. For 07E: trace the cascade execution path through Doc 05D §10 → 07E §7 (PostHog-side) for both 13+ and under-13 cases; trace the inactivity-detection scheduled job through §9.3 → §9.2 → cascade fire.

2. **Web-search any external-reality data** (vendor docs, regulatory citations, case law) before writing it into a spec. For 07E: EDPS v SRB CJEU judgment (Case C-413/23 P, 4 Sept 2025); amended COPPA Rule 2026 (16 CFR 312.10); EDPB 01/2025 pseudonymization guidelines; Kurbo/WW \+ Edmodo FTC settlement precedents; India DPDP 2023 \+ DPDP Rules 2025; Brazil ECA Digital (Law 15,211/2025 effective 17 March 2026). All verified during pre-draft research per the deep-research turn.

3. **After any wholesale section rewrite or vocabulary change, grep for the OLD vocabulary** across the entire doc before declaring cleanup complete. Apply at each in-lock-cycle cleanup round. **Lesson from R3 cleanup (RB-07E-R3-01 \+ R3-02 \+ R3-03):** the grep must cover ALL compound noun phrase variants (e.g., `anonymized-retention model`, `keep-forever-anonymized`, `becomes anonymized after cascade`, `deletePerson?delete_events=true`), not just the renamed identifiers (e.g., `anonymized_indefinite_retention`). Three R3 BLOCKERs were caused by incomplete grep coverage after R1 \+ R2 vocabulary sweeps.

These disciplines are not new audit passes — they are pre-delivery operational checks that prevent the failure classes 07A R1 \+ R2 \+ 07E R1/R2/R3 surfaced. Apply during 07E SWE review cycles.

## **13.6 P31 — vocabulary-consistency pass (07E-introduced; RB-07E-R3-04)**

07E introduces P31 as a new family-level audit pass — the first 07E-introduced pass beyond the inherited P26-P30 from Doc 07 Parent. P31 prevents the failure class that drove R3 cleanup (stale vocabulary surviving wholesale vocabulary rewrites).

**Pass scope:** the entire 07E V1.0 document plus, when activated family-wide V1.1+, the entire Doc 07 family \+ any doc that references 07E vocabulary by exact phrase.

**Pass behavior — three hard-fail conditions:**

1. **V1-retained-event-data anonymization mislabel:** P31 hard-fails if any line in 07E describes V1 retained event data as "anonymized" (adjective form OR noun-phrase compound like "anonymized-retention" / "anonymized records" / "becomes anonymized") OUTSIDE the explicit allowed contexts:

   * Direct verbatim quote from Doc 05D's internal vocabulary (Doc 05D V1.0 internally uses "anonymized" — citing the locked doc is allowed)  
   * Future legal-upgrade context explicitly framed as "potentially anonymized after W5 \+ W9 closure"  
   * Generic legal-anonymization-bar reference (e.g., "the legal anonymization bar" as a definitional concept)  
   * Meta references in cleanup register / change records / R-round audit-history sections describing the historical phrasing that was retired  
   * The retention-class metadata token `pseudonymized_indefinite_retention_pending_anonymization_review` (the class name itself contains the word "anonymization" intentionally — that is the canonical class identifier)  
2. **Doc 05D §10.4 premature-resolution claim:** P31 hard-fails if any line in 07E describes Doc 05D §10.4 as "resolved" / "RESOLVED by 07E lock" / "07E V1.0 lock IS the resolution" / "formal resolution at 07E V1.0 lock" / equivalent without the conditional caveat (W7 \+ W9 closure required). The allowed phrasings are:

   * "07E V1.0 defines the proposed compliance posture"  
   * "proposed compliance posture declaration"  
   * "formal resolution requires W7 \+ W9 closure"  
   * "CONDITIONAL resolution pending W7 \+ W9"  
   * "Doc 05D §10.4 is RESOLVED" used ONLY in the §8.4 "Post-W7-and-W9-closure state (target state)" block, never in launch-state descriptions  
   * Meta references in cleanup register / change records describing the historical phrasing  
3. **Under-13 PostHog deletion canonical path mislabel:** P31 hard-fails if any line in 07E describes the canonical V1 under-13 PostHog deletion path as `posthog.deletePerson(...)` / `PostHog deletePerson API` / `deletePerson?delete_events=true` (these are non-canonical paths per RB-07E-R2-03). The canonical V1 phrasing is:

   * `PostHog bulk_delete with distinct_ids + delete_events=true + delete_recordings=true`  
   * `POST /api/projects/<project_id>/persons/bulk_delete`  
   * The single-person UUID-lookup DELETE path is allowed ONLY when explicitly framed as "non-canonical optional pending integration proof"  
   * Meta references in cleanup register / change records describing the historical phrasing

**Pass implementation:** P31 is a grep-based audit pass executable via `/tmp/audit_07E.py` (existing) with new P31 logic. The pass runs in CI on every commit that touches Doc 07E or downstream consumers (Doc 07 family \+ any doc that cites 07E §-anchors).

**Carve-outs (explicit):**

* The retention class name `pseudonymized_indefinite_retention_pending_anonymization_review` contains "anonymization" by design (it's the canonical class identifier per RB-07E-V1-02) — P31 does not flag occurrences of this exact token.  
* The W8 watch item ("EDPB post-SRB anonymization guidelines") references regulatory work product by its actual name — P31 does not flag this token.  
* The §10.6 \+ §12.5 ML-training-exclusion invariant references "the algorithmic-disgorgement defense" and "legal-anonymization bar" — P31 carves these out as definitional/legal-concept references.  
* Doc 05D internal vocabulary (`mastery_event_audit_log` \+ `gen_random_uuid()` surrogate \+ "one-way-anonymized retention") is allowed when explicitly cited as Doc 05D's locked vocabulary.

**Family expansion (V1.1+):** When Doc 07B / 07C / 07D draft, P31 expands its scope family-wide. The pass becomes the canonical vocabulary-consistency enforcer for the entire Doc 07 family. Doc 07 Parent in-lock-cycle additive may then formally adopt P31 as a Parent-declared pass (rather than 07E-introduced), with 07E remaining the implementation-site owner.

**Why P31 exists (RB-07E-R3-04 root-cause analysis):** R1 \+ R2 \+ R3 cleanup cycles each surfaced stale vocabulary that survived prior cleanup. Pre-delivery grep discipline (§13.5 item 3\) is the operational practice, but P31 codifies it as an executable audit pass that runs automatically. This addresses the systemic risk: vocabulary drift is the load-bearing failure mode for a doc whose legal precision matters.

---

# **§14 — Acceptance Criteria**

Doc 07E V1.0 is acceptable when all of the following hold:

1. **INV-07-03 (analytics retention policy registered) holds via `ci/analytics-retention-policy-registered`** — Doc 06D §9 `infra/retention-policy-registry.yaml` (post-`RB-06D-V1-19` bundled additive) contains `RPOL-ANALYTICS-01` (`canonical_owner_doc_and_section = 'Doc 07E V1.0 §5.1'`, `retention_horizon_months = 12` \+ `calendar_month_semantics: true` per RB-07E-V1-05, `purge_substrate = 'doc05d_cascade'`) \+ `RPOL-ANALYTICS-02` (`canonical_owner_doc_and_section = 'Doc 07E V1.0 §5.2'`, `classification: pseudonymized_personal_data` per RB-07E-V1-02, `retention_horizon_months = null` with `partial_provable_until = 'FWD-07E-V1.1-CARDINALITY-BUCKETING'`). **launch\_required: true** (hard-fail at V1).

2. **INV-07-04 (analytics cascade target declared) holds via `ci/analytics-cascade-target-declared`** — Doc 07E §7 declares the Layer-4 analytics-side cascade target body covering PostHog (V1, verified API contract per RB-07E-V1-03) and BigQuery (V1.1+); §10 declares under-13 hard-delete-everywhere age-stratified variant; §8 declares **proposed compliance posture pending W7+W9** per RB-07E-V1-01 (NOT formal resolution by 07E lock alone). **launch\_required: true** (hard-fail at V1).

3. **Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP — proposed compliance posture (RB-07E-V1-01)** (§8) is formal, cited (EDPS v SRB CJEU Sept 2025 \+ amended COPPA Rule 2026 16 CFR 312.10 \+ FTC AI-training-consent commentary), age-stratified (13+ pseudonymized-retention proposed; under-13 fallback hard-delete proposed), and explicit about **conditional resolution pending W7 (privacy policy publication) \+ W9 (legal counsel sign-off)**. Doc 05D §10.4 is NOT marked RESOLVED at 07E V1.0 lock — see RB-07E-V1-01 \+ W7 \+ W9.

4. **Two retention classes declared** (§5) — `personal_data_with_inactivity_expiry` \+ `pseudonymized_indefinite_retention_pending_anonymization_review` (RB-07E-V1-02 corrected: NOT `anonymized_indefinite_retention`) — with clear class boundaries, retention horizons, and trigger mechanisms.

5. **Under-13 hard-delete-everywhere variant** (§10) is fully bodied: detection-signal pathway (Doc 01 family ownership cited); cascade-mode-parameter shape (`W-07E-DOC05D-MODE-PARAM` registered in §15); **PostHog API contract VERIFIED (RB-07E-V1-03 \+ RB-07E-R2-03 \+ RB-07E-R4-04 corrections applied)** per §10.2 — **canonical V1 path is `POST /api/projects/<project_id>/persons/bulk_delete` with body `{distinct_ids: [analytics_user_id], delete_events: true, delete_recordings: true}` \+ scope `person:write` \+ expected HTTP 202 \+ verified bulk\_delete response schema. The single-person UUID-lookup DELETE path (`GET ... ?distinct_id=<id>` to resolve UUID, then `DELETE ... /persons/<person_uuid>?delete_events=true`) is documented ONLY as a non-canonical optional V1.1+ admin-tooling path pending integration proof — NOT a V1 canonical equivalent.** Canonical PostHog docs URLs `https://posthog.com/docs/privacy/data-storage` \+ `https://posthog.com/docs/api/persons-4` cited as vendor contract source-of-truth (verified 2026-05-26); BigQuery V1.1+ extension declared; **executable ML-training-exclusion invariant declared per §10.6 \+ §12.5 (RB-07E-V1-04)**.

6. **V1.1+ mechanisms declared shape only at V1** — `JOB-INACTIVITY-DETECTION` (§9.3 with hard 90-day-before-first-expiry activation deadline per RB-07E-V1-07), `JOB-POSTHOG-DELETION-VERIFICATION` (§9.4), `ci/historical-pii-conformance` (§12.3), `ops/inactivity-cascade-conformance` (§12.4 with hard 90-day deadline), `ci/ml-training-under13-exclusion` runtime activation (§12.5; V1-declared invariant) — all declared with activation triggers (hybrid per Q-07A-7=δ precedent), launch-required-shape-only-at-V1 framing, declared placeholders at V1.

7. **System-state archive registry** (§11) declares 3 V1-bodied entries (`SSA-MASTERY-CONSTANTS`, `SSA-SCORING-CONSTANTS`, `SSA-POSTHOG-EVENT-STREAM`) \+ 4 V1.1+ stubs (`SSA-LISA-PROMPT-TEMPLATES`, `SSA-BIGQUERY-AGGREGATES`, `SSA-PRACTICE-ENGINE-VERSIONS`, `SSA-EXAM-ENGINE-VERSIONS`, `SSA-TUTOR-ROUTER-VERSIONS`) per Q-07E-V2-2=γ comprehensive name-only stubs pattern.

8. **Four V1 owned mechanisms \+ one V1.1+-declared** (§12) — `ci/analytics-retention-policy-registered` (V1-active) \+ `ci/analytics-cascade-target-declared` (V1-active) \+ `ci/historical-pii-conformance` (V1.1+-placeholder) \+ `ci/ml-training-under13-exclusion` (V1-declared-invariant \+ V1.1+-runtime-active per RB-07E-V1-04) \+ `ops/inactivity-cascade-conformance` (V1.1+-declared with hard deadline per RB-07E-V1-07) — each with the six-element implemented-definition table per Parent §6.13.

9. **Decision 5 holds end-to-end** — no body in 07E restates a primitive owned by another doc. Doc 05D §10 cascade orchestration is referenced; not restated. Doc 06D §9 registry schema is consumed (with W-07E-DOC06D-REGISTRY additive extending it for calendar-month encoding \+ pseudonymized\_personal\_data classification); not restated. Doc 06D §11 privacy-incident mechanism is consumed; not restated. Doc 07A V1.0 §7.1 `analytics_user_id` HMAC algorithm is referenced; not restated. Doc 07A V1.0 §8.1 PII redaction split-enum contract is referenced; not restated. Doc 05D §10.2 retained modeling tuple is referenced verbatim by §-anchor; never re-enumerated. Doc 05D §10.3 `gen_random_uuid()` surrogate \+ irreversibility-by-construction is referenced; not restated. Doc 04B V4.3 `scoring_model_versions` is referenced; not restated. Doc 01 V8.1+ canonical user-activity-timestamp-field is referenced as FWD-07E-06 forward-ref; not picked or restated. Doc 10 privacy policy text is referenced as FWD-07E-05 forward-ref; not authored. PostHog deletion API is cited by canonical vendor docs URL (RB-07E-V1-03); not restated as SDK signature.

10. **Bundled cross-doc additives** are registered in §15 watch items: `W-07E-DOC06D-REGISTRY` (Doc 06D §9 entries population \+ schema extension for calendar-month encoding \+ pseudonymized\_personal\_data classification via `RB-06D-V1-19`); `W-07E-DOC05D-MODE-PARAM` (Doc 05D §10 cascade entry mode parameter via Doc 05D in-lock-cycle additive); `W-07E-PARENT-CASCADE-CLARIFY` (Doc 07 Parent §1 deliverable \#5 clarification via `RB-07-Parent-V1-08`); `W-07E-DOC06D-CGATES` (Doc 06D §10 compliance-gate registry CGATE-\* entries for §7.6 privacy-incident triggers); `W-07E-DOC01-ACTIVITY-FIELD` (Doc 01 V8.1+ canonical user-activity timestamp field declaration); `W-07E-DOC03-PROMPT-ARCHIVE` (Doc 03 family V1.1+ LISA prompt-template-version archive canonical declaration).

11. **Threat model defenses** (§3) cover the eight identified privacy \+ operational threats with explicit defenses citing § locations; threat 1 (anonymization-bar failure) explicitly acknowledges the pseudonymization-not-anonymization V1 posture per RB-07E-V1-02; threat 2 (algorithmic disgorgement) is now defended by §12.5 executable invariant per RB-07E-V1-04.

12. **31-pass audit suite passes clean** — all 25 carry-forward \+ 5 Doc 07 Parent extension passes (P26-P30) \+ 1 07E-introduced pass (P31 per RB-07E-R3-04) pass against 07E V1.0; P29 (07E implementation of retention-policy-cross-ref) \+ P30 (07E implementation of deletion-cascade-target-cross-ref) \+ P31 (vocabulary-consistency, 07E-introduced) implementation evidence is explicit per §13.1 \+ §13.2 \+ §13.6.

13. **No INV-07-09 violation** — 07E declares no Page/Warn/Info alerts at V1; all proving mechanisms are CI / deploy-gate / proof-artifact-only with PR-blocking or audit-failure surfaces; the V1.1+ mechanisms reserve alert routing per Doc 06C §7 standard registration but do not register V1 alerts.

14. **§8.7 no-PII rule** (per Doc 06D §8.7 family-wide canonical) is applied to all 07E proof-artifact shapes (§12 mechanisms) — no `analytics_user_id`, no event payload data, no user identifier of any form in proof artifacts; only field-name metadata \+ counts \+ decisions.

15. **Privacy policy disclosure obligation** is declared (§8.3) with the 7-element disclosure-shape specification, registered as §15 W7 V1 launch gate watch item (Doc 10 / legal counsel authors the text; 07E does not author). **Disclosure MUST use "pseudonymized" language per RB-07E-V1-02 corrected legal posture** — NOT "anonymized" — until W5 \+ W9 closure potentially upgrades the legal status.

16. **V1 vs V1.1+ split is explicit and consistent** — every mechanism declares `launch_required: bool`; every `launch_required: false` mechanism declares a V1.1+ activation trigger AND hard activation deadline where applicable (per RB-07E-V1-07: inactivity-detection has a 90-day-before-first-expiry deadline); the §4 launch-vs-target framing is honored throughout.

17. **Compliance citations are verified externally** — EDPS v SRB (Case C-413/23 P, 4 Sept 2025), amended COPPA Rule (16 CFR 312.10, effective 2025-06-23, compliance deadline 2026-04-22 — now in full force as of working date 2026-05-26 per Federal Register publication), EDPB 01/2025 pseudonymization guidelines (in development), Kurbo/WW \+ Edmodo FTC settlement precedents, India DPDP 2023 \+ Rules 2025, Brazil ECA Digital (Law 15,211/2025, effective 17 March 2026), PostHog Persons API \+ Bulk Delete \+ Deletion Status endpoint contract (RB-07E-V1-03 verified per `https://posthog.com/docs/privacy/data-storage` 2026-05-26 fetch) — verified via web search during pre-draft research turn \+ R1 cleanup verification turn.

18. **No item in Doc 07E contradicts** Doc 07 Parent V1.0, Doc 07A V1.0, Doc 05D V1.0, Doc 06D V1.0, or any other locked sibling — verified by the end-to-end cross-doc audit sweep (audit P9 \+ P10 \+ P12 \+ P15 \+ P17 \+ P19 carry-forward passes).

19. **Pre-07E-lock dependency: Doc 06D §9 schema extension APPLIED (RB-07E-R2-05; satisfied per CR-07E-09)** — Doc 06D V1.0 in-lock-cycle additive `RB-06D-V1-19` Stage 1 (schema extension to accept `retention_horizon_months` \+ `calendar_month_semantics: true` \+ `pseudonymized_personal_data` classification) is APPLIED as of 2026-05-26 (Doc 06D CR-06D-06). The `RPOL-ANALYTICS-01` \+ `RPOL-ANALYTICS-02` entry definitions in 07E §6 reference these schema features; with the schema extension in place, `ci/retention-policy-registry-parity` accepts them. **This was the only pre-07E-lock dependency** and it is now satisfied — all other bundled additives (W-07E-DOC05D-MODE-PARAM, W-07E-PARENT-CASCADE-CLARIFY, W-07E-DOC06D-CGATES, W-07E-DOC01-ACTIVITY-FIELD, W-07E-DOC03-PROMPT-ARCHIVE, plus Stage 2 of W-07E-DOC06D-REGISTRY) remain post-lock pattern.

20. **Vocabulary consistency (RB-07E-R2-02)** — "pseudonymized" is used throughout 07E for V1 retained event data; "potentially anonymized" only for the post-W5-W9 target-state legal status; "hard-deleted, never pseudonymized-retained" for under-13; "non-user system-state archive" for Lyceon-authored artifacts with no user data. No mixed "anonymized"/"pseudonymized" language for the same surface in the same context. Audit P31 (new — see §13 audit profile extension below) enforces vocabulary consistency.

21. **PostHog deletion canonical path (RB-07E-R2-03)** — Under-13 PostHog deletion at V1 uses the bulk\_delete endpoint by `distinct_ids` (not the single-person UUID-lookup path). Single-person UUID-lookup is documented as a non-canonical optional path pending integration proof. The bulk\_delete endpoint is verified per `https://posthog.com/docs/api/persons-4` accessed 2026-05-26.

22. **Under-13 deletion-proof metadata scope (RB-07E-R2-06)** — Under-13 cascade hard-deletes user-event/analytics/mastery/tutor/training data; minimal non-PII deletion-proof metadata (cascade audit entry; ML-training-exclusion ancestry registry entry) is permitted subject to Doc 06D §8.7 no-PII proof-artifact rules. The earlier "no retained data of any kind" framing is corrected.

---

# **§15 — Cross-Doc Seam Table & Watch Items**

## **15.1 Cross-doc seam table (grounded by exact §)**

| Seam | 07E side | Canonical owner \+ exact § | Reconciliation status |
| ----- | ----- | ----- | ----- |
| Retention policy registry substrate | §6 entries `RPOL-ANALYTICS-01` \+ `RPOL-ANALYTICS-02` | Doc 06D V1.0 §9.1 schema; §9.3 \+ §9.4 mechanisms | **RESOLVED (Stage 1\) — schema extension APPLIED per Doc 06D RB-06D-V1-19 / CR-06D-06** (the pre-07E-lock dependency per RB-07E-R2-05 is satisfied); Stage 2 entries population is the post-07E-lock additive owned by this lock event |
| Deletion-cascade base orchestration | §7 Layer-4 analytics body | Doc 05D V1.0 §10 — referenced, not restated | RESOLVED — body delivered in §7 |
| Privacy-compliance gate on pseudonymized retention | §8 proposed compliance posture declaration | Doc 05D V1.0 §10.4 BLOCKING\_PRIVACY\_GAP | CONDITIONAL — 07E V1.0 lock defines the proposed posture; formal RESOLUTION requires W7 \+ W9 closure post-lock (per RB-07E-V1-01) |
| Pseudonymization irreversibility-by-construction (PostHog side) | §7.3 structural pseudonymization via Supabase bridge severance | Doc 05D V1.0 §10.3 INV-05D-16 pattern extended (Doc 05D's internal vocabulary calls this "anonymization"; 07E classifies the resulting state as pseudonymized per RB-07E-V1-02 \+ RB-07E-R4-06 — engineering mechanism is identical) | RESOLVED — extends 05D's pattern to PostHog surface |
| Retained modeling tuple | §5.2 \+ §7.3 reference Doc 05D §10.2 step 11 | Doc 05D V1.0 §10.2 step 11 (`(difficulty, source_family, correct, position-or-ordinal, occurred_at-as-relative-offset, domain, skill, section, outcome)`) | RESOLVED — referenced verbatim by anchor |
| Cascade mode parameter (pseudonymized-retention vs hard-delete fallback) | §10.3 specifies parameter shape for under-13 cascade variant | Doc 05D V1.0 §10 cascade orchestration receives the parameter | OPEN — bounded (W-07E-DOC05D-MODE-PARAM); Doc 05D in-lock-cycle additive owed. Naming note per RB-07E-R3-02: enum value `pseudonymized_retention` (07E-consistent vocabulary; Doc 05D's internal vocabulary uses "anonymized" — see W-07E-DOC05D-MODE-PARAM in §15.3 for the vocabulary-alignment note). |
| 7-day soft-delete envelope | §7.5 references | Doc 01 V6.0 §19 \+ Doc 05D V1.0 §10.1 | RESOLVED — consumer |
| Supabase canonical user-activity timestamp field | §9.1 references "the field declared canonical by Doc 01" | Doc 01 V8.1+ — FWD-07E-06 forward-ref | OPEN — bounded (W-07E-DOC01-ACTIVITY-FIELD); Doc 01 V8.1+ to declare |
| `analytics_user_id` HMAC opaque identifier | §7.3 cascade operates against this identifier | Doc 07A V1.0 §7.1 — referenced, not restated | RESOLVED — consumer |
| PII redaction contract (event-time half) | §12.3 declares warehouse-side V1.1+ joint half | Doc 07A V1.0 §8 \+ §11.2 — referenced | RESOLVED — joint mechanism with V1.1+ warehouse extension |
| PostHog `bulk_delete` API by `distinct_ids` with `delete_events=true` \+ `delete_recordings=true` parameters | §10.2 under-13 cascade canonical V1 path per RB-07E-R2-03 \+ RB-07E-R3-03 (single-person UUID-lookup DELETE path is non-canonical optional pending integration proof) | Doc 07A V1.0 §9.3 SDK paths \+ verified PostHog docs `https://posthog.com/docs/privacy/data-storage` \+ `https://posthog.com/docs/api/persons-4` | RESOLVED — V1-active for under-13; canonical path verified 2026-05-26 |
| Privacy-incident sub-class mechanism | §7.6 trigger conditions for analytics-surface failures | Doc 06D V1.0 §11.3 `attach_privacy_class_to_incident` RPC | RESOLVED — consumer |
| Compliance-gate registry references (CGATE-\*) | §7.6 trigger conditions cite | Doc 06D V1.0 §10 compliance-evidence-process | OPEN — bounded (W-07E-DOC06D-CGATES); Doc 06D §10 to populate |
| Doc 07 Parent §1 deliverable \#5 ("hits PostHog's delete-person API at launch") | §7 supersedes with age-stratified pattern | Doc 07 Parent V1.0 §1 — referenced, clarified | OPEN — bounded (W-07E-PARENT-CASCADE-CLARIFY); post-07E-LOCK Parent additive |
| `infra/event-schema-registry.yaml` (registry contract) | §12.3 historical-PII-conformance validates against | Doc 07A V1.0 §5 — referenced | RESOLVED — consumer |
| Mastery constants change log (system-state archive) | §11.3 SSA-MASTERY-CONSTANTS registry entry | Doc 05D V1.0 §5.2 — referenced | RESOLVED — V1-bodied archive index |
| Scoring constants archive (system-state archive) | §11.4 SSA-SCORING-CONSTANTS registry entry | Doc 04B V4.3 `scoring_model_versions` \+ `constants_snapshot` — referenced | RESOLVED — V1-bodied archive index |
| LISA prompt-template-version archive (system-state archive) | §11.5 SSA-LISA-PROMPT-TEMPLATES V1.1+ stub | Doc 03 family — pending declaration | OPEN — bounded (W-07E-DOC03-PROMPT-ARCHIVE); Doc 03 V1.1+ to declare archive canonical |
| Practice engine version archive | §11.6 SSA-PRACTICE-ENGINE-VERSIONS V1.1+ stub | Doc 02B — pending declaration | OPEN — bounded (W12); Doc 02 family V1.1+ |
| Exam engine version archive | §11.6 SSA-EXAM-ENGINE-VERSIONS V1.1+ stub | Doc 04 family — pending declaration beyond scoring constants | OPEN — bounded (W13); Doc 04 family V1.1+ |
| Tutor router version archive | §11.6 SSA-TUTOR-ROUTER-VERSIONS V1.1+ stub | Doc 03 family — pending declaration | OPEN — bounded (W14); Doc 03 family V1.1+ |
| LISA retention matrix | §11.8 excludes per Doc 03 Main §14.2 canonical | Doc 03 Main V1.1 §14.2 — referenced per project handoff record | OPEN — bounded (W1); Doc 03 Main V1.1 source-tree upload pending |
| Privacy policy disclosure text | §8.3 declares disclosure obligation | Doc 10 / legal counsel — FWD-07E-05 forward-ref | OPEN — bounded (W7); V1 launch gate |
| Scheduled-job heartbeat substrate (V1.1+ inactivity job) | §9.3 declares shape | Doc 06C V1.0 §8.3 — V1.1+ extension path | RESOLVED — V1.1+ extension path |
| Alert-registry registration (V1.1+ when alerts activate) | §12 mechanisms declare no V1 alerts per INV-07-09 | Doc 06C V1.0 §7 — V1.1+ extension path | RESOLVED — V1.1+ extension path |
| Incident lifecycle base | §7.6 consumes via Doc 06D §11 sidecar | Doc 06C V1.0 §10 — referenced via Doc 06D §11 | RESOLVED — consumer |
| Stripe customer record retention (financial 7-year) | §7.4 documents boundary | Doc 09 — FWD-07E-04 forward-ref | OPEN — bounded (V1.1+ Doc 09 territory) |
| FERPA-coupled retention for school-district partnerships | §15 W3 watch item | Doc 08 — FWD-07E-03 forward-ref | OPEN — bounded (W3); future Doc 08 B2B |
| Per-jurisdiction overrides (India DPDP / Brazil ECA / EU GDPR) | §15 W4 watch item | V1.1+ on international launch | OPEN — bounded (W4); V1.1+ FWD-07E-02 |
| Cardinality-aware bucketing | §15 W5 watch item; §6.2 `RPOL-ANALYTICS-02 partial_provable_until` token | V1.1+ pending legal counsel | OPEN — bounded (W5); V1.1+ build |
| EDPB post-SRB anonymization guidelines | §15 W8 watch item; §8.5 audit trail | EDPB — pending publication | OPEN — bounded (W8); external dependency |
| Legal counsel review of §8.2 resolution reasoning \+ §8.3 disclosure | §15 W9 V1 launch gate | Legal counsel | OPEN — bounded (W9); V1 launch gate |
| Algorithmic-disgorgement-prevention for under-13 | §15 W10 watch item; §10.6 ML training corpus carve-out | Lyceon ML pipeline (when applicable) | OPEN — bounded (W10); applies when ML training corpus is consumed |

## **15.2 Watch items (W1-W14)**

**W1 — Doc 03 Main V1.1 source tree** (non-blocking; carried family-wide from 06C/06D/06E/07-Parent/07A)

Doc 03 Main V1.1 is not present in this session's source tree. Citations to §11 (usage caps), §14.2 (retention matrix), §24 (LISA cost metrics) are per project handoff record. On Doc 03 Main V1.1 upload, 07E's §11.5 SSA-LISA-PROMPT-TEMPLATES \+ §11.8 LISA retention exclusion \+ cross-doc seam reconciliations gain parsed input to audit. Non-blocking.

**W2 — Doc 05D V1.0 upload** — RESOLVED

Doc 05D V1.0 was uploaded 2026-05-26 (this session, per Final-2=β pre-draft decision). All Doc 05D §-anchored citations in 07E are parsed-source citations, not project-handoff-record citations. Resolved.

**W3 — FERPA / Doc 08 B2B school-district partnerships (FWD-07E-03)**

FERPA "School Official Exception" enables EdTech vendors to process student data on behalf of schools. If Lyceon V1.1+ partners with school districts (Doc 08 Expansion territory), the 12-month-inactivity retention rule changes — the school owns the data \+ the school's retention policy governs (often longer than 12 months; some schools retain transcripts indefinitely). 07E V1 ships US-only D2C subscription model per project memory; FERPA-coupled retention is V1.1+ Doc 08 territory. Non-blocking at V1; future target state.

**W4 — Per-jurisdiction overrides (India DPDP / Brazil ECA / EU GDPR)**

When international launches activate per Doc 08 expansion sequence (US → UK → Canada → India/Brazil deferred per project memory), per-jurisdiction retention overrides may be needed:

* **India DPDP** (under-18 \= children; 3-year-post-last-interaction obligation — less strict than our 12 months → compatible; 48-hour pre-deletion notification → enforced by §9.2 V1.1+; ₹50 crore penalties per project memory research)  
* **Brazil ECA Digital** (in force 17 March 2026 per project memory; age-assurance for under-16 → Doc 01 family signup gate territory; processed lawfully under LGPD)  
* **EU GDPR** (post-EDPS v SRB EDPB guidelines pending per §3 threat 1 — may strengthen anonymization requirements beyond V1 design)

V1 ships US-only. V1.1+ on international launch activation. Non-blocking at V1; bounded forward-ref via FWD-07E-02.

**W5 — Cardinality-aware bucketing (V1.1+ pending legal counsel)**

Per §3 threat 1 \+ §6.2 `RPOL-ANALYTICS-02 partial_provable_until = 'FWD-07E-V1.1-CARDINALITY-BUCKETING'`: high-cardinality property combinations in retained pseudonymized event data (cohort \+ score \+ exam date, etc.) may enable contextual re-identification per the EDPS v SRB "reasonably likely means" test. V1.1+ work pending legal counsel review of bucketing depth — what cardinality is acceptable for which property combinations; whether jurisdiction-specific bucketing strategies are needed. W5 closure (combined with W9 counsel sign-off) is the path to potentially upgrade the retained data's legal status from pseudonymized to anonymized per RB-07E-V1-02 \+ RB-07E-R3-02 framing.

V1 ships with the spec-locked acknowledgment that this is V1.1+ pending; the `partial_provable_until` token in `RPOL-ANALYTICS-02` makes this honest in the retention policy registry.

**W6 — Archive registry staleness check (V1.1+ activation)**

Per §11.7: `ci/system-state-archive-registry-parity` placeholder mechanism. When archives change shape (new fields added; new versioned-artifact archives registered in other docs; existing archives deprecated), the 07E registry must update. V1.1+ activates the runtime check when warehouse export is live and the archive entries are actually populated to validate against.

V1 ships with the registry locked at the V1 entry set (3 V1-bodied \+ 4 V1.1+ stubs). Subsequent archive additions are bundled cross-doc additives by the archive-owning doc to 07E (similar pattern to W-07A-PARENT-ADDITIVE registered by 07A).

**W7 — Privacy policy disclosure text (Doc 10 / legal counsel V1 launch gate)**

Per §8.3: the privacy policy must disclose the 7 elements specified (personal data retention 12-month-inactivity; pseudonymized retention indefinite \+ ML training per RB-07E-V1-02 — pseudonymized is a personal-data safeguard, not legal anonymization at V1; W5 \+ W9 closure may upgrade legal status; 48-hour notification; under-13 strict deletion; system-state archives; user rights; jurisdictional addenda V1.1+). Doc 10 or legal counsel authors the text; 07E does not author.

**V1 launch gate.** Before Lyceon V1 launches, the privacy policy text MUST be drafted \+ reviewed by legal counsel \+ published. Non-launchable without it.

**W8 — EDPB post-SRB anonymization guidelines (pending publication)**

EDPB 01/2025 guidelines on pseudonymization were in development as of the working date; post-SRB EDPB guidance has not been fully published per the research turn. When published, 07E §8.2 resolution reasoning is reviewed for impact — if the published guidelines impose stronger anonymization requirements that 07E's design does not satisfy, 07E V1.1+ may need to add bucketing depth controls or additional anonymization steps.

V1 ships against the EDPS v SRB CJEU judgment as the legal basis; EDPB post-SRB guidelines are an external dependency that may require V1.1+ updates.

**W9 — Legal counsel review of §8.2 reasoning \+ §8.3 disclosure** (V1 launch gate, joint with W7)

Per §8.5 audit trail: 07E V1.0 lock is the **proposed-posture-declaration event** (per RB-07E-V1-01 \+ RB-07E-R3-01 — NOT the resolution event itself; the resolution event is W7 \+ W9 closure post-lock). The proposed-posture reasoning (EDPS v SRB CJEU basis for 13+ pseudonymized retention; Edmodo/Kurbo precedent \+ amended COPPA 16 CFR 312.10 for under-13 hard-delete) MUST be reviewed \+ confirmed by legal counsel before launch. If legal counsel rejects the reasoning, 07E V1.1+ amends the proposed posture.

**V1 launch gate.** Cannot launch without legal counsel sign-off.

**W10 — Algorithmic-disgorgement-prevention for under-13** (V1.1+ when ML training corpus is consumed)

Per §10.6: if any under-13 data was ever included in the ML training corpus and the under-13 cohort is later excluded from pseudonymized retention per §10, the ML models trained on that data must be retrained on a dataset excluding under-13 data. This is the algorithmic disgorgement defense per Edmodo/Kurbo FTC precedent. The §12.5 executable invariant `ci/ml-training-under13-exclusion` is the runtime enforcement; W10 is the V1.1+ retraining-protocol watch item that activates when an ML pipeline is built.

V1 ships before any ML training corpus is consumed (Doc 07B BigQuery aggregated store is V1.1+); the algorithmic disgorgement risk is bounded to the V1.1+ ML pipeline build. When ML training begins, this watch item activates — pipeline must filter out under-13 data \+ retain proof of compliance.

**W11 — Doc 03 Main V1.1 prompt-template-version archive canonical declaration** (Doc 03 V1.1+)

Per §11.5: SSA-LISA-PROMPT-TEMPLATES is a V1.1+ stub. When Doc 03 family V1.1+ declares the prompt-template-version archive canonical (specific table; timestamp field), 07E receives the declaration via bundled additive `W-07E-DOC03-PROMPT-ARCHIVE` — 07E registers the updated entry as V1.1+ in-lock-cycle additive (no version bump).

**W12-W14 — Per-engine version archive canonical declarations**

* **W12**: Doc 02B practice engine version archive (SSA-PRACTICE-ENGINE-VERSIONS V1.1+ stub)  
* **W13**: Doc 04 family exam engine version archive beyond scoring (SSA-EXAM-ENGINE-VERSIONS V1.1+ stub)  
* **W14**: Doc 03 family tutor router version archive (SSA-TUTOR-ROUTER-VERSIONS V1.1+ stub)

Each declared as V1.1+ stub at V1 lock; canonical declaration owed by the archive-owning doc at its V1.1+ when ready.

## **15.3 Bundled cross-doc additives owed by 07E**

These are work items 07E carries to other locked docs as in-lock-cycle additives. Pattern matches W-07A-PARENT-ADDITIVE from 07A V1.0 lock.

**`W-07E-DOC06D-REGISTRY` → Doc 06D V1.0 in-lock-cycle additive `RB-06D-V1-19` (pre-lock dependency per RB-07E-R2-05; entries population is post-lock)**

* **Two-stage action:**  
  * **Stage 1 — SCHEMA EXTENSION (pre-07E-lock dependency per RB-07E-R2-05):** Doc 06D V1.0 §9.1 schema MUST accept three new field shapes before 07E V1.0 can lock: (a) `retention_horizon_months` field \+ `calendar_month_semantics: true` field as an alternative encoding to the existing `retention_horizon_seconds` (per RB-07E-V1-05 calendar-month-arithmetic encoding); (b) `pseudonymized_personal_data` as a valid `classification` enum value (per RB-07E-V1-02 \+ RB-07E-R2-02 — pseudonymized data is still personal data with safeguards per EDPB guidance, not legally anonymized at V1; the existing `pii | identifier | content | operational | analytics` enum does not capture this category correctly). Doc 06D §9.3 `ci/retention-policy-registry-parity` is updated to accept either retention-horizon encoding \+ the new classification value. **This stage is a pre-lock dependency** because the V1 acceptance criteria for 07E require entries that use these schema features; without the schema extension, the registry would reject them at CI. Doc 06D's in-lock-cycle additive applies the schema extension; lock date holds.  
  * **Stage 2 — ENTRIES POPULATION (post-07E-lock, in standard additive pattern):** Add `RPOL-ANALYTICS-01` \+ `RPOL-ANALYTICS-02` entries to `infra/retention-policy-registry.yaml` per §6.1 \+ §6.2; remove the placeholder line at Doc 06D V1.0 §9.1 line 443 (`Doc 07 analytics — out_of_scope: true with out_of_scope_reason: 'pending Doc 07 (FWD-06-01)'`).  
* **Trigger:**  
  * Stage 1: **Pre-07E-lock** (RB-07E-R2-05) — Doc 06D in-lock-cycle additive applied before 07E V1.0 status transitions DRAFT → LOCKED. If Doc 06D rejects the schema extension, 07E V1.0 cannot lock and must amend.  
  * Stage 2: **Post-07E-lock** in standard additive pattern.  
* **Impact on Doc 06D:** in-lock-cycle additive across two stages; lock date holds across both.  
* **Why two-stage (RB-07E-R2-05 rationale):** SWE R2 correctly identified that requiring schema changes in a locked sibling registry creates a chicken-and-egg risk — 07E V1.0 acceptance criteria reference registry fields the existing schema may reject. The two-stage upgrade resolves this: schema is in place before 07E locks; entries land after 07E locks (standard pattern).

**`W-07E-DOC05D-MODE-PARAM` → Doc 05D V1.0 in-lock-cycle additive (RB-05D-V1-XX)**

* **Action:** Add `cascade_mode: 'pseudonymized_retention' | 'hard_delete_fallback'` parameter to Doc 05D §10 cascade entry function signature; default `'pseudonymized_retention'` for backward compatibility; under-13 callers pass `'hard_delete_fallback'`. **Note (RB-07E-R2-02):** Doc 05D V1.0 internally uses the word "anonymized" for its Layer-2 retention path (§10.2 line 855 \+ §10.3 \+ §10.4); 07E classifies the resulting state as **pseudonymized** (a personal-data safeguard per EDPB guidance, not legal anonymization at V1) per RB-07E-V1-02. The engineering mechanism is identical to Doc 05D's locked spec; only the legal-vocabulary label differs. The enum value uses the 07E-consistent `pseudonymized_retention` label since 07E owns this cross-doc seam; Doc 05D in-lock-cycle additive aligns its prose to reference 07E's vocabulary where applicable without changing its own engineering invariant names (INV-05D-15/-16 retain their current text).  
* **Trigger:** 07E V1.0 lock \+ Doc 01 family declares the under-13 detection signal canonical (Doc 01 V8.1+ for the `under_13_detected` profile flag).  
* **Impact on Doc 05D:** in-lock-cycle additive; lock date holds. Doc 05D §10.4 fallback mode is already specified; only the parameter shape is added \+ vocabulary alignment note.

**`W-07E-PARENT-CASCADE-CLARIFY` → Doc 07 Parent V1.0 in-lock-cycle additive `RB-07-Parent-V1-08`**

* **Action:** Clarify Doc 07 Parent V1.0 §1 deliverable \#5 ("hits PostHog's delete-person API at launch") — replace with age-stratified language: "for under-13 users, hits PostHog's bulk\_delete API at launch via `POST /api/projects/<project_id>/persons/bulk_delete` with `distinct_ids: [analytics_user_id]` \+ `delete_events: true` \+ `delete_recordings: true` (canonical V1 path per RB-07E-R2-03; single-person UUID-lookup path is non-canonical optional pending integration proof); for 13+ users, the analytics-side cascade is structural pseudonymization via Supabase user-row hard-delete (no PostHog API call) — pseudonymized is a safeguard within personal-data processing per EDPB guidance, not legal anonymization at V1 per RB-07E-V1-02; both modes specified in Doc 07E §7 \+ §10."  
* **Trigger:** 07E V1.0 lock.  
* **Impact on Doc 07 Parent:** in-lock-cycle additive; lock date holds.

**`W-07E-DOC06D-CGATES` → Doc 06D V1.0 in-lock-cycle additive (RB-06D-V1-XX)**

* **Action:** Populate Doc 06D §10 compliance-evidence-process compliance-gate registry with the CGATE-\* IDs that 07E §7.6 trigger conditions reference (`CGATE-COPPA-RETENTION`, `CGATE-DPDP-DELETION`, `CGATE-GDPR-ANONYMIZATION`, `CGATE-EDPS-V-SRB-PRECEDENT`, `CGATE-GDPR-CONFIDENTIALITY`, `CGATE-CCPA-SECURITY`, `CGATE-GDPR-DATA-MINIMIZATION`, `CGATE-COPPA-PII`).  
* **Trigger:** 07E V1.0 lock.  
* **Impact on Doc 06D:** in-lock-cycle additive; lock date holds. Adds entries to existing registry; doesn't change schema.

**`W-07E-DOC01-ACTIVITY-FIELD` → Doc 01 V8.1+ amendment**

* **Action:** Doc 01 V8.1+ declares the canonical Supabase user-activity timestamp field name (per FWD-07E-06).  
* **Trigger:** Doc 01 V8.1+ readiness (independent of 07E V1.0 lock).  
* **Impact on Doc 01:** V8.1+ amendment; not in-lock-cycle (Doc 01 V8 is the current public version per project memory).  
* **Impact on 07E:** at Doc 01 V8.1+ ship, 07E V1.1+ retroactively aligns the field reference (in-lock-cycle additive, no version bump).

**`W-07E-DOC03-PROMPT-ARCHIVE` → Doc 03 family V1.1+ amendment**

* **Action:** Doc 03 family V1.1+ declares the LISA prompt-template-version archive canonical (specific table location \+ timestamp field schema).  
* **Trigger:** Doc 03 family V1.1+ readiness.  
* **Impact on 07E:** at Doc 03 V1.1+ ship, 07E updates SSA-LISA-PROMPT-TEMPLATES from V1.1+ stub to V1.1+-bodied (in-lock-cycle additive in 07E V1.X, no version bump if minor).

## **15.4 Outstanding cross-doc obligations inherited (non-07E)**

These are obligations from prior locks that 07E inherits in-context but does not own:

* `RB-06C-V1-16` (carried forward from Doc 06C, non-blocking per project memory)  
* `W-07-PostHog-BQ` (RB-06E-V1-15 \+ RB-06E-V1-16 to Doc 06E — PostHog Tier-1 launch-required \+ BigQuery Tier-1 target-state vendor additions per Doc 07 Parent §8 cross-doc seam table; gates 07E §11.6 SSA-BIGQUERY-AGGREGATES V1.1+ activation and §12.3 `ci/historical-pii-conformance` V1.1+ activation)  
* `W-07A-PARENT-ADDITIVE` (RB-07-Parent-V1-07 to Doc 07 Parent — 8th cohort event class \+ KPI-ENG-11 per 07A V1.0 lock; 07E does not own this; carried for cross-doc visibility)

---

# **§16 — Cleanup Register \+ Closing**

## **16.1 Cleanup register**

| ID | Round | Severity | Issue | Resolution | Status |
| ----- | ----- | ----- | ----- | ----- | ----- |
| RB-07E-V1-01 | R1 | BLOCKER | §8 framed 07E V1.0 lock as the formal Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP resolution while also declaring W7 (privacy policy) \+ W9 (legal counsel) as V1 launch gates — internal contradiction; spec cannot self-certify legal compliance. | §8 retitled "Proposed Compliance Posture (Conditional Resolution Pending W7 \+ W9)". §8.2 reframed from "resolution declaration" to "proposed posture pending sign-off." §8.4 updated to show three states: pre-07E-lock / post-07E-lock (gate still gated) / post-W7+W9 (gate RESOLVED). Acceptance criteria \#3 updated to require W7+W9 before claiming resolution. | Applied 2026-05-26 |
| RB-07E-V1-02 | R1 | BLOCKER | §5.2 and §6.2 named retention class 2 `anonymized_indefinite_retention` and described it as legally anonymized. SWE R1 review correctly identified that EDPS v SRB CJEU does NOT grant automatic anonymization status; EDPB pseudonymization guidance treats pseudonymization as a safeguard within personal-data processing. "Anonymized" was an overclaim. | Class 2 renamed `pseudonymized_indefinite_retention_pending_anonymization_review`. §5.2 fully rewritten to reflect pseudonymization (a safeguard), not anonymization (legal release from data-protection law). RPOL-ANALYTICS-02 classification changed from `analytics` to `pseudonymized_personal_data`. §8.3 privacy policy disclosure shape updated to use "pseudonymized" language. §10 under-13 path retains hard-delete-everywhere (no pseudonymization for under-13). Vocabulary corrected across §5, §6, §8, §10, §11, §14. | Applied 2026-05-26 |
| RB-07E-V1-03 | R1 | BLOCKER | §10.2 specified PostHog Node SDK call `posthog.deletePerson({distinctId: analytics_user_id, deleteEvents: true})` which SWE R1 review could not verify from current PostHog docs. The actual contract is the HTTP DELETE Persons API with `?delete_events=true` query parameter (requires UUID lookup first) OR the bulk\_delete POST endpoint accepting distinct\_ids. | §10.2 rewritten with verified PostHog API contract: (a) GET `/api/projects/<project_id>/persons?distinct_id=<id>` to resolve `person_uuid`; (b) DELETE `/api/projects/<project_id>/persons/<person_uuid>?delete_events=true` with `Authorization: Bearer <PERSON_WRITE_PERSONAL_API_KEY>`; (c) alternative bulk\_delete POST endpoint accepting distinct\_ids; (d) async deletion-status verification endpoint `GET /api/projects/<project_id>/persons/deletion_status?status=pending`. Canonical PostHog docs URL `https://posthog.com/docs/privacy/data-storage` cited as vendor contract source-of-truth (verified 2026-05-26). Operational caveat re: "avoid reusing deleted distinct IDs" documented. | Applied 2026-05-26 |
| RB-07E-V1-04 | R1 | BLOCKER | §10.6 declared under-13 ML-training-exclusion as policy only, not runtime-enforced invariant. SWE R1 review correctly identified that FTC algorithmic-disgorgement enforcement (Edmodo/Kurbo) penalizes prose-only commitments. | §10.6 rewritten with executable invariant: `ML_TRAINING_INPUTS MUST exclude any row whose source user was ever marked under_13_detected = true. ML_TRAINING_INPUTS MUST ALSO exclude any row whose age provenance is unknown.` Two-prong test (positive exclusion \+ unknown-provenance exclusion) declared. New §12.5 proving mechanism `ci/ml-training-under13-exclusion` added with six-element implemented-definition table; V1-declared invariant \+ V1.1+ runtime enforcement when ML pipeline activates. | Applied 2026-05-26 |
| RB-07E-V1-05 | R1 | HIGH | RPOL-ANALYTICS-01 used `retention_horizon_seconds = 31536000` claiming "12 × 30 × 24 × 3600 \= 12 months." Math wrong twice: 12×30×24×3600 \= 31,104,000 (not 31,536,000); 31,536,000 is 365 days. Encoding calendar-month retention as fixed seconds also produces month-length drift. | RPOL-ANALYTICS-01 retention encoding changed to `retention_horizon_months: 12` \+ `calendar_month_semantics: true`. Legacy `retention_horizon_seconds: null`. Cascade trigger uses PostgreSQL native `INTERVAL '12 months'` arithmetic (respects calendar months \+ leap years). Doc 06D §9 schema extension required (carried in W-07E-DOC06D-REGISTRY bundled additive). | Applied 2026-05-26 |
| RB-07E-V1-06 | R1 | HIGH | RPOL-ANALYTICS-02 marked `partial_provable_until: 'FWD-07E-V1.1-CARDINALITY-BUCKETING'` (honest partial-provable) but surrounding prose described indefinite anonymized retention as fully resolved/permissible — language inconsistency. | RPOL-ANALYTICS-02 prose throughout §5.2 \+ §6.2 \+ §8 aligned to partial-provable framing. Class is "pseudonymized at V1; may upgrade to anonymized after W5 \+ W9 closure" — consistent terminology. Privacy policy disclosure (§8.3) uses "pseudonymized" language. | Applied 2026-05-26 |
| RB-07E-V1-07 | R1 | HIGH | §9.3 `JOB-INACTIVITY-DETECTION` V1.1+ deferral was open-ended; no hard deadline tied to first user expiration. | §9.3 \+ §12.4 hard activation deadline added: "no later than 90 days before the earliest possible 12-month inactivity expiration (computed as: earliest Supabase user\_row creation timestamp \+ 12 months − 90 days)." For May-2026 launch, approximately 2027-02-26. Beyond-deadline failure framed as deceptive-practice exposure under FTC Section 5 (privacy policy publishes 12-month claim; failure to enforce is non-compliance). | Applied 2026-05-26 |
| RB-07E-R2-01 | R2 | BLOCKER | After R1 cleanup, "07E lock resolves Doc 05D §10.4" language still appeared in §1 purpose, §4 launch-required, §8.5 audit-trail, §15 seam table, §16 closing, and CR-07E-02 change record. R1 fixed §8 but didn't propagate the reframe to other sections. Internal contradiction with the conditional-compliance framing. | Full vocabulary sweep applied: §1 purpose obligation \#3 reframed to conditional; §4 launch-required reframed; §8.5 retitled "Audit trail of the proposed posture \+ future resolution"; §15 seam table marked CONDITIONAL with explicit W7+W9 requirement; §16 closing reframed; CR-07E-02 corrected. Doc 05D §10.4 is now consistently described as "conditional pending W7 \+ W9" throughout. | Applied 2026-05-26 |
| RB-07E-R2-02 | R2 | BLOCKER | After R1 cleanup, "anonymized" adjective language still appeared in §1 fundamental design ("in anonymized form"), §3 threat 5 ("anonymized at fact"), §5.3 ("once anonymized"), §5.4 ("anonymized at fact"), §7.3 ("structurally anonymized at fact"), §11.6 PostHog archive notes, §16 closing ("keep forever in anonymized form"). R1 fixed §5.2 \+ §6.2 but didn't propagate consistent pseudonymization vocabulary across the rest. Mixed vocabulary creates audit confusion \+ privacy-policy mismatch. | Full vocabulary sweep applied across §1, §3, §5.3, §5.4, §7.3, §11.6, §16. Consistent rule: V1 retained event stream → "pseudonymized"; target state after W5+W9 → "potentially anonymized"; under-13 → "hard-deleted, never pseudonymized-retained"; Lyceon system-state artifacts → "non-user system-state archive". Each replacement carries inline cite to §5.2 \+ RB-07E-V1-02 for context. Audit P31 added to enforce vocabulary consistency. | Applied 2026-05-26 |
| RB-07E-R2-03 | R2 | BLOCKER | §10.2 step 2 specified the single-person UUID-lookup DELETE path as primary, with bulk\_delete as alternative. SWE R2 correctly flagged that the UUID-lookup path adds a failure-mode surface (UUID resolution can fail or return ambiguous results) that bulk\_delete by distinct\_id avoids — child-data deletion should not depend on an endpoint path not proven end-to-end. | §10.2 step 2 rewritten with bulk\_delete by `distinct_ids` as canonical V1 path: `POST /api/projects/<project_id>/persons/bulk_delete` body `{distinct_ids: [analytics_user_id], delete_events: true, delete_recordings: true}` \+ scope `person:write` \+ expected HTTP 202 \+ verified bulk\_delete response schema. Single-person UUID-lookup path demoted to "optional pending integration proof — NOT V1 canonical." `delete_recordings: true` added defensively. Vendor source-of-truth URL `https://posthog.com/docs/api/persons-4` cited. W-07E-PARENT-CASCADE-CLARIFY updated to use canonical bulk\_delete language. | Applied 2026-05-26 |
| RB-07E-R2-04 | R2 | HIGH | Header dependency paragraph still said "Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP is the privacy/compliance gate 07E V1.0 resolves" — contradicts conditional-compliance framing established by RB-07E-V1-01. | Header dependency paragraph rewritten: "Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP is the privacy/compliance gate for which 07E V1.0 defines the proposed compliance posture — formal resolution requires W7 \+ W9 closure post-lock; until W7 \+ W9 close, Doc 05D fallback hard-delete mode remains active." Status line owners reframed to "Privacy/Compliance gate-keeper for §10.4 conditional resolution." | Applied 2026-05-26 |
| RB-07E-R2-05 | R2 | HIGH | W-07E-DOC06D-REGISTRY was post-lock additive; SWE R2 correctly identified that 07E V1 acceptance criteria require Doc 06D registry fields (retention\_horizon\_months, calendar\_month\_semantics, pseudonymized\_personal\_data classification) the existing schema may reject — chicken-and-egg risk. | W-07E-DOC06D-REGISTRY upgraded to two-stage: Stage 1 (schema extension) \= PRE-07E-LOCK dependency applied via Doc 06D in-lock-cycle additive `RB-06D-V1-19` Stage 1; Stage 2 (entries population) \= post-07E-lock additive (standard pattern). New §14 acceptance criterion \#19 explicitly declares the pre-lock dependency. §15 seam table updated to mark registry-substrate seam as CONDITIONAL with explicit Stage 1 / Stage 2 separation. | Applied 2026-05-26 |
| RB-07E-R2-06 | R2 | HIGH | §10.2 step 1 said "No retained data of any kind for under-13 users on the Lyceon side" — too broad; if Doc 05D cascade audit retains deletion-execution metadata or under-13 deletion proof artifacts retain non-PII metadata, "no retained data of any kind" is factually incorrect. | §10.2 step 1 rewritten: "No user-event, analytics, mastery, tutor, or training data from under-13 users is retained after the hard-delete cascade. Minimal non-PII deletion-proof metadata may be retained solely to prove deletion occurred, subject to Doc 06D §8.7 no-PII proof-artifact rules." New §14 acceptance criterion \#22 codifies the distinction. The corrected framing distinguishes user-data (forbidden) from deletion-proof metadata (permitted under §8.7 rules). | Applied 2026-05-26 |
| RB-07E-R3-01 | R3 | BLOCKER | After R2 cleanup, "resolution declaration" / "privacy/compliance gate resolution" / "BLOCKING\_PRIVACY\_GAP resolution" language still appeared in: Applies-to (L11), §1 enumeration (L47), §12.2 failure\_mode\_at\_V1 \+ proof\_artifact\_shape (L911-912), §13.2 P30 framing (L991), §15 W9 audit-trail line (L1161). R2 fixed §8 itself but missed cross-section vocabulary references. | Full vocabulary sweep applied: Applies-to \+ §1 enumeration reframed to "proposed compliance posture declaration"; §12.2 proof field renamed from `privacy_gate_resolution_check` to `privacy_gate_proposed_posture_check` with sub-fields renamed (`doc05d_10_4_resolved` → `doc05d_10_4_proposed_posture_declared` \+ new `formal_resolution_pending_w7_w9_acknowledged`); §13.2 P30 framing reframed; §15 W9 audit-trail line corrected. P31 vocabulary-consistency pass added (RB-07E-R3-04) to enforce this systematically. | Applied 2026-05-26 |
| RB-07E-R3-02 | R3 | BLOCKER | After R2 cleanup, "anonymized" compound noun vocabulary still appeared in: header FWD-07E-05 (L7 — Doc 10 forward-ref), bundled additives intro (L9 "keep-forever-anonymized retention"), Applies-to (L11 "default anonymized-retention path"), §3 threat 2 (L133 "with NO anonymized retention path"), §3 threat 6 (L141 "we retain anonymized records of platform interactions indefinitely"), §3 threat 7 (L143 "keep-forever-anonymized model"), §7.3 section header (L365 "default anonymized-retention path"), §9 inactivity-trigger (L524 "becomes anonymized after cascade"), §10 intro (L592 "default anonymized-retention path"), §10.3 (L671 "13+ users get anonymized-retention mode"), §15 seam table cascade-mode-parameter row (L1083), §15 W7 disclosure list (L1149 "anonymized retention indefinite"), §15 W9 audit-trail (L1161 "EDPS v SRB CJEU basis for 13+ anonymized retention"), §15 W10 ML retraining (L1167 "excluded from anonymized retention"). R2 grep covered specific identifiers but missed broader compound noun phrases. | Full vocabulary sweep applied across all 14 locations. Replacement rule (SWE-specified): V1 retained event data → "pseudonymized"; future legal-upgrade context → "potentially anonymized after W5 \+ W9 closure"; under-13 → "hard-deleted, never pseudonymized-retained"; system-state archives → "non-user system-state archive". Each replacement carries inline cite to RB-07E-V1-02 for context where load-bearing. Allowed contexts preserved: Doc 05D verbatim quotes (§7.1, §8.2), retention class identifier `pseudonymized_indefinite_retention_pending_anonymization_review`, "legal anonymization bar" definitional reference. | Applied 2026-05-26 |
| RB-07E-R3-03 | R3 | BLOCKER | After R2 cleanup, stale `deletePerson` references still appeared in: header bundled additives (L9 "deletePerson?delete\_events=true"), §7.3 (L370 "Do NOT call posthog.deletePerson(...)"), §7.6 idempotency (L430 "PostHog deletePerson?delete\_events=true is called" \+ L432 "PostHog API is idempotent on deletePerson"), §9.4 (L568 "posthog.deletePerson({distinctId, deleteEvents: true})"), §15 seam table (L1088 "PostHog deletePerson API"), §15 seam table (L1091 references to Doc 07 Parent "delete-person API" phrase preserved as historical Parent text). R2 fixed §10.2 itself but missed all the cross-section references. | Full vocabulary sweep applied: all 5 stale `deletePerson` references replaced with `bulk_delete` by `distinct_ids` canonical V1 phrasing. §7.6 idempotency claim "PostHog API is idempotent on deletePerson" REMOVED per SWE direction — replaced with Lyceon-side audit-record-idempotency framing ("Lyceon stores a deletion-request audit record \+ V1.1+ deletion-status check; implementation must NOT rely on undocumented vendor idempotency"). §15 seam table row updated to cite verified bulk\_delete contract \+ canonical PostHog docs URL. §15 L1091 (Doc 07 Parent §1 deliverable \#5 historical phrase "delete-person API") preserved as historical reference to the Parent text being amended by W-07E-PARENT-CASCADE-CLARIFY (per the additive Parent text is what's being clarified). | Applied 2026-05-26 |
| RB-07E-R3-04 | R3 | HIGH | Acceptance criterion \#20 (R2-added) claimed "Audit P31 added" and CR-07E-05 said P31 was added — but the visible §13 still described inherited 30-pass suite \+ P29/P30 implementation only. P31 was declared in cleanup register and acceptance criteria but never bodied in §13. Real defect: declaring a mechanism in cleanup tracking without writing the actual mechanism body. | New §13.6 added — "P31 — vocabulary-consistency pass (07E-introduced; RB-07E-R3-04)". P31 is the first 07E-introduced family-level audit pass (beyond inherited P26-P30 from Doc 07 Parent). Pass scope: 07E V1.0 doc \+ V1.1+ family-wide expansion. Three hard-fail conditions: (1) V1-retained-event-data described as "anonymized" outside allowed contexts; (2) Doc 05D §10.4 described as "resolved" without W7+W9 conditional caveat; (3) Under-13 PostHog deletion canonical path described as `deletePerson` instead of `bulk_delete`. Carve-outs explicit (Doc 05D verbatim quotes; retention class identifier; W8 EDPB anonymization-guidelines reference; legal-anonymization-bar definitional reference; meta references in cleanup register/change records). Pass implementation: `/tmp/audit_07E.py` extension. §13.3 \+ §13.4 updated to reflect 30 → 31 pass count. Acceptance criterion \#20 \+ \#23 updated. | Applied 2026-05-26 |
| RB-07E-R3-05 | R3 | HIGH | Header FWD-07E-05 forward-ref still said Doc 10 must disclose "12-month-inactivity → anonymized-retention model" — Doc 10 will likely copy this phrase directly, propagating the overclaim into the privacy policy. | Header FWD-07E-05 rewritten: "Doc 10 privacy-policy disclosure text (FWD-07E-05 — privacy policy must disclose the 12-month-inactivity → pseudonymized-retention model, with legal-anonymization upgrade only after W5 (cardinality bucketing) \+ W9 (legal counsel sign-off) closure per RB-07E-R3-05; Doc 10 owns the disclosure text; 07E declares the dependency)." This is the canonical phrasing Doc 10 should adopt. | Applied 2026-05-26 |
| RB-07E-R4-01 | R4 | BLOCKER | §2.1 ownership table row for Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP still said "resolution" — P31 rule 2 violation (premature-resolution claim without W7+W9 caveat); R3 swept §1/§4/§8/§12/§13/§15 but missed §2.1. | §2.1 row updated to "Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP proposed compliance posture (per RB-07E-V1-01 \+ RB-07E-R3-01 \+ RB-07E-R4-01 — 07E V1.0 lock declares the proposed posture; formal resolution requires W7 \+ W9 closure post-lock)." | Applied 2026-05-26 |
| RB-07E-R4-02 | R4 | BLOCKER | §5.4 still labelled post-cascade surviving events as class 2 \= "anonymized" — directly contradicted §5.2's correct "pseudonymized" framing per RB-07E-V1-02. (Initial R4 cleanup pass incorrectly marked this verified-clean during register population — but a re-verification grep confirmed the SWE was right: line 255 read "Post-cascade: surviving events are in class 2 (anonymized). System-state archives continue in class 2." This is a real P31 rule 1 violation in §5.4.) | §5.4 line corrected to: "Post-cascade: surviving events are in class 2 (pseudonymized at V1 per RB-07E-V1-02; potentially anonymized only after W5 \+ W9 closure per RB-07E-R3-02). System-state archives continue in class 2." Honest acknowledgment: my initial R4-02 register entry was wrong; the re-verification step caught it. This is the failure class P31 exists to enforce. | Applied 2026-05-26 |
| RB-07E-R4-03 | R4 | BLOCKER | §7.6 incident-class definitions \+ §15 W5 high-cardinality watch item still used "retained anonymized" vocabulary in three live-body locations: §7.6 unauthorized-access prose, §7.6 incident-class table rows ("Cardinality-aware re-identification confirmed against retained anonymized data" \+ "Unauthorized access to retained anonymized PostHog or BigQuery data"), §15 W5 ("high-cardinality property combinations in retained anonymized event data"). These are incident-class definitions \+ compliance-gate trigger templates that implementation teams may copy into dashboards / CGATE IDs / incident templates — vocabulary drift propagates into production artifacts. | All four locations updated to "retained pseudonymized" with inline cite to RB-07E-V1-02 \+ RB-07E-R3-02 framing where load-bearing. §15 W5 also clarifies "W5 closure (combined with W9 counsel sign-off) is the path to potentially upgrade the retained data's legal status from pseudonymized to anonymized." | Applied 2026-05-26 |
| RB-07E-R4-04 | R4 | BLOCKER | §14 AC \#5 still allowed the non-canonical single-person UUID-lookup DELETE path with `OR` connector, reintroducing ambiguity that R2 cleanup explicitly removed at the §10.2 spec body level. | §14 AC \#5 rewritten: canonical V1 path is **only** `POST /api/projects/<project_id>/persons/bulk_delete` with `distinct_ids` \+ `delete_events: true` \+ `delete_recordings: true`; single-person UUID lookup/delete is "documented ONLY as a non-canonical optional V1.1+ admin-tooling path pending integration proof — NOT a V1 canonical equivalent." `OR` connector removed. Both verified PostHog docs URLs cited. | Applied 2026-05-26 |
| RB-07E-R4-05 | R4 | HIGH | Audit pass count inconsistent — header/§13 say "31-pass suite" but §2 \+ §4 launch-required \+ §13 intro \+ §14 AC \#12 \+ §16 closing still said "30-pass." | All forward-looking pass-count references updated to 31 with explicit "30 inherited from Parent \+ P31 introduced by 07E per RB-07E-R3-04" framing. Historical CR records at R1/R2 time (CR-07E-04 \+ CR-07E-05) preserved as historical records describing what was true at the time of those rounds. | Applied 2026-05-26 |
| RB-07E-R4-06 | R4 | HIGH | §15 seam table row for irreversibility-by-construction (PostHog side) still said "Anonymization" \+ "structural anonymization via Supabase bridge severance" — P31 rule 1 violation in a cross-doc seam definition. | Row updated to "Pseudonymization irreversibility-by-construction (PostHog side)" \+ "structural pseudonymization via Supabase bridge severance" with explicit cite to Doc 05D's internal vocabulary use of "anonymization" (engineering mechanism identical; only legal label differs per RB-07E-V1-02 \+ RB-07E-R4-06). | Applied 2026-05-26 |
| RB-07E-R5-01 | R5 | BLOCKER | §3 threat 3 live-body said PostHog `$last_seen_at` "is analytics-side and getting anonymized, so it's the wrong signal" — P31 rule 1 violation: describing a live analytics-side surface as "getting anonymized" at V1. | §3 threat 3 corrected: "PostHog `$last_seen_at` is analytics-side and becomes pseudonymized after cascade per RB-07E-V1-02, so it is the wrong signal." | Applied 2026-05-26 |
| RB-07E-R5-02 | R5 | BLOCKER | §9.2 notification template "what data will be deleted vs anonymized-and-retained" — P31 rule 1 violation in template guidance. If copied into Doc 10 or product copy, reintroduces the legal overclaim. | §9.2 template requirement (d) corrected to "what data will be deleted vs pseudonymized-and-retained (matching the privacy policy disclosure per §8.3 using pseudonymized vocabulary per RB-07E-V1-02 \+ RB-07E-R5-02)." | Applied 2026-05-26 |
| RB-07E-R5-03 | R5 | BLOCKER | §10.6 section header \+ opening sentence used "anonymized-retention" / "one-way-anonymized retention" — P31 rule 1 violation in a section heading \+ opening (high-visibility surface). | §10.6 header renamed: "No pseudonymized-retention for under-13 — executable invariant (RB-07E-V1-04 \+ RB-07E-R5-03)." Opening sentence corrected: "Doc 07E V1.0 PROPOSES that pseudonymized retention of the modeling tuple is NOT permissible for under-13 users." Parenthetical added per SWE direction: "Doc 05D's locked vocabulary calls this 'one-way-anonymized retention'; 07E classifies it as pseudonymized at V1 per RB-07E-V1-02 — same engineering mechanism, different legal label." | Applied 2026-05-26 |
| RB-07E-R5-04 | R5 | HIGH | Multiple "Layer 2 anonymizes" / "Layer 2 anonymization" references in §2 Explicitly-excludes, §2.1 ownership table, §5.0 cascade outcome, §5.4 during-cascade bullet, §10.3 intro \+ mode label. P31 rule 1 violation; each location needed reframing per SWE direction to "Doc 05D's locked Layer 2 one-way transformation; 07E classifies the V1 state as pseudonymized." | All 6 locations rewritten per SWE direction: "Doc 05D's Layer 2 applies its locked one-way transformation; Doc 05D's internal vocabulary calls this 'Layer 2 anonymization'; 07E classifies the resulting V1 state as pseudonymized per RB-07E-V1-02 \+ RB-07E-R5-04 — engineering mechanism identical, legal label differs." §10.3 mode label renamed from "Anonymized-retention mode (default for 13+)" to "Pseudonymized-retention mode (default for 13+; what Doc 05D's locked vocabulary calls 'anonymized-retention mode' per RB-07E-V1-02 \+ RB-07E-R5-04 — engineering mechanism identical)." | Applied 2026-05-26 |
| RB-07E-R5-05 | R5 | P31 conformance | §3 threat 1 title used "Anonymized-retention claim fails legal anonymization bar" and §12.4 proof\_artifact\_shape used field name `user_id_anonymized_for_artifact` — borderline P31 conformance issues caught by R5 comprehensive grep. Not SWE-flagged but applied proactively as part of comprehensive cleanup. | §3 threat 1 title rewritten to "Anonymization-overclaim risk: V1 retained data fails the legal-anonymization bar" with body clarifying the V1 defense is to NOT make the legal-anonymization claim. §12.4 field renamed `user_id_anonymized_for_artifact` → `user_id_redacted_for_artifact` ("redacted" is the precise operation name avoiding the anonymized/pseudonymized legal distinction). | Applied 2026-05-26 |

**Cleanup pattern:** in-lock-cycle (status remains DRAFT pending R2 verification; no version bump). Multi-round cleanup permitted per family precedent. Post-R1-cleanup, the doc is resubmitted for R2 review; clean R2 → status transitions DRAFT → LOCKED with 2026-05-26 lock date holding.

## **16.2 Closing summary**

Doc 07E V1.0 delivers the analytics-side retention, privacy, and deletion-cascade contracts that Doc 06D §9 retention registry \+ Doc 05D §10 deletion cascade reference as their analytics-layer resolution targets. The fundamental design — **keep forever in pseudonymized form** (a personal-data safeguard, not legal anonymization at V1 — see §5.2 \+ RB-07E-V1-02) **for ML training; user-identifying data has 12-month inactivity lifecycle; under-13 hard-delete-everywhere per COPPA strict; system-state archives indefinite as non-user system-state archives** — is locked through extensive pre-draft Q\&A across multiple Karl design overrides hardened against deep compliance research (EDPS v SRB CJEU Sept 2025; amended COPPA Rule 2026; FTC Edmodo/Kurbo enforcement precedent; India DPDP 2023+Rules 2025; Brazil ECA Digital effective March 17, 2026).

**Three V1 owned mechanisms** (`ci/analytics-retention-policy-registered`, `ci/analytics-cascade-target-declared`, `ci/historical-pii-conformance` placeholder) plus **one V1.1+ declared mechanism** (`ops/inactivity-cascade-conformance`).

**Two retention class entries** registered against Doc 06D §9 (`RPOL-ANALYTICS-01` \+ `RPOL-ANALYTICS-02`).

**Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP — proposed compliance posture** declared by 07E V1.0 lock for 13+ users (pseudonymized-retention proposed, conditional on W7 \+ W9 closure post-lock per RB-07E-V1-01) AND via the §10 fallback-hard-delete carve-out for under-13 (the under-13 carve-out applies independent of W7+W9 — COPPA-strict bar is not conditional on counsel sign-off). Formal RESOLUTION requires both external sign-offs to close post-lock.

**Seven system-state archive registry entries** — 3 V1-bodied (mastery constants, scoring constants, PostHog event stream) \+ 4 V1.1+ stubs (LISA prompt templates, BigQuery aggregates, practice/exam/tutor engine versions).

**Six bundled cross-doc additives** owed post-lock: `W-07E-DOC06D-REGISTRY`, `W-07E-DOC05D-MODE-PARAM`, `W-07E-PARENT-CASCADE-CLARIFY`, `W-07E-DOC06D-CGATES`, `W-07E-DOC01-ACTIVITY-FIELD`, `W-07E-DOC03-PROMPT-ARCHIVE`.

**Two V1 launch gates external to 07E:** privacy policy disclosure text (W7) \+ legal counsel review of §8.2 \+ §8.3 (W9). Both require external sign-off before V1 launch.

Decision 5 holds end-to-end. The 31-pass audit suite (30 inherited from Parent \+ P31 introduced by 07E per RB-07E-R3-04) passes against the V1.0 draft. The status transition from DRAFT to LOCKED occurs upon external SWE review \+ clean two-pass re-audit (per Doc 04C / Doc 07A V1.0 precedent).

---

# **Change Records**

## **CR-07E-01 — Doc establishment \+ pre-draft Q\&A locks**

* **Date:** 2026-05-26  
* **Author:** Claude (drafting) per Karl direction  
* **Summary:** Doc 07E V1.0 established per Doc 07 Parent V1.0 §5 family decomposition. Pre-draft Q\&A locked across multiple rounds with Karl's design overrides:  
  * Q-07E-1 \= keep-forever anonymized \+ 12-month inactivity for PII (Karl override of original 24-48 month range — historical Karl decision text; the legal vocabulary "anonymized" was later corrected to "pseudonymized" per RB-07E-V1-02 in R1 cleanup; the engineering decision is unchanged)  
  * Q-07E-V2-2 \= γ comprehensive name-only stubs for system-state archive registry  
  * Q-07E-V2-3 \= γ V1 ships mechanism \+ flags re-identification as watch item  
  * Q-07E-V3-1 \= γ hard-delete-everywhere for under-13  
  * Q-07E-V3-2 \= β V1-hard-locked-12mo, config-extensible V1.1+  
  * Q-07E-V3-3 \= γ revised to Supabase-only (Karl Final-5 override — PostHog analytics-side cannot be retention signal)  
  * Final-1 \= 12-month timer resets on Supabase activity confirmed  
  * Final-2 \= β read Doc 05D before drafting (Doc 05D uploaded 2026-05-26)  
  * Final-3 \= 07E does NOT pick Supabase field name (FWD-07E-06 to Doc 01 V8.1+)  
  * Final-4 \= α cascade immediate; Doc 05D §10 7-day soft-delete envelope remains at account level  
  * Final-5 \= Supabase-only activity signal (Karl override of dual-source lean)  
  * Final-6 \= FERPA as Doc 08 future target state per W3 watch item

## **CR-07E-02 — Doc 05D V1.0 reading \+ pre-draft grilling pass**

* **Date:** 2026-05-26  
* **Author:** Claude  
* **Summary:** Doc 05D V1.0 uploaded; §10 cascade orchestration \+ §10.3 irreversibility-by-construction \+ §10.4 BLOCKING\_PRIVACY\_GAP \+ §10.5 idempotency parsed in detail. Key findings: (a) Doc 05D §10 scopes to Lyceon-side only — PostHog/BigQuery surfaces explicitly handed to 07E; (b) Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP is the gate for which 07E V1.0 defines the proposed compliance posture (formal resolution conditional on W7 \+ W9 closure per RB-07E-V1-01); (c) Doc 05D §10.2 step 11 retained modeling tuple is `(difficulty, source_family, correct, position-or-ordinal, occurred_at-as-relative-offset, domain, skill, section, outcome)`; (d) Doc 05D §10 cascade has no inactivity-based trigger — that's a 07E V1.1+ addition; (e) Doc 05D §10.4 fallback mode (hard-delete event/audit too) is the canonical reference for the under-13 §10 hard-delete-everywhere variant. Pre-draft grilling pass identified six items (Pre-draft-1 through Pre-draft-3 \+ Final-1 through Final-6); all resolved cleanly with Karl confirmations.

## **CR-07E-03 — Initial draft submission for external SWE review**

* **Date:** 2026-05-26  
* **Author:** Claude  
* **Summary:** Initial draft of Doc 07E V1.0 written. 16 sections covering: §1 purpose; §2 scope; §3 threat model (8 threats); §4 launch-vs-target framing; §5 retention class taxonomy (2 classes); §6 Doc 06D §9 entries (2 entries); §7 cascade Layer-4 body (age-stratified); §8 BLOCKING\_PRIVACY\_GAP resolution declaration; §9 V1.1+ inactivity mechanism shape; §10 under-13 hard-delete-everywhere variant; §11 system-state archive registry (3 V1-bodied \+ 4 V1.1+ stubs); §12 V1 owned mechanisms (3 V1 \+ 1 V1.1+-declared); §13 audit profile (P29 \+ P30 implementation site); §14 acceptance criteria (18 items); §15 cross-doc seam \+ watch items (14 watches W1-W14 \+ 6 bundled additives \+ outstanding non-07E obligations); §16 cleanup register \+ closing. Draft submitted to Karl for external SWE review per spec-drafting workflow (Claude drafts → SWE reviews → in-lock-cycle cleanup → LOCK).

## **CR-07E-04 — R1 cleanup applied (SWE B-grade verdict resolved)**

* **Date:** 2026-05-26  
* **Author:** Claude per Karl direction following external SWE R1 review  
* **Summary:** External SWE R1 review returned verdict B-, no-ship-yet, with 4 BLOCKERs \+ 3 HIGHs. All 7 items applied in-lock-cycle as RB-07E-V1-01..07 (no version bump; status remains DRAFT pending R2). Key changes:  
  * **RB-07E-V1-01:** §8 reframed from "07E lock \= formal resolution" to "07E lock \= proposed compliance posture pending W7 \+ W9 sign-off." Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP is NOT marked RESOLVED by 07E V1.0 lock alone — it is RESOLVED only after legal counsel signs off on §8.2 reasoning AND Doc 10 privacy policy is published.  
  * **RB-07E-V1-02:** Retention class 2 renamed from `anonymized_indefinite_retention` to `pseudonymized_indefinite_retention_pending_anonymization_review`. Legal vocabulary throughout updated to use "pseudonymized" (a safeguard within personal-data processing per EDPB guidance) rather than "anonymized" (legal release from data-protection law) — until W5 \+ W9 closure potentially upgrade.  
  * **RB-07E-V1-03:** PostHog API contract verified via 2026-05-26 web fetch of `https://posthog.com/docs/privacy/data-storage`. Unverified SDK signature replaced with verified HTTP DELETE \+ bulk\_delete \+ deletion\_status endpoint contracts. Async-deletion caveat ("avoid reusing deleted distinct IDs") documented.  
  * **RB-07E-V1-04:** Executable invariant added: `ML_TRAINING_INPUTS MUST exclude any row whose source user was ever marked under_13_detected = true`. New §12.5 proving mechanism `ci/ml-training-under13-exclusion` declared. V1-declared invariant \+ V1.1+ runtime enforcement.  
  * **RB-07E-V1-05:** Retention horizon encoding corrected from `retention_horizon_seconds: 31536000` (legacy seconds-based, mathematically wrong for "12 30-day months", also drifts) to `retention_horizon_months: 12` \+ `calendar_month_semantics: true` (calendar-aware PostgreSQL interval arithmetic).  
  * **RB-07E-V1-06:** Prose throughout §5.2 \+ §6.2 \+ §8 aligned to partial-provable framing per RPOL-ANALYTICS-02's `partial_provable_until` token. Consistent pseudonymization language.  
  * **RB-07E-V1-07:** Hard activation deadline for V1.1+ inactivity-detection scheduled job added: 90 days before earliest possible user expiration (\~2027-02-26 for May-2026 launch). Beyond-deadline framed as deceptive-practice exposure.  
* **Audit:** 30-pass re-audit pending; expected clean.  
* **Status transition:** DRAFT (pending R2) → status transitions to LOCKED upon clean R2 \+ clean re-audit.

## **CR-07E-05 — R2 cleanup applied (SWE B+ verdict resolved)**

* **Date:** 2026-05-26  
* **Author:** Claude per Karl direction following external SWE R2 review  
* **Summary:** External SWE R2 review returned verdict B+, partial / no-ship-yet, with 3 BLOCKERs \+ 3 HIGHs. All 6 items applied in-lock-cycle as RB-07E-R2-01..06 (no version bump; status remains DRAFT pending R3). Key changes:  
  * **RB-07E-R2-01 (BLOCKER):** Stale "07E lock resolves Doc 05D §10.4" language swept from §1 purpose obligation \#3, §4 launch-required state, §8.5 audit-trail section title \+ body, §15 seam table, §16 closing, CR-07E-02 change record. Consistent conditional-compliance framing applied throughout.  
  * **RB-07E-R2-02 (BLOCKER):** Stale "anonymized" adjective vocabulary swept across §1 fundamental design, §3 threat 5, §5.3 simplification rationale, §5.4 class-boundary transition, §7.3 PostHog-side body \+ BigQuery V1.1+, §11.6 PostHog archive notes, §16 closing summary. Consistent rule applied: V1 retained data → "pseudonymized" with inline cite to §5.2 \+ RB-07E-V1-02. Audit P31 added.  
  * **RB-07E-R2-03 (BLOCKER):** PostHog deletion API canonical V1 path changed from single-person UUID-lookup DELETE (now demoted to "optional pending integration proof") to bulk\_delete by `distinct_ids` (no UUID lookup, lower failure-mode surface). `delete_recordings: true` added defensively. W-07E-PARENT-CASCADE-CLARIFY updated.  
  * **RB-07E-R2-04 (HIGH):** Header dependency paragraph for Doc 05D §10.4 reframed to conditional language matching RB-07E-V1-01.  
  * **RB-07E-R2-05 (HIGH):** W-07E-DOC06D-REGISTRY upgraded from post-lock additive to two-stage additive — Stage 1 (schema extension to accept `retention_horizon_months` \+ `calendar_month_semantics` \+ `pseudonymized_personal_data` classification) is **pre-07E-lock dependency**; Stage 2 (entries population) remains post-lock. New §14 acceptance criterion \#19.  
  * **RB-07E-R2-06 (HIGH):** §10.2 step 1 "No retained data of any kind for under-13" reframed to "No user-event/analytics/mastery/tutor/training data; minimal non-PII deletion-proof metadata may be retained subject to Doc 06D §8.7 no-PII rules." New §14 acceptance criterion \#22.  
* **Audit:** 30-pass re-audit pending (P31 vocabulary-consistency pass added — declared in §13 \+ acceptance criterion \#20; runtime check is the standard grep-for-old-vocabulary discipline applied pre-delivery).  
* **Status transition:** DRAFT (pending R3) → status transitions to LOCKED upon clean R3 \+ clean re-audit \+ Doc 06D in-lock-cycle additive `RB-06D-V1-19` Stage 1 schema extension applied (RB-07E-R2-05 pre-lock dependency).

## **CR-07E-06 — R3 cleanup applied (SWE B+ → A- verdict resolved)**

* **Date:** 2026-05-26  
* **Author:** Claude per Karl direction following external SWE R3 review  
* **Summary:** External SWE R3 review returned verdict B+ moving toward A-, partial / no-ship-yet, with 3 BLOCKERs \+ 2 HIGHs. All 5 items applied in-lock-cycle as RB-07E-R3-01..05 (no version bump; status remains DRAFT pending R4 review or LOCK). Key changes:  
  * **RB-07E-R3-01 (BLOCKER):** Stale "resolution declaration" / "privacy/compliance gate resolution" language swept from 6 cross-section locations missed by R2 (Applies-to, §1 enumeration, §12.2 failure\_mode \+ proof\_artifact\_shape with field rename `privacy_gate_resolution_check` → `privacy_gate_proposed_posture_check`, §13.2 P30 framing, §15 W9 audit trail). Consistent "proposed compliance posture declaration" framing applied; "resolution" allowed only with W7+W9 conditional caveat.  
  * **RB-07E-R3-02 (BLOCKER):** Stale "anonymized" compound noun vocabulary swept from 14 cross-section locations missed by R2 (header forward-ref, bundled additives intro, Applies-to, §3 threats 2/6/7, §7.3 header, §9 inactivity-trigger, §10 intro, §10.3, §15 seam-table \+ W7 \+ W9 \+ W10). Replacement rule applied per SWE direction.  
  * **RB-07E-R3-03 (BLOCKER):** Stale `deletePerson` references swept from 5 cross-section locations missed by R2 (header bundled additives, §7.3, §7.6 idempotency, §9.4, §15 seam table). §7.6 idempotency-claim "PostHog API is idempotent on deletePerson" REMOVED — replaced with Lyceon-side audit-record-idempotency framing per SWE direction ("implementation MUST NOT rely on undocumented vendor idempotency").  
  * **RB-07E-R3-04 (HIGH):** New §13.6 bodies the P31 vocabulary-consistency pass that R2 declared in cleanup register \+ acceptance criteria but never wrote the body for. P31 is the first 07E-introduced family-level audit pass; three hard-fail conditions cover the R3-01 \+ R3-02 \+ R3-03 failure classes systematically. §13.3 \+ §13.4 updated to reflect 30 → 31 pass count.  
  * **RB-07E-R3-05 (HIGH):** Header FWD-07E-05 Doc 10 forward-ref rewritten to use "12-month-inactivity → pseudonymized-retention model, with legal-anonymization upgrade only after W5 \+ W9" canonical phrasing — this is what Doc 10 should copy directly.  
* **Root-cause acknowledgment:** R1 \+ R2 \+ R3 cleanup cycles each surfaced stale vocabulary that survived prior cleanups. The systemic failure was incomplete grep coverage: I grepped for renamed identifiers (`anonymized_indefinite_retention`, `31536000`) but missed compound noun phrase variants (`anonymized-retention model`, `keep-forever-anonymized`, `becomes anonymized after cascade`). P31 codifies the discipline as an executable audit pass.  
* **Audit:** 31-pass re-audit pending (P31 runtime check pending audit script extension; pre-delivery grep discipline applied with full compound-noun coverage).  
* **Status transition:** DRAFT (pending R4 review or LOCK) → status transitions to LOCKED upon clean R4 \+ clean re-audit \+ Doc 06D in-lock-cycle additive `RB-06D-V1-19` Stage 1 schema extension applied (RB-07E-R2-05 pre-lock dependency).

## **CR-07E-07 — R4 cleanup applied (SWE A- verdict resolved)**

* **Date:** 2026-05-26  
* **Author:** Claude per Karl direction following external SWE R4 review  
* **Summary:** External SWE R4 review returned verdict A-, partial / no-ship-yet, with 4 BLOCKERs \+ 2 HIGHs. All 6 items applied in-lock-cycle as RB-07E-R4-01..06. Key changes:  
  * **RB-07E-R4-01 (BLOCKER):** §2.1 ownership table BLOCKING\_PRIVACY\_GAP row corrected from "resolution" to "proposed compliance posture" with W7+W9 caveat.  
  * **RB-07E-R4-02 (BLOCKER):** §5.4 post-cascade class-2 label corrected from "(anonymized)" to "(pseudonymized at V1; potentially anonymized only after W5 \+ W9 closure)". **Honest acknowledgment:** my initial R4 cleanup register entry incorrectly marked R4-02 as "verified clean" — the SWE was right; the §5.4 line had a real residual issue I missed on first pass. The re-verification grep caught it. The cleanup register entry has been corrected to reflect this honestly.  
  * **RB-07E-R4-03 (BLOCKER):** Four locations swept for "retained anonymized" → "retained pseudonymized" (§7.6 unauthorized-access prose, §7.6 incident-class table 2 rows, §15 W5 high-cardinality watch item). These are incident-class definitions \+ compliance-gate trigger templates — propagation risk into production artifacts. §15 W5 also clarifies the W5+W9-closure path to potential anonymization upgrade.  
  * **RB-07E-R4-04 (BLOCKER):** §14 AC \#5 rewritten — `OR` connector removed; canonical V1 path is **only** bulk\_delete; single-person UUID-lookup explicitly demoted to non-canonical optional V1.1+ admin-tooling pending integration proof.  
  * **RB-07E-R4-05 (HIGH):** Five forward-looking pass-count references updated from 30 → 31 (§2, §4 launch-required, §13 intro, §14 AC \#12, §16 closing). Historical CR-07E-04 \+ CR-07E-05 records preserved as time-of-round historical records.  
  * **RB-07E-R4-06 (HIGH):** §15 seam table irreversibility-by-construction row updated to "Pseudonymization" \+ "structural pseudonymization via Supabase bridge severance" with explicit Doc 05D-vocab cite.  
  * **P31 conformance tightening:** §7.3 \+ §8.4 Doc 05D D21 fixture references made explicit ("Doc 05D's locked fixture name"); §8.2 under-13 proposal phrase tightened ("what Doc 05D's internal vocabulary calls 'one-way-anonymized retention'"); CR-07E-03 historical Karl Q-07E-1 decision text annotated with "the legal vocabulary 'anonymized' was later corrected to 'pseudonymized' per RB-07E-V1-02."  
* **Root-cause acknowledgment (R1 → R2 → R3 → R4 pattern):** Four cleanup rounds, each finding more residual vocabulary drift. The systemic discipline failure is that I have been doing targeted greps focused on the SWE-specified phrases rather than comprehensive scans for ALL P31-violation-class patterns across the doc. **R4 cleanup adopted a different discipline:** before applying fixes, run a single comprehensive scan covering every variant of every P31 rule, categorize allowed-context vs violation, fix everything in one pass, then re-grep to verify. The R4-02 self-correction (where I initially marked the SWE's finding as verified-clean and the re-verification grep proved me wrong) is the lesson made concrete — and is the reason CR-07E-07 documents it openly rather than hiding it.  
* **Audit:** 31-pass re-audit run (30 inherited passes via /tmp/audit\_07E.py clean; P31 runtime check is the comprehensive grep run during this cleanup — clean against all three P31 rule categories outside allowed contexts).  
* **Status transition:** DRAFT (pending R5 review or LOCK-direct) → status transitions to LOCKED upon clean R5 (or LOCK-direct from SWE per R4 final-call trajectory) \+ clean re-audit \+ Doc 06D in-lock-cycle additive `RB-06D-V1-19` Stage 1 schema extension applied (RB-07E-R2-05 pre-lock dependency).

## **CR-07E-08 — R5 cleanup applied (SWE A- verdict; P31 vocabulary leaks resolved)**

* **Date:** 2026-05-26  
* **Author:** Claude per Karl direction following external SWE R5 review  
* **Summary:** External SWE R5 review returned verdict A-, partial / do-not-lock-yet, with 3 BLOCKERs \+ 1 HIGH — all P31 vocabulary-consistency violations the audit pass was supposed to catch automatically (R5 was effectively a manual P31 run by the SWE). All 4 SWE items applied \+ 1 proactive P31-conformance item (RB-07E-R5-05) applied in-lock-cycle as RB-07E-R5-01..05. Key changes:  
  * **RB-07E-R5-01 (BLOCKER):** §3 threat 3 PostHog `$last_seen_at` "getting anonymized" corrected to "becomes pseudonymized after cascade per RB-07E-V1-02."  
  * **RB-07E-R5-02 (BLOCKER):** §9.2 notification template guidance "anonymized-and-retained" corrected to "pseudonymized-and-retained" with explicit RB-07E-V1-02 cite — critical because §9.2 is template guidance that may be copied into Doc 10 or product copy.  
  * **RB-07E-R5-03 (BLOCKER):** §10.6 section header renamed from "No anonymized-retention for under-13" to "No pseudonymized-retention for under-13"; opening sentence reframed with Doc 05D-vocab parenthetical per SWE direction.  
  * **RB-07E-R5-04 (HIGH):** Six locations reframed from "Layer 2 anonymizes" / "Layer-2 anonymization" / "Anonymized-retention mode" to Doc 05D-vocab-cited equivalents (§2 Explicitly-excludes, §2.1 ownership table, §5.0 cascade outcome, §5.4 during-cascade bullet, §10.3 intro \+ mode label). Each location now reads "Doc 05D's Layer 2 applies its locked one-way transformation; Doc 05D's internal vocabulary calls this 'Layer 2 anonymization'; 07E classifies the V1 state as pseudonymized per RB-07E-V1-02 \+ RB-07E-R5-04 — engineering mechanism identical, legal label differs."  
  * **RB-07E-R5-05 (proactive P31 conformance):** §3 threat 1 title rewritten to "Anonymization-overclaim risk" with body clarifying the V1 defense is to NOT make the legal-anonymization claim. §12.4 proof\_artifact\_shape field `user_id_anonymized_for_artifact` renamed to `user_id_redacted_for_artifact` ("redacted" avoids the anonymized/pseudonymized legal distinction).  
* **Discipline shift this round (R1 → R2 → R3 → R4 → R5):** Five cleanup rounds. R5 cleanup adopted the SWE-prescribed exact discipline: grep the live body (everything before §16) for the four base patterns "anonymized", "anonymization", "anonymizes", "anonymized-retention", then categorize each hit as allowed-context vs P31 violation, fix all violations in one pass, then re-grep to verify only approved carve-outs remain. This is the discipline P31 codifies as a runtime audit pass; manual P31 runs caught residues that prior pattern-list greps missed because the prior greps focused on noun phrases and missed verb/gerund forms.  
* **Allowed carve-outs verified clean post-R5:** \~30 remaining "anonymized"-bearing lines in the live body all fall into explicit P31 carve-outs (verbatim Doc 05D quotes; RB-07E-V1-02 explanations; future legal-upgrade contexts with W5+W9 cite; identifier tokens like `pseudonymized_indefinite_retention_pending_anonymization_review`; regulatory work-product names like "EDPB post-SRB anonymization guidelines"; P31 carve-out rules themselves).  
* **Audit:** 31-pass re-audit run; 30 inherited passes via `/tmp/audit_07E.py` clean; P31 runtime check via the exact SWE-prescribed grep returned only carve-out-allowed hits.  
* **Status transition:** DRAFT (pending R6 review or LOCK-direct) → status transitions to LOCKED upon clean R6 (or LOCK-direct from SWE) \+ clean re-audit \+ Doc 06D in-lock-cycle additive `RB-06D-V1-19` Stage 1 schema extension applied (RB-07E-R2-05 pre-lock dependency).

## **CR-07E-09 — R6 LOCK-CONDITIONAL cleared; status → LOCKED**

* **Date:** 2026-05-26  
* **Author:** Claude per Karl direction following external SWE R6 review  
* **Summary:** External SWE R6 review returned verdict **LOCK-CONDITIONAL, grade A, "no further 07E rewrite required."** The R6 review confirmed all R5 findings fixed, P31 properly bodied \+ operationally useful, no live-body P31 blocker remaining, architecture lock-quality, compliance posture correctly conditional on W7 \+ W9. R6 gave a 4-item pre-lock checklist \+ 1 editorial note. All addressed:  
  * **R6 editorial note (stale header):** Header status updated from the stale "DRAFT pending R2 review" to LOCKED (it had never been advanced past R1 across R2–R5 cleanups — a real version-history-hygiene miss caught by R6).  
  * **R6 checklist item 1 (update stale header):** Done — header now reads LOCKED 2026-05-26 with the full R1–R5 \+ R6 lineage.  
  * **R6 checklist item 2 (apply Doc 06D RB-06D-V1-19 Stage 1):** Done — Doc 06D §9.1 schema extended for `retention_horizon_months` \+ `calendar_month_semantics` \+ `pseudonymized_personal_data` via Doc 06D CR-06D-06 / RB-06D-V1-19. **Tag-collision correction:** 07E had referenced the dependency as "RB-06D-V1-13", but that tag was already used in Doc 06D for an unrelated R2 fix (temporal-CHECK constraint); the actual Stage 1 tag is the next-free `RB-06D-V1-19`. All 19 07E references corrected to `RB-06D-V1-19`. §292 updated from "schema does not include" to "schema now includes (APPLIED)."  
  * **R6 checklist item 3 (run 31-pass audit \+ P31 grep):** Done — `/tmp/audit_07E.py` 30 inherited passes clean; P31 manual grep (the four SWE-prescribed base patterns over the live body before §16) returns only approved carve-outs.  
  * **R6 checklist item 4 (confirm W7 \+ W9 remain launch gates, not lock blockers):** Confirmed — W7 (Doc 10 privacy policy publication) \+ W9 (legal counsel sign-off) remain post-lock launch gates per RB-07E-V1-01; they gate Doc 05D §10.4 formal resolution \+ Doc 05D's pseudonymized-retention path production enablement, NOT the 07E spec lock itself.  
* **Version-creep / regression double-check (per Karl direction):** Re-verified all R1–R5 fixes intact with no reversion and no version bump: doc is V1.0 throughout (the V1.1 references are forward-refs to future-version mechanisms, expected); §8 conditional framing intact (RB-07E-V1-01/R2-01/R3-01/R4-01); class 2 pseudonymized naming intact (RB-07E-V1-02); bulk\_delete canonical intact (RB-07E-V1-03/R2-03/R3-03/R4-04); ML-exclusion invariant intact (RB-07E-V1-04); calendar-month retention intact (RB-07E-V1-05); 90-day deadline intact (RB-07E-V1-07); deletion-proof-metadata scope intact (RB-07E-R2-06); P31 bodied intact (RB-07E-R3-04); 31-pass count intact (RB-07E-R4-05); R5 vocabulary fixes intact. The two remaining "30-pass" references are correctly preserved inside CR-07E-04 \+ CR-07E-05 historical records (P31 did not exist at R1/R2 — altering them would falsify change history).  
* **Audit:** 30-pass `/tmp/audit_07E.py` clean; P31 grep clean (approved carve-outs only).  
* **Status transition:** DRAFT → **LOCKED 2026-05-26.** No version bump (in-lock-cycle precedent). The pre-lock dependency (Doc 06D RB-06D-V1-19 Stage 1\) is satisfied.

---

# **End of Doc 07E V1.0 — LOCKED**

**Status as of CR-07E-09 (2026-05-26):** **LOCKED 2026-05-26.** SWE R6 verdict \= LOCK-CONDITIONAL grade A; all four R6 checklist items \+ the editorial header note cleared. The sole pre-lock dependency — Doc 06D `RB-06D-V1-19` Stage 1 schema extension — is applied (Doc 06D CR-06D-06). The full R1–R5 in-lock-cycle cleanup (RB-07E-V1-01..07 \+ RB-07E-R2-01..06 \+ RB-07E-R3-01..05 \+ RB-07E-R4-01..06 \+ RB-07E-R5-01..05; CR-07E-04..09) holds; no version bump; lock date 2026-05-26.

**Post-lock obligations (NOT lock blockers — they gate production enablement, not the spec lock):**

* **Stage 2 of `W-07E-DOC06D-REGISTRY`:** population of `RPOL-ANALYTICS-01` \+ `RPOL-ANALYTICS-02` entries in `infra/retention-policy-registry.yaml` \+ removal of the Doc 06D §9.1 analytics `out_of_scope` placeholder. Owned by this 07E lock event; applied as a Doc 06D post-lock additive.  
* **Other bundled additives:** `W-07E-DOC05D-MODE-PARAM` (Doc 05D cascade mode parameter); `W-07E-PARENT-CASCADE-CLARIFY` (Doc 07 Parent §1 deliverable \#5 clarification); `W-07E-DOC06D-CGATES` (Doc 06D §10 compliance-gate registry CGATE-\* entries); `W-07E-DOC01-ACTIVITY-FIELD` (Doc 01 V8.1+ activity-timestamp field); `W-07E-DOC03-PROMPT-ARCHIVE` (Doc 03 V1.1+ prompt-template archive).

**Two V1 launch gates persist after 07E V1.0 lock (per RB-07E-V1-01) — launch gates, NOT lock blockers (R6 checklist item 4 confirmed):**

* **W7 — Doc 10 privacy policy publication** with the 7-element disclosure shape per §8.3 using "pseudonymized" language per RB-07E-V1-02 \+ RB-07E-R3-02 \+ RB-07E-R3-05 \+ RB-07E-R4-03 \+ RB-07E-R5-02  
* **W9 — Legal counsel sign-off** on §8.2 proposed compliance posture (EDPS v SRB CJEU basis \+ Kurbo-precedent \+ amended COPPA 16 CFR 312.10 basis)

Both W7 \+ W9 must close before Doc 05D §10.4 BLOCKING\_PRIVACY\_GAP is formally RESOLVED \+ Doc 05D's pseudonymized-retention path enables in production.

