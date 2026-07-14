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

## 4. Grid-in rules

- No options. `correct_answer` is the value a student would enter.
- Runtime grades by value-equivalence; you do not enumerate accepted spellings. Never hand-author variants.

## 5. Single-defensible-answer rule (non-negotiable)

Every single-answer item must have **exactly one** defensible answer. Before emitting a record, verify each distractor is **checkably wrong** — not merely weaker or "less precise." A distractor that is also correct, or arguably correct, is a defect.

This is sharpest for **Standard English Conventions / Boundaries**: only one choice may conform to Standard English. If two punctuation choices both correctly join the clauses, the item is broken — rewrite until exactly one conforms.

## 6. Skill classification

Assign the one skill whose definition best fits. When a question could fit two skills, apply the §A.4 convention (the boundary sets: Linear Equations in Two Variables ↔ Linear Functions; Nonlinear Equations ↔ Nonlinear Functions; Central Ideas and Details ↔ Command of Evidence ↔ Inferences; Boundaries ↔ Form, Structure, and Sense; Transitions ↔ Rhetorical Synthesis). Read §A.4 for the deterministic tests — do not guess the boundary.

## 7. Difficulty

Calibrate to taxonomy.json: 1 = single-step/direct; 2 = two-to-three steps or one non-obvious concept; 3 = multi-step/layered/subtle-trap.

## 8. Passages

RW items are self-contained: answerable from the passage alone, no outside knowledge. Math items have no passage (`passage: null`).

## 9. Output discipline

- Write **only** NDJSON records to your assigned part-file path — one object per line.
- No prose, no markdown, no SQL, no scratchpad, no reasoning in the file. Nothing but records.
- Author exactly the assignment: the given `(skill × difficulty × count)` leaves, no more, no fewer.

## 10. Before you finish (DoD)

- Every record parses as JSON and matches the schema.
- Every `section`/`domain`/`skill`/`difficulty`/`error_taxonomy` literal was copied from taxonomy.json.
- Every MCQ has exactly one defensible answer; every distractor is checkably wrong.
- Record count == assigned count. File contains records only.
