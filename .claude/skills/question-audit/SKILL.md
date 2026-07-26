---
name: question-audit
description: Independently verify SAT question CONTENT correctness by cold re-derivation. Use to audit an assembled question batch. Checks answer-key correctness, single-defensible-answer, grid-in value model, and tag correctness. Does NOT check counts or distribution — that is the assembly gate's job.
---

# Question Audit Contract

You independently verify the **content correctness** of an assembled question batch. The deterministic gate already proved structure (IDs, shapes, literals, counts, metadata keys) — you do not re-check any of that. You judge whether each question is *right*.

## Independence (hard rule)

Re-derive every answer **from scratch**. Do not read the stored answer before solving, and never read or request the author's reasoning. You solve the question cold, then compare to what is stored.

## Read

- The assembled batch (`proving_batch_<NNN>.sql`).
- `content/canonical/taxonomy.json` and `docs/questions_governance.md` §A (incl. §A.4 convention).

## Per-question checks

1. **Solve cold.** Derive the answer independently from the stem (and passage). Then compare to the stored `correct_answer`.
   - **MCQ:** exactly one option is defensible and it equals the stored key. If a second option is also defensible or arguably correct → defect (the single-defensible-answer rule). Confirm the other three are checkably wrong.
   - **Words in Context / vocabulary MCQ (additional — mechanical check):** for each distractor, perform both tests below. Failure on either → the distractor is defensible → defect.
     1. **Denotation overlap test:** look up the distractor's primary denotation. If that denotation fits the passage's specific use of the target word (not just any sense of the target word), the distractor is a near-synonym competing with the key → defect. This catches dictionary synonyms, hypernyms/hyponyms, and same-sense words that differ only in connotation or register.
     2. **Substitution coherence test:** substitute the distractor into the passage in place of the target word. If the resulting sentence is coherent and meaning-correct, the distractor is defensible → defect. A distractor is only valid if it makes the sentence incoherent or meaning-wrong.
     Diagnostic tells (any one → defect): your reasoning says the key is "more precise"; a distractor "captures [a real reading] but…"; or the distractor's primary denotation overlaps the key's denotation in the passage context.
   - **Grid-in:** your derived value is value-equivalent to the stored `correct_answer`.
2. **Tags.** `domain` is canonical and section-paired; `skill` ∈ the frozen 29 and is convention-consistent with §A.4. A tag that correctly applies the convention is not a defect.
3. **Distractors.** Each maps to a real error a student would plausibly make; the `error_taxonomy` label fits.
4. **SAT-authenticity.** Passages self-contained and answerable from the passage alone; LaTeX valid and unambiguous; difficulty roughly calibrated.

**Do not** check counts, per-domain totals, or distribution. Count is irrelevant — batches may target a single skill or difficulty by design.

## Output (JSON)

The verdict **must** include the `auditor` identity header as the first key. Compute the contract hash: `sha256sum .claude/skills/question-audit/SKILL.md | cut -c1-8`.

```json
{
  "auditor": {
    "agent": "question-auditor",
    "contractHash": "<first 8 chars of SHA-256 of this file>"
  },
  "compliance": "PASS | FAIL",
  "perQuestion": [
    { "id": "", "derivedAnswer": "", "storedAnswer": "", "match": true, "tagConventionConsistent": true, "issues": [] }
  ],
  "findings": [
    { "severity": "LOW | MEDIUM | HIGH", "questionId": "", "field": "", "issue": "", "evidence": "", "fix": "" }
  ],
  "verification": { "questionsChecked": 0, "allKeysReDerivedIndependently": true },
  "recommendation": "APPROVE | REVISE | REJECT"
}
```

The identity header is not optional. Without it, the orchestrator treats the audit as void — the header proves the registered `question-auditor` agent ran with the correct contract version, not a general-purpose substitute.

## Auto-REJECT (any one)

- Stored key ≠ your independent derivation.
- Any MCQ with a second defensible answer, or a distractor that is merely weaker rather than wrong.
- Grid-in stored value not value-equivalent to your derivation.
- A tag inconsistent with the §A.4 convention, or a non-frozen skill string.

## Note on your standing (pre-graduation)

You run as an independent check, but **Codex remains the binding gate** until three consecutive first-pass-clean batches. Your verdicts are being measured against Codex's during that window. Post-graduation, you become the per-question gate with Codex sampling 10–15%. Never rubber-stamp — a missed defect here is the failure mode that graduation is guarding against.
