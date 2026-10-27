# Worked examples: runbook

Owner brief: "Worked examples: production system" (Karl, 2026-10-27). Engine: Hyperframes 0.8.143
(Karl's pick, 2026-10-27; Hypit shelved until 1.0). Music: "Happy Beats / Business Moves Vol. 12"
by ende.app, CC BY 4.0, credited in every caption.

## What runs where

| Piece | Where | What it does |
|---|---|---|
| Content | `social`: `content/worked-examples/` | `STYLE.json`, `<YYYY-MM>-plan/plan.json`, `<YYYY-Www>/<QUESTION_ID>/example.json` + `voice/`, `posted.json` |
| Asset kit | `video-kit/worked-examples/` | blank paper, Caveat + OFL, brand colours and fonts, the six templates, voice settings, music + licence |
| PR check | `.github/workflows/worked-example-checks.yml` | every content rule on a pull request into `social` |
| Daily job | `.github/workflows/worked-example-daily.yml`, 17:00 UTC | renders today's approved example and posts the labelled set to #social |
| Database | `supabase/migrations/20261118000000_worked_examples.sql` | `worked_examples`, `worked_example_metrics`, `questions_with_usage`, the leak rule both ways |

## The monthly plan (a pull request into `social`)

`content/worked-examples/<YYYY-MM>-plan/plan.json`: one slot per posting day (`post_on`,
`skill_code`, `hook_type`). Hook types rotate: no two consecutive slots share one, and a month of
five or more slots uses all five (puzzle, obvious_answer_trap, speed, challenge, contrarian).

## The weekly batch (a pull request into `social`, 3 examples)

1. Pick questions. Not allowed: a question in any full-length form, or one that is a QOTD today or
   later (the database refuses the approved row). Once an example is approved, its question can
   no longer be added to a full-length form (Karl's decision 1 on #1336, 2026-10-27). The generator reads the question from its seed
   SQL under `infra/supabase/seed/`; a question a seed patch changes is refused.
2. Write `content/worked-examples/<YYYY-Www>/<QUESTION_ID>/example.json`
   (`packages/shared/src/worked-example-schema.ts`). `post_on` is in that week and matches the
   plan's slot. `signature_move` matches `STYLE.json` for the skill.
3. Hook rules: no statistics, no claims about students or people, states the puzzle, ends with
   `?` or `…`, never the answer. They apply to the spoken hook too.
4. Voice it on your machine (never in CI):
   `HYPERFRAMES_PYTHON=<python with kokoro-onnx and soundfile> pnpm exec tsx scripts/worked-examples/voice.ts content/worked-examples/<week>/<QUESTION_ID>`.
   Commit `voice/*.wav` and `voice/manifest.json`. Editing a line later re-voices only that line;
   a line whose text changed without re-voicing fails the check.
5. Check locally: `pnpm exec tsx scripts/worked-examples/check-content.ts --content .`
6. Open the pull request into `social`. Codex audits the maths and hook rules. **Karl's merge is
   the approval** (read from GitHub's record of the merge; any later change to the folder that is
   not Karl's merge makes it unapproved again).
7. After the merge, generate the rows and hand them to Karl to apply:
   `GITHUB_TOKEN=… GITHUB_REPOSITORY=Lyceon-Team/Lyceonai CONTENT_APPROVER_LOGIN=… pnpm exec tsx scripts/worked-examples/seed-sql.ts --content <social checkout> --week <YYYY-Www> > seed.sql`

## The daily job

At 17:00 UTC: select the one example with `post_on` = today (America/Chicago), not retired, not in
`posted.json`, approved by Karl's merge → all content rules → generate → `hyperframes check` →
render → layout check (safe area x 71..912, y 154..1555; blank paper) → MP4 check (1080×1920,
30-60 s, audio, music peak on record) → claim in `posted.json`, pushed to `social` → post to
#social: the video, the TikTok title, the caption. Karl posts to TikTok by hand.

Nothing due: green, "nothing due". Two due on one day, or a due example not approved: red, nothing
posted.

**Re-posting after a failure.** If the post fails after the claim was pushed, the run is red and a
re-run posts nothing (posted once). To post again: download the run's `worked-example` artifact and
post by hand, or remove the example's line from `posted.json` in a pull request into `social` and
re-run.

## Secrets and settings (already used by the QOTD job)

`SLACK_BOT_TOKEN` (secret; scopes include `files:write`, `chat:write`, `files:read`),
`SOCIAL_SLACK_CHANNEL_ID` and `CONTENT_APPROVER_LOGIN` (variables). The job pushes `posted.json`
to `social` with its own token, as the approval stamp does.

## Metrics (manual entry, monthly readout)

Enter readings from each platform's analytics into `worked_example_metrics` (Karl, owner-run):

```sql
INSERT INTO public.worked_example_metrics (worked_example_id, platform, captured_at, views,
  retention_3s_pct, avg_watch_seconds, completion_pct, non_follower_view_pct, follows)
VALUES ('we-satm2czs1be', 'tiktok', '2026-11-09T17:00Z', 0, 0, 0, 0, 0, 0);
```

Monthly readout: `SELECT * FROM public.worked_example_metrics_monthly WHERE month = '2026-11-01'
ORDER BY hook_type, worked_example_id;` (latest reading per example, platform and month).
