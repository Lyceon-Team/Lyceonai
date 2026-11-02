"""Video pilot (Manim): the shared worked-example scene, 1080×1920 at 30 fps, voiced line by line.

@spec [owner brief "Video tools pilot" (Karl, 2026-11-02) Part D2, Video 3, D3 (the same D2 script
      voiced with Chatterbox) and Part D1 ("reuse and extend this tooling; don't fork a second
      render path ... generalise it so each pilot is a small scene module or a per-question config,
      keeping the D2 video reproducible"); Karl's script and voice rulings for every pilot video
      (2026-11-02, SCL-267): 1 "No burned-in word-by-word captions ... the on-screen handwriting and
      graphs carry the content"; 3 the flow hook → setup → key move → trap → answer and quick check
      → "Follow, there's one of these every day.", the end card shows "Lyceon SAT Prep", no
      lyceon.ai spoken or shown; owner brief "Worked examples: production system" (Karl,
      2026-10-27): blank paper, Caveat, Lyceon colours, TikTok safe area x 71..912, y 154..1555;
      Public Disclosure Doctrine §0 rules 1-2] | @implemented [2026-11-02, split into the shared
      scene and pilots/<question id>.py 2026-11-02 (D1), captions removed and re-ordered to the
      SCL-267 flow 2026-11-02]

plain English: rendered by scripts/video-pilots/manim/render.py, which sets the environment this
file reads (manim's command line cannot pass arguments to a scene):
  LYCEON_PILOT_BUNDLE  bundle.json from prepare.ts (question, script, end card, kit settings)
  LYCEON_PILOT_VOICE   voice.json from voice-lines.ts (every line voiced, normalised, checked)
  LYCEON_PILOT_CACHE   manim-voiceover's working folder (outside the repository)
  LYCEON_PILOT_LOG     where the placed lines, stopwatches and on-screen strings go for check.ts
This file is everything the pilots share: the voice, the open card (hook, question, choices), the
recap, every spoken line as a manim-voiceover block back to back with the kit's gap (so the picture
is timed by the voice exactly as the worked examples are), the end card and the log. What is drawn
between the open card and the end card belongs to the question, so it lives in
pilots/<question id>.py, whose run(scene) the scene calls in the spoken order (hook, setup, steps,
trap, answer and check, then scene.outro()); a bundle for a question with no module there is
refused rather than drawn with the wrong figure. Nothing on screen is typed here: the hook,
question, choices, key, notepad lines, trap and end card all come from the bundle.

trade-offs: no captions, by ruling, so the notepad and the figure carry the content. Text is set
with Pango, which cannot fit-to-width the way the HTML kit's fit script does, so long lines are
wrapped or scaled to the safe column here and safe_area_check.py proves the result on sampled
frames. The open card and the recap fall back to one choice per row only when a choice is too
wide for the two-column grid. layout.py's ON_SCREEN records every string set on screen, which the
log carries for check.ts (S1 on what was drawn, and the calculator-name guard).
"""

from __future__ import annotations

import importlib
import json
import os
import re
import sys
from collections.abc import Callable
from pathlib import Path

from manim import (
    BOLD,
    DOWN,
    LEFT,
    FadeIn,
    FadeOut,
    ImageMobject,
    RoundedRectangle,
    Text,
    VGroup,
    config,
)
from manim_voiceover import VoiceoverScene

sys.path.insert(0, str(Path(__file__).resolve().parent))
from layout import ON_SCREEN, at, fit_width, paragraph, px, text, wrap  # noqa: E402
from prevoiced_service import PrevoicedService  # noqa: E402

config.frame_height = 16.0
config.frame_width = 9.0


def pilot_module(question_id: str):
    """pilots/<question id>.py, the question's own drawing; refuses an id with no module."""
    if not re.fullmatch(r"SAT(M|RW)[12][A-Z0-9]{6}", question_id):
        raise RuntimeError(f"{question_id!r} is not a question id")
    if not (Path(__file__).resolve().parent / "pilots" / f"{question_id}.py").is_file():
        raise RuntimeError(f"no pilots/{question_id}.py: a new question needs its own drawing")
    return importlib.import_module(f"pilots.{question_id}")


class WorkedExample(VoiceoverScene):
    def construct(self) -> None:
        b = json.loads(Path(os.environ["LYCEON_PILOT_BUNDLE"]).read_text(encoding="utf8"))
        module = pilot_module(b["question"]["id"])
        self.b = b
        c = b["colours"]
        self.ink, self.red, self.paper = c["ink"], c["red"], c["paper"]
        self.camera.background_color = self.paper
        safe = b["safe_area"]
        self.left, self.right = safe["left"], safe["right"]
        self.width_px = self.right - self.left
        self.voice = PrevoicedService(
            manifest=os.environ["LYCEON_PILOT_VOICE"], cache_dir=os.environ["LYCEON_PILOT_CACHE"]
        )
        self.set_speech_service(self.voice, create_subcaption=False)
        self.placed: list[dict] = []
        self.timers: list[dict] = []
        self.lines = {line["key"]: line["text"] for line in b["lines"]}
        self.keys = [line["key"] for line in b["lines"]]

        module.run(self)

        self.wait(b["end_hold_seconds"])
        self.write_log()

    # The open: hook and question on screen from frame 0.
    def open_card(self) -> tuple[VGroup, VGroup, VGroup]:
        q = self.b["question"]
        hook = paragraph(
            wrap(self.b["hook_line"], "Poppins", 64, self.ink, self.width_px, BOLD), self.left, 180, 74
        )
        # 410 up to a three-line hook (D2, unchanged); a longer hook gets a wider gap above the stem.
        stem_top = max(410, 180 + 74 * len(hook) + (8 if len(hook) <= 3 else 26))
        stem = paragraph(wrap(q["stem"], "Inter", 42, self.ink, self.width_px), self.left, stem_top, 59)
        opts_top = stem_top + 59 * len(stem) + 30
        box_w, box_h, gap = (self.width_px - 18) / 2, 84, 18
        labels = [text(f"{o['key']})  {o['text']}", "Inter", 42, self.ink) for o in q["options"]]
        cols = 2 if all(lb.width <= px(box_w - 4 - 44) for lb in labels) else 1
        if cols == 1:
            box_w = self.width_px
        opts = VGroup()
        for k, label in enumerate(labels):
            x0 = self.left + (k % cols) * (box_w + gap)
            y0 = opts_top + (k // cols) * (box_h + gap)
            box = RoundedRectangle(
                corner_radius=px(16), width=px(box_w - 4), height=px(box_h),  # stroke inside the column
                stroke_color=self.ink, stroke_opacity=0.22, stroke_width=3,
            ).move_to(at(x0 + box_w / 2, y0 + box_h / 2))
            label.move_to(box).align_to(at(x0 + 22, 0), LEFT)
            opts.add(VGroup(box, label))
        self.add(hook, stem, opts)
        return hook, stem, opts

    # The question, small and dimmed, at the top of the working screen. Returns it and its bottom.
    def recap(self) -> tuple[VGroup, float]:
        q = self.b["question"]
        recap_stem = paragraph(wrap(q["stem"], "Inter", 32, self.ink, self.width_px), self.left, 175, 43)
        parts = [f"{o['key']}) {o['text']}" for o in q["options"]]
        rows = ["   ·   ".join(parts)]
        if text(rows[0], "Inter", 32, self.ink).width > px(self.width_px):
            rows = ["   ·   ".join(parts[k : k + 2]) for k in range(0, len(parts), 2)]
        top = 175 + 43 * len(recap_stem) + 6
        recap_opts = VGroup()
        for k, row in enumerate(rows):
            t = text(row, "Inter", 32, self.ink)
            fit_width(t, self.width_px)
            recap_opts.add(t.next_to(at(self.left, top + 43 * k), DOWN, buff=0).align_to(at(self.left, 0), LEFT))
        recap = VGroup(recap_stem, recap_opts).set_opacity(0.72)
        return recap, top + 43 * len(rows)

    # A Caveat notepad line, left at x 90, its top at `top` pixels.
    def notepad_at(self, top: float, s: str, color: str | None = None, size: float = 70) -> Text:
        t = text(s, "Caveat", size, color or self.ink, BOLD)
        fit_width(t, self.width_px - 20)
        return t.next_to(at(90, top), DOWN, buff=0).align_to(at(90, 0), LEFT)

    # End card: logo, "Follow for daily SAT questions", "Lyceon SAT Prep", over the call to action.
    def outro(self) -> None:
        card = self.b["end_card"]
        logo = ImageMobject(str(Path(self.b["logo"])))
        logo.height = px(280)
        follow = fit_width(text(card["follow"], "Caveat", 80, self.ink, BOLD), self.width_px)
        brand = fit_width(text(card["brand"], "Poppins", 76, self.ink, BOLD), self.width_px)
        centre_x = (self.left + self.right) / 2
        logo.move_to(at(centre_x, 551 + 140))
        follow.next_to(logo, DOWN, buff=px(34)).set_x(at(centre_x, 0)[0])
        brand.next_to(follow, DOWN, buff=px(34)).set_x(at(centre_x, 0)[0])
        on_screen = list(self.mobjects)

        def fade(d: float) -> None:
            self.play(*[FadeOut(m) for m in on_screen], run_time=0.3)
            self.play(FadeIn(logo), FadeIn(follow), FadeIn(brand), run_time=0.4)

        self.line("outro", self.lines["outro"], self.keys, fade)

    # A spoken line: its voice from the current time, its animation, then the gap.
    # on_end runs when the voice ends, before the gap (a stopwatch stops there).
    def line(
        self,
        key: str,
        spoken: str,
        keys: list[str],
        animate: Callable[[float], None],
        on_end: Callable[[], None] | None = None,
    ) -> None:
        voiced = self.voice.line_for(spoken)
        if voiced["key"] != key:
            raise RuntimeError(f"line {key} is voiced as {voiced['key']} in the manifest")
        with self.voiceover(text=spoken) as tracker:
            self.placed.append({
                "key": key, "text": spoken, "wav": voiced["wav"], "words": voiced["words"],
                "start": round(tracker.start_t, 3), "duration": round(tracker.duration, 3),
            })
            animate(tracker.duration)
        if on_end is not None:
            on_end()
        if key != keys[-1]:
            self.wait(self.b["gap_seconds"])

    def write_log(self) -> None:
        log: dict = {
            "duration": round(self.renderer.time, 3),
            "engine": self.voice.engine,
            "lines": self.placed,
            "on_screen": ON_SCREEN,
        }
        if self.timers:
            log["timers"] = self.timers
        Path(os.environ["LYCEON_PILOT_LOG"]).write_text(json.dumps(log, indent=2), encoding="utf8")
