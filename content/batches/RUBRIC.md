# Audit rubric (Codex, Doc 10B §4 stage 5)

Approved by Karl, 2026-10-11 (Doc 10B Phase 1 Step 0: "The rubric is approved as written").

Codex audits every item in a batch against this rubric and records one verdict per item in the
"## 2. Codex audit" section of `content/batches/<cycle>/REVIEW.md`. Audit the item itself, against
its cited sources and College Board's current pages. Do not read "## 1. Claude self-audit" before
forming the verdict.

## Verdicts

- **APPROVE**: every row below passes.
- **REVISE**: at least one row fails, and it can be fixed by editing the item.
- **REJECT**: the item cannot be fixed within the cycle. That means one of:
  - a disclosure-doctrine problem built into the topic;
  - its target keyword is already covered by an existing Lyceon page (gate 11);
  - its central claim cannot be supported by a credible source;
  - it is not helpful beyond an existing Lyceon page (Doc 10B §2.9).

Each verdict carries **reasons** and **evidence**. Evidence is a URL plus the quoted text, a
recomputed figure, or a CI run link.

## Checks

| # | Check (source) | Evidence required |
| --- | --- | --- |
| R1 | Every factual sentence about the SAT, scores, tutoring or studying has a citation; College Board first (§5.3) | Sentence → source URL |
| R2 | **Source fidelity:** the cited page actually supports the sentence (§5.4) | Quote from the source |
| R3 | **Accuracy:** format, timing, scoring, dates and policies match College Board's current pages; any math recomputed (§5.5) | URL + quote; the worked check |
| R4 | **Claims:** product or outcome statements map to an approved row in `docs/compliance/claim-inventory.md`; Lyceon-specific claims flagged for Karl (§5.1, Doc 10A §3.1.5) | Row ID |
| R5 | **Disclosure doctrine:** no mechanisms, bank size, scoring or mastery logic, LISA internals or internal labels (§5.2, Doc 10A §3.1.2) | Quoted phrase |
| R6 | **Originality:** no copied passages beyond short attributed quotations; no reproduced official SAT questions (§5.9, §2.10) | The matching source passage |
| R7 | **Helpful, not scaled:** gives the reader something no existing Lyceon page does; not a near-duplicate (§2.9, §5.11) | The nearest existing page |
| R8 | **Reads as written by a person:** no AI tells, filler, invented statistics or invented people; straight to the point (§2.5, §2.13) | Quoted phrase |
| R9 | **No mention of AI, models, automation or process.** The one exception is LISA named as a product feature, e.g. "LISA, your AI tutor" (Karl, 2026-10-11). The SAT trademark notice is present (§5.12, §2.12) | Quoted phrase |
| R10 | **Brief fit:** target keyword and search intent, audience, call to action, internal links to the relevant practice or score pages (§4 stage 2, §5.7) | — |
| R11 | **Links resolve**, and every CI gate is green on the head commit (§5.8, §4 stage 4) | CI run link |
| R12 | **Under-13:** nothing aimed at under-13s (Doc 10A §3.1.7) | — |
