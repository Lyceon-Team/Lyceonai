"""Video pilot (Manim): one graph worked example, 1080×1920 at 30 fps, voiced line by line.

@spec [owner brief "Video tools pilot" (Karl, 2026-11-02) Part D2, Video 3, and D3 (the same script
      and visuals voiced with Chatterbox); Karl's script and voice rulings for every pilot video
      (2026-11-02, SCL-267): 1 "No burned-in word-by-word captions ... the on-screen handwriting and
      graphs carry the content"; 3 the flow hook → setup → key move → trap → answer and quick check
      → "Follow, there's one of these every day.", the end card shows "Lyceon SAT Prep", no
      lyceon.ai spoken or shown; owner brief "Worked examples: production system" (Karl,
      2026-10-27): blank paper, Caveat, Lyceon colours, TikTok safe area x 71..912, y 154..1555;
      Public Disclosure Doctrine §0 rules 1-2]
      | @implemented [2026-11-02, captions removed and re-ordered to the SCL-267 flow 2026-11-02]

plain English: rendered by scripts/video-pilots/manim/render.py, which sets the environment this
file reads (manim's command line cannot pass arguments to a scene):
  LYCEON_PILOT_BUNDLE  bundle.json from prepare.ts (question, script, end card, kit settings)
  LYCEON_PILOT_VOICE   voice.json from voice-lines.ts (every line voiced, normalised, checked)
  LYCEON_PILOT_CACHE   manim-voiceover's working folder (outside the repository)
  LYCEON_PILOT_LOG     where the placed lines and the on-screen strings are written for check.ts
Every spoken line is a manim-voiceover block, back to back with the kit's gap, so the picture is
timed by the voice exactly as the worked examples are. Nothing on screen is typed here: the hook,
question, choices, key, notepad lines, trap and end card all come from the bundle. The one thing
this file knows about the question is the drawing: the circle (x − 2)² + (y − 5)² = 13² against
the x-axis, which is what makes this question a visual one. A different question needs its own
drawing; the scene refuses a bundle for any other question rather than draw the wrong figure.

The spoken order (scriptLines): hook and setup over the open card; the four steps draw the circle,
the drop from the centre, the right triangle and the two crossings; the trap clears the triangle
and draws the diameter under "The trap:"; the answer brings the steps back, draws the chord and
writes and circles the answer while the quick check is spoken; the call to action plays over the
end card (logo, "Follow for daily SAT questions", "Lyceon SAT Prep", from the kit's template).

trade-offs: no captions, by ruling, so the notepad and the figure carry the content. Text is set
with Pango, which cannot fit-to-width the way the HTML kit's fit script does, so long lines are
wrapped or scaled to the safe column here and safe_area_check.py proves the result on sampled
frames. ON_SCREEN records every string set on screen so check.ts can prove the voice never reads
six of its words in a row (rule S1) against what was actually drawn, labels included.
"""

from __future__ import annotations

import json
import math
import os
import sys
from collections.abc import Callable
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
from prevoiced_service import PrevoicedService  # noqa: E402

PILOT_QUESTION = "SATM2BVZSMV"

config.frame_height = 16.0
config.frame_width = 9.0
PX = 120.0  # pixels per Manim unit on a 1080×1920 frame

# Every string set on screen, in the order it was first set (check.ts reads it from the log).
ON_SCREEN: list[str] = []
_seen: set[str] = set()


def at(x: float, y: float) -> np.ndarray:
    """A pixel position (origin top-left, y down) as a Manim point."""
    return np.array([(x - 540.0) / PX, (960.0 - y) / PX, 0.0])


def px(n: float) -> float:
    return n / PX


# Cap height as a fraction of the em, so a size in CSS pixels sets the same letter size.
CAP_HEIGHT = {"Inter": 0.727, "Poppins": 0.70, "Caveat": 0.62}
_cap_at_48: dict[tuple[str, str], float] = {}


def text(s: str, font: str, size_px: float, color: str, weight: str = NORMAL) -> Text:
    if s not in _seen:
        _seen.add(s)
        ON_SCREEN.append(s)
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


class WorkedExample(VoiceoverScene):
    def construct(self) -> None:
        b = json.loads(Path(os.environ["LYCEON_PILOT_BUNDLE"]).read_text(encoding="utf8"))
        if b["question"]["id"] != PILOT_QUESTION:
            raise RuntimeError(f"this scene draws {PILOT_QUESTION}, not {b['question']['id']}")
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
        self.lines = {line["key"]: line["text"] for line in b["lines"]}
        self.keys = [line["key"] for line in b["lines"]]
        lines, keys = self.lines, self.keys

        # Open: hook and question on screen from frame 0, under the hook and the setup.
        hook, stem, opts = self.open_card()
        self.line("hook", lines["hook"], keys, lambda d: None)
        self.line("question", lines["question"], keys, lambda d: None)

        # Work: recap, the figure, the notepad; one step per line (the key move and why).
        recap = self.recap()
        fig = Figure(self, top=175 + 43 * len(recap[0]) + 70)

        def notepad(k: int, s: str, color: str | None = None, size: float = 70) -> Text:
            return self.notepad_at(fig.bottom + 24 + k * 78, s, color, size)

        def step1(d: float) -> None:
            self.play(FadeOut(hook), FadeOut(stem), FadeOut(opts), FadeIn(recap), run_time=0.4)
            self.play(Create(fig.axes), run_time=0.5)
            self.play(Create(fig.circle), FadeIn(fig.centre), Write(notepad_lines[0]), run_time=min(1.6, d * 0.4))
            self.play(Create(fig.radius), FadeIn(fig.radius_label), run_time=0.5)

        def step2(d: float) -> None:
            self.play(fig.axes[0].animate.set_color(self.red).set_stroke(width=8), run_time=0.4)
            self.play(Create(fig.drop), FadeIn(fig.drop_label), Write(notepad_lines[1]), run_time=min(1.6, d * 0.4))

        def step3(d: float) -> None:
            self.play(Create(fig.halves), Create(fig.hyps), FadeIn(fig.half_labels), run_time=min(1.4, d * 0.35))
            self.play(Write(notepad_lines[2]), run_time=min(1.4, d * 0.35))

        def step4(d: float) -> None:
            self.play(FadeIn(fig.points), FadeIn(fig.point_labels), Write(notepad_lines[3]), run_time=min(1.6, d * 0.4))

        notepad_lines = [notepad(k, s) for k, s in enumerate(b["steps"])]
        step_fns = [step1, step2, step3, step4]
        if len(b["steps"]) != len(step_fns):
            raise RuntimeError(f"this drawing has {len(step_fns)} steps; the example has {len(b['steps'])}")
        for k, fn in enumerate(step_fns):
            self.line(f"step-{k + 1}", lines[f"step-{k + 1}"], keys, fn)

        # Trap ("here's where people slip"): the diameter against the chord, under "The trap:".
        trap_head = notepad(0, b["trap"]["heading"], self.red, 84)
        trap_lines = [notepad(k + 1, s) for k, s in enumerate(b["trap"]["notepad"])]
        triangle = [fig.half_labels, fig.hyps, fig.halves, fig.drop, fig.drop_label, fig.radius, fig.radius_label]

        def trap(d: float) -> None:
            self.play(*[FadeOut(m) for m in [*notepad_lines, *triangle]], FadeOut(fig.centre[1]), run_time=0.3)
            self.play(Write(trap_head), Create(fig.diameter), FadeIn(fig.diameter_label), run_time=0.9)
            each = max(0.6, (d - 1.4) / max(len(trap_lines), 1) - 0.2)
            for t in trap_lines:
                self.play(Write(t), run_time=min(1.2, each))
                self.wait(max(0.0, each - 1.2))

        self.line("trap", lines["trap"], keys, trap)

        # Answer and quick check: the steps back, the chord drawn, the answer written and circled.
        answer_line = notepad(len(b["steps"]), b["answer"]["notepad"], self.red, 80)
        answer_line.shift(RIGHT * px(20))  # room for the ring inside the safe column
        ring = Ellipse(
            width=answer_line.width + px(40), height=answer_line.height + px(46),
            stroke_color=self.red, stroke_width=7,
        ).move_to(answer_line)

        def answer(d: float) -> None:
            self.play(
                FadeOut(trap_head), *[FadeOut(t) for t in trap_lines],
                FadeOut(fig.diameter), FadeOut(fig.diameter_label), run_time=0.3,
            )
            self.play(*[FadeIn(m) for m in notepad_lines], FadeIn(fig.halves), FadeIn(fig.hyps),
                      FadeIn(fig.half_labels), run_time=0.4)
            self.play(Create(fig.chord), FadeIn(fig.chord_label), run_time=0.5)
            self.play(Write(answer_line), run_time=min(1.2, d * 0.3))
            self.play(Create(ring), run_time=0.35)

        self.line("answer", lines["answer"], keys, answer)
        self.outro()
        self.wait(b["end_hold_seconds"])
        self.write_log()

    # The open: hook and question on screen from frame 0.
    def open_card(self) -> tuple[VGroup, VGroup, VGroup]:
        q = self.b["question"]
        hook = paragraph(
            wrap(self.b["hook_line"], "Poppins", 64, self.ink, self.width_px, BOLD), self.left, 180, 74
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
        return hook, stem, opts

    # The question, small and dimmed, at the top of the working screen.
    def recap(self) -> VGroup:
        q = self.b["question"]
        recap_stem = paragraph(wrap(q["stem"], "Inter", 32, self.ink, self.width_px), self.left, 175, 43)
        recap_opts = text(
            "   ·   ".join(f"{o['key']}) {o['text']}" for o in q["options"]), "Inter", 32, self.ink
        ).next_to(at(self.left, 175 + 43 * len(recap_stem) + 6), DOWN, buff=0).align_to(at(self.left, 0), LEFT)
        return VGroup(recap_stem, recap_opts).set_opacity(0.72)

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
    def line(self, key: str, spoken: str, keys: list[str], animate: Callable[[float], None]) -> None:
        voiced = self.voice.line_for(spoken)
        if voiced["key"] != key:
            raise RuntimeError(f"line {key} is voiced as {voiced['key']} in the manifest")
        with self.voiceover(text=spoken) as tracker:
            self.placed.append({
                "key": key, "text": spoken, "wav": voiced["wav"], "words": voiced["words"],
                "start": round(tracker.start_t, 3), "duration": round(tracker.duration, 3),
            })
            animate(tracker.duration)
        if key != keys[-1]:
            self.wait(self.b["gap_seconds"])

    def write_log(self) -> None:
        log = {
            "duration": round(self.renderer.time, 3),
            "engine": self.voice.engine,
            "lines": self.placed,
            "on_screen": ON_SCREEN,
        }
        Path(os.environ["LYCEON_PILOT_LOG"]).write_text(json.dumps(log, indent=2), encoding="utf8")


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
