# Lyceon Scoring v1.0 — Source Extraction Notes

**Doc reference:** Doc 04B V4.3 §18 (Validation and Calibration Approach), Appendix B
**Date accessed:** 2026-05-12
**Author:** Lyceon engineering (Karl + Claude)
**Status:** Component of the V4.3 validation evidence packet; covered by the packet SHA-256

---

## 1. Purpose of this document

This document records:

1. **The methodology** used to extract benchmark band data from third-party DSAT score calculators and convert it to the form used in `test_ninjas_bands_reference.csv`.
2. **The source URLs** consulted during v1.0 formula calibration.
3. **Lyceon's interpretation notes** for cases where source presentation required transformation before comparison.

This document does NOT include live HTML snapshots, screenshots, or third-party reviewer signoffs. Per Doc 04B V4.3 §18.2 and Appendix B, audit-grade reviewers performing independent verification are expected to capture live snapshots from the cited URLs themselves — Lyceon's evidence packet documents the methodology and the extracted data, not the upstream binary captures. See §5 below for what reviewers should fetch independently.

---

## 2. Primary benchmark: Test Ninjas DSAT score calculator

**URL:** https://test-ninjas.com/digital-sat-score-calculator
**Calculator type:** Adaptive (Module 1 raw + Module 2 path + Module 2 raw → scaled section score)
**Section coverage:** Reading & Writing (RW) and Math
**Range:** 200–800 per section, rounded to nearest 10

### Methodology

The Test Ninjas calculator does not publish a closed-form formula or a downloadable lookup table. Calibration proceeded by querying the calculator across a representative grid of inputs:

- **M1 levels:** every integer from 0 to N1 (RW: 0–27; Math: 0–22)
- **Module 2 path:** both A (below-threshold) and B (at/above-threshold) paths
- **M2 raw levels:** every integer from 0 to N2 (27 for RW, 22 for Math)

For each (section, path, M1, M2) input, the calculator's scaled output was recorded as a single integer (the calculator rounds to nearest 10). The resulting (M1, M2, path) → scaled mapping forms the band table in `test_ninjas_bands_reference.csv`.

**Important: the band table is a point-input mapping, not a closed-form formula.** Lyceon's v1.0 formula (§6.3) is a closed-form approximation that hits the Test Ninjas bands within the documented tolerance (37.8% exact, 71.1% within ±30, 83.9% within ±50, 98.2% within ±100 — see `validation_summary.md` and Doc 04B V4.3 §18.1).

### Interpretation notes

- **Module 2 wrong-distribution treatment:** The Test Ninjas calculator does not ask for the difficulty distribution of Module 2 wrong answers; it appears to assume proportional distribution (wrongs allocated to easy/medium/hard buckets in proportion to the locked Lyceon module composition — DSAT-standard 14E/9M/4H for M2A RW, etc.). The main validation sweep mirrors this assumption. V4.3's targeted fixtures (§18.1, `validation_targeted_fixtures.csv`) exercise non-proportional patterns that Test Ninjas does not directly compare against — these fixtures are for internal cross-language parity at the Lyceon formula, not benchmark alignment.
- **Path A floor of 200:** Confirmed by sweeping low-M1 / low-M2 combinations against the Test Ninjas calculator; the floor of 200 is shared.
- **Path B floor structure:** Test Ninjas appears to use a discontinuous floor at the threshold (M1 ≥ T), with a baseline of ~450 climbing toward ~580 as M1 increases. Lyceon's path-B floor (§6.3: `min(580, 450 + 15·(r1 - T))`) is a closed-form approximation of this discontinuity.

---

## 3. Secondary corroborating sources

### Applerouth DSAT practice report

**URL:** https://www.applerouth.com (search: "Digital SAT practice test results" or "Digital SAT scoring")
**Use:** Calibration check cases for specific high-priority scenarios documented in Doc 04B V4.3 §18.1:
- Path B miss 1 easy → Applerouth reports ~750; Lyceon produces 790 (+40)
- Path B miss 1 hard → Applerouth reports ~780; Lyceon produces 790 (+10)
- Math 15/22 M1 + 0/22 M2B → Applerouth reports ~460; Lyceon produces 480 (+20)

### College Board Bluebook practice tests

**URL:** https://bluebook.collegeboard.org
**Use:** Boundary case sanity checks against actual CB practice DSAT score reports:
- Perfect score (27/27 + 27/27 M2B path) → CB confirms 800; Lyceon produces 800 ✓
- Path B floor at threshold (M1 = T, M2 = 0) → CB reports range 450–480; Lyceon produces 450 (within range) ✓
- Path A peak (M1 = T−1, M2B not accessible) → CB reports range 580–610; Lyceon produces 630 (+20 above range)

**Important:** Lyceon v1.0 is NOT calibrated to be College Board's exact scoring. The CB checks above are sanity-bound validation, not alignment targets. Disclosure language (Doc 04B V4.3 §17) explicitly does NOT claim CB calibration.

### r/SAT community Bluebook reports

**URL:** https://www.reddit.com/r/Sat/
**Search terms:** "Bluebook score", "Digital SAT score", "DSAT path", "Module 2 hard"
**Use:** Community-reported scenarios used as additional sanity points for high-M1 / collapsed-M2B trajectories. Threads consulted during calibration in March-April 2026 are not archived in this packet; reviewers can search the subreddit independently with the above terms.

Note: Reddit threads are not stable references. Threads may be deleted, edited, or rate-limited. For audit purposes, reviewers should treat r/SAT corroboration as supporting context, not primary evidence — Test Ninjas and Bluebook are the canonical anchors.

---

## 4. The extracted band table

The result of the Test Ninjas calibration sweep is `test_ninjas_bands_reference.csv` (same directory as `validation_sweep.py`).

Schema:

```
section, path, m1, m2, ts_scaled
```

Each row is one observed Test Ninjas output for a single (section, path, M1, M2) input. The CSV is the canonical benchmark used by `validation_sweep.py` for the in-band comparison statistic.

If Test Ninjas updates its calculator post-V4.3, the band table will diverge. The v1.0 formula does not change in response — `scoring_model_versions` immutability (Doc 04B V4.3 §7, §8.4, §23) means any recalibration produces a v2.0 candidate, with a new evidence packet and a new band table. The v1.0 packet remains the historical reference for any score produced against v1.0.

---

## 5. What reviewers should fetch independently

For audit-grade verification, reviewers SHOULD capture the following directly from the cited sources rather than relying on Lyceon-provided pre-fetches:

| Artifact | Where to fetch | Purpose |
|---|---|---|
| Test Ninjas calculator UI snapshot | https://test-ninjas.com/digital-sat-score-calculator | Confirm the calculator interface and inputs match this extraction's assumptions |
| 10–20 random spot-checks from Test Ninjas | Same URL, varying inputs | Confirm the band table in this packet still matches the live calculator |
| Bluebook practice DSAT score report | https://bluebook.collegeboard.org (requires CB account) | Confirm the perfect-score, threshold-floor, and Path-A-peak sanity points |
| Applerouth blog or interview source | Applerouth published content | Confirm the specific calibration check cases cited in §18.1 |
| r/SAT supporting threads | https://www.reddit.com/r/Sat/ | Confirm the community-reported scenarios used as soft corroboration |

Lyceon does not bundle these binary artifacts in the evidence packet. The methodology and extracted data are documented here; reviewers who need stronger evidence than "Lyceon says these were the sources" can perform their own captures using the URLs above.

This is a deliberate boundary: the Lyceon evidence packet's job is to make the formula auditable (Python reference + sweep + targeted fixtures + summary + this methodology), not to serve as a static archive of third-party calculator state. Third-party calculators are living systems and Lyceon does not control their content; freezing snapshots inside Lyceon's evidence packet would create false provenance.

---

## 6. Audit signoff (intentionally absent)

This document does NOT include reviewer signoffs. The validation packet is Lyceon-internal at v1.0 lock; signoff by external reviewers would be a separate audit artifact, not a packet contents file. If post-launch audit signoff becomes a requirement, it will be tracked in a separate document outside this packet (and outside the packet hash).

---

**End of extraction notes.**

This document is part of the V4.3 evidence packet. Its contents are included in the packet SHA-256, which is documented in `evidence_packet.sha256` and in Doc 04B V4.3 §18.2 / Appendix B. The packet hash is computed by `validation_sweep.py` after each regeneration and changes if any packet file (including this one) is edited.
