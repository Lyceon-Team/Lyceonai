"""Video pilots (Manim): a graphing-calculator panel and an on-screen stopwatch, drawn by us.

@spec [owner brief "Video tools pilot" (Karl, 2026-11-02) Part D1: "The graph is drawn by us in
      Manim. Call it 'the graphing method' / 'graphing calculator'" (owner ruling, Karl,
      2026-11-02: no third-party calculator interface, logo or screenshot); Video 2: "An on-screen
      timer ... the times must be honest: they are the durations of each segment as shown in the
      video, so the timer runs on the video clock"] | @implemented [2026-11-02]

plain English:
  GraphPanel: a square-grid xy window (one grid square per unit, axis numbers every `label_every`)
  with plotted functions, marked points, dashed guides from a point to both axes, and labels. It is
  a plain drawing in the brand's ink and red; it imitates no product.
  Stopwatch: "By hand  12.3 s" style readout whose value is the scene's own clock (renderer.time)
  minus the moment start() was called, frozen at stop(). Every digit is drawn up front and shown
  by opacity, because Manim draws a play's moving mobjects from the list it takes when the play
  starts; the value shown is floored to tenths, and stop()
  returns exactly that shown value, which the scene logs.

edge cases: a function is plotted only where it is defined and inside the window, as one piece
per unbroken run of samples; a point outside the window is refused (a read-off that cannot be
seen is not a read-off).
"""

from __future__ import annotations

import math
from collections.abc import Callable

import numpy as np
from manim import (
    BOLD,
    DOWN,
    LEFT,
    DashedLine,
    Dot,
    Line,
    Rectangle,
    Text,
    VGroup,
    VMobject,
)

from layout import at, px, text


class GraphPanel:
    def __init__(
        self,
        scene,
        x_range: tuple[int, int],
        y_range: tuple[int, int],
        unit_px: float,
        top: float,
        label_every: int = 1,
    ) -> None:
        self.scene = scene
        self.x0, self.x1 = x_range
        self.y0, self.y1 = y_range
        self.unit = unit_px
        width = (self.x1 - self.x0) * unit_px
        self.left = (scene.left + scene.right) / 2 - width / 2
        self.top = top
        self.bottom = top + (self.y1 - self.y0) * unit_px
        ink = scene.ink
        grid = VGroup()
        for x in range(self.x0, self.x1 + 1):
            grid.add(Line(self.g(x, self.y0), self.g(x, self.y1), stroke_color=ink, stroke_width=1.5).set_opacity(0.14))
        for y in range(self.y0, self.y1 + 1):
            grid.add(Line(self.g(self.x0, y), self.g(self.x1, y), stroke_color=ink, stroke_width=1.5).set_opacity(0.14))
        axes = VGroup()
        if self.y0 <= 0 <= self.y1:
            axes.add(Line(self.g(self.x0, 0), self.g(self.x1, 0), stroke_color=ink, stroke_width=3.5).set_opacity(0.7))
        if self.x0 <= 0 <= self.x1:
            axes.add(Line(self.g(0, self.y0), self.g(0, self.y1), stroke_color=ink, stroke_width=3.5).set_opacity(0.7))
        numbers = VGroup()
        for x in range(self.x0 + 1, self.x1):
            if x != 0 and x % label_every == 0:
                numbers.add(self.number(str(x).replace("-", "−")).next_to(self.g(x, 0), DOWN, buff=px(6)))
        for y in range(self.y0 + 1, self.y1):
            if y != 0 and y % label_every == 0:
                numbers.add(self.number(str(y).replace("-", "−")).next_to(self.g(0, y), LEFT, buff=px(8)))
        self.frame = VGroup(grid, axes, numbers)

    def number(self, s: str) -> Text:
        return text(s, "Inter", 24, self.scene.ink).set_opacity(0.75)

    def g(self, x: float, y: float) -> np.ndarray:
        """A graph point as a Manim point."""
        return at(self.left + (x - self.x0) * self.unit, self.top + (self.y1 - y) * self.unit)

    def inside(self, x: float, y: float) -> bool:
        return self.x0 <= x <= self.x1 and self.y0 <= y <= self.y1

    def plot(
        self,
        f: Callable[[float], float | None],
        color: str,
        x_from: float | None = None,
        x_to: float | None = None,
        width: float = 6,
        samples: int = 400,
    ) -> VGroup:
        """f over [x_from, x_to] (the window by default), one smooth piece per run inside the window."""
        lo = self.x0 if x_from is None else x_from
        hi = self.x1 if x_to is None else x_to
        pieces: list[list[np.ndarray]] = [[]]
        for k in range(samples + 1):
            x = lo + (hi - lo) * k / samples
            y = f(x)
            if y is None or not self.inside(x, y):
                if pieces[-1]:
                    pieces.append([])
                continue
            pieces[-1].append(self.g(x, y))
        out = VGroup()
        for p in pieces:
            if len(p) >= 2:
                out.add(VMobject(stroke_color=color, stroke_width=width).set_points_smoothly(p))
        return out

    def point(self, x: float, y: float, color: str, radius_px: float = 11) -> Dot:
        if not self.inside(x, y):
            raise ValueError(f"({x}, {y}) is outside the graph window")
        return Dot(self.g(x, y), radius=px(radius_px), color=color)

    def guides(self, x: float, y: float, color: str) -> VGroup:
        """Dashed lines from (x, y) straight to both axes: the read-off."""
        return VGroup(
            DashedLine(self.g(x, y), self.g(x, 0), stroke_color=color, stroke_width=3, dash_length=px(10)),
            DashedLine(self.g(x, y), self.g(0, y), stroke_color=color, stroke_width=3, dash_length=px(10)),
        )

    def label(
        self, s: str, x: float, y: float, direction: np.ndarray, color: str, size: float = 32, buff_px: float = 10
    ) -> Text:
        """Text beside the graph point (x, y), on the `direction` side of it."""
        return text(s, "Inter", size, color, BOLD).next_to(self.g(x, y), direction, buff=px(buff_px))

    def backed_label(
        self, s: str, x: float, y: float, direction: np.ndarray, color: str, size: float = 32, buff_px: float = 10
    ) -> VGroup:
        """A label on a paper-coloured patch, for a point where both graphs pass close by."""
        t = self.label(s, x, y, direction, color, size, buff_px)
        patch = Rectangle(
            width=t.width + px(10), height=t.height + px(10),
            fill_color=self.scene.paper, fill_opacity=0.92, stroke_width=0,
        ).move_to(t)
        return VGroup(patch, t)


def tenths(seconds: float) -> int:
    """Seconds as whole tenths, floored (a stopwatch never shows time that has not passed)."""
    return int(math.floor(seconds * 10 + 1e-9))


class Stopwatch:
    """A label and a readout "12.3 s" at (left, top), running on the scene's clock."""

    def __init__(self, scene, label: str, left: float, top: float, size: float = 52) -> None:
        self.scene = scene
        self.name = label
        self.t0: float | None = None
        self.t1: float | None = None
        ink = scene.ink
        self.label = text(label, "Poppins", 34, ink, BOLD)
        self.label.next_to(at(left, top), DOWN, buff=0).align_to(at(left, 0), LEFT)
        digit_tops = top + 52
        glyphs = [text(str(d), "Poppins", size, ink, BOLD) for d in range(10)]
        slot_w = max(g.width for g in glyphs) + px(2)
        x = at(left, 0)[0]

        def slot() -> VGroup:
            nonlocal x
            group = VGroup(*[g.copy() for g in glyphs])
            for g in group:
                g.next_to(at(0, digit_tops), DOWN, buff=0).set_x(x + slot_w / 2)
            x += slot_w
            return group

        self.tens, self.ones = slot(), slot()
        point = text(".", "Poppins", size, ink, BOLD).next_to(at(0, digit_tops), DOWN, buff=0)
        point.align_to(self.ones[0], DOWN).set_x(x + point.width / 2 + px(2))
        x += point.width + px(4)
        self.tenth = slot()
        unit = text("s", "Poppins", size * 0.8, ink, BOLD).align_to(self.ones[0], DOWN)
        unit.set_x(x + px(12) + unit.width / 2)
        self.static = VGroup(self.label, point, unit)
        self.readout = VGroup(self.tens, self.ones, point, self.tenth, unit)
        self.group = VGroup(self.label, self.readout)
        self.level = 1.0
        self.group.add_updater(lambda m, dt: self.show())
        self.show()

    def dim(self, level: float) -> None:
        """Shows the whole stopwatch at `level` opacity (1 = full). Never set_opacity on the group:
        that would show all ten glyphs of every digit at once."""
        self.level = level
        self.static.set_fill(opacity=level)
        self.show()

    def elapsed(self) -> float:
        if self.t0 is None:
            return 0.0
        end = self.t1 if self.t1 is not None else self.scene.renderer.time
        return max(0.0, end - self.t0)

    def show(self) -> None:
        v = tenths(self.elapsed())
        digits = [(self.tens, (v // 100) % 10, v >= 100), (self.ones, (v // 10) % 10, True), (self.tenth, v % 10, True)]
        for group, d, visible in digits:
            for k, g in enumerate(group):
                g.set_fill(opacity=self.level if visible and k == d else 0)

    def start(self) -> None:
        self.t0 = self.scene.renderer.time

    def stop(self) -> dict:
        """Freezes the readout; returns what it shows and the clock times it measured between."""
        if self.t0 is None:
            raise RuntimeError(f"{self.name} stopwatch stopped before it started")
        self.t1 = self.scene.renderer.time
        shown = tenths(self.t1 - self.t0)
        if shown >= 1000:
            raise RuntimeError(f"{self.name} ran past 99.9 s")
        return {
            "label": self.name,
            "start": round(self.t0, 3),
            "stop": round(self.t1, 3),
            "shown": f"{shown // 10}.{shown % 10} s",
        }


def readout_rows(watches: list[Stopwatch]) -> list[str]:
    """The frozen readouts as text, e.g. "By hand 21.4 s" (for the summary line)."""
    out = []
    for w in watches:
        v = tenths(w.elapsed())
        out.append(f"{w.name} {v // 10}.{v % 10} s")
    return out

