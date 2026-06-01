# **Lyceon — Document 02 Preamble: Assessment Content & Runtime Governance (V3 Final)**

**Version:** 3.0  
**Last Updated:** 2026-04-20  
**Status:** Final Authoritative Control Document  
**Governed By:** Document 00  
**Depends On:** Document 01  
**Applies To:** `DOC_02A_QUESTION_GENERATION.md`, `DOC_02B_RUNTIME_ENGINES.md`, `DOC_02C_MASTERY_KPI_DB.md`  
**Audience:** Engineering, Product, Content, AI Systems, Operations, Auditors, Future Hires

---

# **1\. Why This Preamble Exists**

Lyceon’s assessment layer is central to product trust, learning outcomes, retention, and long-term moat value.

Student outcomes depend on multiple connected systems:

1. content manufacturing  
2. runtime delivery  
3. mastery intelligence  
4. operational controls

If these systems are governed inconsistently, common failures emerge:

* duplicated logic  
* answer leakage  
* misleading metrics  
* brittle launches  
* repo confusion  
* low-trust analytics  
* expensive debugging

This Preamble defines the cross-cutting rules every Document 02 file inherits.

**Always read this file first.**

---

# **2\. Document 02 Suite Structure (Locked)**

| File | Governs | Does Not Govern |
| ----- | ----- | ----- |
| `DOC_02_PREAMBLE.md` | Cross-cutting rules, supersession, invariant namespace, reveal matrix, repo boundaries, governance | Runtime endpoint details, generation internals, mastery formulas |
| `DOC_02A_QUESTION_GENERATION.md` | End-to-end ingestion → extraction → generation → QA → staging publish pipeline in `Lyceonquuestions` | Runtime delivery, mastery writes, user sessions |
| `DOC_02B_RUNTIME_ENGINES.md` | Practice, review, full-length exams, scoring runtime, entitlement gating, reveal-rule enforcement | Content generation internals, mastery formulas |
| `DOC_02C_MASTERY_KPI_DB.md` | Mastery engine, KPI computation, analytics truth, canonical DB contracts, event math | Question generation, runtime endpoint behavior |

---

# **3\. Reading Order**

## **New Reader**

1. Document 00  
2. Document 01  
3. This Preamble  
4. Relevant 02 file for your domain

## **Working Areas**

* Content systems → Preamble → 02A  
* Runtime delivery → Preamble → 02B  
* Progress / DB / KPIs → Preamble → 02C

---

# **4\. Repo Ownership Model**

## **Product Repo Owns Code For**

* frontend product surfaces  
* authentication  
* billing  
* entitlements  
* runtime APIs  
* practice engine  
* review engine  
* exam engine  
* tutor runtime implementation  
* analytics surfaces

## **Separate Content Repo Owns**

* `Lyceonquuestions`

Responsibilities:

* source ingestion  
* parsing  
* generation  
* metadata creation  
* QA pipelines  
* staging writes  
* publish requests

## **Spec Ownership Reminder**

Tutor runtime code may exist in the product repo, but detailed tutor behavior is governed by future Document 03\.

---

# **5\. Canonical Data Ownership**

## **Live Question Bank**

Canonical source used by all runtime systems.

## **Staging Question Bank**

Persistent unpublished candidate pool.

Items remain in staging until:

* promoted  
* rejected  
* archived  
* retired

## **Runtime Tables**

Sessions, attempts, mastery, billing, identities, entitlements, and analytics truth tables remain product-owned domains.

Question generation systems must not mutate those domains.

---

# **6\. Source of Truth & Supersession**

## **Hierarchy**

1. Document 00  
2. Document 01  
3. Latest approved Document 02 suite files  
4. Approved amendments  
5. Legacy PDFs / historical specs  
6. Assumptions

## **Explicit Supersession Map**

| Legacy File | New Governing File |
| ----- | ----- |
| PDF-02 — Question Bank & Canonical Content | 02A \+ this Preamble |
| PDF-03 — Practice Engine | 02B |
| PDF-04 — Full-Length Exams & Scoring | 02B |
| PDF-05 — Adaptive & Mastery Engine | 02C |
| PDF-09 — KPIs, Analytics & Reporting | 02C |
| Question Creation Specs | 02A |
| Reaction / Variant Specs | 02B |
| DB Canonical Runtime Contract | 02C |

## **Not Superseded Here**

* Future Document 03 (Tutor)  
* Future Document 04 (Planning / Calendar)  
* Future Document 05 (Trust / Growth / Compliance)  
* Future Document 06 (Expansion Roadmap)

Legacy files remain historical references only.

---

# **7\. Contradiction Reconciliation Rule**

When newer decisions changed prior specs, future docs must state:

## **Previous Rule**

What old source said.

## **Updated Rule**

What now governs.

## **Why It Changed**

Business, technical, or operational reasoning.

## **Build Impact**

What engineers should implement now.

Silent drift is forbidden.

---

# **8\. Change Control**

Meaningful changes to reveal logic, scoring, generation pipelines, mastery math, or DB contracts require:

## **Governance Record**

Use Section 7 format.

## **Implementation Package**

1. proof of current behavior  
2. proposed replacement  
3. migration plan  
4. rollback path  
5. success metrics

## **Approval Rule**

Cross-file changes, invariant changes, or structural scope changes require Founder \+ CTO approval per Document 00\.

Section 7 explains **what changed and why**.  
Section 8 explains **how it changes safely**.

---

# **9\. Invariant Namespace (Locked)**

## **Cross-Cutting**

* `INV-02-XX`

## **Question Generation**

* `INV-02A-XX`

## **Runtime Engines**

* `INV-02B-XX`

## **Mastery / KPI / DB**

* `INV-02C-XX`

---

# **10\. Inheritance From Prior Documents**

## **Document 00 Principles Flowing Into Doc 02**

* no answer leakage pre-submit  
* mastery must come from legitimate evidence  
* full-length exams are trust anchors  
* AI systems must not silently inflate progress

## **Document 01 Principles Flowing Into Doc 02**

* student owns entitlement  
* guardian visibility is restricted and aggregate-first  
* billing rules gate premium access

These are expanded here, not replaced.

---

# **11\. Cross-Cutting Invariants**

### **INV-02-01**

No runtime engine may depend on unpublished staging content.

### **INV-02-02**

No content generator may write directly to live production question tables.

### **INV-02-03**

All live assessment items require canonical metadata.

### **INV-02-04**

Practice, exams, and tutor use the live canonical bank as question truth source.

### **INV-02-05**

Billing / entitlement rules apply before premium delivery.

### **INV-02-06**

Guardian visibility remains aggregate-only unless explicitly amended.

### **INV-02-07**

Mastery truth must not be rewritten by generation systems.

### **INV-02-08**

Pre-submit client-facing surfaces must never receive correct answers or explanations.

### **INV-02-09**

Internal option metadata and distractor taxonomy must never appear in client-facing responses.

### **INV-02-10**

All assessment systems treat exam family as a parameter, not a hardcoded SAT constant.

---

# **12\. Anti-Leak Reveal Matrix (Authoritative)**

Pre-submit client-facing surfaces must never contain:

* correct answers  
* explanations  
* option metadata  
* distractor taxonomy labels

No feature flag, environment setting, debug mode, or runtime toggle may override this rule.

Any violation is a critical defect.

| Surface | Pre-Submit | Post-Submit | Notes |
| ----- | ----- | ----- | ----- |
| Practice question delivery | Stem, options, assets only | — | No reveal before answer |
| Practice answer result | — | Correctness, answer, explanation | Immediate learning feedback |
| Full exam active attempt | Stem, options, assets only | — | No reveal during exam |
| Full exam review mode | — | Answer \+ explanation | Only after completed submission |
| Tutor during practice | No answer reveal | May use canonical explanation and expand teaching | Practice only |
| Tutor during active full exam | Disabled | Disabled | No tutor access during trust-anchor exam |
| Tutor during exam review | — | May explain and expand | Review phase only |
| Guardian analytics | Aggregate only | Aggregate only | No item-level data |
| Internal analytics | Internal metadata allowed | Internal metadata allowed | Service-role/admin only |

This matrix governs 02A, 02B, and 02C.

---

# **13\. Staging → Promotion Doctrine**

Generate  
→ Validate  
→ Review  
→ Stage  
→ Approve  
→ Promote  
→ Live Bank

## **Validate**

Deterministic checks:

* schema validity  
* answer uniqueness  
* formatting integrity  
* metadata completeness  
* banned patterns  
* structural realism

## **Review**

Automated scoring \+ sampled human review.

Initial reviewers:

* founder/team

Expandable later to trained reviewers.

## **Stage**

Write to staging tables only.

## **Approve**

Founder/team batch approval after Validate \+ Review pass.

Record:

* approver  
* batch ID  
* item count  
* timestamp

## **Promote**

Controlled publish job moves approved staged content to live bank.

---

# **14\. Security & Access Doctrine**

Generation credentials must be system-enforced and scope-limited.

Acceptable enforcement methods:

* database permissions  
* RLS policies  
* credential scoping  
* equivalent technical controls

Generation systems may access:

* source storage  
* generation logs  
* staging tables  
* publish request surfaces

They must not have effective write access to:

* auth systems  
* billing  
* entitlements  
* runtime sessions  
* mastery truth  
* live production bank directly

---

# **15\. SAT-First, Multi-Exam Ready**

Per `INV-02-10`, architecture remains exam-neutral.

SAT-specific behavior belongs in:

* metadata  
* config tables  
* scoring adapters  
* blueprint mappings

Not scattered hardcoded runtime logic.

Future families may include:

* ACT  
* AP  
* MCAT  
* LSAT  
* others by business decision

---

# **16\. AI Governance Doctrine**

AI may accelerate creation and operations.

AI is not final authority.

Live content must pass deterministic checks, review gates, and publish controls.

---

# **17\. Metrics Doctrine**

Optimize for:

* learning outcomes  
* completion  
* explanation usefulness  
* trust  
* retention  
* score gains  
* repeat engagement

Vanity metrics are insufficient.

---

# **18\. Glossary**

## **Canonical Bank**

Approved live question source.

## **Staging Bank**

Persistent unpublished candidate pool.

## **Reveal Rules**

What may or may not be shown before / after submission.

## **Promotion Batch**

Approved staged items promoted together.

## **Question Truth Source**

Canonical item content used by runtime systems.

## **Distractor Taxonomy**

Internal classification of wrong-answer logic.

## **Option Metadata**

Internal option-level labels or scoring annotations.

---

# **19\. Out of Scope For This Suite**

Not fully governed here:

* detailed tutor behavior (Doc 03\)  
* planning/calendar systems (Doc 04\)  
* marketing/trust/compliance (Doc 05\)  
* expansion strategy (Doc 06\)  
* auth / billing identity systems (Doc 01\)

---

# **20\. Change Records**

## **CR-02-P-01**

### **Previous Rule**

Single broad learning runtime spec.

### **Updated Rule**

Four-file suite with explicit ownership.

### **Why It Changed**

Cleaner boundaries and less ambiguity.

### **Build Impact**

Implement against the correct owning file.

---

## **CR-02-P-02**

### **Previous Rule**

Generation could imply direct production writes.

### **Updated Rule**

Generation writes staging only. Promotion controls live release.

### **Why It Changed**

Safety, rollback, QA.

### **Build Impact**

No direct generator writes to live bank.

---

## **CR-02-P-03**

### **Previous Rule**

Reveal rules scattered across legacy specs.

### **Updated Rule**

Single authoritative reveal matrix in this Preamble.

### **Why It Changed**

Cross-cutting rule needed one source of truth.

### **Build Impact**

02A / 02B / 02C reference this matrix and do not redefine it.

---

# **21\. Final Principle**

Lyceon’s assessment layer is the moat.

Protect it with clear ownership, zero answer leakage, deterministic publishing, and trusted runtime behavior.

