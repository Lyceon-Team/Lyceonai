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

## The cloned voice (OpenVoice addendum, Karl, 2026-10-27)

The /brag voice (`af_heart`) stays the default and the fallback until Karl picks the clone after the
comparison below; then `default_profile` in `video-kit/worked-examples/voice.json` changes to
`clone` in its own PR. Licences: `video-kit/worked-examples/voice/OPENVOICE-LICENCE.md` (OpenVoice
V2 and MeloTTS, both MIT, pinned commits).

**Reference recording.** A few minutes of Karl (or a person who has given written consent; Karl
keeps the consent record outside the repository), recorded in a quiet room, as `.m4a` (a phone
voice memo is fine) or `.wav`. It never goes into the repository, a pull request, Slack or GitHub.
To hand it to a Claude Code session, attach the file to a message in that session; it lands in the
session's own upload folder, outside every checkout. The session converts and trims a private copy
outside the repository, uses it for the run, and then deletes the upload, the copy and the cached
embedding; the next clone run needs the file again. Converting by hand (mono 48 kHz WAV, rumble
cut below 70 Hz, silence trimmed at both ends):

```bash
ffmpeg -i in.m4a -ac 1 -ar 48000 -af "highpass=f=70,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.25,areverse" \
  -c:a pcm_s16le ~/lyceon-private/karl.reference.wav
```

Keep it outside every checkout (for example `~/lyceon-private/karl.reference.wav`) and point
`WE_VOICE_REFERENCE` at it. The tooling refuses a path inside the repository or the content
checkout, and `.gitignore` ignores `*.reference.*` and `voice-reference/`. Its tone-colour embedding
is cached in `WE_OPENVOICE_CACHE` (default `~/.cache/lyceon-openvoice`), also outside the repo.

**One-time setup (the batch writer's machine only; CI never installs any of this):**

```bash
python3.11 -m venv ~/.venvs/openvoice && . ~/.venvs/openvoice/bin/activate
pip install torch==2.4.1 torchaudio==2.4.1 --index-url https://download.pytorch.org/whl/cpu
pip install -r scripts/worked-examples/openvoice/requirements.txt
pip install --no-deps -r scripts/worked-examples/openvoice/requirements-git.txt
python -m unidic download
python -c "import nltk; nltk.download('cmudict'); nltk.download('averaged_perceptron_tagger_eng')"
# V2 checkpoints, pinned revision (the README's S3 zip returns 403):
R=f36e7edfe1684461a8343844af60babc2efbb727; D=~/lyceon-private/checkpoints_v2
for f in converter/checkpoint.pth converter/config.json base_speakers/ses/en-us.pth; do
  mkdir -p "$D/$(dirname $f)"; curl -sSfL -o "$D/$f" "https://huggingface.co/myshell-ai/OpenVoiceV2/resolve/$R/$f"
done
```

**Environment for a clone run:** `WE_OPENVOICE_PYTHON=~/.venvs/openvoice/bin/python`,
`WE_OPENVOICE_CHECKPOINTS=~/lyceon-private/checkpoints_v2`, `WE_VOICE_REFERENCE=<the private path>`,
plus `HYPERFRAMES_PYTHON` for the Kokoro fallback and the transcription.

**Comparison (first, before any batch uses the clone):**

```bash
pnpm exec tsx scripts/worked-examples/compare-voices.ts --content <checkout of social> \
  --dir content/worked-examples/2026-W45/SATM2CZS1BE --out ~/lyceon-private/compare
```

By default it renders `af_heart,clone,clone@1.1`: the /brag voice, the clone at its natural pace and
the clone about 10% faster. It writes `we-satm2czs1be-af_heart.mp4`, `we-satm2czs1be-clone.mp4`,
`we-satm2czs1be-clone-1.10x.mp4` and `comparison.md` (length, pace in words per minute and any lines
that fell back). Post the videos to Karl; nothing is committed.

**Speaking rate.** Every profile in `voice.json` has `speaking_rate` (Karl, 2026-10-27): 1.0 is the
engine's natural pace, 1.1 about 10% faster (`hyperframes tts -s` for the /brag voice, MeloTTS
`speed` for the clone). The rate Karl picks goes into the profile in the same PR that makes the
clone the default. A batch records the rate it was voiced at in `voice/manifest.json`; changing the
rate re-voices the whole batch on the next run.

**Voicing a batch in the clone (after Karl picks it):** `voice.ts <example folder> --voice clone`.
Each clone line is transcribed and checked (`scripts/worked-examples/quality.ts`): it must say its
script (character error rate at most `quality.max_character_error_rate` after normalising numbers
and symbols), not clip, and not hold long silences. A line that fails, or that the clone cannot
produce, is spoken again in the /brag voice and recorded in `voice/manifest.json` with
`voice: "af_heart"` and `fallback_reasons`. The content check enforces the same quality rules on
every committed line, in either voice.
