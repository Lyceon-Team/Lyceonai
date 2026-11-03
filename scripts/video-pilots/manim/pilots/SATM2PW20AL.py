"""Video pilot D1, Video 1 "graphing method only" (SATM2PW20AL): √(6x + 19) = x + 2.

@spec [owner brief "Video tools pilot" (Karl, 2026-11-02) Part D1, Video 1: "a calculation-heavy
      Math question solved ONLY by graphing: plot the function(s) in Manim, read the intersection
      ... and map it to the answer"; "recompute the maths and confirm the graph read-off is exact";
      owner ruling (Karl, 2026-11-02): the graph is drawn by us and called "the graphing method" /
      "graphing calculator", with no third-party calculator shown or named; Karl's script and voice
      rulings for every pilot video (2026-11-02, SCL-267): the flow hook → setup → key move → trap
      → answer and quick check → call to action] | @implemented [2026-11-02, re-ordered to the
      SCL-267 flow 2026-11-02]

plain English: each side of the equation is graphed as its own function, y = √(6x + 19) (ink) and
y = x + 2 (red), on a square grid from x = −4 to 7 and y = −2 to 9. They cross once, at the
lattice point (5, 7), which the dashed guides read off to both axes; x = 5 is the only solution.
Under "The trap:" the graph shows why squaring misleads: at x = −3 the curve is at 1 and the line
at −1, a gap of 2, so −3 is not a crossing and B) {−3, 5} is wrong. Then the steps and guides come
back and C) {5} is written and circled while the quick check is spoken.

The maths is checked before anything is drawn (assert_maths): squaring gives x² − 2x − 15 = 0,
discriminant 64, roots 5 and −3; only x = 5 keeps x + 2 ≥ 0 (a square root is never negative), and
at 5 both sides are exactly 7. The read-off is an integer lattice point, not an estimate.
"""

from __future__ import annotations

import math

from manim import DOWN, LEFT, RIGHT, Create, DashedLine, Ellipse, FadeIn, FadeOut, Text, VGroup, Write

from graph import GraphPanel
from layout import px


def curve(x: float) -> float | None:
    inside = 6 * x + 19
    return math.sqrt(inside) if inside >= 0 else None


def line(x: float) -> float:
    return x + 2


def assert_maths() -> None:
    # (x + 2)² = 6x + 19  ⇔  x² − 2x − 15 = 0
    a, b, c = 1, -2, -15
    disc = b * b - 4 * a * c
    root = math.isqrt(disc)
    assert root * root == disc == 64
    roots = sorted(((-b - root) // (2 * a), (-b + root) // (2 * a)))
    assert roots == [-3, 5]
    kept = [x for x in roots if x + 2 >= 0 and 6 * x + 19 == (x + 2) ** 2]
    assert kept == [5], kept
    assert 6 * 5 + 19 == 49 and 5 + 2 == 7  # √49 = 7: the crossing is the lattice point (5, 7)
    assert 6 * -3 + 19 == 1 and -3 + 2 == -1  # at −3 the curve is at 1, the line at −1


def run(scene) -> None:
    assert_maths()
    b = scene.b
    lines, keys = scene.lines, scene.keys
    hook, stem, opts = scene.open_card()

    scene.line("hook", lines["hook"], keys, lambda d: None)
    scene.line("question", lines["question"], keys, lambda d: None)

    recap, recap_bottom = scene.recap()
    panel = GraphPanel(scene, x_range=(-4, 7), y_range=(-2, 9), unit_px=48, top=recap_bottom + 30)
    ink, red = scene.ink, scene.red
    f_curve = panel.plot(curve, ink, x_from=-19 / 6, width=7)
    f_line = panel.plot(line, red, width=7)
    curve_label = panel.label("y = √(6x + 19)", 0.3, 8.3, RIGHT, ink, 30)
    line_label = panel.label("y = x + 2", 0.6, 1.0, RIGHT, red, 30)
    crossing = panel.point(5, 7, ink, 13)
    crossing_label = panel.label("(5, 7)", 5, 7, DOWN + RIGHT, ink, 32)
    guides = panel.guides(5, 7, ink)

    def notepad(k: int, s: str, color: str | None = None, size: float = 70) -> Text:
        return scene.notepad_at(panel.bottom + 22 + k * 78, s, color, size)

    notepad_lines = [notepad(k, s) for k, s in enumerate(b["steps"])]
    answer_line = notepad(len(b["steps"]), b["answer"]["notepad"], red, 80)
    answer_line.shift(RIGHT * px(20))  # room for the ring inside the safe column

    def step1(d: float) -> None:
        scene.play(FadeOut(hook), FadeOut(stem), FadeOut(opts), FadeIn(recap), run_time=0.4)
        scene.play(FadeIn(panel.frame), run_time=0.5)
        scene.play(Create(f_curve), FadeIn(curve_label), Write(notepad_lines[0]), run_time=min(1.8, d * 0.45))

    def step2(d: float) -> None:
        scene.play(Create(f_line), FadeIn(line_label), Write(notepad_lines[1]), run_time=min(1.6, d * 0.45))

    def step3(d: float) -> None:
        scene.play(FadeIn(crossing, scale=1.6), FadeIn(crossing_label), run_time=0.5)
        scene.play(Create(guides), Write(notepad_lines[2]), run_time=min(1.4, d * 0.4))

    def step4(d: float) -> None:
        scene.play(Write(notepad_lines[3]), run_time=min(1.4, d * 0.4))

    step_fns = [step1, step2, step3, step4]
    if len(b["steps"]) != len(step_fns):
        raise RuntimeError(f"this drawing has {len(step_fns)} steps; the example has {len(b['steps'])}")
    for k, fn in enumerate(step_fns):
        scene.line(f"step-{k + 1}", lines[f"step-{k + 1}"], keys, fn)

    # Trap: at x = −3 the curve is at 1 and the line at −1, so the graphs do not meet there.
    trap_head = notepad(0, b["trap"]["heading"], red, 84)
    trap_lines = [notepad(k + 1, s) for k, s in enumerate(b["trap"]["notepad"])]
    on_curve, on_line = panel.point(-3, 1, ink, 10), panel.point(-3, -1, red, 10)
    gap = DashedLine(panel.g(-3, 1), panel.g(-3, -1), stroke_color=red, stroke_width=4, dash_length=px(8))
    gap_labels = VGroup(
        panel.label("1", -3, 1, LEFT, ink, 28),
        panel.label("−1", -3, -1, DOWN, red, 28),
    )

    def trap(d: float) -> None:
        scene.play(*[FadeOut(m) for m in notepad_lines], FadeOut(guides), run_time=0.3)
        scene.play(Write(trap_head), run_time=0.6)
        scene.play(Write(trap_lines[0]), run_time=min(1.2, d * 0.15))
        scene.play(FadeIn(on_curve), FadeIn(on_line), Create(gap), FadeIn(gap_labels), Write(trap_lines[1]),
                   run_time=min(1.4, d * 0.2))
        for t in trap_lines[2:]:
            scene.play(Write(t), run_time=min(1.2, d * 0.15))

    scene.line("trap", lines["trap"], keys, trap)

    # Answer and quick check: the steps and the read-off back, then C) written and circled.
    ring = Ellipse(
        width=answer_line.width + px(40), height=answer_line.height + px(46),
        stroke_color=red, stroke_width=7,
    ).move_to(answer_line)

    def answer(d: float) -> None:
        scene.play(FadeOut(trap_head), *[FadeOut(t) for t in trap_lines], FadeOut(on_curve), FadeOut(on_line),
                   FadeOut(gap), FadeOut(gap_labels), run_time=0.3)
        scene.play(*[FadeIn(m) for m in notepad_lines], FadeIn(guides), run_time=0.4)
        scene.play(Write(answer_line), run_time=min(1.2, d * 0.3))
        scene.play(Create(ring), run_time=0.35)

    scene.line("answer", lines["answer"], keys, answer)
    scene.outro()
