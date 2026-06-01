# **Lyceon — Authoritative Platform Directive (Document 00, V5)**

**Version:** 5.0  
**Status:** Authoritative  
**Authority:** Founder \+ CTO approval for meaningful amendments  
**Audience:** Founders, Engineers, Operators, Designers, Growth Leads, AI Agents, Contractors, Future Hires, Auditors  
**Commercial Focus (Current):** SAT  
**Architectural Direction:** Multi-exam capable learning platform  
**Purpose:** Permanent transfer of institutional knowledge, operating doctrine, and system truth

---

# **1\. What This Document Is**

Most startups operate on fragmented memory.

Important context lives in:

* founders’ heads  
* old chats  
* undocumented assumptions  
* half-correct docs  
* legacy code nobody trusts  
* tribal knowledge that disappears when people leave

That model creates repeated waste.

The same mistakes are rediscovered. The same bugs return under new names. New contributors need weeks to understand what should have been obvious on day one.

Lyceon should not run that way.

This document exists to convert scattered knowledge into durable institutional memory.

A strong engineer, operator, or AI system should be able to read this file and understand:

* what Lyceon is building  
* why certain decisions matter more than others  
* what the business model requires  
* where technical debt historically hides  
* what current systems likely look like  
* what must be preserved  
* what must be improved  
* how changes should be approached  
* how quality is judged  
* how Lyceon can win

This document is intentionally long. It is cheaper to read one strong file than waste months relearning preventable lessons.

---

# **2\. What Lyceon Is Really Building**

Lyceon is not merely test prep software.

Lyceon is building a trusted outcomes engine for ambitious students and families.

The visible product may be:

* practice questions  
* full-length exams  
* dashboards  
* study plans  
* AI tutoring  
* subscriptions

But the real product is confidence backed by measurable progress.

Families do not buy features. They buy a believable path toward improvement.

Students do not care about architecture diagrams. They care whether scores rise, anxiety falls, and effort feels productive.

Therefore Lyceon must think beyond software surfaces.

It is building a system that combines:

* learning science  
* operational trust  
* clear metrics  
* reliability  
* personalization  
* modern software leverage  
* credible execution

If those elements are weak, the product feels hollow even if feature-rich.

---

# **3\. Why This Market Rewards Trust**

Education is not casual consumer software.

The buyer often feels pressure:

* college admissions stakes  
* fear of wasted time  
* fear of wasted money  
* fear of underperformance  
* skepticism from prior disappointments

That means trust is not branding polish. Trust is core revenue infrastructure.

Trust is built through:

* honest positioning  
* accurate progress indicators  
* stable sign-in and billing  
* professional support  
* secure handling of accounts  
* visible competence  
* reliable study experiences  
* no gimmicks

Trust is destroyed through:

* broken auth flows  
* billing confusion  
* fake urgency  
* exaggerated score promises  
* buggy core experiences  
* unclear ownership of problems  
* metrics users cannot believe

Many competitors overspend on acquisition while underinvesting in trust systems.

Lyceon should do the opposite.

---

# **4\. Why SAT First, But Only Commercially**

Focus creates momentum.

Trying to launch SAT, ACT, AP, LSAT, MCAT, and broader tutoring simultaneously usually creates mediocre execution everywhere.

Lyceon’s current commercial priority is SAT because disciplined focus beats scattered ambition.

That means prioritizing:

* excellent SAT content  
* realistic SAT exams  
* score-relevant readiness signals  
* SAT-specific growth channels  
* trust with SAT families  
* repeatable conversion systems

However, SAT should be a business wedge, not a technical prison.

The architecture should remain reusable.

SAT-specific logic belongs primarily in:

* scoring adapters  
* timing rules  
* content metadata  
* blueprint mappings  
* benchmark displays  
* exam-specific UI modules

SAT assumptions should not infect:

* authentication  
* billing  
* analytics foundations  
* tutor memory systems  
* scheduling engines  
* guardian systems  
* generic data ownership models

If SAT-specific code spreads everywhere, future expansion becomes expensive and slow.

---

# **5\. Competitive Ambition**

Lyceon should aim to become a category-defining company in academic performance software.

Not merely “another prep platform.”

The target position is:

* most trusted SAT improvement platform  
* highest quality digital learning experience in its category  
* operationally elite education company  
* system families recommend without hesitation  
* company competitors struggle to match because trust \+ execution compound

This ambition matters because timid standards create mediocre outcomes.

---

# **6\. What Lyceon Must Never Become**

Anti-goals are as important as goals.

Lyceon must never become:

## **6.1 A Feature-Bloated Tutoring Toy**

A product full of shiny surfaces that do not materially improve scores.

## **6.2 A Marketing Shell**

Strong ads, weak product, high churn, disappointed families.

## **6.3 A Generic AI Wrapper**

Thin interface on top of commodity models with no durable moat.

## **6.4 A Sloppy Edu SaaS**

Messy billing, broken auth, unreliable sessions, poor support.

## **6.5 A Codebase Nobody Can Safely Change**

Fear-driven engineering where every edit risks random breakage.

## **6.6 A Vanity Metrics Company**

Celebrating clicks, impressions, or signups while outcomes lag.

## **6.7 A SAT Prison**

So overfit to one exam that expansion becomes a rebuild.

Whenever a decision is unclear, ask whether it moves Lyceon toward or away from these anti-goals.

---

# **7\. Current Reality (Honest View)**

Lyceon is an active system with real momentum and real transitional complexity.

Some current infrastructure and code patterns likely reflect rapid iteration rather than ideal final design.

That is normal for growing products. It only becomes dangerous when denied.

The current picture appears to include:

* Vercel-based web deployment flows  
* GitHub source control  
* GitHub Actions CI gates  
* Cloudflare DNS presence  
* Supabase for auth and core data systems  
* Stripe subscriptions  
* Gemini as primary in-product AI runtime

There are also signs of custom or hybrid runtime patterns that work today but should likely be simplified over time.

This is not failure. It is a stage.

The mistake would be pretending temporary architecture is permanent architecture.

---

# **8\. Known Sources of Historical Friction**

These are recurring waste patterns that should be treated seriously.

## **8.1 Authentication Complexity**

When auth becomes overly custom, time disappears into:

* token debugging  
* session mismatch states  
* cookie inconsistencies  
* OAuth regressions  
* edge-case sign-in failures

Auth should feel boring. If auth is dramatic, something is wrong.

## **8.2 Legacy Drift**

Old systems that never fully die create confusion.

Symptoms:

* multiple paths doing similar things  
* uncertainty over canonical owner  
* fear of deleting dead code  
* accidental reintroduction of old bugs

## **8.3 Duplicate Truth Sources**

When app logic, database logic, dashboards, and docs disagree, nobody knows what is real.

This slows every decision.

## **8.4 Patching Symptoms**

Repeated surface fixes without root-cause correction produce endless cycles of “almost solved.”

## **8.5 Weak Documentation**

Without strong docs, every new contributor starts partially blind.

## **8.6 Underused Tool Leverage**

Modern AI, automation, and tooling can compress weeks into hours. Failing to use them is costly.

---

# **9\. Governance Model**

Lyceon should move quickly, but not randomly.

Meaningful platform changes require Founder \+ CTO alignment.

This includes changes to:

* auth model  
* billing logic  
* learning truth systems  
* deployment architecture  
* source-of-truth ownership  
* security posture  
* public trust claims  
* AI operating model  
* this document

The reason is simple: these changes create second-order effects.

A local improvement can cause global damage if poorly reasoned.

---

# **10\. Current Engineering Controls**

Evidence supports a meaningful baseline governance model.

Mainline changes should pass review gates and automated checks.

Current or visible controls include categories such as:

* dependency integrity checks  
* vulnerability scanning  
* security tests  
* type checks  
* route validation  
* deterministic CI tests  
* build verification  
* deploy integrations

This is the correct direction.

The principle should remain:

Nothing meaningful enters production casually.

---

# **11\. Non-Negotiable Invariants**

## **Identity and Access**

### **INV-AUTH-01**

Server systems authorize access. Clients do not self-authorize.

### **INV-AUTH-02**

Payment events do not automatically equal access rights.

### **INV-AUTH-03**

Entitlements must have one canonical owner.

### **INV-AUTH-04**

Guardian visibility must be explicit, scoped, and revocable.

### **INV-AUTH-05**

Students own learning state.

## **Learning Integrity**

### **INV-LEARN-01**

No answer leakage before legitimate submission.

### **INV-LEARN-02**

Practice, review, and full exams are distinct modes with different purposes.

### **INV-LEARN-03**

Mastery must come from legitimate evidence.

### **INV-LEARN-04**

Full-length exams are trust anchors.

### **INV-LEARN-05**

AI systems may assist learning but may not silently inflate progress.

## **Runtime Integrity**

### **INV-RUN-01**

Every meaningful workflow needs one owner.

### **INV-RUN-02**

Mutations must be safe and preferably idempotent.

### **INV-RUN-03**

Silent failures are unacceptable.

### **INV-RUN-04**

Structural duplication should be reduced continuously.

### **INV-RUN-05**

Meaningful changes require proof first.

## **Trust Integrity**

### **INV-TRUST-01**

Public claims must match actual capability.

### **INV-TRUST-02**

User-facing metrics must be explainable.

### **INV-TRUST-03**

Growth tactics must not degrade trust.

---

# **12\. Proof Before Change Doctrine**

Before major refactors, migrations, rewrites, ownership transfers, auth changes, billing changes, or runtime shifts:

first understand the current system.

Required proof pass should identify:

* what exists now  
* who currently owns it  
* user flow impact  
* dependency graph  
* known pain points  
* risks of change  
* rollback path  
* tests affected  
* operational blast radius

Acceptable evidence sources:

* repository files  
* configs  
* CI workflows  
* dashboards  
* logs  
* SQL inspection  
* screenshots  
* production-safe tests  
* official docs

Blind rewrites feel productive but often create hidden regressions.

---

# **13\. Engineering Decision Framework**

## **13.1 Prefer Industry Standards**

Lyceon should not reinvent solved infrastructure.

Default toward proven patterns for:

* OAuth  
* session handling  
* CSRF protection  
* Stripe webhooks  
* retries  
* queues  
* caching  
* logging  
* rate limiting  
* deployment pipelines

Innovation should focus where it matters:

* pedagogy  
* mastery systems  
* tutor quality  
* trust UX  
* planning intelligence  
* growth execution

## **13.2 Use Better Tools**

Every task should prompt the question:

Is there a faster, safer, more repeatable route using:

* AI coding systems  
* audits  
* templates  
* automation  
* scripts  
* stronger libraries  
* observability tools  
* CI improvements

## **13.3 If Facts Matter, Ask**

Guessing critical facts is expensive.

Seek proof.

---

# **14\. Canonical Product Truth Flow**

Questions  
→ Practice / Review / Full Exams  
→ Verified Outcomes  
→ Mastery  
→ KPI / Readiness  
→ Planning  
→ Guardian Visibility  
→ Tutor Context

Downstream layers must not fabricate upstream truth.

Examples:

* tutor cannot directly create mastery  
* marketing cannot invent readiness  
* planning should react to real outcomes  
* guardian surfaces should reflect real status

---

# **15\. Identity, Billing, Guardian Philosophy**

In education software, payer identity and learner identity often differ.

That creates complexity many products mishandle.

Possible actors:

* student  
* parent  
* guardian  
* school supporter  
* admin

These roles may overlap or differ.

Therefore systems must clearly separate:

* who pays  
* who learns  
* who can view  
* who can manage billing  
* who owns progress  
* who receives communications

Blending these roles creates support chaos and trust erosion.

---

# **16\. AI Tutor Philosophy**

The tutor is an accelerator, not a substitute for truth systems.

Its purpose is to help students:

* think clearly  
* unblock confusion  
* learn efficiently  
* recover from mistakes  
* sustain momentum

The tutor must be:

* safe  
* scoped  
* honest  
* logged  
* permission-aware  
* context-aware

The tutor must never become:

* an answer leak path  
* fake expertise theater  
* unauthorized memory sink  
* hidden decision-maker  
* mastery writer

---

# **17\. Security Constitution**

Security is continuous operational discipline.

## **Access Layer**

* secure auth flows  
* session integrity  
* permission checks  
* guardian scope enforcement

## **Abuse Layer**

* rate limiting  
* anti-automation controls  
* anomaly monitoring

Current rate limiting may span multiple layers. Final posture should be durable and distributed.

## **Billing Layer**

* verified webhooks  
* replay protection  
* safe retries  
* entitlement correctness

## **Data Layer**

* least privilege  
* safe defaults  
* secret hygiene  
* safe logs

## **Edge Layer**

Cloudflare should be expanded where justified into:

* CDN  
* WAF  
* traffic protection  
* caching  
* perimeter controls

---

# **18\. Deployment Doctrine**

Current deployment appears serviceable but somewhat custom.

That is acceptable temporarily.

Long-term architecture should make it obvious:

* where frontend lives  
* where APIs live  
* where workers live  
* where logs live  
* how rollbacks happen  
* what scales independently

Possible strong end states:

* cleaner unified web runtime  
* separated frontend \+ persistent API runtime

The best design is the one that is easiest to operate correctly.

---

# **19\. Observability Doctrine**

You cannot improve what you cannot see.

Lyceon should mature observability across:

* signup funnel dropoff  
* auth failures  
* billing failures  
* tutor quality  
* runtime errors  
* latency  
* abuse attempts  
* churn indicators  
* release regressions

Recommended tooling may include:

* Sentry  
* Microsoft Clarity  
* Google Search Console  
* analytics systems  
* structured logs  
* alerting

---

# **20\. Completion Standard**

A task is not complete because code exists.

Meaningful work is complete when relevant items are satisfied:

* implementation quality acceptable  
* tests pass  
* CI passes  
* regressions considered  
* rollback exists  
* docs updated  
* ownership clear  
* runtime behavior verified

Passing CI alone is not enough.

---

# **21\. Incident and Rollback Doctrine**

All meaningful runtime changes must consider:

* blast radius  
* rollback method  
* reversibility  
* user impact  
* owner on point  
* post-rollback verification

Fast reactions matter.

Controlled reactions matter more.

---

# **22\. Growth Doctrine**

Growth must reinforce trust.

Allowed:

* educational SEO  
* honest comparisons  
* useful free tools  
* transparent offers  
* referral systems with integrity  
* trust-building parent surfaces

Not allowed:

* fake urgency  
* unsupported score promises  
* manipulative dark patterns  
* misleading scarcity  
* vanity metrics sold as truth

Long-term trust compounds better than short-term tricks.

---

# **23\. AI Agent Operating Contract**

Any AI system working on Lyceon should follow this order:

## **Step 1**

Read this document.

## **Step 2**

Read the relevant domain spec.

## **Step 3**

Gather proof of the current system before structural recommendations.

## **Step 4**

Propose the smallest correct path.

## **Step 5**

Provide evidence.

Preferred evidence forms:

* file paths  
* lines  
* command outputs  
* workflow references  
* SQL outputs  
* screenshots  
* test results

If missing facts change correctness, ask first.

---

# **24\. Expansion Doctrine**

Current mission:

Become the most trusted SAT improvement platform.

After that, expand through reused architecture into adjacent categories.

Expansion should feel like extension, not rebuild.

---

# **25\. Final Decision Filter**

Before shipping meaningful change, ask:

1. Does this improve outcomes?  
2. Does it preserve trust?  
3. Is ownership clear?  
4. Is it secure?  
5. Is it maintainable?  
6. Can it scale cleanly?  
7. Can we prove it works?  
8. Would a strong future operator thank us for this decision?

If not, reconsider.

---

# **26\. Closing Principle**

Lyceon should be run like a serious company building durable advantage.

Choose truth over vanity.  
Choose systems over patches.  
Choose clarity over confusion.  
Choose trust over gimmicks.  
Choose leverage over waste.  
Choose long-term strength over short-term noise.

