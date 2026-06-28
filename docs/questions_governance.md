# Questions Governance Document

**Version:** 1.0  
**Status:** Living document — question content is authored and audited against this.  
**Scope:** Per-column content rules, canonical tagging, question types, rendering, quality bar.  
**Out of scope:** Practice engine, serve/retrieval paths, anti-leak serializer, registry engineering.  
**Grounded from:** Genesis DDL (`00000000000000_genesis.sql`), Doc 02A V6, Doc 02B V4, Doc 02 Preamble V3, CB style guides (`docs/SAT Qeustions S.D/`), deployed mastery functions, `packages/shared/src/validate.ts`, `packages/shared/src/types.ts`.

---

## A.1 Per-Column Governance

| Column | DB type / NOT NULL / default / CHECK | Spec-canonical rule (Doc §) | Content-authoring rule | SAT-research rationale |
|--------|--------------------------------------|----------------------------|------------------------|----------------------|
| `id` | `TEXT PK CHECK (~ '^SAT(M\|RW)[12][A-Z0-9]{6}$')` | Doc 02A §14, Doc 02B: canonical ID grammar (§A.2 below) | Generated at authoring time via `buildCanonicalId()`. Never hand-typed, never content-derived. | Opaque IDs prevent answer-key correlation across sources. |
| `section` | `TEXT NOT NULL CHECK (IN ('M','RW'))` | Doc 02A §14: locked section codes. `M`=Math, `RW`=Reading & Writing. | Must match the question's domain (Math domains → `M`, RW domains → `RW`). Cross-section mismatch is a hard reject (`DOMAIN_SECTION_MISMATCH`). | Digital SAT has exactly 2 sections. |
| `source_type` | `INTEGER NOT NULL CHECK (IN (1,2))` | Doc 02A §14: `1`=Source-derived, `2`=AI-generated. | All Lyceon-authored questions use `source_type=2`. Only official CB-derived content (via ingestion pipeline) uses `1`. | Provenance tracking for audit trail and content lineage. |
| `domain` | `TEXT NOT NULL` (no CHECK — governance-enforced) | Doc 02A §14, Doc 05 Parent §10.2, deployed `refresh_domain_mastery`: 8 locked strings (§A.4). | Must be one of the 8 canonical strings EXACTLY. Wrong spelling → `DOMAIN_SECTION_MISMATCH` at mastery ingestion. | CB's official 4+4 domain taxonomy for Digital SAT. |
| `skill_codes` | `TEXT[] NOT NULL` (no CHECK) | Doc 02A §13: open skill taxonomy. | 1-element array containing one canonical skill string from the frozen set (§A.4). Multi-skill tagging deferred. | CB publishes ~29 skills across 8 domains. |
| `difficulty` | `INTEGER NOT NULL CHECK (BETWEEN 1 AND 3)` | Doc 02A §17 INV-02A-05: locked to 1/2/3 (Easy/Medium/Hard). | Calibrated per §A.7. `1`=Easy (single-step, direct application), `2`=Medium (multi-step, requires synthesis), `3`=Hard (complex reasoning, multiple concepts, non-obvious path). | CB categorizes difficulty in 3 tiers for adaptive routing. |
| `stem` | `TEXT NOT NULL` | Doc 02A: question text. | The question prompt. Math stems use LaTeX for notation (§A.5). RW stems include the question but NOT the passage (passage is separate). Must be self-contained with the passage context. | Digital SAT stems are concise — typically 1–3 sentences for Math, a question sentence for RW. |
| `passage` | `TEXT NULL` | Doc 02B: passage text for reading comprehension. | Required for all RW questions (passage-based). NULL for most Math questions. Math questions MAY have a passage for word problems with extended context or data tables. LaTeX for any math in passages. | All Digital SAT RW questions are passage-based (25–150 words, 1 question per passage). |
| `item_type` | `TEXT NOT NULL DEFAULT 'mcq' CHECK (IN ('mcq','grid_in'))` | SCL-018 (rewritten): grid-in in scope for launch. Migration `20260628010000_grid_in_schema_extension.sql`. | `mcq` for multiple-choice, `grid_in` for student-produced response. See §A.3. | Digital SAT Math is ~75% MCQ, ~25% grid-in. |
| `options` | `JSONB NOT NULL` | Doc 02A §19, Doc 02B: student-visible options. | MCQ: exactly 4 objects `[{key:"A",text:"..."}, {key:"B",text:"..."}, {key:"C",text:"..."}, {key:"D",text:"..."}]`. Grid-in: empty array `[]`. Shape enforced by `questions_item_shape_chk` CHECK. See §A.3. | Digital SAT MCQ always has exactly 4 choices labeled A–D. |
| `correct_answer` | `TEXT NOT NULL` | Doc 02 Preamble §12 INV-02-08: INTERNAL, never served pre-submit. | MCQ: one of `"A"`, `"B"`, `"C"`, `"D"` — must match one option key. Grid-in: the canonical numeric/fraction value (e.g., `"2/3"`, `"17"`). See §A.3. | Single unambiguous correct answer per question. |
| `correct_variants` | `TEXT[] NULL` | SCL-018 (rewritten). Migration `20260628010000_grid_in_schema_extension.sql`. | Grid-in: exhaustive set of CB-accepted surface forms (e.g., `{"2/3", ".666", "0.666", ".667", "0.667"}`). MCQ: NULL. Shape enforced by `questions_item_shape_chk` CHECK. See §A.3. | Grid-in answers accept multiple equivalent forms. |
| `explanation` | `TEXT NOT NULL` | Doc 02 Preamble §12: post-submit only. Doc 02A §20: explanation standard. | Must justify WHY the correct answer is correct. Should address why each distractor is wrong when pedagogically useful. LaTeX for math. 2–8 sentences by difficulty. See §A.6. | Explanations are the primary learning feedback mechanism. |
| `option_metadata` | `JSONB NULL` | Doc 02A §19, Doc 02 Preamble §12 INV-02-09: INTERNAL, never to clients. | Per-option role and distractor taxonomy from `distractor_taxonomy_v1`. Keyed object: `{"A": {role, error_taxonomy}, ...}`. The correct-answer option has `role: "correct"` and `error_taxonomy: null`. See §A.6. | Distractor labeling enables analytics on common error patterns. |
| `assets` | `JSONB NULL` | Doc 02A: figures, diagrams, data displays. | Shape: `[{type:"image",url:"...",alt:"...",caption:"..."}]` or `[{type:"latex_figure",content:"..."}]`. Used for geometry diagrams, data tables, graphs. See §A.5. | Digital SAT Math frequently includes figures and data displays. |
| `status` | `TEXT NOT NULL DEFAULT 'draft' CHECK (IN ('draft','qa','published','retired'))` | Doc 02A: lifecycle states. | All new questions start at `draft`. Codex audit moves to `qa`. Human approval moves to `published`. See §A.9. | Staged promotion prevents unvetted content reaching students. |
| `version` | `INTEGER NOT NULL DEFAULT 1` | Genesis DDL. | Increment on any content edit after initial authoring. | Audit trail for content changes. |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Genesis DDL. | Auto-set. Do not manually override. | — |
| `published_at` | `TIMESTAMPTZ NULL` | Genesis DDL. | Set when status transitions to `published`. | — |
| `retired_at` | `TIMESTAMPTZ NULL` | Genesis DDL. | Set when status transitions to `retired`. | — |
| `source_lineage` | `JSONB NULL` | Doc 02A §14: provenance tracking. | For `source_type=2` (AI-generated): `{provenance: "Lyceon original", authored_by: "claude", authored_date: "YYYY-MM-DD"}`. For `source_type=1`: CB provenance chain. | Audit trail for content origin. |
| `generation_attribution` | `JSONB NULL` | Doc 02A: AI generation metadata. | For AI-authored questions: `{model: "<model>", generation_date: "YYYY-MM-DD", prompt_version: "questions_governance_v1"}`. NULL for human-authored. | Tracks which AI system and prompt produced the content. |
| `estimated_time_seconds` | `INTEGER NULL` | Genesis DDL. | Easy: 30–60s. Medium: 60–90s. Hard: 90–120s. Math grid-in: +15s. RW passage-based: +30s for passage reading. | Aligned with Digital SAT pacing (~1.6 min/question Math, ~1.2 min/question RW). |
| `premium_flag` | `BOOLEAN DEFAULT FALSE` | Genesis DDL. | `false` for launch. Premium gating deferred. | — |
| `quality_score` | `NUMERIC NULL` | Genesis DDL. | Set by Codex audit (§A.8). Scale: 0.0–1.0. Threshold for `qa` promotion: ≥ 0.8. | Quantified quality gate. |
| `issue_flags` | `TEXT[] NULL` | Genesis DDL. | Set by Codex audit. Array of finding codes (e.g., `["AMBIGUOUS_STEM", "WEAK_DISTRACTOR_C"]`). Empty array = clean. | Structured audit findings for remediation. |

---

## A.2 Canonical ID Grammar

**Regex (DB CHECK):** `^SAT(M|RW)[12][A-Z0-9]{6}$`

| Segment | Position | Meaning | Source |
|---------|----------|---------|--------|
| `SAT` | 1–3 | Exam family prefix (locked to SAT for launch; architecture is exam-neutral per INV-02-10) | Doc 02A §14 |
| `M` or `RW` | 4–5 | Section code. `M`=Math, `RW`=Reading & Writing. | Doc 02A §14, genesis `sections` table |
| `1` or `2` | 5 or 6 | Source type. `1`=Source-derived (official CB), `2`=AI-generated. | Doc 02A §14, genesis `source_types` table |
| 6 chars `[A-Z0-9]` | last 6 | Random unique suffix. Generated via `generateCanonicalIdSuffix()` using cryptographic randomness (`crypto.randomBytes`). | `question-bank-contract.ts:696-718` |

**Examples:**
- `SATM2A7KX3P` — Math, AI-generated, suffix `A7KX3P`
- `SATRW1B2M9QZ` — Reading & Writing, source-derived, suffix `B2M9QZ`
- `SATRW2F4NV8L` — Reading & Writing, AI-generated, suffix `F4NV8L`

**Minting rules:**
- IDs are minted by `buildCanonicalId(sectionCode, sourceType)` (`question-bank-contract.ts:720-731`)
- Collision-checked: if generated ID already exists, retry (probability ~1-in-2-billion per attempt)
- IDs are **never reused**, even if a question is retired
- IDs are **never content-derived** — the suffix is random, not a hash of the stem or answer
- Source CB IDs (for ingested content) go to `source_lineage.cb_question_id`, never to `id`

**For Lyceon-authored questions:** All use `source_type=2`, so IDs match `^SAT(M|RW)2[A-Z0-9]{6}$`.

---

## A.3 Question Types

### MCQ (Multiple-Choice Question)

The primary question type for both Math and RW sections.

**`options` shape (validated by `optionSchema` in `packages/shared/src/validate.ts:9-12`):**
```json
[
  {"key": "A", "text": "The answer text for option A"},
  {"key": "B", "text": "The answer text for option B"},
  {"key": "C", "text": "The answer text for option C"},
  {"key": "D", "text": "The answer text for option D"}
]
```

**Rules:**
- Exactly 4 options, keys `A`/`B`/`C`/`D` (validated by `hasCanonicalOptionSet()`, `question-bank-contract.ts:168-176`)
- Each option has a non-empty `text` field
- Option text may contain LaTeX for math notation (§A.5)
- Options should be ordered logically: numeric ascending, alphabetical, shortest-to-longest, or by conceptual progression
- Exactly ONE option is correct (validated by `hasSingleCanonicalCorrectAnswer()`, `question-bank-contract.ts:178-187`)

**`correct_answer` format:** One of `"A"`, `"B"`, `"C"`, `"D"` — must match exactly one option key.

**Answer-matching rule:** Exact string match on the option key.

**Per-skill option conventions (from CB style guide analysis):**

| Skill | Option pattern |
|-------|---------------|
| Words in Context | Single words or short phrases (synonyms/near-synonyms) |
| Text Structure and Purpose | Full phrases describing purpose (e.g., "to illustrate...", "to refute...") |
| Cross-Text Connections | Full phrases describing textual relationships |
| Rhetorical Synthesis | Full sentences (the student selects which sentence achieves the rhetorical goal) |
| Boundaries | Punctuation/conjunction variants of the same clause join (e.g., "A, B" vs "A; B" vs "A. B") |
| Form, Structure, and Sense | Verb/pronoun/modifier form variants (e.g., "has been" vs "have been" vs "had been") |
| Transitions | Transition words/phrases (e.g., "However," vs "Therefore," vs "In addition,") |
| Central Ideas and Details / Inferences / Command of Evidence | Full statements about the passage content |
| Math (all skills) | MCQ: numeric values, expressions, or equations; ordered ascending when numeric. Grid-in: N/A (no options). |

### Grid-In (Student-Produced Response)

Grid-in questions are Math-only. The student types a numeric answer instead of choosing from options. **In scope for launch** (SCL-018, rewritten — supersedes prior MCQ-only deferral).

**Digital SAT grid-in frequency:** ~11 of 44 Math questions (~25%), distributed across all 4 Math domains. Grid-in frequency increases with difficulty.

**Schema:** `item_type = 'grid_in'` + `correct_variants TEXT[]` added via migration `20260628010000_grid_in_schema_extension.sql` (awaiting Karl apply). Shape enforced by `questions_item_shape_chk` CHECK constraint.

**Column values for grid-in:**
- `item_type`: `"grid_in"`
- `options`: `[]` (empty array — no choices; enforced by CHECK)
- `correct_answer`: the canonical numeric value as a string (e.g., `"2/3"`, `"0.5"`, `"17"`)
- `correct_variants`: `TEXT[]` — the exhaustive set of CB-accepted surface forms (enforced non-NULL with ≥1 element by CHECK)
- `option_metadata`: NULL (no options to label)

**Grid-in accepted forms** (from `parseCorrectVariants`, `question-bank-contract.ts:237-274` and INGESTION-LOGIC §3):
- Integers: `"17"`, `"-3"`
- Decimals: `".5"`, `"0.5"`, `"0.50"`
- Fractions: `"2/3"`, `"1/16"` (improper fractions only — no mixed numbers)
- 4th-digit truncated AND rounded decimals: `2/3 → {"2/3", ".666", "0.666", ".667", "0.667"}`
- Maximum 5 characters (6 with negative sign) per the Digital SAT input field budget
- No mixed numbers, no percentages, no separators

**Answer-matching rule:** `gridInResponseMatches(response, value)` — value-equality after normalization. Accepts any stored variant form.

---

## A.4 Canonical Tagging (Locked)

### Domains (8 strings — deployed in `refresh_domain_mastery`, `20260625030000_05e_actor_id_write_path.sql:232-238`)

**Math (`section = 'M'`):**

| # | Canonical domain string | Abbrev |
|---|------------------------|--------|
| 1 | `Algebra` | ALG |
| 2 | `Advanced Math` | ADV |
| 3 | `Problem Solving and Data Analysis` | PSDA |
| 4 | `Geometry and Trigonometry` | GEO |

**Reading & Writing (`section = 'RW'`):**

| # | Canonical domain string | Abbrev |
|---|------------------------|--------|
| 5 | `Information and Ideas` | INF |
| 6 | `Craft and Structure` | CAS |
| 7 | `Expression of Ideas` | EXP |
| 8 | `Standard English Conventions` | SEC |

**Enforcement:** The deployed `refresh_domain_mastery` function raises `DOMAIN_SECTION_MISMATCH` for any string not in this exact set. There is no DB CHECK constraint on `questions.domain` — enforcement is governance-level (this document) and mastery-function-level.

**Critical note on string variants:**
- CB source PDFs use `"Problem-Solving and Data Analysis"` (hyphenated) — the deployed canonical string is `"Problem Solving and Data Analysis"` (NO hyphens)
- `practice-topics-routes.ts:13` uses `"Problem Solving & Data Analysis"` (ampersand) — this is WRONG and will be fixed (gap-closure G-01)
- The strings in this table are AUTHORITATIVE. Use them exactly.

### Skills (29 canonical skills — frozen from CB taxonomy)

**Algebra (5 skills):**
1. `Linear Equations in One Variable`
2. `Linear Equations in Two Variables`
3. `Linear Functions`
4. `Linear Inequalities in One or Two Variables`
5. `Systems of Two Linear Equations in Two Variables`

**Advanced Math (3 skills):**
6. `Equivalent Expressions`
7. `Nonlinear Equations in One Variable and Systems of Equations in Two Variables`
8. `Nonlinear Functions`

**Problem Solving and Data Analysis (7 skills):**
9. `Ratios, Rates, Proportional Relationships, and Units`
10. `Percentages`
11. `One-Variable Data: Distributions and Measures of Center and Spread`
12. `Two-Variable Data: Models and Scatterplots`
13. `Probability and Conditional Probability`
14. `Inference from Sample Statistics and Margin of Error`
15. `Evaluating Statistical Claims: Observational Studies and Experiments`

**Geometry and Trigonometry (4 skills):**
16. `Lines, Angles, and Triangles`
17. `Right Triangles and Trigonometry`
18. `Circles`
19. `Area and Volume`

**Information and Ideas (3 skills):**
20. `Central Ideas and Details`
21. `Command of Evidence`
22. `Inferences`

**Craft and Structure (3 skills):**
23. `Words in Context`
24. `Text Structure and Purpose`
25. `Cross-Text Connections`

**Expression of Ideas (2 skills):**
26. `Transitions`
27. `Rhetorical Synthesis`

**Standard English Conventions (2 skills):**
28. `Boundaries`
29. `Form, Structure, and Sense`

**Title Case convention:** Capitalize first/last word and all major words; lowercase `a, an, the, and, or, nor, in, of, to, for, on` unless first/last; capitalize both parts across a hyphen (`Cross-Text`). These 29 strings are the sole source of truth — no deployed SQL function hardcodes skill strings, so this doc is load-bearing for skill consistency.

**`skill_codes` format:** A 1-element TEXT array containing the canonical skill string:
```sql
skill_codes = ARRAY['Linear Equations in One Variable']
```

**`student_skill_mastery.skill` must use these exact Title Case strings** for mastery attribution to work.

**Note on CB taxonomy vs. Lyceon frozen set:** CB's Assessment Framework lists ~30 distinct skills (splitting "Command of Evidence" into Textual and Quantitative sub-skills). The 29 strings above are our canonical frozen set, derived from the CB style guide filenames with typos corrected (`variabe` → `variable`, `Pecentages` → `Percentages`) and normalized to Title Case (SCL-020).

### Digital SAT question distribution (reference for content planning)

| Domain | Section | Approx. questions | % of section |
|--------|---------|-------------------|--------------|
| Information and Ideas | RW | 12–14 | ~26% |
| Craft and Structure | RW | 13–15 | ~28% |
| Expression of Ideas | RW | 8–12 | ~20% |
| Standard English Conventions | RW | 11–15 | ~26% |
| **RW Total** | | **54** | |
| Algebra | Math | 13–15 | ~35% |
| Advanced Math | Math | 13–15 | ~35% |
| Problem Solving and Data Analysis | Math | 5–7 | ~15% |
| Geometry and Trigonometry | Math | 5–7 | ~15% |
| **Math Total** | | **44** | |
| **Grand Total** | | **98** | |

---

## A.5 Math & Asset Rendering Conventions

### Math notation

All math in stems, options, explanations, and passages uses **LaTeX** delimited by `$...$` (inline) and `$$...$$` (display/block). This matches the Digital SAT's Bluebook app, which uses MathJax to render LaTeX-authored content.

**Conventions:**
- Variables: `$x$`, `$y$`, `$f(x)$`
- Fractions: `$\frac{2}{3}$` (display), `$2/3$` (inline where space is tight)
- Exponents: `$x^2$`, `$x^{n+1}$`
- Roots: `$\sqrt{x}$`, `$\sqrt[3]{x}$`
- Equations (display): `$$2x + 3 = 7$$`
- Systems of equations: use `\begin{cases}...\end{cases}` or `\begin{aligned}...\end{aligned}`
- Inequalities: `$x \geq 5$`, `$x < 3$`
- Absolute value: `$|x - 3|$`
- Greek letters: `$\theta$`, `$\pi$`
- Trigonometric functions: `$\sin(\theta)$`, `$\cos(x)$`, `$\tan^{-1}(x)$`
- Degree symbol: `$30°$` or `$30^\circ$`
- Percent: `$25\%$`

**Anti-patterns (do not use):**
- Unicode math symbols in place of LaTeX (e.g., `>=` instead of `$\geq$`)
- Plain-text fractions in stems (e.g., `2/3` instead of `$\frac{2}{3}$`)
- Images of equations when LaTeX rendering is possible
- AsciiMath or MathML notation — use LaTeX exclusively

### Assets (`assets` JSONB)

For questions with figures, diagrams, graphs, or data tables:

```json
[
  {
    "type": "image",
    "url": "assets/questions/SATM2A7KX3P_fig1.svg",
    "alt": "A circle with center O and radius 5, with chord AB of length 8",
    "caption": "Figure 1"
  }
]
```

Or for LaTeX-rendered figures (preferred when possible):

```json
[
  {
    "type": "latex_figure",
    "content": "\\begin{tikzpicture}...\\end{tikzpicture}",
    "alt": "Right triangle with legs 3 and 4",
    "caption": "Figure 1"
  }
]
```

**Rules:**
- Every image/figure must have a descriptive `alt` text (accessibility)
- Figures referenced in the stem as "the figure above" or "Figure 1"
- Data tables may be rendered as LaTeX tabular or as structured JSON within the stem
- Geometry diagrams should include labeled points, angles, and measurements as described in the stem

---

## A.6 Distractor & Explanation Conventions

### Distractor design

Every wrong option must represent a plausible, categorizable error — never a random or absurd answer. Each distractor maps to a label from `distractor_taxonomy_v1` (genesis DDL, `00000000000000_genesis.sql:533-549`).

**Math distractor labels:**

| Label | Meaning | Example error |
|-------|---------|---------------|
| `sign_error` | Wrong sign in calculation | Solving $-2x = 6$ and getting $x = 3$ instead of $x = -3$ |
| `arithmetic_slip` | Careless arithmetic | $7 \times 8 = 54$ instead of $56$ |
| `equation_setup_error` | Wrong equation or operations order | Setting up $d = rt$ as $r = dt$ |
| `unit_error` | Wrong units in answer | Giving area in cm when asked for cm² |
| `graph_read_error` | Misread graph or data | Reading the wrong axis or data point |
| `concept_gap` | Fundamental misunderstanding | Confusing radius with diameter |
| `partial_reasoning` | Incomplete reasoning, returning intermediate result | Solving only step 1 of a 2-step problem |
| `misread_question` | Misunderstood the stem | Finding $x$ when asked for $2x + 1$ |

**RW distractor labels:**

| Label | Meaning | Example error |
|-------|---------|---------------|
| `detail_misread` | Misread a specific detail | Attributing a claim to the wrong speaker |
| `inference_overreach` | Inference beyond text | Concluding causation from correlation |
| `evidence_mismatch` | Evidence doesn't support claim | Selecting a quote about a different topic |
| `grammar_rule_error` | Misapplied grammar rule | Using "who" instead of "whom" incorrectly |
| `sentence_boundary_error` | Punctuation/boundary error | Comma splice or run-on sentence |
| `rhetorical_purpose_error` | Wrong rhetorical purpose | Confusing "to refute" with "to illustrate" |
| `vocab_context_error` | Word in wrong context | Choosing a definition that fits the word but not the passage context |
| `partial_reasoning` | Incomplete reasoning | Answer that's partially right but misses a key qualifier |

### `option_metadata` shape

The canonical shape is a keyed object (not an array), validated by `optionMetadataSchema` in `packages/shared/src/validate.ts:19-24` and typed as `OptionMetadata` in `packages/shared/src/types.ts:17-22`:

```json
{
  "A": {"role": "correct",    "error_taxonomy": null},
  "B": {"role": "distractor", "error_taxonomy": "sign_error"},
  "C": {"role": "distractor", "error_taxonomy": "partial_reasoning"},
  "D": {"role": "distractor", "error_taxonomy": "arithmetic_slip"}
}
```

**Rules:**
- Exactly one key has `role: "correct"` — this MUST match `correct_answer`
- All other keys have `role: "distractor"`
- The `role: "correct"` entry always has `error_taxonomy: null`
- Every `role: "distractor"` entry must have an `error_taxonomy` value from the taxonomy tables above (section-appropriate: Math labels for `section='M'`, RW labels for `section='RW'`)
- `option_metadata` is INTERNAL — never served to clients (INV-02-09)

### Explanation requirements (Doc 02A §20)

Every question must have an explanation that:

1. **States the correct answer** clearly at the start ("The correct answer is B.")
2. **Walks through the solution** step-by-step (Math) or provides the textual evidence and reasoning (RW)
3. **Uses LaTeX** for all math notation (matching the stem/options conventions)
4. **Addresses key distractors** when pedagogically useful — explain why a common wrong answer is wrong
5. **Is appropriately sized** — 2–4 sentences for Easy, 3–6 sentences for Medium, 4–8 sentences for Hard

**Tone:** CB-instructional — clear, direct, educational. Second person ("you") is acceptable but not required.

**Prohibited patterns:**
- Condescending language ("This is a simple problem", "Obviously...")
- Vague hand-waving ("You can see that...", "It's clear that...")
- Restating the stem without adding explanatory value
- Referencing question numbers, test forms, or Lyceon internals
- Emotional language ("Great question!", "Don't worry about...")
- Revealing meta-information about question design or distractor intent

**Example (Math, Easy):**
```
The correct answer is B. To solve $2x + 5 = 13$, subtract 5 from both sides to get $2x = 8$, then divide by 2 to get $x = 4$. Option A ($-4$) results from a sign error when dividing. Option C ($9$) comes from subtracting 5 from 13 but not dividing by 2.
```

**Example (RW, Medium):**
```
The correct answer is C. The passage states that the researcher "found no significant correlation between the variables" (lines 3–4), which directly supports the claim that the hypothesis was not confirmed. Option A refers to the methodology, not the findings. Option D overstates the conclusion — the passage says "not confirmed," not "disproven."
```

---

## A.7 Difficulty Calibration

| Level | Value | Label | Math characteristics | RW characteristics |
|-------|-------|-------|---------------------|-------------------|
| 1 | `1` | Easy | Single-step computation or direct formula application. Clear, short stems. Manageable numbers. One concept. | Straightforward vocabulary or grammar. Passage meaning is explicit. Answer is directly stated or easily inferred. Short passages. |
| 2 | `2` | Medium | Multi-step problem requiring 2–3 operations. May combine two concepts. Requires equation setup or data interpretation. Some algebraic manipulation. | Requires synthesis across parts of the passage. Vocabulary is more nuanced. Grammar rules are less common. Evidence evaluation requires comparison. |
| 3 | `3` | Hard | Complex reasoning with multiple concepts. Non-obvious solution path. May require system of equations, advanced algebraic manipulation, or multi-step geometric reasoning. Abstract or unusual problem framing. | Passage has complex structure or subtle argument. Requires distinguishing closely related claims. Cross-text comparison with nuanced differences. Grammar involves nested or compound structures. |

**Calibration signals from CB style guides:**
- Easy questions: short stems, single operation, direct application of one formula or rule
- Medium questions: 2–3 step solutions, moderate algebraic manipulation, passage synthesis
- Hard questions: 4+ step solutions, non-obvious approach selection, combining multiple concepts, abstract framing
- Grid-in frequency increases with difficulty (from CB style guide analysis: ~0% Easy equivalent expressions → ~55% Hard right triangles)

**Difficulty distribution target:** Roughly balanced across 1/2/3 per skill, with slight emphasis on Medium (difficulty 2) for maximum learning value.

---

## A.8 Quality Bar + Codex Audit Checklist

### Spine: Independent Answer-Key Re-Derivation

The primary audit is answer-key verification. For every question, Codex:

1. **Solves the question cold** — without seeing `correct_answer` or `explanation`
2. **Verifies exactly one option is correct** (MCQ) or the stated value is the unique correct answer (grid-in)
3. **Confirms the derived answer matches `correct_answer`**

If the independent derivation produces a DIFFERENT answer, or if MORE THAN ONE option could be correct, or if NO option is correct — the question **FAILS** regardless of all other criteria.

### Full checklist

| # | Check | Pass criteria | Fail code |
|---|-------|---------------|-----------|
| 1 | **Answer-key re-derivation** | Independent solution matches `correct_answer`; exactly one correct option | `WRONG_ANSWER_KEY` |
| 2 | **Stem clarity** | Unambiguous, self-contained question. No missing information. | `AMBIGUOUS_STEM` |
| 3 | **Option validity** | Exactly 4 options (MCQ), all plausible, no duplicates, no "all of the above" / "none of the above" | `INVALID_OPTIONS` |
| 4 | **Distractor quality** | Each wrong option represents a real, categorizable error (not random/absurd); `error_taxonomy` label is appropriate | `WEAK_DISTRACTOR_{key}` |
| 5 | **Explanation quality** | Explains solution, addresses key distractors, correct length for difficulty, no prohibited patterns | `WEAK_EXPLANATION` |
| 6 | **Math rendering** | All math uses LaTeX, renders correctly, no plain-text math | `MATH_RENDER_ERROR` |
| 7 | **Canonical tagging** | `domain` is one of 8 locked strings; `skill_codes` is from the frozen set; `section` matches domain; `difficulty` is 1/2/3 | `TAG_MISMATCH` |
| 8 | **ID format** | `id` matches `^SAT(M\|RW)[12][A-Z0-9]{6}$` | `ID_FORMAT_ERROR` |
| 9 | **SAT fidelity** | Question style, difficulty, and format match Digital SAT conventions for the tagged skill | `SAT_FIDELITY_LOW` |
| 10 | **No copying** | Content is original, not copied from CB or any other source | `COPYRIGHT_VIOLATION` |
| 11 | **Passage quality** (RW) | Passage is well-crafted, appropriate length (25–150 words), genre-appropriate, 1 question per passage | `PASSAGE_QUALITY` |
| 12 | **Figure accuracy** (if assets) | Figures match the stem, labels are correct, alt text is descriptive | `FIGURE_ERROR` |
| 13 | **option_metadata consistency** | `role: "correct"` key matches `correct_answer`; all distractor labels are from the section-appropriate taxonomy; no missing entries | `OPTION_META_MISMATCH` |

### Scoring

`quality_score` = (checks passed) / (checks applicable). Questions with `WRONG_ANSWER_KEY` or `COPYRIGHT_VIOLATION` get `quality_score = 0.0` regardless.

Promotion threshold: `quality_score >= 0.8` AND no critical failures (checks 1, 10).

---

## A.9 Lifecycle

```
authored → draft → [Codex audit] → qa → [human approval] → published → [if defective] → retired
```

| Status | Meaning | Who transitions |
|--------|---------|-----------------|
| `draft` | Newly authored, not yet audited | Auto on creation |
| `qa` | Passed Codex audit (`quality_score >= 0.8`, no critical failures) | Codex audit process |
| `published` | Human-approved, available to students via practice/exam engines | Karl / human reviewer |
| `retired` | Withdrawn from active use (defect found post-publish, or replaced) | Karl / human reviewer |

**Rules:**
- `draft` → `qa`: only via Codex audit pass
- `qa` → `published`: only via human approval (Karl)
- `published` → `retired`: set `retired_at` timestamp
- No reverse transitions (`published` → `draft` is never valid — retire and re-author)
- `published_at` is set when transitioning to `published`
- `retired_at` is set when transitioning to `retired`
- `version` increments on any content edit; retired questions are not edited (author a new one)

---

## Appendix: RW Passage Conventions

All Reading & Writing questions are passage-based. Each passage supports exactly one question (unlike pre-2024 SAT which used multi-question passages).

**Passage characteristics:**
- Length: 25–150 words (short, focused)
- One passage per question — never shared across questions
- Stored in the `passage` column (separate from `stem`)
- Genres: literary fiction, poetry, social science, natural science, humanities
- No real-world attribution required for Lyceon-original passages, but genre and register should match CB conventions
- Passages should be self-contained — no external knowledge required to answer the question

**Per-domain passage patterns:**
- **Information and Ideas:** Passages present findings, claims, or descriptions. Questions ask about central ideas, supporting evidence, or logical inferences.
- **Craft and Structure:** Passages may be literary or argumentative. Questions ask about word meaning in context, author purpose, or cross-text comparison (paired passages for Cross-Text Connections).
- **Expression of Ideas:** Passages are presented as bulleted notes (Rhetorical Synthesis) or paragraphs with transition gaps (Transitions). No traditional continuous prose for Rhetorical Synthesis.
- **Standard English Conventions:** Passages contain a blank or underlined section where the grammar/punctuation choice is tested. The question asks which option correctly completes the sentence.

**Rhetorical Synthesis special format:** The "passage" for Rhetorical Synthesis is a set of bulleted notes about a topic, followed by a task instruction (e.g., "While writing about X, a student wants to emphasize Y. Which choice most effectively uses relevant information from the notes to accomplish this goal?"). Options are complete sentences.
