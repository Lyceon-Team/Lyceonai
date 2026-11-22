# Video library approval review, 2026-11-22

These are recommendations only. Nothing was written to production; every query was a SELECT on project hncolwkccbbjkfithhlo. YouTube was not reached, so I judged each item from its title, duration, skill_codes, segment summary, timing and pending tags. Row-level detail is in `approval-recommendations.csv` in the same folder.

## What "unapproved" means here
- `video_resources.status` has one value, `available`, on all 305 rows, so it does not separate approved from unapproved rows. The only difference is `approved_at`: 225 videos have it set (2026-10-28 to 2026-11-11) and 80 have it null.
- **None of the 80 unapproved videos has any segments.** All 58 unapproved segments belong to videos that are already approved.
- Karl has approved videos with no segments before: 21 approved videos have none. Even so, the review criteria ask for segments with skill content, so I did not mark any unapproved video "approve". The good ones are marked **unclear (segment first)**. Approving one of them now would add 0 segments.
- Every row has `tagged_by = video-tags-review.csv`, so that column doesn't separate them either.

## Counts by recommendation
| Level | approve | reject | unclear | Total |
|---|---|---|---|---|
| Video | 0 | 52 | 28 | 80 |
| Segment | 54 | 3 | 1 | 58 |

## Videos by channel
| Channel | reject | unclear | Main reasons |
|---|---|---|---|
| Scalar Learning | 36 | 18 | 23 rejected "SAT Math Formula N/23" shorts duplicate the approved "Formula N - X" series (titles map one to one); 5 score reveals, 4 dated "predictions" videos, 2 test-format explainers, 1 resource roundup and 1 course ad are rejected. The unclear ones are full practice-test walkthroughs and marathons (up to 4.2 h) plus 3 strategy/Desmos/hard-problem videos, all usable only if segmented. |
| PrepPros - SAT & ACT Test Prep | 16 | 7 | 13 rejected are paper-SAT section walkthroughs (Writing & Language, No-Calculator, full Calculator sections, 2022-2023) or 2022 Reading-section tips; 3 are generic tips or commentary. The unclear ones are Digital SAT hard-problem sets and strategy videos with no skill codes. |
| Dr. TestPrep | 0 | 1 | Strong candidate from the same series as 5 approved videos; it needs segments first. |
| Penguin SAT Prep | 0 | 1 | Generic "Reading Hacks" with no skill codes; may overlap the approved per-skill videos. |
| Tutorllini Test Prep | 0 | 1 | Desmos Lesson #20 (typing shortcuts and UI) is about the calculator, not an SAT skill; the rest of the series is approved. |

**Strongest video candidates once segmented:** ljryBGiTLkM (Dr. TestPrep, Area and Volume), T-hgOvYTBPU (Scalar, Desmos hacks), 5BLaV52DedU and EEf70TIe-FA (PrepPros, Digital SAT hard sets) and yqcyspQ6HSg (Scalar, 38 hardest).

**Possible duplicates to check:** xVuh0yEF6FM and X68by_8ZbSU (both 302 s); DXBvPkuEiic and -1m5Eqy4VcY (both 3390 s); dYGlPpHPwD0 and nXd0ZBXeeFc (both "Practice Test 11").

## Segments by channel
| Channel | approve | reject | unclear |
|---|---|---|---|
| Tutorllini Test Prep | 15 | 0 | 0 |
| Penguin SAT Prep | 11 | 0 | 0 |
| Brain Buffs Tutoring | 8 | 0 | 1 |
| 3-4-5 Tutoring | 7 | 0 | 0 |
| Settele Tutoring | 4 | 0 | 0 |
| PrepPros - SAT & ACT Test Prep | 3 | 3 | 0 |
| AG Tutoring LLC, Dr. TestPrep, Mathodman, MVP Learners, Nicole Hamilton, Scalar Learning | 1 each | 0 | 0 |

- **Rejected (3):** 6d76c594, e7e17cb5 and bb99ed9a, all from the paper-SAT Writing & Language passage video V5l5-sgkCgE. They cover pronoun clarity, adding or deleting a sentence, and passage relevance. The Digital SAT does not use these formats.
- **Unclear (1):** 925eb974 is a qualitative graph-matching question (a spring's energy over time). No sub-skill fits it, so it is a taxonomy gap.
- **Intros, outros and ads:** none of the 58 is one. Segments starting at 0 s open straight into a method plus a worked question, and 58b3073d and 1a07df57 already leave out the intro and outro.
- **Approve, with notes:** 1c277158 has no pending sub-skill tag. 9c77741b is Boundaries content on a video filed as Transitions/Expression of Ideas. 759419bd is a quadratic (tagged NLF.1) on a video filed as Two-Variable Data. baea531e is only 14 s long but is a complete Desmos hack.

## What approving the "approve" set adds (approved segments per domain)
The domain is the video's `video_resources.domain`. The 28 unclear videos would add 0 segments because none of them has any.

| Domain | Approved now | + Approve set | After |
|---|---|---|---|
| Advanced Math | 97 | 5 | 102 |
| Algebra | 85 | 6 | 91 |
| Geometry and Trigonometry | 46 | 11 | 57 |
| Problem Solving and Data Analysis | 57 | 9 | 66 |
| Craft and Structure | 28 | 0 | 28 |
| Expression of Ideas | 12 | 9* | 21 |
| Information and Ideas | 18 | 9 | 27 |
| Standard English Conventions | 69 | 5 | 74 |
| **Total** | **412** | **54** | **466** |

\* One of these 9 (9c77741b) is really Standard English Conventions content. Counted by content, the figures are Expression of Ideas +8 and Standard English Conventions +6. Expression of Ideas and Information and Ideas gain the most relative to their current size (+75% and +50%).

## Approved items that look wrong by the same criteria (listed only)
- **V5l5-sgkCgE** (PrepPros, "5 Tips ... SAT Writing & Language: May 2022 Passage Explanation") is a paper-SAT Writing & Language passage walkthrough. Its 6 approved segments are 0f2fb21a, 2465480d, 48095d8b, d1e42494, 49b57968 and efc3350e.
- **Very short approved segments:** 68856e40 (6 s, apostrophes, XCfRaZHbtBs), 0bf1df9f (8 s, percent multipliers, 2u6I92--WYI) and bee8177a (12 s, colons, XCfRaZHbtBs).
- **21 approved videos with no segments:** EZsy-CdsIR4, jCT0jTVzKy0, ZRdsmOq4D5c, iJmdrd4xdzc, BikLpKp0TpQ, RlvHAqMUzSw, H3okEuiCaXE, I9e7zd1TiDo, OKGrV3e9aZk, 5VdaJ6HYbD8, 3l2hgANLQV8, PlgbXGyKBYw, 5Yw2P3yULeA, 8zLujZYTsWc, ynsSypnoAcQ, Me3IEHAtESo, eIkiuHw9nrI, UDJ2RHMFax8, 8Ik_TbQ7ouE, bcoYGlribno and IFBTj353NHI.
- **Approved videos whose skill code doesn't match their content** (from the tagging README): qLEVgoVO65U, YbIToNjrWBE, uLYm9UC4Wis, 6GLUNxyNuhI, CnPWdS42whA, gdaX-8LP1rw, JwiaqsMWyfc, Yo-Haulw6gM and nLLwupYkfCo.
