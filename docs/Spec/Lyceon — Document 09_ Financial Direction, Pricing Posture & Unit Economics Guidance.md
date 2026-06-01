# **Lyceon — Document 09: Financial Direction, Pricing Posture & Unit Economics Guidance**

**Version:** V1.0 **Status:** DIRECTIONAL LOCK-CANDIDATE (pending final SWE R2 cleanup confirmation; transitions on lock to: **LOCKED AS DIRECTIONAL V1 — not contract-grade; sections become contract-grade only as authority gates close**) **Last updated:** 2026-05-31 **Owners:** Founder / CTO review **Governed by:** Doc 00 (Authoritative Platform Directive). **What this document is:** Doc 09 is a **directional document**, not a contract document. It captures Lyceon's intended financial direction — pricing posture, revenue recognition direction, unit economics guidance, cost attribution discipline, Stripe financial-record retention direction — at a pre-launch / pre-accountant / pre-counsel / pre-vendor-verification moment in time. Almost everything in Doc 09 awaits authority-validation before becoming lockable contract: CPA review for revenue recognition, accounting books, and unit-economics metric definitions; legal counsel for retention and under-13 financial-record handling; Stripe API vendor-verification for deletion-and-anonymization paths; operational data for CAC / LTV / churn / contribution margin runtime activation. The one exception is the free-tier mechanics body which Doc 02B V4 §11.4 \+ §13 canonically owns and Doc 09 references; the other near-exception is pricing structure which Stripe canonically owns at runtime and Doc 09 references-as-direction-only (never hardcoded). **The register is "direction with explicit gate-lists," not "lockable specification."** Where Doc 04B locks scoring math and Doc 02B locks runtime engine behavior, Doc 09 captures direction toward future financial behavior — making the direction legible to engineering, founders, future accountant/counsel, and future hires, while explicitly naming what authority and what data must arrive before the direction becomes lockable. **Depends on:** Doc 02B V4 (LOCKED — §11.4 Free Tier \+ §13 Freemium Quota Mechanics; the canonical free-tier mechanics that Doc 09 references for any free-tier financial discussion, never restating); Doc 03 Main V1.1 (canonical LISA cost/cap bodies — §11 usage caps \+ §24 cost-tier discipline; referenced as input to contribution-margin direction, never restated); Doc 06D V1.0 (§9 infra/retention-policy-registry.yaml substrate that future Stripe-retention registration would land against once retention policy locks; §10 compliance-evidence process; §8.7 family-wide no-PII proof-artifact rule); Doc 06E V1.0 (§7 vendor cost bodies \+ §8 composite cost-per-MAU \+ cost-per-paying-subscriber bodies — referenced as the canonical infra-cost owner; KPI-OPS-01/02 cite Doc 06E §8 per Doc 07 Parent §10 KPI roster, NOT Doc 09; §10 substrate-cap discipline; §13 pricing snapshot pattern; Doc 09 consumes Doc 06E §8 composite bodies as inputs to contribution-margin direction, never re-owning them); Doc 07 Parent V1.0 (LOCKED 2026-05-23 — Threat 9 "cost-attribution boundary confusion" is Doc 09's load-bearing seam framing; §10 KPI roster citation pattern — KPI-BIZ-03/04 cite Doc 09, KPI-OPS-01/02 cite Doc 06E §8 — is honored verbatim); Doc 07B V1.0 (LOCKED 2026-05-28 — infra/kpi-registry.yaml is the canonical KPI registry; KPI-BIZ-03 \+ KPI-BIZ-04 currently sit as name\_only\_stub entries citing Doc 09 via FWD-07-01; Doc 09 V1 directional posture does NOT fire the body-additive at V1 lock — the additive becomes "expected to fire when CPA-review \+ cohort-data gates close"; the actual enum is bodied\_v1 | name\_only\_stub per Doc 07B §9.5.2 — Doc 09 does not invent enum values); Doc 07E V1.0 (LOCKED 2026-05-26 — §7.4 Stripe customer records boundary statement; FWD-07E-04 receives directional resolution at Doc 09 V1 \+ full resolution at gate-list closure); Doc 01 V6.0 (identity model — Doc 09's "internal team" \+ "admin" references bind to Doc 01's role taxonomy, never restated; user-deletion lifecycle from Doc 01 V6.0 is the upstream event that the Stripe-side deletion direction in §9.4 responds to); Doc 01A V1.0 (§3 config doctrine for any future Doc 09 config-table parameter — e.g. trial length, refund window, currency conversion source — once those lock past directional). **Forward-references receiving DIRECTIONAL resolution at Doc 09 V1 draft (full resolution awaits gate-list closure per the per-§ gate-lists):** FWD-07-01 (Doc 07 Parent \+ 07B → Doc 09 financial unit economics body — KPI-BIZ-03 \+ KPI-BIZ-04 ONLY; KPI-OPS-01 \+ KPI-OPS-02 remain Doc 06E §8 territory per Doc 07 Parent §10 KPI roster); FWD-07E-04 (Doc 07E §7.4 Stripe customer records boundary); FWD-06-05 (Doc 06E side of the Doc 06E ↔ Doc 09 financial-interpretation boundary). **New Doc 09-originated forward-references:** FWD-09-01 (V1.1+ international pricing direction when geography activates per Doc 08); FWD-09-02 (V1.1+ B2B / enterprise pricing direction when those segments activate per Doc 08); FWD-09-03 (V1.1+ Stripe-side identifier-anonymization-at-deletion path per §9.5 — Stripe API vendor-verification required before path becomes implementable). **Applies to:** the pricing direction (§5 — Stripe is canonical at runtime; Doc 09 references the current tier-structure shape without hardcoding USD amounts; expansion direction toward enterprise / B2B / international / promotional / referral / scholarship tiers flagged as expected future); the revenue recognition direction (§6 — the standard SaaS direction is ratable-over-billing-period with deferred-liability for prepaid tiers, using Stripe's period\_start / period\_end as canonical period boundaries; formal accounting treatment pending CPA review); the unit economics guidance (§7 — KPI-BIZ-03 churn direction \+ KPI-BIZ-04 ARPU direction \+ CAC direction \+ LTV direction \+ contribution margin direction, all referencing standard SaaS canon and citing Lyceon-specific inputs without claiming lockable formula bodies); the cost attribution discipline direction (§8 — the Doc 07 ↔ Doc 09 measure-vs-interpret boundary as input-aggregation direction; LISA cost direction from Doc 03 §24; infra cost consumption direction from Doc 06E §7/§8); the Stripe financial-records retention direction (§9 — conservative 7-year retention policy direction pending legal review; 07E cascade boundary direction; Stripe-side user-deletion direction; V1.1+ identifier-anonymization vendor-verified path direction; under-13 separate-legal-review carve-out); the cross-doc additive obligations Doc 09 is *expected to fire* once gate-lists close (§10 — directional, not V1-fireable); the §11 cross-doc seam table grounded by exact §; the §12 forward-references; the §13 audit profile (Doc 09 inherits the applicable global-counter cross-doc passes that have Doc 09 inputs; introduces NO new audit pass at V1 because no V1 contract-grade rules exist yet to prove); the §14 acceptance criteria (directional — "captures direction credibly \+ names every gate-list before the section becomes lockable"); the §15 watch items; the §16 change records. **Explicitly excludes:** event taxonomy \+ the 07A analytics\_user\_id HMAC contract (Doc 07A owns); the warehouse models \+ KPI registry substrate (Doc 07B owns); the dashboard substrate (Doc 07C owns); the experimentation framework (Doc 07D owns); the analytics retention class taxonomy \+ cascade policy \+ small-cell policy \+ under-13 ML-exclusion invariant (Doc 07E owns); the per-platform infra cost body (Doc 06E §7 owns); the composite cost-per-MAU and cost-per-paying-subscriber bodies (Doc 06E §8 owns per Doc 07 Parent §10 KPI roster — NOT Doc 09); LISA cost/cap bodies (Doc 03 Main §11/§24 owns); free-tier mechanics (Doc 02B V4 §11.4 \+ §13 owns); identity model \+ role taxonomy (Doc 01 V6.0 owns); mastery KPI body math (Doc 05B owns); scoring formula (Doc 04B owns); platform retention registry substrate \+ compliance-gate process (Doc 06D owns); Stripe API runtime behavior — billing-period mechanics, customer/subscription/invoice/charge object lifecycle, deletion API semantics, anonymization API capabilities (**Stripe owns; Doc 09 references Stripe as canonical at runtime and never invents Stripe mechanics**); **specific pricing amounts in USD or any currency** (Stripe production state owns at runtime; Doc 09 references the tier-structure shape without hardcoding magnitudes); formal accounting books and external financial reporting (accountant/CPA owns); tax nexus, taxability, tax filing, remittance obligations (accountant \+ counsel own; Doc 09 covers only the retention of tax-relevant Stripe artifacts at the direction level); legal retention periods as universal compliance floors (counsel owns; Doc 09 captures conservative retention direction as Lyceon's intended posture, not as legal-floor assertion); investor-facing financial metrics as external-reporting policy (CPA \+ founder approval owns; Doc 09 metrics are internal-management guidance until approved); under-13 financial-record-retention treatment (legal-review carve-out; Doc 09 names the direction but explicitly does not assume the 13+ posture covers under-13); Delaware C-corp practices, cap table, founder compensation, board mechanics, tax election specifics, equity grant mechanics, investor reporting practices (out of Doc 09 scope per Q-09-Alignment-11′c; corporate counsel \+ Carta \+ accountant own).

---

# **§1 — What Doc 09 Is**

## **1.1 The directional register**

Doc 09 captures Lyceon's intended financial direction at a pre-launch / pre-accountant / pre-counsel / pre-vendor-verification moment. Almost everything in the document is direction-pending-authority-validation. The directional register is the right one for Doc 09 V1 because Lyceon is:

* Pre-accountant on revenue recognition mechanics, deferred-liability accounting, refund / chargeback / trial / multi-currency treatment, GAAP / IFRS alignment  
* Pre-counsel on financial-record retention periods, under-13 financial-record special-handling, jurisdiction-specific retention overrides, tax-record retention obligations  
* Pre-vendor-verification on Stripe deletion / anonymization API behavior, Stripe customer-object update semantics for historical invoices/receipts, Stripe tax record preservation behavior  
* Pre-operational-data on churn rates, ARPU stability, retention curves, CAC attribution, LTV cohort behavior, gross margin stabilization

Stating these as locked contracts in Doc 09 would overclaim authority Lyceon does not yet have. The directional register lets Doc 09 be a useful artifact today — capturing where Lyceon is steering, making the direction legible to engineering and future hires, naming explicit gates that must close before each piece becomes lockable — without inventing CPA-grade or counsel-grade or vendor-verified content.

The register is roughly the register of Doc 08 (expansion direction, not expansion contract) applied to financial direction. Doc 09 is **shorter and lighter than the Doc 07 family**, **less contract-grade than Doc 04B / Doc 02B**, and **closer in shape to Doc 08 than to those contract docs**.

## **1.2 What Doc 09 directionally captures**

Doc 09 V1 captures:

* **The pricing posture and expansion direction** (§5) — Lyceon's current freemium-plus-three-paid-tiers shape, the discount-ladder direction (longer commitment, larger effective discount), the expansion direction toward enterprise / B2B / international / promotional tiers, and the canonical principle that Stripe owns pricing at runtime and Doc 09 never hardcodes amounts  
* **The revenue recognition direction** (§6) — the standard SaaS direction toward ratable-over-billing-period recognition using Stripe billing-period mechanics, deferred-liability direction for prepaid tiers, refund-handling direction, trial conversion direction; all CPA-gated for formal lock  
* **The unit economics guidance** (§7) — directional formulas for KPI-BIZ-03 churn, KPI-BIZ-04 ARPU, CAC, LTV, contribution margin, drawing from standard SaaS canon (a16z / Bessemer / Bain) and citing Lyceon-specific inputs (Doc 02B free-tier mechanics, Doc 03 §24 LISA cost, Doc 06E §8 composite cost, Doc 07B KPI registry technical surface)  
* **The cost attribution discipline direction** (§8) — the Doc 07 ↔ Doc 09 measure-vs-interpret boundary as directional input-aggregation discipline; how Lyceon expects to compose LISA cost \+ infra cost \+ revenue into contribution-margin reporting; V1.1+ per-feature cost attribution direction  
* **The Stripe financial-records retention direction** (§9) — Lyceon's conservative 7-year retention policy direction (pending counsel review; not asserted as universal legal floor); the 07E cascade boundary direction; the user-deletion-vs-subscription-billing direction; the V1.1+ identifier-anonymization vendor-verified path direction; the under-13 separate-legal-review carve-out

What Doc 09 V1 does NOT do:

* Lock executable invariants (no INV-09-\* at V1 — directional document does not assert executable contract rules)  
* Introduce new audit passes (no P34 at V1 — audit passes prove rules; directional content has no rules to prove)  
* Fire cross-doc additives at V1 lock (the §10 additives become "expected to fire when gate-lists close" rather than V1-fireable)  
* Hardcode prices, retention periods as legal floors, accounting treatment as policy, churn formula as canonical, or any other primitive that authority-validation is pending on

## **1.3 The gate-list discipline**

Every directional section in Doc 09 V1 names a concrete **gate-list** — the set of decisions, verifications, and data-thresholds that must close before that section becomes lockable contract. Gate-lists are the bridge between directional V1 content and future contract-grade V1.1+ content. Sections become lockable contract one at a time, as gates close, not in one big-bang V1 → V1.1+ flip.

The gate-list discipline applies per-section because gates close at different times. CPA review of revenue recognition direction may close before legal review of retention direction; vendor verification of Stripe anonymization may close after both. Each section's lockability proceeds independently.

## **1.4 Finance Authority Hierarchy**

Doc 09 sits inside an authority hierarchy that the directional register makes explicit:

1. **Stripe production state controls actual billing at runtime.** Stripe is the canonical source of truth for what Lyceon charges, when subscriptions renew, when charges fire, what invoices look like, what refunds and chargebacks do operationally. Doc 09 does not duplicate, override, or hardcode anything Stripe owns.  
2. **Accounting books control external financial reporting.** When Lyceon's accountant produces revenue reports, balance sheets, tax filings, or investor-facing financial statements, the accountant's books are canonical. Doc 09 does not duplicate, override, or substitute for accounting books.  
3. **Legal counsel controls legal retention obligations.** When questions arise about jurisdiction-specific retention floors, under-13 financial-record handling, tax-record retention requirements, or GDPR / DPDP / state privacy law application to financial records, counsel is canonical. Doc 09 captures conservative policy direction; it does not assert legal-floor authority.  
4. **Stripe API behavior controls deletion / anonymization / customer-object lifecycle.** When questions arise about which fields are mutable, which records are preserved across customer updates, which artifacts persist across deletion, vendor-verified Stripe API behavior is canonical. Doc 09 captures intended posture; it does not assume Stripe behavior that hasn't been verified.  
5. **Doc 09 controls product / engineering financial direction.** Within the space above the authorities, Doc 09 captures how Lyceon intends to interpret financial signals for product analytics, internal reporting, and engineering implementation. The direction is legible and stable; the formal validation against authorities (1) through (4) is pending.  
6. **Doc 07B controls technical measurement substrate.** KPI registry, warehouse models, event taxonomy. Doc 09 references the technical surface as input to its directional financial bodies; Doc 07B remains canonical for what is measured and how.

This hierarchy is the load-bearing principle of Doc 09\. It explains why almost every assertion in Doc 09 is directional rather than contract: the authorities above Doc 09 (Stripe, accountant, counsel, vendor verification) own the canonical answers; Doc 09 captures what Lyceon expects from them and how Lyceon will integrate their answers when received.

## **1.5 Investor-reporting disclosure rule**

Doc 09 formulas, retention directions, revenue-recognition directions, and unit-economics directions are **internal-management guidance** until reviewed and approved by Lyceon's accountant/CPA \+ founder. Investor-facing financial metrics — fundraising decks, board reports, due-diligence packages, public statements — must NOT cite Doc 09 directly as the source of authority. If a metric in an investor-facing context is grounded in Doc 09 direction, the cite must:

1. Disclose the formula convention (e.g., "free-tier infra cost included in CAC denominator per Lyceon management-accounting convention; not GAAP")  
2. Note the pending authority gates (e.g., "revenue-recognition methodology pending CPA review")  
3. Distinguish management metrics from formal accounting metrics

This rule exists because Doc 09 is directional, not authoritative; using directional metrics as if they were authoritative risks investor / regulator / counterparty miscommunication.

---

# **§2 — Scope & Boundary**

## **2.1 In directional scope**

Doc 09 V1 directionally covers:

* The pricing posture and tier-structure shape, with Stripe as canonical at runtime (§5)  
* The expansion direction toward enterprise / B2B / international / promotional pricing as future tiers (§5)  
* The standard SaaS revenue recognition direction using Stripe period boundaries (§6)  
* The directional unit economics formulas for KPI-BIZ-03 churn, KPI-BIZ-04 ARPU, CAC, LTV, contribution margin (§7)  
* The cost attribution discipline direction (§8)  
* The Stripe financial-records retention direction with explicit conservative-policy-not-legal-floor framing (§9)  
* The Stripe-side user-deletion direction (§9.4) — including the explicit posture that user deletion does NOT leave silent billing active  
* The V1.1+ identifier-anonymization direction pending Stripe API vendor verification (§9.5)  
* The under-13 financial-record special-handling carve-out direction (§9.6)  
* The cross-doc additive obligations Doc 09 is *expected to fire when gate-lists close* (§10 — directional, not V1-fireable)

## **2.2 Ownership boundary table (directional pointers)**

| Concern | Owner | Doc 09 directional reference |
| ----- | ----- | ----- |
| Pricing magnitudes (specific USD/local-currency amounts) | **Stripe production state** | Never in Doc 09 — runtime canonical |
| Pricing tier structure direction | **Doc 09** (directional) \+ Stripe (runtime) | §5 |
| Free-tier mechanics | Doc 02B V4 §11.4 \+ §13 | §5 reference |
| LISA per-user cost \+ cap discipline | Doc 03 Main §11 / §24 | §7 \+ §8 reference |
| Per-platform vendor cost bodies | Doc 06E §7 | §8 reference |
| Composite cost-per-MAU (KPI-OPS-01) | Doc 06E §8 per Doc 07 Parent §10 | §7 \+ §8 reference (consume, do not body) |
| Composite cost-per-paying-subscriber (KPI-OPS-02) | Doc 06E §8 per Doc 07 Parent §10 | §7 \+ §8 reference (consume, do not body) |
| MAU canonical KPI body (KPI-ENG-03) | Doc 07B §9.5.3 | §7 reference |
| KPI registry substrate (infra/kpi-registry.yaml) \+ bodied\_v1 | name\_only\_stub enum | Doc 07B §9.5 | §10 expected-future-additive |
| Stripe API runtime behavior (billing periods, deletion semantics, anonymization capabilities) | **Stripe (vendor)** | §6 \+ §9 reference |
| Revenue recognition formal accounting policy | **Accountant / CPA** | §6 direction pending CPA |
| Legal retention floors per jurisdiction | **Legal counsel** | §9 direction pending counsel |
| Under-13 financial-record handling | **Legal counsel** (separate review path) | §9.6 carve-out direction |
| Tax nexus / taxability / filing / remittance | **Accountant \+ counsel** | Out of scope per §2.3 |
| External financial reporting policy | **Accountant \+ founder** | §1.5 disclosure rule |
| Analytics retention class taxonomy \+ cascade | Doc 07E §5 / §7 | §9 reference (Stripe is OUTSIDE 07E cascade per 07E §7.4) |
| Retention policy registry substrate (infra/retention-policy-registry.yaml) | Doc 06D §9.1 | §10 expected-future-additive |
| Privacy-incident sub-class taxonomy | Doc 06D §11 | §9 reference (incident sub-class extension expected if/when Stripe retention locks) |
| Identity model \+ user-deletion lifecycle | Doc 01 V6.0 | §9.4 reference |
| Config doctrine | Doc 01A V1.0 §3 | §5 reference if/when config primitives lock |
| V1.1+ international pricing direction | Doc 09 future per FWD-09-01 \+ Doc 08 Dimension 2 | §5 \+ §12 |
| V1.1+ B2B / enterprise pricing direction | Doc 09 future per FWD-09-02 \+ Doc 08 Dimension 3 | §5 \+ §12 |

## **2.3 Out of directional scope**

Decision 5 reference discipline applies — Doc 09 references canonical owners; the following are NOT in Doc 09 scope:

* **Specific pricing amounts in any currency.** Stripe is canonical at runtime. Doc 09 captures the tier-structure direction (free \+ N paid tiers; paid tiers differentiated by billing period; discount-ladder direction) without hardcoding amounts. If a reader wants to know "what does Lyceon charge?" the answer is "check Stripe."  
* **The free-tier mechanics body.** Doc 02B V4 §11.4 \+ §13 canonically owns the quota, reset cadence, surface gating, tool availability, and upgrade-reveal-retroactive-mastery discipline. Doc 09 references and never restates.  
* **Stripe API runtime behavior.** Billing-period mechanics, customer/subscription/invoice/charge object lifecycle, deletion API semantics, anonymization API capabilities are Stripe-canonical. Doc 09 references Stripe behavior as direction (the standard direction is X) without claiming verified Stripe behavior; vendor verification is the gate-list item for any direction that depends on specific Stripe API behavior.  
* **Formal accounting books and external financial reporting policy.** CPA \+ founder own. Doc 09 captures direction; the books are canonical when produced.  
* **Legal retention floors as universal compliance assertions.** Counsel owns. Doc 09 captures conservative retention direction as Lyceon's intended posture, framed as "this is what Lyceon currently leans toward" rather than "this is what the law requires."  
* **Under-13 financial-record retention treatment as covered by the 13+ posture.** Doc 09 §9.6 explicitly carves under-13 out for separate legal review; the 13+ direction does NOT auto-apply to under-13 paying users.  
* **Tax mechanics.** Sales tax, VAT, GST, Stripe Tax, nexus, remittance, filing — accountant \+ counsel own. Doc 09 covers only the retention direction for tax-relevant Stripe artifacts; the rest of tax mechanics is out of Doc 09 scope per Doc 08 SWE-suggestion 2\.  
* **Investor-facing financial reporting policy.** Doc 09 is internal-management guidance only per §1.5. Investor-facing context requires CPA \+ founder approval and convention disclosure.  
* **The KPI registry substrate \+ KPI-OPS-01/02 bodies.** Doc 07B \+ Doc 06E own. Doc 09 references; the directional additive to Doc 07B for KPI-BIZ-03/04 fires when gates close, not at V1 lock.  
* **Delaware C-corp practices, cap table, founder compensation, board mechanics, tax election specifics, equity grant mechanics, investor reporting practices.** Corporate counsel \+ Carta \+ accountant \+ bylaws own. Out of Doc 09 scope per Q-09-Alignment Q-11′c.

---

# **§3 — What Could Go Wrong (Directional Risks)**

Doc 09 is directional, not contract; the risks at this stage are less "engineering implementation failures" and more "the document loses utility if it drifts from the actual state of authority validation, or if its directional content is read as contract-grade and acted on as if authorities had validated it." The risks below name the failure modes and the defensive direction Doc 09 takes.

1. **Directional content treated as contract.** The risk is that engineers or founders read Doc 09's directional revenue-recognition / retention / unit-economics content and implement it as if it were CPA-approved or counsel-approved or vendor-verified, when none of those validations have occurred. *Defense:* the §1 framing (this is a directional document, not a contract); per-section "authority gate-list" disclosure; the §1.5 investor-reporting disclosure rule; the explicit "pending \[authority\] review" labeling on every directional section.

2. **Pricing hardcoded into Doc 09 and drifting from Stripe.** The original Doc 09 V1 draft hardcoded the three paid-tier USD amounts and the Stripe-canonical assertion was a footnote. That's the wrong direction. *Defense:* the §1.4 finance authority hierarchy makes Stripe canonical at runtime explicit; §5 describes tier-structure direction without hardcoding amounts; the §11 cross-doc seam table names Stripe as canonical owner of runtime pricing; whoever reads Doc 09 cannot conclude that pricing magnitudes live in Doc 09\.

3. **Cost-attribution boundary confusion (Doc 07 vs Doc 09).** The load-bearing threat from Doc 07 Parent Threat 9 still applies. Doc 07 measures, Doc 09 interprets. KPI-BIZ-03/04 are Doc 09's to direction-body when gates close; KPI-OPS-01/02 stay Doc 06E §8 territory; the boundaries are static. *Defense:* §2.2 ownership table is explicit by exact § citation; §8 cost attribution discipline body; §11 cross-doc seam table.

4. **Authority validation arrives and Doc 09 doesn't get updated.** The risk is that CPA review of revenue recognition lands, but Doc 09's directional §6 stays unchanged — Doc 09 silently drifts behind authoritative reality. *Defense:* the gate-list discipline names the authority each section is pending, so when an authority weighs in there's a clear pointer to the Doc 09 section that should update; the lock posture per Q-A-a says sections become lockable as gates close, with the gate-list serving as the trigger.

5. **The 7-year retention direction interpreted as universal legal floor.** Stating "Lyceon's intended retention is 7 years" could be misread as "the law requires 7 years." That's not what Doc 09 says, but the risk is real. *Defense:* §9.2 explicitly frames 7-year as "Lyceon's conservative policy direction subject to accountant/legal review, with jurisdiction-specific overrides expected"; §9 narrative repeatedly references counsel as the canonical authority for legal floors.

6. **Stripe API behavior assumed without verification.** The risk is that Doc 09's §9 directional content (the "Lyceon expects Stripe to support X" claims about deletion / anonymization / customer-object updates) gets implemented before Stripe API behavior is verified. *Defense:* §9.5 explicitly names Stripe vendor verification as the gate-list item before the identifier-anonymization path becomes implementable; FWD-09-03 carries the vendor-verification gate; the §9.4 user-deletion direction is framed in terms of intended posture (cancel-at-period-end) rather than verified API call sequence.

7. **User deletion leaves active paid subscription silently billing.** The original draft posture (V1: retain subscription, user loses access while still being charged) is unacceptable. *Defense:* §9.4 explicitly directs that Lyceon user deletion stops future renewal; access continues through the current paid period; no silent-billing path exists; immediate cancel with refund is an option where law/support warrants.

8. **Under-13 financial-record handling lumped with 13+ posture.** Doc 07E established under-13 hard-delete-everywhere; financial records may need retention, but PII minimization for under-13 must be more aggressive than 13+. The 13+ retention posture cannot auto-cover under-13. *Defense:* §9.6 explicit carve-out; under-13 financial-record handling is a separate legal-review path; the gate-list for §9.6 is closure of under-13 legal review before the §9.6 direction becomes implementable.

9. **Stripe-side identifier-anonymization assumed possible without vendor proof.** The V1.1+ §9.5 path assumes Lyceon can anonymize Stripe customer PII while preserving financial records. Stripe's actual behavior (whether historical invoices/receipts preserve PII at customer-update time; whether tax records preserve billing address; whether anonymization affects dispute/refund workflows; whether Stripe's own retention systems override Lyceon intent) requires verification. *Defense:* §9.5 explicit Stripe-API-vendor-verification gate-list; FWD-09-03 stays open until the vendor proof closes.

10. **Doc 09 inherits Doc 07-family audit passes that don't apply to financial content.** The original draft claimed inheritance of the 33-pass Doc 07 family suite; some passes are dashboard-specific or experiment-specific and don't have Doc 09 inputs. *Defense:* §13 explicitly lists only the audit passes with Doc 09 inputs as inherited; Doc 09 does NOT introduce P34 at V1 (no contract rules to prove); future contract-grade Doc 09 sections will introduce audit passes as those sections lock.

11. **Free-tier mechanics restated in Doc 09 vs referenced from Doc 02B.** Same risk as in the prior contract-grade draft; the directional register doesn't change the discipline. *Defense:* Decision-5 reference discipline; §5 references Doc 02B by exact §; the directional Doc 09 is even more strict about not restating because directional content has no reason to redundantly carry quota numbers.

12. **CR-07-Parent-03 Delaware C-corp trace re-opened.** Risk that future drafting interprets the Doc 07 Parent line as "Doc 09 V1.1+ must add cap table / 409A / board reporting." *Defense:* §16 CR-09-02 explicitly closes the trace; §2.3 names Delaware C-corp in explicitly-excludes.

---

# **§4 — Authority Validation & Gate-List Discipline**

## **4.1 What "directional with gate-lists" means in practice**

Every §-level directional section in Doc 09 V1 carries an explicit **gate-list** — the concrete authorities, verifications, and data-thresholds that must close before that section becomes lockable contract. The gate-list is the bridge between "Doc 09 V1 directional content" and "Doc 09 V1.1+ contract content."

Gate-list closure is per-section because gates close at different times:

* CPA review of revenue recognition may close before legal review of retention  
* Stripe vendor verification of anonymization may close after both, or never (if Stripe API limitations make the original direction infeasible, the gate closes with a different direction than originally captured)  
* Operational-data gates (3+ months of paying-subscriber data for churn stabilization; retention curves for LTV; marketing-spend attribution for CAC) close on their own timeline based on Lyceon's operational maturity

A gate-list closure does NOT automatically lock the section as contract. The flow is:

1. Gate-list condition closes (e.g., CPA reviews §6 revenue recognition direction and produces an opinion).  
2. Doc 09 in-lock-cycle amendment captures the authority's actual position — which may match the directional content, may refine it, or may differ from it.  
3. The section is upgraded from "directional" to "lockable" only when ALL gates in its gate-list have closed and the captured authority position is consistent with what Doc 09 says.  
4. Subsequent operational implementation references the now-lockable section.

This is the same pattern as Doc 07's spec-locked-but-runtime-V1.1+ framing applied to authority gating instead of infrastructure gating.

## **4.2 The standard gate types**

Doc 09 V1 gate-lists draw from a small set of standard gate types:

* **CPA-review gate** — accountant/CPA review of accounting-mechanics direction (revenue recognition methodology, refund-handling treatment, deferred-liability accounting, trial conversion treatment, multi-currency interpretation, unit-economics metric definitions for external reporting)  
* **Counsel-review gate** — legal counsel review of retention direction, under-13 handling, jurisdiction-specific overrides, tax-record retention obligations  
* **Stripe-vendor-verification gate** — verified Stripe API behavior for deletion mechanics, anonymization capabilities, historical-artifact behavior across customer updates, tax-record preservation  
* **Operational-data gate** — accumulation of enough operational data (paying-subscriber history, retention curves, marketing-spend attribution, cohort behavior, gross margin stabilization) for a metric to be stable rather than noisy  
* **Doc-program gate** — another Lyceon doc locking content Doc 09 depends on (e.g., Doc 02B locking, which already happened; Doc 06E V1.0 locking; Doc 07B V1.0 locking, which already happened)

Each Doc 09 §-level directional section names which gate types apply.

## **4.3 What gate-list closure means for cross-doc additives**

The original Doc 09 V1 draft fired two cross-doc additives at V1 lock — one to Doc 07B infra/kpi-registry.yaml (bodying KPI-BIZ-03 \+ KPI-BIZ-04) and one to Doc 06D infra/retention-policy-registry.yaml (registering Stripe financial-records retention class). In the directional reframe, these additives are NOT fired at V1 lock because the underlying content isn't lockable yet:

* The Doc 07B KPI body additive depends on the §7 unit-economics direction stabilizing (CPA review \+ cohort-data gate-list closure for KPI-BIZ-03 churn formula; CPA review \+ ARPU-denominator decision for KPI-BIZ-04)  
* The Doc 06D retention-class additive depends on §9 retention direction locking (counsel-review gate-list closure)

The additives become **expected-to-fire-when-gates-close** rather than V1-fireable. Doc 09 V1 names them in §10 as expected future obligations; they fire as the corresponding §-level sections lock.

This means the locked-corpus forward-references FWD-07-01, FWD-07E-04, FWD-06-05 receive **directional resolution at Doc 09 V1** (Doc 09 captures the direction for each) but **full resolution awaits gate-list closure** (the cross-doc additive doesn't fire until the directional content becomes lockable).

---

# **§5 — Pricing Direction**

## **5.1 The pricing posture principle**

**Stripe is canonical for runtime pricing.** Pricing magnitudes — specific USD or local-currency amounts charged per tier, per period, in each market — live in Stripe and are pulled from Stripe at runtime. Doc 09 NEVER hardcodes pricing magnitudes. Anywhere a reader wants to know "what does Lyceon currently charge?" the answer is "check Stripe."

This discipline is structurally identical to Doc 09's treatment of:

* Doc 02B as canonical for free-tier mechanics (Doc 09 references; never restates the quota count or reset cadence)  
* Doc 03 §24 as canonical for LISA cost tier values (Doc 09 references; never restates the cap rates)  
* Doc 06E §7 as canonical for vendor cost rates (Doc 09 references; never restates rates)  
* Doc 07B §9.5 as canonical for KPI registry shape (Doc 09 references; never restates entry shapes)

Stripe is one more canonical owner in the same pattern, owning the pricing magnitudes that Doc 09 references but does not restate. The advantages of treating Stripe as canonical at runtime:

* Pricing changes happen in Stripe without firing a Doc 09 amendment cycle  
* The doc cannot drift from the live billing surface  
* New tiers added in Stripe (enterprise / B2B / promotional) automatically become operational without Doc 09 needing to be amended to "permit" them  
* The reader has one clear pointer to ground truth

## **5.2 The current tier-structure direction**

Lyceon's V1 pricing posture is a **freemium-plus-three-paid-tiers shape**:

* **One free tier**, with mechanics per Doc 02B V4 §11.4 \+ §13 (canonical free-tier specification; Doc 09 references and does not restate the quota, reset cadence, surface gating, or upgrade-reveal-retroactive-mastery direction)  
* **Three paid tiers**, differentiated by billing period:  
  * A short-period tier (monthly billing)  
  * A medium-period tier (multi-month billing)  
  * A long-period tier (annual billing)

The paid tiers deliver the same product (full premium access per Doc 02B V4 §11.4 right column); the differentiation is billing-period commitment. The pricing magnitudes for each tier are Stripe-configured at runtime.

## **5.3 The discount-ladder direction**

The paid-tier shape follows a **longer-commitment-larger-effective-discount ladder**: the longer the billing period, the larger the effective per-month discount versus the shortest billing period. This is a standard SaaS conversion-incentive structure — higher commitment trades against a larger discount, and the lower-churn pattern that longer commitments naturally produce makes the discount sustainable.

The specific discount magnitudes per tier are Stripe-configured (not Doc 09-bodied). The directional shape is what Doc 09 captures: monthly billing establishes the headline rate; multi-month delivers a meaningful effective-monthly discount; annual delivers the largest effective-monthly discount.

## **5.4 The expansion direction**

The current freemium-plus-three-paid-tiers shape is a V1 starting point, not a permanent ceiling. Lyceon expects to expand pricing structure as the business activates new segments and geographies. Expected expansion directions:

* **Enterprise tier** — for institutional buyers (school districts, large tutoring services, multi-year district contracts). Likely per-seat or per-school or volume-tiered pricing distinct from the consumer freemium ladder. Doc 08 Dimension 3 names B2B as an expected expansion direction; the enterprise tier is the financial layer of that strategic direction.  
* **B2B / institutional tiers** — separate from enterprise; smaller-scale institutional buyers (individual tutors, after-school programs, test-prep counseling centers). Pricing structures may differ from both consumer and enterprise.  
* **International pricing tiers** — when geography expansion per Doc 08 Dimension 2 activates substantively, local-currency tier pricing per market becomes a new direction. May or may not be PPP-adjusted; may include market-specific tax handling (Stripe Tax activation); may include market-specific compliance overhead.  
* **Promotional / referral / scholarship tiers** — discount codes, referral discounts, scholarship pricing for equity-access programs. Stripe supports promotional pricing as a first-class mechanism; Lyceon may activate as growth/conversion experiments warrant.  
* **Multi-currency tiers** — when international pricing activates, Stripe supports charging in local currencies. The revenue-recognition direction in §6 will need a multi-currency extension at that point.

All of these are **future Stripe-configured tiers**. Doc 09 names the expansion direction; the specific implementations land in Stripe (and in Doc 09 directional amendments as each activates).

## **5.5 Trial mechanics direction**

Per Q-09-Alignment-Q2-a, **V1 trial posture is Trial-A (no trial)**. The free tier per Doc 02B V4 §11.4 is the conversion surface — users sample Lyceon's quality through the freemium experience, then upgrade to a paid tier when ready. Trial-A is the simplest V1 posture (day-1 charge on subscription start; minimal billing-flow complexity) and matches Lyceon's freemium thesis per Doc 02B §11.5.

Future trial direction expansion is possible (a free-trial-with-card-on-file Trial-B model is a common standard SaaS conversion-optimization variant); if activated, it lands as a Doc 09 directional amendment plus Stripe configuration.

## **5.6 Refund policy direction**

The standard SaaS direction for D2C subscription refunds is a **short satisfaction-guarantee window** on initial subscription charges (commonly 7-14 days), with renewal charges handled discretionarily at vendor support's discretion. Lyceon's directional posture matches:

* **A short refund window** on initial subscription charges (the specific window length is a product/support decision; Stripe-configured if implemented as a fixed policy)  
* **Full refund within the window** (partial / pro-rated refunds add billing complexity without clear customer benefit at Lyceon's stage)  
* **Renewal charges handled case-by-case** (not a contractual entitlement; vendor support discretion)  
* **Refund triggers subscription cancellation and entitlement revocation** — see §5.8 subscription-state-lifecycle direction; refunds do not leave a user with access while the subscription is reversed

The exact refund window, the exact cancellation timing, and the exact entitlement-revocation behavior are operational decisions pending Stripe configuration and support policy. International markets may require different windows (EU's 14-day distance-selling withdrawal right is a known consideration when geography activates).

## **5.7 Proration direction**

The standard SaaS direction for mid-cycle tier changes is proration (Stripe supports first-class proration on subscription updates). Lyceon's V1 directional posture is **no mid-cycle tier changes** — users may cancel their current subscription and resubscribe at a different tier rather than upgrading/downgrading mid-period. This is the simplest V1 posture; future activation of mid-cycle proration is a Stripe-configuration decision plus product UX decision.

## **5.8 Subscription state lifecycle direction**

The directional posture for subscription state transitions and corresponding entitlement / revenue handling:

| Trigger | Subscription state direction | Entitlement direction | Revenue recognition direction |
| ----- | ----- | ----- | ----- |
| Initial subscription start | active | granted | begins ratable recognition per §6 |
| Successful renewal | active continues | retained | starts new ratable period |
| User cancellation (no refund) | cancels at period end (Stripe cancel\_at\_period\_end) | retained through period\_end | continues ratable through period\_end; no new period starts |
| User cancellation \+ refund request within window | cancels immediately | revoked immediately | reverses recognized revenue per §6 refund direction |
| Failed payment | enters past\_due | grace-period N days, then suspended | recognition pauses pending resolution |
| Chargeback opened | enters dispute state | suspended pending review | recognition pauses pending resolution |
| User account deletion (Lyceon-side) | cancels at period end per §9.4 | retained through period\_end | continues ratable through period\_end; no silent billing per §9.4 |

The specific values (grace-period N days; refund-window exact length; dispute-review duration; period\_end vs immediate cancellation thresholds) are operational decisions pending support policy and Stripe configuration. Doc 09 captures the directional shape; the exact magnitudes lock per their respective gates.

## **5.9 Pricing direction gate-list**

Doc 09 captures the current tier-shape direction (freemium-plus-three-paid-tiers). If Stripe production state later adds, removes, or renames tiers (enterprise tier activates per §5.4; international per-market tiers activate per FWD-09-01; promotional / referral / scholarship tiers activate; the consumer ladder shape changes), **Stripe remains runtime-canonical and Doc 09 must be directionally amended in the next doc cycle** to capture the updated tier-shape direction. This extends the §5.1 Stripe-canonical principle: Stripe controls not just pricing magnitudes but also tier-shape evolution; Doc 09's role is to capture the directional shape at each lock cycle without becoming the source-of-truth for what tiers exist.

For §5 (pricing direction) to become lockable contract:

| Gate | Description |
| ----- | ----- |
| **Stripe-configuration gate** | The Stripe billing surface fully reflects Lyceon's intended pricing structure (free \+ three paid tiers; intended discount ladder; intended refund/cancellation/proration handling). This gate is already substantially closed at V1 draft per Karl 2026-05-31 — pricing is shipped through Stripe and connected to the frontend repo. |
| **Support-policy gate** | Lyceon support policy explicitly documented for refund-window length, renewal-refund discretion, mid-cycle change handling, chargeback response. Pending. |
| **CPA-review gate** | Accountant review of pricing structure's revenue-recognition implications (does the discount-ladder structure introduce any non-standard revenue-rec issues? does the refund-window length interact with revenue rec in unexpected ways?). Pending. |
| **Counsel-review gate (for international/B2B/under-13 paid)** | When V1.1+ expansion to international markets, B2B, or under-13 paying users activates, counsel review of jurisdiction-specific pricing implications (EU distance-selling, FERPA for B2B/educational, COPPA for under-13). Per-segment gate; not blocking V1 directional content. |

---

# **§6 — Revenue Recognition Direction**

## **6.1 The standard SaaS direction**

The standard SaaS direction for subscription revenue recognition is **ratable recognition over the billing period as the service obligation is satisfied**. The principle is auditable in concept: at any point in time, recognized revenue equals the sum across active subscriptions of (charge amount × fraction-of-billing-period-elapsed); deferred liability (the portion of prepaid revenue not yet recognized) is the complement. The ratable approach reflects that the customer paid for access to the service over the period, not for specific units of usage; recognition is linear over time rather than usage-weighted.

This direction aligns with ASC 606 (US GAAP) and IFRS 15 (international) at the conceptual level — ratable recognition is the standard treatment for subscription services where the performance obligation is delivered over time. **The formal accounting treatment is CPA-owned**; Doc 09 captures the direction Lyceon expects to steer toward, not an asserted GAAP/IFRS compliance claim.

## **6.2 Billing period boundaries — Stripe canonical**

The standard SaaS direction uses the vendor's billing period boundaries as canonical, not hardcoded calendar approximations. For Lyceon, **Stripe period\_start / period\_end on subscription objects \+ invoice objects are the canonical billing-period boundaries**, not hardcoded 30 / 90 / 365 day approximations. Calendar months vary; annual periods may include leap years; trials, billing-cycle anchors, cancellations, and renewals can alter period boundaries. The directional recognition formula uses elapsed-seconds-over-total-seconds against Stripe's actual period fields:

recognized\_revenue\_for\_charge\_at\_time\_T \=  
  charge\_amount × (T \- period\_start\_in\_seconds) / (period\_end\_in\_seconds \- period\_start\_in\_seconds)

This is direction, not contract — the exact implementation (which Stripe field is used; how mid-period subscription updates are handled; how trial conversions affect period\_start; how renewal events start new periods) requires Stripe API verification and CPA review of the methodology before becoming lockable.

## **6.3 Per-billing-mode recognition direction**

For Lyceon's V1 freemium-plus-three-paid-tiers shape, the directional recognition pattern per billing mode:

* **Monthly billing direction** — each renewal charge starts a new ratable period from charge date to the next renewal. Recognition is linear over the period.  
* **Multi-month (prepaid) billing direction** — each charge starts a new ratable period over the prepaid duration. The unrecognized portion is **deferred revenue liability** (standard accounting concept) that burns down linearly as the period elapses.  
* **Annual (prepaid) billing direction** — same shape as multi-month, with the deferred-liability schedule running over the annual period.

The specific deferred-liability accounting treatment (which liability account; how the burn-down is recorded; how multi-currency revaluation interacts with deferred liabilities; how refunds within or outside the recognition window reverse deferred liability vs recognized revenue) is **CPA-owned**.

## **6.4 Trial-to-paid recognition direction**

Per Q-09-Alignment-Q2-a, V1 trial posture is no-trial (Trial-A); §6.4 is not directionally active at V1. If Trial-B (free trial with card-on-file) activates at V1.1+, the standard SaaS direction is recognition begins at the first charge date (post-trial), not at trial-signup date. The trial period itself produces no recognized revenue.

## **6.5 Refund-handling recognition direction**

The standard SaaS direction for refunds within a satisfaction-guarantee window is **retroactive revenue reversal** — refunds within the window reverse the recognized revenue from the original recognition period; refunds outside the window are netted in the current period as a revenue reduction. The reasoning is that within-window refunds are functionally a form of variable consideration (the customer's right to refund means the original recognition was provisional); outside-window refunds are discretionary commercial decisions and don't carry the same retroactive treatment.

**This is the standard SaaS direction; the exact accounting treatment is CPA-owned.** ASC 606 / IFRS 15 variable-consideration treatment specifics, the choice of refund accrual vs case-by-case treatment, and the interaction with refund reserves are all CPA decisions.

## **6.6 Cancellation recognition direction**

Cancellation (stop future billing, keep current paid-period access) directionally does NOT trigger revenue recognition adjustment — the current paid period's recognition continues through period\_end; the absence of next renewal simply means no new ratable period starts. This is the standard treatment.

## **6.7 Multi-currency direction (V1.1+ per FWD-09-01)**

V1 is USD-only (international users pay in USD at Stripe-configured tier rates; foreign-card-to-USD conversion happens at the customer's card-issuing bank; Lyceon receives USD). When V1.1+ international pricing activates per Doc 08 Dimension 2, the multi-currency revenue recognition direction needs to specify: transaction-time fx rate vs period-end fx rate vs Stripe-default treatment. This is a CPA decision that locks at the time international pricing activates, not at Doc 09 V1.

## **6.8 Revenue recognition gate-list**

For §6 (revenue recognition direction) to become lockable contract:

| Gate | Description |
| ----- | ----- |
| **CPA-review gate** | Accountant review of: ratable recognition methodology; per-billing-mode treatment; deferred-liability accounting for prepaid tiers; refund-handling retroactive-vs-netted methodology; trial-to-paid recognition timing if Trial-B activates; multi-currency interpretation when international activates; ASC 606 / IFRS 15 alignment verification. **Until this gate closes, §6 is intended-management-accounting-direction, not external-reporting policy. (New lock blocker tag: RB-09-CPA-01.)** |
| **Stripe-API-verification gate** | Verified Stripe API behavior for period\_start / period\_end semantics across initial / renewal / trial / cancellation / refund / multi-currency contexts. Pending Stripe documentation review \+ implementation testing. |
| **Operational-implementation gate** | Engineering implementation of the recognition mechanism (reading Stripe events; computing elapsed-seconds-over-total-seconds; producing recognition reports). Pending engineering work. |
| **External-reporting gate** | Founder \+ CPA approval before Doc 09 §6 direction is used as the basis of any external financial reporting (investor decks, board reports, due diligence). Per §1.5 disclosure rule. |

---

# **§7 — Unit Economics Guidance**

## **7.1 The unit economics direction principle**

Lyceon's unit economics direction draws from the **canonical SaaS metric definitions** — a16z SaaS metrics canon, Bessemer Venture Partners' SaaS metric definitions, Bain SaaS playbook — and applies them to Lyceon-specific inputs. Doc 09 does not invent novel financial formulas; the directional formulas in §7 cite canonical SaaS sources as the formula source and identify Lyceon-specific inputs each formula consumes.

This approach has the virtues that **directional industry-standard formulas** are recognizable to investors, board members, future hires, and finance professionals without re-derivation; the **formula direction is auditable in concept** by checking the cited canonical SaaS source. The formulas are **directional** because Lyceon is pre-operational-data on most of the inputs (no stable churn rate, no retention curves, no marketing-spend attribution at meaningful scale) and pre-CPA-review on metric definitions for external reporting. The §7 bodies become lockable as the relevant gates close per-metric.

## **7.2 KPI-BIZ-03 — churn\_rate\_monthly direction**

**Standard SaaS direction.** Monthly churn rate is the percentage of paying subscribers active at the start of a calendar month who lose paying status during the month:

churn\_rate\_monthly direction \=  
  paying\_subscribers\_whose\_entitlement\_ended\_in\_month / paying\_subscribers\_at\_month\_start

**Lyceon-specific timing direction.** For Lyceon's freemium-plus-three-paid-tiers shape with prepaid 3-month and annual tiers, the "entitlement ended" event must be defined carefully. The directional posture is **entitlement-end-based**, not cancellation-request-based:

* A user cancels their annual renewal in month 3 of the 12-month period; they retain paying entitlement through month 12 (period\_end). Churn is counted at month 12, not month 3\.  
* A user fails payment in month 5 of a monthly subscription and enters past\_due → suspended → eventually entitlement\_ended after grace period exhaustion. Churn is counted at entitlement\_end, not at payment failure.

This direction matches the standard SaaS convention that logo churn measures paying-entitlement-ended-in-month, not cancellation-request-in-month — the user is still a paying subscriber until their paid period actually ends. **The exact entitlement-end semantics are CPA-gated** for external reporting.

**Granularity direction.** Monthly per calendar month; overall \+ tier-breakdown (per-tier churn rates will differ structurally because longer commitment tiers have less-frequent renewal events).

**Lyceon SAT-specific seasonality direction.** SAT prep has a structural seasonality consideration: students typically engage during a finite period before their target test date, then naturally "churn" after the test is taken regardless of product quality. This is **planned churn**, not failure churn. The directional posture for §7.2 is to report monthly churn as the headline metric but distinguish planned-post-test churn from genuine-product-failure churn once cohort analysis becomes available. This is a V1.1+ refinement; the V1 directional formula treats all churn the same.

**Inputs and dependencies:**

* Stripe subscription event stream as the source-of-truth for subscription state transitions  
* Doc 07A §5/§6 event taxonomy \+ Doc 07B warehouse export when V1.1+ activates per W-07-PostHog-BQ  
* The active-vs-entitlement-ended state distinction in Stripe subscription objects

**§7.2 gate-list:**

| Gate | Description |
| ----- | ----- |
| **CPA-review gate** | Accountant review of entitlement-end-based vs cancellation-request-based timing for external-reporting consistency |
| **Cohort-data gate** | At least 3 consecutive complete calendar months with at least 1,000 paying subscribers per month for the metric to be statistically stable |
| **Operational-data gate** | Stripe event stream available \+ warehouse export V1.1+ active per Doc 07B |
| **SAT-seasonality gate** | Cohort analysis available distinguishing planned-post-test churn from genuine churn (V1.1+ enhancement) |

**Expected-future Doc 07B additive.** When the §7.2 gate-list closes and the formula body is lockable, an additive to Doc 07B infra/kpi-registry.yaml bodies the KPI-BIZ-03 entry's measurement\_body field from null to the lockable body, using Doc 07B's actual bodied\_v1 | name\_only\_stub enum convention with bodied\_v1 (matching the schema) AND meeting RB-07B-V1-06's exact-filter requirement (source\_event\_names from Doc 07A registry, window\_semantics, dedup\_key, grain). This additive does NOT fire at Doc 09 V1 lock; it fires when the §7.2 gates close.

## **7.3 KPI-BIZ-04 — revenue\_per\_paying\_user direction**

**Standard SaaS direction.** Revenue per paying user (often called ARPU or ARPPU when computed paying-user-only):

revenue\_per\_paying\_user\_monthly direction \=  
  recognized\_revenue\_in\_month / paying\_user\_months\_in\_month

**Denominator direction — paying-user-months, not distinct-users-active.** The standard SaaS direction for the ARPU denominator is **paying-user-months** (the sum of fractional paid-access in the month, normalized to a full-month-equivalent count) rather than distinct-paying-users-active-at-any-point-in-month. The reason is **alignment with ratable revenue recognition** — if a user has 5 days of paid access in a 30-day month, they contribute 5/30 of a paying-user-month, matching how they contribute 5/30 of their charge to recognized revenue. Distinct-user-counting would understate ARPU for short-tenure subscribers.

paying\_user\_months\_in\_month \=  
  sum across all paying users of (days\_with\_paid\_access\_in\_month / days\_in\_month)

**Lyceon-specific framing.** Free users are excluded from the denominator (the metric is paying-only); this is consistent with standard SaaS ARPPU convention. Including free users in the denominator dilutes the metric in a way that obscures rather than reveals at Lyceon's stage.

**Tier breakdown direction.** Reported overall AND broken down by tier; tier-mix shift affects blended ARPU substantially (converting Monthly subscribers to Annual lowers ARPU per month but raises LTV substantially, so contribution-margin direction per §7.6 improves).

**§7.3 gate-list:**

| Gate | Description |
| ----- | ----- |
| **CPA-review gate** | Accountant review of paying-user-months denominator methodology for external-reporting consistency; choice between alternative ARPU conventions (paying-user-months vs distinct-paying vs average-daily-paying-subscribers — all defensible standard SaaS conventions) |
| **Operational-data gate** | At least 1 full calendar month of paying-subscriber data with the recognition mechanism per §6 operational |
| **Stripe-API \+ warehouse gate** | Per §7.2 gate |

**Expected-future Doc 07B additive.** Same shape as §7.2 additive; fires when §7.3 gates close.

## **7.4 CAC — Customer Acquisition Cost direction**

**Standard SaaS direction.** CAC is the average cost to acquire one new paying customer:

CAC direction \=  
  total\_acquisition\_spend\_in\_period / new\_paying\_customers\_in\_period

Standard inputs to total\_acquisition\_spend: paid marketing, sales spend, organic content production costs, partnership / affiliate payouts.

**Lyceon-specific direction — free-tier infra cost as acquisition input.** Lyceon's free tier is strategically a conversion funnel per Doc 02B V4 §11.5 freemium thesis; its design intent is to drive paid conversion rather than to be a standalone product. The directional posture is to **allocate free-tier infrastructure cost (Doc 06E §8 KPI-OPS-01 cost\_per\_mau × free-user-MAU-share) to acquisition spend** rather than to gross margin.

**This is a Lyceon management-accounting convention, not GAAP and not standard SaaS truth.** Some SaaS companies treat free-tier infra cost as cost-of-revenue (rolled into gross margin); some treat it as acquisition spend; both are defensible accounting conventions and the choice depends on whether the free tier is a conversion engine (Lyceon's framing) or a separate product offering. The directional posture is the conversion-engine framing.

**Disclosure requirement (per §1.5).** Any external-reporting use of CAC must disclose whether free-tier infra cost is included in the denominator. Investor-facing CAC reports comparing Lyceon to other SaaS companies must call out this convention explicitly because peer companies may not include the equivalent cost.

**§7.4 gate-list:**

| Gate | Description |
| ----- | ----- |
| **CPA-review gate** | Accountant review of free-tier-infra-cost-as-acquisition convention; choice between management-accounting CAC and GAAP CAC for different reporting contexts |
| **Marketing-attribution gate** | Marketing-spend attribution data available at meaningful scale (paid acquisition channels distinguishing brand vs direct vs paid social, etc.) |
| **Cohort-data gate** | At least 3 consecutive months of attributable marketing spend AND at least 100 new paying customers per month for per-channel attribution to stabilize |
| **External-reporting gate** | Per §1.5 — disclosure of convention required before external use |

CAC is NOT registered in the Doc 07 Parent §10 KPI roster (the BIZ category includes BIZ-01 trial\_to\_paid, BIZ-02 paid\_signup\_count, BIZ-03 churn\_rate\_monthly, BIZ-04 revenue\_per\_paying\_user; CAC is not registered). Doc 09 owns CAC as a directional financial metric without a corresponding KPI registry entry. If operational practice surfaces a need to register CAC in the KPI registry, that fires a Doc 07B additive at that time.

## **7.5 LTV — Lifetime Value direction**

**Standard SaaS direction — simple-LTV.** The canonical simple-LTV formula per Bessemer / Bain canon:

LTV simple direction \=  
  ARPU × gross\_margin / monthly\_churn\_rate

The interpretation is "perpetuity-with-churn" — 1 / monthly\_churn is the expected paying-subscription lifetime in months; multiplied by ARPU × gross margin produces lifetime contribution margin per customer.

**The simple formula is a management-estimate, not decision-grade truth.** It assumes stable monthly churn, stable gross margin, and a mature cohort population. Lyceon's stage doesn't meet any of those assumptions; the simple-LTV is useful for early-stage directional thinking and not appropriate as the authoritative LTV for decisions like CAC-bidding-ceilings.

**Lyceon SAT-specific seasonality direction.** SAT prep is naturally exam-date bounded — students churn after their target test date because the job is done, not because the product failed. The simple formula treating this as failure churn produces a too-pessimistic LTV. The directional posture for §7.5 is that **cohort-based LTV by exam-date cohort becomes the decision-grade LTV once data accumulates** — measure LTV for students cohorted by target-test-date rather than by signup-date; allow planned-post-test "churn" to be excluded from the lifetime-extension assumption. This is a V1.1+ refinement.

**LTV:CAC ratio direction.** Standard SaaS canon's healthy band is LTV:CAC ≥ 3 (sustainable acquisition); ≥ 5 is excellent. Lyceon's directional target is the ≥ 3 band; the ≥ 5 band is aspirational. Both ratios must be interpreted with the appropriate LTV grade (management-estimate vs decision-grade cohort).

**§7.5 gate-list:**

| Gate | Description |
| ----- | ----- |
| **CPA-review gate** | Accountant review of simple-vs-cohort LTV methodology choice; appropriate use of each for different reporting contexts |
| **Cohort-data gate** | At least 6 months of paying-subscriber data \+ KPI-BIZ-03 churn body \+ KPI-BIZ-04 ARPU body \+ gross\_margin body (which itself requires Doc 03 §24 and Doc 06E §8 to be operational) |
| **SAT-seasonality gate** | Cohort analysis by target-test-date available |
| **External-reporting gate** | Per §1.5 — clear labeling of management-estimate vs decision-grade required for external use |

LTV is NOT registered in the Doc 07 Parent §10 KPI roster (same as CAC). Doc 09 owns LTV directionally.

## **7.6 Contribution margin per paying user direction**

**Standard SaaS direction.** Contribution margin per paying user:

contribution\_margin\_per\_paying\_user\_monthly direction \=  
  revenue\_per\_paying\_user\_monthly                                  \[KPI-BIZ-04 per §7.3\]  
  − LISA\_cost\_per\_paying\_user\_monthly                              \[Doc 03 §24 canonical\]  
  − infra\_cost\_per\_paying\_user\_monthly                             \[Doc 06E §8 KPI-OPS-02 cost\_per\_paying\_subscriber\]  
  − payment\_processing\_cost\_per\_paying\_user\_monthly                \[Doc 06E §7 Stripe vendor body\]

**Composition direction — citing canonical owners, never restating.** Each input's canonical owner:

* revenue\_per\_paying\_user\_monthly — Doc 09 §7.3  
* LISA\_cost\_per\_paying\_user\_monthly — Doc 03 Main §24 owns the LISA cost tier discipline (canonical per-user cost tier structure with hard / alert / soft / target cap discipline). Free-tier users contribute zero LISA cost (Doc 02B §11.4 excludes LISA from free tier).  
* infra\_cost\_per\_paying\_user\_monthly — Doc 06E §8 owns KPI-OPS-02 cost\_per\_paying\_subscriber per Doc 07 Parent §10 KPI roster. Doc 09 does NOT re-own.  
* payment\_processing\_cost\_per\_paying\_user\_monthly — Doc 06E §7 owns the Stripe vendor body which carries the Stripe processing fee structure. Whether Stripe fees roll into the KPI-OPS-02 composite or are treated separately is a Doc 06E §7 decision; Doc 09 §7.6 follows whichever Doc 06E specifies.

**§7.6 gate-list:**

| Gate | Description |
| ----- | ----- |
| **All upstream input gates** | §7.3 ARPU body lockable \+ Doc 03 §24 LISA cost runtime operational \+ Doc 06E §8 KPI-OPS-02 body lockable \+ Stripe fee data accumulated |
| **CPA-review gate** | Accountant review of contribution-margin methodology \+ tier-breakdown reporting \+ the gross-margin denominator if used downstream by LTV |
| **Operational-data gate** | Enough paying-subscriber data for the composition to be stable rather than noisy |

---

# **§8 — Cost Attribution Direction**

## **8.1 The measure-vs-interpret boundary direction**

Doc 07 Parent Threat 9 named "cost-attribution boundary confusion (Doc 07 vs Doc 09)" as a load-bearing threat. The directional discipline for that boundary:

* **Doc 07 measures** — KPI registry entries, warehouse rows, event-time emission, technical-surface KPIs (cost\_per\_mau, cost\_per\_paying\_subscriber)  
* **Doc 09 interprets** — directional financial-formula bodies that consume the measurements as inputs and compose them into business-readable metrics (contribution margin per user, gross margin, LTV)

The boundary is static. Doc 06E §8 owns the composite cost-per-X bodies; Doc 09 consumes them as inputs to contribution-margin direction. Doc 03 §24 owns LISA per-user cost; Doc 09 consumes it as an input to contribution-margin direction. Doc 09 does NOT re-own the upstream cost bodies.

## **8.2 Doc 06E §8 → Doc 09 §7.6 consumption direction**

The directional consumption interface: when Doc 06E §8 bodies KPI-OPS-02 cost\_per\_paying\_subscriber (which is currently a name\_only\_stub per the Doc 07 Parent §10 KPI roster citing Doc 06E §8 as canonical owner), Doc 09 §7.6 contribution margin direction consumes that body as the infra\_cost\_per\_paying\_user\_monthly input. The body lives in Doc 06E §8; Doc 09 cites by exact § and does not restate.

If Doc 06E ever updates its KPI-OPS-02 body (new vendor added; vendor cost rate change; allocation methodology refinement), the change propagates to Doc 09 §7.6 contribution margin direction without Doc 09 amendment because §7.6 consumes by reference, not by inline value. A Doc 06E material change in body shape (e.g., tier-conditioned composite) may trigger a Doc 09 directional amendment if §7.6 needs to consume the tier-conditioned shape; that lands as a Doc 09 in-lock-cycle amendment when Doc 06E publishes the change.

## **8.3 Doc 03 Main §24 → Doc 09 §7.6 consumption direction**

The directional consumption interface: Doc 09 §7.6 consumes Doc 03 Main §24's LISA cost discipline as the LISA\_cost\_per\_paying\_user\_monthly input. The body lives in Doc 03 §24 (per-user cost tier structure with cap discipline — hard cap / alert threshold / soft cap / target tier values canonical there); Doc 09 cites by exact § and does not restate tier values.

The per-paying-user average LISA cost varies meaningfully by usage pattern (a heavily-engaged paying user driving against the Doc 03 §24 hard cap consumes at the hard-cap rate; a casual user consumes a small fraction). The blended average across paying users is what §7.6 contribution-margin direction consumes. Free-tier users contribute zero LISA cost per Doc 02B §11.4.

Doc 03's tutor cap proximity rate (KPI-TUT-05 per Doc 07B §9.5 \+ Doc 03 Main §11/§24 canonical) is a leading indicator of LISA-cost-pressure: as users push against the cap more aggressively, per-paying-user LISA cost approaches the Doc 03 §24 hard-cap rate and gross margin per user compresses. KPI-TUT-05 measurement (Doc 07 surface) feeds Doc 09 §7.6 contribution-margin interpretation (Doc 09 surface).

## **8.4 Free-tier cost attribution direction**

Per §7.4, Lyceon's directional posture allocates free-tier infrastructure cost (Doc 06E §8 KPI-OPS-01 cost\_per\_mau × free-user-MAU-share) to **acquisition cost (CAC)**, not to gross margin. This is a Lyceon management-accounting convention reflecting the free tier's design intent as conversion engine per Doc 02B V4 §11.5 freemium thesis.

LISA cost contribution from free-tier users is **zero** because Doc 02B §11.4 excludes LISA from the free tier; only Doc 06E §8 KPI-OPS-01 (infra cost) flows into the free-tier-to-acquisition allocation.

**Disclosure requirement per §1.5** for any external-reporting use of CAC, contribution margin, or gross margin that's affected by this allocation choice.

## **8.5 V1.1+ per-feature cost attribution direction**

Doc 07 Parent §22 names per-feature cost attribution as V1.1+ technical infrastructure. The directional financial-interpretation layer: when the V1.1+ pipeline activates and per-feature cost data accumulates, Doc 09's §8.5 direction bodies how per-feature technical costs (LISA cost per feature, infra cost per feature, warehouse-query cost for analytics-heavy features) compose into per-feature contribution-margin reporting that supports product-prioritization decisions.

V1 contract-shape direction (fields a future §8.5 body would populate):

* Feature taxonomy  
* Per-feature cost input mapping (which Doc 06E vendor costs map to which features)  
* Per-feature revenue attribution methodology  
* Per-feature contribution margin composition  
* Reporting cadence  
* Decision integration

This is V1.1+ direction; the operational and CPA gates close late-V1.1+ at earliest.

---

# **§9 — Stripe Financial-Records Retention Direction**

## **9.1 The boundary direction**

Doc 07E §7.4 declares the boundary that Doc 09 §9 captures the direction of: *"Stripe customer records (payment history, subscription state, billing artifacts) are governed by Doc 09 (Finance) — financial records retention is typically 7-year-financial-compliance, longer than 12-month-inactivity PII. 07E Layer 4 does NOT extend to Stripe-side records. When a 13+ user's Doc 05D §10 cascade fires, the Stripe-side data is NOT touched — Doc 09 governs that lifecycle independently."*

The boundary direction is **bi-directional**:

* Doc 07E cascade does NOT touch Stripe financial records — does not delete payment history, invoice records, subscription state history at 12-month-inactivity  
* Doc 09 retention does NOT keep PII alive past Doc 07E cascade timeline — the user's PII / event-history goes through 07E cascade; only the financial-records Stripe artifacts persist for the conservative retention period

Both halves are necessary to preserve the privacy posture for non-financial data while satisfying intended financial-records retention.

## **9.2 The conservative retention direction (NOT a universal legal floor)**

Lyceon's directional posture is a **conservative 7-year retention policy** for Stripe payment records, invoice/receipt artifacts, subscription state history, tax records, and customer-level financial metadata. This is **Lyceon's intended conservative posture**, NOT an assertion that 7 years is a universal IRS / state-tax / SEC legal floor.

The legal reality is more nuanced than "7 years is the floor." IRS guidance is conditional — records must generally be kept as long as needed to prove income or deductions, with different periods depending on the issue type (3 years for most issues; 6 years if income is underreported by more than 25%; 7 years for claims involving worthless securities or bad debt deductions; indefinitely for fraud-related issues). State tax retention varies by state. SEC retention varies by registrant status and document class. International jurisdictions (EU, UK, India, Brazil) have separate retention rules; some EU jurisdictions require 10 years for invoices.

Doc 09's direction is to **lean conservative** (7-year as a prudent business retention policy that covers most known requirements) **pending counsel review** that may extend, shorten, or refine the policy by jurisdiction. The §9 directional posture is NOT to be cited as "Lyceon must retain for 7 years per the law" — only as "Lyceon's intended conservative retention policy is currently 7 years subject to counsel validation."

## **9.3 What "Stripe customer records" means for retention direction**

In-scope for the conservative 7-year retention direction:

* Payment records (successful charges, refunds, chargeback records, payment-method authorizations) — needed for tax compliance, audit defense, dispute history  
* Subscription state history (creation, status transitions, renewal events, cancellation events) — needed for revenue-recognition audit per §6 and for §7.2 churn attribution  
* Invoice and receipt artifacts — needed for tax reporting and customer-side receipt continuity  
* Tax records (Stripe Tax sales tax / VAT / GST collected and reported) — required by tax authorities under multi-year retention rules  
* Customer-level financial metadata (customer-id to payment-method linkage, customer-id to historical charge linkage) — needed so the above artifacts remain queryable

NOT in scope for §9 retention (these are PII metadata that follows Doc 07E cascade timeline, not Doc 09 financial-records timeline):

* Customer name and email stored in Stripe customer objects  
* Customer billing address PII (note: tax-record-relevant address components may need partial retention per jurisdiction; counsel-gated)  
* Customer-provided notes or memo fields

The discipline direction is: **financial records persist for the conservative retention period; PII metadata about who the financial records belonged to follows the Doc 07E cascade timeline**. This separation is what makes the V1.1+ §9.5 identifier-anonymization-at-deletion direction possible (in concept; Stripe API verification required).

## **9.4 Stripe-side user-deletion direction (NOT silent billing)**

When a Lyceon user account is deleted (user-initiated deletion per Doc 01 V6.0; under-13 hard-delete per Doc 07E §10; 12-month-inactivity cascade per Doc 07E §7), the directional posture for the Stripe-side response is:

1. **If the user has an active paid subscription, Lyceon cancels future renewal at period end** (Stripe cancel\_at\_period\_end mechanism, or equivalent verified-with-vendor API approach). The user retains entitlement through the end of the current paid period; no new renewal charge fires.  
2. **Premium entitlement remains available until the paid period ends**, OR an immediate-cancel-with-refund path activates if law/support policy requires (e.g., user requests immediate cancellation with refund as part of deletion; user is under-13 and immediate-cancel is the safer posture).  
3. **Stripe financial records are retained per §9.2 conservative direction** (anonymized per §9.5 V1.1+ when that path closes its vendor-verification gate).  
4. **No silent-billing path exists.** The user is never charged for premium access they cannot use.

The original Doc 09 V1 draft had a different posture (V1: subscription continues without active cancellation; user may lose access while still being charged). That posture is unacceptable and §9.4 corrects it.

The exact Stripe API call sequence (use cancel\_at\_period\_end vs cancel vs subscription update; how to handle in-flight invoices; how to handle disputed charges during the deletion window) is Stripe-API-vendor-verification gated. The directional posture above is the intent; the implementation locks when vendor verification closes.

## **9.5 V1.1+ Stripe-side identifier-anonymization direction (vendor-verification gated)**

The standard direction for satisfying both the §9.2 conservative financial-records retention AND Doc 07E §7 PII cascade-at-12-month-inactivity is to **anonymize identifying PII at user deletion while preserving the financial records as anonymized financial records**. The directional path:

1. At Lyceon user deletion event, an identifier-anonymization operation fires against the Stripe customer record  
2. The anonymization replaces PII metadata fields (customer name, email, billing address PII) with anonymized values  
3. The financial records (charges, subscriptions, invoices, tax records) are NOT touched — they persist attached to the anonymized customer record  
4. The Lyceon-side mapping linking Lyceon user\_id to Stripe customer\_id is severed; Lyceon loses the ability to reconnect the historical Stripe customer record to any PII Lyceon retains  
5. The anonymization is one-way (per Doc 07E §7.3 irreversibility-by-construction discipline applied to the Stripe-side identifier link)

**This direction is conceptually clean but vendor-verification-gated.** Stripe's actual API behavior must be verified before this path becomes implementable. The verification questions per RB-09-V1-05:

* Which customer fields can Lyceon overwrite on a Stripe Customer object update?  
* Do historical invoices/receipts retain prior PII at customer-update time (i.e., does invoice.customer\_name capture the customer name at invoice creation, or at invoice query time)?  
* Do tax records preserve billing address or jurisdiction data independently of customer-object update?  
* Does anonymization affect dispute / refund / audit workflows that Stripe's own systems run against historical records?  
* Does Stripe's own retention obligations (PCI, Stripe-side legal compliance) override Lyceon-side anonymization intent?  
* Does Stripe customer-delete API (which permanently deletes the customer and cancels active subscriptions) interact with anonymization in unexpected ways?

**§9.5 gate-list:**

| Gate | Description |
| ----- | ----- |
| **Stripe-API-vendor-verification gate** | All RB-09-V1-05 verification questions answered by Stripe API documentation review \+ implementation testing. stripe\_identifier\_anonymization\_vendor\_proof artifact produced. |
| **CPA-review gate** | Accountant review of whether anonymized financial records satisfy accounting-audit-trail requirements (the financial records persist; do they remain usable for tax audit defense after PII anonymization?) |
| **Counsel-review gate** | Legal counsel review of whether identifier-anonymization satisfies privacy obligations (GDPR right-to-erasure for EU users; DPDP for India; state privacy laws) AND whether financial-records retention overrides privacy-erasure rights |
| **Operational-implementation gate** | Engineering implementation of the anonymization mechanism \+ the Lyceon-side identifier severance |

Until the §9.5 gate-list closes, deleted Lyceon users have Stripe customer records that still contain their identifying PII. **This is a documented V1 limitation** that the §9.5 path is intended to resolve at V1.1+; not a privacy-incident-class issue at V1 because the Stripe-side PII is governed by Stripe's own privacy policy and the user's relationship is with Stripe at the financial-records level.

## **9.6 Under-13 financial-record handling — separate legal-review path**

The Doc 07E §10 under-13 cascade is hard-delete-everywhere except minimal non-PII proof metadata. **The §9.2 conservative 13+ financial-records retention direction does NOT automatically apply to under-13 paying users.** Under-13 is a separate legal-review path:

* Under-13 financial-record retention may be required only to the extent necessary for tax, refund, chargeback, and accounting defense — NOT a blanket 7-year extension  
* Non-required child PII fields must be removed or minimized as early as vendor mechanics allow  
* Under-13 Stripe PII retention cannot rely on the general 13+ Stripe retention posture  
* This is a **launch gate if under-13 paying users are possible at V1** — must close with counsel before V1 launch enables under-13 paid subscriptions

The §9.6 gate-list:

| Gate | Description |
| ----- | ----- |
| **Counsel-review gate (under-13 financial)** | Legal counsel review of: minimum required retention for under-13 financial records (tax / refund / chargeback / audit defense); maximum acceptable PII minimization given vendor mechanics; jurisdiction-specific overrides (COPPA US; GDPR-K EU; DPDP India under-18 distinction). |
| **Product-decision gate** | Whether Lyceon V1 permits under-13 paying users at all. If V1 launches without under-13 paid users (e.g., paying user must be 13+ verified at signup), §9.6 directional content is not launch-critical and the counsel-review gate is V1.1+. If V1 permits under-13 paid users, §9.6 is launch-gating. |
| **Vendor-verification gate** | Stripe API behavior for selective PII minimization in under-13 customer records — likely overlaps with §9.5 vendor verification but may have additional under-13-specific questions (whether Stripe Tax records preserve age-relevant data; whether Stripe support workflows require PII for under-13 chargeback handling). |

## **9.7 Expected future Doc 06D additive**

When the §9 retention direction locks (gate-lists close for §9.2 \+ §9.4 \+ §9.5 \+ §9.6), an in-lock-cycle additive to Doc 06D §9 infra/retention-policy-registry.yaml registers Stripe customer financial records as a retention-class entry, referencing the locked Doc 09 §9 body. This additive does NOT fire at Doc 09 V1 lock; it fires when §9 transitions from directional to lockable.

The additive shape (when it eventually fires) follows Doc 06D §9.1 substrate schema, with canonical\_owner\_doc\_and\_section: 'Doc 09 §9' and the retention class \+ scope \+ cascade-relationship-to-07E fields populated from the locked Doc 09 §9 content. The retention class enum value (financial\_records\_seven\_year\_compliance or whatever the counsel-validated policy resolves to) may need a Doc 06D §5 retention class taxonomy extension; that's part of the additive's coordination.

---

# **§10 — Cross-Doc Additives Expected (Not Fired at V1)**

Per Q-DIRECTION-CHECK-a, the cross-doc additives Doc 09 expected to fire at V1 lock under the original contract-grade draft are **NOT fired at Doc 09 V1 directional lock**. They become expected-future-additives tied to per-§ gate-list closure.

## **10.1 Expected Doc 07B KPI registry additive (when §7.2 \+ §7.3 lock)**

**Target:** infra/kpi-registry.yaml per Doc 07B V1.0 §9.5. **Expected trigger:** §7.2 (KPI-BIZ-03 churn) and §7.3 (KPI-BIZ-04 ARPU) gate-lists close — CPA review of formula methodology, operational-data threshold reached, exact-filter requirements per RB-07B-V1-06 satisfied (source\_event\_names from Doc 07A registry, window\_semantics, dedup\_key, grain). **Mechanism (when triggered):** The two currently-name\_only\_stub entries in Doc 07B's registry transition to bodied\_v1 with measurement\_body populated from the locked Doc 09 §7.2 \+ §7.3 content. Uses Doc 07B's actual bodied\_v1 | name\_only\_stub enum (verified per RB-09-V1-13 grounding scan against Doc 07B §9.5.2 — Doc 09 does NOT invent enum values). **Status at Doc 09 V1 lock:** EXPECTED-FUTURE-ADDITIVE. Resolves FWD-07-01 for BIZ-03/04 portion **only when triggered**, not at Doc 09 V1 directional lock. FWD-07-01 OPS portion (KPI-OPS-01 \+ KPI-OPS-02) stays Doc 06E §8 territory regardless.

## **10.2 Expected Doc 06D retention registry additive (when §9 locks)**

**Target:** infra/retention-policy-registry.yaml per Doc 06D V1.0 §9.1. **Expected trigger:** §9.2 \+ §9.4 \+ §9.5 \+ §9.6 gate-lists close — counsel review of conservative retention policy and under-13 carve-out, Stripe vendor verification of anonymization path, product decision on under-13 paying users. **Mechanism (when triggered):** A new retention-class entry registers Stripe customer financial records, referencing locked Doc 09 §9 content; may require Doc 06D §5 retention-class-taxonomy extension and Doc 06D §11 privacy-incident-sub-class extension (financial\_records\_retention\_violation). **Status at Doc 09 V1 lock:** EXPECTED-FUTURE-ADDITIVE. Resolves FWD-07E-04 **only when triggered**.

## **10.3 Doc 07E §7.4 clarification (small; can land if/when §9 locks)**

**Target:** Doc 07E V1.0 §7.4 prose. **Expected trigger:** §9 retention direction locks. **Mechanism (when triggered):** Small consistency-update clarification to 07E §7.4 acknowledging that the boundary it declares is now bodied on the Doc 09 side. Updates "Doc 09 governs that lifecycle independently (FWD-07E-04 forward-ref)" to reference the locked Doc 09 §9 anchor. **Status at Doc 09 V1 lock:** EXPECTED-FUTURE-CLARIFICATION; small; non-blocking.

## **10.4 No Doc 06E additive expected at V1 or V1.1+ from Doc 09**

Doc 09 directional content consumes Doc 06E §7 vendor cost bodies \+ §8 composite bodies; it does NOT add to Doc 06E. If V1.1+ international pricing per FWD-09-01 activates Stripe Tax as a new vendor needing registration, that fires a Doc 06E §7 additive — but Doc 06E's additive is Doc 06E's responsibility, not Doc 09's.

## **10.5 No V1 additives fire**

To restate clearly: **Doc 09 V1 directional lock fires ZERO cross-doc additives.** The additives in §10.1, §10.2, §10.3 are all expected-future. The locked corpus FWD-07-01, FWD-07E-04, FWD-06-05 receive **directional resolution** at Doc 09 V1 (Doc 09 captures the direction for each) but **full resolution awaits gate-list closure**. The locked-corpus expectation that these forward-references "close at Doc 09 draft" needs to be re-interpreted as "close at Doc 09 directional capture, with the cross-doc additive following when the underlying gates close."

**This does not reopen the locked docs.** Doc 07B V1.0, Doc 06D V1.0, and Doc 07E V1.0 remain LOCKED. Doc 09 V1 only records the expected-future additive obligations it will fire against those locked docs when the corresponding gate-lists close; the locked docs themselves are not modified at Doc 09 V1 directional lock, and the additives when they eventually fire are in-lock-cycle additives to the substrate-receptive locked docs (per the precedent of Doc 05D ↔ Doc 06D, Doc 07E ↔ Doc 06D, Doc 07C ↔ Doc 07B). Locked-doc status integrity is preserved across all Doc 09 V1 directional lock events.

---

# **§11 — Cross-Doc Seam Table (Directional)**

| Seam | Doc 09 side | Canonical owner | Status |
| ----- | ----- | ----- | ----- |
| Stripe pricing magnitudes (USD / local-currency tier amounts) | §5 references; no hardcoding anywhere in Doc 09 | **Stripe production state (runtime)** | RESOLVED — consumer (Stripe canonical at runtime; Doc 09 never hardcodes) |
| Stripe API runtime behavior (billing periods, deletion semantics, anonymization capabilities) | §6 \+ §9 directional reference | **Stripe (vendor; verification-gated for specific API behaviors)** | DIRECTIONAL — vendor verification gates close per-section |
| Free-tier mechanics (canonical specification — quota, reset, gating, surfaces, tools) | §5.2 reference; §7.4 \+ §8.4 acquisition framing | Doc 02B V4 §11.4 \+ §13 | RESOLVED — consumer (referenced, never restated) |
| LISA per-user cost \+ cap discipline (canonical hard / alert / soft / target tier values) | §7.6 \+ §8.3 contribution-margin LISA-cost input | Doc 03 Main §11 / §24 | RESOLVED — consumer (referenced, never restated) |
| Per-platform vendor cost bodies (Supabase, Stripe, Vertex, Cloudflare, etc.) | §7.6 \+ §8.2 contribution-margin infra-cost input | Doc 06E §7 | RESOLVED — consumer (referenced, never restated) |
| Composite cost-per-MAU body (KPI-OPS-01) | §8.4 free-tier acquisition cost composition consumes | **Doc 06E §8** per Doc 07 Parent §10 KPI roster | RESOLVED — consumer (Doc 09 does NOT body this) |
| Composite cost-per-paying-subscriber body (KPI-OPS-02) | §7.6 contribution-margin infra-cost input consumes | **Doc 06E §8** per Doc 07 Parent §10 KPI roster | RESOLVED — consumer (Doc 09 does NOT body this) |
| MAU canonical KPI body (KPI-ENG-03) | §7.4 CAC \+ §7.5 LTV active-user inputs | Doc 07B V1.0 §9.5.3 | RESOLVED — consumer |
| KPI registry substrate (infra/kpi-registry.yaml) \+ bodied\_v1 | name\_only\_stub enum | §10.1 expected-future-additive | Doc 07B V1.0 §9.5 | DIRECTIONAL — additive when §7.2 \+ §7.3 gates close |
| Doc 07E §7.4 Stripe customer records boundary | §9.1 \+ §9.2 \+ §9.3 direction | Doc 07E V1.0 §7.4 | DIRECTIONAL — full resolution when §9 gates close |
| Retention policy registry substrate (infra/retention-policy-registry.yaml) | §10.2 expected-future-additive | Doc 06D V1.0 §9.1 | DIRECTIONAL — additive when §9 gates close |
| Privacy-incident sub-class extension | §10.2 expected sub-class addition when §9 locks | Doc 06D V1.0 §11 | DIRECTIONAL — when §9 locks |
| Stripe vendor body | §6 \+ §7.6 \+ §9 reference (Stripe processing fees \+ financial-records substrate) | Doc 06E V1.0 §7 Stripe subsection | RESOLVED — consumer |
| Identity model \+ user-deletion lifecycle | §9.4 V1 user-deletion direction \+ §9.5 V1.1+ identifier-anonymization | Doc 01 V6.0 | RESOLVED — consumer (referenced, never restated) |
| Config doctrine (any Doc 09 future config-table parameter) | §5 \+ §6 future reference if/when config primitives lock | Doc 01A V1.0 §3 | RESOLVED — consumer |
| CPA-review authority (revenue rec, retention, unit economics, external reporting) | §1.4 hierarchy \+ per-§ gate-lists | **Accountant / CPA (external authority)** | DIRECTIONAL — pending CPA review |
| Legal-counsel authority (retention, under-13, jurisdiction) | §1.4 hierarchy \+ §9 gate-lists | **Legal counsel (external authority)** | DIRECTIONAL — pending counsel review |
| Doc 07 Parent Threat 9 (cost-attribution boundary) | §3 risk 3 \+ §8 entire section direction | Doc 07 Parent V1.0 §3 Threat 9 | RESOLVED — directional discipline captured |
| Doc 07 Parent §22 per-feature cost attribution (V1.1+) | §8.5 V1.1+ direction | Doc 07 Parent V1.0 §22 | OPEN — bounded; V1.1+ |
| Doc 08 Dimension 2 geography expansion | §5.4 \+ §6.7 \+ §9.2 V1.1+ jurisdiction direction | Doc 08 V1.0 | OPEN — bounded forward-ref via FWD-09-01 |
| Doc 08 Dimension 3 B2B / enterprise expansion | §5.4 V1.1+ enterprise/B2B pricing direction | Doc 08 V1.0 | OPEN — bounded forward-ref via FWD-09-02 |
| CR-07-Parent-03 "Delaware C-corp practices noted as Doc 09 input" | §2.3 \+ §16 CR-09-02 explicit closure | Doc 07 Parent V1.0 CR-07-Parent-03 | RESOLVED — explicit drop, no Doc 09 body owed |

---

# **§12 — Forward-References**

## **12.1 Inherited forward-references receiving directional resolution at Doc 09 V1 draft**

* **FWD-07-01** (Doc 07 Parent \+ 07B → Doc 09 financial unit economics body). **DIRECTIONAL RESOLUTION** at Doc 09 V1 — Doc 09 captures the direction for KPI-BIZ-03 \+ KPI-BIZ-04 via §7.2 \+ §7.3 directional bodies. **FULL RESOLUTION** awaits §7.2 \+ §7.3 gate-list closure and the expected Doc 07B KPI registry additive per §10.1. **KPI-OPS-01 and KPI-OPS-02 are outside Doc 09 scope** and remain governed by Doc 06E §8 per Doc 07 Parent §10 KPI roster (per Q-09-Alignment Q-CORRECTION-a), so they are not Doc 09 closure obligations — they close when Doc 06E §8 bodies activate, on Doc 06E's timeline.

* **FWD-07E-04** (Doc 07E §7.4 Stripe customer records boundary). **DIRECTIONAL RESOLUTION** at Doc 09 V1 — Doc 09 §9 captures the retention direction, the cascade boundary direction, and the user-deletion direction. **FULL RESOLUTION** awaits §9 gate-list closure (counsel review \+ Stripe vendor verification) and the expected Doc 06D retention registry additive per §10.2 \+ the Doc 07E §7.4 clarification per §10.3.

* **FWD-06-05** (Doc 06E side of the Doc 06E ↔ Doc 09 financial-interpretation boundary). **RESOLVED** at Doc 09 V1 — §8.2 captures the consumption interface direction (Doc 06E §8 KPI-OPS-02 → Doc 09 §7.6 contribution margin input). This forward-ref is the cleanest of the three because Doc 09 consumes Doc 06E rather than depending on bidirectional gate-list closure; the consumption discipline is established at Doc 09 V1 even though §7.6 itself is directional pending its own gates.

## **12.2 Inherited reference closed (not a forward-ref; explicit drop)**

* **CR-07-Parent-03** trace ("Delaware C-corp practices noted as Doc 09 input"): **CLOSED** via §16 CR-09-02 explicit drop; no Doc 09 body owed.

## **12.3 New Doc 09-originated forward-references**

* **FWD-09-01** — V1.1+ international pricing direction when geography activates per Doc 08 Dimension 2\. Bounded; per-market activation; resolves when first launch market activates substantively. Likely fires Doc 06E §7 Stripe Tax vendor body additive at activation.  
* **FWD-09-02** — V1.1+ B2B / enterprise pricing direction when B2B / enterprise segments activate per Doc 08 Dimension 3\. Bounded; per-segment activation; resolves when first signed B2B/enterprise contract closes.  
* **FWD-09-03** — V1.1+ Stripe-side identifier-anonymization-at-deletion path per §9.5. Bounded; activates as a V1.1+ engineering decision when Stripe API vendor verification closes the §9.5 gate-list. Carries the stripe\_identifier\_anonymization\_vendor\_proof requirement.

---

# **§13 — Audit Profile (Directional)**

## **13.1 Inheritance discipline**

Doc 09 inherits the **global audit-pass counter** from the Doc 07 family (Doc 07D V1.0 closed at P33), but only the **applicable cross-doc passes** that have Doc 09 inputs apply. Doc 09 is NOT a contract-grade doc with executable rules at V1, so:

* **Doc 07-specific passes that have no Doc 09 inputs do NOT apply.** Dashboard-specific passes (Doc 07C-introduced) and experimentation-specific passes (Doc 07D-introduced) and warehouse-model-specific passes don't have Doc 09 inputs to validate.  
* **Cross-doc passes that test Decision-5 reference discipline DO apply.** Doc 07B's ci/kpi-canonical-owner-cite (INV-07-05) and ci/kpi-body-no-restate (INV-07-06) apply to Doc 09's directional KPI references — when Doc 09 §7 references Doc 06E §8 or Doc 03 §24, those references must be exact-§ citations, not restatements.  
* **The DD-07-REDEF defect scan from Doc 07B §9.5.6 applies to Doc 09\.** Any Doc 09 line restating a primitive owned by another doc (LISA tier values, Doc 02B free-tier numbers, vendor cost rates, KPI registry shape) is a defect.

## **13.2 Doc 09-specific directional audit additions**

**No new audit pass introduced at V1** — directional content has no V1 contract rules to prove. The original draft's P34 (financial-body-vs-kpi-registry-parity) is dropped from Doc 09 V1 because the §10.1 KPI registry additive doesn't fire at V1; parity has nothing to check against. P34 (or a successor pass with the same purpose) will activate when §7.2 \+ §7.3 lock and the §10.1 additive fires.

**DD-09-REDEF-DIRECTIONAL defect scan applies** with relaxed grounds because directional content has more reason to describe primitives at the meta level. The scan catches:

* Inline pricing magnitudes (specific USD / local-currency amounts) — **strict no-restatement**; Stripe is canonical at runtime  
* Inline LISA cost tier values ($-figures of hard / alert / soft / target tiers) — strict no-restatement; Doc 03 §24 canonical  
* Inline Doc 02B free-tier specifics (the quota count, exact reset cadence, exact reset timezone) — strict no-restatement except in meta positions (the explicitly-excludes enumeration; the threat-model narrative describing the rule being protected against; the Karl-confirmation log)  
* Inline Doc 06E vendor cost rates — strict no-restatement  
* Inline Doc 07B KPI registry entry shapes — strict no-restatement  
* Inline Doc 07E retention class taxonomy or cascade policy — strict no-restatement  
* Inline Doc 06D registry shape or privacy-incident sub-class enum — strict no-restatement  
* Inline Doc 01 V6.0 identity model primitives — strict no-restatement

**Directional-document audit additions:**

* **Authority gate-list integrity** — every directional §-level section that depends on external authority (CPA, counsel, Stripe vendor verification) names the gate-list explicitly. Sections without gate-lists either (a) don't depend on external authority (rare), or (b) are missing required gate-list disclosure (defect).  
* **Investor-reporting disclosure rule applicability** — every directional section that produces a metric used in external reporting (CAC, LTV, contribution margin, churn, ARPU) is labeled with the §1.5 disclosure rule applicability or the rule is referenced elsewhere governing the section.  
* **Ownership-boundary integrity** — every "Doc 09 directional" claim in §2.2 maps to a section that captures the direction; every "referenced owner" claim resolves to an exact § in the cited doc.  
* **CR-07-Parent-03 closure verification** — §16 CR-09-02 explicitly closes the Delaware C-corp trace; §2.3 names Delaware C-corp in explicitly-excludes.

## **13.3 Known false-positive class**

Doc titles containing flagged words; the §11 cross-doc seam table (cites bodies — required, not restatement); the §2.2 ownership-boundary table (specification shape, not body restatement); §10 expected-future-additive specifications (specification shape of the future additives, not body restatement of the target doc); the §13.2 DD-09-REDEF-DIRECTIONAL defect-scan description (describes what NOT to restate; must mention the categories to make the rule legible — acceptable carve-out); meta-references in the threat-model narrative (§3 describes the rule being protected against).

---

# **§14 — Acceptance Criteria (Directional)**

Doc 09 V1.0 is acceptable for directional lock when:

1. **The pricing direction is captured** (§5) — freemium-plus-three-paid-tiers shape direction; discount-ladder direction; expansion direction (enterprise / B2B / international / promotional); Stripe-canonical-at-runtime principle; free-tier Doc 02B reference; trial-A V1 posture per Q-09-Alignment-Q2-a; refund / proration / subscription-state-lifecycle direction; §5.9 gate-list. **Direction captured; lockability pending §5.9 gate-list.**

2. **The revenue recognition direction is captured** (§6) — standard SaaS ratable direction; Stripe period boundary canonical principle; per-billing-mode direction; trial direction (not active at V1 per Trial-A); refund-handling direction; cancellation direction; multi-currency V1.1+ direction; §6.8 gate-list with RB-09-CPA-01 disclaimer. **Direction captured; lockability pending §6.8 gate-list (especially CPA review).**

3. **The unit economics guidance is captured** (§7) — §7.2 KPI-BIZ-03 churn direction with entitlement-end timing \+ SAT-seasonality consideration; §7.3 KPI-BIZ-04 ARPU direction with paying-user-months denominator; §7.4 CAC direction with free-tier-infra-allocation convention \+ §1.5 disclosure rule applicability; §7.5 LTV direction (simple-as-management-estimate \+ cohort-by-exam-date as decision-grade); §7.6 contribution-margin direction; per-section gate-lists. **Direction captured; lockability per-metric pending per-section gate-lists.**

4. **The cost attribution direction is captured** (§8) — measure-vs-interpret boundary; Doc 06E \+ Doc 03 consumption interfaces; free-tier acquisition allocation framing; V1.1+ per-feature direction. **Direction captured.**

5. **The Stripe retention direction is captured** (§9) — boundary direction; conservative-policy-not-legal-floor framing; in-scope vs out-of-scope retention items; user-deletion direction (no silent billing); V1.1+ identifier-anonymization vendor-verified direction; under-13 separate legal-review carve-out; §9.7 expected Doc 06D additive; per-section gate-lists. **Direction captured; lockability pending §9 gate-list (especially counsel review and Stripe vendor verification).**

6. **Under-13 paid-user product decision is explicit** (§9.6) — if V1 permits under-13 paid users, §9.6 counsel review must close before launch (the §9.6 counsel-review-gate is launch-gating); if V1 blocks under-13 paid users (e.g., age-verification at signup excludes under-13 from paid subscription), that product decision must be documented and §9.6 remains V1.1+ gated rather than launch-gating. **This criterion must be resolved before Doc 09 V1 can transition from DIRECTIONAL LOCK-CANDIDATE to LOCKED AS DIRECTIONAL V1, because under-13 trust-and-safety is the kind of issue where ambiguity at launch is not an acceptable posture.**

7. **Cross-doc additives are correctly framed as expected-future, not V1-fireable** (§10) — §10.1 expected when §7.2 \+ §7.3 lock; §10.2 expected when §9 locks; §10.3 small clarification expected when §9 locks; §10.4 no Doc 06E additive owed from Doc 09; §10.5 zero V1 additives fire.

8. **Every §-level directional section names its gate-list** — concrete authorities and verifications required for lockability; gate-lists meet the Q-09-Alignment-Q-C-b "concrete" depth standard (named decisions, named authorities, named data-thresholds).

9. **Decision-5 holds end-to-end** — DD-09-REDEF-DIRECTIONAL scan clean: no inline pricing magnitudes anywhere; no Doc 02B free-tier numbers except in meta positions; no Doc 03 §24 LISA tier values except in meta positions; no Doc 06E vendor rates; no Doc 06E §8 composite restatement; no Doc 07A / 07B / 07E / 06D / 01 primitive restatement.

10. **The §1.4 Finance Authority Hierarchy is the load-bearing principle** — explicit authorities named in order (Stripe production state → accounting books → legal counsel → Stripe API behavior → Doc 09 → Doc 07B); the §1.5 investor-reporting disclosure rule covers external-reporting use cases.

11. **The cross-doc seam table (§11) is grounded by exact §** — every seam either RESOLVED (consumer of canonical owner) or DIRECTIONAL (pending gate-list closure) or OPEN (bounded forward-ref); FWD-07-01 (BIZ portion) \+ FWD-07E-04 \+ FWD-06-05 receive directional resolution at V1 with explicit full-resolution-when-gates-close framing.

12. **Forward-references are bounded** (§12) — FWD-09-01 (international), FWD-09-02 (B2B/enterprise), FWD-09-03 (Stripe vendor verification) each have explicit activation criteria.

13. *No INV-09- introduced at V1*\* — directional document does not assert executable contract rules; future contract-grade sections will introduce invariants as their gate-lists close.

14. **No new audit pass (P34) introduced at V1** — audit passes prove rules; no V1 rules to prove. P34 (or successor) activates when §7.2 \+ §7.3 lock and the §10.1 additive fires.

---

# **§15 — Watch Items**

| ID | Item | Status |
| ----- | ----- | ----- |
| **W-09-01** | §7.2 KPI-BIZ-03 churn body locks per its gate-list — CPA review \+ operational-data threshold. The expected Doc 07B KPI registry additive per §10.1 fires when this closes. | Open; gate-list defined; non-blocking V1 directional |
| **W-09-02** | §7.3 KPI-BIZ-04 ARPU body locks per its gate-list — CPA review of paying-user-months denominator \+ operational-data. The expected Doc 07B KPI registry additive per §10.1 fires when this closes. | Open; gate-list defined; non-blocking V1 directional |
| **W-09-03** | §7.4 CAC direction locks per its gate-list — CPA review of free-tier-infra-as-acquisition convention \+ marketing-attribution-data threshold. | Open; gate-list defined; non-blocking V1 directional |
| **W-09-04** | §7.5 LTV direction locks per its gate-list — CPA \+ cohort-by-exam-date data \+ SAT-seasonality cohort analysis. | Open; gate-list defined; non-blocking V1 directional |
| **W-09-05** | §7.6 contribution-margin direction locks per its gate-list — all upstream input bodies activate \+ CPA review. | Open; gate-list defined; non-blocking V1 directional |
| **W-09-06** | §6 revenue recognition direction locks per its gate-list (RB-09-CPA-01) — CPA review of ratable methodology \+ refund handling \+ deferred liability \+ Stripe API verification of period boundaries \+ operational implementation. | Open; gate-list defined; non-blocking V1 directional |
| **W-09-07** | §9.2 conservative retention direction locks per its gate-list — counsel review of jurisdiction-specific retention obligations. | Open; gate-list defined; non-blocking V1 directional |
| **W-09-08** | §9.4 user-deletion direction locks per its gate-list — Stripe API verification of cancel\_at\_period\_end behavior \+ support-policy decisions on immediate-cancel-with-refund triggers. | Open; gate-list defined; non-blocking V1 directional |
| **W-09-09** | §9.5 V1.1+ identifier-anonymization direction locks per its gate-list — Stripe API vendor verification of all RB-09-V1-05 questions \+ CPA review of audit-trail preservation \+ counsel review of privacy-vs-retention obligations. stripe\_identifier\_anonymization\_vendor\_proof artifact required. | Open; gate-list defined; FWD-09-03 carries; non-blocking V1 directional |
| **W-09-10** | §9.6 under-13 financial-record direction locks per its gate-list — counsel review of under-13 specific requirements \+ product decision on whether V1 permits under-13 paying users \+ vendor verification of selective PII minimization. **Launch-gating if under-13 paying users are possible at V1.** | Open; gate-list defined; LAUNCH-GATING IF UNDER-13 PAID USERS POSSIBLE |
| **W-09-11** | V1.1+ international pricing direction activates per FWD-09-01 — Doc 08 Dimension 2 geography activation per market. Fires Doc 06E §7 Stripe Tax additive at activation. | Bounded forward-ref FWD-09-01; non-blocking |
| **W-09-12** | V1.1+ B2B / enterprise pricing direction activates per FWD-09-02 — Doc 08 Dimension 3 segment activation. Fires multiple cross-doc additives (Doc 01 role taxonomy, Doc 07E FERPA-coupled retention, Doc 06D B2B-tenant retention) at activation. | Bounded forward-ref FWD-09-02; non-blocking |
| **W-09-13** | V1.1+ per-feature cost attribution direction per §8.5 — Doc 07 Parent §22 V1.1+ pipeline \+ 3 months operational data. | Bounded; non-blocking; late-V1.1+ at earliest |
| **W-09-14** | Doc 06E §8 KPI-OPS-01 and KPI-OPS-02 bodies activate (Doc 06E's responsibility, not Doc 09's). When they activate, §7.6 contribution-margin direction has the inputs it needs to become lockable. | Bounded; non-blocking; Doc 06E V1.1+ activation |
| **W-09-15** | Doc 06E §7 Stripe vendor body — whether processing fees roll into KPI-OPS-02 composite or stay separate. §7.6 direction follows Doc 06E's specification; reconcile at Doc 06E V1.0 verification. | Bounded; non-blocking; resolves at Doc 06E §7 verification |

---

# **§16 — Change Records**

**CR-09-01** — Doc 09 V1.0 established as directional document per Q-09-Alignment Q-A-a, Q-B-stripe-canonical-no-hardcoding, Q-C-b concrete-gate-list-depth, Q-DIRECTION-CHECK-a directional-reframe-proceeds. Single-doc format per Q-09-1-FINAL-b. Captures pricing direction, revenue recognition direction, unit economics guidance, cost attribution direction, Stripe retention direction at a pre-launch / pre-accountant / pre-counsel / pre-vendor-verification moment. Almost all content is directional pending authority validation; the directional register makes that pendency explicit through per-§ gate-lists. Pricing structure direction captured without hardcoding magnitudes (Stripe canonical at runtime per §1.4 finance authority hierarchy \+ §5.1 pricing posture principle); §5.9 captures the Stripe-controls-tier-shape-drift discipline per RB-09-R2-02. Free-tier mechanics referenced from Doc 02B V4 §11.4 \+ §13 (Q-09-Alignment Q10′a). KPI ownership honored per Doc 07 Parent §10 KPI roster (Q-09-Alignment Q-CORRECTION-a) — Doc 09 directional bodies KPI-BIZ-03 \+ KPI-BIZ-04 only; KPI-OPS-01 \+ KPI-OPS-02 are outside Doc 09 scope and remain governed by Doc 06E §8 per RB-09-R2-03 wording cleanup. RB-09-V1-13 enum verification (per SWE R1 review) closed by grounding scan against Doc 07B §9.5 — actual enum is bodied\_v1 | name\_only\_stub, NOT bodied\_v1\_1; Doc 09 V1 does not invent enum values; future §10.1 additive uses Doc 07B's actual enum with RB-07B-V1-06 exact-filter requirements satisfied. Audit profile inherits global counter from P33 (Doc 07D close) without introducing P34 at V1; P34 (or successor) activates when §7.2 \+ §7.3 lock and §10.1 additive fires. No INV-09-\* introduced at V1 (directional document does not assert executable contract rules). Three FWD-09-\* originated forward-references (FWD-09-01 V1.1+ international; FWD-09-02 V1.1+ B2B/enterprise; FWD-09-03 V1.1+ Stripe vendor-verified anonymization). Three inherited forward-references receive directional resolution at V1 with full resolution awaiting gate-list closure (FWD-07-01 for BIZ-03/04 portion only — KPI-OPS-01/02 are outside Doc 09 closure obligations and close on Doc 06E's timeline; FWD-07E-04 via §9 directional bodies; FWD-06-05 via §8.2 consumption interface — the cleanest of the three). Cross-doc additives §10.1 (Doc 07B KPI registry body) \+ §10.2 (Doc 06D Stripe retention class) \+ §10.3 (small Doc 07E §7.4 clarification) are expected-future-additives that fire when corresponding gate-lists close; ZERO additives fire at Doc 09 V1 directional lock per §10.5 (this does not reopen the locked docs — they remain LOCKED). New lock blocker tag RB-09-CPA-01 explicitly required: accountant/CPA signoff before Doc 09 §6 revenue-recognition direction is treated as external-reporting policy. Status label canonicalized as DIRECTIONAL LOCK-CANDIDATE pending final SWE R2 cleanup confirmation; transitions to LOCKED AS DIRECTIONAL V1 (not contract-grade; sections become contract-grade only as authority gates close) on R2 clearance per RB-09-R2-01. Under-13 paid-user product decision promoted into §14 acceptance criteria as criterion \#6 per RB-09-R2-04 (under-13 trust-and-safety ambiguity at launch is not acceptable; must be resolved before V1 lock transitions). SWE R1 \+ R2 review findings normalized — R1 14 findings dissolved into directional reframe (roughly half) \+ landed as gate-list items (other half) \+ RB-09-CPA-01 lock blocker; R2 4 cleanups applied (R2-01 status label canonicalization; R2-02 Stripe-controls-tier-shape-drift in §5.9; R2-03 OPS-KPIs-outside-Doc-09-closure-obligations wording in §12.1; R2-04 under-13 paid-user gate promoted to §14 \#6) plus editorial \#1 (no-reopen-of-locked-docs clarification in §10.5). The directional register is the right register for Doc 09 V1 because the underlying authority validations have not occurred. Grounding verified against Doc 02B V4 §11.4 \+ §13 (free-tier mechanics canonical per Karl 2026-05-31 confirmation); Doc 03 Main V1.1 §11 \+ §24 (LISA cost/cap discipline referenced via project memory); Doc 06D V1.0 §9.1 retention registry substrate \+ §11 privacy-incident sub-class substrate; Doc 06E V1.0 §7 vendor bodies \+ §8 composite KPI-OPS-01/02 bodies; Doc 07 Parent V1.0 Threat 9 \+ §10 KPI roster \+ §22 V1.1+ per-feature cost attribution; Doc 07B V1.0 §9.5 KPI registry actual enum verification (RB-09-V1-13); Doc 07E V1.0 §7.4 Stripe customer records boundary statement; Doc 01 V6.0 identity model \+ user-deletion lifecycle; Doc 01A V1.0 §3 config doctrine; Doc 08 V1.0 Dimension 2 geography \+ Dimension 3 B2B for V1.1+ FWD-09-01/02 activation triggers.

**CR-09-02** — Delaware C-corp practices explicitly dropped from Doc 09 V1 scope per Q-09-Alignment Q11′c. The CR-07-Parent-03 trace line "Delaware C-corp practices noted as Doc 09 input (referenced from Doc 09 when drafted)" is closed at Doc 09 V1.0 draft. Confirmed assessment: cap table discipline, equity grant mechanics, founder compensation, 409A valuations, board mechanics, tax election specifics, ISO/NSO discipline, investor reporting practices belong to corporate counsel \+ Carta \+ accountant \+ corporate bylaws \+ stockholders agreement — these are legal and tax artifacts not spec-doc territory. Doc 09 specifying them would create two sources of truth that drift apart immediately. The trace from CR-07-Parent-03 → Doc 09 is closed; no Doc 09 body owed. Future financial-discipline items that may genuinely warrant spec-doc treatment (cap table reporting cadence, monthly burn-rate publishing, board-reporting practices) would be a different artifact from Doc 09's pricing / revenue / unit economics / cost attribution / Stripe retention work, drafted at the time their content has real binding signal.

---

# **§17 — Closing**

Doc 09 V1.0 captures Lyceon's financial direction as a directional document at a pre-launch / pre-accountant / pre-counsel / pre-vendor-verification moment. It is not a contract; it does not lock executable rules; it does not assert authority-validated treatment of revenue recognition or retention or unit economics. What it captures is the **direction Lyceon is steering toward** — pricing posture with Stripe canonical at runtime; ratable revenue recognition using Stripe period boundaries pending CPA review; standard SaaS unit economics formulas (a16z / Bessemer / Bain canon) applied to Lyceon-specific inputs with explicit pending-data and pending-authority gates; conservative 7-year Stripe financial-records retention pending counsel review; user-deletion direction that avoids silent billing; V1.1+ identifier-anonymization pending Stripe vendor verification; under-13 separate legal-review carve-out.

The §1.4 Finance Authority Hierarchy is the load-bearing principle — Stripe controls runtime billing; accounting books control external reporting; legal counsel controls legal retention floors; Stripe API behavior controls deletion / anonymization capabilities; Doc 09 captures product / engineering financial direction within the space those authorities own. The §1.5 investor-reporting disclosure rule prevents directional content from being treated as authoritative when used in external contexts.

Decision-5 holds end-to-end: Doc 09 directionally bodies pricing posture \+ revenue rec direction \+ unit econ guidance \+ cost attribution direction \+ Stripe retention direction, and references — never restates — Doc 02B free-tier mechanics, Doc 03 §24 LISA cost discipline, Doc 06E §7/§8 vendor and composite cost bodies, Doc 07A event taxonomy, Doc 07B KPI registry shape and enum, Doc 07E retention/cascade policy, Doc 06D retention registry substrate, Doc 01 V6.0 identity model, AND Stripe production state for pricing magnitudes. The §10 cross-doc additives are expected-future-additives that fire when the corresponding §-level gate-lists close; ZERO additives fire at Doc 09 V1 directional lock. The locked-corpus forward-references (FWD-07-01 BIZ portion, FWD-07E-04, FWD-06-05) receive directional resolution at Doc 09 V1 with full resolution awaiting gate-list closure.

Doc 09 V1 is the directional financial-dimension document. The status transition from DRAFT to LOCKED occurs upon external SWE review of the directional reframe \+ clean re-audit (per the in-lock-cycle pattern). Subsequent gate-list closures (CPA review of revenue rec; counsel review of retention; Stripe vendor verification of anonymization; operational-data thresholds for unit economics) trigger per-section lockability transitions and the corresponding cross-doc additives over time — Doc 09 evolves from "directional V1" toward "contract-grade sections as gates close" rather than as a one-time big-bang lock.

**End of Doc 09 V1.0 Directional Draft.**

