# Codex Audit Context — Text-Layer Defect Detection

**Version:** 1.0
**Added:** 2026-09-27
**Purpose:** Supplement to `docs/questions_governance.md` — defines text-layer defect classes that the assembly gate checks mechanically and Codex audits for content correctness.

These defects live in the text *around* the math, not in the math itself, so KaTeX-render checks pass them. Every rule below has three enforcement layers: authoring instructions (governance doc), assembly gate (mechanical), and Codex audit (semantic).

---

## Text-Layer Render Defects (1–4) — Gate HARD-FAIL

Gate checks stem, every option, passage, and explanation for all four.

### 1. LITERAL_NEWLINE — Literal `\n` line breaks

**Defect:** A literal backslash-n (`\n`) appears in a content field after JSON parse. Renders as an actual newline in the middle of text, breaking formatting.

**Rule:** Never emit a literal `\n`. Multi-line math uses `\begin{cases}` or `\begin{aligned}` inside math delimiters. Text lists and multi-part prose use real sentence structure.

**Gate detector (post-parse):** `/\\n(?![A-Za-z])/` — flags real newlines, ignores LaTeX commands (`\neq`, `\nu`, `\nabla`, etc.).

**SQL equivalent:** `field ~ E'\\n([^a-zA-Z]|$)'`

**Codex check:** Flag any question where the rendered output shows an unexpected line break mid-sentence or mid-expression that is not inside a `cases`/`aligned` environment.

### 2. UNBALANCED_DOLLAR — Odd `$` parity

**Defect:** An odd number of unescaped `$` characters in a field. The renderer opens a math context that never closes (or vice versa), corrupting everything after the stray `$`.

**Rule:** Every `$` opens and closes a math delimiter. Currency values use `\$` (escaped dollar).

**Gate detector:** Strip `\$`, then count remaining `$`. Odd count = FAIL.

**JS:** `(s.replace(/\\\$/g,'').match(/\$/g)||[]).length % 2 === 0`

**Codex check:** Verify that every math span opens and closes correctly. Flag any question where inline text appears in math font or where math appears in prose font.

### 3. PROSE_IN_MATH — Multi-word prose inside `$…$`

**Defect:** RW prose (especially monetary amounts like `$412,000`) wrapped in math delimiters, rendering it in math font with broken spacing.

**Rule:** RW prose money uses `\$` (never bare `$`). Never wrap multi-word prose in `$…$`.

**Gate detector:** Strip `\$`; for each matched `$…$` span, if inner content matches three or more consecutive words (`/[A-Za-z]{3,}\s+[A-Za-z]{3,}\s+[A-Za-z]{3,}/`) and contains no LaTeX command (`\` + letter) → FAIL.

**Codex check:** Read each question and verify no prose paragraph or monetary expression is accidentally rendered as math. If you see multi-word English in math italic, flag it.

### 4. DOUBLED_BACKSLASH_BEFORE_CMD — `\\` before command/delimiter

**Defect:** A doubled backslash before a LaTeX command or delimiter character (after JSON parse), producing a literal `\` before the command text instead of rendering the command.

**Rule:** Single backslash for LaTeX commands. `\\` is only valid as a row break in `cases`/`aligned` environments (followed by whitespace or newline).

**Gate detector (post-parse):** `/\\\\[A-Za-z${%({\[]/` = FAIL. (`\\` followed by whitespace is allowed.)

**Codex check:** Flag any question where a backslash character appears literally before what should be a rendered LaTeX command (e.g., the student sees `\frac{2}{3}` as text instead of a rendered fraction).

---

## Answer-Key Correctness (5–6) — Gate HARD-FAIL, Grid-In Only

### 5. CORRECT_ANSWER_NOT_IN_VARIANTS

**Defect:** The `correct_answer` value is not present in the `correct_variants` array.

**Rule:** `correct_answer` MUST appear in `correct_variants`. Gate checks post-assembly after `gridInAcceptedForms()` generates variants.

**Gate detector:** `correct_variants.includes(correct_answer)` must be true.

**Codex check:** For every grid-in, verify that the stated `correct_answer` string appears verbatim in the `correct_variants` array.

### 6. Variant Completeness (warning, not hard-fail)

**Defect:** A grid-in correct_answer has an incomplete set of SAT-equivalent forms (e.g., decimal with no fraction variant).

**Rule:** Emit all SAT-equivalent forms: exact fraction AND its decimal; for values < 1 include both `.5` and `0.5` forms; for rounded irrationals include the standard SAT truncation/rounding set.

**Gate detector:** Warns (does not hard-fail) if a decimal key has no fraction or alternate variant.

**Codex check:** For each grid-in, independently compute the expected variant set and compare to `correct_variants`. Flag if the stored set is missing an obvious SAT-equivalent form (e.g., `1/2` without `0.5` and `.5`).

---

## Content Authenticity (7–8) — Gate FLAG, Codex Adjudicates

### 7. PHANTOM_FIGURE — Figure reference without asset

**Defect:** Stem references a visual element ("the graph shows", "in the figure", "the scatterplot") but `assets` is NULL — the student is asked to read from a figure that doesn't exist.

**Rule:** Never reference a visual that is not attached. Make the item self-contained: give the equation, data, slope, or configuration in text. Saying "the graph of $f(x) = …$" is acceptable when the graph IS the equation and no value must be read from it.

**Gate detector:** Flag (not hard-fail) any stem matching `/graph|figure|chart|scatterplot|histogram|diagram|table/i` when `assets` is NULL.

**Codex adjudication:** For each flagged item:
- If the question is answerable from the text alone (the "figure" reference is descriptive, like "the graph of $f(x) = x^2$"), mark as **self-contained — pass**.
- If the student must read a value, coordinate, trend, or shape from a visual that doesn't exist, mark as **REJECT** — the item needs an asset or must be reworded.

### 8. RW_LONGEST_ANSWER_TELL — Batch-level statistical tell

**Defect:** More than 35% of RW MCQs in a batch have the correct option strictly the longest. This is a test-taking tell — students learn that the longest answer is usually correct.

**Rule:** Distractors must be comparable in length to the correct answer. Do NOT systematically write the correct RW option longest. Fix direction: lengthen distractors, not trim the key.

**Gate detector:** Fail the batch if > 35% of RW MCQs have the correct option strictly longest (random baseline 25%).

**Codex check:** Report the batch's longest-answer rate. If above 25%, flag specific questions where the correct option is conspicuously longer and recommend distractor lengthening.

---

## Blueprint Weighting (9) — Coverage Target

### 9. SAT Domain Weight Targets

**Prior state:** Even-per-skill target produced an SAT-inverted Math domain mix (PSDA over-built, Advanced Math + Algebra under-built).

**New target:** SAT domain weights:

| Domain | Section | Target % |
|--------|---------|----------|
| Algebra | M | ~35% |
| Advanced Math | M | ~35% |
| Problem Solving and Data Analysis | M | ~15% |
| Geometry and Trigonometry | M | ~15% |

RW domains are already on-target.

**Gate output:** The assembly gate reports the batch's domain mix (counts and percentages per domain) in the PASS report JSON under `domain_mix`.

**Codex check:** Review the domain mix in the gate report. Flag if Math domains are significantly off-target (e.g., PSDA > 20% or Algebra < 30%).

---

## Shuffle-Invariant Reference (11) — Gate HARD-FAIL

### 11. OPTION_LETTER_REF / OPTION_POSITION_REF — Letter or positional option references

**Defect:** Stem or explanation references an answer option by letter (A/B/C/D) or by position (first/second/third/fourth/last option/choice/response). Options are Fisher-Yates shuffled at serve; these references point at the wrong choice once shuffled.

**Rule:** Reference every option BY CONTENT ONLY — name the actual text, claim, or value. Never write "Option A", "Choice B", "(C)", "the second option", "the first choice", "the last response", etc.

**Gate detectors (HARD-FAIL):**

- Letter: `/(Option|Choice)\s+\(?[A-D][\s.),]/` — case-sensitive on A-D to avoid firing on the article "a". Does NOT flag bare capital letters (geometry vertex labels are legitimate).
- Position: `/\b(?:the\s+)?(?:first|second|third|fourth|last)\s+(?:option|choice|response)\b/i`

Both are checked on `stem` and `explanation`.

**Codex check:** For every question, read the stem and explanation. Flag any reference to an option by letter or by ordinal position. A capital letter inside LaTeX (`$\sin A$`, `$\cos(B)$`, `triangle $ABC$`) or as a geometry vertex/point label is math, not an option reference — do not flag those. The test is whether the letter or positional phrase is being used to identify one of the four answer choices.

---

## Stem Integrity (12–13) — Gate HARD-FAIL

### 12. EMPTY_STEM — Missing or whitespace-only stem

**Defect:** The `stem` field is empty, null, or contains only whitespace. The student sees no question prompt.

**Rule:** Every question must have a non-empty stem that contains the question prompt.

**Gate detector:** `!rec.stem || rec.stem.trim().length === 0` → FAIL.

**Codex check:** Flag any question whose stem is blank or contains no recognizable question prompt.

### 13. STEM_EQUALS_PASSAGE — Stem is a verbatim copy of the passage

**Defect:** `trim(stem) === trim(passage)`. The stem was overwritten by a copy of the passage — the student sees the passage twice and no question prompt. Found in 17 published Transitions questions. A DB CHECK constraint (`questions_stem_ne_passage`) now blocks publishing these; the gate rejects them at authoring so batches don't fail at publish time.

**Rule:** The stem must contain the actual question prompt, not a copy of the passage. For R&W questions, the stem asks the question ("Which choice completes the text…"); the passage provides the context. They must be distinct.

**Gate detector:** `typeof stem === 'string' && typeof passage === 'string' && stem.trim() === passage.trim()` → FAIL.

**Codex check:** For every R&W question, verify the stem contains an actual question prompt (e.g., "Which choice completes the text…" or "Which choice best states the main idea…") and is not a duplicate of the passage. For any question where stem and passage appear identical or near-identical, flag as **REJECT**.

---

## Lower-Priority Guidance (10) — Authoring Convention

### 10. Math Delimiter Standardization

**Convention:** Use `$…$` for inline math and `$$…$$` for display math exclusively. Do not use `\(…\)` or `\[…\]` notation. This applies to all content fields: stem, options, passage, and explanation.

**Explanation completeness:** Every explanation should state why each distractor is wrong, not just why the correct answer is correct. Address common errors by referencing the distractor's content (never by letter).

**Codex check:** Flag any question using `\(…\)` or `\[…\]` delimiters instead of `$…$` / `$$…$$`.
