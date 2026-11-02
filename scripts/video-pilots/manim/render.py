"""Video pilot (Manim): renders the pilot worked example in one Kokoro voice and lays the music
bed under it.

@spec [owner brief "Video tools pilot" (Karl, 2026-11-02) Part D2: Video 3 (1080×1920, 30 fps,
      the current voice; the worked examples' outro line and music, CC BY 4.0, credited) and
      Video 4 (the same script four ways under identical visuals)] | @implemented [2026-11-02]

plain English, from the repository root with the pilot venv's Python (scripts/video-pilots/README.md):
  python scripts/video-pilots/manim/render.py --bundle <work>/bundle.json \
      --voice af_heart --rate 1 --work <work>/af_heart-1 --out <folder>/manim-SATM2BVZSMV.mp4
It converts the kit's fonts (Caveat, Poppins, Inter: WOFF2, which Pango cannot open) to TrueType
in <work>/fonts and points fontconfig there (nothing is installed system-wide), runs `manim render` on scene.py at 1080×1920 and 30 fps with the voice settings in
the environment, then mixes the music bed under the voice with ffmpeg exactly as the worked
examples' composition does: the track at voice.json's music_gain from 0:00, faded to silence over
the last music_fade_seconds. It writes <out> and <out without .mp4>.lines.json (each spoken line's
start, length, audio file and transcription) for check.ts. The voiced lines are cached under
<work>/voice, so a second render in the same voice re-voices nothing.

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
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def inside_repo(path: Path) -> bool:
    try:
        path.resolve().relative_to(ROOT)
    except ValueError:
        return False
    return True


def run(cmd: list[str], env: dict[str, str] | None = None) -> str:
    done = subprocess.run(cmd, env=env, capture_output=True, text=True, check=False)
    if done.returncode != 0:
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
    ap.add_argument("--voice", required=True, help="a Kokoro-82M voice id, e.g. af_heart")
    ap.add_argument("--rate", type=float, default=1.0, help="Kokoro speed (voice.json speaking_rate)")
    ap.add_argument("--work", required=True, help="scratch folder outside the repository")
    ap.add_argument("--out", required=True, help="the .mp4 to write, outside the repository")
    a = ap.parse_args()
    bundle_path, work, out = Path(a.bundle).resolve(), Path(a.work).resolve(), Path(a.out).resolve()
    for p in (work, out):
        if inside_repo(p):
            raise SystemExit(f"{p} is inside the repository; renders are never committed")
    if not 0.5 <= a.rate <= 2:
        raise SystemExit(f"rate {a.rate} is outside 0.5-2")
    bundle = json.loads(bundle_path.read_text(encoding="utf8"))
    work.mkdir(parents=True, exist_ok=True)
    (work / "voice").mkdir(exist_ok=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    kit_fonts(bundle["fonts"], work / "fonts")
    fonts_conf(work / "fonts", work / "fonts.conf")
    log = work / "lines.json"
    env = dict(os.environ)
    env.update(
        {
            "FONTCONFIG_FILE": str(work / "fonts.conf"),
            "LYCEON_PILOT_BUNDLE": str(bundle_path),
            "LYCEON_PILOT_VOICE": a.voice,
            "LYCEON_PILOT_RATE": f"{a.rate:g}",
            "LYCEON_PILOT_PYTHON": sys.executable,
            "LYCEON_PILOT_CACHE": str(work / "voice"),
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
    voiced = next((work / "media" / "videos").rglob(f"{name}.mp4"))
    d = duration_of(voiced)
    music = bundle["music"]
    fade = float(music["fade_seconds"])
    mix = (
        f"[1:a]atrim=0:{d:.3f},asetpts=N/SR/TB,volume={music['gain']},"
        f"afade=t=out:st={max(0.0, d - fade):.3f}:d={fade}[m];"
        "[0:a][m]amix=inputs=2:duration=first:normalize=0[a]"
    )
    run(
        [
            "ffmpeg", "-y", "-v", "error", "-i", str(voiced), "-i", music["file"],
            "-filter_complex", mix, "-map", "0:v", "-map", "[a]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", str(out),
        ]
    )
    shutil.copyfile(log, out.with_suffix(".lines.json"))
    print(json.dumps({"out": str(out), "duration": round(duration_of(out), 3), "credit": music["credit"]}))


if __name__ == "__main__":
    main()
