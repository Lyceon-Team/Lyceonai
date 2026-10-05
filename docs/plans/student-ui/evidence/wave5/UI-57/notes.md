# UI-57 Mastery: not prototyped, screenshots for Karl

DESIGN.md §4 lists the Mastery page under "Not prototyped; build to the shell spec and send Karl
screenshots before merge". There is no Mastery prototype, so the prototype column in `index.md`
is a **visual reference only**: the Home prototype (`Main.dc.html`, its Mastery block uses the same
wide rows) beside the paid shots, and the Practice prototype (`Practice.dc.html`, the locked mastery
card in its right panel) beside the free shots.

Captured 2026-10-03 with `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-57`
(`STUDENT_HARNESS_DB=student_e2e_ui57 HARNESS_PORT=5077 STUDENT_HARNESS_VITE_PORT=5197`).
20 built captures, every one with 0px horizontal overflow and no theme lock (`/mastery` follows
the device theme).

Data: the group asks for the `mastery-skills` seed. The harness bank tags every question with the
CI fixture's one placeholder skill (`exg-fixture`); the seed retags the bank, before any answer,
with each domain's canonical skills from `content/canonical/taxonomy.json` (bank content, like the
readable stems). The levels on screen are what the base seed's answers produced through the real
answer path; no mastery row is written by the harness. With that short history most skills are
"Not enough answers yet" and one per domain is measured (Algebra: Linear Equations in One Variable,
Building).

What the page is:

- Page header "Your mastery" and its shipped description; no eyebrow, no in-body Back (UI-41).
- Math, then Reading & Writing (OQ-51), each a section heading over its four domains as wide
  mastery rows (five segments to `mastery_level`, the level pill; unmeasured is the dashed pill).
- Each domain row is a button with a chevron; it opens that domain's skills beneath it (several
  may be open). Skills are wide rows, indented, their meters and pills aligned with the domain's.
- An opened domain with an unmeasured skill offers one outline "Practise <domain>" (RULE 6); a
  student with nothing measured gets one filled "Start practising" under the grid.
- Free: the locked mastery card; "See what's included" opens the upgrade modal for
  `mastery_detail`. No mastery request is made.
- No right panel and no footer (UI-41 route table).

Open visual questions for Karl:

1. **Whole-row disclosure.** A domain opens by clicking its row (chevron at the end). The old page
   had a "Skills" button per card and a separate skills screen with "All domains". Keep the row?
2. **Skill rows use the same wide row as domains** (18px name). Should skills be visually lighter
   (smaller name, or the compact row)?
3. **The wide pill track is 184px, not the prototype's 132px.** At 132px the dashed "Not enough
   answers yet" pill overlapped the meter (every unmeasured skill here; any unmeasured domain on
   Home). Measured pills are right-aligned, so they sit where they did; the meter moves 52px left
   on Home too.
4. **Free layout.** The locked card (designed for a 360px right panel) sits in the reading column,
   capped at 440px, under the same header and description as the paid page.
5. **Hover tint on the opened row** in the screenshots is the pointer resting on it after the
   click, not an "open" style.
