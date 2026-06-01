# **Lyceon — Document 02A: Question Generation & Content Supply Chain (V6)**

**Version:** 6.0 **Last Updated:** 2026-04-20 **Status:** Authoritative SWE Specification **Owner:** Founder / CTO Review **Governed By:** Document 00, Document 01, Document 02 Preamble V3 **Applies To:** `Lyceonquestions` repository and all systems that ingest, generate, validate, review, or publish assessment content **Supersedes (within scope):** PDF-02 Question Bank & Canonical Content, PDF-QR Question Creation & Option Integrity (generation scope only; reaction policy governed by 02B)

---

# **Table of Contents**

1. Purpose and Mission  
2. Scope and Out-of-Scope  
3. Inheritance from Preamble V3  
4. Current-State vs Target-State Doctrine  
5. Repository Ownership Model  
6. Core Invariants  
7. End-to-End Pipeline Architecture  
8. Source Ingestion Layer  
9. Raw Storage and Provenance  
10. Extraction Layer  
11. Canonicalization Layer  
12. Reference Intelligence Layer  
13. Generation Runtime Contract  
14. Canonical Question ID System (Locked from PDF-02)  
15. Canonical Candidate Output Schema  
16. Canonical Question Record Schema (Directional)  
17. Difficulty Standard (Locked, Supersedes PDF-02 §15)  
18. Distractor Taxonomy v1 (Starter Closed Enum)  
19. Internal Option Metadata Contract  
20. Explanation Standard  
21. SAT Realism and Anti-AI-Tell Rules  
22. Prompt Contract and Versioning  
23. Automated QA Gate System  
24. Duplicate Detection Contract  
25. Failure Handling and Repair vs Discard  
26. Human Review Operations  
27. Publishing / Upsert Contract  
28. Current Integration Model (Verify Before Refactor)  
29. Target Integration Model and Migration Path  
30. Monitoring After Publish  
31. Retirement and Revision  
32. Feedback Integration Contract  
33. Failure Modes Table  
34. Pipeline Observability  
35. CI / Testing Standards  
36. Security and Credential Boundaries  
37. Verification Before Refactor Checklist  
38. Change Records  
39. Worked Example: One Question, Source to Live  
40. Final Principles

---

# **1\. Purpose and Mission**

## **Purpose**

Lyceon needs a durable system for producing trusted assessment inventory at scale. The company cannot depend on static question libraries, one-time authoring bursts, undocumented manual uploads, random AI generations, or untracked publishing behavior. Each of these approaches has failure modes that compound: libraries decay, one-time bursts don't cover skill gaps that emerge over time, untracked uploads create auditability holes, random generation produces content that students detect as fake, and untracked publishing makes rollback impossible.

This document governs the operating system that replaces all of those approaches with a controlled content supply chain.

## **Strategic Mission**

Build a repeatable engine that converts trusted academic references into original, high-quality, metadata-complete questions suitable for practice sessions, review systems, full-length exams, tutor explanations, analytics, and future exam families.

The system optimizes for quality over volume, originality over copying, auditability over guesswork, repeatability over improvisation, and long-term compounding advantage over short-term throughput.

## **Why This Matters**

Many companies can call an LLM and ask it to produce SAT questions. Few can build a disciplined content factory that learns from trusted references, generates realistic inventory, catches defects, avoids duplicates, improves continuously from student outcomes, and powers multiple product surfaces from one canonical bank. That system compounds over time in ways a prompt-and-pray approach cannot. The calibration data accumulates. The error-pattern distractor library accumulates. The feedback loop between tutor, practice, and generation tightens. Competitors can copy the UI, the pricing, the brand positioning. They cannot copy the accumulated operational discipline and the data it produces. That is the moat this document defends.

---

# **2\. Scope and Out-of-Scope**

## **In Scope**

This document governs source ingestion, parsing, extraction, canonicalization, reference retrieval, generation prompts, candidate creation, metadata contracts, automated QA validation, duplicate prevention, reviewer workflow, publish jobs, and question-bank writes.

## **Out of Scope**

This document does not govern runtime delivery of questions (02B), mastery engine or KPI systems (02C), billing or entitlements (Doc 01), identity or authentication (Doc 01), tutor runtime behavior (future Doc 03), marketing or public question previews (future Doc 05), student session orchestration (02B), or reaction policy and deterministic variant selection (02B — separate from generation even though the taxonomy enum in §18 is shared across both).

## **Supersession Declaration**

This document supersedes PDF-02 Question Bank & Canonical Content for all sections on content model, schema, publishing, versioning, and retrieval views — except the canonical ID system and option contract which are carried forward verbatim per §14 and §19. It supersedes PDF-QR Question Creation & Option Integrity for all generation, distractor, option\_metadata, taxonomy, realism, and prompt contract content. Reaction policy and deterministic variant selection from PDF-QR are governed by 02B, not here.

Legacy PDFs move to `docs/old-spec-docs/` as historical reference only.

---

# **3\. Inheritance from Preamble V3**

02A inherits all Preamble V3 cross-cutting invariants. The following are particularly load-bearing for this document:

* **INV-02-02** (no direct writes to live) shapes the staging → promotion target-state architecture in §29. Current-state credentials per §28 must be scoped to prevent accidental cross-table writes until the target state is in place.  
* **INV-02-03** (canonical metadata required) shapes the generation output contract in §15 and the QA metadata completeness gate in §23.  
* **INV-02-04** (live canonical bank is question truth source) shapes the upsert behavior in §27 and the retirement mechanism in §31.  
* **INV-02-07** (generation systems cannot rewrite mastery truth) shapes credential scoping in §28 and §36.  
* **INV-02-08 and INV-02-09** (anti-leak reveal rules) are enforced at runtime by 02B, but 02A is the upstream producer of the `option_metadata` structures those invariants govern. §19 specifies the internal-only split.  
* **INV-02-10** (exam-family parameterized) shapes the schema in §16 and the pipeline's treatment of `exam_family` as a configuration value rather than a hardcoded constant.

Where 02A introduces its own invariants (INV-02A-XX in §6), they elaborate rather than override these. Each INV-02A-XX is annotated with the Preamble invariants it elaborates where applicable.

---

# **4\. Current-State vs Target-State Doctrine**

This specification uses two operating lenses throughout.

## **Current-State**

The implementation likely present today or in near-term practical use. May include shortcuts, broad credentials, or missing audit trails acceptable for pre-launch velocity but not acceptable long-term.

## **Target-State**

The preferred mature architecture after controlled migration. Stronger isolation, tighter permissions, atomic batches, rollback discipline, versioned contracts.

## **Mandatory Rule**

Before any meaningful refactor or implementation change, the engineering team must:

1. Inspect actual repository code to determine current behavior  
2. Inspect actual database schema and data to determine current state  
3. Inspect deployed runtime behavior to determine current dependencies  
4. Compare verified current state to this specification  
5. Migrate intentionally with a documented gap path

No refactoring from assumption. Silent drift between spec and production is treated as a bug.

## **Why This Matters**

Specs that describe only the target state become fiction over time because teams cannot tell whether they are working from the spec or from legacy code. Specs that describe only the current state become obsolete the moment anything changes. Specs that describe both, with a named gap, stay useful across the migration window and provide a clear record of intentional change. This is standard CTO-grade governance for systems that cannot afford drift.

---

# **5\. Repository Ownership Model**

## **Canonical Generation Repository**

`https://github.com/Lyceon-Team/Lyceonquestions`

## **Generation Repository Owns**

Content ingestion code, parsers, prompt files, generation runtime, QA validation logic, review queue tooling, publishing jobs, batch approval workflow, content operational metrics, and all content-manufacturing CI.

## **Product Repository Owns**

Student runtime (practice, review, exam engines), tutor runtime, authentication, billing, entitlements, analytics UI, mastery systems, live product APIs, and the authoritative database schema.

## **Repository Separation Rationale**

The separation is about concerns (content manufacturing versus product runtime), not engineering standards. All Lyceon Coding Standards apply equally to `Lyceonquestions` — TypeScript strict mode, Zod-at-every-boundary, structured logging, pnpm package manager, no `any` types, no `@ts-ignore`, testing requirements. The generation repo is not a playground.

Shared types between repositories (generator output schemas, canonical record schemas, taxonomy enums) may be syndicated from the product repo's `packages/shared` as a published npm package, or duplicated with a versioning convention that prevents drift. The mechanism is a V7 implementation detail; the requirement is that schema divergence between repos is a bug and CI must catch it.

## **Why This Matters**

Monolithic repositories make content ops changes slow because every content prompt tweak requires running full product CI. Separate repositories let content operations iterate independently without destabilizing runtime. The cost is cross-repo coordination for shared types, which is manageable with a disciplined versioning contract. The bigger risk is the generation repo drifting from product engineering standards, which is why this document explicitly requires Coding Standards compliance.

---

# **6\. Core Invariants**

### **INV-02A-01 (elaborates INV-02-01, INV-02-02)**

No generated item becomes live without passing all blocking QA gates and receiving batch approval from an authorized approver.

### **INV-02A-02 (elaborates INV-02-03)**

Every live question has explanation coverage conforming to §20.

### **INV-02A-03 (elaborates INV-02-03)**

Every live question carries complete canonical metadata per §16.

### **INV-02A-04**

Publishing operations are idempotent. Re-running an approved batch produces the same outcome as the first run.

### **INV-02A-05 (supersedes PDF-02 §15)**

Difficulty is integer `1`, `2`, or `3` only (`1` \= Easy, `2` \= Medium, `3` \= Hard). No component in the generation pipeline, QA gates, prompt outputs, metadata contracts, or DB writes may reference difficulty values outside this set.

### **INV-02A-06**

Exact duplicates must not publish. Near-duplicates are governed by §24 thresholds.

### **INV-02A-07 (elaborates INV-02-08, INV-02-09)**

Internal option metadata and distractor taxonomy must never appear in any client-facing response, tutor reveal during active sessions, guardian dashboard, or public export. Runtime enforcement is 02B's responsibility; 02A's responsibility is producing the data structures correctly so runtime can enforce.

### **INV-02A-08 (elaborates INV-02-10)**

Generation pipeline treats `exam_family` as a parameter. No SAT hardcoding outside configuration, metadata mappings, or scoring adapters.

### **INV-02A-09**

Prompts, taxonomies, QA logic, and generation model selections are versioned assets. Changes follow Preamble §8 change control.

### **INV-02A-10**

Source lineage is retained for every item from source file to live bank.

### **INV-02A-11**

Canonical IDs are generated product-side at promotion time per §14. `Lyceonquestions` never issues IDs that reach `public.questions`.

### **INV-02A-12**

Retired items remain in `public.questions` with `active_status = retired`. Items are never deleted — retirement preserves historical session references.

---

# **7\. End-to-End Pipeline Architecture**

Trusted Sources  
  → Ingest  
  → Extract  
  → Normalize  
  → Retrieve References  
  → Generate Candidates  
  → Automated QA Validation  
  → Human Review (risk-based sampling)  
  → Batch Assembly  
  → Approval  
  → Promotion / Upsert  
  → Live Bank  
  → Monitor  
  → Feedback  
  → Improve

Every live question should be traceable through this chain by `batch_id` and `source_lineage`.

## **Why This Matters**

The lifecycle is the audit trail. If any stage cannot be reconstructed for a given live item, the content operation has lost control of its supply chain. Traceability from live question back to original source file is what makes this system a content factory rather than a content lottery.

---

# **8\. Source Ingestion Layer**

## **Approved Source Classes**

* Official public SAT practice material (College Board released tests)  
* Public SAT blueprint and specification documents  
* Internal authored content (founder/team-created reference items)  
* Existing rows in `public.questions` (used as anchors, not regenerated)  
* Structured skill taxonomy files  
* Future licensed datasets (pending legal approval)

## **Conditional Source Classes**

Contractor-authored material (after approval workflow), third-party educational references (after legal and quality approval).

## **Prohibited Source Classes**

Unverified scraped internet content, random test-prep blog material, unknown answer-key sources, unverifiable PDFs, copyrighted content beyond permitted reference use.

## **Copyright Posture**

Official College Board materials are copyrighted. Lyceon references these as structural and stylistic anchors — topic distribution, difficulty pacing, stem patterns, explanation tone — but does not reproduce them. All Lyceon items are independently authored via the generation pipeline. When using official content as anchor input, the anchor itself is not stored in live production assets or exposed to users; only generated derivatives pass through promotion. This matches the legal posture of third-party SAT prep providers like Magoosh and Princeton Review who author in the style of official content rather than licensing or copying it.

## **Why This Matters**

The quality ceiling of any generation system is the quality floor of its sources. Low-trust sources produce low-trust output no matter how clever the prompting. The prohibited list exists because those source classes have predictable failure modes: scraped content has unknown licensing, blog material often has wrong answer keys, unverified PDFs may have OCR errors or anonymized content that has already degraded. Restricting inputs is cheaper than cleaning outputs.

---

# **9\. Raw Storage and Provenance**

## **Current Direction**

Google Cloud Storage as the object store for raw sources, with architecture designed to allow provider migration later. Specific provider choice is an implementation decision; the requirement is an immutable object store with versioning, checksums, and structured paths.

## **Required Properties Per Stored Source**

* Immutable raw archive (source files never modified in place; new versions are new objects)  
* Versioned folder structure  
* Content checksum (SHA-256 or equivalent) recorded at ingestion  
* Ingestion timestamp  
* Source provenance record (filename, source type, origin notes, parser version)  
* Recoverability (full pipeline can be re-run from archived sources)

## **Suggested Bucket Structure**

raw/  
  sat/  
    official/  
    references/  
  internal/  
  licensed/  
processed/  
  extracted/  
  canonicalized/  
exports/

## **Why This Matters**

Without immutable raw archives, the pipeline cannot be re-run when prompts, parsers, or taxonomies change. Every major system change would require re-ingesting sources, which is costly and often impossible when sources are deprecated or lost. The raw storage layer is insurance against future pipeline improvements. The checksum requirement catches silent corruption during storage or transfer.

---

# **10\. Extraction Layer**

Source files arrive in heterogeneous formats: PDFs, DOCX, images, CSV, JSON, plain text, structured spreadsheets, and folder-based legacy item drops. The extraction layer converts these into structured machine-usable records.

## **Extraction Functions**

* OCR for image-based or scanned content  
* Text extraction from PDFs and DOCX  
* Passage detection and segmentation for reading items  
* Question stem identification  
* Answer option extraction with key preservation  
* Answer key capture  
* Image and diagram capture to `/processed/assets/`  
* Table capture for data-interpretation items  
* Formula capture (LaTeX where possible)

## **Legacy Filename Contract**

Existing files in `Lyceonquestions` encode metadata in filenames. Observed pattern:

\<Difficulty\> \- \<Skill\> \- \<Domain\> \- \<Section\> \- \<Legacy ID\>

Examples from the current repository:

Easy \- Right triangles and trigonometry \- Geometry and Trigonometry \- Math-10  
Hard \- Command of Evidence \- Information and Ideas \- Reading and Writing \- 98

Parser contract:

* Delimiter: `-` (space-hyphen-space). Skill and domain names may contain internal hyphens.  
* Difficulty mapping: `Easy` → `1`, `Medium` → `2`, `Hard` → `3` per INV-02A-05  
* Section mapping: `Math` → `M`, `Reading and Writing` → `RW`  
* Filenames not matching the pattern route to a manual review queue with raw filename preserved

## **Why This Matters**

Extraction failures compound. A wrong answer key extracted at this stage produces a wrong canonical question at live stage, which shows students wrong content for as long as it remains unretired. Image and diagram capture matters because SAT items frequently depend on visual content; text-only extraction produces items students cannot actually solve. The legacy filename contract matters because the existing repo represents real organizational work that should be absorbed, not discarded.

---

# **11\. Canonicalization Layer**

Different sources describe similar concepts differently. Canonicalization normalizes extracted records into a shared schema before generation.

## **Normalization Functions**

* Unify section labels (`Math` / `math` / `M` → `M`; `Reading and Writing` / `RW` / `Verbal` → `RW`)  
* Map domain synonyms to canonical domain names  
* Map skill synonyms to canonical skill codes  
* Standardize answer option formatting (order A/B/C/D, strip extraneous whitespace)  
* Standardize difficulty labels per INV-02A-05  
* Split multi-part question sets into individual records  
* Attach source lineage (source filename, extraction timestamp, parser version)  
* Detect obvious duplicates against existing bank before generation begins

## **Why This Matters**

Canonicalization is the point where sources stop looking like sources and start looking like candidates. If this layer is weak, downstream systems (generation, QA, analytics) have to handle every source variation separately, which is brittle and expensive. A strong canonicalization layer means every downstream stage operates on clean, predictable inputs.

---

# **12\. Reference Intelligence Layer**

Generation quality depends heavily on reference quality. Without anchoring, LLM output drifts toward the most common patterns in training data, which for SAT-like questions means textbook clones, generic phrasing, and predictable distractors. Reference anchoring shifts the probability distribution toward the style and rigor of actual SAT items.

## **Method A — Direct Retrieval (current practical mode)**

Hand-curated reference items are selected per generation call and included inline in prompts as style anchors. Simple to set up, no embedding infrastructure required. Appropriate while the reference library is small (under \~500 items).

## **Method B — Indexed Retrieval / RAG (target mature mode, component)**

Reference material is chunked, embedded (Supabase pgvector or equivalent), and retrieved dynamically by semantic similarity to the target skill and difficulty.

## **Method C — Hybrid (target mature mode)**

Curated exemplars are always included in prompts for style anchoring; RAG retrieval supplements with topic- and difficulty-matched references. This is the long-term operating model.

## **Transition Trigger**

Move from direct retrieval to hybrid when any of these becomes true: reference library exceeds \~500 items (prompts can no longer fit the curated set), generation throughput exceeds manual curation capacity, or generation quality signals indicate reference diversity is a limiting factor. Transition is a content-ops decision recorded as a change record.

## **Why This Matters**

This is the single most important lever for generation quality, and it compounds. Better references produce better candidates, which produce better calibration signals at runtime, which inform which references to add next. Competitors who skip reference anchoring produce content that feels almost-SAT-but-not-quite, which students detect immediately. The gap between "SAT-like" and "SAT-native" is small on the page and catastrophic for trust.

---

# **13\. Generation Runtime Contract**

Every generation run receives structured inputs and is expected to return candidates conforming to §15.

## **Required Inputs**

* `exam_family` (e.g., "SAT")  
* `section` (`M` or `RW` for SAT)  
* `domain`  
* `skill_codes` (array of canonical skill identifiers)  
* `difficulty` (integer in {1, 2, 3} per INV-02A-05)  
* `style_references` (array of reference items included inline)  
* `uniqueness_constraints` (embeddings or identifiers of nearby existing items to avoid)  
* `output_schema` (the §15 canonical candidate schema)  
* `taxonomy_enum` (the §18 distractor taxonomy v1 inline, as a closed list)  
* `explanation_standard` (the §20 structure inline)

## **Provider Doctrine**

Model provider is replaceable. Use the best approved model available at the time, provided outputs pass all downstream QA gates and regression tests. The contract matters more than the vendor; switching from one provider to another is a versioned change under Preamble §8 but does not require spec amendment.

## **Why This Matters**

Structured inputs are the difference between "make 100 SAT questions" (which produces unusable output) and a contract the model can actually fulfill. Every input in the required list is there because generation without it produced characteristic failure modes in earlier experiments: without uniqueness constraints, the model produces near-duplicates of existing items; without taxonomy\_enum inline, distractors lack misconception coverage; without explanation\_standard inline, explanations drift toward chatty or motivational tone that degrades trust.

---

# **14\. Canonical Question ID System (Locked from PDF-02)**

## **Authoritative Format**

Every published question receives an immutable canonical ID:

SAT{SECTION}{SOURCE}{RANDOM}

## **Expanded Structure**

{TEST}{SECTION}{SOURCE}{RANDOM}

| Component | Length | Meaning |
| ----- | ----- | ----- |
| SAT | 3 | Exam identifier |
| M or RW | 1–2 | Section code |
| 1 or 2 | 1 | Source type |
| XXXXXX | 6 | Random uppercase alphanumeric `[A-Z0-9]` |

## **Total ID Length**

* Math: `SATM1XXXXXX` → 10 characters  
* Reading & Writing: `SATRW2XXXXXX` → 11 characters

Length variance is intentional and acceptable. Any code parsing IDs must handle both lengths.

## **Section Codes (Locked)**

| Code | Meaning |
| ----- | ----- |
| `M` | Math |
| `RW` | Reading & Writing (combined section) |

Reading and Writing are one SAT section. They are not separated at the canonical ID level. Sub-domain and skill breakdowns handle internal differentiation per §16.

## **Source Type Codes (Locked, Wording Modernized)**

| Code | Meaning |
| ----- | ----- |
| `1` | Source-derived content (originally `PDF-derived` in PDF-02; wording modernized per CR-02A-05) |
| `2` | AI-generated content |

This enables provenance auditing, QA filtering, dataset analysis, and future licensing boundary enforcement.

## **Random Identifier Segment**

* Exactly 6 characters  
* Uppercase alphanumeric `[A-Z0-9]` only  
* Cryptographically random  
* No semantic meaning  
* Generated once, at publish time  
* Collision-checked against live bank before commit

## **Examples**

SATM1Q7A9K2  
SATRW2L9X3FZ  
SATM2K7Q4P1  
SATRW1A3B5C7

## **Generation Authority**

Canonical IDs are generated **product-side at promotion time**, not by the generation pipeline. `Lyceonquestions` produces candidates without a canonical ID; the product-side promotion job fills in the ID during the upsert into `public.questions`. This boundary exists because:

* Collision checking must happen against the live production database, which the generation repo should not have broad access to  
* ID authority belongs with the system that owns the live bank  
* Generation repo compromise or bug cannot produce duplicate or malformed IDs  
* Staging can use temporary `staging_id` values (UUIDs) that have no relationship to the canonical ID assigned at promotion

## **ID Generation Rules**

* Generated only when publishing / promoting  
* Never regenerated  
* Never reused (even if the original item is retired)  
* Never derived from content text  
* Never sequential  
* Collision-checked at insert against `public.questions.id`  
* Preserved across content versions (revisions increment `version`, not `id`)

## **Operational Meaning**

The canonical ID is an opaque durable identifier, not a taxonomic label. It carries only section and source-type information as structural prefixes. All other item metadata lives in the record per §16.

## **Why This Matters**

Locking this format prevents three failure modes: (1) drift toward UUIDs loses the structural information (section, source type) that makes IDs debuggable; (2) drift toward sequential IDs leaks production timing and volume information; (3) drift toward content-derived IDs creates collision risk when two items happen to produce the same hash. The random 6-char segment is long enough to make collisions rare (36^6 ≈ 2 billion combinations) and short enough to be human-readable in logs. Generating at promotion time rather than generation time ensures the authority boundary matches the data boundary.

---

# **15\. Canonical Candidate Output Schema**

Every generated candidate must conform to this schema before entering QA. Invalid shape fails immediately.

{  
  "stem": "string",  
  "passage": "string | null",  
  "options": \[  
    {"key": "A", "text": "string"},  
    {"key": "B", "text": "string"},  
    {"key": "C", "text": "string"},  
    {"key": "D", "text": "string"}  
  \],  
  "correct\_answer": "A | B | C | D",  
  "explanation": "string",  
  "metadata": {  
    "exam\_family": "SAT",  
    "section": "M | RW",  
    "domain": "string",  
    "skill\_codes": \["string"\],  
    "difficulty": 1,  
    "estimated\_time\_seconds": 75  
  },  
  "option\_metadata": {  
    "A": {"role": "correct", "error\_taxonomy": null},  
    "B": {"role": "distractor", "error\_taxonomy": "sign\_error"},  
    "C": {"role": "distractor", "error\_taxonomy": "misread\_question"},  
    "D": {"role": "distractor", "error\_taxonomy": "equation\_setup\_error"}  
  },  
  "generation\_attribution": {  
    "prompt\_version": "sat\_math.v1.0.0",  
    "model\_version": "provider-model-identifier",  
    "generated\_at": "ISO-8601 timestamp"  
  }  
}

Validation uses Zod per Coding Standards §7 at the generation output boundary. The schema is the source of truth; the TypeScript type is inferred from the schema, not defined separately.

Note the absence of an `id` field. Canonical IDs are assigned product-side at promotion per §14. Staging records use a temporary `staging_id: uuid` for tracking during review.

## **Why This Matters**

A generation call without a structured output contract is not a contract, it's a request. Every field in the schema exists because its absence produced a specific downstream failure in earlier iterations. `generation_attribution` exists so that when a generation regression is detected (say, low QA pass rate on a batch), the specific prompt version and model version can be identified and rolled back. Without attribution, prompt changes become untraceable and rollback is guesswork.

---

# **16\. Canonical Question Record Schema (Directional)**

The live `public.questions` table holds the canonical question record. This schema is directional; authoritative DB schema is owned by 02C.

\-- Directional schema; authoritative version owned by 02C  
\-- Reconciled from PDF-02 §9 \+ PDF-QR §3 \+ difficulty lock per INV-02A-05

questions (  
  id text primary key,              \-- SAT{M|RW}{1|2}XXXXXX per §14  
  section text check (section in ('M','RW')),  
  source\_type int check (source\_type in (1,2)),  
  domain text not null,  
  skill\_codes text\[\] not null,  
  difficulty int check (difficulty between 1 and 3),  
  stem text not null,  
  passage text,  
  options jsonb not null,            \-- student-visible per §19  
  correct\_answer text not null,      \-- 'A'|'B'|'C'|'D'  
  explanation text not null,  
  option\_metadata jsonb,             \-- internal-only per §19  
  assets jsonb,  
  status text check (status in ('draft','qa','published','retired')),  
  version int not null default 1,  
  created\_at timestamptz not null default now(),  
  published\_at timestamptz,  
  retired\_at timestamptz,  
  source\_lineage jsonb,              \-- provenance per §10  
  generation\_attribution jsonb,      \-- prompt\_version, model\_version, etc  
  estimated\_time\_seconds int,  
  premium\_flag boolean default false,  
  quality\_score numeric,  
  issue\_flags text\[\]  
)

question\_versions (  
  id uuid primary key,  
  question\_id text references questions(id),  
  version int,  
  diff jsonb,  
  editor\_id uuid,  
  created\_at timestamptz not null default now()  
)

The generator produces output matching §15. The upsert path (§27) maps generator output into this schema, assigns the canonical ID, and inserts or updates.

## **Divergence Between Directional Schema and Live Schema**

If the live `public.questions` schema differs from this directional schema at the time of implementation, that divergence is tracked as follows:

* Fields in this schema not in the live table represent target-state additions requiring a 02C migration  
* Fields in the live table not in this schema represent legacy columns that must be either documented here or deprecated  
* The authoritative reconciliation happens in 02C; 02A cites this schema as the directional contract

## **Why This Matters**

Without a consolidated schema, generator output and DB write target drift silently. Every drift is an integration bug that manifests as failed upserts, lost metadata, or — worst case — successful upserts that silently drop fields. The version log (`question_versions`) carries forward from PDF-02 §11.3 and is the audit trail for item revisions; without it, fixing a typo in an explanation is indistinguishable from rewriting the question.

---

# **17\. Difficulty Standard (Locked, Supersedes PDF-02 §15)**

## **Canonical Scale**

| Value | Label |
| ----- | ----- |
| `1` | Easy |
| `2` | Medium |
| `3` | Hard |

## **Supersession Notice**

PDF-02 §15 previously locked difficulty as integer 1–5. That specification is superseded per CR-02A-02.

Per INV-02A-05, no component in the generation pipeline, QA gates, prompt outputs, metadata contracts, or DB writes may reference values outside {1, 2, 3}. Existing 1-5 references in legacy specs are historical only.

## **Build Impact of Supersession**

The DB constraint on `public.questions.difficulty` must change from `check (difficulty between 1 and 5)` to `check (difficulty between 1 and 3)`. Any existing 4 or 5 difficulty values in production must be remapped before the constraint is changed; verify via DB inspection per §37. Downstream 02B selection algorithms using difficulty bands must use the new range. 02C mastery difficulty multipliers must use the new range.

## **Why This Matters**

A 5-point scale sounds more granular than a 3-point scale but in practice produces label drift — reviewers inconsistently classify 2 vs 3 vs 4, and the distinctions stop meaning anything. A 3-point scale forces meaningful distinctions. The tradeoff is less fine-grained calibration data; this is acceptable because calibrated difficulty (which will come from IRT or similar at 02C's discretion) provides the fine granularity, while the categorical scale provides human-meaningful labels. Locking now prevents every downstream system from inventing its own mapping.

---

# **18\. Distractor Taxonomy v1 (Starter Closed Enum)**

## **Version**

`distractor_taxonomy.v1`

Every `option_metadata` record records the taxonomy version used. Every generation prompt includes the current enum inline as a closed list.

## **Math Labels (v1)**

* `sign_error`  
* `arithmetic_slip`  
* `equation_setup_error`  
* `unit_error`  
* `graph_read_error`  
* `concept_gap`  
* `partial_reasoning`  
* `misread_question`

## **Reading & Writing Labels (v1)**

* `detail_misread`  
* `inference_overreach`  
* `evidence_mismatch`  
* `grammar_rule_error`  
* `sentence_boundary_error`  
* `rhetorical_purpose_error`  
* `vocab_context_error`  
* `partial_reasoning`

## **Enforcement Rules**

* Generators receive the current enum inline in every generation prompt and must select exactly one label per distractor from this list  
* The correct answer's `error_taxonomy` is always `null`  
* Each distractor has exactly one taxonomy label  
* QA rejects any item carrying a label outside the current enum per §23  
* Taxonomy evolution (v2, v3, etc.) requires a versioned update with migration mapping from old labels to new labels per Preamble §8 change control  
* Ad-hoc prompt edits that introduce new labels are forbidden

## **Relationship to PDF-QR §5**

PDF-QR §5 defined a longer taxonomy with labels that have been consolidated or renamed in v1. See CR-02A-04 for the full mapping from PDF-QR labels to v1 labels.

## **Why This Matters**

Closed enums are the difference between taxonomy-as-infrastructure and taxonomy-as-vibe. Without a closed enum, generators invent labels per run, QA cannot deterministically validate, and downstream analytics (02C) cannot join student attempts to distractor intent. The starter-and-evolve approach (rather than a fully locked enum) accepts that real student error data may reveal labels that merge, split, or emerge — but evolution happens through versioned updates, not prompt drift. The "taxonomy sprawl is a hidden quality problem" principle from PDF-QR §5 still applies: a short stable list is better than a large clever list no generator uses consistently.

---

# **19\. Internal Option Metadata Contract**

## **Student-Visible `options` (sent pre-submit and post-submit per Preamble §12)**

\[  
  {"key": "A", "text": "..."},  
  {"key": "B", "text": "..."},  
  {"key": "C", "text": "..."},  
  {"key": "D", "text": "..."}  
\]

No metadata of any kind. Just keys and text.

## **Internal-Only `option_metadata` (never sent to clients)**

{  
  "A": {"role": "correct", "error\_taxonomy": null},  
  "B": {"role": "distractor", "error\_taxonomy": "sign\_error"},  
  "C": {"role": "distractor", "error\_taxonomy": "misread\_question"},  
  "D": {"role": "distractor", "error\_taxonomy": "equation\_setup\_error"}  
}

## **Required Fields Per Option**

* `role`: `"correct"` | `"distractor"`  
* `error_taxonomy`: one of the current `distractor_taxonomy.v1` enum values (for distractors) or `null` (for the correct answer)

## **Optional Generation-Time Fields**

* `generation_confidence`: numeric, model's self-reported confidence (if available)  
* `generation_notes`: string, internal authoring notes

## **Anti-Leak Rule (Absolute)**

Per Preamble §12 and INV-02-08, INV-02-09: generators produce both structures; staging stores both; live bank retains both; runtime (02B) serves only the student-visible structure. This is absolute — no feature flag, debug mode, environment setting, or runtime toggle may override this rule. Any violation is a critical defect.

## **Why This Matters**

The dual-structure approach is what makes distractor analytics possible without leaking design intent to students. Storing role and taxonomy on the question record once (rather than computing per-attempt) makes analytics joins cheap and keeps the hot-path attempt write small. If this metadata ever leaks to students, it breaks three things at once: students learn which option was designed as which trap (eliminating the trap's effectiveness); tutor conversations become contaminated because the model starts reasoning from internal labels rather than student-visible text; and the moat data (distractor effectiveness patterns) becomes public information competitors can scrape.

---

# **20\. Explanation Standard**

Every live question requires explanation coverage per INV-02A-02. Explanations are the primary educational payload of the product — weak explanations weaken the whole runtime regardless of question quality.

## **Required Structure**

1. The first sentence states the correct answer and the core reason it is correct.  
2. Subsequent sentences name the concept or skill being tested and walk the reasoning. For Math, this is the solution path. For Reading & Writing, this is the evidence trail — what in the passage or sentence supports the answer.  
3. When a specific wrong answer is a common trap, the explanation may close by naming why that wrong answer is tempting and why it fails. Optional but recommended for hard items.

## **Length Guidance**

* Difficulty 1 (Easy): 2–4 sentences  
* Difficulty 2 (Medium): 3–6 sentences  
* Difficulty 3 (Hard): 4–8 sentences

Explanations exceeding these ranges require justification in `generation_notes` and are flagged for human review.

## **Tone Requirements**

Match the tone of official College Board explanations: instructional, direct, test-native.

Prohibited:

* Chatty openers ("Great question\!", "Let's dive in\!")  
* Motivational content ("You've got this\!", "Don't worry if you missed this one")  
* Hedging language ("It might be that...", "One possible interpretation is...")  
* Meta-commentary about the question itself ("This is a tricky one because...")  
* AI-sounding phrases ("Let's break this down", "In summary")

## **Good vs Bad Examples**

### **Bad (chatty, AI-sounding)**

"Great question\! The answer is C because when we think about it carefully, we can see that the passage supports this interpretation. This is a really common trap that students fall into, so don't feel bad if you picked something else. The key thing to remember is..."

### **Good (College Board style)**

"C is correct. The passage states in lines 42-44 that 'the committee rejected the proposal on procedural grounds,' which directly supports the claim that the proposal failed due to process rather than substance. A (substance-based rejection) contradicts the explicit textual evidence."

### **Bad (hedgy, uncertain)**

"The answer is probably B, since it seems like this might be the most likely interpretation, although you could argue for A in some cases depending on how you read the passage..."

### **Good (direct, confident)**

"B is correct. Substituting x \= 3 into the expression yields 2(3)² \- 5 \= 13\. A (17) results from squaring after multiplying: (2·3)² \- 5 \= 31\. C (7) results from omitting the square: 2·3 \- 5 \= 1 adjusted for sign. D (-1) results from a sign error in the final subtraction."

## **Why This Matters**

Students read explanations when they get questions wrong. A weak explanation at that moment is when the product fails them — they miss the question, consult the explanation, and learn nothing, which both fails the learning objective and erodes trust. The structure requirement ensures every explanation answers the three questions a struggling student asks: what's the answer, what was this testing, and how should I have reasoned about it. The tone requirement exists because chatty or motivational explanations feel like a consumer app and lose the test-prep trust College Board earned.

---

# **21\. SAT Realism and Anti-AI-Tell Rules**

Synthetic SAT-style questions must read like native SAT material, not like an AI model imitating test prep. Students detect the gap immediately, and the gap is the most common failure mode of AI-generated educational content.

## **Banned Stem-Level AI-Tells**

* Unnatural parallelism reading more polished than test-native language  
* Filler intensifiers ("quite," "rather," "significantly") where SAT stems use direct phrasing  
* Generic framing phrases ("Overall," "In summary," "It can be said that")  
* Stiff synonym substitutions no human item writer would choose  
* Explanation-style phrasing in the stem (explanation belongs in the explanation field, not the stem)  
* Motivational or explanatory voice in the stem

## **Banned Option-Level AI-Tells**

* Oddly symmetrical option sets (all four options same length, same structure)  
* Correct answer standing out by being longer, cleaner, or more polished than distractors  
* Repeated stem language mechanically copied into every option  
* Telltale paired opposites making elimination trivial unless the real SAT pattern would justify it  
* Hedging phrases inside answer options ("might be," "could possibly")  
* Explanation-style phrasing inside what should be a terse answer choice

## **Section-Specific Writing Discipline**

### **Math**

Use clean mathematical setup, concise exact wording, natural variable usage, and graph/data language that mirrors official tests. Avoid wordiness, faux-rigorous jargon, answer choices that differ only cosmetically, and explanation-like answer text. Real SAT Math options are typically short (often single numbers, expressions, or short phrases). Generated options should match.

### **Reading & Writing**

Use tight sentence-level editing, realistic rhetorical moves, natural but formal prose, and authentic grammar/synthesis framing. Avoid chatty tone, inflated vocabulary for its own sake, options that sound like tutoring advice rather than test answers, and clunky AI symmetry. Real SAT R\&W items are carefully edited — generated items that feel looser than the surrounding prose stand out immediately.

## **Distractor Design Rules**

* Plausible to a partially prepared student — filters nonsense distractors that inflate correctness artificially  
* Distinct from other distractors — prevents three versions of the same mistake  
* Consistent with the stem and context — keeps wrong answers from feeling arbitrary  
* Not visibly longer, cleaner, or more hedged than peers — avoids accidental answer cues  
* Mapped to exactly one taxonomy label per §18 — supports QA and analytics

For Math, a distractor might represent a sign slip, wrong equation setup, or misuse of units. For R\&W, a distractor might represent detail misread or evidence mismatch. The point is to make wrong options diagnostic without making them obvious.

## **Why This Matters**

Realism is the moat. Students can distinguish "almost SAT-like" from "SAT-native" in seconds, and that distinction determines whether they trust the product enough to use it for real prep. The banned patterns exist because each one is a recurring failure mode of AI-generated content — they're not hypothetical. The section-specific discipline exists because Math and R\&W have different writing conventions that generic "SAT style" prompts miss. Every rule in this section is a rule that, if violated, produces content students notice and trust less.

---

# **22\. Prompt Contract and Versioning**

Prompts are version-controlled files in the `Lyceonquestions` repository. Ad-hoc undocumented prompts are operational debt.

## **Prompt Storage**

prompts/  
  sat\_math\_generation.v1.0.0.md  
  sat\_rw\_generation.v1.0.0.md  
  regression/  
    sat\_math\_generation.v1.0.0/  
      golden\_001.json  
      golden\_002.json  
      ...

## **Versioning Convention**

Semantic versioning: `<family>.v<major>.<minor>.<patch>`

* Patch (v1.2.3 → v1.2.4): prose clarifications, no behavior change expected  
* Minor (v1.2.x → v1.3.0): added constraints, expanded examples, still backward-compatible  
* Major (v1.x.x → v2.0.0): schema change, taxonomy change, structural change — requires regression sign-off against golden outputs

Every generation output carries `prompt_version` in `generation_attribution`.

## **Required Prompt Structure**

Every prompt includes:

* Output schema from §15 inline  
* Taxonomy enum from §18 inline as closed list  
* Explanation standard from §20 inline  
* SAT realism rules from §21 inline  
* Difficulty target per INV-02A-05  
* Domain, skill, section targets  
* Style references (inline reference items)  
* Uniqueness constraints (identifiers of nearby existing items)

## **Regression Testing**

Each active prompt version has at least 10 golden outputs in `prompts/regression/<prompt_family>/`. CI runs the prompt against the golden inputs and fails if outputs diverge from goldens beyond tolerance (directional: cosine distance \> 0.15 on output embedding or any structural diff in schema fields).

## **Change Control**

Prompt changes follow Preamble §8 change control. Major version bumps require documented justification, golden regression sign-off, and an approval from the content operations owner.

## **Why This Matters**

Prompt changes are silent by default — the output just becomes slightly different, and the difference can be hard to detect without regression tests. Without versioning, attributing a quality regression to a specific prompt change is guesswork. Without regression tests, breaking changes ship to generation and only get caught when QA pass rate or student complaint rate shifts. The cost of regression infrastructure is paid once; the cost of lacking it recurs every time a prompt changes.

---

# **23\. Automated QA Gate System**

Candidates pass through deterministic gates before human review. Every gate has explicit pass/fail criteria.

## **Blocking Gates (must pass to advance)**

| Gate | Pass Criteria | On Failure |
| ----- | ----- | ----- |
| Schema validity | Output matches §15 Zod schema | Discard, log prompt regression signal |
| Exactly one correct answer | `option_metadata` contains exactly one `role: "correct"` | Discard |
| Four options present | `options.length === 4`, keys A/B/C/D, all non-empty | Discard |
| No duplicate option text | All 4 option texts distinct after whitespace normalization | Discard |
| Difficulty in range | `difficulty ∈ {1, 2, 3}` | Discard |
| Answer key integrity | `correct_answer` matches the key of the option with `role: "correct"` | Discard |
| Metadata completeness | `section`, `domain`, `skill_codes`, `difficulty`, `estimated_time_seconds` all present | Discard |
| Taxonomy labels valid | All distractor `error_taxonomy` values in current §18 enum; correct answer's is null | Discard |
| Explanation present | Non-empty string, ≥20 characters | Discard |
| No exact duplicate | Not identical to any item in live bank or current staging batch | Discard |
| Near-duplicate check | Semantic similarity \<0.95 vs live bank and staging per §24 | Route to dedup queue |
| No banned patterns | No AI-tell patterns from §21 | Discard, log for prompt regression |
| Policy compliance | No unsafe content, no malformed formulas, no broken assets | Discard |

## **Advisory Flags (logged, flag for review, not blocking)**

| Flag | Trigger |
| ----- | ----- |
| Explanation brevity | Explanation below recommended length for difficulty |
| Unusual option length distribution | Any option \>2x the median length of the four |
| Low model confidence | `generation_confidence` below threshold (directional: 0.7) |
| Difficulty suspicion | Hard items that look easy, easy items that look hard |
| Stem length outlier | Stem significantly longer or shorter than similar items |

## **Gate Infrastructure**

All gates run via a deterministic validator that takes a candidate, returns `{ status: "pass" | "reject" | "flag", reasons: [...], advisory_flags: [...] }`. The validator is pure (no side effects), fully tested, and runs in CI on golden fixtures.

## **Why This Matters**

Vague gates are worse than no gates because they produce false confidence. "Looks good" is not a pipeline. Every gate in the blocking list exists because items passing all other gates but failing this specific check produced downstream problems: schema violations fail the upsert, missing taxonomy breaks analytics, invented taxonomy corrupts the distractor library, duplicates flood the bank, AI-tells degrade student trust. The separation of blocking vs advisory lets QA be strict where strictness is justified (anti-leak, schema, taxonomy) and flexible where judgment is required (explanation quality, stylistic fit). Advisory flags route to human review rather than failing silently.

---

# **24\. Duplicate Detection Contract**

## **Comparison Targets**

Every candidate is compared against:

* Current live `public.questions` bank  
* Current staging batch candidates  
* Recent unpublished candidates (rolling window; directional: last 30 days)

## **Similarity Computation**

* Semantic embeddings via Supabase pgvector or equivalent embedding store  
* Consistent embedding model version recorded as `embedding_model_version` alongside each similarity score  
* Lexical similarity via Jaccard similarity on tokenized stems  
* Both checks run for every candidate

## **Directional Thresholds (tunable)**

* Semantic cosine similarity \> 0.95 vs an existing item: trivial rewrite, reject  
* 0.85 – 0.95: near-duplicate, route to dedup queue for human decision  
* \< 0.85: distinct enough to publish pending other gates

## **Additional Rule**

Items with same numeric skeleton AND same reasoning path AND \>70% lexical overlap are trivial rewrites regardless of embedding distance. This catches the `2x + 3 = 7` vs `2x + 3 = 9` pattern that embeddings often treat as distinct.

## **Tuning Path**

Thresholds are tuned against production complaint rate (students reporting duplicates) and bank growth rate (how fast the bank accumulates). Initial thresholds are directional; adjustments are change records.

## **Why This Matters**

Duplicate control is where the "allow materially different variants" decision becomes operational. Without thresholds, "materially different" is subjective and reviewers decide inconsistently. With thresholds, the rule is enforceable and student-perceived repetition stays low. The additional numeric-skeleton rule catches a specific failure mode: embeddings treat structural similarity as distinctness when the underlying math is identical, which produces questions students feel they've already solved.

---

# **25\. Failure Handling and Repair vs Discard**

When candidates fail QA or review:

## **Repair Path**

Used when the failure is small and deterministic:

* Formatting cleanup (whitespace, option ordering)  
* Metadata patch (missing skill code, wrong section label)  
* Taxonomy label correction (if the intent is clear but the label was mis-selected)

Repair returns the item to QA for a fresh pass.

## **Discard Path**

Used when the failure reflects quality problems:

* Ambiguous or unclear stem  
* Multiple defensible correct answers  
* Weak or misleading explanation  
* Repetitive reasoning path (adds no new teaching value)  
* Fake-feeling writing (AI-tells, unnatural phrasing)  
* Low educational value

Discarded items are logged with the failure reason. Patterns in discard reasons inform prompt regression — if a high share of candidates discard for the same reason, the prompt needs revision.

## **Batch Handling**

If a batch partially fails, the default is to discard the failed items and promote the passing items (INV-02A-04 idempotency). The entire batch is discarded only when the failure rate exceeds a threshold (directional: \>50% failing) or when a systemic problem is detected (all items failing for the same reason suggests a prompt or source problem).

## **Why This Matters**

Defaulting to repair is cheap and sometimes produces usable items, but defaulting to repair for every failure fills review queues with weak content that should have been discarded. The rule of thumb: deterministic, content-preserving failures repair; quality-based failures discard. Reviewers should reject weak items quickly rather than debating them. Time spent debating a weak item is time not spent reviewing a stronger one.

---

# **26\. Human Review Operations**

Human review is selective, not exhaustive. Risk-based dynamic sampling per your Q2 answer.

## **Always Review**

* New prompt versions (100% of first batch, 50% of next 3 batches)  
* Premium exam content destined for full-length exam forms (100%)  
* Suspicious batches (QA pass rate below 80%)  
* First runs of new pipelines or new source classes

## **Sampling Rate Factors**

| Factor | Contribution to sample rate |
| ----- | ----- |
| Baseline random sample | 10% |
| New prompt version (first batch) | 100% |
| New prompt version (batches 2-4) | 50% |
| Premium exam content | 100% |
| Suspicious batch (QA pass rate \< 80%) | 100% |
| Complaint-prone skill (\>3 historical complaints) | \+25% |
| Hard difficulty (3) | \+15% |
| Low model confidence (\<0.7) | \+50% |
| Flagged duplicate in dedup queue | \+50% |
| Cumulative maximum | 100% |

## **Initial Reviewers**

Founder and founding team. Per your Q3 answer at file-creation time, review pool is expandable later to trained reviewers (internal staff, then external contractors, then subject specialists).

## **Reviewer Questions**

* Is the answer unquestionably correct?  
* Would a serious student trust this item?  
* Does it feel SAT-grade or almost-SAT-grade?  
* Is the explanation useful?  
* Are the distractors pulling their weight (each represents a distinct, plausible misconception)?  
* Is this worth space in the bank?

If the answer to any of these is no, reject or revise.

## **Reviewer Tools**

Reviewers see both the student-visible content and the internal `option_metadata` (including taxonomy assignments) during review. Taxonomy visibility helps reviewers verify that distractor intent is clear and distinct. Reviewer UI is implemented in a later phase; pre-launch, review happens via direct DB queries or a simple admin tool.

## **Why This Matters**

Full human review is too expensive to scale. Zero human review misses qualitative problems that automated gates cannot detect. Risk-based sampling directs scarce human attention to the items most likely to fail — new prompt versions are historically where failures cluster, premium exam content is where failures are most damaging, and low-confidence items are the model's own signal that something is off. The combination factors exist because multiple risk signals compound: a hard item with low confidence in a complaint-prone skill is almost certainly worth reviewing.

---

# **27\. Publishing / Upsert Contract**

Approved content publishes through idempotent upsert keyed by canonical ID.

## **Upsert Pattern**

INSERT INTO public.questions (  
  id, section, source\_type, domain, skill\_codes, difficulty,  
  stem, passage, options, correct\_answer, explanation, option\_metadata,  
  assets, status, version, source\_lineage, generation\_attribution,  
  estimated\_time\_seconds, premium\_flag  
) VALUES (...)  
ON CONFLICT (id) DO UPDATE SET  
  \-- fields that can change on revision (per §31 retirement and revision rules)  
  stem \= EXCLUDED.stem,  
  options \= EXCLUDED.options,  
  explanation \= EXCLUDED.explanation,  
  option\_metadata \= EXCLUDED.option\_metadata,  
  version \= public.questions.version \+ 1,  
  published\_at \= now()  
WHERE public.questions.status \!= 'retired';

## **Idempotency Guarantees**

* Re-running an approved batch produces the same result as the first run  
* Upsert by canonical ID prevents duplicate insertion  
* Version increment on update preserves edit history (see §31 and `question_versions`)  
* Retired items are not re-published by upsert; revival requires explicit action

## **Batch Metadata**

Every publish batch records:

* `batch_id` (e.g., `SAT_BATCH_2026_04_20_A`)  
* `created_at`  
* `approver_id`  
* `item_count`  
* `source_families` (list of source classes represented in the batch)  
* `generator_version` / `prompt_version` range  
* `reviewer_summary` (sampling rate, pass rate)  
* `result` (success/partial/failed)  
* `promoted_at`  
* `rollback_pointer`

## **Atomicity**

Target-state: per §29, promotion runs as a single transaction per batch. All items in the approved batch promote or none do. Current-state: batches may promote item-by-item with aggregated error reporting; verify before refactor per §37.

## **Why This Matters**

Idempotency lets the team re-run promotion without fear of duplicate insertion, which is essential for pipelines that include manual steps and occasional partial failures. Upsert by canonical ID is what makes idempotency possible — insert-only semantics would require distinguishing "already inserted" from "new" at every batch, which is fragile. The version increment on update preserves edit history without requiring explicit version management in the upsert caller, which removes a class of bugs where revisions overwrite history silently.

---

# **28\. Current Integration Model (Verify Before Refactor)**

## **Likely Current State**

`Lyceonquestions` likely holds a single Supabase service-role credential with broad privileges against the product database. The credential is likely used to:

* SELECT from `public.questions` to load reference items and check duplicates  
* INSERT or UPDATE (upsert) into `public.questions` for approved items  
* Read metadata structures from related tables

The exact credential scope and RLS posture must be verified by inspection before any refactor.

## **Likely Upsert Pattern**

`INSERT ... ON CONFLICT (id) DO UPDATE` keyed by canonical ID, likely called item-by-item rather than as a single batch transaction. Error handling likely aggregates per-item failures rather than rolling back the batch.

## **Likely Duplicate Check**

`SELECT id FROM public.questions WHERE <similarity condition>` run before each upsert.

## **Known Current-State Risks**

* Single credential has write access to live `public.questions` (no staging isolation per INV-02-02)  
* Credential may have access to runtime tables (users, entitlements, sessions) beyond what content operations require  
* No staging boundary (live is the only write target)  
* No promotion audit log (upserts happen without batch records)  
* No atomic batch transaction (individual upserts succeed or fail independently)  
* Schema coupling: generator assumes live schema is stable without versioned contract  
* No rollback mechanism beyond manual DB intervention

## **Verification Required Before Refactor**

* Locate the credential in the `Lyceonquestions` repository environment or secrets management  
* Query `information_schema.role_table_grants` to determine actual grants by table  
* Inspect RLS policies on `public.questions` and related tables  
* Inspect current upsert SQL in generation repo code  
* Check whether RLS is enforced on `public.questions` or bypassed by service-role  
* Confirm current `public.questions.id` format in production rows (PDF-02 format per §14, UUIDs, or legacy strings)

## **Why This Matters**

A broad service-role credential is operationally acceptable pre-launch because the risk window is small and the pre-launch iteration speed benefit is real. Post-launch, that credential becomes a failure mode: a single compromised key has broad blast radius, a single bug can corrupt live content, and audit trails are absent when needed. The current-state description exists so that teams refactoring toward target state know what they're migrating from, not so that they treat the current state as a long-term target.

---

# **29\. Target Integration Model and Migration Path**

## **Target Architecture**

Generate  
  → Automated QA  
  → Human Review (risk-based)  
  → public.questions\_staging  
  → Approval Action (founder/team)  
  → Promotion Job (product-side, atomic)  
  → public.questions

## **Staging Table Schema**

`public.questions_staging` mirrors `public.questions` column-for-column plus staging-only fields:

* `staging_id`: uuid primary key (temporary, pre-canonical ID)  
* `batch_id`: text, identifies the candidate batch  
* `staging_status`: text ('pending', 'approved', 'rejected', 'promoted')  
* `submitted_at`: timestamptz  
* `review_notes`: jsonb | null  
* `risk_flags`: text\[\] | null  
* all `public.questions` columns except `id` (which is assigned at promotion)

## **Credentials at Target State**

* `Lyceonquestions` holds a **staging-writer** credential with INSERT/UPDATE on `public.questions_staging` only. No access to live tables, users, entitlements, or sessions.  
* Promotion job runs under a **promotion-admin** credential with SELECT on staging plus INSERT/UPDATE on `public.questions`. Callable only by admin-role users.  
* Analytics jobs use a **read-only** credential against aggregated views only.  
* Local development uses a separate credential against a development Supabase project, never production.

## **Promotion Job**

* Location: product repository, implemented as a Postgres function `promote_batch(batch_id uuid, approver_id uuid)` or equivalent admin API endpoint  
* Callable only by promotion-admin role  
* Triggered by founder/team approval action (admin UI button, CLI command, or equivalent)  
* Runs as a single transaction per batch: all items promote or none do  
* On success, generates canonical IDs per §14 for each item, inserts into `public.questions`, records a row in `public.promotion_log`  
* On failure, no items promote and the batch remains in staging with a failure reason recorded

## **Promotion Log**

promotion\_log (  
  id uuid primary key,  
  batch\_id text not null,  
  approver\_id uuid not null,  
  item\_count int not null,  
  promoted\_at timestamptz not null default now(),  
  rollback\_pointer jsonb,  
  success boolean not null,  
  failure\_reason text  
)

## **Rollback**

Rollback marks batch items as `active_status = retired` with a rollback reason code in `issue_flags`. Items are never deleted — retirement preserves historical session references per INV-02A-12. Rollback is reversible via re-approval and a new promotion batch.

## **Migration Path (Current → Target)**

1. Create `public.questions_staging` table mirroring live schema (product-repo migration owned by 02C)  
2. Introduce staging-writer credential scoped to staging table  
3. Update `Lyceonquestions` upsert logic to write to staging with `batch_id`, behind a feature flag  
4. Build `public.promotion_log` table and `promote_batch` function  
5. Build founder/team approval UI or CLI that calls the promotion job  
6. Route new content through staging flow behind feature flag  
7. Backfill any in-flight candidates from direct-to-live path  
8. Cut over — all new content routes through staging  
9. Retire direct-to-live write path from `Lyceonquestions`  
10. Revoke broad service-role credential from `Lyceonquestions`; issue staging-writer credential  
11. Document the completed migration as a change record

## **Why This Matters**

The target state addresses every known current-state risk: staging isolation means direct-to-live errors are impossible, scoped credentials mean compromise has small blast radius, atomic batch transactions mean partial failures don't corrupt live data, promotion audit log provides the audit trail, and rollback discipline means bad batches are recoverable. The migration path exists so teams can execute this transition intentionally without guessing the right order. Each step is independently testable.

---

# **30\. Monitoring After Publish**

Once content goes live, it continues to be measured. Live performance is feedback, not final proof.

## **Runtime Signals Tracked (computed by 02C)**

* Solve rate (per item, per difficulty, per skill)  
* Time-to-solve distribution  
* Distractor selection distribution (which distractors are being selected, which are not)  
* Skip rate (students skipping rather than answering)  
* Retry rate (students retrying after wrong attempts)  
* Tutor escalation frequency (tutor opened on this item)  
* Complaint count (student reports of bad items)  
* Explanation open rate  
* Explanation helpfulness (if feedback mechanism exists)

## **Exposure to `Lyceonquestions`**

Signals flow to `Lyceonquestions` via a scheduled export or a read-only view (`public.item_performance`) exposing aggregated item-level performance:

item\_performance view:  
  question\_id  
  attempts\_count  
  solve\_rate  
  avg\_time\_ms  
  skip\_rate  
  complaint\_count  
  tutor\_escalation\_rate  
  distractor\_selection\_distribution (jsonb keyed by A/B/C/D)

## **Why This Matters**

Without live signal, the generation pipeline is running blind. Items that look fine in review but perform poorly in production are the most valuable feedback the system can get, because they reveal failure modes that both automated QA and human review missed. The feedback loop is what makes the system a learning factory rather than a static pipeline.

---

# **31\. Retirement and Revision**

## **Retirement Mechanism**

Retirement updates `public.questions.active_status` from `published` to `retired`. Items are never deleted — retirement preserves historical session references per INV-02A-12.

Runtime engines (02B) exclude retired items from new selections. In-progress sessions continue to serve the item until session completion — mid-session item swaps are prohibited.

## **Retirement Reasons**

* Ambiguity (multiple defensible answers identified post-launch)  
* Poor outcomes (solve rate dramatically different from expected, persistent complaints)  
* Exposure fatigue (item has been seen by too many students, loses assessment value)  
* Duplicate identified post-launch  
* Outdated standards (exam change renders item obsolete)  
* Bad calibration (difficulty label wrong, surfaced through runtime data)  
* Weak explanation identified through complaint patterns

## **Retirement Triggers**

* Automated thresholds per §32 feedback integration contract (directional thresholds)  
* Human decision by founder/team based on review of complaints or performance data

## **Retirement Action**

Logged with `retired_at` timestamp, `reason_code`, and `triggered_by` (user or automated rule). `active_status = retired`.

## **Revision**

Revision (explanation fix, metadata correction, option text typo) uses the version log per §16 lineage: same canonical ID, version increment, diff stored in `question_versions`. Revised items go through QA again before republish.

Reclassification (domain or skill code change) is a metadata revision and uses the same path. Downstream mastery data may need recomputation — owned by 02C feedback integration.

## **Reversibility**

Retired items can be restored to `active_status = published` via the same approval path as new promotion. Items retired for ambiguity require QA re-review before restoration.

## **Why This Matters**

Hard-delete of retired items would break every historical session, mastery record, and analytics query referencing them. Soft-retire preserves history while removing the item from runtime. Revision via version log means typo fixes don't masquerade as new content, and rollback of a bad revision is trivial. These mechanics are invisible in the good case and essential in the bad case.

---

# **32\. Feedback Integration Contract**

## **Retirement Trigger Thresholds (directional, tunable)**

* Solve rate \<15% on Easy (difficulty=1) items → flag for human review  
* Solve rate \>90% on Hard (difficulty=3) items → flag for human review  
* Complaint count ≥3 → flag for human review  
* No distractor selected by \>5% of students after 100 attempts → distractor engineering review  
* Tutor escalation rate \>30% → explanation review

## **Prompt Regression Triggers**

Batch-level metrics that escalate for prompt review:

* QA rejection rate \>X% (directional: 30%) → prompt review required  
* Review rejection rate \>Y% (directional: 20%) → prompt review required  
* Early runtime complaint rate \>Z% (directional: 2% in first 30 days) → prompt review

## **Who Owns What**

* Runtime signals: computed by product repo / 02C analytics  
* Retirement decisions: founder/team reviews flagged items and marks retired  
* Prompt regression decisions: content ops team reviews and updates prompts

## **Why This Matters**

Without defined thresholds, "we'll review bad items when we notice them" is the retirement policy, which means bad items stay live indefinitely. Explicit thresholds make retirement a routine operation rather than a crisis response. The separation of item retirement (downstream) from prompt regression (upstream) is important because one bad item might just be bad, but a pattern of bad items points to a prompt that needs revision.

---

# **33\. Failure Modes Table**

| Stage | Failure | Handling |
| ----- | ----- | ----- |
| Source ingestion | Unsupported format | Reject, log, notify content ops |
| Source ingestion | Corrupted file | Retry once; escalate to manual on second failure |
| Extraction | OCR failure | Retry with alternate engine; manual queue if persistent |
| Extraction | Malformed PDF | Quarantine, flag for manual extraction |
| Canonicalization | Taxonomy mismatch | Route to manual domain/skill assignment |
| Canonicalization | Unparseable filename | Route to manual review queue with raw filename |
| Generation | Model timeout | Retry once; mark item gen-failed on second failure; continue batch |
| Generation | Output schema invalid | Reject item, log prompt regression signal |
| Generation | Invented taxonomy label | Reject item, log prompt regression signal |
| Generation | Copyright-adjacent output (too similar to anchor) | Discard, log prompt regression signal |
| QA validation | Blocking gate fails | Discard item per §23, log reason code |
| QA validation | Near-duplicate detected | Route to dedup queue per §24 |
| QA validation | Multiple advisory flags | Elevate review sampling per §26 |
| Review | Timeout \>72h without decision | Alert ops, age-escalate to founder |
| Upsert | DB constraint violation | Rollback single item, preserve batch, alert |
| Upsert | Connection failure | Retry with exponential backoff; abort batch on persistent failure |
| Upsert | Canonical ID collision | Regenerate random segment, retry once; alert on second collision |
| Promotion | Batch approval timeout (\>7d) | Batch remains staged, age threshold alert |
| Promotion | Atomic transaction failure | Rollback entire batch, preserve in staging, alert |
| Post-publish | Complaint spike | Flag for retirement review per §32 |
| Post-publish | Solve rate outlier | Flag for calibration review per §32 |

## **Why This Matters**

Pipeline failures are not rare events — they are continuous. Without an explicit handling policy per failure mode, each incident becomes a decision-from-scratch that consumes ops time and produces inconsistent outcomes. The table makes routine failures routine and reserves human judgment for the cases that actually require it.

---

# **34\. Pipeline Observability**

## **Structured Logging**

Every pipeline stage emits JSON logs at stage boundaries per Coding Standards §12 with required fields:

* `stage` (ingestion, extraction, canonicalization, generation, qa, review, staging, promotion)  
* `batch_id`  
* `item_count`  
* `duration_ms`  
* `success_count`  
* `failure_count`  
* `failure_reasons[]` (aggregated, not per-item for high-volume stages)

Logs are redacted per Coding Standards §12.1. Never logged: full generation prompts (may contain copyrighted source material), model API keys, any student-identifying data (though `Lyceonquestions` should not see any).

## **Required Metrics**

* Candidates generated per batch  
* QA pass rate per gate  
* QA reject rate with reason distribution  
* Duplicate rejection rate  
* Review pass rate  
* Publish count per batch  
* Rollback count  
* Live complaint rate by item and by batch  
* Solve rate anomaly count

## **Required Dashboards (directional, tooling TBD)**

* Pipeline health (stages operating, queues depths, batch throughput)  
* Content quality (QA pass rates over time, review outcomes, live complaint rate)  
* Generation attribution (pass rate by prompt version, by model version)

## **Required Alerts**

* QA rejection rate \>50% in a batch: investigate prompt regression immediately  
* Duplicate rejection rate \>30% in a batch: investigate reference diversity  
* No batches promoted in 72h: investigate approval workflow  
* Promotion job failures: immediate page to on-call  
* Embedding model version mismatch between pipeline and stored similarity scores: halt duplicate checks

## **Why This Matters**

Observability is what makes pipelines debuggable in production. Without it, a generation regression looks identical to a reference-library gap looks identical to a model-provider incident. Structured logging with consistent fields lets dashboards reason about the pipeline rather than requiring engineers to grep through unstructured logs. Alert thresholds exist because silent degradation is the worst failure mode — the pipeline keeps running but produces worse and worse content, which only gets caught downstream when student complaint rates shift.

---

# **35\. CI / Testing Standards**

The `Lyceonquestions` repository maintains its own CI pipeline per Coding Standards §14 and §16.

## **Required Checks**

* **Zod schema tests:** all input/output contracts have 100% type-guard coverage  
* **Closed-enum tests:** every current taxonomy label has positive fixtures; every invented-label case has negative fixtures that must fail QA  
* **Filename parser tests:** parser handles every existing filename in the current `Lyceonquestions` repo (snapshot test)  
* **Generation regression tests:** golden outputs for each active prompt version committed to `prompts/regression/`; CI fails on diff beyond tolerance  
* **QA gate tests:** each gate from §23 has positive and negative test cases  
* **Duplicate detection tests:** thresholds tested against known duplicate pairs and known distinct pairs  
* **Upsert integration smoke test:** one end-to-end item from generation to staging per CI run, run against a test Supabase project  
* **Taxonomy version migration tests:** when taxonomy evolves (v1 → v2), migration mapping must have positive and negative coverage

## **Coverage Thresholds**

* ≥90% on validation gate code (§23) — these are anti-leak enforcement; must be tested  
* ≥80% on generation contract validation (§15)  
* ≥80% on upsert and promotion logic  
* ≥80% overall

Broken quality gates block merge. PR CI must pass before merge regardless of reviewer approval.

## **Why This Matters**

Tests on validation gates matter more than tests on anything else because those gates are what prevent leaks and bad content from reaching live. A schema validation bug that passes tests becomes a schema validation bug in production that causes upsert failures. A taxonomy enforcement bug that passes tests becomes invented taxonomy labels corrupting the distractor library. Test coverage thresholds are higher on these paths because the cost of a failure is higher.

---

# **36\. Security and Credential Boundaries**

## **Target-State Credential Model**

* **Read-only analytics:** SELECT on aggregated views only, no raw tables  
* **Staging writer (Lyceonquestions):** INSERT/UPDATE on `public.questions_staging` only  
* **Promotion admin:** SELECT staging \+ INSERT/UPDATE on `public.questions`, assignable only to authorized users  
* **Local development:** separate Supabase project, never production credentials

## **Enforcement Mechanism**

* Database role grants with least-privilege principle  
* Row-Level Security (RLS) on sensitive tables where applicable  
* Separate Supabase project for development  
* Credential rotation on schedule (directional: every 90 days)  
* No credentials in repository code or commits  
* Audit logging on credential use (Supabase audit logs or equivalent)

## **Rules**

* Least privilege: every credential has the narrowest scope that supports its function  
* Rotate secrets on schedule and on suspected compromise  
* No secrets in code (use environment variables, secret management)  
* Audit credential usage monthly  
* Revoke unused credentials promptly

## **Current-State Risks**

Per §28, current-state likely has a single broad credential. Migration to target state per §29 resolves this.

## **Why This Matters**

Credential boundaries are the enforcement arm of every architectural decision in this document. Without them, staging isolation is theoretical, audit trails are bypassable, and rollback is optional. The target-state model is standard for any production system handling user data; the current-state broad credential is pre-launch expedient that must be retired before real user data is present.

---

# **37\. Verification Before Refactor Checklist**

Before any team refactors or re-implements any component governed by this document, the following verifications must be gathered and compared against the spec.

## **Schema Truth**

* Current `public.questions` schema via `\d+ public.questions` or equivalent DB introspection  
* Current indexes, constraints, RLS policies  
* Any legacy columns not documented here  
* Current `public.questions.id` format in production rows

## **Data Truth**

* Sample row distributions (difficulty values, section values, source\_type values)  
* Orphaned records, legacy ID formats, metadata gaps  
* Duplicate item count using the similarity rules in §24  
* Existing option\_metadata values, if any

## **Code Truth**

* Current `Lyceonquestions` repository structure and current import/ingestion scripts  
* Current generation prompt locations and versions (if any)  
* Current duplicate detection logic (if any)  
* Current review workflow (if any)  
* Current upsert SQL in generation code

## **Credential Truth**

* Actual Supabase credentials held by `Lyceonquestions`  
* Actual RLS policies on `public.questions`  
* Actual role grants for the generation credential  
* Credential rotation status

Only after gathering these should a team propose a specific refactor. The refactor proposal must state: current state (as verified), target state (per this spec), migration path, rollback path.

---

# **38\. Change Records**

## **CR-02A-01**

**Previous Rule:** Question systems blended into broader learning runtime specs. **Updated Rule:** Dedicated repo-owned content manufacturing spec governing the `Lyceonquestions` repository. **Why It Changed:** Cleaner ownership, faster iteration, isolated debugging domain. **Build Impact:** All content pipelines governed by this document; content repo separated from product repo.

## **CR-02A-02**

**Previous Rule:** PDF-02 §15 locked difficulty as integer 1–5. **Updated Rule:** Difficulty is integer 1-3 (Easy=1, Medium=2, Hard=3) per INV-02A-05. **Why It Changed:** Simpler operational mapping, easier human categorization, closer to real source-file convention (filenames use Easy/Medium/Hard). **Build Impact:** DB constraint on `public.questions.difficulty` must change from `between 1 and 5` to `between 1 and 3`. Any existing 4-5 values must be remapped before constraint change (verify via DB inspection per §37). 02B selection algorithms and 02C mastery difficulty multipliers must use the new range.

## **CR-02A-03**

**Previous Rule:** Distractor logic implicit with no enumerated labels. **Updated Rule:** Starter closed enum `distractor_taxonomy.v1` introduced per §18, with versioned evolution path. **Why It Changed:** Closed enum is required for deterministic QA enforcement and analytics joins. Starter-and-evolve approach accepts that production data may suggest label refinements while preventing silent prompt-level drift. **Build Impact:** Prompts include v1 enum inline. QA rejects invented labels. Taxonomy evolution requires versioned update with migration mapping per Preamble §8.

## **CR-02A-04**

**Previous Rule:** PDF-QR §5 locked a longer distractor taxonomy with specific labels. **Updated Rule:** v1 taxonomy consolidates and renames some PDF-QR labels for operational clarity.

**Label mapping from PDF-QR to v1:**

* `careless_arithmetic` → `arithmetic_slip`  
* `units_error` → `unit_error`  
* `partial_reasoning_trap` → `partial_reasoning`  
* `grammar_rule_confusion` → `grammar_rule_error`  
* `rhetorical_synthesis_error` → `rhetorical_purpose_error`  
* `vocab_in_context_error` → `vocab_context_error`  
* `procedural_error` → absorbed into `concept_gap` where appropriate  
* `order_of_operations` → absorbed into `equation_setup_error`  
* `main_idea_confusion` → absorbed into `detail_misread` or `inference_overreach` depending on context

**Why It Changed:** Starter v1 simplification. Evidence-backed evolution may reintroduce dropped labels or rename further; doing so requires new taxonomy version and migration mapping. **Build Impact:** All existing `option_metadata` records using old labels must be remapped before taxonomy enforcement. Pre-launch, no live records exist, so migration is a no-op currently. Verify via DB inspection before enforcement.

## **CR-02A-05**

**Previous Rule:** PDF-02 source type 1 defined as "PDF-derived (anonymized, transformed)." **Updated Rule:** Source type 1 defined as "Source-derived content." Format unchanged. **Why It Changed:** Wording modernization to accommodate non-PDF source types (DOCX, images, structured data, future licensed sources). **Build Impact:** None to format. Documentation clarified.

## **CR-02A-06**

**Previous Rule:** Publishing logic implied inserts or generic writes. **Updated Rule:** Approved content uses idempotent upsert keyed by canonical ID per §27. **Why It Changed:** Safe re-runs, metadata upgrades, explanation upgrades, dedup prevention, operational resilience. **Build Impact:** All publishing jobs must be idempotent. `ON CONFLICT (id) DO UPDATE` is the canonical pattern.

## **CR-02A-07**

**Previous Rule:** Reference retrieval method undefined. **Updated Rule:** Direct retrieval (Method A) as current practical mode; hybrid retrieval (Method C) as target state. Transition triggered by library size \>500 items, throughput requirements, or quality signals per §12. **Why It Changed:** Explicit decision prevents drift and makes the upgrade path auditable. **Build Impact:** Current-state direct retrieval implementable immediately. Target-state hybrid requires embedding infrastructure (Supabase pgvector or equivalent) and retrieval tuning.

## **CR-02A-08**

**Previous Rule:** Current-state and target-state not distinguished. **Updated Rule:** Every operational section uses the current-state / target-state / verify-before-refactor framing per §4. **Why It Changed:** Prevents spec from becoming fiction (target-only) or obsolete (current-only). Enables intentional migration. **Build Impact:** Before any refactor, verify current state per §37. Compare to target state. Migrate intentionally.

## **CR-02A-09**

**Previous Rule:** Canonical ID generation authority undefined. **Updated Rule:** Canonical IDs are generated product-side at promotion time per §14. `Lyceonquestions` never issues IDs that reach `public.questions`. **Why It Changed:** ID authority belongs with the system that owns the live bank. Prevents generation-repo compromise or bug from producing duplicate or malformed IDs. Enables collision checking against live data without granting broad live-table access to the generation repo. **Build Impact:** Generation pipeline produces candidates without `id`. Staging uses temporary `staging_id` (uuid). Promotion job assigns canonical ID at insertion.

---

# **39\. Worked Example: One Question, Source to Live**

## **Source File**

Existing `Lyceonquestions` repo file:

Easy \- Right triangles and trigonometry \- Geometry and Trigonometry \- Math-10.pdf

## **Stage 1 — Source Ingestion**

File dropped in `raw/sat/internal/math/`. Pipeline computes SHA-256 checksum `a3f2...c9d1`, uploads to GCS with ingestion timestamp `2026-04-20T14:32:11Z`, records provenance: `{filename, source_type: "internal", checksum, parser_version: "v1.3.0", storage_path: "gs://lyceon-sources/raw/sat/internal/math/Easy...pdf"}`.

## **Stage 2 — Extraction**

PDF text extracted. Question stem identified: *"In right triangle ABC, angle C is a right angle. If sin A \= 3/5, what is cos B?"* Four options parsed: A) 3/5, B) 4/5, C) 5/3, D) 5/4. Answer key captured: B. No diagram attached. Extraction records stored in `processed/extracted/` with source lineage linking back to the raw file.

## **Stage 3 — Canonicalization**

Filename parser extracts: `difficulty="Easy"`, `skill="Right triangles and trigonometry"`, `domain="Geometry and Trigonometry"`, `section="Math"`, `legacy_id="10"`. Maps to canonical form: `difficulty=1`, `skill_codes=["TRIG_RT_RATIO"]`, `domain="GEOM_TRIG"`, `section="M"`. Source lineage attached: `{source_file: "Easy - Right triangles...", batch_id: "SAT_BATCH_2026_04_20_A_intake", extraction_timestamp: "2026-04-20T14:32:45Z"}`.

## **Stage 4 — Reference Retrieval**

Pipeline retrieves 3 style anchors from the curated reference set matching (Math, Geometry and Trigonometry, difficulty 1): two from prior canonical items in `public.questions`, one from an internal authored reference. All three included inline in the generation prompt.

## **Stage 5 — Generation**

This source is itself a high-quality item. The pipeline generates one variant — a similar but distinct item testing the same skill at the same difficulty — using the source as an anchor. Prompt version `sat_math.v1.0.0`. Model version `claude-sonnet-4-6`. Prompt includes: output schema per §15, distractor\_taxonomy.v1 enum inline, explanation standard per §20 inline, SAT realism rules per §21 inline, anchor references, uniqueness constraint (avoid near-duplicates of 4 existing items in this skill).

Generated candidate output:

{  
  "stem": "In right triangle XYZ, angle Z is a right angle. If cos X \= 5/13, what is sin Y?",  
  "passage": null,  
  "options": \[  
    {"key": "A", "text": "5/13"},  
    {"key": "B", "text": "12/13"},  
    {"key": "C", "text": "13/5"},  
    {"key": "D", "text": "13/12"}  
  \],  
  "correct\_answer": "A",  
  "explanation": "A is correct. In a right triangle, the two non-right angles are complementary, so sin Y \= cos X \= 5/13. This is the cofunction identity for complementary angles. B (12/13) results from computing sin X instead of sin Y. C (13/5) and D (13/12) result from taking reciprocals, confusing sine with cosecant.",  
  "metadata": {  
    "exam\_family": "SAT",  
    "section": "M",  
    "domain": "GEOM\_TRIG",  
    "skill\_codes": \["TRIG\_RT\_RATIO"\],  
    "difficulty": 1,  
    "estimated\_time\_seconds": 45  
  },  
  "option\_metadata": {  
    "A": {"role": "correct", "error\_taxonomy": null},  
    "B": {"role": "distractor", "error\_taxonomy": "concept\_gap"},  
    "C": {"role": "distractor", "error\_taxonomy": "misread\_question"},  
    "D": {"role": "distractor", "error\_taxonomy": "misread\_question"}  
  },  
  "generation\_attribution": {  
    "prompt\_version": "sat\_math.v1.0.0",  
    "model\_version": "claude-sonnet-4-6",  
    "generated\_at": "2026-04-20T14:33:12Z"  
  }  
}

## **Stage 6 — Automated QA**

All blocking gates pass:

* Schema valid  
* Exactly one correct answer  
* Four unique options  
* Difficulty in {1, 2, 3}  
* Answer key integrity (correct\_answer "A" matches option\_metadata role "correct" on A)  
* Metadata complete  
* Taxonomy labels valid (all in v1 enum)  
* Explanation ≥20 chars  
* No exact duplicate in live bank or staging  
* Near-duplicate check: max similarity 0.73 vs existing items (below 0.85 threshold)  
* No banned AI-tell patterns detected

Two advisory flags raised:

* Low confidence (model reported 0.74, below 0.7 threshold borderline)  
* Short estimated\_time\_seconds for skill (45s is typical for this skill; no action)

Item proceeds to review queue.

## **Stage 7 — Review Sampling**

Baseline 10% random sample. This item draws 0.23 (above 0.10) — not sampled by baseline. Risk factors: hard difficulty \+15% (no, difficulty is 1), low confidence \+50% (yes, 0.74). Effective sample rate 60%. Draws 0.23, below 60% — item IS sampled for human review.

## **Stage 8 — Human Review**

Founder reviews. Asks the 6 reviewer questions:

* Unquestionably correct? Yes — cofunction identity confirmed.  
* Would a serious student trust this? Yes — reads SAT-native.  
* SAT-grade feel? Yes.  
* Explanation useful? Yes — names the concept (cofunction identity) and walks distractor traps.  
* Distractors pulling weight? Yes — B is a common concept error (computing sin X instead of sin Y); C and D test reciprocal confusion.  
* Worth bank space? Yes — fills a gap in easy-difficulty right-triangle items.

Approved.

## **Stage 9 — Batch Assembly**

Item included in batch `SAT_BATCH_2026_04_20_A` with 49 other approved items. Batch metadata records approver, item count, source family distribution, generator attribution, reviewer summary (10% baseline sample, 8 items sampled total with 1 rejection unrelated to this item, 7 passes).

## **Stage 10 — Promotion**

Founder triggers batch promotion via admin action. Promotion job runs in product repo under promotion-admin credentials. Transaction begins. For each item in batch:

* Canonical ID generated: `SATM2K7Q4P1` (random segment `K7Q4P1`, source type 2 for AI-generated, section M)  
* Collision check against `public.questions.id`: no collision  
* Row inserted into `public.questions` with `status = 'published'`, `version = 1`, `published_at = now()`  
* All metadata and option\_metadata preserved per §15 schema

Transaction commits. Promotion log row recorded:

batch\_id: SAT\_BATCH\_2026\_04\_20\_A  
approver\_id: \<founder uuid\>  
item\_count: 50  
promoted\_at: 2026-04-20T15:47:22Z  
rollback\_pointer: {"batch\_id": "SAT\_BATCH\_2026\_04\_20\_A", "ids": \[...\]}  
success: true

## **Stage 11 — Live**

Item serves in practice sessions. After 50 attempts: solve rate 61% (expected for easy; within normal range), avg time 42 seconds (matches estimated 45s), distractor B selected by 18% (concept\_gap distractor pulling weight), distractors C and D selected by 11% and 8% respectively (both within normal distribution). No complaints. Item stays live. Runtime signals feed back to 02C analytics; no action triggered.

## **Stage 12 — Feedback**

After 200 attempts, solve rate settles at 64%. No retirement triggers fired. Item becomes part of the mature bank, used as potential reference anchor for future generation of similar items.

## **Why This Matters**

One concrete traversal makes every abstract rule in the document implementable. An engineer reading this section knows what each stage produces, what the handoffs look like, what QA catches, what review verifies, what promotion records, and what live feedback looks like. The rest of the document describes the rules; this section shows the rules in operation.

---

# **40\. Final Principles**

Lyceon should not generate random questions.

Lyceon should operate a controlled manufacturing system for trusted educational inventory, where quality, metadata, telemetry, and trust compound over time.

Every rule in this document exists to protect one of four properties:

* **Quality:** because student trust depends on content feeling native  
* **Metadata integrity:** because every downstream system (runtime, mastery, analytics, tutor) is only as good as the metadata it consumes  
* **Auditability:** because undiagnosable problems in production are indistinguishable from unfixable ones  
* **Compounding:** because the moat is not the current bank, it is the system that improves the bank

The assessment layer is the moat. Protect it with clear ownership, zero answer leakage, deterministic publishing, trusted runtime behavior, and disciplined content operations.

