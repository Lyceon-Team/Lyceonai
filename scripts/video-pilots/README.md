# Video pilots

Pilots for Karl's review (owner brief "Video tools pilot", Karl, 2026-11-02, Parts D1, D2 and D3).
Nothing here is part of the worked-example pipeline, and nothing here posts anything. Renders,
voiced lines and model weights are never committed (`.gitignore` covers a run pointed inside the
repository; the scripts also refuse an output folder inside it).

## The script and voice rules (Karl, 2026-11-02, every pilot video)

* **No burned-in captions.** The handwriting and the figure carry the content.
* **The voice never reads the screen.** Rules S1 (no six consecutive on-screen words spoken) and
  S2 (the spoken hook is not the hook line) from `shared/worked-examples/rules.ts`: `prepare.ts`
  refuses an example that breaks them, and `check.ts` runs S1 again on the rendered video against
  every string the scene actually drew.
* **Flow:** a spoken hook that challenges the viewer → one plain-talk sentence of setup → the key
  move and why → the trap ("Now here's where people slip…", `TRAP_VOICE_OPENING`) → the answer
  and a quick check → "Follow, there's one of these every day." The end card shows "Lyceon SAT
  Prep" (read from the kit's own end-card template). No lyceon.ai, spoken or shown.
* **Tone:** contractions, short sentences, "you/we", natural beats ("Okay.", "Go.").
* **Voice:** Kokoro `am_michael` (voice.json's default profile). "Lyceon" goes to every engine
  through `spokenBrandName(text, engine)` in `scripts/worked-examples/voice.ts`, one table.
* **Loudness:** every line, in every engine, goes through `normaliseLoudness` in
  `scripts/worked-examples/voice.ts` (two-pass loudnorm to about −14 LUFS, true peak ≤ −1 dBTP,
  then the limiter), the function the worked examples run on every committed line. The finished
  mix (voice and music bed together) then goes through the worked examples' finished-mix limiter,
  `scripts/worked-examples/final-mix.ts`: true peak at most −1 dBTP (SCL-270, Karl, 2026-11-02).

## Files

| File | What it does |
|---|---|
| `manim/prepare.ts` | Checks the pilot example (`video-kit/pilots/manim/<id>/example.json`) against its bank question from the seed SQL and the worked-example rules (hook H1-H6, key, trap opening, S1, S2, public-copy lists), then writes `bundle.json` (script in spoken order, end card, kit settings) |
| `voice-lines.ts` | Voices every line in one engine (`kokoro` or `chatterbox`): brand respelling, the engine, `normaliseLoudness`, `hyperframes transcribe`, `quality.ts`. Caches raw audio by engine settings and text; writes `voice.json`. `--say "<text>"` voices one line and prints what the transcriber heard (the brand check) |
| `chatterbox/speak_lines.py` | D3: Chatterbox on CPU, the built-in voice, one fixed seed, one raw WAV per line (its PerTh watermark kept) |
| `chatterbox/requirements.txt` | D3: every package of the Chatterbox venv, pinned, transitive ones included (torch CPU builds) |
| `manim/prevoiced_service.py` | The manim-voiceover speech service: plays the lines `voice-lines.ts` voiced |
| `manim/scene.py` | The shared scene: voice, open card, recap, notepad, end card, log; no captions; safe area x 71..912, y 154..1555. It calls `pilots/<question id>.py` |
| `manim/pilots/<id>.py` | One module per question: its figure and its choreography in the spoken order (hook, setup, steps, trap, answer and check, end card) |
| `manim/layout.py`, `manim/graph.py` | Shared layout helpers (and `ON_SCREEN`, every string drawn); the D1 graph panel and the video-clock stopwatch |
| `manim/word-guard.ts` | D1: refuses the third-party calculator's name in pilot sources, spoken lines and anything drawn |
| `manim/render.py` | Runs `voice-lines.ts`, then Manim at 1080×1920, 30 fps, then lays the worked examples' music bed under the voice with ffmpeg, then limits the finished mix to ≤ −1 dBTP true peak with `scripts/worked-examples/final-mix.ts` (its CLI) |
| `manim/check.ts` | Every video: 1080×1920, 30 fps, audio, 30-60 s, every line through `quality.ts`, the voice-over-music margin, S1 on what was drawn, the finished mix at most −1 dBTP true peak (`final-mix.ts` `finishedMixProblems`); prints loudness (LUFS, true peak). Exit 1 on any failure |
| `manim/safe_area_check.py` | Samples frames and fails if any ink leaves the safe area |
| `manim/requirements.txt` | The Manim venv: every Python package, pinned, transitive ones included |

## Setup (once)

System packages (Debian/Ubuntu names): Python 3.11+, `ffmpeg`, `pkg-config`, `libcairo2-dev`,
`libpango1.0-dev` (ManimPango has no Linux wheel and builds against Pango), plus Node and pnpm
for the TypeScript steps and `hyperframes`. No LaTeX: every label is Pango text.

```bash
python3.11 -m venv ~/.venvs/lyceon-video-pilots       # outside the repository
~/.venvs/lyceon-video-pilots/bin/python -m pip install -r scripts/video-pilots/manim/requirements.txt
```

The first voiced line downloads the Kokoro-82M model and voices (about 350 MB) to
`~/.cache/hyperframes/tts`, and the transcriber to `~/.cache/hyperframes/whisper`. Both stay outside
the repository. Nothing is added to `package.json` or the lockfile: hyperframes runs through
`pnpm dlx` at the version `video-kit/worked-examples/voice.json` pins.

### Chatterbox (D3), CPU only

```bash
python3.11 -m venv ~/.venvs/lyceon-chatterbox          # its own venv, outside the repository
~/.venvs/lyceon-chatterbox/bin/python -m pip install -r scripts/video-pilots/chatterbox/requirements.txt
```

* chatterbox-tts 0.1.7, MIT code and weights. Every line carries Resemble's PerTh watermark,
  applied inside `generate()`; nothing here removes it. It survives the loudness step: PerTh's
  own detector reads 1.0 on a raw line and on the same line normalised (and 0.0 on a Kokoro line),
  measured 2026-11-02.
* With the weights cached, `HF_HUB_OFFLINE=1` skips the Hub check on every model load.
* The default built-in voice (`conds.pt`); no reference recording is used or needed.
* The first run downloads the weights (about 3.2 GB) to `~/.cache/huggingface`, outside the
  repository.
* **Slow on CPU:** 12-38× slower than real time under load, plus up to a minute to load the
  model. The D3 script (nine lines, 38.6 s of speech) took 1,625 s of generation on 4 CPU cores
  shared with a build (5-200× real time per line; 5× alone), about 30 minutes in all. `voice-lines.ts` renders line by line and caches each
  raw line under `<work>/voice/raw`, so a re-render, or an edit to one line, re-voices only what
  changed.
* "Lyceon" is given to it as "Lie-see-on" (`BRAND_RESPELLINGS.chatterbox`): it says the plain
  spelling as "Lycian".
* Its raw output peaks near 0 dBFS; like every engine's, each line goes through
  `normaliseLoudness` before it is transcribed, checked or played.

## Render

```bash
OUT=~/video-pilots-out                                  # any folder outside the repository
PY=~/.venvs/lyceon-video-pilots/bin/python
pnpm exec tsx scripts/video-pilots/manim/prepare.ts \
  --example video-kit/pilots/manim/SATM2BVZSMV/example.json --out $OUT/build

# D2: am_michael
$PY scripts/video-pilots/manim/render.py --bundle $OUT/build/bundle.json \
  --engine kokoro --work $OUT/build/kokoro --out $OUT/d2-manim-am_michael.mp4

# D3: the same script and visuals in Chatterbox
$PY scripts/video-pilots/manim/render.py --bundle $OUT/build/bundle.json \
  --engine chatterbox --chatterbox-python ~/.venvs/lyceon-chatterbox/bin/python \
  --work $OUT/build/chatterbox --out $OUT/d3-chatterbox.mp4

# Checks
$PY scripts/video-pilots/manim/safe_area_check.py $OUT/d2-manim-am_michael.mp4 $OUT/build/bundle.json
$PY scripts/video-pilots/manim/safe_area_check.py $OUT/d3-chatterbox.mp4 $OUT/build/bundle.json
pnpm exec tsx scripts/video-pilots/manim/check.ts \
  --video "D2 am_michael=$OUT/d2-manim-am_michael.mp4" --video "D3 chatterbox=$OUT/d3-chatterbox.mp4"

# The brand line in each engine: what the transcriber hears
HYPERFRAMES_PYTHON=$PY pnpm exec tsx scripts/video-pilots/voice-lines.ts --say "Lyceon SAT Prep." \
  --engine kokoro --out $OUT/brand-kokoro
HYPERFRAMES_PYTHON=$PY pnpm exec tsx scripts/video-pilots/voice-lines.ts --say "Lyceon SAT Prep." \
  --engine chatterbox --python ~/.venvs/lyceon-chatterbox/bin/python --out $OUT/brand-chatterbox
```

`render.py` sets `HYPERFRAMES_PYTHON` to the Manim venv's Python, so hyperframes runs Kokoro there
and transcribes there for both engines.

### D1: graphing pilots

```bash
for Q in SATM2PW20AL SATM2XXVNK7; do
  pnpm exec tsx scripts/video-pilots/manim/prepare.ts \
    --example video-kit/pilots/manim/$Q/example.json --out $OUT/build-$Q
done
$PY scripts/video-pilots/manim/render.py --bundle $OUT/build-SATM2PW20AL/bundle.json --engine kokoro \
  --work $OUT/build-SATM2PW20AL/kokoro --out $OUT/d1-graphing-only.mp4
$PY scripts/video-pilots/manim/render.py --bundle $OUT/build-SATM2XXVNK7/bundle.json --engine kokoro \
  --work $OUT/build-SATM2XXVNK7/kokoro --out $OUT/d1-graphing-vs-hand.mp4
$PY scripts/video-pilots/manim/safe_area_check.py $OUT/d1-graphing-only.mp4 $OUT/build-SATM2PW20AL/bundle.json
$PY scripts/video-pilots/manim/safe_area_check.py $OUT/d1-graphing-vs-hand.mp4 $OUT/build-SATM2XXVNK7/bundle.json
pnpm exec tsx scripts/video-pilots/manim/check.ts \
  --video "D1 graphing only=$OUT/d1-graphing-only.mp4" \
  --video "D1 by hand vs graphing=$OUT/d1-graphing-vs-hand.mp4"
```

## Notes

* **Fonts.** The kit's fonts are WOFF2, which Pango cannot open; `render.py` converts them to
  TrueType in the work folder (fontTools) and points fontconfig there. Nothing is installed.
* **Music.** The worked examples' track, `video-kit/worked-examples/music/`, at `music_gain` and
  faded over the last `music_fade_seconds`. Credit wherever the video is shared:
  Music: "Happy Beats / Business Moves Vol. 12" by ende.app, CC BY 4.0.
* **Loudness of the finished video.** `render.py` limits the finished mix with the worked
  examples' one limiter (`final-mix.ts`, its CLI; nothing copies its ffmpeg arguments), and
  `check.ts` fails a video whose true peak is above −1 dBTP (SCL-270). It reports the whole
  video's integrated loudness alongside (the voice lines' normalised level with the music bed
  under them and the pauses between lines).
* **One module per question.** `scene.py` loads `pilots/<question id>.py` and refuses a bundle
  with no module there. A new question needs its own module (its figure and choreography); the
  open card, recap, end card, voice and log are shared.
* **No third-party calculator.** By the owner's ruling of 2026-11-02 the graphs are drawn here in
  Manim and called "the graphing method" or "graphing calculator"; no product's interface, logo or
  screenshot is shown and its name is never on screen or spoken. `word-guard.ts` enforces the name
  in three places (prepare, check, the test suite).
* **Stopwatches are honest by construction.** `graph.py`'s `Stopwatch` reads the scene's own
  clock, so each readout is the length of its segment in the video (from its first step's voice
  to the end of its last), not a real-world solve time; re-voicing re-measures them. The log
  records each start, stop and shown value, and `check.ts` fails a readout that is not the floored
  tenths of stop − start.
* **CI.** `tests/ci/video-pilots.test.ts` runs every committed pilot script through the rules
  (S1 and S2 included), the calculator-name guard over the pilot sources, and proves check.ts's
  format, S1, word-guard, timer and true-peak checks (the last on a real ffmpeg video, skipped
  without ffmpeg); rendering is never run in CI.
