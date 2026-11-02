# Video pilots

Pilots for Karl's review (owner brief "Video tools pilot", Karl, 2026-11-02, Part D2). Nothing
here is part of the worked-example pipeline, and nothing here posts anything. Renders, voiced lines
and model weights are never committed (`.gitignore` covers a run pointed inside the repository; the
scripts also refuse an output folder inside it).

## Manim + manim-voiceover + Kokoro-82M (`manim/`)

| File | What it does |
|---|---|
| `manim/prepare.ts` | Checks the pilot example (`video-kit/pilots/manim/<id>/example.json`) against its bank question from the seed SQL and the worked-example rules (hook H1-H6, key, "The trap", public-copy lists), then writes `bundle.json` |
| `manim/scene.py` | The Manim scene: hook → question → steps on a graph → answer → trap → end card, word-by-word captions, safe area x 71..912, y 154..1555 |
| `manim/kokoro_service.py` | A manim-voiceover `SpeechService` that shells out to `pnpm dlx hyperframes@<voice.json version> tts`, the worked examples' own path, and transcribes each line with `hyperframes transcribe` |
| `manim/render.py` | Runs Manim at 1080×1920, 30 fps, and lays the worked examples' music bed under the voice with ffmpeg |
| `manim/check.ts` | The worked examples' voice checks (`scripts/worked-examples/quality.ts`, `audio.ts` mix margin, 30-60 s) and the comparison table |
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
* **One drawing per question.** The scene draws this question's circle and refuses any other
  bundle. A new question needs its own figure.
* **CI.** None. A pilot.
