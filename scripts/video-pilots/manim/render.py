"""Video pilot (Manim): voices the pilot in one engine, renders it, and lays the music bed under it.

@spec [owner brief "Video tools pilot" (Karl, 2026-11-02) Part D2, Video 3 (1080×1920, 30 fps; the
      worked examples' outro line and music, CC BY 4.0, credited) and D3 (the same script in
      Chatterbox, rendered alongside the am_michael version); Karl's script and voice rulings for
      every pilot video (2026-11-02, SCL-267): am_michael everywhere, every line through #1395's
      loudness step; SCL-270 (Karl, 2026-11-02): a true-peak limiter (≤ −1 dBTP) on the finished
      mix in every pipeline] | @implemented [2026-11-02, engines and the shared voicing step
      2026-11-02, the finished-mix limiter 2026-11-02]

plain English, from the repository root with the pilot venv's Python (scripts/video-pilots/README.md):
  python scripts/video-pilots/manim/render.py --bundle <work>/bundle.json \
      --engine kokoro --work <work>/kokoro --out <folder>/d2-manim-am_michael.mp4
  python scripts/video-pilots/manim/render.py --bundle <work>/bundle.json \
      --engine chatterbox --chatterbox-python ~/.venvs/lyceon-chatterbox/bin/python \
      --work <work>/chatterbox --out <folder>/d3-chatterbox.mp4
It first runs scripts/video-pilots/voice-lines.ts (pnpm exec tsx), which voices every line in the
engine (Kokoro am_michael through `hyperframes tts`, with HYPERFRAMES_PYTHON set to this venv's
Python, which has kokoro-onnx; or Chatterbox in its own venv), normalises each with the worked
examples' normaliseLoudness, transcribes and quality-checks it, and caches the raw audio under
<work>/voice. A line that fails stops the render. It then converts the kit's fonts (WOFF2, which
Pango cannot open) to TrueType in <work>/fonts and points fontconfig there (nothing is installed
system-wide), runs `manim render` on scene.py at 1080×1920 and 30 fps, and mixes the music bed
under the voice with ffmpeg exactly as the worked examples' composition does: the track at
voice.json's music_gain from 0:00, faded to silence over the last music_fade_seconds, into
<out without .mp4>.mix.mp4. That mix is then limited to a true peak of at most -1 dBTP by the
worked examples' finished-mix limiter (scripts/worked-examples/final-mix.ts, its CLI; SCL-270,
Karl's ruling 2026-11-02) into <out>, and the unlimited mix is deleted. It writes
<out> and <out without .mp4>.lines.json (each spoken line's start, length, normalised audio and
transcription, and every string set on screen) for check.ts, and prints the seconds each stage
took (the Chatterbox lines' own generation times are in <work>/voice/voice.json).

edge cases: refuses an --out or --work inside the repository (renders are never committed);
every subprocess failure stops the run with its exit status. Nothing here logs the script text.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def inside_repo(path: Path) -> bool:
    try:
        path.resolve().relative_to(ROOT)
    except ValueError:
        return False
    return True


def run(cmd: list[str], env: dict[str, str] | None = None, cwd: Path | None = None) -> str:
    done = subprocess.run(cmd, env=env, cwd=cwd, capture_output=True, text=True, check=False)
    if done.returncode != 0:
        sys.stderr.write(done.stdout[-4000:])
        sys.stderr.write(done.stderr[-4000:])
        raise SystemExit(f"{Path(cmd[0]).name} exited {done.returncode}")
    return done.stdout


def kit_fonts(files: list[str], folder: Path) -> None:
    """The kit's WOFF2 fonts as plain TrueType: Pango (HarfBuzz) cannot open WOFF2 itself."""
    from fontTools.ttLib import TTFont

    folder.mkdir(parents=True, exist_ok=True)
    for f in files:
        font = TTFont(f)
        font.flavor = None
        font.save(str(folder / (Path(f).stem + ".ttf")))


def fonts_conf(font_dir: Path, path: Path) -> None:
    dirs = f"  <dir>{font_dir}</dir>"
    path.write_text(
        '<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n'
        f'  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>\n{dirs}\n</fontconfig>\n',
        encoding="utf8",
    )


def duration_of(mp4: Path) -> float:
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(mp4)])
    return float(json.loads(out)["format"]["duration"])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--engine", required=True, choices=["kokoro", "chatterbox"])
    ap.add_argument("--chatterbox-python", help="the Python of the venv from chatterbox/requirements.txt")
    ap.add_argument("--work", required=True, help="scratch folder outside the repository")
    ap.add_argument("--out", required=True, help="the .mp4 to write, outside the repository")
    a = ap.parse_args()
    bundle_path, work, out = Path(a.bundle).resolve(), Path(a.work).resolve(), Path(a.out).resolve()
    for p in (work, out):
        if inside_repo(p):
            raise SystemExit(f"{p} is inside the repository; renders are never committed")
    bundle = json.loads(bundle_path.read_text(encoding="utf8"))
    work.mkdir(parents=True, exist_ok=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    stages: dict[str, float] = {}

    t0 = time.monotonic()
    voice_dir = work / "voice"
    env = dict(os.environ)
    env["HYPERFRAMES_PYTHON"] = sys.executable  # kokoro-onnx lives in this venv
    voicing = [
        "pnpm", "exec", "tsx", str(ROOT / "scripts/video-pilots/voice-lines.ts"),
        "--bundle", str(bundle_path), "--engine", a.engine, "--out", str(voice_dir),
    ]
    if a.chatterbox_python:
        voicing += ["--python", a.chatterbox_python]
    done = subprocess.run(voicing, env=env, cwd=ROOT, check=False)
    if done.returncode != 0:
        raise SystemExit(f"voice-lines.ts exited {done.returncode}")
    stages["voice"] = time.monotonic() - t0

    t0 = time.monotonic()
    (work / "cache").mkdir(exist_ok=True)
    kit_fonts(bundle["fonts"], work / "fonts")
    fonts_conf(work / "fonts", work / "fonts.conf")
    log = work / "lines.json"
    env.update(
        {
            "FONTCONFIG_FILE": str(work / "fonts.conf"),
            "LYCEON_PILOT_BUNDLE": str(bundle_path),
            "LYCEON_PILOT_VOICE": str(voice_dir / "voice.json"),
            "LYCEON_PILOT_CACHE": str(work / "cache"),
            "LYCEON_PILOT_LOG": str(log),
        }
    )
    # Manim caches each Text as an SVG keyed by its text and font name, not by the font file;
    # a stale cache would keep a fallback face, so every render sets its text afresh.
    shutil.rmtree(work / "media", ignore_errors=True)
    name = "voiced"
    run(
        [
            sys.executable, "-m", "manim", "render",
            "-r", "1080,1920", "--fps", "30", "--format", "mp4",
            "--media_dir", str(work / "media"), "-o", name, "--disable_caching",
            str(HERE / "scene.py"), "WorkedExample",
        ],
        env,
    )
    stages["manim"] = time.monotonic() - t0

    t0 = time.monotonic()
    voiced = next((work / "media" / "videos").rglob(f"{name}.mp4"))
    # The voice is taken from Manim's lossless voiced.wav, not decoded back out of voiced.mp4's
    # AAC: re-encoding that AAC put the finished video's true peak at 0.0 dBTP although every
    # line was at most -1 (measured 2026-11-02; from the WAV it stays at -1.0).
    voice_wav = voiced.with_suffix(".wav")
    if not voice_wav.is_file():
        raise SystemExit("manim wrote no voiced.wav beside voiced.mp4")
    d = duration_of(voiced)
    music = bundle["music"]
    fade = float(music["fade_seconds"])
    mix = (
        f"[2:a]atrim=0:{d:.3f},asetpts=N/SR/TB,volume={music['gain']},"
        f"afade=t=out:st={max(0.0, d - fade):.3f}:d={fade}[m];"
        "[1:a][m]amix=inputs=2:duration=first:normalize=0[a]"
    )
    mixed = out.with_suffix(".mix.mp4")
    run(
        [
            "ffmpeg", "-y", "-v", "error", "-i", str(voiced), "-i", str(voice_wav), "-i", music["file"],
            "-filter_complex", mix, "-map", "0:v", "-map", "[a]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", str(mixed),
        ]
    )
    stages["mix"] = time.monotonic() - t0

    # SCL-270 (Karl, 2026-11-02): the finished mix goes through the worked examples' one
    # true-peak limiter (at most -1 dBTP), called as its CLI; its ffmpeg arguments live there only.
    t0 = time.monotonic()
    run(["pnpm", "exec", "tsx", "scripts/worked-examples/final-mix.ts", str(mixed), str(out)], cwd=ROOT)
    mixed.unlink()
    stages["limit"] = time.monotonic() - t0
    shutil.copyfile(log, out.with_suffix(".lines.json"))
    print(json.dumps({
        "out": str(out),
        "duration": round(duration_of(out), 3),
        "engine": a.engine,
        "stage_seconds": {k: round(v, 1) for k, v in stages.items()},
        "credit": music["credit"],
    }))


if __name__ == "__main__":
    main()
