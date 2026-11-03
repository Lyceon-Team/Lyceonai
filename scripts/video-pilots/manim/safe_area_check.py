"""Video pilot (Manim): proves a rendered video keeps everything inside the TikTok safe area, by
sampling frames.

@spec [owner brief "Video tools pilot" (Karl, 2026-11-02) Part D2: "Check the safe area by sampling
      frames ... otherwise do a frame-sampling check with ffmpeg and report it"; owner brief "Worked
      examples: production system" (Karl, 2026-10-27): safe area x 71..912, y 154..1555]
      | @implemented [2026-11-02]

plain English:
  python scripts/video-pilots/manim/safe_area_check.py <video.mp4> <bundle.json> [--every 0.25]
decodes a frame every --every seconds with ffmpeg (RGB, full 1080×1920), marks every pixel that
differs from the paper colour by more than 40 in any channel as ink, and fails if any ink lies
outside the bundle's safe area. scripts/worked-examples/layout-check.ts does this job for the
HTML kit in a browser; a Manim render has no DOM to measure, so the pixels are the evidence.
Prints one JSON line: frames checked, the union of the ink boxes, and every frame that broke it.
Exits 1 on any breach or if the video is not 1080×1920.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

W, H = 1080, 1920
THRESHOLD = 40


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("bundle")
    ap.add_argument("--every", type=float, default=0.25)
    a = ap.parse_args()
    bundle = json.loads(Path(a.bundle).read_text(encoding="utf8"))
    safe = bundle["safe_area"]
    paper = bundle["colours"]["paper"].lstrip("#")
    paper_rgb = np.array([int(paper[k : k + 2], 16) for k in (0, 2, 4)], dtype=np.int16)
    probe = json.loads(
        subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
             "stream=width,height", "-of", "json", a.video],
            capture_output=True, text=True, check=True,
        ).stdout
    )["streams"][0]
    if (probe["width"], probe["height"]) != (W, H):
        print(json.dumps({"ok": False, "problem": f"video is {probe['width']}x{probe['height']}"}))
        sys.exit(1)
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", a.video, "-vf", f"fps=1/{a.every}",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, check=True,
    ).stdout
    frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, H, W, 3)
    union = [W, H, -1, -1]
    breaches = []
    for k, frame in enumerate(frames):
        ink = (np.abs(frame.astype(np.int16) - paper_rgb) > THRESHOLD).any(axis=2)
        ys, xs = np.nonzero(ink)
        if xs.size == 0:
            continue
        box = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
        union = [min(union[0], box[0]), min(union[1], box[1]), max(union[2], box[2]), max(union[3], box[3])]
        if box[0] < safe["left"] or box[2] > safe["right"] or box[1] < safe["top"] or box[3] > safe["bottom"]:
            breaches.append({"t": round(k * a.every, 2), "ink_box": box})
    result = {
        "ok": not breaches,
        "frames": int(frames.shape[0]),
        "every_seconds": a.every,
        "safe_area": safe,
        "ink_union": {"left": union[0], "top": union[1], "right": union[2], "bottom": union[3]},
        "breaches": breaches,
    }
    print(json.dumps(result))
    sys.exit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
