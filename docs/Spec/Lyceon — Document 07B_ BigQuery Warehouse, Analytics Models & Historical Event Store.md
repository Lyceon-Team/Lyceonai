# **Lyceon — Document 07B: BigQuery Warehouse, Analytics Models & Historical Event Store**

**Version:** V1.0 **Status:** LOCKED 2026-05-28 (R1 SWE cleanup RB-07B-V1-01..08 applied in-lock-cycle per CR-07B-02; R2 SWE verdict \= LOCK-CONDITIONAL grade A-, no further rewrite required; LOCK-CONDITIONAL cleared by applying the 3 non-blocking R2 cleanups RB-07B-V1-09..11 \+ clean two-pass re-audit \+ KPI-event-name registry parity \+ P31 \+ DD-07-REDEF per CR-07B-03; no version bump) **Last updated:** 2026-05-28 **Owners:** Founder / CTO review **Governed by:** Doc 00 (Authoritative Platform Directive) \+ Doc 07 Parent V1.0 (LOCKED 2026-05-23). **Scope per Doc 07 Parent §5.1 family decomposition:** Doc 07B is the **third launch-required-content sub-doc** (per Parent Q-07-6=β drafting order: Parent → 07A → 07E → 07B → 07C → 07D) and owns the warehouse model specification — the BigQuery dataset/table architecture, the PostHog → BigQuery export/ingestion contract, the normalized \+ dimensional warehouse event model, the `infra/kpi-registry.yaml` canonical KPI roster, the warehouse-side PII conformance enforcement, the warehouse-side cascade/deletion-propagation behavior, the system-state-archive warehouse integration, and the BigQuery cost/query-governance discipline. **Depends on:** Doc 07 Parent V1.0 (canonical decisions Q-07-1..6 inherited verbatim; §4 spec-locked-infrastructure-target-state framing applies; INV-07-05 / INV-07-06 are 07B-implemented; the 6-element §6.13 implemented-definition discipline applies to 07B's owned mechanisms; the 35-KPI roster — 34 Parent-canonical \+ KPI-ENG-11 from RB-07-Parent-V1-07 — is registered in `infra/kpi-registry.yaml` per Parent §10, which 07B bodies); Doc 07A V1.0 (LOCKED 2026-05-25 — `infra/event-schema-registry.yaml` 25-event / 8-class taxonomy \+ the 4 Person Properties \+ the `analytics_user_id = HMAC-SHA256(supabase_user_id, ANALYTICS_SALT)` derivation contract \+ the §8 split-enum PII redaction contract \+ the `emitEvent` wrapper boundary — all referenced, never restated; 07B is the warehouse-side consumer of these event-time contracts); Doc 07E V1.0 (LOCKED 2026-05-26 — the analytics retention class taxonomy \+ the Doc 05D §10 Layer-4 cascade body \+ the BigQuery cascade behavior \+ the `ci/historical-pii-conformance` placeholder mechanism that 07B activates \+ the `SSA-BIGQUERY-AGGREGATES` system-state-archive stub that 07B bodies — all referenced, never restated; 07B is the warehouse-side activation site for 07E's V1.1+ warehouse declarations); Doc 06A V1.0 (§3 platform stack inventory — BigQuery added as Tier-1 target-state vendor via W-07-PostHog-BQ; §7 environment matrix — BigQuery datasets per-environment); Doc 06C V1.0 (§6 severity crosswalk consumed by reference — 07B V1 owns no alerts per INV-07-09); Doc 06D V1.0 (§9 retention policy registry — 07B's warehouse-side retention behavior consumes the analytics-layer entries that 07E registers and the RB-06D-V1-19 schema extension; §8.7 family-wide no-PII proof-artifact rule applies to 07B's proof artifacts; §11 privacy-incident sub-class — 07B warehouse PII conformance failures produce privacy incidents via the standard mechanism); Doc 06E V1.0 (§4 launch-vs-target convention adopted; §5 vendor inventory \+ §7 cost-structure documentation pattern \+ §10 substrate-cap discipline \+ §13 pricing snapshot — BigQuery vendor body lands via W-07-PostHog-BQ; 07B references the cost-model pattern, never restates the vendor cost body); Doc 03C V3.0 (LISA GCP orchestration substrate — Cloud Run / Vertex / Cloud Tasks; if 07B's BigQuery export pipeline is Cloud-Run-orchestrated, that GCP substrate is owned by Doc 03C as a 03C V1.1+ amendment per the W-07B-DOC03C-EXPORT-SUBSTRATE additive, NOT by 07B); Doc 05B V1.0 (mastery KPI body math — referenced by KPI-LRN-01 / KPI-LRN-05 registry entries, never restated); Doc 04 family V1.0 (exam runtime / scoring — referenced by KPI-LRN-02 / KPI-LRN-03 / KPI-LRN-06 registry entries); Doc 01 V6.0 / Doc 01A V1.0 (Supabase user\_id semantics \+ §3 config doctrine for `infra/kpi-registry.yaml` registration). **Forward-references (bounded; inherited from Parent):** FWD-07-01 (Doc 09 financial unit economics — KPI-BIZ-03 / KPI-BIZ-04 / KPI-OPS-01 / KPI-OPS-02 registry entries cite Doc 09 as the V1.1+ canonical owner for financial bodies; 07B owns the technical measurement surface, Doc 09 owns the financial formula); FWD-07-02 (Doc 08 multi-vertical analytical model — 07B V1 covers single-vertical SAT warehouse model only; multi-vertical dimensional fork belongs to Doc 08); FWD-07-03 (Doc 10 brand/social-proof analytics — dashboard/community-engagement surface, not warehouse-model layer). **New 07B-originated forward-refs / additives:** FWD-07B-01 (Doc 07C dashboards consume 07B's warehouse models \+ KPI registry as their data source — bounded; resolves when 07C drafts); FWD-07B-02 (Doc 07D experimentation analytics consume 07B's event-fact tables for experiment-arm tagging — bounded; resolves when 07D drafts); W-07B-DOC03C-EXPORT-SUBSTRATE (cross-doc additive owed to Doc 03C for any Cloud-Run-orchestrated BigQuery export pipeline substrate — see §6 \+ §19). **Applies to:** the BigQuery dataset/project/table architecture (§5 — dataset layout, table naming, partitioning \+ clustering discipline, environment-scoped datasets); the PostHog → BigQuery export/ingestion contract (§6 — export mechanism, backfill behavior, replay/idempotency model, schema-version handling, the W-07B-DOC03C-EXPORT-SUBSTRATE additive boundary); the raw event landing tables (§7 — landing-zone schema, ingestion-metadata columns, no-transform-on-land discipline); the normalized event model (§8 — typed event tables, schema-version reconciliation, historical-event compatibility); the fact \+ dimension model layer (§9 — declared-shape target-state V1.1+; fact/dimension contracts named with owning-doc citations, full modeling deferred to 07C consumption demand); the cohort \+ learning-trajectory model layer (§10 — declared-shape target-state V1.1+; cohort/trajectory model contracts named, full modeling deferred); the warehouse-side PII \+ historical redaction conformance (§11 — bodies 07E's `ci/historical-pii-conformance` warehouse-side half of INV-07-02, validates historical events across all schema versions against 07A's redaction contract); the warehouse-side retention \+ cascade \+ under-13 deletion propagation (§12 — bodies 07E's BigQuery cascade behavior; deletion-status verification; late-arriving-row tombstone/blocklist discipline); the system-state-archive warehouse integration (§13 — bodies 07E's `SSA-BIGQUERY-AGGREGATES` stub; timestamp semantics; join rules with event stream \+ versioned system artifacts); the BigQuery cost \+ partitioning \+ query-governance discipline (§14 — scan caps, partition-required discipline, materialized-vs-view rules, scheduled-query cadence, references 06E cost-model pattern \+ the W-07-PostHog-BQ BigQuery subsection); the `infra/kpi-registry.yaml` 35-KPI canonical roster with two owned proving mechanisms `ci/kpi-canonical-owner-cite` (INV-07-05) \+ `ci/kpi-body-no-restate` (INV-07-06) \+ audit P27 (§9.5 — launch-required KPI registry); the §16 audit profile inheriting the family passes \+ applying P31 vocabulary-consistency discipline; the §17 acceptance criteria. **Explicitly excludes:** event definitions \+ event-time payload schema (Doc 07A owns — `infra/event-schema-registry.yaml` \+ the 25 V1 events \+ the `emitEvent` boundary \+ the `analytics_user_id` HMAC contract — referenced, never restated); retention class taxonomy \+ privacy cascade policy (Doc 07E owns — the `personal_data_with_inactivity_expiry` \+ `pseudonymized_indefinite_retention_pending_anonymization_review` classes \+ the Layer-4 cascade body \+ the under-13 hard-delete-everywhere policy \+ the proposed compliance posture — referenced, never restated); platform retention registry substrate \+ compliance-gate process (Doc 06D owns — §9 `infra/retention-policy-registry.yaml` schema \+ §10 compliance-evidence process — referenced, never restated); per-platform infra cost body (Doc 06E §7 owns the vendor cost structures including the BigQuery subsection landing via W-07-PostHog-BQ — referenced, never restated); mastery KPI body math (Doc 05B §3-§5 owns the acc formula \+ position decay \+ difficulty/source weights \+ 5-level threshold — referenced, never restated); LISA cost/cap bodies (Doc 03 Main §11 / §24 canonical); financial unit economics body (Doc 09 — FWD-07-01); GCP orchestration substrate (Doc 03C owns Cloud Run / Vertex / Cloud Tasks — any export-pipeline substrate is a 03C V1.1+ amendment via W-07B-DOC03C-EXPORT-SUBSTRATE); student-facing reporting (Doc 04C / app surfaces); dashboard substrate (Doc 07C target-state V1.1+); experimentation framework (Doc 07D target-state V1.1+).

---

# **§1 — Purpose & Position in the Doc 07 Family**

## **1.1 What 07B is**

Doc 07B is the **warehouse contract**: it specifies how Lyceon's analytics events — captured at runtime per Doc 07A's event-schema contract and buffered in PostHog — flow into a BigQuery warehouse, how they land and normalize, how they model into facts/dimensions/cohorts, how they obey the retention/cascade/PII obligations Doc 07E declared, and how warehouse cost stays bounded. It is the third launch-required-content sub-doc in the Doc 07 family.

Per Doc 07 Parent §4's "spec-locked, infrastructure-target-state" framing, **07B is the most target-state-leaning of the launch-required sub-docs**: the running BigQuery warehouse is V1.1+ infrastructure (BigQuery is a Tier-1 *target-state* vendor per the W-07-PostHog-BQ additive, distinct from PostHog which is Tier-1 *launch-required*). What is **launch-required at V1** is the spec contract — the warehouse model definitions, the export contract, the PII-conformance contract, the cascade-propagation contract — AND the `infra/kpi-registry.yaml` canonical KPI roster (names \+ canonical-owner citations \+ the 6 bodied KPIs), which is launch-required per Doc 07 Parent §5.1 ("KPI registry \+ canonical owner citations launch-required; warehouse model body target-state").

The single most important discipline 07B enforces, stated up front: **07B is not an "analytics wish-list doc."** It is a warehouse engineering contract — tables, joins, ingestion idempotency, retention behavior, deletion behavior, PII conformance, cost controls, and proof mechanisms. KPI bodies that belong to other docs (05B mastery math, 03 §24 LISA cost, 06E §7 vendor cost, Doc 09 financial unit economics) are **cited by exact §, never restated** (Decision 5; INV-07-06; audit P27).

## **1.2 What 07B owns vs references (the one-question-per-doc boundary)**

Per the canonical doc-architecture principle (each doc owns exactly one major question; later docs reference earlier ones, never restate), 07B's question is: **"How does Lyceon store, model, and govern analytics data in the warehouse — without losing events, leaking PII, retaining what must be deleted, or running unbounded cost?"**

07B owns the warehouse substrate \+ the KPI registry. It does NOT own: the events themselves (07A), the retention/privacy policy (07E), the registry substrate (06D), the cost bodies (06E), the mastery math (05B), or the GCP orchestration substrate (03C). The §18 cross-doc seam table grounds every one of these boundaries by exact §.

## **1.3 The V1 deliverable vs the V1.1+ infrastructure**

**Launch-required at V1 (the spec deliverable):**

* The `infra/kpi-registry.yaml` canonical 35-KPI roster (names \+ `canonical_owner_doc_and_section` citations \+ the 6 bodied KPIs) with `ci/kpi-canonical-owner-cite` (INV-07-05) \+ `ci/kpi-body-no-restate` (INV-07-06) hard-fail at V1 (§9.5).  
* The warehouse model spec contracts: dataset/table architecture (§5), export/ingestion contract (§6), raw landing (§7), normalized model (§8) — **specified, not deployed**.  
* The warehouse-side PII conformance contract (§11), cascade-propagation contract (§12), SSA integration contract (§13), cost-governance discipline (§14) — **specified, not deployed**.

**Target-state V1.1+ (the infrastructure body, activates per W-07-PostHog-BQ BigQuery Tier-1 substrate activation):**

* The running BigQuery warehouse (datasets created, tables materialized).  
* The live PostHog → BigQuery export pipeline (§6 — the W-07B-DOC03C-EXPORT-SUBSTRATE additive supplies the Cloud-Run orchestration substrate via Doc 03C if Cloud-Run-orchestrated).  
* The activated `ci/historical-pii-conformance` runtime body (§11 — placeholder at 07E V1; 07B bodies the spec; runtime activates when BigQuery export is live).  
* The fact/dimension/cohort/trajectory model bodies (§9-§10 — declared-shape stubs at V1; bodied when Doc 07C dashboard demand requires them).  
* The `SSA-BIGQUERY-AGGREGATES` archive body (§13 — 07E V1.1+ stub; 07B bodies the integration contract; activates with warehouse export).

## **1.4 Two standing directives applied to 07B**

Per Karl's locked directives for the family going forward:

1. **No cleanup register.** 07B carries **§20 Change Records** (which capture locked-decision rationale — reader-relevant for a spec) but does NOT carry a cleanup register section. In-lock-cycle SWE cleanup items are recorded in the relevant §20 change record narrative, not in a standalone register table. (This is a deliberate departure from 07A/07E which carried both; not retroactively stripped from those locked docs.)  
2. **Strict no-redundancy / Decision 5\.** If a primitive is owned by another doc, 07B references it by exact § and never restates it. Where 07B must describe cross-doc behavior, it cites "defined in \[Doc XX §Y\], canonical and referenced" and adds only the warehouse-side wrapper. The DD-07-REDEF defect class (any 07B line that restates a number/mechanism another doc owns) is checked by the §16 audit.

---

# **§2 — Scope & Boundary**

## **2.1 In scope (07B owns)**

The BigQuery dataset/project/table architecture (§5); the PostHog → BigQuery export/ingestion contract including backfill \+ replay/idempotency \+ schema-version handling (§6); the raw event landing tables (§7); the normalized event model with historical-event compatibility (§8); the fact \+ dimension model layer — declared-shape V1.1+ (§9); the cohort \+ learning-trajectory model layer — declared-shape V1.1+ (§10); the warehouse-side PII \+ historical redaction conformance bodying 07E's `ci/historical-pii-conformance` (§11); the warehouse-side retention \+ cascade \+ under-13 deletion propagation bodying 07E's BigQuery cascade behavior (§12); the system-state-archive warehouse integration bodying 07E's `SSA-BIGQUERY-AGGREGATES` (§13); the BigQuery cost \+ partitioning \+ query-governance discipline (§14); the `infra/kpi-registry.yaml` 35-KPI canonical roster \+ INV-07-05 \+ INV-07-06 proving mechanisms (§9.5 — launch-required).

## **2.2 Ownership boundary table (07B owns / referenced owner)**

| Concern | Owner | 07B section |
| ----- | ----- | ----- |
| BigQuery dataset/table architecture | **07B** | §5 |
| PostHog → BigQuery export contract | **07B** | §6 |
| Cloud-Run orchestration substrate for export | Doc 03C V3.0 (V1.1+ amendment via W-07B-DOC03C-EXPORT-SUBSTRATE) | §6 references |
| Raw landing \+ normalized event tables | **07B** | §7 / §8 |
| Event definitions \+ event-time payload schema | Doc 07A V1.0 §5/§6 | §8 references |
| `analytics_user_id` HMAC derivation | Doc 07A V1.0 §7 | §8 / §12 references |
| Event-time PII redaction contract | Doc 07A V1.0 §8 | §11 references |
| Fact/dimension/cohort/trajectory models | **07B** (declared-shape V1.1+) | §9 / §10 |
| Warehouse-side `ci/historical-pii-conformance` | **07B** (bodies 07E's warehouse-side INV-07-02 half) | §11 |
| Retention class taxonomy \+ cascade policy | Doc 07E V1.0 §5/§7/§10 | §12 references |
| BigQuery cascade behavior (the policy) | Doc 07E V1.0 §7.3/§10 | §12 references |
| BigQuery cascade mechanism (how it executes) | **07B** | §12 |
| Platform retention registry substrate | Doc 06D V1.0 §9 (+ RB-06D-V1-19 schema extension) | §12 references |
| `SSA-BIGQUERY-AGGREGATES` archive (the registry entry) | Doc 07E V1.0 §11 | §13 references |
| `SSA-BIGQUERY-AGGREGATES` warehouse integration (the body) | **07B** | §13 |
| BigQuery cost/query governance (warehouse-design discipline) | **07B** | §14 |
| BigQuery vendor cost body ($ cost model, substrate-cap) | Doc 06E §7 (BigQuery subsection via W-07-PostHog-BQ) | §14 references |
| `infra/kpi-registry.yaml` 35-KPI roster | **07B** | §9.5 |
| Mastery KPI body math | Doc 05B V1.0 §3-§5 | §9.5 references |
| LISA cost/cap KPI bodies | Doc 03 Main §11/§24 | §9.5 references |
| Financial unit economics KPI bodies | Doc 09 (FWD-07-01) | §9.5 references |

## **2.3 Out of scope (referenced, never restated)**

Per Decision 5, the following are explicitly NOT 07B's to define — 07B references the canonical owner by exact §:

* **Event definitions \+ the `emitEvent` boundary** → Doc 07A V1.0 §5/§6/§9.  
* **The `analytics_user_id = HMAC-SHA256(supabase_user_id, ANALYTICS_SALT)` contract** → Doc 07A V1.0 §7.  
* **The split-enum PII redaction contract** (`event_redaction_method` runtime 4-enum \+ `proof_artifact_redaction_method` proof-artifact 4-enum) → Doc 07A V1.0 §8.  
* **The retention class taxonomy \+ cascade policy \+ under-13 policy \+ proposed compliance posture** → Doc 07E V1.0 §5/§7/§8/§10.  
* **The Doc 06D §9 retention registry substrate \+ the RB-06D-V1-19 schema extension \+ the §10 compliance-evidence process** → Doc 06D V1.0.  
* **The Doc 05D §10 cascade orchestration base** → Doc 05D V1.0 §10 (07E owns the Layer-4 analytics target body; 07B owns only the BigQuery-mechanism wrapper).  
* **The per-vendor infra cost bodies** → Doc 06E §7 (BigQuery subsection via W-07-PostHog-BQ).  
* **The mastery KPI body math** → Doc 05B §3-§5.  
* **The GCP orchestration substrate** → Doc 03C V3.0 (export-pipeline substrate via W-07B-DOC03C-EXPORT-SUBSTRATE).  
* **Dashboards** → Doc 07C (target-state V1.1+). **Experimentation** → Doc 07D (target-state V1.1+). **Student-facing reporting** → Doc 04C.

---

# **§3 — Threat Model**

The warehouse is the place where "we kept everything forever" meets "we promised to delete some of it and never leak PII." The threats are specific to that tension. Each threat names its defense by reference to the owning mechanism.

1. **BigQuery stores raw PII from historical PostHog events.** PostHog events are captured per 07A's redaction contract — but if a historical event was emitted before a redaction rule existed, or a schema version slipped a PII field through, that PII lands in BigQuery and is retained "forever" in the pseudonymized class. The warehouse becomes the place a redaction failure becomes permanent. *Defense:* §11 bodies 07E's `ci/historical-pii-conformance` (the warehouse-side half of INV-07-02, joint with 07A's event-time half) — it validates historical events in BigQuery **across all schema versions ever emitted** against 07A's registry redaction contract, and hard-fails on any forbidden-identifier value or unredacted PII field. The "we kept everything forever and never leaked PII" audit trail.

2. **Under-13 rows survive in the warehouse after cascade.** Doc 07E §10 requires under-13 hard-delete-everywhere (Supabase \+ PostHog \+ BigQuery \+ every surface). If the warehouse-side cascade doesn't propagate, under-13 event rows survive in BigQuery and — worse — could be swept into an ML training corpus, triggering algorithmic-disgorgement risk (07E §3 threat 2; Edmodo/Kurbo FTC precedent). *Defense:* §12 bodies the warehouse-side under-13 deletion propagation (referencing 07E §10 as the policy owner) \+ deletion-status verification for BigQuery rows \+ the ML-training-exclusion invariant 07E §10.6/§12.5 declares (referenced, never restated).

3. **Unbounded BigQuery cost.** A single unpartitioned full-table scan over a "forever" event store can scan terabytes and generate a four-figure query bill in seconds; a runaway scheduled query compounds it daily. The "keep everything forever" retention model makes the warehouse the highest-magnitude cost-runaway surface in the analytics layer. *Defense:* §14 partition-required discipline on every large table \+ scan-cap discipline (maximum-bytes-billed guardrails) \+ materialized-vs-view rules \+ scheduled-query cadence governance; references Doc 06E §7 BigQuery cost-model \+ §10 substrate-cap discipline (the $-cost body lives in 06E; 07B owns the warehouse-design discipline that produces bounded scans).

4. **Schema drift between 07A and the warehouse.** 07A's `infra/event-schema-registry.yaml` evolves (strict→loose tier promotions, new V1.1+ events, property additions). If the warehouse ingestion doesn't track schema versions, the normalized model silently bifurcates — old rows in one shape, new rows in another, joins producing wrong aggregates. *Defense:* §6 schema-versioned ingestion (every landed row carries the observed `schema_version` per 07A §5.6 semantics) \+ §8 normalized-model schema-version reconciliation \+ a parity check that the warehouse's known schema versions are a subset of 07A's registry history.

5. **"Pseudonymized" overclaimed as "anonymous" in warehouse documentation.** The warehouse is where the retained data physically lives, so warehouse docs are tempting to describe as holding "anonymized" data. Per 07E's hard-won P31 discipline (5 cleanup rounds), the V1 legal status is **pseudonymized**, not anonymized. *Defense:* 07B inherits 07E's P31 vocabulary-consistency discipline (§16) — every reference to the retained warehouse data uses "pseudonymized" (07E's canonical vocabulary per RB-07E-V1-02), citing Doc 07E §5.2 as the canonical owner of the legal posture; never "anonymized" outside the explicit carve-outs (verbatim Doc 05D/07E quotes, future legal-upgrade contexts with W5+W9 cite, identifier tokens, regulatory work-product names).

6. **Late-arriving events after cascade.** A user's cascade fires (deletion propagated to the warehouse) — then a buffered/delayed PostHog event for that same `analytics_user_id` arrives in a later export batch and gets inserted, resurrecting deleted data. *Defense:* §12 late-arriving-row discipline — a deletion-blocklist (tombstone) check against the set of cascaded `analytics_user_id`s before any warehouse insert; any late-arriving row keyed to a tombstoned identifier is dropped (for under-13: never inserted; for 13+: the row is already pseudonymized-at-fact since the Supabase bridge is gone, but the blocklist still prevents re-materializing identity-linked derived state).

7. **Analytics models silently redefine KPIs owned by other docs.** A warehouse fact/dimension model or a KPI registry entry restates the 05B mastery formula, the 03 §24 LISA cost tiers, or the 06E vendor cost rates — creating a second source of truth that drifts. *Defense:* INV-07-06 (`ci/kpi-body-no-restate`) \+ audit P27 — every KPI body must cite its canonical owner and must not match a restatable-primitive pattern (05B mastery formula tokens, 03 §24 cost-tier tokens, 06E §7 vendor-cost-rate tokens). The §9.5 KPI registry is names \+ citations \+ only the 6 deterministically-warehouse-measurable bodies.

8. **Warehouse becomes a second identity store.** If the warehouse joins `analytics_user_id` back to any identity-bearing field (email, name, Supabase user\_id), it reconstructs the bridge that 07E's cascade depends on severing. *Defense:* §5 \+ §8 — the warehouse keys exclusively on `analytics_user_id` (07A §7 contract); there is no identity-bearing column anywhere in the warehouse; no join path from `analytics_user_id` back to Supabase identity exists by construction (the HMAC is uninvertible and the salt is server-only per 07A §7 / 06D §8.7).

---

# **§4 — Launch vs V1.1+ Warehouse Framing**

Per Doc 07 Parent §4 (the "spec-locked, infrastructure-target-state" framing) and 06E §4 (the `launch_required: bool` annotation convention adopted family-wide), every 07B mechanism declares its launch-required status. 07B is the sub-doc where this framing is most consequential, because the warehouse itself is target-state.

## **4.1 Launch-required at V1**

* **`infra/kpi-registry.yaml` 35-KPI roster** (names \+ `canonical_owner_doc_and_section` citations \+ the 6 bodied KPIs) — `launch_required: true`. Per Parent §5.1: "KPI registry \+ canonical owner citations launch-required." The reason it's launch-required even though the warehouse is target-state: the KPI registry is the canonical anti-drift contract (Parent §3 threat 6 — KPI definition drift undermines internal trust); it must exist and be owner-cited from V1 so that every consumer (founder dashboard, investor deck, engineering metrics) references one canonical name set.  
* **`ci/kpi-canonical-owner-cite`** (INV-07-05) — `launch_required: true`. Hard-fails on any KPI registry entry without a resolving `canonical_owner_doc_and_section`.  
* **`ci/kpi-body-no-restate`** (INV-07-06) \+ audit P27 — `launch_required: true`. Hard-fails if any KPI body restates a primitive owned by another doc.

## **4.2 Target-state V1.1+ (activates per W-07-PostHog-BQ BigQuery Tier-1 substrate activation)**

* The BigQuery dataset/table architecture **body** (§5 — spec is launch-required; created datasets are V1.1+).  
* The PostHog → BigQuery **export pipeline** (§6 — contract is launch-required; running pipeline is V1.1+; the Cloud-Run substrate is a Doc 03C V1.1+ amendment via W-07B-DOC03C-EXPORT-SUBSTRATE).  
* The raw landing \+ normalized event **tables** (§7 / §8 — schema spec is launch-required; materialized tables are V1.1+).  
* The fact/dimension/cohort/trajectory **model bodies** (§9 / §10 — declared-shape contracts at V1; full bodies activate when Doc 07C dashboard demand requires them).  
* The **`ci/historical-pii-conformance` runtime body** (§11 — 07B bodies the spec at V1; runtime activates when BigQuery export is live, bodying 07E §12.3's placeholder).  
* The warehouse-side **cascade execution** (§12 — propagation contract is launch-required; running cascade against BigQuery is V1.1+ per 07E §7.3 "BigQuery-side V1.1+").  
* The **`SSA-BIGQUERY-AGGREGATES` archive body** (§13 — 07E V1.1+ stub; 07B bodies the integration contract; activates with warehouse export).

## **4.3 Deploy-gate class**

07B adopts the **SPEC\_CONTRACT\_GATE** class introduced in Doc 07 Parent §4: 07B's spec must lock before downstream consumers (Doc 07C dashboards, Doc 07D experimentation) can build against the warehouse model, even though the warehouse infrastructure is target-state. 07B also inherits the **W-07-PostHog-BQ deploy gate** (Parent §11 W3 / RB-07-Parent-V1-06): 07B's BigQuery-targeted warehouse-model deploy-proof is blocked until 06E's `RB-06E-V1-15/16` lands (BigQuery registered as Tier-1 target-state vendor with §5 inventory \+ §6.3 outage runbook \+ §7 cost structure \+ §10 substrate-cap \+ §13 pricing snapshot). **Spec lock proceeds in parallel; deploy-proof does not.**

---

# **§5 — BigQuery Dataset & Table Architecture**

**launch\_required: false (spec is launch-required; created datasets are V1.1+ per §4.2).** The dataset/table architecture spec is the launch deliverable; the materialized BigQuery datasets activate when the warehouse export goes live per W-07-PostHog-BQ.

## **5.1 Project & dataset layout**

The warehouse lives in the Lyceon GCP project (the same project that hosts the Doc 03C LISA orchestration substrate — GCP project layout is owned by Doc 06A §3 platform stack \+ Doc 03C; 07B does not redefine the project, it adds datasets within it). Datasets are **environment-scoped** per Doc 06A §7 environment matrix:

| Dataset | Environment | Purpose |
| ----- | ----- | ----- |
| `lyceon_analytics_raw_dev` / `_staging` / `_prod` | per-env | Raw event landing zone (§7) — holds BOTH the vendor-shaped append-only export table (`raw__posthog_events_export`) AND the Lyceon-derived deduped canonical table (`raw__events_canonical`); ingestion-metadata-tagged |
| `lyceon_analytics_normalized_dev` / `_staging` / `_prod` | per-env | Normalized typed event tables (§8) — read only from `raw__events_canonical` |
| `lyceon_analytics_models_dev` / `_staging` / `_prod` | per-env | Fact/dimension/cohort/trajectory models (§9/§10 — V1.1+) |
| `lyceon_analytics_archive_dev` / `_staging` / `_prod` | per-env | System-state-archive aggregates (§13 — `SSA-BIGQUERY-AGGREGATES` body) |
| `lyceon_analytics_ops_dev` / `_staging` / `_prod` | per-env | Warehouse operational substrate: `analytics_user_partition_index` (§12.4), the under-13 deletion blocklist/tombstone set (§12.5), conformance watermarks (§11.3) |

Per-environment datasets carry per-environment `analytics_user_id` values (the HMAC salt is per-environment per Doc 07A §7 — so a Dev `analytics_user_id` and a Prod `analytics_user_id` for the same conceptual user are different and non-joinable; this is a feature, not a bug — it prevents cross-environment identity correlation).

## **5.2 Table naming discipline**

Tables follow `<event_class>__<event_name>` for raw/normalized event tables (e.g. `practice__practice_session_started`), `fact__<grain>` for fact tables, `dim__<entity>` for dimension tables, `cohort__<definition>` for cohort tables. The `<event_class>` and `<event_name>` segments MUST match the canonical names in Doc 07A's `infra/event-schema-registry.yaml` (referenced, never restated) — a naming parity that the §6 ingestion contract enforces.

## **5.3 Partitioning & clustering discipline (the cost-control foundation)**

**Every event table MUST be partitioned.** This is a hard architectural invariant (not a recommendation), because the "keep everything forever" retention model makes unpartitioned full-table scans the primary cost-runaway threat (§3 threat 3). The discipline:

* **Partition column:** every event table is partitioned by `event_date` (DATE, derived from the event's `occurred_at` timestamp at ingestion). Daily partitioning is the default grain.  
* **Clustering:** event tables cluster by `event_name` then `analytics_user_id` (the two highest-selectivity filter columns for typical analytics queries).  
* **Partition-expiration:** NOT set on event tables (retention is "forever" for the pseudonymized 13+ class per 07E §5.2; deletion is cascade-driven per §12, not partition-expiration-driven). System-state-archive tables (§13) similarly carry no partition expiration. **This is the one place 07B deviates from BigQuery default cost-hygiene** (which would set partition expiration) — and the deviation is deliberate and documented: retention is policy-driven (07E), not TTL-driven.

The §14 cost-governance discipline builds on this foundation: partition-required \+ clustering means typical analytics queries scan a bounded date range \+ filter set rather than the full "forever" store.

## **5.4 No-PII architectural invariant (RB-07B-V1-04 corrected)**

No table in any warehouse dataset has an **identity-bearing** column. The only user identifier anywhere in the warehouse is `analytics_user_id` (Doc 07A §7 — HMAC-derived, uninvertible, server-only salt). There is no `email`, no `name`, no `phone`, no `DOB`, no `supabase_user_id`, and **no identity-bearing free-text column** that could carry PII anywhere in the warehouse.

**The one permitted free-text/JSON exception (RB-07B-V1-04):** the raw `properties` JSON column is permitted **only in the vendor/raw landing layer** (`raw__posthog_events_export` and `raw__events_canonical` — §7), where it holds the raw event properties as exported from PostHog. This raw JSON is already redacted at event-time per Doc 07A §8 (`emitEvent` applies the per-property redaction posture at capture), and it is governed by 07B's §11 historical PII conformance (which validates the landed JSON across all schema versions against 07A's redaction contract). The raw JSON layer is the one place "everything as captured" lands faithfully so that (a) normalization can rebuild from raw and (b) §11 can audit the full event stream for PII.

**Everywhere else the ban is absolute:** the normalized (§8), model (§9/§10), archive (§13), KPI (§9.5), and proof-artifact layers MUST NOT introduce unconstrained JSON or free-text columns. The normalized layer flattens the raw JSON into typed, registry-matched columns (§8.1); downstream layers carry only typed columns \+ the opaque `analytics_user_id`. This is enforced by §11's `ci/historical-pii-conformance` against the 07A redaction contract, and it is also an architectural rule stated here so that table DDL review catches a violation before ingestion, not after. (§3 threat 8 — the warehouse must never become a second identity store; the raw JSON is permitted but contains no identity-bearing field by virtue of 07A's event-time redaction, and §11 proves it.)

---

# **§6 — PostHog Export / Ingestion Contract**

**launch\_required: false (contract is launch-required; running pipeline is V1.1+).** The export contract is the launch deliverable; the running pipeline activates when the warehouse goes live per W-07-PostHog-BQ. The Cloud-Run orchestration substrate (if used) is a Doc 03C V1.1+ amendment per W-07B-DOC03C-EXPORT-SUBSTRATE.

## **6.1 Export mechanism (RB-07B-V1-01 — vendor export shape separated from Lyceon projections)**

PostHog is the V1 launch-required analytics substrate buffer (Doc 07A §9 — `emitEvent` routes to the PostHog SDK; PostHog is the Tier-1 launch-required vendor per W-07-PostHog-BQ). BigQuery is the V1.1+ target-state warehouse the events flow *into*.

**The canonical export path is PostHog's managed first-party batch export to BigQuery** (Q1=a). PostHog's managed batch-export writes events into a **single vendor-shaped landing table**, not into Lyceon-defined per-event tables — the managed export's output shape is owned by the PostHog vendor, and 07B does not assume the managed export can route each event into separate Lyceon per-event raw tables. The three-tier warehouse ingestion architecture is therefore:

PostHog managed batch export  
  └─▶ raw\_\_posthog\_events\_export        (vendor-shaped, append-only; duplicate UUIDs MAY exist)  
        └─▶ raw\_\_events\_canonical        (Lyceon-derived; deduped; exactly one row per posthog\_event\_uuid)  
              └─▶ normalized\_\_\<event\_class\>\_\_\<event\_name\>   (Lyceon-derived; typed; reads ONLY from raw\_\_events\_canonical)  
                    └─▶ raw\_\_\<event\_class\>\_\_\<event\_name\>     (OPTIONAL Lyceon-derived per-event views/projections, if needed)

**Per-event raw tables are Lyceon-derived projections, not assumed direct PostHog export targets.** The managed export's only target is `raw__posthog_events_export`; everything downstream is a Lyceon-owned transform job.

If Lyceon later chooses a **custom export substrate** (e.g. a Cloud-Run job that routes events into per-event tables directly), that requires a custom GCP orchestration substrate and triggers `W-07B-DOC03C-EXPORT-SUBSTRATE` (§6.5) — the substrate is owned by Doc 03C, not 07B. At V1.1+ the canonical assumption is the managed export (Q1=a), so the additive is declared-but-likely-no-op.

The export contract:

* **Cadence:** scheduled batch export (hourly default; the cadence value is a config-doctrine setting per Doc 01A §3, materialized in the warehouse config, not hardcoded here).  
* **Source of truth:** PostHog is the source; `raw__posthog_events_export` is the destination. The export is one-directional (PostHog → BigQuery); the warehouse never writes back to PostHog.  
* **Payload:** each exported event carries the full PostHog event envelope (event\_name, `analytics_user_id` as the distinct\_id, properties, timestamp, `posthog_event_uuid`, and PostHog's own ingestion metadata).

## **6.2 Backfill behavior**

When the warehouse first activates (V1.1+), or after an export outage, a backfill replays the PostHog event history into the raw landing zone. Backfill obeys the same idempotency model as steady-state ingestion (§6.3) — replaying an already-landed event is a no-op (no duplicate row). Backfill is bounded by PostHog's own event-retention window (PostHog retains events per its plan; the warehouse backfill can only recover what PostHog still holds — this is why BigQuery export should activate early, to begin the "forever" retention before PostHog's window ages out the oldest events).

## **6.3 Replay / idempotency model (RB-07B-V1-02 — executable dedup architecture)**

The export-ingestion path is **idempotent**: replaying an event (backfill, export retry, duplicate batch) MUST NOT produce a duplicate row in the canonical raw table. The idempotency key is `posthog_event_uuid` (PostHog assigns a stable UUID per event at capture, usable for de-duplication).

**The architectural reality this must respect:** BigQuery does NOT enforce primary-key or uniqueness constraints (Google: BigQuery primary/foreign-key constraints are declarative-only and not enforced; the user must ensure data conforms). So uniqueness cannot be assumed at the table level — it must be *produced* by a dedup transform. The three-tier architecture (§6.1) is exactly what makes dedup executable:

* **`raw__posthog_events_export`** — the vendor export target, **append-only under normal ingestion/replay, duplicate UUIDs MAY exist** (the managed export may re-deliver on retry; backfill may overlap steady-state). This table is never deduped (the dedup happens building canonical); it is the faithful vendor landing. (Append-only is the normal posture, not immutability — compliance cascades per §12.3 are the one permitted mutation path; see §7.1.)  
* **`raw__events_canonical`** — the Lyceon-derived deduped raw table, **exactly one row per `posthog_event_uuid`**, built by a `MERGE` (or a deterministic dedup query: `ROW_NUMBER() OVER (PARTITION BY posthog_event_uuid ORDER BY _ingested_at) = 1`, keeping the first-landed row). The MERGE inserts only UUIDs not already present; replaying an already-canonical event is a no-op.  
* **Normalized tables read ONLY from `raw__events_canonical`** — so every downstream model, KPI, and aggregate computes over the deduped stream, never the raw vendor table.

**This mirrors the platform-wide idempotency discipline** (Doc 04B Stripe-style event-ledger idempotency; Doc 05A `(event_source_kind, event_id)` UNIQUE) — the warehouse applies the same "replay is safe" principle, adapted to BigQuery's no-enforced-uniqueness reality via the dedup transform. 07B references the principle; it does not restate the 04B/05A mechanisms.

**Proving mechanism — `ci/warehouse-event-dedup-conformance` (V1.1+):** fails if any `posthog_event_uuid` appears more than once in `raw__events_canonical`. This is the executable proof that the dedup transform actually produces uniqueness (since BigQuery won't enforce it). Declared in §15.2; six-element definition in §11A.

## **6.4 Schema-version handling**

Every exported event carries the `schema_version` it was emitted under (Doc 07A §5.6 schema-version semantics — major/minor bumps; referenced, never restated). The landing table records the observed `schema_version` per row. This is the foundation for §8's normalized-model schema-version reconciliation (handling the case where the same event\_name has been emitted under multiple schema versions over the "forever" retention window). The §6 ingestion enforces a parity check: every observed `schema_version` in the landing zone MUST be a known version in 07A's `infra/event-schema-registry.yaml` history (an unknown schema version is a drift signal — §3 threat 4 — and is recorded in the ingestion proof artifact, not silently landed).

## **6.5 The W-07B-DOC03C-EXPORT-SUBSTRATE boundary (ownership)**

Per Doc 07E §(cascade-substrate note): if the BigQuery export pipeline is orchestrated by Cloud Run (e.g. a Cloud Run service that triggers/monitors the PostHog batch export, or a custom export job), **that GCP substrate is owned by Doc 03C as a 03C V1.1+ amendment, NOT by 07B.** Doc 03C V3.0 owns the GCP orchestration substrate (Cloud Run service config, Cloud Tasks queues, etc.). 07B specifies the export *contract* (cadence, idempotency, schema-version handling, the no-PII landing discipline); the *substrate* that runs it is 03C's.

This is registered as the bundled cross-doc additive **W-07B-DOC03C-EXPORT-SUBSTRATE** (§19 watch items): when the V1.1+ warehouse export activates, if it requires Cloud-Run orchestration, Doc 03C applies a V1.1+ amendment registering the export-orchestration service in its substrate inventory. 07B references 03C as the canonical substrate owner. **If** the export uses only PostHog's first-party batch-export destination (no custom Cloud-Run orchestration), the additive is a no-op — PostHog's managed export needs no Lyceon-side GCP substrate. The additive is declared bounded and non-blocking; it resolves at V1.1+ warehouse activation when the orchestration approach is chosen.

---

# **§7 — Raw Event Landing Tables**

**launch\_required: false (schema spec launch-required; materialized tables V1.1+).**

## **7.1 Landing-zone discipline: land faithfully, dedup into canonical, transform downstream**

The raw landing zone holds two Lyceon-distinct tiers (§6.1):

* **`raw__posthog_events_export`** — the vendor export target. **Append-only under normal ingestion and replay behavior** (not an absolute immutability guarantee — see below). Events land exactly as the PostHog managed export delivers them — no normalization, no type coercion, no PII transformation (the PII redaction already happened at event-time per Doc 07A §8 `emitEvent`; the landing tier trusts that contract and §11 verifies it). Duplicate `posthog_event_uuid`s MAY exist here (export retries, backfill overlap). This tier's job is faithful capture so that (a) the canonical tier can be rebuilt by re-running the dedup, (b) the normalized model can be rebuilt from canonical, and (c) §11 historical-PII-conformance has the full event stream to audit across all schema versions. **Compliance cascades are the only permitted mutation path (RB-07B-V1-09):** under-13 hard-delete purges (§12.3) may delete rows from this table using the same partition-bounded delete discipline. "Append-only" describes the normal ingestion posture, NOT immutability against compliance-driven deletion — an implementation team must not treat this table as never-mutable, which would conflict with the under-13 hard-delete-everywhere obligation (07E §10).  
* **`raw__events_canonical`** — the Lyceon-derived deduped raw table (§6.3). Exactly one row per `posthog_event_uuid`, built by MERGE/dedup from `raw__posthog_events_export`. This is the single canonical raw source that normalized tables (§8) read from.

## **7.2 Landing table schema**

Both raw tiers live in the `lyceon_analytics_raw_<env>` dataset (§5.1). `raw__posthog_events_export` carries the vendor export shape; `raw__events_canonical` carries the same columns deduped:

* `posthog_event_uuid` (STRING) — the idempotency/dedup key (§6.3). One row per UUID in `raw__events_canonical`.  
* `analytics_user_id` (STRING) — the only user identifier (Doc 07A §7; uninvertible).  
* `event_name` (STRING) — matches 07A registry.  
* `schema_version` (STRING) — the observed emission schema version (§6.4).  
* `occurred_at` (TIMESTAMP) — event time.  
* `event_date` (DATE) — the partition column (§5.3), derived from `occurred_at`.  
* `properties` (JSON) — the raw event properties as exported (already redacted at event-time per 07A §8; permitted in the raw landing layer ONLY per §5.4 RB-07B-V1-04).  
* `_ingested_at` (TIMESTAMP) — warehouse ingestion timestamp (ingestion metadata; also the dedup tie-breaker — first-landed row wins).  
* `_export_batch_id` (STRING) — the export batch this row arrived in (ingestion metadata, for replay/audit).

The `properties` JSON is stored raw (not flattened) at the landing layer (the §5.4-permitted exception); flattening \+ typing happens at the normalized layer (§8), which reads from `raw__events_canonical`. This keeps landing faithful to the source and schema-version-agnostic.

## **7.3 The cascade tombstone pre-check (at canonical build)**

Beyond the dedup transform (§6.3), the canonical-build step applies the **cascade tombstone pre-check** (§12.5 — late-arriving-row discipline): when building `raw__events_canonical` from `raw__posthog_events_export`, the transform checks each candidate row's `analytics_user_id` against the under-13 deletion blocklist (tombstone set, held in `lyceon_analytics_ops_<env>` per §5.1). If the identifier is under-13-tombstoned, the row is **dropped (never promoted to canonical)** — this prevents a late-arriving under-13 event from resurrecting deleted data (§3 threat 6). For 13+ cascaded users, the row is promoted to canonical normally (it's already pseudonymized-at-fact since the Supabase bridge is gone per 07E §7.3); the blocklist is specifically the under-13 hard-delete enforcement surface. The tombstone set is owned by §12.5; §7.3 (the canonical-build step) is its first enforcement point. (Note: the vendor table `raw__posthog_events_export` is append-only under normal ingestion, so the tombstone drop happens at canonical-promotion, not at vendor-land — this keeps the vendor tier a faithful record under normal behavior while ensuring tombstoned identifiers never reach canonical/normalized/model layers. The vendor table's under-13 rows are themselves removed by the §12.3 compliance-cascade partition-bounded delete — the one permitted mutation path per §7.1 RB-07B-V1-09.)

---

# **§8 — Normalized Event Model**

**launch\_required: false (schema spec launch-required; materialized tables V1.1+).**

## **8.1 Normalized typed event tables**

The normalized layer transforms the raw landing JSON into typed, queryable columns. Each normalized table (`<event_class>__<event_name>` in `lyceon_analytics_normalized_<env>`) flattens the `properties` JSON into typed columns matching the event's JSON Schema in Doc 07A's `infra/event-schema-registry.yaml` (referenced, never restated — the registry is the canonical property contract; the normalized table is its typed warehouse projection). The normalized layer:

* Types each property per the registry's JSON Schema (string/number/boolean/timestamp).  
* Preserves `analytics_user_id`, `event_name`, `schema_version`, `occurred_at`, `event_date` (partition), and the idempotency UUID.  
* Adds no new user-identifying columns (§5.4 invariant holds).

## **8.2 Schema-version reconciliation (the historical-compatibility mechanism)**

Because retention is "forever" (07E §5.2), the same `event_name` may exist in the landing zone under multiple `schema_version`s spanning the entire retention window. The normalized model reconciles these:

* **Additive minor-version changes** (a new optional property added in a minor bump per 07A §5.6): the normalized table includes the new column; rows from older versions carry NULL for it. This is the common, safe case.  
* **Major-version changes** (a breaking change — property renamed, type changed, removed): the normalized model carries a `schema_version` discriminator and the normalization logic maps each major version's shape into the current normalized schema explicitly. Where a clean mapping is impossible, the older-version rows are normalized into a compatibility view that documents the gap (rather than silently coercing). The reconciliation logic is versioned alongside 07A's registry history.

This is §3 threat 4's defense: schema drift is handled by explicit version-aware normalization, not by hoping all events share one shape.

## **8.3 Historical-event compatibility contract**

The normalized model guarantees that a query against a normalized event table returns **semantically consistent** rows across the full retention window, even though the underlying raw events span schema versions. Where semantic consistency cannot be guaranteed (a major-version break that changed a metric's meaning), the normalized table surfaces the discontinuity explicitly (a `schema_version` filter or a documented compatibility boundary) rather than producing a silently-wrong aggregate. The §11 conformance check \+ the §16 audit verify that no normalized table silently merges incompatible schema versions.

## **8.4 The normalized layer is the KPI \+ model data source**

The §9 fact/dimension models and the §9.5 KPI registry's bodied KPIs read from the normalized layer (not the raw landing zone). This gives every downstream model \+ KPI a typed, schema-reconciled, schema-version-aware source — so a KPI like `daily_active_users` (KPI-ENG-01) computes over a consistent normalized event stream, not raw JSON.

---

# **§9 — Fact & Dimension Models \+ KPI Registry**

**§9.1-§9.4 (fact/dimension model bodies): launch\_required: false — declared-shape V1.1+ per Decision 2a (narrow first draft). §9.5 (KPI registry): launch\_required: true.**

## **9.1 Declared-shape discipline for the model layer**

Per the pre-draft decision (narrow first draft; SWE stance "07B must not become an analytics wish-list doc"), the fact/dimension model **bodies** are declared-shape target-state V1.1+: 07B names each fact/dimension model \+ its grain \+ its source normalized tables \+ its owning-doc citation, but defers full dimensional modeling (every column, every measure, every slowly-changing-dimension rule) to when Doc 07C dashboard demand requires a specific model. This avoids speculative modeling of dashboards that don't exist yet, while locking the model contracts so 07C has a stable target.

## **9.2 Fact table contracts (declared-shape)**

| Fact model | Grain | Source (normalized) | Owning-doc citation | Status |
| ----- | ----- | ----- | ----- | ----- |
| `fact__event` | one row per event | all `<event_class>__<event_name>` normalized tables | 07A event taxonomy | V1.1+ declared-shape |
| `fact__session` | one row per practice/exam session | practice \+ exam normalized events | Doc 02 / Doc 04 (session semantics) | V1.1+ declared-shape |
| `fact__subscription` | one row per subscription state-change | billing normalized events | Doc 01 billing / Doc 09 (FWD-07-01 financial body) | V1.1+ declared-shape |
| `fact__mastery_event` | one row per mastery event (BI-side observation) | mastery normalized events | Doc 05A/05B (mastery body canonical — referenced, never restated) | V1.1+ declared-shape |

Each fact table keys on `analytics_user_id` \+ `event_date`; carries no identity-bearing column; computes measures (counts, durations, amounts) but never restates a primitive body (e.g. `fact__mastery_event` records the BI-side observation that a mastery event occurred; it does NOT recompute the 05B mastery formula — that's 05B's body, referenced).

## **9.3 Dimension table contracts (declared-shape)**

| Dimension model | Entity | Source | Owning-doc citation | Status |
| ----- | ----- | ----- | ----- | ----- |
| `dim__user` | the analytics user (pseudonymized) | Person Properties (07A §7) | 07A §7 (`analytics_user_id` \+ the 4 Person Properties) | V1.1+ declared-shape |
| `dim__exam_date_cohort` | exam-date cohort | 07A §10 SAT calendar \+ cohort assignment | 07A §10 (`infra/sat-test-calendar.yaml`) | V1.1+ declared-shape |
| `dim__event_class` | the 8 canonical event classes | 07A registry | 07A §6 (8-class catalog) | V1.1+ declared-shape |
| `dim__date` | calendar date | generated | standard date dimension | V1.1+ declared-shape |

`dim__user` is the pseudonymized user dimension — it carries `analytics_user_id` \+ the 4 Person Properties from 07A §7 (`analytics_user_id`, `exam_date`, `exam_date_cohort_id`, `exam_date_source`) and nothing identity-bearing. It is subject to the §12 cascade (when a user is cascaded, their `dim__user` row is propagated per the age-stratified policy).

## **9.4 Cohort \+ learning-trajectory models → §10 (declared-shape)**

The cohort and learning-trajectory models are declared in §10 (also declared-shape V1.1+).

## **9.5 The `infra/kpi-registry.yaml` canonical KPI roster (launch-required)**

**launch\_required: true.** This is the launch-required core of 07B per Parent §5.1.

`infra/kpi-registry.yaml` is the canonical machine-readable KPI registry per Doc 06C §6.0 registry-canonical principle (the YAML is canonical; this markdown roster is reference, not source-of-truth). It carries the **35-KPI roster**: the 34 Parent-canonical KPIs (Doc 07 Parent §10) \+ KPI-ENG-11 `exam_anchored_engagement_rate` (added via the RB-07-Parent-V1-07 additive that Doc 07A's W-07A-PARENT-ADDITIVE applied to Parent — see §9.5.1 for the count reconciliation). **6 are bodied at V1; 29 are name-only stubs** with canonical-owner citations \+ V1.1+ activation triggers.

### **9.5.1 KPI count reconciliation (34 → 35\)**

Doc 07 Parent §10 locks the roster at **34 KPIs** (6 bodied, 28 stubs). Doc 07A's W-07A-PARENT-ADDITIVE (RB-07-Parent-V1-07, applied to Parent post-07A-LOCK) added the 8th `cohort` event class **and** KPI-ENG-11 `exam_anchored_engagement_rate` to the Parent §10 roster. The post-additive canonical count is therefore **35 KPIs (6 bodied, 29 stubs)**. 07B locks `infra/kpi-registry.yaml` at 35, with KPI-ENG-11 as a name-only stub (07B-owned, exam-anchored engagement measured from the cohort event class). This reconciliation is recorded in §20 CR-07B-01. (Per Doc 07A §245: the 35-count is the post-additive state; the Parent-canonical literal pre-additive value was 34\. 07B adopts the post-additive 35 because RB-07-Parent-V1-07 has landed.)

### **9.5.2 KPI registry entry shape**

Each registry entry carries:

kpis:  
  \- kpi\_id: \<stable id; format 'KPI-\<CATEGORY\>-\<NN\>'\>          \# e.g. KPI-ENG-01  
    kpi\_name: \<snake\_case canonical name\>                       \# e.g. daily\_active\_users  
    category: \<ENG | LRN | TUT | BIZ | OPS\>  
    status: \<bodied\_v1 | name\_only\_stub\>  
    canonical\_owner\_doc\_and\_section: \<resolves to Doc 07B itself OR a referenced owner doc \+ §\>  
    measurement\_body:                                           \# REQUIRED when status=bodied\_v1; NULL for stubs. Per RB-07B-V1-06, a bodied KPI MUST specify exact filters:  
      source\_event\_names:  
        numerator: \[\<exact 07A event\_name(s)\>\]                  \# e.g. \[exam\_completed\]  
        denominator: \[\<exact 07A event\_name(s)\>\]                \# e.g. \[exam\_started\]  (omit for count-style KPIs)  
      window\_semantics:  
        timezone: UTC                                           \# all warehouse windows are UTC  
        inclusion\_rule: \<exact rule\>                            \# e.g. "event\_date within trailing 30-day window inclusive of today"  
      dedup\_key: posthog\_event\_uuid                             \# the canonical dedup key (§6.3)  
      grain: \<day | user | cohort\>  
    v1\_1\_activation\_trigger: \<present only when status=name\_only\_stub; the trigger that bodies it\>  
    source\_normalized\_tables: \<which §8 normalized tables feed it\>

The `canonical_owner_doc_and_section` is the load-bearing INV-07-05 field: every KPI cites its owner. For 07B-owned KPIs (the warehouse-measurable ones), the owner is Doc 07B itself. For KPIs whose body lives elsewhere, the owner is the referenced doc (Doc 05B for mastery KPIs, Doc 03 Main §24 for LISA cost KPIs, Doc 06E §8 for infra cost KPIs, Doc 09 for financial KPIs via FWD-07-01).

**RB-07B-V1-06 — exact-filter requirement for bodied KPIs:** a `bodied_v1` KPI's `measurement_body` is not lock-grade unless it specifies exact `source_event_names` (numerator \+ denominator as exact 07A event\_names — referenced from the registry, never inventing new event names), `window_semantics` (UTC timezone \+ explicit inclusion rule), `dedup_key: posthog_event_uuid`, and `grain`. A summary like "completed-exam events / started-exam events" is insufficient — the YAML must carry the exact `[exam_completed] / [exam_started]` event-name filters so two implementers compute the identical number. This is what `ci/kpi-canonical-owner-cite` (§9.5.5) additionally checks for `bodied_v1` entries: a bodied KPI with an under-specified `measurement_body` (missing exact `source_event_names`, `window_semantics`, `dedup_key`, or `grain`) fails.

### **9.5.3 The 6 bodied-at-V1 KPIs (deterministically warehouse-measurable)**

Per Parent §10, the 6 KPIs bodied at V1 are the ones with a deterministic warehouse measurement that restates no other doc's primitive:

| KPI ID | Name | Owner | Measurement body (summary) |
| ----- | ----- | ----- | ----- |
| KPI-ENG-01 | `daily_active_users` | 07B | distinct `analytics_user_id` with ≥1 event where `event_date` \= day (UTC); grain=day; dedup\_key=posthog\_event\_uuid; source\_event\_names: any registered event |
| KPI-ENG-03 | `monthly_active_users` | 07B | distinct `analytics_user_id` with ≥1 event in trailing 30-day window (UTC, inclusive of today); grain=day; source\_event\_names: any registered event |
| KPI-ENG-06 | `d30_retention_rate` | 07B | numerator: distinct signup-cohort `analytics_user_id` with ≥1 event in days 28-30 post-signup; denominator: signup-cohort size; grain=cohort; source: `[user_signed_up]` (denominator) \+ any event (numerator) |
| KPI-LRN-02 | `exam_completion_rate` | 07B (refs Doc 04 family for exam event semantics) | numerator: `[exam_completed]`; denominator: `[exam_started]`; grain=day; UTC; dedup\_key=posthog\_event\_uuid |
| KPI-BIZ-01 | `subscription_conversion_rate` | 07B | numerator: `[subscription_activated]` (07A billing-class; the trial→paid or direct-paid activation per 07A §6.4); denominator: `[subscription_trial_started]` or `[user_signed_up]` per the exact registry filter; grain=cohort; UTC |
| KPI-BIZ-02 | `paid_subscriber_count` | 07B | distinct `analytics_user_id` in active-paid-subscription state (derived from 07A billing-class state-change events: `[subscription_activated]` net of `[subscription_cancelled]`); grain=day; source: billing normalized events |

Each bodied KPI computes over the §8 normalized event stream (which reads from `raw__events_canonical`, so the dedup is already applied). None restates a primitive body — e.g. `exam_completion_rate` counts 07A exam-class events (`[exam_completed] / [exam_started]`); it does not restate Doc 04B's scoring formula. The **exact** event-name filters, window semantics, dedup key, and grain for each live in `infra/kpi-registry.yaml` per the §9.5.2 RB-07B-V1-06 schema (the table above summarizes; the YAML is canonical and carries the full exact filters so two implementers compute the identical number). The exact event\_names cited are referenced from Doc 07A's `infra/event-schema-registry.yaml` canonical names — `exam_completed` \+ `exam_started` (07A exam class), `subscription_activated` \+ `subscription_trial_started` \+ `subscription_cancelled` (07A billing class §6.4 — note 07A §6.4 explicitly names `subscription_activated` as canonical for KPI-BIZ-01 \+ KPI-BIZ-02), `user_signed_up` (07A auth/cohort class). **07B does not invent event names** — `ci/kpi-canonical-owner-cite` (§9.5.5, RB-07B-V1-11) verifies every `source_event_names` value resolves to a canonical 07A registry event name (`kpi_event_name_registry_parity: PASS`). If any name in this doc's summary differs from the 07A registry, the registry name is canonical and the YAML uses it.

### **9.5.4 The 29 name-only stubs**

The remaining 29 KPIs are name-only stubs: locked canonical name \+ category \+ `canonical_owner_doc_and_section` citation \+ `v1_1_activation_trigger`, with `measurement_body: null`. They include the full ENG/LRN/TUT/BIZ/OPS roster per Parent §10 (e.g. KPI-ENG-02 `weekly_active_users`, KPI-LRN-01 `mastery_level_distribution` citing Doc 05B §3-§5, KPI-TUT-05 `tutor_cap_proximity_rate` citing Doc 03 Main §11/§24, KPI-OPS-01 `cost_per_mau` citing Doc 06E §8, KPI-BIZ-03 `churn_rate_monthly` citing Doc 09 via FWD-07-01) plus KPI-ENG-11 `exam_anchored_engagement_rate` (07B-owned, exam-anchored engagement from the cohort event class). KPI-TUT-02 `tutor_helped_rate` remains a name-only stub with no V1 body per Parent §10.6 (non-deterministic measurement; reserved name; V1.1+ implementers must not body it with a non-deterministic measurement).

### **9.5.5 The two owned proving mechanisms**

Per Parent §6.13 six-element implemented-definition discipline, 07B owns two KPI proving mechanisms (both launch-required):

**`ci/kpi-canonical-owner-cite` (INV-07-05):**

| Element | Definition |
| ----- | ----- |
| What it proves | Every KPI in `infra/kpi-registry.yaml` cites a resolving `canonical_owner_doc_and_section`; every bodied KPI's `source_event_names` resolve to canonical event names in Doc 07A's registry (RB-07B-V1-11) |
| Execution location | GitHub Actions, on PRs touching `infra/kpi-registry.yaml`; plus nightly |
| Input | `infra/kpi-registry.yaml` \+ the doc-reference resolution index (each cited doc \+ § must resolve to a referenced doc OR Doc 07B itself) \+ Doc 07A's `infra/event-schema-registry.yaml` event-name set (for `source_event_names` parity) |
| Failure condition | Any KPI entry with empty/unresolving `canonical_owner_doc_and_section`; any `bodied_v1` entry with null `measurement_body`; any `name_only_stub` with null `v1_1_activation_trigger`; **any `bodied_v1` entry whose `measurement_body` is missing exact `source_event_names` (numerator/denominator), `window_semantics` (timezone \+ inclusion\_rule), `dedup_key`, or `grain` (RB-07B-V1-06 — a bodied KPI must be exactly specified, not summarized)**; **any `source_event_names` value that is not a canonical event name in Doc 07A's `infra/event-schema-registry.yaml` (RB-07B-V1-11 — KPI event names must match the registry exactly; 07B does not invent event names)** |
| Proof artifact | `kpi-canonical-owner-cite` record per Parent §10.5 envelope \+ extras: `kpis_checked[]`, per-KPI `{kpi_id, owner_resolution, status, body_presence_check, trigger_presence_check, decision}`, plus \`kpi\_event\_name\_registry\_parity: PASS |
| launch\_required | true |

**`ci/kpi-body-no-restate` (INV-07-06) \+ audit P27:**

| Element | Definition |
| ----- | ----- |
| What it proves | No KPI `measurement_body` restates a primitive owned by another doc |
| Execution location | GitHub Actions, on PRs touching `infra/kpi-registry.yaml`; plus the §16 audit P27 pass |
| Input | `infra/kpi-registry.yaml` bodied entries \+ the restatable-primitive token sets (Doc 05B mastery-formula tokens, Doc 03 §24 cost-tier tokens, Doc 06E §7 vendor-cost-rate tokens) |
| Failure condition | Any bodied KPI whose `measurement_body` matches a restatable-primitive pattern (e.g. contains the 05B `0.5^((i-1)/30)` half-life expression, the 03 §24 `$20/$18/$10/<$6` tiers, or a 06E vendor cost rate) — such a body must instead cite the owner |
| Proof artifact | `kpi-body-no-restate` record per Parent §10.5 envelope \+ extras: `bodied_kpis_checked[]`, per-KPI `{kpi_id, restatable_pattern_scan_result, owner_citation_present, decision}` |
| launch\_required | true |

## **9.6 Registry-Bound KPI Views Layer (CR-07B-04 additive)**

**launch\_required: false (V1.1+ infrastructure — views materialize when the warehouse export activates per W-07-PostHog-BQ; view-layer contract is V1 spec, registered now). Added in-lock-cycle per CR-07B-04 to satisfy Doc 07C V1.0 R1 cleanup RB-07C-V1-03 (Q-07C-R1-1=a: 07B owns the mapping-layer substrate; 07C consumes via view names).**

### **9.6.1 What the views layer is**

For every entry in `infra/kpi-registry.yaml`, a corresponding **BigQuery view** lives in 07B's `lyceon_analytics_models_<env>` dataset (§5.1). The view's SQL is the canonical measurement body for that KPI — the same body declared in the registry entry's `measurement_body` (§9.5.2 / §9.5.3), now materialized as a queryable BigQuery view. Downstream consumers (Doc 07C dashboards, Doc 07D experimentation analytics, ad-hoc analytical queries) reference KPIs **by view name**, not by reinventing the SQL.

The views layer is **the substrate that makes the KPI registry consumable by tools that don't natively understand `infra/kpi-registry.yaml`**. BI tools (Looker Studio, Metabase, Hex — the V1.1+ dashboard-tool candidates per Doc 07C §6) consume the views as ordinary BigQuery views; the parity discipline (`ci/kpi-canonical-owner-cite` \+ `ci/kpi-body-no-restate`) operates on the views' SQL through the same INV-07-05 \+ INV-07-06 mechanisms.

### **9.6.2 View-naming convention**

Each view is named `kpi_<lowercase_id_with_underscores>` where the underscored form preserves the canonical `kpi_id` structure:

| `kpi_id` | View name |
| ----- | ----- |
| KPI-ENG-01 | `kpi_eng_01_daily_active_users` |
| KPI-ENG-03 | `kpi_eng_03_monthly_active_users` |
| KPI-ENG-06 | `kpi_eng_06_d30_retention_rate` |
| KPI-LRN-02 | `kpi_lrn_02_exam_completion_rate` |
| KPI-BIZ-01 | `kpi_biz_01_subscription_conversion_rate` |
| KPI-BIZ-02 | `kpi_biz_02_paid_subscriber_count` |
| ... | ... (one view per registered KPI) |

The naming convention is deterministic and reversible: given a view name, the `kpi_id` is recoverable, and given a `kpi_id`, the view name is computable. This is what enables INV-07-11 (Doc 07C §8.4) to validate dashboard-tile `kpi_id` references against the view layer by name-resolution, and what enables the `ci/kpi-canonical-owner-cite` extension (§9.6.5) to scan view SQL against canonical bodies.

### **9.6.3 View status mirrors KPI status**

A view materializes only when its underlying KPI is bodied:

* **`bodied_v1` KPI** → corresponding view activates at V1.1+ when the BigQuery warehouse export goes live per W-07-PostHog-BQ. At V1.1+ activation, the 6 V1-bodied KPIs (KPI-ENG-01, KPI-ENG-03, KPI-ENG-06, KPI-LRN-02, KPI-BIZ-01, KPI-BIZ-02) get their 6 corresponding views materialized in `lyceon_analytics_models_<env>`.  
* **`name_only_stub` KPI** → no view is materialized; the view name is *reserved* but the SQL is null until the KPI is bodied (its `v1_1_activation_trigger` per §9.5.4 fires).  
* **A KPI moves from `name_only_stub` to bodied → its view materializes** in the same operation that bodies the KPI registry entry.

This mirroring is the contractual link between the registry and the views layer: the views are projections of the registry, not an independent substrate. The §9.5 `infra/kpi-registry.yaml` is the canonical source-of-truth; the views are the BigQuery-tooling-friendly read surface.

### **9.6.4 What downstream consumers reference**

* **Doc 07C dashboards (V1.1+)** reference KPI views by name from their tile templates (per Doc 07C §6.2 criterion \#2 reframed by RB-07C-V1-03 and Doc 07C §11). A Looker Studio / Metabase / Hex dashboard tile selects `FROM lyceon_analytics_models_<env>.kpi_eng_01_daily_active_users` and surfaces the result; the tool does not need to understand `infra/kpi-registry.yaml`.  
* **Doc 07D experimentation analytics (V1.1+, FWD-07B-02 / FWD-07C-01 territory)** when drafted will likely reference KPI views the same way for experiment-arm metric computation.  
* **Ad-hoc analytical queries** by internal team members reference the views as the canonical KPI surface; "what is the canonical DAU?" is answered by `SELECT * FROM kpi_eng_01_daily_active_users`, not by an ad-hoc query that risks definition drift.

### **9.6.5 Parity discipline (the views inherit existing INV-07-05 \+ INV-07-06)**

No new audit pass or invariant is introduced by §9.6 — the existing parity discipline extends naturally:

* **`ci/kpi-canonical-owner-cite` (INV-07-05, §9.5.5)** extends to verify every materialized view in `lyceon_analytics_models_<env>` matches a `bodied_v1` (or formerly-stub-now-bodied) KPI in `infra/kpi-registry.yaml` — i.e., no orphan views, no missing views for bodied KPIs.  
* **`ci/kpi-body-no-restate` (INV-07-06, §9.5.5)** extends to verify each view's SQL is the canonical measurement body (`source_event_names` \+ `window_semantics` \+ `dedup_key` \+ `grain` per RB-07B-V1-06 \+ RB-07B-V1-11) — not a divergent or restated definition. The view IS the canonical body; it does not contain a competing one.  
* **Audit pass P27** continues to verify the parity (KPI registry ↔ view layer) at the same cadence it verifies the KPI registry alone.

The views layer is therefore additive to the existing parity discipline, not a new enforcement surface. This is why §9.6 introduces no new launch-required invariant.

### **9.6.6 Cascade behavior for the views**

The views are stateless projections (SQL views, not materialized tables) — they hold no row-level data themselves; they query 07B's normalized event stream (§8) on read. Cascade obligations therefore flow through the underlying normalized tables (§12 — partition-bounded under-13 hard-delete, 13+ pseudonymized-at-fact), and the views automatically reflect the post-cascade state on next query. **No view-layer cascade mechanism is needed** — the views inherit cascade correctness by virtue of reading from cascade-correct underlying tables.

If a KPI is implemented as a *materialized view* (rather than a regular view) for cost-governance reasons per §14.4, that materialized view IS subject to the §12 cascade mechanism — same as any §9 fact/dim model — and the §14.6 cost-governance proof artifact records the materialization decision. The default and recommended pattern is regular views (stateless); materialization is opt-in per cost/performance need.

### **9.6.7 Resolves W-07C-DOC07B-KPI-VIEWS at land**

This subsection resolves the Doc 07C-originated additive **W-07C-DOC07B-KPI-VIEWS** in the same operation that lands it — same shape as 06D's RB-06D-V1-19 Stage 1 schema extension (which landed in 06D in the same operation that 07E referenced it). 07C §6.2 criterion \#2 \+ §11 reference 07B §9.6 as the canonical mapping-layer substrate; the additive is bounded-and-resolved, not bounded-and-pending. Doc 07C's CR-07C-02 (R1 cleanup change record) records the dependency citing this §9.6 as the resolution.

---

# **§10 — Cohort & Learning-Trajectory Models**

**launch\_required: false — declared-shape V1.1+ per Decision 2a (narrow first draft).**

## **10.1 Declared-shape cohort models**

Per the narrow-first-draft decision, cohort and learning-trajectory models are declared-shape: named with grain \+ source \+ owning-doc citation, full bodies deferred to Doc 07C dashboard demand. Cohort models build on `dim__exam_date_cohort` (§9.3) and the signup-cohort logic.

| Cohort model | Definition | Source | Owning-doc citation | Status |
| ----- | ----- | ----- | ----- | ----- |
| `cohort__signup_week` | users grouped by signup week | `dim__user` \+ first-event date | 07B | V1.1+ declared-shape |
| `cohort__exam_date` | users grouped by target exam date | `dim__exam_date_cohort` | 07A §10 | V1.1+ declared-shape |
| `cohort__retention_curve` | retention by signup cohort over time | `fact__event` \+ `cohort__signup_week` | 07B (feeds KPI-ENG-07 `cohort_retention_curve` stub) | V1.1+ declared-shape |

## **10.2 Declared-shape learning-trajectory models**

Learning-trajectory models track a pseudonymized user's progression over time. They are the warehouse-side aggregation surface that *cites* Doc 05B mastery as its data source but never restates the 05B formula (§3 threat 7; INV-07-06).

| Trajectory model | Definition | Source | Owning-doc citation | Status |
| ----- | ----- | ----- | ----- | ----- |
| `trajectory__mastery_over_time` | mastery-level progression per user over time | `fact__mastery_event` | Doc 05B §3-§5 (mastery body canonical — referenced, never restated; this model aggregates BI-side observations of mastery events, it does not recompute mastery) | V1.1+ declared-shape |
| `trajectory__practice_velocity` | practice-question throughput over time | practice normalized events | Doc 02B (practice engine) | V1.1+ declared-shape |
| `trajectory__exam_score_progression` | exam scaled-score progression | exam normalized events | Doc 04B (scoring body canonical — referenced, never restated) | V1.1+ declared-shape |

**Critical Decision-5 discipline for trajectory models:** `trajectory__mastery_over_time` is the highest-risk model for primitive-restatement (§3 threat 7). It records the *observed* mastery-level at points in time (the BI-side observation that 07A's mastery-class events carry) — it does NOT recompute the mastery level from raw events using the 05B formula. The 05B formula is canonical to 05B; the warehouse reads the observed mastery-level that flowed through the event stream. The §16 audit \+ INV-07-06 verify this model carries no 05B formula tokens.

## **10.3 Small-cell / minimum-cardinality guardrail (RB-07B-V1-07)**

`dim__user` (§9.3) and the cohort models above carry exam-date-cohort properties (`exam_date`, `exam_date_cohort_id` from Doc 07A §7). These are pseudonymized analytics dimensions — but small cohorts can become **quasi-identifying**: a cohort of "students with exam\_date \= a specific rare date \+ a specific cohort\_id \+ a specific geography" may contain few enough users to single one out, defeating the pseudonymization the warehouse depends on (§3 threat 8; the re-identification vector 07E §3 threat 1 \+ §15 W5 flag).

**The guardrail (07B owns the warehouse-side enforcement; 07E owns the policy):**

Any exported aggregate, archive aggregate (§13), dashboard-facing model (§9/§10, consumed by Doc 07C), or ML-training extract that is **grouped by `exam_date`, `exam_date_cohort_id`, geography, school, or any other high-cardinality cohort dimension** MUST enforce minimum cell-size suppression or bucketing **before external reporting or training-corpus export.** A group whose cell size falls below the minimum is suppressed or bucketed up to a coarser dimension.

**Ownership (Decision 5):** the *policy* — what cardinality is acceptable, the bucketing depth, the jurisdiction-specific thresholds — is owned by **Doc 07E §15 W5** (cardinality-aware bucketing; V1.1+ pending legal counsel review of bucketing depth per the EDPS v SRB "reasonably likely means" test). 07B does NOT set the threshold (that's 07E's policy \+ the W9 legal-counsel review). 07B owns the **warehouse-side enforcement mechanism**: the min-cell-size suppression/bucketing applied at the export/aggregate/training-extract boundary, consuming 07E's policy threshold. The minimum cell-size value is a config-doctrine setting (01A §3) whose canonical value is owned by 07E's W5 policy when it closes; until then, 07B enforces a conservative default and flags the dependency. This guardrail is checked at the §13 archive-aggregate boundary and at any Doc 07C/07D consumption boundary (the consuming doc applies it before external surfacing).

---

# **§11 — PII & Historical Redaction Conformance**

**launch\_required: false (07B bodies the spec at V1; runtime activates when BigQuery export is live, bodying Doc 07E §12.3's placeholder mechanism).** This section is the warehouse-side half of INV-07-02 (joint with Doc 07A's event-time half).

## **11.1 What 07B activates**

Doc 07E §12.3 declares `ci/historical-pii-conformance` as a **placeholder mechanism at 07E V1** — it names the mechanism \+ the proof-artifact shape but declares the runtime body as V1.1+, activating "when PostHog → BigQuery warehouse export is live per W-07-PostHog-BQ." **07B is the activation site.** 07B bodies the mechanism's spec (what it checks, against what contract, with what failure conditions) at V1; the runtime body activates when the warehouse export goes live. 07B does NOT redefine the mechanism (07E owns its declaration); 07B supplies the warehouse-side implementation contract.

## **11.2 What `ci/historical-pii-conformance` proves (RB-07B-V1-05 — full-scope, not sample-based)**

The mechanism is the "we kept everything forever and never leaked PII" audit trail (07E §3 threat 1 framing). It verifies that historical events in BigQuery — **across all schema versions ever emitted**, spanning the full "forever" retention window — do not contain PII fields, validated against Doc 07A's `infra/event-schema-registry.yaml` redaction contract (referenced, never restated).

**Pass/fail is full-scope deterministic, never sample-based (RB-07B-V1-05).** A compliance proof that "we never leaked PII" cannot rest on sampling — a sampled scan that misses the one leaked partition produces a false PASS. The mechanism scans **all registry-declared candidate fields and all JSON paths across all rows since the last clean watermark**; sampling is permitted only as a diagnostic aid (e.g. surfacing example field names in a developer report), never as the basis for the pass/fail decision.

This is distinct from 07A's event-time `ci/pii-redaction-conformance` (which validates the registry *declarations* \+ the runtime emission at capture time): 07B's warehouse-side half validates the *landed historical data* — catching the case where an event was emitted before a redaction rule existed, or a schema version slipped a PII field through, leaving PII permanently in the "forever" store (§3 threat 1).

**Watermark discipline:** the scan advances a clean watermark so it doesn't re-scan the entire "forever" store every run (which would be cost-prohibitive — §14) while still being full-scope over new data. Each run scans all rows since the last clean watermark; on a clean result, the watermark advances. The watermark fields (held in `lyceon_analytics_ops_<env>` per §5.1) are `last_clean_event_date`, `last_clean_export_batch_id`, `last_clean_posthog_event_uuid`, and `partitions_scanned[]`. A run is full-scope over `[last_clean_watermark, now]`; a violation anywhere in that range fails the run and does NOT advance the watermark (so the violation is re-scanned until resolved).

## **11.3 The six-element implemented-definition**

Per Parent §6.13:

| Element | Definition |
| ----- | ----- |
| What it proves | No historical event row in BigQuery (any schema version) contains a PII field or a forbidden-identifier value, validated full-scope against 07A's registry redaction contract |
| Execution location | Scheduled BigQuery query (runs on the warehouse; cadence is a config-doctrine setting per 01A §3); V1.1+ activation when warehouse export is live |
| Input | `raw__events_canonical` (§7) \+ the normalized tables (§8) across all `schema_version`s, scanned full-scope over `[last_clean_watermark, now]` \+ Doc 07A's `infra/event-schema-registry.yaml` redaction contract (the `event_redaction_method` per-property posture per 07A §8) \+ the forbidden-identifier-type set (email-hash, phone-hash, name-hash, cross-system stable-hash per 07A §8 / INV-07-02) |
| Failure condition | (a) any event property present in BigQuery that the 07A registry marks as `drop` (should never have landed); (b) any property marked `bucket` whose value is unbucketed (raw value present); (c) any property marked `opaque_id_only` carrying a non-opaque value; (d) any column matching a forbidden-identifier pattern (raw email/name/phone/DOB, or a stable cross-system hash); (e) any `analytics_user_id` that is not HMAC-shaped (a non-opaque identifier in the user-id column); (f) **the scan is not full-scope over the watermark range** (a sampled-only run is itself a failure — pass/fail MUST be deterministic full-scope) |
| Proof artifact | `historical-pii-conformance` record per Parent §10.5 envelope \+ extras: `last_clean_event_date`, `last_clean_export_batch_id`, `last_clean_posthog_event_uuid`, `partitions_scanned[]`, `candidate_fields_scanned[]` (all registry-declared fields \+ JSON paths checked), `rows_scanned_count`, per-violation `{event_name, schema_version_observed, schema_version_current_registry, property_set_diff, forbidden_identifier_field_name, decision}`. **Subject to Doc 06D §8.7 no-PII rule** — the proof artifact stores only field-name metadata \+ counts; NEVER the actual property values that triggered a violation (a PII-leak proof must not itself contain the leaked PII). `diagnostic_example_event_refs[]` is permitted as a diagnostic-only field (renamed from `events_sampled[]` per RB-07B-V1-10 so it cannot be mistaken for the compliance basis), explicitly NOT the pass/fail basis. |
| launch\_required | false (V1.1+ runtime; spec bodied at V1) |

## **11.4 Relationship to 07A redaction \+ 07E retention**

The conformance chain across the three docs (each owning its half, none restating the others):

* **07A §8** owns the event-time redaction contract (the per-property posture; the `emitEvent` boundary that redacts at capture).  
* **07B §11** (this section) owns the warehouse-side historical validation (does the landed data actually obey the contract, across all schema versions, forever).  
* **07E §12.3** owns the mechanism declaration \+ the joint-with-07A framing (INV-07-02 warehouse-side half).

A failure here produces a privacy-class incident via the Doc 06D §11 `attach_privacy_class_to_incident` standard mechanism (referenced, never restated) — 07B warehouse PII-conformance failures are privacy-incident producers, same as 07A/07E redaction failures.

## **11A — `ci/warehouse-event-dedup-conformance` (RB-07B-V1-02)**

The executable proof that the dedup transform (§6.3) actually produces uniqueness in `raw__events_canonical` — necessary because BigQuery does not enforce uniqueness natively. Per Parent §6.13:

| Element | Definition |
| ----- | ----- |
| What it proves | Exactly one row per `posthog_event_uuid` in `raw__events_canonical` (the dedup transform is correct; replay/backfill produced no duplicates) |
| Execution location | Scheduled BigQuery query (cadence config-doctrine per 01A §3); V1.1+ activation when warehouse export is live |
| Input | `raw__events_canonical` |
| Failure condition | Any `posthog_event_uuid` appearing more than once in `raw__events_canonical` (`SELECT posthog_event_uuid FROM raw__events_canonical GROUP BY posthog_event_uuid HAVING COUNT(*) > 1` returns any row) |
| Proof artifact | `warehouse-event-dedup-conformance` record per Parent §10.5 envelope \+ extras: `canonical_row_count`, `distinct_uuid_count`, `duplicate_uuid_count` (MUST be 0 to pass), `partitions_scanned[]`. Subject to Doc 06D §8.7 (carries counts \+ opaque UUIDs only). |
| launch\_required | false (V1.1+ runtime; spec bodied at V1) |

---

# **§12 — Retention, Cascade & Under-13 Deletion Propagation**

**launch\_required: false (propagation contract launch-required as spec; running cascade against BigQuery is V1.1+ per Doc 07E §7.3 "BigQuery-side V1.1+").** This section bodies the *mechanism* of the BigQuery cascade; Doc 07E owns the *policy*.

## **12.1 The ownership split (07E policy / 07B mechanism)**

Doc 07E §7 \+ §10 own the analytics-side cascade **policy** (referenced, never restated):

* The retention class taxonomy: `personal_data_with_inactivity_expiry` (class 1\) \+ `pseudonymized_indefinite_retention_pending_anonymization_review` (class 2\) — Doc 07E §5.  
* The Layer-4 analytics cascade body extending Doc 05D §10 across PostHog \+ BigQuery — Doc 07E §7.  
* The age-stratified behavior: 13+ pseudonymized-retention (BigQuery rows keyed to `analytics_user_id`, pseudonymized-at-fact via the severed Supabase bridge); under-13 hard-delete-everywhere — Doc 07E §10.  
* The under-13 ML-training-exclusion invariant — Doc 07E §10.6 / §12.5.

**07B owns the BigQuery-side execution mechanism** — how the cascade policy physically executes against the warehouse. 07B references 07E §7.3 (which already specifies the BigQuery-side behavior at the policy level) and bodies the warehouse mechanism that carries it out.

## **12.2 13+ pseudonymized retention (the default)**

Per Doc 07E §7.3 (referenced): when a 13+ user is cascaded, the Supabase user row is hard-deleted (Doc 05D §10 Layer 1), severing the bridge from `analytics_user_id` to real identity. The `analytics_user_id = HMAC-SHA256(supabase_user_id, ANALYTICS_SALT)` (Doc 07A §7) becomes uninvertible because its input (the Supabase user\_id) is gone. **The BigQuery rows therefore become pseudonymized-at-fact** the moment the Supabase bridge is severed — no BigQuery-side mutation is required for the pseudonymization itself (07E §7.3 / §line-376). The BigQuery rows remain under their orphaned `analytics_user_id` in the "forever" pseudonymized class 2\.

07B's mechanism responsibility here is minimal-by-design: the warehouse does nothing on a 13+ cascade except continue holding the now-pseudonymized rows. The `dim__user` row (§9.3) remains keyed to the orphaned `analytics_user_id`; no identity reconstruction is possible (§3 threat 8 holds by construction).

## **12.3 Under-13 hard-delete propagation (the override) — RB-07B-V1-03 partition-bounded**

Per Doc 07E §10 (referenced): under-13 users get hard-delete-everywhere — including BigQuery. 07B bodies the warehouse-side execution, made **partition-bounded** because BigQuery partition pruning requires a filter on the partition column (Google: to prune partitions, the query must filter on the partitioning column; BigQuery's partition-delete optimization applies to whole-partition deletes, NOT user-specific deletes — so a naive `DELETE WHERE analytics_user_id = X` scans every partition of the "forever" store):

1. **Trigger:** the under-13 cascade signal arrives from the Doc 05D §10 cascade orchestration (which 07E §10 extends to the analytics layer). 07B's warehouse cascade mechanism receives the `analytics_user_id` to purge.  
2. **Bound:** look up the user's partition range from `analytics_user_partition_index` (§12.4) — the `min_event_date`, `max_event_date`, and `partitions_touched[]` for that `analytics_user_id` across each table. This bounds the delete to only the partitions the user actually appears in, not the full "forever" store.  
3. **Purge (partition-bounded):** for each warehouse table the user appears in, a DELETE scoped by BOTH the partition predicate AND the user predicate:

DELETE FROM \<table\>  
WHERE event\_date BETWEEN @min\_event\_date AND @max\_event\_date  
  AND analytics\_user\_id \= @analytics\_user\_id;

The `event_date BETWEEN` predicate enables partition pruning (only the user's partitions are scanned); the `analytics_user_id` predicate \+ clustering (§5.3) makes the within-partition delete efficient. This covers `raw__events_canonical` (§7), the normalized tables (§8), and the model/archive tables (§9/§10/§13). (`raw__posthog_events_export` is the faithful vendor tier — under-13 rows there are handled by the §7.3 canonical-build tombstone drop \+ a bounded vendor-tier purge over the same partition range.) 4\. **Tombstone:** the `analytics_user_id` is added to the under-13 deletion blocklist (§12.5) so late-arriving events are dropped at canonical-build (§7.3). 5\. **ML-exclusion:** the under-13 ML-training-exclusion invariant (Doc 07E §10.6 / §12.5 — referenced, never restated) ensures no under-13 row reaches an ML training corpus even transiently. 07B's warehouse mechanism honors this by purging before any training-corpus extraction reads the affected partitions.

## **12.4 The `analytics_user_partition_index` (RB-07B-V1-03)**

To make under-13 deletes partition-bounded, the warehouse maintains an index of which partitions each `analytics_user_id` appears in, per table. The index lives in `lyceon_analytics_ops_<env>` (§5.1):

analytics\_user\_partition\_index  
\- analytics\_user\_id        (STRING)  
\- table\_name               (STRING)  
\- min\_event\_date           (DATE)  
\- max\_event\_date           (DATE)  
\- partitions\_touched\[\]      (ARRAY\<DATE\>)   \-- the specific daily partitions the user appears in  
\- last\_seen\_at             (TIMESTAMP)

**Maintenance (Q2=a — ingestion-maintained):** the index is updated on the canonical-build path (§6.3 / §7.3) — when a row is promoted into `raw__events_canonical`, its `(analytics_user_id, table_name, event_date)` updates the index (extend min/max, append the partition if new, bump `last_seen_at`). This keeps the index always-current with a trivial per-row write cost, matching the "server is source of truth" posture — the index is never stale at cascade time, so the partition bound is always correct. (The alternative — a scheduled rebuild before each cascade batch — was considered and rejected per Q2=a: always-current beats cheaper-but-stale for a deletion-correctness surface.) The index carries no PII (only the opaque `analytics_user_id` \+ table/date metadata); subject to Doc 06D §8.7. The index itself is subject to the §12 cascade (an under-13 user's index rows are purged with their data; the tombstone persists separately in the blocklist).

## **12.4a Deletion-status verification for BigQuery rows**

After an under-13 purge, the warehouse must *prove* the deletion completed (the "every deletion has executable proof" discipline — Doc 06D INV-06-08 family pattern, referenced). 07B's verification, via `ops/warehouse-cascade-conformance` (§15.2):

* A post-purge query confirms zero rows remain keyed to the purged `analytics_user_id` across all warehouse tables (bounded by the same partition range from the index).  
* **The deletion query MUST carry a partition predicate AND a dry-run byte estimate** (RB-07B-V1-03 — `ops/warehouse-cascade-conformance` fails if a BigQuery deletion lacks a partition predicate or a dry-run byte estimate; this keeps the deletion path both compliant and operationally bounded — an unbounded full-store delete is itself a failure).  
* The result is recorded in a deletion-proof artifact (subject to Doc 06D §8.7 no-PII rule — the artifact stores the purged `analytics_user_id` only as a hashed/redacted token per the proof-artifact-redaction-method, plus row-count-before/after \+ partitions-purged \+ dry-run-bytes \+ decision; never raw identity).  
* This proof feeds the Doc 05D §10 cascade audit (07E §7.3 references Doc 05D fixture D21 / the cascade proof artifact) — 07B's BigQuery-deletion proof is the warehouse-side contribution to that cascade proof chain.

## **12.5 Late-arriving rows after cascade (the tombstone / deletion-blocklist)**

§3 threat 6: a buffered PostHog event for a cascaded `analytics_user_id` arrives in a later export batch. The defense is a **deletion-blocklist (tombstone set)**:

* The blocklist holds every `analytics_user_id` that has been cascaded under the under-13 hard-delete path.  
* **At canonical-build (§7.3):** before promoting a row from `raw__posthog_events_export` into `raw__events_canonical`, the transform checks the row's `analytics_user_id` against the blocklist. An under-13-tombstoned identifier's late-arriving row is **dropped (never promoted to canonical)** — so it never reaches normalized/model/archive layers.  
* For 13+ cascaded users, no blocklist drop is needed — the row is already pseudonymized-at-fact (the bridge is gone), so a late-arriving 13+ event simply lands in the pseudonymized class 2 like any other 13+ event. The blocklist is specifically the under-13 hard-delete enforcement surface.  
* The blocklist itself carries no PII — only the opaque (already-uninvertible for 13+; deletion-marked for under-13) `analytics_user_id` tokens. It is subject to Doc 06D §8.7. The blocklist's own retention: it must persist at least as long as PostHog's event-buffer window (so no late-arriving event outlives the tombstone), which is a config-doctrine setting per 01A §3.

## **12.6 Relationship to the Doc 06D §9 retention registry**

Doc 06D §9 `infra/retention-policy-registry.yaml` holds the analytics-layer retention entries (`RPOL-ANALYTICS-01` \+ `RPOL-ANALYTICS-02`) that Doc 07E registers (07E §6) — using the `retention_horizon_months` \+ `calendar_month_semantics` \+ `pseudonymized_personal_data` schema that the RB-06D-V1-19 Stage 1 extension added (referenced, never restated). 07B's warehouse cascade mechanism is the BigQuery-side enforcement of those registered policies. 07B does NOT register new retention policies (that's 07E's ownership via the Doc 06D §9 registry); 07B executes the cascade behavior the registered policies imply for the BigQuery surface. The Doc 06D §9.4 `ops/retention-policy-conformance` mechanism (with the RB-06D-V1-19 calendar-month-arithmetic extension) is the conformance check that the analytics retention purges happen on schedule; 07B's BigQuery cascade is one of the substrates that mechanism observes (the `doc05d_cascade` purge-substrate per 06D §9.4).

---

# **§13 — System-State Archive Integration**

**launch\_required: false (07B bodies Doc 07E §11's `SSA-BIGQUERY-AGGREGATES` V1.1+ stub; activates with warehouse export).**

## **13.1 What 07B bodies**

Doc 07E §11 declares `SSA-BIGQUERY-AGGREGATES` as a V1.1+ system-state-archive stub, with `v1_1_activation_trigger: 'Doc 07B V1.1+ ships warehouse-model spec + W-07-PostHog-BQ BigQuery Tier-1 substrate activates'` (07E §line-828, referenced). **07B is the activation site** — it bodies the integration contract for this archive entry. 07B does NOT redefine the archive registry (07E §11 owns the unified system-state-archive registry); 07B supplies the warehouse-side integration body.

## **13.2 What `SSA-BIGQUERY-AGGREGATES` is**

It is the BigQuery-resident aggregated derived data that constitutes part of the system-state-archive ML-training corpus (Doc 07E §5.2 class 2 — `pseudonymized_indefinite_retention_pending_anonymization_review`). Per Doc 07E §11 (referenced): system-state archives are Lyceon-authored versioned-artifact archives retained indefinitely as ML training corpus, and they "carry no user-identifying data by design" — so they sit in retention class 2 from creation without raising the pseudonymization-vs-anonymization question (07E §5.2 / §11). For BigQuery aggregates specifically: the aggregated derived data (cohort rollups, trajectory aggregates, fact-table summaries) is keyed on `analytics_user_id` where it references users, and is otherwise Lyceon-authored aggregate state.

## **13.3 Timestamp semantics**

The archive's timestamp semantics: every archived aggregate carries the `event_date` partition \+ an `_archived_at` timestamp (when the aggregate was materialized into the archive dataset `lyceon_analytics_archive_<env>` per §5.1). Aggregates are versioned by materialization date — the archive holds the historical sequence of aggregate states, not just the latest, so the "forever" reconstruction (07E §5.2 — "historical system-state reconstruction") can replay what the aggregates looked like at any past point.

## **13.4 Join rules with event stream \+ versioned system artifacts**

The archive joins to:

* **The event stream** (§8 normalized tables) via `analytics_user_id` \+ `event_date` — so an archived aggregate can be traced back to the events that produced it (within the retention window).  
* **Versioned system artifacts** (the other system-state archives in Doc 07E §11 — `SSA-MASTERY-CONSTANTS`, `SSA-SCORING-CONSTANTS`, `SSA-POSTHOG-EVENT-STREAM`) via the archive registry's cross-references. This lets a reconstruction join "what the aggregates showed" with "what formula constants / scoring constants / event schema were in effect at that time" — the full system-state snapshot 07E §11 is designed to preserve.

The join rules carry the same no-PII invariant (§5.4): joins are on `analytics_user_id` \+ temporal keys only; no identity-bearing join path exists.

## **13.5 Cascade behavior for the archive**

The archive obeys the same §12 cascade: under-13 aggregates are purged on cascade (the under-13 `analytics_user_id`'s contribution to any aggregate is removed — for aggregates that are per-user, the row is deleted; for aggregates that pool multiple users, the under-13 user's events are excluded from the aggregate on the next materialization, and the ML-training-exclusion invariant per 07E §10.6 ensures no under-13 data persists in a training-corpus extraction). 13+ aggregates remain in the pseudonymized class 2\. The §11 `ci/historical-pii-conformance` validates the archive carries no PII, same as the event tables.

---

# **§14 — Cost, Partitioning & Query Governance**

**launch\_required: false (the governance discipline is spec at V1; enforcement activates with the warehouse). The $-cost model body lives in Doc 06E §7 (BigQuery subsection via W-07-PostHog-BQ); 07B owns the warehouse-design discipline that produces bounded scans.**

## **14.1 The ownership split (06E cost body / 07B warehouse-design discipline)**

Per the pre-draft grounding \+ Decision 5: the BigQuery **$-cost model** (pricing tiers, cost-per-query, scale projections at 1K/10K/100K MAU, the substrate-cap configuration) is owned by **Doc 06E §7** as a vendor cost subsection — landing via the W-07-PostHog-BQ additive (RB-06E-V1-15/16), which adds BigQuery as a Tier-1 target-state vendor with the full 06E §5/§6/§7/§10/§13 registration (referenced, never restated). **07B owns the warehouse-design discipline** — the partitioning/clustering/scan-cap/materialization rules that *produce* bounded scans so the 06E cost model holds. The two are complementary: 06E says "here's what BigQuery costs and here's the substrate-cap ceiling"; 07B says "here's how the warehouse is designed so queries stay within that."

## **14.2 Partition-required discipline (the foundation)**

Per §5.3 (the architectural foundation): **every event table and every large model table MUST be partitioned** (by `event_date`, daily grain) **and clustered** (by `event_name` then `analytics_user_id`). This is a hard invariant, not a recommendation — it is the single most important cost control, because the "keep everything forever" retention model (07E §5.2) makes unpartitioned full-table scans the highest-magnitude cost threat (§3 threat 3). A query that filters on `event_date` \+ `event_name` scans only the relevant partitions \+ clusters, not the full "forever" store.

## **14.3 Scan-cap discipline (maximum-bytes-billed)**

Every scheduled query \+ every materialization job MUST declare a `maximum_bytes_billed` ceiling (BigQuery's native scan-cap guardrail). A query that would scan more than its ceiling fails rather than running up an unbounded bill. This is the warehouse-design complement to Doc 06E §10's substrate-cap discipline (06E §10 owns the vendor-level spend ceiling — Layer 1 of the three-layer cost-protection model; 07B's per-query scan-cap is the warehouse-design-level enforcement that keeps individual queries from being the thing that breaches the 06E ceiling). The default ceilings are config-doctrine settings per 01A §3, not hardcoded here.

## **14.4 Materialized-vs-view rules**

* **Views** (logical, no storage, recomputed per query) are used for low-frequency, small-scan transformations where recomputation is cheap.  
* **Materialized tables / materialized views** (stored, incrementally refreshed) are used for high-frequency, large-scan aggregates (the §9 fact tables, the §13 archive aggregates) where recomputing per query would repeatedly scan large data. Materialization trades storage cost (cheap in BigQuery) for scan cost (expensive) — the right trade for "forever" data queried often.  
* The rule: **if an aggregate is queried more than once per partition-period and scans more than the scan-cap-warning threshold, it MUST be materialized, not a view.** This prevents the common cost-runaway of a dashboard repeatedly running a full-scan view.

## **14.5 Scheduled-query cadence governance**

Scheduled queries (the materialization refreshes, the §11 conformance check, the §13 archive materialization) declare their cadence as config-doctrine settings (01A §3). The governance rule: **cadence must be no more frequent than the data's update grain** — e.g. a daily-partitioned fact table's materialization refreshes daily, not hourly (refreshing more often than data arrives scans the same partition repeatedly for no new data). The §16 audit \+ a cadence-config check verify no scheduled query refreshes more frequently than its source data updates.

## **14.6 Cost-governance proof (RB-07B-V1-08 — dry-run estimates required)**

The warehouse-design discipline produces the `warehouse-cost-governance` proof artifact (V1.1+, when the warehouse is live). Per RB-07B-V1-08, the proof is not just "tables are partitioned" — it requires a **BigQuery dry-run byte estimate** per scheduled query/materialization, so the cost ceiling is verified *before* the query runs (Google: `maximum_bytes_billed` caps query cost — if estimated bytes exceed the configured limit, the query fails without incurring a charge; the dry-run gives the estimate to check against the cap).

**For every scheduled query / materialization, the proof records:**

* the BigQuery dry-run `bytes_processed` estimate,  
* the configured `maximum_bytes_billed` ceiling,  
* the partitions scanned,  
* the decision: pass/fail.

**Failure conditions:** the proof fails if (a) any scheduled query/materialization is missing a `maximum_bytes_billed` ceiling; (b) the dry-run `bytes_processed` estimate exceeds the approved cap; (c) any large table is not partitioned \+ clustered (§14.2); (d) any scheduled query exceeds its cadence rule (§14.5).

The six-element shape:

| Element | Definition |
| ----- | ----- |
| What it proves | Every scheduled query/materialization is partition-bounded \+ scan-capped \+ within its dry-run estimate; every large table is partitioned \+ clustered |
| Execution location | Scheduled check on the warehouse (cadence config-doctrine per 01A §3); V1.1+ when warehouse is live |
| Input | The scheduled-query/materialization config registry \+ BigQuery dry-run API (`--dry_run` byte estimates) \+ the table partition/cluster metadata |
| Failure condition | (a)-(d) above (missing cap; dry-run estimate \> cap; unpartitioned large table; cadence violation) |
| Proof artifact | `warehouse-cost-governance` record per Parent §10.5 envelope \+ extras: per-query `{query_id, dry_run_bytes_processed, maximum_bytes_billed, partitions_scanned, cadence_check, decision}`, `tables_checked[]` (partition+cluster check). Subject to Doc 06D §8.7 (table-name \+ config \+ byte-count metadata only). |
| launch\_required | false (V1.1+ runtime; spec bodied at V1) |

This feeds Doc 06E's cost-monitoring (06E owns the $-spend monitoring \+ the substrate-cap ceiling per §10; 07B's proof confirms the warehouse-design preconditions — partition-bounded, scan-capped, dry-run-verified — that keep spend within the 06E ceiling). 06E owns "what it costs and the spend ceiling"; 07B owns "the warehouse is designed \+ proven so queries stay within that."

---

# **§15 — V1 / V1.1+ Mechanisms**

Per Doc 07 Parent §4 \+ 06E §4, every 07B mechanism declares `launch_required: bool` with a V1.1+ trigger criterion for `launch_required: false` mechanisms.

## **15.1 Launch-required (V1) mechanisms**

| Mechanism | Invariant | What it proves | launch\_required |
| ----- | ----- | ----- | ----- |
| `ci/kpi-canonical-owner-cite` | INV-07-05 | Every KPI cites a resolving canonical owner (§9.5.5) | **true** |
| `ci/kpi-body-no-restate` | INV-07-06 | No KPI body restates another doc's primitive (§9.5.5) \+ audit P27 | **true** |

These two are the launch-required core: the `infra/kpi-registry.yaml` 35-KPI roster is launch-required (Parent §5.1), and these mechanisms enforce its integrity (owner-citation \+ no-restate).

## **15.2 Target-state V1.1+ mechanisms**

| Mechanism | What it proves | V1.1+ activation trigger | launch\_required |
| ----- | ----- | ----- | ----- |
| `ci/historical-pii-conformance` (warehouse-side INV-07-02 half) | No historical event in BigQuery contains PII across all schema versions — full-scope deterministic scan with watermarks, not sampling (§11.2/§11.3) | W-07-PostHog-BQ BigQuery Tier-1 substrate activation (warehouse export live) | false |
| `ci/warehouse-event-dedup-conformance` | Exactly one row per `posthog_event_uuid` in `raw__events_canonical` (§11A) — the executable proof the dedup transform produces uniqueness BigQuery won't enforce | Warehouse export live | false |
| `ops/warehouse-cascade-conformance` | Under-13 cascade purges propagate to BigQuery, partition-bounded, deletion-status verified; **fails if a deletion lacks a partition predicate or a dry-run byte estimate** (§12.3/§12.4a) | Warehouse export live \+ first cascade against BigQuery | false |
| `ci/warehouse-schema-version-parity` | Every observed warehouse `schema_version` is a known 07A registry version (§6.4) | Warehouse export live | false |
| `warehouse-cost-governance` proof | Every large table partitioned \+ clustered; **every scheduled query records a dry-run `bytes_processed` estimate \+ configured `maximum_bytes_billed` \+ partitions scanned; fails if cap missing or estimate exceeds cap** (§14.6) | Warehouse export live | false |

Each V1.1+ mechanism's spec (the six-element implemented-definition shape) is bodied at 07B V1; the runtime body activates per the stated trigger. This is the "spec-locked, infrastructure-target-state" framing (Parent §4): the contracts are locked now; the running infrastructure follows.

## **15.3 Bundled cross-doc additives**

| Additive | Target doc | What it does | Status |
| ----- | ----- | ----- | ----- |
| W-07B-DOC03C-EXPORT-SUBSTRATE | Doc 03C V3.0 | If the BigQuery export pipeline is Cloud-Run-orchestrated, Doc 03C applies a V1.1+ amendment registering the export-orchestration service in its GCP substrate inventory (§6.5). No-op if PostHog's managed first-party export is used. | Bounded; resolves at V1.1+ warehouse activation when orchestration approach is chosen |
| W-07-PostHog-BQ (inherited from Parent/07E) | Doc 06E | Adds BigQuery as Tier-1 target-state vendor (06E §5/§6/§7/§10/§13) — the $-cost body 07B §14 references. Applied as RB-06E-V1-15/16 post-Doc-07-family work. | Inherited; 07B §14 references the resulting BigQuery cost subsection |

07B does NOT own a Doc 06D registry additive: the analytics retention entries (`RPOL-ANALYTICS-01/02`) \+ the RB-06D-V1-19 schema extension are owned by Doc 07E (the Stage 1 schema is already applied per Doc 06D CR-06D-06; the Stage 2 entry population is 07E's post-lock additive). 07B consumes that substrate; it adds nothing to it.

---

# **§16 — Audit Profile**

## **16.1 Inherited audit suite**

07B inherits the Doc 07 family audit suite: the 30-pass baseline (25 carry-forward from 06E \+ P26-P30 from Doc 07 Parent) plus P31 (vocabulary-consistency, introduced by Doc 07E per RB-07E-R3-04). 07B applies P31's discipline because it carries the same "pseudonymized vs anonymized" legal-vocabulary risk as 07E (the warehouse is where the pseudonymized data physically lives — §3 threat 5).

## **16.2 07B implementation-site passes**

07B is the implementation site for two Parent-extension passes:

* **P27 — KPI canonical-owner-citation parity.** Every entry in `infra/kpi-registry.yaml` has a resolving `canonical_owner_doc_and_section`; no KPI body restates a primitive owned by another doc (cross-checked against Doc 05B mastery-formula tokens \+ Doc 03 §24 cost-tier tokens \+ Doc 06E §7 vendor-cost-rate tokens). 07B is the implementation site (Parent §9 P27 names 07B). Implemented as `ci/kpi-canonical-owner-cite` (INV-07-05) \+ `ci/kpi-body-no-restate` (INV-07-06).  
* **P31 — vocabulary-consistency (inherited from 07E).** 07B applies P31's three hard-fail rules adapted to the warehouse context: (1) no warehouse data described as "anonymized" at V1 (it's pseudonymized per 07E §5.2 — outside the explicit carve-outs); (2) no premature claim that the warehouse "resolves" Doc 05D §10.4 (07E owns the proposed posture; W7+W9 resolve); (3) no claim that BigQuery is launch-required (it's Tier-1 *target-state* per W-07-PostHog-BQ).

## **16.3 07B-specific audit additions**

Beyond the inherited suite, 07B's audit verifies:

* **DD-07-REDEF defect scan (Decision 5):** no 07B line restates a primitive owned by another doc — specifically no restatement of the 07A event schema (07B references the registry, never restates event definitions), the 07E retention/cascade policy (07B references, never restates the taxonomy or the cascade policy), the 06D registry substrate, the 06E vendor cost body, the 05B mastery formula, or the 03C GCP substrate. Any such line is a defect.  
* **Ownership-boundary integrity:** every "07B owns" claim in §2.2 maps to a section that bodies it; every "referenced owner" claim resolves to an exact § in the cited doc.  
* **launch\_required annotation coverage (INV-07-07):** every 07B mechanism declares `launch_required: bool`; every `false` resolves to a V1.1+ trigger.  
* **No-V1-alerts (INV-07-09):** no 07B V1 mechanism declares an `alert_id` (07B V1 owns no alerts — the warehouse is target-state, so warehouse alerts are V1.1+ when the infrastructure activates per 06C §7 standard registration).

## **16.4 Known false-positive class**

Carry-over \+ 07B-specific: doc titles containing flagged words; the §18 cross-doc seam table (cites bodies — required, not restatement); the §9.2/§9.3/§10 model-contract tables (name owning-doc citations — required, not restatement); the §9.5.3 bodied-KPI summaries (these ARE 07B's owned bodies, not restatements of other docs — P27 enforces owner-cite, and these cite 07B itself); the §9.5.5 `ci/kpi-body-no-restate` failure-condition definition (legitimately NAMES the forbidden 05B/03/06E primitive tokens as detect-and-reject examples — same carve-out class as 07E's P31 rule definitions, not a restatement); BigQuery/PostHog/Cloud-Run vendor-name vocabulary (vendor identifiers, not primitive-body restatements); the `pseudonymized_indefinite_retention_pending_anonymization_review` class identifier (07E-owned identifier token, referenced); SQL/DDL keywords \+ the partition-bounded DELETE example in §12.3 (warehouse-mechanism spec, not a restatement); SQL/DDL keywords in the §5/§7/§8 schema specs.

---

# **§17 — Acceptance Criteria (Executable-Proof Framed)**

07B V1.0 is acceptable for lock when:

1. **The `infra/kpi-registry.yaml` 35-KPI roster is specified** (§9.5) — 34 Parent-canonical \+ KPI-ENG-11; 6 bodied \+ 29 name-only stubs; every entry carries a resolving `canonical_owner_doc_and_section`. **launch\_required: true.**  
2. **`ci/kpi-canonical-owner-cite` (INV-07-05) is specified** with the six-element implemented-definition (§9.5.5). **launch\_required: true.**  
3. **`ci/kpi-body-no-restate` (INV-07-06) \+ audit P27 is specified** with the six-element implemented-definition (§9.5.5). **launch\_required: true.**  
4. **The BigQuery dataset/table architecture is specified** (§5) — environment-scoped datasets, table naming matching 07A registry, partition-required \+ clustering discipline, no-PII architectural invariant.  
5. **The PostHog → BigQuery export/ingestion contract is specified** (§6) — PostHog managed export to the single vendor table `raw__posthog_events_export`, the three-tier vendor→canonical→normalized architecture (RB-07B-V1-01), the executable dedup model via `raw__events_canonical` MERGE \+ `ci/warehouse-event-dedup-conformance` (RB-07B-V1-02), schema-version handling, the W-07B-DOC03C-EXPORT-SUBSTRATE ownership boundary.  
6. **The raw landing (§7) \+ normalized event model (§8) are specified** — two-tier landing (vendor export \+ canonical deduped), the cascade tombstone pre-check at canonical-build (RB-07B-V1-02/03), schema-version reconciliation, historical-event compatibility.  
7. **The fact/dimension (§9) \+ cohort/trajectory (§10) models are declared-shape** — named with grain \+ source \+ owning-doc citation; full bodies deferred V1.1+ per Decision 2a; the `trajectory__mastery_over_time` Decision-5 discipline (BI-side observation, not 05B-formula recomputation) is explicit; the §10.3 small-cell/minimum-cardinality guardrail citing 07E §15 W5 (RB-07B-V1-07).  
8. **`ci/historical-pii-conformance` is bodied** (§11) — 07B activates 07E §12.3's placeholder; full-scope deterministic scan with watermarks (NOT sampling for pass/fail — RB-07B-V1-05); validates historical BigQuery events across all schema versions against 07A's redaction contract; subject to 06D §8.7. **launch\_required: false (V1.1+ runtime; spec at V1).**  
9. **The warehouse-side cascade/deletion-propagation is bodied** (§12) — 13+ pseudonymized-at-fact (no warehouse mutation needed), under-13 partition-bounded hard-delete via the `analytics_user_partition_index` (RB-07B-V1-03) \+ deletion-status verification (partition-predicate \+ dry-run required) \+ the tombstone/deletion-blocklist for late-arriving rows; references 07E §7/§10 as policy owner. **launch\_required: false.**  
10. **The `SSA-BIGQUERY-AGGREGATES` warehouse integration is bodied** (§13) — 07B activates 07E §11's stub; timestamp semantics \+ join rules \+ cascade behavior. **launch\_required: false.**  
11. **The cost/partitioning/query-governance discipline is specified** (§14) — partition-required, scan-cap (`maximum_bytes_billed`), materialized-vs-view rules, scheduled-query cadence governance, the `warehouse-cost-governance` dry-run-estimate proof (RB-07B-V1-08); references 06E §7 cost body \+ §10 substrate-cap, never restates. **launch\_required: false.**  
12. **Every mechanism declares `launch_required: bool`** (INV-07-07) with V1.1+ triggers for `false` mechanisms (§15); **no V1 mechanism declares an alert** (INV-07-09).  
13. **Decision 5 holds end-to-end** — DD-07-REDEF scan clean: no restatement of 07A event schema / 07E retention-cascade policy / 06D registry / 06E cost body / 05B mastery formula / 03C GCP substrate (§16.3).  
14. **The audit suite passes** — inherited 30-pass \+ P31; 07B implementation-site P27 \+ P31 explicit; 07B-specific DD-07-REDEF \+ ownership-boundary \+ annotation-coverage \+ no-V1-alerts checks clean (§16).  
15. **The cross-doc seam table (§18) is grounded by exact §** — every seam resolves or is explicitly carried as a bounded forward-ref.  
16. **The no-free-text invariant is correctly scoped (RB-07B-V1-04)** — raw `properties` JSON permitted ONLY in the raw landing layer (governed by 07A redaction \+ §11 conformance); identity-bearing free-text \+ unconstrained JSON banned everywhere else (§5.4).  
17. **BigQuery vendor-behavior accuracy** — no claim assumes BigQuery enforces uniqueness (dedup is a transform per §6.3) or that partition pruning works without a partition predicate (deletes are partition-bounded per §12.3); the export shape separates the vendor managed-export target from Lyceon-derived projections (§6.1); `raw__posthog_events_export` is append-only under normal ingestion with compliance-cascade deletes as the one permitted mutation path (§7.1, RB-07B-V1-09).  
18. **KPI event-name registry parity (RB-07B-V1-11)** — every bodied KPI's `source_event_names` resolves to a canonical event name in Doc 07A's `infra/event-schema-registry.yaml`; `ci/kpi-canonical-owner-cite` emits `kpi_event_name_registry_parity: PASS` \+ `checked_against: infra/event-schema-registry.yaml` (§9.5.5). The diagnostic-only PII-conformance field is named `diagnostic_example_event_refs[]` (not `events_sampled[]`) so it cannot be mistaken for the compliance basis (§11.3, RB-07B-V1-10).

---

# **§18 — Cross-Doc Seam Table (Grounded by Exact §)**

| Seam | 07B side | Canonical owner | Status |
| ----- | ----- | ----- | ----- |
| Event definitions \+ payload schema | §8 normalized tables project the registry shape | Doc 07A V1.0 §5/§6 `infra/event-schema-registry.yaml` | RESOLVED — consumer (referenced, never restated) |
| `analytics_user_id` HMAC derivation | §8/§12 key on it; §12.2 relies on its uninvertibility | Doc 07A V1.0 §7 | RESOLVED — consumer |
| Event-time PII redaction contract | §11 validates landed data against it | Doc 07A V1.0 §8 (split-enum) | RESOLVED — consumer |
| Schema-version semantics | §6.4 \+ §8.2 reconcile across versions | Doc 07A V1.0 §5.6 | RESOLVED — consumer |
| `ci/historical-pii-conformance` (warehouse half) | §11 bodies it | Doc 07E V1.0 §12.3 (declares placeholder; 07B activates) | RESOLVED — 07B is activation site |
| Retention class taxonomy | §12 cascade obeys it | Doc 07E V1.0 §5 | RESOLVED — consumer |
| Layer-4 analytics cascade policy | §12 bodies the BigQuery mechanism | Doc 07E V1.0 §7/§10 (policy); Doc 05D §10 (cascade base) | RESOLVED — 07E owns policy, 07B owns BigQuery mechanism |
| BigQuery cascade behavior | §12.2/§12.3 execute it | Doc 07E V1.0 §7.3 (BigQuery-side V1.1+) | RESOLVED — consumer \+ mechanism |
| Under-13 ML-training-exclusion invariant | §12.3 honors it | Doc 07E V1.0 §10.6/§12.5 | RESOLVED — consumer |
| `SSA-BIGQUERY-AGGREGATES` archive entry | §13 bodies it | Doc 07E V1.0 §11 (stub; 07B activates) | RESOLVED — 07B is activation site |
| Doc 06D §9 retention registry substrate | §12.6 enforces registered policies | Doc 06D V1.0 §9 (+ RB-06D-V1-19 schema; 07E registers entries) | RESOLVED — consumer |
| Doc 06D §9.4 retention conformance | §12.6 — BigQuery cascade is an observed substrate | Doc 06D V1.0 §9.4 (`doc05d_cascade` substrate) | RESOLVED — consumer |
| Privacy-incident sub-class | §11.4 — warehouse PII failures produce privacy incidents | Doc 06D V1.0 §11 `attach_privacy_class_to_incident` | RESOLVED — consumer |
| No-PII proof-artifact rule | §11/§12/§14 proof artifacts obey it | Doc 06D V1.0 §8.7 | RESOLVED — consumer |
| BigQuery vendor cost body | §14 references the cost model | Doc 06E V1.0 §7 (BigQuery subsection via W-07-PostHog-BQ) | OPEN — bounded (W-07-PostHog-BQ); deploy-gated, non-blocking for spec lock |
| BigQuery substrate-cap | §14.3 scan-cap complements it | Doc 06E V1.0 §10 (substrate-cap discipline) | RESOLVED — consumer (06E pattern locked; BigQuery subsection via W-07-PostHog-BQ) |
| GCP export-orchestration substrate | §6.5 — contract only; substrate is 03C's | Doc 03C V3.0 (V1.1+ amendment via W-07B-DOC03C-EXPORT-SUBSTRATE) | OPEN — bounded; resolves at V1.1+ warehouse activation |
| Mastery KPI body math | §9.5/§10.2 KPI entries cite it | Doc 05B V1.0 §3-§5 | RESOLVED — referenced, never restated |
| Exam scoring / completion semantics | §9.5 KPI-LRN-02 \+ §10.2 trajectory cite it | Doc 04 family V1.0 | RESOLVED — referenced |
| LISA cost/cap KPI bodies | §9.5 KPI-TUT-\*/KPI-OPS-03 cite it | Doc 03 Main V1.1 §11/§24 | RESOLVED — referenced (cited\_per\_project\_handoff\_record until Doc 03 Main parsed) |
| Financial unit economics KPI bodies | §9.5 KPI-BIZ-03/04 \+ KPI-OPS-01/02 cite it | Doc 09 (FWD-07-01) | OPEN — bounded forward-ref |
| Config doctrine (cadence, scan-cap defaults, salts) | §6/§14 settings are config-doctrine | Doc 01A V1.0 §3 | RESOLVED — consumer |
| Dashboards consume 07B models \+ KPI registry | declared as data source | Doc 07C (FWD-07B-01) | OPEN — bounded; resolves when 07C drafts |
| Experimentation consumes 07B event facts | declared as data source | Doc 07D (FWD-07B-02) | OPEN — bounded; resolves when 07D drafts |

---

# **§19 — Watch Items**

| ID | Item | Status |
| ----- | ----- | ----- |
| **W1** | Doc 03 Main V1.1 §11/§24 LISA cost/cap KPI citations (KPI-TUT-\*/KPI-OPS-03) recorded as `cited_per_project_handoff_record` until Doc 03 Main is parsed into the audit. | Bounded; non-blocking (inherited from 07A W1 pattern) |
| **W2** | Doc 05B §3-§5 mastery KPI citations (KPI-LRN-01/05) recorded as referenced until 05B parsed. | Bounded; non-blocking |
| **W3 / W-07-PostHog-BQ** | BigQuery Tier-1 target-state vendor registration in Doc 06E (§5/§6/§7/§10/§13) via RB-06E-V1-15/16. 07B §14 references the resulting BigQuery cost subsection. Deploy gate (07B BigQuery-targeted deploy-proof blocked until landed per Parent RB-07-Parent-V1-06), NOT a spec-lock gate. | Bounded; deploy-gated; non-blocking for spec lock |
| **W4 / W-07B-DOC03C-EXPORT-SUBSTRATE** | If the BigQuery export pipeline is Cloud-Run-orchestrated, Doc 03C applies a V1.1+ amendment registering the export-orchestration service in its GCP substrate inventory (§6.5). No-op if PostHog managed export is used. | Bounded; resolves at V1.1+ warehouse activation when orchestration approach chosen |
| **W5** | Doc 09 financial unit economics bodies (KPI-BIZ-03/04, KPI-OPS-01/02 via FWD-07-01). | Bounded forward-ref; resolves when Doc 09 drafts |
| **W6** | Doc 07C dashboards (FWD-07B-01) \+ Doc 07D experimentation (FWD-07B-02) consume 07B models — full fact/dimension/cohort/trajectory bodies (§9/§10) activate on 07C/07D demand. | Bounded; resolves when 07C/07D draft |
| **W7** | The 07E W7+W9 launch gates (privacy policy publication \+ legal counsel sign-off) gate production enablement of the pseudonymized-retention path — including the BigQuery-resident pseudonymized data. 07B inherits this dependency: the warehouse cannot hold pseudonymized 13+ data in production until 07E's W7+W9 close (the under-13 hard-delete path is independent and always safe). | Inherited from 07E; non-blocking for 07B spec lock |

---

# **§20 — Change Records**

**CR-07B-01** — Doc 07B V1.0 established. Scope per Doc 07 Parent §5.1 family decomposition \+ the SWE warehouse-scope handoff: BigQuery warehouse, analytics models & historical event store. Third launch-required-content sub-doc (Parent → 07A → 07E → 07B → 07C → 07D drafting order). Pre-draft Q\&A locked (Karl decisions): **Q1=a** — KPI roster locked at 35 (34 Parent-canonical \+ KPI-ENG-11 from RB-07-Parent-V1-07; reconciliation recorded in §9.5.1; the \+1 is the post-additive canonical count per Doc 07A §245); **Q2=a** — narrow warehouse-contract first draft (body §5-§8 \+ §11-§14 fully; §9-§10 fact/dimension/cohort/trajectory models declared-shape target-state V1.1+, names \+ grain \+ source \+ owning-doc citation, full bodies deferred to 07C demand — per SWE "not an analytics wish-list doc" stance); **Q3=a** — export pipeline specified as a contract \+ W-07B-DOC03C-EXPORT-SUBSTRATE additive owed to Doc 03C for any Cloud-Run orchestration substrate (07E §line-115 boundary: GCP substrate is 03C's, not 07B's); **Q4=a** — KPI registry (§9.5) launch-required, warehouse bodies target-state V1.1+ (Parent §5.1 split); **Q5=confirmed** — no cleanup register (this doc carries §20 Change Records only, no §21 register; departure from 07A/07E which carried both, not retroactively stripped); strict Decision-5 reference discipline (DD-07-REDEF scan in §16.3). Two 07B-owned launch-required proving mechanisms: `ci/kpi-canonical-owner-cite` (INV-07-05) \+ `ci/kpi-body-no-restate` (INV-07-06) \+ audit P27. Four V1.1+ mechanisms (§15.2). Two bundled additives (§15.3): W-07B-DOC03C-EXPORT-SUBSTRATE (new, owed to 03C) \+ W-07-PostHog-BQ (inherited). Grounding verified against locked 07A (event registry, `analytics_user_id` HMAC, redaction contract, the 35-KPI count \+ KPI-ENG-11), 07E (`ci/historical-pii-conformance` activation, `SSA-BIGQUERY-AGGREGATES` activation, BigQuery cascade behavior, P31 discipline), Doc 06D (§9 registry \+ RB-06D-V1-19 schema, §8.7, §11), Doc 06E (cost-model pattern, substrate-cap, BigQuery-via-W-07-PostHog-BQ), Doc 03C (GCP substrate ownership). Inherits the 30-pass family audit \+ P31; 07B is implementation site for P27 \+ P31. Status DRAFT pending external SWE review.

**CR-07B-02** — External SWE/spec audit applied in-lock-cycle (no version bump; status stays DRAFT pending next review). SWE verdict: scope/direction APPROVED, spec-lock NOT YET (B+/A- directionally), "targeted cleanup pass, not rewrite." 4 BLOCKERs \+ 4 HIGHs resolved as RB-07B-V1-01..08; pre-cleanup alignment locked with Karl (Q1a/Q2a/Q3a/Q4-confirmed):

* **RB-07B-V1-01 (BLOCKER):** Separated PostHog managed export from Lyceon-derived projections. §5.1 \+ §6.1 now specify the three-tier architecture: PostHog managed export → `raw__posthog_events_export` (single vendor-shaped table) → `raw__events_canonical` → `normalized__<class>__<event>`. Per-event raw tables are Lyceon-derived projections, not assumed PostHog export targets. Managed export is the canonical V1.1+ path (Q1=a); custom export would trigger W-07B-DOC03C-EXPORT-SUBSTRATE.  
* **RB-07B-V1-02 (BLOCKER):** Executable dedup architecture. §6.3 rewritten — vendor table append-only (dups possible), `raw__events_canonical` deduped via MERGE (one row per `posthog_event_uuid`), normalized reads only from canonical. Added `ci/warehouse-event-dedup-conformance` (§11A) — fails if any UUID appears \>1× in canonical. Closes the BigQuery-doesn't-enforce-uniqueness gap.  
* **RB-07B-V1-03 (BLOCKER):** Partition-bounded under-13 deletion. §12.3 rewritten — deletes carry both an `event_date BETWEEN` partition predicate (for pruning) and the `analytics_user_id` predicate; §12.4 adds the ingestion-maintained (Q2=a) `analytics_user_partition_index` (min/max event\_date \+ partitions\_touched per user per table); §12.4a requires partition-predicate \+ dry-run-estimate or `ops/warehouse-cascade-conformance` fails.  
* **RB-07B-V1-04 (BLOCKER):** Fixed the no-free-text invariant. §5.4 rewritten — raw `properties` JSON permitted ONLY in the raw landing layer (governed by 07A redaction \+ §11 conformance); identity-bearing free-text banned everywhere; unconstrained JSON/free-text banned in normalized/model/archive/KPI/proof layers.  
* **RB-07B-V1-05 (HIGH):** Historical PII conformance full-scope. §11.2/§11.3 rewritten — pass/fail is full-scope deterministic scan over `[last_clean_watermark, now]` with watermark fields (`last_clean_event_date`, `last_clean_export_batch_id`, `last_clean_posthog_event_uuid`, `partitions_scanned[]`); sampling is diagnostic-only, never pass/fail.  
* **RB-07B-V1-06 (HIGH):** Exact KPI filters. §9.5.2 entry shape extended — bodied KPIs require exact `source_event_names` (numerator/denominator), `window_semantics` (UTC \+ inclusion\_rule), `dedup_key: posthog_event_uuid`, `grain`; §9.5.3 table updated with exact event-name filters; `ci/kpi-canonical-owner-cite` fails on under-specified bodied entries.  
* **RB-07B-V1-07 (HIGH):** Small-cell guardrail. §10.3 added — min cell-size suppression/bucketing for exam-date/cohort/geography/school aggregates before external reporting or ML-training export; 07B owns warehouse-side enforcement, cites 07E §15 W5 as the policy owner (Q3=a; no 07E additive).  
* **RB-07B-V1-08 (HIGH):** Dry-run cost proof. §14.6 rewritten — `warehouse-cost-governance` records per-query dry-run `bytes_processed` \+ configured `maximum_bytes_billed` \+ partitions scanned \+ decision; fails if cap missing or estimate exceeds cap.

All new warehouse mechanics stay V1.1+ declared-shape (Q4 confirmed — no launch-required creep; only the KPI registry \+ INV-07-05/06 are launch-required). SWE-verified vendor behavior (PostHog managed-export shape \+ UUID dedup; BigQuery no-enforced-uniqueness \+ partition-pruning-needs-predicate \+ `maximum_bytes_billed`) is now accurately reflected. Status DRAFT pending next SWE review (expected LOCK-CONDITIONAL or PASS per the SWE final call).

**CR-07B-03** — R2 SWE review cleared LOCK-CONDITIONAL; status → LOCKED. R2 verdict: LOCK-CONDITIONAL, grade A-, scope/direction APPROVED, spec materially improved, "no further rewrite required." All 8 R1 findings confirmed Fixed. R2 gave 3 non-blocking cleanups \+ a pre-lock checklist; all applied as RB-07B-V1-09..11:

* **RB-07B-V1-09 (non-blocking — vendor table append-only tension):** §6.3 \+ §7.1 \+ §7.3 clarified that `raw__posthog_events_export` is append-only **under normal ingestion/replay**, NOT absolute immutability — compliance cascades (under-13 partition-bounded hard-delete per §12.3) are the one permitted mutation path. Prevents an implementer treating the vendor table as never-mutable (which would conflict with under-13 hard-delete-everywhere).  
* **RB-07B-V1-10 (non-blocking — diagnostic field naming):** renamed the PII-conformance diagnostic field `events_sampled[]` → `diagnostic_example_event_refs[]` (§11.3) so it cannot be mistaken for the compliance pass/fail basis (which is full-scope deterministic per RB-07B-V1-05).  
* **RB-07B-V1-11 (non-blocking — KPI event-name registry parity):** `ci/kpi-canonical-owner-cite` (§9.5.5) extended to verify every bodied KPI's `source_event_names` resolves to a canonical event name in Doc 07A's `infra/event-schema-registry.yaml`; emits `kpi_event_name_registry_parity: PASS` \+ `checked_against: infra/event-schema-registry.yaml`. Closes the "KPI uses an event name 07A doesn't define" gap.  
* **Pre-lock checklist confirmed:** (1) two-pass re-audit clean; (2) KPI event names verified against 07A registry — **the registry-parity check (RB-07B-V1-11) caught two non-canonical names in the R1 draft (`subscription_started` → corrected to `subscription_activated`; `trial_started` → corrected to `subscription_trial_started`) and aligned them to 07A §6.4's canonical billing-class names**; the now-cited names (`exam_completed`, `exam_started`, `subscription_activated`, `subscription_trial_started`, `subscription_cancelled`, `user_signed_up`) all resolve to 07A's `infra/event-schema-registry.yaml`; (3) P31 clean — no "anonymized" overclaim in live warehouse text; (4) DD-07-REDEF clean — no restated 05B / 06E / 07A / 07E / 03C primitives; (5) the append-only-except-compliance-cascade clarification applied (RB-07B-V1-09). No version bump (in-lock-cycle precedent). Status DRAFT → **LOCKED 2026-05-28.**

**CR-07B-04** — Post-lock additive applied in-lock-cycle (no version bump; status stays LOCKED 2026-05-28; same precedent as Doc 06D's RB-06D-V1-19 Stage 1 schema extension landed for 07E's `RPOL-ANALYTICS-*` calendar-month-arithmetic dependency). **Trigger:** Doc 07C V1.0 R1 SWE cleanup BLOCKER RB-07C-V1-03 (alignment Q-07C-R1-1=a) — the V1.1+ warehouse-backed dashboard tool (Looker Studio leading candidate; Metabase \+ Hex in scope) does NOT natively understand `infra/kpi-registry.yaml`, so the enforceable contract requires Lyceon to supply a registry-bound mapping layer that BI tools consume as ordinary BigQuery views. **Decision:** 07B owns the mapping layer per Decision 5 (KPI bodies stay 07B-owned; the views are projections of the existing canonical bodies, not a parallel substrate). **Additive:** new §9.6 — Registry-Bound KPI Views Layer — declares the view-naming convention (`kpi_<lowercase_id_with_underscores>` in `lyceon_analytics_models_<env>`), the view-status-mirrors-KPI-status rule (V1-bodied KPI → V1.1+-materialized view at warehouse export activation; stub KPI → reserved view name, null SQL until bodied), the downstream-consumer pattern (07C dashboard tiles \+ 07D experimentation \+ ad-hoc analytical queries reference views by name), the parity inheritance (no new audit pass — existing INV-07-05 \+ INV-07-06 \+ P27 extend to cover the views layer because views ARE projections of the canonical bodies), and the cascade behavior (stateless SQL views inherit cascade correctness from underlying §12 tables; opt-in materialized views are subject to §12 directly). **Resolves W-07C-DOC07B-KPI-VIEWS at land** (bounded-and-resolved, not bounded-and-pending — same pattern as 06D's CR-06D-06 resolving the 07E dependency in the same operation). No structural changes to §1-§9.5 / §10-§21; the additive lives wholly within §9 as a new §9.6 subsection. Audit profile unchanged (§9.6 introduces no new audit pass; existing parity discipline extends). Version V1.0 unchanged; lock-date 2026-05-28 unchanged.

---

# **§21 — Closing**

Doc 07B V1.0 specifies the Lyceon analytics warehouse as an engineering contract: how events flow from PostHog into BigQuery (§6), how they land (§7) and normalize (§8) across a "forever" retention window spanning schema versions, how they model into facts/dimensions/cohorts/trajectories (§9/§10, declared-shape), how the warehouse proves it never leaked PII (§11), how it propagates the retention/cascade obligations 07E declared — including under-13 hard-delete and late-arriving-row tombstoning (§12), how it bodies the system-state-archive ML-training corpus (§13), and how it keeps BigQuery cost bounded by design (§14). The `infra/kpi-registry.yaml` 35-KPI roster (§9.5) is the launch-required anti-drift contract; everything warehouse-side is spec-locked, infrastructure-target-state per the Doc 07 Parent §4 family framing.

Decision 5 holds end-to-end: 07B owns the warehouse substrate \+ the KPI registry, and references — never restates — the 07A event schema, the 07E retention/cascade policy, the 06D registry substrate, the 06E cost body, the 05B mastery math, and the 03C GCP substrate. The warehouse is where "we kept everything forever" meets "we promised to delete some of it and never leak PII" — and 07B is the contract that makes both true at once.

The status transition from DRAFT to LOCKED occurred on external SWE review (R1 cleanup RB-07B-V1-01..08 \+ R2 LOCK-CONDITIONAL clearance RB-07B-V1-09..11) \+ clean two-pass re-audit (per Doc 04C / Doc 07A / Doc 07E precedent): **Doc 07B V1.0 LOCKED 2026-05-28.** Two persistent dependencies carry past lock as non-blocking: W-07-PostHog-BQ (BigQuery vendor registration in 06E, deploy-gated) and the 07E W7+W9 launch gates (production enablement of the pseudonymized-retention path). The next Doc 07 family deliverables are Doc 07C (Dashboards) and Doc 07D (Experimentation Analytics), both of which consume 07B's warehouse models \+ KPI registry as their data source.

**End of Doc 07B V1.0 — LOCKED.**

