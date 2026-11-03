"""Video pilot D2 (SATM2BVZSMV): the circle (x − 2)² + (y − 5)² = 13² against the x-axis.

@spec [owner brief "Video tools pilot" (Karl, 2026-11-02) Part D2, Video 3: "one geometry or graph
      worked example"; D3 (the same script in Chatterbox); Part D1: "keeping the D2 video
      reproducible"; Karl's script and voice rulings for every pilot video (2026-11-02, SCL-267):
      the flow hook → setup → key move → trap → answer and quick check → call to action]
      | @implemented [2026-11-02, moved out of scene.py 2026-11-02 (D1), re-ordered to the SCL-267
      flow 2026-11-02]

plain English: the D2 drawing and its choreography, in the spoken order. Hook and setup over the
open card; the four steps draw the circle and its centre with the radius, the drop to the x-axis,
the two right triangles, and the two crossing points; the trap clears the triangle and draws the
diameter under "The trap:"; the answer brings the steps and the triangle back, draws the chord, and
writes and circles the answer while the quick check is spoken; then the shared end card. The same
choreography as #1400's single-file scene, with self → scene.
"""

from __future__ import annotations

import math

import numpy as np
from manim import (
    DOWN,
    LEFT,
    RIGHT,
    UP,
    Circle,
    Create,
    DashedLine,
    Dot,
    Ellipse,
    FadeIn,
    FadeOut,
    Line,
    Text,
    VGroup,
    Write,
)

from layout import at, px, text


def run(scene) -> None:
    b = scene.b
    lines, keys = scene.lines, scene.keys
    hook, stem, opts = scene.open_card()
    scene.line("hook", lines["hook"], keys, lambda d: None)
    scene.line("question", lines["question"], keys, lambda d: None)

    # Work: recap, the figure, the notepad; one step per line (the key move and why).
    recap, _ = scene.recap()
    fig = Figure(scene, top=175 + 43 * len(recap[0]) + 70)

    def notepad(k: int, s: str, color: str | None = None, size: float = 70) -> Text:
        return scene.notepad_at(fig.bottom + 24 + k * 78, s, color, size)

    def step1(d: float) -> None:
        scene.play(FadeOut(hook), FadeOut(stem), FadeOut(opts), FadeIn(recap), run_time=0.4)
        scene.play(Create(fig.axes), run_time=0.5)
        scene.play(Create(fig.circle), FadeIn(fig.centre), Write(notepad_lines[0]), run_time=min(1.6, d * 0.4))
        scene.play(Create(fig.radius), FadeIn(fig.radius_label), run_time=0.5)

    def step2(d: float) -> None:
        scene.play(fig.axes[0].animate.set_color(scene.red).set_stroke(width=8), run_time=0.4)
        scene.play(Create(fig.drop), FadeIn(fig.drop_label), Write(notepad_lines[1]), run_time=min(1.6, d * 0.4))

    def step3(d: float) -> None:
        scene.play(Create(fig.halves), Create(fig.hyps), FadeIn(fig.half_labels), run_time=min(1.4, d * 0.35))
        scene.play(Write(notepad_lines[2]), run_time=min(1.4, d * 0.35))

    def step4(d: float) -> None:
        scene.play(FadeIn(fig.points), FadeIn(fig.point_labels), Write(notepad_lines[3]), run_time=min(1.6, d * 0.4))

    notepad_lines = [notepad(k, s) for k, s in enumerate(b["steps"])]
    step_fns = [step1, step2, step3, step4]
    if len(b["steps"]) != len(step_fns):
        raise RuntimeError(f"this drawing has {len(step_fns)} steps; the example has {len(b['steps'])}")
    for k, fn in enumerate(step_fns):
        scene.line(f"step-{k + 1}", lines[f"step-{k + 1}"], keys, fn)

    # Trap ("here's where people slip"): the diameter against the chord, under "The trap:".
    trap_head = notepad(0, b["trap"]["heading"], scene.red, 84)
    trap_lines = [notepad(k + 1, s) for k, s in enumerate(b["trap"]["notepad"])]
    triangle = [fig.half_labels, fig.hyps, fig.halves, fig.drop, fig.drop_label, fig.radius, fig.radius_label]

    def trap(d: float) -> None:
        scene.play(*[FadeOut(m) for m in [*notepad_lines, *triangle]], FadeOut(fig.centre[1]), run_time=0.3)
        scene.play(Write(trap_head), Create(fig.diameter), FadeIn(fig.diameter_label), run_time=0.9)
        each = max(0.6, (d - 1.4) / max(len(trap_lines), 1) - 0.2)
        for t in trap_lines:
            scene.play(Write(t), run_time=min(1.2, each))
            scene.wait(max(0.0, each - 1.2))

    scene.line("trap", lines["trap"], keys, trap)

    # Answer and quick check: the steps back, the chord drawn, the answer written and circled.
    answer_line = notepad(len(b["steps"]), b["answer"]["notepad"], scene.red, 80)
    answer_line.shift(RIGHT * px(20))  # room for the ring inside the safe column
    ring = Ellipse(
        width=answer_line.width + px(40), height=answer_line.height + px(46),
        stroke_color=scene.red, stroke_width=7,
    ).move_to(answer_line)

    def answer(d: float) -> None:
        scene.play(
            FadeOut(trap_head), *[FadeOut(t) for t in trap_lines],
            FadeOut(fig.diameter), FadeOut(fig.diameter_label), run_time=0.3,
        )
        scene.play(*[FadeIn(m) for m in notepad_lines], FadeIn(fig.halves), FadeIn(fig.hyps),
                   FadeIn(fig.half_labels), run_time=0.4)
        scene.play(Create(fig.chord), FadeIn(fig.chord_label), run_time=0.5)
        scene.play(Write(answer_line), run_time=min(1.2, d * 0.3))
        scene.play(Create(ring), run_time=0.35)

    scene.line("answer", lines["answer"], keys, answer)
    scene.outro()


class Figure:
    """The circle (x − 2)² + (y − 5)² = 169 on xy axes, with the parts the steps reveal."""

    def __init__(self, scene, top: float) -> None:
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
