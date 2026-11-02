"""manim-voiceover speech service for Kokoro-82M, through the same `hyperframes tts` the worked
examples use.

@spec [owner brief "Video tools pilot" (Karl, 2026-11-02) Part D2: "a small custom SpeechService
      subclass that calls kokoro-onnx directly, or shells out to `pnpm dlx hyperframes@<voice.json's
      version> tts`, the exact path the worked examples use. Prefer the path that gives the SAME
      audio as the worked examples for af_heart"] | @implemented [2026-11-02]

plain English: manim-voiceover ships no Kokoro service (its built-in services are hosted
speech APIs, pyttsx3 and a recorder), so this is one. It shells out to
`pnpm dlx hyperframes@<version> tts <text> -v <voice> -s <rate> -o <wav>`, the call
scripts/worked-examples/voice.ts makes (kokoroTtsArgs), so af_heart at 1.0 is byte-for-byte the
audio a worked example commits: the end-card line it produces has the same md5 as
video-kit/worked-examples/voice/outro.wav. hyperframes runs Kokoro-82M (kokoro-onnx) in the Python
named by HYPERFRAMES_PYTHON; its model and voices download once to ~/.cache/hyperframes/tts, outside
the repository.

Each line is then transcribed with `hyperframes transcribe --json -m <model>` (the transcriber the
worked examples' quality checks use) and its word times are written beside the audio as
<name>.words.json, for the captions and for scripts/video-pilots/manim/check.ts.

The rate is Kokoro's own `speed` (voice.json's speaking_rate), not manim-voiceover's global_speed,
which would time-stretch the audio with SoX after the fact.

edge cases: a failed tts or transcribe raises with the tool's exit status; the line's text is never
logged. The cache key includes the voice, the rate and the hyperframes version, so changing any of
them re-voices the line.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from manim_voiceover._typing import VoiceoverData
from manim_voiceover.services.base import (
    PathLike,
    SpeechService,
    initialize_speech_service,
    path_to_string,
)


def _hyperframes(version: str, args: list[str], cwd: str, python: str) -> str:
    env = dict(os.environ)
    env.update(
        {
            "HYPERFRAMES_PYTHON": python,
            "HYPERFRAMES_NO_TELEMETRY": "1",
            "DO_NOT_TRACK": "1",
        }
    )
    run = subprocess.run(
        ["pnpm", "dlx", f"hyperframes@{version}", *args],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if run.returncode != 0:
        raise RuntimeError(f"hyperframes {args[0]} exited {run.returncode}")
    return run.stdout


def words_from_transcribe(stdout: str) -> list[dict[str, float | str]]:
    """The words `hyperframes transcribe --json` wrote (its last stdout line names the file)."""
    last = stdout.strip().split("\n")[-1]
    result = json.loads(last)
    path = result.get("transcriptPath") if isinstance(result, dict) else None
    if not isinstance(path, str):
        raise RuntimeError("transcribe did not name a transcript")
    raw = json.loads(Path(path).read_text(encoding="utf8"))
    if not isinstance(raw, list):
        raise RuntimeError("the transcript is not a list of words")
    words: list[dict[str, float | str]] = []
    for w in raw:
        if not (
            isinstance(w, dict)
            and isinstance(w.get("text"), str)
            and isinstance(w.get("start"), (int, float))
            and isinstance(w.get("end"), (int, float))
        ):
            raise RuntimeError("a transcript word lacks text, start or end")
        words.append({"text": w["text"], "start": float(w["start"]), "end": float(w["end"])})
    return words


class KokoroHyperframesService(SpeechService):
    """Kokoro-82M through `hyperframes tts`, with word times from `hyperframes transcribe`."""

    def __init__(
        self,
        voice: str,
        speed: float,
        hyperframes: str,
        transcribe_model: str,
        python: str,
        **kwargs: object,
    ) -> None:
        if shutil.which("pnpm") is None:
            raise RuntimeError("pnpm is not on PATH (hyperframes runs with pnpm dlx)")
        self.voice = voice
        self.speed = speed
        self.hyperframes = hyperframes
        self.transcribe_model = transcribe_model
        self.python = python
        initialize_speech_service(self, kwargs)

    def generate_from_text(
        self,
        text: str,
        cache_dir: PathLike | None = None,
        path: PathLike | None = None,
        **kwargs: object,
    ) -> VoiceoverData:
        if cache_dir is None:
            cache_dir = self.cache_dir
        input_data = {
            "input_text": text,
            "service": "kokoro-hyperframes",
            "voice": self.voice,
            "speed": self.speed,
            "hyperframes": self.hyperframes,
        }
        cached = self.get_cached_result(input_data, cache_dir)
        if cached is not None:
            return cached
        audio_path = (
            self.get_audio_basename(input_data) + ".wav" if path is None else path_to_string(path)
        )
        target = Path(cache_dir) / audio_path
        with tempfile.TemporaryDirectory(prefix="pilot-tts-") as work:
            wav = str(Path(work) / "line.wav")
            _hyperframes(
                self.hyperframes,
                # f"{x:g}" writes 1.0 as "1", as voice.ts's String(speaking_rate) does.
                ["tts", text, "-v", self.voice, "-s", f"{self.speed:g}", "-o", wav],
                work,
                self.python,
            )
            words = words_from_transcribe(
                _hyperframes(
                    self.hyperframes,
                    ["transcribe", wav, "--json", "-m", self.transcribe_model],
                    work,
                    self.python,
                )
            )
            shutil.copyfile(wav, target)
        target.with_suffix(".words.json").write_text(json.dumps(words), encoding="utf8")
        return {"input_text": text, "input_data": input_data, "original_audio": audio_path}
