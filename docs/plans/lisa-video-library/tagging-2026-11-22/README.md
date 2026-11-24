# Video segment tagging: full pass, 2026-11-22

## Apply state (owner reports)
- `approve-video-segments-2026-11-22.sql`: applied by Karl, 2026-11-22, reporting `466 approved of 470`.
- `apply-video-segment-tags-2026-11-22.sql` and `fix-video-skill-codes-2026-11-22.sql`: not applied as of Karl's 2026-11-22 report.

## Files in this folder
| File | What it is |
|---|---|
| `apply-video-segment-tags-2026-11-22.sql` | The additive tag inserts (owner-run) |
| `fix-video-skill-codes-2026-11-22.sql` | Skill-code and domain corrections for 9 videos (owner-run) |
| `approve-video-segments-2026-11-22.sql` | Approval of 54 segments (owner-run, applied) |
| `tags-review.csv` | Every tag in the apply file, with its source and evidence |
| `excluded.csv` | The 6 tags held out because they contradict production evidence |
| `existing-doubtful.csv` | 38 production tags the reviewers doubted (not changed) |
| `untagged.csv` | The 7 segments with no sub-skill, with reasons |
| `verification-report.md` | The independent final verification |
| `coverage-report.md`, `coverage-by-subskill.csv` | Video coverage per sub-skill and question, before and after |
| `approval-recommendations.csv`, `approval-summary.md` | Approve, reject or unclear for every unapproved video and segment |
| `candidate-videos.csv`, `candidate-videos-summary.md` | 123 Khan Academy SAT and James Lu candidates (not added) |
| `teaching-notes-plan-2026-11-22.md` | The teaching-notes (write-up and chunk) plan and Karl's open rulings |

## What to run
`apply-video-segment-tags-2026-11-22.sql` in the Supabase SQL editor (project hncolwkccbbjkfithhlo). It is additive only: it never deletes or updates. It is safe to re-run (ON CONFLICT DO NOTHING), and its guards check that every segment, sub-skill and cluster ID exists, with no fixed counts.

The last query prints segments, segments_with_sub_skill, segments_with_cluster, sub_skill_tags and cluster_tags.

**Expected:**
- segments_with_sub_skill: 463 of 470 (was 361)
- segments_with_cluster: 469 (was 466)
- sub-skill tags: rise by 208
- cluster tags: rise by 144

## How it was made
| Step | Result |
|---|---|
| Two blind, independent tagging passes per domain (16 taggers, 470 segments) | Agreed on 1,120 tags |
| Adjudication of every one-pass-only tag (8 reviewers) | 111 accepted, 48 rejected |
| Final independent verifier | SQL parsed with the Postgres parser; all IDs exist; 4 contradictions with transcript-backed production tags; 40-tag spot check: 37 correct, 0 wrong, 3 unclear |
| Excluded from the file (excluded.csv) | 6 tags that contradict production evidence |
| In the file | 1,231 rows: 879 already in production (skipped), 352 new |

**Basis:** segment summaries, video titles and skill codes, and the evidence on existing production tags. The database has no transcripts and YouTube was blocked from this session, so tags the summary couldn't support were left out rather than guessed.

## For Karl to review (nothing here is applied)
- **existing-doubtful.csv**: 38 existing production tags whose evidence or summary contradicts them. Keep or remove is your call.
- **untagged.csv**: 7 segments with no sub-skill. Five of them point to taxonomy gaps, where new IDs could be added under the add-only rule:
  - polygon interior-angle sum, (n−2)×180 (9d4657c4)
  - midpoint formula (a3f15554)
  - distance formula (b9243e41)
  - qualitative graph matching, a spring's energy over time (925eb974)
  - old-SAT add/delete-a-sentence (e7e17cb5); an old-format item, and arguably out of scope

  Two are unclear from their summaries: Stoicism inference (1c277158) and old-SAT relevance (bb99ed9a).
- **Mislabeled videos** (the skill code is wrong in video_resources; tags follow the content):
  - Filed as Words in Context, actually Command of Evidence: qLEVgoVO65U, YbIToNjrWBE, uLYm9UC4Wis
  - Filed as Transitions, actually Command of Evidence: 6GLUNxyNuhI, CnPWdS42whA, gdaX-8LP1rw, JwiaqsMWyfc
  - Filed as Transitions, actually Boundaries punctuation: Yo-Haulw6gM
  - Filed as Inferences, summary says Command of Evidence: nLLwupYkfCo
- **Segment with conflicting production tags:** efc3350e has BND.3 (no punctuation, from the transcript) next to the agreed BND.4. BND.4 was held out of this file.
- **Taxonomy wording:** the INFS.4 and INFS.5 inclusion tests name "INFS.1" and "INFS.2" inside their own text.

## Known limits
- **Stats segments:** PSDA-B (statistics) sub-skills aren't loaded yet. These segments are tagged against the current IDs; a short add-only pass is needed once PSDA-B lands.
- **Near-duplicate PSDA pairs:** pairs such as ESC1/ESC.1 and PCT.3/PCT.7 are both tagged where each one's inclusion test is met, per the rule that no ID is superseded.
