# Lyceon Scoring Formula v1.0 — Validation Evidence Summary

**Benchmark:** Widely-referenced third-party DSAT score calculator (Test Ninjas)
**Source URL:** https://test-ninjas.com/digital-sat-score-calculator
**Formula:** Locked Lyceon scoring v1.0 (see Doc 04B V4.3 §6)
**Rounding:** Round half up to nearest 10 (Doc 04B V4.3 §6.3 canonical rule)
**Methodology:** Exhaustive sweep of all (r1, r2) pairs per section per path under proportional M2 wrong-distribution; supplemented by targeted difficulty-distribution fixtures (see `validation_targeted_fixtures.csv`). Module compositions per locked Lyceon Doc 04B V4.3 §12.

## Overall Results

- **Total scenarios swept:** 1313
- **In Test Ninjas band:** 496 (37.8%)
- **Within 30 scaled points:** 934 (71.1%)
- **Within 50 scaled points:** 1101 (83.9%)
- **Within 100 scaled points:** 1290 (98.2%)

## Per-Section Results

### Reading & Writing — 784 scenarios

- In TN band: 333 (42.5%)
- Within 30: 588 (75.0%)
- Within 50: 682 (87.0%)
- Within 100: 777 (99.1%)

| TN band | n | In-band | ≤30 | ≤50 | Mean delta |
|---|---|---|---|---|---|
| 200-240 | 21 | 21 | 21 | 21 | +0.0 |
| 250-290 | 57 | 50 | 57 | 57 | -1.2 |
| 300-350 | 93 | 80 | 93 | 93 | -1.4 |
| 360-410 | 129 | 55 | 108 | 113 | +2.9 |
| 420-470 | 159 | 22 | 101 | 125 | +10.2 |
| 480-530 | 115 | 15 | 46 | 82 | +6.3 |
| 540-590 | 90 | 19 | 52 | 72 | +8.3 |
| 600-650 | 54 | 22 | 44 | 53 | +9.6 |
| 660-710 | 38 | 24 | 38 | 38 | +3.2 |
| 720-770 | 22 | 20 | 22 | 22 | +0.0 |
| 780-800 | 6 | 5 | 6 | 6 | -1.7 |


### Math — 529 scenarios

- In TN band: 163 (30.8%)
- Within 30: 346 (65.4%)
- Within 50: 419 (79.2%)
- Within 100: 513 (97.0%)

| TN band | n | In-band | ≤30 | ≤50 | Mean delta |
|---|---|---|---|---|---|
| 200-240 | 10 | 10 | 10 | 10 | +0.0 |
| 250-290 | 26 | 21 | 26 | 26 | -1.9 |
| 300-350 | 55 | 25 | 55 | 55 | -10.5 |
| 360-410 | 80 | 20 | 64 | 74 | -8.5 |
| 420-470 | 105 | 19 | 51 | 72 | +6.2 |
| 480-530 | 100 | 15 | 35 | 56 | +9.9 |
| 540-590 | 62 | 13 | 31 | 40 | +12.1 |
| 600-650 | 46 | 14 | 32 | 41 | +13.9 |
| 660-710 | 30 | 14 | 27 | 30 | +10.3 |
| 720-770 | 12 | 9 | 12 | 12 | +3.3 |
| 780-800 | 3 | 3 | 3 | 3 | +0.0 |


## High-Priority Specific Cases

| Case | Lyceon | Expected | Source |
|---|---|---|---|
| Target case: 0/27 M1 + 27/27 M2A (RW) | 430 | 430 | Anchor: banded ceiling test |
| Perfect Path B (RW) | 800 | 800 | SAT scale ceiling |
| Applerouth: Path B miss 1 easy (RW) | 790 | ~750 | Applerouth interview |
| Applerouth: Path B miss 1 hard (RW) | 790 | ~780 | Applerouth interview |
| Applerouth: 15/22 M1 + 0/22 M2B (Math) | 480 | ~460 | Applerouth practice test 1 |
| Reddit Bluebook: 25/27 + 7/27 M2B (RW) | 600 | ~580 | r/SAT community report |
| CB Path B floor at threshold (RW) | 450 | ~450-480 | CB graph + Applerouth |
| Zero everything (RW) | 200 | 200 | SAT scale floor |

## Reproducibility

This validation can be reproduced by:

1. Running `validation_sweep.py` against any Python 3.8+ environment
2. The output `validation_results.csv` will be byte-identical for the same formula constants
3. The PL/pgSQL implementation in production must produce identical scaled values
   for the same inputs to be considered correctly deployed

## Acceptance Threshold

The Lyceon scoring formula v1.0 is considered validated against the Test Ninjas
benchmark when:

- **70%+ of scenarios within 50 scaled points** of the benchmark band
- **95%+ of scenarios within 100 scaled points** of the benchmark band

Current results exceed both thresholds.
