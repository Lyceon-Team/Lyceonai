# Candidate videos: James Lu SAT + Khan Academy SAT (official)

Generated 2026-11-22. Read-only research. No video in the CSV is among the 305 `video_resources.video_id` values; I checked all 134 harvested ids against the full list and found 0 overlaps.

## Sources

| Channel | Channel id | How it was found | Official? |
|---|---|---|---|
| James Lu SAT (@JamesLuSAT) | UCy0sBL6X8dxIGXrkJZN4urQ | channel /videos and /streams tabs, his course playlists, 9 YouTube searches | His own channel |
| Khan Academy SAT (@KhanAcademySATPrep) | UCb6Pzsn8oIFv1N8eGem570A | playlists "Reading and Writing \| SAT \| Khan Academy" (PL6dL3ACWCL8c7VrP02fgLtG8pM60okPaX, 29 videos) and "Math \| SAT \| Khan Academy" (PLXpL_oD58Un4, 83 videos) | Verified badge; channel description reads "For Official SAT Practice on Khan Academy, visit www.khanacademy.org/digital-SAT" |

Notes on Khan Academy:
- The main Khan Academy channel (@khanacademy) has no public Digital SAT skill lessons. It has only webinars and promotional clips, plus older general reading and grammar lessons that are not SAT-specific. None of these went into the CSV.
- The Khan videos were uploaded between 2026-09-23 and 2026-09-28 (one on 2026-10-14), so they are all Digital SAT. Many titles carry another Khan course tag (for example "Cambridge O Level", "7th grade English", "Pakistan National Curriculum"). They still appear in the official SAT playlists, so they were kept.
- Some playlists are named after Khan Academy but belong to other channels: "Khan Academy Reading & Writing walkthroughs" belongs to 3-4-5 Tutoring, and "Digital SAT Math on Khan Academy" belongs to Scalar Learning. Both channels are already in the library, and these playlists were excluded.

## Counts

| Channel | Rows | high | normal | verified=yes | verified=no |
|---|---|---|---|---|---|
| Khan Academy SAT | 112 | 41 | 71 | 103 | 9 |
| James Lu SAT | 11 | 7 | 4 | 10 | 1 |
| **Total** | **123** | **48** | **75** | **113** | **10** |

## Candidates per skill (a video can count toward more than one skill)

| Skill | Candidates |
|---|---|
| Nonlinear Functions | 14 |
| Equivalent Expressions | 14 |
| Right Triangles and Trigonometry | 9 |
| Circles | 9 |
| Boundaries | 7 |
| Form, Structure, and Sense | 7 |
| Two-Variable Data: Models and Scatterplots | 6 |
| Command of Evidence | 6 |
| Linear Inequalities in One or Two Variables | 6 |
| Nonlinear Equations in One Variable and Systems of Equations in Two Variables | 6 |
| Ratios, Rates, Proportional Relationships, and Units | 5 |
| Percentages | 4 |
| Systems of Two Linear Equations in Two Variables | 4 |
| Linear Equations in One Variable | 4 |
| Linear Functions | 4 |
| Central Ideas and Details | 3 |
| Inferences | 3 |
| Lines, Angles, and Triangles | 3 |
| Area and Volume | 3 |
| One-Variable Data: Distributions and Measures of Center and Spread | 3 |
| Probability and Conditional Probability | 3 |
| Evaluating Statistical Claims: Observational Studies and Experiments | 3 |
| Transitions | 3 |
| Words in Context | 3 |
| Cross-Text Connections | 2 |
| Inference from Sample Statistics and Margin of Error | 2 |
| Rhetorical Synthesis | 2 |
| Text Structure and Purpose | 2 |
| Linear Equations in Two Variables | 2 |

## The 15 lowest-coverage skills (approved segments summed across all domain tags)

| # | Skill | Approved segments now | Candidates |
|---|---|---|---|
| 1 | Rhetorical Synthesis | 0 | 2 |
| 2 | Inferences | 1 | 3 |
| 3 | Ratios, Rates, Proportional Relationships, and Units | 1 | 5 |
| 4 | Central Ideas and Details | 3 | 3 |
| 5 | Inference from Sample Statistics and Margin of Error | 5 | 2 |
| 6 | Cross-Text Connections | 7 | 2 |
| 7 | Words in Context | 7 | 3 |
| 8 | Evaluating Statistical Claims: Observational Studies and Experiments | 8 | 3 |
| 9 | Probability and Conditional Probability | 8 | 3 |
| 10 | Lines, Angles, and Triangles | 11 | 3 |
| 11 | Percentages | 11 | 4 |
| 12 | Transitions | 12 | 3 |
| 13 | Command of Evidence | 14 | 6 |
| 14 | Right Triangles and Trigonometry | 14 | 9 |
| 15 | Text Structure and Purpose | 14 | 2 |

The cut is clean: the next skill, Linear Equations in Two Variables, has 15.

How the ranking was built: I summed approved segments per skill across every `video_resources.domain` value. The per-(domain, skill) query in the brief splits several skills across mismatched domains (for example "Advanced Math / Circles" and "Advanced Math / Percentages"). Summing per skill gives a single ranking.

## Unverified rows (verified = no)

For these 10 videos YouTube returned a bot-check or captcha page on every one of 3 fetch attempts, so I never got the watch-page data. Each id is still confirmed by YouTube's oEmbed endpoint (HTTP 200, with the channel and title shown) and by the official playlist listing. Their `published` value is approximate ("1mo ago" or "1y ago" from the listing).

LjyPfd5p4pg, P2ZBHoQVN0Q, EhTpHuZqWg0, 9x4ihhkkOdw, -010noyu2l0, aRCvVUeCW4E, vF4Vv5xZzeA, B5P5_hI3NZ4, yCXnnRKNeQU (Khan Academy SAT); hSCNS0PJnZg (James Lu SAT)

On the other 113 rows, the fetched watch page was checked for the matching video id, title, channel and date. The watch pages were behind a sign-in wall and did not include a length, so every duration in the CSV comes from YouTube's playlist or search listing.

## Excluded after checking

- F-YsV4IplnA "FREE 3.5 Hour SAT Reading & Writing Masterclass (2026)": it is in a James Lu playlist, but oEmbed says the owner is "John H Test Prep".
- _nkKALQZyP8, a Khan Academy SAT webinar for districts. It is not tied to any skill.
- James Lu videos that are not about one skill:
  - ZYBc-Zvp_tI (silly mistakes in math)
  - v88UhSJuK7w (study mistakes)
  - NBECQxDBQQs (R&W pacing strategy)
- James Lu full-test walkthroughs and hard-question streams. They cover every skill and would need to be segmented first:
  - Full-test walkthroughs: 1UGO6uXnbgk, nfhUlWOGojI, H95GL5itxF8
  - Hard-question streams: Kap5CP7QNhU (22h), yy8ASPvYBO8 (11h40m), IZv4GsZol7c (10h30m)

## Tagging caveats

- Khan math titles use Khan's unit names. Several of these could reasonably go to more than one College Board skill:
  - "Isolating quantities" was tagged Equivalent Expressions.
  - "Linear and exponential growth" was tagged Two-Variable Data.
  - "Table data" was tagged Probability.
  - "Angles, arc lengths, and trig functions" was tagged both Circles and Right Triangles and Trigonometry.
- Likely duplicate Khan uploads (same title, or a "Khan Academy1" suffix):
  - gLdGfFH588s / 3u4zLAoNxHU
  - LCDN7CQNCxA / Oprm3CfqDgY
  - LjX5jzcN_ko / FhU61MqnwRY
- James Lu "How to Solve Hard SAT Reading Questions Easily" (dUl1Hmgx-NE) teaches a general reading process. Its tags (Central Ideas and Details; Inferences) are approximate.
- The skill split for James Lu "Must Know SAT Grammar Patterns" (hSCNS0PJnZg) comes from its title only.
