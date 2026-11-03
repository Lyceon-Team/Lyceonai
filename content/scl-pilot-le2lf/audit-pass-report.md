# Blind Audit Pass — LE2 + LF SCL Tagging Report

Date: 2026-11-03  |  tagged_by: audit-pass  |  taxonomy: scl-v1.0.0
Total questions tagged: 594

## Per-sub-skill counts

| Sub-skill | Count | % of bank |
|-----------|------:|----------:|
| LE2.4 | 300 | 50.5% |
| LE2.5 | 93 | 15.7% |
| LF.1 | 189 | 31.8% |
| LF.2 | 39 | 6.6% |
| LF.3 | 127 | 21.4% |
| LF.4 | 35 | 5.9% |
| LF.5 | 12 | 2.0% |

LE2-tagged questions: 300 (LE2-only: 300)
LF-tagged questions: 294 (LF-only: 294)
Cross-skill (LE2+LF on same question): 0
Multi-sub-skill (>1 sub-skill): 199

## Bank gap (expected)

LE2.1, LE2.2, LE2.3 are contextual word-problem sub-skills.
LE2.1 count: 0
LE2.2 count: 0
LE2.3 count: 0
The LE2 bank is entirely abstract line questions — zero contextual coverage is expected and correct.

## Cluster coverage

Total clusters in taxonomy: 230
Clusters used by audit pass: 25
Clusters unused (205): CL.0001, CL.0002, CL.0005, CL.0006, CL.0007, CL.0008, CL.0010, CL.0011, CL.0012, CL.0013, CL.0014, CL.0015, CL.0018, CL.0019, CL.0020, CL.0021, CL.0022, CL.0023, CL.0025, CL.0026, CL.0027, CL.0028, CL.0029, CL.0030, CL.0031, CL.0032, CL.0035, CL.0036, CL.0037, CL.0038 ...

## Top 20 clusters by usage

| Cluster | Family | Uses | Name |
|---------|--------|-----:|------|
| CL.0128 | by_hand_doing | 243 | write y = mx + b from slope and a point |
| CL.0024 | by_hand_doing | 195 | compute slope from two points |
| CL.0047 | by_hand_doing | 193 | isolate the variable |
| CL.0094 | by_hand_doing | 169 | substitute a value and evaluate |
| CL.0084 | by_hand_doing | 115 | set a variable to zero to find an intercept or initial value |
| CL.0080 | by_hand_doing | 104 | rewrite in slope-intercept form |
| CL.0116 | by_hand_doing | 83 | use the negative-reciprocal slope for a perpendicular line |
| CL.0104 | by_hand_doing | 39 | translate words into an equation or inequality |
| CL.0160 | by_hand_recognizing | 34 | read slope and intercept from the equation |
| CL.0154 | by_hand_recognizing | 34 | match a number in the model to its meaning in context |
| CL.0089 | by_hand_doing | 26 | solve for the constant |
| CL.0172 | by_hand_recognizing | 10 | recognize parallel lines have equal slopes |
| CL.0009 | by_hand_doing | 7 | check a point in the equation or inequality |
| CL.0034 | by_hand_doing | 6 | distribute over every term |
| CL.0003 | by_hand_doing | 6 | add or subtract equations to eliminate a variable |
| CL.0017 | by_hand_doing | 5 | combine like terms |
| CL.0016 | by_hand_doing | 4 | clear fractions by multiplying by the common denominator |
| CL.0095 | by_hand_doing | 3 | substitute an expression |
| CL.0053 | by_hand_doing | 2 | match coefficients |
| CL.0087 | by_hand_doing | 2 | shift a graph by adjusting its equation |

## Notation-boundary cases (LE2 vs LF)

No questions tagged with both LE2.x and LF.x sub-skills.
The notation boundary was clean: LE2 questions use y=/slope-intercept,
LF questions use f(x)=/function notation. No ambiguous crossovers found.

## Distractors

Questions with distractor tags: 186
Total distractor annotations: 449

## Suspected mis-skills

None. All 8 audit fork workers reported zero mis-skills.
Every LE2 question uses y=/slope-intercept notation; every LF question uses f(x)/function notation.

## Off-spec patterns

None detected.

## Methodology

- 594 questions split into 8 chunks (4 LE2 x 75, 4 LF x 74/74/74/72)
- Each chunk independently audited by a fork worker with full taxonomy access
- Workers solved each question from scratch, derived sub-skills and clusters blind to the write pass
- Combined output validated: 594 lines, 594 unique IDs, 0 JSON errors, 0 invalid taxonomy IDs
