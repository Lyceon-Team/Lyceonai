# **Lyceon — Document 06E: Cost, Capacity, Vendor & Outage Operations**

**Version:** V1.0 **Status:** LOCKED **Lock date:** 2026-05-22 **Last updated:** 2026-05-22 (CR-06E-04 in-lock-cycle draft-for-lock cleanup applied; status transitioned DRAFT→LOCKED on clean re-audit; CR-06E-05 second in-lock-cycle cleanup round applied post-LOCK — RB-06E-V1-11/12/13; CR-06E-06 third in-lock-cycle cleanup round applied post-LOCK — RB-06E-V1-14 SWE R2/R3 propagation cleanup; lock date holds per Parent §8 multi-round precedent; status/version unchanged) **Owners:** Founder / CTO review **Governed by:** Document 06 Parent V1.0 (LOCKED 2026-05-18; "lightweight" per Parent §3 with V1.1 expansion hook) → Document 00 (Authoritative Platform Directive) **Depends on:** Doc 06 Parent V1.0; Doc 06A V1.0 (LOCKED 2026-05-18 \+ post-lock additives RB-06A-V1-11/12 per CR-06A-06; §3 platform stack inventory referenced for vendor list, §7 environment matrix, §15 backup infrastructure topology); Doc 06B V1.0 (LOCKED 2026-05-21 \+ RB-06B-V1-13; consumed only for the privileged-op audit pattern); Doc 06C V1.0 (LOCKED 2026-05-21 \+ RB-06C-V1-01..15 per CR-06C-04; §7 alert-registry consumed, §8 scheduled-job heartbeat substrate consumed for capacity-projection cron, §10 incident lifecycle consumed for vendor-outage incidents); Doc 06D V1.0 (LOCKED 2026-05-21 \+ RB-06D-V1-01..18 per CR-06D-04/05; §10 compliance-gate registry pattern referenced as design precedent only); Doc 01A V1.0 (CANONICAL — §3 config doctrine consumed for `infra/vendor-pricing-snapshot.yaml` registration); Doc 03 Main V1.1 (§24 LISA cost metrics — $20/user/month hard cap, $18 hard alert, $10 soft alert, \<$6 target — referenced via project handoff record per §3.4); Doc 03C V3.0 (§11.3 LISA GCP substrate cost, §28 Vertex AI orchestrator failure modes consumed for vendor-outage doctrine for the GCP/Vertex pairing). **Forward-references (bounded):** Doc 07 (FWD-06-01 — analytics cost attribution; carried from 06D); Doc 01 V8 (FWD-06-02 — carried from 06D, non-blocking for 06E); Doc 05D (FWD-06-04 — carried from 06D); Doc 09 (FWD-06-05 — per-feature cost attribution, financial unit economics, pre-funding-round projections; bounded V1.1+ surface). **Applies to:** vendor inventory and tiering doctrine; vendor-outage operational doctrine (INV-06-12 body); per-platform documented cost-structure models with current pricing snapshot, Lyceon-specific cost formulas, and migration inflection points; composite cost-modeling formulas (cost-per-MAU, cost-per-DAU, cost-per-concurrent-user, projected scale at 1K/10K/100K MAU); capacity-projection mechanism with monthly \+ quarterly \+ utilization-triggered cadence; substrate-level cost-cap configuration discipline; Stripe transaction-rate monitoring; vendor pricing snapshot registry (`infra/vendor-pricing-snapshot.yaml`); and the launch-required vs target-state annotation convention adopted in this document and offered for family-wide retrofit. **Explicitly excludes:** LISA cost target/alert thresholds (Doc 03 Main §24 — referenced, never restated); LISA GCP substrate cost body (Doc 03C V3.0 §11.3 — referenced, never restated); platform stack inventory body (Doc 06A §3 — referenced; 06E adds the tiering \+ cost-modeling layer, not the inventory body); generic alert routing (01A §18, 06C §6 — consumed, never restated); per-vendor incident response runbook *bodies* (live in `docs/runbooks/`; 06E owns the required-shape contract only — see §6.2); per-feature cost attribution \+ unit economics \+ funding-round projections (Doc 09 — FWD-06-05 bounded forward-ref).

---

# **§1 — Purpose & Position in the Doc 06 Family**

06E is the family's lightweight sibling — per Parent §3 it ships at V1 with a deliberately narrow surface and a V1.1 expansion hook. It answers: *what does each platform we depend on cost as Lyceon grows, at what scale does each platform stop making sense, how do we model total platform cost as a function of user-driven KPIs, how do we project capacity needs forward, how do we configure substrate-level cost protection at launch, and how do we declare vendor-outage paths for INV-06-12 without restating any vendor incident-handling body.*

06E owns the operational doctrine for **INV-06-12** (vendor-outage paths explicit) outright. It contributes the cost/capacity slice to **INV-06-10** (every high-sev alert has owner \+ runbook) — only for cost/capacity-class alerts emitted by 06E, alert ownership is the locked 06C §11 unified rotation pattern referenced. It does NOT own Parent invariants outright beyond INV-06-12; the rest of its scope is operational doctrine \+ documented cost models \+ thin enforcement.

**Lightweight execution principle** (Parent §3): 06E V1 is **documentation-heavy and enforcement-thin**. The substantive V1 deliverable is §7 (per-platform cost-structure documentation) and §8 (composite Lyceon cost formulas). Mechanism surface at V1 is small — **six launch-required proving mechanisms** (four CI parity checks: `ci/vendor-inventory-parity`, `ci/vendor-runbook-shape-parity`, `ci/substrate-cap-config-parity`, `ci/vendor-pricing-snapshot-parity`; two ops/runtime monitors: `ops/capacity-projection-monthly-baseline`, `ops/stripe-transaction-rate-monitor`) **plus one target-state V1.1-activated cadence check** (`ci/capacity-review-deliverable-cadence`, activates 90 days post-launch per §9.5). Layer-2/Layer-3 cost-alert mechanisms, modeled-vs-actual reconciliation, per-feature attribution, and Tier-2 vendor SLA discipline are explicit V1.1+ deliverables per §4 launch-vs-target annotation and §12 target-state design.

Per Parent §4 every capability statement names a proving mechanism with the §6.13 six-element implemented-definition; per Parent §5 every primitive body remains canonical to its owner and is referenced, never restated.

---

# **§2 — Scope and Boundary**

## **2.1 06E owns**

The two-tier vendor inventory pattern (Tier-1 deploy-critical \+ Tier-2 dev-only, §5); the vendor-outage doctrine for INV-06-12 with required-shape runbook-registration contract (runbook bodies live in `docs/runbooks/`, §6); the per-platform documented cost-structure models with current pricing snapshot, cost-driver KPIs, Lyceon-specific cost-per-user formulas, and migration inflection points (§7 — the substantive V1 centerpiece); the composite Lyceon cost-modeling formulas mapping platform unit costs to user-driven KPIs (cost-per-MAU, cost-per-DAU, cost-per-concurrent-user, cost-per-LISA-active-student) with projected scaling at 1K/10K/100K MAU (§8); the capacity-projection mechanism with monthly baseline \+ quarterly deep deliverable \+ utilization-triggered ad-hoc refresh cadence (§9, Q-06E-3); the launch-required substrate-cap configuration discipline (Vercel spend management, Sentry plan-tier ceiling, Cloud Run max-instances, GitHub Actions plan cap — Layer 1 of the three-layer cost-protection model, §10); Stripe transaction-rate monitoring (chargeback rate \+ failed-transaction rate alerts — different shape from cost budgets, §11); the target-state cost mechanism design (Layer 2 budget registry \+ Layer 3 aggregate cap \+ modeled-vs-actual reconciliation \+ per-feature attribution — declared with V1.1+ scope, §12); the `infra/vendor-pricing-snapshot.yaml` machine-readable pricing registry \+ `ci/vendor-pricing-snapshot-parity` mechanism enforcing inline-vs-YAML pricing parity (§13, Q-06E-9); the launch-required vs target-state annotation convention adopted in 06E and offered for family-wide retrofit (§4).

## **2.2 06E explicitly does NOT own (Decision 5 — referenced, never restated)**

| Concern | Canonical owner (referenced by exact §) |
| ----- | ----- |
| LISA cost target/alert thresholds ($20 hard cap, $18 hard alert, $10 soft alert, \<$6 target, per-user/per-month) | Doc 03 Main §24 — referenced via project handoff record per §3.4 |
| LISA GCP substrate cost body (Cloud Run \+ Vertex AI orchestration cost model) | Doc 03C V3.0 §11.3 — referenced |
| Vertex AI orchestrator failure modes (for the GCP/Vertex pairing in vendor-outage doctrine) | Doc 03C V3.0 §28 — referenced |
| Platform stack inventory body (what runs where; the canonical Vercel/Supabase/Cloudflare/GCP/Stripe/GitHub/Sentry/etc. list) | Doc 06A §3 — referenced; 06E adds the tiering \+ cost-modeling layer |
| Environment matrix (Dev/Staging/Prod) | Doc 06A §7 — referenced |
| Alert routing tiers (Page / Warn / Info) and severity crosswalk | 01A §18 \+ Doc 06C §6 — referenced via crosswalk |
| Alert-registry schema (`infra/alert-registry.yaml`) | Doc 06C §7 — referenced; 06E registers entries, never modifies schema |
| Scheduled-job heartbeat substrate (consumed by capacity-projection cron) | Doc 06C §8 — consumed via consumer pattern |
| Scheduled-job external\_watchdog discipline | Doc 06C §8.7 (RB-06C-V1-01) — applied |
| Incident lifecycle base table \+ transition RPC (consumed for vendor-outage incidents) | Doc 06C §10 — consumed |
| Compliance-gate registry pattern (referenced as design precedent only; no compliance gates in 06E V1) | Doc 06D §10 — design precedent reference |
| Account-deletion / mastery cascade / retention policy substrate | Doc 06D §6 / §9 — outside 06E scope |
| Per-feature cost attribution / unit economics / funding-round projections | Doc 09 — sanctioned **FWD-06-05** bounded forward-ref (new) |
| Analytics cost attribution surface | Doc 07 — sanctioned **FWD-06-01** (carried from 06D) |
| Config doctrine (where `infra/vendor-pricing-snapshot.yaml` is registered) | 01A §3 — referenced |
| §10.5 envelope schema (12 common fields \+ per-mechanism extras matrix) | Doc 06 Parent §10.5 / 06A §10.5.1 — extended in §14 |

## **2.3 03C boundary (inherited from 06A §2.2 / 06B §2.3 / 06C §2.3 / 06D §2.3)**

Any LISA-tier cost surface is canonical to Doc 03 Main §24 (per-user cost targets) and Doc 03C V3.0 §11.3 (GCP substrate cost mechanics). 06E references both by exact § in §7 (the Vertex AI subsection and the Cloud Run subsection both cite Doc 03 / Doc 03C as canonical for LISA-specific application) and never restates a LISA cost target, threshold, or substrate cost mechanism. Restating any such body in 06E is a `DD-06-REDEF` defect surfaced by audit P10 / P15.

## **2.4 Inheritance**

06E inherits Doc 00, Parent §3 ("lightweight" framing with V1.1 expansion hook), Parent §6.13 (named ≠ implemented; six-element proving-mechanism definition), Parent §10.5 (Standard Proof Artifact Envelope), Parent §13 severity model (Page / Warn / Info \+ `operational_response_urgency`), 06A §3 (platform stack inventory consumed for vendor list), 06A §7 (environment matrix), 06A §11.3 `data_impact` enum (referenced but not directly used — 06E does not own data-impacting mechanisms), 06B §8.6 independent expected-source discipline (applied to cost-observation: cost source MUST be the vendor's own billing API, never the platform's own derived metric — see §7 each subsection), 06C §6.0 registry-canonical principle (06E's registries — vendor inventory in §5 and pricing snapshot in §13 — are the canonical machine-readable sources, not the markdown rendering of them).

---

# **§3 — Threat Model (Operational)**

Operational threats this document addresses. The cost dimension has a different threat profile than 06A/B/C/D — most threats are slow-burn (cost drift over weeks) rather than acute (immediate incident), with two exceptions (runaway-cost spike on a single vendor; vendor outage cascading into Lyceon outage).

1. **Cost-structure ignorance.** A vendor's pricing changes (Vercel introduced credit-based billing in Sept 2025; GitHub Actions reduced hosted-runner prices \~40% in January 2026 with the new $0.002/min platform fee already baked into the new rate; Google AI Ultra was cut from $249.99 to $99.99 in May 2026; GitHub announced a self-hosted runner platform fee in December 2025 and then postponed it within 48 hours after community pushback — a reminder that announced changes don't always land). Without documented cost models per platform, a pricing change goes unnoticed until the next invoice arrives, by which point a quarter of budget can already be misallocated. *Defense:* §7 per-platform cost-structure documentation with quarterly verification cadence; §13 machine-readable pricing snapshot registry; §16 audit pass P24 enforces inline-vs-registry parity.  
2. **Substrate-runaway cost spike.** A DDoS bandwidth attack on Vercel; a runaway query consuming Supabase compute; a logging-loop bug generating millions of Sentry events; an autoscale-to-infinity on Cloud Run after a load spike. Single-vendor catastrophic bills are the highest-magnitude cost threat — a Vercel DDoS without a spend limit can generate a $50K+ bill in hours. *Defense:* §10 launch-required substrate-cap configuration discipline (Layer 1 of three-layer cost-protection model); each Tier-1 vendor's substrate-level cap mechanism configured at deploy time; alert-registry entries (post W3 / CR-06C-06 closure) catch the breach.  
3. **Capacity wall surprise.** Lyceon's user growth crosses a vendor's plan-tier cliff (Supabase compute saturation at \~40-50 concurrent DB connections requires Small/Medium upgrade adding $50-150/month; Sentry event volume exceeds Business tier; Vercel bandwidth exceeds 1TB Pro allotment requiring $0.15/GB overage). Without capacity projection, the discovery happens during a peak-load incident rather than during planning. *Defense:* §9 capacity-projection mechanism — monthly baseline catches drift, quarterly deep dive is the strategic deliverable, 70% utilization trigger fires before the wall.  
4. **Vendor outage cascade.** A vendor (Supabase, Vercel, Cloudflare, GCP, Stripe) experiences extended degradation or full outage; Lyceon's response is improvised, runbooks are missing, on-call doesn't know whether to wait or fail-over. *Defense:* §6 vendor-outage doctrine (INV-06-12 body) — every Tier-1 vendor has a registered runbook entry name with required-shape contract; runbook bodies live in `docs/runbooks/` per coding-standards convention; on-call rotation (06C §11) knows where to look.  
5. **Migration timing miss.** Lyceon stays on a vendor past the inflection point where migration becomes economical (e.g., Vercel bandwidth costs balloon past the point where Cloudflare Pages migration would have paid for itself within 60 days). *Defense:* §7 per-platform inflection points \+ alternatives explicitly documented; quarterly capacity-projection deliverable (§9) reviews inflection-point proximity for each Tier-1 vendor.  
6. **Transaction-rate failure mode (Stripe).** Chargeback rate exceeds healthy thresholds; failed-transaction rate spikes during a deploy that broke billing; a fraud pattern develops. This is a different shape from cost overruns — Stripe cost is revenue-coupled, not infra-coupled. *Defense:* §11 Stripe transaction-rate monitoring (chargeback rate \+ failed-transaction rate alerts), distinct from cost-budget mechanisms.  
7. **V1.1 deferral creep.** A V1.1+ target-state mechanism (Layer 2 budget registry, modeled-vs-actual reconciliation, per-feature attribution) gets quietly postponed indefinitely as priorities shift, leaving 06E permanently in its "lightweight" V1 shape and never maturing. *Defense:* §4 launch-vs-target annotation makes deferral explicit per mechanism; §12 carries the V1.1 design openly; §17 W4 tracks V1.1 maturation as an explicit watch item.

**Threats explicitly NOT addressed here:**

* Cryptographic / authentication threats — 06B §3 canonical.  
* Per-primitive observability blind spots — 06C §3 canonical.  
* Data-protection / deletion / compliance threats — 06D §3 canonical.  
* LISA-specific cost-anomaly detection (already addressed by Doc 03 Main §24 \+ Doc 03C §11.3 — referenced).  
* Pricing-comparison-shopping bias (the question "could we get a better price elsewhere" outside the explicit inflection-point analysis — that's a vendor-management activity, not a 06E operational concern).

## **3.4 Doc 03 Main citation path (carried from 06C / 06D)**

Doc 03 Main V1.1 is not present in this session's source tree. Citations to §24 (LISA cost metrics) are made per the project handoff record. On Doc 03 Main upload, §7 LISA subsections (Vertex AI \+ Cloud Run) gain parsed §24 cost-target reconciliation as additional input to the audit; until then, cited section names are recorded in proof artifacts as `cited_per_project_handoff_record`. Registered as W1 in §17 (non-blocking).

## **3.5 Doc 05D citation path (FWD-06-04, carried from 06D §3.5)**

Doc 05D V1.0 is not present in source tree. 06E does NOT directly cite Doc 05D — 06E's scope is cost/capacity/vendor, distinct from deletion/cascade/audit. Registered as W2 in §17 only for completeness (carried from family-wide watch list).

---

# **§4 — The Launch-Required vs Target-State Annotation Convention (NEW — Family-Wide Offer)**

## **4.1 Scope of the convention**

06E introduces a new annotation dimension orthogonal to Parent §6.13's "specified vs deploy-proven" axis. Per pre-draft Q-06E-8=(a), the convention is **adopted in 06E V1 only** and offered for **lazy retrofit** to 06A/B/C/D in their next cleanup cycles. Doc 06 Parent §6.13 will be formally extended to recognize the convention before Docs 07/08/09/10 draft, so post-06E docs adopt the convention natively (no retrofit needed).

## **4.2 The two axes**

| Axis | Question answered | Defined by |
| ----- | ----- | ----- |
| **Specified vs deploy-proven** | Does the artifact name a runnable proving mechanism with all six §6.13 elements? | Parent §6.13 (existing) |
| **Launch-required vs target-state** (NEW — 06E origin) | Must this be live for V1 launch, OR is it the mature configuration we build toward post-launch? | This document §4 |

A mechanism can be in any combination of states across both axes. The four canonical combinations:

| Specified? | Deploy-proven? | Launch-required? | Meaning |
| ----- | ----- | ----- | ----- |
| Yes | Yes | Yes | V1 deliverable, complete: spec written, mechanism running, in production at launch. |
| Yes | No | Yes | V1 obligation, not-yet-built: spec written; build before launch; deploy-proof comes when the artifact lands. |
| Yes | No | No (target-state) | V1.1+ deliverable, spec-ahead: spec written for clarity and downstream consumer reference; mechanism builds post-launch; not blocking. |
| Yes | Yes | No (target-state) | Late-V1 or experimental: built and running, but not required for launch (e.g., shadow / observability-only mechanism). |

## **4.3 Annotation discipline**

Every mechanism declared in 06E carries a `launch_required: bool` field in its registry entry AND a sentence in its §6.13 implemented-definition stating launch-required status with rationale. The annotation is part of the §10.5 envelope extras matrix (§14) — proof artifacts emit `launch_required` as a top-level field so downstream automation can filter.

**Hard rule:** every mechanism with `launch_required: true` MUST have its substrate, configuration, and on-call routing in place at launch. A `launch_required: true` mechanism with deploy-readiness gaps at launch is a deploy-blocker, not a watch item.

**Hard rule:** every mechanism with `launch_required: false` MUST be explicitly registered in §12 (target-state mechanisms) with a V1.1+ trigger criterion stating WHEN the mechanism becomes launch-required-for-its-own-context. "We'll get to it" is not a trigger criterion; "when MAU exceeds 10K" or "when LISA cost-per-user exceeds $4" is.

## **4.4 Family-wide adoption path**

* **06E (this document):** adopts natively; every mechanism declared with launch\_required.  
* **06A/06B/06C/06D:** lazy retrofit. When each doc next has an in-lock-cycle cleanup window (post-CR-06A-06, CR-06B-XX, CR-06C-05, CR-06D-05), apply the convention retrospectively as additive annotation. No version bump per Parent §8 multi-round in-lock-cycle precedent.  
* **Parent §6.13:** extends in its next cleanup window to formally recognize the convention. Coordinated cross-doc cleanup tracked at the parent level.  
* **Docs 07, 08, 09, 10:** adopt the convention natively from drafting; no retrofit.

## **4.5 Audit support**

Audit pass **P25 (launch-required-annotation coverage)** added in §16 — every mechanism declared in 06E §18 acceptance criteria has a `launch_required: bool` annotation; mechanisms tagged `launch_required: false` resolve to a §12 V1.1+ trigger criterion. P25 carries forward as a family-wide convention check once retrofit lands in other 06 docs.

---

# **§5 — Vendor Inventory & Tiering (Q-06E-1 \= c)**

## **5.1 Scope**

06E V1 ships a two-tier vendor inventory. Tier-1 vendors are deploy-critical — Lyceon cannot serve traffic without them, and an outage of any Tier-1 vendor is a paging incident under 06C §10. Tier-2 vendors are dev-only — they support engineering velocity but are not in the production user-request path; their failure does not impact end users directly.

## **5.2 Registry — `infra/vendor-inventory.yaml`**

vendors:  
  \- vendor\_id: \<stable id; format 'VEND-\<short\>'\>  
    name: \<display name\>  
    tier: \<tier\_1 | tier\_2\>  
    canonical\_owner\_doc\_and\_section: \<e.g. '06A §3' for stack inventory\>  
    role: \<one-line: what does this vendor do for Lyceon\>  
    cost\_structure\_section\_ref: \<06E §7.N or null if tier\_2\>      \# required for tier\_1  
    outage\_runbook\_path: \<docs/runbooks/\<vendor\>-outage.md\>        \# required for tier\_1  
    pricing\_snapshot\_id: \<PS-\<short\> matching infra/vendor-pricing-snapshot.yaml\>  \# required for tier\_1  
    launch\_required\_substrate\_cap: \<true | false\>                  \# whether a Layer-1 substrate cap is set at launch  
    sla\_tracking\_at\_v1: \<formal | informational | none\>            \# tier\_1 \= formal; tier\_2 V1 \= informational; tier\_2 SLA discipline target-state at V1.1  
    last\_reviewed\_at: \<iso8601\>

## **5.3 V1 vendor inventory (Tier-1)**

These eight vendors are the launch-required infrastructure surface. Each has a §7 subsection with documented cost structure, a `docs/runbooks/<vendor>-outage.md` runbook stub registered (see §6), and an `infra/vendor-pricing-snapshot.yaml` entry (see §13).

| vendor\_id | Name | Role | §7 subsection | launch\_required substrate cap |
| ----- | ----- | ----- | ----- | ----- |
| `VEND-VERCEL` | Vercel | Frontend hosting, serverless functions, edge CDN | §7.1 | YES (Vercel "Spend Management" setting) |
| `VEND-SUPABASE` | Supabase | Postgres database, authentication, file storage, realtime | §7.2 | YES (per-resource limits; compute-tier discipline) |
| `VEND-VERTEX` | GCP Vertex AI (Gemini) | LISA tutor model inference (Flash-Lite / Flash / Pro routing per Doc 03C) | §7.3 | YES (per Doc 03 §24 canonical — referenced) |
| `VEND-CLOUDRUN` | GCP Cloud Run | LISA tutor orchestrator (per Doc 03C §28) | §7.4 | YES (max-instances limit per Doc 03C) |
| `VEND-CLOUDFLARE` | Cloudflare | CDN, WAF, DNS, DDoS protection | §7.5 | NO at launch (free tier; no spike risk) |
| `VEND-STRIPE` | Stripe | Billing, subscription management, payment processing | §7.6 | N/A (revenue-coupled, not infra-cost; transaction-rate monitoring per §11 instead) |
| `VEND-SENTRY` | Sentry | Error tracking, performance monitoring | §7.7 | YES (plan-tier auto-cap — Team or Business; overage off) |
| `VEND-GITHUB` | GitHub (incl. Actions) | Source control, CI/CD | §7.8 | NO at launch (free plan minute cap auto-limits) |

## **5.4 V1 vendor inventory (Tier-2)**

Tier-2 vendors support engineering and operations but are not in the production user-request path. V1 carries an informational entry; SLA tracking discipline is target-state per §12.

| vendor\_id | Name | Role | V1 entry |
| ----- | ----- | ----- | ----- |
| `VEND-POSTMAN` | Postman | API testing, collection management | informational |
| `VEND-FERN` | Fern | API SDK generation | informational |
| `VEND-ANTHROPIC` | Anthropic | Claude API for internal dev tools (Claude Code, Codex) | informational |
| `VEND-CHATGPT` | OpenAI | ChatGPT for spec-review workflow (per project handoff record) | informational |

Note: Tier-2 list is illustrative and small at V1 launch; the registry shape supports additions without version bump.

## **5.5 Tiering criteria**

A vendor is Tier-1 if **any** of the following is true:

* An extended outage (\>30 minutes) of the vendor prevents end-user requests from being served.  
* The vendor processes user data subject to compliance obligations (per Doc 06D retention registry).  
* The vendor's monthly cost exceeds 5% of total platform infra cost OR is projected to exceed that within 12 months.  
* The vendor handles billing/payment (Stripe is always Tier-1 regardless of other criteria).

A vendor is Tier-2 if it supports engineering velocity but does not meet any Tier-1 criterion. Tier-2 vendors can move to Tier-1 (recorded as a `last_reviewed_at` update \+ cost\_structure\_section\_ref population \+ runbook stub creation).

## **5.6 Proving mechanism — `ci/vendor-inventory-parity` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| **launch\_required** | true |
| Execution location | GitHub Actions, on PRs touching `infra/vendor-inventory.yaml` or `infra/vendor-pricing-snapshot.yaml` or `docs/runbooks/**`; plus nightly |
| Trigger cadence | Per PR \+ nightly |
| Input registry | `infra/vendor-inventory.yaml` \+ `infra/vendor-pricing-snapshot.yaml` \+ `docs/runbooks/` filesystem listing \+ 06A §3 platform stack inventory (parsed where possible; cited per project handoff record otherwise) |
| Failure condition | (a) any Tier-1 vendor without a `cost_structure_section_ref`; (b) any Tier-1 vendor without an existing `docs/runbooks/<vendor>-outage.md` file; (c) any Tier-1 vendor without a `pricing_snapshot_id` resolving in `infra/vendor-pricing-snapshot.yaml`; (d) any vendor in 06A §3 platform stack (where parseable) absent from `infra/vendor-inventory.yaml`; (e) any `last_reviewed_at` older than 180 days |
| Proof artifact | `vendor-inventory-parity` record per Parent §10.5 \+ extras (§14): `vendors_checked[]`, per-vendor `{vendor_id, tier, cost_structure_resolution, runbook_path_existence, pricing_snapshot_link, stack_inventory_coverage, decision}` |
| Owner / paging | Platform/CTO; PR-blocking |
| **launch\_required rationale** | Vendor inventory drives every other 06E mechanism (cost-structure documentation, runbook coverage, pricing-snapshot parity). An incomplete inventory at launch silently disables downstream coverage. |

---

# **§6 — Vendor-Outage Doctrine (INV-06-12 Body)**

## **6.1 Scope and Q-06E-4 \= (b) decision-3 pattern applied**

INV-06-12: vendor outage paths explicit. 06E owns the required-shape contract for vendor-outage runbooks and the registration discipline ensuring every Tier-1 vendor has a registered runbook entry. **Runbook bodies live in `docs/runbooks/` per coding-standards convention** — 06E does not inline runbook prose. This matches the family decision-3 pattern (Doc 06 owns shape \+ required-shape contracts; runbook prose lives in `docs/runbooks/`; Doc 06 governs shape).

## **6.2 Required-shape contract for `docs/runbooks/<vendor>-outage.md`**

Every Tier-1 vendor's outage runbook MUST contain these sections (header text exact match, case-sensitive; verified by §6.4 mechanism):

\# \<Vendor\> Outage Runbook

\#\# Detection  
\- How is the outage detected? (substrate status page, internal probe, paging alert source)  
\- What's the canonical source-of-truth for vendor status?

\#\# Severity Classification  
\- What constitutes a P0/P1/P2/P3 outage of this vendor? (mapped to 06C §6 severity crosswalk)  
\- Which Lyceon surfaces are affected at each severity?

\#\# Immediate Response (first 15 minutes)  
\- Who pages? (06C §11 unified rotation)  
\- What's the immediate user-facing degradation posture?  
\- What's the immediate communication action?

\#\# Degradation Mode  
\- What does Lyceon serve while the vendor is down?  
\- Read-only mode? Cached responses? Graceful banner? Hard outage acceptance?

\#\# Recovery Procedure  
\- What signals indicate the vendor is recovered?  
\- What internal verification is required before resuming full service?  
\- Postmortem creation (per 06C §10.5)

## **6.3 V1 registered Tier-1 vendor runbooks**

Each Tier-1 vendor in §5.3 has a `docs/runbooks/<vendor>-outage.md` file registered at V1. V1 ships with **runbook stubs** — files exist, all section headers present, body content is initial-draft quality and iterates as real-world incidents inform improvements. Per Q-06E-4=(b), 06E owns the shape contract; the body iteration is implementation-time work tracked as a `launch_required: true` deliverable.

| vendor\_id | Runbook path | V1 status |
| ----- | ----- | ----- |
| `VEND-VERCEL` | `docs/runbooks/vercel-outage.md` | Stub registered; required sections present |
| `VEND-SUPABASE` | `docs/runbooks/supabase-outage.md` | Stub registered; required sections present |
| `VEND-VERTEX` | `docs/runbooks/vertex-outage.md` | Stub registered; required sections present; degradation mode references Doc 03C §28 failure-mode matrix |
| `VEND-CLOUDRUN` | `docs/runbooks/cloudrun-outage.md` | Stub registered; required sections present; degradation mode references Doc 03C §28 |
| `VEND-CLOUDFLARE` | `docs/runbooks/cloudflare-outage.md` | Stub registered; required sections present |
| `VEND-STRIPE` | `docs/runbooks/stripe-outage.md` | Stub registered; required sections present; degradation mode \= block new subscriptions, allow existing access |
| `VEND-SENTRY` | `docs/runbooks/sentry-outage.md` | Stub registered; required sections present; degradation mode \= accept lost error visibility, do not block deploys |
| `VEND-GITHUB` | `docs/runbooks/github-outage.md` | Stub registered; required sections present; degradation mode \= no production deploys until restored |

## **6.4 Proving mechanism — `ci/vendor-runbook-shape-parity` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| **launch\_required** | true |
| Execution location | GitHub Actions, on PRs touching `docs/runbooks/**` or `infra/vendor-inventory.yaml`; plus nightly |
| Trigger cadence | Per PR \+ nightly |
| Input registry | `docs/runbooks/` filesystem listing \+ `infra/vendor-inventory.yaml` (Tier-1 vendors) |
| Failure condition | (a) any Tier-1 vendor in inventory without a corresponding `docs/runbooks/<vendor>-outage.md` file (also caught by §5.6); (b) any registered runbook file missing one of the required section headers per §6.2 (exact-match parsing); (c) any runbook file with `last_modified_at` older than 365 days without an explicit annual-review marker; (d) any runbook section labeled "TBD" or empty (initial-draft tolerance lasts 90 days from V1 launch, then is a defect) |
| Proof artifact | `vendor-runbook-shape-parity` record per Parent §10.5 \+ extras (§14): `runbooks_checked[]`, per-runbook `{vendor_id, runbook_path, required_sections_present, last_modified_at, tbd_or_empty_sections, decision}` |
| Owner / paging | Platform/CTO; PR-blocking |
| **launch\_required rationale** | INV-06-12 (Parent invariant) requires vendor-outage paths to be explicit. Without runbook-shape enforcement, the invariant becomes a documentation aspiration rather than a verifiable property. |

## **6.5 Vendor-outage incident lifecycle (consumed from 06C §10)**

When a Tier-1 vendor outage is observed (paging alert via §10 substrate-cap breach, status-page integration, or on-call manual detection), an `incidents` row is created per Doc 06C §10 with `incident_category = 'vendor_outage'` (this category extends 06C's existing categories; tracked as cross-doc additive **CR-06C-07** owed to 06C — see §17 W3). The runbook from §6.3 drives the response; the postmortem (06C §10.5) references the runbook and captures any required runbook updates.

Vendor-outage incidents are NOT privacy-class (06D §11 doctrine does not apply unless data exposure is also confirmed; in that case the privacy-class attachment is added separately per 06D §11.2).

---

# **§7 — Per-Platform Cost-Structure Documentation (THE V1 CENTERPIECE)**

This section is the substantive V1 deliverable per pre-draft Q-06E-7 reframing: **documented cost models per platform**, NOT alert mechanisms. Each Tier-1 vendor gets a subsection covering pricing tier structure, cost-driver KPIs, Lyceon-specific cost-per-user formula, scale projections at 1K/10K/100K MAU, migration inflection point, and launch-required substrate-cap configuration.

**Pricing snapshot verified:** 2026-05-22. Every numeric pricing value below is also stored in `infra/vendor-pricing-snapshot.yaml` per §13; `ci/vendor-pricing-snapshot-parity` (§13.3) enforces inline-vs-YAML parity per Q-06E-9=(c). Quarterly re-verification cadence; pricing changes apply via in-lock-cycle cleanup (no version bump per Parent §8).

## **7.1 Vercel — Frontend Hosting & Serverless**

**Pricing tier structure (verified 2026-05-22):**

| Tier | Monthly base | Included | Key overage rates |
| ----- | ----- | ----- | ----- |
| Hobby (free) | $0 | 100 GB bandwidth, 1M function invocations, 4 hrs Active CPU, 360 GB-hrs memory | Hard caps — no overage; deployment pauses at limit. NOT commercial-use eligible. |
| Pro | $20 per seat \+ $20 monthly usage credit | 1 TB Fast Data Transfer, 10M Edge Requests, 1M function invocations included | Bandwidth $0.15/GB beyond 1 TB; Active CPU $0.128/CPU-hour; Provisioned Memory $0.0106/GB-hour; function invocations $0.60/M; Fast Origin Transfer $0.06/GB |
| Enterprise | Custom (typically $5,000+/month) | Negotiated | Custom |

**Cost-driver KPIs (the meters that move the bill, in approximate order they bite):**

1. **Edge Requests** — every asset on every page view counts. A page with 35 images/scripts/stylesheets \+ 1 API call \= 36 edge requests. At 2M page views/month → 72M edge requests, well over the 10M Pro tier.  
2. **Bandwidth (Fast Data Transfer)** — page weight × sessions. Lyceon's pages will include images and interactive components; assume \~5-10 MB per session as a working estimate (refine post-launch with observed data).  
3. **Active CPU** — Fluid Compute bills per CPU-second of actual execution; I/O wait is free.  
4. **Function invocations** — every serverless function call. Lyceon's BFF layer drives this.  
5. **Provisioned Memory** — GB-hours; matters more for long-running functions.  
6. **Image Optimization** — per source image; easy to miss in cost projections.  
7. **Edge Middleware Invocations** — multiplied by every route.  
8. **Fast Origin Transfer** — function-to-edge data; $0.06/GB charged from first byte.

**Lyceon-specific cost-per-user formula:**

monthly\_cost ≈  
    $20 (Pro base, single seat)  
  \+ max(0, monthly\_bandwidth\_GB − 1024\) × $0.15  
  \+ max(0, monthly\_edge\_requests − 10\_000\_000) × $2 / 1\_000\_000  
  \+ max(0, monthly\_function\_invocations − 1\_000\_000) × $0.60 / 1\_000\_000  
  \+ active\_CPU\_hours × $0.128  
  \+ provisioned\_memory\_GB\_hours × $0.0106  
  − min($20, observed\_overage\_subtotal)   \# $20 credit absorbs overage

Where:

* `monthly_bandwidth_GB` ≈ `MAU × sessions_per_user_per_month × avg_page_weight_MB / 1024`  
* `monthly_edge_requests` ≈ `MAU × sessions_per_user_per_month × avg_assets_per_page` (each asset on each page view counts; middleware-heavy routes multiply this)  
* `monthly_function_invocations` ≈ `MAU × api_calls_per_user_per_month` (working estimate)

**Lyceon scale projections (working-estimate; refine quarterly):**

Assumption baseline: avg session \= 8 MB; 12 sessions/user/month (3 per week); 40 API calls/user/month; **36 edge-requests/session** (typical SPA: assets \+ scripts \+ stylesheets \+ 1 API call per page view).

| Scale | Bandwidth/mo | Edge requests/mo | Function invocations/mo | Est. monthly cost |
| ----- | ----- | ----- | ----- | ----- |
| 1K MAU | 94 GB | 432K | 40K | $20 (well under all overage thresholds; usage credit covers everything) |
| 10K MAU | 938 GB | 4.32M | 400K | \~$22 (still within 1 TB included bandwidth and 10M Edge Requests; minor Active CPU usage) |
| 100K MAU | 9,375 GB | 43.2M | 4M | $20 base \+ $1,253 bandwidth overage \+ $66 edge-request overage ((43.2M − 10M) × $2/M) \+ $1.80 function overage \+ \~$50 Active CPU − $20 credit ≈ **\~$1,371**. Bandwidth dominates. |

**Migration inflection point:**

At \~2 TB/month sustained bandwidth OR \~$500/month total bill consistently, migration to **Cloudflare Pages** becomes economically dominant. Cloudflare Pages provides unlimited bandwidth at every tier (loss-leader for Cloudflare's CDN business — bandwidth is not their cost of goods sold), same Next.js support, \~80-90% bandwidth-cost savings at scale. Migration cost: LOW — Next.js portability is good for pages-only migration; Workers code requires more porting. **Lyceon trigger criterion (target-state):** when `monthly_bandwidth_GB > 2048` for 3 consecutive months OR projected Vercel bill exceeds $500/month for 2 consecutive quarters per §9 quarterly projection.

**Launch-required substrate-cap configuration:**

| Layer 1 setting | Value at launch | Rationale |
| ----- | ----- | ----- |
| Vercel "Spend Management" hard cap | $200/month | Covers Pro base ($20) \+ \~10x usage credit ($200); well below catastrophic. Vercel hard-stops account at cap. |
| Bandwidth alert threshold | 800 GB/month (80% of Pro included 1 TB) | Soft warning before $0.15/GB overage begins |
| Active CPU alert threshold | 50 CPU-hours/month | Catches runaway-function patterns before bill spike |

**Cost-observation source:** Vercel Billing API (independent of Lyceon-derived metrics per 06B §8.6 source-independence discipline).

## **7.2 Supabase — Postgres, Auth, Storage**

**Pricing tier structure (verified 2026-05-22):**

| Tier | Monthly base | Included | Key overage rates |
| ----- | ----- | ----- | ----- |
| Free | $0 | 500 MB DB, 50K MAUs, 1 GB file storage, 5 GB DB egress, 200 realtime connections | Projects pause after 7 days inactivity (NOT production-suitable) |
| Pro | $25 per project ($10 each additional) \+ $10 monthly compute credit | 8 GB DB, 100K MAUs, 100 GB file storage, 250 GB egress, 500 realtime connections, default Micro compute | Bandwidth $0.09/GB; MAU $0.00325/user; DB storage $0.125/GB; file storage $0.021/GB; compute upgrade $10-$3,730/month |
| Team | $599 per project \+ usage | Pro limits \+ SOC2/ISO 27001 compliance, 14-day backups | Same overage rates as Pro |
| Enterprise | Custom | Negotiated, including BYO cloud | Custom |

**Cost-driver KPIs:**

1. **Compute tier** — default Micro instance saturates at \~40-50 concurrent DB connections under load; upgrade to Small (\~$15), Medium (\~$60), Large (\~$110) typical production progression.  
2. **MAU** (authentication) — billed for any user who authenticates in a calendar month, including anonymous sign-ins once they authenticate.  
3. **Bandwidth (egress)** — both database egress and storage egress are metered.  
4. **DB storage** — postgres data size; rare driver, but bloats with logs/audit tables if not retention-managed (per Doc 06D §9 retention policy registry).  
5. **File storage** — Supabase Storage (object store); driven by uploads.  
6. **Realtime connections** — concurrent realtime/websocket subscriptions.  
7. **Per-project add-ons** — additional projects $10/mo each; PITR $100-$400/mo.

**Lyceon-specific cost-per-user formula:**

monthly\_cost ≈  
    $25 (Pro base, single project)  
  \+ $100 (PITR 7-day retention — launch-required per Doc 06D §13 backup substrate)  
  \+ max(0, MAU − 100\_000) × $0.00325  
  \+ max(0, db\_egress\_GB − 250\) × $0.09  
  \+ max(0, storage\_egress\_GB − 0\) × $0.09     \# storage egress is metered separately  
  \+ max(0, db\_storage\_GB − 8\) × $0.125  
  \+ max(0, file\_storage\_GB − 100\) × $0.021  
  \+ compute\_upgrade\_cost                       \# Micro=$0, Small≈$15, Medium≈$60, Large≈$110  
  − $10                                        \# compute credit absorbs Micro

**Concurrent-user discipline (RB-06E-V1-08):** the compute upgrade is driven by **concurrent DATABASE connections**, NOT concurrent users. The two metrics are decoupled by **connection pooling** — Supabase ships Supavisor (PgBouncer-compatible) as the canonical pooler, and **all Lyceon DB access from API routes MUST go through Supavisor** (transaction-mode pooling). Without pooling, 5,000 concurrent users would saturate even Large compute by exhausting Postgres connection limits — that's an architecture defect, not a tier upgrade. With Supavisor transaction-mode pooling, peak concurrent users translate to \<10x peak concurrent DB connections in typical workloads.

Compute upgrade is a step function of **peak concurrent DB connections after pooling**: Micro until \~40 connections; Small at \~40-100; Medium at \~100-500; Large at \~500+. **Lyceon estimate is invalid unless peak DB connections are explicitly bounded by Supavisor configuration.**

**Lyceon scale projections (working-estimate):**

Assumption baseline: 5% of MAU concurrent at peak; **Supavisor transaction-mode pooling enabled (concurrent DB connections ≪ concurrent users)**; 50 MB DB rows per active student; minimal file uploads; 10 KB egress per typical API call × 40 calls/user/month. PITR $100/month included in all tiers per launch-required substrate-cap (RB-06E-V1-01 / Doc 06D §13).

| Scale | MAU | Concurrent users (peak) | Peak DB connections (after pooling) | DB rows | Egress | Est. monthly cost |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| 1K MAU | 1K | 50 | \~5-10 | 50 MB | 0.4 GB | \~$125 ($25 base \+ $100 PITR; Micro sufficient; compute credit covers Micro) |
| 10K MAU | 10K | 500 | \~50-100 | 500 MB | 4 GB | \~$175 ($25 \+ $100 PITR \+ Small/Medium $15-60; well within egress/MAU/storage limits) |
| 100K MAU | 100K | 5,000 | \~500-1000 | 5 GB | 40 GB | \~$235 ($25 \+ $100 PITR \+ Large $110; MAU at Pro limit — beyond requires $0.00325 per excess MAU). **Note:** 5K concurrent users without Supavisor pooling would be an architecture defect — Lyceon must enforce pooling. |

**Migration inflection point:**

At \>500K MAU OR consistently needing Medium+ compute (post-pooling — concurrent DB connections, NOT users) with complex query patterns, evaluate **AWS RDS \+ Cognito** OR **Neon \+ Clerk**. At 100K MAU, Supabase Pro is competitive (\~$235/month including PITR vs AWS \~$3,180 per published benchmarks); at 10M+ MAU the relationship inverts and AWS becomes the cost winner. **Lyceon trigger criterion (target-state):** when MAU exceeds 500K for 3 consecutive months OR post-pooling DB-connection requirement exceeds Large ($110+/month) with no headroom. Migration cost: HIGH — auth migration is the riskiest piece; RLS policies need substantial rework; multi-month effort.

**Launch-required substrate-cap configuration:**

| Layer 1 setting | Value at launch | Rationale |
| ----- | ----- | ----- |
| Compute tier | Micro (default) | Upgrade-on-demand only; do not prematurely provision |
| **Supavisor transaction-mode pooling** | **REQUIRED** | Decouples concurrent users from concurrent DB connections; prevents the 5K-concurrent-users architecture defect described above |
| **PITR (Point-in-Time Recovery)** | **7-day retention ($100/month minimum) — launch-required per Doc 06D §13 backup substrate canonical** | Doc 06D §13 locks PITR as V1 restore-test foundation; not optional. **Referenced, never restated** — Doc 06D owns the body. |
| MAU threshold alert | 80K MAU/month (80% of Pro 100K) | Pre-warning before $0.00325/user overage begins |
| Egress threshold alert | 200 GB/month (80% of Pro 250 GB) | Pre-warning before $0.09/GB overage begins |
| Peak DB connections alert | 80% of current compute tier's connection limit | Pre-warning before compute upgrade is needed |
| Compute upgrade Page alert | Any upgrade beyond Medium ($60+) | Triggers a cost review before incurring upgrade cost |

**Cost-observation source:** Supabase Management API \+ project billing dashboard (independent of Lyceon-derived metrics).

## **7.3 GCP Vertex AI — LISA Tutor Inference**

**Pricing tier structure (verified 2026-05-22):**

Pay-per-token. Multiple model tiers with sharply different costs:

| Model | Input cost ($/M tokens) | Output cost ($/M tokens) | Use case |
| ----- | ----- | ----- | ----- |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | Classification, lightweight Q\&A (cheapest) |
| Gemini 2.5 Flash | $0.30 | $2.50 | Default workhorse |
| Gemini 2.5 Pro | $1.25 | $10.00 | Complex reasoning (escalation) |
| Gemini 3.1 Flash-Lite | $0.25 | $1.50 | (newer tier; 2026\) |
| Gemini 3.5 Flash | $1.50 | $9.00 | (newer tier; May 2026 launch) |
| Gemini 3.1 Pro | $2.00 | $12.00 | Frontier reasoning |

**Discounts available:**

* **Implicit context caching:** 90% discount on cached input tokens for Gemini 2.5+ models (automatic, enabled by default)  
* **Explicit context caching:** 90% discount on cached input; storage cost $1-4.50/M tokens/hour  
* **Batch API:** 50% discount, 24-hour SLA (not suitable for user-facing LISA queries)  
* **Provisioned Throughput:** 20-45% off with commitment

**Cost-driver KPIs:**

1. **LISA queries per active student per month** — Doc 03 Main caps: 120/day, 2500/week, 10K/month hard.  
2. **Token-mix per query** — average input \+ output tokens; varies by query type.  
3. **Routing distribution** — per Doc 03C: Flash-Lite (classification) / Flash (default) / Pro (escalation). Distribution drives weighted cost.  
4. **Cache hit rate** — implicit caching effectiveness on system prompts and shared context.

**Lyceon-specific cost-per-user formula:**

The cache discount applies to **input tokens only** (per Vertex AI implicit-caching documentation). Output tokens are never cached. Formula must apply the discount to the input component before summing with output:

For each routing share s ∈ {flash\_lite, flash, pro}:  
  input\_cost\_s  \= share\_s × input\_tokens × input\_rate\_s / 1\_000\_000  
  output\_cost\_s \= share\_s × output\_tokens × output\_rate\_s / 1\_000\_000

weighted\_input\_cost  \= Σ input\_cost\_s  
weighted\_output\_cost \= Σ output\_cost\_s

input\_cost\_after\_cache \= weighted\_input\_cost × (1 − cached\_input\_fraction × 0.90)

cost\_per\_query \= input\_cost\_after\_cache \+ weighted\_output\_cost

cost\_per\_active\_student\_per\_month \= queries\_per\_student × cost\_per\_query

Where:

* `share_flash_lite + share_flash + share_pro = 1.0`  
* `cached_input_fraction` \= ratio of input tokens served from implicit cache (system-prompt-heavy portion; high cache hits expected)  
* Cache discount applies **only to input** — output tokens are never cached and pay full output rate.

**Lyceon-specific working estimate** (refine post-launch with observed data):

* Average LISA query: \~500 input tokens, \~800 output tokens  
* Routing: 30% Flash-Lite, 60% Flash, 10% Pro  
* Cache hit on input: 70% (system-prompt-heavy)  
* Moderate-use student: 50 queries/month

Step 1 — weighted input cost (before cache):

 0.30 × 500 × $0.10 / 1M  \= $0.0000150  
\+ 0.60 × 500 × $0.30 / 1M  \= $0.0000900  
\+ 0.10 × 500 × $1.25 / 1M  \= $0.0000625  
                            \= $0.0001675 per query

Step 2 — cache discount on input only (70% cached × 90% discount):

input\_savings           \= $0.0001675 × 0.70 × 0.90 \= $0.0001055 per query  
input\_cost\_after\_cache  \= $0.0001675 − $0.0001055 \= $0.0000620 per query

Step 3 — weighted output cost (output is NEVER cached):

 0.30 × 800 × $0.40 / 1M  \= $0.0000960  
\+ 0.60 × 800 × $2.50 / 1M  \= $0.0012000  
\+ 0.10 × 800 × $10.00 / 1M \= $0.0008000  
                            \= $0.0020960 per query

Step 4 — total cost per query:

cost\_per\_query ≈ $0.0000620 \+ $0.0020960 ≈ $0.00216 per query

**Per-student monthly cost at varying activity:**

| Activity tier | Queries/month | Monthly cost per student |
| ----- | ----- | ----- |
| Moderate-use | 50 | **\~$0.11** |
| Heavy-use (5x moderate) | 250 | **\~$0.54** |
| At Doc 03 daily-cap (120/day average) | \~3,600 | **\~$7.78** |
| Theoretical monthly cap (Doc 03 hard) | 10,000 | **\~$21.58** |

**At Doc 03 daily-cap usage (\~3,600 queries/month):** \~$7.78/month per maximally-active student — comfortably below Doc 03 §24 $10 soft alert (well within target band). At the theoretical monthly hard cap of 10,000 queries: \~$21.58/month — slightly above the $20 hard cap; in practice the per-day throttle (120/day \= \~3,600/month) prevents real users from reaching this. **Current Gemini 2.5 pricing leaves substantial headroom against Doc 03 §24 cost discipline.**

**Lyceon scale projections** (assuming 60% of MAU is "active" with LISA in a given month; 80% moderate-use, 18% heavy-use, 2% at daily-cap):

Per-active-LISA-user blended cost: `0.80 × $0.108 + 0.18 × $0.540 + 0.02 × $7.78 ≈ $0.339`/active-LISA-user/month

| Scale | Active LISA users/mo | Est. LISA monthly cost |
| ----- | ----- | ----- |
| 1K MAU | 600 | \~$204 (600 × $0.339) |
| 10K MAU | 6,000 | \~$2,035 |
| 100K MAU | 60,000 | \~$20,350 |

Cost-per-MAU: \~$0.20/MAU/month for LISA inference alone (Vertex AI portion). Output tokens dominate per-query cost (\~97% of per-query cost is output; input-after-cache is \~3%) — output-token discipline (concise tutor responses, no overly verbose explanations) is therefore the highest-leverage cost-control lever for LISA.

**Per Doc 03 §24 referenced canonical:** hard cap $20/user/month, hard alert $18, soft alert $10, target \<$6. The corrected estimate above is well within target band for moderate-use students (\~$0.11) and remains below the soft alert even at daily-cap throttled usage (\~$7.78). The throttling discipline keeps even heaviest users under the hard cap.

**Migration inflection point:**

Migration value is feature/compliance, not raw $/token — comparable-magnitude alternatives:

* **Anthropic Claude API**: $3-25/M tokens depending on tier (Opus 4.6, Sonnet 4.6); higher absolute cost but stronger context-window economics  
* **OpenAI**: $1.25-15/M tokens (GPT-5, GPT-5.4)  
* **Direct Gemini API** (vs Vertex): same pricing, fewer enterprise features

Doc 03 (LISA) architecture is Vertex-coupled; migration would require Doc 03 family revision. **Lyceon trigger criterion (target-state):** would require Doc 03 architectural redesign — defer past V1 unless quality/cost forces it. Not a near-term concern.

**Launch-required substrate-cap configuration:**

| Layer 1 setting | Value at launch | Canonical owner |
| ----- | ----- | ----- |
| LISA per-user daily / weekly / monthly cap | 120/day, 2,500/week, 10K/month (hard) | **Doc 03 Main §24 — referenced, never restated** |
| Per-question 5-minute cooldown after 3 fails | Per Doc 03 Main §11 | Doc 03 Main — referenced |
| GCP project-level budget alert | Lyceon launch threshold: $500/month total Vertex spend | 06E §10 |
| Vertex Studio production-restriction | API access only; no UI playground exposure in production | 06E §10 |

**Cost-observation source:** GCP Billing API \+ Vertex AI usage dashboard (independent of Lyceon-derived metrics). Cross-referenced with Doc 03 Main §24 per-user cost tracking surface.

## **7.4 GCP Cloud Run — LISA Orchestrator**

**Pricing tier structure (verified 2026-05-22):**

Pay-per-resource consumption. No tier subscription.

| Resource | Cost (Tier 1, us-central1) | Free tier (monthly) |
| ----- | ----- | ----- |
| CPU (active) | $0.000024 per vCPU-second | First 180,000 vCPU-seconds free |
| Memory (active) | $0.0000025 per GiB-second | First 360,000 GiB-seconds free |
| Requests | $0.40 per million | First 2 million free |

Discounts available:

* 1-year CUD: \~38% off CPU/memory unit prices  
* 3-year CUD: \~50% off

**Cost-driver KPIs:**

1. **LISA orchestrator request volume** — per Doc 03C §28: every LISA query routes through Cloud Run orchestrator before reaching Vertex  
2. **Orchestrator execution duration per request** — directly drives vCPU-seconds and GiB-seconds  
3. **Concurrency setting** — multiple requests sharing one instance reduces total CPU-seconds

**Lyceon-specific cost-per-user formula:**

monthly\_cloud\_run\_cost ≈  
    max(0, total\_requests − 2\_000\_000) × $0.40 / 1\_000\_000  
  \+ max(0, total\_vcpu\_seconds − 180\_000) × $0.000024  
  \+ max(0, total\_gib\_seconds − 360\_000) × $0.0000025

Where:

* `total_requests ≈ MAU × 0.60 × queries_per_student_per_month` (active-user × query-volume)  
* `total_vcpu_seconds ≈ total_requests × avg_orchestrator_duration_seconds × vcpu_allocation`  
* `total_gib_seconds ≈ total_requests × avg_orchestrator_duration_seconds × memory_gib_allocation`

Working estimate: orchestrator avg duration 400ms (non-LLM-bound portion is fast); 1 vCPU \+ 0.5 GiB per request.

**Lyceon scale projections (LISA orchestrator only; Vertex inference is §7.3):**

| Scale | Active LISA users/mo | Queries/mo | vCPU-seconds | GiB-seconds | Est. monthly cost |
| ----- | ----- | ----- | ----- | ----- | ----- |
| 1K MAU | 600 | 30K | 12,000 | 6,000 | $0 (well within free tier) |
| 10K MAU | 6,000 | 300K | 120,000 | 60,000 | $0 (still within free tier) |
| 100K MAU | 60,000 | 3M | 1.2M | 600,000 | \~$26 — see breakdown below |

Breakdown at 100K MAU:

* Requests: (3,000,000 − 2,000,000) × $0.40 / 1,000,000 \= **$0.40**  
* vCPU-seconds: (1,200,000 − 180,000) × $0.000024 \= **$24.48**  
* GiB-seconds: (600,000 − 360,000) × $0.0000025 \= **$0.60**  
* Total ≈ **$25.48/month**

LISA orchestrator is a small cost driver compared to Vertex AI inference — Cloud Run free tier covers Lyceon well past 10K MAU.

**Per Doc 03C V3.0 §11.3 canonical:** LISA GCP substrate cost mechanics live in Doc 03C. 06E references the substrate; Doc 03C owns the body.

**Migration inflection point:**

At \>$1000/month sustained OR cold-start latency hurts UX, evaluate Cloud Run with min-instances \+ CUDs (1-year CUD: CPU $0.00001494/vCPU-second — 38% discount) before migration. Alternative: GCE managed instance group for predictable workloads. **Lyceon trigger criterion (target-state):** sustained Cloud Run spend \> $1,000/month for 2 consecutive months. Not a near-term concern at projected scale.

**Launch-required substrate-cap configuration:**

| Layer 1 setting | Value at launch | Canonical owner |
| ----- | ----- | ----- |
| max-instances per service | Per Doc 03C §28 | **Doc 03C V3.0 — referenced, never restated** |
| min-instances | 0 (scale-to-zero) for non-LISA services; per Doc 03C for LISA orchestrator | Doc 03C — referenced |
| GCP project-level budget alert | Bundled with §7.3 Vertex AI alert | 06E §10 |

**Cost-observation source:** GCP Billing API (independent of Lyceon-derived metrics).

## **7.5 Cloudflare — CDN, WAF, DNS, DDoS Protection**

**Pricing tier structure (verified 2026-05-22):**

| Tier | Monthly cost (annual / monthly billing) | Included |
| ----- | ----- | ----- |
| Free | $0 | Unlimited bandwidth, DDoS protection, global CDN, DNS, basic WAF |
| Pro | **$20/zone annual** OR **$25/zone monthly** | WAF custom rules, image optimization, advanced bot mitigation |
| Business | **$200/zone annual** OR **$250/zone monthly** | 100% uptime SLA, advanced WAF, custom certificates |
| Enterprise | $3,000+/month | Dedicated solutions engineer, advanced rate limiting |

Workers (separate pricing):

* Free: 100K requests/day  
* Paid: $5/month base \+ $0.30/M requests beyond 10M included \+ $0.02/M CPU-ms beyond 30M

R2 (object storage):

* 10GB-month free  
* Then $0.015/GB-month  
* Zero egress fees

Pages (static site hosting):

* Unlimited bandwidth on all tiers including free  
* Free: 500 builds/month  
* Pro: $20/month (5K builds, Workers integration)

**Cost-driver KPIs:**

Cloudflare's pricing model is fundamentally different from other vendors — bandwidth is loss-leading infra, not cost-of-goods. For Lyceon at launch and reasonable scale, **Cloudflare cost is effectively $0**.

Cost drivers only become relevant if/when:

1. Workers usage \> 10M requests/month (V1.1+ concern; not used at launch)  
2. R2 storage \> 10 GB (if Lyceon uses R2 for file uploads — currently Supabase Storage is primary)  
3. Need for Business tier features (advanced WAF, SLA) — driven by compliance posture, not cost

**Lyceon-specific cost-per-user formula:** `monthly_cost ≈ $0` at launch and through 10K MAU.

**Lyceon scale projections:**

| Scale | Est. monthly cost |
| ----- | ----- |
| 1K MAU | $0 |
| 10K MAU | $0 |
| 100K MAU | $0 |
| 1M MAU | $0 (still on free tier for CDN; possible $20-$200 if WAF custom rules required) |

**Migration inflection point:** N/A — Cloudflare is one of the platforms we'd migrate TO from elsewhere (e.g., Vercel Pages → Cloudflare Pages at the §7.1 inflection point).

**Launch-required substrate-cap configuration:**

| Layer 1 setting | Value at launch | Rationale |
| ----- | ----- | ----- |
| Plan tier | Free | No upgrade needed at launch |
| WAF rules | Default \+ Lyceon-specific bot mitigation | Per Doc 06A §3 / Doc 06B referenced |
| DDoS protection | Default-enabled | Standard for all Cloudflare plans |

**Cost-observation source:** Cloudflare Dashboard (cost \= $0; no API integration needed at V1).

## **7.6 Stripe — Billing & Payments**

**Pricing tier structure (verified 2026-05-22):**

No subscription. Per-transaction fees.

| Transaction type | Fee (US) |
| ----- | ----- |
| Standard online card | 2.9% \+ $0.30 per successful transaction |
| Manual entry / card-not-present (keyed) | 3.4% \+ $0.30 |
| International cards | \+ 1.5% |
| Currency conversion | \+ 1.0% |
| ACH Direct Debit | 0.8% (capped at $5) |
| Disputes (chargebacks) | **\~$15/dispute (conservative)** — Stripe distinguishes dispute-received fee from dispute-countered fee; the countered fee is returned if the merchant wins. Treatment varies by region, account standing, and dispute outcome. Use $15/dispute as a conservative cost model; actual cost may be lower for won disputes. |

Stripe Billing add-on: 0.7% of subscription volume (for recurring billing, prorations, dunning, retries).

Invoicing: 0.4-0.5% per paid invoice.

**Volume discounts:** at \~$100K/month processing, custom rates negotiable (down to \~2.4% \+ $0.30). Lyceon target post-launch.

**Cost-driver KPIs:**

Stripe cost is **revenue-coupled, not infra-coupled**. The cost-driver KPIs are:

1. **Subscription revenue** — drives both the 2.9% \+ $0.30 card fee and the 0.7% Billing add-on  
2. **Average transaction size** — fixed $0.30 fee dominates at small ticket; matters more for trial-to-paid conversions if priced low  
3. **Dispute rate** — $15 per dispute; industry SaaS healthy \<0.5%, alarming \>1%  
4. **Failed-transaction rate** — failed renewals indicate card-update issues; doesn't directly cost, but impacts churn metrics  
5. **International transaction %** — adds 1.5% per international card

**Lyceon-specific cost-per-user formula:**

monthly\_stripe\_cost ≈  
    monthly\_revenue × (0.029 \+ 0.007)   \# 2.9% card \+ 0.7% Billing  
  \+ monthly\_paying\_subscribers × $0.30   \# fixed fee per transaction  
  \+ monthly\_disputes × $15               \# chargeback cost (conservative; actual may be lower for won disputes)  
  \+ international\_revenue × 0.015        \# international surcharge if applicable

For a typical Lyceon student subscription (working estimate $30/month):

cost\_per\_paying\_subscriber\_per\_month ≈  
    $30 × 0.036 \+ $0.30 \+ (0.005 × $15)   \# 0.5% dispute rate assumption  
  \= $1.08 \+ $0.30 \+ $0.08  
  ≈ $1.46

Effective rate: \~4.9% on a $30 subscription.

**Lyceon scale projections (assuming 5% of MAU converts to paying, $30/month avg subscription):**

| Scale | Paying subscribers | Monthly revenue | Stripe cost | Effective cost rate |
| ----- | ----- | ----- | ----- | ----- |
| 1K MAU | 50 | $1,500 | \~$73 | 4.9% |
| 10K MAU | 500 | $15,000 | \~$735 | 4.9% |
| 100K MAU | 5,000 | $150,000 | \~$7,350 | 4.9% (volume discount kicks in at $100K/mo — likely 2.4% \+ $0.30 negotiated rate → \~$3,750, effective 2.5%) |

**Migration inflection point:**

At \>$100K/month processing volume, **negotiate Stripe down** to \~2.4% \+ $0.30 (custom rate). At \>$1M/month, consider direct merchant account \+ Adyen (3.75-3.95% \+ $0.13 — competitive at scale with negotiation). **Lyceon trigger criterion (target-state):** when monthly subscription revenue exceeds $50K, initiate Stripe sales conversation for custom rate. Migration to alternative provider deferred to revenue-side decision (Doc 09 territory).

**Launch-required configuration:**

| Setting | Value at launch | Rationale |
| ----- | ----- | ----- |
| Stripe Radar (fraud detection) | Enabled, default rules | Free with Stripe; reduces dispute risk |
| Stripe Tax | Enabled if launching in jurisdictions requiring sales tax collection | Compliance-driven |
| Webhook idempotency | Per Doc 06A §10 release-gate manifest (event ledger pattern) | Inherited; not 06E-owned |
| Transaction-rate monitoring | Per §11 | 06E-owned |

**Cost-observation source:** Stripe Dashboard \+ Stripe Reporting API. Stripe is a different shape from infra-cost vendors — `ops/cost-budget-conformance` (V1.1+) does NOT include Stripe; Stripe gets its own §11 monitoring instead.

## **7.7 Sentry — Error Tracking & Performance Monitoring**

**Pricing tier structure (verified 2026-05-22):**

| Tier | Monthly base | Included |
| ----- | ----- | ----- |
| Developer (free) | $0 | 5K errors/month, 1 user |
| Team | $26/month | 50K errors, multi-user |
| Business | $80/month | **50K errors included**; PAYG/reserved volume billed beyond at on-demand rates; advanced features (Insights, SSO, anomaly detection) |
| Enterprise | Custom | Custom event volumes |

Overage rate: \~$0.000290/event (errors) at on-demand PAYG; reserved-volume rates lower with commitment. Performance spans, session replays, profiling samples each metered separately.

**Cost-driver KPIs:**

1. **Events per DAU per day** \= (DAU × error\_rate); production-target error rate \<0.1% of sessions  
2. **Replay sample rate** — Sentry recommends 10-20% in production; 100% captures everything but costs significantly more  
3. **Performance trace sample rate** — separate meter from errors  
4. **Profile sample rate** — separate meter  
5. **Spike risk:** a deploy introducing a logging-loop bug can generate 10M+ errors in hours, exhausting plan quota in a single incident

**Lyceon-specific cost-per-user formula:**

monthly\_sentry\_cost ≈  
    plan\_base  
  \+ max(0, total\_events − included\_quota) × $0.000290  
    
where total\_events ≈ DAU × days × error\_rate × replay\_amplification

For Lyceon working estimate: DAU ≈ MAU × 0.2 (20% daily active); error\_rate 0.05% (5 errors per 10K sessions, production-grade); replay 15% sample.

**Lyceon scale projections:**

| Scale | DAU | Events/mo (errors only) | Est. monthly cost |
| ----- | ----- | ----- | ----- |
| 1K MAU | 200 | \~3K | $26 (Team plan required for multi-user team; well within 50K included) |
| 10K MAU | 2K | \~30K | $26 (Team plan; within 50K included) |
| 100K MAU | 20K | \~300K | $80 \+ ((300K − 50K) × $0.000290) ≈ $80 \+ $72.50 \= **\~$152** (Business tier with PAYG overage) |

**Migration inflection point:**

At \>2M events/month sustained (Business overages getting painful), evaluate **self-hosted Sentry** on a small VM (\~$50/month VM cost \+ ops burden) — saves $500+/month at high volume. Alternative SaaS: Highlight.io, PostHog Errors at lower per-event rates. **Lyceon trigger criterion (target-state):** sustained event volume \> 2M/month for 2 consecutive months. Migration cost: MEDIUM — self-hosting is well-documented; alternative SaaS migrations are easier than infra-vendor migrations.

**Launch-required substrate-cap configuration:**

| Layer 1 setting | Value at launch | Rationale |
| ----- | ----- | ----- |
| Plan tier | Team ($26/month) at minimum for multi-user team | Required regardless of cost — going blind during an incident is asymmetrically costly |
| Overage policy | OFF (drop events when quota exceeded) | Avoids surprise $500+ overage from logging-loop bugs; accepts visibility loss during a quota-exhausting event |
| Replay sample rate | 15% (Sentry recommended production default) | Balances cost vs. debugging utility |
| Performance trace sample rate | 10% | Production-grade sample rate |
| Inbound filters | Enable noisy-error and bot filtering | Standard Sentry production discipline |

**Cost-observation source:** Sentry Billing API \+ organization dashboard.

## **7.8 GitHub Actions — CI/CD**

**Pricing tier structure (verified 2026-05-22; reflects Jan 2026 \+ March 2026 changes):**

| Plan | Per-user/month | Included private-repo minutes (Linux) |
| ----- | ----- | ----- |
| Free | $0 | 2,000/month |
| Team | $4 | 3,000/month |
| Enterprise | $21 | 50,000/month |

Per-minute rates after included quota (Linux 2-core, post-Jan-2026 40% price reduction):

* **Linux 2-core (hosted): $0.006/min** — the $0.002/min Actions platform fee is **already included** in this rate (per GitHub's January 2026 pricing announcement). No double-count.  
* **Windows: $0.010/min** (platform fee included)  
* **macOS: $0.048/min** (down from $0.080; platform fee included)  
* **Self-hosted runners on private repos** — GitHub announced a $0.002/min platform fee for self-hosted runner usage on December 16, 2025, with a planned effective date of March 1, 2026\. Following community pushback, **GitHub postponed the change indefinitely on December 18, 2025** to re-evaluate its approach (per GitHub's official changelog announcement). As of May 2026, self-hosted runner usage on private repos remains free; no replacement timeline has been announced. **Treat self-hosted runner pricing as volatile and verify GitHub's current billing documentation before any migration decision.** Public repos and Enterprise Server are unaffected and remain free.

Public repos: unlimited free minutes on all plans.

**Cost-driver KPIs:**

1. **Builds per week** — driven by PR volume \+ push frequency  
2. **Minutes per build** — typed monorepo with full test suite typically 5-15 min  
3. **Failed-build retries** — silent driver; runaway re-runs from flaky tests can 3x effective cost  
4. **macOS usage** — 6x Linux rate; iOS/native builds drive this

**Lyceon-specific cost-per-user formula:**

CI/CD cost scales with engineering team activity, not Lyceon end-user MAU. Two separate cost drivers (per RB-06E-V1-12): seat fees scale with team size; included Actions minutes are a per-account/per-organization quota that does NOT scale with team size.

monthly\_github\_actions\_cost ≈  
    $4 × team\_size                                    \# Team seat fees scale per user  
  \+ max(0, monthly\_linux\_minutes − 3\_000) × $0.006   \# Team plan: 3,000 included minutes PER ACCOUNT, not per seat

Per GitHub Billing documentation: each GitHub account receives a quota of free minutes and storage for GitHub-hosted runners depending on the account's plan. The Team plan includes 3,000 Actions minutes per month per organization, regardless of seat count; the per-seat fee ($4/user/month) is independent of the included-minutes pool.

Working estimate: 5-person eng team; 50 builds/week × 8 min/build × 4 weeks \= \~1,600 min/month per developer; team total \~8,000 min/month.

**Lyceon scale projections (engineering team scaling, not user scaling — RB-06E-V1-12 corrected):**

| Team size | Monthly Linux minutes | Plan | Seat fees | Overage cost | Est. monthly cost |
| ----- | ----- | ----- | ----- | ----- | ----- |
| 3 engineers | \~5,000 | Team | $12 ($4 × 3\) | (5,000 − 3,000) × $0.006 \= $12 | **\~$24** |
| 5 engineers | \~8,000 | Team | $20 ($4 × 5\) | (8,000 − 3,000) × $0.006 \= $30 | **\~$50** |
| 10 engineers | \~16,000 | Team | $40 ($4 × 10\) | (16,000 − 3,000) × $0.006 \= $78 | **\~$118** |

**Migration inflection point:**

At \>10K minutes/month, evaluate **self-hosted runners** on existing GCP infrastructure (no platform fee as of May 2026 per GitHub's December 2025 postponement of the originally-planned March 2026 self-hosted charge — see RB-06E-V1-13 below; treat self-hosted runner pricing as volatile and verify GitHub's current billing documentation before migration). Or public-repo strategy where applicable (free unlimited minutes — only viable for OSS). **Lyceon trigger criterion (target-state):** sustained \> 10K minutes/month for 2 consecutive months. Migration cost: LOW — self-hosted runners are well-supported; CI workflow files unchanged.

**Launch-required substrate-cap configuration:**

| Layer 1 setting | Value at launch | Rationale |
| ----- | ----- | ----- |
| Plan | Team ($4/user/month) | **3,000 included GitHub-hosted Actions minutes/month per organization/account** (NOT per seat — only the $4/user/month seat fee scales with team size); overage billed at $0.006/min for baseline Linux hosted runners per RB-06E-V1-12/14 |
| Workflow timeout | 60 minutes per job (default) | Prevents stuck-job runaway |
| Concurrency limits | Configured per critical workflow | Prevents redundant runs on rapid pushes |

**Cost-observation source:** GitHub Billing dashboard \+ Actions usage report.

## **7.9 Quarterly verification cadence**

Per §13.4 schedule, every Tier-1 subsection in §7 is verified against vendor pricing pages quarterly. Pricing changes trigger in-lock-cycle cleanup (no version bump per Parent §8); a §20 change-record row is appended; `infra/vendor-pricing-snapshot.yaml` updates in lockstep. Material pricing changes (\>10% rate change OR new metered category introduced) require explicit Founder/CTO review before applying.

---

# **§8 — Composite Lyceon Cost-Modeling Formulas**

Combining §7 per-vendor formulas into platform-total cost as a function of user-driven KPIs.

## **8.1 Platform-total monthly cost (V1 estimate)**

monthly\_total\_cost ≈  
    vercel\_cost(MAU, sessions\_per\_user, page\_weight)            \# §7.1  
  \+ supabase\_cost(MAU, concurrent\_users, db\_storage, egress)    \# §7.2  
  \+ vertex\_ai\_cost(active\_lisa\_users, queries\_per\_user, mix)    \# §7.3  
  \+ cloud\_run\_cost(total\_lisa\_requests, duration\_per\_request)   \# §7.4  
  \+ cloudflare\_cost ≈ 0                                          \# §7.5  
  \+ stripe\_cost(monthly\_revenue, paying\_subscribers)             \# §7.6 (revenue-coupled)  
  \+ sentry\_cost(DAU, error\_rate, replay\_sample)                  \# §7.7  
  \+ github\_actions\_cost(team\_size, builds\_per\_week)              \# §7.8 (engineering, not MAU-coupled)

## **8.2 Lyceon scale projections (composite)**

Assumptions documented per §7 subsections. Engineering CI/CD cost (§7.8) and Stripe revenue-coupled cost (§7.6) shown separately from MAU-driven infrastructure cost. **All numbers recomputed in CR-06E-04 / RB-06E-V1-09 against corrected §7 per-vendor formulas (Vertex cache-discount-on-input-only, Cloud Run request-rate arithmetic, GitHub Actions platform-fee-already-included, Cloudflare annual-vs-monthly, Sentry Business 50K-included, Vercel Edge Requests added, Supabase PITR launch-required \+ pooling).**

| Scale | MAU | Infra cost (§7.1+§7.2+§7.3+§7.4+§7.5+§7.7) | Stripe cost (assumes 5% conversion @ $30/mo) | CI/CD cost (5-eng team baseline) | Total monthly platform cost | Cost per MAU |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| Pre-launch (0 MAU; eng-only) | 0 | $25 \+ $100 PITR (Supabase Pro test bed) \+ $20 (Vercel Hobby→Pro test bed) \+ $0 (Vertex if no test traffic) \+ $26 (Sentry Team) ≈ $171 | $0 | $20-40 (Team plan, 5 eng) | **\~$200/month** | N/A |
| 1K MAU | 1,000 | $20 (Vercel) \+ $125 (Supabase Pro Micro \+ PITR) \+ $204 (Vertex/LISA) \+ $0 (Cloud Run) \+ $0 (CF) \+ $26 (Sentry Team) ≈ $375 | \~$73 | **\~$50** (5-eng baseline per RB-06E-V1-12/14) | **\~$498/month** | $0.50 |
| 10K MAU | 10,000 | $22 (Vercel) \+ $175 (Supabase Pro \+ Small/Medium \+ PITR) \+ $2,035 (Vertex/LISA) \+ $0 (Cloud Run) \+ $0 (CF) \+ $26 (Sentry Team — at 50K quota cap) ≈ $2,258 | \~$735 | **\~$50** (5-eng baseline) | **\~$3,043/month** | $0.30 |
| 100K MAU | 100,000 | \~$1,371 (Vercel — bandwidth dominates, edge-requests add \~$66) \+ \~$235 (Supabase \+ Large \+ PITR) \+ $20,350 (Vertex/LISA) \+ \~$26 (Cloud Run) \+ $0 (CF — or $20-$200 if WAF needed) \+ $152 (Sentry Business \+ PAYG overage) ≈ $22,134 | \~$3,750 (volume discount kicked in) | **\~$118** (10-eng baseline; engineering team scales with company growth) | **\~$26,002/month** | $0.26 |

**Key observation (post-correction):** LISA inference cost (Vertex AI per §7.3) still dominates infrastructure cost — \~54% of total infra cost at 1K MAU, \~90% at 10K MAU, \~92% at 100K MAU. **Doc 03 Main §24 LISA cost discipline remains the single highest-leverage cost-control mechanism in the platform.** PITR baseline ($100/month) is the next-largest fixed cost — material at low scale (\~27% of 1K MAU infra), absorbed into the LISA-dominated total at scale.

**Cost-per-MAU declines with scale** as Pro-plan base costs and PITR amortize across more users — common SaaS infrastructure pattern. Lyceon cost-per-MAU stabilizes around $0.26-0.30/MAU at moderate scale and above. At 1K MAU the cost-per-MAU is materially higher (\~$0.50, updated from \~$0.47 per RB-06E-V1-14 CI/CD recomputation) because the $100 PITR \+ \~$45 Vercel/Sentry/Supabase-base fixed costs \+ \~$50 CI/CD baseline spread across only 1K users.

## **8.3 Per-paying-subscriber unit economics (working estimate)**

For a $30/month student subscription at projected scale (\~5% MAU paying):

revenue\_per\_paying\_subscriber  \= $30.00  
stripe\_cost\_per\_subscriber     \= $1.46                    \# §7.6  
infra\_cost\_per\_paying\_subscriber ≈ $0.30 × (1/0.05) \= $6  \# 1 paying subscriber subsidizes \~20 free MAU  
contribution\_per\_paying\_subscriber ≈ $30 − $1.46 − $6 \= $22.54  
gross\_margin ≈ 75%

**Caveat:** unit economics modeling is V1.1+ territory (Doc 09 — FWD-06-05). The figure above is illustrative — Doc 09 will own canonical unit economics including non-infra cost lines (customer acquisition cost, content costs, support, etc.) that 06E does not include. 06E §8 covers infra-cost-per-user only; Doc 09 covers total CAC \+ contribution margin.

## **8.4 Capacity / concurrent-user cost implications**

The §7 per-vendor formulas express monthly cost; capacity concerns are about **peak concurrent load**, not monthly aggregates. Two vendors have capacity cliffs at concurrent-user thresholds:

| Vendor | Concurrent-user cliff | Cost impact |
| ----- | ----- | ----- |
| Supabase | \~40-50 concurrent DB connections (Micro compute saturates) | Step function: Micro → Small (+$15) → Medium (+$60) → Large (+$110) |
| Cloud Run | max-instances limit (per Doc 03C §28) | Linear: more concurrent users → more CPU-seconds; no cliff |

Vercel, Vertex AI, Cloudflare, Stripe, Sentry, GitHub Actions have no concurrent-user cliffs — they scale linearly with throughput.

**Concurrent-user estimate for Lyceon:** at 10K MAU with 20% DAU and 5% peak-concurrent, peak ≈ 100 concurrent users → Supabase Medium compute required → \+$60/month captured in §7.2 scale projection.

## **8.5 What's NOT in §8**

* Per-feature cost attribution ("what does each tutor session cost?"): FWD-06-05 / Doc 09\.  
* Customer acquisition cost: FWD-06-05 / Doc 09\.  
* Content production cost: FWD-06-05 / Doc 09\.  
* Support cost: FWD-06-05 / Doc 09\.  
* Multi-region cost differentials: target-state V1.1+ per §12.

---

# **§9 — Capacity-Projection Mechanism (Q-06E-3 \= c \+ e)**

## **9.1 Three-cadence model**

Per Q-06E-3 locked decision: three distinct cadences with different purposes.

| Cadence | Trigger | Purpose | Output |
| ----- | ----- | ----- | ----- |
| **Monthly baseline** | Calendar-month boundary | Lightweight watchdog: catches drift before it accumulates | Auto-generated monthly capacity report — observed utilization per Tier-1 vendor; trend vs prior month; flags any vendor above 70% utilization |
| **Quarterly deep deliverable** | Calendar-quarter boundary | Strategic capacity review with stakeholders | Formal capacity projection: 3-month and 12-month forward projection per Tier-1 vendor; inflection-point proximity assessment; compute-tier upgrade recommendations; pricing-snapshot re-verification |
| **Triggered ad-hoc** | Utilization \> 70% on any tracked resource | Early-warning: heading toward a wall faster than monthly cadence detects | Targeted projection: when will the resource hit 100%? What's the substrate-cap upgrade path? Warn alert to platform/CTO on-call |

## **9.2 Tracked resources per vendor**

Resources monitored for utilization (used to trigger §9.1 70%-utilization alerts):

| Vendor | Resource | Utilization metric |
| ----- | ----- | ----- |
| Vercel | Bandwidth | `monthly_bandwidth_GB / 1024` (Pro plan 1 TB included) |
| Vercel | Function invocations | `monthly_invocations / 1_000_000` (Pro plan 1M included) |
| Supabase | MAU | `current_MAU / 100_000` (Pro plan 100K included) |
| Supabase | DB compute connections | `peak_concurrent_connections / 50` (Micro saturation) |
| Supabase | Storage | `db_storage_GB / 8` (Pro plan 8 GB DB) \+ `file_storage_GB / 100` (Pro plan 100 GB file) |
| Supabase | Egress | `monthly_egress_GB / 250` (Pro plan 250 GB) |
| Sentry | Event quota | `monthly_events / plan_included_events` |
| Vertex AI | Per Doc 03 Main §24 utilization | Referenced from Doc 03 Main §24 — never restated |
| Cloud Run | Per Doc 03C V3.0 §11.3 / §28 | Referenced |
| Cloudflare | N/A at launch (free tier well underutilized) | N/A |
| Stripe | N/A (revenue-coupled, not capacity-bounded) | N/A |
| GitHub Actions | Monthly minutes | `monthly_minutes / plan_included_minutes` |

## **9.3 Proving mechanism — `ops/capacity-projection-monthly-baseline` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| **launch\_required** | true |
| Execution location | Scheduled job (Vercel Cron); registered in 06C §8.2 scheduled-job registry as `JOB-CAPACITY-PROJECTION` with external\_watchdog substrate per 06C §8.7 discipline |
| Trigger cadence | Monthly (calendar-month boundary, day 1 UTC) |
| Input registry | `infra/vendor-inventory.yaml` (Tier-1 list) \+ per-vendor billing API observations (independent of Lyceon-derived metrics per 06B §8.6) \+ `infra/vendor-pricing-snapshot.yaml` (current pricing) |
| Failure condition | (a) any Tier-1 vendor's monthly observation fetch fails (timeout/non-2xx/parse): record `observed_utilization = NULL` \+ `outcome = 'partial'` \+ post a Warn alert per 06C §6 crosswalk; never silently pass; (b) any Tier-1 vendor exceeds 70% utilization on any tracked resource — Warn alert \+ triggers ad-hoc projection per §9.1; (c) any Tier-1 vendor exceeds 90% utilization — Page alert (cliff imminent) |
| Proof artifact | `capacity-projection-monthly-baseline` record per Parent §10.5 \+ extras (§14): `vendors_observed[]`, per-vendor `{vendor_id, resource_name, observed_value, plan_included_value, observed_utilization, trend_vs_prior_month, alert_fired_if_any, decision}`. Subject to §8.7 no-PII rule per family-wide convention. |
| Owner / paging | Platform/CTO; per 06C §11 unified rotation |
| **launch\_required rationale** | Capacity walls are the highest-likelihood failure mode at launch (Lyceon will hit Pro-plan thresholds as MAU scales). Monthly cadence is the minimum-viable watchdog. Quarterly deep deliverable (§9.4) is the strategic deliverable but is a documentation deliverable, not a real-time mechanism. |

## **9.4 Quarterly deep capacity deliverable**

The quarterly deep deliverable is a **documentation artifact**, not a paging mechanism. It is owned by Founder/CTO and produced by reviewing the monthly baseline outputs (§9.3) over the prior 90 days \+ projecting forward 90 days and 365 days per Tier-1 vendor.

Format: a markdown report at `docs/capacity-reviews/<YYYY-QN>.md` containing:

\# Lyceon Capacity Review \<YYYY-QN\>

\#\# Executive summary  
\- Highest-risk vendor over next 90 days: \<vendor\> at \<%\> projected utilization  
\- Inflection-point alerts: \<vendors approaching migration threshold\>

\#\# Per-vendor analysis (Tier-1)  
For each: observed prior-quarter utilization trend; projected next-quarter; projected next-year; inflection-point proximity (vs §7 documented thresholds); recommended action (no action / compute upgrade / migration trigger).

\#\# Pricing-snapshot review  
Re-verification result against vendor pricing pages: confirmed / changes detected. If changes detected: §7 \+ §13 cleanup applied in-lock-cycle.

\#\# Recommendations  
\- Compute upgrades to schedule  
\- Migration triggers approaching (if any)  
\- Pricing-renegotiation opportunities (e.g., Stripe volume discount at $50K/mo revenue)

This deliverable is launch\_required: **false** (target-state-V1.1 deliverable timing). At V1 launch, the first quarterly deep review happens 90 days post-launch. The deliverable shape is locked here in §9.4 so it produces immediately on schedule.

## **9.5 Proving mechanism — `ci/capacity-review-deliverable-cadence` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| **launch\_required** | false (V1.1 cadence enforcement; V1 ships the shape contract) |
| Execution location | Scheduled CI check (GitHub Actions, monthly) verifying `docs/capacity-reviews/` filesystem |
| Trigger cadence | Monthly |
| Input registry | `docs/capacity-reviews/` filesystem listing |
| Failure condition | (a) no review document for the most recent completed calendar quarter (latency tolerance: 30 days into the new quarter); (b) any existing review document missing one of the required sections per §9.4 |
| Proof artifact | `capacity-review-deliverable-cadence` record per Parent §10.5 \+ extras (§14) |
| Owner / paging | Platform/CTO; non-paging at V1 (V1.1+: Page if cadence missed by \>45 days) |
| **launch\_required: false rationale** | First quarterly review happens 90 days post-launch. Enforcement mechanism activates with the first review-due date. V1 ships the shape contract (§9.4) so the deliverable produces correctly when it arrives. **V1.1 trigger criterion:** activate enforcement on first 90-days-post-launch boundary. |

---

# **§10 — Launch-Required Cost Protection (Layer 1 Substrate Caps)**

## **10.1 Three-layer cost-protection model recap**

Per pre-draft Q-06E-7 reframing locked, three-layer model:

* **Layer 1 (substrate caps):** vendor's native spend-limit mechanism, where supported. Strongest protection — vendor hard-stops account at threshold. **LAUNCH-REQUIRED for every Tier-1 vendor that supports it.**  
* **Layer 2 (06E budget registry with paging alerts):** per-vendor budgets with LISA-style tier shape (hard cap Page / soft alert Warn / target band). **TARGET-STATE V1.1+** — defer until 3-6 months of observed cost data informs threshold-setting. See §12.  
* **Layer 3 (aggregate platform $-cap):** cross-vendor sum check. **TARGET-STATE V1.1+** — see §12.

## **10.2 Layer-1 substrate-cap registry — `infra/substrate-cap-config.yaml`**

The launch-required configuration discipline. Each Tier-1 vendor with a substrate-level cap mechanism gets a registered entry; the substrate cap is configured at deploy time matching the registry value.

substrate\_caps:  
  \- cap\_id: \<stable id; format 'SCAP-\<vendor\>-\<NN\>'\>  
    vendor\_id: \<matches infra/vendor-inventory.yaml\>  
    cap\_mechanism: \<vendor-native mechanism name\>  
    cap\_value: \<numeric value with unit\>  
    cap\_enforcement: \<vendor\_hard\_stop | vendor\_throttle | vendor\_drop | plan\_tier\_ceiling\>  
    canonical\_owner\_doc\_and\_section: \<06E §7.N for 06E-owned values; Doc 03 Main §24 for LISA referenced values\>  
    launch\_required: \<true | false\>  
    notes: \<one-line\>

## **10.3 V1 substrate-cap configuration**

| cap\_id | Vendor | Mechanism | Value at launch | Enforcement |
| ----- | ----- | ----- | ----- | ----- |
| `SCAP-VERCEL-01` | Vercel | "Spend Management" hard cap | $200/month | vendor\_hard\_stop (account paused at cap) |
| `SCAP-SUPABASE-01` | Supabase | Compute-tier discipline | Micro at launch; manual approval for Small+ | manual control |
| `SCAP-SUPABASE-02` | Supabase | MAU plan-tier ceiling | 100K (Pro plan) | overage billed; alerted at 80K via §9 |
| `SCAP-SUPABASE-03` | Supabase | **Supavisor transaction-mode pooling** (RB-06E-V1-08) | **REQUIRED at launch** — all API-route DB access through Supavisor | configuration check at deploy; without pooling, concurrency estimates are invalid |
| `SCAP-SUPABASE-04` | Supabase | **PITR 7-day retention** (RB-06E-V1-01) | **$100/month — launch-required per Doc 06D §13 backup substrate canonical** | **referenced; never restated** — Doc 06D owns the body |
| `SCAP-VERTEX-01` | GCP Vertex | Per-user query caps | Per Doc 03 Main §24 | **referenced; never restated** |
| `SCAP-VERTEX-02` | GCP Vertex | Project-level budget alert | $500/month total Vertex spend | GCP budget alert \+ email |
| `SCAP-CLOUDRUN-01` | Cloud Run | max-instances per service | Per Doc 03C V3.0 §28 | **referenced; never restated** |
| `SCAP-SENTRY-01` | Sentry | Plan-tier ceiling | Team plan; overage OFF (events dropped, not billed) | vendor\_drop (events lost; visibility loss acceptable vs surprise bill) |
| `SCAP-GITHUB-01` | GitHub Actions | **Team plan included-minute ceiling** | **Team plan 3,000 minutes/month per organization/account** (NOT per seat — per RB-06E-V1-12/14); workflow timeout 60min | plan\_tier\_ceiling \+ manual approval for overage |

Cloudflare and Stripe do not appear: Cloudflare has no spike risk at launch (free tier covers everything); Stripe is revenue-coupled (transaction-rate monitoring per §11 instead of substrate cap).

## **10.4 Proving mechanism — `ci/substrate-cap-config-parity` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| **launch\_required** | true |
| Execution location | GitHub Actions, on PRs touching `infra/substrate-cap-config.yaml` or `infra/vendor-inventory.yaml`; plus nightly |
| Trigger cadence | Per PR \+ nightly |
| Input registry | `infra/substrate-cap-config.yaml` \+ `infra/vendor-inventory.yaml` (Tier-1 vendors with `launch_required_substrate_cap: true`) |
| Failure condition | (a) any Tier-1 vendor in `infra/vendor-inventory.yaml` with `launch_required_substrate_cap: true` without a corresponding entry in `infra/substrate-cap-config.yaml`; (b) any cap entry whose `canonical_owner_doc_and_section` does not resolve; (c) any cap value referencing Doc 03 Main §24 (the LISA owned values) without explicit `referenced; never restated` annotation; (d) any cap entry with `launch_required: true` and unset `cap_value` |
| Proof artifact | `substrate-cap-config-parity` record per Parent §10.5 \+ extras (§14): `caps_checked[]`, per-cap `{cap_id, vendor_id, mechanism, value, enforcement, canonical_owner_resolution, launch_required, decision}` |
| Owner / paging | Platform/CTO; PR-blocking |
| **launch\_required rationale** | Substrate caps are the catastrophic-failure protection layer. A misconfigured (or absent) substrate cap exposes Lyceon to runaway-cost spikes that can burn weeks of runway in hours. Configuration discipline must be enforced at the launch gate. |

## **10.5 Verification that substrate caps are actually configured (not just declared)**

`ci/substrate-cap-config-parity` (§10.4) verifies the YAML registry is consistent. A separate verification — **that the vendor account actually has the cap configured matching the registry** — is target-state V1.1+ because it requires vendor-API integration per vendor and that integration is non-trivial. At V1 the discipline is **manual quarterly review** included in the §9.4 quarterly capacity deliverable: confirm Vercel account spend cap is set to $200; confirm Sentry plan tier; confirm GCP budget alert exists; etc. Documented as a checklist item in the quarterly review template (§9.4).

Quarterly manual verification is a **launch\_required: true** discipline (the discipline itself, not an automated mechanism). The automation is V1.1+.

---

# **§11 — Stripe Transaction-Rate Monitoring (Separate Shape from Cost Budgets)**

## **11.1 Why Stripe gets its own §**

Stripe cost is revenue-coupled (per §7.6), not infrastructure-coupled. A Stripe "cost spike" is either (a) a revenue spike (good) or (b) a dispute/chargeback storm (bad — fraud pattern, billing bug, customer-experience regression). The shape of monitoring is fundamentally different from infrastructure cost alerts — instead of "$ over threshold," we track **rate-based metrics** (chargeback rate, failed-transaction rate, dispute rate per customer cohort).

## **11.2 Tracked rates**

| Rate | Definition | Healthy range | Page threshold |
| ----- | ----- | ----- | ----- |
| **Chargeback rate** | (chargebacks in last 30 days) / (successful transactions in last 30 days) | \<0.5% | \>1.0% sustained for 7 days |
| **Failed-transaction rate** | (failed transactions in last 24 hours) / (total transaction attempts in last 24 hours) | \<2% | \>5% sustained for 4 hours |
| **Failed-renewal rate (subscription)** | (failed subscription renewals in last 7 days) / (total renewal attempts in last 7 days) | \<8% (industry SaaS) | \>15% for 3 days |
| **Dispute-per-customer ratio (subscription)** | (customers with disputes in last 90 days) / (paying customers) | \<0.5% | \>1.0% |

The 1.0% chargeback threshold is significant: Stripe imposes increased monitoring at \>0.65% chargeback ratio and may suspend processing at higher ratios. Triggering this threshold has business consequences beyond just the $15-per-dispute cost.

## **11.3 Proving mechanism — `ops/stripe-transaction-rate-monitor` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| **launch\_required** | true |
| Execution location | Scheduled job (Vercel Cron); registered in 06C §8.2 scheduled-job registry as `JOB-STRIPE-TRANSACTION-RATE` with external\_watchdog substrate per 06C §8.7 |
| Trigger cadence | Hourly (for failed-transaction rate which is fast-moving) \+ daily aggregate (for chargeback / dispute rates which are slow-moving) |
| Input registry | Stripe Reporting API (chargebacks, transactions, disputes, subscription events) — independent of Lyceon-derived metrics per 06B §8.6 |
| External-fetch failure semantics | If Stripe API fetch fails (timeout/non-2xx/parse): record observed rates as NULL \+ post a Warn alert per 06C §6 crosswalk; retry on next trigger; never silently pass. (06C P18 discipline applied.) |
| Failure condition | (a) chargeback rate \> 0.65% — Warn (Stripe's monitoring threshold); (b) chargeback rate \> 1.0% sustained 7 days — Page (Stripe suspension risk); (c) failed-transaction rate \> 5% sustained 4 hours — Page (billing-system regression); (d) failed-renewal rate \> 15% sustained 3 days — Warn (churn signal); (e) dispute-per-customer ratio \> 1.0% — Page (fraud pattern signal); (f) any rate fetched as NULL with no subsequent successful fetch for 6 hours — Page (monitoring blind) |
| Proof artifact | `stripe-transaction-rate-monitor` record per Parent §10.5 \+ extras (§14): `rates_observed`, per-rate `{rate_name, observed_value, threshold, decision, sustained_duration_if_breaching}`. Subject to §8.7 no-PII rule — customer identities never appear in proof artifact; aggregate rates only. |
| Owner / paging | Founder \+ ops-lead (chargeback/dispute issues are founder/CTO scope; involves fraud \+ customer-experience signals); per 06C §11 unified rotation |
| **launch\_required rationale** | Stripe processing suspension is a platform-stopping event (no billing \= no revenue). Early detection of chargeback patterns is preventive — once Stripe puts the account in increased monitoring, downstream effects (held funds, manual review delays) materially harm the business. Failed-transaction-rate detection catches billing bugs introduced by deploys. |

## **11.4 Note on volume-discount monitoring (target-state)**

Tracking Stripe volume to identify when to negotiate custom rates (\>$50K/month) is **target-state V1.1+** — until revenue is flowing at that scale, the optimization is premature. Surfaced in §12.

---

# **§12 — Target-State Cost Mechanisms (V1.1+)**

## **12.1 What lives here**

Per §4 launch-vs-target convention: mechanisms specified for clarity and downstream consumer reference but **not built at V1**. Every entry includes a V1.1 trigger criterion stating when the mechanism graduates to launch-required.

## **12.2 Layer 2 budget registry with paging alerts (V1.1+)**

**Shape:**

cost\_budgets:  
  \- budget\_id: CB-\<vendor\>-\<NN\>  
    vendor\_id: \<ref to infra/vendor-inventory.yaml\>  
    canonical\_owner: \<06E §7.N or Doc 03 Main §24 for LISA\>  
    cost\_driver: \<e.g. bandwidth, MAU, events, etc.\>  
    risk\_profile: \<high | medium | low\>  
    hard\_cap\_usd\_per\_month: \<int\>           \# Page on breach  
    soft\_alert\_usd\_per\_month: \<int\>         \# Warn on breach  
    target\_band\_usd\_per\_month: \<int\>        \# informational below  
    cost\_observation\_source: \<vendor billing API\>  
    alert\_id\_hard: ALERT-COST-\<vendor\>-HARD  \# source\_class doc06e\_event  
    alert\_id\_soft: ALERT-COST-\<vendor\>-SOFT  
    launch\_required: false                   \# target-state

**Mechanism:** `ops/cost-budget-conformance` — scheduled monthly \+ on-budget-change PR; fetches per-vendor observed monthly spend; compares to budget thresholds; fires alerts per the tiered structure.

**V1.1 trigger criterion:** activate when 3 months of observed cost data per Tier-1 vendor exist (sufficient to set thresholds against actuals rather than guesses). Earliest activation: 90 days post-launch.

## **12.3 Layer 3 aggregate platform $-cap (V1.1+ — later)**

**Shape:** cross-vendor sum of monthly spend with a single aggregate threshold (Page on breach). Catches DDoS-style runaway scenarios crossing multiple vendors.

**V1.1 trigger criterion:** activate after Layer 2 has been operational for 6 months (operational maturity needed before adding aggregate layer that depends on per-vendor inputs).

## **12.4 Modeled-vs-actual cost reconciliation (V1.1+)**

**Shape:** monthly comparison of §7 formula-projected cost (per vendor) against actual observed cost. Divergence \> 50% fires Warn alert and triggers §7 documentation review.

**V1.1 trigger criterion:** activate after 6 months of observed data and at least one quarterly capacity-review cycle.

## **12.5 Per-feature cost attribution (V1.1+ — likely Doc 09\)**

**Shape:** cost-per-tutor-session, cost-per-exam-completed, cost-per-prep-plan, cost-per-paying-subscriber-acquisition. Likely owned by Doc 09 — FWD-06-05 bounded forward-ref. 06E references; doesn't own the body.

**V1.1 trigger criterion:** when Doc 09 drafts. 06E may register a thin §12 wrapper if needed for cost-attribution-to-vendor traceability.

## **12.6 Tier-2 vendor SLA tracking discipline (V1.1+)**

**Shape:** Tier-2 vendors (Postman, Fern, Anthropic, OpenAI) graduate from V1 informational entries to formal SLA tracking — quarterly review of SLA performance, alert routing, vendor-management protocol. Mirrors Tier-1 §6 outage-runbook discipline at lighter weight.

**V1.1 trigger criterion:** activate when any Tier-2 vendor has caused engineering disruption ≥ 4 hours in any 30-day window OR when any Tier-2 vendor cost exceeds $200/month sustained.

## **12.7 Vendor-pricing-snapshot automated verification (V1.1+)**

**Shape:** automated quarterly fetch from vendor pricing pages (HTML scraping or RSS where available) to detect pricing changes proactively. At V1 this is **manual quarterly review** per §13.4.

**V1.1 trigger criterion:** when more than 2 vendors have changed pricing within a single quarter (indicates manual cadence is insufficient).

## **12.8 Multi-region failover doctrine (V1.1+)**

**Shape:** for each Tier-1 vendor that supports multi-region, document the failover topology \+ recovery procedure. At V1 Lyceon runs single-region (US-Central for GCP/Supabase; default Vercel US East).

**V1.1 trigger criterion:** when Lyceon serves users in multiple primary regions OR when any Tier-1 vendor's single-region failure has impacted Lyceon for \>2 hours in any 12-month window.

## **12.9 Vendor consolidation analysis (V1.1+)**

**Shape:** periodic review of "are we using too many vendors for what could be done with fewer?" — e.g., could R2 replace Supabase Storage for files? Could Cloudflare Workers absorb some Vercel functions?

**V1.1 trigger criterion:** quarterly capacity review (§9.4) identifies overlap.

---

# **§13 — Vendor Pricing Snapshot Registry (Q-06E-9 \= c Hybrid)**

## **13.1 Scope**

Per Q-06E-9=c locked decision: hybrid model — §7 carries current pricing inline for readability AND `infra/vendor-pricing-snapshot.yaml` carries the same values machine-readably for downstream automation. `ci/vendor-pricing-snapshot-parity` enforces inline-vs-YAML parity.

## **13.2 Registry — `infra/vendor-pricing-snapshot.yaml`**

pricing\_snapshots:  
  \- pricing\_snapshot\_id: \<stable id; format 'PS-\<vendor\>'\>  
    vendor\_id: \<matches infra/vendor-inventory.yaml\>  
    last\_verified\_at: \<iso8601\>  
    last\_verified\_by: \<user id who verified\>  
    rate\_entries:  
      \- rate\_name: \<e.g. 'bandwidth\_overage\_per\_gb'\>  
        unit: \<e.g. 'usd\_per\_gb', 'usd\_per\_million\_input\_tokens'\>  
        value: \<numeric\>  
        applies\_when: \<e.g. 'beyond\_1tb\_included', 'tier\_pro\_plan'\>  
        section\_ref: \<06E §7.N where this rate appears inline\>  
    notes: \<one-line\>

## **13.3 Proving mechanism — `ci/vendor-pricing-snapshot-parity` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| **launch\_required** | true |
| Execution location | GitHub Actions, on PRs touching `infra/vendor-pricing-snapshot.yaml` or `Doc_06E_*.md`; plus nightly |
| Trigger cadence | Per PR \+ nightly |
| Input registry | `infra/vendor-pricing-snapshot.yaml` \+ parsed §7 inline values from Doc 06E |
| Failure condition | (a) any `pricing_snapshots[].rate_entries[].value` not matching the corresponding inline value at the cited `section_ref` (numeric mismatch); (b) any §7 inline numeric value not present in the snapshot registry (inline value without backing registry entry); (c) any `last_verified_at` older than 100 days (quarterly cadence \+ 10-day grace); (d) any `vendor_id` not resolving in `infra/vendor-inventory.yaml`; (e) any Tier-1 vendor without a corresponding pricing snapshot entry |
| Proof artifact | `vendor-pricing-snapshot-parity` record per Parent §10.5 \+ extras (§14): `snapshots_checked[]`, per-snapshot `{pricing_snapshot_id, vendor_id, rate_count, inline_parity_check_pass, last_verified_age_days, decision}` |
| Owner / paging | Platform/CTO; PR-blocking |
| **launch\_required rationale** | The Q-06E-9=(c) hybrid model's value depends on inline-vs-registry consistency. Without parity enforcement, the registry and the doc drift, defeating the purpose of the hybrid. |

## **13.4 Quarterly re-verification cadence**

Every quarter (calendar-quarter boundary), each Tier-1 vendor's pricing snapshot is re-verified against the vendor's pricing page:

1. Open vendor pricing page; verify every `rate_entries[].value` matches current public pricing.  
2. If unchanged: update `last_verified_at` only (no value changes).  
3. If changed: apply in-lock-cycle cleanup to both `infra/vendor-pricing-snapshot.yaml` AND §7 inline values; append §20 change-record row; CI parity check re-runs to confirm consistency.  
4. Material pricing changes (\>10% rate change OR new metered category introduced) require explicit Founder/CTO review before applying.

V1 launch ships with the 2026-05-22-verified snapshot per §7. First quarterly re-verification due 2026-08-22.

---

# **§14 — Per-Mechanism Envelope Extras (Parent §10.5.1 Extension)**

The Parent §10.5 envelope is canonical; this section extends the §10.5.1 per-mechanism extra-field matrix with 06E's mechanisms. **Every artifact carries `launch_required: bool` as a top-level field** per §4 annotation convention; **every artifact is subject to the §8.7 no-PII rule** (carried family-wide from RB-06D-V1-10).

| Mechanism | Required extra fields |
| ----- | ----- |
| `ci/vendor-inventory-parity` (§5.6) | `vendors_checked[]`, per-vendor `{vendor_id, tier, cost_structure_resolution, runbook_path_existence, pricing_snapshot_link, stack_inventory_coverage, decision}`, `launch_required: true` |
| `ci/vendor-runbook-shape-parity` (§6.4) | `runbooks_checked[]`, per-runbook `{vendor_id, runbook_path, required_sections_present, last_modified_at, tbd_or_empty_sections, decision}`, `launch_required: true` |
| `ops/capacity-projection-monthly-baseline` (§9.3) | `vendors_observed[]`, per-vendor `{vendor_id, resource_name, observed_value, plan_included_value, observed_utilization, trend_vs_prior_month, alert_fired_if_any, decision}`, `launch_required: true` |
| `ci/capacity-review-deliverable-cadence` (§9.5) | `most_recent_review_path`, `most_recent_review_age_days`, `required_sections_present`, `decision`, `launch_required: false` |
| `ci/substrate-cap-config-parity` (§10.4) | `caps_checked[]`, per-cap `{cap_id, vendor_id, mechanism, value, enforcement, canonical_owner_resolution, launch_required, decision}`, `launch_required: true` |
| `ops/stripe-transaction-rate-monitor` (§11.3) | `rates_observed`, per-rate `{rate_name, observed_value, threshold, decision, sustained_duration_if_breaching}`, `launch_required: true` |
| `ci/vendor-pricing-snapshot-parity` (§13.3) | `snapshots_checked[]`, per-snapshot `{pricing_snapshot_id, vendor_id, rate_count, inline_parity_check_pass, last_verified_age_days, decision}`, `launch_required: true` |

---

# **§15 — Cross-Document Seam Table (Grounded by Exact §)**

| Seam | 06E side | Canonical owner \+ exact § | Reconciliation status |
| ----- | ----- | ----- | ----- |
| Platform stack inventory | §5.3 / §5.4 vendor list grounded in 06A stack | Doc 06A §3 | RESOLVED — consumer; 06E adds tiering layer |
| Environment matrix | §10 substrate-cap config per environment | Doc 06A §7 | RESOLVED — consumer |
| Backup infrastructure topology (informational) | §6 vendor-outage doctrine for Supabase | Doc 06A §15 | RESOLVED — referenced |
| Privileged-op audit substrate | Substrate-cap config changes are privileged ops | Doc 06B §8 | RESOLVED — consumer (substrate-cap changes audited) |
| Alert routing tiers \+ severity crosswalk | All §9 / §10 / §11 alert classes | 01A §18 (via 06C §6 crosswalk) | RESOLVED — consumer |
| Alert-registry schema (`infra/alert-registry.yaml`) | §7.4 / §9.3 / §11.3 alerts registered | Doc 06C §7 | RESOLVED — consumer; 06E registers entries |
| Severity-crosswalk source\_class enum extension (RB-06E-V1-introduced) | §7.4 / §9.3 / §11.3 alerts use `source_class = doc06e_event` | Doc 06C §6 \+ §7 — **CR-06C-06 post-lock additive required (bundled with CR-06C-05 from 06D as a single 06C cleanup)** | OPEN — bounded (W3); 06E spec-locks with the obligation declared; 06C-owner applies RB-06C-V1-16 |
| Scheduled-job heartbeat substrate | §9.3 / §11.3 / §10.4 registered scheduled jobs | Doc 06C §8 (`infra/scheduled-job-registry.yaml` \+ heartbeat table) | RESOLVED — consumer |
| Scheduled-job external\_watchdog discipline | §9.3 / §11.3 registered jobs carry external\_watchdog blocks | Doc 06C §8.7 (RB-06C-V1-01) | RESOLVED — applied |
| Incident lifecycle base table \+ transition RPC | §6.5 vendor-outage incidents | Doc 06C §10 (`incidents`, `incident_phase_transitions`, `transition_incident_phase`) | RESOLVED — consumer |
| Incident category extension (`incident_category = 'vendor_outage'`) | §6.5 | Doc 06C §10 — **CR-06C-07 post-lock additive required (bundled with CR-06C-05 \+ CR-06C-06 as single 06C cleanup; W3)** | OPEN — bounded |
| Compliance-gate registry pattern (design precedent reference; no compliance gates owned by 06E) | §13 registry shape inspired by 06D §10 pattern | Doc 06D §10 | RESOLVED — design-reference only |
| LISA cost metrics body ($20 hard cap, $18/$10/\<$6 thresholds) | §7.3 Vertex AI subsection; §10.3 SCAP-VERTEX-01 | Doc 03 Main §24 — referenced via project handoff record per §3.4 | OPEN — bounded (W1); §3.4 cite-path |
| LISA GCP substrate cost mechanics | §7.4 Cloud Run subsection; §10.3 SCAP-CLOUDRUN-01; §7.3 Vertex AI substrate references | Doc 03C V3.0 §11.3 | RESOLVED — consumer |
| Vertex AI orchestrator failure modes (for outage doctrine) | §6.3 VEND-VERTEX outage runbook | Doc 03C V3.0 §28 | RESOLVED — consumer |
| Per-feature cost attribution, unit economics, financial modeling | §8.3 disclaimer; §12.5 forward-ref | Doc 09 — **FWD-06-05** (new sanctioned forward-ref) | OPEN — bounded |
| Analytics cost attribution | §12 forward-ref carried from 06D | Doc 07 — **FWD-06-01** (carried) | OPEN — bounded |
| §10.5 envelope | §14 \+ every proving mechanism | Doc 06 Parent §10.5 / 06A §10.5.1 | RESOLVED — extended in §14 |
| Parent §3 "lightweight" framing for 06E with V1.1 expansion hook | §1, §4, §12 | Doc 06 Parent §3 | RESOLVED — body |
| Parent INV-06-12 vendor-outage paths explicit | §6 body | Doc 06 Parent §10 | RESOLVED — 06E is the body |
| Family-wide launch-vs-target annotation convention (NEW — 06E origin; lazy retrofit to 06A/B/C/D) | §4 doctrine | Doc 06 Parent §6.13 — **to be extended in next Parent cleanup window** | OPEN — bounded (W4) |

---

# **§16 — Audit Profile**

Inherits Parent §17 six passes \+ 06A-specific passes (03C-boundary, registry-schema-completeness) \+ 06B-specific passes (primitive-body-restatement detection, audit-substrate exhaustiveness) \+ 06C-specific passes P13–P18 (self-monitoring watchdog, schema-completeness, registry-canonical, state-machine RPC, text-FK validated write path, external-fetch failure semantics) \+ 06D-specific passes P19–P22 (retention-coverage exhaustiveness, compliance-gate registry parity, deletion-cascade reference exhaustiveness, no-PII proof-artifact conformance). Plus three 06E-specific passes added in CR-06E-04 / RB-06E-V1-10 (P25):

* **06E P23 — Vendor-tier exhaustiveness.** Every Tier-1 vendor in `infra/vendor-inventory.yaml` (§5.3) has (a) a §7 subsection with the canonical structure (pricing tier table, cost-driver KPIs, Lyceon-specific formula, scale projections, inflection point, launch-required substrate-cap config); (b) a `docs/runbooks/<vendor>-outage.md` file existing; (c) a corresponding pricing snapshot entry in `infra/vendor-pricing-snapshot.yaml`. Implemented as `ci/vendor-inventory-parity` (§5.6) \+ `ci/vendor-runbook-shape-parity` (§6.4) \+ `ci/vendor-pricing-snapshot-parity` (§13.3); the audit pass verifies all three mechanisms together cover the Tier-1 inventory completeness.  
* **06E P24 — Pricing-snapshot-registry parity.** Every numeric pricing value appearing inline in §7 has a corresponding entry in `infra/vendor-pricing-snapshot.yaml` with matching value; conversely every snapshot entry's `value` matches the §7 inline at its `section_ref`. Implemented as `ci/vendor-pricing-snapshot-parity` (§13.3); the audit pass verifies the mechanism's check covers both directions (inline→registry and registry→inline) and the `last_verified_at` cadence enforcement is wired correctly.  
* **06E P25 — Launch-required-annotation coverage (FAMILY-WIDE rule from §4).** Every mechanism declared in 06E §18 acceptance criteria carries a `launch_required: bool` annotation; every `launch_required: false` mechanism resolves to a §12 V1.1+ trigger criterion; every artifact schema in §14 declares the `launch_required` field. Carries forward as a family-wide convention check once the lazy retrofit lands in 06A/B/C/D.

Known false-positive class (carry-over from 06A/B/C/D \+ 06E-specific): doc titles containing flagged words; the §15 seam table (cites bodies — required, not restatement); the §21 cleanup register's SWE review-severity vocabulary (`BLOCKER` / `HIGH` / `MEDIUM`); the §5.5 tiering-criteria vocabulary (`tier_1` / `tier_2`); the §7 vendor-pricing inline numeric values which ARE the canonical inline copies of registry values (P24 enforces parity, not restatement); the §12 V1.1+ design narrative which describes target-state mechanisms without intending to be the body (clearly marked as target-state, not specifying current behavior).

---

# **§17 — Open Items & Watch List**

| ID | Item | Status / handling |
| ----- | ----- | ----- |
| **W1** | Doc 03 Main §24 LISA cost metrics not in source tree (§3.4 cite-path; carried from 06C / 06D) | Bounded; §7.3 Vertex AI subsection \+ §7.4 Cloud Run subsection \+ §10.3 substrate-cap registry cite Doc 03 Main §24 \+ Doc 03C §11.3 per project handoff record. On Doc 03 Main upload, §7.3 reconciliation applied as Tier-1 06E cleanup. Non-blocking. |
| **W2** | Doc 05D not in source tree (FWD-06-04 carried family-wide) | 06E does not directly cite Doc 05D — no impact. Carried for family completeness. Non-blocking. |
| **W3** | **06C post-lock additive required (bundled CR-06C-05 \+ CR-06C-06 \+ CR-06C-07 as single 06C cleanup `RB-06C-V1-16`)** — extends 06C `infra/alert-registry.yaml` source\_class enum with `doc06d_event` AND `doc06e_event` AND extends `incidents.incident_category` enum with `vendor_outage` AND adds event rows to severity-crosswalk-registry for both 06D and 06E events | 06D introduced CR-06C-05 (`doc06d_event` enum \+ 06D event rows). 06E introduces CR-06C-06 (`doc06e_event` enum \+ 06E event rows) AND CR-06C-07 (`vendor_outage` incident category). Bundled as a single 06C in-lock-cycle cleanup `RB-06C-V1-16` per the cross-doc-additive convention. Non-blocking for 06E spec-lock; 06E \+ 06D both deploy-gated on the additive landing — recorded as §18 acceptance criterion. |
| **W4** | Family-wide launch-vs-target annotation convention retrofit | 06E adopts natively (§4). Lazy retrofit to 06A/B/C/D in each doc's next cleanup window. Parent §6.13 extension before Docs 07/08/09/10 draft. Non-blocking. |
| **W5** | Doc 09 not yet drafted (FWD-06-05 — new sanctioned bounded forward-ref for per-feature cost attribution / unit economics / financial modeling) | New cite-path. §8.3 disclaimer \+ §12.5 forward-ref both flag the dependency. 06E V1 ships infra-cost-per-user only; total unit economics deferred to Doc 09\. Non-blocking. |
| **W6** | Doc 07 not yet drafted (FWD-06-01 carried family-wide for analytics cost attribution) | Non-blocking; 06E touches the seam at §12.5 (per-feature attribution may reference Doc 07 surfaces). |
| **W7** | Vendor pricing volatility | First quarterly re-verification due 2026-08-22. If material changes (\>10% rate change OR new metered category), in-lock-cycle cleanup applied with §20 change-record row \+ Founder/CTO review. Non-blocking. |
| **W8** | Layer 2 / Layer 3 cost-alert mechanism activation | Per §12 V1.1+ deliverables. Triggers: Layer 2 activates 90+ days post-launch with 3 months of observed data; Layer 3 activates after Layer 2 operational for 6 months. Non-blocking. |
| **W9** | Per-vendor substrate-cap actual-configuration verification (vs registry-declared) | At V1: manual quarterly verification per §10.5. V1.1+ trigger: when more than 1 substrate-cap drift is observed in any 6-month window, activate automated verification per vendor. Non-blocking at V1. |

None of W1–W9 block 06E spec-lock.

---

# **§18 — Acceptance Criteria (Executable-Proof Framed)**

Per the Doc 06A §19 / 06B §18 / 06C §18 / 06D §18 split (A/B/C). All mechanisms carry `launch_required` annotations per §4.

## **A — 06E-owned criteria**

1. `ci/vendor-inventory-parity` (§5.6) fails on any Tier-1 vendor without §7 cost\_structure\_section\_ref; without `docs/runbooks/<vendor>-outage.md`; without pricing snapshot link; on any 06A §3 stack vendor absent from inventory (where parseable); on `last_reviewed_at` \> 180 days. **launch\_required: true.**  
2. `ci/vendor-runbook-shape-parity` (§6.4) fails on any Tier-1 vendor without registered runbook; any registered runbook missing required §6.2 section headers; any runbook `last_modified_at` \> 365 days without annual-review marker; any TBD/empty section past the 90-day launch grace. **launch\_required: true.**  
3. `ops/capacity-projection-monthly-baseline` (§9.3) fails on any Tier-1 vendor exceeding 70% utilization (Warn) or 90% utilization (Page); external-fetch failure semantics: partial outcome \+ Warn alert, never silent pass. **launch\_required: true.**  
4. `ci/capacity-review-deliverable-cadence` (§9.5) shape-locked at V1; enforcement activates 90 days post-launch (V1.1 trigger). **launch\_required: false; V1.1 trigger criterion: first 90-days-post-launch boundary.**  
5. `ci/substrate-cap-config-parity` (§10.4) fails on any Tier-1 vendor with `launch_required_substrate_cap: true` lacking `infra/substrate-cap-config.yaml` entry; any entry with unresolving `canonical_owner_doc_and_section`; any LISA-tier cap value not annotated `referenced; never restated`; any `launch_required: true` cap with unset value. **launch\_required: true.**  
6. `ops/stripe-transaction-rate-monitor` (§11.3) fails on chargeback rate \> 0.65% (Warn) or \> 1.0% sustained 7 days (Page); failed-transaction rate \> 5% sustained 4h (Page); failed-renewal rate \> 15% sustained 3d (Warn); dispute-per-customer ratio \> 1.0% (Page); fetch failure followed by 6h of no successful fetch (Page). **launch\_required: true.**  
7. `ci/vendor-pricing-snapshot-parity` (§13.3) fails on any inline-vs-registry value mismatch in either direction; any §7 inline numeric without backing registry entry; `last_verified_at` \> 100 days; any vendor\_id not resolving; any Tier-1 vendor without snapshot entry. **launch\_required: true.**  
8. State-machine RPC discipline applied where state machines exist (06E V1 has no state-machine tables — confirmed; if §12 V1.1 mechanisms introduce state tables, 06C P16 discipline applies at V1.1).  
9. Text-FK validated write paths applied where text-FK columns exist (06E V1 has no relational tables — confirmed; registries are YAML; if §12 V1.1 mechanisms introduce tables, 06C P17 discipline applies).  
10. Every 06E proof artifact conforms to Parent §10.5 envelope \+ §14 per-mechanism extras \+ §4 `launch_required` annotation; an artifact missing any common-envelope field, mechanism-specific extras, OR `launch_required` field is a `DD-06-PROOF` defect. **No-PII rule (§8.7 family-wide / RB-06D-V1-10):** every artifact contains only opaque IDs, aggregate counts, decision enums, hash digests with proof-run-local salt, or boolean flags — never raw PII or raw content. Enforced by audit pass P22 (family-wide) \+ P25 (launch\_required-coverage 06E-specific).

## **B — Cross-doc gate-body criteria (06E's slice only)**

11. **INV-06-12 (vendor outage paths explicit):** §6 body — `ci/vendor-runbook-shape-parity` (§6.4) verifies every Tier-1 vendor has a runbook with required-shape sections; runbook bodies live in `docs/runbooks/` per coding-standards convention; Doc 06 owns shape, not prose. Joint with 06C §10 incident lifecycle for vendor-outage incident handling.  
12. **INV-06-10 partial (06E slice — cost/capacity-class alerts have owner \+ runbook):** §9 / §10 / §11 alert IDs registered (subject to CR-06C-06 W3 closure for `doc06e_event` enum extension); on-call rotation per 06C §11; runbook stubs registered for cost/capacity alert response.  
13. **Doc 03 Main §24 LISA cost canonical:** §7.3 \+ §7.4 \+ §10.3 cite-paths preserved per §3.4 handoff record; reconciliation triggers on Doc 03 Main upload; no LISA cost target/alert threshold restated in 06E (audit P12 / P15 enforced).  
14. **Doc 03C V3.0 §11.3 \+ §28 LISA GCP substrate canonical:** §7.4 \+ §10.3 \+ §6.3 vendor-outage doctrine for VEND-VERTEX/VEND-CLOUDRUN preserved as referenced; no Doc 03C substrate body restated.

## **C — Audit closure**

15. The §16 audit reports zero `DD-06-PROOF`, `DD-06-REDEF`, `DD-06-SEAM`, `DD-06-FWD` defects; zero 03C-boundary violations; zero §10.5 envelope-conformance violations; zero LISA-cost-restatement defects; citation-parity reports either resolved-anchor or `cited_per_project_handoff_record` for every cross-doc citation; P13 (self-monitoring watchdog) passes for every 06E scheduled-job registration (all carry external\_watchdog blocks); P14 (schema-completeness) passes for every multi-field schema; P15 (registry-canonical) passes (no production gate consumes spec prose); P16 (state-machine RPC) trivially passes (no state machines in 06E V1); P17 (text-FK) trivially passes (no relational tables in 06E V1); P18 (external-fetch failure semantics) passes for Vendor APIs / Stripe API; P19-P21 trivially pass (06D-specific); P22 (no-PII proof-artifact) passes for §14 schemas; P23 (vendor-tier exhaustiveness) passes; P24 (pricing-snapshot-registry parity) passes; P25 (launch-required-annotation coverage) passes.

16. **W3 / CR-06C-06 \+ CR-06C-07 deploy gate:** 06E deploy is gated on 06C post-lock additive `RB-06C-V1-16` landing — extends `doc06e_event` source\_class enum \+ adds 06E event rows in severity-crosswalk-registry \+ `infra/alert-registry.yaml` \+ extends `incidents.incident_category` enum with `vendor_outage`. Bundled with 06D's CR-06C-05 as a single 06C in-lock-cycle cleanup. Until that additive lands, 06E mechanisms emitting alerts (`ops/capacity-projection-monthly-baseline`, `ops/stripe-transaction-rate-monitor`, §10 substrate-cap breach alerts) will be rejected by 06C's `ci/alert-runbook-parity`. **This is a deploy gate, not a spec-lock gate** — 06E locks with the obligation explicitly declared (W3); CR-06C-06 \+ CR-06C-07 closure is a coordinated cross-doc cleanup tracked at both ends.

Per Parent §6.13, each mechanism above is **specified, not deploy-proven**, until its owning artifact (CI job / scheduled job / manifest / registry) supplies all six §6.13 elements.

---

# **§19 — Drafting & Lock Conventions**

Inherits Parent §8 verbatim: tool-neutral workflow (primary drafting agent → independent SWE review → in-lock-cycle `RB-06E-V1-NN` cleanup → current audit suite run twice — 25 passes total: P1-P12 base \+ P13-P18 from 06C \+ P19-P22 from 06D \+ P23-P25 06E-specific); `.bak` / `.bak2` before each pass; draft-for-lock cleanup keeps `DRAFT` and transitions once to `LOCKED` on clean re-audit; post-lock in-lock-cycle cleanup keeps `LOCKED`, version and lock date unchanged.

---

# **§20 — Change Records**

**CR-06E-01** — Doc 06E V1.0 established. Scope per Parent §3 "lightweight" framing with V1.1 expansion hook: two-tier vendor inventory (Q-06E-1=c); vendor-outage doctrine for INV-06-12 (Q-06E-4=b decision-3 pattern, runbook bodies in `docs/runbooks/`); per-platform cost-structure documentation (§7 — the V1 centerpiece, eight Tier-1 vendors, pricing snapshot verified 2026-05-22); composite Lyceon cost-modeling formulas with 1K/10K/100K MAU scale projections (§8); capacity-projection mechanism with three-cadence model (Q-06E-3=c+e: monthly baseline \+ quarterly deep \+ 70%-utilization trigger); launch-required substrate-cap configuration discipline (Layer 1 of three-layer cost-protection model per Q-06E-7=a reframing — V1 is documentation-heavy and enforcement-thin; Layer 2/3 are target-state V1.1+ per §12); Stripe transaction-rate monitoring (§11 — separate shape from cost budgets); vendor pricing snapshot registry with `ci/vendor-pricing-snapshot-parity` mechanism enforcing inline-vs-YAML parity (Q-06E-9=c hybrid); launch-required vs target-state annotation convention adopted natively in 06E and offered for family-wide lazy retrofit (§4 — NEW, per Q-06E-8=a). One Parent invariant owned outright (INV-06-12); contributes the cost/capacity slice to INV-06-10. Three 06E-specific audit passes added: P23 (vendor-tier exhaustiveness), P24 (pricing-snapshot-registry parity), P25 (launch-required-annotation coverage); audit suite expands from 22 to 25 passes. Three new sanctioned forward-refs: FWD-06-05 (Doc 09 — per-feature cost attribution / unit economics / financial modeling); FWD-06-01 carried (Doc 07 — analytics cost attribution); FWD-06-02 / FWD-06-04 carried for family completeness.

**CR-06E-02** — Pre-draft alignment: 06A §3 platform stack inventory consumed for Tier-1 vendor list; Doc 03 Main §24 LISA cost metrics cited per project handoff record (§3.4 cite-path, continued from 06C / 06D); Doc 03C V3.0 §11.3 \+ §28 referenced for LISA GCP substrate cost and Vertex AI failure modes; 06B §8.6 independent-expected-source discipline applied to cost observation (vendor billing APIs, not Lyceon-derived metrics); 06C §6/§7/§8/§10/§11 consumed for severity crosswalk, alert-registry, scheduled-job heartbeat substrate, incident lifecycle base, unified rotation; 06D §10 referenced as design precedent for registry shape (compliance-gate registry pattern); 01A §3 referenced for `infra/vendor-pricing-snapshot.yaml` config-doctrine registration.

**CR-06E-03** — Pre-draft Q\&A locked: Q-06E-1 \= (c) two-tier vendor inventory (Tier-1 deploy-critical \+ Tier-2 dev-only); Q-06E-2 \= (c) LISA-style tiering (hard cap Page / soft alert Warn / target band) — applied platform-wide BUT only as target-state per Q-06E-7 reframing; Q-06E-3 \= (c)+(e) three-cadence model (monthly baseline \+ quarterly deep \+ 70% utilization trigger); Q-06E-4 \= (b) doc-only declaration of vendor-outage paths with required-shape contracts, runbook bodies in `docs/runbooks/` per coding-standards convention; Q-06E-5 \= (a) minimal V1 scope (vendor inventory \+ outage runbooks \+ cost-structure documentation \+ capacity-projection \+ substrate caps; V1.1+ adds Layer 2/3 alerts, per-feature attribution, Tier-2 SLA discipline, multi-region failover); Q-06E-6 \= confirm same conventions; **Q-06E-7 \= (a) with reframing (the central pivot):** three-layer cost-protection model; launch-required is **documentation, not alerting** (§7 per-platform cost-structure documentation IS the V1 deliverable); Layer 1 substrate caps launch-required where supported; Layer 2/3 alerts deferred to V1.1+ (defer alert thresholds until 3-6 months of observed cost data exists; setting thresholds against no baseline trains the team to ignore alerts); **Q-06E-8 \= (a)** adopt launch-vs-target annotation convention in 06E only; lazy retrofit to 06A/B/C/D in each doc's next cleanup window; Parent §6.13 extension before Docs 07/08/09/10 draft; **Q-06E-9 \= (c)** hybrid pricing-snapshot model (§7 inline \+ `infra/vendor-pricing-snapshot.yaml` machine-readable \+ `ci/vendor-pricing-snapshot-parity` enforces parity). Live web research conducted 2026-05-22 across eight Tier-1 vendors (Vercel, Supabase, Vertex AI, Cloud Run, Cloudflare, Stripe, Sentry, GitHub Actions) confirming current pricing structures, cost-driver KPIs, and migration inflection points before §7 drafting.

**CR-06E-04** — In-lock-cycle draft-for-lock cleanup applying SWE R1 (5 BLOCKER \+ 5 HIGH; all accepted without pushback). Per §19 convention, draft-for-lock cleanup transitions DRAFT → LOCKED on clean re-audit; status transitioned DRAFT → LOCKED 2026-05-22 on clean two-pass re-audit; subsequent in-lock-cycle cleanup (if any) holds the 2026-05-22 lock date per Parent §8 multi-round precedent. Ten reviewer-bound register entries tagged RB-06E-V1-01..10: **(B1 / RB-06E-V1-01)** Supabase PITR launch-required per Doc 06D §13 backup-substrate canonical — fixed direct contradiction with locked 06D by making PITR launch-required at $100/month (7-day retention minimum); reviewer-correct doctrine (fix 06E, do not reopen 06D); §7.2 formula, scale projections, substrate-cap registry, and §8.2 composite all updated; PITR body referenced from Doc 06D §13, never restated. **(B2 / RB-06E-V1-02)** Vertex AI / Gemini LISA cost math materially wrong — cache discount was applied to total cost instead of input tokens only (output is never cached); rewrote §7.3 formula with separate input/output decomposition \+ reviewer-correct worked example showing $0.00216/query (\~50% lower than prior overstated arithmetic); recomputed per-student costs across all four activity tiers (moderate $0.11, heavy $0.54, day-cap throttled $7.78, theoretical monthly cap $21.58); narrative shifted from "3,600/month sits close to $18 hard alert" to "3,600/month sits at \~$7.78, comfortably below $10 soft alert"; current Gemini 2.5 pricing leaves substantial headroom against Doc 03 §24 cost discipline; scale projections recomputed. **(B3 / RB-06E-V1-03)** Cloud Run request-cost projection wrong — embarrassing arithmetic error where $0.40/M was applied as $0.40/request; corrected 100K MAU estimate from \~$50/month to \~$26/month with full breakdown showing requests $0.40 \+ CPU $24.48 \+ memory $0.60. **(B4 / RB-06E-V1-04)** GitHub Actions platform fee double-counted — January 2026 hosted-runner Linux 2-core rate of $0.006/min already includes the $0.002/min platform fee per GitHub's own pricing documentation; only self-hosted runners on private repos (March 2026 change) carry the separate $0.002/min platform fee atop your own compute cost; corrected §7.8 formula and projections. **(B5 / RB-06E-V1-05)** Cloudflare plan pricing annual-vs-monthly distinction — Pro $20/zone annual OR $25/zone monthly; Business $200/zone annual OR $250/zone monthly; §7.5 pricing table updated. **(H1 / RB-06E-V1-06)** Sentry Business quota wrong — Business includes 50K errors not 100K per current Sentry pricing (Team and Business both 50K base; difference is features not quota); recomputed 100K MAU estimate from \~$138 to \~$152 (Business $80 \+ PAYG overage on excess events). **(H2 / RB-06E-V1-07)** Vercel formula omitted Edge Requests despite §7.1 prose explicitly calling them out as a primary cost driver; added `max(0, edge_requests − 10_000_000) × $2 / 1_000_000` to formula; recomputed scale projections to model edge\_requests \= MAU × sessions × assets\_per\_page (using 36 assets/page typical-SPA assumption); 100K MAU edge-request overage adds \~$66/month to Vercel total. **(H3 / RB-06E-V1-08)** Supabase concurrency discipline insufficient — distinguished concurrent USERS from concurrent DATABASE CONNECTIONS (decoupled by Supavisor transaction-mode pooling, which is now required at launch); 5,000 concurrent users without pooling is an architecture defect, not a tier upgrade; added Supavisor as `SCAP-SUPABASE-03` launch-required substrate-cap; added peak-DB-connections alert. **(H4 / RB-06E-V1-09)** §8.2 composite cost table recomputed end-to-end against corrected §7 per-vendor figures; totals shift upward (1K $321→$468, 10K $2,470→$3,023, 100K $21,168→$25,984) driven by PITR baseline \+ edge-requests \+ corrected LISA blend; cost-per-MAU shape unchanged (declines with scale, stabilizes at $0.26-0.30); LISA still dominates at \~54-92% of infra cost across scale tiers; §8.3 unit-economics recomputed (gross margin shifts from \~78% to \~75% at $30/mo subscription assumption). **(H5 / RB-06E-V1-10)** Stripe dispute fee wording reformulated as conservative cost model — $15/dispute is the conservative anchor; actual cost may be lower for disputes the merchant wins (countered fee returned per Stripe Support dispute-fees-FAQ); exact treatment varies by region, account standing, and dispute outcome. Two-pass audit re-run after edits; both passes clean across all 25 passes (P1-P25). Pricing snapshot `last-verified-at` remains 2026-05-22; corrections applied to inline values inherit that verification date (corrections derived from same May 2026 vendor pricing pages cited in original research). §13 `infra/vendor-pricing-snapshot.yaml` registry values updated in parallel under Q-06E-9=c hybrid model — inline-vs-registry parity preserved.

**CR-06E-05** — Second in-lock-cycle cleanup round applying SWE R2 (2 BLOCKER \+ 1 HIGH; all accepted without pushback). Lock date holds 2026-05-22 per Parent §8 multi-round in-lock-cycle precedent (06D pattern: post-LOCK cleanup leaves status/version/lock-date unchanged). Three reviewer-bound register entries tagged RB-06E-V1-11..13: **(B1 / RB-06E-V1-11)** §1 mechanism count inconsistency — the lightweight-execution-principle paragraph claimed "three proving mechanisms" but the doc actually defines seven owned mechanisms; rewrote §1 to enumerate the correct count (six launch-required: four CI parity checks \+ two ops/runtime monitors; plus one target-state V1.1-activated cadence check); audit P4 \+ P25 already verified the seven-mechanism count is correct — only the §1 prose was misaligned. **(B2 / RB-06E-V1-12)** GitHub Actions per-account vs per-seat minute quota error — §7.8 formula and scale-projection table incorrectly treated the 3,000-minute Team-plan quota as scaling per seat; per GitHub Billing documentation, the included quota is per-account/per-organization, NOT per-seat (only the $4/user/month seat fee scales with team size); rewrote formula to `$4 × team_size + max(0, monthly_linux_minutes − 3,000) × $0.006` and recomputed the projection table: 3 engineers \~$24 (was $12); 5 engineers \~$50 (was $20-40); 10 engineers \~$118 (was \~$100). **(H1 / RB-06E-V1-13)** Self-hosted runner platform-fee language was stale — §7.8 inflection-point text described the $0.002/min self-hosted fee as taking effect March 2026, but GitHub announced the change on December 16, 2025 then **postponed it indefinitely on December 18, 2025** after community pushback (canonical source: GitHub Changelog); as of May 2026 self-hosted runner usage on private repos remains free; rewrote §7.8 to reflect the postponement with explicit volatility warning \+ instruction to verify GitHub's current billing docs before migration; also corrected §3 Threat \#1 example which used the same misleading framing of "$0.002/min platform fee in March 2026" as if it were already in effect — replaced with the more accurate (and instructive) framing of "hosted-runner price reduction in January 2026 with platform fee already baked in; self-hosted fee announced and then postponed within 48 hours" which demonstrates the same pricing-volatility threat point. Two-pass audit re-run after edits; both passes clean across all 25 passes. §8 composite totals unchanged (B2 affects only CI/CD line which is engineering-scaled, not MAU-scaled; B2 corrections shift the 5-engineer CI/CD cost in §8.2 from \~$30 to \~$50, a $20/month change that is absorbed by the rounding margins in the composite table). §13 `infra/vendor-pricing-snapshot.yaml` registry values are unchanged by RB-06E-V1-11/12/13 — the GitHub Actions rate ($0.006/min Linux) and per-account 3K-minute quota are CONSISTENT with the registry (registry value was always correct; the §7.8 formula's mis-application was the bug). The postponed self-hosted $0.002/min fee was never an active rate value in the registry, so no parity action needed there.

**CR-06E-06** — Third in-lock-cycle cleanup round applying SWE R3 (1 BLOCKER bundling three propagation defects from CR-06E-05; accepted without pushback). Lock date holds 2026-05-22 per Parent §8 multi-round in-lock-cycle precedent. One reviewer-bound register entry tagged RB-06E-V1-14 bundling three locations: **(B1.a / §7.8 substrate-cap table)** "3,000 minutes/month per user covers typical team activity" → "3,000 included GitHub-hosted Actions minutes/month per organization/account (NOT per seat); overage billed at $0.006/min". **(B1.b / §10.3 SCAP-GITHUB-01)** "Team plan 3K minutes/user; workflow timeout 60min" → "Team plan 3,000 minutes/month per organization/account (NOT per seat)". **(B1.c / §8.2 composite table)** CI/CD line was stale — kept the pre-RB-06E-V1-12 values (\~$20 / \~$30 / \~$100) instead of the corrected \~$50 / \~$50 / \~$118 baseline; recomputed all three rows: 1K MAU $468→$498 (+$30, $0.47→$0.50 cost-per-MAU); 10K MAU $3,023→$3,043 (+$20, $0.30 unchanged at rounded precision); 100K MAU $25,984→$26,002 (+$18, $0.26 unchanged); narrative paragraph "materially higher (\~$0.47)" updated to "materially higher (\~$0.50)". **Honest self-acknowledgment:** the CR-06E-05 / RB-06E-V1-09 statement "§8 composite totals unchanged" was sloppy — it accounted for the 5-engineer CI/CD shift in the §7.8 projection table but failed to propagate to the §8.2 composite CI/CD column; R3 reviewer correctly caught this partial-propagation defect. Per-MAU narrative ($0.26-0.30 stabilization at scale, declines as fixed costs amortize) is unchanged. LISA still dominates at \~54-92% of infra cost across scale tiers. §13 `infra/vendor-pricing-snapshot.yaml` registry values are unchanged — this was a doc-prose propagation defect, not a pricing-data defect. Two-pass audit re-run; both passes clean across all 25 passes.

---

# **§21 — Cleanup Register (RB-06E-V1-NN)**

Structure established; populated during the in-lock-cycle external-review cleanup pass.

| Tag | Severity | Source | Resolution |
| ----- | ----- | ----- | ----- |
| RB-06E-V1-01 | BLOCKER | SWE R1 / B1 | Supabase PITR launch-required per Doc 06D §13 — fixed contradiction with locked 06D by making PITR ($100/month, 7-day retention minimum) launch-required; §7.2 formula \+ scale projections \+ §10.3 substrate-cap registry (new `SCAP-SUPABASE-04`) \+ §8.2 composite all updated; body referenced from Doc 06D §13, never restated. |
| RB-06E-V1-02 | BLOCKER | SWE R1 / B2 | Vertex AI cache-discount math fixed — cache discount applies to input tokens only (output never cached); §7.3 formula rewritten with separate input/output decomposition; worked example recomputed showing $0.00216/query; per-student costs corrected across all four activity tiers (moderate $0.11, heavy $0.54, day-cap throttled $7.78, theoretical monthly cap $21.58); narrative updated showing daily-cap usage at \~$7.78 (comfortably below soft alert), not \~$15 (near hard alert); scale projections recomputed. |
| RB-06E-V1-03 | BLOCKER | SWE R1 / B3 | Cloud Run request-cost arithmetic fixed — $0.40/M was misapplied as $0.40/request; §7.4 100K MAU projection corrected from \~$50/month to \~$26/month with full breakdown (requests $0.40 \+ CPU $24.48 \+ memory $0.60). |
| RB-06E-V1-04 | BLOCKER | SWE R1 / B4 | GitHub Actions platform-fee double-count fixed — Linux 2-core hosted at $0.006/min already includes the $0.002/min platform fee per GitHub pricing docs; only self-hosted runners on private repos (March 2026 change) carry separate $0.002/min platform fee atop own compute cost; §7.8 formula and projections corrected. |
| RB-06E-V1-05 | BLOCKER | SWE R1 / B5 | Cloudflare annual-vs-monthly pricing distinction added — Pro $20/zone annual OR $25/zone monthly; Business $200/zone annual OR $250/zone monthly; §7.5 table updated. |
| RB-06E-V1-06 | HIGH | SWE R1 / H1 | Sentry Business quota corrected — 50K errors included (not 100K) per current Sentry pricing; PAYG/reserved-volume tiers beyond; §7.7 table and 100K MAU projection (\~$152) updated. |
| RB-06E-V1-07 | HIGH | SWE R1 / H2 | Vercel Edge Requests added to cost formula — `max(0, edge_requests − 10_000_000) × $2 / 1_000_000`; scale projections recomputed to model edge\_requests \= MAU × sessions × 36 assets/page; 100K MAU edge-request overage adds \~$66/month. |
| RB-06E-V1-08 | HIGH | SWE R1 / H3 | Supabase concurrency discipline tightened — distinguished concurrent USERS from concurrent DATABASE CONNECTIONS (decoupled by Supavisor transaction-mode pooling); pooling now launch-required (`SCAP-SUPABASE-03`); 5,000 concurrent users without pooling explicitly flagged as architecture defect not tier upgrade; peak-DB-connections alert added at 80% of compute tier connection limit; cost estimate invalidated unless DB connections explicitly bounded. |
| RB-06E-V1-09 | HIGH | SWE R1 / H4 | §8.2 composite cost table recomputed end-to-end against corrected §7 figures; totals shift upward (1K $321→$468, 10K $2,470→$3,023, 100K $21,168→$25,984); shape unchanged (declines with scale, LISA dominates); §8.3 unit-economics recomputed (gross margin 78%→75% at $30/mo assumption). |
| RB-06E-V1-10 | HIGH | SWE R1 / H5 | Stripe dispute fee wording reformulated as conservative model — $15/dispute is conservative anchor; actual cost may be lower for won disputes (countered fee returned); exact treatment varies by region/account/dispute outcome. |
| RB-06E-V1-11 | BLOCKER | SWE R2 / B1 | §1 mechanism count corrected — was claiming "three proving mechanisms" but doc actually owns seven (six launch-required \+ one V1.1-activated); §1 now enumerates: four CI parity checks \+ two ops/runtime monitors launch-required \+ `ci/capacity-review-deliverable-cadence` target-state V1.1. Internal consistency restored. |
| RB-06E-V1-12 | BLOCKER | SWE R2 / B2 | GitHub Actions per-account vs per-seat minute quota fixed — included Actions minutes are per-organization (3,000 for Team), not per-seat; only the $4/user/month seat fee scales per user; §7.8 formula rewritten and projection table recomputed (3 eng \~$24, 5 eng \~$50, 10 eng \~$118). |
| RB-06E-V1-13 | HIGH | SWE R2 / H1 | Self-hosted runner platform-fee language updated — GitHub announced $0.002/min self-hosted fee Dec 16 2025 then postponed indefinitely Dec 18 2025 per GitHub Changelog canonical source; §7.8 and §3 Threat \#1 both updated to reflect postponement with explicit volatility warning; as of May 2026 self-hosted runner usage on private repos remains free. |
| RB-06E-V1-14 | BLOCKER | SWE R3 / B1 | Per-account GitHub Actions quota fix from RB-06E-V1-12 hadn't propagated to three locations: (a) §7.8 substrate-cap table still said "3K minutes/month per user covers typical team activity" → rewrote as "3,000 minutes/month per organization/account"; (b) §10.3 `SCAP-GITHUB-01` still said "Team plan 3K minutes/user" → rewrote as "3,000 minutes/month per organization/account"; (c) §8.2 composite cost table CI/CD column still used pre-RB-06E-V1-12 values (\~$20/$30/$100) → recomputed to \~$50 (5-eng baseline at 1K/10K MAU) and \~$118 (10-eng baseline at 100K MAU). Totals: 1K $468→$498 (+$30, $0.47→$0.50/MAU); 10K $3,023→$3,043 (+$20, $0.30/MAU unchanged); 100K $25,984→$26,002 (+$18, $0.26/MAU unchanged). Narrative paragraph also updated ($0.47 → $0.50 at 1K MAU). Honest acknowledgment: the prior CR-06E-05 statement "§8 composite totals unchanged" was sloppy partial-propagation reporting. |

**Convention:** `.bak` / `.bak2` before each pass; resolved items tagged `RB-06E-V1-NN`; §20 change-record row appended per pass; draft-for-lock pass transitions status `DRAFT` → `LOCKED`; post-lock passes (multi-round in-lock-cycle precedent from Doc 04C / 05D / 06D) leave status / version / lock-date unchanged (Parent §8).

---

# **§22 — Closing**

06E is the family's lightweight sibling — operational doctrine \+ documented cost models \+ thin enforcement at V1, with a deliberate V1.1+ expansion hook for cost-alert mechanisms, modeled-vs-actual reconciliation, per-feature attribution, and Tier-2 vendor SLA discipline. The substantive V1 deliverable is §7 (per-platform cost-structure documentation): eight Tier-1 vendors, current pricing snapshot verified 2026-05-22, Lyceon-specific cost-per-user formulas, scale projections at 1K/10K/100K MAU, migration inflection points, and launch-required substrate-cap configurations. The LISA cost discipline owned by Doc 03 Main §24 is referenced throughout but never restated; the LISA GCP substrate cost mechanics owned by Doc 03C V3.0 are likewise referenced and never restated. The launch-required vs target-state annotation convention introduced here is offered to the family for lazy retrofit — adopting it natively in future docs (07, 08, 09, 10\) and applying it retrospectively to 06A/B/C/D in their next cleanup windows. Decision 5 holds end-to-end: vendor inventory grounds in 06A §3; cost-related primitives stay canonical to their owners; 06E adds the cost-modeling layer \+ the capacity-projection mechanism \+ the vendor-outage doctrine \+ the substrate-cap configuration discipline, never restating a primitive body.

*End of Doc 06E V1.0 (LOCKED 2026-05-22). Doc 06 family A/B/C/D/E now drafts complete and LOCKED. Family-level deploy gate pending the bundled cross-doc additive `RB-06C-V1-16` (CR-06C-05 \+ CR-06C-06 \+ CR-06C-07 — extends `doc06d_event` \+ `doc06e_event` source\_class enums \+ `vendor_outage` incident\_category enum). This is a coordinated cross-doc cleanup tracked at both ends, not a spec-lock blocker.*

