"""Video pilots (Manim): the layout helpers every pilot scene shares.

@spec [owner brief "Video tools pilot" (Karl, 2026-11-02) Part D2 (1080×1920, Caveat / Poppins /
      Inter, safe area x 71..912, y 154..1555) and Part D1 ("reuse and extend this tooling; don't
      fork a second render path": each pilot is a small scene module)] | @implemented [2026-11-02]

plain English: pixel positions (origin top-left, y down) to Manim points, Pango text sized by cap
height so a size in CSS pixels sets the same letter size as the HTML kit, greedy word wrap,
left-aligned paragraphs and fit-to-width. Moved unchanged out of scene.py (D2) so the shared scene
and the per-question modules in pilots/ use one copy; scene.py and pilots/*.py import it, and
neither imports the other (manim loads scene.py under its own module name, so a pilot importing
scene.py would run a second copy of it).

ON_SCREEN records every string `text` sets, in order, so the scene's log carries everything put
on screen for check.ts (S1 on what was drawn, and the word guard). It is a superset of what is shown: wrap's
trial lines are set to be measured. Nothing here logs.
"""

from __future__ import annotations

import numpy as np
from manim import DOWN, LEFT, NORMAL, Mobject, Text, VGroup

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
