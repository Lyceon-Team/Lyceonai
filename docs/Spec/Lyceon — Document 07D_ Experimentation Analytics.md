# **Lyceon — Document 07D: Experimentation Analytics**

**Version:** V1.0 **Status:** DRAFT (pre-lock; in-lock-cycle cleanup pattern per Doc 04C / Doc 05D / Doc 07A / Doc 07E / Doc 07B / Doc 07C precedent — status transitions DRAFT → LOCKED on external SWE review \+ clean two-pass re-audit; no version bump across cleanup rounds) **Last updated:** 2026-05-28 **Owners:** Founder / CTO review **Governed by:** Doc 00 (Authoritative Platform Directive) \+ Doc 07 Parent V1.0 (LOCKED 2026-05-23). **Scope per Doc 07 Parent §5.1 family decomposition:** Doc 07D is the **fifth and final sub-doc** (per Parent Q-07-6=β drafting order: Parent → 07A → 07E → 07B → 07C → 07D) and owns the experimentation framework specification — the A/B test event-tagging contract, the statistical-framework contract, the experiment-management surface contract, the experiment registry shape, the V1.1+ activation trigger enforcement, and the experiment-arm cascade \+ small-cell inheritance. Per Doc 07 Parent line 175 \+ line 176 ("Mostly target-state; minimal launch content" \+ "Substrate registered via W-07-PostHog-BQ; no V1 experiments running"), 07D is **the most target-state-leaning of the Doc 07 sub-docs and the lightest in launch-required surface area** — no experiments run at V1 per Parent §22; what locks at V1 is the *contract* (how experiments tag events, how arms are attributed, how significance is determined, how experiments register, who can run them) plus the executable gate that prevents any experiment from running before the V1.1+ activation trigger fires. **Depends on:** Doc 07 Parent V1.0 (canonical decisions Q-07-1..6 inherited verbatim; §3 threat 8 — "A/B test misuse at V1" — bodied by 07D's INV-07-12 as executable gate; the 5K-MAU sustained-activation criterion declared by Parent §3 threat 8; the §4 spec-locked-infrastructure-target-state framing applies; the 6-element §6.13 implemented-definition discipline applies to 07D's owned mechanisms; the 35-KPI roster registered in 07B that experiment-arm metrics reference); Doc 07A V1.0 (LOCKED 2026-05-25 — `infra/event-schema-registry.yaml` 25-event taxonomy \+ the `analytics_user_id` HMAC contract \+ the §8 PII redaction contract; 07D experiment-arm event-tagging extends 07A events with arm-attribution properties — never inventing new event names, only adding properties to existing events per 07A's loose-tier-for-future-properties discipline — all referenced, never restated); Doc 07E V1.0 (LOCKED 2026-05-26 — the retention class taxonomy applies to experiment-arm allocations and arm-attributed events; the small-cell/cardinality guardrail per 07E §15 W5 applies to experiment-arm reports; the under-13 hard-delete cascade per 07E §10 propagates to arm assignments; the under-13 ML-training-exclusion invariant 07E §10.6 extends to experiment-data-derived training corpora — all referenced, never restated); Doc 07B V1.0 (LOCKED 2026-05-28 — `infra/kpi-registry.yaml` 35-KPI canonical roster \+ INV-07-05 \+ INV-07-06 \+ 07B §9.6 Registry-Bound KPI Views Layer that experiment-arm metric computation reads from at V1.1+ \+ `fact__event` declared-shape model that V1.1+ experiment-arm event tagging consumes \+ §10.3 small-cell guardrail that experiment-arm reports inherit \+ §12 cascade behavior that experiment-arm warehouse rows inherit — all referenced, never restated; 07D resolves Doc 07B's FWD-07B-02); Doc 07C V1.0 (LOCKED 2026-05-28 — `infra/dashboard-registry.yaml` canonical dashboard roster \+ INV-07-10 internal-only audience invariant \+ INV-07-11 dashboard-to-KPI-registry parity \+ audit P32 dashboard-registry-presence-and-shape \+ the executive-scorecard contract pattern; 07D experiment-arm dashboards register in 07C's dashboard registry with `audience: internal_team` and inherit INV-07-10; experiment-arm dashboards reference KPIs via 07B §9.6 KPI views per W-07C-DOC07B-KPI-VIEWS — all referenced, never restated; 07D resolves Doc 07C's FWD-07C-01); Doc 06A V1.0 (§3 platform stack — PostHog Tier-1 launch-required vendor whose feature-flag \+ experiments surface is the V1 substrate for the experiment-management surface contract); Doc 06C V1.0 (§7 `infra/alert-registry.yaml` substrate — 07D V1 mechanisms produce no alerts per INV-07-09; V1.1+ experiment-related alerts register in 06C §7 when experiments activate); Doc 06D V1.0 (§8.7 family-wide no-PII proof-artifact rule applies to 07D's experiment registry proof artifacts; §11 privacy-incident sub-class — 07D experiment surfaces that violated the V1.1+-activation gate or the internal-only audience inheritance would produce a privacy incident via the standard mechanism); Doc 06E V1.0 (§4 launch-vs-target convention adopted; the PostHog Tier-1 launch-required vendor body covers the V1 experiment-management substrate via W-07-PostHog-BQ — referenced, never restated; no new 07D vendor additive owed because PostHog covers the substrate at V1 and V1.1+ experiment activation does not require additional vendors at this lock — Statsig/Optimizely are V2+ candidates per Parent §6 line 215); Doc 01 V6.0 (identity model — 07D's "internal team" audience definition consumes Doc 01's role taxonomy for the experiment-management-surface access discipline; 07D does NOT redefine identity); Doc 01A V1.0 (§3 config doctrine for `infra/experiment-registry.yaml` registration). **Forward-references (bounded; inherited from Parent):** FWD-07-01 (Doc 09 financial unit economics — experiments measuring revenue impact reference Doc 09 KPI bodies via FWD-07-01 at V1.1+); FWD-07-02 (Doc 08 multi-vertical — 07D V1 covers single-vertical SAT experiments only; multi-vertical experiment design belongs to Doc 08); FWD-07-03 (Doc 10 brand/social-proof analytics — community-engagement / social-proof experiments are V1.1+ Doc 10 territory). **New 07D-originated forward-refs / additives:** none — 07D is the final sub-doc; it resolves both Doc 07B FWD-07B-02 and Doc 07C FWD-07C-01 at draft. **Applies to:** the A/B test event-tagging contract (§5 — how experiment-arm attribution is added to existing 07A events as properties; never inventing event names; the `experiment_id` \+ `experiment_arm` \+ `experiment_assignment_timestamp` property contract); the statistical-framework contract (§6 — canonical defaults α=0.05 / β=0.20 / MDE-floor-5%-relative / sequential-testing correction required; documented override path for V1.1+ implementers); the experiment-management surface contract (§7 — PostHog feature flags \+ experiments surface at V1; specialized tools V2+ per Parent §6 line 215); the V1.1+ activation trigger enforcement (§8 — INV-07-12 `ci/no-v1-experiments` hard CI gate bodying Parent §3 threat 8; the sustained-5K-MAU activation criterion); the `infra/experiment-registry.yaml` canonical experiment roster (§9 — registry shape mirroring 07B KPI \+ 07C dashboard pattern; 3-value status enum; statistical-framework-config block per experiment); the experiment-to-KPI-registry parity discipline (§10 — INV-07-13 `ci/experiment-references-kpi-registry`; every experiment's `target_kpi_ids[]` resolves in 07B's KPI registry); the experiment-management access discipline (§11 — internal-team-only at V1 inheriting 07C INV-07-10 audience taxonomy; experiment-arm dashboards register in 07C's dashboard registry); the experiment-arm cascade \+ small-cell inheritance (§12 — 07E §7/§10 cascade \+ 07E §15 W5 small-cell \+ 07B §10.3 warehouse-side enforcement — all inherited, never re-implemented); the V1 / V1.1+ mechanism table (§13 — every 07D mechanism declares launch\_required: bool); the §14 audit profile inheriting the family passes \+ applying P31 \+ introducing P33 `experiment-registry-presence-and-shape`; the §15 acceptance criteria; the §16 cross-doc seam table; the §17 watch items. **Explicitly excludes:** event definitions \+ event-time payload schema (Doc 07A owns — referenced via property-extension contract in §5, never restating event names or canonical schema); the warehouse model layer (Doc 07B owns — `fact__event` \+ KPI views \+ cohort/trajectory models — referenced, never restated; experiment-arm metric computation at V1.1+ consumes 07B §9.6 views by name); the dashboard substrate (Doc 07C owns — `infra/dashboard-registry.yaml` \+ INV-07-10 audience invariant \+ INV-07-11 KPI-reference parity; experiment-arm dashboards register in 07C's registry, never building parallel dashboard infrastructure); the retention/cascade/PII policy (Doc 07E owns — 07D inherits cascade \+ small-cell \+ ML-exclusion invariants, never re-implementing); the platform retention registry substrate \+ compliance-gate process (Doc 06D owns); the per-vendor infra cost body (Doc 06E §7 owns — referenced via W-07-PostHog-BQ for PostHog at V1; specialized experimentation tools Statsig/Optimizely are V2+ per Parent §6 line 215, not 07D V1.0 scope); mastery KPI body math (Doc 05B owns — referenced by `kpi_id` only); LISA cost/cap bodies (Doc 03 Main §11/§24); financial unit economics body (Doc 09 — FWD-07-01); the identity model \+ role taxonomy (Doc 01 V6.0 — referenced for internal-team membership semantics, never restated); the V1.1+ warehouse-backed dashboard tool selection (Doc 07C W-07C-V1.1-TOOL-SELECTION — when chosen, experiment-arm dashboards use the same chosen tool); the V1.1+ warehouse export substrate (Doc 07B \+ Doc 03C W-07B-DOC03C-EXPORT-SUBSTRATE).

---

# **§1 — Purpose & Position in the Doc 07 Family**

## **1.1 What 07D is**

Doc 07D is the **experimentation framework spec**: it specifies how Lyceon will run A/B experiments when the V1.1+ activation trigger fires (Parent §3 threat 8 — sustained 5K MAU minimum) — how experiments tag events for arm attribution, what statistical defaults apply, where experiments are defined and managed, and how experiment-arm allocations \+ reports inherit the cascade \+ small-cell \+ audience discipline already owned by 07E \+ 07B \+ 07C. It is the **fifth and final sub-doc** in the Doc 07 family.

Per Doc 07 Parent line 175 \+ §22 \+ §3 threat 8 framing, **07D is the most target-state-leaning sub-doc** in the family: no experiments run at V1 by design, because A/B experimentation is not statistically meaningful at sub-1K MAU scale (Parent §3 threat 8), and running experiments anyway would produce decisions on underpowered samples that are systematically wrong. What locks at V1 is the **contract** — the event-tagging schema, the statistical-framework defaults, the experiment-management surface, the experiment registry, the V1.1+ activation gate — plus the **executable invariant `ci/no-v1-experiments`** that prevents any experiment from running before the sustained-5K-MAU trigger fires.

The single most important discipline 07D enforces, stated up front: **07D V1 ships a contract, not a framework.** No experiments are registered as `bodied_v1`; every experiment in the registry is `name_only_stub` or `contract_v1_body_v1_1` per the 3-value status enum inherited from 07C. The V1.1+ activation is a quantified, externally-verifiable event (sustained 5K MAU minimum per Parent §3 threat 8), not a vibe.

## **1.2 What 07D owns vs references (the one-question-per-doc boundary)**

Per the canonical doc-architecture principle, 07D's question is: **"How does Lyceon's internal team safely run A/B experiments at V1.1+ — without inventing new event names, without bypassing the V1.1+ activation gate, without re-implementing cascade or small-cell or audience policy that 07E/07B/07C already own, and without losing definitional continuity between experiment-arm metrics and the canonical KPI registry?"**

07D owns the **experimentation contract** — the event-tagging extension, the statistical-framework defaults, the experiment-management surface choice, the experiment registry, the V1.1+ activation invariant, and the experiment-to-KPI-registry parity invariant. It does NOT own: the event taxonomy (07A), the warehouse models or KPI registry (07B), the dashboard substrate or audience invariant (07C — 07D inherits INV-07-10 for experiment-arm dashboards), the retention/cascade/small-cell policy (07E), the identity model (Doc 01), or the financial KPI bodies (Doc 09 — FWD-07-01). The §16 cross-doc seam table grounds every one of these boundaries by exact §.

## **1.3 The V1 deliverable vs the V1.1+ infrastructure**

**Launch-required at V1 (the spec deliverable \+ the V1.1+ activation gate):**

* The A/B test event-tagging contract (§5 — `experiment_id` \+ `experiment_arm` \+ `experiment_assignment_timestamp` properties extending existing 07A events via the loose-tier-future-properties path; no new event names; the `assigned_at_first_exposure` discipline that prevents post-hoc assignment).  
* The statistical-framework contract (§6 — canonical defaults α=0.05 / β=0.20 / MDE-floor=5%-relative / sequential-testing correction required; the per-experiment override path with documented rationale).  
* The experiment-management surface contract (§7 — PostHog feature flags \+ experiments surface at V1; specialized tools Statsig/Optimizely V2+ per Parent §6 line 215).  
* The `infra/experiment-registry.yaml` canonical experiment roster (§9 — registry shape; 3-value status enum; statistical-framework-config block per entry; `v1_1_activation_criterion` field; `target_kpi_ids[]` referencing 07B registry).  
* The V1.1+ activation invariant `ci/no-v1-experiments` (§8 — INV-07-12 hard CI gate bodying Parent §3 threat 8 as executable; the sustained-5K-MAU activation criterion).  
* The experiment-to-KPI-registry parity invariant `ci/experiment-references-kpi-registry` (§10 — INV-07-13 mirrors 07C's INV-07-11 dashboard parity; same anti-drift discipline).  
* The audit pass P33 `experiment-registry-presence-and-shape` (§9 / §14 — 07D-introduced; brings family suite to 33 passes total).  
* The experiment-arm cascade \+ small-cell inheritance contract (§12 — explicit inheritance from 07E/07B/07C; 07D never re-implements).

**Target-state V1.1+ (activates when sustained 5K MAU trigger fires):**

* Actual running experiments (V1 has zero `bodied_v1` experiments; all V1 entries are `name_only_stub` or `contract_v1_body_v1_1`).  
* Experiment-arm metric computation reading from 07B §9.6 KPI views by name.  
* Experiment-arm dashboards registered in 07C's `infra/dashboard-registry.yaml`.  
* Experiment-arm result proof artifacts (small-cell-conditioned per §12).  
* Sequential-testing automation in the chosen experiment-management surface.

## **1.4 The two standing directives applied to 07D**

Per Karl's locked family directives:

1. **No cleanup register.** 07D carries §18 Change Records (locked-decision rationale — reader-relevant) but no cleanup register section. In-lock-cycle SWE cleanup items are recorded in the relevant §18 change record narrative, not in a standalone register table. (Same convention as 07B and 07C; deliberate departure from 07A/07E.)  
2. **Strict no-redundancy / Decision 5\.** Every experiment reference to a KPI is by `kpi_id` only; every reference to cascade behavior is to 07E §7/§10 by exact §; every reference to small-cell suppression is to 07E §15 W5 \+ 07B §10.3 by exact §; every reference to dashboard audience invariant is to 07C INV-07-10 \+ 07C §7 audience taxonomy by exact §; every reference to event taxonomy is to 07A §5/§6 by exact §. The DD-07-REDEF defect class (any 07D line that restates a primitive another doc owns) is checked by the §14 audit.

---

# **§2 — Scope & Boundary**

## **2.1 In scope (07D owns)**

The A/B test event-tagging contract — how experiment-arm attribution extends existing 07A events as properties (§5); the statistical-framework contract — canonical defaults \+ override path (§6); the experiment-management surface contract — PostHog feature flags \+ experiments surface at V1; Statsig/Optimizely deferred to V2+ per Parent §6 line 215 (§7); the V1.1+ activation invariant `ci/no-v1-experiments` (§8 — INV-07-12 bodies Parent §3 threat 8 as executable gate); the `infra/experiment-registry.yaml` canonical experiment roster \+ registry shape \+ 3-value status enum \+ statistical-framework-config block \+ V1.1+ activation criterion field (§9); the experiment-to-KPI-registry parity invariant `ci/experiment-references-kpi-registry` (§10 — INV-07-13); the experiment-management access discipline — internal-team-only at V1 inheriting 07C INV-07-10 audience taxonomy (§11); the experiment-arm cascade \+ small-cell inheritance contract — 07E \+ 07B \+ 07C policies inherited by reference (§12).

## **2.2 Ownership boundary table (07D owns / referenced owner)**

| Concern | Owner | 07D section |
| ----- | ----- | ----- |
| A/B test event-tagging contract | **07D** | §5 |
| Statistical-framework contract (defaults \+ override path) | **07D** | §6 |
| Experiment-management surface contract | **07D** | §7 |
| `ci/no-v1-experiments` (INV-07-12) bodying Parent §3 threat 8 | **07D** | §8 |
| `infra/experiment-registry.yaml` canonical experiment roster | **07D** | §9 |
| `ci/experiment-references-kpi-registry` (INV-07-13) | **07D** | §10 |
| Audit pass P33 `experiment-registry-presence-and-shape` | **07D** | §9 / §14 |
| Experiment-arm cascade \+ small-cell inheritance | **07D** (inheritance contract only — never re-implements policy) | §12 |
| Event taxonomy (the events that experiment-arm tagging extends) | Doc 07A V1.0 §5/§6 | §5 references |
| `analytics_user_id` HMAC contract | Doc 07A V1.0 §7 | §5 / §12 references |
| Event-time PII redaction contract | Doc 07A V1.0 §8 | §5 references |
| 35-KPI canonical roster (the experiments' `target_kpi_ids[]` references) | Doc 07B V1.0 §9.5 `infra/kpi-registry.yaml` | §10 references (resolves Doc 07B FWD-07B-02) |
| Registry-Bound KPI Views Layer (V1.1+ experiment-arm metric computation reads from) | Doc 07B V1.0 §9.6 | §6 / §10 references |
| `fact__event` declared-shape model (V1.1+ experiment-arm event-tagging consumes) | Doc 07B V1.0 §9 | §5 / §12 references |
| Warehouse-side small-cell enforcement | Doc 07B V1.0 §10.3 | §12 references |
| Warehouse cascade behavior (V1.1+ experiment-arm rows inherit) | Doc 07B V1.0 §12 | §12 references |
| `infra/dashboard-registry.yaml` (experiment-arm dashboards register here) | Doc 07C V1.0 §8 | §11 references (resolves Doc 07C FWD-07C-01) |
| Internal-only audience invariant (experiment-arm dashboards inherit) | Doc 07C V1.0 §7.2 INV-07-10 | §11 references |
| Dashboard-to-KPI-registry parity (experiment-arm dashboards inherit) | Doc 07C V1.0 §8.4 INV-07-11 | §10 / §11 references |
| Retention class taxonomy \+ cascade policy \+ under-13 hard-delete \+ small-cell policy \+ ML-exclusion invariant | Doc 07E V1.0 §5/§7/§10/§15 W5 | §12 references (07D inherits, never re-implements) |
| Identity model \+ role taxonomy ("internal team" definition) | Doc 01 V6.0 | §11 references |
| Alert routing (V1.1+ experiment-related alerts) | Doc 06C V1.0 §7 `infra/alert-registry.yaml` | §13 references (07D V1 produces no alerts per INV-07-09) |
| PostHog vendor body (V1 substrate for feature flags \+ experiments) | Doc 06E §7 (via W-07-PostHog-BQ) | §7 references |
| Privacy-incident sub-class | Doc 06D V1.0 §11 | §3 threat 2 references |
| No-PII proof-artifact rule | Doc 06D V1.0 §8.7 | §8 / §9 / §10 references |
| Config doctrine (registry locations) | Doc 01A V1.0 §3 | §9 references |
| Financial KPI bodies (experiments measuring revenue impact) | Doc 09 (FWD-07-01) | §10 references (bounded forward-ref) |
| Specialized experimentation tools (Statsig, Optimizely) | V2+ scope per Parent §6 line 215 | §7 references |

## **2.3 Out of scope (referenced, never restated)**

Per Decision 5, the following are explicitly NOT 07D's to define — 07D references the canonical owner by exact §:

* **The 25-event taxonomy \+ the `analytics_user_id` HMAC \+ the PII redaction contract** → Doc 07A V1.0 §5/§6/§7/§8. 07D extends events with arm-attribution properties via 07A's loose-tier-for-future-properties path; never invents event names; never alters the redaction contract.  
* **The 35-KPI canonical roster \+ the 6 V1-bodied KPI measurement bodies** → Doc 07B V1.0 §9.5. 07D experiments reference target KPIs by `kpi_id`; never restate measurement bodies.  
* **The Registry-Bound KPI Views Layer** → Doc 07B V1.0 §9.6. V1.1+ experiment-arm metric computation reads `lyceon_analytics_models_<env>.kpi_<id>` views by name; same pattern 07C dashboards consume.  
* **The `fact__event` declared-shape model \+ the warehouse cascade behavior \+ the warehouse-side small-cell enforcement** → Doc 07B V1.0 §9 \+ §10.3 \+ §12.  
* **The retention class taxonomy \+ the cascade policy \+ the under-13 hard-delete \+ the small-cell/cardinality policy \+ the ML-training-exclusion invariant** → Doc 07E V1.0 §5/§7/§10/§10.6/§15 W5.  
* **The `infra/dashboard-registry.yaml` canonical roster \+ INV-07-10 internal-only audience \+ INV-07-11 dashboard-to-KPI parity \+ audit P32 dashboard-registry-presence-and-shape \+ the audience taxonomy \+ the executive-scorecard contract pattern** → Doc 07C V1.0 §7/§8/§10. Experiment-arm dashboards register in 07C's registry; inherit INV-07-10; inherit INV-07-11.  
* **The Doc 06D §9 retention registry substrate \+ the §10 compliance-evidence process \+ the §11 privacy-incident sub-class \+ the §8.7 no-PII proof-artifact rule** → Doc 06D V1.0.  
* **The PostHog Tier-1 vendor body (the V1 substrate for the experiment-management surface)** → Doc 06E §7 \+ Doc 06A §3 via W-07-PostHog-BQ. 07D does NOT introduce a new vendor additive for V1 — PostHog covers the V1 substrate.  
* **The mastery KPI body math** → Doc 05B §3-§5.  
* **The LISA cost/cap bodies** → Doc 03 Main §11/§24.  
* **The financial unit economics bodies** → Doc 09 (FWD-07-01) — experiments measuring revenue impact reference Doc 09 at V1.1+.  
* **The identity model \+ the role taxonomy** → Doc 01 V6.0.  
* **The V1.1+ warehouse-backed dashboard tool selection** → Doc 07C W-07C-V1.1-TOOL-SELECTION.  
* **Specialized experimentation tools** → Statsig / Optimizely are V2+ candidates per Parent §6 line 215; not 07D V1.0 scope.

---

# **§3 — Threat Model**

Experimentation is the place where small-cell, audience, cascade, KPI-drift, and statistical-power failures compound. The threats are specific to that compound surface — each names its defense by reference to the owning mechanism.

1. **An experiment runs at V1 before statistical meaningfulness.** Parent §3 threat 8 is explicit: PostHog provides the A/B test substrate at launch, but actual A/B experimentation is not statistically meaningful at sub-1K-MAU scale. If V1 launches with A/B tests running anyway, decisions made on underpowered samples will be systematically wrong — and the wrong-decisions compound (a "winning" arm chosen on underpowered data ships permanently and is never revisited). The threat is the strongest argument for the executable gate. *Defense:* INV-07-12 `ci/no-v1-experiments` (§8) — hard CI gate that fails on any registered experiment whose `v1_1_activation_check.sustained_5k_mau_confirmed` is not `true`; bodies Parent §3 threat 8 as an executable enforcement, exactly the way 07C INV-07-10 bodies Parent W7.

2. **An experiment surfaces to an external audience without going through 07C INV-07-10.** Experiment-arm dashboards are dashboards; they register in 07C's `infra/dashboard-registry.yaml` and inherit INV-07-10 `ci/dashboards-internal-only` (internal-team-only at V1; relaxation requires the 07C §7.3 scope-expansion path). The threat is parallel construction — building an experiment-result surface that bypasses 07C's dashboard registry (e.g., an ad-hoc PostHog insight shared externally, an experiment-result PDF exported to a board deck). *Defense:* §11 — experiment-arm result surfaces MUST register in 07C's dashboard registry; experiment-arm dashboards inherit INV-07-10 by virtue of being registered dashboards. Out-of-registry experiment-arm surfaces are governance violations (§14 audit catches via 07C-side enforcement).

3. **Experiment-arm metric computation drifts from the canonical KPI registry.** An experiment's "primary metric" is computed by a one-off SQL query that diverges slightly from 07B's canonical KPI body (e.g., the experiment computes "DAU among experiment-cohort users" with a different active-user definition than KPI-ENG-01). Two experiments measuring "the same KPI" produce different numbers. *Defense:* INV-07-13 `ci/experiment-references-kpi-registry` (§10) — every experiment's `target_kpi_ids[]` MUST resolve to canonical entries in 07B's `infra/kpi-registry.yaml`; experiment-arm metric computation at V1.1+ reads from 07B §9.6 KPI views by name (the W-07C-DOC07B-KPI-VIEWS pattern); arm-conditioned computation applies the same canonical body. A tile-level variant that diverges from a registered KPI is registry-routed via a new KPI registration in 07B (same routing as 07C §11.4 — definition drift never silently allowed at the experiment layer).

4. **Experiment-arm allocation persists after the user's cascade fires.** A user gets assigned to an experiment arm; under-13 cascade fires; arm-assignment row persists in the warehouse — defeating the under-13 hard-delete obligation per 07E §10 / 07E §10.6 ML-training-exclusion. *Defense:* §12 cascade inheritance — experiment-arm allocations stored in the warehouse inherit 07B §12 cascade (partition-bounded under-13 hard-delete \+ 13+ pseudonymized); experiment-arm allocations stored in PostHog at V1.1+ inherit 07E §7 cascade. 07D does NOT re-implement cascade — it requires that any storage of arm assignments uses a substrate that already implements cascade correctly (the §12 inheritance contract is the executable check).

5. **Experiment-arm reports leak small-cell user data.** An experiment-arm report grouped by cohort dimensions (exam-date, geography, school) surfaces small cells that are quasi-identifying — same threat 07C §3 threat 5 surfaces at the dashboard layer, materialized at the experiment-report layer. *Defense:* §12.3 small-cell inheritance — experiment-arm reports inherit 07E §15 W5 small-cell threshold \+ 07B §10.3 warehouse-side enforcement; arm-conditioned reports source from 07B models that already applied suppression; 07D does NOT re-implement the policy.

6. **Statistical-framework defaults are silently overridden per-experiment.** A team running an experiment quietly relaxes α to 0.10 to claim significance on noisy data; another team uses MDE \= 1% relative producing wildly over-powered designs that ship marginal effects as "wins." Without explicit per-experiment governance, the framework defaults become aspirational and the actual statistics in use are inconsistent. *Defense:* §6.3 \+ §9 registry — every experiment's `statistical_framework_config` block in `infra/experiment-registry.yaml` declares the α/β/MDE/sequential-correction values in use; any deviation from §6.2 canonical defaults requires a documented `override_rationale` field; P33 audit pass verifies override-rationale presence whenever the config diverges from defaults. The framework is enforced by registry-conformance, not by hope.

7. **An experiment's V1.1+ activation criterion gets relaxed below sustained 5K MAU.** A team wants to "try a quick experiment" at 3K MAU; the V1.1+ activation criterion (Parent §3 threat 8\) gets quietly relaxed to 3K for the one experiment. Once relaxed, the precedent erodes the criterion entirely. *Defense:* INV-07-12 is a hard CI gate; the sustained-5K-MAU threshold is the §8 §6.13 six-element table's failure-condition input; relaxation requires an invariant amendment which is itself a code-review event. Parent §3 threat 8's quantification ("sustained 5K MAU minimum") is what enables the executable enforcement — a non-quantified threat ("when statistically meaningful") could not be CI-enforced.

8. **Experiment-derived data flows into ML training without under-13 exclusion.** An experiment generates a labeled dataset (e.g., arm-conditioned exam outcomes) that later flows into a model training corpus; if under-13 users were in the experiment cohort, their data enters the corpus, violating 07E §10.6 / §12.5 ML-training-exclusion. *Defense:* §12.4 ML-training-corpus export inheritance — experiment-derived data extracts for ML training MUST source from 07B models that already applied under-13 exclusion; same upstream-applies / downstream-inherits pattern as 07C §13.4.

9. **Multiple concurrent experiments interact (interference) without explicit accounting.** Two experiments running concurrently overlap user assignments; arm A in experiment 1 is correlated with arm A in experiment 2; the measured effect is interference, not the experiment's intended treatment. At V1.1+ activation this is a real risk if multiple experiments register concurrently. *Defense:* §9.4 registry shape — each experiment entry's `concurrent_experiment_isolation_policy` field declares either `exclusive_population` (no other concurrent experiment may overlap the population) or `factorial_design_accepted` (interaction explicitly modeled). P33 audit pass verifies the field is present on every `bodied_v1` experiment entry at V1.1+.

---

# **§4 — Launch vs V1.1+ Experimentation Framing**

Per Doc 07 Parent §4 \+ line 175 \+ §22 framing, **07D is the most target-state-leaning sub-doc** in the Doc 07 family — even more so than 07C, because 07C ships one V1-bodied operational dashboard while 07D ships zero V1-bodied experiments. Every 07D mechanism declares `launch_required: bool` per the Doc 06E §4 convention adopted family-wide.

## **4.1 Launch-required at V1**

* **`infra/experiment-registry.yaml` canonical experiment roster** (§9) — registry shape \+ entry validation rules; the registry is the canonical anti-drift contract for experiments, same role 07B's KPI registry plays for KPIs and 07C's dashboard registry plays for dashboards. `launch_required: true`. V1 entries are `name_only_stub` or `contract_v1_body_v1_1`; zero `bodied_v1` at V1.  
* **`ci/no-v1-experiments` (INV-07-12)** — `launch_required: true`. Hard CI gate that fails on any registered experiment whose `v1_1_activation_check.sustained_5k_mau_confirmed` is not `true`; bodies Parent §3 threat 8 as executable enforcement (§8).  
* **`ci/experiment-references-kpi-registry` (INV-07-13)** — `launch_required: true`. Hard CI gate that fails on any experiment whose `target_kpi_ids[]` contains a value not in 07B's `infra/kpi-registry.yaml` (§10).  
* **Audit pass P33 `experiment-registry-presence-and-shape`** (§9 / §14) — `launch_required: true`. 07D-introduced audit pass parallel to 07C's P32; brings family audit suite to 33 passes total.  
* **The A/B test event-tagging contract** (§5) — `launch_required: true`. The property-extension schema (`experiment_id`, `experiment_arm`, `experiment_assignment_timestamp`) extending existing 07A events is locked at V1 so V1.1+ implementations have a stable contract to build against.  
* **The statistical-framework contract — canonical defaults \+ override path** (§6) — `launch_required: true`. The defaults (α=0.05 / β=0.20 / MDE-floor=5% relative / sequential-correction-required) are the V1 contract; per-experiment overrides require documented rationale.  
* **The experiment-management surface contract** (§7) — `launch_required: true`. PostHog feature flags \+ experiments surface at V1 \+ V1.1+; specialized tools V2+.

## **4.2 Target-state V1.1+ (activates when sustained 5K MAU trigger fires)**

* **Actual running experiments** — V1.1+ activation event; the first `bodied_v1` experiment entry materializes when an experiment's `v1_1_activation_check.sustained_5k_mau_confirmed: true` is set \+ the experiment is configured in PostHog's experiments surface.  
* **Experiment-arm metric computation against 07B §9.6 KPI views** — reads `lyceon_analytics_models_<env>.kpi_<id>` views by name with arm-conditioning; same pattern 07C V1.1+ dashboards consume.  
* **Experiment-arm dashboards registered in 07C's `infra/dashboard-registry.yaml`** — inherit INV-07-10 (internal-team-only) \+ INV-07-11 (KPI-reference parity).  
* **Experiment-arm result proof artifacts** — small-cell-conditioned per §12.3; subject to Doc 06D §8.7 no-PII rule.  
* **Sequential-testing automation** — implementation in the chosen experiment-management surface (PostHog's experiments product supports sequential-test stopping rules; V1.1+ configuration applies §6.2 corrections).  
* **V1.1+ experiment-related alerts** — registered in Doc 06C §7 `infra/alert-registry.yaml` when experiments activate (07D V1 produces zero alerts per INV-07-09 family-wide).

## **4.3 Deploy-gate class**

07D adopts the **SPEC\_CONTRACT\_GATE** class from Doc 07 Parent §4: 07D's spec must lock before V1.1+ experimentation infrastructure deploys, even though the experiments themselves are V1.1+. Unlike 07B/07C, 07D introduces **no new bundled cross-doc additive** — PostHog covers the V1 \+ V1.1+ experiment-management substrate via W-07-PostHog-BQ (already registered); the V1.1+ warehouse-backed metric computation rides on top of 07B §9.6 \+ W-07C-V1.1-TOOL-SELECTION (both already declared); specialized tools Statsig/Optimizely are V2+ per Parent §6 line 215 and would require their own additive only if/when V2+ scope opens.

---

# **§5 — A/B Test Event-Tagging Contract**

**launch\_required: true.** This is the spec contract for how experiment-arm attribution extends existing 07A events — locked at V1 so V1.1+ implementations have a stable target.

## **5.1 The event-tagging principle**

Experiments do NOT introduce new event names. Lyceon's event taxonomy is owned by Doc 07A V1.0 §5/§6 (the 25-event roster registered in `infra/event-schema-registry.yaml`), and that taxonomy is fixed at V1 launch. What experiments DO is **extend existing events with arm-attribution properties** via Doc 07A's loose-tier-for-future-properties path (Doc 07A V1.0 §5.2 — referenced, never restated). Three properties extend the property schema of every event emitted by a user who has been assigned to one or more experiments:

| Property | Type | Semantics |
| ----- | ----- | ----- |
| `experiment_id` | string | The canonical experiment identifier from `infra/experiment-registry.yaml`; resolves to a registered entry per INV-07-12 |
| `experiment_arm` | string | The arm the user is assigned to within the experiment; must be one of the `arm_definitions[]` values in the experiment registry entry |
| `experiment_assignment_timestamp` | iso8601 | The timestamp of the user's first assignment to this experiment-arm (the `assigned_at_first_exposure` discipline per §5.4) |

**Multi-experiment overlap policy (RB-07D-V1-04, Q-07D-R1-3=b).** To prevent property-shape drift in downstream consumers (PostHog property column-type ambiguity; BigQuery column-type fork between scalar string and array-of-string), 07D adopts a **scalar-default-with-explicit-factorial-opt-in** posture:

* **Default posture (the common case):** scalar `experiment_id`, `experiment_arm`, `experiment_assignment_timestamp` properties; **each user is assigned to at most one experiment at a time**. This is enforced by every experiment's registry entry declaring `concurrent_experiment_isolation_policy.isolation_mode: exclusive_population` (§9.4) — under this policy, no other concurrent experiment may overlap the same user population during the experiment's runtime. The scalar properties are simple; the schema is unambiguous; downstream consumers parse a single scalar value per event.

**Factorial designs (the explicit opt-in):** when an experiment's registry entry declares `concurrent_experiment_isolation_policy.isolation_mode: factorial_design_accepted` AND names other concurrent experiments in `conflicting_experiment_ids[]`, the user's events carry an array-shaped property:  
 experiment\_assignments:  \- experiment\_id: EXP-LRN-01    experiment\_arm: control    experiment\_assignment\_timestamp: 2026-08-15T14:23:00Z  \- experiment\_id: EXP-ENG-02    experiment\_arm: variant\_a    experiment\_assignment\_timestamp: 2026-08-15T14:25:00Z

* The `experiment_assignments[]` array is structurally consistent (always array-shaped when present); a factorial-design participating user's events carry the array property instead of the three scalar properties. The scalar properties are NOT emitted on those events — the schema choice is one-or-the-other, never both, so downstream consumers can branch on shape without ambiguity.

**The default-vs-factorial discipline is registry-enforced.** P33 audit pass (§9.5 hard-fail condition 5\) verifies every `bodied_v1` experiment has a populated `isolation_mode`; the default `exclusive_population` ensures the scalar property shape is used unless `factorial_design_accepted` is explicitly opted into. This prevents the SWE-flagged scalar-or-array mutation problem: a user is in EITHER the scalar-property regime OR the `experiment_assignments[]` array regime, never silently switched between the two as concurrent assignments accumulate.

## **5.2 No event-name proliferation**

The 25-event taxonomy in 07A is not extended by 07D. An experiment "Variant B exam-completion checkout flow" does NOT add a new `experiment_variant_b_exam_completed` event; it adds `experiment_id`, `experiment_arm`, `experiment_assignment_timestamp` properties to the existing `exam_completed` event. This is the discipline that lets the 07A registry stay closed-set at V1 while still supporting V1.1+ experimentation — same way 07A's loose-tier-for-future-properties path (07A §5.2) lets new properties land without new events.

Concrete consequence: when an experiment activates, the V1 launch-required `infra/event-schema-registry.yaml` does NOT change. The experiment-registry entry declares which 07A events its arm-attribution properties extend (`target_event_names[]` field per §9.4); the property extension is implementation-time wiring, not a registry-schema change.

## **5.3 The `assigned_at_first_exposure` discipline**

An experiment's arm assignment for a user is **stable from the moment of first exposure**. Once a user is bucketed into arm A for experiment X, every subsequent event that user emits for the duration of the experiment carries `experiment_id: X`, `experiment_arm: A`, `experiment_assignment_timestamp: <first-exposure-ts>`. The discipline prevents two threats:

* **Post-hoc reassignment.** An implementation that re-bucketed users on each event (e.g., re-computing the hash bucket each event) would silently drift user populations between arms, destroying treatment integrity.  
* **Pre-exposure tagging.** An implementation that tagged events for users who had not yet been exposed to the experiment would inflate the population with users who never saw the treatment, biasing effect estimation toward null.

The discipline is implementation-level (the PostHog experiments product enforces it natively via its feature-flag substrate; V1.1+ alternative tools must enforce equivalently per §7.2 selection criteria); 07D V1 declares the discipline as a contract that V1.1+ implementations satisfy.

## **5.4 Event-time PII redaction unchanged**

The 07A §8 PII redaction contract applies identically to events carrying experiment-arm-attribution properties — adding `experiment_id` \+ `experiment_arm` \+ `experiment_assignment_timestamp` properties does NOT alter the PII redaction contract. None of the three properties carries PII; `experiment_id` is a canonical opaque identifier, `experiment_arm` is a categorical label, `experiment_assignment_timestamp` is an opaque timestamp. The 07A `analytics_user_id` HMAC contract (07A §7) carries through unchanged — arm-attributed events are emitted by the same `emitEvent` boundary 07A §6 specifies (referenced, never restated).

---

# **§6 — Statistical-Framework Contract**

**launch\_required: true.** Canonical defaults \+ override path locked at V1 so V1.1+ experiments operate on a known statistical foundation.

## **6.1 The framework principle**

07D V1 names canonical statistical defaults that V1.1+ experiments inherit unless explicitly overridden with documented rationale. The defaults are conservative — chosen for the family's audit-friendly / safety-first posture — and apply to every experiment registered in `infra/experiment-registry.yaml`. The override path exists (per Karl's Q-07D-2=a decision) so V1.1+ implementers are not forced into one-size-fits-all statistics, but every override is recorded in the experiment's registry entry with explicit rationale.

## **6.2 Canonical defaults**

| Parameter | V1.0 canonical default | Semantics |
| ----- | ----- | ----- |
| **α (significance threshold)** | **0.05** | Type I error rate (false-positive ceiling); the conventional research default, conservative enough for safety-critical product decisions |
| **β (Type II error / power complement)** | **0.20** (so power 1 − β \= **0.80**) | Type II error rate; the conventional 80%-power design |
| **MDE floor (minimum detectable effect)** | **5% relative** | The smallest relative effect size the experiment is designed to detect; floor prevents over-powered designs that ship marginal effects as "wins"; a per-experiment MDE may be larger than 5% with documented rationale but not smaller without explicit override |
| **Sequential-testing correction** | **Required** when peeking-at-results during experiment runtime is possible. **Canonical default (RB-07D-V1-06): `posthog_native_sequential`** when the experiment is configured in PostHog's experiments product (PostHog's product supports a built-in sequential-test stopping rule); **canonical fallback default: `obrien_fleming` (alpha-spending)** when the experiment is configured outside PostHog (offline analysis, future non-PostHog substrate). Other corrections (`alpha_spending`, `bonferroni_by_look`, `none_if_no_peeking`) are permitted with documented `override_rationale` in `statistical_framework_config`. | Prevents the "looking until significant" failure mode; the per-substrate default removes the menu-of-options ambiguity at lock-grade specification while preserving override flexibility |
| **Pre-registration of hypothesis \+ primary metric \+ arms** | **Required at experiment registration** | The experiment's `hypothesis` \+ `target_kpi_ids[]` (primary metric) \+ `arm_definitions[]` (arms) MUST be declared in the registry entry BEFORE any user is assigned to an arm; post-hoc hypothesis editing is forbidden (the executable check: registry entry's `last_reviewed_at` predates the experiment's `first_assignment_timestamp`) |

### **6.2.1 Sequential-correction default selection (RB-07D-V1-06)**

The `sequential_correction` field in `statistical_framework_config` is a 5-value enum:

| Value | When to use |
| ----- | ----- |
| **`posthog_native_sequential`** | **Canonical default for PostHog-substrate experiments.** PostHog's experiments product implements a built-in sequential stopping rule; using PostHog's native method ensures the rule is enforced automatically by the substrate without manual analyst intervention |
| **`obrien_fleming`** | **Canonical default for non-PostHog/offline experiments.** O'Brien-Fleming alpha-spending boundaries are the standard offline sequential-test method; appropriate for any analysis performed outside PostHog's native sequential-testing surface |
| `alpha_spending` | A generalized alpha-spending approach (other than O'Brien-Fleming); permitted with documented `override_rationale` explaining the alpha-spending function chosen |
| `bonferroni_by_look` | Bonferroni correction at each interim look; conservative; permitted with documented `override_rationale` |
| `none_if_no_peeking` | No correction needed when the experiment design forbids interim analysis (single look at fixed sample size); permitted with documented `override_rationale` confirming no peeking will occur |

The defaults remove the lock-grade ambiguity of "use Bonferroni or O'Brien-Fleming or alpha-spending or PostHog sequential" without overconstraining V1.1+ implementers; the override path keeps the family-wide override-with-rationale discipline.

## **6.3 Per-experiment override path (Q-07D-2=a documented override)**

An experiment may diverge from any §6.2 default per Karl's Q-07D-2=a decision (named defaults with override path), but every divergence MUST be recorded in the experiment's `statistical_framework_config` block in `infra/experiment-registry.yaml` (§9.3) with explicit `override_rationale` text. The rationales are reader-visible (an internal team member reviewing the registry sees exactly which defaults each experiment diverges from and why). The P33 audit pass (§14.2) verifies override-rationale presence whenever the config diverges from §6.2 defaults; an override without rationale is a registry defect.

Examples of legitimate overrides (illustrative, not exhaustive):

* **Strict-α (e.g., α \= 0.01)** for a high-stakes ship/no-ship decision where false-positives are costly.  
* **High-MDE-floor (e.g., MDE \= 10%)** for a low-volume cohort where the smallest detectable effect is necessarily larger; documented as a power-vs-volume trade-off.  
* **Bayesian framework** in place of frequentist α/β with documented prior \+ posterior decision rule.

Examples of overrides that are NOT legitimate (registered overrides should not paper over these):

* **Relaxed-α (e.g., α \= 0.10)** without a documented power/cost trade-off justifying the false-positive risk increase.  
* **MDE floor below 5% relative** without documented rationale; the floor exists specifically to prevent over-powered designs.  
* **No sequential-correction** when peeking is possible.

## **6.4 The framework discipline is enforced by registry-conformance, not by hope**

Per Karl's Q-07D-2=a — name the defaults, allow override with rationale — the enforcement mechanism is **the experiment registry**. Every experiment registers its `statistical_framework_config`; P33 audit pass verifies presence \+ override-rationale-when-divergent. Implementations cannot quietly run experiments at α=0.10 without that override being visible to any reviewer reading the registry.

---

# **§7 — Experiment-Management Surface Contract**

**launch\_required: true.** PostHog feature flags \+ experiments surface at V1 \+ V1.1+; specialized tools are V2+ per Parent §6 line 215\.

## **7.1 V1 \+ V1.1+ substrate: PostHog**

Per Doc 07 Parent line 192 \+ line 194 \+ line 215, PostHog is the V1 launch-required substrate that includes the feature-flag \+ experiments product as part of its integrated offering (along with product analytics \+ dashboards \+ funnels \+ session replay). The PostHog vendor body lives in Doc 06E §7 via W-07-PostHog-BQ (referenced, never restated). When the V1.1+ activation trigger fires (sustained 5K MAU), experiments activate on the PostHog experiments surface — no new vendor decision required, no new vendor additive owed by 07D.

## **7.2 Selection criteria the V1 substrate satisfies**

PostHog's feature-flag \+ experiments product satisfies these criteria (criteria are framed tool-agnostic so V2+ replacement candidates can be evaluated against the same checklist):

1. **Supports the `assigned_at_first_exposure` discipline** (§5.3) — PostHog's feature flag bucketing is hash-stable, so a user once assigned to an arm remains in that arm for the duration of the experiment.  
2. **Supports event-property arm-attribution** — PostHog automatically attaches feature-flag values as event properties on every event the user emits, matching the §5.1 property contract.  
3. **Supports sequential-testing or equivalent peeking-correction** (§6.2 sequential-correction-required criterion) — PostHog's experiments product implements sequential stopping rules; V1.1+ configuration sets the §6.2 correction.  
4. **Internal-only access enforceable** — PostHog access-control (Doc 07C §6.2 criterion 3 references the PostHog access-control surface — referenced, never restated) supports internal-team-only access for experiment-management UI; same surface 07C INV-07-10 hardening already verifies.  
5. **Cascade-correct arm-assignment storage** — PostHog feature-flag assignments tied to the `analytics_user_id` inherit 07E §7 PostHog-side cascade (under-13 hard-delete propagates through PostHog's per-person property deletion); 07B §12 warehouse cascade applies at V1.1+ when assignments flow to BigQuery.  
6. **Pre-registration of hypothesis \+ arms via registry** — PostHog's experiments product accepts experiment definitions via API \+ UI; the §6.2 pre-registration requirement is satisfied by the `infra/experiment-registry.yaml` registry entry preceding any user assignment.

## **7.3 V2+ candidates: Statsig, Optimizely**

Per Parent §6 line 215, specialized experimentation tools (Statsig, Optimizely) are **V2+ candidates** — not V1.0, not V1.1+. The V1.1+ activation event uses PostHog's experiments product as-is. The V2+ candidate evaluation will use the §7.2 criteria as the checklist; selection (if and when V2+ scope opens) would require a Doc 06E vendor body additive (similar shape to W-07C-V1.1-TOOL-SELECTION but for the experimentation tool layer).

07D V1.0 does NOT pre-commit to V2+ tool selection or even to whether V2+ tooling is required. PostHog's experiments product may remain sufficient indefinitely; the V2+ candidate evaluation occurs only if PostHog's experiments product becomes a binding constraint on Lyceon's experimentation needs.

---

# **§8 — V1.1+ Activation Trigger Enforcement (INV-07-12)**

**launch\_required: true.** This is the executable gate that bodies Parent §3 threat 8 — the load-bearing invariant of the entire 07D contract.

## **8.1 The activation principle**

Per Doc 07 Parent §3 threat 8 (Karl-locked, Q-07D-1=a): no experiment runs in production at V1; experiments activate only when **sustained 5K MAU is confirmed**. The threshold is Parent-canonical; 07D bodies it as an executable enforcement.

"Sustained 5K MAU" is operationalized as: **monthly active users (KPI-ENG-03 from 07B's registry, V1-bodied) \>= 5,000 for at least 3 consecutive complete calendar months**. The "sustained" qualifier prevents one-time-spike activation (a viral moment that spikes MAU to 5K for one month is not statistical-meaningfulness-restored); 3 consecutive months is the empirical floor for "this is the actual product scale, not noise."

The 3-month operationalization is the V1 default; a per-experiment override of the operationalization itself is permitted via the experiment registry entry's `v1_1_activation_criterion_override` field per §8.3 — but with **bounded directionality per RB-07D-V1-03 (Q-07D-R1-2=b)**: overrides that make the gate *stricter* (raise MAU threshold above 5K; require 4+ consecutive months; add segment-specific MAU requirements) are permitted with documented rationale alone; overrides that *lower* the 5K-MAU floor are permitted **only with explicit dual approval** (CTO \+ legal/privacy admin) **plus an explicit power analysis** demonstrating the lower threshold still yields adequate statistical power for the experiment's declared MDE. This is the load-bearing protection: the gate cannot be casually weakened, but legitimate low-threshold cases (e.g., a high-frequency event with abundant samples per user, where 3K MAU yields sufficient power for a 5% MDE) are not categorically forbidden — they are channeled through the dual-approval path that creates an audit record.

## **8.2 INV-07-12 `ci/no-v1-experiments` (the executable invariant)**

Per Parent §6.13 six-element implemented-definition:

| Element | Definition |
| ----- | ----- |
| What it proves | No experiment in `infra/experiment-registry.yaml` has `status: bodied_v1` unless its `v1_1_activation_check.sustained_5k_mau_confirmed` is `true` (with the 3-consecutive-month operationalization verified) AND the full executable proof block per RB-07D-V1-02 is present (source\_kpi\_id \+ evidence\_window \+ evidence\_query\_ref \+ observed\_monthly\_values \+ confirmation\_artifact\_url \+ confirmed\_by\_admin\_id). Bodies Parent §3 threat 8 as executable gate — confirmation is auditable against the canonical KPI registry, not boolean-trust. |
| Execution location | GitHub Actions, on PRs touching `infra/experiment-registry.yaml`; plus nightly |
| Input | `infra/experiment-registry.yaml` (experiment registry) \+ 07B KPI-ENG-03 monthly\_active\_users canonical body (referenced via 07B §9.5.3 \+ §9.6 KPI views layer at V1.1+; the `evidence_query_ref` field must resolve to a canonical 07B §9.6 view name) |
| Failure condition | (a) Any experiment with `status: bodied_v1` whose `v1_1_activation_check.sustained_5k_mau_confirmed` is not `true`; (b) any experiment with `status: bodied_v1` whose `v1_1_activation_check.confirmation_timestamp` is missing or older than 12 months (re-confirmation required for long-running activation precedents); (c) any experiment with `status: bodied_v1` and `v1_1_activation_criterion_override` present without `override_rationale` documented; (d) any experiment with `status: bodied_v1` that lacks the `v1_1_activation_check` block entirely; (e) any experiment with `status: bodied_v1` whose `first_assignment_timestamp` precedes the `confirmation_timestamp` (cart-before-horse: the activation must be confirmed BEFORE assignment begins); (f) **any experiment with `sustained_5k_mau_confirmed: true` whose executable proof fields are missing or incomplete (RB-07D-V1-02) — specifically: `source_kpi_id` not resolvable in 07B's registry; `evidence_window.calendar_months` not exactly 3 consecutive complete calendar months; `evidence_query_ref` not resolvable to a canonical 07B §9.6 view name; `observed_monthly_values` not exactly 3 numeric values OR any value below the activation threshold for the corresponding calendar month; `confirmation_artifact_url` missing or unresolvable; `confirmed_by_admin_id` missing**; (g) **any experiment whose `v1_1_activation_criterion_override` lowers the 5K-MAU floor without `override_approvals.cto_approval_admin_id` \+ `override_approvals.legal_privacy_approval_admin_id` \+ `override_approvals.power_analysis_artifact_url` \+ `override_approvals.approval_rationale` all populated (RB-07D-V1-03, Q-07D-R1-2=b — sub-5K-MAU activation is permitted under documented dual-approval \+ explicit power analysis, NOT silent override)**; (h) **any experiment with `confirmation_timestamp` that does NOT postdate the last `evidence_window.calendar_months` entry's month-end (the confirmation must be made AFTER the evidence window completes, not before)** |
| Proof artifact | `no-v1-experiments` record per Doc 07 Parent §10.5 envelope \+ extras: `experiments_checked[]`, per-experiment `{experiment_id, status, sustained_5k_mau_confirmed, source_kpi_id, evidence_window_months, observed_monthly_values, confirmation_artifact_url, confirmed_by_admin_id, confirmation_timestamp, first_assignment_timestamp, override_present, override_approvals_complete, decision}`. Subject to Doc 06D §8.7 (carries experiment-id \+ boolean \+ timestamp \+ admin-id \+ URL metadata only; no user data — the observed\_monthly\_values are aggregate MAU counts already exposed at the registry layer per Doc 07B §9.5.3). |
| launch\_required | true |

## **8.3 Per-experiment override of the activation criterion (RB-07D-V1-03 Q-07D-R1-2=b soft floor)**

Per Q-07D-1=a \+ RB-07D-V1-03 (Q-07D-R1-2=b), the sustained-5K-MAU criterion itself can be overridden per-experiment, but with **bounded directionality**:

**Stricter overrides (no approval gate beyond rationale):** raising the MAU threshold above 5K, requiring 4+ consecutive months, adding segment-specific MAU requirements. Recorded in `v1_1_activation_criterion_override` \+ `override_rationale`. Example: an experiment requiring 10K MAU because of segment-level statistical power; an experiment requiring 6 consecutive months because of seasonal-effect concerns. P33 verifies `override_rationale` presence.

**Looser overrides (sub-5K-MAU floor — require dual approval \+ power analysis):** lowering the MAU threshold below 5K is permitted **only** under all of these conditions, each enforced by INV-07-12 failure condition (g):

1. `override_approvals.cto_approval_admin_id` populated (CTO approval recorded against Doc 01 admin role).  
2. `override_approvals.legal_privacy_approval_admin_id` populated (legal/privacy admin approval recorded; legal/privacy review confirms the lower threshold does not compromise privacy posture for the experiment's cohort).  
3. `override_approvals.power_analysis_artifact_url` populated (explicit power analysis demonstrating the lower MAU floor still yields adequate statistical power for the experiment's declared MDE; the analysis is auditable and reviewable).  
4. `override_approvals.approval_rationale` populated (documented justification beyond the generic `override_rationale`; explains specifically why this experiment's design tolerates the lower threshold — typical valid case: high-frequency event with abundant samples per user yields sufficient power at lower MAU; typical invalid case: "we want to ship faster").

The dual-approval requirement is INV-07-12 failure condition (g) — bypassing any of the four required fields hard-fails CI. **What cannot be relaxed by per-experiment override is INV-07-12 itself** — the requirement that some sustained-MAU-based activation criterion is confirmed before `bodied_v1` is the load-bearing protection. Removing the invariant entirely (e.g., "experiments can run at any scale without confirmation") would require:

1. A documented Parent §3 threat 8 re-evaluation: statistical-power posture revision against the no-criterion stance.  
2. An invariant amendment (§8.2 failure-condition update or removal).  
3. A code-review event — INV-07-12 itself is a CI rule whose source change is reviewable.

This is the "executable Parent §3 threat 8" — Parent's policy becomes an enforceable contract whose relaxation has a documented path (per-experiment via dual approval; categorical via invariant amendment).

## **8.4 V1.0 lock posture: zero `bodied_v1` experiments**

At V1.0 lock, `infra/experiment-registry.yaml` contains zero `status: bodied_v1` entries. The registry may contain `name_only_stub` entries (canonical names reserved for future activation) and `contract_v1_body_v1_1` entries (experiment contracts locked at V1, bodied at V1.1+ when their activation criteria fire). The first `bodied_v1` entry is the V1.1+ activation event itself — the moment Lyceon's first experiment runs in production.

---

# **§9 — The `infra/experiment-registry.yaml` Canonical Experiment Roster**

**launch\_required: true.** This is the launch-required core of 07D — same role for experiments that 07B's `infra/kpi-registry.yaml` plays for KPIs and 07C's `infra/dashboard-registry.yaml` plays for dashboards.

`infra/experiment-registry.yaml` is the canonical machine-readable experiment registry per Doc 06C §6.0 registry-canonical principle (the YAML is canonical; this markdown roster is reference, not source-of-truth). It carries the V1 experiment roster (zero bodied; all `name_only_stub` or `contract_v1_body_v1_1`) \+ the V1.1+ activation criteria \+ the statistical-framework-config blocks \+ the `target_kpi_ids[]` references that INV-07-13 validates against 07B's KPI registry.

## **9.1 Registry purpose**

The registry is the anti-drift contract for experiments (§3 threats 1, 3, 6, 7\) — same role for experiments that 07B's KPI registry plays for KPIs and 07C's dashboard registry plays for dashboards. Every experiment is registered with a stable `experiment_id`, a `hypothesis`, `arm_definitions[]`, `target_kpi_ids[]` referencing 07B's registry, an `audience` (internal-only at V1 per §11 inheritance), a `statistical_framework_config` block per §6, a `v1_1_activation_check` block per §8, and a `concurrent_experiment_isolation_policy` per §3 threat 9\. Outside-the-registry experiments (ad-hoc PostHog feature flags configured without registry entry) are not Lyceon-canonical and are not considered part of 07D's V1.0 contract; the P33 audit pass \+ the experiment-management surface access discipline (§11) catch them.

## **9.2 Registry entry shape**

experiments:  
  \- experiment\_id: \<stable id; format 'EXP-\<area\>-\<NN\>'\>             \# e.g. EXP-LRN-01  
    experiment\_name: \<snake\_case canonical name\>                      \# e.g. exam\_completion\_checkout\_v1  
    hypothesis: \<pre-registered hypothesis text\>                      \# required pre-assignment per §6.2  
    audience: \<internal\_team\>                                         \# V1 inherits 07C INV-07-10; only internal\_team permitted at V1  
    arm\_definitions:                                                  \# required pre-assignment per §6.2  
      \- arm\_name: \<control | variant\_a | variant\_b | ...\>  
        description: \<one-line\>  
        allocation\_percentage: \<integer; arms sum to 100\>  
    target\_kpi\_ids:                                                    \# primary \+ secondary metrics  
      \- \<kpi\_id from infra/kpi-registry.yaml\>                          \# MUST resolve to 07B canonical entries per INV-07-13  
    target\_event\_names:                                                \# 07A events the arm-attribution properties extend  
      \- \<event\_name from infra/event-schema-registry.yaml\>             \# MUST resolve to 07A canonical entries  
    status: \<bodied\_v1 | contract\_v1\_body\_v1\_1 | name\_only\_stub\>      \# 3-value enum inherited from 07C §8.2 RB-07C-V1-01; at V1.0 lock, zero bodied\_v1  
    statistical\_framework\_config:                                      \# required per §6.3  
      alpha: \<numeric; default 0.05\>  
      beta: \<numeric; default 0.20\>  
      mde\_floor\_relative: \<numeric; default 0.05 — 5% relative\>  
      sequential\_correction: \<posthog\_native\_sequential | obrien\_fleming | alpha\_spending | bonferroni\_by\_look | none\_if\_no\_peeking\>  \# RB-07D-V1-06: 5-value enum; defaults per §6.2.1 (posthog\_native\_sequential for PostHog-substrate; obrien\_fleming for non-PostHog/offline)  
      override\_rationale: \<required when any param differs from §6.2 defaults\>  
      power\_analysis\_artifact\_url: \<required for status=bodied\_v1 per RB-07D-V1-07; URL/path to the power analysis showing required-users-per-arm × MDE × baseline-rate yielded by the chosen α/β; auditable artifact per Doc 06D §8.7 no-PII rule\>  
      sample\_size\_requirement:                                          \# required for status=bodied\_v1 per RB-07D-V1-07  
        required\_users\_per\_arm: \<integer; minimum users per arm to reach the §6.2 MDE-floor at the chosen α/β\>  
        expected\_duration\_days: \<integer; expected experiment runtime to accumulate required\_users\_per\_arm given current traffic\>  
        assumptions:                                                    \# the inputs to the power analysis  
          baseline\_rate: \<numeric; the control-arm baseline event rate or value used in the power calc\>  
          mde\_relative: \<numeric; the minimum detectable effect size as relative change; should equal the statistical\_framework\_config.mde\_floor\_relative unless this experiment intentionally aims higher\>  
    v1\_1\_activation\_check:                                             \# required per §8.2; RB-07D-V1-02 expanded with executable proof fields  
      sustained\_5k\_mau\_confirmed: \<boolean; must be true for status=bodied\_v1\>  
      source\_kpi\_id: \<required when sustained\_5k\_mau\_confirmed=true; canonical KPI body (default 'KPI-ENG-03') from 07B's registry that the evidence references\>  
      evidence\_window:                                                  \# required when sustained\_5k\_mau\_confirmed=true  
        calendar\_months: \<list of 3 consecutive YYYY-MM strings\>        \# the 3 complete calendar months that meet the threshold  
      evidence\_query\_ref: \<required when sustained\_5k\_mau\_confirmed=true; canonical 07B §9.6 view name 'lyceon\_analytics\_models\_\<env\>.kpi\_eng\_03' or override per source\_kpi\_id\>  
      observed\_monthly\_values: \<required when sustained\_5k\_mau\_confirmed=true; list of 3 numeric values, each ≥ the activation threshold for the corresponding calendar month\>  
      confirmation\_artifact\_url: \<required when sustained\_5k\_mau\_confirmed=true; URL/path to the proof artifact (query result snapshot, dashboard screenshot of KPI view, signed statement) per Doc 06D §8.7 no-PII rule\>  
      confirmed\_by\_admin\_id: \<required when sustained\_5k\_mau\_confirmed=true; the Doc 01 admin role identifier of the person who confirmed activation; provides auditable accountability\>  
      confirmation\_timestamp: \<iso8601; when sustained-MAU was confirmed; must postdate the last calendar\_month end and predate first\_assignment\_timestamp\>  
      operationalization: \<'monthly\_active\_users\_ge\_5000\_for\_3\_consecutive\_calendar\_months' | \<override\>\>  
      v1\_1\_activation\_criterion\_override: \<optional; per-experiment override per §8.3\>  
      override\_rationale: \<required when override present\>  
      override\_approvals:                                               \# required when v1\_1\_activation\_criterion\_override lowers the 5K-MAU floor per RB-07D-V1-03 (Q-07D-R1-2=b)  
        cto\_approval\_admin\_id: \<required when override sets MAU floor below 5K\>  
        legal\_privacy\_approval\_admin\_id: \<required when override sets MAU floor below 5K\>  
        power\_analysis\_artifact\_url: \<required when override sets MAU floor below 5K; explicit power analysis showing the lower threshold still yields adequate statistical power for the experiment's MDE\>  
        approval\_rationale: \<required when override sets MAU floor below 5K; documented justification beyond the override\_rationale field\>  
    concurrent\_experiment\_isolation\_policy:                            \# required per §3 threat 9  
      isolation\_mode: \<exclusive\_population | factorial\_design\_accepted\>  
      conflicting\_experiment\_ids: \<list when factorial; required when factorial\>  
    first\_assignment\_timestamp:                                        \# set at V1.1+ activation; must postdate confirmation\_timestamp  
      \<iso8601 or null\>  
    posthog\_experiment\_binding:                                        \# RB-07D-V1-05: registry ↔ PostHog vendor-state parity  
      posthog\_experiment\_id: \<required for status=bodied\_v1; null permitted for contract\_v1\_body\_v1\_1 / name\_only\_stub\>  
      posthog\_feature\_flag\_key: \<required for status=bodied\_v1; the feature-flag key in PostHog that gates arm assignment\>  
      vendor\_state: \<required for status=bodied\_v1; one of: draft | running | paused | archived; mirrors the actual PostHog vendor surface state\>  
    canonical\_owner\_doc\_and\_section: 'Doc 07D V1.0 §9'  
    description: \<one-line purpose\>  
    last\_reviewed\_at: \<iso8601\>

The `audience` field is constrained by 07C INV-07-10 (inheritance per §11). The `target_kpi_ids[]` is constrained by INV-07-13 (§10). The `target_event_names[]` is constrained against 07A's event registry by the same shape-conformance pattern. The `status × v1_1_activation_check` cross-constraint is per INV-07-12 (§8.2). The `concurrent_experiment_isolation_policy` is per §3 threat 9\.

## **9.3 The 3-value status enum**

Inherited from 07C §8.2 (RB-07C-V1-01 introduced the third value):

* **`bodied_v1`** — the experiment is actually running in production at V1.1+. **At V1.0 lock, zero `bodied_v1` entries permitted** per INV-07-12. The first `bodied_v1` entry materializes only when an experiment's `v1_1_activation_check.sustained_5k_mau_confirmed: true` and the experiment is configured in PostHog's experiments product.  
* **`contract_v1_body_v1_1`** — the experiment contract is locked at V1 (hypothesis \+ arms \+ target KPIs \+ statistical config); the bodied experiment activates at V1.1+ when its `v1_1_activation_check` is confirmed. This is the typical V1 status for experiments that are pre-designed but await activation.  
* **`name_only_stub`** — just a reserved canonical name \+ minimum metadata; no contract locked yet; bodies in some future revision when the experiment is designed.

**07D-specific semantic clarification (RB-07D-V1-01).** The family enum value `bodied_v1` is inherited from 07C and used consistently across all three Doc 07 registries (`infra/kpi-registry.yaml` in 07B, `infra/dashboard-registry.yaml` in 07C, `infra/experiment-registry.yaml` here in 07D) to denote a registry entry whose underlying capability is materialized in production. For 07D specifically, **`bodied_v1` means "bodied/running after the V1.1+ activation gate fires," NOT "launch-active at V1"** — the name carries the family-wide semantic but the V1.1+ activation-gate constraint (INV-07-12) means zero experiment entries can use this status at V1.0 lock. This is unlike 07C where `bodied_v1` does indicate a V1-launch-active dashboard (`DASH-OPS-01`), or 07B where `bodied_v1` indicates a V1-bodied KPI measurement (the 6 V1-bodied KPIs). 07D is the most target-state-leaning sub-doc in the family per Parent line 175 \+ line 176, and the `bodied_v1` semantic in 07D's registry reflects that: the status value exists to capture the V1.1+ activation event, not a V1 operational state.

## **9.4 Concurrent-experiment isolation policy**

Per §3 threat 9, every experiment registry entry declares an `isolation_mode`:

* **`exclusive_population`** — no other concurrent experiment may overlap the same user population during this experiment's runtime. The simplest design; appropriate when interaction effects are unknown or untolerable.  
* **`factorial_design_accepted`** — interaction with other concurrent experiments is explicitly modeled. The `conflicting_experiment_ids` field names which other experiments are part of the factorial design and how the design accounts for interaction. Requires more sophisticated statistical handling (factorial ANOVA or equivalent) declared in `statistical_framework_config.override_rationale`.

At V1.1+ activation, P33 audit verifies that any `bodied_v1` experiment has a populated `isolation_mode`; the registry cannot ship a running experiment without the isolation policy declared.

## **9.5 Audit pass P33 `experiment-registry-presence-and-shape`**

07D introduces audit pass **P33** to the family suite: **`experiment-registry-presence-and-shape`** — parallel to 07C's P32. P33 runs at the same cadence as INV-07-12 \+ INV-07-13.

P33 verifies all of these, with hard-fail on any:

1. **Presence:** the `infra/experiment-registry.yaml` file exists and parses as valid YAML.  
2. **Status × activation consistency (mirrors INV-07-12):** every `bodied_v1` entry has `v1_1_activation_check.sustained_5k_mau_confirmed: true` \+ `confirmation_timestamp` populated \+ `confirmation_timestamp` precedes `first_assignment_timestamp`. **(RB-07D-V1-02 expansion:)** every `bodied_v1` entry's `v1_1_activation_check` block also has populated `source_kpi_id` (resolvable in 07B's KPI registry), `evidence_window.calendar_months` (exactly 3 consecutive complete calendar months), `evidence_query_ref` (resolvable to a canonical 07B §9.6 view name), `observed_monthly_values` (exactly 3 numeric values each ≥ activation threshold), `confirmation_artifact_url`, `confirmed_by_admin_id`, and `confirmation_timestamp` postdating the last `evidence_window` month-end.  
3. **Status × KPI-references consistency (mirrors INV-07-13):** every entry's `target_kpi_ids[]` resolves to canonical entries in 07B's `infra/kpi-registry.yaml`; empty `target_kpi_ids[]` hard-fails (an experiment with no primary metric is a registry defect).  
4. **Statistical-framework-config presence \+ override-rationale conformance:** every entry has a populated `statistical_framework_config` block; any field divergent from §6.2 defaults has `override_rationale` populated. **(RB-07D-V1-07 expansion:)** every `bodied_v1` entry's `statistical_framework_config` also has populated `power_analysis_artifact_url` \+ `sample_size_requirement` block (required\_users\_per\_arm \+ expected\_duration\_days \+ assumptions.baseline\_rate \+ assumptions.mde\_relative).  
5. **Concurrent-isolation policy presence:** every `bodied_v1` entry has `concurrent_experiment_isolation_policy.isolation_mode` populated; `factorial_design_accepted` mode has `conflicting_experiment_ids` populated.  
6. **Pre-registration discipline (§6.2):** every `bodied_v1` entry has `hypothesis`, `arm_definitions[]`, `target_kpi_ids[]` populated \+ `last_reviewed_at` predating `first_assignment_timestamp`.  
7. **Target-event-names registry parity:** every entry's `target_event_names[]` resolves to canonical entries in 07A's `infra/event-schema-registry.yaml`.  
8. **Arm-allocation sums to 100:** every entry's `arm_definitions[].allocation_percentage` sums to 100 (no over-allocation, no under-allocation).  
9. **Audience inheritance from 07C INV-07-10:** every entry's `audience` is `internal_team` at V1 (relaxation routes through 07C §7.3 scope-expansion review, not through 07D directly).  
10. **(RB-07D-V1-05 PostHog vendor-state parity):** every `bodied_v1` entry has `posthog_experiment_binding` populated with `posthog_experiment_id` \+ `posthog_feature_flag_key` \+ `vendor_state` ∈ {`draft`, `running`, `paused`, `archived`}. **Additionally, any active PostHog experiment or feature flag with experiment semantics on the PostHog vendor surface that lacks a matching `experiment_id` in `infra/experiment-registry.yaml` hard-fails — registry ↔ vendor parity is bidirectional, same shape as 07C INV-07-10 registry-vs-vendor verification.** At V1.0 lock (zero `bodied_v1` entries), the `posthog_experiment_binding` field may be null on `contract_v1_body_v1_1` and `name_only_stub` entries; the bidirectional vendor-parity check is V1.1+ runtime enforcement when experiments activate.  
11. **(RB-07D-V1-03 override-approval enforcement):** every entry with `v1_1_activation_check.v1_1_activation_criterion_override` that lowers the 5K-MAU floor has all four `override_approvals` fields populated (cto\_approval\_admin\_id \+ legal\_privacy\_approval\_admin\_id \+ power\_analysis\_artifact\_url \+ approval\_rationale). Sub-5K-MAU override without complete approvals hard-fails (mirrors INV-07-12 failure condition (g)).

Total family audit suite becomes **33 passes** at 07D lock (30 inherited from Parent \+ P31 from 07E \+ P32 from 07C \+ P33 from 07D).

---

# **§10 — Experiment-to-KPI-Registry Parity Discipline (INV-07-13)**

**launch\_required: true.** This is the experiment-layer materialization of Decision 5 \+ Parent §3 threat 6 (KPI definition drift) — same role for experiments that 07C INV-07-11 plays for dashboards.

## **10.1 The parity rule**

Every experiment in `infra/experiment-registry.yaml` references one or more `kpi_id`s from Doc 07B's `infra/kpi-registry.yaml` as its `target_kpi_ids[]`. The reference is by `kpi_id` only — never by free-text metric label, never by inline measurement formula, never by ad-hoc arm-conditioned query. The experiment measures its primary \+ secondary metrics by applying the canonical measurement body of each `kpi_id` (as defined in 07B's registry) with arm-conditioning (filter by `experiment_id` \+ `experiment_arm` from §5's event-tagging contract); the experiment does not redefine the measurement.

This mirrors 07C INV-07-11 dashboard-to-KPI parity exactly: 07B's KPI registry is the canonical anti-drift contract for KPI definitions; the experiment registry references it; INV-07-13 is the executable check.

## **10.2 INV-07-13 `ci/experiment-references-kpi-registry`**

Per Parent §6.13:

| Element | Definition |
| ----- | ----- |
| What it proves | Every experiment's `target_kpi_ids[]` resolves to canonical entries in Doc 07B's `infra/kpi-registry.yaml`; no experiment invents a metric name (§3 threats 1, 3); the experiment's primary metric is a canonical KPI, not an ad-hoc query result |
| Execution location | GitHub Actions, on PRs touching `infra/experiment-registry.yaml` or `infra/kpi-registry.yaml`; plus nightly |
| Input | `infra/experiment-registry.yaml` (07D-owned) \+ `infra/kpi-registry.yaml` (Doc 07B-owned) — the KPI registry's set of canonical `kpi_id` values is the resolution target |
| Failure condition | (a) Any experiment entry whose `target_kpi_ids[]` contains a value not present in 07B's KPI registry; (b) any experiment entry with empty `target_kpi_ids[]` (an experiment without a primary metric is a registry defect); (c) any `bodied_v1` experiment whose `target_kpi_ids[]` references any `name_only_stub` KPI from 07B's registry (a running experiment cannot measure a not-yet-bodied KPI — the KPI must body before the experiment can measure against it); (d) any `target_kpi_ids[]` entry that resolves but to a KPI whose `bodied_status` is `name_only_stub` for a `bodied_v1` experiment |
| Proof artifact | `experiment-references-kpi-registry` record per Doc 07 Parent §10.5 envelope \+ extras: `experiments_checked[]`, per-experiment `{experiment_id, target_kpi_ids[], target_kpi_ids_resolved[], target_kpi_ids_unresolved[], status_consistency_check, decision}`. Subject to Doc 06D §8.7. |
| launch\_required | true |

## **10.3 Arm-conditioned KPI computation at V1.1+**

At V1.1+ when experiments activate and the warehouse export is live, experiment-arm metric computation reads from 07B §9.6 Registry-Bound KPI Views Layer by name — same pattern 07C V1.1+ dashboards consume (W-07C-DOC07B-KPI-VIEWS). For a KPI view `lyceon_analytics_models_<env>.kpi_<id>`, the arm-conditioned computation filters by `experiment_id = '<EXP-X>'` AND `experiment_arm = '<arm_name>'` — applying the canonical KPI body to the arm-attributed subpopulation.

The arm-conditioning happens at the consumer (the experiment-analysis query / the experiment-results dashboard / the experiment-management surface's metric panel); it does NOT happen inside the KPI view (the views remain the canonical full-population KPI body per 07B §9.6). This preserves 07B's parity discipline — the KPI view is the canonical body; arm-conditioning is a filter applied downstream — and ensures every experiment is measuring against the same canonical KPI definition.

## **10.4 Tile-level divergence is registry-routed (mirrors 07C §11.4)**

If an experiment legitimately needs a slight variant of a registered KPI as its target metric (e.g., "DAU within the experiment cohort only, excluding users who unenrolled mid-experiment"), the variant is registered in 07B's `infra/kpi-registry.yaml` as a new KPI with its own `kpi_id` — at which point the experiment registry references the new `kpi_id`. Tile-level inline divergence from a registered KPI's body is rejected by INV-07-13. This routes definition-drift through the canonical registry, never letting it accumulate at the experiment layer (same routing as 07C §11.4).

---

# **§11 — Experiment-Management Access Discipline**

**launch\_required: true.** Internal-team-only at V1 inheriting 07C INV-07-10 audience taxonomy; experiment-arm result dashboards register in 07C's dashboard registry.

## **11.1 The inheritance contract**

07D experiments and experiment-arm result surfaces inherit 07C's audience invariant. Specifically:

* **Experiment-management UI access** (who can configure experiments in PostHog's experiments product, who can declare arm allocations, who can confirm V1.1+ activation criteria) — inherits Doc 01 V6.0's role taxonomy via the standard authentication binding; at V1 only **internal team** members can access the experiment-management surface. The PostHog access-control surface (per Doc 07C §6.2 criterion 3 referencing the PostHog vendor docs) enforces this at the vendor layer; 07D V1 declares the access discipline as a contract that the vendor surface satisfies.  
* **Experiment-arm result dashboards** — every experiment-arm result dashboard MUST register in Doc 07C's `infra/dashboard-registry.yaml` with `audience: internal_team`; inherits 07C INV-07-10 enforcement. Out-of-registry experiment-result surfaces are governance violations (§3 threat 2).  
* **Experiment-arm result exports** — inherit Doc 07C §10.3 `external_export_ban` discipline (RB-07C-V1-07 — board export / screenshot / investor-deck reuse / external forwarding NOT permitted at V1 absent §7.3 scope-expansion review). The pattern that 07C extended to its executive scorecard applies identically to experiment-result surfaces, which are an even more obvious external-export risk (experiments are inherently storytelling artifacts that beg for board-deck inclusion).

## **11.2 No new audience invariant — pure inheritance**

Per Decision 5 \+ Karl's Q-07D-4=a (cascade \+ audience inherit, never re-implement), 07D does NOT define a new audience invariant for experiments. The 07C INV-07-10 hard CI gate already enforces internal-team-only at the dashboard layer; experiment-arm dashboards (being dashboards) inherit it automatically. 07D's contribution is the **inheritance contract** (the requirement that experiment-arm result surfaces are dashboards that register in 07C's registry — not parallel infrastructure that bypasses 07C); the enforcement substrate is 07C INV-07-10 \+ audit P32.

## **11.3 Relaxing the audience inheritance (the scope-expansion path)**

If at V1.1+ scope expansion an experiment-arm result surface needs an external audience (e.g., a board-reporting dashboard surfacing the results of a high-strategic-significance experiment), the path is **through 07C §7.3** — privacy-posture re-evaluation \+ 07C INV-07-10 invariant amendment \+ code-review event. 07D does NOT provide a parallel relaxation path; any audience change for an experiment-arm dashboard routes through the 07C-side invariant amendment, not through an experiment-registry override.

This keeps the relaxation path single-owner (07C) — same Decision-5 pattern as cascade ownership (07E) and KPI ownership (07B).

---

# **§12 — Experiment-Arm Cascade \+ Small-Cell Inheritance**

**launch\_required: false (V1 has zero running experiments so no V1 cascade events occur for experiment-arm allocations; V1.1+ experiments inherit the policy when they activate). launch\_required: true for the inheritance contract (§12.1).**

## **12.1 The inheritance contract**

07D experiments do NOT re-implement cascade or small-cell policy. They **inherit** them from 07E \+ 07B \+ 07C (Karl-locked Q-07D-4=a):

* **Cascade obligations** (under-13 hard-delete \+ 13+ pseudonymized retention \+ 12-month-inactivity hard-delete for PII) are owned by Doc 07E V1.0 §7/§10 (referenced, never restated). Experiment-arm allocations stored in PostHog at V1.1+ inherit Doc 07E §7 PostHog-side cascade; experiment-arm allocations \+ arm-attributed events stored in the warehouse at V1.1+ inherit Doc 07B V1.0 §12 partition-bounded BigQuery cascade.  
* **Small-cell / cardinality bucketing** is owned by Doc 07E V1.0 §15 W5 (policy \+ threshold) \+ Doc 07B V1.0 §10.3 (warehouse-side enforcement) (referenced, never restated). Arm-conditioned reports inherit small-cell suppression from upstream models.  
* **Under-13 ML-training-exclusion invariant** is owned by Doc 07E V1.0 §10.6 / §12.5 (referenced, never restated). Experiment-derived data extracts that flow into ML training inherit the under-13 exclusion.

This is the Decision 5 application at the experiment layer: 07D experiments consume cascade \+ small-cell \+ ML-exclusion policies; they do not own or re-implement them. Same pattern as 07C §13 at the dashboard layer.

## **12.2 Experiment-arm allocation \+ cascade**

When an under-13 cascade fires for a user who was assigned to one or more experiments:

* **PostHog-side (V1.1+ feature-flag substrate):** the user's per-person properties (including feature-flag values that resolve to experiment-arm assignments) are deleted as part of 07E §7.3 PostHog-side cascade behavior (referenced, never restated); the arm assignment for that user is no longer queryable in PostHog.  
* **Warehouse-side (V1.1+ BigQuery substrate via 07B §12):** arm-attributed event rows in `fact__event` that carry `experiment_id` \+ `experiment_arm` \+ `analytics_user_id` for the cascaded user — the under-13 path applies partition-bounded hard-delete to rows containing that `analytics_user_id`; arm-attribution properties are deleted along with the user's full event history. For 13+ pseudonymized retention, the Supabase identity bridge severance makes the `analytics_user_id` uninvertible; arm-attribution rows persist but cannot be linked back to the user's identity per Doc 07E §7.3 \+ §5 retention class semantics.

07D does NOT introduce a new cascade mechanism for experiment-arm rows; the existing 07B §12 \+ 07E §7.3 cascades handle them by virtue of arm-attribution being event properties (not a separate substrate). This is what the §12.1 inheritance contract makes executable.

## **12.3 Experiment-arm reports \+ small-cell inheritance**

An experiment-arm report grouped by cohort dimensions (e.g., "arm A retention by exam-date cohort" or "arm B conversion by school") MUST source from a 07B model that already applied min-cell suppression / bucketing per 07B §10.3 (which itself consumes 07E §15 W5's threshold). 07D does NOT apply the suppression at the experiment-report layer; it requires the upstream model to have applied it. Concretely:

* **A V1.1+ experiment-arm dashboard tile grouped by cohort dimensions** reads from `cohort__*` or `trajectory__*` models in 07B's `lyceon_analytics_models_<env>` dataset, arm-conditioned by filter; those models — when bodied V1.1+ — apply the suppression per 07B §10.3. The tile inherits the suppression.  
* **An ad-hoc experiment-result query that groups by cohort dimensions without sourcing from a suppressed model** is a discipline violation. P33 audit pass \+ the upstream-must-suppress contract (§13.3 in 07C precedent) handle this; 07D-side enforcement is via the §11 inheritance requirement (experiment-arm result surfaces are dashboards registered in 07C's registry, inheriting 07C's small-cell discipline by being upstream-sourced).

## **12.4 Experiment-derived ML-training-corpus export inheritance**

If experiment-derived data flows into an ML training corpus (e.g., "labeled arm-conditioned exam outcomes for fine-tuning a recommendation model"), the export inherits the 07E §10.6 / §12.5 ML-training-exclusion invariant — under-13 users are never present in ML training extracts. 07D does NOT re-implement the invariant; it requires that any experiment-side export to ML training is sourced from a 07B model that already applied the under-13 exclusion (the upstream-applies / downstream-inherits pattern at the experiment layer, identical to 07C §13.4 at the dashboard layer).

---

# **§13 — V1 / V1.1+ Mechanisms**

Per Doc 07 Parent §4 \+ Doc 06E §4 convention, every 07D mechanism declares `launch_required: bool` with a V1.1+ trigger criterion for `launch_required: false` mechanisms.

## **13.1 Launch-required (V1) mechanisms**

| Mechanism | Invariant | What it proves | launch\_required |
| ----- | ----- | ----- | ----- |
| `ci/no-v1-experiments` | INV-07-12 | No experiment is `bodied_v1` without sustained-5K-MAU activation confirmed; bodies Parent §3 threat 8 as executable gate (§8.2) | **true** |
| `ci/experiment-references-kpi-registry` | INV-07-13 | Every experiment's `target_kpi_ids[]` resolves to canonical entries in Doc 07B's `infra/kpi-registry.yaml` (§10.2) | **true** |
| Audit pass P33 — `experiment-registry-presence-and-shape` | (audit pass, not invariant) | `infra/experiment-registry.yaml` exists, parses, declares V1 entries; status × activation consistency; status × KPI-references consistency; statistical-framework-config presence \+ override-rationale conformance; concurrent-isolation policy presence; pre-registration discipline; target-event-names registry parity; arm-allocation sums to 100; audience inheritance from 07C INV-07-10 (§9.5) | **true** |
| A/B test event-tagging contract | (spec contract, no invariant body at V1) | The property-extension schema (`experiment_id`, `experiment_arm`, `experiment_assignment_timestamp`) \+ the `assigned_at_first_exposure` discipline \+ the no-new-event-names principle (§5) | **true** (spec contract; V1.1+ implementations satisfy) |
| Statistical-framework contract | (spec contract, no invariant body at V1) | Canonical defaults α=0.05 / β=0.20 / MDE-floor=5% / sequential-correction-required; override-with-rationale path (§6.2 \+ §6.3) | **true** (spec contract; V1.1+ implementations satisfy; registry enforces conformance) |
| Experiment-management surface contract | (spec contract, no invariant body at V1) | PostHog feature flags \+ experiments surface at V1 \+ V1.1+; selection criteria §7.2; Statsig/Optimizely V2+ (§7) | **true** (spec contract) |
| Experiment-arm cascade \+ small-cell inheritance contract | (spec contract, inheritance from 07E/07B/07C, no 07D-owned body) | 07D inherits cascade \+ small-cell \+ ML-exclusion; never re-implements (§12) | **true** (inheritance contract is launch-required; no V1 enforcement events because zero running experiments) |

These seven launch-required items are the V1 contract: the three executable mechanisms (INV-07-12 \+ INV-07-13 \+ P33) \+ the four spec contracts (event-tagging \+ statistical-framework \+ experiment-management-surface \+ cascade/small-cell-inheritance).

## **13.2 Target-state V1.1+ mechanisms**

| Mechanism | What it proves | V1.1+ activation trigger | launch\_required |
| ----- | ----- | ----- | ----- |
| First `bodied_v1` experiment | An experiment activates with sustained-5K-MAU confirmed \+ PostHog configuration complete | Sustained 5K MAU \+ PostHog experiment configured | false |
| Arm-conditioned KPI computation via 07B §9.6 KPI views | V1.1+ experiment-result queries read from `lyceon_analytics_models_<env>.kpi_<id>` views with arm-conditioning (§10.3) | First experiment-result query in production | false |
| Experiment-arm dashboards in 07C's `infra/dashboard-registry.yaml` | Experiment-result surfaces register as dashboards; inherit INV-07-10 \+ INV-07-11 (§11) | First experiment-arm dashboard build | false |
| Experiment-result proof artifact | Small-cell-conditioned per §12.3 \+ Doc 06D §8.7 no-PII rule | First experiment-result publication | false |
| Sequential-testing automation | The chosen experiment-management surface configures sequential-correction per §6.2 | First experiment with peeking-enabled runtime | false |
| V1.1+ experiment-related alerts | Registered in Doc 06C §7 `infra/alert-registry.yaml` (07D V1 produces zero per INV-07-09) | First V1.1+ experiment alert need | false |

Each V1.1+ mechanism's spec (the six-element implemented-definition shape where applicable) is bodied at 07D V1; the runtime body activates per the stated trigger. Same "spec-locked, infrastructure-target-state" framing as the rest of the Doc 07 family.

## **13.3 V1 no-alert reminder (INV-07-09 family-wide)**

Per family invariant INV-07-09 (Doc 07 Parent §6), no V1 Doc 07 mechanism produces an alert. 07D V1 has zero `alert_id` declarations. V1.1+ experiment-related alerts (experiment-arm allocation skew, sequential-test stopping-rule triggered, experiment-end-result-ready notification) register in Doc 06C §7 `infra/alert-registry.yaml` when experiments activate per the standard 06C registration pattern — not in 07D.

## **13.4 Bundled cross-doc additives**

| Additive | Target doc | What it does | Status |
| ----- | ----- | ----- | ----- |
| **W-07-PostHog-BQ** (inherited from Parent \+ 07A \+ 07B \+ 07C) | Doc 06E | PostHog Tier-1 launch-required vendor (the V1 substrate for 07D's experiment-management surface) \+ BigQuery Tier-1 target-state vendor; 07D's V1 \+ V1.1+ experiment-management substrate depends on PostHog's launch-required body | Inherited; deploy-gated; non-blocking for 07D spec lock |
| **W-07B-DOC03C-EXPORT-SUBSTRATE** (inherited from 07B) | Doc 03C | The BigQuery export pipeline that V1.1+ experiment-arm event tagging consumes is the same export pipeline 07B owns | Inherited; deploy-gated; non-blocking |
| **W-07C-V1.1-TOOL-SELECTION** (inherited from 07C) | Doc 06E | The V1.1+ warehouse-backed dashboard tool that experiment-arm dashboards use is the same tool 07C's executive scorecard uses | Inherited; deploy-gated; non-blocking |

**07D introduces zero new bundled cross-doc additives.** This is unique among the Doc 07 sub-docs — every other sub-doc introduced at least one new additive (07A: W-07-PostHog-BQ; 07E: RPOL-ANALYTICS-01/02 \+ RB-06D-V1-19 schema extension; 07B: W-07B-DOC03C-EXPORT-SUBSTRATE \+ the 07B §9.6 in-lock-cycle additive itself; 07C: W-07C-V1.1-TOOL-SELECTION). 07D's zero-new-additive posture is the family's "all dependencies resolved at land" closing posture — every substrate 07D needs already exists in the locked family.

## **13.5 Cross-doc forward-ref resolutions at land**

07D is the family's final sub-doc; it resolves both inherited forward-references at draft:

* **FWD-07B-02** (from Doc 07B V1.0 §17 / §18) — "Doc 07D experimentation analytics consume 07B's event-fact tables for experiment-arm tagging" — **RESOLVED at 07D draft.** §5 specifies the arm-attribution property contract that extends 07A events read into 07B's `fact__event`; §10.3 specifies how V1.1+ experiment-arm metric computation reads from 07B §9.6 KPI views.  
* **FWD-07C-01** (from Doc 07C V1.0 §17 / §18) — "Doc 07D experimentation dashboards consume 07C's dashboard registry as their substrate when 07D drafts" — **RESOLVED at 07D draft.** §11 specifies that experiment-arm result dashboards register in 07C's `infra/dashboard-registry.yaml` with `audience: internal_team`; inherit INV-07-10 \+ INV-07-11 \+ audit P32.

Both resolutions are bounded-and-resolved at this draft, mirroring the 06D ↔ 07E and 07B ↔ 07C precedents. No further forward-references are open in the 07D ← 07B/07C direction.

---

# **§14 — Audit Profile**

## **14.1 Inherited audit suite**

07D inherits the Doc 07 family audit suite — the 30-pass baseline (25 carry-forward from 06E \+ P26-P30 from Doc 07 Parent) — plus P31 (vocabulary-consistency, introduced by Doc 07E per RB-07E-R3-04) \+ P32 (dashboard-registry-presence-and-shape, introduced by Doc 07C per RB-07C-V1-05). 07D introduces **P33 (experiment-registry-presence-and-shape)** per §9.5, bringing the family suite to **33 passes total** at 07D lock.

## **14.2 07D implementation-site passes**

07D is the implementation site for:

* **P27 — KPI canonical-owner-citation parity (inherited; 07B implementation site is canonical, 07D extends).** 07D experiments reference 07B KPI registry entries via `target_kpi_ids[]`; the §10 parity discipline \+ INV-07-13 enforce that every experiment cites canonical `kpi_id` values. P27's 07B-side enforcement covers KPI bodies; 07C extended to dashboard references; 07D extends to experiment references.  
* **P31 — vocabulary-consistency (inherited from 07E).** 07D applies P31's discipline to experiment-layer text: no experiment description claims to surface "anonymized" data (the pseudonymized-vs-anonymized legal distinction holds at the experiment layer too — an experiment-result description that says "anonymized cohort comparison" misrepresents the V1.1+ pseudonymized status per 07E §5.2); no claim that 07D V1 ships "running experiments" (those are V1.1+ per Parent §22 \+ INV-07-12); no V1 alert declarations (INV-07-09).  
* **P32 — dashboard-registry-presence-and-shape (inherited from 07C).** Experiment-arm result dashboards registered in 07C's `infra/dashboard-registry.yaml` are subject to P32; 07D's contribution is the requirement that experiment-arm dashboards register at all (§11), with P32 as the enforcement substrate.  
* **P33 — experiment-registry-presence-and-shape (07D-introduced).** Per §9.5, verifies `infra/experiment-registry.yaml` presence \+ parse \+ V1-entry-shape \+ status × activation consistency \+ status × KPI-references consistency \+ statistical-framework-config presence \+ override-rationale conformance \+ concurrent-isolation policy presence \+ pre-registration discipline \+ target-event-names registry parity \+ arm-allocation sums \+ audience inheritance.

## **14.3 07D-specific audit additions**

Beyond the inherited suite, 07D's audit verifies:

* **DD-07-REDEF defect scan (Decision 5):** no 07D line restates a primitive owned by another doc — no restatement of 07A event definitions, 07B KPI bodies, 07B warehouse table definitions, 07B §9.6 view-naming-convention bodies, 07C dashboard registry shape, 07C INV-07-10 / INV-07-11 bodies, 07E retention/cascade policy, 07E small-cell threshold, 06D registry substrate, 06E vendor cost bodies, 05B mastery formulas, Doc 03 §24 LISA cost tiers, Doc 09 financial formulas, Doc 01 identity model. Any such line is a defect.  
* **Ownership-boundary integrity:** every "07D owns" claim in §2.2 maps to a section that bodies it; every "referenced owner" claim resolves to an exact § in the cited doc.  
* **launch\_required annotation coverage (INV-07-07 family-wide):** every 07D mechanism declares `launch_required: bool`; every `false` resolves to a V1.1+ trigger.  
* **No-V1-alerts (INV-07-09 family-wide):** no 07D V1 mechanism declares an `alert_id`. V1.1+ alerts register in Doc 06C §7.  
* **No-V1-bodied-experiments (INV-07-12 site-specific):** no `bodied_v1` entry in `infra/experiment-registry.yaml` at V1.0 lock (the registry is V1.0-spec-locked; the first `bodied_v1` entry is the V1.1+ activation event).  
* **Experiment-registry parity with KPI registry \+ event registry:** every `kpi_id` in every experiment's `target_kpi_ids[]` resolves to a canonical entry in 07B; every event in `target_event_names[]` resolves to a canonical entry in 07A.  
* **Statistical-framework conformance:** every experiment's `statistical_framework_config` block populated; override-rationale present when divergent from §6.2 defaults.  
* **Forward-ref resolution at land:** FWD-07B-02 \+ FWD-07C-01 marked RESOLVED in §13.5 \+ §16 seam table; no open forward-refs from 07B/07C remain after 07D draft.

## **14.4 Known false-positive class**

Carry-over \+ 07D-specific: doc titles containing flagged words; the §16 cross-doc seam table (cites bodies — required, not restatement); the §9.2 registry-entry-shape pseudocode (specification shape, not body restatement); the §6.2 canonical-defaults table (07D-owned statistical-framework body, not restatement); the §5.1 event-tagging property table (07D-owned property contract); §7 PostHog vendor-name vocabulary (vendor identifier, not primitive-body restatement); the `bodied_v1` / `contract_v1_body_v1_1` / `name_only_stub` status-enum tokens (07C-owned enum inherited by 07D); the `internal_team` audience-enum token (07C-owned enum inherited by 07D); the W-07-PostHog-BQ / W-07B-DOC03C-EXPORT-SUBSTRATE / W-07C-V1.1-TOOL-SELECTION inherited-additive identifiers; the `experiment_id` / `experiment_arm` / `experiment_assignment_timestamp` 07D-owned property names.

---

# **§15 — Acceptance Criteria (Executable-Proof Framed)**

07D V1.0 is acceptable for lock when:

1. **The A/B test event-tagging contract is specified** (§5) — the three arm-attribution properties (`experiment_id`, `experiment_arm`, `experiment_assignment_timestamp`); the no-new-event-names principle (§5.2); the `assigned_at_first_exposure` discipline (§5.3); the PII redaction contract carry-through (§5.4). **launch\_required: true.**  
2. **The statistical-framework contract is specified** (§6) — the §6.2 canonical defaults (α=0.05 / β=0.20 / MDE-floor=5% relative / sequential-correction-required / pre-registration-required); the §6.3 override path with documented rationale; the §6.4 enforcement via registry-conformance. **launch\_required: true.**  
3. **The experiment-management surface contract is specified** (§7) — PostHog feature flags \+ experiments surface at V1 \+ V1.1+; the §7.2 selection criteria PostHog satisfies; the §7.3 V2+ candidate deferral (Statsig/Optimizely per Parent §6 line 215). **launch\_required: true.**  
4. **`ci/no-v1-experiments` (INV-07-12) is specified** (§8) — six-element implemented-definition; bodies Parent §3 threat 8 as executable gate; the sustained-5K-MAU activation criterion with 3-consecutive-month operationalization; the override path (§8.3); the V1.0-lock-posture-zero-bodied (§8.4). **launch\_required: true.**  
5. **The `infra/experiment-registry.yaml` canonical experiment roster is specified** (§9) — entry shape (§9.2) with all required fields; the 3-value status enum inherited from 07C (§9.3); the concurrent-experiment-isolation policy (§9.4); audit pass P33 with the 9 hard-fail conditions (§9.5). **launch\_required: true.**  
6. **`ci/experiment-references-kpi-registry` (INV-07-13) is specified** (§10) — six-element implemented-definition; mirrors 07C INV-07-11 dashboard parity at the experiment layer; arm-conditioned computation reads from 07B §9.6 KPI views at V1.1+ (§10.3); tile-level divergence is registry-routed via new KPI registration (§10.4). **launch\_required: true.**  
7. **The experiment-management access discipline is specified** (§11) — internal-team-only at V1 inheriting 07C INV-07-10; experiment-arm result dashboards register in 07C's `infra/dashboard-registry.yaml`; experiment-arm result exports inherit 07C §10.3 `external_export_ban` discipline; the scope-expansion path routes through 07C §7.3 (no parallel 07D relaxation path). **launch\_required: true.**  
8. **The experiment-arm cascade \+ small-cell inheritance contract is specified** (§12) — 07E §7/§10 cascade \+ 07E §15 W5 small-cell \+ 07E §10.6 ML-exclusion \+ 07B §10.3 warehouse-side enforcement \+ 07B §12 BigQuery cascade — all inherited by reference, never re-implemented. **launch\_required: true (inheritance contract); launch\_required: false (V1 enforcement events because zero running experiments at V1).**  
9. **Every mechanism declares `launch_required: bool`** (INV-07-07 family-wide) with V1.1+ triggers for `false` mechanisms (§13); **no V1 mechanism declares an alert** (INV-07-09 family-wide).  
10. **Decision 5 holds end-to-end** — DD-07-REDEF scan clean: no restatement of 07A event schema / 07B KPI bodies \+ warehouse model definitions \+ §9.6 views / 07C dashboard registry shape \+ INV-07-10 \+ INV-07-11 / 07E retention-cascade policy \+ small-cell threshold \+ ML-exclusion / 06D registry / 06E vendor cost bodies / 05B mastery formula / 03 §24 LISA cost / 03C GCP substrate / Doc 09 financial / Doc 01 identity model (§14.3).  
11. **The audit suite passes** — inherited 30-pass \+ P31 \+ P32 \+ P33; 07D implementation-site P27 \+ P31 \+ P32 \+ P33 explicit; 07D-specific DD-07-REDEF \+ ownership-boundary \+ annotation-coverage \+ no-V1-alerts \+ no-V1-bodied-experiments \+ experiment-registry parity \+ statistical-framework conformance \+ forward-ref resolution clean (§14).  
12. **The cross-doc seam table (§16) is grounded by exact §** — every seam resolves or is explicitly carried as a bounded forward-ref; FWD-07B-02 \+ FWD-07C-01 RESOLVED at land.  
13. **The watch items (§17) are bounded** — all inherited W-07-PostHog-BQ \+ W-07B-DOC03C-EXPORT-SUBSTRATE \+ W-07C-V1.1-TOOL-SELECTION \+ the inherited 07E W7/W9 launch gates are bounded and non-blocking for spec lock; 07D introduces zero new **cross-doc** watch items (RB-07D-V1-08 — 07D-owned registry proof fields per RB-07D-V1-02/03/05/07 are local lock-grade mechanics, not cross-doc watch items).

---

# **§16 — Cross-Doc Seam Table (Grounded by Exact §)**

| Seam | 07D side | Canonical owner | Status |
| ----- | ----- | ----- | ----- |
| 25-event taxonomy (the events arm-attribution properties extend) | §5 event-tagging contract; §9.2 `target_event_names[]` field | Doc 07A V1.0 §5/§6 `infra/event-schema-registry.yaml` | RESOLVED — consumer (referenced, never restated) |
| 07A loose-tier-for-future-properties path | §5.1 arm-attribution properties extend via this path | Doc 07A V1.0 §5.2 | RESOLVED — consumer |
| `analytics_user_id` HMAC contract | §5.4 \+ §12.2 cascade behavior consumes | Doc 07A V1.0 §7 | RESOLVED — consumer |
| Event-time PII redaction contract | §5.4 carry-through unchanged | Doc 07A V1.0 §8 | RESOLVED — consumer |
| `emitEvent` boundary | §5.4 arm-attributed events emitted through it | Doc 07A V1.0 §6 | RESOLVED — consumer |
| 35-KPI canonical roster (the experiments' `target_kpi_ids[]` references) | §10 INV-07-13 parity discipline | Doc 07B V1.0 §9.5 `infra/kpi-registry.yaml` | RESOLVED — consumer (referenced, never restated); **resolves Doc 07B FWD-07B-02** |
| 07B §9.6 Registry-Bound KPI Views Layer (V1.1+ arm-conditioned metric computation reads from) | §10.3 V1.1+ arm-conditioning filter applied at consumer | Doc 07B V1.0 §9.6 | RESOLVED — consumer (W-07C-DOC07B-KPI-VIEWS pattern reused) |
| `fact__event` declared-shape model (V1.1+ arm-attribution properties land here) | §5 \+ §12.2 cascade behavior | Doc 07B V1.0 §9 (declared-shape V1.1+) | RESOLVED — consumer; V1.1+ activation when 07B models body |
| Warehouse-side cascade mechanism (V1.1+ arm-attributed rows inherit) | §12.2 BigQuery cascade inheritance | Doc 07B V1.0 §12 | RESOLVED — consumer |
| Warehouse-side small-cell enforcement | §12.3 arm-arm reports inherit from upstream models | Doc 07B V1.0 §10.3 | RESOLVED — consumer |
| `infra/dashboard-registry.yaml` (experiment-arm dashboards register here) | §11 access discipline \+ dashboards inherit INV-07-10 \+ INV-07-11 | Doc 07C V1.0 §8 | RESOLVED — consumer; **resolves Doc 07C FWD-07C-01** |
| Internal-only audience invariant (experiment-arm dashboards inherit) | §11.1 pure inheritance | Doc 07C V1.0 §7.2 INV-07-10 | RESOLVED — consumer |
| Dashboard-to-KPI-registry parity (experiment-arm dashboards inherit) | §11.1 inheritance | Doc 07C V1.0 §8.4 INV-07-11 | RESOLVED — consumer |
| Audit P32 (dashboard-registry-presence-and-shape; experiment-arm dashboards subject to it) | §14.2 inherited | Doc 07C V1.0 §8.5 | RESOLVED — consumer |
| Audience taxonomy \+ reserved V1.1+ values | §11.3 scope-expansion routes through 07C §7.3 | Doc 07C V1.0 §7.1 \+ §7.3 | RESOLVED — consumer |
| Executive-scorecard external-export-ban pattern | §11.1 experiment-arm result exports inherit | Doc 07C V1.0 §10.3 (RB-07C-V1-07) | RESOLVED — consumer |
| Retention class taxonomy \+ pseudonymized-vs-anonymized legal distinction | §12 \+ §14.2 P31 vocabulary discipline | Doc 07E V1.0 §5 | RESOLVED — consumer |
| Cascade policy (under-13 hard-delete \+ 13+ pseudonymized \+ 12-month-inactivity) | §12.2 experiment-arm allocation \+ cascade | Doc 07E V1.0 §7/§10 | RESOLVED — consumer |
| Under-13 ML-training-exclusion invariant | §12.4 experiment-derived ML-corpus export inheritance | Doc 07E V1.0 §10.6 / §12.5 | RESOLVED — consumer |
| Small-cell / cardinality policy \+ threshold | §12.3 arm-conditioned reports inherit from upstream models | Doc 07E V1.0 §15 W5 (policy \+ threshold) | RESOLVED — consumer |
| PostHog vendor body (V1 \+ V1.1+ experiment-management substrate) | §7 PostHog as the substrate | Doc 06E §7 PostHog subsection (via W-07-PostHog-BQ) | OPEN — bounded (W-07-PostHog-BQ inherited); deploy-gated, non-blocking |
| BigQuery vendor body (V1.1+ warehouse for arm-attributed events) | §10.3 \+ §12.2 V1.1+ consumer | Doc 06E §7 BigQuery subsection (via W-07-PostHog-BQ) | OPEN — bounded; deploy-gated |
| Privacy-incident sub-class | §3 threat 2 — INV-07-12 violations or out-of-registry experiments produce privacy incidents | Doc 06D V1.0 §11 | RESOLVED — consumer |
| No-PII proof-artifact rule | §8.2 \+ §9.5 \+ §10.2 proof artifacts obey it | Doc 06D V1.0 §8.7 | RESOLVED — consumer |
| Alert routing (V1.1+ experiment alerts) | §13.3 V1 owns no alerts; V1.1+ register here | Doc 06C V1.0 §7 `infra/alert-registry.yaml` | RESOLVED — V1.1+ consumer (V1 zero alerts per INV-07-09) |
| Config doctrine (registry locations, cadence defaults) | §9 settings are config-doctrine | Doc 01A V1.0 §3 | RESOLVED — consumer |
| Identity model \+ role taxonomy ("internal team" definition for experiment-management access) | §11.1 access binds to Doc 01 roles | Doc 01 V6.0 | RESOLVED — consumer (referenced, never restated) |
| Financial KPI bodies (V1.1+ experiments measuring revenue impact) | §10 `target_kpi_ids[]` may reference KPI-BIZ-03/04, KPI-OPS-01/02 | Doc 09 (FWD-07-01) | OPEN — bounded forward-ref; resolves when Doc 09 drafts |
| Multi-vertical experiment design | §2.3 out of scope; SAT single-vertical at V1 | Doc 08 (FWD-07-02) | OPEN — bounded forward-ref; resolves when Doc 08 drafts |
| Brand/social-proof experiments | §2.3 out of scope; Doc 10 territory | Doc 10 (FWD-07-03) | OPEN — bounded forward-ref; resolves when Doc 10 drafts |
| LISA cost / cap KPI citations | §10 `target_kpi_ids[]` may reference KPI-TUT-\*/KPI-OPS-03 at V1.1+ when bodied | Doc 03 Main V1.1 §11/§24 | RESOLVED — referenced (cited per project handoff record until Doc 03 Main parsed) |
| GCP orchestration (for export substrate) | inherited via 07B's W-07B-DOC03C-EXPORT-SUBSTRATE | Doc 03C V3.0 (via 07B W-07B-DOC03C-EXPORT-SUBSTRATE) | OPEN — bounded; deploy-gated, non-blocking |
| V1.1+ warehouse-backed dashboard tool (experiment-arm dashboards use same tool 07C scorecard uses) | §11 \+ §13.4 inherited | Doc 07C W-07C-V1.1-TOOL-SELECTION | OPEN — bounded; deploy-gated |

---

# **§17 — Watch Items**

| ID | Item | Status |
| ----- | ----- | ----- |
| **W1** | Doc 03 Main V1.1 §11/§24 LISA cost/cap KPI citations (KPI-TUT-\*/KPI-OPS-03) may surface in experiment `target_kpi_ids[]` at V1.1+ when bodied; recorded as `cited_per_project_handoff_record` until Doc 03 Main is parsed into the audit | Bounded; non-blocking (inherited from 07A/07B/07C W1 pattern) |
| **W2** | Doc 05B §3-§5 mastery KPI citations (KPI-LRN-01/05) may surface in experiment `target_kpi_ids[]` at V1.1+ when bodied | Bounded; non-blocking |
| **W3 / W-07-PostHog-BQ** | Inherited from Parent \+ 07A \+ 07B \+ 07C. PostHog Tier-1 launch-required \+ BigQuery Tier-1 target-state vendor body via RB-06E-V1-15/16. 07D V1 \+ V1.1+ experiment-management substrate depends on PostHog launch-required body; V1.1+ arm-attributed event tagging depends on BigQuery target-state body | Bounded; deploy-gated; non-blocking |
| **W4 / W-07B-DOC03C-EXPORT-SUBSTRATE** | Inherited from 07B. GCP substrate for the V1.1+ BigQuery export pipeline that 07D arm-attributed event tagging consumes | Bounded; non-blocking |
| **W5 / W-07C-V1.1-TOOL-SELECTION** | Inherited from 07C. V1.1+ warehouse-backed dashboard tool selection event; experiment-arm dashboards use the same chosen tool as 07C's executive scorecard body | Bounded; resolves at V1.1+ dashboard-tool selection |
| **W6** | Doc 09 financial unit economics bodies (KPI-BIZ-03/04 \+ KPI-OPS-01/02 via FWD-07-01) may surface in V1.1+ experiment `target_kpi_ids[]` measuring revenue impact | Bounded forward-ref; resolves when Doc 09 drafts |
| **W7 / Parent §3 threat 8 inherited (V1.1+ activation gate)** | Parent §3 threat 8 declares no V1 experiments running; sustained-5K-MAU as V1.1+ activation criterion. 07D bodies as INV-07-12 (§8.2) — hard CI gate at V1. Relaxation requires §8.3 path (per-experiment activation-criterion override with rationale; full invariant removal requires invariant amendment \+ code-review event). | Bounded; non-blocking for V1; the executable gate is the body of the watch item |
| **W8 / Parent W7 inherited (internal-only audience)** | 07C INV-07-10 enforces; 07D inherits per §11. Relaxation routes through 07C §7.3, not through 07D. | Bounded (inherited from 07C); non-blocking |
| **W9** | The 07E W7+W9 launch gates (privacy policy publication \+ legal counsel sign-off) gate production enablement of the pseudonymized-retention path — including experiment-arm allocations stored under pseudonymized retention. 07D inherits this dependency from 07E. | Inherited from 07E; non-blocking for 07D spec lock |

**07D introduces zero new cross-doc watch items (RB-07D-V1-08 clarification).** This is the family's closing posture — every dependency 07D has on substrates not yet activated is captured by an existing watch item inherited from Parent / 07A / 07B / 07C / 07E. The Doc 07 family's full cross-doc watch-item set closes at 07D lock without expansion. **Note:** 07D-owned registry proof fields introduced by R1 cleanup — `v1_1_activation_check` executable proof block (RB-07D-V1-02), `override_approvals` for sub-5K-MAU activation (RB-07D-V1-03), `posthog_experiment_binding` (RB-07D-V1-05), `power_analysis_artifact_url` \+ `sample_size_requirement` (RB-07D-V1-07) — are 07D-owned registry fields enforced by INV-07-12 / INV-07-13 / P33, not cross-doc watch items. They are local lock-grade mechanics for the experiment registry, not pending dependencies on external docs.

---

# **§18 — Change Records**

**CR-07D-01** — Doc 07D V1.0 established. Scope per Doc 07 Parent §5.1 family decomposition \+ line 175 ("Mostly target-state; minimal launch content") \+ line 176 ("A/B test event-tagging contract \+ statistical-framework contract; Substrate registered via W-07-PostHog-BQ; no V1 experiments running") \+ line 34's explicit naming of "A/B test event tagging contract, statistical-framework contract, experiment-management surface contract." Fifth and final sub-doc (Parent → 07A → 07E → 07B → 07C → 07D drafting order). Pre-draft Q\&A locked (Karl decisions): **Q-07D-1=a** — INV-07-12 `ci/no-v1-experiments` hard CI gate bodying Parent §3 threat 8 as executable enforcement with sustained-5K-MAU criterion (3-consecutive-month operationalization); per-experiment activation-criterion override permitted with documented rationale per §8.3; **Q-07D-2=a** — name conservative statistical defaults at V1.0 (α=0.05 / β=0.20 / MDE-floor=5%-relative / sequential-correction-required / pre-registration-required) with documented per-experiment override path; defaults are enforceable via registry-conformance (P33) not by hope; **Q-07D-3=a** — full `infra/experiment-registry.yaml` mirror of 07B/07C registry pattern; 3-value status enum inherited from 07C; `statistical_framework_config` \+ `v1_1_activation_check` \+ `concurrent_experiment_isolation_policy` blocks per entry; **Q-07D-4=a** — explicit cascade \+ small-cell \+ ML-exclusion inheritance from 07E/07B/07C; 07D never re-implements policy; experiment-arm result dashboards register in 07C's registry inheriting INV-07-10; **Q-07D-5=a** — confirm no cleanup register \+ strict Decision-5 \+ introduce P33 `experiment-registry-presence-and-shape` (family suite to 33 passes total) \+ two owned launch-required invariants INV-07-12 \+ INV-07-13. Three 07D-owned launch-required invariants/passes: INV-07-12 \+ INV-07-13 \+ P33. Six V1.1+ mechanisms (§13.2). **Zero new bundled cross-doc additives** (unique among Doc 07 sub-docs — every dependency resolved at land via inherited additives W-07-PostHog-BQ \+ W-07B-DOC03C-EXPORT-SUBSTRATE \+ W-07C-V1.1-TOOL-SELECTION). **Resolves both inherited forward-references at draft:** FWD-07B-02 (Doc 07B → Doc 07D experimentation analytics consuming `fact__event` for arm-attribution) RESOLVED via §5 \+ §10.3; FWD-07C-01 (Doc 07C → Doc 07D experimentation dashboards consuming `infra/dashboard-registry.yaml`) RESOLVED via §11. Grounding verified against locked 07 Parent (line 34 \+ line 175 \+ line 176 \+ §3 threat 8 \+ §22 \+ §6 line 215 \+ W7 \+ Q-07-5=β internal-only constraint), 07A (event registry \+ property-extension via loose-tier path; HMAC contract; PII redaction contract — all referenced, never restated), 07B (35-KPI registry consumed via INV-07-13; §9.6 KPI views layer consumed for V1.1+ arm-conditioned computation; `fact__event` declared-shape consumed for arm-attribution; §10.3 small-cell \+ §12 cascade inherited; FWD-07B-02 resolved), 07C (dashboard registry consumed for experiment-arm result dashboards; INV-07-10 \+ INV-07-11 \+ P32 inherited; §7.3 scope-expansion path is the sole audience-relaxation route; FWD-07C-01 resolved), 07E (cascade policy \+ small-cell W5 \+ ML-exclusion invariant \+ retention class taxonomy — all referenced, never restated; P31 vocabulary discipline applied at experiment layer per §14.2), Doc 06A/06C/06D/06E (substrate \+ alert registry \+ retention registry \+ vendor body via W-07-PostHog-BQ — referenced, never restated), Doc 01 (internal-team membership semantics — referenced, never restated). Inherits the 30-pass family audit \+ P31 \+ P32 \+ introduces P33 for the experiment-registry-presence-and-shape pass (family suite to 33 passes total). Status DRAFT pending external SWE review.

**CR-07D-02** — R1 external SWE review cleanup applied in-lock-cycle (no version bump; status stays DRAFT pending next review). SWE verdict: A-, scope/direction APPROVED, "targeted cleanup pass, not rewrite." 5 BLOCKERs \+ 3 HIGHs resolved as RB-07D-V1-01..08; pre-cleanup alignment locked with Karl (Q-07D-R1-1=a / 2=b / 3=b):

* **RB-07D-V1-01 (BLOCKER):** Kept the inherited family 3-value status enum (`bodied_v1 | contract_v1_body_v1_1 | name_only_stub`) for cross-registry consistency with 07B \+ 07C, per Q-07D-R1-1=a; added doc-local clarifying note in §9.3 explaining that in 07D specifically `bodied_v1` means "bodied/running after the V1.1+ activation gate fires," NOT "launch-active at V1" — unlike 07C where `bodied_v1` does indicate a V1-launch-active dashboard (DASH-OPS-01) and 07B where `bodied_v1` indicates a V1-bodied KPI body. No new enum value introduced (preserves family enum consistency); semantic clarification is doc-local.  
* **RB-07D-V1-02 (BLOCKER):** Made sustained-5K-MAU activation evidence executable. Expanded `v1_1_activation_check` block (§9.2) with 7 proof-source fields: `source_kpi_id` (canonical KPI body, default `KPI-ENG-03`), `evidence_window.calendar_months` (3 consecutive YYYY-MM), `evidence_query_ref` (canonical 07B §9.6 view name), `observed_monthly_values` (3 numeric ≥ threshold), `confirmation_artifact_url`, `confirmed_by_admin_id` (Doc 01 role), `confirmation_timestamp` (must postdate evidence window). Updated INV-07-12 §8.2 six-element table with failure conditions (f) for incomplete proof block and (h) for confirmation-before-evidence-window-end. P33 §9.5 hard-fail \#2 expanded to verify proof fields.  
* **RB-07D-V1-03 (BLOCKER):** Constrained activation-threshold override per Q-07D-R1-2=b (soft floor). Stricter overrides (raise MAU; require 4+ months; add segment requirements) permitted with rationale alone; **looser overrides (sub-5K-MAU) require dual approval** — `override_approvals.cto_approval_admin_id` \+ `override_approvals.legal_privacy_approval_admin_id` \+ `override_approvals.power_analysis_artifact_url` \+ `override_approvals.approval_rationale` — all four fields enforced by INV-07-12 failure condition (g) \+ P33 §9.5 hard-fail \#11. The load-bearing gate cannot be casually weakened; legitimate sub-5K-MAU cases (high-frequency events with abundant samples per user) are channeled through documented dual-approval that creates an audit record.  
* **RB-07D-V1-04 (BLOCKER):** Fixed multi-experiment event-tagging shape per Q-07D-R1-3=b (scalar default \+ explicit factorial opt-in). Default posture: scalar `experiment_id` \+ `experiment_arm` \+ `experiment_assignment_timestamp` properties, enforced by `concurrent_experiment_isolation_policy.isolation_mode: exclusive_population` (the §9.4 field). Factorial designs require explicit `isolation_mode: factorial_design_accepted` \+ `conflicting_experiment_ids[]`, at which point the user's events carry the `experiment_assignments[]` array property INSTEAD of (not in addition to) the scalar properties — schema is one-or-the-other, never mid-event mutation. P33 §9.5 hard-fail \#5 already enforces isolation\_mode presence; the schema-choice discipline added to §5.1.  
* **RB-07D-V1-05 (BLOCKER):** Expanded P33 to verify registry ↔ PostHog vendor-state parity at V1.1+. Added `posthog_experiment_binding` block to §9.2 entry shape with `posthog_experiment_id` \+ `posthog_feature_flag_key` \+ `vendor_state` (∈ {draft, running, paused, archived}; required for `bodied_v1`, null permitted for stub/contract). P33 §9.5 hard-fail \#10 added: bidirectional vendor-parity check — any active PostHog experiment / feature-flag without a matching registry `experiment_id` hard-fails (same shape as 07C INV-07-10 registry-vs-vendor verification per RB-07C-V1-02).  
* **RB-07D-V1-06 (HIGH):** Named canonical sequential-testing defaults per §6.2 \+ added §6.2.1 substrate-driven default selection rule. `posthog_native_sequential` is the canonical default for PostHog-substrate experiments (PostHog's experiments product implements built-in sequential stopping); `obrien_fleming` (alpha-spending boundaries) is the canonical fallback default for non-PostHog/offline analysis. The `sequential_correction` enum is now 5 values: `posthog_native_sequential | obrien_fleming | alpha_spending | bonferroni_by_look | none_if_no_peeking`. Other corrections permitted with documented `override_rationale`.  
* **RB-07D-V1-07 (HIGH):** Added `power_analysis_artifact_url` \+ `sample_size_requirement` block (with `required_users_per_arm` \+ `expected_duration_days` \+ `assumptions.baseline_rate` \+ `assumptions.mde_relative`) to `statistical_framework_config` in §9.2. Required for `bodied_v1` per P33 §9.5 hard-fail \#4 expansion. Closes the gap where the registry locked α/β/MDE but did not require the actual power-analysis artifact proving the experiment design achieves the claimed power at the claimed MDE.  
* **RB-07D-V1-08 (HIGH):** Clarified "zero new watch items" → "zero new **cross-doc** watch items" at §17 \+ §15 AC \#13 \+ §19 closing. 07D-owned registry proof fields introduced by R1 cleanup (`v1_1_activation_check` proof block, `override_approvals` block, `posthog_experiment_binding` block, `power_analysis_artifact_url` \+ `sample_size_requirement` block) are local lock-grade mechanics enforced by INV-07-12 / INV-07-13 / P33; they are NOT cross-doc watch items (no dependency on external docs awaiting resolution).

Status DRAFT pending next SWE review (expected LOCK-CONDITIONAL per the SWE final call after this targeted cleanup).

---

# **§19 — Closing**

Doc 07D V1.0 specifies Lyceon's experimentation framework as a contract: how experiments tag events for arm attribution (via property extension of existing 07A events, never inventing event names), what statistical defaults apply (α=0.05 / β=0.20 / MDE-floor=5% relative / sequential-correction-required / pre-registration-required, with documented per-experiment override path), where experiments are defined and managed (PostHog feature flags \+ experiments surface at V1 \+ V1.1+; specialized tools V2+), when experiments can run (only after sustained-5K-MAU is confirmed per INV-07-12 bodying Parent §3 threat 8), what every experiment must declare in `infra/experiment-registry.yaml` (hypothesis \+ arms \+ target KPIs from 07B's registry \+ statistical-framework-config \+ activation-check \+ concurrent-isolation policy), and how experiment-arm allocations \+ arm-attributed events \+ arm-conditioned reports inherit cascade \+ small-cell \+ ML-exclusion policies owned by 07E \+ 07B \+ 07C (never re-implementing). The three executable mechanisms — INV-07-12 `ci/no-v1-experiments` \+ INV-07-13 `ci/experiment-references-kpi-registry` \+ audit P33 `experiment-registry-presence-and-shape` — make the contract enforceable from V1 lock onward, even though zero experiments run at V1 and the V1.1+ activation event is the first `bodied_v1` registry entry.

Decision 5 holds end-to-end: 07D owns the experimentation contract (event-tagging \+ statistical-framework \+ experiment-management-surface \+ V1.1+-activation invariant \+ experiment registry \+ experiment-to-KPI parity) and references — never restates — the 07A event taxonomy, the 07B KPI registry \+ warehouse models \+ §9.6 views, the 07C dashboard registry \+ audience invariant \+ KPI-reference parity, the 07E retention/cascade policy \+ small-cell threshold \+ ML-exclusion invariant, the 06D registry substrate, the 06E vendor cost bodies, the 05B mastery math, the Doc 03 §24 LISA cost, the Doc 09 financial bodies, and the Doc 01 identity model. The three launch-required executable mechanisms make the contract enforceable from V1 lock onward, even though the running experiments are V1.1+ target-state.

07D is the family's final sub-doc and the family's closing posture: zero new bundled cross-doc additives (every dependency resolved via inherited additives), zero new **cross-doc** watch items (every cross-doc dependency captured by inherited watch items; 07D-owned registry proof fields per R1 cleanup are local lock-grade mechanics enforced by INV-07-12 / INV-07-13 / P33, not cross-doc watch items), and two cross-doc forward-references resolved at draft (Doc 07B FWD-07B-02 \+ Doc 07C FWD-07C-01 both RESOLVED via §5/§10.3/§11). The status transition from DRAFT to LOCKED occurs upon external SWE review \+ clean two-pass re-audit (per Doc 04C / Doc 07A / Doc 07E / Doc 07B / Doc 07C precedent). After 07D lock, the **Doc 07 family lock is complete** — Parent \+ 07A \+ 07E \+ 07B \+ 07C \+ 07D all locked — pending only the bundled cross-doc additive `RB-06E-V1-15/16` (W-07-PostHog-BQ) for PostHog \+ BigQuery vendor registration in Doc 06E, which is a deploy-gate, not a spec-lock-gate.

**End of Doc 07D V1.0 Draft.**

