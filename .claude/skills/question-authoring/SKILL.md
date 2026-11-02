---
name: question-authoring
description: Contract for authoring Lyceon SAT questions as constrained content JSON. Use when authoring one or more SAT questions for the question bank. Defines the record schema, canonical literals, MCQ/grid-in rules, the single-defensible-answer rule, and output discipline. Workers emit content only — never IDs, correct_variants, or SQL.
---

# Question Authoring Contract

You author SAT questions as **content JSON** (NDJSON — one JSON object per line) to an assigned part-file. A deterministic pipeline mints IDs, derives grid-in accepted forms, and renders SQL. **You never write an ID, a `correct_variants` array, or SQL.** Your surface is content only.

## 1. Read the canon first — never from memory

Before authoring, read these files. Copy every section/domain/skill/difficulty/taxonomy literal from them exactly. Typing any canonical string from memory is the single most common defect and is forbidden.

- `content/canonical/taxonomy.json` — legal sections, domains, skills (mapped to domains), difficulty defs, distractor taxonomy, option keys.
- `docs/questions_governance.md` §A — authoring rules, math/LaTeX conventions (§A.5), and the **§A.4 classification convention** for choosing a skill when a question could fit two.

## 2. Record schema (emit exactly this)

One object per line. No trailing commas, no comments, no prose around it.

```json
{
  "section": "M | RW",
  "domain": "<exact string from taxonomy.json, whose .section == section>",
  "skill": "<exact string from taxonomy.json, whose .domain == domain>",
  "difficulty": 1 | 2 | 3,
  "item_type": "mcq | grid_in",
  "stem": "<question text; LaTeX per governance §A.5>",
  "passage": "<RW only; null for M>",
  "options": [ {"key":"A","text":"..."}, {"key":"B","text":"..."}, {"key":"C","text":"..."}, {"key":"D","text":"..."} ],
  "correct_option": "A | B | C | D",
  "option_metadata": { "A": {"role":"...","error_taxonomy":"..."}, "B": {...}, "C": {...}, "D": {...} },
  "correct_answer": "<grid_in only: the value, e.g. \"5\", \"13\", \"1/2\", \"0.5\">",
  "explanation": "<why the answer is correct AND why each distractor is wrong>",
  "estimated_time_seconds": 60
}
```

- **MCQ:** include `options` (exactly 4), `correct_option`, `option_metadata`. Omit `correct_answer`.
- **Grid-in:** include `correct_answer` (the value). Omit `options`, `correct_option`, `option_metadata`. Do **not** write `correct_variants` — the pipeline derives it via `gridInAcceptedForms`.

## 3. MCQ rules

- Exactly 4 options, keys `A`–`D` distinct, non-empty text.
- Exactly one correct option. `option_metadata[correct_option].role = "correct"` with `error_taxonomy: null`.
- The other three: `role: "distractor"`, each with an `error_taxonomy` label drawn from **this section's** `distractor_taxonomy` set in taxonomy.json, and the explanation names the specific error each represents.

### RW option-length constraint (hard rule)

For every Reading & Writing MCQ, the correct answer MUST NOT be the strictly longest option. At least one distractor must be as long as or longer than the key; ideally the key sits mid-pack in length. A correct option that is strictly longest is the single most exploitable SAT tell — option shuffling does not hide a length signal. Fix direction: lengthen distractors to match or exceed the key, never trim the key. The assembly gate fails the batch above 35% (`RW_LONGEST_ANSWER_TELL`), but every individual RW MCQ must satisfy this constraint — do not rely on batch-level averaging.

## 4. Grid-in rules

- No options. `correct_answer` is the value a student would enter.
- Runtime grades by value-equivalence; you do not enumerate accepted spellings. Never hand-author variants.

## 5. Single-defensible-answer rule (non-negotiable)

Every single-answer item must have **exactly one** defensible answer. Before emitting a record, verify each distractor is **checkably wrong** — not merely weaker or "less precise." A distractor that is also correct, or arguably correct, is a defect.

This is sharpest for **Standard English Conventions / Boundaries**: only one choice may conform to Standard English. If two punctuation choices both correctly join the clauses, the item is broken — rewrite until exactly one conforms.

**Words in Context / vocabulary items:** a distractor is only valid if it produces an incoherent or meaning-wrong sentence in context. A distractor that produces a coherent sentence but is "less precise" than the key is a defect — the item then has two defensible answers. Diagnostic tell: if the explanation defends the key as "more precise" or says a distractor "captures [a real reading] but…", the item is defective. Replace the distractor with one that fails on meaning, not merely on precision.

**Near-synonym ban (WiC):** never use a dictionary synonym, near-synonym, or hypernym/hyponym of the key whose denotation overlaps with the passage's specific sense. Test each candidate distractor: look up its primary denotation; if that denotation fits the passage's use of the target word, the distractor is presumptively defensible — replace it with a word from the same semantic field whose denotation is wrong for the context.

## 6. Skill classification

Assign the one skill whose definition best fits. When a question could fit two skills, apply the §A.4 convention (the boundary sets: Linear Equations in Two Variables ↔ Linear Functions; Nonlinear Equations ↔ Nonlinear Functions; Central Ideas and Details ↔ Command of Evidence ↔ Inferences; Boundaries ↔ Form, Structure, and Sense; Transitions ↔ Rhetorical Synthesis). Read §A.4 for the deterministic tests — do not guess the boundary.

## 7. Difficulty

Calibrate to taxonomy.json: 1 = single-step/direct; 2 = two-to-three steps or one non-obvious concept; 3 = multi-step/layered/subtle-trap.

## 8. No function composition (hard rule — off-spec)

The Digital SAT does not test function composition. An OCR audit of 377 official Linear/Nonlinear Functions questions found zero self-compositions and only one weak two-step numeric composite. Never author:

- **Self-composition:** `f(f(x))`, `h(h(x))`, `g(g(x))` in any form (nested notation, two-step wording, or table).
- **Nested-notation composition solved for a variable:** `f(g(a)) = k` solve for `a`, `g(f(t)) = k` solve for `t`.
- **Two-function composite in general:** any `f(g(…))` or `g(f(…))` pattern.

**Translations are NOT composition and remain allowed:** `g(x) = f(x+5)`, `g = f + k`, `h = f - 13`, etc. These are graph shifts / vertical translations, not function composition.

The assembly gate hard-fails any stem matching `/[fgh]\s*\(\s*[fgh]\s*\(/` as `COMPOSITION_OFFSPEC`.

## 8a. No sum/difference-of-cubes factoring (hard rule — off-spec)

The Digital SAT does not test factoring a sum or difference of cubes. An OCR audit of all 1,618 official College Board questions found zero items that factor or divide out `a^3 ± b^3`. Never author:

- **Cube factoring:** "which is equivalent to `8x^3 + 27`", `x^3 - 8`, `125p^3 - 64q^3`, `27x^6 - 8`.
- **Cube division that cancels by the identity:** `\frac{8x^3 - 27}{2x - 3}`, `\frac{x^3 - 8}{x^2 + 2x + 4}`.
- **The identity by another route:** "given `a + b` and `a^2 + b^2`, find `a^3 + b^3`".

**Still allowed:** cubic terms in ordinary arithmetic and functions, for example combining like terms (`12x^3 - 5x^3`, `(8x^3 + 8) - (x^3 - 2)`), evaluating `f(x) = x^3 + 9`, or a cubic with more than two terms.

The assembly gate hard-fails a Math record as `CUBES_OFFSPEC` when it finds any of three things (`scripts/cubes-offspec.ts`):
- a standalone `a^3 ± b^3` binomial in the stem, with perfect-cube coefficient and constant;
- the identity named ("sum/difference of cubes") in the stem or explanation;
- the identity's `a^2 ∓ ab + b^2` factor in the stem, an option or the explanation.

## 9. Stem integrity (hard rule)

The stem must contain the actual question prompt — it must never be empty and must never be a copy of the passage. For R&W, the stem asks the question ("Which choice completes the text…"); the passage provides the context. If `trim(stem) === trim(passage)`, the gate hard-fails (`STEM_EQUALS_PASSAGE`). An empty or whitespace-only stem also hard-fails (`EMPTY_STEM`).

## 10. Passages

RW items are self-contained: answerable from the passage alone, no outside knowledge. Math items have no passage (`passage: null`).

## 11. No letter or positional references (hard rule — shuffle-invariant)

Explanations and stems must reference answer options BY CONTENT ONLY — name the actual text, claim, or value. Never reference by letter (A/B/C/D) or by position (first/second/third/fourth/last option/choice/response). Options are Fisher-Yates shuffled at serve; letter and positional references point at the wrong choice once shuffled. The assembly gate hard-fails any record matching these patterns in stem or explanation. Refer to the correct answer and every distractor by content — use a pronoun or short descriptor to avoid redundancy.

## 12. Output discipline

- Write **only** NDJSON records to your assigned part-file path — one object per line.
- No prose, no markdown, no SQL, no scratchpad, no reasoning in the file. Nothing but records.
- Author exactly the assignment: the given `(skill × difficulty × count)` leaves, no more, no fewer.

## 13. Before you finish (DoD)

- Every record parses as JSON and matches the schema.
- Every `section`/`domain`/`skill`/`difficulty`/`error_taxonomy` literal was copied from taxonomy.json.
- Every MCQ has exactly one defensible answer; every distractor is checkably wrong.
- Every explanation references options by content, never by letter (A/B/C/D).
- Record count == assigned count. File contains records only.
