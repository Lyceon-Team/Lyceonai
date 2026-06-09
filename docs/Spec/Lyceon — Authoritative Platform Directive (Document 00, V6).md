# **Lyceon — Authoritative Platform Directive (Document 00, V6)**

**Version:** 6.0 **Status:** LOCKED 2026-06-02 (supersedes V5.0) — R1 \+ R2 cleanup applied in-lock-cycle (`RB-00-V6-01..16`, `RB-00-V6-R2-01..05`; no version bump) **Authority:** Founder \+ CTO approval for meaningful amendments **Audience:** Founders, Engineers, Operators, Designers, Growth Leads, AI Agents (Claude / Claude Code / Codex), Contractors, Future Hires, Auditors, Counsel **Commercial Focus (Current):** SAT **Architectural Direction:** Multi-exam-capable learning platform **Governs:** Every document, family, runtime, and operating decision in Lyceon **Purpose:** Permanent transfer of institutional knowledge, operating doctrine, and system truth — and the single high-level map of everything Lyceon has decided

---

## **Supersession Note (V5 → V6)**

V6 supersedes V5.0. V5 was written (April 2026\) before the platform's spec corpus was drafted and locked. Since then the Doc 04, 05, 06, 07, and 10 families have locked, Doc 01A V1.0 (Platform Primitives) became canonical, and a body of operating doctrine, legal direction, and launch-market reality accumulated across drafting cycles that V5 never captured.

V6 keeps everything in V5 that still holds — the mission, the trust thesis, the anti-goals, the canonical principles, the truth flow, the decision filters, the founder voice — and **catches the gaps**: it adds the canonical document map, the two governing doctrines (reference-never-restate; executable-proof), the full build-and-verification lifecycle, the launch-market scope, and the cross-cutting publication conditions. V6 does not restate what the family docs own; it points to them. This is itself the first rule of V6 (§8).

The version bump is deliberate. This is a structural rewrite, not lock-cycle cleanup, so it earns V6 with an explicit supersedes-V5 header rather than a no-bump cleanup pass.

---

# **§0 — About This Document & How To Use It**

Most startups run on fragmented memory: context lives in founders' heads, old chats, undocumented assumptions, half-correct docs, and legacy code nobody trusts. That model rediscovers the same mistakes, lets the same bugs return under new names, and forces every new contributor to spend weeks relearning what should have been obvious on day one.

Lyceon does not run that way. This document converts scattered knowledge into durable institutional memory.

**Doc 00 is the constitution and the index.** It is deliberately high-level. It states what is true platform-wide, names the doctrines every family inherits, and maps where the detail lives. It does **not** reproduce the detail. When this document and a family document appear to conflict on a mechanism, the family document that *owns* that mechanism is canonical for the mechanism; Doc 00 is canonical for the principle.

**How to read it, by role:**

* **New engineer / contractor / AI agent:** read Doc 00 in full, then the Preamble and the family doc for your domain (§3 maps them), then begin work under the lifecycle in §10.  
* **Founder / operator:** §1–§7 (what and why), §13–§16 (markets, publication gates, governance, decision filter).  
* **Auditor / counsel:** §3 (map), §6 (principles), §8–§9 (doctrines), §14 \+ Appendix B (publication conditions).

This document is long because it is cheaper to read one strong file than to waste months relearning preventable lessons.

---

# **§1 — What Lyceon Is**

Lyceon is not merely test-prep software. Lyceon is building **a trusted outcomes engine for ambitious students and families.**

The visible product is practice questions, full-length exams, dashboards, study plans, an AI tutor, and subscriptions. The real product is **confidence backed by measurable progress.**

Families do not buy features; they buy a believable path toward improvement. Students do not care about architecture diagrams; they care whether scores rise, anxiety falls, and effort feels productive.

So Lyceon must think beyond software surfaces. It is building a system that combines learning science, operational trust, clear metrics, reliability, personalization, modern software leverage, and credible execution. If those elements are weak, the product feels hollow even when feature-rich.

---

# **§2 — Why Lyceon Can Be Trusted (Proof Over Gimmicks)**

Education is not casual consumer software. The buyer feels real pressure: college-admissions stakes, fear of wasted time and money, fear of underperformance, and skepticism from prior disappointments. **Trust is therefore not branding polish — it is core revenue infrastructure.**

Trust is built through honest positioning, accurate progress indicators, stable sign-in and billing, professional support, secure account handling, visible competence, reliable study experiences, and the absence of gimmicks. Trust is destroyed through broken auth, billing confusion, fake urgency, exaggerated score promises, buggy core experiences, unclear ownership of problems, and metrics users cannot believe.

Many competitors overspend on acquisition while underinvesting in trust systems. Lyceon does the opposite. **Proof over gimmicks** is the brand posture (Doc 10 §4 owns it) and the engineering posture (this document owns it): every claim Lyceon makes about a student's progress traces to something the platform can actually prove.

---

# **§3 — The Canonical Document Map**

Lyceon's knowledge lives in a numbered document corpus. Each family answers one question and owns its mechanisms. This map is the **index**; it is intentionally summary-grade. Exact section bindings live in each family's own seam table (Doc 06 Parent §7 and Doc 07 Parent §8 are the densest examples).

| Doc | Question it answers / Title | Version & Status | Owns (summary) |
| ----- | ----- | ----- | ----- |
| **00** | How do we operate, and where is everything? *(Authoritative Platform Directive)* | **V6.0 — this doc** | Constitution, canonical principles, governing doctrines, lifecycle, document map |
| **01** | Who is who, and what can they do? *(Identity, Access, Billing & Guardian Trust)* | **V6.0 current; V8 pending** (bounded upgrade-ref scoped to Doc 06D) | Identity, roles, auth, billing, entitlements, MFA, guardian trust, consent, account lifecycle |
| **01A** | What primitives does everything share? *(Platform Primitives)* | **V1.0 — CANONICAL, §-numbered** | Config doctrine, observability (logger / correlation IDs / metrics / PII redaction / alert routing), caching, idempotency, rate-limit ledger, abuse scoring, internal service-auth (HMAC-SHA256) |
| **02** | How is assessment content made and run? *(Assessment Content & Runtime Governance)* | Preamble **V3.0**; 02A (Generation), 02B (Runtime Engines, **V4**), 02C (Mastery/KPI/DB) | Question generation pipeline, runtime engines (practice/review/exam), reveal-rule enforcement, anti-leak reveal matrix, staging→promotion doctrine |
| **03** | How does the AI tutor work? *(LISA — AI Tutor System)* | Main **V1.1 CANONICAL**; 03A V3.0, 03B V4.1, 03C V3.0, 03C.1 V1.0 | LISA persona, modes, surfaces, entitlement gating, usage limits, failure matrix, SLA, GCP orchestration, retention matrix |
| **04** | How are exams scored, and what's the truth anchor? *(Full-Length Exams, Scoring, Diagnostics & Readiness)* | Parent **V3.0**; 04A V2.2, 04B V4.3, 04C V1.0, 04D V1.0 — **LOCKED** | Exam runtime, canonical scoring formula v1.0 (immutable moat), reports, readiness, integrity/audit |
| **05** | How is progress measured? *(Mastery, KPI Rollups, Projections & Audit)* | Parent \+ 05A–05D **V1.0 — LOCKED** | Per-skill/domain mastery formula, KPI rollups, score projections, audit/recompute/deletion-cascade, constants governance |
| **06** | How do we run the platform safely? *(Reliability, Infrastructure, Security & Compliance Operations)* | Parent \+ 06A–06E **V1.0 — LOCKED** | Infra topology, CI/CD & deploy gates, security ops, observability ops, incident response, backup/DR, compliance ops, cost/capacity |
| **07** | How do we measure the business and the learning? *(Metrics, Warehousing, Analytics & Decision Systems)* | Parent \+ 07A–07E **V1.0 — LOCKED** | Event taxonomy, warehouse models, dashboards, experimentation, retention/privacy/cascade, KPI roster |
| **08** | Where is Lyceon going? *(Expansion)* | **Strategic vision artifact — not a contract** | Six expansion dimensions \+ the outcomes-proof compounding-asset thesis; directional. Requires a citation pass before any external use |
| **09** | What is the financial direction? *(Financial Direction, Pricing Posture & Unit Economics)* | **V1.0 — DIRECTIONAL** (lockable per-section only as CPA / counsel / Stripe-verification gates close) | Pricing posture, revenue-recognition direction, unit-economics guidance, Stripe-records retention direction — direction with explicit gate-lists, never hardcoded amounts |
| **10** | How do we present Lyceon, and what must we publish? *(Brand, Public Narrative & Pre-Launch Legal Program)* | **V1.0 — LOCKED**; 7 legal artifacts text-passed / counsel-ready / publish-gated | Brand posture, competitive positioning, social-proof framework, age-threshold taxonomy, legal-document inventory \+ W7 launch-gating |
| **Coding Standards** | How is code written, audited, and shipped? *(Capstone)* | **Planned** — drafted after Doc 00 / 01 / 02 are fully hardened | The detailed implementation manual that sits under the §10 lifecycle; instruction layer for Claude Code, Codex, and human devs |

### **3.1 Doc 10 legal artifacts (text-locked, counsel-ready, publish-gated)**

Privacy Policy V1.0 · Student ToS V2.0 · Parent/Guardian Terms V2.0 · Refund Policy V1.0 · Subscription/Auto-Renewal Notice V1.0 · Honor Code V1.0 · Community Guidelines V1.0. These are **text-passed / lock-conditional**: internally text-locked for counsel review (counsel approves and tightens rather than rewrites), **not approved for publication**. They are not publish-ready until the §14 / Appendix B conditions close and counsel approves. The remaining Phase-2 artifacts (Cookie Policy, Sub-Processor List, Data Retention Schedule, AUP, DPA, and others) are not yet drafted.

**"Locked" in this corpus** means a document is internally version-locked for review and downstream consumption — not, for legal artifacts, that it is approved for publication. Publication is gated by §14 / Appendix B.

### **3.2 Operational doctrine — ownership pointers (reference, never restate)**

V5 carried prose for security, deployment, observability, incident, and cost doctrine. Those now have canonical owners. Doc 00 keeps a one-line pointer and nothing more:

* **Shared primitives** (config, observability conventions, caching, idempotency, rate limiting, abuse scoring, service-auth/HMAC) → **Doc 01A V1.0** (canonical, §-numbered).  
* **Security operations** (secrets handling, access, service-to-service auth operations) → **Doc 06B** \+ Doc 01A.  
* **Deployment, CI/CD, environments, migration/rollback runbooks** → **Doc 06A**.  
* **Observability operations, SLOs, incident response lifecycle** → **Doc 06C** (consuming Doc 01A observability primitives and Doc 03 §26 failure matrix / SLA targets).  
* **Backup / PITR / DR, retention, deletion proof, compliance ops** → **Doc 06D**.  
* **Cost / capacity / vendor** → **Doc 06E** (consuming Doc 03 §24 LISA cost discipline).

If V6 ever appears to define one of these, that is a defect under §8.

---

# **§4 — Why SAT First, But Only Commercially**

Focus creates momentum. Launching SAT, ACT, AP, LSAT, MCAT, and broader tutoring at once produces mediocre execution everywhere. Lyceon's current commercial priority is **SAT**, because disciplined focus beats scattered ambition: excellent SAT content, realistic SAT exams, score-relevant readiness signals, SAT-specific growth channels, trust with SAT families, and repeatable conversion.

But **SAT is a business wedge, not a technical prison.** The architecture stays reusable. SAT-specific logic belongs in scoring adapters, timing rules, content metadata, blueprint mappings, benchmark displays, and exam-specific UI — never in authentication, billing, analytics foundations, tutor memory, scheduling, guardian systems, or generic data ownership. This is enforced doctrine, not aspiration: Doc 02 Preamble INV-02-10 treats exam family as a parameter, never a hardcoded SAT constant. If SAT-specific code spreads everywhere, future expansion becomes a rebuild instead of an extension.

---

# **§5 — Ambition & Anti-Goals**

**Ambition.** Lyceon should become a category-defining company in academic-performance software — the most trusted SAT improvement platform, the highest-quality digital learning experience in its category, an operationally elite education company, the system families recommend without hesitation, and the company competitors struggle to match because trust and execution compound. Timid standards create mediocre outcomes.

**Anti-goals are as important as goals.** Lyceon must never become:

1. **A feature-bloated tutoring toy** — shiny surfaces that do not move scores.  
2. **A marketing shell** — strong ads, weak product, high churn, disappointed families.  
3. **A generic AI wrapper** — a thin interface on commodity models with no durable moat.  
4. **A sloppy edu SaaS** — messy billing, broken auth, unreliable sessions, poor support.  
5. **A codebase nobody can safely change** — fear-driven engineering where every edit risks random breakage.  
6. **A vanity-metrics company** — celebrating clicks and signups while outcomes lag.  
7. **A SAT prison** — so overfit to one exam that expansion becomes a rebuild.

When a decision is unclear, ask whether it moves Lyceon toward or away from these.

---

# **§6 — Canonical Principles**

These are the constitution. They are stated as principles, not as a registry. **Doc 00 does not enumerate or index the platform's invariants** — each family doc owns and numbers its own enforceable invariants (INV-01-xx, INV-02-xx, INV-03-xx, INV-05-xx, INV-06-01..12, INV-07-01..09, and so on). Pulling all invariants into Doc 00 would be bulky and would duplicate canonical owners. Doc 00 states *what must always be true*; the domain docs prove it per domain.

**Identity & access**

* Servers authorize access. Clients never self-authorize, and never carry trusted role or entitlement state.  
* One identity per user. Students own their learning state.  
* Payment ≠ permissions. Entitlements have exactly one canonical owner and are student-scoped.  
* Guardian visibility is **derived** — visible only when the guardian link is active *and* the student entitlement is active — and is explicit, scoped, revocable, view-only, and aggregate-first. Guardians never write student learning state.

**Learning integrity**

* No answer, explanation, option metadata, or distractor taxonomy reaches any client-facing surface before legitimate submission. No flag, env setting, or debug mode may override this. (Doc 02 Preamble §12 owns the reveal matrix.)  
* Practice, review, and full-length exams are distinct modes with distinct purposes.  
* Mastery comes only from legitimate, observed evidence — never inferred, estimated, or derived from "AI confidence." No predicted-score or vanity metrics. (Doc 05 owns the formula.)  
* Full-length exams are the **trust anchor**. (Doc 04 owns scoring.)

**Runtime integrity**

* Determinism after state exists: no randomness in selection once mastery data exists.  
* Every meaningful workflow and every truth source has exactly one canonical owner. Truth flows one way and is auditable.  
* Mutations are safe and idempotent. Silent failures are unacceptable.  
* AI never alters truth without a verified action. The tutor never writes mastery directly.

**Trust integrity**

* Public claims match real capability.  
* User-facing metrics are explainable.  
* Growth tactics never degrade trust.

**Data & minors**

* Lyceon does not intentionally inject account/profile PII into AI prompts; user-submitted LISA content is minimized, filtered, and retention-bounded (operational and safety/support retention windows are owned by Doc 03 and the Privacy Policy — Doc 00 does not restate their mechanics). Minimize data collection on student surfaces. (The no-injected-PII posture and data minimization are Lyceon's strongest compliance assets across every launch regime — preserve them against product pressure.)

---

# **§7 — The Canonical Product Truth Flow**

Truth moves in one direction. Downstream layers never fabricate upstream truth.

Canonical question bank  
  → Practice / Review / Full-length exams        (Doc 02B runtime engines)  
  → Verified outcomes / canonical learning events (source\_family ∈ {test, practice, review})  
  → Mastery (per-skill, per-domain)               (Doc 05A / 05B)  
  → KPIs / readiness / score projection           (Doc 05B / 05C)  
  → Study planning  
  → Guardian visibility (derived, aggregate-first) (Doc 01\)  
  → LISA context                                   (Doc 03\)

The boundaries that make this true:

* **LISA cannot write mastery** (Doc 03 INV-03-01). Tutor-triggered retries flow through the review engine (Doc 02B), which emits canonical events with `source_family='review'`; LISA logs only to tutor tables.  
* **Marketing cannot invent readiness.** Public claims trace to real outcomes (§2, Doc 10).  
* **Planning reacts to real outcomes**; it does not assert them.  
* **Guardian surfaces reflect real status**, derived and aggregate, never item-level (Doc 02 INV-02-06).  
* **Scoring is the anchor.** The Doc 04B canonical scoring formula v1.0 is immutable at v1.0, and forms bind immutably to one scoring-model version at publish; Doc 04B owns the formula and its evidence-packet hash (referenced, not restated here, per §8). Mastery (Doc 05\) carries no calendar/time decay, uses position-based weighting, and never recomputes on a constants change (Doc 05D INV-05D-13).

---

# **§8 — Reference-Never-Restate Doctrine (Decision 5\)**

**Rule.** Where a mechanism, number, schema, or formula is owned by another document, Doc 00 — and every document — *references it by name and section* ("defined in Doc XX §Y; that file is canonical") and adds only the wrapper appropriate to its own scope. No document restates or re-derives another document's owned content.

**Why it is load-bearing.** Lyceon's corpus is large and interdependent. The single most expensive failure class in this project is a downstream doc silently redefining an upstream mechanism — the framing assumption that contradicts a locked sibling and costs a full restructure to unwind. Reference-never-restate makes the corpus mechanically auditable: every cross-doc claim either resolves to a named owner or is a defect.

**Mechanical check.** Any line in any document that restates a number, schema, or mechanism owned elsewhere — rather than citing it — is a drafting defect, caught in the cross-doc audit pass. Doc 06 Parent §5 operationalizes this rule for the operations corpus; Doc 00 elevates it to a platform constitution.

**Highest-risk restatement traps** (always reference-only): the Doc 04B scoring constants; the Doc 05 mastery formula and weights; Doc 03 §11 usage caps and §24 cost tiers; Doc 01A primitives; specific pricing amounts (Stripe owns at runtime; Doc 09 references shape only). If you find yourself typing one of these values into a document that does not own it, stop and cite instead.

---

# **§9 — Executable-Proof Doctrine (Decision 4\)**

**Principle.** Outputs without proof are incorrect. A capability claim is only as real as the runnable mechanism that proves it.

This applies to specs and to code alike. In the spec corpus (Doc 06 family), every invariant that asserts a capability must name the test or scheduled job that proves it and the proof artifact it produces — a capability statement with no named proving mechanism is a drafting defect. In code (the §10 lifecycle), every claim of correctness must carry file:line evidence, exact command output, or verbatim error text. "Appears to," "likely," and "should work" are disallowed.

**Proof discipline (always):**

* No proof → no claim.  
* Required evidence forms: file paths and line numbers, exact command output, workflow references, SQL output, screenshots, test results.  
* If a missing fact would change correctness, ask before proceeding — do not guess.

Doc 06 Parent §4 owns the operational executable-proof contract (proving-mechanism \+ proof-artifact durability). Doc 00 elevates the principle to apply to everything Lyceon produces.

---

# **§10 — The Build & Verification Lifecycle**

Everything Lyceon produces — a spec or a feature — moves through one verification loop. The loop exists so that nothing meaningful enters production casually and so that every artifact is provably correct against a locked contract.

**Code vs. spec/legal artifacts.** For **code**, all eight phases apply literally (`contracts/`, annotations, build, CI, deploy). For **specs and legal artifacts**, the lifecycle applies **by analogy**: authoring → review → cleanup → audit → lock → publication gates (there is no literal code build/CI/deploy for a document). The discipline is the same; the mechanics differ.

The Coding Standards Doc (capstone, §3) is the **detailed manual** that sits under this lifecycle and references it as canonical. Doc 00 owns the loop's shape, gates, and proof obligations; the Coding Standards Doc owns the mechanics (lint rules, annotation schema, skill files, routing table).

## **10.1 The eight phases**

| Phase | Name | What happens | What it must produce |
| ----- | ----- | ----- | ----- |
| **0** | **Spec authoring & lock** | Claude drafts → ChatGPT reviews → in-lock-cycle cleanup with grep-traceable `RB-<DOC>-V<N>-NN` tags (no version bump) → multi-pass audit → R2 \= lock | A locked spec \= the correctness contract |
| **1** | **Validation contract** | Before any code, write the validation contract in the designated validation-contract location (currently `contracts/`, with exact mechanics owned by the Coding Standards Doc), mapped to the routing table. It defines correctness *independently of implementation* | A contract Codex can audit against |
| **2** | **Implement** | Claude Code writes against the locked spec \+ contract, with `@spec` / `@implemented` annotations | Annotated, spec-aligned code |
| **3** | **Build \+ internal audit subagent** | Build under strict gates (no `any`, no `@ts-ignore`, typecheck). **A dedicated internal audit subagent runs a full self-compliance pass** against spec \+ contract \+ canonical principles before any handoff — the "grill-me" discipline, catch-your-own-defects | A clean build \+ an internal self-audit report; defects fixed before Phase 4 |
| **4** | **External audit** | Codex, read-only, audits compliance against spec \+ contract \+ invariants. No improvements beyond spec | A PASS / FAIL / PARTIAL verdict with file:line findings |
| **5** | **QA / test** | Anti-leak, idempotency, denial, and redaction tests; state how tested and what would falsify the fix | Green tests proving the invariants the change touches |
| **6** | **CI gate** | Required checks run. Pre-launch: soft linting warnings. Post-launch / hardening: hard CI failures | A reproducible CI result; *passing CI is necessary, not sufficient* |
| **7** | **Deploy gate** | Compliance gates are deploy gates. Enumerated deploy-blocking items must clear before deploy | A deploy that no compliance/upstream gate blocks |

## **10.2 Two distinct audit gates**

Phase 3 and Phase 4 are deliberately separate. The Phase-3 **internal audit subagent** is the implementer grilling its own work so defects never reach the independent gate. The Phase-4 **external Codex audit** stays genuinely independent: read-only, compliance-only, no improvements beyond spec, every finding carrying file:line evidence. Self-audit does not replace independent audit; it protects it.

## **10.3 The three-gate spine**

Across Phases 2–6: **Claude Code writes → Codex audits → CI validates.** Pre-launch, gates may be advisory **for non-critical polish only**. Security, auth, billing, anti-leak, under-13 handling, privacy/data-leak, and minor-safety gates are **hard (blocking) before any public launch** — they are never advisory. Post-launch / hardening, all gates are hard. The annotation schema (`@spec [Doc-ID_version, section] | @implemented [YYYY-MM-DD] | plain English: what the code does, expected outcome, trade-offs, edge cases`) makes each gate's job mechanical.

## **10.4 AI agent operating contract**

Any AI system working on Lyceon follows this order: (1) read Doc 00; (2) read the relevant domain spec; (3) gather proof of the current system before structural recommendations; (4) propose the smallest correct path; (5) provide evidence. If missing facts change correctness, ask first.

## **10.5 Completion standard**

A task is not complete because code exists. It is complete when: implementation quality is acceptable, tests pass, CI passes, regressions are considered, a rollback exists, docs are updated, ownership is clear, and runtime behavior is verified. One atomic change per step; stop on ambiguity; never batch unrelated fixes. **Passing CI alone is not enough.**

## **10.6 Proof before change**

Before major refactors, migrations, rewrites, ownership transfers, or auth/billing/runtime shifts, first understand the current system: what exists, who owns it, user-flow impact, dependency graph, known pain points, risk of change, rollback path, tests affected, blast radius. Acceptable evidence: repo files, configs, CI workflows, dashboards, logs, SQL inspection, screenshots, production-safe tests, official docs. Blind rewrites feel productive but create hidden regressions.

## **10.7 Engineering decision framework**

Prefer industry standards for solved infrastructure (OAuth, sessions, CSRF, Stripe webhooks, retries, queues, caching, logging, rate limiting, deployment). Innovate where it matters: pedagogy, mastery, tutor quality, trust UX, planning intelligence, growth. Use better tools (AI coding systems, audits, templates, automation, observability) to compress weeks into hours. If facts matter, seek proof — guessing critical facts is expensive.

---

# **§11 — Identity, Billing & Guardian Philosophy**

In education software, payer identity and learner identity often differ. Possible actors: student, parent, guardian, school supporter, admin. These roles overlap or differ, so systems must clearly separate who pays, who learns, who can view, who manages billing, who owns progress, and who receives communications. Blending these creates support chaos and trust erosion.

Doc 01 V6.0 owns the mechanism (V8 pending). The platform-level commitments Doc 00 holds:

* Students own learning state; guardians are view-only and aggregate-first; guardian association is one-primary-per-minor and revocable with a defined data-export window.  
* **Age thresholds are not one number.** Age-of-majority, the digital-consent threshold, and the LISA minimum age (≥ 13\) are distinct. Doc 10 §2.4 owns the canonical age-threshold taxonomy and all Phase-2 legal artifacts inherit it.  
* COPPA posture: a genuine server-side age gate **blocks** under-13 account creation — no knowingly permitted under-13 accounts and no COPPA VPC flow at V1; Lyceon's launch posture does not place minors as payor of record. Doc 01 \+ the Privacy Policy \+ Parent Terms own the detail (see §13).

---

# **§12 — LISA Philosophy & AI-Honesty Doctrine**

LISA (the AI tutor) is an accelerator, not a substitute for truth systems. Its purpose is to help students think clearly, unblock confusion, learn efficiently, recover from mistakes, and sustain momentum. The persona is the moat; the wiring is best-in-class commodity (Gemini via Vertex AI). Doc 03 Main V1.1 owns LISA.

LISA must be safe, scoped, honest, logged, permission-aware, and context-aware. LISA must never become an answer-leak path, fake-expertise theater, an unauthorized memory sink, a hidden decision-maker, or a mastery writer.

Platform-level commitments Doc 00 holds:

* **LISA never writes mastery** (Doc 03 INV-03-01). Guardians have **zero routine product access** to LISA conversations or transcripts (Doc 03 INV-03-05 governs routine access). Safety-limited excerpts may be disclosed to a parent/guardian **only** under the safety-review process and the Privacy Policy / Parent Terms — this is an out-of-band, process-gated exception, not a guardian-facing LISA feature. (Whether Doc 03 INV-03-05 is absolute or scoped to routine access is tracked as **Watch Item W-00-01**.)  
* **AI-honesty.** LISA is honest about being AI, corrects rather than flatters, and does not fabricate capability or progress. The Privacy Policy (§3.4 / §8) owns the user-facing honesty and correction language.  
* **No intentionally injected PII in prompts.** Lyceon does not add account/profile PII to AI prompts; user-submitted LISA content is minimized, filtered, retention-bounded, and excluded from routine guardian visibility. Operational and safety/support retention windows, and account-level training-exclusion controls, are owned by Doc 03 and the Privacy Policy (Privacy Policy §4.3 / §9.7; Doc 03 §14.2 retention matrix) — Doc 00 does not restate their mechanics.  
* LISA is disabled during live full-length exams and available only in review-safe post-submit contexts (Doc 02 Preamble §12 reveal matrix).

---

# **§13 — Tier 1 Launch Markets & Regulatory Gates**

Brief summary; the detail is owned elsewhere (Doc 10 §2.4 age taxonomy; Doc 08 expansion Dimension 2; the legal artifacts; Doc 06D compliance ops).

**Tier 1 candidate launch markets:** United States, Canada, United Kingdom, Ireland, Australia, New Zealand, Singapore. Recommended sequence: US → UK → Canada (Quebec potentially deferred for French-language \+ DPO) → AU / NZ / SG / IE. **A market is not "live" until the counsel and implementation gates for that market close** (matching the Privacy Policy's "may be made available" framing); some carry child-design obligations (UK, AU) and consent/representative posture decisions that are counsel-gated.

**Live regulatory gates (must be honored before the relevant market launches):**

* **COPPA amended rule (general compliance date April 22, 2026, now in effect; except certain §312.11 safe-harbor provisions):** Lyceon's V1 posture is a genuine server-side under-13 age gate, **no knowingly permitted under-13 accounts**, delete-on-discovery handling, and **no COPPA verifiable-parental-consent (VPC) flow** — Parent/Guardian Terms are not a VPC mechanism. A COPPA VPC flow is built only if a future under-13 product is explicitly approved by counsel and rebuilt for COPPA-grade verifiable parental consent.  
* **EU AI Act Article 50 transparency obligations (apply from August 2, 2026, subject to counsel verification and any Digital/AI Omnibus transition or amendment):** interactive-AI disclosure to **EU users**. UK users are governed by Lyceon's AI-honesty policy and any UK-specific counsel-verified requirement (the AI Act is EU law and not a UK obligation unless mirrored). Lyceon adopts AI-honesty disclosures ahead of the deadline as a trust and product-design posture regardless.  
* **Ireland digital-consent threshold is 16** for Article 8 (GDPR) consent-based processing of information-society services offered to a child (Data Protection Act 2018 §31) — not every processing operation for Irish 13–15 users is blocked, but Ireland launch requires a dedicated parent/guardian consent architecture and counsel-approved lawful-basis mapping before accepting Irish 13–15 users.  
* **EU Article 11a withdrawal function (Dir 2023/2673, 19 June 2026):** checkout withdrawal function (Doc 09 / Subscription Notice §7.7).  
* **India DPDP** defines children as under-18 — a dedicated architecture sprint, deferred to a later phase. **Brazil** deferred.

Lyceon's no-injected-PII posture and data minimization (§6) are the strongest compliance assets across all of these and must be preserved against product pressure.

---

# **§14 — Cross-Cutting Publication Conditions**

A body of conditions must close between "counsel-ready" and "publish-ready" / "deploy-ready." These are operating commitments, not policy text. The brief summary is below; the full **25-item registry is Appendix B**.

* **Corporate (2):** Delaware C-corp formation (postal/legal-entity fields in Privacy Policy); single Effective-Date update across all legal artifacts (currently a placeholder).  
* **Counsel (4):** EU/UK representative \+ DPO posture; EU/UK digital-content vs digital-service classification; sign-off on minor-safety / authority-escalation / automated-moderation / sexualized-minor-content language; regional incorporation-by-reference in Parent Terms.  
* **Engineering — checkout/billing (6):** California ARL consent \+ recordkeeping; EU Article 11a withdrawal function by 19 June 2026; Stripe-portal cancellation prod-verify; annual-reminder jobs; price-change workflow; no-surprise-upgrades enforcement for minor accounts.  
* **Engineering — data/privacy (4):** LISA 7+90-day retention impl; training-exclusion controls; under-13 hard-delete \+ financial carve-out; sub-processor reality check.  
* **Engineering — guardian/minor (4):** one-primary-Guardian-association DB enforcement; revocation \+ 30-day export; guardian-visibility server-side enforcement; clickwrap acceptance with parent/minor linkage.  
* **Engineering — moderation/safety (4):** in-product report function; appeal workflow; automated moderation bounded to temporary actions; minor-safety escalation.  
* **Bundle (1):** all seven consumer-facing legal docs publish together.

---

# **§15 — Governance, Change Control & Decision Authority**

Lyceon moves quickly but not randomly. **Meaningful platform changes require Founder \+ CTO alignment** — changes to the auth model, billing logic, learning-truth systems, deployment architecture, source-of-truth ownership, security posture, public trust claims, the AI operating model, or this document. **Counsel approval is additionally required** for legal, privacy, consumer-protection, minor-safety, or public-policy changes. These changes create second-order effects; a local improvement can cause global damage if poorly reasoned.

**Lock discipline (corpus-wide):**

* In-lock-cycle cleanup (blockers, highs, mediums surfaced by review) is applied with grep-traceable `RB-<DOC>-V<N>-NN` register tags, status stays "Locked," **no version bump.**  
* Changes that require substantive re-architecture trigger a **new version** with an explicit supersedes header (this document is an example).  
* Spec workflow direction is one-way: **Claude drafts → ChatGPT reviews → cleanup feeds the next Claude cycle.** Never the reverse.  
* Tiered change control where a doc declares it: e.g., the Doc 04B scoring formula is canonical and immutable at v1.0; only a Tier-3 (new-version) protocol may change it. Constants are not tunable within a version.  
* **Pending-version notes are update-required.** Any "Vn pending" note in this document (e.g., Doc 01 V8 in §3) must be removed or updated when the target document locks, so the constitution does not carry stale version state.

**Why the discipline exists.** Historical friction in early Lyceon came from auth that was too custom, legacy drift, duplicate truth sources, symptom-patching, weak docs, and underused tooling. The lock discipline, the single-canonical-owner rule, and the lifecycle in §10 exist to retire those failure classes permanently. Auth should feel boring; if auth is dramatic, something is wrong.

---

# **§16 — The Decision Filter**

Before shipping meaningful change, ask:

1. Does this improve outcomes?  
2. Does it preserve trust?  
3. Is ownership clear (single canonical owner)?  
4. Is it secure?  
5. Is it maintainable?  
6. Can it scale cleanly?  
7. **Can we prove it works** (executable proof, §9)?  
8. **Does it reference rather than restate** what another doc owns (§8)?  
9. Would a strong future operator thank us for this decision?

If not, reconsider.

---

# **§17 — Glossary (Domain Truth, Brief)**

* **Canonical bank** — the approved live question source; the question truth for all runtime systems.  
* **Trust anchor** — full-length exams; the most credible measurement Lyceon produces.  
* **Mastery** — derived per-skill / per-domain competence from observed events only; never inferred. NULL when evidence is below threshold.  
* **Entitlement** — student-scoped access right with one canonical owner; not granted by payment alone.  
* **Guardian association** — the active, revocable link that, with an active entitlement, derives guardian visibility (aggregate-first, view-only).  
* **`source_family`** — the provenance of a canonical learning event (`test` / `practice` / `review`); tutor-triggered retries carry `review`.  
* **Executable proof** — a runnable mechanism (test, scheduled job, command output) that demonstrates a capability holds, plus the durable artifact it produces.  
* **Reference-never-restate** — cite the owning doc \+ section; never re-derive its content.  
* **Reveal matrix** — the authoritative pre/post-submit disclosure table (Doc 02 Preamble §12).

---

# **§18 — Closing Principle**

Lyceon is run like a serious company building durable advantage.

Choose truth over vanity. Choose systems over patches. Choose clarity over confusion. Choose trust over gimmicks. Choose leverage over waste. Choose proof over assertion. Choose references over restatement. Choose long-term strength over short-term noise.

The system does not guess. Agents do not infer. Outputs without proof are incorrect.

---

# **Appendix B — Cross-Cutting Publication Conditions Registry**

The 25 conditions that gate the corpus between counsel-ready / spec-locked and publish-ready / deploy-ready. Consolidated from the lock cycles of Doc 10 plus the seven consumer-facing legal artifacts, and the locked spec families. Each is an operating commitment outside the policy/spec text it conditions.

| \# | Category | Condition | Conditions / Source |
| ----- | ----- | ----- | ----- |
| 1 | Corporate | Delaware C-corp formation → update postal address \+ legal entity | Privacy Policy §16.1 |
| 2 | Corporate | Single Effective-Date update across all seven consumer-facing legal artifacts (placeholder today; Doc 10 is an internal spec and carries no public effective date) | The seven legal artifacts |
| 3 | Counsel | EU/UK representative \+ DPO posture decided pre-EU/UK/Ireland launch | Privacy Policy; Doc 10 §11.8 |
| 4 | Counsel | EU/UK digital-content vs digital-service classification | Refund (RP-LC-01); Subscription Notice |
| 5 | Counsel | Sign-off on minor-safety / authority-escalation / automated-moderation / sexualized-minor-content language | Community Guidelines (CG-LC-05) |
| 6 | Counsel | Parent Terms §19 regional incorporation-by-reference | Parent Terms (PG-LC-06) |
| 7 | Eng — billing | California ARL separate consent \+ recordkeeping | Sub Notice (SN-LC-01/02); Refund (RP-LC-03) |
| 8 | Eng — billing | EU Article 11a withdrawal function by 19 June 2026 | Sub Notice §7.7 (Dir 2023/2673) |
| 9 | Eng — billing | Stripe-portal cancellation prod-verify | Sub Notice |
| 10 | Eng — billing | Annual-reminder jobs before annual-plan launch | Sub Notice (SN-LC-04) |
| 11 | Eng — billing | Price-change notice workflow (30-day material / 7-day non-material) | Sub Notice (SN-LC-05) |
| 12 | Eng — billing | No-surprise-upgrades enforcement for minor accounts | Parent Terms (PG-LC-05) |
| 13 | Eng — data/privacy | LISA 7+90-day retention implementation | Privacy Policy §9.7 |
| 14 | Eng — data/privacy | Training-exclusion controls implementation | Privacy Policy §4.3 |
| 15 | Eng — data/privacy | Under-13 hard-delete \+ financial-record carve-out | Privacy Policy §9.4 |
| 16 | Eng — data/privacy | Sub-processor reality check before publish | Privacy Policy / sub-processor list |
| 17 | Eng — guardian/minor | One-primary-Guardian-association DB enforcement | Parent Terms (PG-LC-02) |
| 18 | Eng — guardian/minor | Revocation workflow \+ 30-day data export | Parent Terms (PG-LC-03) |
| 19 | Eng — guardian/minor | Guardian-visibility APIs server-side enforcement | Parent Terms (PG-LC-04) |
| 20 | Eng — guardian/minor | Clickwrap acceptance with parent/minor linkage (Appendix-A patterns) | ToS / Parent Terms / Honor Code / CG (ST-LC-01, PG-LC-01, HC-LC-02, CG-LC-04) |
| 21 | Eng — moderation/safety | In-product report function | Honor Code / CG (HC-LC-02, CG-LC-01) |
| 22 | Eng — moderation/safety | Appeal workflow via hello@lyceon.ai | Honor Code / CG (HC-LC-03, CG-LC-01) |
| 23 | Eng — moderation/safety | Automated moderation bounded to temporary actions | CG §6.1 (CG-LC-02) |
| 24 | Eng — moderation/safety | Minor-safety escalation matching Privacy Policy \+ Parent Terms | CG (CG-LC-03) |
| 25 | Bundle | All seven consumer-facing legal artifacts publish together | All artifacts (RP-LC-04) |

---

# **Watch Items**

Tracked open items the constitution carries forward. Not lock-blocking, but they must not remain informal.

* **W-00-01 — Doc 03 / legal-artifact LISA safety-disclosure reconciliation.** Before publication, confirm whether Doc 03 INV-03-05 prohibits *all* guardian LISA access or only *routine product* access. If absolute, amend Doc 03 or issue a reconciliation memo so that safety-limited excerpt disclosure under the Privacy Policy / Parent Terms does not conflict with the LISA invariant. Owners: Doc 03 \+ legal-artifact program. Referenced in §12.

---

# **Change Records**

## **CR-00-V6-01 — Structural rewrite V5 → V6**

**Previous rule.** Doc 00 V5 (836 lines): founder philosophy \+ 18 numbered constitutional invariants \+ tactical doctrine (security, deployment, observability, incident prose inlined).

**Updated rule.** Doc 00 V6: constitution \+ canonical document map (index) \+ brief doctrine summaries pointing to canonical owners, per the reference-never-restate and executable-proof doctrines. Invariant enumeration removed from Doc 00 (domain docs own their invariants); operational doctrine prose replaced by ownership pointers (§3.2); new build-and-verification lifecycle (§10); launch markets (§13); publication conditions (§14 \+ Appendix B).

**Why it changed.** V5 predated the locked spec corpus (Doc 04/05/06/07/10 families, Doc 01A V1.0) and a body of operating, legal, and launch-market decisions it never captured. The governing document had to catch those gaps and stop restating what families now own.

**Build impact.** All work proceeds under the §10 lifecycle. Cross-doc references resolve to named owners. Doc 00 is canonical for principles; family docs are canonical for mechanisms.

---

*End of Document 00 V6.0 — Supersedes V5.0. Open: Watch Item W-00-01; §14 / Appendix B publication conditions.*

