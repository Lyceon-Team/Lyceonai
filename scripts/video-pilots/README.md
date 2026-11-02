# Video pilots

Pilots for Karl's review (owner brief "Video tools pilot", Karl, 2026-11-02, Part D2). Nothing
here is part of the worked-example pipeline, and nothing here posts anything. Renders, voiced lines
and model weights are never committed (`.gitignore` covers a run pointed inside the repository; the
scripts also refuse an output folder inside it).

## Manim + manim-voiceover + Kokoro-82M (`manim/`)

| File | What it does |
|---|---|
| `manim/prepare.ts` | Checks the pilot example (`video-kit/pilots/manim/<id>/example.json`) against its bank question from the seed SQL and the worked-example rules (hook H1-H6, key, "The trap", public-copy lists), then writes `bundle.json` |
| `manim/scene.py` | The shared Manim scene: voice, open card (hook, question, choices), recap, every spoken line, word-by-word captions, end card and log, safe area x 71..912, y 154..1555. It calls `pilots/<question id>.py` for what is drawn in between |
| `manim/pilots/<id>.py` | One module per question, `run(scene)`: its figure and choreography. `SATM2BVZSMV` (D2, the circle), `SATM2PW20AL` (D1 Video 1, graphing only), `SATM2XXVNK7` (D1 Video 2, by hand vs graphing, with stopwatches) |
| `manim/layout.py` | Pixel layout and Pango text helpers shared by the scene and the modules; records every string set on screen for the log |
| `manim/graph.py` | `GraphPanel` (a square-grid graph we draw ourselves: functions, points, read-off guides) and `Stopwatch` (runs on the video's own clock) |
| `manim/word-guard.ts` | The calculator-name guard (owner ruling 2026-11-02): prepare.ts refuses, check.ts fails, and `tests/ci/video-pilots.test.ts` scans every committed pilot source |
| `manim/kokoro_service.py` | A manim-voiceover `SpeechService` that shells out to `pnpm dlx hyperframes@<voice.json version> tts`, the worked examples' own path, and transcribes each line with `hyperframes transcribe` |
| `manim/render.py` | Runs Manim at 1080×1920, 30 fps, and lays the worked examples' music bed under the voice with ffmpeg |
| `manim/check.ts` | The worked examples' voice checks (`scripts/worked-examples/quality.ts`, `audio.ts` mix margin, 30-60 s), the comparison table, the calculator-name guard over every spoken and on-screen line (exit 1 on a hit) and the stopwatch readouts |
| `manim/safe_area_check.py` | Samples frames and fails if any ink leaves the safe area |
| `manim/requirements.txt` | Every Python package, pinned, transitive ones included |

### Setup (once)

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

### Render

```bash
OUT=~/video-pilots-out                                  # any folder outside the repository
PY=~/.venvs/lyceon-video-pilots/bin/python
pnpm exec tsx scripts/video-pilots/manim/prepare.ts \
  --example video-kit/pilots/manim/SATM2BVZSMV/example.json --out $OUT/build

# Video 3: the current voice (af_heart at 1.0)
$PY scripts/video-pilots/manim/render.py --bundle $OUT/build/bundle.json \
  --voice af_heart --rate 1 --work $OUT/build/af_heart-1 --out $OUT/manim-SATM2BVZSMV.mp4

# Video 4: the same script and visuals in four voices
$PY scripts/video-pilots/manim/render.py --bundle $OUT/build/bundle.json --voice af_heart   --rate 1   --work $OUT/build/af_heart-1   --out $OUT/voice-compare-af_heart.mp4
$PY scripts/video-pilots/manim/render.py --bundle $OUT/build/bundle.json --voice af_heart   --rate 1.1 --work $OUT/build/af_heart-1.1 --out $OUT/voice-compare-af_heart-1.1x.mp4
$PY scripts/video-pilots/manim/render.py --bundle $OUT/build/bundle.json --voice af_bella   --rate 1   --work $OUT/build/af_bella-1   --out $OUT/voice-compare-af_bella.mp4
$PY scripts/video-pilots/manim/render.py --bundle $OUT/build/bundle.json --voice am_michael --rate 1   --work $OUT/build/am_michael-1 --out $OUT/voice-compare-am_michael.mp4

# Checks
$PY scripts/video-pilots/manim/safe_area_check.py $OUT/manim-SATM2BVZSMV.mp4 $OUT/build/bundle.json
pnpm exec tsx scripts/video-pilots/manim/check.ts \
  --video "af_heart 1.0 (current)=$OUT/voice-compare-af_heart.mp4" \
  --video "af_heart 1.1=$OUT/voice-compare-af_heart-1.1x.mp4" \
  --video "af_bella 1.0=$OUT/voice-compare-af_bella.mp4" \
  --video "am_michael 1.0=$OUT/voice-compare-am_michael.mp4"
```

`render.py` sets `HYPERFRAMES_PYTHON` to the venv's own Python, so hyperframes runs Kokoro there.

### D1: graphing pilots

```bash
for Q in SATM2PW20AL SATM2XXVNK7; do
  pnpm exec tsx scripts/video-pilots/manim/prepare.ts \
    --example video-kit/pilots/manim/$Q/example.json --out $OUT/build-$Q
done
$PY scripts/video-pilots/manim/render.py --bundle $OUT/build-SATM2PW20AL/bundle.json --voice af_heart --rate 1 \
  --work $OUT/build-SATM2PW20AL/af_heart-1 --out $OUT/graphing-only-SATM2PW20AL.mp4
$PY scripts/video-pilots/manim/render.py --bundle $OUT/build-SATM2XXVNK7/bundle.json --voice af_heart --rate 1 \
  --work $OUT/build-SATM2XXVNK7/af_heart-1 --out $OUT/graphing-vs-hand-SATM2XXVNK7.mp4
$PY scripts/video-pilots/manim/safe_area_check.py $OUT/graphing-only-SATM2PW20AL.mp4 $OUT/build-SATM2PW20AL/bundle.json
$PY scripts/video-pilots/manim/safe_area_check.py $OUT/graphing-vs-hand-SATM2XXVNK7.mp4 $OUT/build-SATM2XXVNK7/bundle.json
pnpm exec tsx scripts/video-pilots/manim/check.ts \
  --video "Video 1 graphing only (af_heart 1.0)=$OUT/graphing-only-SATM2PW20AL.mp4" \
  --video "Video 2 by hand vs graphing (af_heart 1.0)=$OUT/graphing-vs-hand-SATM2XXVNK7.mp4"
```

### Notes

* **The "current voice" is already Kokoro-82M.** `voice.json`'s `af_heart` runs Kokoro-82M through
  `hyperframes tts`, so the voice comparison is between Kokoro voices and rates, not between
  Kokoro and something else. The speech service calls the same command with the same arguments as
  `scripts/worked-examples/voice.ts`, so af_heart at 1.0 is the worked examples' audio byte for byte
  (the end-card line it produces has the md5 of `video-kit/worked-examples/voice/outro.wav`).
* **Fonts.** The kit's fonts are WOFF2, which Pango cannot open; `render.py` converts them to
  TrueType in the work folder (fontTools) and points fontconfig there. Nothing is installed.
* **Music.** The worked examples' track, `video-kit/worked-examples/music/`, at `music_gain` and
  faded over the last `music_fade_seconds`. Credit wherever the video is shared:
  Music: "Happy Beats / Business Moves Vol. 12" by ende.app, CC BY 4.0.
* **One module per question.** `scene.py` loads `pilots/<question id>.py` and refuses a bundle
  with no module there. A new question needs its own module (its figure and choreography); the
  open card, recap, captions, end card, voice and log are shared. The split left D2 unchanged:
  re-rendered from the same voiced lines, its audio has the same md5 and its frames match the
  pre-split render to within Manim's own run-to-run noise (a few anti-aliased pixels).
* **No third-party calculator.** By the owner's ruling of 2026-11-02 the graphs are drawn here in
  Manim and called "the graphing method" or "graphing calculator"; no product's interface, logo or
  screenshot is shown and its name is never on screen, in a caption or spoken. `word-guard.ts`
  enforces the name in three places (prepare, check, the test suite).
* **Stopwatches are honest by construction.** `graph.py`'s `Stopwatch` reads the scene's own
  clock, so each readout is the length of its segment in the video (from its first step's voice
  to the end of its last), not a real-world solve time. The log records each start, stop and
  shown value, and `check.ts` fails a readout that is not the floored tenths of stop − start.
* **CI.** Only `tests/ci/video-pilots.test.ts` (the calculator-name guard over the committed
  pilot sources, and the D1 examples against the worked-example rules). Nothing renders in CI.
