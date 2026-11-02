"""Video pilot (Manim): the shared worked-example scene, 1080×1920 at 30 fps, voiced with Kokoro-82M.

@spec [owner brief "Video tools pilot" (Karl, 2026-11-02) Part D2, Video 3 and Video 4, and Part D1
      ("reuse and extend this tooling; don't fork a second render path ... generalise it so each
      pilot is a small scene module or a per-question config, keeping the D2 video reproducible");
      owner brief "Worked examples: production system" (Karl, 2026-10-27), Video: hook → question →
      steps → answer near the end → "The trap:" → end card "Follow for daily SAT questions" +
      lyceon.ai; blank paper, Caveat, Lyceon colours; word-by-word highlighted captions; TikTok safe
      area x 71..912, y 154..1555; Public Disclosure Doctrine §0 rules 1-2] | @implemented
      [2026-11-02, split into the shared scene and pilots/<question id>.py 2026-11-02 (D1)]

plain English: rendered by scripts/video-pilots/manim/render.py, which sets the environment this
file reads (manim's command line cannot pass arguments to a scene):
  LYCEON_PILOT_BUNDLE  bundle.json from prepare.ts (question, script, kit settings)
  LYCEON_PILOT_VOICE   a Kokoro voice id (af_heart, af_bella, am_michael, ...)
  LYCEON_PILOT_RATE    Kokoro speed (voice.json's speaking_rate; 1 = natural)
  LYCEON_PILOT_PYTHON  the Python hyperframes runs Kokoro in (kokoro-onnx + soundfile)
  LYCEON_PILOT_CACHE   where the voiced lines are kept (outside the repository)
  LYCEON_PILOT_LOG     where the placed lines are written for check.ts
This file is everything the pilots share: the voice, the open card (hook, question, choices), the
recap, every spoken line as a manim-voiceover block back to back with the kit's gap (so the picture
is timed by the voice exactly as the worked examples are), the word-by-word captions, the end card
and the log. What is drawn between the open card and the end card belongs to the question, so it
lives in pilots/<question id>.py, whose run(scene) the scene calls; a bundle for a question with no
module there is refused rather than drawn with the wrong figure. Nothing on screen is typed here:
the hook, question, choices, key, notepad lines, trap and end card all come from the bundle.

trade-offs: captions follow composition.ts (at most five words a chunk, each word lit while it is
spoken; word times from the transcription when it heard the same number of words, otherwise
spread by character position: scriptWordTimes, ported). Text is set with Pango, which cannot
fit-to-width the way the HTML kit's fit script does, so long lines are wrapped or scaled to the
safe column here and safe_area_check.py proves the result on sampled frames. The open card and the
recap fall back to one choice per row only when a choice is too wide for the two-column grid, so
the D2 video (SATM2BVZSMV) renders exactly as it did before the split.
"""

from __future__ import annotations

import importlib
import json
import math
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
    Mobject,
    RoundedRectangle,
    Text,
    VGroup,
    config,
)
from manim_voiceover import VoiceoverScene

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kokoro_service import KokoroHyperframesService  # noqa: E402
from layout import ON_SCREEN, PX, at, fit_width, paragraph, px, text, wrap  # noqa: E402

config.frame_height = 16.0
config.frame_width = 9.0


def script_word_times(text_: str, words: list[dict], duration: float) -> list[tuple[str, float, float]]:
    """composition.ts scriptWordTimes: the script's words with times relative to the line."""
    script = [w for w in text_.split() if w]
    if len(script) == len(words):
        return [(w, float(words[k]["start"]), float(words[k]["end"])) for k, w in enumerate(script)]
    first = float(words[0]["start"]) if words else 0.0
    last = float(words[-1]["end"]) if words else duration
    total = sum(len(w) + 1 for w in script)
    out: list[tuple[str, float, float]] = []
    offset = 0
    for w in script:
        start = first + (last - first) * offset / total
        offset += len(w) + 1
        out.append((w, start, first + (last - first) * offset / total))
    return out


def caption_chunks(items: list, max_words: int) -> list[list]:
    """composition.ts captionChunks: consecutive chunks of at most max_words, sized evenly."""
    n = math.ceil(len(items) / max_words)
    size = math.ceil(len(items) / max(n, 1))
    return [items[k : k + size] for k in range(0, len(items), size)]


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
        self.ink, self.red, self.hi, self.paper = c["ink"], c["red"], c["highlight"], c["paper"]
        self.cap_text = c["captionText"]
        self.camera.background_color = self.paper
        safe = b["safe_area"]
        self.left, self.right = safe["left"], safe["right"]
        self.width_px = self.right - self.left
        self.set_speech_service(
            KokoroHyperframesService(
                voice=os.environ["LYCEON_PILOT_VOICE"],
                speed=float(os.environ["LYCEON_PILOT_RATE"]),
                hyperframes=b["hyperframes"],
                transcribe_model=b["transcribe_model"],
                python=os.environ["LYCEON_PILOT_PYTHON"],
                cache_dir=os.environ["LYCEON_PILOT_CACHE"],
            ),
            create_subcaption=False,
        )
        self.placed: list[dict] = []
        self.timers: list[dict] = []
        self.captions: list[tuple[float, float, VGroup, list[tuple[Mobject, float, float]]]] = []
        # One holder with its own updater: Manim treats a mobject with an updater as moving, so
        # it is redrawn every frame even inside self.play (a scene-level add during a play would
        # be frozen into the static background).
        self.caption_holder = VGroup()
        self.caption_holder.add_updater(lambda m, dt: self.update_captions(dt))
        self.add(self.caption_holder)
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

    # End card: logo, "Follow for daily SAT questions", lyceon.ai, over the outro line.
    def outro(self) -> None:
        logo = ImageMobject(str(Path(self.b["kit_dir"]) / "lyceon-logo.png"))
        logo.height = px(280)
        follow = fit_width(text("Follow for daily SAT questions", "Caveat", 80, self.ink, BOLD), self.width_px)
        url = text("lyceon.ai", "Poppins", 84, self.ink, BOLD)
        centre_x = (self.left + self.right) / 2
        logo.move_to(at(centre_x, 551 + 140))
        follow.next_to(logo, DOWN, buff=px(34)).set_x(at(centre_x, 0)[0])
        url.next_to(follow, DOWN, buff=px(34)).set_x(at(centre_x, 0)[0])
        on_screen = [m for m in self.mobjects if m is not self.caption_holder]

        def fade(d: float) -> None:
            self.play(*[FadeOut(m) for m in on_screen], run_time=0.3)
            self.play(FadeIn(logo), FadeIn(follow), FadeIn(url), run_time=0.4)

        self.line("outro", self.lines["outro"], self.keys, fade, caption=self.b["outro_caption"])

    # A spoken line: its voice from the current time, its animation, its captions, then the gap.
    # on_end runs when the voice ends, before the gap (a stopwatch stops there).
    def line(
        self,
        key: str,
        spoken: str,
        keys: list[str],
        animate: Callable[[float], None],
        caption: str | None = None,
        on_end: Callable[[], None] | None = None,
    ) -> None:
        with self.voiceover(text=spoken) as tracker:
            wav = Path(self.speech_service.cache_dir) / tracker.data["final_audio"]
            words = json.loads(wav.with_suffix(".words.json").read_text(encoding="utf8"))
            self.placed.append({
                "key": key, "text": spoken, "wav": str(wav), "words": words,
                "start": round(tracker.start_t, 3), "duration": round(tracker.duration, 3),
            })
            self.add_captions(caption or spoken, words, tracker.start_t, tracker.duration, key == keys[-1])
            animate(tracker.duration)
        if on_end is not None:
            on_end()
        if key != keys[-1]:
            self.wait(self.b["gap_seconds"])

    def add_captions(self, caption: str, words: list[dict], start: float, duration: float, last: bool) -> None:
        # Between plays: retire the previous line's chunks and hold all of this line's.
        self.caption_holder.remove(*self.caption_holder.submobjects)
        self.captions = []
        timed = script_word_times(caption, words, duration)
        chunks = caption_chunks(list(range(len(timed))), self.b["caption_max_words"])
        line_end = start + duration + (self.b["end_hold_seconds"] if last else self.b["gap_seconds"])
        centre_x = (self.left + self.right) / 2
        for ci, chunk in enumerate(chunks):
            # One Text per chunk, so the words share a baseline; Text drops spaces from its
            # glyphs, so each word is the slice of glyphs its letters occupy.
            row = text(" ".join(timed[k][0] for k in chunk), "Poppins", 44, self.cap_text, BOLD)
            fit_width(row, self.width_px - 44)
            box = RoundedRectangle(
                corner_radius=px(20), width=row.width + px(44), height=px(44 * 1.32 + 32),
                fill_color=self.ink, fill_opacity=1, stroke_width=0,
            )
            box.move_to(at(centre_x, 1360 + box.height * PX / 2))
            row.move_to(box)
            lit: list[tuple[Mobject, float, float]] = []
            pads = VGroup()
            offset = 0
            for k in chunk:
                glyphs = row[offset : offset + len(timed[k][0])]
                offset += len(timed[k][0])
                pad = RoundedRectangle(
                    corner_radius=px(8), width=glyphs.width + px(10), height=px(44 * 1.25),
                    fill_color=self.hi, fill_opacity=0, stroke_width=0,
                ).move_to(glyphs).set_y(box.get_y())
                pads.add(pad)
                lit.append((VGroup(pad, glyphs), start + timed[k][1], start + timed[k][2]))
            group = VGroup(box, pads, row)
            c_start = start if ci == 0 else start + timed[chunk[0]][1]
            nxt = chunks[ci + 1][0] if ci + 1 < len(chunks) else None
            c_end = start + timed[nxt][1] if nxt is not None else line_end
            group.set_fill(opacity=0)
            self.caption_holder.add(group)
            self.captions.append((c_start, c_end, group, lit))

    def update_captions(self, dt: float) -> None:
        """Shows the chunk being spoken and lights its word, by opacity only.

        Manim draws a play's moving mobjects from the family list it takes when the play starts,
        so adding or removing a chunk mid-play leaves the old one drawn. Every chunk of a line is
        therefore put in the holder before the line's first play (add_captions), and this only
        changes opacities and colours.
        """
        t = self.renderer.time
        for s, e, g, lit in self.captions:
            box, pads, row = g[0], g[1], g[2]
            if not s <= t < e:
                g.set_fill(opacity=0)
                continue
            box.set_fill(opacity=1)
            row.set_fill(opacity=1)
            for word, ws, we in lit:
                pad, w = word[0], word[1]
                on = ws <= t < we
                pad.set_fill(opacity=1 if on else 0)
                w.set_color(self.ink if on else self.cap_text)

    def write_log(self) -> None:
        log: dict = {
            "duration": round(self.renderer.time, 3),
            "lines": self.placed,
            "on_screen": ON_SCREEN,
        }
        if self.timers:
            log["timers"] = self.timers
        Path(os.environ["LYCEON_PILOT_LOG"]).write_text(json.dumps(log, indent=2), encoding="utf8")
