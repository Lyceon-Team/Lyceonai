"""Video pilot D3: speaks a list of lines with Chatterbox (CPU), one raw WAV per line.

@spec [owner brief "Video tools pilot" (Karl, 2026-11-02) D3: "a one-video Chatterbox pilot on the
      SAME D2 script, rendered alongside the am_michael version for a naturalness comparison";
      chatterbox-tts 0.1.7, MIT code and weights; outputs carry Resemble's PerTh watermark (keep
      it); the default built-in voice (conds.pt), no reference clip; CPU only; render line by line
      and cache; "Lyceon" respelled "Lie-see-on"; raw output peaks near 0 dBFS, so every line MUST
      go through the same loudness step as the worked examples] | @implemented [2026-11-02]

plain English: never run by hand. scripts/video-pilots/voice-lines.ts writes a jobs file (a JSON
list of {"text", "out"}: the text already respelled by spokenBrandName(text, "chatterbox"), and
the raw WAV to write) and runs this with the Python of a venv built from requirements.txt beside
it. The model loads once (device "cpu", the built-in voice), then each line is generated with the
same fixed seed, so the same text gives the same audio, and written as 16-bit mono PCM at the
model's own rate (24 kHz). Chatterbox applies the PerTh watermark inside generate(); nothing here
removes or bypasses it. voice-lines.ts then runs each raw WAV through normaliseLoudness from
scripts/worked-examples/voice.ts, the worked examples' own two-pass loudnorm and limiter.

stdout carries one JSON object per event and nothing else: {"event": "loaded", "seconds"} once,
then {"event": "line", "index", "wall_seconds", "audio_seconds"} per line. The text is never
printed or logged. The weights (about 3.2 GB) download once to ~/.cache/huggingface, outside the
repository.

edge cases: a jobs file that is not a list of {"text", "out"} with non-empty text, or an output
path inside the repository, stops the run before the model loads. Any generation error stops the
run with Python's own traceback (no text in it: chatterbox does not echo its input).
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def inside_repo(path: Path) -> bool:
    try:
        path.resolve().relative_to(ROOT)
    except ValueError:
        return False
    return True


def read_jobs(path: Path) -> list[tuple[str, Path]]:
    raw = json.loads(path.read_text(encoding="utf8"))
    if not isinstance(raw, list) or not raw:
        raise SystemExit("the jobs file must be a non-empty list")
    jobs: list[tuple[str, Path]] = []
    for k, job in enumerate(raw):
        text = job.get("text") if isinstance(job, dict) else None
        out = job.get("out") if isinstance(job, dict) else None
        if not isinstance(text, str) or not text.strip() or not isinstance(out, str):
            raise SystemExit(f"job {k} needs a non-empty text and an out path")
        target = Path(out)
        if inside_repo(target):
            raise SystemExit(f"job {k} writes inside the repository; voiced lines are never committed")
        jobs.append((text, target))
    return jobs


def emit(event: dict[str, object]) -> None:
    print(json.dumps(event), flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", required=True, help='JSON list of {"text", "out"}')
    ap.add_argument("--seed", type=int, default=0, help="the fixed seed every line is generated with")
    a = ap.parse_args()
    jobs = read_jobs(Path(a.jobs))

    import soundfile
    import torch
    from chatterbox.tts import ChatterboxTTS

    started = time.monotonic()
    model = ChatterboxTTS.from_pretrained(device="cpu")
    if model.conds is None:
        raise SystemExit("the built-in voice (conds.pt) did not load")
    emit({"event": "loaded", "seconds": round(time.monotonic() - started, 2)})
    for k, (text, out) in enumerate(jobs):
        torch.manual_seed(a.seed)
        t0 = time.monotonic()
        wav = model.generate(text)
        wall = time.monotonic() - t0
        samples = wav.squeeze(0).numpy()
        # 16-bit PCM cannot hold a sample past full scale; one would be clipped on write. Such a
        # line is scaled down to just under full scale first (a plain gain, which the loudness
        # step that follows resets anyway) and the event says so.
        peak = float(abs(samples).max()) if samples.size else 0.0
        scaled = peak > 0.999
        if scaled:
            samples = samples * (0.999 / peak)
        out.parent.mkdir(parents=True, exist_ok=True)
        soundfile.write(str(out), samples, model.sr, subtype="PCM_16")
        emit(
            {
                "event": "line",
                "index": k,
                "wall_seconds": round(wall, 2),
                "audio_seconds": round(len(samples) / model.sr, 3),
                "raw_peak": round(peak, 4),
                "scaled_to_full_scale": scaled,
            }
        )


if __name__ == "__main__":
    main()
