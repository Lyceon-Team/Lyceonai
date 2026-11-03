"""Video pilot D1, Video 2 "faster: graphing or by hand?" (SATM2XXVNK7): y = x² − 7x + 5 and y = x − 7.

@spec [owner brief "Video tools pilot" (Karl, 2026-11-02) Part D1, Video 2: "An on-screen timer.
      Solve the SAME question both ways: by hand first with the timer running, then by graphing
      with the timer reset. Show both elapsed times. ... The times must be honest: they are the
      durations of each segment as shown in the video, so the timer runs on the video clock. Don't
      claim real-world solve times."; owner ruling (Karl, 2026-11-02): the graph is drawn by us and
      called "the graphing method" / "graphing calculator", with no third-party calculator shown or
      named; Karl's script and voice rulings for every pilot video (2026-11-02, SCL-267): the flow
      hook → setup → key move → trap → answer and quick check → call to action] | @implemented
      [2026-11-02, trap before the answer (SCL-267 flow) 2026-11-02; the stopwatches unchanged]

plain English: two stopwatches sit under the question, "By hand" and "Graphing". The by-hand
stopwatch starts as step 1's voice starts and stops as step 4's voice ends (set equal, collect,
factor, substitute back); the graphing one starts as step 5's voice starts and stops as step 6's
ends (graph both, read the two crossings). Each therefore shows exactly how long its segment runs
in this video, on the video's own clock (graph.py Stopwatch), and the scene logs both segments'
start, stop and shown value for check.ts. Nothing claims these are real-world solve times: they
time the narration, which is the honest reading of "as shown in the video".

The graph: y = x² − 7x + 5 (ink) and y = x − 7 (red) on a square grid from x = −1 to 9 and
y = −8 to 3. They cross at the lattice points (2, −5) and (6, −1), read off with dashed guides; the
answer is A. Under "The trap:" the two points of choice C, (3, −4) and (4, −3), are marked: they
are on the line, but the parabola is at −7 there, so they are not crossings.

The maths is checked before anything is drawn (assert_maths): x² − 7x + 5 = x − 7 gives
x² − 8x + 12 = 0, discriminant 16, roots 2 and 6, and y = −5 and −1 on both graphs exactly.
"""

from __future__ import annotations

import math

from manim import DOWN, LEFT, RIGHT, Create, Ellipse, FadeIn, FadeOut, Text, VGroup, Write

from graph import GraphPanel, Stopwatch
from layout import px


def parabola(x: float) -> float:
    return x * x - 7 * x + 5


def line(x: float) -> float:
    return x - 7


def assert_maths() -> None:
    a, b, c = 1, -8, 12  # x² − 7x + 5 − (x − 7)
    disc = b * b - 4 * a * c
    root = math.isqrt(disc)
    assert root * root == disc == 16
    xs = sorted(((-b - root) // (2 * a), (-b + root) // (2 * a)))
    assert xs == [2, 6]
    assert [(x, parabola(x)) for x in xs] == [(x, line(x)) for x in xs] == [(2, -5), (6, -1)]
    # Choice C's points are on the line but not on the parabola (it is at −7 at both).
    for x, y in [(3, -4), (4, -3)]:
        assert line(x) == y and parabola(x) == -7


def run(scene) -> None:
    assert_maths()
    b = scene.b
    lines, keys = scene.lines, scene.keys
    if len(b["steps"]) != 6:
        raise RuntimeError(f"this drawing has 6 steps (4 by hand, 2 graphing); the example has {len(b['steps'])}")
    hook, stem, opts = scene.open_card()

    scene.line("hook", lines["hook"], keys, lambda d: None)
    scene.line("question", lines["question"], keys, lambda d: None)

    recap, recap_bottom = scene.recap()
    ink, red = scene.ink, scene.red
    watch_top = recap_bottom + 22
    by_hand = Stopwatch(scene, "By hand", scene.left + 10, watch_top)
    graphing = Stopwatch(scene, "Graphing", scene.left + scene.width_px / 2 + 30, watch_top)
    graphing.dim(0.35)
    work_top = watch_top + 150

    def hand_line(k: int, s: str) -> Text:
        return scene.notepad_at(work_top + 10 + k * 92, s)

    hand_lines = [hand_line(k, s) for k, s in enumerate(b["steps"][:4])]

    panel = GraphPanel(scene, x_range=(-1, 9), y_range=(-8, 3), unit_px=44, top=work_top)
    f_parabola = panel.plot(parabola, ink, width=7)
    f_line = panel.plot(line, red, width=7)
    parabola_label = panel.label("y = x² − 7x + 5", 1.0, 2.5, RIGHT, ink, 26)
    line_label = panel.label("y = x − 7", 7.5, -2.5, RIGHT, red, 26)
    crossings = VGroup(panel.point(2, -5, ink, 12), panel.point(6, -1, ink, 12))
    crossing_labels = VGroup(
        # Beside each point on a paper patch, clear of the read-off guides: (2, −5) to its right,
        # (6, −1) below and to its right.
        panel.backed_label("(2, −5)", 2, -5, RIGHT, ink, 26, buff_px=20),
        panel.backed_label("(6, −1)", 6, -1, DOWN + RIGHT, ink, 26, buff_px=12),
    )
    guides = VGroup(panel.guides(2, -5, ink), panel.guides(6, -1, ink))

    def graph_line(k: int, s: str, color: str | None = None, size: float = 64) -> Text:
        return scene.notepad_at(panel.bottom + 16 + k * 74, s, color, size)

    graph_lines = [graph_line(k, s) for k, s in enumerate(b["steps"][4:])]
    answer_line = graph_line(2, b["answer"]["notepad"], red, 74)
    answer_line.shift(RIGHT * px(20))  # room for the ring inside the safe column

    def hand(k: int):
        def play(d: float) -> None:
            if k == 0:
                by_hand.start()  # the segment starts with step 1's voice
                scene.play(FadeOut(hook), FadeOut(stem), FadeOut(opts), FadeIn(recap),
                           FadeIn(by_hand.group), FadeIn(graphing.group), run_time=0.4)
            scene.play(Write(hand_lines[k]), run_time=min(1.6, d * 0.4))
        return play

    def graph_step1(d: float) -> None:
        graphing.dim(1)
        by_hand.dim(0.55)
        graphing.start()
        scene.play(*[FadeOut(m) for m in hand_lines], run_time=0.3)
        scene.play(FadeIn(panel.frame), run_time=0.4)
        scene.play(Create(f_parabola), FadeIn(parabola_label), run_time=min(1.2, d * 0.3))
        scene.play(Create(f_line), FadeIn(line_label), Write(graph_lines[0]), run_time=min(1.2, d * 0.3))

    def graph_step2(d: float) -> None:
        scene.play(FadeIn(crossings, scale=1.6), FadeIn(crossing_labels), run_time=0.5)
        scene.play(Create(guides), Write(graph_lines[1]), run_time=min(1.4, d * 0.4))

    timers: dict[str, dict] = {}

    def stop(name: str, watch: Stopwatch):
        def at_end() -> None:
            timers[name] = watch.stop()
            scene.timers.append(timers[name])
        return at_end

    for k in range(4):
        scene.line(f"step-{k + 1}", lines[f"step-{k + 1}"], keys, hand(k),
                   on_end=stop("by_hand", by_hand) if k == 3 else None)
    scene.line("step-5", lines["step-5"], keys, graph_step1)
    scene.line("step-6", lines["step-6"], keys, graph_step2, on_end=stop("graphing", graphing))

    # Trap: choice C's points sit on the line; the parabola is at −7 there.
    trap_head = graph_line(0, b["trap"]["heading"], red, 74)
    trap_lines = [graph_line(k + 1, s) for k, s in enumerate(b["trap"]["notepad"])]
    c_points = VGroup(panel.point(3, -4, red, 10), panel.point(4, -3, red, 10))
    c_labels = VGroup(
        panel.label("(3, −4)", 3, -4, LEFT, red, 26),
        panel.label("(4, −3)", 4, -3, RIGHT + DOWN * 0.3, red, 26),
    )

    def trap(d: float) -> None:
        scene.play(*[FadeOut(m) for m in graph_lines], FadeOut(guides), FadeOut(crossing_labels), run_time=0.3)
        scene.play(Write(trap_head), run_time=0.6)
        scene.play(Write(trap_lines[0]), run_time=min(1.2, d * 0.2))
        scene.play(FadeIn(c_points, scale=1.4), FadeIn(c_labels), *[Write(t) for t in trap_lines[1:]],
                   run_time=min(1.4, d * 0.25))

    scene.line("trap", lines["trap"], keys, trap)

    # Answer and quick check: the crossings back, both stopwatches at full, A) written and circled.
    ring = Ellipse(
        width=answer_line.width + px(40), height=answer_line.height + px(46),
        stroke_color=red, stroke_width=7,
    ).move_to(answer_line)

    def answer(d: float) -> None:
        by_hand.dim(1)
        scene.play(FadeOut(trap_head), *[FadeOut(t) for t in trap_lines], FadeOut(c_points), FadeOut(c_labels),
                   run_time=0.3)
        scene.play(*[FadeIn(m) for m in graph_lines], FadeIn(guides), FadeIn(crossing_labels), run_time=0.4)
        scene.play(Write(answer_line), run_time=min(1.2, d * 0.3))
        scene.play(Create(ring), run_time=0.35)

    scene.line("answer", lines["answer"], keys, answer)
    scene.outro()
