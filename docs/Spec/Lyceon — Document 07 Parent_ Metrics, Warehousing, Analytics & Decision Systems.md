# **Lyceon — Document 07 Parent: Metrics, Warehousing, Analytics & Decision Systems**

**Version:** V1.0 **Status:** LOCKED **Lock date:** 2026-05-23 **Last updated:** 2026-05-23 (CR-07-Parent-04 in-lock-cycle draft-for-lock cleanup applied; status transitioned DRAFT→LOCKED on clean two-pass re-audit; subsequent in-lock-cycle cleanup if any holds the 2026-05-23 lock date per Parent §8 multi-round precedent) **Owners:** Founder / CTO review **Governed by:** Doc 00 (Authoritative Platform Directive). **Family scope per canonical document map:** Doc 07 covers metrics, warehousing, analytics, and decision-systems infrastructure — event taxonomy, tracking standards, product analytics, funnel analytics, learning analytics, tutor analytics, warehouse models, dashboards, experimentation metrics, executive scorecards, churn predictors, cohort retention. **Depends on:** Doc 00 (server-authoritative, deterministic, auditable); Doc 01 V6.0 (identity model, opaque user\_id semantics); Doc 01A V1.0 (CANONICAL — §3 config doctrine, §14 PII inventory, §18 alert routing tiers consumed via crosswalk); Doc 03 Main V1.1 (LISA tutor; §11 usage caps, §14.2 retention matrix, §24 LISA cost discipline, PDF-06 §4 tutor verification events — all referenced, never restated); Doc 04 family V1.0 (LOCKED — exam runtime, scoring, completion events feed Doc 07 event taxonomy as canonical sources); Doc 05 family V1.0 (LOCKED — mastery events \+ audit logs \+ KPI rollups; **05B owns mastery KPI bodies canonically**, Doc 07 references); Doc 05D V1.0 (LOCKED — account-deletion cascade names "analytics" as layer 4; Doc 07 owns the cascade target body); Doc 06 family V1.0 (LOCKED A/B/C/D/E — 06A §3 platform stack inventory consumed for vendor list extension, 06C §6/§7/§8/§10/§11 substrate consumed, 06D §9 retention policy registry consumed (Doc 07 registers analytics-layer entries), 06D §11 privacy-incident sub-class consumed (Doc 07 surfaces are privacy-incident producers), 06E §4 launch-vs-target convention adopted natively, 06E §5/§7 vendor inventory \+ cost models extended with PostHog \+ BigQuery via W-07-PostHog-BQ cross-doc additive). **Forward-references (bounded):** Doc 09 (FWD-07-01 — financial unit economics, CAC/LTV/margins, revenue models, the boundary established with FWD-06-05 from 06E's side); Doc 08 (FWD-07-02 — multi-vertical analytical model when ACT/AP/B2B/international verticals add per Doc 08 scope); Doc 10 (FWD-07-03 — brand/social-proof analytics surface for community engagement and social listening). **Applies to:** family governance and structural framing — sub-doc decomposition (07A Event Schema \+ 07E Retention/Privacy/Cascade \+ 07B Warehouse Models \+ 07C Dashboards \+ 07D Experimentation Analytics, drafted in this launch-required-first order per Q-07-6); the "spec-locked, infrastructure-target-state" framing that distinguishes Doc 07 V1 from prior family V1s; family invariants INV-07-01..09; family-wide audit suite extension to 30 passes (25 baseline carried from 06E \+ P26-P30 new for Doc 07); the canonical 34-KPI roster (6 bodied at V1, 28 name-only stubs) registered in `infra/kpi-registry.yaml`; the launch-required-vs-target-state annotation discipline applied at the doc family level (most Doc 07 mechanisms are `launch_required: false`; the launch-required minimum is event taxonomy spec \+ event emission to PostHog \+ PII redaction contract \+ retention policy declaration \+ cascade target declaration \+ KPI registry); the bundled cross-doc additive W-07-PostHog-BQ owed to Doc 06E (PostHog as Tier-1 launch-required vendor; BigQuery as Tier-1 target-state vendor); and the boundary-table-canonical principle applied to Doc 07 → Doc 09 financial-unit-economics boundary (Doc 07 owns the technical surface that measures; Doc 09 owns the financial formula/interpretation; cited never restated). **Explicitly excludes:** mastery KPI body math (Doc 05B owns canonical formula \+ 0.5^((i-1)/30) position-based half-life \+ difficulty weights \+ source weights \+ 5-level mastery threshold — referenced, never restated); LISA cost discipline body (Doc 03 Main §24 owns $20/$18/$10/\<$6 tiering — referenced, never restated); LISA usage caps body (Doc 03 Main §11 owns 120/day, 2500/week, 10K/month — referenced, never restated); per-platform infra cost body (Doc 06E §7 owns 8-vendor cost structure — referenced, never restated); financial unit economics body (Doc 09 — FWD-07-01 bounded forward-ref); multi-vertical analytical model body (Doc 08 — FWD-07-02 bounded forward-ref); brand/social-proof analytics body (Doc 10 — FWD-07-03 bounded forward-ref); deletion-cascade base mechanism (Doc 05D §10 owns the cascade orchestration; Doc 07E owns layer-4 analytics target body); alert routing / scheduled job substrate / incident lifecycle (06C §6/§7/§8/§10/§11 own — consumed as substrate); compliance-gate registry pattern (06D §10 referenced as design precedent only); §10.5 envelope schema (Doc 06 Parent §10.5 / 06A §10.5.1 — extended where needed in sub-docs).

---

# **§1 — Purpose & Position in the Lyceon Document Architecture**

Doc 07 is the **internal-only** metrics, warehousing, analytics, and decision-systems doc family. It answers: *what events does Lyceon emit at every layer of the stack, how does that event stream become analytical surfaces, what canonical KPIs does the platform track and how are they defined, how do internal stakeholders (founder, product team, engineering) make decisions using those surfaces, and how does the analytics layer honor the platform's retention, privacy, and deletion-cascade obligations.*

**The "spec-locked, infrastructure-target-state" framing.** Per pre-draft decision Q-07-3-confirmation-1, Doc 07 V1 ships **substantive spec contracts** for everything Doc 06D §9 retention registry and Doc 05D §10 deletion cascade reference, but the **infrastructure body** (running warehouse, built dashboards, A/B test framework, churn predictive model) is target-state V1.1+ per §4 launch-vs-target convention adopted family-wide from 06E. This is the most aggressively target-state-leaning doc family to date, and the framing is intentional: Lyceon at MVP launch does not need a running analytics warehouse to be a working product, but it MUST not lose the events that the eventual analytics layer will need, and it MUST honor the privacy/retention/cascade obligations the 06 family has already committed to.

**What Doc 07 V1 actually ships at launch.** Six launch-required deliverables (carried in §12 acceptance criteria):

1. **Locked event taxonomy specification** (07A) — every event Lyceon code emits at launch has a registered structure in `infra/event-schema-registry.yaml`. Strict registration is required for the named V1 events; loose-schema is permitted for V1.1+ additions per Q-07-1=(a) but the PII redaction contract applies regardless of schema tier. **Loose schema means the event has a registry entry with base required fields but does not yet require full property-level schema. It does NOT mean unregistered production events are allowed** — every emitted event at every tier must have a registry entry before it can be emitted in production.  
2. **Event emission to PostHog from V1 application code** — the only running analytics infrastructure at launch. PostHog acts as the V1 event buffer that preserves events until the warehouse comes online.  
3. **PII redaction contract on event emission** — always-strict regardless of schema tier; zero raw PII in event payloads (server-generated opaque user\_id only — no email/phone/name-derived or stable cross-system hash identifiers; bucketed demographics only per Q-07-3-confirmation-3=a).  
4. **Locked analytics retention policy declaration** (07E) — registered in Doc 06D §9 retention policy registry as the FWD-06-01 resolution. The *enforcement* mechanism (warehouse-side TTL, automated purge) is target-state; the *policy declaration* is launch-required.  
5. **Locked deletion-cascade target declaration** (07E) — Doc 05D §10 cascade layer-4 (analytics) cascade target body. Hits PostHog's delete-person API at launch; extended to warehouse layer when BigQuery activates V1.1+.  
6. **Locked KPI registry** (`infra/kpi-registry.yaml`) — 34 KPI names locked at V1 with canonical-owner-citations; 6 KPIs bodied with measurement formula at V1; 28 are name-only stubs with V1.1+ activation triggers.

**What Doc 07 V1 explicitly does NOT ship at launch.** Running warehouse (BigQuery activation is target-state); built dashboards (PostHog's built-in dashboards cover operational minimum at launch; warehouse-backed dashboards are V1.1+); A/B testing framework (PostHog substrate is in place via Tier-1 vendor inventory but no experiments run at launch); churn predictive model (definitions and data structure locked at V1; predictive model is V1.1+ or V2); per-feature cost attribution pipeline (technical mechanism is V1.1+; FWD-07-01 carries the financial interpretation boundary to Doc 09); tutor analytics BI surface (Doc 03 owns LISA operational analytics; Doc 07 BI wrapper is V1.1+).

**Doc 07 owns the spec contracts that downstream consumers reference.** Doc 06D §9 retention registry has an analytics-layer row that must be resolvable to Doc 07 by exact §. Doc 05D §10 cascade has a layer-4 entry that must be resolvable to Doc 07 by exact §. These are launch-blocking on spec lock, not on infrastructure deployment. The spec contracts Doc 07 V1 delivers are therefore substantive enough that 06D and 05D can deploy against them without ambiguity.

Per Parent §6.13 (Doc 06 Parent canonical, inherited family-wide) every capability statement names a proving mechanism with the six-element implemented-definition; per Parent §5 every primitive body remains canonical to its owner and is referenced, never restated; per 06E §4 (NEW from 06E origin, applied family-wide) every mechanism declares `launch_required: bool` with V1.1+ trigger criterion for `launch_required: false` mechanisms.

---

# **§2 — Scope and Boundary**

## **2.1 Doc 07 owns**

The five-sub-doc family decomposition (07A Event Schema \+ 07E Retention/Privacy/Cascade \+ 07B Warehouse Models \+ 07C Dashboards \+ 07D Experimentation Analytics — drafted in launch-required-first order per Q-07-6=β); the event taxonomy specification with strict/loose schema tier discipline (07A — `infra/event-schema-registry.yaml`); the PII redaction contract applied always-strict to all event emissions regardless of schema tier (07A \+ 07E joint); the V1 launch event emission to PostHog as the V1 analytics substrate buffer (07A); the warehouse model specification including dimensional model, fact/dimension table contracts, ingestion pipeline contract (07B — bodies target-state V1.1+); the dashboard substrate specification including dashboarding tool selection rationale, dashboard registry shape, executive-scorecard contract (07C — bodies target-state V1.1+); the experimentation framework specification including A/B test event tagging contract, statistical-framework contract, experiment-management surface contract (07D — bodies target-state V1.1+); the analytics retention policy declaration registered with Doc 06D §9 retention registry as FWD-06-01 resolution (07E — declaration launch-required, enforcement target-state); the deletion-cascade target body for Doc 05D §10 layer-4 (analytics) cascade resolution (07E — launch-required for PostHog substrate; extended to warehouse V1.1+); the canonical 34-KPI roster locked at V1 with `infra/kpi-registry.yaml` machine-readable registry (07B — 6 bodied, 28 name-only stubs); the cross-doc boundary table for Doc 07 ↔ Doc 09 (technical surface vs financial body) preserved via FWD-07-01; the canonical event-classes catalog (auth/billing/practice/exam/tutor/mastery/system events); the bundled cross-doc additive W-07-PostHog-BQ owed to Doc 06E (PostHog Tier-1 launch-required \+ BigQuery Tier-1 target-state); five new family-specific audit passes P26-P30 extending the carry-forward audit suite to 30 passes total.

## **2.2 Doc 07 explicitly does NOT own (Decision 5 — referenced, never restated)**

| Concern | Canonical owner (referenced by exact §) |
| ----- | ----- |
| Mastery KPI body math (acc formula, position decay, difficulty weights, source weights, mastery thresholds) | Doc 05B V1.0 — referenced via 05B §3-§5; KPI-LRN-01 / KPI-LRN-05 entries in `infra/kpi-registry.yaml` cite 05B as canonical owner |
| LISA cost target/alert thresholds ($20 hard cap, $18 hard alert, $10 soft alert, \<$6 target) | Doc 03 Main V1.1 §24 — referenced via project handoff record per §3.4; KPI-OPS-03 / KPI-TUT-05 entries cite Doc 03 §24 |
| LISA usage caps (120/day, 2,500/week, 10K/month hard) | Doc 03 Main V1.1 §11 — referenced; KPI-TUT-04 / KPI-TUT-05 entries cite |
| LISA retention matrix (10 LISA tables, archival cadences) | Doc 03 Main V1.1 §14.2 — referenced; 07E retention declarations for tutor-event surfaces cite |
| LISA tutor verification events (tutor\_helped / tutor\_failed canonical taxonomy) | Doc 03 family — referenced; KPI-TUT-02 / KPI-TUT-03 entries cite as canonical event source (V1: name-only stubs, no deterministic body per pre-draft Q-07-3 follow-up) |
| Per-platform infra cost body (Vercel, Supabase, Vertex AI, Cloud Run, Cloudflare, Stripe, Sentry, GitHub Actions cost structures) | Doc 06E V1.0 §7 — referenced; KPI-OPS-01 / KPI-OPS-02 entries cite 06E §8 composite |
| Financial unit economics body (CAC, LTV, gross margin, revenue models, churn financial impact) | Doc 09 — **FWD-07-01** sanctioned bounded forward-ref; KPI-BIZ-03 / KPI-BIZ-04 entries cite Doc 09 as target owner for V1.1+ bodies |
| Multi-vertical analytical model body (ACT/AP/B2B/international event-taxonomy fork or extension) | Doc 08 — **FWD-07-02** sanctioned bounded forward-ref; 07A event-schema-registry V1 covers single-vertical SAT; Doc 08 owns multi-vertical model |
| Brand/social-proof analytics body (community engagement, social listening, sentiment) | Doc 10 — **FWD-07-03** sanctioned bounded forward-ref |
| Account-deletion cascade base orchestration | Doc 05D V1.0 §10 — referenced; 07E owns ONLY the layer-4 (analytics) cascade target body |
| Privacy-incident lifecycle base | Doc 06D V1.0 §11 — referenced; Doc 07 surfaces are privacy-incident producers via the standard mechanism |
| Compliance-gate registry pattern | Doc 06D V1.0 §10 — design precedent reference only; Doc 07 V1 has no compliance gates owned |
| Retention policy registry substrate | Doc 06D V1.0 §9 — referenced; Doc 07E registers analytics-layer entries via the standard schema |
| Alert routing tiers (Page / Warn / Info) \+ severity crosswalk | Doc 01A §18 via Doc 06C §6 — referenced; Doc 07 V1 owns no alerting bodies (no V1 launch-required alerts; V1.1+ Doc 07-class alerts will register via 06C §7 standard) |
| Scheduled-job heartbeat substrate | Doc 06C V1.0 §8 — referenced (Doc 07 V1 has no launch-required scheduled jobs; V1.1+ warehouse ingestion job will register via 06C §8 standard) |
| Incident lifecycle base table \+ transition RPC | Doc 06C V1.0 §10 — referenced (Doc 07-class incidents register via the standard mechanism when V1.1+ infrastructure activates) |
| Platform stack inventory body (canonical Vercel/Supabase/etc. list) | Doc 06A V1.0 §3 — referenced; Doc 07 contributes PostHog \+ BigQuery as new Tier-1 entries via the W-07-PostHog-BQ cross-doc additive applied to Doc 06E §5/§7/§13 |
| Environment matrix (Dev/Staging/Prod) | Doc 06A V1.0 §7 — referenced |
| Vendor cost-structure documentation pattern | Doc 06E V1.0 §7 — referenced; PostHog \+ BigQuery extension subsections will be added under the W-07-PostHog-BQ additive |
| Vendor pricing snapshot registry pattern | Doc 06E V1.0 §13 — referenced; PostHog \+ BigQuery pricing snapshot entries added under the W-07-PostHog-BQ additive |
| Launch-vs-target annotation convention origin | Doc 06E V1.0 §4 — referenced; Doc 07 adopts natively (more `launch_required: false` annotations than any prior doc) |
| §10.5 envelope schema (12 common fields \+ per-mechanism extras matrix) | Doc 06 Parent §10.5 / 06A §10.5.1 — extended in sub-docs where needed (per-sub-doc envelope extras matrices) |

## **2.3 03C boundary (inherited from 06 family)**

Any LISA-tier surface is canonical to Doc 03 Main §11/§14.2/§24 and Doc 03C V3.0 §11.3/§28. Doc 07 references both by exact § in 07A (tutor event types) \+ 07B (KPI-TUT-\* registry entries) \+ 07E (LISA retention surface cross-ref to Doc 03 Main §14.2) and never restates a LISA cap, retention duration, cost threshold, or substrate cost mechanism. Restating any such body in Doc 07 is a `DD-07-REDEF` defect surfaced by audit P12 / P15 (carry-forward) \+ P27 (KPI-canonical-owner-citation parity, new).

## **2.4 Doc 05 family boundary (mastery KPI canonical split)**

Per pre-draft Q-07-1-context decision (mastery KPIs for user-facing surfaces are 05B-owned; other KPIs for admin/internal surfaces are Doc 07-owned), the boundary is:

* **05B owns:** `acc_s` formula, position-based weight `pw = 0.5^((i-1)/30)`, difficulty weights (0.79/1.0/1.20), source weights (0.50/0.30/0.20), 5-level mastery threshold (0.19/0.39/0.59/0.79), `MIN_EVENTS_FOR_MASTERY = 5`. User-facing surfaces read 05B mastery\_level only.  
* **Doc 07 owns:** internal/admin BI surface that may aggregate 05B mastery\_level across cohorts, time, and segments. `mastery_level_distribution` (KPI-LRN-01) is a Doc 07-owned aggregate KPI that *cites* 05B as its data source but does not restate the 05B formula. `mastery_progression_velocity` (KPI-LRN-05) is similarly Doc 07-owned and references 05B mastery event stream.

Doc 07 doc lines that restate the 05B formula, weight, threshold, or constants are `DD-07-REDEF` defects flagged by audit P27.

## **2.5 Inheritance**

Doc 07 inherits Doc 00, Doc 06 Parent §3 (lightweight family-shape framing — Doc 07 is even more lightweight at V1 than 06E given the all-target-state framing), Parent §6.13 (named ≠ implemented; six-element proving mechanism), Parent §10.5 (Standard Proof Artifact Envelope), Parent §13 severity model (Page / Warn / Info \+ operational\_response\_urgency — Doc 07 V1 emits no alerts, so this is inherited-but-unused at V1), 06A §3 (platform stack inventory consumed and extended via W-07-PostHog-BQ), 06A §7 (environment matrix), 06B §8.6 source-independence (event-emission cost-source independence — cost-related events emit from vendor billing APIs not from Lyceon-derived metrics), 06C §6.0 registry-canonical principle (Doc 07's `event-schema-registry.yaml` and `kpi-registry.yaml` are canonical machine-readable sources, not the markdown renderings of them), 06D §8.7 no-PII proof-artifact rule (family-wide reference — applied to all Doc 07 proof artifacts; RB-06D-V1-10 family-wide rule canonical), 06D §11 privacy-incident sub-class (Doc 07 surfaces are privacy-incident producers), 06E §4 launch-vs-target annotation convention (adopted natively), 06E §5 vendor inventory pattern (Doc 07 extends via W-07-PostHog-BQ), 06E §7 cost-structure documentation pattern (PostHog \+ BigQuery subsections added via W-07-PostHog-BQ), 06E §13 pricing snapshot registry pattern (PostHog \+ BigQuery entries added via W-07-PostHog-BQ).

---

# **§3 — Threat Model (Operational \+ Privacy)**

Operational \+ privacy threats this family addresses. Doc 07's threat profile is unique in the family because the doc is mostly target-state — many threats are about *future operability of analytics decisions* rather than about *current operational failures*.

1. **Event loss at launch.** If Lyceon V1 application code does not emit events from day one, those events are unrecoverable. Future analytics surfaces that depend on historical event streams (cohort retention, churn analysis, learning trajectory analysis) will be permanently blind for the launch cohort. *Defense:* §1 launch-required deliverable \#2 (event emission to PostHog from V1 application code) \+ 07A event taxonomy spec locked at V1 \+ PostHog Tier-1 launch-required substrate per W-07-PostHog-BQ.

2. **Event taxonomy drift.** Without strict registration of V1-named events, code teams emit ad-hoc events with inconsistent shapes; analytical surfaces built later cannot reliably aggregate. *Defense:* 07A `infra/event-schema-registry.yaml` strict tier for V1-named events; CI parity check enforces every code-emitted event against the registry; loose tier permitted for V1.1+ additions but PII contract still applies (Q-07-1=a). **Loose-tier means the registry entry has base required fields but defers full property-level schema; loose-tier does NOT permit unregistered production events** — every emitted event at every tier must have a registry entry, schema-tier governs how rigorous the entry's field-list is, not whether the entry exists.

3. **PII leak through analytics surface.** Event payloads inadvertently include raw PII (user names, email addresses, free-text answers); the analytics warehouse becomes a parallel PII store. Stable cross-system hash identifiers (e.g., hashed email) are also a re-identification vector and equally forbidden. *Defense:* 07A \+ 07E joint PII redaction contract — zero raw PII in event payloads per Q-07-3-confirmation-3=a; **server-generated opaque user\_id only** (no email/phone/name-derived or stable cross-system hash identifiers); bucketed demographics only; CI validator at emission time \+ 07E warehouse-side enforcement when warehouse activates.

4. **Retention policy declaration absent.** Doc 06D §9 retention policy registry has an analytics-layer row that expects to be resolved by Doc 07\. If Doc 07 does not lock the retention policy at V1, 06D cannot deploy its retention-policy-conformance mechanism. *Defense:* 07E retention policy declaration is launch-required spec content; published as a Doc 06D §9 registry row resolving the FWD-06-01 obligation.

5. **Deletion-cascade analytics layer absent.** Doc 05D §10 cascade names "analytics" as layer 4; if Doc 07 does not body the layer-4 target, the cascade has a known dangling reference. *Defense:* 07E deletion-cascade target declaration is launch-required spec content; hits PostHog's delete-person API at launch (PostHog substrate is the V1 analytics layer); extended to warehouse layer when BigQuery activates V1.1+.

6. **KPI definition drift.** Without a canonical KPI registry, the same KPI name (e.g., "MAU") gets defined differently by different consumers (the founder's DAU/MAU dashboard vs. the engineering team's MAU vs. an investor pitch deck's MAU). Decisions based on conflicting numbers undermine internal trust. *Defense:* `infra/kpi-registry.yaml` with 34 canonical KPI names locked at V1; 6 bodied at V1 with measurement formula \+ lineage; 28 name-only stubs with V1.1+ activation triggers and canonical-owner-citation discipline.

7. **Stack-consolidation drift.** Lyceon picks PostHog at V1 for product analytics \+ dashboards \+ experimentation, with intent to consolidate toward GCP (BigQuery as warehouse-of-record) per founder preference. Without a documented migration path and decision criteria, the V1 PostHog substrate could become permanent ad-hoc infrastructure that drifts away from the GCP-consolidation strategy. *Defense:* §6 V1 vendor choices documented with explicit V1.1+ migration triggers; 07B warehouse model spec is BigQuery-targeted from V1 even though build is target-state; PostHog → BigQuery migration path is a target-state design that V1 spec anticipates.

8. **A/B test misuse at V1.** PostHog provides the A/B test substrate at launch (W-07-PostHog-BQ Tier-1 launch-required), but actual A/B experimentation is not statistically meaningful at sub-1K-MAU scale. If V1 launches with A/B tests running anyway, decisions made on underpowered samples will be wrong. *Defense:* 07D explicitly states no V1 launch-required experiments; substrate is in place for V1.1+ activation; V1.1+ trigger criterion \= sustained 5K MAU minimum.

9. **Cost-attribution boundary confusion (Doc 07 vs Doc 09).** Both Doc 07 and Doc 09 touch cost: Doc 07 measures, Doc 09 interprets. Without clean boundary discipline, per-feature cost attribution could either get re-implemented in two places or fall through the gap. *Defense:* §15 cross-doc seam table establishes Doc 07 ↔ Doc 09 boundary as "technical surface vs financial body"; FWD-07-01 carries the boundary forward to Doc 09 drafting.

10. **Internal-only assumption violated at V1.1+.** Q-07-5 (E2 answer) locked Doc 07 V1 as internal-only consumers. If Doc 07 V1.1+ adds external consumers (board reporting via dashboard exports, parent-facing surfaces, regulator reporting) without re-evaluating the privacy posture, surfaces designed for internal use leak when externalized. *Defense:* §16 watch item W-07-INTERNAL-EXT-DRIFT flags V1.1+ scope expansion as a re-evaluation trigger.

**Threats explicitly NOT addressed here:**

* Mastery formula correctness — 05A/05B canonical.  
* LISA cost discipline correctness — Doc 03 Main §24 canonical.  
* Backup / restore / DR threats — Doc 06A §15 / 06D §13 canonical.  
* Compliance-evidence process — Doc 06D §10 canonical (Doc 07 V1 has no compliance gates).  
* Authentication / authorization — Doc 01 / Doc 01A canonical.  
* Vendor-outage cost-cap threats — Doc 06E §6 / §10 canonical.  
* Financial unit economics / runway / CAC modeling — Doc 09 — FWD-07-01 bounded forward-ref.

## **3.4 Doc 03 Main citation path (carried family-wide from 06C/06D/06E)**

Doc 03 Main V1.1 is not present in this session's source tree. Citations to §11 (usage caps), §14.2 (retention matrix), §24 (LISA cost metrics) are made per the project handoff record. On Doc 03 Main upload, 07A tutor-event subsections \+ KPI-TUT-\* / KPI-OPS-03 registry entries \+ 07E LISA retention cross-references gain parsed §24/§14.2/§11 reconciliation as additional input to the audit; until then, cited section names are recorded in proof artifacts as `cited_per_project_handoff_record`. Registered as W1 in §16 (non-blocking).

## **3.5 Doc 05D / Doc 05B citation paths**

Doc 05D V1.0 and Doc 05B V1.0 are not present in this session's source tree. Citations to 05D §10 (cascade base) and 05B §3-§5 (mastery KPI body) are made per project memory. On uploads, reconciliation triggers as standard. Registered as W2 in §16 (non-blocking).

---

# **§4 — The "Spec-Locked, Infrastructure-Target-State" Framing (Doc-07-Specific Doctrine)**

## **4.1 What this framing is**

Doc 07 is the first family in the canonical document map where the entire family ships at V1 as **spec contracts** with **target-state infrastructure**. Prior families (Doc 04, Doc 05, Doc 06\) all shipped launch-required infrastructure alongside their specs. Doc 07 V1 deliberately does not.

This framing extends the §4 launch-vs-target annotation convention introduced in Doc 06E by applying it at the doc-family level rather than just at the mechanism level. The convention states that every mechanism declares `launch_required: bool`. Doc 07's family-level extension states that **most mechanisms in the doc family are `launch_required: false`**, and the doc's V1 value is in spec contract precision and downstream consumer reference resolution rather than in operational deployment.

## **4.2 Why this framing is the right one for Doc 07 V1**

Three reasons:

1. **MVP launch does not require running analytics.** Lyceon MVP is a learning product. Students study, take exams, get scored, see mastery progress. None of that requires a running analytics warehouse, built dashboards, or A/B test machinery. The MVP product can launch and operate correctly with no Doc 07 infrastructure deployed beyond event emission. Building Doc 07 infrastructure at MVP launch is premature optimization.

2. **MVP launch DOES require event emission and retention/cascade spec lock.** If Lyceon V1 ships without emitting events, the event stream needed for any future analytics is permanently lost for the launch cohort. If Lyceon V1 ships without an analytics retention policy declared, Doc 06D §9 retention conformance cannot be enforced. If Lyceon V1 ships without an analytics cascade target declared, Doc 05D §10 deletion cascade has a dangling reference. These are launch-required obligations that Doc 07 V1 honors via spec contracts plus a minimal running PostHog substrate.

3. **The 06 family is already deploy-gated on Doc 07's spec lock.** FWD-06-01 from 06C/06D/06E names Doc 07 as the resolution target. The 06 family cannot deploy its full retention conformance and cascade orchestration without Doc 07's spec locked. Spec lock IS the launch deliverable.

## **4.3 What launch-required means in Doc 07's context**

Three categories of launch-required mechanism in Doc 07 V1:

**Category A — Spec contracts that downstream consumers reference by exact §.** These are spec-locked but the *enforcement mechanism* may be target-state. Examples: 07E retention policy declaration (declaration spec-locked; enforcement target-state); 07E deletion-cascade target body (spec-locked; PostHog-side launch-required, warehouse-side target-state); 07A event-schema-registry V1 entries (registry locked; CI parity check launch-required).

**Category B — Running infrastructure that must be live at V1 because the event stream is unrecoverable.** PostHog event emission. This is the ONLY infrastructure deployment Doc 07 V1 mandates.

**Category C — Always-strict cross-cutting contracts that apply regardless of category A or B.** PII redaction contract (applies to every event emitted at V1 and every event emitted V1.1+ — schema strictness tier does not affect PII contract per Q-07-1=a).

**Everything else** is `launch_required: false` with V1.1+ trigger criterion stated.

## **4.4 Implications for audit, deploy gates, and cross-doc seams**

* **Audit suite continues at 30 passes** carried from 06E \+ 5 new (P26-P30). Passes that check infrastructure deployment (e.g., 06D-specific deploy-readiness passes) are not applicable to Doc 07; they trivially pass for Doc 07 the same way 06D-specific passes trivially passed for 06E.  
* **Deploy gates use a new SPEC\_CONTRACT\_GATE class** (introduced in this doc) alongside the existing BLOCKING\_UPSTREAM\_GAP / BLOCKING\_PRIVACY\_GAP / SPEC\_LOCK\_GATE classes from the 06 family. SPEC\_CONTRACT\_GATE means: this spec must be locked before downstream consumer X can deploy, even though the infrastructure described by the spec may be target-state. Doc 06D §9 retention conformance has a SPEC\_CONTRACT\_GATE on Doc 07E retention policy declaration. Doc 05D §10 cascade orchestration has a SPEC\_CONTRACT\_GATE on Doc 07E cascade target body.  
* **Cross-doc seams** include a "spec contract resolution status" column for forward-refs originating from Doc 07\. FWD-07-01 (Doc 09\) carries SPEC\_CONTRACT\_GATE on the boundary statement; FWD-07-02 (Doc 08\) and FWD-07-03 (Doc 10\) are not deploy-gating but their resolution is locked.

---

# **§5 — Family Decomposition (Q-07-6=β Drafting Order)**

## **5.1 Five sub-docs**

Per Q-07-1=β locked, Doc 07 ships five sub-docs at V1:

| Sub-doc | Title | Drafting order | Primary V1 deliverable | V1 launch-required content |
| ----- | ----- | ----- | ----- | ----- |
| **07A** | Event Schema & Tracking Standards | 1st | `infra/event-schema-registry.yaml` \+ PII redaction contract \+ V1 event-class catalog | Schema spec \+ PostHog emission contract |
| **07E** | Analytics Retention, Privacy & Cascade | 2nd | Retention policy declaration (FWD-06-01 resolution) \+ Doc 05D §10 cascade layer-4 target body | Both declarations launch-required spec; enforcement target-state |
| **07B** | Warehouse Models & KPI Registry | 3rd | `infra/kpi-registry.yaml` (34 KPIs, 6 bodied, 28 stub) \+ dimensional model spec | KPI registry \+ canonical owner citations launch-required; warehouse model body target-state |
| **07C** | Dashboards & Decision Surfaces | 4th | Dashboard substrate spec \+ executive-scorecard contract | Mostly target-state; minimal launch content |
| **07D** | Experimentation Analytics | 5th | A/B test event-tagging contract \+ statistical-framework contract | Substrate registered via W-07-PostHog-BQ; no V1 experiments running |

## **5.2 Drafting order rationale (launch-required-first per Q-07-6=β)**

07A and 07E are drafted first because they contain the V1 launch-required content. If drafting them surfaces gaps that affect 07B/C/D shape (likely — schema strictness or PII boundary may force warehouse-model adjustments), better to find those gaps early. 07B follows because the KPI registry depends on the event schema from 07A. 07C and 07D are last because they're mostly target-state.

## **5.3 Sub-doc lock sequencing**

Each sub-doc drafts → independent SWE review → in-lock-cycle cleanup → audit clean → LOCK. Per the 06 family precedent (multi-round in-lock-cycle cleanup permitted post-LOCK without version bump, lock date holds), each Doc 07 sub-doc can absorb post-lock cleanup rounds. The W-07-PostHog-BQ cross-doc additive to 06E lands after all Doc 07 sub-docs LOCK to avoid concurrent cross-doc churn.

---

# **§6 — Vendor Choices for Doc 07 V1 (Stack Consolidation Lean GCP)**

## **6.1 PostHog (Tier-1 launch-required)**

**Role:** V1 analytics substrate. Provides product analytics \+ dashboards \+ A/B testing \+ feature flags \+ funnels \+ session replay as a single integrated tool. Acts as the V1 event-stream buffer that preserves events until the BigQuery warehouse comes online.

**Why PostHog at V1:** Q-07-2=β locked the BigQuery \+ PostHog stack. PostHog is launch-required because: (a) collapses 4 potential vendor decisions (product analytics tool \+ dashboard tool \+ A/B test tool \+ funnel analyzer) into one; (b) generous free tier (1M events/month) covers Lyceon launch volumes by wide margin; (c) PostHog → BigQuery export pipeline exists natively, supporting target-state migration to warehouse-backed analytics without re-instrumentation.

**Cross-doc registration:** PostHog must be added to Doc 06E `infra/vendor-inventory.yaml` as Tier-1 launch-required vendor \+ 06E §6.3 outage runbook stub \+ 06E §7 cost-structure subsection \+ 06E §13 pricing snapshot entry. This is the W-07-PostHog-BQ bundled cross-doc additive applied after all Doc 07 sub-docs LOCK.

## **6.2 BigQuery (Tier-1 target-state)**

**Role:** Warehouse-of-record. Receives PostHog event export, joins with Supabase user/billing data via federated query or scheduled export, hosts the dimensional model for executive scorecards, learning analytics, financial KPIs, churn cohort analysis.

**Why BigQuery at target-state, not V1:** building the warehouse before there's enough data and analytical demand to justify it is premature. BigQuery activates when: (a) sustained PostHog event volume approaches 500K events/month, OR (b) cross-source joins (PostHog events \+ Supabase user data \+ Stripe billing data) become operationally needed, OR (c) advanced analytics surfaces (churn cohort, mastery progression segmentation, multi-vertical analytics per FWD-07-02) require warehouse compute.

**Why BigQuery (not Snowflake / Redshift / ClickHouse):** founder GCP-consolidation preference; LISA orchestrator already on GCP (Cloud Run \+ Vertex AI per Doc 03C); BigQuery free tier (1 TB queries/month \+ 10 GB storage) covers significant target-state warehouse volume before paid spend; pay-per-query model matches Lyceon's burst analytical pattern (heavy weekly board-prep query bursts; light day-to-day).

**Cross-doc registration:** Same as PostHog — Doc 06E `infra/vendor-inventory.yaml` Tier-1 target-state vendor entry via W-07-PostHog-BQ. The Tier-1 target-state combination is novel — 06E V1 had no Tier-1 target-state vendors, all 8 Tier-1 vendors were launch-required. Doc 07's introduction of a Tier-1 target-state vendor extends 06E's Tier-1 classification convention; the 06E §5.5 tiering criteria update is part of the W-07-PostHog-BQ additive.

## **6.3 Tier-2 dev-only vendors introduced by Doc 07 (if any)**

V1 introduces no Tier-2 dev-only vendors. PostHog covers the product-analytics surface entirely at V1. dbt (analytics transformation tool) is a target-state V1.1+ candidate when BigQuery activates; if adopted, would be Tier-2 dev-only and registered at that time.

## **6.4 What this vendor lean does NOT include**

* **No separate dashboarding tool at V1.** PostHog dashboards cover operational minimum. Metabase / Looker Studio / Hex are V1.1+ candidates when warehouse-backed dashboards become a demand.  
* **No experimentation-management tool at V1 beyond PostHog.** PostHog feature flags \+ A/B test substrate is sufficient for V1.1+ activation; specialized tools (Statsig, Optimizely) are V2+ candidates.  
* **No data-catalog or lineage tool at V1.** Lineage is documented in 07B inline at V1; V1.1+ may adopt OpenMetadata or DataHub if scale justifies.

---

# **§7 — Family Invariants (INV-07-01..09)**

Family-wide invariants asserting properties that hold across all Doc 07 sub-docs. Each invariant names a proving mechanism per Parent §6.13 \+ carries `launch_required: bool` per 06E §4 convention.

| ID | Statement | launch\_required | Proving mechanism (in sub-doc) |
| ----- | ----- | ----- | ----- |
| **INV-07-01** | Every event Lyceon code emits at any tier (V1 strict, V1.1+ loose) is registered in `infra/event-schema-registry.yaml`. Strict-tier entries declare full property-level schema; loose-tier entries declare base required fields and defer full schema. **Schema tier governs entry rigor, NOT whether an entry is required** — unregistered production events are forbidden at every tier. | **true** | `ci/event-schema-registry-parity` (07A) — fails on any code-emitted event without a registry entry, regardless of tier; tier-specific completeness checks layered on top |
| **INV-07-02** | No event payload at any tier contains raw PII; user identifiers are **server-generated opaque user\_id only** (no email-derived, phone-derived, name-derived, or stable cross-system hash identifiers in analytics payloads — hashes only inside proof artifacts with proof-run-local salt per family-wide §8.7 / RB-06D-V1-10 rule); demographic fields are bucketed | **true** | `ci/pii-redaction-conformance` (07A \+ 07E joint) — fails on any registry entry without PII redaction declaration; fails on any registry entry declaring a forbidden identifier type (email-hash, phone-hash, name-hash, cross-system stable-hash); fails on any V1.1+ runtime event matching a forbidden-PII pattern |
| **INV-07-03** | Doc 07 declares an analytics retention policy registered in Doc 06D §9 retention registry | **true** | `ci/analytics-retention-policy-registered` (07E) — fails if Doc 06D §9 registry lacks an analytics-layer row resolving to Doc 07E |
| **INV-07-04** | Doc 07 declares a deletion-cascade target body for Doc 05D §10 layer 4 (analytics) | **true** | `ci/analytics-cascade-target-declared` (07E) — fails if Doc 05D §10 cascade lacks a resolvable Doc 07E layer-4 target |
| **INV-07-05** | Every KPI in `infra/kpi-registry.yaml` cites its canonical owning doc | **true** | `ci/kpi-canonical-owner-cite` (07B) — fails on any KPI entry without `canonical_owner_doc_and_section` resolving |
| **INV-07-06** | KPI definitions never restate primitive bodies owned by other docs (05B mastery formula, Doc 03 §24 LISA cost, 06E §7 vendor cost) | **true** | `ci/kpi-body-no-restate` (07B) \+ audit P27 — fails if any KPI body matches a restatable-primitive pattern |
| **INV-07-07** | Every Doc 07 mechanism declares `launch_required: bool`; every `launch_required: false` mechanism resolves to a V1.1+ trigger criterion | **true** | `ci/doc07-launch-required-annotation-coverage` (Parent) — extension of 06E P25 family-wide rule applied at Doc 07 scope |
| **INV-07-08** | PostHog event emission is live at V1; events are emitted from V1 application code per the registry contract | **true** | `ops/posthog-emission-conformance` (07A) — runtime health check that PostHog ingestion is receiving events from V1 application code. **At V1, `ops/posthog-emission-conformance` is a deploy-readiness proof \+ audit artifact only; it MUST NOT emit Page/Warn/Info alerts.** Failure modes at V1: (a) deploy-time: blocks deploy completion until manually resolved; (b) runtime: records a structured failure in the proof artifact stream; on-call rotation is NOT paged. V1.1+ activation: when Doc 07-class alerts activate per 06C §7 standard registration, this mechanism may add alert routing — at which point INV-07-09 relaxes by V1.1+ scope expansion per §4 family-level extension. |
| **INV-07-09** | No Doc 07 V1 mechanism produces an alert; Doc 07-class alerts register only when V1.1+ infrastructure activates | **true** (negative invariant) | `ci/doc07-v1-no-alerts` (Parent) — fails if any V1 Doc 07 mechanism declares an `alert_id`; V1.1+ relaxes this invariant when warehouse \+ dashboards add alerting needs. **Reconciliation with INV-07-08:** `ops/posthog-emission-conformance` (the only V1 runtime check) is explicitly non-alerting per its INV-07-08 entry above; INV-07-09 and INV-07-08 coexist consistently at V1. |

INV-07-09 is structurally distinct from prior family invariants (it's a *negative* invariant asserting absence). This is deliberate: Doc 07 V1's all-target-state framing means most mechanisms cannot fire alerts because they don't run; the negative invariant prevents accidental alert declarations that would have no rotation owner or runbook (06C §11 / §10 obligations would be unsatisfiable).

---

# **§8 — Cross-Doc Seam Table (Grounded by Exact §)**

| Seam | Doc 07 side | Canonical owner \+ exact § | Reconciliation status |
| ----- | ----- | ----- | ----- |
| Mastery KPI body math | KPI-LRN-01 / KPI-LRN-05 stub entries in `kpi-registry.yaml` | Doc 05B V1.0 §3-§5 — referenced via project memory per §3.5 | OPEN — bounded (W2); upload-on-receipt |
| LISA cost target/alert thresholds | KPI-OPS-03 / KPI-TUT-05 stub entries cite | Doc 03 Main V1.1 §24 — referenced via project handoff record per §3.4 | OPEN — bounded (W1); upload-on-receipt |
| LISA usage caps body | KPI-TUT-04 / KPI-TUT-05 stub entries cite | Doc 03 Main V1.1 §11 — referenced | OPEN — bounded (W1) |
| LISA retention matrix | 07E LISA-tutor retention cross-references cite | Doc 03 Main V1.1 §14.2 — referenced | OPEN — bounded (W1) |
| LISA tutor verification events (tutor\_helped / tutor\_failed) | KPI-TUT-02 / KPI-TUT-03 stub entries cite (V1 name-only, no deterministic body) | Doc 03 family — referenced; PDF-06 §4 | OPEN — bounded (W1) |
| Per-platform infra cost body | KPI-OPS-01 / KPI-OPS-02 stub entries cite | Doc 06E V1.0 §7/§8 — referenced; LOCKED 2026-05-22 | RESOLVED — consumer |
| Vendor inventory pattern (PostHog \+ BigQuery additions) | §6 vendor-choice narrative \+ sub-doc 07A/07B references | Doc 06E V1.0 §5 — **W-07-PostHog-BQ post-Doc-07-lock additive `RB-06E-V1-15` (PostHog Tier-1 launch-required) \+ `RB-06E-V1-16` (BigQuery Tier-1 target-state)** | OPEN — bounded (W3); 06E in-lock-cycle additive |
| Vendor cost-structure documentation pattern | PostHog \+ BigQuery subsections to add | Doc 06E V1.0 §7 — same additive | OPEN — bounded (W3) |
| Vendor pricing snapshot registry | PostHog \+ BigQuery pricing snapshot entries to add | Doc 06E V1.0 §13 — same additive | OPEN — bounded (W3) |
| Vendor outage runbook shape | PostHog \+ BigQuery outage runbook stubs to add | Doc 06E V1.0 §6.2 / §6.3 — same additive | OPEN — bounded (W3) |
| Launch-vs-target annotation convention | §4 family-level extension | Doc 06E V1.0 §4 — referenced; adopted natively | RESOLVED — consumer \+ family-level extension |
| Platform stack inventory | §6 PostHog \+ BigQuery additions | Doc 06A V1.0 §3 — referenced via 06E §5 extension | OPEN — bounded (W3) |
| Environment matrix | sub-doc 07A/E PostHog environment configuration cites | Doc 06A V1.0 §7 — referenced | RESOLVED — consumer |
| Alert routing tiers \+ severity crosswalk | INV-07-09 negative invariant (no V1 alerts) | Doc 01A §18 via Doc 06C §6 — referenced | RESOLVED — inherited-but-unused at V1 |
| Alert-registry schema (when V1.1+ adds alerts) | V1.1+ extension via standard mechanism | Doc 06C V1.0 §7 — referenced | RESOLVED — V1.1+ extension path |
| Scheduled-job heartbeat substrate (when V1.1+ adds ingestion jobs) | V1.1+ warehouse ingestion job registration | Doc 06C V1.0 §8 (`infra/scheduled-job-registry.yaml`) — referenced | RESOLVED — V1.1+ extension path |
| Incident lifecycle base (when V1.1+ Doc 07-class incidents arise) | V1.1+ registration via standard mechanism | Doc 06C V1.0 §10 — referenced | RESOLVED — V1.1+ extension path |
| Privacy-incident sub-class (Doc 07 surfaces are privacy-incident producers) | 07A \+ 07E PII redaction failure → privacy-incident path | Doc 06D V1.0 §11 — referenced | RESOLVED — consumer |
| Retention policy registry substrate | 07E retention policy declaration | Doc 06D V1.0 §9 — referenced; INV-07-03 SPEC\_CONTRACT\_GATE | RESOLVED — body delivered in 07E |
| Deletion-cascade base orchestration | 07E layer-4 cascade target body | Doc 05D V1.0 §10 — referenced; INV-07-04 SPEC\_CONTRACT\_GATE | OPEN — bounded (W2 upload-on-receipt); body deliverable in 07E |
| Financial unit economics body | KPI-BIZ-03 / KPI-BIZ-04 stub entries cite | Doc 09 — **FWD-07-01** sanctioned bounded forward-ref | OPEN — bounded |
| Multi-vertical analytical model body | 07A event-taxonomy V1 covers single-vertical SAT; Doc 08 owns multi-vertical | Doc 08 — **FWD-07-02** sanctioned bounded forward-ref | OPEN — bounded |
| Brand / social-proof analytics body | Future Doc 07 sub-doc or Doc 10 reference | Doc 10 — **FWD-07-03** sanctioned bounded forward-ref | OPEN — bounded |
| §10.5 envelope schema | Per-sub-doc envelope extras matrix | Doc 06 Parent §10.5 / 06A §10.5.1 — referenced | RESOLVED — extended per sub-doc |
| Compliance-gate registry pattern | Design precedent only (no Doc 07 compliance gates V1) | Doc 06D V1.0 §10 — design-precedent reference | RESOLVED — design-reference only |

---

# **§9 — Audit Profile (30 Passes — 25 Carry-Forward \+ 5 New)**

Inherits Parent §17 six passes \+ 06A-specific passes (03C-boundary, registry-schema-completeness) \+ 06B-specific passes (primitive-body-restatement detection, audit-substrate exhaustiveness) \+ 06C-specific passes P13-P18 (self-monitoring watchdog, schema-completeness, registry-canonical, state-machine RPC, text-FK validated write path, external-fetch failure semantics) \+ 06D-specific passes P19-P22 (retention-coverage exhaustiveness, compliance-gate registry parity, deletion-cascade reference exhaustiveness, no-PII proof-artifact conformance) \+ 06E-specific passes P23-P25 (vendor-tier exhaustiveness, pricing-snapshot-registry parity, launch-required-annotation coverage). Plus five Doc-07-specific passes added in this Parent:

* **P26 — Event-schema-registry parity.** Every code-emitted event from V1 application code has a registered structure in `infra/event-schema-registry.yaml`; every registry entry has the required fields (event\_name, schema\_tier, owner, pii\_redaction\_declaration, retention\_class, V1\_active\_flag). Strict tier entries have full property-level schema; loose tier entries have required base fields only — **but unregistered production events are forbidden at every tier**. Implemented in 07A.  
* **P27 — KPI canonical-owner-citation parity.** Every entry in `infra/kpi-registry.yaml` has a non-empty `canonical_owner_doc_and_section` that resolves to either Doc 07 itself OR a referenced canonical owner doc (Doc 05B, Doc 03 Main, Doc 06E, Doc 09 via FWD-07-01, etc). No KPI body restates a primitive owned by another doc (cross-checked against Doc 05B mastery formula tokens \+ Doc 03 §24 cost-tier tokens \+ Doc 06E §7 vendor-cost-rate tokens). Implemented in 07B.  
* **P28 — PII-redaction-contract conformance.** Every entry in `infra/event-schema-registry.yaml` declares a PII redaction posture; no entry declares a forbidden raw-PII field type (canonical forbidden list: raw email, raw name, raw phone, raw free-text answer content, raw home address). Loose-tier entries are still subject to this check (per Q-07-1=a). Implemented in 07A \+ 07E joint.  
* **P29 — Retention-policy-declaration cross-ref to Doc 06D §9.** Doc 07E's retention policy declaration is parseable from 07E and matches a Doc 06D §9 retention registry row (when 06D is uploaded or via project-handoff cite-path). The cross-reference is bidirectional: 06D §9 must point at 07E; 07E must declare what 06D §9 expects. Implemented in 07E.  
* **P30 — Deletion-cascade-target cross-ref to Doc 05D §10.** Doc 07E's layer-4 (analytics) cascade target body is parseable from 07E and matches a Doc 05D §10 cascade-layer-4 entry (when 05D is uploaded or via project-memory cite-path). Bidirectional cross-reference. Implemented in 07E.

**Carry-forward baseline becomes 30 passes** for Doc 08, Doc 09, Doc 10 audits.

Known false-positive class (carry-over \+ Doc-07-specific): doc titles containing flagged words; the §8 cross-doc seam table (cites bodies — required, not restatement); the §17 cleanup register's SWE review-severity vocabulary (`BLOCKER` / `HIGH` / `MEDIUM`); the §6 vendor-name vocabulary (`PostHog` / `BigQuery` / `Metabase` etc. are vendor identifiers, not primitive-body restatements); KPI roster entries in §10 are the canonical roster (P27 enforces owner cite, not restatement); the launch\_required `false` annotations in §11+ are intentional per §4 family-level framing.

---

# **§10 — Canonical KPI Roster (34 KPIs, 6 Bodied \+ 28 Stub)**

Per Q-07-3=β with γ depth: comprehensive set named, only the critical ones bodied. The full roster is registered in `infra/kpi-registry.yaml` (per 07B body); summarized here at the Parent level for cross-doc reference. **Tutor\_helped\_rate (KPI-TUT-02) demoted to name-only stub** per Karl decision (no deterministic measurement at V1; reserved name for V1.1+ activation when Doc 03 family develops a non-attribution-biased measurement OR a learned attribution model is built).

## **10.1 Engagement & Retention KPIs (10 total; 3 bodied)**

| KPI ID | Name | V1 status | Canonical owner |
| ----- | ----- | ----- | ----- |
| KPI-ENG-01 | `daily_active_users` | **bodied V1** | 07B |
| KPI-ENG-02 | `weekly_active_users` | stub | 07B |
| KPI-ENG-03 | `monthly_active_users` | **bodied V1** | 07B |
| KPI-ENG-04 | `d1_retention_rate` | stub | 07B |
| KPI-ENG-05 | `d7_retention_rate` | stub | 07B |
| KPI-ENG-06 | `d30_retention_rate` | **bodied V1** | 07B |
| KPI-ENG-07 | `cohort_retention_curve` | stub | 07B |
| KPI-ENG-08 | `session_count_per_active_user` | stub | 07B |
| KPI-ENG-09 | `session_duration_median` | stub | 07B |
| KPI-ENG-10 | `stickiness_ratio` | stub | 07B |

## **10.2 Learning Analytics KPIs (6 total; 1 bodied)**

| KPI ID | Name | V1 status | Canonical owner |
| ----- | ----- | ----- | ----- |
| KPI-LRN-01 | `mastery_level_distribution` | stub | 07B refs **Doc 05B §3-§5** |
| KPI-LRN-02 | `exam_completion_rate` | **bodied V1** | 07B refs Doc 04 family |
| KPI-LRN-03 | `exam_score_distribution` | stub | 07B refs Doc 04B |
| KPI-LRN-04 | `practice_question_velocity` | stub | 07B refs Doc 02B |
| KPI-LRN-05 | `mastery_progression_velocity` | stub | 07B refs **Doc 05B** |
| KPI-LRN-06 | `diagnostic_completion_rate` | stub | 07B refs Doc 04 |

## **10.3 Tutor Analytics KPIs (5 total; 0 bodied)**

| KPI ID | Name | V1 status | Canonical owner |
| ----- | ----- | ----- | ----- |
| KPI-TUT-01 | `tutor_engagement_rate` | stub | 07B refs **Doc 03 Main** |
| KPI-TUT-02 | `tutor_helped_rate` | **stub (no V1 body — non-deterministic measurement)** | 07B refs Doc 03 family / PDF-06 §4 |
| KPI-TUT-03 | `tutor_failed_rate` | stub | 07B refs Doc 03 family |
| KPI-TUT-04 | `tutor_queries_per_active_student` | stub | 07B refs **Doc 03 Main §11** |
| KPI-TUT-05 | `tutor_cap_proximity_rate` | stub | 07B refs **Doc 03 Main §11/§24** |

## **10.4 Business / Subscription KPIs (8 total; 2 bodied)**

| KPI ID | Name | V1 status | Canonical owner |
| ----- | ----- | ----- | ----- |
| KPI-BIZ-01 | `subscription_conversion_rate` | **bodied V1** | 07B |
| KPI-BIZ-02 | `paid_subscriber_count` | **bodied V1** | 07B |
| KPI-BIZ-03 | `churn_rate_monthly` | stub | 07B refs **Doc 09 (FWD-07-01)** |
| KPI-BIZ-04 | `revenue_per_paying_user` | stub | 07B refs Doc 09 |
| KPI-BIZ-05 | `funnel_landing_to_signup_rate` | stub | 07B |
| KPI-BIZ-06 | `funnel_signup_to_first_session_rate` | stub | 07B |
| KPI-BIZ-07 | `funnel_first_session_to_trial_rate` | stub | 07B |
| KPI-BIZ-08 | `funnel_trial_to_paid_rate` | stub | 07B (cross-ref KPI-BIZ-01) |

## **10.5 Operational / Cost KPIs (5 total; 0 bodied)**

| KPI ID | Name | V1 status | Canonical owner |
| ----- | ----- | ----- | ----- |
| KPI-OPS-01 | `cost_per_mau` | stub | 07B refs **Doc 06E §8** |
| KPI-OPS-02 | `cost_per_paying_subscriber` | stub | 07B refs Doc 06E §8 |
| KPI-OPS-03 | `lisa_cost_per_active_student` | stub | 07B refs **Doc 03 Main §24** |
| KPI-OPS-04 | `support_ticket_rate_per_mau` | stub | 07B |
| KPI-OPS-05 | `error_rate_per_session` | stub | 07B refs Doc 06C |

**Total: 34 KPIs across 5 categories. 6 bodied at V1 (DAU, MAU, D30 retention, exam-completion-rate, subscription conversion, paid subscriber count). 28 name-only stubs with locked canonical names and canonical-owner citations.**

## **10.6 KPI-TUT-02 rationale (non-deterministic-measurement carve-out)**

`tutor_helped_rate` is name-only stub at V1 because measurement is non-trivial — it requires inferring causal contribution of LISA interactions to downstream learning outcomes. Counting LISA messages is easy; counting LISA's *contribution* requires either (a) explicit student feedback that introduces selection bias, (b) A/B comparison against students who didn't engage LISA (selection bias the other way), or (c) a learned attribution model that is V2+ territory. Per Doc 03 V1.1 §0.6 referenced from project memory, similar attribution questions are explicitly deferred. The name is reserved so that when someone (Doc 03 V2? Doc 07 V1.1?) develops a deterministic measurement, the canonical name slot is already there to body into. V1.1 implementers should not body `tutor_helped_rate` with a non-deterministic measurement.

---

# **§11 — Open Items & Watch List**

| ID | Item | Status / handling |
| ----- | ----- | ----- |
| **W1** | Doc 03 Main §11/§14.2/§24 not in source tree (§3.4 cite-path; carried family-wide from 06C/06D/06E) | Bounded; reconciliation triggers on upload. Non-blocking. |
| **W2** | Doc 05 family (05B \+ 05D) not in source tree (§3.5 cite-path) | Bounded; reconciliation triggers on upload. Non-blocking. |
| **W3** | **W-07-PostHog-BQ — Cross-doc additive owed to Doc 06E** — bundled `RB-06E-V1-15` (PostHog Tier-1 launch-required, full registration: inventory \+ outage runbook stub \+ §7 cost-structure subsection \+ §13 pricing snapshot) \+ `RB-06E-V1-16` (BigQuery Tier-1 target-state, same full registration). Applied as single in-lock-cycle cleanup pass on Doc 06E after all Doc 07 sub-docs LOCK. Includes 06E §5.5 tiering-criteria update to recognize Tier-1 target-state classification (Doc 07's introduction is novel; 06E V1 had no Tier-1 target-state vendors). | Bounded; non-blocking for Doc 07 spec lock. Doc 07 sub-docs spec-lock with W3 obligation explicitly declared. |
| **W4** | FWD-07-01 (Doc 09 financial unit economics) — boundary established; resolves when Doc 09 drafts | Bounded; carries SPEC\_CONTRACT\_GATE on Doc 07 ↔ Doc 09 boundary clarification. |
| **W5** | FWD-07-02 (Doc 08 multi-vertical analytical model) — 07A event-schema-registry V1 covers single-vertical SAT only | Bounded; resolves when Doc 08 drafts. |
| **W6** | FWD-07-03 (Doc 10 brand / social-proof analytics) — surface-only forward-ref | Bounded; resolves when Doc 10 drafts. |
| **W7** | **Internal-only-at-V1 assumption (Q-07-5=b)** — Doc 07 V1 consumers are internal team only; V1.1+ scope expansion to external consumers (board reporting via dashboard exports, parent-facing surfaces, regulator reporting, school admin) requires re-evaluation of privacy posture and access controls. | Bounded; not blocking V1. Triggered at first V1.1+ external-consumer-add discussion. |
| **W8** | **PostHog as V1 substrate, BigQuery as target-state warehouse** — migration path from PostHog-only to PostHog \+ BigQuery requires explicit V1.1+ migration plan (data export contract, dual-write transition, query-cutover sequencing). | Bounded; resolves at first BigQuery-activation discussion. 07B Warehouse Models V1 spec assumes BigQuery target architecture from V1 even though build is target-state. |
| **W9** | **Stack-consolidation lean GCP** — long-term direction is to consolidate toward GCP-native tools; PostHog is a stack-divergence acknowledged for V1 velocity reasons. Future Doc 07 V1.1+ may evaluate Looker Studio \+ custom event ingestion as a PostHog replacement. | Bounded; non-blocking. Re-evaluation trigger: PostHog cost approaches BigQuery \+ Looker Studio combined cost at scale (estimate: \~5M events/month). |

None of W1-W9 block Doc 07 Parent spec lock. W1-W2 carry forward family-wide upload-on-receipt patterns. W3 is the new bundled cross-doc additive obligation. W4-W6 are the three sanctioned bounded forward-refs declared by Doc 07\. W7-W9 are Doc 07 V1.1+ scope-expansion watch items.

---

# **§12 — Acceptance Criteria (Executable-Proof Framed)**

Per the family A/B/C split (A \= 07-owned criteria, B \= cross-doc gate-body criteria, C \= audit closure). All mechanisms carry `launch_required` annotations per §4 family-level extension of 06E §4.

## **A — 07-owned criteria (Parent \+ family-wide)**

1. INV-07-01 (event schema registry parity) holds via `ci/event-schema-registry-parity` (07A). **launch\_required: true.**  
2. INV-07-02 (PII redaction always-strict) holds via `ci/pii-redaction-conformance` (07A \+ 07E joint). **launch\_required: true.**  
3. INV-07-03 (analytics retention policy registered with Doc 06D §9) holds via `ci/analytics-retention-policy-registered` (07E). **launch\_required: true.**  
4. INV-07-04 (cascade target declared for Doc 05D §10 layer 4\) holds via `ci/analytics-cascade-target-declared` (07E). **launch\_required: true.**  
5. INV-07-05 (KPI canonical-owner citation) holds via `ci/kpi-canonical-owner-cite` (07B). **launch\_required: true.**  
6. INV-07-06 (KPI bodies don't restate primitive bodies) holds via `ci/kpi-body-no-restate` (07B) \+ audit P27. **launch\_required: true.**  
7. INV-07-07 (launch\_required annotation coverage in Doc 07\) holds via `ci/doc07-launch-required-annotation-coverage` (Parent). **launch\_required: true.**  
8. INV-07-08 (PostHog event emission live) holds via `ops/posthog-emission-conformance` (07A). **launch\_required: true.**  
9. INV-07-09 (Doc 07 V1 emits no alerts) holds via `ci/doc07-v1-no-alerts` (Parent). **launch\_required: true.**

## **B — Cross-doc gate-body criteria (Doc 07 obligations to other families)**

10. **FWD-06-01 obligation resolved** — Doc 06D §9 analytics-layer retention registry row resolves to Doc 07E retention policy declaration. SPEC\_CONTRACT\_GATE; 06D deploys retention conformance against Doc 07E spec lock.  
11. **Doc 05D §10 layer-4 (analytics) cascade target body** — Doc 07E delivers the cascade target body resolution. SPEC\_CONTRACT\_GATE; 05D deploys cascade orchestration against Doc 07E spec lock.  
12. **Doc 06E vendor inventory extension obligation** — W3 / W-07-PostHog-BQ cross-doc additive lands after Doc 07 family LOCK as bundled `RB-06E-V1-15/16`. Doc 07 V1 acceptance includes the declaration of this obligation; the application is at 06E's end. Bundled cross-doc additive precedent from RB-06C-V1-16 / RB-06D-V1-\* patterns.

## **C — Audit closure**

13. The §9 audit suite (30 passes) reports zero defects of class `DD-07-PROOF`, `DD-07-REDEF`, `DD-07-SEAM`, `DD-07-FWD`, `DD-07-PII`; zero LISA-body-restatement defects (P12 / P27); zero 05B-mastery-body-restatement defects (P27); zero Doc-06E-body-restatement defects (P27); citation-parity reports either resolved-anchor or `cited_per_project_handoff_record` / `cited_per_project_memory` for every cross-doc citation; P26 (event-schema-registry parity) passes; P27 (KPI canonical-owner cite) passes; P28 (PII redaction conformance) passes; P29 (retention policy cross-ref to 06D §9) passes; P30 (cascade target cross-ref to 05D §10) passes.

14. **W3 / W-07-PostHog-BQ deploy gate.** Doc 07 sub-doc deploys (07A PostHog emission contract; 07B BigQuery warehouse model targeting; 07E retention/cascade body referencing PostHog substrate at V1) are gated on 06E in-lock-cycle additive `RB-06E-V1-15/16` landing. **This is a deploy gate, not a spec-lock gate** — Doc 07 family locks with the obligation explicitly declared (W3); 06E additive closure is coordinated cross-doc cleanup tracked at both ends. **Sequencing clarification (RB-07-Parent-V1-06):** 07A may spec-lock before W-07-PostHog-BQ lands, but **07A deploy-proof for PostHog emission MUST be blocked until `RB-06E-V1-15/16` is applied to Doc 06E**. The rationale is concrete: PostHog's Tier-1 vendor registration (06E §5), outage runbook (06E §6.3), cost-structure documentation (06E §7), pricing snapshot (06E §13), and substrate-cap configuration (06E §10) are the canonical owners of vendor-side operational discipline. 07A's `ops/posthog-emission-conformance` mechanism cannot satisfy its Parent §6.13 six-element implemented-definition (specifically, the "operational ownership" element which traces back through the 06C alert/incident substrate to a vendor in 06E's inventory) until PostHog exists as a registered vendor in 06E. Spec lock can proceed in parallel; deploy-proof cannot. Same gating applies to 07B BigQuery-targeted warehouse-model deploy-proof when V1.1+ BigQuery activation occurs.

Per Parent §6.13, each mechanism above is **specified, not deploy-proven**, until its owning artifact (CI job, scheduled job, manifest, registry) supplies all six §6.13 elements. Per §4 family-level framing of Doc 07, deploy-proof for `launch_required: false` mechanisms arrives at V1.1+ activation per stated trigger criteria.

---

# **§13 — Drafting & Lock Conventions**

Inherits Parent §8 verbatim: tool-neutral workflow (primary drafting agent → independent SWE review → in-lock-cycle `RB-<DOC>-V1-NN` cleanup → current audit suite run twice — 30 passes total for Doc 07 family: P1-P12 base \+ P13-P18 from 06C \+ P19-P22 from 06D \+ P23-P25 from 06E \+ P26-P30 new for Doc 07); `.bak` / `.bak2` before each pass; draft-for-lock cleanup keeps `DRAFT` and transitions once to `LOCKED` on clean re-audit; post-lock in-lock-cycle cleanup keeps `LOCKED`, version and lock date unchanged.

---

# **§14 — Change Records**

**CR-07-Parent-01** — Doc 07 Parent V1.0 established. Scope per canonical document map (Doc 07 — Metrics, Warehousing, Analytics & Decision Systems): event taxonomy \+ tracking standards \+ product/funnel/learning/tutor analytics \+ warehouse models \+ dashboards \+ experimentation metrics \+ executive scorecards \+ churn predictors \+ cohort retention; five-sub-doc decomposition (07A Event Schema \+ 07E Retention/Privacy/Cascade \+ 07B Warehouse Models \+ 07C Dashboards \+ 07D Experimentation Analytics per Q-07-6=β drafting order); spec-locked-infrastructure-target-state family framing (§4 — extends 06E §4 launch-vs-target convention at family scope); canonical 34-KPI roster locked (6 bodied at V1, 28 name-only stubs per Q-07-3=β-with-γ-depth); strict-tier-for-V1-named-events \+ loose-tier-for-future \+ always-strict-PII-redaction-contract (Q-07-1=a); zero raw PII in event payloads, opaque user\_id \+ bucketed demographics only (Q-07-3-confirmation-3=a); internal-only consumers at V1 (Q-07-5=b); PostHog \+ BigQuery stack (Q-07-2=β); three sanctioned bounded forward-refs (FWD-07-01 Doc 09 financial unit economics; FWD-07-02 Doc 08 multi-vertical; FWD-07-03 Doc 10 brand); five new audit passes P26-P30 extending suite to 30 passes carry-forward baseline; W-07-PostHog-BQ cross-doc additive obligation to Doc 06E (post-Doc-07-LOCK bundled `RB-06E-V1-15/16` adding PostHog Tier-1 launch-required \+ BigQuery Tier-1 target-state with full 06E §5/§6/§7/§13 registration). Nine family invariants INV-07-01..09 declared (including INV-07-09 negative invariant on V1 alert absence). SPEC\_CONTRACT\_GATE class introduced for spec-locked-but-infrastructure-target-state deploy gates (distinct from BLOCKING\_UPSTREAM\_GAP / BLOCKING\_PRIVACY\_GAP / SPEC\_LOCK\_GATE). KPI-TUT-02 (`tutor_helped_rate`) demoted from initially-proposed-bodied to name-only stub per Karl decision (no deterministic measurement at V1; reserved name for V1.1+ activation).

**CR-07-Parent-02** — Pre-draft alignment: Doc 06A §3/§7 platform stack inventory \+ environment matrix consumed; Doc 06C §6/§7/§8/§10/§11 substrate consumed (severity crosswalk, alert-registry pattern, scheduled-job heartbeat substrate, incident lifecycle, unified rotation — all inherited-but-unused at V1 per INV-07-09 negative invariant); Doc 06D §9 retention policy registry consumed (Doc 07E will register analytics-layer entries) \+ §11 privacy-incident sub-class consumed (Doc 07 surfaces are privacy-incident producers); Doc 06E §4 launch-vs-target convention adopted natively and extended to family level \+ §5 vendor inventory pattern extended via W3 \+ §7 cost-structure documentation pattern extended via W3 \+ §13 pricing snapshot registry pattern extended via W3; Doc 03 Main §11/§14.2/§24 cited per project handoff record (§3.4 cite-path, continued from 06C/06D/06E); Doc 05D §10 \+ Doc 05B §3-§5 cited per project memory (§3.5 cite-path); 01A §3 referenced for `infra/event-schema-registry.yaml` and `infra/kpi-registry.yaml` config-doctrine registration.

**CR-07-Parent-03** — Pre-draft Q\&A locked: **Q-07-1 \= (a)** strict schema for V1-named events \+ loose schema for future \+ always-strict PII redaction contract regardless of schema tier; **Q-07-2 \= (α)** single `infra/kpi-registry.yaml` registry covering all KPIs with canonical-owner-cite per entry \+ CI parity check; **Q-07-3 \= (β) with (γ) depth** comprehensive 34-KPI set named at V1, 6 critical KPIs bodied, 28 name-only stubs with V1.1+ activation triggers; **Q-07-4 \= (α)** all three forward-refs declared: FWD-07-01 Doc 09 \+ FWD-07-02 Doc 08 \+ FWD-07-03 Doc 10; **Q-07-5 \= (β)** five new audit passes P26-P30; **Q-07-6 \= (β)** launch-required-first drafting order (Parent → 07A → 07E → 07B → 07C → 07D). Pre-draft sub-questions: scope (Decision 1 \= β five sub-docs; Decision 2 \= β BigQuery \+ PostHog stack; Decision 3 \= "all of these and Doc 07 is not a launch blocker for the MVP. this is all target state"); KPI roster completeness confirmed at 34 across 5 categories (no additions); KPI-TUT-02 (`tutor_helped_rate`) demoted to name-only stub (no V1 deterministic measurement); analytics scope \= operational \+ learning \+ business \+ admin/internal (mastery KPI for user-side stays in 05B per canonical split); Delaware C-corp practices noted as Doc 09 input (referenced from Doc 09 when drafted); stack-consolidation lean GCP acknowledged (W9 watch item — BigQuery target-state aligns with consolidation strategy); experimentation framework V1.1+ target-state per all-target-state framing; tutor\_helped attribution problem documented in §10.6 with rationale-for-reservation.

**CR-07-Parent-04** — In-lock-cycle draft-for-lock cleanup applying SWE R1 (2 BLOCKER \+ 4 HIGH; all accepted without pushback). Per §13 convention, draft-for-lock cleanup transitions DRAFT → LOCKED on clean re-audit; status transitioned DRAFT → LOCKED 2026-05-23 on clean two-pass re-audit; subsequent in-lock-cycle cleanup (if any) holds the 2026-05-23 lock date per Parent §8 multi-round precedent (06D / 06E pattern). External claim verification: SWE R1 confirmed PostHog 1M-events/month free tier \+ PostHog→BigQuery batch export \+ BigQuery 1 TiB/month free query processing \+ 10 GB free storage \+ PostHog persons deletion API — no external vendor/tool claims invalid. Six reviewer-bound register entries tagged RB-07-Parent-V1-01..06: **(B1 / RB-07-Parent-V1-01)** §1 line 20 KPI count mismatch — had "27 are name-only stubs" while §10 \+ summary statements correctly say 28; corrected §1 line 20 to "28 are name-only stubs"; B1 was the last surviving stale "27" reference from initial drafting (other sweeps caught the rest); §10 per-category counts confirmed: ENG 10 (3 bodied) \+ LRN 6 (1 bodied) \+ TUT 5 (0 bodied) \+ BIZ 8 (2 bodied) \+ OPS 5 (0 bodied) \= 34 total / 6 bodied / 28 stubs. **(B2 / RB-07-Parent-V1-02)** §1 stale section reference — "carried in §17 acceptance criteria" was a stale cross-reference (Parent acceptance criteria are §12); corrected to "carried in §12 acceptance criteria"; this matters because Doc 07's SPEC\_CONTRACT\_GATE machinery relies on exact-§ resolution; B2 surfaces a new audit-pass-class candidate `internal-section-reference-resolution` (deferred to post-cycle since adding mid-cycle would change the 30-pass baseline). **(H3 / RB-07-Parent-V1-03)** INV-07-08 (PostHog emission conformance) tension with INV-07-09 (no V1 alerts) resolved by explicit non-alerting failure-mode specification — V1 failure modes for `ops/posthog-emission-conformance`: (a) deploy-time blocks deploy completion until manually resolved; (b) runtime records structured failure in proof artifact stream; on-call rotation is NOT paged; INV-07-09 entry gained a reconciliation paragraph naming `ops/posthog-emission-conformance` as the only V1 runtime check and confirming it is explicitly non-alerting; V1.1+ activation path defined (when Doc 07-class alerts register via 06C §7 standard, this mechanism may add alert routing and INV-07-09 relaxes per §4 family-level scope expansion). **(H4 / RB-07-Parent-V1-04)** "opaque/hashed user\_id" identifier language tightened to "server-generated opaque user\_id only" at three locations: INV-07-02 table entry (added forbidden-identifier-types list: email-hash, phone-hash, name-hash, cross-system stable-hash; CI conformance check fails on registry entries declaring forbidden types), §1 deliverable \#3 (wording aligned), §3 threat \#3 defense (wording aligned \+ added sentence "Stable cross-system hash identifiers (e.g., hashed email) are also a re-identification vector and equally forbidden"); rationale: hashes of email/phone/name remain re-identifiable especially if unsalted or stable across systems; the stronger standard is server-generated opaque identifiers with hashes confined to proof artifacts using proof-run-local salt (per family-wide §8.7 / RB-06D-V1-10). **(H5 / RB-07-Parent-V1-05)** Loose-schema future-event production-emission loophole closed at four locations: §1 deliverable \#1 (added "Loose schema means the event has a registry entry with base required fields but does not yet require full property-level schema. It does NOT mean unregistered production events are allowed"), §3 threat \#2 defense (same clarification), INV-07-01 table entry (strengthened to require every event at every tier — V1 strict, V1.1+ loose — to have a registry entry; schema tier governs entry rigor, NOT whether entry exists), P26 description (aligned with strengthened invariant — "unregistered production events are forbidden at every tier"); reviewer-correct on the loophole risk (V1.1+ code teams could otherwise emit unregistered events justified by "we're using loose schema"). **(H6 / RB-07-Parent-V1-06)** §12 acceptance criterion \#14 (W3 / W-07-PostHog-BQ deploy gate) tightened with explicit 07A deploy-proof sequencing rule — 07A may spec-lock before W-07-PostHog-BQ lands, but 07A deploy-proof for PostHog emission MUST be blocked until `RB-06E-V1-15/16` is applied to Doc 06E; rationale spelled out: PostHog's Tier-1 vendor registration / outage runbook / cost-structure / pricing snapshot / substrate-cap are the canonical owners of vendor-side operational discipline, and 07A's `ops/posthog-emission-conformance` cannot satisfy its Parent §6.13 six-element implemented-definition (specifically the operational-ownership element which traces through 06C alert/incident substrate to a vendor in 06E inventory) until PostHog exists in 06E; same gating applies to 07B BigQuery-targeted deploy-proof when V1.1+ activation occurs. Two-pass audit re-run after edits; both passes clean across all 30 passes (P1-P12 base \+ P13-P18 from 06C \+ P19-P22 from 06D \+ P23-P25 from 06E \+ P26-P30 new for Doc 07). No external claim verification required — all six findings were internal consistency / clarification defects.

---

# **§15 — Cleanup Register (RB-07-Parent-V1-NN)**

Structure established; populated during the in-lock-cycle external-review cleanup pass.

| Tag | Severity | Source | Resolution |
| ----- | ----- | ----- | ----- |
| RB-07-Parent-V1-01 | BLOCKER | SWE R1 / B1 | KPI count mismatch fixed — §1 line 20 had stale "27 are name-only stubs" while §10 \+ summary statements correctly say 28; corrected to "28 are name-only stubs". §10 per-category counts confirmed: 10 \+ 6 \+ 5 \+ 8 \+ 5 \= 34; 6 bodied (ENG 3 \+ LRN 1 \+ TUT 0 \+ BIZ 2 \+ OPS 0\) \+ 28 stubs \= 34\. |
| RB-07-Parent-V1-02 | BLOCKER | SWE R1 / B2 | Section-cross-reference fixed — §1 said "carried in §17 acceptance criteria" but Parent acceptance criteria are §12; corrected. Important because SPEC\_CONTRACT\_GATE machinery relies on exact-§ resolution. Surfaces new audit-pass-class candidate (`internal-section-reference-resolution`) deferred to post-cycle to preserve 30-pass baseline. |
| RB-07-Parent-V1-03 | HIGH | SWE R1 / H3 | INV-07-08 / INV-07-09 tension resolved — `ops/posthog-emission-conformance` failure mode at V1 explicitly non-alerting: (a) deploy-time blocks deploy; (b) runtime records structured failure in proof artifact stream; on-call NOT paged. INV-07-09 entry gained reconciliation paragraph. V1.1+ activation path defined. |
| RB-07-Parent-V1-04 | HIGH | SWE R1 / H4 | Identifier language tightened — "opaque/hashed user\_id" → "server-generated opaque user\_id only" at three locations (INV-07-02 table \+ §1 deliverable \#3 \+ §3 threat \#3 defense); forbidden-identifier-types list added (email-hash, phone-hash, name-hash, cross-system stable-hash); rationale: stable cross-system hashes remain re-identifiable. |
| RB-07-Parent-V1-05 | HIGH | SWE R1 / H5 | Loose-schema future-event production-emission loophole closed at four locations (§1 deliverable \#1 \+ §3 threat \#2 \+ INV-07-01 table \+ P26 description); reframed: loose schema \= loose fields (registry entry still required), NOT permission to emit unregistered events. INV-07-01 strengthened to make registry-entry universality explicit at every tier. |
| RB-07-Parent-V1-06 | HIGH | SWE R1 / H6 | §12 acceptance criterion \#14 tightened — 07A may spec-lock before W-07-PostHog-BQ lands, but 07A deploy-proof for PostHog emission MUST be blocked until `RB-06E-V1-15/16` is applied; rationale spelled out (PostHog's vendor registration / outage runbook / cost-structure / pricing snapshot / substrate-cap are the canonical owners of vendor-side operational discipline; 07A's `ops/posthog-emission-conformance` can't satisfy its Parent §6.13 six-element implemented-definition operational-ownership element until PostHog exists in 06E). Same gating applies to 07B BigQuery-targeted deploy-proof at V1.1+ activation. |

**Convention:** `.bak` / `.bak2` before each pass; resolved items tagged `RB-07-Parent-V1-NN`; §14 change-record row appended per pass; draft-for-lock pass transitions status `DRAFT` → `LOCKED`; post-lock passes (multi-round in-lock-cycle precedent from Doc 04C / 05D / 06D / 06E) leave status / version / lock-date unchanged (Parent §8).

---

# **§16 — Closing**

Doc 07 Parent V1.0 establishes the family's structural framing — five sub-docs in launch-required-first drafting order, spec-locked-infrastructure-target-state family-level framing (the most target-state-leaning family to date), nine family invariants including a novel negative invariant (INV-07-09 no V1 alerts), three sanctioned bounded forward-refs, the W-07-PostHog-BQ bundled cross-doc additive obligation to 06E, and the canonical 34-KPI roster with 6-bodied / 28-stub split. The audit suite extends to 30 passes (P26-P30 new) and becomes the carry-forward baseline for Doc 08/09/10. The SPEC\_CONTRACT\_GATE deploy-gate class is introduced to handle the case where downstream consumers (Doc 06D §9, Doc 05D §10) deploy against Doc 07 spec lock rather than against Doc 07 infrastructure availability. Decision 5 holds end-to-end: mastery KPI bodies stay canonical to 05B; LISA cost/cap bodies stay canonical to Doc 03; per-platform infra cost bodies stay canonical to 06E; financial unit economics bodies stay canonical to Doc 09 (FWD-07-01); Doc 07 adds the technical analytical surface layer that measures \+ the V1 launch-required minimum (event emission \+ PII contract \+ retention declaration \+ cascade target \+ KPI registry) without restating any primitive body. Drafting order proceeds: 07A (Event Schema) next, then 07E (Retention/Privacy/Cascade), then 07B (Warehouse Models), then 07C (Dashboards), then 07D (Experimentation Analytics). Family lock pending all five sub-doc locks \+ the bundled cross-doc additive `RB-06E-V1-15/16` (W-07-PostHog-BQ).

*End of Doc 07 Parent V1.0 (LOCKED 2026-05-23 after CR-07-Parent-04 in-lock-cycle draft-for-lock cleanup applying SWE R1's 2 BLOCKER \+ 4 HIGH findings; all accepted without pushback). Sub-doc drafting begins with 07A Event Schema & Tracking Standards.*

