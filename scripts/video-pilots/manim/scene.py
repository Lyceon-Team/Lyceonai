"""Video pilot (Manim): one graph worked example, 1080×1920 at 30 fps, voiced with Kokoro-82M.

@spec [owner brief "Video tools pilot" (Karl, 2026-11-02) Part D2, Video 3 and Video 4; owner brief
      "Worked examples: production system" (Karl, 2026-10-27), Video: hook → question → steps →
      answer near the end → "The trap:" → end card "Follow for daily SAT questions" + lyceon.ai;
      blank paper, Caveat, Lyceon colours; word-by-word highlighted captions; TikTok safe area
      x 71..912, y 154..1555; Public Disclosure Doctrine §0 rules 1-2] | @implemented [2026-11-02]

plain English: rendered by scripts/video-pilots/manim/render.py, which sets the environment this
file reads (manim's command line cannot pass arguments to a scene):
  LYCEON_PILOT_BUNDLE  bundle.json from prepare.ts (question, script, kit settings)
  LYCEON_PILOT_VOICE   a Kokoro voice id (af_heart, af_bella, am_michael, ...)
  LYCEON_PILOT_RATE    Kokoro speed (voice.json's speaking_rate; 1 = natural)
  LYCEON_PILOT_PYTHON  the Python hyperframes runs Kokoro in (kokoro-onnx + soundfile)
  LYCEON_PILOT_CACHE   where the voiced lines are kept (outside the repository)
  LYCEON_PILOT_LOG     where the placed lines are written for check.ts
Every spoken line is a manim-voiceover block, back to back with the kit's gap, so the picture is
timed by the voice exactly as the worked examples are. Nothing on screen is typed here: the hook,
question, choices, key, notepad lines, trap and end card all come from the bundle. The one thing
this file knows about the question is the drawing: the circle (x − 2)² + (y − 5)² = 13² against
the x-axis, which is what makes this question a visual one. A different question needs its own
drawing; the scene refuses a bundle for any other question rather than draw the wrong figure.

trade-offs: captions follow composition.ts (at most five words a chunk, each word lit while it is
spoken; word times from the transcription when it heard the same number of words, otherwise
spread by character position: scriptWordTimes, ported). Text is set with Pango, which cannot
fit-to-width the way the HTML kit's fit script does, so long lines are wrapped or scaled to the
safe column here and safe_area_check.py proves the result on sampled frames.
"""

from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

import numpy as np
from manim import (
    BOLD,
    DOWN,
    LEFT,
    NORMAL,
    RIGHT,
    UP,
    Circle,
    Create,
    DashedLine,
    Dot,
    Ellipse,
    FadeIn,
    FadeOut,
    ImageMobject,
    Line,
    Mobject,
    RoundedRectangle,
    Text,
    VGroup,
    Write,
    config,
)
from manim_voiceover import VoiceoverScene

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kokoro_service import KokoroHyperframesService  # noqa: E402

PILOT_QUESTION = "SATM2BVZSMV"

config.frame_height = 16.0
config.frame_width = 9.0
PX = 120.0  # pixels per Manim unit on a 1080×1920 frame


def at(x: float, y: float) -> np.ndarray:
    """A pixel position (origin top-left, y down) as a Manim point."""
    return np.array([(x - 540.0) / PX, (960.0 - y) / PX, 0.0])


def px(n: float) -> float:
    return n / PX


# Cap height as a fraction of the em, so a size in CSS pixels sets the same letter size.
CAP_HEIGHT = {"Inter": 0.727, "Poppins": 0.70, "Caveat": 0.62}
_cap_at_48: dict[tuple[str, str], float] = {}


def text(s: str, font: str, size_px: float, color: str, weight: str = NORMAL) -> Text:
    key = (font, weight)
    if key not in _cap_at_48:
        _cap_at_48[key] = Text("H", font=font, weight=weight, font_size=48).height
    font_size = 48 * (px(size_px * CAP_HEIGHT[font]) / _cap_at_48[key])
    return Text(s, font=font, weight=weight, font_size=font_size, color=color)


def wrap(s: str, font: str, size_px: float, color: str, width_px: float, weight: str = NORMAL) -> list[Text]:
    """Greedy word wrap into lines no wider than width_px."""
    lines: list[Text] = []
    current: list[str] = []
    for word in s.split():
        trial = text(" ".join([*current, word]), font, size_px, color, weight)
        if current and trial.width > px(width_px):
            lines.append(text(" ".join(current), font, size_px, color, weight))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(text(" ".join(current), font, size_px, color, weight))
    return lines


def paragraph(lines: list[Text], left: float, top: float, line_px: float) -> VGroup:
    """Lines set left-aligned from (left, top), one every line_px pixels (tops aligned)."""
    for k, line in enumerate(lines):
        line.next_to(at(left, top + k * line_px), DOWN, buff=0).align_to(at(left, 0), LEFT)
    return VGroup(*lines)


def fit_width(m: Mobject, width_px: float) -> Mobject:
    if m.width > px(width_px):
        m.scale_to_fit_width(px(width_px))
    return m


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


class WorkedExample(VoiceoverScene):
    def construct(self) -> None:
        b = json.loads(Path(os.environ["LYCEON_PILOT_BUNDLE"]).read_text(encoding="utf8"))
        if b["question"]["id"] != PILOT_QUESTION:
            raise RuntimeError(f"this scene draws {PILOT_QUESTION}, not {b['question']['id']}")
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
        self.captions: list[tuple[float, float, VGroup, list[tuple[Mobject, float, float]]]] = []
        # One holder with its own updater: Manim treats a mobject with an updater as moving, so
        # it is redrawn every frame even inside self.play (a scene-level add during a play would
        # be frozen into the static background).
        self.caption_holder = VGroup()
        self.caption_holder.add_updater(lambda m, dt: self.update_captions(dt))
        self.add(self.caption_holder)

        lines = {line["key"]: line["text"] for line in b["lines"]}
        keys = [line["key"] for line in b["lines"]]
        q = b["question"]

        # Open: hook and question on screen from frame 0.
        hook = paragraph(
            wrap(b["hook_line"], "Poppins", 64, self.ink, self.width_px, BOLD), self.left, 180, 74
        )
        stem = paragraph(wrap(q["stem"], "Inter", 42, self.ink, self.width_px), self.left, 410, 59)
        opts_top = 410 + 59 * len(stem) + 30
        opts = VGroup()
        box_w, box_h, gap = (self.width_px - 18) / 2, 84, 18
        for k, o in enumerate(q["options"]):
            x0 = self.left + (k % 2) * (box_w + gap)
            y0 = opts_top + (k // 2) * (box_h + gap)
            box = RoundedRectangle(
                corner_radius=px(16), width=px(box_w - 4), height=px(box_h),  # stroke inside the column
                stroke_color=self.ink, stroke_opacity=0.22, stroke_width=3,
            ).move_to(at(x0 + box_w / 2, y0 + box_h / 2))
            label = text(f"{o['key']})  {o['text']}", "Inter", 42, self.ink)
            label.move_to(box).align_to(at(x0 + 22, 0), LEFT)
            opts.add(VGroup(box, label))
        self.add(hook, stem, opts)

        self.line("hook", lines["hook"], keys, lambda d: None)
        self.line("question", lines["question"], keys, lambda d: None)

        # Work: recap, the figure, the notepad.
        recap_stem = paragraph(wrap(q["stem"], "Inter", 32, self.ink, self.width_px), self.left, 175, 43)
        recap_opts = text(
            "   ·   ".join(f"{o['key']}) {o['text']}" for o in q["options"]), "Inter", 32, self.ink
        ).next_to(at(self.left, 175 + 43 * len(recap_stem) + 6), DOWN, buff=0).align_to(at(self.left, 0), LEFT)
        recap = VGroup(recap_stem, recap_opts).set_opacity(0.72)
        fig = Figure(self, top=175 + 43 * len(recap_stem) + 70)
        self.fig = fig

        def notepad(k: int, s: str, color: str | None = None, size: float = 70) -> Text:
            t = text(s, "Caveat", size, color or self.ink, BOLD)
            fit_width(t, self.width_px - 20)
            return t.next_to(at(90, fig.bottom + 24 + k * 78), DOWN, buff=0).align_to(at(90, 0), LEFT)

        def step1(d: float) -> None:
            self.play(FadeOut(hook), FadeOut(stem), FadeOut(opts), FadeIn(recap), run_time=0.4)
            self.play(Create(fig.axes), run_time=0.5)
            self.play(Create(fig.circle), FadeIn(fig.centre), Write(notepad_lines[0]), run_time=min(1.6, d * 0.4))
            self.play(Create(fig.radius), FadeIn(fig.radius_label), run_time=0.5)

        def step2(d: float) -> None:
            self.play(fig.axes[0].animate.set_color(self.hi).set_stroke(width=8), run_time=0.4)
            self.play(Create(fig.drop), FadeIn(fig.drop_label), Write(notepad_lines[1]), run_time=min(1.6, d * 0.4))

        def step3(d: float) -> None:
            self.play(Write(notepad_lines[2]), run_time=min(1.4, d * 0.35))
            self.play(Create(fig.halves), Create(fig.hyps), FadeIn(fig.half_labels), run_time=min(1.4, d * 0.35))

        def step4(d: float) -> None:
            self.play(FadeIn(fig.points), FadeIn(fig.point_labels), Write(notepad_lines[3]), run_time=min(1.6, d * 0.4))

        def answer(d: float) -> None:
            self.play(Create(fig.chord), FadeIn(fig.chord_label), run_time=0.5)
            self.play(Write(answer_line), run_time=min(1.2, d * 0.4))
            ring = Ellipse(
                width=answer_line.width + px(40), height=answer_line.height + px(46),
                stroke_color=self.red, stroke_width=7,
            ).move_to(answer_line)
            self.answer_ring = ring
            self.play(Create(ring), run_time=0.35)

        notepad_lines = [notepad(k, s) for k, s in enumerate(b["steps"])]
        answer_line = notepad(len(b["steps"]), b["answer"]["notepad"], self.red, 80)
        answer_line.shift(RIGHT * px(20))  # room for the ring inside the safe column
        step_fns = [step1, step2, step3, step4]
        for k, fn in enumerate(step_fns[: len(b["steps"])]):
            self.line(f"step-{k + 1}", lines[f"step-{k + 1}"], keys, fn)
        self.line("answer", lines["answer"], keys, answer)

        # Trap: the diameter against the chord, and "The trap:" with its lines.
        trap_head = notepad(0, b["trap"]["heading"], self.red, 84)
        trap_lines = [notepad(k + 1, s) for k, s in enumerate(b["trap"]["notepad"])]

        def trap(d: float) -> None:
            self.play(
                *[FadeOut(m) for m in [*notepad_lines, answer_line, self.answer_ring]],
                FadeOut(fig.half_labels), FadeOut(fig.hyps), FadeOut(fig.halves),
                FadeOut(fig.drop), FadeOut(fig.drop_label), FadeOut(fig.radius), FadeOut(fig.radius_label),
                FadeOut(fig.centre[1]),
                run_time=0.3,
            )
            self.play(Write(trap_head), Create(fig.diameter), FadeIn(fig.diameter_label), run_time=0.9)
            each = max(0.6, (d - 1.4) / max(len(trap_lines), 1) - 0.2)
            for t in trap_lines:
                self.play(Write(t), run_time=min(1.2, each))
                self.wait(max(0.0, each - 1.2))

        self.line("trap", lines["trap"], keys, trap)

        # End card: logo, "Follow for daily SAT questions", lyceon.ai.
        logo = ImageMobject(str(Path(b["kit_dir"]) / "lyceon-logo.png"))
        logo.height = px(280)
        follow = fit_width(text("Follow for daily SAT questions", "Caveat", 80, self.ink, BOLD), self.width_px)
        url = text("lyceon.ai", "Poppins", 84, self.ink, BOLD)
        centre_x = (self.left + self.right) / 2
        logo.move_to(at(centre_x, 551 + 140))
        follow.next_to(logo, DOWN, buff=px(34)).set_x(at(centre_x, 0)[0])
        url.next_to(follow, DOWN, buff=px(34)).set_x(at(centre_x, 0)[0])
        on_screen = [m for m in self.mobjects if m is not self.caption_holder]

        def outro(d: float) -> None:
            self.play(*[FadeOut(m) for m in on_screen], run_time=0.3)
            self.play(FadeIn(logo), FadeIn(follow), FadeIn(url), run_time=0.4)

        self.line("outro", lines["outro"], keys, outro, caption=b["outro_caption"])
        self.wait(b["end_hold_seconds"])
        self.write_log()

    # A spoken line: its voice from the current time, its animation, its captions, then the gap.
    def line(self, key: str, spoken: str, keys: list[str], animate, caption: str | None = None) -> None:
        with self.voiceover(text=spoken) as tracker:
            wav = Path(self.speech_service.cache_dir) / tracker.data["final_audio"]
            words = json.loads(wav.with_suffix(".words.json").read_text(encoding="utf8"))
            self.placed.append({
                "key": key, "text": spoken, "wav": str(wav), "words": words,
                "start": round(tracker.start_t, 3), "duration": round(tracker.duration, 3),
            })
            self.add_captions(caption or spoken, words, tracker.start_t, tracker.duration, key == keys[-1])
            animate(tracker.duration)
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
        Path(os.environ["LYCEON_PILOT_LOG"]).write_text(
            json.dumps({"duration": round(self.renderer.time, 3), "lines": self.placed}, indent=2),
            encoding="utf8",
        )


class Figure:
    """The circle (x − 2)² + (y − 5)² = 169 on xy axes, with the parts the steps reveal."""

    def __init__(self, scene: WorkedExample, top: float) -> None:
        ink, red = scene.ink, scene.red
        scale = 20.0  # pixels per graph unit: the circle (26 units) is 520 px across
        cx = (scene.left + scene.right) / 2
        cy = top + 13 * scale  # the centre's pixel row; the circle's top is at `top`

        def g(x: float, y: float) -> np.ndarray:
            return at(cx + (x - 2) * scale, cy - (y - 5) * scale)

        self.bottom = cy + 13 * scale
        label = lambda s, size=34, color=ink: text(s, "Inter", size, color)  # noqa: E731
        x_axis = Line(g(-12.5, 0), g(16.5, 0), stroke_color=ink, stroke_width=3).set_opacity(0.6)
        y_axis = Line(g(0, -8.6), g(0, 18.6), stroke_color=ink, stroke_width=3).set_opacity(0.6)
        self.axes = VGroup(x_axis, y_axis,
                           label("x", 30).next_to(g(16.5, 0), UP, buff=px(6)),
                           label("y", 30).next_to(g(0, 18.6), LEFT, buff=px(8)))
        self.circle = Circle(radius=px(13 * scale), stroke_color=ink, stroke_width=5).move_to(g(2, 5))
        self.centre = VGroup(Dot(g(2, 5), radius=px(7), color=ink),
                             label("(2, 5)", 30).next_to(g(2, 5), UP, buff=px(8)))
        self.radius = Line(g(2, 5), g(2 - 13 * math.cos(math.radians(50)), 5 + 13 * math.sin(math.radians(50))),
                           stroke_color=ink, stroke_width=4)
        self.radius_label = label("13", 32).next_to(self.radius.get_center(), LEFT, buff=px(10))
        self.drop = DashedLine(g(2, 5), g(2, 0), stroke_color=red, stroke_width=5, dash_length=px(14))
        self.drop_label = label("5", 34, red).next_to(self.drop, RIGHT, buff=px(8))
        self.halves = VGroup(Line(g(2, 0), g(14, 0), stroke_color=red, stroke_width=6),
                             Line(g(2, 0), g(-10, 0), stroke_color=red, stroke_width=6))
        self.hyps = VGroup(Line(g(2, 5), g(14, 0), stroke_color=ink, stroke_width=4),
                           Line(g(2, 5), g(-10, 0), stroke_color=ink, stroke_width=4))
        self.half_labels = VGroup(
            label("12", 32, red).next_to(g(8, 0), DOWN, buff=px(8)),
            label("12", 32, red).next_to(g(-4, 0), DOWN, buff=px(8)),
            label("13", 32).next_to(g(8, 2.5), UP + np.array([0.6, 0, 0]), buff=px(2)),
        )
        self.points = VGroup(Dot(g(14, 0), radius=px(9), color=red), Dot(g(-10, 0), radius=px(9), color=red))
        self.point_labels = VGroup(
            label("(14, 0)", 30, red).next_to(g(14, 0), DOWN + RIGHT, buff=px(4)),
            label("(−10, 0)", 30, red).next_to(g(-10, 0), DOWN + LEFT, buff=px(4)),
        )
        self.chord = Line(g(-10, 0), g(14, 0), stroke_color=red, stroke_width=10)
        self.chord_label = label("24", 36, red).next_to(g(2, 0), DOWN, buff=px(10))
        self.diameter = DashedLine(g(-11, 5), g(15, 5), stroke_color=ink, stroke_width=5, dash_length=px(16))
        self.diameter_label = label("26 = diameter", 32).next_to(g(9, 5), UP, buff=px(10))
