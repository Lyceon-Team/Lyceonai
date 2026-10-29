# SCL Tagging Pilot Report: Equivalent Expressions (EE)

**Date:** 2026-10-29
**Taxonomy version:** scl-v1.0.0
**Skill:** Equivalent Expressions (EE.1 -- EE.5)
**Question count:** 351 (302 MCQ, 49 grid-in)

---

## Coverage (both passes)

| Metric | Count | Rate |
|---|---|---|
| Questions with sub-skill tag | 351 / 351 | 100% |
| Questions with cluster tag | 351 / 351 | 100% |
| MCQ with distractor cluster | 302 / 302 | 100% |
| **First-class count** | **351 / 351** | **100%** |

First-class = has sub-skill + cluster + distractor (where MCQ).

---

## Inter-pass agreement

| Layer | Exact match | Count |
|---|---|---|
| Sub-skill set | 69.2% | 243 / 351 |
| Cluster set | 74.6% | 262 / 351 |
| Distractor cluster set (MCQ only) | 37.4% | 113 / 302 |

**Total questions with at least one disagreement:** 254 / 351

### Disagreement breakdown

| Type | Count |
|---|---|
| Sub-skill only | 35 |
| Cluster only | 15 |
| Distractor only | 101 |
| Mixed (2+ layers) | 103 |

### Nature of sub-skill disagreements (108 total)

Pass 2 assigned more sub-skills in 75 cases; Pass 1 more in 8; same count but different tags in 25. The dominant pattern: Pass 2 tagged secondary sub-skills (e.g. EE.1 alongside EE.2 for distribute-then-combine, or EE.5 alongside EE.3 for factor-then-cancel rational expressions) that Pass 1 omitted. The primary sub-skill agreed in the vast majority.

### Nature of cluster disagreements (89 total)

Pass 2 assigned more clusters in 37 cases; Pass 1 more in 19; same count different clusters in 33. Common divergence: whether CL.0075 (reduce fraction) vs CL.0008 (cancel common factor) applies to cancellation steps; whether CL.0033 (distribute negative) is tagged separately from CL.0034 (distribute over every term).

### Nature of distractor disagreements (189 MCQ)

Distractor cluster assignment is inherently more subjective -- each wrong answer can stem from multiple possible errors, and the two passes often attributed different root causes. This is the expected weakest layer.

---

## Sub-skill distribution

| Sub-skill | Pass 1 | Pass 2 |
|---|---|---|
| EE.1 (combine like terms) | 76 | 89 |
| EE.2 (expand/multiply) | 99 | 103 |
| EE.3 (factor polynomials) | 178 | 167 |
| EE.4 (exponents/radicals) | 45 | 59 |
| EE.5 (rational expressions) | 95 | 146 |

Pass 2 tags EE.5 more liberally (146 vs 95), applying it to factor-and-cancel rational expressions where Pass 1 tagged only EE.3.

## Top clusters

| Cluster | Pass 1 | Pass 2 |
|---|---|---|
| CL.0008 (cancel common factor) | 114 | 109 |
| CL.0164 (recognize diff of squares) | 104 | 103 |
| CL.0017 (combine like terms) | 103 | 114 |
| CL.0034 (distribute over every term) | 101 | 95 |
| CL.0037 (factor trinomial) | 72 | 69 |
| CL.0006 (exponent rules) | 52 | 62 |
| CL.0035 (divide polynomials) | 49 | 46 |
| CL.0033 (distribute negative) | 29 | 31 |
| CL.0039 (factor out GCF) | 25 | 25 |
| CL.0075 (reduce fraction) | 6 | 18 |
| CL.0165 (perfect-square trinomial) | 10 | 15 |
| CL.0040 (find common denominator) | 12 | 12 |

---

## Validation

- **All tag IDs valid** against scl-v1.0.0 taxonomy (0 invalid sub-skill IDs, 0 invalid cluster IDs in both passes)
- **Zero mis-skilled questions** (every question has at least one EE sub-skill in both passes)
- **Zero cross-skill sub-skill tags** used (no non-EE sub-skills assigned)

---

## Model cost

Both passes were executed in-session (derivation by the session model, not separate API calls), so token costs are not separately metered. The total session cost covers the full pilot.

---

## Recommendations for Karl

1. **Sub-skill and cluster agreement (69--75%) is reasonable for a first pilot.** Most disagreements are about granularity (how many secondary tags), not about the primary classification. A single adjudication pass reviewing the 254 disagreements would produce a clean canonical set.

2. **Distractor agreement (37%) is expected-low.** Distractor error attribution is inherently ambiguous (a wrong answer can result from multiple error types). Consider whether distractor clusters need adjudication or whether the pass-1 assignments are sufficient for the adaptive engine's needs.

3. **Coverage is complete.** 100% first-class across all 351 questions.

4. **No mis-skilled questions found.** The EE serving set appears correctly classified.

5. **DB writes are prepared but not executed.** The SQL to insert Pass 1 tags into `question_sub_skills`, `question_clusters`, and `distractor_clusters` is in `docs/scl-tag-pilot/ee-tag-insert.sql`. Approve before execution.

---

## Files

| File | Location |
|---|---|
| Pass 1 results | `docs/scl-tag-pilot/pass-1-results.ndjson` |
| Pass 2 results | `docs/scl-tag-pilot/pass-2-results.ndjson` |
| Disagreements | `docs/scl-tag-pilot/disagreements.json` |
| Pilot report JSON | `docs/scl-tag-pilot/pilot-report.json` |
| DB insert SQL | `docs/scl-tag-pilot/ee-tag-insert.sql` |
