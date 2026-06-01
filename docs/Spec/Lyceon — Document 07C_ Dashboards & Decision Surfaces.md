# **Lyceon — Document 07C: Dashboards & Decision Surfaces**

**Version:** V1.0 **Status:** LOCKED 2026-05-28 (R1 SWE cleanup RB-07C-V1-01..09 applied in-lock-cycle per CR-07C-02; R2 SWE verdict \= LOCK-CONDITIONAL grade A-, no architecture rewrite required — 4 final stale-language consistency items applied as RB-07C-V1-10..13 per CR-07C-03; clean two-pass re-audit \+ KPI-event-name parity verified against 07B \+ P31 \+ DD-07-REDEF; no version bump across cleanup rounds) **Last updated:** 2026-05-28 **Owners:** Founder / CTO review **Governed by:** Doc 00 (Authoritative Platform Directive) \+ Doc 07 Parent V1.0 (LOCKED 2026-05-23). **Scope per Doc 07 Parent §5.1 family decomposition:** Doc 07C is the **fourth sub-doc** (per Parent Q-07-6=β drafting order: Parent → 07A → 07E → 07B → 07C → 07D) and owns the dashboard substrate specification — the dashboard registry shape, the dashboarding-tool selection rationale, the executive-scorecard contract, the internal-only audience invariant, the role-based-access discipline, and the warehouse-vs-PostHog substrate split. Per Parent line 175 ("Mostly target-state; minimal launch content"), 07C is the **most target-state-leaning** of the Doc 07 sub-docs — the running dashboards are V1.1+ infrastructure that activates when the warehouse export goes live per W-07-PostHog-BQ; what locks at V1 is the *contract* (which dashboards exist, who they're for, what KPIs each surfaces, the access-control model) plus the operational minimum that PostHog's built-in dashboards already cover at launch. **Depends on:** Doc 07 Parent V1.0 (canonical decisions Q-07-1..6 inherited verbatim; §4 spec-locked-infrastructure-target-state framing applies; the 6-element §6.13 implemented-definition discipline applies to 07C's owned mechanisms; W7 internal-only-at-V1 watch item is bodied by 07C's INV-07-10 invariant; the 35-KPI roster — 34 Parent-canonical \+ KPI-ENG-11 — that 07C dashboards reference); Doc 07A V1.0 (LOCKED 2026-05-25 — `infra/event-schema-registry.yaml` 25-event taxonomy \+ the `analytics_user_id` HMAC contract \+ the §8 PII redaction contract; 07C dashboards consume 07A events only via PostHog at V1 or via 07B's normalized event stream at V1.1+, never inventing event names — all referenced, never restated); Doc 07E V1.0 (LOCKED 2026-05-26 — the pseudonymized retention class taxonomy applies to any dashboard caching layer; the small-cell/cardinality guardrail per 07E §15 W5 applies to any dashboard tile that groups by exam-date or cohort dimensions; the under-13 ML-training-exclusion invariant 07E §10.6 extends to dashboard-exported aggregates — all referenced, never restated); Doc 07B V1.0 (LOCKED 2026-05-28 — `infra/kpi-registry.yaml` 35-KPI canonical roster \+ INV-07-05 \+ INV-07-06 \+ the 6 V1-bodied KPI measurement bodies \+ the warehouse normalized event stream that V1.1+ dashboards read from \+ the §10.3 small-cell/minimum-cardinality guardrail that dashboard-facing models inherit \+ the `dim__user` \+ cohort/trajectory model declared-shape contracts that V1.1+ dashboards consume — all referenced, never restated; 07C resolves Doc 07B's FWD-07B-01); Doc 06A V1.0 (§3 platform stack — PostHog Tier-1 launch-required vendor whose built-in dashboards are the V1 substrate; BigQuery Tier-1 target-state vendor whose query layer V1.1+ dashboards read from); Doc 06C V1.0 (§7 `infra/alert-registry.yaml` substrate — 07C V1 mechanisms produce no alerts per INV-07-09; V1.1+ dashboard-related alerts register in 06C §7 when the warehouse activates); Doc 06D V1.0 (§8.7 family-wide no-PII proof-artifact rule applies to 07C's dashboard registry proof artifacts; §11 privacy-incident sub-class — 07C dashboard surfaces that violated the internal-only audience invariant would produce a privacy incident via the standard mechanism); Doc 06E V1.0 (§4 launch-vs-target convention adopted; the PostHog Tier-1 launch-required vendor body \+ the V1.1+ dashboard-tool vendor body land via W-07-PostHog-BQ \+ the new W-07C-V1.1-TOOL-SELECTION additive — referenced, never restated); Doc 05B V1.0 (mastery KPI body math — dashboards reference mastery KPIs by `kpi_id` only; never restated); Doc 03 Main V1.1 (LISA cost/cap KPI bodies — dashboards reference by `kpi_id` only; never restated); Doc 01 V6.0 (identity model — 07C's "internal team" audience definition consumes Doc 01's role taxonomy; 07C does NOT redefine identity); Doc 01A V1.0 (§3 config doctrine for `infra/dashboard-registry.yaml` registration). **Forward-references (bounded; inherited from Parent):** FWD-07-01 (Doc 09 financial unit economics — financial dashboard contracts reference Doc 09 as the V1.1+ canonical owner for financial bodies; 07C owns the dashboard surface, Doc 09 owns the financial formula); FWD-07-02 (Doc 08 multi-vertical — 07C V1 covers single-vertical SAT dashboards only; multi-vertical dashboard fork belongs to Doc 08); FWD-07-03 (Doc 10 brand/social-proof analytics — dashboards on community engagement / social listening are V1.1+ Doc 10 territory). **New 07C-originated forward-refs / additives:** FWD-07C-01 (Doc 07D experimentation dashboards consume 07C's dashboard registry as their substrate when 07D drafts — bounded; resolves when 07D drafts); W-07C-V1.1-TOOL-SELECTION (cross-doc additive owed to Doc 06E — when the V1.1+ warehouse-backed dashboard tool is chosen, Doc 06E receives a vendor registration in §5/§7/§10/§13 per the W-07-PostHog-BQ pattern; **Looker Studio is named as a leading V1.1+ candidate per Karl's GCP-consolidation lean (Parent W9), but Metabase \+ Hex remain in scope and the final selection is deferred to the additive's resolution event — 07C does not pre-commit**). **Applies to:** the dashboard substrate spec including substrate-split semantics (§5 — PostHog at V1 / warehouse-backed tool at V1.1+); the V1.1+ dashboard-tool selection rationale \+ criteria (§6 — Looker Studio as a leading candidate, criteria for the final choice, W-07C-V1.1-TOOL-SELECTION additive boundary); the internal-only-at-V1 invariant \+ audience taxonomy (§7 — INV-07-10 bodies W7 watch item from Parent); the `infra/dashboard-registry.yaml` canonical dashboard roster with three owned proving mechanisms (§8 — INV-07-10 internal-only enforcement \+ INV-07-11 dashboard-to-KPI-registry parity \+ the dashboard-registry-presence-and-shape audit P32); the V1 bodied dashboards (§9 — the founder-facing operational dashboard that surfaces the 6 V1-bodied KPIs from 07B's registry, configured in PostHog at V1); the executive-scorecard contract (§10 — dedicated section per Parent line 34's explicit naming; V1 contract locks audience \+ KPI references \+ cadence; V1.1+ activates body when the warehouse \+ scorecard tool come online); the dashboard-to-KPI parity discipline (§11 — every dashboard tile references a `kpi_id` from 07B's canonical KPI registry, never restates a measurement body); the warehouse-vs-PostHog substrate split governance (§12 — which dashboards live where, the migration discipline from PostHog-built dashboards at V1 to warehouse-backed dashboards at V1.1+); the dashboard-side cascade \+ cardinality conformance inheritance (§13 — 07E §15 W5 small-cell guardrail \+ 07B §10.3 enforcement inherited; dashboards do NOT re-implement, they consume); the V1 / V1.1+ mechanism table (§14 — every 07C mechanism declares launch\_required: bool); the §15 audit profile inheriting the family passes \+ applying P31 \+ P27; the §16 acceptance criteria; the §17 cross-doc seam table; the §18 watch items. **Explicitly excludes:** event definitions \+ event-time payload schema (Doc 07A owns — referenced via PostHog at V1 or 07B normalized at V1.1+); the warehouse model layer (Doc 07B owns — `infra/kpi-registry.yaml` \+ the fact/dimension/cohort/trajectory declared-shape contracts — referenced, never restated; 07C dashboards consume the registry, never restate it); the retention/cascade/PII policy (Doc 07E owns — referenced; 07C inherits 07E's small-cell guardrail \+ cascade obligations, never re-implementing); the platform retention registry substrate \+ compliance-gate process (Doc 06D owns); the per-vendor infra cost body (Doc 06E §7 owns — referenced via W-07-PostHog-BQ for PostHog/BigQuery, via W-07C-V1.1-TOOL-SELECTION for the V1.1+ dashboard tool when chosen); mastery KPI body math (Doc 05B owns — referenced by `kpi_id` only); LISA cost/cap bodies (Doc 03 Main §11/§24); financial unit economics body (Doc 09 — FWD-07-01); experimentation dashboards (Doc 07D — FWD-07C-01); student-facing reporting (Doc 04C / app surfaces — explicitly out of scope per Q-07-5=β internal-only-at-V1); guardian-facing surfaces (Doc 01 guardian trust model \+ Doc 04C — explicitly out of scope at V1 per internal-only); school-admin / regulator / board-reporting dashboards (V1.1+ scope expansion per Parent W7 — re-evaluation of privacy posture required before any external consumer adds).

---

# **§1 — Purpose & Position in the Doc 07 Family**

## **1.1 What 07C is**

Doc 07C is the **dashboard substrate contract**: it specifies what dashboards Lyceon's internal team consumes, what KPIs each surfaces (referenced from Doc 07B's canonical 35-KPI registry, never restated), what audience each is bound to (V1: internal team only, enforced), what data substrate each runs on (PostHog at V1 / warehouse-backed tool at V1.1+), and how the V1 PostHog-built dashboards migrate to V1.1+ warehouse-backed dashboards without losing definitional continuity. It is the **fourth sub-doc** in the Doc 07 family.

Per Doc 07 Parent line 175 \+ §4 framing, **07C is the most target-state-leaning sub-doc**: the V1 launch substrate is PostHog's built-in dashboards (which exist by virtue of Lyceon paying for PostHog as a Tier-1 launch-required vendor — no separate dashboard tool at V1 per Parent line 214). What locks at V1 is the **contract** — the dashboard registry, the internal-only audience enforcement, the executive-scorecard contract, the KPI-reference discipline, the substrate-split governance — plus the operational-minimum V1 dashboards configured in PostHog that surface the 6 V1-bodied KPIs from 07B's registry. Everything warehouse-backed (executive scorecard body, learning analytics surfaces, cohort retention dashboards, financial dashboards, churn dashboards) is V1.1+ target-state that activates when the BigQuery export goes live per W-07-PostHog-BQ.

The single most important discipline 07C enforces, stated up front: **07C is not a "what dashboards do we want?" doc.** It is a contract that constrains *every* future dashboard to reference 07B's canonical KPI registry by `kpi_id`, to declare an `audience` field that passes the internal-only invariant (V1) or the explicit V1.1+ scope-expansion review (per W7), and to inherit 07E's small-cell/cardinality guardrail when it groups by exam-date or cohort dimensions. KPI bodies that belong to other docs (07B's measurement bodies, 05B's mastery formula, 03 §24 LISA cost, Doc 09 financial unit economics) are **cited by exact `kpi_id`, never restated** in dashboard specs (Decision 5; INV-07-06 carries forward; audit P27).

## **1.2 What 07C owns vs references (the one-question-per-doc boundary)**

Per the canonical doc-architecture principle, 07C's question is: **"How does Lyceon's internal team consume analytics through dashboards — without inventing new KPI definitions, without leaking dashboards to external audiences before privacy posture is re-evaluated, and without losing definitional continuity when the V1 PostHog dashboards migrate to V1.1+ warehouse-backed dashboards?"**

07C owns the **dashboard registry \+ substrate-split governance \+ audience enforcement \+ executive-scorecard contract**. It does NOT own: the KPI registry (07B), the warehouse models (07B), the event taxonomy (07A), the retention/cascade policy (07E), the identity model (Doc 01), the financial KPI bodies (Doc 09 — FWD-07-01), or the V1.1+ dashboard tool's vendor body (Doc 06E via W-07C-V1.1-TOOL-SELECTION). The §17 cross-doc seam table grounds every one of these boundaries by exact §.

## **1.3 The V1 deliverable vs the V1.1+ infrastructure**

**Launch-required at V1 (the spec deliverable \+ the operational-minimum dashboards):**

* The `infra/dashboard-registry.yaml` canonical dashboard roster (names \+ audiences \+ `kpi_ids` references \+ substrate annotations \+ status: `bodied_v1 | contract_v1_body_v1_1 | name_only_stub` per RB-07C-V1-01 three-value enum) with INV-07-10 (internal-only audience enforcement) \+ INV-07-11 (dashboard-to-KPI-registry parity) launch-required (§8).  
* The V1 bodied operational dashboard configured in PostHog (§9) — surfaces the 6 V1-bodied KPIs from 07B's registry: KPI-ENG-01 daily\_active\_users, KPI-ENG-03 monthly\_active\_users, KPI-ENG-06 d30\_retention\_rate, KPI-LRN-02 exam\_completion\_rate, KPI-BIZ-01 subscription\_conversion\_rate, KPI-BIZ-02 paid\_subscriber\_count.  
* The executive-scorecard contract (§10) — V1 contract locks audience \+ KPI references \+ cadence; the bodied scorecard is V1.1+.  
* The internal-only-at-V1 audience invariant (§7) — bodies Parent W7 as an executable gate.

**Target-state V1.1+ (activates per W-07-PostHog-BQ BigQuery \+ W-07C-V1.1-TOOL-SELECTION dashboard-tool activation):**

* The warehouse-backed dashboard tool itself (§6 — Looker Studio is the leading candidate per Karl's GCP-consolidation lean; Metabase \+ Hex remain in scope; final selection at additive resolution).  
* The executive-scorecard body (§10 — contract is launch-required; body activates when the warehouse \+ scorecard tool come online).  
* Learning-analytics dashboards (mastery cohorts, exam-score progression, practice-velocity — reference 07B's `trajectory__*` models which are themselves declared-shape V1.1+).  
* Cohort retention dashboards (reference 07B's `cohort__*` models, declared-shape V1.1+).  
* Financial dashboards (reference Doc 09 financial KPI bodies via FWD-07-01).  
* LISA cost / capacity dashboards (reference Doc 03 Main §11/§24 by `kpi_id`).

## **1.4 The two standing directives applied to 07C**

Per Karl's locked family directives:

1. **No cleanup register.** 07C carries §19 Change Records (locked-decision rationale — reader-relevant) but no cleanup register section. In-lock-cycle SWE cleanup items are recorded in the relevant §19 change record narrative, not in a standalone register table. (Same convention as 07B; deliberate departure from 07A/07E which carried both, not retroactively stripped.)  
2. **Strict no-redundancy / Decision 5\.** Every dashboard reference to a KPI is by `kpi_id` only; no dashboard spec restates a measurement formula, a 05B mastery body, a 03 §24 LISA cost tier, a 06E vendor cost rate, a Doc 09 financial formula, or a 07B warehouse table definition. The DD-07-REDEF defect class (any 07C line that restates a primitive another doc owns) is checked by the §15 audit.

---

# **§2 — Scope & Boundary**

## **2.1 In scope (07C owns)**

The dashboard substrate spec including substrate-split semantics PostHog-at-V1 / warehouse-backed-at-V1.1+ (§5); the V1.1+ dashboard-tool selection rationale \+ criteria (§6 — Looker Studio as the leading candidate plus Metabase \+ Hex still in scope); the internal-only-at-V1 audience invariant \+ audience taxonomy (§7 — INV-07-10 bodies Parent W7); the `infra/dashboard-registry.yaml` canonical dashboard roster \+ INV-07-10 \+ INV-07-11 proving mechanisms (§8); the V1 bodied operational dashboard configured in PostHog surfacing the 6 V1-bodied KPIs (§9); the executive-scorecard contract — dedicated section per Parent line 34 (§10); the dashboard-to-KPI parity discipline (§11); the warehouse-vs-PostHog substrate-split governance (§12); the dashboard-side cascade \+ cardinality conformance inheritance from 07E \+ 07B (§13).

## **2.2 Ownership boundary table (07C owns / referenced owner)**

| Concern | Owner | 07C section |
| ----- | ----- | ----- |
| Dashboard substrate spec | **07C** | §5 |
| V1.1+ dashboard-tool selection rationale \+ criteria | **07C** | §6 |
| V1.1+ dashboard-tool vendor body (when chosen) | Doc 06E §5/§7/§10/§13 (via W-07C-V1.1-TOOL-SELECTION) | §6 references |
| Internal-only audience invariant | **07C** (INV-07-10, bodies Parent W7) | §7 |
| `infra/dashboard-registry.yaml` canonical dashboard roster | **07C** | §8 |
| `ci/dashboards-internal-only` (INV-07-10) | **07C** | §8 \+ §7 |
| `ci/dashboard-references-kpi-registry` (INV-07-11) | **07C** | §8 \+ §11 |
| V1 bodied operational dashboard (PostHog-configured) | **07C** | §9 |
| Executive-scorecard contract | **07C** | §10 |
| The KPIs the dashboards reference | Doc 07B §9.5 `infra/kpi-registry.yaml` | §11 references |
| KPI measurement bodies | Doc 07B (for the 6 V1-bodied) \+ Doc 05B (mastery) \+ Doc 03 (LISA) \+ Doc 06E (infra cost) \+ Doc 09 (financial via FWD-07-01) | §11 references |
| Event definitions | Doc 07A V1.0 §5/§6 | §11 references (via KPI registry) |
| Substrate-split (PostHog ↔ warehouse-backed) governance | **07C** | §12 |
| The V1 PostHog substrate body | Doc 06A §3 \+ Doc 06E §7 (PostHog vendor body via W-07-PostHog-BQ) | §5 / §12 references |
| The V1.1+ warehouse substrate body | Doc 07B \+ Doc 06E §7 (BigQuery vendor body via W-07-PostHog-BQ) | §5 / §12 references |
| Small-cell / cardinality policy | Doc 07E §15 W5 (policy \+ threshold) \+ Doc 07B §10.3 (warehouse-side enforcement) | §13 references (07C inherits, never re-implements) |
| Retention / cascade policy | Doc 07E §5/§7/§10 | §13 references |
| Identity model \+ role taxonomy (for "internal team" definition) | Doc 01 V6.0 | §7 references |
| Alert routing (V1.1+ dashboard-related alerts) | Doc 06C §7 `infra/alert-registry.yaml` | §14 references (07C V1 produces no alerts per INV-07-09) |

## **2.3 Out of scope (referenced, never restated)**

Per Decision 5, the following are explicitly NOT 07C's to define — 07C references the canonical owner by exact §:

* **The 35-KPI canonical roster \+ the 6 V1-bodied KPI measurement bodies** → Doc 07B V1.0 §9.5. 07C dashboards reference KPIs by `kpi_id`; they never restate a measurement body.  
* **The fact/dimension/cohort/trajectory model declared-shape contracts** → Doc 07B V1.0 §9/§10. V1.1+ dashboards read from these models when 07B activates the bodies.  
* **The `analytics_user_id` HMAC contract \+ the event taxonomy \+ the event-time PII redaction contract** → Doc 07A V1.0 §6/§7/§8.  
* **The retention class taxonomy \+ the cascade policy \+ the under-13 hard-delete \+ the small-cell/cardinality policy** → Doc 07E V1.0 §5/§7/§10/§15 W5.  
* **The Doc 06D §9 retention registry substrate** → Doc 06D V1.0.  
* **The per-vendor infra cost bodies** → Doc 06E §7 (PostHog \+ BigQuery via W-07-PostHog-BQ; the V1.1+ dashboard tool via W-07C-V1.1-TOOL-SELECTION).  
* **The mastery KPI body math** → Doc 05B §3-§5.  
* **The LISA cost/cap bodies** → Doc 03 Main §11/§24.  
* **The financial unit economics bodies** → Doc 09 (FWD-07-01).  
* **The identity model \+ the role taxonomy** → Doc 01 V6.0.  
* **Student-facing reporting** → Doc 04C / app surfaces (explicitly out of scope at V1 per Q-07-5=β internal-only).  
* **Guardian-facing surfaces** → Doc 01 \+ Doc 04C (explicitly out of scope at V1).  
* **School-admin / regulator / board-reporting dashboards** → V1.1+ scope expansion per Parent W7.  
* **Experimentation dashboards** → Doc 07D (FWD-07C-01).

---

# **§3 — Threat Model**

Dashboards are the place where canonical KPIs become decisions. The threats are specific to that translation — each names its defense by reference to the owning mechanism.

1. **A dashboard surfaces a KPI by a name that isn't in 07B's canonical registry.** Someone builds a "Weekly Engagement" dashboard tile using an ad-hoc query against 07A events and labels it WAU; later, a registered `KPI-ENG-02 weekly_active_users` stub gets bodied with a slightly different definition, and now Lyceon has two contradictory "WAU" numbers in circulation. The same KPI-definition-drift threat Parent §3 line 96 surfaces, materialized at the dashboard layer. *Defense:* INV-07-11 `ci/dashboard-references-kpi-registry` (§8 / §11) — every dashboard tile MUST reference a `kpi_id` from 07B's canonical `infra/kpi-registry.yaml`; a tile with a free-text metric label that doesn't resolve to a registered `kpi_id` is a registry violation.

2. **A dashboard surfaces to an external audience without re-evaluating privacy posture.** Parent W7 is explicit: V1 consumers are internal team only; V1.1+ scope expansion to external consumers (board reporting, parent-facing, regulator, school admin) requires re-evaluation. The threat is gradual scope creep — a board-deck dashboard exported once, a parent newsletter using a dashboard screenshot, a regulator submission. Each individual case looks innocuous; the cumulative effect is V1 surfaces operating under V1.1+-scope risk. *Defense:* INV-07-10 `ci/dashboards-internal-only` (§7 / §8) — every registered V1 dashboard's `audience` field MUST be `internal_team`; any other value is a registry violation. The invariant is the executable gate that bodies Parent W7 — V1.1+ scope expansion requires an explicit change to the invariant \+ a documented privacy-posture re-evaluation.

3. **Dashboards drift in definition from their underlying KPI.** A dashboard tile references `KPI-ENG-01 daily_active_users` but applies its own filter (e.g., "active users excluding admin accounts") that diverges from the canonical KPI body. Two implementers reading the same `kpi_id` get different numbers. *Defense:* §11 dashboard-to-KPI parity discipline — a dashboard tile that references a `kpi_id` MUST apply the canonical measurement body exactly as specified in 07B's registry. Tile-level filters that diverge from the canonical body are either (a) registered as a new KPI in 07B's registry (with its own `kpi_id` and canonical owner-cite) or (b) rejected.

4. **The V1 → V1.1+ migration loses definitional continuity.** A V1 PostHog dashboard surfacing `KPI-BIZ-02 paid_subscriber_count` is rebuilt in V1.1+ on Looker Studio (or Metabase/Hex) against the warehouse, and the new dashboard produces a slightly different number because the warehouse computation diverged from the PostHog computation. The "we trust the dashboard" assumption breaks at the substrate boundary. *Defense:* §12 substrate-split governance — both the V1 PostHog-built and the V1.1+ warehouse-backed dashboards reference the same canonical `kpi_id` in 07B's registry; the canonical measurement body in `infra/kpi-registry.yaml` is the single source of truth that both substrates compute against. If the numbers differ, one substrate has drifted from the canonical body, and the parity check (07B §9.5.3: "the YAML is canonical and carries the full exact filters so two implementers compute the identical number") catches it.

5. **A dashboard exports an aggregate that violates 07E's small-cell / cardinality policy.** A dashboard grouped by `exam_date` \+ `exam_date_cohort_id` \+ geography surfaces small cells (e.g., "students with exam date June 1 \+ cohort X \+ school Y" with N=3) that are quasi-identifying — defeating the pseudonymization the warehouse depends on (07E §3 threat 1 \+ §15 W5; 07B §10.3). *Defense:* §13 dashboard-side cascade \+ cardinality conformance inheritance — 07C dashboards inherit 07B §10.3 (warehouse-side min-cell suppression/bucketing) \+ 07E §15 W5 (policy \+ threshold). 07C does NOT re-implement the policy (Decision 5); it requires that any dashboard tile grouped by high-cardinality cohort dimensions is sourced from a model that already applied the suppression upstream.

6. **Dashboard tile caches retain pseudonymized data past the cascade.** Dashboard tools (PostHog, Looker Studio, Metabase) often cache query results for performance; if a cached aggregate retains a user's contribution after their cascade fires, the cascade is undermined at the dashboard layer. *Defense:* §13 inherits 07E §7.3 / 07B §12 cascade semantics — for 13+ pseudonymized retention, no warehouse mutation is needed (the Supabase bridge severance makes the cache pseudonymized-at-fact); for under-13 hard-delete, dashboard caches MUST be invalidated/rebuilt before any external dashboard surface displays an aggregate that could include cascaded data. The migration to V1.1+ warehouse-backed dashboards (§12) explicitly includes a cache-invalidation contract for the chosen tool.

7. **Executive-scorecard contract drifts at V1.1+ activation.** Parent line 34 explicitly names the executive-scorecard contract as a 07C deliverable. The threat is that the V1 contract (audience \+ KPI references \+ cadence) gets re-negotiated at V1.1+ body-time, and the bodied scorecard surfaces KPIs the V1 contract didn't include or omits KPIs it did. *Defense:* §10 — the executive-scorecard contract is a dedicated, locked V1 spec; the V1.1+ body MUST match the V1 contract or registry-route any changes through a documented contract amendment (no silent additions/deletions).

8. **Internal-only invariant gets relaxed without going through the watch item.** Parent W7 declares V1.1+ scope expansion as a re-evaluation trigger. The threat is INV-07-10 getting relaxed via an "obvious case" (e.g., "the board wants to see this one chart") without the formal re-evaluation. *Defense:* INV-07-10 is a hard CI gate; relaxing it requires a documented invariant change which is itself a code-review event. Parent W7 explicitly says re-evaluation, not waiver.

---

# **§4 — Launch vs V1.1+ Dashboard Framing**

Per Doc 07 Parent §4 \+ line 175 ("Mostly target-state; minimal launch content"), 07C is the most target-state-leaning sub-doc in the Doc 07 family. Every 07C mechanism declares `launch_required: bool` per the Doc 06E §4 convention adopted family-wide.

## **4.1 Launch-required at V1**

* **`infra/dashboard-registry.yaml` canonical dashboard roster** (names \+ audiences \+ `kpi_ids` \+ substrate annotations \+ status: `bodied_v1 | contract_v1_body_v1_1 | name_only_stub` per RB-07C-V1-01 three-value enum) — `launch_required: true`. The registry is the canonical anti-drift contract — same role for dashboards that 07B's KPI registry plays for KPIs.  
* **`ci/dashboards-internal-only` (INV-07-10)** — `launch_required: true`. Hard-fails on any registered V1 dashboard whose `audience` is not `internal_team`. Bodies Parent W7 as an executable gate (§7 / §8).  
* **`ci/dashboard-references-kpi-registry` (INV-07-11)** — `launch_required: true`. Hard-fails on any dashboard tile referencing a `kpi_id` that doesn't resolve to a canonical entry in 07B's `infra/kpi-registry.yaml` (§8 / §11).  
* **The V1 bodied operational dashboard configured in PostHog (§9)** — `launch_required: true`. Surfaces the 6 V1-bodied KPIs from 07B's registry; the operational minimum the internal team needs at launch.  
* **The executive-scorecard contract** (§10) — `launch_required: true`. The V1 contract (audience \+ KPI references \+ cadence \+ the substrate-migration commitment) locks; the bodied scorecard activates V1.1+.

## **4.2 Target-state V1.1+ (activates per W-07-PostHog-BQ \+ W-07C-V1.1-TOOL-SELECTION)**

* **The V1.1+ warehouse-backed dashboard tool selection \+ activation** (§6 — Looker Studio leading candidate; Metabase \+ Hex in scope; final selection deferred).  
* **The executive-scorecard body** (§10 — contract locked V1, body activates V1.1+).  
* **Learning-analytics dashboards** (mastery cohorts, exam-score progression, practice-velocity — reference 07B's `trajectory__*` declared-shape models which themselves activate V1.1+).  
* **Cohort retention dashboards** (reference 07B's `cohort__*` declared-shape models).  
* **Financial dashboards** (reference Doc 09 financial KPI bodies via FWD-07-01).  
* **LISA cost / capacity dashboards** (reference Doc 03 Main §11/§24 KPI bodies by `kpi_id`).  
* **Churn dashboards** (reference 07B's churn-related stub KPIs once bodied V1.1+).

## **4.3 Deploy-gate class**

07C adopts the **SPEC\_CONTRACT\_GATE** class from Doc 07 Parent §4: 07C's spec must lock before V1.1+ dashboard infrastructure deploys, even though the dashboards themselves are V1.1+. 07C also inherits the **W-07-PostHog-BQ deploy gate** (BigQuery vendor body in 06E §7) and introduces a new **W-07C-V1.1-TOOL-SELECTION deploy gate**: the V1.1+ warehouse-backed dashboards cannot deploy until the chosen tool (Looker Studio, Metabase, Hex, or another candidate) is registered in Doc 06E §5/§7/§10/§13. **Spec lock proceeds in parallel with both deploy gates; neither blocks 07C V1 spec lock.**

---

# **§5 — Dashboard Substrate Spec**

**launch\_required: false for the substrate body (V1 PostHog dashboards exist by virtue of the PostHog Tier-1 vendor; V1.1+ warehouse-backed dashboards activate per W-07-PostHog-BQ \+ W-07C-V1.1-TOOL-SELECTION). launch\_required: true for the substrate-split governance contract (§5.3).**

## **5.1 The two substrates (V1 PostHog / V1.1+ warehouse-backed)**

V1: **PostHog's built-in dashboards**. PostHog is the Tier-1 launch-required analytics substrate (Doc 06A §3 \+ W-07-PostHog-BQ); its built-in dashboard product is included with the PostHog vendor body (Doc 06E §7 via W-07-PostHog-BQ — referenced, never restated). 07C does not "deploy" PostHog dashboards; it configures them. The V1-bodied dashboard in §9 (the unique `DASH-OPS-01 founder_operational_v1` per RB-07C-V1-06) surfaces the 6 V1-bodied KPIs from 07B's registry as PostHog dashboard tiles configured against the V1 PostHog event stream.

V1.1+: **a warehouse-backed dashboard tool** (Looker Studio, Metabase, Hex, or another candidate — §6 selection). The V1.1+ tool reads from 07B's BigQuery warehouse normalized event stream \+ 07B's fact/dimension/cohort/trajectory models (when those activate per 07B §15.2). 07C V1 locks the substrate-split contract (which dashboards live on which substrate, the migration discipline); the V1.1+ tool's vendor body lands via W-07C-V1.1-TOOL-SELECTION.

## **5.2 Why two substrates (the migration story)**

Per Parent §6 (Stack-consolidation drift, line 98\) \+ line 194: PostHog at V1 collapses four potential vendor decisions (product analytics \+ dashboards \+ A/B testing \+ funnels) into one. The free tier covers Lyceon launch volumes by wide margin. The PostHog → BigQuery export pipeline (07B §6) is the foundation that lets V1.1+ migrate to warehouse-backed dashboards without re-instrumentation. The migration is the strategically-intended path, not a fallback: V1 minimizes vendor decisions while preserving the V1.1+ option to consolidate on GCP-native warehouse-backed analytics per Karl's stack-consolidation lean (Parent W9).

The migration discipline is: every V1 PostHog dashboard's canonical-KPI references in `infra/dashboard-registry.yaml` are substrate-agnostic. When a dashboard migrates from V1 PostHog substrate to V1.1+ warehouse-backed substrate, the registry entry's `data_source` field updates from `posthog_v1` to `warehouse_v1_1_plus` but the `kpi_ids[]` and `audience` and the dashboard's semantic definition remain unchanged. This is what enables §3 threat 4's defense.

## **5.3 The substrate-split governance contract (launch-required)**

**launch\_required: true.** This is the governance contract that survives the substrate migration.

Every entry in `infra/dashboard-registry.yaml` declares its `data_source` (per §8.2 schema): `posthog_v1` (V1 PostHog-configured dashboard) or `warehouse_v1_1_plus` (V1.1+ warehouse-backed dashboard). The substrate-split governance contract:

* **No dashboard registered as `warehouse_v1_1_plus` may be marked `bodied_v1`** — a registry validation rule. If the dashboard is V1.1+ substrate, it is V1.1+ status by construction.  
* **A dashboard whose `data_source` migrates from `posthog_v1` to `warehouse_v1_1_plus` MUST retain its `kpi_ids[]` and `audience`** — the substrate-migration commitment per §3 threat 4\. If migration would change the KPIs surfaced, that is registry-routed as a new dashboard, not a substrate migration of an existing one.  
* **The §11 dashboard-to-KPI parity discipline applies identically to both substrates** — V1 PostHog and V1.1+ warehouse-backed dashboards both reference 07B's canonical KPI registry by `kpi_id`, both apply the canonical measurement body exactly, and both are checked by INV-07-11.

---

# **§6 — V1.1+ Dashboard-Tool Selection**

**launch\_required: false for the tool selection itself (V1.1+ activation event). launch\_required: true for the selection criteria \+ the W-07C-V1.1-TOOL-SELECTION additive declaration.**

## **6.1 Tool-agnostic at V1.0 (per Q-07C-2=a-modified)**

Per Karl's pre-draft Q-07C-2 decision (locked in §19 CR-07C-01): 07C stays **tool-agnostic at V1.0** for the V1.1+ warehouse-backed dashboard tool. Parent line 214 lists Metabase / Looker Studio / Hex as V1.1+ candidates. **Looker Studio is named as a leading V1.1+ candidate per Karl's GCP-consolidation lean (Parent W9)** — it is the GCP-native warehouse-backed-dashboard tool, integrates with BigQuery without an additional connector, and aligns with the family's stack-consolidation strategy. **However, Looker Studio is not the final or only choice** — Metabase and Hex remain in scope, and the final selection is deferred to the W-07C-V1.1-TOOL-SELECTION additive's resolution event.

## **6.2 Selection criteria (the locked V1 contract)**

When the V1.1+ tool is selected, it MUST satisfy these criteria (any candidate that fails any criterion is disqualified):

1. **Warehouse-backed.** The tool reads from BigQuery (07B's warehouse) directly, not from PostHog. PostHog-backed analytics are V1 substrate; V1.1+ migration to warehouse-backed is the strategic intent (§5.2).  
2. **Consumes Lyceon-supplied registry-bound query templates or views (RB-07C-V1-03).** The selected dashboard tool must support registry-bound query templates or views supplied by Lyceon. Each dashboard tile must be traceable to a `kpi_id` through a Lyceon-owned mapping layer — specifically the **Doc 07B §9.6 Registry-Bound KPI Views Layer** (BigQuery views named by `kpi_id` in `lyceon_analytics_models_<env>`; landed via 07B CR-07B-04 in-lock-cycle additive triggered by this RB), dashboard metadata, or checked query-template manifests. **The tool does not need native awareness of `infra/kpi-registry.yaml`**; Lyceon's CI (INV-07-11 \+ 07B's INV-07-05 \+ INV-07-06) owns parity. This keeps the requirement implementable across Looker Studio, Metabase, Hex, and any future candidate.  
3. **Supports the internal-only audience invariant \+ access controls per RB-07C-V1-02.** The tool's access-control model must permit role-bound dashboards (internal-team-only by default) with auditable access AND support disabling public-link sharing AND support disabling iframe/embed sharing. Tools whose default sharing model is "anyone with the link" without enforced authentication, OR tools that cannot disable public sharing entirely, are incompatible. Equivalent surface examples: Looker Studio's Google-identity-bound access controls; Metabase's collection permissions; Hex's workspace access controls.  
4. **Respects 07B's partition-bounded query discipline.** The tool must support partition-predicate filters in its query templates (07B §14.2 — partition-required on every large table). A tool that issues unbounded full-table scans by default is incompatible with the cost-governance contract.  
5. **Prevents stale under-13 data after cascade — at least one approved path (RB-07C-V1-04).** The dashboard path must prevent stale under-13 data from being displayed after cascade. The criterion is satisfied by ANY ONE of these approved paths: (1) **tool-level cache invalidation** — the tool supports per-cascade cache invalidation; (2) **cache minimization** — the tool's caching can be disabled or its TTL minimized below the cascade response window for affected dashboards; (3) **post-cascade materialized views** — the dashboard sources from 07B-side materialized views/tables that exclude purged users (per 07B §12 partition-bounded cascade), so the dashboard's query reads cascade-correct state regardless of tool cache; (4) **access blocking until verified refresh** — the dashboard is blocked from displaying until a verified post-cascade refresh completes. A candidate tool is disqualified ONLY if it can satisfy NONE of these four paths. This preserves Looker Studio, Metabase, and Hex as viable candidates while keeping the cascade obligation real.  
6. **Vendor body fits 06E §5/§7/§10/§13 registration.** The chosen tool must be registrable as a Doc 06E vendor (any Tier — most likely Tier-1 target-state) with a substrate-cap and cost-model section. Tools whose pricing is per-seat-unbounded or whose enterprise pricing is opaque-on-request-only are evaluated against the substrate-cap discipline.

## **6.3 Looker Studio as leading candidate (rationale)**

Looker Studio (formerly Google Data Studio) is named as the leading candidate because:

* **GCP-native, BigQuery-native integration.** Matches Karl's GCP-consolidation lean (Parent W9); zero additional connector infrastructure (no Cloud-Run substrate for the dashboard tool itself — distinct from W-07B-DOC03C-EXPORT-SUBSTRATE which is about the BigQuery export, not the dashboard read).  
* **Cost-effective at Lyceon's scale.** Looker Studio's BigQuery integration is included in standard GCP usage; no separate per-seat license for V1.1+ launch volumes.  
* **Supports the §6.2 criteria baseline** — warehouse-backed (criterion 1); consumes 07B §9.6 registry-bound KPI views by name (criterion 2 — no native registry awareness needed; Looker Studio reads `FROM lyceon_analytics_models_<env>.kpi_<id>` as ordinary BigQuery views); Google-identity-bound access control via the Lyceon GCP organization with public-link and embed sharing disablable per RB-07C-V1-02 (criterion 3); partition-predicate-aware (criterion 4); for the cascade-cache criterion 5, Looker Studio most likely satisfies via **path (3) post-cascade materialized views** (sourcing from 07B-side cascade-correct views/tables so dashboard reads are cascade-correct regardless of tool cache) and/or **path (4) access blocking until verified refresh** — final cascade-path selection deferred to the W-07C-V1.1-TOOL-SELECTION resolution event, not normative at V1 spec.

**However:** Metabase (open-source, self-hostable, strong SQL templating) and Hex (notebook-driven, strong for ad-hoc exploratory analysis) remain in scope. The final selection is deferred — 07C does NOT pre-commit. The W-07C-V1.1-TOOL-SELECTION additive resolves when the V1.1+ activation event occurs.

## **6.4 The W-07C-V1.1-TOOL-SELECTION cross-doc additive (declaration)**

When the V1.1+ warehouse-backed dashboard tool is chosen, an additive lands in Doc 06E registering the tool as a vendor with the full §5/§7/§10/§13 registration (per the W-07-PostHog-BQ pattern that 07B's W3 watch item also references). The additive carries:

* Vendor name (Looker Studio / Metabase / Hex / other).  
* Tier classification (most likely Tier-1 target-state; possibly Tier-2).  
* §5 inventory entry \+ §6 outage runbook \+ §7 cost-structure subsection \+ §10 substrate-cap configuration \+ §13 pricing-snapshot entry.

Status: bounded; resolves at V1.1+ warehouse-backed dashboard activation event. 07C V1 spec lock does NOT require the additive to resolve (the additive is a deploy gate, not a spec lock gate — same SPEC\_CONTRACT\_GATE pattern as W-07-PostHog-BQ).

---

# **§7 — Internal-Only-at-V1 Audience Invariant \+ Audience Taxonomy**

**launch\_required: true.** This section bodies Parent W7 ("Internal-only-at-V1 assumption (Q-07-5=b)") as an executable invariant.

## **7.1 The audience taxonomy**

A dashboard's `audience` field declares who is permitted to view it. The V1 taxonomy:

* **`internal_team`** — Lyceon internal team members (founders, employees, contractors under NDA). This is the **only permitted V1 value**.

The taxonomy reserves these values for V1.1+ scope-expansion review (Parent W7), each of which requires a documented privacy-posture re-evaluation before any dashboard is registered with that audience:

* **`guardian`** — Reserved V1.1+. Guardian-facing dashboards are explicitly out of scope at V1 (Doc 01 guardian trust model \+ Doc 04C territory; not 07C scope at V1 even after V1.1+ unlock — this value would only enter 07C scope if guardian-facing analytics dashboards become a 07C-owned surface, which would itself be a scope decision).  
* **`student`** — Reserved V1.1+. Student-facing analytics is Doc 04C territory; if any student-facing dashboard becomes 07C-owned at V1.1+, it requires explicit scope decision.  
* **`school_admin`** — Reserved V1.1+. School-admin dashboards (for B2B / school-license sales) require privacy posture re-evaluation per Parent W7.  
* **`regulator`** — Reserved V1.1+. Regulator-facing dashboards (compliance reporting) require privacy posture re-evaluation per Parent W7.  
* **`board`** — Reserved V1.1+. Board-reporting dashboards (export to investor decks or board meetings) require privacy posture re-evaluation per Parent W7.  
* **`public`** — **Never permitted for 07C-governed internal analytics dashboards (RB-07C-V1-09).** This is an absolute restriction within 07C's scope regardless of V1 / V1.1+. Public marketing-facing or social-proof analytics surfaces (e.g., a public-facing "students helped" counter on the marketing site, public testimonials data, social-proof aggregates for the homepage) are **outside 07C's scope** and would belong to **Doc 10 (FWD-07-03)** if introduced — they are brand/social-proof analytics, not internal analytics dashboards. 07C never declares a `public` audience because 07C never owns a public surface; Doc 10 would own its own surface model if a public analytics need ever arises, with its own privacy/PII/cardinality discipline appropriate to public exposure.

## **7.2 INV-07-10 `ci/dashboards-internal-only` (the executable invariant)**

Per Parent §6.13 six-element implemented-definition (RB-07C-V1-02 hardened to ban PostHog public links \+ iframe/embed sharing; PostHog supports both per the vendor sharing docs, and the audience invariant is not enforced unless these are explicitly disabled):

| Element | Definition |
| ----- | ----- |
| What it proves | Every registered V1 dashboard in `infra/dashboard-registry.yaml` declares `audience: internal_team`; for PostHog-substrate dashboards, public-link sharing is disabled, iframe/embed sharing is disabled, and visibility is restricted to authenticated organization/project members (RB-07C-V1-02); bodies Parent W7 as an executable gate |
| Execution location | GitHub Actions, on PRs touching `infra/dashboard-registry.yaml`; plus nightly |
| Input | `infra/dashboard-registry.yaml` (audience \+ `posthog_access_control` block per §8.2 entry shape) \+ the audience-taxonomy whitelist (§7.1 — V1 permits only `internal_team`) \+ the PostHog vendor sharing/access-control surface (verified for `data_source: posthog_v1` entries) |
| Failure condition | (a) Any dashboard entry with `audience` value other than `internal_team` (V1 invariant); (b) any dashboard entry with empty/null `audience`; (c) any dashboard entry whose `audience` is `public` (never permitted for 07C-governed internal analytics dashboards regardless of V1/V1.1+; per RB-07C-V1-09 future public marketing/social-proof surfaces would belong to Doc 10 if introduced, not 07C); (d) any dashboard entry with a deprecated audience value not present in §7.1; (e) **for any `data_source: posthog_v1` entry: `posthog_access_control.public_link_enabled` is true, OR `posthog_access_control.embed_enabled` is true, OR `posthog_access_control.visibility_restricted_to_authenticated_members` is false (RB-07C-V1-02)**; (f) **for any `data_source: posthog_v1` entry: the `posthog_access_control` block is missing entirely (RB-07C-V1-02 — the access-control fields are required for PostHog-substrate dashboards, not optional)** |
| Proof artifact | `dashboards-internal-only` record per Parent §10.5 envelope \+ extras: `dashboards_checked[]`, per-dashboard `{dashboard_id, audience, audience_resolution, data_source, public_link_enabled, embed_enabled, visibility_restricted_to_authenticated_members, decision}`. Subject to Doc 06D §8.7 (carries dashboard-id \+ audience-enum \+ boolean access-control flags only; no user data). |
| launch\_required | true |

The PostHog access-control surface (organization-level \+ project-level \+ resource-level permissions per the PostHog vendor docs — referenced, never restated) is the right enforcement substrate for V1; INV-07-10's CI check reads the dashboard registry's `posthog_access_control` block and verifies the recorded state against PostHog's actual configuration. **A PostHog dashboard whose registry declares `public_link_enabled: false` but is actually publicly shared at the vendor surface is itself an INV-07-10 violation** — the registry is the canonical declaration; vendor-side drift from the declaration is a registry-conformance failure (§3 threat 2). At V1.1+ when warehouse-backed substrate activates per W-07C-V1.1-TOOL-SELECTION, equivalent access-control fields apply to the chosen V1.1+ tool (Looker Studio: Google-identity-bound access; Metabase: collection permissions; Hex: workspace access — the §6.2 criterion 3 ensures any chosen V1.1+ tool supports an equivalent surface).

## **7.3 Relaxing the invariant (the scope-expansion path)**

INV-07-10 is a hard CI gate at V1. Relaxing it at V1.1+ (e.g., permitting `board` or `school_admin` audiences) requires:

1. A documented Parent W7 re-evaluation: privacy posture review against the proposed audience, identification of new compliance gates (e.g., a board-reporting audience may trigger export-control review; a regulator audience may trigger jurisdiction-specific compliance review).  
2. An invariant amendment in this section (§7.1 taxonomy update \+ §7.2 failure condition update) that registers the new permitted audience values.  
3. A code-review event — INV-07-10 itself is a CI rule whose source change is reviewable; the invariant cannot be silently waived per dashboard.

This is the "executable W7" — Parent's policy becomes an enforceable contract whose relaxation has a documented path.

## **7.4 "Internal team" definition (referenced from Doc 01\)**

The definition of "internal team" — who counts as a Lyceon internal team member — is owned by Doc 01 V6.0's identity \+ role model. 07C does NOT redefine internal-team membership; it references Doc 01 for the role taxonomy that resolves the membership. The dashboard tool's access control (PostHog at V1, the V1.1+ warehouse-backed tool when chosen) binds to Doc 01's role assignments through standard authentication. 07C's contribution is the registry-level invariant that every dashboard's `audience` declares `internal_team`; Doc 01 owns the membership semantics.

---

# **§8 — The `infra/dashboard-registry.yaml` Canonical Dashboard Roster**

**launch\_required: true.** This is the launch-required core of 07C — the same role for dashboards that 07B's `infra/kpi-registry.yaml` plays for KPIs.

`infra/dashboard-registry.yaml` is the canonical machine-readable dashboard registry per Doc 06C §6.0 registry-canonical principle (the YAML is canonical; this markdown roster is reference, not source-of-truth). It carries the V1 dashboard roster \+ the V1.1+ name-only stubs \+ the substrate-split annotations \+ the audience declarations \+ the `kpi_ids` references that INV-07-11 validates against 07B's KPI registry.

## **8.1 Registry purpose**

The registry is the anti-drift contract for dashboards (§3 threats 1, 4, 7, 8\) — same role for dashboards that 07B's KPI registry plays for KPIs. Every dashboard, V1-bodied or V1.1+-stub, is registered with a stable `dashboard_id`, an `audience`, the `kpi_ids` it surfaces, and its substrate annotation. The registry is the single source of truth for "what dashboards Lyceon has"; outside-the-registry dashboards (e.g., ad-hoc PostHog dashboards configured by an individual) are not Lyceon-canonical and are not considered part of 07C's V1.0 contract.

## **8.2 Registry entry shape**

dashboards:  
  \- dashboard\_id: \<stable id; format 'DASH-\<area\>-\<NN\>'\>           \# e.g. DASH-OPS-01  
    dashboard\_name: \<snake\_case canonical name\>                     \# e.g. founder\_operational\_v1  
    audience: \<internal\_team\>                                       \# V1 invariant: only internal\_team permitted  
    data\_source: \<posthog\_v1 | warehouse\_v1\_1\_plus\>                 \# substrate-split per §5.3  
    status: \<bodied\_v1 | contract\_v1\_body\_v1\_1 | name\_only\_stub\>    \# RB-07C-V1-01 added contract\_v1\_body\_v1\_1 for V1-contract/V1.1+-body pattern; Q-07C-R1-3=b makes it available to any dashboard wanting this pattern, not reserved to scorecard  
    kpi\_ids: \[\<kpi\_id from infra/kpi-registry.yaml\>, ...\]           \# MUST resolve to 07B canonical entries per INV-07-11  
    v1\_1\_kpi\_additions: \[...\]                                        \# ONLY permitted when status=contract\_v1\_body\_v1\_1; locked at V1; activate when each KPI bodies (RB-07C-V1-01)  
    v1\_1\_activation\_trigger: \<required when status=name\_only\_stub OR status=contract\_v1\_body\_v1\_1\>  \# trigger that bodies the dashboard  
    canonical\_owner\_doc\_and\_section: 'Doc 07C V1.0 §9' | 'Doc 07C V1.0 §10' | \<etc\>  
    description: \<one-line purpose\>  
    last\_reviewed\_at: \<iso8601\>  
    \# PostHog-specific access-control fields (REQUIRED when data\_source \= posthog\_v1, per RB-07C-V1-02):  
    posthog\_access\_control:  
      public\_link\_enabled: false                                     \# MUST be false for V1 (RB-07C-V1-02)  
      embed\_enabled: false                                           \# MUST be false for V1 (RB-07C-V1-02)  
      visibility\_restricted\_to\_authenticated\_members: true            \# MUST be true for V1 (RB-07C-V1-02)

The `audience` field is constrained by INV-07-10 (§7.2). The `kpi_ids` are constrained by INV-07-11 (§8.4). The `status` × `data_source` cross-constraint matrix per §5.3 \+ RB-07C-V1-05:

| status | data\_source | Permitted | Rationale |
| ----- | ----- | ----- | ----- |
| `bodied_v1` | `posthog_v1` | YES | The V1 launch posture for the operational minimum (§9) |
| `bodied_v1` | `warehouse_v1_1_plus` | NO | Warehouse infrastructure is V1.1+; cannot be V1-bodied |
| `contract_v1_body_v1_1` | `posthog_v1` | YES | V1 contract surface on PostHog; V1.1+ body migrates per §5.3 |
| `contract_v1_body_v1_1` | `warehouse_v1_1_plus` | YES | V1 contract registered against V1.1+ substrate (the substrate-migration commitment per §5.3) |
| `name_only_stub` | `posthog_v1` | YES | A future V1.1+ dashboard intended for PostHog substrate (unusual; most stubs are warehouse-backed) |
| `name_only_stub` | `warehouse_v1_1_plus` | YES | The default for V1.1+ stub dashboards |

**Three status semantics distinguished:**

* **`bodied_v1`** — the dashboard is actually configured \+ live \+ surfacing data at V1; references only `bodied_v1` KPIs from 07B's registry (INV-07-11 failure condition (d)); MUST NOT carry `v1_1_kpi_additions`.  
* **`contract_v1_body_v1_1`** (new per RB-07C-V1-01; available to any dashboard per Q-07C-R1-3=b) — the V1 contract is locked (audience \+ KPI references \+ cadence \+ the `v1_1_kpi_additions` composition); the bodied dashboard activates at V1.1+ when its `v1_1_activation_trigger` fires; MAY carry `v1_1_kpi_additions` declaring the V1.1+ additions; the V1 surface itself (if any) references only `bodied_v1` KPIs.  
* **`name_only_stub`** — just a reserved canonical name \+ audience \+ KPI-reference list \+ activation trigger; no V1 surface; bodies at V1.1+.

## **8.3 INV-07-10 `ci/dashboards-internal-only` — implementation site here**

See §7.2 for the full six-element table. This section is the implementation site of the registry-side enforcement — the YAML's `audience` field is what the mechanism reads.

## **8.4 INV-07-11 `ci/dashboard-references-kpi-registry`**

Per Parent §6.13:

| Element | Definition |
| ----- | ----- |
| What it proves | Every dashboard tile's `kpi_ids[]` resolves to a canonical entry in Doc 07B's `infra/kpi-registry.yaml`; no dashboard invents a metric name (§3 threats 1, 3\) |
| Execution location | GitHub Actions, on PRs touching `infra/dashboard-registry.yaml` or `infra/kpi-registry.yaml`; plus nightly |
| Input | `infra/dashboard-registry.yaml` (07C-owned) \+ `infra/kpi-registry.yaml` (Doc 07B-owned) — the KPI registry's set of canonical `kpi_id` values is the resolution target |
| Failure condition | (a) Any dashboard entry whose `kpi_ids[]` contains a value not present in 07B's KPI registry; (b) any dashboard entry with empty `kpi_ids[]` (a dashboard with no canonical KPI references is a registry defect — likely an ad-hoc dashboard that should be either registered as a new KPI or removed); (c) any `name_only_stub` dashboard whose `kpi_ids[]` references only `bodied_v1` KPIs (suggests the dashboard should itself be bodied at V1, not stub); (d) any `bodied_v1` dashboard whose `kpi_ids[]` references any `name_only_stub` KPI (a bodied dashboard cannot surface a not-yet-bodied KPI); (e) **any `bodied_v1` dashboard that carries `v1_1_kpi_additions` (RB-07C-V1-01 — `v1_1_kpi_additions` is permitted ONLY on `contract_v1_body_v1_1` status; a fully-bodied V1 dashboard has no V1.1+ pending additions by definition)**; (f) **any `contract_v1_body_v1_1` dashboard whose `kpi_ids[]` (the V1-surfaced KPIs) references any `name_only_stub` KPI (the V1 surface, like a bodied\_v1, can only surface bodied KPIs; V1.1+ additions go in `v1_1_kpi_additions`)** |
| Proof artifact | `dashboard-references-kpi-registry` record per Parent §10.5 envelope \+ extras: `dashboards_checked[]`, per-dashboard `{dashboard_id, kpi_ids_resolved[], kpi_ids_unresolved[], status_consistency_check, decision}`. Subject to Doc 06D §8.7. |
| launch\_required | true |

## **8.5 Registry presence \+ shape \+ state-transition audit (audit P32 — 07C-introduced, RB-07C-V1-05 expanded)**

07C introduces audit pass **P32** to the family suite: **`dashboard-registry-presence-and-shape`** (renamed from initial-draft `dashboard-registry-presence` per RB-07C-V1-05 to reflect the expanded scope — presence-only was too weak for 07C's central risk surface). P32 runs at the same cadence as INV-07-10 \+ INV-07-11.

P32 verifies all of these, with hard-fail on any:

1. **Presence:** the `infra/dashboard-registry.yaml` file exists and parses as valid YAML.  
2. **V1 completeness:** all required V1 dashboard entries are present — `DASH-OPS-01 founder_operational_v1` (§9) AND `DASH-SCORECARD-01 executive_scorecard_v1` (§10) AND any future-locked V1 entries declared in this section.  
3. **Status × data\_source consistency:** every entry's `status` × `data_source` combination is permitted per the §8.2 matrix. Hard-fails if (a) any `warehouse_v1_1_plus` is marked `bodied_v1` (V1.1+ substrate cannot be V1-bodied); (b) any `status` value is outside the 3-value enum (`bodied_v1` / `contract_v1_body_v1_1` / `name_only_stub`).  
4. **Status × KPI-references consistency:** (a) any `bodied_v1` dashboard whose `kpi_ids[]` references any `name_only_stub` KPI in 07B's registry hard-fails (same as INV-07-11 failure (d)); (b) any `bodied_v1` dashboard carrying `v1_1_kpi_additions` hard-fails (same as INV-07-11 failure (e) — `v1_1_kpi_additions` is permitted ONLY on `contract_v1_body_v1_1`); (c) any `contract_v1_body_v1_1` dashboard lacking `v1_1_kpi_additions` hard-fails (a contract-V1-body-V1.1+ dashboard whose `v1_1_kpi_additions` is empty is either misclassified or contractually incomplete).  
5. **Access-control field presence (RB-07C-V1-02):** any `data_source: posthog_v1` entry missing the `posthog_access_control` block (or any required sub-field within it — `public_link_enabled`, `embed_enabled`, `visibility_restricted_to_authenticated_members`) hard-fails. (Field values are checked by INV-07-10; P32 checks field presence.)  
6. **Substrate/tool field presence:** any entry missing `data_source`, missing `audience`, missing `kpi_ids[]`, missing `canonical_owner_doc_and_section`, or missing `v1_1_activation_trigger` when required for its status hard-fails.

This makes P32 match 07C's actual registry risk: not just "is the file there" but "is the file's state-transition matrix consistent with the locked semantics." (P32 is the 07C-family-new audit pass, the same way 07E introduced P31 vocabulary-consistency.) Total family audit suite becomes **32 passes** at 07C lock (30 inherited from Parent \+ P31 from 07E \+ P32 from 07C).

---

# **§9 — V1 Bodied Operational Dashboard (PostHog-Configured)**

**launch\_required: true.** The single V1-bodied dashboard per Karl's Q-07C-4=a decision.

## **9.1 The founder-facing operational dashboard (V1-bodied uniqueness)**

At V1, **exactly one dashboard is bodied** in PostHog: `DASH-OPS-01 founder_operational_v1` — the founder-facing operational dashboard that surfaces the 6 V1-bodied KPIs from 07B's canonical KPI registry. This is the "minimal launch content" Parent line 175 describes — enough operational visibility that the internal team can see Lyceon's pulse at launch, while everything heavier (executive scorecard *body*, learning analytics, cohort retention, financial, churn, LISA cost) is V1.1+ — either `name_only_stub` or `contract_v1_body_v1_1` per the §10 executive-scorecard pattern. **Per RB-07C-V1-06: `DASH-OPS-01` is the only `status: bodied_v1` entry at V1** — `DASH-SCORECARD-01` is `status: contract_v1_body_v1_1` per §10.3 (the V1 contract is locked; the bodied scorecard is V1.1+), not `bodied_v1`.

## **9.2 Registry entry**

\- dashboard\_id: DASH-OPS-01  
  dashboard\_name: founder\_operational\_v1  
  audience: internal\_team  
  data\_source: posthog\_v1  
  status: bodied\_v1                                          \# the unique V1-bodied dashboard per RB-07C-V1-06  
  kpi\_ids:  
    \- KPI-ENG-01      \# daily\_active\_users (07B-bodied)  
    \- KPI-ENG-03      \# monthly\_active\_users (07B-bodied)  
    \- KPI-ENG-06      \# d30\_retention\_rate (07B-bodied)  
    \- KPI-LRN-02      \# exam\_completion\_rate (07B-bodied)  
    \- KPI-BIZ-01      \# subscription\_conversion\_rate (07B-bodied)  
    \- KPI-BIZ-02      \# paid\_subscriber\_count (07B-bodied)  
  canonical\_owner\_doc\_and\_section: 'Doc 07C V1.0 §9'  
  description: 'Founder-facing operational pulse: V1 engagement \+ learning \+ business KPIs from PostHog event stream'  
  last\_reviewed\_at: 2026-05-28  
  \# PostHog access-control block (REQUIRED per RB-07C-V1-02):  
  posthog\_access\_control:  
    public\_link\_enabled: false                               \# MUST be false (INV-07-10 hardened)  
    embed\_enabled: false                                     \# MUST be false (INV-07-10 hardened)  
    visibility\_restricted\_to\_authenticated\_members: true     \# MUST be true (INV-07-10 hardened)

## **9.3 Why exactly these 6 KPIs**

The 6 KPIs are precisely the V1-bodied KPIs from 07B's canonical registry (07B §9.5.3) — the only KPIs whose measurement bodies are deterministically computable at V1 against the PostHog event stream without warehouse infrastructure. Every other Parent §10 KPI is a name-only stub awaiting V1.1+ warehouse activation. Surfacing the 6 bodied KPIs in the V1 operational dashboard matches "minimal launch content" exactly: the dashboard does not surface stub KPIs (INV-07-11 failure condition (d) — a bodied dashboard cannot reference stub KPIs).

## **9.4 Substrate: PostHog at V1**

Per §5.1, the dashboard runs on PostHog's built-in dashboard product. The tile-level queries reference PostHog event names from Doc 07A's `infra/event-schema-registry.yaml` (the same registry 07B's KPI bodies reference, so the dashboard's measurement matches the KPI body by construction — both compute against the same event stream). At V1.1+, this dashboard's `data_source` migrates from `posthog_v1` to `warehouse_v1_1_plus` per the §5.3 substrate-migration governance; the `kpi_ids[]` and `audience` and `description` stay identical (§3 threat 4 defense).

## **9.5 What is NOT in this dashboard at V1**

The dashboard intentionally does NOT surface:

* The 29 V1.1+ name-only-stub KPIs (Parent §10 \+ 07B §9.5.4 — these activate V1.1+ when their underlying models body).  
* The executive-scorecard cadence-bound surface (that's §10's dedicated contract — different audience cadence, different KPI set composition, different substrate at V1.1+).  
* Any guardian/student/school-admin/regulator/board surface (out of scope at V1 per INV-07-10).  
* Any LISA cost / tutor analytics / financial unit economics surface (V1.1+ per Parent §22 — Doc 07 V1 explicitly does not ship "tutor analytics BI surface" or "per-feature cost attribution pipeline").

---

# **§10 — Executive-Scorecard Contract (Dedicated)**

**launch\_required: true for the contract; launch\_required: false for the bodied scorecard (V1.1+).** This section is a dedicated dashboard contract per Parent line 34's explicit naming and Karl's Q-07C-5=a decision to give it its own section.

## **10.1 What an executive scorecard is**

The executive scorecard is the periodic (weekly / monthly — the cadence is a V1 contract parameter) cross-domain KPI surface presented to the internal team for company-pulse review. It is distinct from the §9 founder-operational dashboard in three ways: (a) it bundles a curated cross-domain KPI selection (engagement \+ learning \+ business \+ ops) rather than the single operational pulse; (b) it is cadence-bound (a scorecard *snapshot* per cadence period, archived) rather than always-live; (c) it is the surface most likely to drift toward external-audience use at V1.1+ (board reporting, investor decks), which is exactly why Parent W7 \+ INV-07-10 audience enforcement matters most here.

## **10.2 The V1 contract (locks now; body activates V1.1+)**

The V1 executive-scorecard contract locks:

* **Audience:** `internal_team` (V1) — INV-07-10 enforced.  
* **Cadence:** weekly \+ monthly (two scorecard variants on the same KPI set; the weekly is operational-cadence, the monthly is review-cadence).  
* **KPI composition:** the 6 V1-bodied KPIs from 07B's registry **plus** a designated set of V1.1+ name-only-stub KPIs that activate when their measurement bodies activate. The V1 contract names the V1.1+ stubs the scorecard MUST surface when they body — preventing the V1.1+ activation from re-negotiating composition (§3 threat 7 defense).  
* **Substrate:** `posthog_v1` for the contract entry at V1 (since the V1-bodied KPIs are PostHog-substrate); migrates to `warehouse_v1_1_plus` at V1.1+ when the warehouse-backed scorecard body activates, per §5.3.

## **10.3 V1 contract KPI composition**

The executive scorecard's KPI composition at V1 \+ the named V1.1+ additions:

\- dashboard\_id: DASH-SCORECARD-01  
  dashboard\_name: executive\_scorecard\_v1  
  audience: internal\_team  
  data\_source: posthog\_v1                       \# migrates to warehouse\_v1\_1\_plus at V1.1+ activation  
  status: contract\_v1\_body\_v1\_1                 \# RB-07C-V1-01 — V1 contract locked; bodied scorecard activates V1.1+ (RB-07C-V1-06 — NOT bodied\_v1; DASH-OPS-01 is the unique V1-bodied)  
  kpi\_ids:  
    \# V1-surfaced KPIs (only bodied\_v1 KPIs permitted on the V1 surface per INV-07-11 failure (f)):  
    \- KPI-ENG-01      \# daily\_active\_users  
    \- KPI-ENG-03      \# monthly\_active\_users  
    \- KPI-ENG-06      \# d30\_retention\_rate  
    \- KPI-LRN-02      \# exam\_completion\_rate  
    \- KPI-BIZ-01      \# subscription\_conversion\_rate  
    \- KPI-BIZ-02      \# paid\_subscriber\_count  
  v1\_1\_kpi\_additions:                           \# locked at V1; activate when each KPI bodies in 07B's registry  
    \- KPI-ENG-02      \# weekly\_active\_users  
    \- KPI-ENG-11      \# exam\_anchored\_engagement\_rate (the cohort-class additive)  
    \- KPI-LRN-01      \# mastery\_level\_distribution (refs Doc 05B canonically)  
    \- KPI-LRN-03      \# exam\_score\_progression (refs Doc 04 family)  
    \- KPI-BIZ-03      \# churn\_rate\_monthly (refs Doc 09 via FWD-07-01)  
    \- KPI-OPS-01      \# cost\_per\_mau (refs Doc 06E §8)  
  v1\_1\_activation\_trigger: 'V1.1+ warehouse-backed dashboard tool selected per W-07C-V1.1-TOOL-SELECTION AND at least three v1\_1\_kpi\_additions KPIs bodied in 07B registry AND substrate-split migration governance-approved per §5.3 (see §10.5)'  
  canonical\_owner\_doc\_and\_section: 'Doc 07C V1.0 §10'  
  description: 'Weekly \+ monthly cross-domain executive scorecard; V1 contract surface is operational pulse; V1.1+ body adds the named additions when each KPI bodies'  
  last\_reviewed\_at: 2026-05-28  
  \# PostHog access-control block (REQUIRED per RB-07C-V1-02; PostHog substrate at V1):  
  posthog\_access\_control:  
    public\_link\_enabled: false                  \# MUST be false (INV-07-10 hardened)  
    embed\_enabled: false                        \# MUST be false (INV-07-10 hardened)  
    visibility\_restricted\_to\_authenticated\_members: true  
  \# External-export ban (RB-07C-V1-07):  
  external\_export\_ban: 'No board export, board screenshot, investor-deck reuse, or external forwarding is permitted at V1 unless this dashboard is reclassified through §7.3 scope-expansion review and Parent W7 re-evaluation. The scorecard is the dashboard most likely to drift toward external audiences (§3 threat 2); this explicit ban closes the loophole.'

## **10.4 Why a dedicated section (per Karl Q-07C-5=a)**

Parent line 34 explicitly names "dashboard registry shape" \+ "executive-scorecard contract" as separate 07C deliverables. The executive scorecard gets its own §10 (rather than being one entry in §8's general registry) for three reasons:

1. **It is the dashboard most likely to drift to external audiences** (board reporting, investor deck exports) — Parent W7's archetypal threat. A dedicated section makes the V1 internal-only-bound contract visible.  
2. **The V1.1+ KPI additions are contractually locked at V1.** The `v1_1_kpi_additions` list above is the V1.1+ activation commitment — when KPI-LRN-01 bodies V1.1+, the scorecard surfaces it; this prevents V1.1+ re-negotiation (§3 threat 7).  
3. **Parent explicitly distinguishes it** — line 34 lists "dashboard registry shape" and "executive-scorecard contract" as separate items; giving them separate sections matches Parent's framing.

## **10.5 V1.1+ body activation trigger**

The bodied executive scorecard activates when **all** of these are true: (a) the V1.1+ warehouse-backed dashboard tool is selected \+ registered via W-07C-V1.1-TOOL-SELECTION; (b) at least three of the `v1_1_kpi_additions` KPIs have bodied in 07B's registry (a scorecard with only the 6 V1-bodied KPIs is the V1 surface, not the V1.1+ body — the V1.1+ body requires at least the named additions activating); (c) the substrate-split migration from `posthog_v1` to `warehouse_v1_1_plus` is governance-approved per §5.3. The trigger criterion (b) prevents premature V1.1+ activation when only the warehouse exists but the additional KPIs haven't bodied.

---

# **§11 — Dashboard-to-KPI Parity Discipline**

**launch\_required: true.** This section bodies the relationship between every 07C dashboard and Doc 07B's canonical KPI registry — the executable contract that prevents §3 threats 1, 3\.

## **11.1 The parity rule**

Every dashboard tile in `infra/dashboard-registry.yaml` references one or more `kpi_id`s from Doc 07B's `infra/kpi-registry.yaml`. The reference is by `kpi_id` only — never by free-text metric label, never by inline measurement formula, never by ad-hoc query. The dashboard surfaces the KPI's canonical measurement body as defined in 07B's registry; the dashboard does not redefine the measurement.

This is the dashboard-layer materialization of Decision 5 \+ Parent §3 threat 6 (KPI definition drift) \+ 07B's INV-07-06 (`ci/kpi-body-no-restate`). The KPI registry is the canonical anti-drift contract for KPI definitions; the dashboard registry is the canonical anti-drift contract for dashboards-that-surface-KPIs.

## **11.2 What "references a `kpi_id`" means at the tile level**

A dashboard contains one or more **tiles** (charts, single-number KPIs, tables). Each tile must be traceable to a registered `kpi_id` from the dashboard's `kpi_ids[]` list. Concretely:

* **PostHog dashboards at V1:** each tile's underlying PostHog query computes a measurement that matches a `kpi_id`'s canonical body in 07B's registry. The tile carries a comment / description annotation naming the `kpi_id`; the dashboard registry's `kpi_ids[]` enumerates them.  
* **V1.1+ warehouse-backed dashboards:** each tile is built from a parameterized template that takes a `kpi_id` as input and computes the KPI's canonical body against 07B's normalized event stream. The tile-template mapping is governance-tracked.

A tile that surfaces a measurement NOT in 07B's registry is one of: (a) a registry defect (an unregistered KPI in use — should be either registered with its own `kpi_id` or removed); (b) a dashboard defect (a tile that diverges from a registered KPI's canonical body — INV-07-11 failure condition (a) or §3 threat 3); (c) an ad-hoc exploration that is NOT a Lyceon-canonical dashboard and should not be in `infra/dashboard-registry.yaml`.

## **11.3 INV-07-11 enforces this (§8.4)**

The parity discipline is mechanically enforced by INV-07-11 `ci/dashboard-references-kpi-registry` per §8.4. The six-element table is at §8.4; this section is the *discipline description* and §8.4 is the *implementation site*. Both are referenced — never restating the parity contract in two places.

## **11.4 Tile-level divergence is registry-routed, not silently allowed**

If a dashboard tile legitimately needs a slight variant of a registered KPI (e.g., "DAU excluding admin accounts"), the variant is registered in 07B's `infra/kpi-registry.yaml` as a new KPI with its own `kpi_id` (e.g., `KPI-ENG-01-VARIANT-NON-ADMIN`) — at which point the dashboard registry references the new `kpi_id`. Tile-level inline divergence from a registered KPI's body is rejected by INV-07-11. This routes definition-drift through the canonical registry rather than letting it accumulate at the dashboard layer.

---

# **§12 — Warehouse-vs-PostHog Substrate Split Governance**

**launch\_required: true** for the governance contract (§12.2-§12.4); **launch\_required: false** for the V1.1+ migration execution itself.

## **12.1 The substrate-split intent (recap from §5.2)**

V1 dashboards live on PostHog (the launch-required substrate). V1.1+ dashboards migrate to a warehouse-backed tool (Looker Studio leading candidate; Metabase / Hex in scope; selection deferred per W-07C-V1.1-TOOL-SELECTION). The migration is strategic, not optional — the V1 PostHog substrate is the launch posture that minimizes vendor decisions; the V1.1+ warehouse-backed substrate is the consolidation target aligned with Karl's GCP-consolidation lean (Parent W9).

## **12.2 The substrate-split governance contract**

Per §5.3 (referenced, not restated here), every `infra/dashboard-registry.yaml` entry declares a `data_source` (`posthog_v1` or `warehouse_v1_1_plus`) and obeys the three governance rules: (a) no `warehouse_v1_1_plus` may be `bodied_v1`; (b) a dashboard whose `data_source` migrates from `posthog_v1` to `warehouse_v1_1_plus` MUST retain its `kpi_ids[]` and `audience`; (c) the §11 parity discipline applies identically to both substrates. See §5.3 for the full contract.

## **12.3 The migration discipline**

When a V1 PostHog dashboard migrates to V1.1+ warehouse-backed substrate, the migration is a registry update — not a new dashboard. The migration steps:

1. **Identify the migration source:** the existing `infra/dashboard-registry.yaml` entry with `data_source: posthog_v1`.  
2. **Build the warehouse-backed dashboard:** in the chosen V1.1+ tool (per W-07C-V1.1-TOOL-SELECTION), construct the dashboard reading from 07B's BigQuery warehouse normalized event stream. The dashboard's tiles reference the same `kpi_ids[]` as the V1 PostHog dashboard.  
3. **Verify parity:** the V1.1+ warehouse-backed dashboard's tile values match the V1 PostHog dashboard's tile values for the same time window (within the documented numeric tolerance — most KPIs are integer counts or simple ratios; tolerance is essentially zero for those). This is the §3 threat 4 defense — both substrates compute against the same canonical KPI body, so they MUST produce identical numbers.  
4. **Update the registry:** change `data_source` from `posthog_v1` to `warehouse_v1_1_plus`; the `kpi_ids[]`, `audience`, `description`, and `status` remain unchanged.  
5. **Decommission the V1 PostHog dashboard:** after V1.1+ activation confirmation and a documented retention window for cross-checking, the V1 PostHog dashboard is decommissioned. PostHog dashboards that have not yet been migrated continue to live alongside V1.1+ warehouse-backed dashboards during the migration period.

## **12.4 The parity-verification proof artifact (V1.1+)**

When a migration completes, a proof artifact `dashboard-substrate-migration-parity` records the per-KPI comparison between the V1 PostHog and V1.1+ warehouse-backed values. **Per RB-07C-V1-08, the proof artifact's stored values are conditioned on the small-cell-sensitivity of the dashboard's tiles:**

* **For top-level non-cohort dashboards** (e.g. `DASH-OPS-01` surfacing the 6 V1-bodied KPIs at aggregate scope): the proof records per-KPI `{kpi_id, posthog_v1_value, warehouse_v1_1_plus_value, tolerance, parity_check_decision}` \+ migration timestamp \+ canonical KPI body cited. Safe because the V1-bodied KPIs are aggregate counts/ratios over the full user base, not small-cell-sensitive cohort breakdowns.  
* **For cohort or small-cell-sensitive dashboards** (any dashboard whose tiles group by `exam_date`, `exam_date_cohort_id`, geography, school, or another high-cardinality cohort dimension per §13.3): parity proof artifacts store aggregate values only if they pass the **Doc 07B §10.3 / Doc 07E §15 W5 minimum-cell guardrail (referenced, never restated)**. Otherwise the proof artifact stores only `{kpi_id, parity_check_decision (pass/fail), suppressed_cell_count, redacted_metadata}` — never the underlying small-cell values. This inherits the same protection 07B §10.3 \+ 07E §15 W5 apply at the model layer, ensuring the parity-proof artifact itself cannot become a re-identification vector.

Subject to Doc 06D §8.7 (carries KPI-id \+ decision metadata \+ counts-or-redacted-values per the small-cell rule above; never raw user data). Per the family's INV-07-09 no-V1-alerts discipline, this proof artifact is V1.1+ (no V1 alerts; V1.1+ artifacts register in 06C §7 when the warehouse activates).

## **12.5 Migration is not always required**

Some V1 PostHog dashboards may never migrate — for instance, the §9 founder-operational dashboard might remain on PostHog if the V1.1+ warehouse-backed tool surfaces the same KPIs more cost-effectively elsewhere. The migration is option, not obligation; the §12.2 governance contract applies whether migration happens or not. What is NOT optional is the substrate-split annotation in the registry: every dashboard declares its `data_source`.

---

# **§13 — Dashboard-Side Cascade \+ Cardinality Conformance Inheritance**

**launch\_required: false (V1 PostHog dashboards inherit PostHog's cascade behavior per 07E §7; V1.1+ warehouse-backed dashboards inherit 07B §12 \+ §10.3 enforcement). launch\_required: true for the inheritance contract (§13.1).**

## **13.1 The inheritance contract**

07C dashboards do NOT re-implement cascade or cardinality policies. They **inherit** them from 07E \+ 07B:

* **Cascade obligations (under-13 hard-delete \+ 13+ pseudonymized retention) are owned by Doc 07E §7/§10** (referenced, never restated). 07C's contribution is ensuring dashboard caches respect the cascade — see §13.2.  
* **Small-cell / cardinality bucketing is owned by Doc 07E §15 W5 (policy) \+ Doc 07B §10.3 (warehouse-side enforcement)** (referenced, never restated). 07C's contribution is requiring dashboard tiles that group by high-cardinality cohort dimensions source from models that already applied the suppression — see §13.3.

This is the Decision 5 application at the dashboard layer: 07C dashboards consume cascade \+ cardinality policies; they do not own or re-implement them.

## **13.2 Dashboard cache \+ cascade**

Dashboard tools (PostHog at V1, the V1.1+ warehouse-backed tool) cache query results for performance. The threat (§3 threat 6): a cached aggregate retains a user's contribution past their cascade. The defense:

* **For 13+ pseudonymized retention (the default per 07E §7.3):** no dashboard cache action is required. The Supabase identity bridge is severed at cascade; the `analytics_user_id` becomes uninvertible. The cached aggregate continues to hold the user's contribution under their now-pseudonymized identifier (07E §7.3 / 07B §12.2 — pseudonymized-at-fact). No identity reconstruction is possible from the cache.  
* **For under-13 hard-delete (the override per 07E §10):** dashboard caches MUST be invalidated/rebuilt before any external dashboard surface displays an aggregate that could include the cascaded user. The §6.2 criterion 5 (cache-invalidation-on-cascade support) ensures the V1.1+ tool selection can satisfy this. At V1, PostHog's cache behavior is the responsibility of PostHog as a vendor; if a PostHog dashboard would surface cascaded under-13 data from a stale cache, that is reported as a PostHog vendor escalation per Doc 06E §6 outage runbook pattern (referenced, never restated).

## **13.3 Small-cell / cardinality bucketing inheritance**

A dashboard tile that groups by `exam_date`, `exam_date_cohort_id`, geography, school, or any other high-cardinality cohort dimension MUST source from a 07B model that already applied min-cell suppression / bucketing per 07B §10.3 (which itself consumes 07E §15 W5's policy threshold). 07C does NOT apply the suppression at the dashboard layer; it requires the upstream model to have applied it. Concretely:

* **A V1.1+ dashboard tile grouping by cohort dimensions** reads from `cohort__*` or `trajectory__*` models in 07B's `lyceon_analytics_models_<env>` dataset. Those models — when bodied V1.1+ — apply the suppression per 07B §10.3. The tile inherits the suppression by virtue of reading from a suppressed source.  
* **An ad-hoc tile that groups by cohort dimensions without sourcing from a suppressed model** is a discipline violation. The §15 audit \+ the dashboard-registry-presence-and-shape pass (§8.5 P32) verify this by registry inspection at V1.0; runtime enforcement is V1.1+ when the warehouse activates.

## **13.4 ML-training-corpus export from dashboards**

If a dashboard exports an aggregate that subsequently flows into an ML training corpus (e.g., a "user behavior cohort" exported for model training), the export inherits the 07E §10.6 / §12.5 ML-training-exclusion invariant — under-13 users are never present in ML training extracts. 07C does NOT re-implement the invariant; it requires that any dashboard-side export to ML training is sourced from a 07B model that already applied the under-13 exclusion (the §13.3 same pattern: upstream model enforces; downstream dashboard inherits).

---

# **§14 — V1 / V1.1+ Mechanisms**

Per Doc 07 Parent §4 \+ Doc 06E §4 convention, every 07C mechanism declares `launch_required: bool` with a V1.1+ trigger criterion for `launch_required: false` mechanisms.

## **14.1 Launch-required (V1) mechanisms**

| Mechanism | Invariant | What it proves | launch\_required |
| ----- | ----- | ----- | ----- |
| `ci/dashboards-internal-only` | INV-07-10 | Every registered V1 dashboard's `audience` is `internal_team`; bodies Parent W7 as executable gate (§7.2) | **true** |
| `ci/dashboard-references-kpi-registry` | INV-07-11 | Every dashboard's `kpi_ids[]` resolves to a canonical entry in Doc 07B's `infra/kpi-registry.yaml` (§8.4) | **true** |
| Audit pass P32 — `dashboard-registry-presence-and-shape` | (audit pass, not invariant) | `infra/dashboard-registry.yaml` exists, parses, declares V1 dashboard entries \+ executive-scorecard contract; status × data\_source consistency; status × KPI-references consistency; access-control field presence for posthog\_v1 entries; substrate/tool field presence (§8.5, RB-07C-V1-05 expanded scope) | **true** |

These three are the launch-required core: the `infra/dashboard-registry.yaml` canonical roster is launch-required (Parent §5.1 family decomposition \+ Karl Q-07C-3=a), and these mechanisms enforce its integrity (audience \+ KPI-reference \+ presence).

## **14.2 Target-state V1.1+ mechanisms**

| Mechanism | What it proves | V1.1+ activation trigger | launch\_required |
| ----- | ----- | ----- | ----- |
| `dashboard-substrate-migration-parity` proof | A migrating dashboard's V1.1+ warehouse-backed tile values match the V1 PostHog tile values (§12.4) | First dashboard migration from posthog\_v1 to warehouse\_v1\_1\_plus | false |
| Executive-scorecard body activation | The V1 contract's V1.1+ KPI additions activate when the underlying KPIs body (§10.5) | All three §10.5 conditions met | false |

Each V1.1+ mechanism's spec (the six-element implemented-definition shape) is bodied at 07C V1; the runtime body activates per the stated trigger. Same "spec-locked, infrastructure-target-state" framing as the rest of the Doc 07 family.

## **14.3 V1 no-alert reminder (INV-07-09 family-wide)**

Per family invariant INV-07-09 (Doc 07 Parent §6), no V1 Doc 07 mechanism produces an alert. 07C V1 has zero `alert_id` declarations. V1.1+ dashboard-related alerts (warehouse query failures, dashboard load failures, substrate-migration parity violations) register in Doc 06C §7 `infra/alert-registry.yaml` when the warehouse activates per the standard 06C registration pattern — not in 07C.

## **14.4 Bundled cross-doc additives**

| Additive | Target doc | What it does | Status |
| ----- | ----- | ----- | ----- |
| **W-07C-V1.1-TOOL-SELECTION** | Doc 06E | When the V1.1+ warehouse-backed dashboard tool is chosen (Looker Studio leading candidate; Metabase \+ Hex in scope; final deferred), Doc 06E §5/§7/§10/§13 receives a vendor registration per the W-07-PostHog-BQ pattern | Bounded; resolves at V1.1+ activation when the tool is selected |
| **W-07-PostHog-BQ** (inherited from Parent \+ 07A \+ 07B) | Doc 06E | PostHog Tier-1 launch-required vendor \+ BigQuery Tier-1 target-state vendor registration; 07C's V1 PostHog dashboards depend on PostHog's launch-required status; V1.1+ warehouse-backed dashboards depend on BigQuery's target-state activation | Inherited; deploy-gated; non-blocking for 07C spec lock |

07C does NOT introduce its own KPI-registry additive (07B owns the KPI registry; 07C is a consumer per FWD-07B-01 resolution). 07C does NOT introduce a 07B-side additive (07B's existing W-07B-DOC03C-EXPORT-SUBSTRATE handles export substrate; dashboard reads do not require additional GCP substrate beyond what the V1.1+ tool itself uses, which is registered via W-07C-V1.1-TOOL-SELECTION).

---

# **§15 — Audit Profile**

## **15.1 Inherited audit suite**

07C inherits the Doc 07 family audit suite — the 30-pass baseline (25 carry-forward from 06E \+ P26-P30 from Doc 07 Parent) — plus P31 (vocabulary-consistency, introduced by Doc 07E per RB-07E-R3-04). 07C also introduces **P32 (dashboard-registry-presence-and-shape)** per §8.5, bringing the family suite to **32 passes total** at 07C lock.

## **15.2 07C implementation-site passes**

07C is the implementation site for:

* **P27 — KPI canonical-owner-citation parity (inherited; 07B implementation site is canonical, 07C extends).** 07C dashboards reference 07B KPI registry entries; the §11 parity discipline \+ INV-07-11 enforce that every dashboard tile cites a canonical `kpi_id`. P27's 07B-side enforcement covers KPI bodies; the 07C-side extension covers dashboard references.  
* **P31 — vocabulary-consistency (inherited from 07E).** 07C applies P31's discipline to dashboard-layer text: no dashboard description claims to surface "anonymized" data (the pseudonymized-vs-anonymized legal distinction holds at the dashboard layer too — a dashboard summary that says "anonymized cohort distribution" misrepresents the V1 pseudonymized status per 07E §5.2); no claim that 07C V1 ships "running warehouse dashboards" (those are V1.1+ per Parent line 22); no V1 alert declarations (INV-07-09).  
* **P32 — dashboard-registry-presence-and-shape (07C-introduced).** Per §8.5, verifies `infra/dashboard-registry.yaml` presence \+ parse \+ V1-entry-completeness \+ executive-scorecard entry \+ status × data\_source consistency \+ status × KPI-references consistency \+ access-control field presence for posthog\_v1 entries \+ substrate/tool field presence. Runs at the same cadence as INV-07-10 \+ INV-07-11.

## **15.3 07C-specific audit additions**

Beyond the inherited suite, 07C's audit verifies:

* **DD-07-REDEF defect scan (Decision 5):** no 07C line restates a primitive owned by another doc — no restatement of 07B KPI bodies, 07A event definitions, 07E retention/cascade policy, 07B warehouse table definitions, 06D registry substrate, 06E vendor cost bodies, 05B mastery formulas, Doc 03 §24 LISA cost tiers, Doc 09 financial formulas, Doc 01 identity model. Any such line is a defect.  
* **Ownership-boundary integrity:** every "07C owns" claim in §2.2 maps to a section that bodies it; every "referenced owner" claim resolves to an exact § in the cited doc.  
* **launch\_required annotation coverage (INV-07-07 family-wide):** every 07C mechanism declares `launch_required: bool`; every `false` resolves to a V1.1+ trigger.  
* **No-V1-alerts (INV-07-09 family-wide):** no 07C V1 mechanism declares an `alert_id`. V1.1+ alerts register in Doc 06C §7.  
* **Dashboard-registry parity with KPI registry (INV-07-11 site):** every `kpi_id` in every dashboard entry's `kpi_ids[]` resolves to a canonical entry in 07B's `infra/kpi-registry.yaml`.  
* **Audience invariant (INV-07-10 site):** every registered V1 dashboard's `audience` is `internal_team`.

## **15.4 Known false-positive class**

Carry-over \+ 07C-specific: doc titles containing flagged words; the §17 cross-doc seam table (cites bodies — required, not restatement); the §10.3 executive-scorecard KPI-id list (these are dashboard-registry references, not restatements — same carve-out class as 07B's §9.5.3 KPI-table list); the §9.2 founder-operational dashboard `kpi_ids[]` list (registry reference, not restatement); §6.2 \+ §6.3 Looker Studio / Metabase / Hex vendor-name vocabulary (vendor identifiers, not primitive-body restatements); §7.1 reserved audience values (taxonomy declaration, not restatement); the `posthog_v1` / `warehouse_v1_1_plus` substrate identifier tokens (07C-owned enum values).

---

# **§16 — Acceptance Criteria (Executable-Proof Framed)**

07C V1.0 is acceptable for lock when:

1. **The `infra/dashboard-registry.yaml` canonical roster is specified** (§8) — entry shape per §8.2; the V1 bodied dashboards (§9 \+ §10.3) \+ the V1.1+ name-only stubs registered; every entry carries `audience`, `data_source`, `status`, `kpi_ids[]`, `canonical_owner_doc_and_section`. **launch\_required: true.**  
2. **`ci/dashboards-internal-only` (INV-07-10) is specified** with the six-element implemented-definition (§7.2 / §8.3); bodies Parent W7. **INV-07-10 verifies BOTH the registry declaration AND the vendor-side state for PostHog dashboards** (RB-07C-V1-13) — for any `data_source: posthog_v1` entry, the CI check confirms `public_link_enabled=false`, `embed_enabled=false`, AND `visibility_restricted_to_authenticated_members=true` at the PostHog vendor surface; a registry/vendor mismatch (e.g. registry declares `public_link_enabled: false` but the dashboard is actually publicly shared at PostHog) is itself an INV-07-10 violation per §7.2 failure conditions (e)+(f). **launch\_required: true.**  
3. **`ci/dashboard-references-kpi-registry` (INV-07-11) is specified** with the six-element implemented-definition (§8.4); validates against 07B's `infra/kpi-registry.yaml`. **launch\_required: true.**  
4. **Audit pass P32 — `dashboard-registry-presence-and-shape` is specified** (§8.5 / §15.2). **launch\_required: true.**  
5. **The dashboard substrate spec is specified** (§5) — V1 PostHog / V1.1+ warehouse-backed; the substrate-split governance contract (§5.3); the migration story (§5.2 → §12).  
6. **The V1.1+ dashboard-tool selection rationale \+ criteria are specified** (§6) — tool-agnostic at V1.0; Looker Studio as leading candidate; Metabase \+ Hex in scope; the 6 selection criteria (§6.2); the W-07C-V1.1-TOOL-SELECTION additive declaration (§6.4 / §14.4).  
7. **The internal-only-at-V1 audience invariant \+ audience taxonomy are specified** (§7) — INV-07-10 hard CI gate; reserved V1.1+ audience values with Parent W7 re-evaluation path (§7.3); internal-team definition referenced from Doc 01 (§7.4, never restated).  
8. **The V1 bodied operational dashboard is specified** (§9) — `DASH-OPS-01 founder_operational_v1` configured in PostHog; surfaces the 6 V1-bodied KPIs from 07B's registry; migration path to V1.1+ warehouse-backed substrate locked.  
9. **The executive-scorecard contract is specified** (§10) — dedicated section per Parent line 34; V1 contract locks audience \+ KPI references \+ cadence; `v1_1_kpi_additions` list locked at V1; V1.1+ body activation trigger (§10.5) specified.  
10. **The dashboard-to-KPI parity discipline is specified** (§11) — every tile references a `kpi_id`; tile-level divergence is registry-routed via a new KPI registration (§11.4); INV-07-11 enforces.  
11. **The warehouse-vs-PostHog substrate-split governance is specified** (§12) — the migration discipline (§12.3); the parity-verification proof artifact (§12.4); migration is option-not-obligation (§12.5).  
12. **The dashboard-side cascade \+ cardinality conformance inheritance is specified** (§13) — 07E \+ 07B owned (referenced, never restated); dashboard cache \+ cascade behavior (§13.2); small-cell inheritance from upstream models (§13.3); ML-training-corpus export inheritance (§13.4).  
13. **Every mechanism declares `launch_required: bool`** (INV-07-07 family-wide) with V1.1+ triggers for `false` mechanisms (§14); **no V1 mechanism declares an alert** (INV-07-09 family-wide).  
14. **Decision 5 holds end-to-end** — DD-07-REDEF scan clean: no restatement of 07A event schema / 07B KPI bodies \+ warehouse model definitions / 07E retention-cascade policy / 06D registry / 06E vendor cost bodies / 05B mastery formula / 03 §24 LISA cost / 03C GCP substrate / Doc 09 financial / Doc 01 identity model (§15.3).  
15. **The audit suite passes** — inherited 30-pass \+ P31 \+ P32; 07C implementation-site P27 \+ P31 \+ P32 explicit; 07C-specific DD-07-REDEF \+ ownership-boundary \+ annotation-coverage \+ no-V1-alerts \+ dashboard-registry parity checks clean (§15).  
16. **The cross-doc seam table (§17) is grounded by exact §** — every seam resolves or is explicitly carried as a bounded forward-ref.  
17. **The watch items (§18) are bounded** — W-07C-V1.1-TOOL-SELECTION \+ the inherited W7 \+ W-07-PostHog-BQ \+ the inherited 07E W7/W9 launch gates all bounded and non-blocking for spec lock.

---

# **§17 — Cross-Doc Seam Table (Grounded by Exact §)**

| Seam | 07C side | Canonical owner | Status |
| ----- | ----- | ----- | ----- |
| 35-KPI canonical roster (the dashboards' `kpi_ids[]` references) | §11 parity discipline | Doc 07B V1.0 §9.5 `infra/kpi-registry.yaml` | RESOLVED — consumer (referenced, never restated); resolves Doc 07B FWD-07B-01 |
| **07B §9.6 Registry-Bound KPI Views Layer (the V1.1+ tool's read substrate)** | **§6.2 criterion \#2 \+ §11 — V1.1+ dashboards read `lyceon_analytics_models_<env>.kpi_<id>` views; tool does not need native registry awareness** | **Doc 07B V1.0 §9.6 (added in-lock-cycle per 07B CR-07B-04 triggered by this RB-07C-V1-03)** | **RESOLVED — consumer \+ W-07C-DOC07B-KPI-VIEWS resolved at land (bounded-and-resolved, not bounded-and-pending; same pattern as 06D CR-06D-06 ↔ 07E)** |
| 6 V1-bodied KPI measurement bodies | §9.2 \+ §10.3 dashboards surface them | Doc 07B V1.0 §9.5.3 | RESOLVED — consumer |
| V1.1+ name-only-stub KPIs (the executive-scorecard `v1_1_kpi_additions`) | §10.3 names the V1.1+ additions; §10.5 activation trigger | Doc 07B V1.0 §9.5.4 \+ Doc 05B / Doc 03 / Doc 09 (per FWD-07-01) for the KPI bodies' canonical owners | RESOLVED — consumer \+ FWD-07-01 carry-through |
| Event taxonomy (the KPIs' source events) | §9.4 / §11 dashboards compute against the same event stream as the KPI bodies | Doc 07A V1.0 §5/§6 | RESOLVED — consumer (referenced via KPI registry) |
| `analytics_user_id` HMAC contract | §13.2 cache \+ cascade discipline relies on it | Doc 07A V1.0 §7 | RESOLVED — consumer |
| Event-time PII redaction contract | §13 dashboards inherit; never re-implement | Doc 07A V1.0 §8 | RESOLVED — consumer |
| Retention class taxonomy \+ pseudonymized-vs-anonymized legal distinction | §13.2 cascade behavior \+ §15.2 P31 vocabulary discipline | Doc 07E V1.0 §5 | RESOLVED — consumer |
| Cascade policy (under-13 hard-delete \+ 13+ pseudonymized) | §13.2 dashboard cache \+ cascade | Doc 07E V1.0 §7/§10 | RESOLVED — consumer |
| Under-13 ML-training-exclusion invariant | §13.4 ML-training-corpus export inheritance | Doc 07E V1.0 §10.6 / §12.5 | RESOLVED — consumer |
| Small-cell / cardinality policy | §13.3 dashboard tiles inherit from upstream models | Doc 07E V1.0 §15 W5 (policy) \+ Doc 07B V1.0 §10.3 (warehouse-side enforcement) | RESOLVED — consumer |
| Warehouse normalized event stream \+ cohort/trajectory models | §12 V1.1+ dashboards read from | Doc 07B V1.0 §8/§10 (declared-shape V1.1+) | RESOLVED — consumer; V1.1+ activation when 07B models body |
| BigQuery cascade mechanism | §12 V1.1+ dashboards inherit the cascade-propagated state | Doc 07B V1.0 §12 | RESOLVED — consumer |
| `dim__user` pseudonymized user dimension | §10 / §13.2 dashboards reference | Doc 07B V1.0 §9.3 (declared-shape V1.1+) | RESOLVED — consumer |
| PostHog vendor body (V1 substrate) | §5.1 / §9 V1 dashboards configured on PostHog | Doc 06E §7 PostHog subsection (via W-07-PostHog-BQ) | OPEN — bounded (W-07-PostHog-BQ); deploy-gated, non-blocking for spec lock |
| BigQuery vendor body (V1.1+ substrate read) | §5.1 / §12 V1.1+ dashboards read from BigQuery | Doc 06E §7 BigQuery subsection (via W-07-PostHog-BQ) | OPEN — bounded; deploy-gated |
| V1.1+ dashboard-tool vendor body | §6 selection event | Doc 06E §5/§7/§10/§13 (via W-07C-V1.1-TOOL-SELECTION) | OPEN — bounded; resolves at V1.1+ tool selection |
| Identity model \+ role taxonomy ("internal team" definition) | §7.4 dashboard access binds to Doc 01 roles | Doc 01 V6.0 | RESOLVED — consumer (referenced, never restated) |
| Privacy-incident sub-class | §3 threat 2 — INV-07-10 violations produce privacy incidents | Doc 06D V1.0 §11 `attach_privacy_class_to_incident` | RESOLVED — consumer |
| No-PII proof-artifact rule | §7.2 / §8.4 / §12.4 proof artifacts obey it | Doc 06D V1.0 §8.7 | RESOLVED — consumer |
| Alert routing (V1.1+ dashboard alerts) | §14.3 V1 owns no alerts; V1.1+ register here | Doc 06C V1.0 §7 `infra/alert-registry.yaml` | RESOLVED — V1.1+ consumer (V1 produces no alerts per INV-07-09) |
| Config doctrine (registry locations, cadence defaults) | §8 / §6.2 settings are config-doctrine | Doc 01A V1.0 §3 | RESOLVED — consumer |
| Financial KPI bodies | §10.3 `v1_1_kpi_additions` includes KPI-BIZ-03 churn\_rate\_monthly \+ KPI-OPS-01 cost\_per\_mau citations | Doc 09 (FWD-07-01) | OPEN — bounded forward-ref; resolves when Doc 09 drafts |
| Experimentation dashboards | §10.3 may add experiment-arm KPIs at V1.1+ when 07D drafts | Doc 07D (FWD-07C-01) | OPEN — bounded; resolves when 07D drafts |
| LISA cost / cap KPI bodies | §10.3 V1.1+ additions reference KPI-TUT-\* and KPI-OPS-03 | Doc 03 Main V1.1 §11/§24 | RESOLVED — referenced (cited per project handoff record until Doc 03 Main parsed) |

---

# **§18 — Watch Items**

| ID | Item | Status |
| ----- | ----- | ----- |
| **W1** | Doc 03 Main V1.1 §11/§24 LISA cost/cap KPI citations (KPI-TUT-\*/KPI-OPS-03) referenced via `kpi_ids[]` in V1.1+ scorecard additions; recorded as `cited_per_project_handoff_record` until Doc 03 Main is parsed into the audit | Bounded; non-blocking (inherited from 07A/07B W1 pattern) |
| **W2** | Doc 05B §3-§5 mastery KPI citations (KPI-LRN-01/05) referenced via `kpi_ids[]` in V1.1+ scorecard additions | Bounded; non-blocking |
| **W3 / W-07-PostHog-BQ** | Inherited from Parent \+ 07A \+ 07B. BigQuery \+ PostHog vendor registrations in Doc 06E §5/§7/§10/§13 via RB-06E-V1-15/16. 07C V1 PostHog dashboards depend on PostHog launch-required body; V1.1+ warehouse-backed dashboards depend on BigQuery target-state body | Bounded; deploy-gated; non-blocking for spec lock |
| **W4 / W-07C-V1.1-TOOL-SELECTION** | When the V1.1+ warehouse-backed dashboard tool is chosen (Looker Studio leading candidate per Karl's GCP-consolidation lean; Metabase \+ Hex in scope; final deferred), Doc 06E §5/§7/§10/§13 registers the vendor per the W-07-PostHog-BQ pattern (§6.4 / §14.4). | Bounded; resolves at V1.1+ tool selection event |
| **W5 / Parent W7 inherited (internal-only-at-V1)** | Parent W7 declares V1.1+ scope expansion (board reporting, parent-facing, regulator, school admin) as a re-evaluation trigger. 07C bodies this as INV-07-10 (§7.2) — a hard CI gate at V1. Relaxation requires the §7.3 path (privacy-posture re-evaluation \+ invariant amendment \+ code-review event). | Bounded; non-blocking for V1; the executable gate is the body of the watch item |
| **W6** | Doc 09 financial unit economics bodies (KPI-BIZ-03/04 \+ KPI-OPS-01/02 via FWD-07-01) referenced in §10.3 V1.1+ scorecard additions | Bounded forward-ref; resolves when Doc 09 drafts |
| **W7** | Doc 07D experimentation dashboards (FWD-07C-01) may add experiment-arm-tagged dashboard registry entries when 07D drafts | Bounded; resolves when 07D drafts |
| **W8** | The 07E W7+W9 launch gates (privacy policy publication \+ legal counsel sign-off) gate production enablement of the pseudonymized-retention path — including dashboard caches that hold pseudonymized aggregates. 07C inherits this dependency from 07E. | Inherited from 07E; non-blocking for 07C spec lock |
| **W9 / W-07C-DOC07B-KPI-VIEWS** | When V1.1+ warehouse-backed dashboards consume KPIs via the BigQuery view layer, the canonical view definitions live in 07B §9.6 (added in-lock-cycle per 07B CR-07B-04, triggered by RB-07C-V1-03). 07C §6.2 criterion \#2 \+ §11 reference 07B §9.6 as the substrate. | **RESOLVED at land** — the additive landed in 07B in the same operation that registers it here (same pattern as 06D CR-06D-06 ↔ 07E); not bounded-and-pending |

---

# **§19 — Change Records**

**CR-07C-01** — Doc 07C V1.0 established. Scope per Doc 07 Parent §5.1 family decomposition \+ line 175 ("Mostly target-state; minimal launch content") \+ line 34's explicit naming of "dashboard registry shape \+ executive-scorecard contract." Fourth sub-doc (Parent → 07A → 07E → 07B → 07C → 07D drafting order). Pre-draft Q\&A locked (Karl decisions): **Q-07C-1=a** — `ci/dashboards-internal-only` hard invariant (INV-07-10) bodies Parent W7 as an executable CI gate; **Q-07C-2=a-modified** — tool-agnostic at V1.0 for the V1.1+ warehouse-backed dashboard tool; **Looker Studio named as a leading V1.1+ candidate** per Karl's GCP-consolidation lean (Parent W9) but **NOT the final or only choice** — Metabase \+ Hex remain in scope; final selection deferred to W-07C-V1.1-TOOL-SELECTION additive resolution; **Q-07C-3=a** — full `infra/dashboard-registry.yaml` mirror of 07B's KPI-registry discipline (canonical YAML, audience \+ data\_source \+ kpi\_ids per entry, two owned proving mechanisms INV-07-10 \+ INV-07-11, plus the 07C-introduced audit pass P32); **Q-07C-4=a** — body the V1 launch-required operational minimum as 1 V1-bodied dashboard `DASH-OPS-01 founder_operational_v1` configured in PostHog surfacing the 6 V1-bodied KPIs from 07B's registry; everything else (executive-scorecard body, learning analytics, cohort retention, financial, churn, LISA cost) is name-only stub for V1.1+; **Q-07C-5=a-confirmed** — no cleanup register (this doc carries §19 Change Records only, no §20 register — same convention as 07B), strict Decision-5 (DD-07-REDEF scan in §15.3), executive-scorecard contract gets its own dedicated §10 per Parent line 34's explicit naming. Three 07C-owned launch-required mechanisms: INV-07-10 \+ INV-07-11 \+ audit P32. Two V1.1+ mechanisms (§14.2). Two bundled additives: W-07C-V1.1-TOOL-SELECTION (new, owed to Doc 06E for V1.1+ dashboard-tool registration) \+ W-07-PostHog-BQ (inherited). Grounding verified against locked 07 Parent (line 34 \+ line 175 \+ line 192 \+ line 214 \+ W7 \+ Q-07-5=β internal-only constraint), 07A (event registry referenced via KPI registry), 07B (35-KPI registry consumed; FWD-07B-01 resolved by 07C; the 6 V1-bodied KPIs surface in §9; the V1.1+ stubs surface in §10.3 scorecard additions; the small-cell guardrail §10.3 inherited), 07E (cascade policy \+ small-cell W5 \+ ML-exclusion invariant — all referenced, never restated; P31 vocabulary discipline applied at dashboard layer per §15.2), Doc 06A/06C/06D/06E (substrate \+ alert registry \+ retention registry \+ vendor body via W-07-PostHog-BQ \+ W-07C-V1.1-TOOL-SELECTION), Doc 01 (internal-team membership semantics — referenced, never restated). Inherits the 30-pass family audit \+ P31 \+ introduces P32 for the dashboard-registry-presence-and-shape pass (family suite to 32 passes total). Status DRAFT pending external SWE review.

**CR-07C-02** — R1 external SWE review cleanup applied in-lock-cycle (no version bump; status stays DRAFT pending next review). SWE verdict: B+, scope/direction APPROVED, "targeted cleanup pass, not rewrite." 5 BLOCKERs \+ 4 HIGHs resolved as RB-07C-V1-01..09; pre-cleanup alignment locked with Karl (Q-07C-R1-1=a / 2=a / 3=b / 4=a):

* **RB-07C-V1-01 (BLOCKER):** Added third dashboard registry status `contract_v1_body_v1_1` (§8.2; available to any dashboard per Q-07C-R1-3=b, not reserved to scorecard) — `v1_1_kpi_additions` is permitted ONLY on this status; INV-07-11 failure conditions (e) \+ (f) added enforcement.  
* **RB-07C-V1-02 (BLOCKER):** Hardened INV-07-10 (§7.2) to explicitly ban PostHog public-link sharing \+ iframe/embed sharing \+ require `visibility_restricted_to_authenticated_members: true`; added `posthog_access_control` block to §8.2 entry shape (REQUIRED for `data_source: posthog_v1` entries); both V1-bodied dashboards (`DASH-OPS-01`, `DASH-SCORECARD-01`) registry entries now carry the access-control block with `public_link_enabled: false` \+ `embed_enabled: false` \+ `visibility_restricted_to_authenticated_members: true`.  
* **RB-07C-V1-03 (BLOCKER):** Reframed §6.2 criterion \#2 — tool consumes Lyceon-supplied registry-bound query templates/views (the **07B §9.6 Registry-Bound KPI Views Layer**, added in-lock-cycle in 07B per CR-07B-04 in the same operation that landed this RB cleanup, **Q-07C-R1-1=a: 07B owns the mapping layer**); tool does NOT need native registry awareness; Lyceon's CI (INV-07-11 \+ 07B INV-07-05 \+ INV-07-06) owns parity. Resolves W-07C-DOC07B-KPI-VIEWS at land (§18 W9).  
* **RB-07C-V1-04 (BLOCKER):** Reframed §6.2 criterion \#5 cache-invalidation — 4 approved paths (tool-level invalidation / cache minimization / post-cascade materialized views / access-blocking until verified refresh); candidate disqualified only if it supports NONE; Looker Studio likely satisfies via path (3) or (4) per §6.3 brief note.  
* **RB-07C-V1-05 (BLOCKER):** Expanded P32 from presence-only to **`dashboard-registry-presence-and-shape`** (§8.5) — adds state-transition validation: status × data\_source matrix consistency, status × KPI-references consistency, access-control field presence for posthog\_v1 entries, substrate/tool field presence; the 6 hard-fail conditions match 07C's actual registry risk surface.  
* **RB-07C-V1-06 (HIGH):** Fixed "exactly one V1-bodied" affirmation — `DASH-OPS-01` is unique V1-bodied (§9.1); `DASH-SCORECARD-01` is `contract_v1_body_v1_1` (§10.3), not `bodied_v1`. Direct consequence of RB-07C-V1-01.  
* **RB-07C-V1-07 (HIGH):** Added explicit `external_export_ban` field on `DASH-SCORECARD-01` (§10.3) banning board export / board screenshot / investor-deck reuse / external forwarding at V1 unless reclassified through §7.3 scope-expansion review \+ Parent W7 re-evaluation; closes the scorecard-as-loophole risk.  
* **RB-07C-V1-08 (HIGH):** §12.4 parity-proof small-cell suppression — for cohort/small-cell-sensitive dashboards, the proof artifact stores only `{kpi_id, parity_check_decision, suppressed_cell_count, redacted_metadata}` instead of raw per-KPI values; inherits Doc 07B §10.3 \+ Doc 07E §15 W5 thresholds (referenced, never restated, **Q-07C-R1-4=a**); ensures parity proof cannot itself become a re-identification vector.  
* **RB-07C-V1-09 (HIGH):** §7.1 clarified — `public` is never permitted for 07C-governed *internal analytics* dashboards; future public marketing/social-proof surfaces (if any) would belong to **Doc 10 (FWD-07-03)**, not 07C; prevents future Doc 10 cross-doc conflict.

**07B in-lock-cycle additive triggered by this round:** Doc 07B §9.6 added per 07B CR-07B-04, no 07B version bump, no 07B status change (still V1.0 LOCKED 2026-05-28). The additive is a small, structurally-compatible extension to satisfy 07C's RB-07C-V1-03 — same precedent as 06D's RB-06D-V1-19 Stage 1 schema extension landed for 07E's dependency. Status DRAFT pending next SWE review (expected LOCK-CONDITIONAL per the SWE final call after this targeted cleanup).

**CR-07C-03** — R2 SWE review cleared LOCK-CONDITIONAL; status → LOCKED. R2 verdict (post-R1-cleanup review): **LOCK-CONDITIONAL, grade A-, scope/direction APPROVED, "no architecture rewrite required"** — Doc 07C is "architecturally sound; remaining issues are stale-language cleanup, not design failures." R2 also reviewed the cross-doc 07B §9.6 additive and **passed Doc 07B as remaining LOCKED** ("the 07B §9.6 additive is the right cross-doc move; KPI bodies and read surfaces belong in the KPI/warehouse layer, not in dashboard tooling; preserves Decision 5 because views are projections of the registry, not a second KPI-definition authority"). All 9 R1 findings confirmed Fixed. R2 gave 4 stale-language consistency items \+ a pre-lock checklist; all applied as RB-07C-V1-10..13:

* **RB-07C-V1-10 (R2-01):** Stale two-value enum `status: bodied_v1 | name_only_stub` replaced with three-value enum `status: bodied_v1 | contract_v1_body_v1_1 | name_only_stub` at the two non-canonical occurrences (§1.3 V1 deliverable framing \+ §4.1 launch-required framing); §8.2 already had the canonical three-value enum.  
* **RB-07C-V1-11 (R2-02):** P32 naming consistency — every reference renamed from stale `dashboard-registry-presence` to canonical `dashboard-registry-presence-and-shape` (matching the §8.5 RB-07C-V1-05 expanded scope) at 7 sites: header `Applies to` clause, §13.3 audit reference, §14.1 V1 mechanism table, §15.1 audit suite summary, §15.2 implementation-site, §16 AC \#4, CR-07C-01 closing sentence, and §20 closing. The §8.5 rename-documenting line legitimately keeps the old name as the citation source ("renamed from initial-draft `dashboard-registry-presence`"); preserved as carve-out.  
* **RB-07C-V1-12 (R2-03):** "6 V1-bodied dashboards" typo fixed at §5.1 — corrected to "the V1-bodied dashboard in §9 ... surfaces the 6 V1-bodied KPIs from 07B's registry"; consistent with the RB-07C-V1-06 uniqueness affirmation that DASH-OPS-01 is the one V1-bodied dashboard.  
* **RB-07C-V1-13 (R2-04):** §16 AC \#2 (INV-07-10) explicitly added: "INV-07-10 verifies BOTH the registry declaration AND the vendor-side state for PostHog dashboards" — for any posthog\_v1 entry, the CI check confirms the registry-declared booleans (`public_link_enabled: false`, `embed_enabled: false`, `visibility_restricted_to_authenticated_members: true`) match the actual PostHog vendor surface; registry/vendor mismatch is itself an INV-07-10 violation per §7.2 failure (e)+(f). The §7.2 text already specified this; R2-04 surfaced it to the acceptance criteria for visibility.  
* **Pre-lock checklist confirmed:** (1) two-pass re-audit clean; (2) KPI event names verified against 07A registry (the 13 KPI references in 07C continue to resolve to 07B's canonical registry — the same parity check that caught two non-canonical names during 07B R2 holds clean for 07C); (3) P31 clean — no "anonymized" overclaim in live dashboard text; (4) DD-07-REDEF clean — no restated 05B / 06E / 07A / 07E / 07B-KPI-body / 03 / 09 / 01 primitives; (5) all 4 stale-language items resolved. No version bump (in-lock-cycle precedent — same as 07B's R1+R2 cleanup spanning RB-07B-V1-01..11 with no version bump). Status DRAFT → **LOCKED 2026-05-28.**

---

# **§20 — Closing**

Doc 07C V1.0 specifies Lyceon's dashboard substrate as a contract: which dashboards exist, who they're for (internal team only at V1, enforced — including PostHog public-link/embed bans verified at both registry-declaration and vendor-surface state), what KPIs each surfaces (referenced from 07B's canonical 35-KPI registry by `kpi_id` and consumed at V1.1+ via 07B §9.6's registry-bound KPI views layer, never restated), what substrate each runs on (PostHog at V1 / warehouse-backed at V1.1+ via the chosen tool per W-07C-V1.1-TOOL-SELECTION), how the V1 PostHog dashboards migrate to V1.1+ warehouse-backed dashboards without losing definitional continuity, and how the cascade \+ cardinality obligations 07E \+ 07B own are inherited at the dashboard layer (never re-implemented; small-cell parity-proof suppression for cohort-sensitive migrations). The `infra/dashboard-registry.yaml` canonical roster (§8) is the launch-required anti-drift contract — its three-value status enum (`bodied_v1 | contract_v1_body_v1_1 | name_only_stub`) supports the V1-bodied operational pulse (§9), the V1-contract-V1.1+-body executive scorecard (§10), and the V1.1+ name-only-stub roster; the V1 bodied operational dashboard (§9) is the operational minimum that PostHog covers at launch; the executive-scorecard contract (§10) is the dedicated contract for the cross-domain cadence-bound surface that V1.1+ activation bodies — with an explicit `external_export_ban` field closing the board/investor-deck loophole at V1.

Decision 5 holds end-to-end: 07C owns the dashboard substrate \+ the audience invariant \+ the executive-scorecard contract \+ the substrate-split governance, and references — never restates — the 07B KPI registry \+ KPI views layer, the 07A event schema, the 07E retention/cascade policy, the 06D registry substrate, the 06E vendor cost bodies, the 05B mastery math, the Doc 03 §24 LISA cost, the Doc 09 financial bodies, and the Doc 01 identity model. Three launch-required executable invariants — INV-07-10 internal-only \+ INV-07-11 KPI-reference parity \+ audit P32 dashboard-registry-presence-and-shape — make the contract enforceable from V1 lock onward, even though the running warehouse-backed dashboards are V1.1+ target-state.

The status transition from DRAFT to LOCKED occurred on two external SWE review rounds (R1 cleanup RB-07C-V1-01..09 \+ R2 LOCK-CONDITIONAL clearance RB-07C-V1-10..13) \+ clean two-pass re-audit (per Doc 04C / Doc 07A / Doc 07E / Doc 07B precedent): **Doc 07C V1.0 LOCKED 2026-05-28.** R2 also confirmed Doc 07B remains LOCKED following the in-lock-cycle CR-07B-04 additive. Three persistent dependencies carry past lock as non-blocking: W-07-PostHog-BQ (BigQuery \+ PostHog vendor registration in 06E, deploy-gated), W-07C-V1.1-TOOL-SELECTION (the V1.1+ dashboard-tool vendor registration when chosen), and the 07E W7+W9 launch gates (production enablement of the pseudonymized-retention path). The next Doc 07 family deliverable is **Doc 07D (Experimentation Analytics)** — the fifth and final sub-doc, which consumes 07C's dashboard registry (FWD-07C-01) \+ 07B's `fact__event` table \+ 07B §9.6 KPI views (07B FWD-07B-02 / W-07C-DOC07B-KPI-VIEWS pattern) as its substrate.

**End of Doc 07C V1.0 — LOCKED.**

