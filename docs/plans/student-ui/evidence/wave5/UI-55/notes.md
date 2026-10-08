# UI-55 Calendar — remaining differences from Calendar.dc.html

Captured 2026-10-03 with `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-55`
(`STUDENT_HARNESS_DB=student_e2e_ui55 HARNESS_PORT=5076 STUDENT_HARNESS_VITE_PORT=5195`);
re-captured 2026-10-05 after SCL-211 / OQ-56 (`STUDENT_HARNESS_DB=student_e2e_oq56
HARNESS_PORT=5092 STUDENT_HARNESS_VITE_PORT=5192`); re-captured 2026-10-05 for OQ-63, the shared
full-length phone pre-start check (`STUDENT_HARNESS_DB=student_e2e_precheck HARNESS_PORT=5101
STUDENT_HARNESS_VITE_PORT=5201`).
36 built captures, every one with 0px horizontal overflow and no theme lock (`/calendar` follows
the device theme). See `index.md` for the shot-by-shot table.

Data: the paid student's plan is what the real generator builds on first open, with the SAT date
set (seed `calendar-goal`, real `PUT /api/calendar/profile`) to the Sunday of the capture week, so
"1 days until your SAT" and mostly rest days before today are real output, not a layout choice.
Since OQ-63 the seed also puts a full-length block on today through the real
`PUT /api/calendar/days/:date` (today's blocks carried, a created full-length block with
`form_id` null), so today reads "20 of 36 · edited" and ends with "Full-length test · Full
sitting" in every paid shot. Every capture is taken as a student who has already answered the
site-wide cookie banner (the strictly necessary consent cookie, "Reject analytics"; capture.ts),
so the banner is not drawn over the page.

OQ-63 (owner ruling, Karl, 2026-10-05: "Phone notice: show it for every full-length start on a
phone, including calendar-launched starts. One shared pre-start check, same \"Continue anyway\".
Test it from a calendar block at 390px."):
- `paid-full-length-notice`, 390: today's full-length block, Start. The notice ("Full-length tests
  are built for a laptop or tablet, like test day.", outline Continue anyway, Close) opens as the
  student Modal over the block sheet; nothing is launched. Desktop: the same block's sheet, no
  Start pressed (a control: at lg and up Start launches at once and would leave the page).
- `paid-full-length-continue`: Start, and at 390 Continue anyway. The calendar launch runs and the
  student lands in the sitting (`/tests/<session>`, "Reading & Writing · Module 1 of 2"). The first
  capture creates the session; the later ones find the block started and resume it, so the notice
  is asked for a Resume as for a Start.
- Found by this test and fixed: at 390 the block sheet (z-index 9, shared `calendar.css`) sat under
  the App shell's phone tab bar (z-index 40), which took the tap on the sheet's Start. The student
  sheet and scrim now sit at 45/44 (`calendar-student.css`), above the bars and below the Modal.

Ruled 2026-10-05 (OQ-56, SCL-211): the streak line under the title and the facts strip under the
grid are gone, matching the prototype; the free card is read-only once a profile exists, with
"Edit goals in Settings" (`free-save` ends on it; `free-saved` reloads it). `free-save` deletes the
free student's study profile before each capture so every viewport and theme makes a first save.

Differences kept, and why:

1. (Removed: the streak line, SCL-211.)
2. (Removed: "Your schedule" in the right panel — Karl's ruling on the production QA of
   2026-10-07, item 11(e). The panel is now the prototype's: mini month, goal card, Show.)
3. (Removed: the facts strip, SCL-211.)
4. **No "Training for".** OQ-37 holds the dream school until UI-S8 closes.
5. **Free page has no Week/Month header.** The prototype draws the plan controls over the free
   setup form; a free student has no plan to step through or regenerate (both would 402), so the
   free page starts with the form, whose heading is the page H1 (OQ-56 (a), not ruled; kept). After
   the first save the card keeps its heading and sentence ("Set up your study plan") above the
   read-only answers: existing copy, not new.
6. **Block cards keep the shipped copy** ("Math · 5 questions", "~8 min", "Adv Math 5"), not the
   prototype's sample wording; done blocks keep the shipped strike-through.
7. **Rest days are tinted** (flat margin tone, not hatched since the 2026-10-05 split below) in
   week and month (shipped §14 rule); the prototype has no rest days.
8. **"+ Add block"** keeps its shipped label (prototype: "Add block").
9. **Show labels**: "Reading & Writing" (canonical section name, OQ-51 (a)) for the prototype's
   "Reading and Writing".
10. **Phone day strip** does not star the test day (the selected day's column does). The prototype
    has no phone layout.
11. **The paid setup popup at 390px** (fitted: the card shrinks to the screen and its body scrolls
    so Skip/Continue stay visible) is not captured: neither harness persona is a paid student
    without a profile.

Split 2026-10-05 (Codex audit finding 2; owner ruling, Karl: "split it"): the student page no
longer imports the guardian's legacy `calendar.css`; `calendar-student.css` is its whole
stylesheet (every rule the student tree renders, ported on the tokens; the guardian's rail, `.top`
header and facts strip not ported). Re-captured after the split. Against a capture of the
pre-split tree on the same harness run, the calendar draws the same, with one intended change: rest
days (and a blocked-out day) are flat tints instead of diagonal hatches (DESIGN.md §1, "no
gradients"); visible in `paid-month` (the days after the test date) and on any rest-day column.
Every other pixel difference between the two runs is plan data (block mixes and the projected
range differ from run to run of the harness), not styling. 0px horizontal overflow in all 36 rows.

Production QA 2026-10-07, item 11 (re-captured after the fixes; 50 rows, 0px horizontal overflow
in all). Before/after pairs for each sub-item are in `../../qa-2026-10-07/11a` … `11g`.
- (a) `paid-month`: Month opens today's month (it opened the month of the week's Monday) and is
  read ahead in week view, so its first render is the month, not the held-over week. The days
  after the test date stay empty here because this seed's plan ends on the test day; past the
  test date, a month view shows what the server's 14-day plan horizon holds (handoff, calendar
  vertical).
- (b) new shot `paid-block-sheet`: the block sheet as a modal dialog with Close, focus on Close.
- (c), (d) new shot `paid-week-mid` at 700, 1024 and 1280 (extra viewports): the header laid out
  against the calendar column (stacked under 700px of column, title over controls from 700px, one
  row from 920px) and block cards whose text stays inside them.
- (e) the right panel without "Your schedule"; (f) no "+ Add block" under the test-day card;
  (g) the projected range on one line (`paid-week`, `paid-week-full`).

OQ-66 (c), owner ruling (Karl, 2026-10-07): "the calendar header is at most two rows at 1024px.
Below ~1200px, move Edit schedule and Regenerate plan into a \"⋯\" menu." Re-captured after the
change (56 rows, 0px horizontal overflow in all). Before/after pairs are in
`../../qa-2026-10-07/oq66-c-calendar-header/`.
- Below a 1200px viewport the two buttons are in a "⋯" menu ("More actions"): at 1024
  (`paid-week-mid--w1024`) and 390 (`paid-week--mobile`) the header is two rows, the range title
  with "⋯" at its right end over the view controls (it was three); at 700 the title over the
  controls with "⋯" at the right. At 1280 and 1440 the buttons, unchanged.
- New shot `paid-more-menu`: the menu open at 1024 (extra viewport) and 390, light and dark, in
  the page's theme; at 1440 (control) no "⋯", the two buttons.
- `paid-regenerate` at 390 now chooses Regenerate plan from the menu and reopens it: the item
  reads "Plan regenerated".

Production re-test, round 2 (Karl, 2026-10-08), items C and G. Re-captured after the change
(`STUDENT_HARNESS_DB=qa2c_after HARNESS_PORT=5821 STUDENT_HARNESS_VITE_PORT=5823`; 68 rows, 0px
horizontal overflow in all). Before/after pairs are in `../../qa-2026-10-08/C/` and `../G/`.
- C ("Calendar chips at narrow widths: compact labels that keep the count ('Rev 15', 'Math 5',
  'R&W 15') plus color; never a single letter; no mid-word breaks"): at 1024 and 1280
  (`paid-week-mid`, seven columns under 130px) the card titles are "Rev 7", "Math 5", "R&W 5" in
  the card's colour, and a scope chip keeps one line with its name cut by an ellipsis and its
  count whole ("Data… 5"); before, "Craft & Structur e 5" and "Conventi ons 5" were split and
  "Reading & Writing · 5 questions" took four lines. The month (`paid-month`, new `w1024`) shows
  "Rev 7", "Math 5", "R&W 5" whole at 1024 (it was "Revi…"); at 390 the same labels where it was
  "R…", "M…", "F…". A full-length test keeps its words (OQ-62 (b)) and wraps after the hyphen.
  At 1440 the full wording, as before.
