# **Lyceon — Document 10: Brand, Public Narrative & Pre-Launch Legal Document Program**

**Version:** V1.0 **Status:** LOCKED 2026-05-31 (DRAFT → LOCKED on R2 clean clearance; in-lock-cycle multi-round cleanup pattern; no version bump) **Last updated:** 2026-05-31 **Owners:** Founder / CTO review **Governed by:** Doc 00 (Authoritative Platform Directive).

**What this document is:** Doc 10 is a **two-surface directional document** covering Lyceon's brand-and-trust posture (Surface 1\) and the pre-launch legal-document program (Surface 2). Doc 10 is NOT a contract document; it is the framing artifact that captures what Lyceon's brand-and-trust direction is and what legal documents Lyceon needs to produce before launch. The actual legal documents — Privacy Policy, Terms of Service, Refund Policy, etc. — are **separate artifacts** drafted standalone in industry-grade legal form, intended to be dropped into the Lyceon repo and wired into the frontend acceptance flow.

The register is **directional with two distinct surfaces**:

* **Surface 1 — Brand / public narrative / social-proof direction** (§4–§8): pre-launch EdTech competitive analysis, Lyceon's positioning relative to incumbents, brand voice, social-proof framework, community direction, public-facing analytics surfaces direction, LISA-as-public-voice direction. Load-bearing principle: **proof over gimmicks**.  
* **Surface 2 — Pre-launch legal-document program** (§9–§11): the inventory of legal documents Lyceon needs to publish before launch, per-document directional summary (what each is, why we need it, what it covers, launch-readiness status), and the W7 launch-gating discipline. The actual legal-document artifacts are produced separately.

**Doc 10 unique conventions** (departing from Doc 08 and Doc 09 patterns per Karl's "each doc gets to be unique" direction): no forced INV-10-\* / FWD-10-\* / W-10-\* numbering scaffolding; no forced cross-doc seam table parity with Doc 09; no Brand/Trust Authority Hierarchy analog forced into existence where it doesn't naturally fit. Doc 10 adopts conventions that serve its content and drops conventions that don't.

**Depends on:**

* **Doc 00** (Authoritative Platform Directive — server-authoritative, deterministic, auditable; the brand posture grounded in these principles)  
* **Doc 01 V6.0** (identity model — student / guardian / admin role taxonomy referenced for legal-document audience scope; never restated)  
* **Doc 02B V4 §11.4 \+ §13** (free-tier mechanics — referenced for legal-document subscription/billing-tier disclosure context; never restated)  
* **Doc 03 Main V1.1 §11 \+ §24** (LISA usage caps \+ cost discipline — referenced for legal-document LISA-data-handling disclosure context; never restated)  
* **Doc 03 Main V1.1 §14.2** (LISA tutor conversation retention — canonical retention windows referenced for legal-document tutor-data-handling disclosure; never restated)  
* **Doc 04 family V1.0** (LOCKED — exam runtime \+ scoring formula; referenced for legal-document AI-content-disclosure context; never restated)  
* **Doc 05 family V1.0** (LOCKED — mastery engine; referenced for legal-document data-processing-purpose disclosure; never restated)  
* **Doc 06D V1.0 §9** (retention policy registry substrate — referenced for legal-document retention disclosure)  
* **Doc 07A V1.0 §8** (PII redaction contract — canonical for legal-document PII-handling disclosure)  
* **Doc 07E V1.0** (LOCKED 2026-05-26 — **load-bearing dependency**: §5/§7/§10 retention model \+ §8.3 privacy-policy disclosure obligation \+ §15 W7 launch gate \+ §10.6 under-13 ML-exclusion invariant; the W7 obligation declared by 07E is the operational reason Doc 10 Surface 2 exists)  
* **Doc 08 V1.0** (Expansion strategy — Dimension 2 launch markets \+ Dimension 6 channel/content/community direction; referenced for jurisdictional scope and brand-channel direction)  
* **Doc 09 V1.0** (LOCKED 2026-05-31 — financial direction; §5 pricing posture \+ §5.7 refund direction \+ §9 Stripe retention direction; referenced for legal-document subscription/refund/financial-records disclosure)  
* **Industry research** (this draft cycle — competitive EdTech landscape \+ multi-jurisdictional legal-document requirements; the research-source pointers grounded in §4 \+ §9)

**Forward-references (bounded):**

* **FWD-10-A** (V1.1+ — community infrastructure activation per Doc 08 Dimension 6 long-horizon: Discord, Reddit branded subreddit, score-progression UGC, LISA-as-content-brand)  
* **FWD-10-B** (V1.1+ — international jurisdiction-specific legal-document additions when Doc 08 Dimension 2 secondary markets activate substantively beyond initial English-speaking launch set)  
* **FWD-10-C** (V1.1+ — B2B / educational-institution legal artifacts when Doc 08 Dimension 3 activates: FERPA-coupled DPAs, Master Service Agreements, district-procurement-templates, educator terms)  
* **FWD-10-D** (V1.1+ — separate brand-and-trust analytics surfaces if Lyceon ever exposes public-facing dashboards — currently named in Doc 07C §7.1 as out-of-07C-scope and would land in Doc 10 if introduced)

**Inherited forward-references receiving resolution at Doc 10 V1:**

* **FWD-07E-05** (Doc 07E V1.0 → Doc 10 privacy policy disclosure text) — **RESOLVED at Doc 10 V1** via §9.2 Privacy Policy artifact, which lands the W7-named disclosure language for the 12-month-inactivity → pseudonymized-retention model \+ ML-training-corpus indefinite-retention \+ legal-anonymization-upgrade-after-W5+W9 nuance.  
* **FWD-07-03** (Doc 07 Parent \+ 07B \+ 07C \+ 07D → Doc 10 brand/social-proof analytics) — **DIRECTIONALLY RESOLVED at Doc 10 V1** via §6 public-facing analytics surfaces direction; full resolution awaits V1.1+ when public-facing surfaces operationally activate (FWD-10-D).

**Applies to:** the brand posture and public-narrative direction (§4); the EdTech competitive landscape and Lyceon positioning (§5); the public-facing analytics surfaces direction (§6); the social-proof framework and testimonial direction (§7); the community direction and LISA-as-public-voice direction (§8 — referencing Doc 08 Dimension 6 as canonical channel owner); the pre-launch legal-document inventory (§9); per-document directional summaries with launch-readiness status (§9.1–§9.20); the W7 launch-gating discipline \+ Doc 10 ↔ existing-drafts reconciliation framework (§10); the legal-document program coordination (§11); the lightweight conventions adopted (§12); the acceptance criteria (§13); the change records (§14); the closing (§15).

**Explicitly excludes:**

* Event taxonomy, KPI registry, dashboard substrate, experimentation framework (Doc 07 family owns)  
* Retention class taxonomy \+ cascade policy (Doc 07E owns; Doc 10 references for disclosure-shape only)  
* LISA cost / cap / retention bodies (Doc 03 Main owns; referenced for disclosure-shape only)  
* Mastery KPI body math (Doc 05B owns)  
* Scoring formula (Doc 04B owns)  
* Free-tier mechanics body (Doc 02B owns)  
* Pricing magnitudes (Stripe canonical at runtime per Doc 09 §1.4)  
* Revenue recognition methodology (CPA-owned per Doc 09 §6 \+ §1.4)  
* Legal retention floors as universal compliance assertions (legal counsel owns per Doc 09 §1.4 \+ §9)  
* Stripe API runtime behavior (Stripe vendor; referenced for disclosure-shape only)  
* Channel/community strategic-vision-direction body (Doc 08 Dimension 6 owns the strategic direction; Doc 10 bodies the brand-and-trust interpretation only)  
* B2B / enterprise / institutional legal artifacts (FWD-10-C V1.1+)  
* Specific brand assets — logos, color palette, typography, marketing-site copy (operational design/marketing work outside Doc 10 spec scope)  
* Marketing campaign execution — paid acquisition channels, content production schedule, influencer programs (operational marketing work outside Doc 10 spec scope)  
* The actual legal-document text of each artifact in §9's inventory (each is a **separate artifact** drafted in industry-grade legal form; Doc 10 captures only the directional summary)  
* Investor-facing brand materials (corporate communications work outside Doc 10 spec scope per the Doc 09 §1.5 disclosure-rule analog — investor-facing brand claims require founder \+ counsel approval and convention disclosure)

---

# **§1 — What Doc 10 Is**

## **1.1 The two-surface directional register**

Doc 10 captures Lyceon's brand-and-trust direction at a pre-launch moment. The document has two distinct surfaces:

**Surface 1 — Brand, public narrative, and social-proof direction (§4–§8).** This is strategic-brand-thinking made legible — what Lyceon's brand posture is, how Lyceon positions itself relative to the EdTech competitive landscape, what social proof Lyceon will surface, how community direction lands, what proof-over-gimmicks means in practice. Surface 1 is closer to Doc 08's strategic-vision register than to Doc 09's gate-list-directional register because brand direction isn't authority-validated the same way revenue recognition or retention is — there are no CPAs or counsel or Stripe vendors who validate brand posture. Brand direction is owned by Lyceon itself: founder direction \+ marketing/product judgment \+ competitive insight. The Surface 1 register is "captured-direction-with-explicit-principle" rather than "directional-with-gate-lists."

**Surface 2 — Pre-launch legal-document program (§9–§11).** This is the operational-coordination surface — the enumeration of every legal document Lyceon needs to publish before launch, per-document directional summary, and the W7 launch-gating discipline that ties Doc 07E's operational requirement to Doc 10's deliverable. Surface 2 is closer to Doc 09's directional register because legal documents are counsel-validated, and the relationship between Lyceon's intent and counsel's validation is exactly the kind of "directional pending authority" pattern Doc 09 names. The Surface 2 register is "directional with explicit counsel-review gate \+ publication gate per document."

The two surfaces are intentionally distinct in tone, content, and convention. Surface 1 reads like a brand-positioning document. Surface 2 reads like a legal-program coordination document. They share the same Doc 10 because both are about how Lyceon presents itself to the public — Surface 1 is the strategic and reputational presentation; Surface 2 is the legal and contractual presentation.

## **1.2 What Doc 10 V1 directionally captures**

**Surface 1:**

* The proof-over-gimmicks principle as the load-bearing brand posture (§4)  
* The pre-launch EdTech competitive landscape and Lyceon's positioning within it (§5)  
* The public-facing analytics surfaces direction — the marketing-site counters and aggregates that make Lyceon's outcomes legible without exposing user data (§6)  
* The social-proof framework — score-progression sharing direction, testimonials direction, outcomes-proof claims direction (§7)  
* The community direction and LISA-as-public-voice direction, referencing Doc 08 Dimension 6 as canonical channel-strategy owner (§8)

**Surface 2:**

* The pre-launch legal-document inventory (§9 — 20 documents identified across 6 categories)  
* Per-document directional summary (§9.1–§9.20) — what each is, why Lyceon needs it, what it directionally covers, launch-readiness status (drafted as separate artifact, drafted with gaps, not yet drafted, not yet decided)  
* The W7 launch-gating discipline \+ the Doc 07E-Doc 10 dependency closure (§10)  
* The legal-document program coordination — how the artifacts get produced, reviewed by counsel, and integrated into the frontend acceptance flow (§11)

**What Doc 10 V1 does NOT do:**

* Lock executable invariants (no INV-10-\* at V1 — directional document has no executable contract rules to assert)  
* Introduce new audit passes (no P34 at V1 — Doc 10 is even lighter on contract-grade content than Doc 09\)  
* Body the legal documents themselves (each legal document is a **separate artifact** with its own register)  
* Body Doc 08 Dimension 6 channel strategy (Doc 08 owns; Doc 10 references)  
* Make brand-positioning claims that go beyond what Lyceon's actual product reality supports  
* Author the legal-document text (counsel \+ Lyceon co-produce; Doc 10 names the deliverables, the standalone artifacts contain the text)

## **1.3 The load-bearing principle: proof over gimmicks**

The single most important framing in Doc 10 V1 is **proof over gimmicks**. This is the principle that anchors Lyceon's brand posture and discriminates Lyceon from the EdTech incumbents whose brand-and-trust postures Doc 10 §5 analyzes.

Proof-over-gimmicks means:

* Outcomes claims are grounded in measurable score improvement (Doc 04B scoring \+ Doc 05B mastery KPI), not in aspirational marketing  
* AI claims are grounded in LISA's actual capabilities (Doc 03 Main; LISA explains, hints, walks through; LISA is not an authoritative tutor and is disclosed as such), not in "AI-powered" buzzword marketing  
* Engagement claims are grounded in actual sustained study behavior (Doc 07's planned engagement KPIs), not in gamification-as-substance  
* Privacy claims are grounded in Lyceon's actual technical posture (Doc 07A PII redaction \+ Doc 07E retention \+ Doc 05D cascade \+ Doc 03 conversation ephemerality), not in vague "we respect your privacy" marketing  
* Pricing claims are grounded in Stripe-canonical runtime pricing (Doc 09 §5), not in "starts at" inflation patterns  
* Score-improvement testimonials are opt-in user-generated, not paid-actor patterns  
* Community claims are grounded in real community activity (Doc 08 Dimension 6 direction), not in fake-engagement metrics

The proof-over-gimmicks principle is operationalized through every Surface 1 section. It's also implicitly operationalized through Surface 2 — Lyceon's legal documents are honest about what Lyceon does (the 12-month inactivity retention; the pseudonymized ML training corpus; the LISA limitations; the AI hallucination risk; the refund policy) rather than using opaque legal-speak to obscure what Lyceon actually does with user data and money.

## **1.4 What Doc 10 is NOT, and the boundary that matters**

Doc 10 is not:

* The published privacy policy (the Privacy Policy is a separate artifact)  
* The published terms of service (the Student ToS, Parent Terms, etc. are separate artifacts)  
* The brand-design specification (no logos, colors, typography in Doc 10\)  
* The marketing campaign plan (no campaign launch dates, paid acquisition allocation, channel calendars)  
* The investor-facing brand collateral (no fundraising deck content, no board materials)  
* The B2B sales playbook (FWD-10-C V1.1+)

The boundary that matters: **Doc 10 is the spec that frames Lyceon's brand-and-trust posture \+ names the legal artifacts to produce. The legal artifacts themselves are separate documents drafted to industry-grade legal-quality standard.** The Privacy Policy artifact delivered alongside Doc 10 V1 is the first such artifact; remaining artifacts are produced in Phase 2 delivery cycles per the three-phase delivery program (Phase 1 \= Doc 10 spec \+ Privacy Policy; Phase 2 \= remaining 19 legal artifacts; Phase 3 \= engineering integration with frontend acceptance flow).

---

# **§2 — Scope & Boundary**

## **2.1 In scope**

Doc 10 V1 covers:

| Surface | Section | Coverage |
| ----- | ----- | ----- |
| 1 | §4 | Proof-over-gimmicks principle as load-bearing brand posture |
| 1 | §5 | EdTech competitive landscape (Khan Academy, Duolingo, Princeton Review, Kaplan, Magoosh, Test Ninjas, Bluebook/College Board) \+ Lyceon positioning |
| 1 | §6 | Public-facing analytics surfaces direction |
| 1 | §7 | Social-proof framework and testimonial direction |
| 1 | §8 | Community direction and LISA-as-public-voice (Doc 08 Dimension 6 reference) |
| 2 | §9 | Pre-launch legal-document inventory (20 documents across 6 categories) |
| 2 | §9.1–§9.20 | Per-document directional summary \+ launch-readiness status |
| 2 | §10 | W7 launch-gating discipline \+ Doc 07E dependency closure |
| 2 | §11 | Legal-document program coordination |
| both | §12 | Conventions adopted |
| both | §13 | Acceptance criteria |
| both | §14 | Change records |
| both | §15 | Closing |

## **2.2 Out of scope**

Decision-5 reference discipline applies — Doc 10 references canonical owners and does not restate. Out of Doc 10 scope:

* **Doc 08 Dimension 6 channel-strategy body** — Doc 08 owns the strategic direction for QOTD, Discord, Reddit, score-progression UGC, LISA-as-social-presence, partner content, and LISA-as-content-brand long-horizon. Doc 10 references and provides the brand-and-trust interpretation only.  
* **Doc 07E retention model body** — Doc 07E owns the 12-month-inactivity → pseudonymized-retention \+ cascade policy \+ under-13 hard-delete \+ small-cell discipline. Doc 10 references for disclosure-shape only.  
* **Doc 09 financial direction body** — Doc 09 owns pricing posture, revenue recognition direction, refund direction, Stripe retention direction. Doc 10 references for disclosure-shape only.  
* **Doc 03 LISA architecture body** — Doc 03 Main owns LISA usage caps, cost discipline, conversation retention. Doc 10 references for disclosure-shape only.  
* **Doc 07A PII redaction body** — Doc 07A owns the PII redaction contract. Doc 10 references for disclosure-shape only.  
* **The actual legal-document text** — each legal document in §9's inventory is a separate artifact; Doc 10 captures only the directional summary.  
* **Brand design specification** — logos, colors, typography, design system.  
* **Marketing campaign execution** — paid channels, content schedule, influencer programs.  
* **Investor-facing brand collateral** — fundraising decks, board materials.  
* **B2B sales artifacts** — district procurement templates, MSAs, FERPA DPAs (FWD-10-C V1.1+).  
* **Public relations / press strategy** — counsel-and-founder coordination, not Doc 10 territory.

## **2.3 The "Doc 10 is unique" framing**

Per Karl 2026-05-31 direction, Doc 10 does NOT force pattern-parity with Doc 08 or Doc 09\. Specific departures:

* **No Brand/Trust Authority Hierarchy section** (the Doc 09 §1.4 Finance Authority Hierarchy analog) — Surface 1 brand direction isn't authority-validated in the way financial direction is; Surface 2 legal direction has counsel as the singular authority, captured per-document in §9 rather than as a load-bearing hierarchy section.  
* *No INV-10- invariants at V1*\* (Doc 10 has no executable contract rules to assert)  
* *No W-10- prefix*\* (no formal watch-item list — open items captured inline per-section where they live)  
* **No new audit pass introduced at V1** (no rules to prove)  
* **No §13 audit-profile elaboration parallel to Doc 09 §13** (Doc 10 has nothing to audit beyond Decision-5 reference discipline)  
* **No formal §11 cross-doc seam table** (cross-doc dependencies named inline in §1 Depends-on / Explicitly-excludes; light enough to not warrant a separate seam table)  
* **Section structure mirrors content rather than convention** — Surface 1 sections (§4–§8) read like a brand-positioning document; Surface 2 sections (§9–§11) read like a legal-program coordination document; the document tonally shifts between them and that's intentional.

What Doc 10 keeps from Doc 09 conventions: the directional register where appropriate (Surface 2's per-document directional summaries with counsel-review-gate framing); the Decision-5 reference discipline throughout; the multi-round in-lock-cycle cleanup pattern; the change record convention.

## **2.4 Age-threshold taxonomy (canonical for Doc 10 and all Phase 2 legal artifacts)**

Lyceon's legal-document program uses four distinct age-threshold concepts that must NOT be collapsed into a single "Children" definition. Each concept has a specific legal basis and a specific operational consequence; conflating them creates either over-restriction (deleting legitimate minor users) or under-protection (insufficient safeguards for users who require them).

| Concept | Threshold | Legal basis | Lyceon operational consequence |
| ----- | ----- | ----- | ----- |
| **COPPA child** | Under 13 | US Children's Online Privacy Protection Act | V1 blocks paid accounts; if detected, hard-delete-everywhere per Doc 07E §10; data excluded from AI training corpus per Doc 07E §10.6 |
| **Digital consent threshold (GDPR Article 8\)** | Varies by EU member state: 13 (UK historic), 14 (Austria), 15 (Czech, France), 16 (Ireland, Germany, Netherlands, others) | Article 8 GDPR variation per member state | Below threshold: parental/guardian consent required where consent is the legal basis for processing; **NOT automatic deletion** if valid parental consent is obtained |
| **Child-safety / age-appropriate-design user** | Under 18 | UK Children's Code (15 standards); Australia Children's Online Privacy Code (registers by Dec 10, 2026); similar emerging frameworks | Age-appropriate design obligations apply: privacy-by-default high; data minimization tailored to age; plain language; no dark patterns; child-protection-oriented service design. **NOT a deletion trigger.** |
| **Lyceon student minor** | Under 18 | Lyceon's product audience definition | Minor user; guardian consent required where applicable; Parent / Guardian Terms apply; guardian-visibility model per Doc 01 V6.0 |

**Operational rules derived from this taxonomy:**

* **Under-13 detection → hard-delete-everywhere.** This applies regardless of jurisdiction, because Lyceon's V1 posture is no under-13 paid accounts globally.  
* **13-15 in Ireland (or other jurisdictions where digital consent age \> 13\) → parental/guardian consent required.** This is NOT a deletion case if valid guardian consent is obtained. Without valid guardian consent in a jurisdiction where it is required, the account is suspended or deleted as appropriate.  
* **Under-18 in UK or Australia → age-appropriate design applies.** This is NOT a deletion trigger; it changes how Lyceon designs and discloses, not whether the user may access the Service.  
* **All minor users (13-17) → Parent / Guardian Terms apply; guardian-visibility model per Doc 01 V6.0.**

This taxonomy is canonical for Doc 10 and is the reference model for Privacy Policy, Children's Online Privacy Notice, Parental Consent Mechanism, Parent / Guardian Terms, and Student Terms of Use. Each Phase 2 legal artifact references this taxonomy rather than restating different age thresholds.

---

# **§3 — What Could Go Wrong (Risks)**

Doc 10 is directional, not contract-grade. The risks at this stage are about: (a) the brand posture losing its proof-over-gimmicks anchoring and drifting toward generic EdTech marketing, (b) the legal-document program not actually producing the artifacts before launch, and (c) the surfaces becoming inconsistent with the locked corpus or with the actual legal documents.

1. **Brand-posture drift toward generic EdTech marketing.** The risk is that Surface 1 captures aspirational claims that go beyond what Lyceon's product reality supports. "Best AI tutor" claims unsupported by outcome data; "improve scores by 200 points" claims without cohort backing; "loved by students" claims without evidence. Marketing drift is the most common EdTech brand failure mode (see Duolingo's AI-disclosure backlash per §5 analysis). *Defense:* §4 proof-over-gimmicks as load-bearing principle; §6 public-facing analytics surfaces direction grounded in actual measured outcomes; §7 social-proof framework requires opt-in user-generated content rather than paid-actor patterns.

2. **Legal documents not produced before launch.** The risk is that Doc 10 spec is locked but the actual legal artifacts in §9's inventory don't get produced before launch, leaving Lyceon launching without complete legal coverage. This is the W7 launch-gate risk applied to the full legal-document program. *Defense:* §10 launch-gating discipline names per-document launch criticality; §11 program coordination names the production-and-review process; Phase 1 produces the highest-priority artifact (Privacy Policy) alongside Doc 10 spec; Phase 2 produces the remaining 19 artifacts in subsequent cycles.

3. **Brand surface and legal surface become inconsistent.** The risk is that Surface 1 brand claims drift away from what the Surface 2 legal documents actually say. Surface 1 says "we never share data with advertisers"; Surface 2 Privacy Policy says "we share aggregated data with marketing analytics providers." Inconsistency erodes trust and creates legal exposure. *Defense:* §4 proof-over-gimmicks principle requires Surface 1 brand claims to be consistent with Surface 2 legal disclosures; §11 program coordination includes a cross-surface consistency review before each legal artifact is published.

4. **Competitive analysis drifts out of date.** The §5 competitive landscape is grounded in May 2026 research; competitors change strategy frequently. The risk is that Doc 10 V1 locks in an analysis that's stale by launch. *Defense:* §5 is captured as directional-at-time-of-lock; refresh expected as Doc 10 amendments when material competitive moves occur.

5. **Doc 07E W7 disclosure language reproduced inaccurately in Privacy Policy.** The W7 obligation declared by Doc 07E §8.3 has specific substance that must land in the published Privacy Policy: the 12-month inactivity → pseudonymized retention \+ indefinite ML-training corpus \+ legal-anonymization-upgrade-after-W5+W9 nuance. If the Privacy Policy reproduces this language inaccurately or softens it past the W7 substance, the entire 07E retention posture is non-compliant. *Defense:* Privacy Policy V1.0 lands W7 disclosure language with substantive precision; counsel reviews for accuracy before publication; FWD-07E-05 closure noted in §9.2 Privacy Policy summary.

6. **Refund policy conflict between existing drafts and Doc 09 direction.** The existing Dec 2025 ToS and Parent Terms drafts say "fees are non-refundable." Doc 09 §5.7 names a 7-day satisfaction-window direction. The conflict must be resolved in the new ToS \+ new Parent Terms \+ new standalone Refund Policy. *Defense:* §9.5 Refund Policy directional summary names the Doc 09 §5.7 reconciliation; the new Refund Policy artifact bodies the 7-day window direction; the ToS and Parent Terms artifacts reference the Refund Policy rather than restating refund mechanics.

7. **Under-13 paid-user posture not consistently disclosed across legal documents.** Lyceon V1 blocks under-13 paid users per Doc 09 §14 criterion \#6 \+ Q-09-LOCK confirmation. This posture must be disclosed consistently across Privacy Policy \+ Children's Privacy Notice \+ Parent Terms \+ ToS \+ age-verification UX language. *Defense:* §9 inventory includes a Children's Privacy Notice as a separate artifact; §11 program coordination includes cross-document under-13 consistency review.

8. **AI-content disclosure inconsistent or missing in jurisdictions where it's required.** EU AI Act Article 50 transparency obligations apply from August 2, 2026, subject to counsel verification and any transition/amendment updates (the August 2, 2026 date is the published-statutory applicability date for Article 50; the Article 5 prohibited-practices set is a separate earlier date that should not be conflated with Article 50). The Privacy Policy \+ AI Content Disclosure Notice \+ LISA in-product disclosure must collectively satisfy Article 50 substance for EU users by the applicability date. Australia's automated decision-making disclosure obligations (effective Dec 10, 2026\) and similar emerging frameworks apply parallel logic. *Defense:* §9 inventory includes a standalone AI Content Disclosure Notice; §11 program coordination includes jurisdiction-specific AI disclosure review and counsel verification of applicable dates per launch market.

9. **Cookie consent UX not compliant with EU/UK/Quebec Law 25 requirements at launch.** Cookie banner must satisfy currently applicable EU ePrivacy/GDPR, UK PECR/ICO, Quebec Law 25, and any counsel-verified EU reform requirements. One-click accept/refuse, do-not-re-ask cadence, and machine-readable browser signal respect are target implementation requirements pending counsel confirmation of the final binding text (the EU Digital Omnibus Nov 2025 proposal introduced these directions but had not, at the time of Doc 10 V1 drafting, been finalized into binding law; counsel verifies final applicability before launch). *Defense:* §9 inventory includes a Cookie Policy \+ Cookie Banner Notice as distinct artifacts; §11 program coordination includes cookie-UX validation per jurisdiction per counsel-confirmed legal text.

10. **Public-facing analytics surfaces leak PII through small-cell exposure.** Lyceon's marketing-site "students helped" counter, average score improvement aggregate, and similar public surfaces must obey Doc 07E §15 W5 small-cell guardrail (no aggregate that would enable re-identification of an individual student through low cardinality). *Defense:* §6 public-facing analytics surfaces direction explicitly requires Doc 07E §15 W5 small-cell discipline applied to any public-facing aggregate; Doc 07C §7.1 RB-09 boundary statement reaffirms that public-facing surfaces are out of 07C internal-dashboard scope and would be Doc 10's responsibility with appropriate cardinality discipline.

11. **Australia Children's Online Privacy Code applicability not addressed before Australia launch.** Per Doc 08 Dimension 2 \+ the May 2026 research, Australia's COPC (modeled on UK AADC; defines child as under-18) is being established by the Office of the Australian Information Commissioner and is to be registered by Dec 10, 2026; once registered, it applies directly to Lyceon's 13-18 user base in Australia. Australia's automated decision-making disclosure obligations also take effect Dec 10, 2026 and apply to LISA \+ mastery engine \+ scoring formula. *Counsel-check footnote — Online Safety Amendment Act (Social Media Minimum Age):* Australia's under-16 social-media ban (Online Safety Amendment Act 2024; operational Dec 2025\) does not apply to Lyceon if Lyceon is not a "social media service" as defined in the Online Safety Act, which is the expected position for an educational platform — but counsel should verify the OSA definition against Lyceon's product scope before Australia launch. *Defense:* §9 inventory includes Australia-specific compliance as part of multi-jurisdictional Privacy Policy \+ Children's Online Privacy Notice scope; per-jurisdiction provisions noted as launch-prerequisite.

12. **Ireland digital age of consent (16) not addressed before Ireland launch.** Ireland sets digital consent at 16, not 13 (per GDPR Article 8 variation). Lyceon's 13-15 Irish users may need parental consent if relying on consent as legal basis. *Defense:* §9 inventory includes Ireland-specific provisions; per Doc 07E §15 W7 launch gate, Ireland launch requires this resolution; FWD-07E-02 jurisdiction-override path applies.

---

# **§4 — Surface 1: The Proof-Over-Gimmicks Brand Posture**

## **4.1 The principle**

Lyceon's brand posture is anchored in **proof over gimmicks**. Every brand claim Lyceon makes externally must be grounded in something measurable, verifiable, or directly demonstrable through the product itself. This is the single load-bearing principle of Surface 1 because it discriminates Lyceon from the EdTech incumbents whose brand-and-trust postures (per §5 competitive analysis) rely heavily on aspirational marketing, opaque outcomes claims, and gamification-as-substance.

Proof-over-gimmicks is operationalized through five concrete dimensions:

**Outcomes proof.** Lyceon's outcomes claims are grounded in measurable score improvement using Lyceon's own scoring infrastructure (Doc 04B canonical scoring formula \+ Doc 05B canonical mastery KPI math). When Lyceon says "students improve their SAT scores with Lyceon," the claim is backed by Doc 07's planned engagement KPIs and cohort analysis — not by selected anecdotes. The marketing-site public-facing analytics surfaces direction (§6) is the operational mechanism for outcomes proof.

**AI capability honesty.** Lyceon's AI claims describe what LISA actually does (explains concepts, walks through problems, provides hints, identifies common mistake patterns) and explicitly disclose what LISA is not (an authoritative tutor, an oracle, a substitute for human instruction). The "AI-powered" buzzword pattern that characterizes Duolingo's marketing is exactly what Lyceon avoids. LISA's limitations are disclosed in the Privacy Policy \+ Student ToS \+ Parent Terms \+ AI Content Disclosure Notice; LISA's actual capabilities are demonstrated through product engagement.

**Engagement honesty.** Lyceon's engagement claims describe sustained study behavior (consecutive-day practice, hours spent, questions answered, concepts mastered) rather than gamification-as-substance (streaks, badges, leaderboards positioned as the value proposition rather than as engagement mechanics). The community direction (§8) extends this — community engagement is a tool that supports sustained study, not a substitute for actual learning.

**Privacy honesty.** Lyceon's privacy claims describe what Lyceon technically does (no raw PII in analytics events per Doc 07A; HMAC-derived opaque user\_id per Doc 07A §7; 12-month-inactivity → pseudonymized retention per Doc 07E §7; LISA conversation ephemerality per Doc 03 Main §14.2; under-13 hard-delete-everywhere per Doc 07E §10) rather than vague "we respect your privacy" marketing. The Privacy Policy artifact lands these technical disclosures in published-text form.

**Pricing honesty.** Lyceon's pricing claims describe the actual tier-structure shape (freemium \+ 3 paid tiers; monthly / multi-month / annual) and refer to Stripe-canonical runtime pricing for magnitudes (Doc 09 §5.1). The "starts at" inflation pattern (where the headline price is a tier most users won't actually buy) is exactly what Lyceon avoids. The Refund Policy is honest about the 7-day satisfaction window direction (Doc 09 §5.7) rather than using "fees are non-refundable" boilerplate that conflicts with Doc 09 direction.

## **4.2 Why proof-over-gimmicks matters specifically for Lyceon**

The EdTech market is **saturated with gimmick-heavy positioning**. Per §5 competitive analysis: Duolingo's gamification-as-substance approach has produced a product that students engage with daily but where measurable learning outcomes are contested. Princeton Review and Kaplan use "top 5% score" claims at $2,000+ price points that depend on selected-cohort marketing. Test Ninjas competes on question-volume claims without psychometric review. Bluebook (College Board direct) has institutional credibility but lacks the AI-tutor capability Lyceon offers. The market has been trained to expect gimmicky positioning, which means **proof-over-gimmicks is genuinely differentiating** — it's a brand posture that other players in the space don't credibly occupy.

Three structural advantages let Lyceon credibly hold the proof-over-gimmicks position:

**1\. The product is engineered for proof.** Lyceon's locked corpus (Doc 04B scoring; Doc 05B mastery; Doc 03 LISA; Doc 07 KPI infrastructure) is built to produce auditable outcome measurement from day one. Lyceon doesn't need to retrofit measurement after launch; the measurement infrastructure is the platform.

**2\. The privacy and data-handling posture is engineered for honesty.** Lyceon's locked corpus (Doc 07A opaque user\_id; Doc 07E retention model; Doc 05D cascade; Doc 03 conversation ephemerality) is built around technical posture that supports the strongest possible privacy disclosures. Competitors who built their products without this posture (Duolingo per §5) cannot credibly make the same privacy claims even if they wanted to.

**3\. The pricing and refund posture is engineered for transparency.** Lyceon's Doc 09 §5 freemium-plus-three-paid-tiers shape is straightforward; Stripe canonicity at runtime prevents pricing-page drift; the Doc 09 §5.7 refund direction is consumer-friendly. The "starts at $X" inflation pattern competitors use is structurally not available to Lyceon because the actual tier structure is honest.

## **4.3 The brand voice direction**

Lyceon's brand voice direction is **trustworthy, patient, pedagogically rigorous, AI-honest** — the same voice LISA embodies inside the product extended to the brand surface. This is consistent with Doc 08 Dimension 6's "LISA-as-content-brand" long-horizon direction: the brand voice the audience encounters across marketing channels is the same voice they encounter inside the product. Brand consistency becomes brand authenticity because the voice is the product.

Specific brand-voice characteristics:

* **Clear over clever.** Marketing copy describes what Lyceon does and why it works in plain language. No clever taglines that obscure substance.  
* **Honest about limits.** When LISA can't do something (write essays, take exams, replace human tutoring), the brand voice says so. When Lyceon doesn't guarantee score improvement (no EdTech product can), the brand voice says so.  
* **Pedagogically rigorous.** Marketing content reflects actual learning science (spaced repetition, retrieval practice, error-correction-via-explanation) rather than gamification tropes.  
* **Respectful of students.** The audience is 13-18 students who are stressed about a high-stakes exam. Brand voice treats them as capable young adults navigating real pressure, not as targets for engagement gimmicks.  
* **Respectful of parents.** Parent-facing communications acknowledge that parents have real concerns about AI, data privacy, and screen time. Brand voice addresses these directly rather than handwaving past them.

---

# **§5 — Surface 1: EdTech Competitive Landscape and Lyceon Positioning**

## **5.1 The competitive landscape at Lyceon's launch moment**

Lyceon enters a competitive landscape with seven materially relevant players, each occupying a distinct positioning that informs Lyceon's differentiation. The landscape was researched during Doc 10 V1 drafting in May 2026; competitive positioning shifts frequently and Doc 10 amendments should refresh this section when material moves occur.

**Khan Academy \+ Bluebook (College Board direct).** The credibility-and-free leg. Khan Academy partnered with College Board years ago to offer official SAT prep at no cost; Bluebook is the College Board's own digital SAT platform. Combined, these are the institutional incumbents with the strongest credibility signal. Khan Academy has invested significantly in Khanmigo (their AI tutor) with strong privacy posture — separate Privacy Policy \+ Children's Privacy Policy \+ DPA \+ COPPA Help Center article; AI moderation flagging self-harm and harmful language; daily interaction limits; parent/teacher chat-log visibility; explicit "do not store images" disclosures. This is the gold-standard institutional reference for AI-tutor disclosure quality. **Lyceon's positioning relative to this leg:** Lyceon is not free, but Lyceon's outcomes proof \+ AI honesty \+ product polish \+ community-and-content engine target an audience willing to pay for a meaningfully better experience than free.

**Princeton Review and Kaplan.** The premium-incumbent leg. Both run $600–$2,000+ price points for SAT courses \+ tutoring; both have decades of brand credibility; both have integrated AI into their offerings (Princeton Review's "AI for Learning" suite won industry awards). Their privacy posture is standard enterprise EdTech — California-specific notices, CCPA "Do Not Sell or Share" links, opt-out signal honored. Their AI integration is incremental rather than central to product identity. **Lyceon's positioning relative to this leg:** dramatically lower price point (the Doc 09 tier-structure shape vs $2,000+ courses); AI-native architecture rather than AI-incremental; engineered measurement infrastructure rather than marketing-claim-based outcomes.

**Duolingo.** The gamification-leader-with-AI-disclosure-problems leg. Duolingo is the most-recognized brand in language learning and has expanded into SAT prep via standalone Duolingo English Test. Their gamification approach has produced massive consumer adoption but increasing AI-ethics scrutiny — undisclosed AI training on user data, opaque children's privacy compliance, advertising-network data sharing per Common Sense Privacy Evaluation. The Medium analysis cited in research framed Duolingo as a "cautionary tale" rather than a model. **Lyceon's positioning relative to this leg:** opposite end of the spectrum — gamification-as-tool (not gamification-as-substance); explicit AI training disclosure; no advertising-network data sharing; transparent privacy posture. Where Duolingo represents the engagement-first-at-any-cost approach, Lyceon represents the outcomes-first-with-engagement-as-mechanism approach.

**Magoosh.** The mid-market structured-learning leg. Magoosh sits between the free institutional incumbents (Khan Academy / Bluebook) and the premium incumbents (Princeton Review / Kaplan) at a moderate price point. Their differentiation is structured curriculum \+ video lessons \+ practice questions. Their AI integration is minimal compared to Khanmigo. **Lyceon's positioning relative to this leg:** similar price-point band, AI-native architecture as differentiator, modern UX/UI as differentiator.

**Test Ninjas.** The volume-of-questions leg. Test Ninjas positions around large question banks at low price points. Tutors recommend it as supplementary drilling material rather than primary diagnostic. No emphasis on adaptive learning or AI tutoring. **Lyceon's positioning relative to this leg:** dramatically different — Lyceon is psychometrically reviewed questions \+ LISA-explained \+ mastery-engine-adaptive, not raw-volume drilling.

**The Reddit r/SAT pseudo-incumbent.** Reddit's r/SAT community is a meaningful informal incumbent — students help each other, share resources, discuss strategies, recommend products. This is where word-of-mouth among SAT students actually happens; this is also where Lyceon will need to build organic credibility through real value contribution (per Doc 08 Dimension 6 Reddit direction) rather than astroturfing. **Lyceon's positioning relative to this leg:** Lyceon participates as a credible community member contributing real value (LISA-style explanations of complex questions, study-strategy content, exam-day advice) rather than as a corporate-marketing presence. The dual-shape Doc 08 names (organic team posts on r/SAT as named individuals \+ branded subreddit) is the operational direction.

**Google Gemini SAT practice tests (free).** A new entrant — Gemini began offering free full-length SAT practice tests in January 2026, with content vetted through Princeton Review for realism. This is a credibility-borrowing approach: Google's distribution \+ Princeton Review's content. **Lyceon's positioning relative to this leg:** Lyceon's adaptive mastery engine \+ LISA-tutor \+ measurement infrastructure are differentiation that free practice tests don't address — practice tests measure where you are; Lyceon adapts to where you are and helps you get to where you need to be. The competitive shape is "free practice diagnostic" vs "paid adaptive learning platform" — different products serving different user moments.

## **5.2 Lyceon's positioning summary**

The competitive map suggests Lyceon's positioning as **the AI-native SAT-prep platform that takes outcomes seriously without taking your data carelessly**. Four anchor points:

**1\. AI-native, not AI-incremental.** Lyceon's product architecture is built around LISA \+ mastery engine \+ scoring formula as core platform mechanics, not retrofitted as features. This differentiates from Princeton Review / Kaplan (AI-incremental) and from Test Ninjas / Magoosh (limited AI).

**2\. Outcomes-engineered, not marketing-claimed.** Lyceon's measurement infrastructure (Doc 07 KPIs \+ Doc 05B mastery \+ Doc 04B scoring) produces auditable outcomes from day one. Public-facing analytics surfaces (§6) make outcomes visible in a privacy-respecting way. This differentiates from all incumbents whose outcome claims depend on selected-cohort marketing rather than infrastructure.

**3\. Privacy-rigorous and AI-honest, not opaque.** Lyceon's locked technical posture (no raw PII in events; HMAC opaque user\_id; 12-month inactivity retention; pseudonymized ML training corpus; LISA conversation ephemerality; under-13 hard-delete) allows the strongest possible privacy and AI-transparency disclosures. This differentiates from Duolingo (privacy criticism \+ AI-disclosure problems) and most competitors who use boilerplate privacy language.

**4\. Accessibly priced \+ transparently structured, not premium-inflated.** Lyceon's Doc 09 freemium-plus-three-paid-tiers structure with Stripe canonical runtime pricing is dramatically more accessible than $600–$2,000+ Princeton Review / Kaplan courses while providing AI-native learning that free options (Khan Academy / Bluebook / Gemini) don't.

Together, these four anchor points are not just positioning claims — they're claims the locked corpus actually supports. The proof-over-gimmicks principle is operationalized through positioning that's grounded in real product reality.

---

# **§6 — Surface 1: Public-Facing Analytics Surfaces Direction**

## **6.1 What public-facing analytics surfaces are**

Public-facing analytics surfaces are the marketing-site surfaces that display Lyceon's outcomes data publicly — counters, aggregates, social-proof visualizations that demonstrate Lyceon's scale and effectiveness without exposing individual student data. Per Doc 07C V1.0 §7.1 \+ RB-07C-V1-09, these surfaces are explicitly out of 07C internal-dashboard scope and would belong to Doc 10 if introduced. Doc 10 V1 directionally captures the surfaces Lyceon plans for launch.

## **6.2 The launch direction: four public-facing surfaces**

Four public-facing analytics surfaces directionally planned for launch:

**1\. Students-Helped Counter.** A counter on the marketing homepage showing the cumulative number of unique students who have used Lyceon. The metric is `count(distinct analytics_user_id)` from the Doc 07A event stream; updated daily; no real-time precision needed. This is a scale-credibility signal that grows monotonically. Cardinality discipline per Doc 07E §15 W5 applies — the metric is "unique users ever" not "unique users by demographic," so re-identification risk is structurally low.

**2\. Average Score Improvement Aggregate.** An aggregate showing the average SAT score improvement of Lyceon users who completed a defined practice arc (e.g., users who took a baseline diagnostic and a follow-up diagnostic at least 30 days later). Computed from Doc 04B scoring events. Reported as "average improvement of X points among students who completed \[defined arc\]" with the cohort definition transparent. Cardinality discipline requires minimum cohort size (e.g., n≥100) before any score-improvement aggregate is published, with per-cohort small-cell discipline applied if any sub-aggregate (by score band, by exam-date cohort, by tier) is exposed.

**3\. Total Questions Answered Counter.** A counter showing cumulative practice questions answered across the platform. Computed from Doc 07A practice-class events. This is a platform-activity signal that demonstrates real usage. Cardinality discipline is structurally trivial — total platform volume reveals nothing about individuals.

**4\. LISA Conversations Counter (Conditional).** A counter showing cumulative LISA tutor conversations. Computed from Doc 07A tutor-class events. Cardinality discipline is structurally trivial. **Conditional** because per Doc 03 Main §14.2 LISA conversation retention discipline \+ Doc 07E privacy posture, the metric must be from Doc 07A BI-side events (which are ephemeral observation records of conversation events), not from LISA conversation content itself. The published counter is "how many conversations happened," not "what was said in them."

## **6.3 Public-facing surfaces NOT planned for V1**

Surfaces NOT planned for V1 launch:

* Per-school / per-region / per-demographic outcome aggregates (cardinality discipline harder; not needed for V1 brand-trust)  
* Live "students online now" counter (engagement-theater rather than outcomes proof; not aligned with proof-over-gimmicks)  
* Per-student score-progression visualizations in any public form (privacy violations even with consent; out of scope)  
* LISA conversation excerpts as social proof (LISA conversations are conversations, not marketing collateral; not used in public-facing surfaces)

## **6.4 The privacy-and-cardinality discipline**

Every public-facing analytics surface must satisfy:

* **Doc 07E §15 W5 small-cell discipline.** Any aggregate that could enable re-identification of an individual through low cardinality is not published. Minimum cohort sizes per Doc 07E §15 W5; no aggregates below the threshold.  
* **Doc 07A §8 PII redaction inheritance.** Surfaces consume Doc 07A events which are already PII-redacted; surfaces add no PII back.  
* **Doc 07E §10.6 under-13 ML-exclusion invariant.** Under-13 user data is excluded from all training-data uses; under-13 events do not flow into public-facing analytics either (the cleaner posture).  
* **Update cadence appropriate to non-real-time precision.** Counters and aggregates update daily or less frequently; no real-time precision that could enable timing-based re-identification.  
* **Reproducibility for audit.** The methodology behind each counter/aggregate is documented and auditable; any external claim about the public surfaces can be traced back to the underlying methodology.

## **6.5 V1.1+ public-facing analytics direction**

Future public-facing surfaces noted as V1.1+ direction (FWD-10-D):

* Per-exam-date-cohort outcome aggregates (when exam-date cohort populations are large enough for cardinality discipline)  
* Score-band-specific improvement aggregates (when score-band populations are large enough)  
* Geographic outcome aggregates (when international launch markets activate per Doc 08 Dimension 2\)  
* LISA-effectiveness aggregates (when measurement methodology for "LISA helped" is bodied per Doc 07's KPI-TUT-02 placeholder)

V1.1+ surface activation requires Doc 10 amendment \+ Doc 07E §15 W5 cardinality validation per surface \+ counsel review of any disclosure language attached to the surface.

---

# **§7 — Surface 1: Social-Proof Framework and Testimonial Direction**

## **7.1 The opt-in user-generated principle**

Lyceon's social-proof framework is built on **opt-in user-generated content**, not on paid-actor patterns or aspirational marketing claims that fail proof-over-gimmicks. Three structural principles:

**1\. Opt-in only.** Students who improve their scores can opt-in to share Lyceon-generated progression visualizations to their own social media. No automatic posting; no opt-out mechanism that requires action to disable; explicit per-share consent. The Doc 08 Dimension 6 "score-progression sharing as user-generated content" direction is the canonical channel-strategy framing; Doc 10 §7 bodies the brand-and-trust interpretation.

**2\. Lyceon-generated visualizations.** Lyceon produces the visualization (clean, branded, screenshot-able graphics that turn the testimonial pattern into something the student wants to share because it celebrates their accomplishment); the student chooses whether to share. Lyceon does not paid-promote any user-generated content nor compensate students for sharing.

**3\. Verifiable underlying outcomes.** Every shared score-progression visualization is backed by Lyceon's actual scoring infrastructure — the displayed scores correspond to real Doc 04B-scored diagnostics. No fictionalized improvements; no aspirational projections. The visualizations are records, not pitches.

## **7.2 Testimonial direction**

Beyond score-progression UGC, Lyceon's testimonial direction includes:

**Written testimonials.** Opt-in collection from students who voluntarily provide testimonials about their Lyceon experience. Used on marketing site with student consent and demographic representation discipline (testimonials should represent the actual Lyceon user base — diverse score bands, demographics, exam contexts — not selected-best-case patterns).

**Case studies — V1.1+ only.** Deeper case studies (student journey from baseline diagnostic through final exam result with study-pattern detail) are V1.1+ work. V1 sticks to score-progression UGC \+ written testimonials because case studies require operational data accumulation \+ heavier consent discipline \+ counsel review.

**LISA-conversation excerpts.** Not used in social proof or testimonials. LISA conversations are private learning interactions, not marketing collateral.

**Outcomes claims grounded in §6 public-facing surfaces.** Marketing-site claims like "Lyceon students improve their SAT scores by an average of X points" must be backed by the §6 Average Score Improvement Aggregate methodology. If the aggregate isn't large enough yet to support the claim (per the Doc 07E §15 W5 cardinality discipline), the claim isn't made until it is.

## **7.3 Demographic representation discipline**

Social-proof and testimonial direction includes explicit demographic representation discipline:

* Testimonials should reflect the diversity of Lyceon's actual user base (across score bands, demographics, geographic contexts, exam-date cohorts)  
* Marketing imagery showing student users represents diverse identity (race, gender, socioeconomic context, geography) rather than a narrowly aspirational subset  
* Score-progression UGC selection (which user-generated stories Lyceon amplifies on Lyceon-owned channels with student consent) follows the same diversity discipline

This is not just an inclusion principle (though it is that) — it's also a proof-over-gimmicks principle. If Lyceon claims to help "students preparing for the SAT," the testimonial set should reflect what that audience actually looks like, not a selected-best-case marketing subset.

---

# **§8 — Surface 1: Community Direction and LISA-as-Public-Voice**

## **8.1 The boundary: Doc 08 Dimension 6 owns; Doc 10 interprets**

Doc 08 Dimension 6 ("Channel and Community Strategy") canonically owns Lyceon's channel and community direction — QOTD content engine, Discord community, Reddit presence, score-progression UGC, LISA-as-social-presence, partner content, and LISA-as-content-brand long-horizon. Doc 10 §8 does NOT restate Doc 08 Dimension 6 content; Doc 10 §8 bodies the **brand-and-trust interpretation** of channel mechanics — how QOTD reinforces trust, how Discord supports brand voice, how LISA-as-social-presence sustains the proof-over-gimmicks principle.

This is structurally similar to the Doc 09 ↔ Doc 06E boundary: Doc 06E owns the cost-measurement bodies; Doc 09 owns the financial interpretation of those bodies. Here Doc 08 owns the channel-strategy bodies; Doc 10 owns the brand-and-trust interpretation of those channels.

## **8.2 QOTD as proof-over-gimmicks operationalized**

Doc 08 Dimension 6's Question of the Day direction is the most load-bearing channel mechanic for Doc 10's brand-and-trust interpretation. QOTD is Lyceon's product, sampled — a moment of the actual Lyceon experience, free, delivered to where the audience already is. This is proof-over-gimmicks at channel-strategy scale: instead of marketing the product, Lyceon distributes the product itself as the marketing.

Brand-and-trust implications:

* Every QOTD published builds trust because the audience experiences Lyceon's actual quality before any purchase decision  
* LISA's explanation of each QOTD demonstrates LISA's pedagogical voice publicly; this is brand voice consistency between in-product and in-channel  
* The cumulative QOTD library becomes a credibility asset over time — months of high-quality SAT-style questions with LISA explanations is a moat that competitors can't replicate by buying ads  
* QOTD-as-proof is also the operational mechanism for the Doc 08 long-horizon "LISA-as-content-brand" direction — the same LISA voice the audience encounters daily in QOTD extends naturally to fuller content surfaces

## **8.3 Discord community as brand-and-trust amplifier**

Doc 08 Dimension 6's Discord community direction creates a hosted community where students prepare for the SAT together. Brand-and-trust implications:

* The community is a credibility surface: prospective students discover Lyceon through real student interaction, not through advertising  
* The community is a trust-retention surface: paying students stay engaged with Lyceon through peer interaction, increasing trust in continued engagement  
* The community is a long-term moat: community lock-in is durably sticky in a way subscription-only products aren't  
* The community is also a brand-voice consistency check: if LISA's pedagogical voice doesn't fit the community context, the community surfaces it quickly (and Lyceon adjusts), creating a fast feedback loop between brand voice and audience reception

## **8.4 LISA-as-public-voice direction**

Doc 08 Dimension 6's "LISA as social-media presence" \+ "LISA as content brand" long-horizon direction extends LISA's pedagogical voice into Lyceon's public-facing channels. Brand-and-trust implications:

* **Brand familiarity before conversion.** Prospective students trust LISA before they sign up because they've been watching LISA explain things on social media for weeks. Conversion friction collapses because the relationship is pre-built.  
* **Brand voice consistency.** The voice the audience encounters externally is the same voice they encounter inside the product. There's no gap between "marketing LISA" and "product LISA" because there's only one LISA.  
* **Brand voice authenticity.** LISA's pedagogical register (patient, explanatory, rigorous, AI-honest) is naturally the right brand voice for an EdTech product targeting stressed teenagers. The brand voice the audience trusts is the brand voice the product delivers.  
* **Brand voice scalability.** As Lyceon expands product surface and geography, the LISA voice scales with the product. Localizing LISA's voice for a new market doesn't require building a new brand voice from scratch — it requires localizing the existing one.

The long-horizon "LISA-as-content-brand" possibility (Doc 08 Dimension 6 years 3-7 direction) makes LISA the trusted voice in the test-prep landscape: the one voice across SAT prep, exam-day strategy, admissions advice, study methodology that students return to. If this works, the proprietary asset Lyceon owns isn't the SAT-prep product — it's LISA. Brand value compounds because the proprietary content asset gets stronger over time, audience trust accumulates, and the channels are owned rather than rented.

## **8.5 What community direction is NOT at V1**

Doc 08 Dimension 6 names community direction as part of the years-1-3 trajectory — the question-of-the-day content engine and Discord/Reddit community footprint are established from early-stage rather than retroactively. Doc 10 V1 directionally captures this as launch-phase work, with full operational activation as V1.1+ infrastructure:

* V1 \= QOTD content engine direction locked \+ content production pipeline planning  
* V1 \= Lyceon-owned Discord server creation \+ initial topic-channel structure  
* V1 \= Lyceon team presence on r/SAT as named individuals contributing real value  
* V1.1+ (FWD-10-A) \= full community infrastructure activation — branded subreddit, exam-date cohort channels, AMA events, score-progression UGC pipeline, LISA-as-social-presence full activation, partner-tutor content distribution program, LISA-as-content-brand long-horizon

V1.1+ direction proceeds incrementally per Doc 08 Dimension 6 years-1-3 trajectory; not all community infrastructure activates at launch.

---

# **§9 — Surface 2: Pre-Launch Legal-Document Inventory**

## **9.1 The inventory**

Lyceon's pre-launch legal-document program consists of **20 distinct documents across 6 categories**. The inventory is derived from (a) Lyceon's locked-corpus disclosure obligations (Doc 07E W7 \+ Doc 09 §5.7 \+ Doc 01 V6.0 guardian model \+ Doc 03 LISA disclosure \+ Doc 04 AI scoring), (b) multi-jurisdictional legal requirements for Lyceon's Doc 08 Dimension 2 launch markets (US federal \+ US state patchwork \+ EU/GDPR \+ UK \+ Canada \+ Australia \+ NZ \+ Singapore \+ Ireland), and (c) industry-grade EdTech standard practice as researched in May 2026 across Khan Academy, Princeton Review, Kaplan, Magoosh, Duolingo, and Test Ninjas.

**Counting reconciliation:** The inventory table below numbers rows 1 through 20 (twenty rows \= twenty distinct documents). The per-document directional summaries are numbered §9.2 through §9.21 (twenty summaries; §9.1 is the inventory header itself, so summary numbering offsets by one from row numbering). Both counts equal 20 documents; the §-numbering offset is convention not a counting error.

| \# | Category | Document | Launch-readiness status |
| ----- | ----- | ----- | ----- |
| 1 | Core Consumer Policies | Privacy Policy | **Drafted as separate artifact this delivery cycle (Phase 1\)** |
| 2 | Core Consumer Policies | Student Terms of Use | Phase 2 (existing Dec 2025 draft requires substantial revision) |
| 3 | Core Consumer Policies | Parent / Guardian Terms | Phase 2 (existing Dec 2025 draft requires substantial revision) |
| 4 | Core Consumer Policies | Honor Code | Phase 2 (existing Dec 2025 draft solid; minor refresh) |
| 5 | Core Consumer Policies | Community Guidelines | Phase 2 (existing Dec 2025 draft solid; minor refresh) |
| 6 | Subscription & Billing | Refund Policy | Phase 2 (not yet drafted; resolves Doc 09 §5.7 conflict with existing drafts) |
| 7 | Subscription & Billing | Subscription / Auto-Renewal Notice | Phase 2 (not yet drafted; California ARL \+ EU consumer-protection requirements) |
| 8 | Subscription & Billing | Acceptable Use Policy | Phase 2 (not yet drafted; consolidates scattered coverage in Honor Code \+ Community Guidelines \+ ToS) |
| 9 | Privacy & Data Protection (Cookies) | Cookie Policy | Phase 2 (not yet drafted; EU/UK/Quebec Law 25 compliance) |
| 10 | Privacy & Data Protection (Cookies) | Cookie Banner / Consent Notice | Phase 2 (not yet drafted; one-click accept/refuse target per EU Digital Omnibus Nov 2025 proposal, pending counsel verification of binding text) |
| 11 | Privacy & Data Protection (Jurisdictional) | California Notice at Collection | Phase 2 (not yet drafted; CCPA/CPRA-specific) |
| 12 | Privacy & Data Protection (Jurisdictional) | California Do Not Sell or Share Notice | Phase 2 (not yet drafted; CCPA/CPRA-specific) |
| 13 | Privacy & Data Protection (Children) | Children's Online Privacy Notice | Phase 2 (not yet drafted; separate COPPA-specific direct notice) |
| 14 | Privacy & Data Protection (Children) | Parental Consent Mechanism | Phase 2 (not yet drafted; clickwrap acceptance flow language for guardian role per Doc 01 V6.0) |
| 15 | AI Transparency | AI Content Disclosure Notice | Phase 2 (not yet drafted; EU AI Act Article 50 transparency applicable from August 2, 2026 \+ LISA-specific disclosure) |
| 16 | Data Processing | Data Processing Agreement (DPA) | Phase 2 (not yet drafted; EU GDPR \+ Quebec Law 25 \+ UK GDPR; B2B/enterprise expectation) |
| 17 | Data Processing | Sub-Processor List | Phase 2 (not yet drafted; standalone for transparency; DPA appendix) |
| 18 | Data Processing | Data Retention Schedule | Phase 2 (not yet drafted; bodies Doc 07E retention model \+ Doc 09 §9 Stripe retention) |
| 19 | Accessibility & Marketing | Accessibility Statement | Phase 2 (not yet drafted; ADA/WCAG conformance) |
| 20 | Accessibility & Marketing | Marketing Communications Consent | Phase 2 (not yet drafted; opt-in for marketing emails/SMS) |

Phase 2 production order is captured in §11 program coordination; the order is driven by launch-criticality \+ dependency chains, not by inventory ordering.

## **9.2 Privacy Policy (W7 launch-gate; drafted Phase 1\)**

**What it is.** Lyceon's comprehensive privacy policy disclosing how Lyceon collects, uses, stores, shares, and protects personal data. The single most load-bearing legal document for Lyceon because (a) it closes the Doc 07E W7 launch gate, (b) it grounds every other privacy-adjacent legal document, and (c) it's the primary trust-signal artifact for prospective users and parents.

**Why Lyceon needs it.** Mandatory under every applicable privacy law (CCPA, every state comprehensive privacy law, GDPR, UK GDPR, PIPEDA, Quebec Law 25, Australian Privacy Principles, NZ Privacy Act, Singapore PDPA, COPPA implementation). Doc 07E W7 specifically names Privacy Policy publication as one of the two external sign-offs (alongside W9 counsel sign-off) that must close before Doc 05D's pseudonymized-retention path enables in production. Until W7 closes, Doc 05D ships in fallback hard-delete mode and Lyceon loses the ML training corpus from day 1\.

**What it directionally covers.** Information collected (account, learning, technical, billing); how Lyceon uses information (operate platform, personalize learning via mastery engine, improve AI quality via the pseudonymized ML training corpus, safety/security/fraud prevention, communications); third-party service providers and sub-processors (Supabase, Stripe, PostHog at launch, Vertex AI for LISA, Google Cloud Platform); children's privacy (COPPA under-13 hard-delete posture; Ireland 16+ digital consent special handling; Australia COPC compliance); the 12-month-inactivity → pseudonymized-retention model (W7-named disclosure language per Doc 07E §8.3); Stripe 7-year financial-records retention (Doc 09 §9.2 directional disclosure); LISA conversation handling (Doc 03 Main §14.2); user rights (access, deletion via 7-day soft-delete \+ Doc 05D cascade, correction, portability, opt-out where applicable); cookies and tracking technologies (high-level; detailed in standalone Cookie Policy); international users \+ cross-border data transfers (US-operated; transfers to EU/UK adequacy assumed pending counsel; Quebec Law 25 TIA noted); changes to the policy; contact information.

**Doc 07E §8.3 W7 disclosure language requirement.** Lands the substantive disclosure: "Lyceon retains pseudonymized records of platform interactions indefinitely for product improvement and AI model training. Personal information is retained for 12 months from last activity and then deleted. Pseudonymized retained records are subject to safeguards under personal-data protections. Cardinality-aware bucketing is V1.1+ work pending legal counsel review of post-EDPB anonymization guidelines, after which the legal status may be upgraded to anonymized."

**Launch-readiness:** DRAFTED (this delivery cycle, Phase 1). Awaiting counsel review per Doc 07E §15 W7 \+ W9. **Spec-side closure of FWD-07E-05 at Doc 10 V1; operational W7 closure requires counsel-reviewed Privacy Policy publication.**

## **9.3 Student Terms of Use**

**What it is.** The contractual agreement between Lyceon and student users (13+ per Lyceon's V1 age-gating posture per Doc 09 §14 criterion \#6) governing access and use of the platform.

**Why Lyceon needs it.** Mandatory legal artifact for any consumer SaaS. The existing Dec 2025 draft is solid in structure but requires substantial revision to (a) reconcile refund language with Doc 09 §5.7 (existing draft says "fees are non-refundable" — conflicts with Doc 09 7-day window direction), (b) reference the now-canonical LISA architecture (Doc 03), (c) update AI hallucination disclosure to current best practice (Princeton Review / Khan Academy reference), (d) reference Honor Code by name, (e) update jurisdiction-specific dispute resolution (arbitration \+ class action waiver standard; governing law clause needed), (f) reference the canonical Privacy Policy by name with cross-reference discipline.

**What it directionally covers.** Service description; eligibility and age requirements (13+ at V1 with explicit V1 blocks under-13 paid users posture); account responsibility; acceptable use; AI tutor disclosure and safety expectations; honor code by reference; intellectual property (Lyceon-owned content \+ user-content licensing); subscriptions and billing (referencing Refund Policy by name; no refund language inline); termination conditions; limitation of liability \+ warranty disclaimer; dispute resolution (arbitration \+ class action waiver); changes to terms; contact information; governing law.

**Launch-readiness:** Existing Dec 2025 draft requires substantial revision. Phase 2 production.

## **9.4 Parent / Guardian Terms**

**What it is.** The contractual agreement between Lyceon and a parent/guardian who provides consent for a minor's use of Lyceon. Per Doc 01 V6.0 guardian trust model \+ the V1 13+ age-gating posture, this applies to guardian users of 13-17 minors (and to 16+ users in Ireland where digital age of consent is 16).

**Why Lyceon needs it.** Mandatory clickwrap when the user is a minor. Closes the parental/guardian consent loop required under Article 8 GDPR (where parental consent is required at the applicable digital-consent threshold per §2.4 age-threshold taxonomy) and is operationally consistent with COPPA in Lyceon's V1 posture (Lyceon does not implement a COPPA-grade "verifiable parental consent" mechanism — that term of art is reserved for FTC-approved VPC methods; Lyceon's posture is to block under-13 paid accounts and hard-delete-everywhere if a user is detected under-13, per §2.4 \+ Doc 07E §10). The existing Dec 2025 draft is solid in structure but requires (a) refund-language reconciliation (same conflict as ToS), (b) guardian-visibility language reflecting Doc 01 V6.0 guardian trust model precisely, (c) Stripe billing-on-deletion language reflecting Doc 09 §9.4 direction (cancel-at-period-end, not silent billing), (d) updated indemnification \+ limitation of liability language reviewed for multi-jurisdiction, (e) age-threshold taxonomy alignment per §2.4.

**What it directionally covers.** Role of parent/guardian (legal authority \+ duty to monitor); educational purpose disclaimer (Lyceon does not guarantee outcomes); age eligibility \+ child protection (V1 13+ posture \+ under-13 hard-delete posture if a minor is identified under-13); AI content limitations \+ parent acknowledgment; academic integrity \+ parent acknowledgment of misuse risk; account responsibility; payment \+ subscription \+ billing responsibility (referencing Refund Policy \+ Subscription Notice by name); data collection \+ privacy (referencing Privacy Policy by name); content ownership; prohibited conduct; indemnification; limitation of liability; arbitration \+ class action waiver; changes to terms; contact information.

**Launch-readiness:** Existing Dec 2025 draft requires substantial revision. Phase 2 production.

## **9.5 Honor Code**

**What it is.** Student-facing statement of academic integrity expectations and AI-responsible-use principles.

**Why Lyceon needs it.** Sets expectation about how Lyceon is used (learning tool, not assignment-shortcut) and how AI is used responsibly. Important for school-district procurement reviews (per the SETDA EdTech Quality Indicators discussed in research). Existing Dec 2025 draft is solid; minor refresh expected for V1.

**What it directionally covers.** Learn honestly principle; academic integrity expectations (no live exams, no AI-as-author for assignments); AI responsible use; respectful interaction expectations; platform protection (no scraping/exploitation); reporting violations; consequences of violations; commitment statement. Implementation note about onboarding checkbox \+ timestamp logging at acceptance is canonical and carries over.

**Launch-readiness:** Existing Dec 2025 draft solid; minor refresh in Phase 2\.

## **9.6 Community Guidelines**

**What it is.** Statement of expected behavior in any Lyceon community/social/leaderboard feature.

**Why Lyceon needs it.** Sets behavior expectations for community/social features (Discord, leaderboards, future community-of-practice surfaces per Doc 08 Dimension 6). Important for child-safety posture (Children's Code, Australia COPC). Existing Dec 2025 draft is solid; minor refresh for V1.

**What it directionally covers.** Respectful interaction \+ authenticity; appropriate content (no explicit/violent/self-harm content; no PII oversharing); AI responsible use; academic integrity / no cheating; platform protection; reporting; enforcement and monitoring; updates.

**Launch-readiness:** Existing Dec 2025 draft solid; minor refresh in Phase 2\.

## **9.7 Refund Policy**

**What it is.** Standalone published refund policy bodying Doc 09 §5.7 directional refund posture.

**Why Lyceon needs it.** California Automatic Renewal Law (ARL) requires clear refund and cancellation disclosure; EU consumer protection (14-day distance-selling withdrawal right) requires it; Quebec consumer-protection has similar; UK has similar. Existing Dec 2025 drafts of ToS \+ Parent Terms say "fees are non-refundable" which directly conflicts with Doc 09 §5.7's 7-day satisfaction-window direction. The standalone Refund Policy resolves the conflict — it bodies Doc 09's direction in published-text form, and the ToS \+ Parent Terms reference the Refund Policy by name rather than restating refund mechanics inline.

**What it directionally covers.** Satisfaction guarantee window (7-day per Doc 09 §5.7 direction); cancellation mechanics; auto-renewal handling; chargeback handling; international jurisdiction-specific provisions (EU 14-day withdrawal; California ARL; Quebec); refund processing timeline; how to request a refund; contact for billing issues. **Notably:** the policy is honest about the actual refund posture rather than using "fees are non-refundable" as a default that conflicts with consumer expectation and with Doc 09 direction.

**Launch-readiness:** Not yet drafted. Phase 2 production; high priority because it resolves an existing-draft conflict and is launch-relevant.

## **9.8 Subscription / Auto-Renewal Notice**

**What it is.** Notice presented at billing flow \+ standalone-page form disclosing recurring-charge terms with explicit consumer acknowledgment.

**Why Lyceon needs it.** California ARL requires affirmative consent to auto-renewal terms in a specific disclosed form (acknowledgment must be separate from broader ToS acceptance per California Business and Professions Code §17602). EU consumer-protection (Modernisation Directive 2019/2161) has parallel requirements. Multiple US states have ARL-equivalent rules. This is operationally an in-billing-flow disclosure UX with a standalone-page reference, not just a static document.

**What it directionally covers.** Subscription terms; recurring-charge amount \+ cadence (referencing Stripe-canonical runtime pricing per Doc 09 §5.1); how to cancel; refund-window cross-reference; affirmative acknowledgment requirement; California-specific \+ EU-specific provisions; reminder-notice cadence (California ARL requires periodic reminder for long auto-renewals).

**Launch-readiness:** Not yet drafted. Phase 2 production.

## **9.9 Acceptable Use Policy (AUP)**

**What it is.** Consolidated statement of what users may and may not do on the platform.

**Why Lyceon needs it.** B2B and school-district procurement reviews (per research) commonly require a standalone AUP rather than scattered language across ToS \+ Honor Code \+ Community Guidelines. Consolidates the prohibited-conduct language currently scattered. For V1 consumer launch, AUP may be a near-duplicate of consolidated ToS \+ Honor Code \+ Community Guidelines content; for V1.1+ B2B activation (FWD-10-C), AUP becomes more important.

**What it directionally covers.** Permitted uses (learning, practice, AI-assisted study within Honor Code); prohibited uses (cheating, exam-time use, abuse, harassment, scraping, exploit attempts, AI jailbreaking, account sharing, illegal activity); enforcement.

**Launch-readiness:** Not yet drafted. Phase 2 production; medium priority (could ship as merged ToS+Honor Code+Community Guidelines content for V1, with standalone AUP activated for V1.1+ B2B).

## **9.10 Cookie Policy**

**What it is.** Standalone published policy describing what cookies and similar technologies Lyceon uses, why, and how users control them.

**Why Lyceon needs it.** EU ePrivacy Directive \+ GDPR \+ UK PECR \+ Quebec Law 25 require cookie disclosure beyond what fits in a Privacy Policy. The EU Digital Omnibus package (proposed November 2025\) introduced a direction to migrate ePrivacy provisions into GDPR while maintaining cookie-consent requirements; final binding text is subject to ongoing EU legislative process and counsel verification before Lyceon treats the proposal as settled law. Lyceon needs cookie disclosure that satisfies currently-applicable EU/UK/Canada requirements and the counsel-verified target requirements from the Omnibus process.

**What it directionally covers.** Categories of cookies used (strictly necessary, performance/analytics via PostHog, functional, no advertising cookies per Lyceon's no-advertising posture); first-party vs third-party; data collected via cookies; cookie lifetime; how to manage/decline cookies; cookie-banner mechanism reference; do-not-track signal handling.

**Launch-readiness:** Not yet drafted. Phase 2 production.

## **9.11 Cookie Banner / Consent Notice**

**What it is.** The in-product UX banner that solicits cookie consent.

**Why Lyceon needs it.** Cookie banner must satisfy currently applicable EU ePrivacy/GDPR, UK PECR/ICO, Quebec Law 25, and any counsel-verified EU reform requirements. One-click accept/refuse, do-not-re-ask cadence, and machine-readable browser signal respect are target implementation requirements per the EU Digital Omnibus Nov 2025 proposal direction, pending counsel confirmation of the final binding text. The banner is the operational mechanism by which Lyceon satisfies these requirements; Lyceon's banner must be compliant with the counsel-confirmed legal regime as of launch.

**What it directionally covers.** UX shape (one-click accept; one-click refuse equally prominent; no dark patterns; granular consent option for non-essential cookies); 6-month do-not-re-ask period implementation; machine-readable browser signal handling; consent log with timestamp \+ cookie category granularity for audit purposes; consent withdrawal mechanism in user settings.

**Launch-readiness:** Not yet drafted. Phase 2 production; some content is operational UX implementation rather than legal-document text. Document specifies what the UX must achieve and the legal-disclosure language within the banner.

## **9.12 California Notice at Collection**

**What it is.** California-specific notice satisfying CCPA/CPRA §1798.100 requirement to disclose categories of personal information collected and purposes at or before collection.

**Why Lyceon needs it.** CCPA/CPRA mandatory. Distinct from the Privacy Policy by statute — the Notice at Collection is a specific shorter notice presented at the point of collection (typically at signup), referencing the full Privacy Policy. California's private right of action for breaches involving unencrypted personal information makes California compliance specifically load-bearing.

**What it directionally covers.** Categories of personal information collected; purpose of collection; whether personal information is sold/shared (Lyceon doesn't sell; cross-reference Do Not Sell or Share notice for "share" definition under CCPA); retention period (cross-reference Data Retention Schedule); link to full Privacy Policy.

**Launch-readiness:** Not yet drafted. Phase 2 production.

## **9.13 California Do Not Sell or Share My Personal Information Notice**

**What it is.** California-specific notice \+ mechanism allowing California residents to opt out of "sale" or "sharing" of personal information as those terms are defined in CCPA/CPRA.

**Why Lyceon needs it.** Mandatory under CCPA/CPRA if a business "sells" or "shares" personal information in CCPA's broad statutory sense (which includes cross-context behavioral advertising and certain analytics arrangements). Lyceon's posture is no advertising sharing, so the substantive answer is "Lyceon does not sell personal information and does not share for cross-context behavioral advertising," but the notice mechanism is still required as an industry-standard footer link \+ opt-out signal handling.

**What it directionally covers.** Statement that Lyceon does not sell personal information per CCPA definition; statement that Lyceon does not share for cross-context behavioral advertising per CCPA definition; analytics-provider relationship disclosure (PostHog, BigQuery — analytics processing for Lyceon's own purposes, not "sharing" for third-party advertising); opt-out mechanism (footer link \+ Global Privacy Control opt-out signal honored).

**Launch-readiness:** Not yet drafted. Phase 2 production.

## **9.14 Children's Online Privacy Notice**

**What it is.** Separate child-directed (or parent-directed-about-children) privacy notice specifically addressing COPPA requirements \+ GDPR-K requirements \+ UK AADC \+ Australia COPC \+ Ireland 16+ digital consent posture.

**Why Lyceon needs it.** While the Privacy Policy covers children's privacy in §4 of its standard structure, a **separate** Children's Online Privacy Notice is industry-standard best practice (Khan Academy has separate "Khan Academy Kids Privacy Policy" \+ main Privacy Policy structure). The separate notice signals that Lyceon takes child privacy seriously enough to give it dedicated treatment. Substantively, the separate notice provides plain-language disclosure appropriate for parent \+ child audiences rather than the legalistic register of the main Privacy Policy.

**What it directionally covers.** Lyceon's V1 13+ posture; under-13 hard-delete-everywhere if a minor is identified; what data Lyceon collects from minors (the same Doc 07A-redacted event stream, no special child data collection); Ireland 16+ digital consent special handling; Australia COPC compliance; UK AADC compliance commitments (privacy-by-default high, no dark patterns, data minimization tailored to age, plain language); parent rights (access, deletion, correction); LISA conversation handling for minor users; under-13 ML-exclusion invariant (Doc 07E §10.6); contact for parent inquiries.

**Launch-readiness:** Not yet drafted. Phase 2 production.

## **9.15 Parental Consent Mechanism**

**What it is.** The clickwrap acceptance flow language and underlying mechanism by which a parent provides consent for a minor's use of Lyceon.

**Why Lyceon needs it.** Required as a UX \+ logging mechanism even though Lyceon doesn't offer verifiable parental consent flows for under-13 (per existing draft \+ Doc 09 §14 criterion \#6 V1 posture). For 13-17 users (and for 16+ in Ireland), parent acknowledgment is required at signup. Operationally this is a UX with logged-timestamp acceptance, anchored to the Parent / Guardian Terms.

**What it directionally covers.** The mandatory clickwrap language template: "I am the parent or legal guardian of the user. I have read and agree to the Parent / Guardian Terms, the Student Terms of Use, and the Privacy Policy, and I consent to my child's use of the Lyceon platform." Logging requirements (timestamp \+ account association \+ IP for fraud-prevention scoped). Parent identity verification posture (V1 \= trust acceptance \+ monitoring; V1.1+ may add identity verification for sensitive jurisdictions).

**Launch-readiness:** Not yet drafted. Phase 2 production; this is partially operational UX implementation alongside legal-document language.

## **9.16 AI Content Disclosure Notice**

**What it is.** Standalone notice disclosing that Lyceon uses AI (LISA) to generate explanations, hints, and instructional content, with explicit limitations \+ EU AI Act §50 transparency language.

**Why Lyceon needs it.** EU AI Act Article 50 transparency obligations apply from August 2, 2026, subject to counsel verification and any transition/amendment updates. (Earlier AI Act milestones, including the Article 5 prohibited-practices provisions effective February 2, 2025, are distinct from Article 50 transparency obligations and should not be conflated.) Australia's automated decision-making disclosure obligations are scheduled to take effect December 10, 2026 and apply parallel logic. EU AI Act high-risk AI obligations are also scheduled for August 2, 2026 (with possible extension via Digital Omnibus proposal to as late as December 2027 for certain Annex III categories pending counsel verification) — LISA tutor \+ mastery engine \+ scoring formula may qualify as high-risk depending on final EU regulator interpretation. Lyceon's existing draft ToS \+ Parent Terms reference "AI-generated content may be inaccurate, incomplete, biased, offensive, or inappropriate" but a standalone Notice is industry-standard.

**What it directionally covers.** Statement that LISA explanations, hints, and feedback are AI-generated; LISA's known limitations (probabilistic, may hallucinate, not authoritative, requires critical thinking); LISA's safeguards (Doc 03 LISA system design); EU AI Act §50 compliance statement for EU users; Australia automated decision-making disclosure for Australian users; how users can report AI behavior concerns; how Lyceon iterates on AI quality; the mastery engine \+ scoring formula as automated systems (Doc 04B \+ Doc 05B); reservation of right to refine AI disclosures as regulatory frameworks evolve.

**Launch-readiness:** Not yet drafted. Phase 2 production; jurisdiction-specific provisions require counsel review for EU \+ Australia substance.

## **9.17 Data Processing Agreement (DPA)**

**What it is.** Standalone Data Processing Agreement satisfying GDPR Article 28 \+ UK GDPR \+ Quebec Law 25 \+ B2B/enterprise expectations.

**Why Lyceon needs it.** GDPR Article 28 requires DPAs between controllers and processors. For Lyceon's consumer launch, Lyceon is the controller for EU/UK user data; DPAs with sub-processors (Supabase, Stripe, PostHog, Vertex AI, GCP) are required upstream. For V1.1+ B2B activation (FWD-10-C), Lyceon will be a processor for school-district / institutional clients and will need to offer a DPA template to those clients. The consumer-facing DPA is typically a public posted template that EU/UK users can reference; the B2B DPA is a per-engagement signed document.

**What it directionally covers.** Subject matter \+ purpose of processing; nature of processing; categories of personal data; categories of data subjects; sub-processor authorization (referencing the standalone Sub-Processor List by name); confidentiality obligations; security measures (cross-reference Doc 06D \+ Doc 06E \+ Doc 07E technical/organizational measures); data subject rights handling; data breach notification mechanism; data return/deletion at end of services; audit rights; international transfer mechanism (Standard Contractual Clauses \+ UK IDTA per current EU \+ UK adequacy posture); jurisdiction-specific provisions for Quebec Law 25 Transfer Impact Assessment integration.

**Launch-readiness:** Not yet drafted. Phase 2 production; especially load-bearing for B2B activation but useful even for consumer launch as transparency artifact.

## **9.18 Sub-Processor List**

**What it is.** Standalone public-facing list of Lyceon's sub-processors with categories of data processed and locations.

**Why Lyceon needs it.** GDPR Article 28(2) requires controllers to maintain a list of sub-processors and to provide notice of changes. Industry-standard EdTech practice (Khan Academy publishes; Princeton Review publishes via vendor) is to publish the list publicly. Important for procurement reviews \+ transparency. DPA appendix.

**What it directionally covers.** Per sub-processor: name \+ category (cloud hosting, payment processing, analytics, AI compute) \+ categories of personal data processed \+ processing location \+ relevant contractual safeguards reference. Current Lyceon sub-processors per Doc 06A platform stack inventory \+ Doc 06E vendor body: Supabase (authentication \+ database; US); Stripe (payment processing; US); PostHog (analytics at launch per W-07-PostHog-BQ; EU/US); Vertex AI / Google Cloud (LISA AI inference \+ platform; US); BigQuery / Google Cloud (warehouse at V1.1+ per W-07-PostHog-BQ; US). Updates as the platform stack evolves.

**Launch-readiness:** Not yet drafted. Phase 2 production.

## **9.19 Data Retention Schedule**

**What it is.** Standalone published document bodying retention periods \+ cascade behaviors for each data category, grounded in Doc 06D retention policy registry \+ Doc 07E retention model \+ Doc 09 §9 Stripe retention.

**Why Lyceon needs it.** GDPR Article 5(1)(e) \+ Article 13/14 require retention period disclosure. Industry-standard EdTech practice publishes a separate schedule. Substantively this is the published-form representation of Doc 06D's `infra/retention-policy-registry.yaml` content \+ Doc 07E's retention class taxonomy \+ Doc 09 §9.2's Stripe 7-year direction.

**What it directionally covers.** Per data category: retention period \+ retention basis \+ post-period cascade behavior \+ jurisdiction-specific overrides (Ireland 16+ digital consent; Quebec Law 25). Account data (12-month inactivity → cascade per Doc 07E §7); analytics data (pseudonymized indefinite retention for ML training per Doc 07E §5 \+ §10.6 under-13 exclusion); financial records (Stripe 7-year per Doc 09 §9.2 directional posture); LISA conversation data (Doc 03 Main §14.2 retention windows); under-13 data (hard-delete everywhere per Doc 07E §10); user-initiated deletion within 7-day soft-delete envelope per Doc 01 V6.0 \+ Doc 05D §10.1.

**Launch-readiness:** Not yet drafted. Phase 2 production; depends on Doc 06D retention policy registry being substantively populated, which depends on Doc 09 §10.2 expected-future-additive timing.

## **9.20 Accessibility Statement**

**What it is.** Public statement of Lyceon's accessibility commitment and current ADA/WCAG conformance status.

**Why Lyceon needs it.** ADA Title III \+ Section 508 expectations for educational technology; UK Equality Act 2010; EU Web Accessibility Directive expectations. Required for B2B education-sector procurement reviews (V1.1+ FWD-10-C). Industry-standard reputational good-practice for V1 consumer launch even before B2B becomes load-bearing.

**What it directionally covers.** Lyceon's commitment to accessibility; current WCAG conformance level \+ audit cadence; known gaps \+ remediation roadmap; how users with accessibility needs can request alternative access or report issues; contact for accessibility issues.

**Launch-readiness:** Not yet drafted. Phase 2 production; depends on actual accessibility audit work to ground the conformance claims.

## **9.21 Marketing Communications Consent**

**What it is.** Separate opt-in mechanism for marketing emails \+ SMS distinct from transactional/operational communications.

**Why Lyceon needs it.** CAN-SPAM Act compliance \+ GDPR Article 6 \+ Article 7 (consent for marketing) \+ EU PECR \+ CASL (Canada Anti-Spam Legislation) \+ Singapore Do Not Call Registry. Marketing consent must be separate from broader ToS acceptance \+ must be revocable. Operationally a UX with logged consent \+ unsubscribe-link compliance.

**What it directionally covers.** What categories of marketing communications Lyceon may send (product updates, educational content, new feature announcements, retention/upgrade outreach); opt-in mechanism at signup (separate from ToS acceptance per CASL \+ EU); unsubscribe mechanism with one-click discipline; reservation of transactional communications as not requiring marketing consent.

**Launch-readiness:** Not yet drafted. Phase 2 production.

---

# **§10 — Surface 2: W7 Launch-Gating Discipline \+ Doc 07E Dependency Closure**

## **10.1 The W7 launch gate**

Doc 07E V1.0 §15 W7 declares the privacy policy publication launch gate: *"Doc 10 \+ legal counsel review as a V1 launch gate — privacy policy must be drafted \+ reviewed before launch."* The W7 obligation is one of two external sign-offs (alongside W9 legal counsel sign-off on the Doc 07E §8 compliance posture reasoning) that must close before Doc 05D's pseudonymized-retention path enables in production. Until both close, Doc 05D ships in fallback hard-delete mode and Lyceon loses the ML training corpus.

**Two distinct closure events apply to W7, and Doc 10 keeps them separate:**

**Spec-side closure (closed by Doc 10 V1 \+ Privacy Policy V1):**

1. Producing the Privacy Policy V1.0 as a separate artifact in this delivery cycle (Phase 1\)  
2. Landing the W7-named disclosure language per Doc 07E §8.3 (the 12-month-inactivity \+ pseudonymized-retention \+ ML-training-corpus \+ legal-anonymization-upgrade-after-W5+W9 substantive language)  
3. Closing FWD-07E-05 (Doc 07E V1.0 → Doc 10 privacy policy disclosure text) at Doc 10 V1 lock

**Operational closure (NOT closed by Doc 10 V1; closes only after counsel-reviewed Privacy Policy publication):**

1. Legal counsel review of the Privacy Policy V1 draft  
2. Counsel-approved revisions incorporated  
3. Privacy Policy published on the Lyceon marketing site  
4. Doc 07E W7 launch-gate marked closed; pseudonymized-retention path enables in production

The two events are sequential and must not be conflated. **Doc 10 V1 \+ Privacy Policy V1 draft close the spec-side FWD-07E-05 dependency. W7 launch-gate closure requires counsel-reviewed Privacy Policy publication and is not closed by the Doc 10 V1 lock event alone.**

## **10.2 Per-document launch-criticality**

The 20 legal documents in §9's inventory have varying launch-criticality. Counts below sum to 20: 12 launch-blocking \+ 5 launch-strongly-preferred \+ 3 launch-deferred.

**Launch-blocking (must be published before launch) — 12 documents:**

* Privacy Policy (§9.2 — W7 gate)  
* Student Terms of Use (§9.3 — mandatory consumer agreement)  
* Parent / Guardian Terms (§9.4 — mandatory for minor users)  
* Cookie Policy (§9.10 — EU/UK/Quebec required)  
* Cookie Banner / Consent Notice (§9.11 — operational consent UX)  
* Children's Online Privacy Notice (§9.14 — multi-jurisdictional child-privacy requirement)  
* Parental Consent Mechanism (§9.15 — mandatory clickwrap for minors)  
* Refund Policy (§9.7 — California ARL \+ EU \+ UK; resolves existing-draft conflict)  
* Subscription / Auto-Renewal Notice (§9.8 — California ARL \+ EU consumer protection)  
* AI Content Disclosure Notice (§9.16 — EU AI Act Article 50 transparency applicable from August 2, 2026 per current schedule; counsel verifies applicability for Lyceon)  
* California Notice at Collection (§9.12 — CCPA/CPRA mandatory)  
* California Do Not Sell or Share Notice (§9.13 — CCPA/CPRA mandatory)

**Launch-strongly-preferred (publish if possible; can ship without temporarily but reputational/legal exposure) — 5 documents:**

* Honor Code (§9.5 — onboarding-flow acceptance loop)  
* Community Guidelines (§9.6 — community feature acceptance)  
* Data Retention Schedule (§9.19 — GDPR Article 13/14 disclosure)  
* Sub-Processor List (§9.18 — GDPR Article 28(2) \+ transparency)  
* Marketing Communications Consent (§9.21 — CAN-SPAM \+ GDPR \+ CASL)

**Launch-deferred (can ship without; activate as platform scales) — 3 documents:**

* Data Processing Agreement (§9.17 — primarily B2B-relevant; consumer-facing DPA can ship V1.1+ if needed)  
* Acceptable Use Policy (§9.9 — consolidates scattered content; can ship as scattered for V1, consolidated for V1.1+)  
* Accessibility Statement (§9.20 — reputational good-practice; not consumer-launch-blocking)

## **10.3 Launch-criticality and the Doc 07E dependency**

Doc 07E's W7 closure depends specifically on Privacy Policy publication. The 12 launch-blocking documents listed above all need to be published before Lyceon's consumer launch, but only the Privacy Policy specifically closes W7. Lyceon's launch readiness from the legal-document perspective requires:

1. **W7 closure** — Privacy Policy published \+ counsel-reviewed (closes the Doc 07E pseudonymized-retention activation gate)  
2. **W9 closure** — Doc 07E §8 compliance posture reasoning legally counsel-reviewed (the other Doc 07E gate, separate from Doc 10\)  
3. **All 12 launch-blocking documents published** — Lyceon's consumer onboarding flow is compliant with the multi-jurisdictional requirements

W7 \+ W9 close → Doc 05D pseudonymized-retention path enables → Lyceon's ML training corpus accumulates from launch.

All 12 launch-blocking documents published → Lyceon's consumer onboarding flow can launch.

The W7 dependency is a subset of the full launch-readiness; closing W7 alone doesn't make Lyceon launch-ready, but failing to close W7 makes Lyceon's intended Doc 07E posture unable to activate.

---

# **§11 — Surface 2: Legal-Document Program Coordination**

## **11.1 The three-phase production program**

Per Karl's direction during alignment, Lyceon's legal-document production follows a three-phase program:

**Phase 1 — Doc 10 spec \+ Privacy Policy V1.0 (this delivery cycle).** Doc 10 spec is locked; Privacy Policy V1.0 is drafted as a separate artifact in industry-grade legal form. The Privacy Policy closes the FWD-07E-05 forward-reference and prepares the W7 gate for counsel review and publication.

**Phase 2 — Remaining 19 legal artifacts (subsequent delivery cycles).** Each artifact drafted standalone in industry-grade legal form, grounded in the locked Lyceon corpus \+ jurisdictional research. Production order driven by launch-criticality (§10.2) \+ dependency chains. Estimated delivery cadence: 3–5 artifacts per cycle, depending on each artifact's complexity. Each artifact goes through SWE review cycle before lock.

**Phase 3 — Engineering integration (operational, handed to engineering at Phase 2 close).** The published artifacts get wired into Lyceon's signup / checkout / consent flows. Doc 10 is not the canonical owner of this engineering work; Phase 3 is named here for visibility but the deliverables are not Doc 10's responsibility.

## **11.2 Phase 2 production order (proposed)**

The proposed Phase 2 production order, grouped by delivery cycle:

**Cycle 2a (launch-blocking core):**

* Student Terms of Use (§9.3) — substantial revision of existing draft  
* Parent / Guardian Terms (§9.4) — substantial revision of existing draft  
* Refund Policy (§9.7) — resolves Doc 09 §5.7 conflict; new artifact  
* Subscription / Auto-Renewal Notice (§9.8) — new artifact; ties into ToS \+ Parent Terms

**Cycle 2b (launch-blocking child \+ jurisdictional):**

* Children's Online Privacy Notice (§9.14) — new artifact  
* Parental Consent Mechanism (§9.15) — new artifact  
* AI Content Disclosure Notice (§9.16) — new artifact; EU AI Act §50 substance  
* California Notice at Collection (§9.12) \+ California Do Not Sell or Share Notice (§9.13) — both new

**Cycle 2c (launch-blocking cookies \+ remaining):**

* Cookie Policy (§9.10) — new artifact  
* Cookie Banner / Consent Notice (§9.11) — new artifact \+ UX specification  
* Honor Code (§9.5) refresh \+ Community Guidelines (§9.6) refresh — minor updates to existing drafts

**Cycle 2d (launch-strongly-preferred):**

* Data Retention Schedule (§9.19) — new artifact; depends on Doc 06D registry maturity  
* Sub-Processor List (§9.18) — new artifact  
* Marketing Communications Consent (§9.21) — new artifact

**Cycle 2e (launch-deferred; V1.1+ activation):**

* Data Processing Agreement (§9.17) — new artifact; primarily B2B relevance  
* Acceptable Use Policy (§9.9) — consolidation artifact  
* Accessibility Statement (§9.20) — new artifact

The order is proposal; actual production order may adjust based on counsel review timelines \+ operational priorities.

## **11.3 Per-artifact production process**

Each legal-document artifact follows the same production process:

1. **Drafting** — produced as standalone industry-grade legal document grounded in (a) the locked Lyceon corpus per Decision-5 reference discipline, (b) jurisdictional research per Doc 10 V1 §9 \+ Phase 1 research findings, (c) competitive exemplar quality bar (Khan Academy as institutional EdTech reference; Princeton Review for standard consumer SaaS structure)  
2. **Internal review** — cross-document consistency check against other already-drafted artifacts \+ against Surface 1 brand-and-trust claims (the inconsistency risk per §3 Risk 3\)  
3. **Counsel review** — legal counsel reviews for substantive accuracy, jurisdictional completeness, and risk-tolerance fit. Counsel posture is **approve and tighten**, not **rewrite from scratch** (per Karl direction on quality bar)  
4. **Lyceon revision** — incorporating counsel feedback  
5. **Final counsel sign-off**  
6. **Publication** — artifact published on the marketing site \+ integrated into signup/checkout/consent flow per Phase 3 engineering work

The process is the same shape as Lyceon spec doc lock cycles (draft → SWE review → cleanup → lock), with counsel substituting for SWE reviewer and publication substituting for lock.

## **11.4 Cross-document consistency review**

The §3 Risk 3 (Surface 1 brand and Surface 2 legal claims diverge) is mitigated through explicit cross-document consistency review:

* Before each artifact ships, review the artifact's substantive claims against (a) Surface 1 brand-and-trust language and (b) all other already-drafted artifacts  
* The Privacy Policy is the anchor — most other artifacts cross-reference it; consistency between Privacy Policy and other artifacts is mandatory  
* Cross-references between artifacts are explicit by name (e.g., "subscription terms detailed in our Refund Policy") rather than inline restatement  
* When Lyceon's product or technical posture changes (e.g., a new sub-processor added; LISA's retention windows adjusted), the change cascades to every affected legal artifact in a coordinated update cycle, not piecemeal

## **11.5 Quality bar: industry-grade legal**

The quality bar Karl committed to during alignment: *"industry grade ... perfect from the start ... writing so perfect that just a legal person has to approve it."*

What this means operationally:

* **Document structure** matches industry-leading EdTech / SaaS conventions — defined terms with capitalization, numbered sections \+ subsections, severability clauses, governing law clauses, dispute resolution clauses, force-majeure where relevant  
* **Substantive content** is grounded in the locked Lyceon corpus — every Lyceon-specific reality (LISA architecture, retention model, free-tier mechanics, cascade discipline, mastery engine, scoring formula) properly disclosed  
* **Jurisdictional awareness** — separate sections or clauses where US/EU/UK/Canada/Australia/NZ/Singapore/Ireland law differ materially  
* **Consistent defined terms** used across documents — terms defined once and referenced consistently  
* **Standard scaffolding** — boilerplate clauses present where standard, with Lyceon-specific tuning  
* **Cross-document consistency** — all 20 artifacts internally consistent with each other

**What this does NOT mean:**

* Final legal text ready to publish without counsel review (counsel sign-off still required per §11.3)  
* Final adjudication on jurisdiction-specific edge cases that depend on case law or regulator opinions (counsel resolves these)  
* Final business-judgment decisions about Lyceon's risk-tolerance choices (limitation of liability caps, refund-window exact length, etc. — these are Lyceon \+ counsel decisions, not drafting choices)

The commitment is: **counsel reviews and tightens; counsel does not rewrite from scratch.**

## **11.6 External claim-control framework**

Surface 1's proof-over-gimmicks principle (§4) requires operational discipline on external claims. Brand-and-trust posture is meaningless if marketing or social channels make claims that don't survive contact with reality. Lyceon adopts the following four-category claim taxonomy for all external brand surfaces (marketing site, social media, press, paid acquisition, content marketing, LISA-as-public-voice content):

| Category | Definition | Approval required |
| ----- | ----- | ----- |
| **1\. Product-demonstrable today** | Claim is verifiable by interacting with the live Lyceon product (e.g., "LISA explains practice questions step by step"; "Lyceon adapts question difficulty to your mastery level"). | No founder approval required if claim is true on the live product as of publication |
| **2\. Internally measured but not yet public** | Claim is supported by internal Lyceon measurement (Doc 07 KPIs, Doc 05B mastery, Doc 04B scoring) but the underlying cohort/data is not externally visible (e.g., "Lyceon students improve by an average of X points after Y hours of practice"). | Founder approval required; outcome claims require a documented cohort, denominator, date range, and Doc 07E §15 W5 cardinality check before publication |
| **3\. Counsel-approved legal claim** | Claim is a privacy, security, or compliance assertion (e.g., "we never sell your data"; "we comply with COPPA"; "we don't share data for advertising"). | Counsel approval required; claim must be consistent with the corresponding language in the published Privacy Policy and other legal artifacts |
| **4\. Future aspiration** | Claim describes Lyceon's intended future direction rather than current product reality (e.g., "we're building toward..."; "next quarter..."; "in development"). | Explicit "future" / "in development" / "planned" language required; cannot be presented as current capability |

**Operational rules:**

* Only Category 1 and Category 3 claims may appear on public marketing pages without founder review  
* Category 2 claims (especially outcome claims) require the documented cohort \+ denominator \+ date range \+ cardinality check before publication  
* Category 4 claims must be explicitly future-tagged and cannot be implicitly read as current capability  
* The Lyceon team applies this framework to QOTD, Discord, Reddit presence, paid acquisition copy, partner content, and all LISA-as-public-voice content per Doc 08 Dimension 6 direction  
* The §6 public-facing analytics surfaces (Students-Helped Counter, Average Score Improvement Aggregate, Total Questions Answered Counter, LISA Conversations Counter) are Category 2 claims that operate under explicit cohort \+ cardinality discipline

This framework operationalizes the proof-over-gimmicks principle into a checkable claim-control discipline that the marketing/content team can apply consistently as Lyceon scales.

## **11.7 Legal artifact dependency map**

The 20 legal documents in §9's inventory are not independent — they cross-reference each other in load-bearing ways. Anchor relationships:

**Privacy Policy is the trust anchor** (anchored documents reference it; it is the substantive source):

* Cookie Policy (§9.10) — Privacy Policy §6 covers cookies high-level; Cookie Policy bodies the detail  
* Children's Online Privacy Notice (§9.14) — Privacy Policy §11 covers children high-level; Children's Notice bodies the detail  
* Data Retention Schedule (§9.19) — Privacy Policy §7 covers retention high-level; Retention Schedule bodies the table  
* Sub-Processor List (§9.18) — Privacy Policy §5.1 names sub-processors; Sub-Processor List bodies the table  
* AI Content Disclosure Notice (§9.16) — Privacy Policy §3.4 covers LISA high-level; AI Content Disclosure bodies the detail  
* California Notice at Collection (§9.12) — Privacy Policy §9.2 references California rights; Notice at Collection is the California-statutory form  
* California Do Not Sell or Share Notice (§9.13) — Privacy Policy §4.6 states no-sale/no-share; Do Not Sell Notice is the California-statutory mechanism

**Student Terms of Use is the consumer-contract anchor** (anchored documents reference it):

* Student Terms of Use (§9.3) — primary consumer agreement  
* Parent / Guardian Terms (§9.4) — referenced for minor users; references Student ToS by name  
* Honor Code (§9.5) — referenced from Student ToS by name; acceptance via onboarding checkbox  
* Community Guidelines (§9.6) — referenced from Student ToS by name; applies to community features  
* Acceptable Use Policy (§9.9) — consolidates prohibited-conduct language; references Student ToS by name

**Refund Policy is the billing-contract anchor** (anchored documents reference it):

* Refund Policy (§9.7) — primary refund/cancellation policy; bodies Doc 09 §5.7 direction  
* Subscription / Auto-Renewal Notice (§9.8) — references Refund Policy by name for cancellation  
* Marketing Communications Consent (§9.21) — distinct opt-in; separate from billing

**Parental Consent Mechanism crosswalks:**

* Parental Consent Mechanism (§9.15) — clickwrap UX; references Parent / Guardian Terms \+ Privacy Policy \+ Children's Online Privacy Notice by name

**Decision-5 reference discipline applies to legal artifacts identically to spec-doc discipline:** each artifact references the anchor by name rather than restating its content. When the Privacy Policy is updated, anchored artifacts that reference it do not need parallel updates unless the specific referenced provision changes.

## **11.8 Counsel-must-decide launch-market gating**

Doc 08 Dimension 2 names seven launch markets (US, UK, Canada, Australia, New Zealand, Republic of Ireland, Singapore). The legal-document requirements are non-uniform: each market has distinct compliance prerequisites that may or may not be ready at Lyceon's intended launch moment.

**Operational rule:** Counsel must approve each launch market before Lyceon accepts users from that market. If a market's legal-document or consent requirements are not ready at launch, the product must geo-block or delay that market until they are. Launching a market without counsel approval creates direct legal exposure that no spec-side closure can compensate for.

**Markets with elevated launch-gating considerations per May 2026 research:**

* **Quebec (Canada).** Law 25 imposes Transfer Impact Assessments for cross-border data \+ automated decision-making transparency \+ mandatory PIAs \+ CLOUD Act exposure for US-headquartered processors. Counsel may recommend Quebec geo-block at launch with V1.1+ activation when Quebec-specific compliance is operationally complete.  
* **Ireland.** Digital age of consent is 16 (not 13\) per Article 8 GDPR variation. Lyceon's 13-15 Irish users require parental/guardian consent for processing where consent is the legal basis. Either (a) Ireland launches with valid Parental Consent Mechanism for 13-15 users, or (b) Ireland launch is delayed until 13-15 consent mechanism is operational, or (c) Ireland launches only for 16+ users initially.  
* **UK.** UK Children's Code applies to services likely accessed by children under 18; Lyceon's 13-18 user base falls entirely within scope. UK launch requires Children's Code conformance (privacy-by-default high; no dark patterns; data minimization tailored to age; plain language disclosures). Not a deletion trigger but a design obligation.  
* **Australia.** Children's Online Privacy Code registers by Dec 10, 2026; ADM disclosure obligations effective Dec 10, 2026; if Lyceon's Australian launch precedes these dates substantially, counsel verifies interim requirements. If Australian launch is after Dec 10, 2026, COPC compliance is launch-prerequisite.  
* **EU member states (general).** EU AI Act Article 50 transparency obligations applicable from August 2, 2026; high-risk obligations also scheduled for August 2, 2026 with possible extension to Dec 2027\. LISA \+ mastery engine \+ scoring formula may qualify; counsel verifies per launch market.

**Doc 08 Dimension 2 recommended launch sequence direction** — New Zealand → Singapore → Australia → UK → Ireland → US → Canada (Quebec potentially deferred) — accommodates the increasing legal complexity across the sequence; the first markets in the sequence have lighter compliance requirements than the last. Counsel review of each market's readiness before activation is the operational discipline that translates this direction into safe launch execution.

## **11.9 Brand-design parallel artifact track**

The Surface 2 legal-document program is one parallel track of pre-launch artifacts. Lyceon's brand-design system is a second parallel track with its own deliverables, lifecycle, and ownership. Doc 10 captures this track directionally without embedding the brand-design artifacts themselves — same shape as Surface 2 (Doc 10 names the artifacts and directionally describes what they are; the artifacts get produced separately, in their own iteration cadence).

**The brand-design artifact track:**

| \# | Artifact | Description |
| ----- | ----- | ----- |
| 1 | **Brand Identity System** | Logo (primary \+ variants for light/dark/monochrome/favicon); usage guidelines; sizing \+ clear-space rules; minimum-size and accessibility-contrast specifications |
| 2 | **Color Palette \+ Typography Tokens** | Primary \+ secondary brand colors with hex/RGB/HSL values; accessibility-compliant contrast pairings; typography system (display \+ body \+ UI fonts); type-scale tokens; spacing tokens |
| 3 | **Brand Voice Guide** | Operational handbook bodying §4.3 brand-voice direction (clear over clever; honest about limits; pedagogically rigorous; respectful of students; respectful of parents); voice-do-and-don't examples; tone modulations per surface (marketing site vs LISA in-product vs Discord community vs social posts) |
| 4 | **Tagline \+ Positioning Lines** | Lyceon's externally-used short-form claims; tagged per the §11.6 claim-control framework; counsel-reviewed where they make legal claims |
| 5 | **Marketing-Site Copy System** | Page-level copy (homepage, product pages, pricing, about, contact); tone-aligned with brand voice; SEO-aligned with target search intent |
| 6 | **LISA Voice \+ Visual Guide** | LISA's public-facing character per Doc 08 Dimension 6 LISA-as-content-brand direction (voice consistency across in-product and external surfaces; visual representation if LISA is depicted; behavior expectations across channels) |
| 7 | **Social-Media Asset System** | Template \+ sizing specifications for Instagram, TikTok, X/Twitter, LinkedIn, YouTube; brand-consistent thumbnail and post-template patterns; QOTD content templates per Doc 08 Dimension 6 |
| 8 | **Email Template System** | Transactional email templates (signup confirmation, billing notices, security alerts); marketing email templates (per separate Marketing Communications Consent); design \+ voice consistency |
| 9 | **Public Document Templates** | PDF report templates (score reports, progression summaries); certificate-of-completion templates; score-progression UGC templates (Lyceon-generated visualizations users can share per §7.1 opt-in user-generated principle) |

**Brand-design artifact lifecycle:**

* Brand artifacts iterate at their own cadence (marketing data, A/B testing, design feedback)  
* Brand-design artifacts are NOT spec-locked; Doc 10 does not amend on each brand iteration  
* Brand artifacts must remain consistent with Surface 1 principles (§4 proof-over-gimmicks; §4.3 brand voice direction; §7.3 demographic representation discipline; §11.6 claim-control framework)  
* Brand-design artifacts that make legal claims (taglines, marketing copy) flow through §11.6 claim categorization  
* The brand-design track is operational marketing/design work; not Doc 10's responsibility to body the artifacts themselves

**Launch-criticality of brand-design track:** All nine artifacts are launch-relevant. Brand Identity System \+ Color Palette \+ Marketing-Site Copy are launch-blocking from an operational marketing perspective (Lyceon cannot launch without a marketing site and visual identity), but they are launch-blocking on the brand-launch side, not on the spec-side or legal-side that Surface 2 governs. The two tracks (legal artifacts \+ brand-design artifacts) must both complete their respective production work before launch; Doc 10 spec lock does not depend on either track's operational completion.

---

# **§12 — Conventions Adopted (Light)**

Doc 10 adopts the following conventions, drawn from Doc 09 directional precedent \+ the Doc 10-unique framing per Karl direction:

* **Directional register** with two surface treatments — Surface 1 (captured-direction-with-explicit-principle); Surface 2 (directional with counsel-review-gate per document)  
* **Decision-5 reference discipline** — Doc 10 cites canonical owners (Doc 07E, Doc 09, Doc 03, Doc 07A, Doc 08, etc.) and never restates their bodies  
* **In-lock-cycle multi-round cleanup pattern** — DRAFT status holds through SWE review cycle(s); status transitions DRAFT → LOCKED on clean re-audit; no version bump  
* **Change record convention** — CR-10-XX entries capture substantive changes per lock cycle  
* *No INV-10- invariants at V1*\* — directional document does not assert executable contract rules  
* **No new audit pass introduced at V1** — Doc 10 has nothing to audit beyond Decision-5 reference discipline  
* *No formal W-10- watch-item list*\* — open items captured inline per-section where they live  
* **No formal cross-doc seam table** — cross-doc dependencies named in §1 Depends-on \+ Explicitly-excludes; lighter footprint than Doc 09 §11  
* **No Brand/Trust Authority Hierarchy section** — Doc 09 §1.4 finance authority pattern doesn't fit Surface 1 (brand isn't authority-validated); Surface 2 has counsel as singular authority, captured per-document  
* **Section structure mirrors content** — Surface 1 sections (§4–§8) read like brand-positioning; Surface 2 sections (§9–§11) read like legal-program coordination; tonal shift between them is intentional

What Doc 10 does NOT inherit from Doc 09:

* Per-section gate-list discipline at the §-level (Doc 10 captures gates per-document in §9 inventory rather than per-§ at spec level)  
* Finance Authority Hierarchy analog as §1.4 (no equivalent brand-and-trust authority hierarchy)  
* Investor-reporting disclosure rule analog (Doc 10 has no metric-equivalent content to disclose to investors; brand claims are by definition external-reporting from day one)  
* Pricing-canonical-not-hardcoded discipline as a load-bearing principle (Doc 10 doesn't body pricing; references Doc 09 §5)

---

# **§13 — Acceptance Criteria**

Doc 10 V1.0 is acceptable for lock when:

1. **Surface 1 captures the proof-over-gimmicks principle** (§4) as the load-bearing brand posture, with five concrete operational dimensions (outcomes proof, AI capability honesty, engagement honesty, privacy honesty, pricing honesty)

2. **Surface 1 captures the EdTech competitive landscape and Lyceon's positioning** (§5) with seven competitor analyses (Khan Academy/Bluebook, Princeton Review/Kaplan, Duolingo, Magoosh, Test Ninjas, Reddit r/SAT, Google Gemini SAT) and four anchor positioning points

3. **Surface 1 captures the public-facing analytics surfaces direction** (§6) with four V1 surfaces (Students-Helped Counter, Average Score Improvement Aggregate, Total Questions Answered Counter, LISA Conversations Counter) and explicit Doc 07E §15 W5 cardinality discipline applied

4. **Surface 1 captures the social-proof framework and testimonial direction** (§7) with the opt-in user-generated principle \+ demographic representation discipline

5. **Surface 1 captures the community direction** (§8) referencing Doc 08 Dimension 6 as canonical channel-strategy owner and bodying the brand-and-trust interpretation only

6. **Surface 2 captures the pre-launch legal-document inventory** (§9) with 20 documents enumerated across 6 categories, each with per-document directional summary (what it is, why Lyceon needs it, what it directionally covers, launch-readiness status)

7. **Surface 2 closes the W7 launch-gating dependency** (§10) with explicit per-document launch-criticality classification (12 launch-blocking; 5 launch-strongly-preferred; 3 launch-deferred)

8. **Surface 2 captures the three-phase production program** (§11) with Phase 1 (this cycle), Phase 2 (subsequent cycles in proposed order), Phase 3 (engineering integration)

9. **The Privacy Policy V1.0 artifact** is produced alongside Doc 10 V1 as a separate artifact in industry-grade legal form (Phase 1 deliverable)

10. **Decision-5 reference discipline holds end-to-end** — Doc 10 references Doc 07E, Doc 09, Doc 03, Doc 07A, Doc 08, Doc 01, Doc 04, Doc 05, Doc 06D, Doc 06E by exact § citation; no restatement of canonical bodies

11. **FWD-07E-05 closure documented** (§10.1) — Doc 10 V1 closes the Doc 07E forward-reference for privacy policy disclosure text via the Privacy Policy artifact \+ W7 launch-gate framing

12. **FWD-07-03 directionally resolved** — Doc 10 V1 captures brand/social-proof analytics direction (§6 public-facing surfaces); full resolution awaits V1.1+ operational activation (FWD-10-D)

13. *No INV-10- introduced at V1*\* — directional document does not assert executable contract rules

14. **No new audit pass introduced at V1** — Doc 10 has nothing to audit beyond Decision-5 reference discipline (which inherits the cross-doc audit pass discipline from prior locked docs)

15. **§2.4 age-threshold taxonomy is canonical** — four distinct concepts (COPPA child; digital consent threshold; child-safety / age-appropriate-design user; Lyceon student minor) defined with thresholds \+ legal basis \+ operational consequence; cross-referenced by all Phase 2 legal artifacts rather than restated

16. **§11.6 external claim-control framework** — four-category claim taxonomy (product-demonstrable today; internally measured but not yet public; counsel-approved legal claim; future aspiration) with operational rules for marketing/content team

17. **§11.7 legal artifact dependency map** — Privacy Policy as trust anchor; Student ToS as consumer-contract anchor; Refund Policy as billing-contract anchor; Parental Consent Mechanism crosswalk; Decision-5 reference discipline applied to legal artifacts

18. **§11.8 counsel-must-decide launch-market gating** — operational rule that counsel must approve each launch market before user acceptance; elevated launch-gating considerations enumerated per market (Quebec, Ireland, UK, Australia, EU)

19. **§11.9 brand-design parallel artifact track captured directionally** — nine brand-design artifacts named (Brand Identity System, Color Palette \+ Typography Tokens, Brand Voice Guide, Tagline \+ Positioning Lines, Marketing-Site Copy System, LISA Voice \+ Visual Guide, Social-Media Asset System, Email Template System, Public Document Templates); track operates at independent cadence from Surface 2 legal-document program; must remain consistent with Surface 1 principles. Brand-design artifact completion is operational launch work and does not block Doc 10 spec lock.

20. **Counts reconciled** — §9 inventory \= 20 documents (rows 1-20 in table; §9.2-§9.21 per-doc summaries with one-position offset); §10.2 launch-criticality \= 12 launch-blocking \+ 5 launch-strongly-preferred \+ 3 launch-deferred summing to 20

21. **W7 spec-side closure vs operational closure separated** — §10.1 explicitly distinguishes Doc 10 V1 \+ Privacy Policy V1 draft (closes spec-side FWD-07E-05) from counsel-reviewed Privacy Policy publication (closes W7 operationally); the two closure events are sequential and not conflated

---

# **§14 — Change Records**

**CR-10-01** — Doc 10 V1.0 established as two-surface directional document per Karl 2026-05-31 alignment direction. Surface 1 (§4–§8) covers brand/public-narrative/social-proof direction grounded in proof-over-gimmicks principle and pre-launch EdTech competitive analysis (Khan Academy, Princeton Review, Kaplan, Duolingo, Magoosh, Test Ninjas, Reddit r/SAT, Google Gemini SAT — May 2026 research). Surface 2 (§9–§11) covers pre-launch legal-document inventory with 20 documents across 6 categories \+ per-document directional summaries \+ W7 launch-gating discipline \+ three-phase production program. Phase 1 delivers Doc 10 spec \+ Privacy Policy V1.0 (FWD-07E-05 closure at Doc 10 V1; W7 gate prepared for counsel review and publication). FWD-07-03 directionally resolved via §6 public-facing analytics surfaces direction; full resolution at V1.1+ FWD-10-D. Doc 10 unique conventions per Karl "each doc gets to be unique" direction: no forced INV-10-\* / W-10-\* / formal cross-doc seam table / Authority Hierarchy section — adopted only where they fit Doc 10's content. The five existing Dec 2025 legal-document drafts (Privacy Policy, Student ToS, Parent Terms, Honor Code, Community Guidelines) referenced as directional reference only — Doc 10 produces all legal artifacts from scratch grounded in the locked corpus (Doc 03 LISA, Doc 07A redaction, Doc 07E retention, Doc 09 pricing/refund/Stripe-retention, Doc 01 V6.0 identity, Doc 05D cascade) rather than iterating on the existing drafts. Multi-jurisdictional research grounding: US federal (COPPA amended-rule full compliance deadline April 22, 2026 per FTC final rule published April 22, 2025 \+ 365-day compliance window; FERPA; CCPA/CPRA \+ 20-22 state comprehensive privacy laws — May 2026 inventory); EU (GDPR \+ EU AI Act Article 50 transparency applicable from August 2, 2026 \+ high-risk obligations August 2, 2026 with possible Digital Omnibus extension to Dec 2027; Digital Omnibus November 2025 PROPOSAL — not yet final binding law — for ePrivacy migration into GDPR \+ one-click cookie consent \+ 6-month do-not-re-ask \+ machine-readable signal respect); UK (UK GDPR \+ DPA 2018 \+ Age Appropriate Design Code under-18); Canada (PIPEDA federal \+ Quebec Law 25 Transfer Impact Assessment \+ CLOUD Act exposure); Australia (Privacy Act reforms 2024-2026 \+ Children's Online Privacy Code to be registered by Dec 10, 2026 \+ automated decision-making disclosure effective Dec 10, 2026; Online Safety Amendment Act under-16 social-media ban likely not applicable to Lyceon as educational platform — counsel-check footnote); NZ (Privacy Act 2020 \+ IPP3A May 2026); Singapore (PDPA \+ children's privacy guidelines \+ 13-17 self-consent posture); Ireland (digital age of consent 16 — Article 8 GDPR variation; high proportion of children; Irish DPC fundamentals for child-oriented data processing). Industry-grade quality bar: counsel reviews and tightens, not rewrites from scratch. Status DRAFT pending external SWE review of the two-surface directional structure.

**CR-10-02** — R1 cleanup pass applied 2026-05-31 in response to external SWE review register RB-10-V1-01..07 \+ RB-PP-V1-01..09 \+ reviewer's three additional Doc 10 recommendations \+ Karl's brand-design artifacts question. Doc 10 cleanups applied (RB-10-V1-01 through RB-10-V1-07): §10.1 W7 closure language explicitly separated into spec-side closure (closed by Doc 10 V1 \+ Privacy Policy V1 draft) vs operational closure (closes only on counsel-reviewed Privacy Policy publication); §3 Risk 8 \+ §9.16 \+ §10.2 \+ §11.2 EU AI Act Article 50 timing corrected to August 2, 2026 applicable date (was incorrectly "in force since Feb 2025" — that earlier date is Article 5 prohibited-practices, distinct); §3 Risk 9 \+ §9.10 \+ §9.11 EU Digital Omnibus framing softened from "mandates" to "Nov 2025 proposal pending counsel verification of binding text"; §3 Risk 11 Australia COPC kept as direct issue with under-16 social-media ban moved to counsel-check footnote; §9.4 Parent Terms summary corrected — removed COPPA "verifiable parental consent" term-of-art misuse (Lyceon does not implement COPPA-grade VPC); §10.2 launch-criticality counts reconciled to 12 launch-blocking \+ 5 launch-strongly-preferred \+ 3 launch-deferred (was inconsistent at 11+5+4); §10.3 Doc 07E dependency text adjusted to match 12-launch-blocking count. **New canonical taxonomy added (§2.4 age-threshold taxonomy)** — four distinct concepts (COPPA child under-13; digital consent threshold per Article 8 GDPR variation; child-safety / age-appropriate-design user under-18 per UK Children's Code \+ Australia COPC; Lyceon student minor under-18) with thresholds \+ legal basis \+ operational consequence; cross-referenced by all Phase 2 legal artifacts rather than restated. **New §11.6 external claim-control framework added** — four-category claim taxonomy (product-demonstrable today; internally measured but not yet public; counsel-approved legal claim; future aspiration) with founder \+ counsel approval rules; operationalizes proof-over-gimmicks (§4) into checkable discipline. **New §11.7 legal artifact dependency map added** — Privacy Policy as trust anchor; Student ToS as consumer-contract anchor; Refund Policy as billing-contract anchor; Parental Consent Mechanism crosswalks; Decision-5 reference discipline applied to legal artifacts. **New §11.8 counsel-must-decide launch-market gating added** — operational rule that counsel must approve each Doc 08 Dimension 2 launch market before user acceptance; per-market elevated launch-gating considerations enumerated (Quebec Law 25 \+ CLOUD Act; Ireland 13-15 consent; UK Children's Code; Australia COPC \+ ADM disclosure; EU AI Act per-market verification). **New §11.9 brand-design parallel artifact track added** — nine brand-design artifacts named (Brand Identity System; Color Palette \+ Typography Tokens; Brand Voice Guide; Tagline \+ Positioning Lines; Marketing-Site Copy System; LISA Voice \+ Visual Guide; Social-Media Asset System; Email Template System; Public Document Templates); track operates at independent cadence from Surface 2 legal-document program; must remain consistent with Surface 1 principles and §11.6 claim-control framework. Acceptance criteria expanded from 14 to 21 to reflect new sections. Status remains DRAFT pending R2 reviewer clearance; no version bump per in-lock-cycle multi-round cleanup convention. The Privacy Policy V1.0 artifact receives parallel R1 cleanup per RB-PP-V1-01..09 in a separate cleanup register entry on that artifact.

**CR-10-03** — R2 cleanup pass applied 2026-05-31 in response to external SWE R2 review register RB-10-R2-01..03. Three targeted wording fixes: §15 closing language separated Privacy Policy ships closing **spec-side FWD-07E-05 dependency** (not the W7 launch gate) and **preparing W7 for counsel-reviewed publication** — operational W7 closure now explicitly tied to counsel review and publication rather than to Doc 10 V1 lock; §9.2 Privacy Policy summary launch-readiness line updated from "Closure of FWD-07E-05 at Doc 10 V1" to "Spec-side closure of FWD-07E-05 at Doc 10 V1; operational W7 closure requires counsel-reviewed Privacy Policy publication" to maintain the spec-side vs operational closure distinction §10.1 already establishes; §13 acceptance criterion 19 updated from "§11.9 brand-design parallel artifact track" to "§11.9 brand-design parallel artifact track captured directionally" with explicit statement that brand-design artifact completion is operational launch work and does not block Doc 10 spec lock. Per reviewer R2 verdict ("LOCK-CONDITIONAL ... Fix the three wording items above and I would mark Doc 10 V1.0 LOCKED"), Doc 10 status transitions DRAFT → **LOCKED** at this R2 cleanup application. No version bump per in-lock-cycle multi-round cleanup convention. The Privacy Policy V1.0 artifact receives parallel R2 cleanup pass per RB-PP-R2-01..13 \+ reviewer's depth-expansion recommendations (Quick Summary, Data Categories Table, Sensitive Information posture, Automated Systems section, Detailed Rights Request Process, US State Privacy Appendix, Security Program Details, Retention Summary Table, Legal Bases Table) in a separate cleanup register entry on that artifact; Privacy Policy progression to LOCKED is independent of Doc 10 lock and requires counsel review \+ publication for operational W7 closure.

---

# **§15 — Closing**

Doc 10 V1.0 captures Lyceon's brand-and-trust direction and pre-launch legal-document program at a pre-launch moment. The two-surface structure deliberately captures distinct content surfaces — Surface 1 (brand/social-proof/community direction grounded in proof-over-gimmicks) and Surface 2 (legal-document program with W7 launch-gating discipline) — without forcing them into a single register. The document's unique conventions reflect Karl's direction that each Lyceon doc gets to be unique to its content rather than pattern-matching prior docs.

The proof-over-gimmicks principle is the load-bearing anchor of Surface 1\. Lyceon's brand posture is differentiated from EdTech incumbents not by clever positioning but by structural product reality — the locked corpus (LISA architecture, mastery engine, scoring formula, retention model, cascade discipline, free-tier mechanics) is engineered to support honest claims about outcomes, AI, engagement, privacy, and pricing in a way competitors structurally can't.

The pre-launch legal-document inventory is the operational deliverable of Surface 2 — 20 documents across 6 categories that Lyceon needs to produce and publish before launch. The Privacy Policy V1.0 ships alongside Doc 10 V1 as the Phase 1 deliverable, closing the spec-side FWD-07E-05 dependency and preparing W7 for counsel-reviewed publication; operational W7 closure occurs when the Privacy Policy is counsel-reviewed and published, not at Doc 10 V1 lock. The remaining 19 artifacts are Phase 2 work, produced in subsequent delivery cycles to industry-grade legal quality.

Decision-5 reference discipline holds end-to-end. Doc 10 references Doc 07E, Doc 09, Doc 03, Doc 07A, Doc 08, Doc 01, Doc 04, Doc 05, Doc 06D, Doc 06E by exact § citation; never restates their canonical bodies. The legal-document artifacts produced under Phase 2 follow the same discipline — each artifact references canonical owners and bodies disclosure-shape only, not the canonical content itself.

Doc 10 V1's status transition from DRAFT to LOCKED occurs upon external SWE review of the two-surface directional structure \+ clean re-audit. Subsequent W7 closure (counsel review \+ Privacy Policy publication) and Phase 2 artifact production happen post-lock per the §11 program coordination.

**End of Doc 10 V1.0 Draft.**

