# **Lyceon — Document 07A: Event Schema & Tracking Standards**

**Version:** V1.0 **Status:** LOCKED **Lock date:** 2026-05-25 **Last updated:** 2026-05-25 (CR-07A-05 in-lock-cycle multi-round cleanup applied per Parent §13 / 06 family §8 multi-round precedent — status / version / lock-date unchanged; applies SWE R2's 3 BLOCKER \+ 1 HIGH propagation-defect cleanup) **Owners:** Founder / CTO review **Governed by:** Doc 00 (Authoritative Platform Directive) \+ Doc 07 Parent V1.0 (LOCKED 2026-05-23). **Scope per Doc 07 Parent §5.1 family decomposition:** Doc 07A is the **first launch-required-content sub-doc** (per Parent Q-07-6=β drafting order) and owns the V1 event-schema specification, event-emission contract, and PII redaction contract — the contracts every line of Lyceon V1 application code emits against and that the eventual V1.1+ warehouse-side enforcement layer inherits. **Depends on:** Doc 07 Parent V1.0 (canonical decisions Q-07-1..6 inherited verbatim; §4 spec-locked-infrastructure-target-state framing applies; INV-07-01 / INV-07-02 / INV-07-08 are 07A-implemented; the 6-element §6.13 implemented-definition discipline applies to 07A's three owned mechanisms); Doc 01 V6.0 (Supabase auth user\_id is the source identifier from which `analytics_user_id` is HMAC-derived per §7); Doc 01A V1.0 (§3 config doctrine for `infra/event-schema-registry.yaml` registration; §14 PII inventory consumed as cross-reference); Doc 03 Main V1.1 (LISA tutor — §11 usage caps \+ §14.2 retention matrix \+ §24 cost discipline canonical; 07A's two tutor-class events emit BI-side observations only, never restating LISA bodies); Doc 04 family V1.0 (LOCKED — exam runtime / scoring / session-state events feed 07A's exam-class events as canonical sources); Doc 05 family V1.0 (LOCKED — 05A `apply_mastery_event` \+ `mastery_event_audit_log` are canonical; 07A's mastery-class events emit BI-side observations only, never duplicating 05A's audit-log row or restating 05B's mastery math); Doc 06A V1.0 (§3 platform stack inventory; PostHog \+ BigQuery additions land via Doc 07 Parent's W-07-PostHog-BQ obligation); Doc 06C V1.0 (§6 severity crosswalk consumed by reference — 07A V1 owns no alerts per INV-07-09); Doc 06D V1.0 (§9 retention policy registry consumed by 07E; §11 privacy-incident sub-class — 07A redaction failures produce privacy incidents via the standard mechanism; §8.7 family-wide no-PII proof-artifact rule applies to 07A's proof artifacts); Doc 06E V1.0 (§4 launch-vs-target convention adopted; §5 vendor inventory pending W-07-PostHog-BQ); Doc 07E (sibling sub-doc — 07E owns the analytics retention policy declaration \+ Doc 05D §10 layer-4 cascade target body; 07A's `pii_redaction_conformance` mechanism is 07A+07E joint per Parent §7). **Forward-references (bounded; inherited from Parent):** FWD-07-01 (Doc 09 financial unit economics — 07A's billing-class events are BI-side observations from Stripe webhooks; financial bodies stay canonical to Doc 09 when drafted); FWD-07-02 (Doc 08 multi-vertical analytical model — 07A V1 covers single-vertical SAT event taxonomy only; multi-vertical fork/extension belongs to Doc 08); no FWD-07-03 from 07A side (brand/social-proof analytics is dashboard-layer, not schema-layer). **Applies to:** the canonical `infra/event-schema-registry.yaml` machine-readable registry schema (§5 \+ §6 — strict-tier JSON-Schema-per-event for V1-named events; loose-tier 6-field tuple \+ base required fields \+ description for V1.1+ additions); the 25 V1 events across 8 canonical event classes (§6 — auth 3 / cohort 3 / billing 5 / practice 3 / exam 5 / tutor 2 / mastery 2 / system 2); the 4 V1 Person Properties (§7 — `analytics_user_id`, `exam_date`, `exam_date_cohort_id`, `exam_date_source`); the per-property PII redaction declaration shape with split-enum contract per RB-07A-V1-06 (§8 — `event_redaction_method` runtime 4-method enum \[`not_pii` / `opaque_id_only` / `bucket` / `drop`; `hash_server_local` excluded\] \+ `proof_artifact_redaction_method` proof-artifact-only 4-method enum \[`not_pii` / `bucket` / `hash_server_local` / `drop`; `opaque_id_only` excluded\]); the `emitEvent` wrapper library contract that is the single runtime emission boundary (§9 — registry-validates \+ redacts \+ maps user\_id \+ routes to PostHog SDK); the SAT test calendar reference data \+ exam-date-cohort assignment logic (§10 — `infra/sat-test-calendar.yaml` \+ next-test-date default logic); three owned proving mechanisms `ci/event-schema-registry-parity` (INV-07-01) \+ `ci/pii-redaction-conformance` (INV-07-02 joint with 07E) \+ `ops/posthog-emission-conformance` (INV-07-08 explicitly non-alerting at V1 per Parent RB-07-Parent-V1-03); the bundled in-lock-cycle additive obligation W-07A-PARENT-ADDITIVE (RB-07-Parent-V1-07 applied to Parent post-07A-LOCK) that adds the 8th `cohort` event class \+ KPI-ENG-11 `exam_anchored_engagement_rate` to Parent §2.1 \+ §10 registries. **Explicitly excludes:** warehouse data model (Doc 07B owns — `infra/kpi-registry.yaml` 35-KPI roster); analytics retention policy declaration (Doc 07E owns — FWD-06-01 resolution to Doc 06D §9); deletion-cascade analytics layer-4 target body (Doc 07E owns — Doc 05D §10 cascade target); dashboarding substrate (Doc 07C target-state V1.1+); experimentation framework (Doc 07D target-state V1.1+); mastery KPI body math (Doc 05B canonical); LISA cost/cap bodies (Doc 03 Main §11 / §24 canonical); per-platform infra cost body (Doc 06E §7 canonical); financial unit economics body (Doc 09 — FWD-07-01).

---

# **§1 — Purpose & Position**

Doc 07A is the **event-schema and tracking-standards** sub-doc of the Doc 07 family. Per Doc 07 Parent §1 launch-required-deliverable enumeration, 07A owns four of the six launch-required deliverables the Doc 07 family ships at V1:

1. **Locked event taxonomy specification** (`infra/event-schema-registry.yaml` shape \+ 25 V1 event registrations in strict tier).  
2. **PostHog event emission from V1 application code** (the only running Doc 07 infrastructure at launch; INV-07-08 proving mechanism `ops/posthog-emission-conformance` is 07A-owned).  
3. **PII redaction contract on event emission** (always-strict regardless of schema tier per Parent Q-07-1=(a); per-property posture per Q-07A-4=(β); INV-07-02 proving mechanism `ci/pii-redaction-conformance` is 07A+07E joint).  
4. **The first half of the KPI registry obligation** — by owning the event taxonomy that 07B's KPI registry consumes as its data source for every Lyceon-specific KPI. 07A does NOT own KPI definitions themselves (07B does).

The remaining two Doc 07 V1 launch-required deliverables (analytics retention policy declaration; deletion-cascade analytics layer-4 target body) live in **07E Analytics Retention, Privacy & Cascade** — drafted second per Parent Q-07-6=β order.

**Why 07A is the natural first sub-doc.** Per Parent §1 final paragraph: *"if Lyceon V1 ships without emitting events, the event stream needed for any future analytics is permanently lost for the launch cohort."* 07A spec lock is therefore the most launch-blocking artifact in the entire Doc 07 family — application code teams cannot emit events correctly without 07A's event registry and PII redaction contract locked. Drafting 07A first surfaces any spec gaps before they propagate into application code or into sibling sub-docs.

**The "spec-locked, infrastructure-target-state" framing applied to 07A.** 07A V1 ships substantive spec contracts for everything Lyceon V1 code emits at launch, plus the minimal running infrastructure (PostHog event emission live; emission wrapper library deployed). Per Parent §4 family-level framing:

* **Launch-required at V1:** event-schema registry (locked \+ populated with 25 V1 events) \+ PII redaction contract (locked \+ per-property posture per registry entry) \+ emission wrapper library (live in application code) \+ PostHog as substrate (Tier-1 launch-required per W-07-PostHog-BQ) \+ `ci/event-schema-registry-parity` hard-fail at V1 for registration presence / wrapper bypass / property-set mismatch (per RB-07A-V1-01 fix to original advisory framing — INV-07-01 is a load-bearing launch-required invariant and must be enforced at V1).  
* **Target-state V1.1+:** warehouse-side event-stream ingestion (when PostHog → BigQuery export activates per W8); the single V1.1+ relaxation in CI strictness is loose-tier property-depth checking (which requires the warehouse export to be live to validate observed payloads against declared base required fields).  
* **Always-strict regardless of tier:** PII redaction contract per Q-07-1=(a) family-wide rule.

**Three owned mechanisms** (each carrying a §11 six-element implemented-definition table per Parent §6.13 / family inheritance):

1. `ci/event-schema-registry-parity` — INV-07-01 proving mechanism. Verifies every event emitted by Lyceon application code matches a registered entry in `infra/event-schema-registry.yaml`. **At V1 the following are hard-fail:** (a) any code-emitted event without a registry entry (registration presence — the load-bearing INV-07-01 invariant); (b) any direct import of the PostHog SDK outside the wrapper module (wrapper-bypass detection via lint integration); (c) any strict-tier entry whose `pii_redaction` key set does not equal its `json_schema.properties` key set (property-set mismatch). **The single V1.1+ relaxation** is loose-tier property-depth enforcement (verifying that V1.1+ loose-tier entries' base required fields appear in observed event payloads — a payload-stream check that requires the warehouse export to be live). Launch-required: true.  
2. `ci/pii-redaction-conformance` — INV-07-02 proving mechanism (07A \+ 07E joint). Verifies every registry entry declares per-property PII redaction posture using only the `event_redaction_method` runtime 4-method enum (per RB-07A-V1-06 split — runtime enum excludes `hash_server_local`; the proof-artifact-only 4-method enum is separate per §8.1) \+ the JSON Schema property set matches the `pii_redaction` key set (no orphan property in either direction). Launch-required: true.  
3. `ops/posthog-emission-conformance` — INV-07-08 proving mechanism. Runtime health check that PostHog ingestion is receiving events from V1 application code. **Explicitly non-alerting at V1** per Parent RB-07-Parent-V1-03 — failure modes: (a) deploy-time blocks deploy completion until manually resolved; (b) runtime records a structured failure in the proof artifact stream; on-call rotation is NOT paged. V1.1+ activation may add alert routing once 06C-side registration completes. Launch-required: true.

---

# **§2 — Scope & Boundary**

## **2.1 Doc 07A owns**

The `infra/event-schema-registry.yaml` canonical machine-readable registry shape (§5 — events list \+ person\_properties list \+ retention\_classes reference); the 25 V1 event registrations across 8 canonical event classes (§6 — full per-event strict-tier JSON Schema with `additionalProperties: false`); the 4 V1 Person Properties contract (§7 — `analytics_user_id`, `exam_date`, `exam_date_cohort_id`, `exam_date_source`); the per-property PII redaction declaration shape (§8 — split-enum contract per RB-07A-V1-06: `event_redaction_method` runtime 4-method enum \[`not_pii` / `opaque_id_only` / `bucket` / `drop`\] for every event registry entry; `proof_artifact_redaction_method` proof-artifact-only 4-method enum \[`not_pii` / `bucket` / `hash_server_local` / `drop`\] for proof artifacts only); the `emitEvent` wrapper library contract that is the single runtime emission boundary into PostHog (§9 — registry-validates the event\_name \+ applies PII redaction per registry posture \+ maps Supabase user\_id → analytics\_user\_id \+ routes to PostHog SDK); the SAT test calendar reference data file `infra/sat-test-calendar.yaml` \+ the exam-date → cohort\_id derivation logic \+ the next-test-date default rule when a student signs up without setting an exam date (§10); the `analytics_user_id` HMAC-derivation contract from Supabase user\_id (§7 — separate immutable column on user record, computed once at signup, `analytics_user_id = HMAC-SHA256(supabase_user_id, ANALYTICS_SALT)`; salt managed per family-wide §8.7 / RB-06D-V1-10 secret-handling); the three V1 owned proving mechanisms (§11 — `ci/event-schema-registry-parity` \+ `ci/pii-redaction-conformance` \+ `ops/posthog-emission-conformance` with six-element §6.13 implemented-definition tables each); the strict→loose tier promotion contract (§5 — what gets relaxed when an event moves from strict to loose; under what conditions; with what audit trail) and the loose→strict promotion contract (the harder direction — writing the full JSON Schema for a previously-loose entry); the §13 audit profile inheriting 30 passes from Parent with explicit notes on where 07A is the implementation site (P26 \+ P28) vs the trivial consumer (other passes); the §14 acceptance criteria covering all 07A-owned launch-required mechanisms \+ the bundled W-07A-PARENT-ADDITIVE obligation (RB-07-Parent-V1-07 applied to Parent post-07A-LOCK adding the 8th cohort event class \+ KPI-ENG-11).

## **2.2 Doc 07A explicitly does NOT own (Decision 5 — referenced, never restated)**

| Concern | Canonical owner (referenced by exact §) |
| ----- | ----- |
| KPI definitions \+ KPI registry shape | Doc 07B V1.0 (sibling sub-doc — pending) — `infra/kpi-registry.yaml` 35-KPI roster (after RB-07-Parent-V1-07 additive); 07A events feed 07B KPIs but 07A does not define KPIs |
| Analytics retention policy declaration | Doc 07E V1.0 (sibling sub-doc — pending) — FWD-06-01 resolution to Doc 06D §9; 07A declares `retention_class` per event but the class definitions \+ mapping to 06D §9 entries belongs to 07E |
| Deletion-cascade analytics layer-4 target body | Doc 07E V1.0 (sibling sub-doc — pending) — Doc 05D §10 cascade target; 07A's PostHog deletion API integration sits inside 07E's cascade body |
| Dashboarding substrate \+ executive scorecards | Doc 07C V1.0 (sibling sub-doc — pending; target-state V1.1+) |
| A/B test event tagging \+ statistical framework | Doc 07D V1.0 (sibling sub-doc — pending; target-state V1.1+) |
| Mastery KPI body math (acc formula, position decay, difficulty/source weights, 5-level thresholds) | Doc 05B V1.0 §3-§5 — referenced; 07A's mastery-class events emit BI-side observations only and never restate 05B math |
| 05A `mastery_event_audit_log` row schema | Doc 05A V1.0 §11 — referenced; 07A's `mastery_event_observed` is NOT a duplicate of the audit-log row, it is a separate BI-side observation emitted alongside the canonical mastery event |
| LISA cost target/alert thresholds ($20 hard cap, $18 hard alert, $10 soft alert, \<$6 target) | Doc 03 Main V1.1 §24 — referenced |
| LISA usage caps (120/day, 2,500/week, 10K/month hard) | Doc 03 Main V1.1 §11 — referenced |
| LISA tutor verification events (tutor\_helped / tutor\_failed canonical taxonomy) | Doc 03 family — referenced; 07A registers `tutor_session_started` \+ `tutor_session_ended` only at V1; explicitly NOT `tutor_helped` or `tutor_failed` per Parent §10.6 KPI-TUT-02 carve-out (non-deterministic measurement at V1) |
| Per-platform infra cost body | Doc 06E V1.0 §7 — referenced |
| Financial unit economics body | Doc 09 — FWD-07-01 sanctioned bounded forward-ref |
| Multi-vertical event-taxonomy fork/extension | Doc 08 — FWD-07-02 sanctioned bounded forward-ref |
| Supabase user\_id semantics (the source identifier from which `analytics_user_id` derives) | Doc 01 V6.0 / Doc 01A V1.0 — referenced; 07A consumes via §7 HMAC-derivation contract |
| Privacy-incident lifecycle base | Doc 06D V1.0 §11 — referenced; 07A redaction failures produce privacy incidents via the standard mechanism |
| Severity crosswalk (Page / Warn / Info \+ operational\_response\_urgency) | Doc 01A §18 via Doc 06C §6 — referenced; 07A V1 owns NO alerts per INV-07-09 inheritance |
| Scheduled-job heartbeat substrate | Doc 06C V1.0 §8 — referenced; 07A V1 has no scheduled jobs (V1.1+ warehouse ingestion job will register via 06C §8 standard when activated) |
| Vendor inventory \+ outage runbook \+ cost-structure \+ pricing-snapshot for PostHog \+ BigQuery | Doc 06E V1.0 §5 / §6.3 / §7 / §13 — referenced; **W-07-PostHog-BQ** Parent-declared obligation applies `RB-06E-V1-15/16` post-Doc-07-family-LOCK |
| Family-wide §8.7 no-PII proof-artifact rule | Doc 06D V1.0 §8.7 / RB-06D-V1-10 — family-wide reference applied to 07A proof artifacts |

## **2.3 Inheritance**

Doc 07A inherits Doc 00, Doc 07 Parent V1.0 in full (§4 spec-locked-infrastructure-target-state framing; INV-07-01 / INV-07-02 / INV-07-08 invariant statements; the canonical 8-event-class catalog including the cohort 8th class pending RB-07-Parent-V1-07; §10 KPI roster with 35-KPI count after RB-07-Parent-V1-07; the SPEC\_CONTRACT\_GATE deploy-gate class; the W-07-PostHog-BQ cross-doc additive obligation), Doc 06 Parent §6.13 (named ≠ implemented; six-element proving mechanism), Doc 06 Parent §10.5 (Standard Proof Artifact Envelope — extended in §11 with 07A per-mechanism envelope extras), Doc 06A §3 (platform stack inventory; PostHog \+ BigQuery additions deferred to W-07-PostHog-BQ), Doc 06A §7 (environment matrix — PostHog and analytics\_user\_id behave identically across Dev/Staging/Prod with per-environment salts), Doc 06C §6.0 (registry-canonical principle — `infra/event-schema-registry.yaml` is canonical; 07A's markdown rendering of it in §5 \+ §6 is reference, not source-of-truth), Doc 06D §8.7 no-PII proof-artifact rule (family-wide reference applied universally), Doc 06D §11 privacy-incident sub-class (07A redaction failures produce privacy incidents via the standard mechanism), Doc 06E §4 launch-vs-target annotation convention (adopted natively per Parent §4 family-level extension).

---

# **§3 — Threat Model (Schema \+ Emission \+ Redaction Threats)**

Threats this sub-doc addresses. 07A's threat profile is sharper than Parent's because the threats are concrete: a misconfigured schema entry, a leaked PII field, a dropped event at the wrapper layer.

1. **Unregistered event emission (the loose-tier loophole).** Per Parent RB-07-Parent-V1-05, loose-tier means loose *fields*, not unregistered events. Without enforcement, V1.1+ code teams could emit ad-hoc events justified by "we'll use loose schema" — and the event stream silently bifurcates between registered and unregistered events. *Defense:* `ci/event-schema-registry-parity` rejects any code-emitted event without a registry entry, regardless of tier; the `emitEvent` wrapper library refuses to send if the event\_name is not in the registry (registry-validates at the call site).

2. **PII leak via under-specified redaction posture.** A schema entry that lists JSON Schema properties but omits one property from the `pii_redaction` map silently lets the wrapper send that property to PostHog unredacted (depending on wrapper implementation default). Without an explicit posture, "I forgot to redact" looks identical to "this field doesn't need redaction." *Defense:* `ci/pii-redaction-conformance` requires the `pii_redaction` key set EQUAL the JSON Schema property set (no orphans either direction); the `event_redaction_method` runtime 4-method enum (per RB-07A-V1-06 split — see §8.1.1) forces an explicit choice including `not_pii` as a positive declaration (silence is not an option).

3. **Cross-system stable-identifier leak via `analytics_user_id` mis-derivation.** Per RB-07-Parent-V1-04 forbidden-identifier-types, stable cross-system hashes are a re-identification vector. If `analytics_user_id` is computed as `sha256(supabase_user_id)` without salt, anyone with both Supabase user\_ids and PostHog distinct\_ids can join the two datasets. *Defense:* §7 HMAC-derivation contract requires `analytics_user_id = HMAC-SHA256(supabase_user_id, ANALYTICS_SALT)` with `ANALYTICS_SALT` stored as a server-only secret per family-wide §8.7 / RB-06D-V1-10 rule; salt is per-environment (Dev/Staging/Prod each have their own salt); salt rotation is V1.1+ target-state (V1 ships with one salt per env).

4. **Wrapper-library bypass via direct PostHog SDK calls.** If application code calls the PostHog SDK directly instead of going through `emitEvent`, the registry-validation and PII-redaction enforcement is skipped. *Defense:* (a) `emitEvent` is the single emission boundary documented in §9 with a clear surface; (b) the PostHog SDK is imported only inside `emitEvent` and the wrapper itself is the only allowed importer (lint rule); (c) `ci/event-schema-registry-parity` runs against the actual emitted-event stream at V1.1+ activation, catching any wrapper bypass at the network boundary.

5. **Event-stream loss between V1 launch and warehouse activation.** PostHog's free tier ingests 1M events/month. Lyceon launch volumes are well below that bound, but if the launch goes viral or there's a logging-loop bug, PostHog could drop events at the ingestion layer. *Defense:* `ops/posthog-emission-conformance` runtime check verifies PostHog ingestion is receiving events from V1 application code; deploy-time \+ runtime monitoring (non-alerting at V1 per Parent RB-07-Parent-V1-03 reconciliation with INV-07-09); PostHog's own ingestion-rate dashboard provides additional visibility per W-07-PostHog-BQ-bound 06E §6.3 outage runbook.

6. **Cohort-assignment drift via late `exam_date` updates.** A student signs up with an initial `exam_date`, then changes it three months later via `exam_date_changed_in_settings`. PostHog's Person Properties get updated, but events emitted between signup and the change carry the OLD `exam_date_cohort_id`. This is correct behavior at the event-stream level (events are immutable) but can confuse cohort analyses that join events to current Person Property values. *Defense:* §7 Person Properties contract documents that `exam_date_cohort_id` on the user is the *current* cohort; cohort analyses that need historical accuracy use the event-time cohort property emitted on each event; the trade-off is documented \+ KPI definitions in 07B will specify which (current vs event-time) they use.

7. **Schema-drift between strict-tier JSON Schema and runtime payload.** A code path emits a payload that doesn't match the declared JSON Schema (extra field, missing required field, wrong type). The wrapper either rejects the emission (correct behavior) or passes it through (silent drift). *Defense:* `emitEvent` validates the payload against the registry's JSON Schema *before* PostHog SDK call; on validation failure, the wrapper logs a structured error to the proof artifact stream \+ drops the event (non-alerting per INV-07-09). Lost-event accounting is a known cost of strict validation; the alternative (passing invalid events through) is worse for analytics integrity.

8. **`infra/sat-test-calendar.yaml` staleness.** The SAT test calendar must be updated annually as College Board publishes new dates. If the file is stale and the next-upcoming-exam-date computation returns a date in the past, new signups get assigned to a cohort\_id that's already expired. *Defense:* `ci/sat-test-calendar-freshness` checks that `infra/sat-test-calendar.yaml` contains at least one test date ≥ today \+ 30 days; warns in CI when the lead-time drops below 90 days; this is a per-event-derivation safety check that piggybacks on `ci/event-schema-registry-parity` as a sub-check.

9. **PostHog autocapture noise polluting the registry.** PostHog's default behavior auto-captures pageviews and other DOM events. These are NOT registered in `infra/event-schema-registry.yaml` (the registry covers only Lyceon-explicit business events). Without explicit handling, autocapture events would either (a) appear in analytics alongside registered events with no governance, or (b) get filtered out and lose useful information. *Defense:* §9 wrapper-library contract explicitly states autocapture is DISABLED at V1 (PostHog SDK config `autocapture: false`); Lyceon emits only explicit `emitEvent`\-routed events; if pageview tracking becomes needed, it gets registered as a regular event in `infra/event-schema-registry.yaml` per the standard discipline.

**Threats explicitly NOT addressed here:**

* Warehouse-side query optimization / cost — Doc 07B / 07C.  
* Mastery formula correctness — 05A/05B canonical.  
* LISA cost discipline correctness — Doc 03 Main §24 canonical.  
* Privacy-incident lifecycle base orchestration — Doc 06D §11 canonical.  
* Vendor outage runbook content — Doc 06E §6.3 canonical (pending W-07-PostHog-BQ).  
* A/B experimentation statistical validity — Doc 07D.  
* Compliance-evidence process for retention policy — Doc 07E \+ Doc 06D §10.

## **3.4 Doc 03 / Doc 05 citation paths (carried family-wide)**

Per Parent §3.4 / §3.5 cite-path discipline. Doc 03 Main V1.1 §11/§14.2/§24 and Doc 05 family V1.0 (05A §11 \+ 05B §3-§5) are referenced per project handoff record / project memory; on upload, 07A tutor-event subsections (§6.7) \+ mastery-event subsections (§6.8) \+ Person Properties subsection (§7) gain parsed-§ reconciliation. Until then, cited section names are recorded as `cited_per_project_handoff_record` / `cited_per_project_memory` in proof artifacts. Carried forward in §12 watch list (W1, W2) as non-blocking.

---

# **§4 — Launch-vs-Target Framing Applied to 07A**

Per Parent §4 family-level extension. 07A's mechanism inventory by `launch_required` status:

**Launch-required at V1 (`launch_required: true`):**

* `infra/event-schema-registry.yaml` exists and is populated with the 25 V1 event registrations (§5 \+ §6)  
* All 25 V1 events are strict-tier with full JSON Schema (§6)  
* The 4 V1 Person Properties are declared in registry \+ applied to PostHog Person Properties (§7)  
* `analytics_user_id` HMAC-derivation contract is implemented \+ per-environment salts are configured (§7)  
* Per-property PII redaction posture is declared for every property on every event \+ every Person Property (§8)  
* `emitEvent` wrapper library is deployed \+ is the single emission boundary into PostHog (§9)  
* `infra/sat-test-calendar.yaml` exists with at least 12 months of forward-looking SAT test dates (§10)  
* Three owned mechanisms have proof artifacts that satisfy the §11 six-element implemented-definition:  
  * `ci/event-schema-registry-parity` hard-fail at V1 for registration presence / wrapper bypass / property-set mismatch; only loose-tier property-depth relaxation deferred to V1.1+ (warehouse-side payload-stream check)  
  * `ci/pii-redaction-conformance` running hard-fail at V1 (PII discipline is always-strict)  
  * `ops/posthog-emission-conformance` running deploy-time hard-block \+ runtime non-alerting structured-failure record

**Target-state V1.1+ (`launch_required: false`):**

* `ci/event-schema-registry-parity` loose-tier property-depth check (V1: not run because warehouse export not live; V1.1+: when warehouse activates, payload-stream validation extends to verify loose-tier entries' base required fields appear in observed payloads). **Note (per RB-07A-V1-01):** the parity check's registration-presence \+ wrapper-bypass \+ property-set-mismatch sub-checks are hard-fail at V1; only loose-tier property-depth requires the V1.1+ warehouse export to activate. Activation trigger (hybrid per Q-07A-7=δ): (a) sustained PostHog event volume \> 100K events/month for 2 consecutive months \[volume\] OR (b) 6 months post-launch \[time\] OR (c) first analytics insight that breaks because of an under-validated loose-tier event \[demand\] — first-to-trigger wins.  
* Warehouse-side `ci/event-schema-registry-parity` extension (currently CI-only against application code; V1.1+ extends to validate the PostHog → BigQuery export stream as well). Activation trigger: BigQuery warehouse activates per W8 (Parent §11) — PostHog event volume sustained \> 500K events/month OR cross-source analytical query becomes operationally needed.  
* `ops/posthog-emission-conformance` alert routing addition (V1: non-alerting; V1.1+: may add Page/Warn routing via 06C §7 standard registration). Activation trigger: when the first Doc 07-class alert is registered via 06C §7 — at which point INV-07-09 relaxes for V1.1+ scope expansion per Parent §4 family-level extension.  
* Schema-version-managed loose→strict promotion automation (V1: manual promotion via PR; V1.1+: tooling to assist with JSON Schema generation from observed loose-tier event payloads). Activation trigger: 3+ loose-tier promotions completed manually \[volume\] OR first loose-tier event used in a customer-facing dashboard \[demand\].  
* Salt rotation infrastructure for `ANALYTICS_SALT` (V1: one salt per environment, no rotation; V1.1+: rotation playbook \+ dual-salt grace period for analytics\_user\_id continuity). Activation trigger: 12 months post-launch \[time\] OR first security-incident requiring credential rotation \[demand\].  
* Autocapture re-evaluation (V1: PostHog autocapture DISABLED per §3 threat 9; V1.1+: if pageview tracking becomes needed, register `page_viewed` as a regular event in `infra/event-schema-registry.yaml` per standard discipline). Activation trigger: first product-analytics question that requires page-view data \[demand\].

**Always-strict regardless of launch\_required:**

* PII redaction contract per Parent Q-07-1=(a) family-wide rule — no relaxation at any tier or any time.  
* Server-generated opaque user\_id only per Parent RB-07-Parent-V1-04 — no relaxation; the `analytics_user_id` HMAC derivation is the V1 implementation and V1.1+ adds salt rotation but never relaxes the constraint.

---

# **§5 — Event-Schema Registry Shape**

## **5.1 The canonical registry file**

`infra/event-schema-registry.yaml` is the canonical machine-readable registry per Doc 06C §6.0 registry-canonical principle. The markdown rendering in §6 below is reference, not source-of-truth. `ci/event-schema-registry-parity` reads the YAML file and validates against application code \+ (V1.1+) the PostHog event stream.

## **5.2 Top-level registry schema**

\# infra/event-schema-registry.yaml  
\# Canonical event-schema registry for Lyceon. Owned by Doc 07A V1.0.  
\# Per Doc 07 Parent §4 / Doc 07A §4 launch-vs-target framing: V1 ships 25 strict-tier events \+ 4 Person Properties.

schema\_version: "1.0.0"  
last\_updated: "2026-05-23"  
owner\_doc: "07A V1.0"

events:  
  \# List of event entries — see §5.3 for entry shape; full V1 entries in §6.  
  \- event\_name: \<string\>  
    schema\_tier: \<"strict" | "loose"\>  
    canonical\_event\_class: \<one of: auth | cohort | billing | practice | exam | tutor | mastery | system\>  
    owner: \<string — sub-doc \+ version that defines this event, e.g., "07A V1.0"\>  
    V1\_active: \<boolean\>  
    schema\_version: \<semver string\>  
    description: \<string — free-text human-readable description; required for both tiers\>  
    json\_schema: \<JSON Schema object — required for strict tier; optional for loose tier\>  
    base\_required\_fields: \<array of strings — required for loose tier; redundant if json\_schema present\>  
    pii\_redaction: \<object mapping property\_name → redaction\_method; see §8 for method enum\>  
    retention\_class: \<string — references Doc 07E retention class taxonomy when 07E locks; V1 placeholder: "standard\_analytics"\>

person\_properties:  
  \# List of PostHog Person Property entries — see §7.  
  \- property\_name: \<string\>  
    description: \<string\>  
    type: \<string — JSON Schema primitive type or composite\>  
    mutability: \<"immutable" | "mutable"\>  
    derivation: \<string — how the value is computed; required for derived properties\>  
    pii\_redaction\_method: \<string — one of the \`event\_redaction\_method\` runtime 4-method enum per RB-07A-V1-06 split — see §8.1.1\>  
    retention\_class: \<string\>

retention\_classes:  
  \# Placeholder pending Doc 07E lock. V1 ships with single class "standard\_analytics".  
  \# 07E will define the full retention class taxonomy \+ mapping to Doc 06D §9 retention registry entries.  
  \- class\_name: "standard\_analytics"  
    description: "Placeholder retention class for V1 events; full definition pending Doc 07E V1.0 lock \+ FWD-06-01 resolution to Doc 06D §9."  
    pending\_07E\_resolution: true

## **5.3 Strict-tier entry shape (full JSON Schema per Q-07A-2=α)**

A strict-tier entry MUST include:

* `event_name` — canonical event name; lowercase snake\_case; matches PostHog distinct\_id convention  
* `schema_tier: strict`  
* `canonical_event_class` — one of the 8 canonical classes per Parent §2.1 (with cohort added via RB-07-Parent-V1-07)  
* `owner` — sub-doc \+ version that defines this event  
* `V1_active: true` for V1 events; `false` for V1.1+ reserved entries  
* `schema_version` — semver; tracks schema evolution within a single event\_name  
* `description` — free-text; required even for strict tier (humans read the registry too)  
* `json_schema` — full JSON Schema with `additionalProperties: false` (this is the strict-tier discipline; prevents payload drift)  
* `pii_redaction` — per-property posture; key set MUST equal `json_schema.properties` key set (CI enforces)  
* `retention_class` — references Doc 07E class taxonomy (V1 placeholder: `"standard_analytics"`)

## **5.4 Loose-tier entry shape (Q-07A-3=γ)**

A loose-tier entry MUST include:

* `event_name`, `schema_tier: loose`, `canonical_event_class`, `owner`, `V1_active`, `schema_version`, `description`, `pii_redaction`, `retention_class` (the 9-field canonical loose-tier tuple — same governance metadata as strict-tier)  
* `base_required_fields` — array of property names that MUST be present in every emission (typically `[event_name, timestamp, user_id, schema_version]`)  
* `pii_redaction` keys are a subset of declared base \+ known fields; new fields encountered at runtime are NOT silently allowed (the wrapper rejects unknown fields if they don't have a `pii_redaction` entry)

A loose-tier entry MAY omit `json_schema` — that's the difference from strict tier. **A loose-tier entry MUST NOT omit registry presence** — per Parent RB-07-Parent-V1-05, every emitted event at every tier must have a registry entry. Loose \= relaxed structure within an entry, not absent entry.

## **5.5 Strict↔loose tier promotion contracts**

**Loose → strict promotion (V1.1+ pattern):** Author writes a full JSON Schema for the previously-loose entry; updates `schema_tier: loose` → `schema_tier: strict`; bumps `schema_version` (typically minor bump within the loose-version lineage, e.g., `0.1.0` → `1.0.0`); CI validates the new JSON Schema against historical event payloads (queried from PostHog, V1.1+ when warehouse export landed) to verify no drift; merges PR.

**Strict → loose demotion (anti-pattern; should not happen but contract exists):** If a strict-tier event needs to relax (rare), author downgrades with `schema_version` bump \+ audit-log entry; CI flags strict→loose demotion as a notable event-stream-governance change requiring explicit reviewer approval. V1 ships with no demotions expected.

## **5.6 Schema-version semantics**

`schema_version` is per-event semver:

* **Major bump** (1.0.0 → 2.0.0): breaking change to the event's schema (renamed property, removed required property, changed property type). Requires V1.1+ warehouse-side migration handling. Rare.  
* **Minor bump** (1.0.0 → 1.1.0): additive non-breaking change (new optional property, expanded enum, new redaction posture for an existing property). Common.  
* **Patch bump** (1.0.0 → 1.0.1): description / metadata / non-payload changes. Frequent.

The `schema_version` is emitted as part of every event payload (per base\_required\_fields) so downstream consumers can detect version drift.

---

# **§6 — The 25 V1 Events (Per-Class Catalog)**

## **6.0 Pending-additive framing (RB-07A-V1-07)**

Per RB-07A-V1-07, the original draft inconsistently treated the W-07A-PARENT-ADDITIVE (RB-07-Parent-V1-07) as **both pending application AND already canonical** in different places. The corrected framing:

* **Doc 07 Parent V1.0 (LOCKED 2026-05-23)** currently declares **7 canonical event classes** (auth / billing / practice / exam / tutor / mastery / system) in §2.1 and a **34-KPI roster** in §10 with 6 bodied \+ 28 stubs.  
* **Doc 07A V1.0 proposes** the addition of an 8th `cohort` event class \+ KPI-ENG-11 `exam_anchored_engagement_rate` via the **W-07A-PARENT-ADDITIVE obligation** (§12 W6 — applied to Parent as `RB-07-Parent-V1-07` post-07A-LOCK).  
* **Until `RB-07-Parent-V1-07` is applied to Parent**, the 3 cohort-class events registered in §6.3 below are **proposed-by-07A-pending-Parent-additive**, not Parent-canonical. The KPI-ENG-11 reference in §10 is also pending. 07A spec lock does NOT itself canonicalize them at Parent scope — only the bundled additive does.  
* **After `RB-07-Parent-V1-07` is applied**, the 8th cohort class \+ KPI-ENG-11 become Parent-canonical and 07A's §6.3 \+ §10 references retroactively align with Parent without further 07A edit.

This pending-additive framing applies to every reference in 07A to "8 canonical event classes" or "35-KPI roster" or "29 stubs" — those values are the post-additive state. The current Parent-canonical values are 7 / 34 / 28 respectively until `RB-07-Parent-V1-07` lands.

## **6.1 Per-class summary (counts include the cohort class pending RB-07-Parent-V1-07 Parent additive)**

| Class | Count | Events |
| ----- | ----- | ----- |
| auth | 3 | user\_signed\_up, user\_signed\_in, user\_signed\_out |
| **cohort** *(pending Parent §2.1 additive via RB-07-Parent-V1-07)* | 3 | exam\_date\_set\_at\_signup, exam\_date\_set\_via\_calendar\_prompt, exam\_date\_changed\_in\_settings |
| billing | 5 | subscription\_trial\_started, subscription\_activated, subscription\_renewed, subscription\_cancelled, subscription\_payment\_failed |
| practice | 3 | practice\_session\_started, practice\_question\_submitted, practice\_session\_completed |
| exam | 5 | exam\_started, exam\_section\_submitted, exam\_completed, exam\_section\_partial\_abandoned, exam\_resumed |
| tutor | 2 | tutor\_session\_started, tutor\_session\_ended |
| mastery | 2 | mastery\_event\_observed, mastery\_level\_changed |
| system | 2 | error\_caught, consent\_captured |

**Common base fields** (present in every event payload; declared in every entry's `json_schema.required`):

* `event_name` (string; const matches the canonical name)  
* `timestamp` (string; ISO 8601 date-time UTC)  
* `analytics_user_id` (string; opaque server-generated identifier; see §7)  
* `schema_version` (string; semver pattern)

## **6.2 auth class (3 events)**

### **`user_signed_up`**

\- event\_name: user\_signed\_up  
  schema\_tier: strict  
  canonical\_event\_class: auth  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when a new user completes initial account creation (post-email-verification). Does not include the email itself; only opaque analytics\_user\_id."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, signup\_source\]  
    properties:  
      event\_name:        { type: string, const: "user\_signed\_up" }  
      timestamp:         { type: string, format: date-time }  
      analytics\_user\_id: { type: string, format: uuid }  
      schema\_version:    { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      signup\_source:     { type: string, enum: \[direct, referral, paid\_ad, organic\_search, unknown\] }  
  pii\_redaction:  
    event\_name:        not\_pii  
    timestamp:         not\_pii  
    analytics\_user\_id: opaque\_id\_only  
    schema\_version:    not\_pii  
    signup\_source:     not\_pii  
  retention\_class: standard\_analytics

### **`user_signed_in`**

\- event\_name: user\_signed\_in  
  schema\_tier: strict  
  canonical\_event\_class: auth  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when an authenticated session begins (post-credential-verification, post-Supabase-auth-success). Per §3 threat 9, this is the auth-state-transition event, NOT a session-boundary event (PostHog session tracking owns session boundaries natively)."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version\]  
    properties:  
      event\_name:        { type: string, const: "user\_signed\_in" }  
      timestamp:         { type: string, format: date-time }  
      analytics\_user\_id: { type: string, format: uuid }  
      schema\_version:    { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
  pii\_redaction:  
    event\_name:        not\_pii  
    timestamp:         not\_pii  
    analytics\_user\_id: opaque\_id\_only  
    schema\_version:    not\_pii  
  retention\_class: standard\_analytics

### **`user_signed_out`**

\- event\_name: user\_signed\_out  
  schema\_tier: strict  
  canonical\_event\_class: auth  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when an authenticated session ends (explicit sign-out OR session expiry). Auth-state-transition event."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, signout\_trigger\]  
    properties:  
      event\_name:        { type: string, const: "user\_signed\_out" }  
      timestamp:         { type: string, format: date-time }  
      analytics\_user\_id: { type: string, format: uuid }  
      schema\_version:    { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      signout\_trigger:   { type: string, enum: \[explicit, session\_expiry, security\_logout\] }  
  pii\_redaction:  
    event\_name:        not\_pii  
    timestamp:         not\_pii  
    analytics\_user\_id: opaque\_id\_only  
    schema\_version:    not\_pii  
    signout\_trigger:   not\_pii  
  retention\_class: standard\_analytics

## **6.3 cohort class (3 events; pending RB-07-Parent-V1-07 Parent §2.1 additive)**

### **`exam_date_set_at_signup`**

\- event\_name: exam\_date\_set\_at\_signup  
  schema\_tier: strict  
  canonical\_event\_class: cohort  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when a new user inputs their target SAT exam date during onboarding. Drives initial cohort assignment per §10."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, exam\_date, exam\_date\_cohort\_id\]  
    properties:  
      event\_name:          { type: string, const: "exam\_date\_set\_at\_signup" }  
      timestamp:           { type: string, format: date-time }  
      analytics\_user\_id:   { type: string, format: uuid }  
      schema\_version:      { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      exam\_date:           { type: string, format: date }  
      exam\_date\_cohort\_id: { type: string, pattern: "^\[a-z\]+\_\\\\d{4}$" }  
  pii\_redaction:  
    event\_name:          not\_pii  
    timestamp:           not\_pii  
    analytics\_user\_id:   opaque\_id\_only  
    schema\_version:      not\_pii  
    exam\_date:           not\_pii  
    exam\_date\_cohort\_id: not\_pii  
  retention\_class: standard\_analytics

### **`exam_date_set_via_calendar_prompt`**

\- event\_name: exam\_date\_set\_via\_calendar\_prompt  
  schema\_tier: strict  
  canonical\_event\_class: cohort  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when an existing user inputs (or confirms) their target SAT exam date in response to the calendar feature's prompt (paid-tier feature). May fire repeatedly across a user's lifecycle if calendar prompts multiple times."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, exam\_date, exam\_date\_cohort\_id, previous\_exam\_date\_cohort\_id\]  
    properties:  
      event\_name:                    { type: string, const: "exam\_date\_set\_via\_calendar\_prompt" }  
      timestamp:                     { type: string, format: date-time }  
      analytics\_user\_id:             { type: string, format: uuid }  
      schema\_version:                { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      exam\_date:                     { type: string, format: date }  
      exam\_date\_cohort\_id:           { type: string, pattern: "^\[a-z\]+\_\\\\d{4}$" }  
      previous\_exam\_date\_cohort\_id:  { type: \["string", "null"\], pattern: "^\[a-z\]+\_\\\\d{4}$" }  
  pii\_redaction:  
    event\_name:                   not\_pii  
    timestamp:                    not\_pii  
    analytics\_user\_id:            opaque\_id\_only  
    schema\_version:               not\_pii  
    exam\_date:                    not\_pii  
    exam\_date\_cohort\_id:          not\_pii  
    previous\_exam\_date\_cohort\_id: not\_pii  
  retention\_class: standard\_analytics

### **`exam_date_changed_in_settings`**

\- event\_name: exam\_date\_changed\_in\_settings  
  schema\_tier: strict  
  canonical\_event\_class: cohort  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when a user changes their target SAT exam date via the settings UI. Drives cohort re-assignment; the OLD cohort\_id is captured in previous\_exam\_date\_cohort\_id for cohort-migration analysis."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, exam\_date, exam\_date\_cohort\_id, previous\_exam\_date\_cohort\_id\]  
    properties:  
      event\_name:                    { type: string, const: "exam\_date\_changed\_in\_settings" }  
      timestamp:                     { type: string, format: date-time }  
      analytics\_user\_id:             { type: string, format: uuid }  
      schema\_version:                { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      exam\_date:                     { type: string, format: date }  
      exam\_date\_cohort\_id:           { type: string, pattern: "^\[a-z\]+\_\\\\d{4}$" }  
      previous\_exam\_date\_cohort\_id:  { type: \["string", "null"\], pattern: "^\[a-z\]+\_\\\\d{4}$" }  
  pii\_redaction:  
    event\_name:                   not\_pii  
    timestamp:                    not\_pii  
    analytics\_user\_id:            opaque\_id\_only  
    schema\_version:               not\_pii  
    exam\_date:                    not\_pii  
    exam\_date\_cohort\_id:          not\_pii  
    previous\_exam\_date\_cohort\_id: not\_pii  
  retention\_class: standard\_analytics

## **6.4 billing class (5 events)**

Billing events are emitted from Stripe webhook handlers — Stripe is the canonical source of truth for revenue / subscription data per Parent §6.1 platform-features-first principle. Lyceon receives Stripe webhooks, validates them per Doc 01A §44 abuse-score boundary, then routes a Lyceon-named event through `emitEvent` to PostHog for cross-source analytical correlation.

### **`subscription_trial_started`**

\- event\_name: subscription\_trial\_started  
  schema\_tier: strict  
  canonical\_event\_class: billing  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when a Stripe checkout completes for a trial subscription. Stripe's customer.subscription.created webhook with trial\_end set is the source. Stripe is canonical for revenue data; this event exists for PostHog cross-correlation with engagement events only."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, trial\_duration\_days, plan\_id\]  
    properties:  
      event\_name:           { type: string, const: "subscription\_trial\_started" }  
      timestamp:            { type: string, format: date-time }  
      analytics\_user\_id:    { type: string, format: uuid }  
      schema\_version:       { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      trial\_duration\_days:  { type: integer, minimum: 1, maximum: 90 }  
      plan\_id:              { type: string, pattern: "^\[a-z\_0-9\]+$" }  
  pii\_redaction:  
    event\_name:          not\_pii  
    timestamp:           not\_pii  
    analytics\_user\_id:   opaque\_id\_only  
    schema\_version:      not\_pii  
    trial\_duration\_days: not\_pii  
    plan\_id:             not\_pii  
  retention\_class: standard\_analytics

### **`subscription_activated`**

\- event\_name: subscription\_activated  
  schema\_tier: strict  
  canonical\_event\_class: billing  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when a paid subscription first activates (trial → paid conversion OR direct paid signup). Source: Stripe invoice.paid webhook with billing\_reason set appropriately. Stripe dashboard is canonical for KPI-BIZ-02 paid\_subscriber\_count \+ KPI-BIZ-01 subscription\_conversion\_rate."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, plan\_id, activation\_source\]  
    properties:  
      event\_name:        { type: string, const: "subscription\_activated" }  
      timestamp:         { type: string, format: date-time }  
      analytics\_user\_id: { type: string, format: uuid }  
      schema\_version:    { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      plan\_id:           { type: string, pattern: "^\[a-z\_0-9\]+$" }  
      activation\_source: { type: string, enum: \[trial\_conversion, direct\_paid, reactivation\] }  
  pii\_redaction:  
    event\_name:        not\_pii  
    timestamp:         not\_pii  
    analytics\_user\_id: opaque\_id\_only  
    schema\_version:    not\_pii  
    plan\_id:           not\_pii  
    activation\_source: not\_pii  
  retention\_class: standard\_analytics

### **`subscription_renewed`**

\- event\_name: subscription\_renewed  
  schema\_tier: strict  
  canonical\_event\_class: billing  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when a subscription renews (Stripe invoice.paid with billing\_reason='subscription\_cycle'). Stripe is canonical for renewal cadence \+ MRR."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, plan\_id, renewal\_count\]  
    properties:  
      event\_name:        { type: string, const: "subscription\_renewed" }  
      timestamp:         { type: string, format: date-time }  
      analytics\_user\_id: { type: string, format: uuid }  
      schema\_version:    { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      plan\_id:           { type: string, pattern: "^\[a-z\_0-9\]+$" }  
      renewal\_count:     { type: integer, minimum: 1 }  
  pii\_redaction:  
    event\_name:        not\_pii  
    timestamp:         not\_pii  
    analytics\_user\_id: opaque\_id\_only  
    schema\_version:    not\_pii  
    plan\_id:           not\_pii  
    renewal\_count:     not\_pii  
  retention\_class: standard\_analytics

### **`subscription_cancelled`**

\- event\_name: subscription\_cancelled  
  schema\_tier: strict  
  canonical\_event\_class: billing  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when a user cancels their subscription (Stripe customer.subscription.deleted OR cancel\_at\_period\_end transition). Stripe is canonical for churn-rate body (KPI-BIZ-03 references Doc 09 FWD-07-01 for financial-side interpretation)."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, plan\_id, cancellation\_reason\_category\]  
    properties:  
      event\_name:                   { type: string, const: "subscription\_cancelled" }  
      timestamp:                    { type: string, format: date-time }  
      analytics\_user\_id:            { type: string, format: uuid }  
      schema\_version:               { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      plan\_id:                      { type: string, pattern: "^\[a-z\_0-9\]+$" }  
      cancellation\_reason\_category: { type: string, enum: \[user\_initiated, payment\_failed, exam\_passed, refund\_requested, unknown\] }  
  pii\_redaction:  
    event\_name:                   not\_pii  
    timestamp:                    not\_pii  
    analytics\_user\_id:            opaque\_id\_only  
    schema\_version:               not\_pii  
    plan\_id:                      not\_pii  
    cancellation\_reason\_category: not\_pii  
  retention\_class: standard\_analytics

### **`subscription_payment_failed`**

\- event\_name: subscription\_payment\_failed  
  schema\_tier: strict  
  canonical\_event\_class: billing  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when Stripe reports a failed subscription payment (invoice.payment\_failed). Stripe is canonical for dunning \+ retry logic."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, plan\_id, failure\_count\]  
    properties:  
      event\_name:        { type: string, const: "subscription\_payment\_failed" }  
      timestamp:         { type: string, format: date-time }  
      analytics\_user\_id: { type: string, format: uuid }  
      schema\_version:    { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      plan\_id:           { type: string, pattern: "^\[a-z\_0-9\]+$" }  
      failure\_count:     { type: integer, minimum: 1, description: "Sequential failure count on this subscription cycle." }  
  pii\_redaction:  
    event\_name:        not\_pii  
    timestamp:         not\_pii  
    analytics\_user\_id: opaque\_id\_only  
    schema\_version:    not\_pii  
    plan\_id:           not\_pii  
    failure\_count:     not\_pii  
  retention\_class: standard\_analytics

## **6.5 practice class (3 events)**

### **`practice_session_started`**

\- event\_name: practice\_session\_started  
  schema\_tier: strict  
  canonical\_event\_class: practice  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when a student starts a practice session (non-exam study activity)."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, practice\_session\_id, section\]  
    properties:  
      event\_name:          { type: string, const: "practice\_session\_started" }  
      timestamp:           { type: string, format: date-time }  
      analytics\_user\_id:   { type: string, format: uuid }  
      schema\_version:      { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      practice\_session\_id: { type: string, format: uuid }  
      section:             { type: string, enum: \[rw, math\] }  
  pii\_redaction:  
    event\_name:          not\_pii  
    timestamp:           not\_pii  
    analytics\_user\_id:   opaque\_id\_only  
    schema\_version:      not\_pii  
    practice\_session\_id: not\_pii  
    section:             not\_pii  
  retention\_class: standard\_analytics

### **`practice_question_submitted`**

\- event\_name: practice\_question\_submitted  
  schema\_tier: strict  
  canonical\_event\_class: practice  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when a student submits an answer to a practice question. Does NOT include the answer content (free-text PII vector); only correctness \+ metadata."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, practice\_session\_id, question\_id, is\_correct, time\_on\_question\_ms\]  
    properties:  
      event\_name:           { type: string, const: "practice\_question\_submitted" }  
      timestamp:            { type: string, format: date-time }  
      analytics\_user\_id:    { type: string, format: uuid }  
      schema\_version:       { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      practice\_session\_id:  { type: string, format: uuid }  
      question\_id:          { type: string, format: uuid }  
      is\_correct:           { type: boolean }  
      time\_on\_question\_ms:  { type: integer, minimum: 0 }  
  pii\_redaction:  
    event\_name:          not\_pii  
    timestamp:           not\_pii  
    analytics\_user\_id:   opaque\_id\_only  
    schema\_version:      not\_pii  
    practice\_session\_id: not\_pii  
    question\_id:         not\_pii  
    is\_correct:          not\_pii  
    time\_on\_question\_ms: not\_pii  
  retention\_class: standard\_analytics

### **`practice_session_completed`**

\- event\_name: practice\_session\_completed  
  schema\_tier: strict  
  canonical\_event\_class: practice  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when a student completes a practice session (explicit completion OR session timeout/abandonment)."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, practice\_session\_id, completion\_type, total\_questions, correct\_count\]  
    properties:  
      event\_name:          { type: string, const: "practice\_session\_completed" }  
      timestamp:           { type: string, format: date-time }  
      analytics\_user\_id:   { type: string, format: uuid }  
      schema\_version:      { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      practice\_session\_id: { type: string, format: uuid }  
      completion\_type:     { type: string, enum: \[explicit, timeout, abandonment\] }  
      total\_questions:     { type: integer, minimum: 0 }  
      correct\_count:       { type: integer, minimum: 0 }  
  pii\_redaction:  
    event\_name:          not\_pii  
    timestamp:           not\_pii  
    analytics\_user\_id:   opaque\_id\_only  
    schema\_version:      not\_pii  
    practice\_session\_id: not\_pii  
    completion\_type:     not\_pii  
    total\_questions:     not\_pii  
    correct\_count:       not\_pii  
  retention\_class: standard\_analytics

## **6.6 exam class (5 events; anchored on Doc 04 family canonical events)**

Exam events are emitted alongside the canonical Doc 04 family exam lifecycle. Per Decision 5, Doc 04 family owns the exam runtime \+ scoring canonical events; 07A's exam-class events are BI-side observations for cross-correlation with engagement / cohort / billing analytics. **07A does NOT restate Doc 04 family's `test_sessions` state machine or scoring formula** — those are canonical to Doc 04A V2.2 \+ Doc 04B V4.3.

### **`exam_started`**

\- event\_name: exam\_started  
  schema\_tier: strict  
  canonical\_event\_class: exam  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when a student starts a full-length SAT exam. BI-side observation; Doc 04A V2.2 \`test\_sessions\` table is canonical for exam state."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, test\_session\_id, test\_form\_id\]  
    properties:  
      event\_name:        { type: string, const: "exam\_started" }  
      timestamp:         { type: string, format: date-time }  
      analytics\_user\_id: { type: string, format: uuid }  
      schema\_version:    { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      test\_session\_id:   { type: string, format: uuid }  
      test\_form\_id:      { type: string, format: uuid }  
  pii\_redaction:  
    event\_name:        not\_pii  
    timestamp:         not\_pii  
    analytics\_user\_id: opaque\_id\_only  
    schema\_version:    not\_pii  
    test\_session\_id:   not\_pii  
    test\_form\_id:      not\_pii  
  retention\_class: standard\_analytics

### **`exam_section_submitted`**

\- event\_name: exam\_section\_submitted  
  schema\_tier: strict  
  canonical\_event\_class: exam  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when a student submits an exam section (RW or Math). BI-side observation; Doc 04A V2.2 \`test\_session\_sections\` is canonical."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, test\_session\_id, section, module, section\_duration\_ms\]  
    properties:  
      event\_name:          { type: string, const: "exam\_section\_submitted" }  
      timestamp:           { type: string, format: date-time }  
      analytics\_user\_id:   { type: string, format: uuid }  
      schema\_version:      { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      test\_session\_id:     { type: string, format: uuid }  
      section:             { type: string, enum: \[RW, M\] }  
      module:              { type: string, enum: \["1", "2A", "2B"\] }  
      section\_duration\_ms: { type: integer, minimum: 0 }  
  pii\_redaction:  
    event\_name:          not\_pii  
    timestamp:           not\_pii  
    analytics\_user\_id:   opaque\_id\_only  
    schema\_version:      not\_pii  
    test\_session\_id:     not\_pii  
    section:             not\_pii  
    module:              not\_pii  
    section\_duration\_ms: not\_pii  
  retention\_class: standard\_analytics

### **`exam_completed`**

\- event\_name: exam\_completed  
  schema\_tier: strict  
  canonical\_event\_class: exam  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when a student completes a full-length exam (all sections submitted). BI-side observation; Doc 04B V4.3 scoring is canonical for the score itself (this event does NOT include the scaled score; that's the scoring system's canonical output)."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, test\_session\_id, total\_duration\_ms\]  
    properties:  
      event\_name:        { type: string, const: "exam\_completed" }  
      timestamp:         { type: string, format: date-time }  
      analytics\_user\_id: { type: string, format: uuid }  
      schema\_version:    { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      test\_session\_id:   { type: string, format: uuid }  
      total\_duration\_ms: { type: integer, minimum: 0 }  
  pii\_redaction:  
    event\_name:        not\_pii  
    timestamp:         not\_pii  
    analytics\_user\_id: opaque\_id\_only  
    schema\_version:    not\_pii  
    test\_session\_id:   not\_pii  
    total\_duration\_ms: not\_pii  
  retention\_class: standard\_analytics

### **`exam_section_partial_abandoned`**

\- event\_name: exam\_section\_partial\_abandoned  
  schema\_tier: strict  
  canonical\_event\_class: exam  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when an exam is abandoned mid-section (per Doc 04A V2.2 \`test\_session\_partial\_scored\_abandoned\` outbox event). BI-side observation."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, test\_session\_id, last\_section\_active\]  
    properties:  
      event\_name:          { type: string, const: "exam\_section\_partial\_abandoned" }  
      timestamp:           { type: string, format: date-time }  
      analytics\_user\_id:   { type: string, format: uuid }  
      schema\_version:      { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      test\_session\_id:     { type: string, format: uuid }  
      last\_section\_active: { type: string, enum: \[RW, M\] }  
  pii\_redaction:  
    event\_name:          not\_pii  
    timestamp:           not\_pii  
    analytics\_user\_id:   opaque\_id\_only  
    schema\_version:      not\_pii  
    test\_session\_id:     not\_pii  
    last\_section\_active: not\_pii  
  retention\_class: standard\_analytics

### **`exam_resumed`**

\- event\_name: exam\_resumed  
  schema\_tier: strict  
  canonical\_event\_class: exam  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when a previously-active exam session resumes (Doc 04A V2.2 resume-from-\`section\_break\` state). BI-side observation."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, test\_session\_id, resume\_from\_state\]  
    properties:  
      event\_name:        { type: string, const: "exam\_resumed" }  
      timestamp:         { type: string, format: date-time }  
      analytics\_user\_id: { type: string, format: uuid }  
      schema\_version:    { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      test\_session\_id:   { type: string, format: uuid }  
      resume\_from\_state: { type: string, enum: \[section\_break, module1\_submitted, module2\_active\] }  
  pii\_redaction:  
    event\_name:        not\_pii  
    timestamp:         not\_pii  
    analytics\_user\_id: opaque\_id\_only  
    schema\_version:    not\_pii  
    test\_session\_id:   not\_pii  
    resume\_from\_state: not\_pii  
  retention\_class: standard\_analytics

## **6.7 tutor class (2 events; BI-side observations only per Decision 5\)**

Per Parent §10.6 KPI-TUT-02 carve-out \+ Doc 03 Main V1.1 §0.6 deferral: **07A's tutor-class events register lifecycle (start / end) only, not effectiveness measures.** No `tutor_helped` / `tutor_failed` events at V1; those reservations are Doc 03 family's call to add when attribution is solved.

### **`tutor_session_started`**

\- event\_name: tutor\_session\_started  
  schema\_tier: strict  
  canonical\_event\_class: tutor  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when a student initiates a LISA tutor session. BI-side observation; Doc 03 Main §11 owns LISA usage caps \+ Doc 03 Main §24 owns LISA cost discipline. Does NOT include tutor prompt content."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, tutor\_session\_id, tutor\_entry\_mode\]  
    properties:  
      event\_name:        { type: string, const: "tutor\_session\_started" }  
      timestamp:         { type: string, format: date-time }  
      analytics\_user\_id: { type: string, format: uuid }  
      schema\_version:    { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      tutor\_session\_id:  { type: string, format: uuid }  
      tutor\_entry\_mode:  { type: string, enum: \[scoped\_question, scoped\_session, general\] }  
  pii\_redaction:  
    event\_name:        not\_pii  
    timestamp:         not\_pii  
    analytics\_user\_id: opaque\_id\_only  
    schema\_version:    not\_pii  
    tutor\_session\_id:  not\_pii  
    tutor\_entry\_mode:  not\_pii  
  retention\_class: standard\_analytics

### **`tutor_session_ended`**

\- event\_name: tutor\_session\_ended  
  schema\_tier: strict  
  canonical\_event\_class: tutor  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when a LISA tutor session ends. NO helped/failed/effectiveness measurement at V1 per Parent §10.6 KPI-TUT-02 carve-out — attribution is non-deterministic at V1; the canonical name is reserved for V1.1+ when attribution is solved."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, tutor\_session\_id, session\_duration\_ms, turn\_count\]  
    properties:  
      event\_name:          { type: string, const: "tutor\_session\_ended" }  
      timestamp:           { type: string, format: date-time }  
      analytics\_user\_id:   { type: string, format: uuid }  
      schema\_version:      { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      tutor\_session\_id:    { type: string, format: uuid }  
      session\_duration\_ms: { type: integer, minimum: 0 }  
      turn\_count:          { type: integer, minimum: 0 }  
  pii\_redaction:  
    event\_name:          not\_pii  
    timestamp:           not\_pii  
    analytics\_user\_id:   opaque\_id\_only  
    schema\_version:      not\_pii  
    tutor\_session\_id:    not\_pii  
    session\_duration\_ms: not\_pii  
    turn\_count:          not\_pii  
  retention\_class: standard\_analytics

## **6.8 mastery class (2 events; BI-side observations only per Decision 5\)**

Per Decision 5 \+ Parent §2.4 mastery-KPI boundary: **07A's mastery-class events emit BI-side observations alongside Doc 05A's canonical `apply_mastery_event` / `mastery_event_audit_log` writes; they are NOT duplicates of the audit-log row and NEVER restate 05B mastery math.**

### **`mastery_event_observed`**

\- event\_name: mastery\_event\_observed  
  schema\_tier: strict  
  canonical\_event\_class: mastery  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted alongside (NOT instead of) Doc 05A apply\_mastery\_event RPC firing. BI-side observation for analytics correlation between mastery events and engagement / cohort / billing. Doc 05A mastery\_event\_audit\_log is the canonical audit trail; 07A's event is a separate analytics-side observation. Does NOT include the per-event acc contribution math (Doc 05B canonical) — only event metadata."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, skill\_id, event\_source\_kind, is\_correct\]  
    properties:  
      event\_name:        { type: string, const: "mastery\_event\_observed" }  
      timestamp:         { type: string, format: date-time }  
      analytics\_user\_id: { type: string, format: uuid }  
      schema\_version:    { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      skill\_id:          { type: string, format: uuid }  
      event\_source\_kind: { type: string, enum: \[test, practice, review\] }  
      is\_correct:        { type: boolean }  
  pii\_redaction:  
    event\_name:        not\_pii  
    timestamp:         not\_pii  
    analytics\_user\_id: opaque\_id\_only  
    schema\_version:    not\_pii  
    skill\_id:          not\_pii  
    event\_source\_kind: not\_pii  
    is\_correct:        not\_pii  
  retention\_class: standard\_analytics

### **`mastery_level_changed`**

\- event\_name: mastery\_level\_changed  
  schema\_tier: strict  
  canonical\_event\_class: mastery  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when a student's mastery\_level for a skill or domain transitions per Doc 05B canonical mastery-level transition logic (level boundaries are owned canonically by Doc 05B §3-§5 and are NOT restated here per Decision 5 \+ RB-07A-V1-08). BI-side observation. The mastery\_level integer 1-5 is the only canonical mastery field exposed to read surfaces per Doc 05 Parent acceptance criterion \#20."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, entity\_kind, entity\_id, previous\_mastery\_level, new\_mastery\_level\]  
    properties:  
      event\_name:             { type: string, const: "mastery\_level\_changed" }  
      timestamp:              { type: string, format: date-time }  
      analytics\_user\_id:      { type: string, format: uuid }  
      schema\_version:         { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      entity\_kind:            { type: string, enum: \[skill, domain\] }  
      entity\_id:              { type: string, format: uuid }  
      previous\_mastery\_level: { type: \["integer", "null"\], minimum: 1, maximum: 5, description: "null if first transition from cold-start" }  
      new\_mastery\_level:      { type: integer, minimum: 1, maximum: 5 }  
  pii\_redaction:  
    event\_name:             not\_pii  
    timestamp:              not\_pii  
    analytics\_user\_id:      opaque\_id\_only  
    schema\_version:         not\_pii  
    entity\_kind:            not\_pii  
    entity\_id:              not\_pii  
    previous\_mastery\_level: not\_pii  
    new\_mastery\_level:      not\_pii  
  retention\_class: standard\_analytics

## **6.9 system class (2 events)**

### **`error_caught`**

\- event\_name: error\_caught  
  schema\_tier: strict  
  canonical\_event\_class: system  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when a frontend or backend error is caught \+ classified for analytics. The error message body is REDACTED (drop method) per §8; only error\_class \+ error\_severity are sent. Sentry is the canonical error-tracking system; this event exists for product-analytics correlation between errors and user / session behavior."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, error\_class, error\_severity, error\_origin\]  
    properties:  
      event\_name:        { type: string, const: "error\_caught" }  
      timestamp:         { type: string, format: date-time }  
      analytics\_user\_id: { type: string, format: uuid }  
      schema\_version:    { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      error\_class:       { type: string, pattern: "^\[A-Z\]\[A-Za-z0-9\]+Error$", description: "Classification only, e.g., 'NetworkError', 'ValidationError'; NEVER raw error messages" }  
      error\_severity:    { type: string, enum: \[low, medium, high, critical\] }  
      error\_origin:      { type: string, enum: \[frontend, backend, webhook\] }  
  pii\_redaction:  
    event\_name:        not\_pii  
    timestamp:         not\_pii  
    analytics\_user\_id: opaque\_id\_only  
    schema\_version:    not\_pii  
    error\_class:       not\_pii  
    error\_severity:    not\_pii  
    error\_origin:      not\_pii  
  retention\_class: standard\_analytics

### **`consent_captured`**

\- event\_name: consent\_captured  
  schema\_tier: strict  
  canonical\_event\_class: system  
  owner: "07A V1.0"  
  V1\_active: true  
  schema\_version: "1.0.0"  
  description: "Emitted when a user captures a consent event (COPPA / FERPA / general TOS acknowledgment). Does NOT include the consent body itself — only consent\_type \+ consent\_version metadata for analytics correlation."  
  json\_schema:  
    type: object  
    additionalProperties: false  
    required: \[event\_name, timestamp, analytics\_user\_id, schema\_version, consent\_type, consent\_version\]  
    properties:  
      event\_name:        { type: string, const: "consent\_captured" }  
      timestamp:         { type: string, format: date-time }  
      analytics\_user\_id: { type: string, format: uuid }  
      schema\_version:    { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
      consent\_type:      { type: string, enum: \[coppa\_parental, ferpa\_acknowledgment, tos, privacy\_policy, marketing\_optin\] }  
      consent\_version:   { type: string, pattern: "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" }  
  pii\_redaction:  
    event\_name:        not\_pii  
    timestamp:         not\_pii  
    analytics\_user\_id: opaque\_id\_only  
    schema\_version:    not\_pii  
    consent\_type:      not\_pii  
    consent\_version:   not\_pii  
  retention\_class: standard\_analytics

---

# **§7 — Person Properties Contract**

PostHog Person Properties are user-attached key-value attributes that follow the user across events and enable cohort filtering (per §10). 07A V1 declares **4 Person Properties**.

## **7.1 `analytics_user_id`**

The canonical analytics identifier per RB-07-Parent-V1-04 server-generated-opaque-only constraint.

**Deterministic derivation algorithm (RB-07A-V1-05):** Per the original draft's "HMAC-SHA256 truncated to UUID format" was under-specified — HMAC-SHA256 outputs 256 bits, UUIDs are 128 bits with specific version/variant bit positions per RFC 4122\. The corrected algorithm is deterministic:

1\. raw\_hmac \= HMAC-SHA256(key \= ANALYTICS\_SALT, message \= supabase\_user\_id\_as\_bytes)  
2\. first\_128\_bits \= raw\_hmac\[0:16\]  (take the first 16 bytes / 128 bits)  
3\. Apply UUIDv4-shaped bit settings per RFC 4122 §4.4 (deterministic-but-UUID-format-valid):  
   \- Set bits \[48:52\] to 0100 (UUID version 4\)  
   \- Set bits \[64:66\] to 10   (UUID variant RFC 4122\)  
4\. Format as canonical 8-4-4-4-12 hyphenated lowercase hex string  
5\. analytics\_user\_id \= the resulting UUID string

The result is a **deterministic-from-supabase\_user\_id-and-salt, UUIDv4-shaped string** — same input always produces the same output (immutability); different `ANALYTICS_SALT` produces a different output (per-environment isolation; future salt rotation produces a clean break); the UUIDv4-shape makes it schema-valid against the `format: uuid` JSON Schema constraint in every event payload. **Note:** the resulting value is NOT cryptographically a UUIDv4 (which requires actual random bits); it is **shaped like a UUIDv4 for schema compatibility** but its randomness comes from HMAC-SHA256 of the (supabase\_user\_id, salt) pair. This is the documented trade-off; the alternative (raw 32-char hex without UUID shape) would require a non-UUID JSON Schema constraint and complicate the registry.

**Computed ONCE at signup** (`user_signed_up` event handler) and stored as an immutable column on the user record. The wrapper library (§9) reads this column on every emission. **Mutability:** immutable. Once computed at signup, the value never changes. If the salt rotates V1.1+, the `analytics_user_id` field changes — but that's a planned migration event with explicit dual-salt grace period, not arbitrary change.

**Why HMAC \+ salt, not raw Supabase user\_id:** per Parent RB-07-Parent-V1-04 forbidden-identifier-types list, stable cross-system identifiers are a re-identification vector. Raw Supabase user\_id would be such an identifier (someone with both Supabase data and PostHog data could join by raw UUID). HMAC \+ salt prevents this — PostHog and Supabase share NO common identifier without the salt.

**Per-environment salts:** `ANALYTICS_SALT_DEV`, `ANALYTICS_SALT_STAGING`, `ANALYTICS_SALT_PROD` — stored as Supabase environment secrets per family-wide §8.7 / RB-06D-V1-10 secret-handling rule \+ Doc 01A §61 secret-config doctrine. Salt rotation is V1.1+ target-state (V1 ships one salt per env).

| Field | Value |
| ----- | ----- |
| property\_name | `analytics_user_id` |
| type | string (UUIDv4-shaped per algorithm above) |
| mutability | immutable |
| derivation | Deterministic algorithm per §7.1 above: `HMAC-SHA256(ANALYTICS_SALT, supabase_user_id)` → first 128 bits → set UUID version 4 \+ variant RFC 4122 bits → format as canonical UUID string |
| pii\_redaction\_method | `opaque_id_only` |
| retention\_class | `standard_analytics` |

## **7.2 `exam_date`**

The student's target SAT exam date.

| Field | Value |
| ----- | ----- |
| property\_name | `exam_date` |
| type | string (ISO 8601 date) |
| mutability | mutable (via `exam_date_set_via_calendar_prompt` and `exam_date_changed_in_settings`) |
| derivation | Initially set by `exam_date_set_at_signup` (user-provided or default-to-next-test-date per §10); updated by calendar-prompt or settings-change events |
| pii\_redaction\_method | `not_pii` |
| retention\_class | `standard_analytics` |

## **7.3 `exam_date_cohort_id`**

The cohort identifier derived from `exam_date` per the SAT test calendar.

| Field | Value |
| ----- | ----- |
| property\_name | `exam_date_cohort_id` |
| type | string (pattern `^[a-z]+_\d{4}$`, e.g., `may_2026`, `june_2026`, `october_2026`) |
| mutability | mutable (recomputed whenever `exam_date` changes) |
| derivation | Lookup against `infra/sat-test-calendar.yaml`: find the SAT administration whose date matches `exam_date`; cohort\_id \= `<month_name>_<year>` for that administration. See §10 for the lookup logic \+ the "default to next test date" rule. |
| pii\_redaction\_method | `not_pii` |
| retention\_class | `standard_analytics` |

## **7.4 `exam_date_source`**

The provenance of the current `exam_date` — which event set it.

| Field | Value |
| ----- | ----- |
| property\_name | `exam_date_source` |
| type | string (enum: `signup` / `calendar_prompt` / `settings_change` / `default_next_test`) |
| mutability | mutable (set by each cohort-class event when it fires) |
| derivation | `signup` when `exam_date_set_at_signup` fires; `calendar_prompt` when `exam_date_set_via_calendar_prompt` fires; `settings_change` when `exam_date_changed_in_settings` fires; `default_next_test` when the student signed up without setting an exam date and the system applied the default-to-next-test-date rule per §10 |
| pii\_redaction\_method | `not_pii` |
| retention\_class | `standard_analytics` |

## **7.5 Person Property update contract**

When a cohort-class event fires, the wrapper library (§9) MUST update PostHog Person Properties for the user as part of the emission:

* `exam_date_set_at_signup` → sets `exam_date`, `exam_date_cohort_id`, `exam_date_source` (= `signup` or `default_next_test`)  
* `exam_date_set_via_calendar_prompt` → updates `exam_date`, `exam_date_cohort_id`, `exam_date_source` (= `calendar_prompt`)  
* `exam_date_changed_in_settings` → updates `exam_date`, `exam_date_cohort_id`, `exam_date_source` (= `settings_change`)

Per RB-07A-V1-03, the wrapper applies these Person Property updates via the **PostHog Node.js SDK's `identify()` method or event-attached `$set`** (see §9.3.2 for exact SDK paths). The two SDK calls happen in the **same logical emission operation** within the wrapper invocation — but this is NOT a database-style atomic transaction. PostHog SDK batches events and identify calls separately; cross-call durability is bounded by PostHog SDK retry semantics. V1.1+ may introduce stronger guarantees if PostHog adds dual-write transactional support.

---

# **§8 — PII Redaction Contract**

## **8.1 The redaction-method enums (RB-07A-V1-06 split)**

Per Parent Q-07A-4=(β), every property on every event \+ every Person Property declares its PII redaction posture. Per RB-07A-V1-06, the redaction-method enum is **split into two enums** so that `hash_server_local` (which is documented as proof-artifact-only) cannot accidentally be selected as a runtime emission posture and leak a hashed identifier to PostHog:

### **8.1.1 `event_redaction_method` (runtime enum — used in `pii_redaction` entries on every event registry entry)**

| Method | Semantics | Example use |
| ----- | ----- | ----- |
| `not_pii` | Property is explicitly non-PII; no redaction needed. Declared positively (silence is NOT acceptable). | `event_name`, `timestamp`, `is_correct`, `section`, `error_class` |
| `opaque_id_only` | Property is an opaque server-generated identifier (UUID or HMAC-derived per §7.1); no derivation back to user identity. | `analytics_user_id`, `practice_session_id`, `tutor_session_id`, `test_session_id`, `skill_id`, `question_id` |
| `bucket` | Continuous or fine-grained value redacted to coarse bucket. Example: numerical age redacted to bracket (`13-15`, `16-17`, `18+`). | Currently unused at V1 (no continuous PII-ish properties in V1 events) |
| `drop` | Property is captured at emission boundary but DROPPED before send. Used for fields whose presence is meaningful for runtime processing but whose value cannot leave the application boundary. | `error_caught.error_message_body` (captured for Sentry forwarding; dropped from PostHog payload) — note this property is NOT in the strict-tier JSON Schema; the wrapper handles the drop internally |

**The `event_redaction_method` runtime enum is the 4-method enum used in `pii_redaction` for every event registry entry. `hash_server_local` is explicitly excluded from the runtime enum** per RB-07A-V1-06 — a registry entry that declares `hash_server_local` as the redaction posture for an event property is a `ci/pii-redaction-conformance` hard-fail (the only allowed use of hashing is in proof artifacts, NOT in event payloads sent to PostHog).

### **8.1.2 `proof_artifact_redaction_method` (proof-artifact-only enum)**

This enum applies ONLY to fields written to proof artifacts (the `unredacted_property_count` / `posture_coverage_percent` / `emit_to_ingest_latency_ms`\-style metadata fields in §11.4) and never to event payloads sent to PostHog.

| Method | Semantics |
| ----- | ----- |
| `not_pii` | Field carries no PII (metadata, counts, timestamps, latencies). |
| `bucket` | Bucketed metadata if needed. |
| `hash_server_local` | Hash with proof-run-local salt per family-wide §8.7 / RB-06D-V1-10 — used only when a proof artifact must include an identifier-like field for diagnostic traceability without exposing the underlying identifier. |
| `drop` | Field captured for upstream diagnostic systems (e.g., Sentry) but dropped from the proof artifact written to the audit stream. |

`opaque_id_only` is intentionally NOT in the proof-artifact enum — proof artifacts MUST NOT carry user identifiers in any form (per §8.7 family-wide rule). If diagnostic traceability requires identifier-shaped data in a proof artifact, the only allowed method is `hash_server_local`.

The two-enum split closes the future-path-for-hashed-identifiers-to-leave-the-app concern that the original draft's single-enum design (where `hash_server_local` was documented-but-unenforced as proof-artifact-only) left open.

## **8.2 The contract**

**Per-property declaration is mandatory.** Per `ci/pii-redaction-conformance`, every entry's `pii_redaction` key set MUST equal the entry's `json_schema.properties` key set (for strict tier) OR the entry's `base_required_fields` set (for loose tier). No orphan property in either direction.

**Silence is not acceptable.** A property that is genuinely non-PII MUST declare `not_pii` explicitly. This forces every property author to think about the PII posture; silent assumption is not allowed.

**Wrapper enforces at runtime.** Per §9 wrapper contract: when `emitEvent` is called, the wrapper reads the registry entry, walks each property in the payload, applies the declared redaction method, and sends the redacted payload to PostHog. A property in the payload without a registry entry → wrapper rejects the emission (logs to proof artifact stream, drops the event).

## **8.3 The two-layer defense**

| Layer | Mechanism | Failure mode |
| ----- | ----- | ----- |
| CI-side (static) | `ci/pii-redaction-conformance` validates registry consistency at PR time | Hard-fail at V1 (PII discipline is always-strict) |
| Runtime (dynamic) | `emitEvent` wrapper applies redaction per registry posture before send | Wrapper logs structured failure \+ drops event (non-alerting per INV-07-09) |

CI catches registry-side errors (missing posture, mismatched property sets). Runtime catches code-side errors (payload with unexpected property, redaction-method mismatch). Both required.

## **8.4 The `not_pii` discipline**

A property declared `not_pii` is a positive claim that the property's value cannot identify a user. Examples of `not_pii` properties:

* Constants (`event_name`, `schema_version` value)  
* Timestamps (the timestamp alone doesn't identify; only timestamp \+ other PII does, and the other PII is independently redacted)  
* Server-generated opaque IDs (already redacted via `opaque_id_only`; `not_pii` is for IDs that are themselves non-identifying like `section`, `module`, enum values)  
* Booleans  
* Bounded enums whose value space is small (`section: rw | math`, `severity: low | medium | high | critical`)  
* Counts and durations (`time_on_question_ms`, `total_questions`, `correct_count`)

**A `not_pii` declaration on a free-text property is a defect.** CI does not statically detect this — humans \+ code review must flag. If a free-text-shaped property needs to enter the registry, the posture should be `drop` (don't send) or `hash_server_local` (proof-artifact only). 07A V1 has NO free-text properties in any V1 event registry entry by design.

---

# **§9 — Emission Wrapper Library (`emitEvent`)**

## **9.1 The contract**

`emitEvent` is the single emission boundary into PostHog. Per Q-07A-5=(β), application code calls `emitEvent` exclusively; the PostHog SDK is imported only inside the wrapper itself.

// Conceptual signature (TypeScript shape; actual implementation per Doc 07 Parent §6.13 implemented-definition table)  
emitEvent(  
  eventName: string,  
  payload: Record\<string, unknown\>,  
  options?: {  
    personPropertyUpdates?: Record\<string, unknown\>;  // For cohort-class events  
  }  
): Promise\<{ ok: boolean; reason?: string }\>;

## **9.2 What the wrapper does (deterministic sequential steps)**

Per RB-07A-V1-02, the deterministic sequence below replaces the original draft's order (which validated against `json_schema` before injecting base fields — impossible since base fields are in `json_schema.required` for every strict-tier entry). The corrected order treats the wrapper as a **security boundary**, not just a convenience helper: caller-supplied base fields are rejected (not just overwritten) to remove spoofing surface; final payload validation runs after canonical injection; redaction runs after validation so the validated payload is what gets redacted.

1. **Reject direct SDK usage outside wrapper** — enforced at lint/build time (see §9.4); the wrapper module is the only file in the codebase that imports the PostHog SDK.  
2. **Resolve authenticated server user** via session context. Per RB-07A-V1-09, **all V1 events including `user_signed_up` fire identified** — the wrapper has no pre-auth/anonymous path at V1. `user_signed_up` is emitted from the post-signup-transaction handler, after the Supabase user row is created AND the `analytics_user_id` column has been computed and persisted (per §7.1 derivation algorithm). This makes `user_signed_up` schema-valid (the `analytics_user_id` field is present and required) and removes the contradiction between the original draft's "pre-auth event" framing and the strict schema's `analytics_user_id` requirement. If session context cannot resolve an authenticated user when `emitEvent` is called, the wrapper rejects the emission (logs structured error; returns `{ ok: false, reason: "unauthenticated_emission_attempt" }`) — no anonymous fallback exists at V1.  
3. **Load immutable `analytics_user_id`** from the user record in Supabase (cached in memory after first lookup for the session).  
4. **Reject caller-supplied base fields.** The caller MUST NOT pass `event_name`, `timestamp`, `analytics_user_id`, or `schema_version` in the `payload` argument. If any of these keys appear in the caller payload, the wrapper rejects the emission (logs structured error; returns `{ ok: false, reason: "caller_supplied_base_field" }`). This removes the spoofing surface — base fields are wrapper-canonical, not caller-trusted.  
5. **Look up the event entry** in `infra/event-schema-registry.yaml` by `eventName`. If no entry exists → reject emission; log structured failure; return `{ ok: false, reason: "event_not_registered" }`. (This is the runtime complement to `ci/event-schema-registry-parity` static check.)  
6. **Inject canonical base fields**: `event_name` (const from registry), `timestamp` (now, UTC ISO 8601), `analytics_user_id` (from step 3), `schema_version` (from registry entry). These four fields are wrapper-canonical; caller payload contributes only the event-specific non-base fields.  
7. **Construct the final payload** by merging the sanitized caller payload (caller fields minus any rejected base-field keys from step 4\) with the injected base fields. The merge is deterministic: injected base fields take precedence (caller cannot override even if step 4 missed something).  
8. **Validate the final payload against the registry's `json_schema`** (strict tier) OR `base_required_fields` (loose tier). On validation failure → reject; log structured failure; return `{ ok: false, reason: "schema_validation_failed", details: <error> }`. The dropped event is the known cost of strict validation; the alternative (passing invalid events through) is worse for analytics integrity.  
9. **Apply per-property PII redaction** per the registry entry's `pii_redaction` map: walk each property in the final payload, apply the declared redaction method per §8.1 enum (`event_redaction_method` per RB-07A-V1-06 split — runtime enum excludes `hash_server_local`). Result is the **redacted payload** ready for emission.  
10. **Send through the exact PostHog SDK call path** (see §9.3.1 for the precise signature per RB-07A-V1-03 — no more "atomic" overclaim).  
11. **If `options.personPropertyUpdates` is present** (only valid for cohort-class events per §7.5) → emit the Person Property update as the same logical emission operation via PostHog SDK's documented path (see §9.3.2). This is NOT a database transaction; per RB-07A-V1-03, the wrapper does not claim atomicity beyond what PostHog SDK provides.  
12. **Write proof artifact** with no payload body — only event name \+ emission timestamp \+ ingestion confirmation timestamp \+ latency (per family-wide §8.7 / RB-06D-V1-10 no-PII proof-artifact rule).  
13. Return `{ ok: true }`.

## **9.3 Exact PostHog SDK call paths**

Per RB-07A-V1-03, the original draft used the underspecified phrasing "Call PostHog SDK `capture(eventName, redactedPayload, { distinctId: analyticsUserId })` ... atomically with the event" — that's database-transaction language PostHog SDKs don't provide. The corrected contract specifies the exact PostHog SDK call paths.

### **9.3.1 Server-side emission (the V1 default for all Lyceon events)**

V1 events emit server-side (from Lyceon backend code, not browser) using the **PostHog Node.js SDK** (`posthog-node`). The exact server-side signature is:

// Server-side via posthog-node — V1 default  
posthog.capture({  
  distinctId: analyticsUserId,    // The HMAC-derived opaque user\_id from §7.1  
  event: eventName,               // The canonical event name from registry  
  properties: redactedPayload,    // Already validated \+ redacted per §9.2 steps 8-9  
  timestamp: new Date(),          // From wrapper step 6 base-field injection  
});

This is the only V1 SDK call path for event emission. Browser-side `posthog-js` is NOT used at V1 (no autocapture, no client-side `posthog.capture()` calls; all emissions are server-side from authenticated request handlers OR webhook handlers).

### **9.3.2 Person Property updates (cohort-class events only)**

Per §7.5, cohort-class events update PostHog Person Properties. The exact server-side path is `posthog-node`'s `identify()` method or attaching `$set` to the event:

// Option A — separate identify call (preferred for clarity, V1 default)  
posthog.identify({  
  distinctId: analyticsUserId,  
  properties: personPropertyUpdates,   // e.g., { exam\_date, exam\_date\_cohort\_id, exam\_date\_source }  
});

// Option B — $set attached to the event capture (alternative; same SDK; equivalent effect)  
// Per RB-07A-V1-12 / PostHog Node SDK docs: $set goes INSIDE the properties object, not at top level  
posthog.capture({  
  distinctId: analyticsUserId,  
  event: eventName,  
  properties: {  
    ...redactedPayload,  
    $set: personPropertyUpdates,         // PostHog interprets $set inside properties as Person Property update  
  },  
});

**Atomicity disclaimer (per RB-07A-V1-03):** PostHog Node.js SDK batches events and Person Property updates separately in its in-memory queue, then flushes to PostHog's ingestion endpoint asynchronously. **The wrapper does NOT claim database-style atomicity.** What the wrapper guarantees is that the two SDK calls happen in the **same logical emission operation** within the wrapper invocation — both calls execute sequentially before the wrapper returns, both errors propagate to the caller if either fails, and both are dropped together if validation rejects the emission upstream. Cross-call durability (i.e., the event captured but the Person Property update lost, or vice versa) is bounded by PostHog SDK retry semantics, not Lyceon-side transaction semantics. V1.1+ may introduce stronger guarantees if PostHog ships dual-write transactional support; V1 ships with the SDK's documented behavior.

### **9.3.3 Webhook-handler emissions (billing class)**

Billing-class events (§6.4) emit from Stripe webhook handlers, which run server-side post-Stripe-signature-verification. The same `posthog-node` SDK and same emission contract apply; the only difference is that the authenticated server user (step 2 of §9.2) resolves from the Stripe webhook's customer-ID-to-Lyceon-user lookup, not from an active session context.

## **9.4 What the wrapper does NOT do (PostHog SDK handles natively)**

* **Batching** — PostHog SDK batches events natively per its configuration.  
* **Retry** — PostHog SDK retries failed sends per its configuration.  
* **Delivery confirmation** — PostHog SDK handles delivery; the wrapper's promise resolves once the SDK accepts the event into its batch buffer.  
* **Session tracking** — PostHog session tracking is native; the wrapper does not emit `session_started` / `session_ended` events.  
* **Schema versioning of the wire format** — PostHog handles event-payload-format compatibility natively.  
* **Autocapture** — per §3 threat 9, autocapture is DISABLED at V1 (`autocapture: false` in PostHog SDK config); the wrapper does not handle DOM events.

## **9.5 Bypass enforcement**

Per §3 threat 4, the wrapper is only effective if application code uses it exclusively. Three-layer defense:

1. **Code organization**: the PostHog SDK is imported only inside the wrapper module; no other file imports the SDK directly.  
2. **Lint rule**: a custom ESLint rule (or equivalent for non-TS code) flags any import of the PostHog SDK outside the wrapper module.  
3. **CI verification at V1.1+**: when warehouse-side event-stream validation activates, `ci/event-schema-registry-parity` extends to verify the actual ingested events match the registry — catching any wrapper bypass at the network boundary even if lint missed it.

## **9.6 Estimated implementation size**

\~120-180 LOC for the wrapper module (per RB-07A-V1-02 corrected sequence \+ RB-07A-V1-03 explicit SDK paths; the deterministic sequence is longer than the original draft's lighter version by \~40-60 LOC) \+ \~20-40 LOC for the lint rule preventing direct SDK imports. Single-file scope for the wrapper module; testable in isolation; deletable when V1.1+ infrastructure adds equivalent enforcement at the warehouse-export boundary.

---

# **§10 — Cohort Definition & SAT Test Calendar**

## **10.1 The cohort definition**

Per Doc 07 Parent decision (Karl override on Q-07A-5-equivalent): **Lyceon cohorts students by exam date (the next-upcoming SAT test date the student is preparing for), not by signup date.** Industry-standard SaaS cohorts by signup-week / signup-month; Lyceon's edtech-specific override anchors on exam-date because time-to-exam is the primary determinant of user behavior in test-prep platforms.

The cohort identifier is the SAT administration date the student is preparing for, formatted as `<lowercase_month_name>_<year>` (e.g., `may_2026`, `june_2026`, `october_2026`). Granularity is per-SAT-administration (\~7/year), not per-month (per Karl decision \#4 in current pre-draft round).

## **10.2 The SAT test calendar reference file**

`infra/sat-test-calendar.yaml` is a one-and-done annual reference file maintained per Karl decision \#2 in current pre-draft round. Per RB-07A-V1-04, the file includes provenance fields (`source_url`, `retrieved_at`) and `ci/sat-test-calendar-freshness` (§10.5) blocks deploy if these are missing or if the dates contradict the cited source:

\# infra/sat-test-calendar.yaml  
\# Canonical SAT administration calendar for cohort assignment per Doc 07A V1.0 §10.  
\# Maintained annually as College Board publishes new dates.

schema\_version: "1.0.0"  
last\_updated: "2026-05-25"  
owner\_doc: "07A V1.0"  
source: "College Board official SAT test dates calendar"  
source\_url: "https://satsuite.collegeboard.org/sat/dates-deadlines"  
retrieved\_at: "2026-05-25"

\# The sample below reflects the official College Board calendar as retrieved on retrieved\_at.  
\# Past administrations (e.g., March 14 2026, May 2 2026 if before today) are retained for cohort\_id  
\# continuity of users whose exam\_date\_cohort\_id was assigned before the date passed; the calendar-freshness  
\# check (§10.5) only requires that at least one future-dated administration exists ≥ today \+ 30 days.

administrations:  
  \- date: "2026-03-14"  
    cohort\_id: "march\_2026"  
  \- date: "2026-05-02"  
    cohort\_id: "may\_2026"  
  \- date: "2026-06-06"  
    cohort\_id: "june\_2026"  
  \- date: "2026-08-22"  
    cohort\_id: "august\_2026"  
  \- date: "2026-09-12"  
    cohort\_id: "september\_2026"  
  \- date: "2026-10-03"  
    cohort\_id: "october\_2026"  
  \- date: "2026-11-07"  
    cohort\_id: "november\_2026"  
  \- date: "2026-12-05"  
    cohort\_id: "december\_2026"  
  \- date: "2027-03-06"  
    cohort\_id: "march\_2027"  
  \- date: "2027-05-01"  
    cohort\_id: "may\_2027"  
  \- date: "2027-06-05"  
    cohort\_id: "june\_2027"  
  \# Additional administrations through 24 months forward are appended as College Board publishes.

**Provenance discipline (RB-07A-V1-04):** the original draft listed fabricated dates (May 4 / June 8 / Aug 24 / Oct 5 / Nov 2 / Dec 7 — none of which match the official College Board calendar). This was a "should-have-searched, didn't" failure caught by SWE R1. The corrected sample reflects dates verified against `https://satsuite.collegeboard.org/sat/dates-deadlines` on 2026-05-25 (cross-referenced against the per-administration pages e.g., `/dates/march-14-2026-sat-test-date`, `/dates/may-2-2026-sat-test-date`, `/dates/june-6-2026-sat-test-date`). The `source_url` \+ `retrieved_at` fields are mandatory schema elements; `ci/sat-test-calendar-freshness` blocks deploy if either is absent, if `retrieved_at` is older than 180 days, or if the file is stale per §10.5 rule.

## **10.3 Cohort assignment logic**

When a cohort-class event fires (§6.3), the system computes the cohort\_id:

* **If `exam_date` is provided** → look up the SAT administration whose `date` matches `exam_date` in `infra/sat-test-calendar.yaml`; use that `cohort_id`.  
* **If no SAT administration matches `exam_date` exactly** → return the cohort\_id of the next-upcoming SAT administration on-or-after `exam_date` (i.e., the test the student is realistically targeting).  
* **If `exam_date` is in the past** → return the cohort\_id of the next-upcoming SAT administration after today (effectively "the student's old target has expired; assign to next available test").

## **10.4 The "default to next test date" rule**

When a student signs up without providing an `exam_date` (the field is optional at signup per Karl decision in this round), the system applies a default:

* `exam_date` is set to the date of the next-upcoming SAT administration after today (from `infra/sat-test-calendar.yaml`).  
* `exam_date_cohort_id` is set to that administration's cohort\_id.  
* `exam_date_source` is set to `default_next_test`.

This ensures every signed-up student is in a cohort from day one. The student can change their exam date later via the calendar feature (paid) or settings UI.

## **10.5 Calendar freshness \+ provenance check**

`ci/sat-test-calendar-freshness` (a sub-check of `ci/event-schema-registry-parity`):

* **Hard-fail at V1** (per RB-07A-V1-04) if any of the following:  
  * `source_url` field is missing or empty  
  * `retrieved_at` field is missing, empty, or older than 180 days from the CI run date  
  * `infra/sat-test-calendar.yaml` does NOT contain at least one administration date ≥ today \+ 30 days (we'd be unable to assign any new signup to a future cohort)  
* **Warn** if the latest administration date is \< today \+ 90 days (we have less than 90 days of forward-looking calendar — time to update).

**Past-retained-dates rule (per SWE R2 clarification):** Past administration dates retained in `infra/sat-test-calendar.yaml` for cohort\_id continuity (e.g., users whose `exam_date_cohort_id = march_2026` need the `march_2026` cohort\_id to remain resolvable after March 14 2026 passes) do NOT need to appear on the current College Board public page at CI time. Once a date was source-verified at the time it was added (recorded in the `retrieved_at` for that batch), it is retained for cohort-continuity even after the date passes and College Board removes it from their current page. The freshness check evaluates **future-dated administrations**, not historical ones — past dates are immutable historical record.

The provenance discipline (`source_url` \+ `retrieved_at` mandatory) is the corrective response to the original draft's fabricated dates (the calendar must point at a verifiable source and document when it was last verified against that source). This piggybacks on the event-schema-registry-parity CI run; same scheduling, same failure routing.

---

# **§11 — V1 Owned Mechanisms (Six-Element §6.13 Implemented-Definition Tables)**

Per Doc 06 Parent §6.13 / family inheritance, each owned proving mechanism declares a six-element implemented-definition table. 07A owns three mechanisms.

## **11.1 `ci/event-schema-registry-parity`**

| Element | Value |
| ----- | ----- |
| **mechanism\_id** | `ci/event-schema-registry-parity` |
| **launch\_required** | true |
| **implementer** | Lyceon CI infrastructure (GitHub Actions) — runs on every PR \+ on `main` push |
| **proves** | INV-07-01: every event Lyceon code emits at any tier is registered in `infra/event-schema-registry.yaml` |
| **failure\_mode\_at\_V1** | **Hard-fail at V1** for the three load-bearing sub-checks: (a) unregistered event names (registration presence — direct enforcement of INV-07-01); (b) direct PostHog SDK imports outside the wrapper module (wrapper-bypass detection via lint integration); (c) registry/property mismatch (per-strict-tier entry, `pii_redaction` keys ≠ `json_schema.properties` keys). **The single V1.1+ relaxation is the loose-tier property-depth sub-check** (verifying that loose-tier entries' base required fields appear in observed payloads) — that one requires the V1.1+ warehouse export to activate per §4 hybrid trigger (volume / time / demand; first-to-trigger wins). The advisory framing of the original draft was over-permissive at the wrong layer; the registration-presence \+ wrapper-bypass \+ property-mismatch sub-checks are the load-bearing parts of INV-07-01 and must enforce at V1 (per RB-07A-V1-01). |
| **proof\_artifact\_emitted** | Structured PR comment / CI job output: list of code-emitted event names \+ list of registry entries \+ diff. Stored per family-wide §8.7 / RB-06D-V1-10 no-PII proof-artifact rule (event names \+ counts only; no payload bodies). |
| **operational\_ownership** | Owned by Lyceon engineering on-call rotation per 06C §11.0 unified rotation framing; alert routing not applicable at V1 (non-alerting per INV-07-09). |

## **11.2 `ci/pii-redaction-conformance`**

| Element | Value |
| ----- | ----- |
| **mechanism\_id** | `ci/pii-redaction-conformance` |
| **launch\_required** | true |
| **implementer** | Lyceon CI infrastructure (GitHub Actions) — runs on every PR \+ on `main` push. Joint ownership with Doc 07E (07E owns the warehouse-side conformance extension at V1.1+ activation). |
| **proves** | INV-07-02: no event payload at any tier contains raw PII; user identifiers are server-generated opaque user\_id only; per-property posture declared for every property. |
| **failure\_mode\_at\_V1** | Hard-fail at V1 — PII discipline is always-strict per Parent Q-07-1=(a). CI blocks merge if: (a) any registry entry has missing `pii_redaction` posture; (b) `pii_redaction` keys ≠ `json_schema.properties` keys; (c) any entry declares a forbidden-identifier-type posture (email-hash, phone-hash, name-hash, cross-system stable-hash). |
| **proof\_artifact\_emitted** | Structured CI job output: per-entry posture coverage report. Stored per family-wide §8.7 / RB-06D-V1-10 (declarations only; no payload bodies). |
| **operational\_ownership** | Owned by Lyceon engineering on-call rotation per 06C §11.0 unified rotation framing. Privacy-incident path triggered on V1.1+ runtime redaction failure per Doc 06D §11 standard mechanism. |

## **11.3 `ops/posthog-emission-conformance`**

| Element | Value |
| ----- | ----- |
| **mechanism\_id** | `ops/posthog-emission-conformance` |
| **launch\_required** | true |
| **implementer** | Lyceon ops infrastructure — periodic synthetic emission \+ PostHog ingestion health check. Runs every 15 minutes against staging \+ prod environments. |
| **proves** | INV-07-08: PostHog event emission is live at V1; events are emitted from V1 application code per the registry contract. |
| **failure\_mode\_at\_V1** | **Explicitly non-alerting** per Parent RB-07-Parent-V1-03 reconciliation with INV-07-09. Failure modes at V1: (a) deploy-time: blocks deploy completion until manually resolved; (b) runtime: records structured failure in proof artifact stream; on-call rotation is NOT paged. V1.1+ activation per §4 hybrid trigger may add Page/Warn alert routing via 06C §7 standard registration — at which point INV-07-09 relaxes for V1.1+ scope. |
| **proof\_artifact\_emitted** | Structured ops log: synthetic event emission timestamp \+ PostHog ingestion confirmation timestamp \+ latency. Per family-wide §8.7 / RB-06D-V1-10 (timestamps \+ metadata only; no PII). |
| **operational\_ownership** | Owned by Lyceon engineering on-call rotation per 06C §11.0 unified rotation framing. **Vendor-side operational discipline (PostHog outage runbook \+ cost-structure \+ pricing-snapshot \+ substrate-cap) is canonical to Doc 06E §6.3 / §7 / §13 / §10 pending W-07-PostHog-BQ landing** — per Parent RB-07-Parent-V1-06, 07A deploy-proof for this mechanism MUST be blocked until `RB-06E-V1-15/16` is applied to Doc 06E. |

## **11.4 Envelope-extras matrix (per Doc 06 Parent §10.5 extension)**

Beyond the 12 common Standard Proof Artifact Envelope fields owned by Doc 06A §10.5.1, 07A's three mechanisms add:

| Mechanism | Additional envelope-extras fields |
| ----- | ----- |
| `ci/event-schema-registry-parity` | `unregistered_events_detected` (list of event names) \+ `unredacted_property_count` (integer) \+ `tier_distribution` (strict vs loose count) |
| `ci/pii-redaction-conformance` | `posture_coverage_percent` (float 0-100) \+ `forbidden_identifier_types_detected` (list) \+ `orphan_properties` (list of property names) |
| `ops/posthog-emission-conformance` | `synthetic_event_emit_timestamp` (ISO 8601\) \+ `posthog_ingestion_confirm_timestamp` (ISO 8601\) \+ `emit_to_ingest_latency_ms` (integer) \+ `posthog_api_response_code` (integer) |

---

# **§12 — Cross-Doc Seam Table & Watch Items**

## **12.1 Cross-doc seams**

| Seam | 07A side | Canonical owner \+ exact § | Status |
| ----- | ----- | ----- | ----- |
| Supabase user\_id source identity | §7 `analytics_user_id` HMAC-derivation | Doc 01 V6.0 / Doc 01A V1.0 — referenced | RESOLVED — consumer |
| `infra/event-schema-registry.yaml` config doctrine | §5 registry shape | Doc 01A §3 — referenced; registered per standard | RESOLVED — consumer |
| Mastery formula body | §6.8 mastery events (BI-side observations) | Doc 05B V1.0 §3-§5 — referenced via project memory | OPEN — bounded (W2) |
| Doc 05A `apply_mastery_event` \+ `mastery_event_audit_log` | §6.8 mastery events emit alongside (not duplicate) | Doc 05A V1.0 §11 — referenced via project memory | OPEN — bounded (W2) |
| Doc 04A V2.2 exam runtime canonical events | §6.6 exam events (BI-side observations) | Doc 04A V2.2 — referenced via project memory | RESOLVED — bounded reference |
| Doc 04B V4.3 scoring canonical output | §6.6 `exam_completed` (BI-side, no score body) | Doc 04B V4.3 — referenced | RESOLVED — consumer |
| LISA tutor canonical taxonomy | §6.7 tutor events (lifecycle only; NO tutor\_helped/failed) | Doc 03 Main V1.1 §11 / §14.2 / §24 \+ PDF-06 §4 — referenced via project handoff record | OPEN — bounded (W1) |
| Retention class taxonomy | §5.2 `retention_classes` placeholder | Doc 07E V1.0 (sibling sub-doc — pending) | OPEN — bounded (W4) |
| Analytics-side cascade target body | §7 `analytics_user_id` \+ §9 PostHog deletion API hookup | Doc 07E V1.0 (sibling sub-doc — pending; Doc 05D §10 layer-4 target) | OPEN — bounded (W4) |
| KPI definitions consuming 07A events | §6 event-class catalog feeds 07B KPI bodies | Doc 07B V1.0 (sibling sub-doc — pending) | OPEN — bounded (W5) |
| Vendor inventory \+ outage runbook \+ cost-structure \+ pricing-snapshot for PostHog | §6 vendor-name references | Doc 06E V1.0 §5 / §6.3 / §7 / §13 — W-07-PostHog-BQ Parent-declared obligation | OPEN — bounded (W3 carried from Parent) |
| Family-wide §8.7 no-PII proof-artifact rule | §11 envelope-extras \+ all proof artifacts | Doc 06D V1.0 §8.7 / RB-06D-V1-10 — family-wide reference | RESOLVED — consumer |
| Privacy-incident sub-class (07A redaction failures) | §3 threat 2 defense; §8 PII contract | Doc 06D V1.0 §11 — referenced; standard mechanism | RESOLVED — consumer |
| Severity crosswalk (Page / Warn / Info) | INV-07-09 inheritance — 07A V1 owns no alerts | Doc 01A §18 via Doc 06C §6 — referenced | RESOLVED — inherited-but-unused at V1 |
| Scheduled-job heartbeat substrate | 07A V1 has no scheduled jobs | Doc 06C V1.0 §8 — referenced | RESOLVED — V1.1+ extension path |
| Multi-vertical event-taxonomy fork | Doc 08 — FWD-07-02 inherited | Doc 08 — bounded forward-ref | OPEN — bounded |
| Financial unit economics body | §6.4 billing events feed Doc 09 (FWD-07-01 inherited) | Doc 09 — bounded forward-ref | OPEN — bounded |

## **12.2 Watch list**

| ID | Item | Status |
| ----- | ----- | ----- |
| **W1** | Doc 03 Main §11/§14.2/§24 not in source tree (§3.4 cite-path carried family-wide) | Bounded; reconciliation triggers on upload |
| **W2** | Doc 05 family (05A \+ 05B) not in source tree (§3.5 cite-path) | Bounded; reconciliation triggers on upload |
| **W3** | W-07-PostHog-BQ cross-doc additive owed to Doc 06E (carried from Parent) — bundled `RB-06E-V1-15/16` applied to 06E post-Doc-07-family-LOCK; **gates 07A deploy-proof per Parent RB-07-Parent-V1-06** | Bounded; non-blocking for 07A spec lock; blocks 07A deploy-proof |
| **W4** | Doc 07E (sibling sub-doc) — pending; provides retention\_class taxonomy \+ Doc 05D §10 cascade target body that 07A's PostHog deletion hookup references | Bounded; resolves when 07E drafts (next per Q-07-6=β order) |
| **W5** | Doc 07B (sibling sub-doc) — pending; consumes 07A events as KPI data source | Bounded; resolves when 07B drafts |
| **W6** | **W-07A-PARENT-ADDITIVE — Bundled in-lock-cycle additive owed to Doc 07 Parent V1.0** — applied as `RB-07-Parent-V1-07` post-07A-LOCK adding: (a) 8th `cohort` event class to Parent §2.1 canonical event-class catalog; (b) KPI-ENG-11 `exam_anchored_engagement_rate` to Parent §10.1 KPI roster \+ §10.6 rationale subsection; (c) §1 deliverable \#6 count update 34→35 KPIs \+ 28→29 stubs; (d) §5.1 sub-doc table 07B description update 34→35 KPIs; (e) CR-07-Parent-05 appended documenting the additive | Bounded; non-blocking for 07A spec lock; applied post-07A-LOCK before Doc 07 family closure |
| **W7** | `ci/event-schema-registry-parity` hard-fails at V1 for three load-bearing sub-checks (registration presence \+ wrapper bypass \+ property-set mismatch per RB-07A-V1-01). The single V1.1+-target-state sub-check is loose-tier observed-payload property-depth (requires PostHog → BigQuery warehouse export to be live to validate observed payloads against declared base required fields). Activation trigger per Q-07A-7=δ hybrid (volume / time / demand; first-to-trigger wins) | Bounded; non-blocking |
| **W8** | Salt rotation infrastructure (V1.1+) — V1 ships single salt per environment; rotation playbook \+ dual-salt grace period are V1.1+ work | Bounded; non-blocking |
| **W9** | `analytics_user_id` HMAC derivation requires per-environment salt config — initial deployment must verify all three environment secrets exist before V1 launch | Bounded; resolves at first deploy |

---

# **§13 — Audit Profile**

## **13.1 Inherited 30-pass baseline**

Per Doc 07 Parent §9, 07A inherits the 30-pass audit suite established at Parent: P1-P12 base \+ P13-P18 from 06C \+ P19-P22 from 06D \+ P23-P25 from 06E \+ P26-P30 new for Doc 07\. No new passes added at the 07A sub-doc level — 07A is the implementation site of P26 (event-schema-registry parity) and P28 (PII redaction conformance) but does not introduce new pass classes.

## **13.2 07A as implementation site for P26 \+ P28**

**P26 (event-schema-registry parity)** — Parent declares the pass class \+ verifies 07A names the registry artifact \+ `ci/event-schema-registry-parity` proving mechanism; 07A implements the actual registry shape (§5) \+ 25 V1 event entries (§6) \+ the CI verification logic.

**P28 (PII-redaction-contract conformance)** — Parent declares the pass class \+ verifies 07A names the redaction contract; 07A implements the split-enum contract per RB-07A-V1-06 (§8.1.1 `event_redaction_method` runtime 4-method enum \+ §8.1.2 `proof_artifact_redaction_method` proof-artifact-only 4-method enum) \+ the per-property declaration discipline (§8.2) \+ the two-layer defense (§8.3) \+ the `not_pii` discipline (§8.4) \+ the CI verification logic.

## **13.3 Audit trivializations at 07A scope**

Passes that trivially pass at 07A scope because they enforce concerns owned elsewhere:

* **P9 envelope-extras matrix** — 07A §11.4 declares per-mechanism extras; P9 enforces presence.  
* **P19 retention-coverage exhaustiveness** — 07E owns retention policy registry; 07A trivially passes (declares `retention_class: standard_analytics` placeholder pending 07E).  
* **P20 compliance-gate registry parity** — Doc 06D owns; 07A V1 has no compliance gates owned; trivially passes.  
* **P21 deletion-cascade reference exhaustiveness** — 07E owns analytics layer-4 target body; 07A references via §7 \+ §9 PostHog deletion API hookup; trivially passes at 07A scope.  
* **P23 vendor-tier exhaustiveness** — Doc 06E owns vendor inventory; 07A references PostHog \+ BigQuery via W3 carry-forward; trivially passes.  
* **P24 pricing-snapshot-registry parity** — Doc 06E owns; trivially passes.  
* **P29 retention-policy-declaration cross-ref to Doc 06D §9** — 07E owns; trivially passes at 07A.  
* **P30 deletion-cascade-target cross-ref to Doc 05D §10** — 07E owns; trivially passes at 07A.

## **13.4 Known false-positive class (07A-specific)**

* §5 \+ §6 YAML code blocks: registry entries naming SAT-specific terms (`section: rw | math`, `RW / M`, etc.) are content, not redaction-vocabulary leaks.  
* §8.1 redaction-method-name enumeration table: `not_pii` / `drop` / etc. are vocabulary tokens, not actual posture declarations.  
* §11 six-element implemented-definition tables: severity vocabulary (`HIGH`, `MEDIUM`, etc. — none present in 07A V1 but anticipated for future review-bound register entries) needs P8 exception inside cleanup-register \+ change-records sections.

---

# **§14 — Acceptance Criteria**

## **A — 07A-owned criteria**

1. **INV-07-01 (event-schema-registry parity) holds via `ci/event-schema-registry-parity`** — every code-emitted event at V1 launch has a registered entry in `infra/event-schema-registry.yaml`. **launch\_required: true** (hard-fail at V1 for registration presence / wrapper bypass / property-set mismatch per RB-07A-V1-01; loose-tier property-depth check defers to V1.1+ when warehouse export activates).  
2. **INV-07-02 (PII-redaction-contract conformance) holds via `ci/pii-redaction-conformance`** — every registry entry declares per-property PII redaction posture using only the `event_redaction_method` runtime 4-method enum per RB-07A-V1-06 split (§8.1.1: `not_pii` / `opaque_id_only` / `bucket` / `drop`; `hash_server_local` excluded from runtime enum) \+ `pii_redaction` keys equal `json_schema.properties` keys \+ no forbidden-identifier-types declared. **launch\_required: true** (hard-fail at V1).  
3. **INV-07-08 (PostHog emission live at V1) holds via `ops/posthog-emission-conformance`** — synthetic emission \+ ingestion verified every 15 minutes; failure mode explicitly non-alerting at V1 per Parent RB-07-Parent-V1-03 reconciliation with INV-07-09. **launch\_required: true**.  
4. **All 25 V1 events are strict-tier with full JSON Schema** — §6 enumerates; `infra/event-schema-registry.yaml` is the canonical implementation; markdown rendering in §6 is reference. **launch\_required: true**.  
5. **All 4 V1 Person Properties are declared \+ applied to PostHog** — §7 declares; wrapper library applies via `$set` per §7.5. **launch\_required: true**.  
6. **`analytics_user_id` HMAC-derivation contract is implemented per §7.1** — per-environment salts configured; immutable column on user record; computed at signup. **launch\_required: true**.  
7. **`emitEvent` wrapper library is the single emission boundary** — §9 contract implemented; PostHog SDK imported only inside wrapper; lint rule enforces. **launch\_required: true**.  
8. **`infra/sat-test-calendar.yaml` exists with ≥12 months forward-looking SAT administrations** — §10 reference data \+ `ci/sat-test-calendar-freshness` sub-check active. **launch\_required: true**.

## **B — Cross-doc gate-body criteria**

9. **W3 / W-07-PostHog-BQ deploy gate honored** — 07A spec-locks before `RB-06E-V1-15/16` lands; 07A **deploy-proof** for `ops/posthog-emission-conformance` MUST be blocked until `RB-06E-V1-15/16` is applied to Doc 06E per Parent RB-07-Parent-V1-06.  
10. **W6 / W-07A-PARENT-ADDITIVE obligation declared** — `RB-07-Parent-V1-07` applied to Parent post-07A-LOCK adding 8th cohort event class \+ KPI-ENG-11 \+ count updates. Documented at §12.2 W6.

## **C — Audit closure**

11. **§13 audit suite (30 passes) reports zero defects** of class `DD-07A-PROOF`, `DD-07A-REDEF`, `DD-07A-SEAM`, `DD-07A-FWD`, `DD-07A-PII`; zero LISA-body-restatement defects (P12 / P27); zero 05B-mastery-body-restatement defects (P27); zero Doc-06E-body-restatement defects (P27); zero 04 family-body-restatement defects (P27); citation-parity reports either resolved-anchor or `cited_per_project_handoff_record` / `cited_per_project_memory` for every cross-doc citation; P26 \+ P28 are implementation-site-clean; remaining passes trivially pass per §13.3.

---

# **§15 — Change Records**

**CR-07A-01** — Doc 07A V1.0 established. Scope per Doc 07 Parent §5.1 family decomposition: event taxonomy \+ tracking standards \+ PostHog emission contract \+ PII redaction contract \+ emission wrapper library \+ SAT test calendar \+ cohort assignment logic; 25 V1 events across 8 canonical classes (auth 3 \+ cohort 3 \+ billing 5 \+ practice 3 \+ exam 5 \+ tutor 2 \+ mastery 2 \+ system 2); 4 V1 Person Properties (`analytics_user_id` HMAC-derived, `exam_date`, `exam_date_cohort_id`, `exam_date_source`); per-property PII redaction with 5-method enum (`bucket` / `hash_server_local` / `drop` / `opaque_id_only` / `not_pii`); strict-tier JSON Schema for every V1 event with `additionalProperties: false`; loose-tier 6-field tuple \+ base required fields \+ description for V1.1+ additions; emission wrapper library `emitEvent` as single emission boundary (\~80-120 LOC); SAT test calendar `infra/sat-test-calendar.yaml` annually maintained; exam-date-anchored cohort definition per Karl edtech override of SaaS-standard signup cohort; default-to-next-test-date rule for students who signup without an exam date; three V1 owned proving mechanisms (`ci/event-schema-registry-parity` advisory at V1 hard-fail V1.1+, `ci/pii-redaction-conformance` hard-fail at V1, `ops/posthog-emission-conformance` non-alerting at V1 per Parent RB-07-Parent-V1-03); 30-pass audit suite inherited from Parent with P26 \+ P28 as 07A implementation site; W-07A-PARENT-ADDITIVE bundled obligation to Parent V1.0 (`RB-07-Parent-V1-07` post-07A-LOCK adding 8th cohort event class \+ KPI-ENG-11 `exam_anchored_engagement_rate` \+ count updates 34→35 KPIs / 28→29 stubs). Hybrid V1.1+ activation triggers per Q-07A-7=δ for each `launch_required: false` mechanism (volume / time / demand; first-to-trigger wins). PostHog autocapture DISABLED at V1 (`autocapture: false` in SDK config) — only explicit `emitEvent`\-routed events emitted.

**CR-07A-02** — Pre-draft alignment: Doc 07 Parent V1.0 LOCKED 2026-05-23 consumed in full (decisions Q-07-1..6 \+ Q-07-1=a strict-V1+loose-future \+ Q-07-3-confirmation-3=a zero-raw-PII \+ Q-07-5=b internal-only \+ Q-07-2=β BigQuery+PostHog stack \+ Q-07-6=β launch-required-first drafting order \+ 8 canonical event classes pending RB-07-Parent-V1-07 cohort additive \+ 6+28 KPI distribution \+ W-07-PostHog-BQ cross-doc additive obligation \+ INV-07-01..09 all referenced); Doc 01 V6.0 \+ Doc 01A V1.0 §3 \+ §14 consumed for Supabase user\_id source \+ config doctrine \+ PII inventory; Doc 03 Main V1.1 §0.6 deferral \+ §11 caps \+ §14.2 retention \+ §24 cost \+ PDF-06 §4 cited per project handoff record (§3.4 carry-forward); Doc 04 family V1.0 LOCKED canonical events referenced per project memory; Doc 05 family (05A \+ 05B) cited per project memory (§3.5 carry-forward); Doc 06A §3 / §7 \+ Doc 06C §6 \+ Doc 06D §8.7 / §9 / §11 \+ Doc 06E §4 / §5 / §6.3 / §7 / §13 all consumed by reference.

**CR-07A-03** — Pre-draft Q\&A locked: **Q-07A-1 \= (α)** comprehensive minimum 25 V1 events (no over-specification); **Q-07A-2 \= (α)** JSON Schema for every event property with `additionalProperties: false`; **Q-07A-3 \= (γ)** loose-tier 6-field tuple \+ base required fields \+ free-text description (most rigorous loose-tier shape; description required for both tiers); **Q-07A-4 \= (β)** per-property PII redaction with 5-method enum (`bucket` / `hash_server_local` / `drop` / `opaque_id_only` / `not_pii`); **Q-07A-5 \= (β)** thin wrapper library `emitEvent` as single emission boundary; **Q-07A-6 \= (β)** lighter sub-doc shape \~16 sections; **Q-07A-7 \= (δ)** hybrid V1.1+ activation triggers per mechanism (volume / time / demand). Plus follow-up locks: **(1) cohort \= 8th event class** via Karl override (β) — separate class, not folded into system or auth; **(2) `infra/sat-test-calendar.yaml`** one-and-done annual reference file; **(3) `analytics_user_id` \= HMAC-SHA256(supabase\_user\_id, ANALYTICS\_SALT)** per Karl decision (β) — separate immutable column on user record; per-environment salts per family-wide §8.7 / RB-06D-V1-10; **(4) cohort granularity** \= per-SAT-administration (e.g., `may_2026`); **(5) retention KPI** \= hybrid exam-anchored primary \+ signup-anchored stratified secondary per Karl decision (c); add **KPI-ENG-11 `exam_anchored_engagement_rate`** per (x) via RB-07-Parent-V1-07 bundled additive to Parent. Platform-features-first principle locked per Karl: PostHog/Stripe/Supabase native KPIs preferred over Lyceon-side math; KPI body shape \= citation-of-platform-source not math; industry-standard KPI names not ad hoc invention; PostHog autocapture disabled at V1; PostHog session tracking native (no Lyceon `session_started`/`session_ended` events); `$feature_flag_called` PostHog-native (no Lyceon `feature_flag_evaluated` event — initially planned 23-event roster reduced to 22, then expanded to 25 after cohort 3 events added).

**CR-07A-04** — In-lock-cycle draft-for-lock cleanup applying SWE R1 (4 BLOCKER \+ 4 HIGH; all accepted without pushback). Per Parent §13 convention, draft-for-lock cleanup transitions DRAFT → LOCKED on clean two-pass re-audit; status transitioned DRAFT → LOCKED 2026-05-25 on clean re-audit; subsequent in-lock-cycle cleanup (if any) holds the 2026-05-25 lock date per multi-round precedent. External claim verification: SWE R1 cited PostHog Person Properties docs \+ PostHog autocapture config docs \+ PostHog Sessions docs \+ College Board official SAT test dates — independently re-verified during this cleanup pass. **Eight reviewer-bound register entries tagged RB-07A-V1-01..08:** **(B1 / RB-07A-V1-01)** `ci/event-schema-registry-parity` reframed from advisory-at-V1 to hard-fail-at-V1 for three load-bearing sub-checks (registration presence / wrapper bypass / property-set mismatch); only loose-tier property-depth sub-check remains V1.1+-deferred since it requires the warehouse export to validate observed payloads. Applied at §1 mechanism description, §4 launch-vs-target framing, §4 acceptance-list, §4 V1.1+ section, §11.1 implemented-definition table, §14 acceptance criterion \#1. Reviewer-correct rationale: INV-07-01 is launch-required; advisory enforcement weakens the load-bearing invariant; runtime wrapper rejection alone leaves direct SDK bypass \+ missed instrumentation possible. **(B2 / RB-07A-V1-02)** `emitEvent` validation/injection order was internally impossible — original draft validated payload against `json_schema` BEFORE injecting base fields, but every strict schema requires base fields in `json_schema.required`. Corrected to deterministic 13-step security-boundary sequence: reject direct SDK usage → resolve authenticated user → load immutable analytics\_user\_id → reject caller-supplied base fields (removes spoofing surface) → look up registry entry → inject canonical base fields → construct final payload (injected fields take precedence) → validate final payload → apply per-property redaction → send via exact SDK call path → emit Person Property updates as same logical operation → write proof artifact with no payload body → return. Caller-supplied base fields now rejected, not just overwritten. Applied at §9.2 wholesale replacement. **(B3 / RB-07A-V1-03)** PostHog SDK call semantics overclaim corrected — "atomic with event emission" / "single SDK call" replaced with exact PostHog Node.js SDK call paths: server-side `posthog.capture({distinctId, event, properties, timestamp})` for events; `posthog.identify({distinctId, properties})` or event-attached `$set` for Person Property updates; "same logical emission operation" language replaces atomicity claim; PostHog SDK batches events and identify calls separately; cross-call durability bounded by SDK retry semantics, not Lyceon-side transaction semantics. Applied at new §9.3.1 (server-side emission), §9.3.2 (Person Properties), §9.3.3 (webhook-handler emissions), §7.5 cohort-class Person Property update contract. **(B4 / RB-07A-V1-04)** SAT calendar sample dates corrected against College Board official source — original draft listed fabricated dates (May 4 / June 8 / Aug 24 / Oct 5 / Nov 2 / Dec 7 — none match official calendar) generated from training-data memory without web verification. Replaced with verified dates retrieved from `https://satsuite.collegeboard.org/sat/dates-deadlines` on 2026-05-25: March 14 \+ May 2 \+ June 6 \+ August 22 \+ September 12 \+ October 3 \+ November 7 \+ December 5 (2026); March 6 \+ May 1 \+ June 5 (2027). Added mandatory `source_url` \+ `retrieved_at` fields to `infra/sat-test-calendar.yaml` schema. `ci/sat-test-calendar-freshness` extended to hard-fail at V1 if `source_url` missing, `retrieved_at` missing or \>180 days old, or no administration ≥ today+30 days. Applied at §10.2 \+ §10.5. **(H1 / RB-07A-V1-05)** `analytics_user_id` HMAC-derivation algorithm tightened — "truncated to UUID format" replaced with deterministic 5-step algorithm: `raw_hmac = HMAC-SHA256(ANALYTICS_SALT, supabase_user_id_bytes)` → first 128 bits → set UUIDv4 version bits \+ RFC 4122 variant bits → canonical 8-4-4-4-12 hyphenated lowercase hex string. Result is deterministic-from-(supabase\_user\_id, salt), UUIDv4-shaped (schema-valid against `format: uuid`), but NOT cryptographically a UUIDv4 (randomness comes from HMAC, not true random). Documented trade-off: UUIDv4-shape preserves JSON Schema validity at the cost of cryptographic UUIDv4 semantics; alternative (raw 32-char hex) would require non-UUID JSON Schema constraint and complicate registry. Applied at §7.1 prose \+ table. **(H2 / RB-07A-V1-06)** Redaction-method enum split into two enums — original draft's single 5-method enum (`bucket` / `hash_server_local` / `drop` / `opaque_id_only` / `not_pii`) documented `hash_server_local` as proof-artifact-only but didn't enforce; a registry entry could declare `hash_server_local` for an event property and the wrapper would forward a hashed identifier to PostHog. Split into: `event_redaction_method` (runtime enum used in `pii_redaction` for every event registry entry; 4 methods: `not_pii` / `opaque_id_only` / `bucket` / `drop`; `hash_server_local` explicitly excluded) and `proof_artifact_redaction_method` (proof-artifact-only enum; 4 methods: `not_pii` / `bucket` / `hash_server_local` / `drop`; `opaque_id_only` intentionally excluded since proof artifacts must not carry user identifiers in any form). `ci/pii-redaction-conformance` hard-fails registry entries that declare `hash_server_local` as event-property posture. Applied at §8.1 (split into §8.1.1 \+ §8.1.2). **(H3 / RB-07A-V1-07)** Pending-additive framing made consistent — original draft inconsistently treated W-07A-PARENT-ADDITIVE as both pending application AND already canonical (e.g., "the canonical 8-event-class catalog including the cohort 8th class pending RB-07-Parent-V1-07" was self-contradictory). Added §6.0 pending-additive-framing subsection establishing: Doc 07 Parent V1.0 LOCKED 2026-05-23 currently declares 7 canonical event classes \+ 34-KPI roster (6 bodied \+ 28 stubs); Doc 07A V1.0 PROPOSES the 8th `cohort` class \+ KPI-ENG-11 via the W-07A-PARENT-ADDITIVE obligation; until RB-07-Parent-V1-07 is applied to Parent, the 3 cohort-class events in §6.3 are proposed-by-07A-pending-Parent-additive, not Parent-canonical. After RB-07-Parent-V1-07 lands, 07A's references retroactively align with Parent without further 07A edit. Applied at new §6.0 \+ renumbering §6.x subsections (auth class moved from §6.1 to §6.2, cohort §6.3, billing §6.4, practice §6.5, exam §6.6, tutor §6.7, mastery §6.8, system §6.9) \+ all internal §6.x cross-references updated. **(H4 / RB-07A-V1-08)** Doc 05B mastery threshold constants (`0.19/0.39/0.59/0.79`) removed from `mastery_level_changed` event description — original draft restated 05B-canonical body in a Decision-5 violation. Reframed as "per Doc 05B canonical mastery-level transition logic" with explicit "level boundaries owned canonically by Doc 05B §3-§5 and NOT restated here per Decision 5 \+ RB-07A-V1-08." The boundary value list previously inlined is removed. Applied at §6.8 mastery\_level\_changed JSON Schema description. **Two-pass audit re-run after edits;** both passes clean across all 30 passes (P1-P12 base \+ P13-P18 from 06C \+ P19-P22 from 06D \+ P23-P25 from 06E \+ P26-P30 from Doc 07 Parent). External claim verification: SAT calendar dates re-verified against `https://satsuite.collegeboard.org/sat/dates-deadlines` per-administration pages on 2026-05-25 (March 14, May 2, June 6 verified directly; remaining 2026 \+ 2027 dates confirmed via secondary source cross-reference). **Pattern note (carried forward for future drafting):** RB-07A-V1-02 is the most chagrining defect of this cycle — the validation-before-injection order would have been caught by a single mental trace through the wrapper sequence. Adding "trace at least one synthetic call through any spec'd sequential procedure" to pre-delivery audit discipline. RB-07A-V1-04 (fabricated SAT dates) is the second — should-have-web-searched, didn't; adding "web-search any external-reality data (vendor dates, prices, calendars) before writing it into a spec" to pre-delivery discipline.

---

**CR-07A-05** — In-lock-cycle multi-round cleanup (round 2 post-LOCK) applying SWE R2 (3 BLOCKER \+ 1 HIGH; all accepted without pushback). Per Parent §13 / 06 family §8 multi-round precedent, in-lock-cycle cleanup applied after LOCK does NOT bump version or change lock date; status / version / lock-date unchanged. **Four reviewer-bound register entries tagged RB-07A-V1-09..12:** **(B1 / RB-07A-V1-09)** `user_signed_up` pre-auth contradiction fixed — §9.2 step 2 originally said "if no authenticated user (e.g., pre-auth event), the wrapper takes a documented unauthenticated path: anonymous distinct\_id only; no `analytics_user_id` injection. V1 events that fire pre-auth are limited to `user_signed_up` (which carries no `analytics_user_id` in its strict schema)" — but `user_signed_up` schema DID require `analytics_user_id`, breaking the wrapper contract on the first event. Corrected: `user_signed_up` fires AFTER the Supabase user row is created AND the `analytics_user_id` column has been computed and persisted per §7.1; all V1 events including `user_signed_up` fire identified; if session context cannot resolve an authenticated user, the wrapper rejects emission with `{ok: false, reason: "unauthenticated_emission_attempt"}` — no anonymous fallback exists at V1. Applied §9.2 step 2 wholesale. **(B2 / RB-07A-V1-10)** Split-enum language propagated through all current-state references — RB-07A-V1-06 had introduced the `event_redaction_method` runtime 4-method enum \+ `proof_artifact_redaction_method` proof-artifact-only 4-method enum at §8.1 but left "5-method enum" language in §1 mechanism \#2 description, §1 scope-Applies-to paragraph, §3 threat \#2 defense, §5.2 top-level registry-schema comment, §13.2 P28 implementation-site description, §14 acceptance criterion \#2. All six sites updated to reference the split-enum contract per RB-07A-V1-06. Note: CR-07A-04 narrative \+ §16 register row 6 retain "5-method enum" wording because they describe the original-state-being-fixed; historical CR records are immutable and contextually clear. **(B3 / RB-07A-V1-11)** Hard-fail-at-V1 language propagated through W7 \+ closing — RB-07A-V1-01 had reframed `ci/event-schema-registry-parity` from advisory-at-V1 to hard-fail-at-V1 for three load-bearing sub-checks at §1, §4, §11.1, §14 but left "advisory at V1 per §4 hybrid trigger" in §12 W7 watch item and "advisory at V1 hard-fail V1.1+" in §16.2 closing. Both updated to current truth: hard-fail at V1 for registration presence \+ wrapper bypass \+ property-set mismatch; only loose-tier observed-payload property-depth defers to V1.1+ when warehouse export activates. Applied §12 W7 \+ §16.2 closing. **(H1 / RB-07A-V1-12)** PostHog `$set` syntax corrected in §9.3.2 Option B — original showed `$set` at top level of `posthog.capture()` call; per PostHog Node SDK docs, `$set` must be nested inside the `properties` object: `properties: {...redactedPayload, $set: personPropertyUpdates}`. Code sample updated. Note: §9.3.2 Option A (separate `posthog.identify()` call) remains the V1 default per RB-07A-V1-03; Option B is the alternate path now syntactically correct against PostHog docs. **Calendar past-retained-dates clarification (per SWE R2 H2 acknowledgment):** §10.5 calendar-freshness check absorbed an explicit rule for past-retained dates — once an administration date was source-verified at the time it was added (recorded in the batch's `retrieved_at`), it is retained for cohort\_id continuity even after the date passes and College Board removes it from their current page. The freshness check evaluates future-dated administrations, not historical ones; past dates are immutable historical record. Applied §10.5 prose addition. **Two-pass audit re-run after edits;** both passes clean across all 30 passes. **Pattern note (carried forward):** SWE R2 caught propagation defects that should have been caught at CR-07A-04 closure time. Adding "after any wholesale section rewrite or vocabulary change, grep for the OLD vocabulary across the entire doc before declaring cleanup complete" to pre-delivery audit discipline. The R1→R2 grep would have caught B2 (5-method enum) and B3 (advisory at V1) immediately; the wrapper-contract mental-trace from CR-07A-04's pattern note would have caught B1 (user\_signed\_up pre-auth contradiction).

# **§16 — Cleanup Register \+ Closing**

## **16.1 Cleanup register (RB-07A-V1-NN)**

Structure established; populated during the in-lock-cycle external-review cleanup pass.

| Tag | Severity | Source | Resolution |
| ----- | ----- | ----- | ----- |
| RB-07A-V1-01 | BLOCKER | SWE R1 / B1 | `ci/event-schema-registry-parity` hard-fail at V1 for registration presence \+ wrapper bypass \+ property-set mismatch; only loose-tier property-depth sub-check remains V1.1+-deferred (requires warehouse export to validate observed payloads). Original advisory framing weakened load-bearing INV-07-01; corrected at §1 \+ §4 \+ §11.1 \+ §14. |
| RB-07A-V1-02 | BLOCKER | SWE R1 / B2 | `emitEvent` validation/injection order corrected to deterministic 13-step security-boundary sequence: reject SDK bypass → resolve user → load analytics\_user\_id → reject caller-supplied base fields → look up registry → inject canonical base fields → construct final payload → validate final → redact → send → emit Person Property updates → write proof artifact → return. Original "validate before inject" sequence was internally impossible (base fields are in `json_schema.required`). Caller-supplied base fields now rejected, not just overwritten — closes spoofing surface. Applied §9.2 wholesale. |
| RB-07A-V1-03 | BLOCKER | SWE R1 / B3 | PostHog SDK overclaim corrected. "Atomic with event emission" / underspecified `capture(eventName, payload, {distinctId})` replaced with exact PostHog Node.js SDK call paths: `posthog.capture({distinctId, event, properties, timestamp})` for events; `posthog.identify({distinctId, properties})` OR event-attached `$set` for Person Property updates; "same logical emission operation" replaces atomicity claim; cross-call durability bounded by SDK retry semantics. New §9.3.1 (server-side emission), §9.3.2 (Person Properties), §9.3.3 (webhook-handler path); §7.5 updated. |
| RB-07A-V1-04 | BLOCKER | SWE R1 / B4 | SAT calendar sample dates corrected against College Board official source. Original draft listed fabricated dates (May 4 / June 8 / Aug 24 / Oct 5 / Nov 2 / Dec 7\) — none match official calendar. Replaced with verified dates retrieved from `https://satsuite.collegeboard.org/sat/dates-deadlines` on 2026-05-25 (March 14 \+ May 2 \+ June 6 \+ Aug 22 \+ Sep 12 \+ Oct 3 \+ Nov 7 \+ Dec 5, 2026; March 6 \+ May 1 \+ June 5, 2027). Added mandatory `source_url` \+ `retrieved_at` fields to schema. `ci/sat-test-calendar-freshness` extended to hard-fail at V1 on missing provenance OR `retrieved_at` \>180 days OR no future-dated administration ≥ today+30. Applied §10.2 \+ §10.5. |
| RB-07A-V1-05 | HIGH | SWE R1 / H1 | `analytics_user_id` HMAC-derivation algorithm specified deterministically: `raw_hmac = HMAC-SHA256(ANALYTICS_SALT, supabase_user_id_bytes)` → first 128 bits → set UUIDv4 version bits \+ RFC 4122 variant bits → canonical 8-4-4-4-12 hyphenated lowercase hex. Result: deterministic-from-(supabase\_user\_id, salt), UUIDv4-shaped (schema-valid against `format: uuid`), but not cryptographically UUIDv4 — documented trade-off. Applied §7.1 prose \+ table. |
| RB-07A-V1-06 | HIGH | SWE R1 / H2 | Redaction-method enum split into two enums. `event_redaction_method` (runtime, 4 methods: not\_pii / opaque\_id\_only / bucket / drop; `hash_server_local` excluded) used in registry `pii_redaction` for every event. `proof_artifact_redaction_method` (proof-artifact-only, 4 methods: not\_pii / bucket / hash\_server\_local / drop; `opaque_id_only` excluded since proof artifacts must not carry identifiers). `ci/pii-redaction-conformance` hard-fails entries declaring `hash_server_local` as event-property posture. Applied §8.1 (now §8.1.1 \+ §8.1.2). |
| RB-07A-V1-07 | HIGH | SWE R1 / H3 | Pending-additive framing made consistent at new §6.0 — Doc 07 Parent V1.0 LOCKED 2026-05-23 currently declares 7 canonical event classes \+ 34-KPI roster; 07A PROPOSES 8th `cohort` class \+ KPI-ENG-11 via W-07A-PARENT-ADDITIVE; until RB-07-Parent-V1-07 is applied, cohort-class events in §6.3 are proposed-by-07A-pending-Parent-additive, not Parent-canonical. After RB-07-Parent-V1-07 lands, 07A retroactively aligns with Parent without further edit. Renumbered §6.x subsections (auth §6.2, cohort §6.3, billing §6.4, practice §6.5, exam §6.6, tutor §6.7, mastery §6.8, system §6.9); all internal §6.x cross-references updated. |
| RB-07A-V1-08 | HIGH | SWE R1 / H4 | Doc 05B mastery threshold constants (`0.19/0.39/0.59/0.79`) removed from `mastery_level_changed` event description. Original draft restated 05B-canonical body — Decision 5 violation. Replaced with "per Doc 05B canonical mastery-level transition logic" \+ explicit "level boundaries owned canonically by Doc 05B §3-§5 and NOT restated here per Decision 5 \+ RB-07A-V1-08." Applied §6.8 (post-renumber). |
| RB-07A-V1-09 | BLOCKER | SWE R2 / B1 | `user_signed_up` pre-auth contradiction with strict schema's `analytics_user_id` requirement fixed. `user_signed_up` now fires AFTER user row \+ `analytics_user_id` creation; identified-not-anonymous; wrapper rejects emission with `unauthenticated_emission_attempt` if no session context. Removed pre-auth/anonymous wrapper code path. Applied §9.2 step 2\. |
| RB-07A-V1-10 | BLOCKER | SWE R2 / B2 | Split-enum language propagated to 6 current-state sites that RB-07A-V1-06 missed: §1 mechanism \#2, §1 scope-Applies-to, §3 threat \#2 defense, §5.2 registry-schema comment, §13.2 P28 implementation-site, §14 acceptance criterion \#2. Historical CR-04 narrative \+ §16 row 6 retain old wording (immutable historical record). |
| RB-07A-V1-11 | BLOCKER | SWE R2 / B3 | Hard-fail-at-V1 language propagated to 2 current-state sites that RB-07A-V1-01 missed: §12 W7 watch item \+ §16.2 closing. Both updated to "hard-fail at V1 for registration presence \+ wrapper bypass \+ property-set mismatch; only loose-tier observed-payload property-depth defers to V1.1+." |
| RB-07A-V1-12 | HIGH | SWE R2 / H1 | PostHog `$set` syntax corrected in §9.3.2 Option B per PostHog Node SDK docs — `$set` nested inside `properties` object, not at top level of `posthog.capture()`. Option A (`posthog.identify()`) remains V1 default per RB-07A-V1-03. Plus §10.5 calendar past-retained-dates rule absorbed per SWE R2 H2 acknowledgment (past source-verified dates retained for cohort continuity; freshness check evaluates future-dated only). |

**Convention:** `.bak` / `.bak2` before each pass; resolved items tagged `RB-07A-V1-NN`; §15 change-record row appended per pass; draft-for-lock pass transitions status `DRAFT` → `LOCKED`; post-lock passes (multi-round in-lock-cycle precedent) leave status / version / lock-date unchanged (Parent §13 / 06 family §8).

## **16.2 Closing**

Doc 07A V1.0 establishes the V1 launch-required event taxonomy \+ emission contract \+ PII redaction contract for the entire Lyceon stack. The 25 V1 events across 8 canonical classes (with cohort as the 8th class pending RB-07-Parent-V1-07 Parent additive) cover the auth lifecycle, exam-date cohort assignment \+ maintenance, billing state transitions, practice activity, exam runtime (BI-side observations of Doc 04 family canonical events), tutor lifecycle (BI-side observations of LISA — NO helped/failed effectiveness at V1 per Parent §10.6 KPI-TUT-02 carve-out), mastery transitions (BI-side observations of Doc 05A canonical events; NO mastery math restatement per Decision 5), and system signals (errors \+ consent capture). The 4 V1 Person Properties anchor cohort-based analytics: `analytics_user_id` HMAC-derived from Supabase user\_id per RB-07-Parent-V1-04 server-generated-opaque-only constraint; `exam_date` \+ `exam_date_cohort_id` per Karl edtech override of SaaS-standard signup cohort; `exam_date_source` provenance tracking. The per-property PII redaction contract via split-enum design (RB-07A-V1-06: `event_redaction_method` runtime 4-method enum \+ `proof_artifact_redaction_method` proof-artifact-only 4-method enum) and `not_pii` positive-declaration discipline closes the redaction loophole. The `emitEvent` wrapper library is the single runtime emission boundary (\~120-180 LOC per RB-07A-V1-02 corrected sequence \+ RB-07A-V1-03 explicit SDK paths) — registry-validates \+ redacts \+ maps user\_id \+ routes to PostHog. The three V1 owned mechanisms (registry parity **hard-fail at V1 for registration presence \+ wrapper bypass \+ property-set mismatch** per RB-07A-V1-01; only loose-tier observed-payload property-depth defers to V1.1+ when warehouse export activates \+ PII conformance hard-fail at V1 \+ emission conformance non-alerting at V1) close the executable-proof obligation per Doc 06 Parent §6.13. Decision 5 holds end-to-end: mastery KPI bodies stay canonical to 05B; LISA cost/cap bodies stay canonical to Doc 03; Doc 04 family exam runtime \+ scoring bodies stay canonical to Doc 04A V2.2 \+ Doc 04B V4.3; per-platform infra cost bodies stay canonical to 06E; financial unit economics bodies stay canonical to Doc 09 (FWD-07-01); Doc 07A adds the event-schema layer that captures observations without restating any primitive body. **Two outstanding cross-doc additives:** W3 (W-07-PostHog-BQ on 06E — gates 07A deploy-proof) and W6 (W-07A-PARENT-ADDITIVE on Parent — adds 8th cohort event class \+ KPI-ENG-11). Both are bounded; neither blocks 07A spec lock. **Drafting order proceeds:** 07E (Analytics Retention, Privacy & Cascade) next per Q-07-6=β order.

*End of Doc 07A V1.0 (LOCKED 2026-05-25 after two in-lock-cycle cleanup rounds: CR-07A-04 draft-for-lock applying SWE R1's 4 BLOCKER \+ 4 HIGH findings; CR-07A-05 multi-round post-LOCK applying SWE R2's 3 BLOCKER \+ 1 HIGH propagation-defect findings; all twelve accepted without pushback; status / version / lock-date unchanged through round 2 per Parent §13 / 06 family §8 multi-round precedent). Sub-doc drafting continues with 07E Analytics Retention, Privacy & Cascade.*

