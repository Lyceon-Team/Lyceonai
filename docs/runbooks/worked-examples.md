# Worked examples: runbook

Owner brief: "Worked examples: production system" (Karl, 2026-10-27). Engine: Hyperframes 0.8.143
(Karl's pick, 2026-10-27; Hypit shelved until 1.0). Music: "Happy Beats / Business Moves Vol. 12"
by ende.app, CC BY 4.0, credited in every caption.

**Cadence and tools (Karl's content rulings, 2026-11-02; SCL-264).** Worked examples post Mon/Wed/Fri,
plus more if quality holds; the other days rotate graphing-calculator/trap, product moments,
test-date/myth and parent posts. A starting shape that changes with the data. Hyperframes stays the
core; pilots are Manim with manim-voiceover (math visuals) and Chatterbox (a naturalness comparison
against the Kokoro-82M `am_michael` voice); screen demos are scripted Playwright recordings, not
OpenScreen, whose repository is archived (Karl, 2026-11-02); Remotion (licence), stock-footage
generators, AI video/avatar models and schedulers are rejected for now. Until Desmos replies to the permission request, no example shows the Desmos
interface or logo or says "Desmos" on screen or in a caption (screen recordings included): a graphing
method is drawn in our own rendering (Manim). Posting stays by hand from `#social`.

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
   The script, in spoken order (Karl's rulings 2026-11-02, SCL-267). The screen shows the
   question; the voice talks about it. Write it the way you'd say it: contractions, short
   sentences, "you"/"we", beats like "Okay." or "Go.".

   | spoken | field | what it holds | on screen meanwhile |
   |---|---|---|---|
   | 1 | `hook.voice` | the hook as a question or a challenge to the viewer ("Think you can do this one in ten seconds? Go.") | `hook.line` (bold, from frame 0) and the question card |
   | 2 | `question_voice` | ONE sentence of setup in plain talk: what the question is about. Not a reading of it (the key keeps its old name) | the question card |
   | 3 | `steps[].voice` | the key move and why, one step per line | `steps[].notepad`, written as each line starts |
   | 4 | `trap.voice` | the trap; starts "The trap" | "The trap:" and `trap.notepad` |
   | 5 | `answer.voice` | the answer and a quick check | the steps again, then `answer.notepad`, circled |
   | 6 | the kit's `outro_text` | "Follow, there's one of these every day." | the end card: logo, "Follow for daily SAT questions", "Lyceon SAT Prep" |

   There are no burned-in captions. `signature_move`, `trap.summary`, `check` and `takeaway` are
   not spoken; they go into the database row.
3. Hook rules: no statistics, no claims about students or people, states the puzzle, ends with
   `?` or `…`, never the answer. They apply to the spoken hook too, except "states the puzzle" and
   "ends with ? or …", which apply to the on-screen line only. One exception (Karl's ruling
   2026-11-02, SCL-265): a hook may open with "Most people" ("Most people think it's $64…?");
   everything else about people stays refused, including a second claim later in the same hook.
   Script rules (SCL-267): no spoken line may share a run of 6 or more consecutive words with
   anything on screen (the hook line, the question's passage, stem and options as the seed SQL has
   them, the step notepads, the answer notepad, the trap notepad), compared in lower case without
   punctuation and with numbers as written; and the spoken hook may not be the hook line read
   aloud.
4. Voice it on your machine (never in CI; needs `ffmpeg` for the loudness step):
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
#social in the QOTD's format (SCL-262; for worked examples SCL-265, Karl's ruling 2026-11-02):

1. Any QA warning first ("SAT date list needs updating"), outside the copy blocks.
2. **TikTok**: the video, its comment the platform line, the label ("Worked example · {skill} ·
   {hook_type}") and "For review: posts on <date>. Karl posts by hand."; then ONE caption block and
   a keywords block (one keyword per line, for TikTok's "Manage keywords").
3. **Instagram** (the same video as TikTok, above: not uploaded again): its caption block.
4. **Facebook** (the same video): its caption block.

The captions are the SCL-262 lines with the example's title ("SAT Math worked example ·
Percentages") as the headline. TikTok: headline / "Follow for daily SAT questions 👆 Comment your
answer 👇" / hashtags. Instagram: headline / "Comment your answer 👇" / "Taking the SAT <next test
date>? Comment SAT and I'll send you the link" / hashtags. Facebook: headline / "How would you solve
it? Share your approach below 👇" / hashtags. Hashtags: `#SAT #SATprep #digitalSAT #<Month>SAT
#SATMath`. Every caption ends with the music credit, which the track's CC BY 4.0 licence requires.
Keywords: the test month, `SAT`, `SAT prep`, `Digital SAT`, `College admissions`, `SAT math`, then
the question's canonical domain's. No link, bio line or metadata in any copy block: the TikTok bio
link and the Instagram link to send are set once (`docs/runbooks/qotd-slack.md`); the tagged
`/start` links (`utm_campaign=worked_example`) stay in `post.json` in the run's download. Karl
posts by hand.

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

## Metrics (the private Drive tracker is the record)

Every Monday, Karl's analytics pull (Claude in Chrome, read-only) reads each platform's numbers into
the private Drive tracker; numbers never go in the repository. Judge a video at 72 hours on
retention, saves per 1,000 views and share of views from search; each test carries an experiment
ID (Karl, 2026-11-02; SCL-264).

**The private Drive tracker is the record (Karl, 2026-11-02).** Readings are no longer entered into
`worked_example_metrics`, and its monthly readout (`worked_example_metrics_monthly`) is no longer
run. The table, the view and their migration (`supabase/migrations/20261118000000_worked_examples.sql`)
stay as they are; they are not dropped or altered, but they are not the record.

## The voice (Kokoro `am_michael`), pronunciation and loudness

Since Karl's ruling of 2026-11-02 (SCL-267) every batch is voiced in Kokoro-82M `am_michael`
(`hyperframes tts -v am_michael`), the `default_profile` and the `fallback_profile` in
`video-kit/worked-examples/voice.json`. It replaces the /brag voice `af_heart`, which stays
defined so the W45 batch, voiced in it, still validates. The kit's end-card line
(`video-kit/worked-examples/voice/outro.wav`) is voiced with
`pnpm exec tsx scripts/worked-examples/voice.ts --kit`.

**"Lyceon" is said "lye-see-on"** (/ˈlaɪsiɑn/: LYE, see, ON; stress on the first syllable).
Write "Lyceon" in a script; `spokenBrandName` in `scripts/worked-examples/voice.ts` hands the
engine the respelling "Lysee-ahn" (espeak phonemes lˈaɪsiːˈɑːn). Inline phoneme markup
(misaki's `[Lyceon](/lˈIsiˌɑn/)`) does not work through `hyperframes tts`: it passes text to
kokoro-onnx's espeak phonemizer, which read the markup aloud ("lysian, slash L-stress, ISI…",
tested 2026-11-02). Unrespelled, "Lyceon" phonemizes as lˈaɪsɪən and was heard as "Lycian".
The transcriber hears the respelling as "Lycion"; `transcript_aliases` maps "lycian", "lycion"
and "lysian" back to "lyceon" for the quality check.

**Loudness.** Every voiced line is normalised before it is transcribed and checked: two-pass ffmpeg
`loudnorm` to about -14 LUFS integrated with true peak at most -1 dBTP (`loudness` in
`voice.json`), each line padded to 3.5 s for the pass and trimmed back so short lines can be
raised too, then `alimiter` 0.5 dB under the ceiling. The committed WAV is the normalised one, so
no line reaches the clipping check's `max_peak_dbfs` (-0.1).

## The cloned voice (OpenVoice addendum, Karl, 2026-10-27)

The clone is not the default until Karl picks it after the comparison below; then
`default_profile` in `video-kit/worked-examples/voice.json` changes to `clone` in its own PR. Until
then the default and the fallback are `am_michael` (Karl's ruling 2026-11-02, SCL-267; before it,
the /brag voice `af_heart`). Licences: `video-kit/worked-examples/voice/OPENVOICE-LICENCE.md` (OpenVoice
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
plus `HYPERFRAMES_PYTHON` for the Kokoro fallback (`am_michael`) and the transcription.

**Comparison (first, before any batch uses the clone):**

```bash
pnpm exec tsx scripts/worked-examples/compare-voices.ts --content <checkout of social> \
  --dir content/worked-examples/2026-W45/SATM2CZS1BE --out ~/lyceon-private/compare
```

By default it renders `am_michael,clone,clone@1.1` (the fallback voice first): `am_michael`, the clone
at its natural pace and the clone about 10% faster. It writes `we-satm2czs1be-am_michael.mp4`, `we-satm2czs1be-clone.mp4`,
`we-satm2czs1be-clone-1.10x.mp4` and `comparison.md` (length, pace in words per minute and any lines
that fell back). Post the videos to Karl; nothing is committed.

**Speaking rate.** Every profile in `voice.json` has `speaking_rate` (Karl, 2026-10-27): 1.0 is the
engine's natural pace, 1.1 about 10% faster (`hyperframes tts -s` for the Kokoro voices, MeloTTS
`speed` for the clone). The rate Karl picks goes into the profile in the same PR that makes the
clone the default. A batch records the rate it was voiced at in `voice/manifest.json`; changing the
rate re-voices the whole batch on the next run.

**Voicing a batch in the clone (after Karl picks it):** `voice.ts <example folder> --voice clone`.
Each clone line is transcribed and checked (`scripts/worked-examples/quality.ts`): it must say its
script (character error rate at most `quality.max_character_error_rate` after normalising numbers
and symbols), not clip, and not hold long silences. A line that fails, or that the clone cannot
produce, is spoken again in the fallback voice (`am_michael`) and recorded in `voice/manifest.json`
with `voice: "am_michael"` and `fallback_reasons`. The content check enforces the same quality rules on
every committed line, in either voice.
