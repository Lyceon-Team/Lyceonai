"""manim-voiceover speech service that plays lines already voiced by voice-lines.ts.

@spec [Karl's script and voice rulings for every pilot video (2026-11-02, SCL-267): am_michael
      everywhere; "Lyceon" through spokenBrandName(); "Your Kokoro speech service must run every
      line through the SAME function or command #1395 added in voice.ts"; owner brief "Video tools
      pilot" D3 (Chatterbox through the same loudness step)] | @implemented [2026-11-02]

plain English: the voicing is done before Manim starts, by scripts/video-pilots/voice-lines.ts,
which gives each line to the engine (Kokoro am_michael through `hyperframes tts`, or Chatterbox),
normalises it with normaliseLoudness from scripts/worked-examples/voice.ts, transcribes it and runs
the worked examples' quality checks. Doing it in TypeScript is what lets every line go through the
very functions the worked examples use, not a Python copy of them. This service only serves those
lines to manim-voiceover: for each voiceover block it finds the manifest line with the same text
(whitespace collapsed, as manim-voiceover collapses it) and copies its normalised WAV into the
cache folder. A text with no line in the manifest, or two lines with one text, is refused.

edge cases: the line's text is never logged.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

from manim_voiceover._typing import VoiceoverData
from manim_voiceover.services.base import (
    PathLike,
    SpeechService,
    initialize_speech_service,
)


def _norm(text: str) -> str:
    return " ".join(text.split())


class PrevoicedService(SpeechService):
    """Serves the lines of a voice-lines.ts manifest (voice.json) to manim-voiceover."""

    def __init__(self, manifest: str, **kwargs: object) -> None:
        data = json.loads(Path(manifest).read_text(encoding="utf8"))
        self.engine: str = data["engine"]
        self.lines: dict[str, dict] = {}
        for line in data["lines"]:
            key = _norm(line["text"])
            if key in self.lines:
                raise RuntimeError(f"two manifest lines share one text ({line['key']})")
            self.lines[key] = line
        initialize_speech_service(self, kwargs)

    def line_for(self, text: str) -> dict:
        line = self.lines.get(_norm(text))
        if line is None:
            raise RuntimeError("a voiceover line is not in the voice manifest; run voice-lines.ts again")
        return line

    def generate_from_text(
        self,
        text: str,
        cache_dir: PathLike | None = None,
        path: PathLike | None = None,
        **kwargs: object,
    ) -> VoiceoverData:
        line = self.line_for(text)
        target_dir = Path(self.cache_dir if cache_dir is None else cache_dir)
        digest = hashlib.sha256(Path(line["wav"]).read_bytes()).hexdigest()[:12]
        name = f"{self.engine}-{line['key']}-{digest}.wav"
        shutil.copyfile(line["wav"], target_dir / name)
        return {
            "input_text": text,
            "input_data": {"input_text": text, "service": f"prevoiced-{self.engine}"},
            "original_audio": name,
        }
