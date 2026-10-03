# Student UI design package

Signed off by Karl on 2026-10-02. Source of truth for Waves 4 and 5, with the register
(`../student-ui-vertical.md`) winning wherever the two disagree.

- `DESIGN.md`: the spec.
- `tokens.css`: every color, in light (`.lyc`) and dark (`.lyc.dark`) sets.
- `prototype/*.dc.html`: reference screens (Main, Practice, Review, Runner, FullLength, Report,
  Calendar, Lisa, Settings, Help). Live canvas: https://claude.ai/artifact/ATJjfZK3wmGY3KDTajZoe4.

The prototypes load `./support.js` (the canvas runtime), which is not part of this package, so they do
not render from a plain checkout; use the live canvas to see them. Their data is illustrative only.
