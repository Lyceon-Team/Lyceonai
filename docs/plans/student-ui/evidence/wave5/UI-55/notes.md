# UI-55 Calendar — remaining differences from Calendar.dc.html

Captured 2026-10-03 with `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-55`
(`STUDENT_HARNESS_DB=student_e2e_ui55 HARNESS_PORT=5076 STUDENT_HARNESS_VITE_PORT=5195`).
28 built captures, every one with 0px horizontal overflow and no theme lock (`/calendar` follows
the device theme). See `index.md` for the shot-by-shot table.

Data: the paid student's plan is what the real generator builds on first open, with the SAT date
set (seed `calendar-goal`, real `PUT /api/calendar/profile`) to the Sunday of the capture week, so
"1 days until your SAT" and mostly rest days before today are real output, not a layout choice.

Differences kept, and why:

1. **Streak line under the title.** The prototype header has no streak; Doc 05F §14 says the streak
   is rendered on the calendar, so the shipped line stays (owner question).
2. **"Your schedule" in the right panel.** Not in the prototype; register §2 moves the calendar's
   schedule summary into the right panel (register wins over DESIGN.md).
3. **Facts strip under the grid.** Not in the prototype; Doc 05F §17.1 item 7 / §14.
4. **No "Training for".** OQ-37 holds the dream school until UI-S8 closes.
5. **Free page has no Week/Month header.** The prototype draws the plan controls over the free
   setup form; a free student has no plan to step through or regenerate (both would 402), so the
   free page starts with the form, whose heading is the page H1 (owner question).
6. **Block cards keep the shipped copy** ("Math · 5 questions", "~8 min", "Adv Math 5"), not the
   prototype's sample wording; done blocks keep the shipped strike-through.
7. **Rest days are hatched** in week and month (shipped §14 rule); the prototype has no rest days.
8. **"+ Add block"** keeps its shipped label (prototype: "Add block").
9. **Show labels**: "Reading & Writing" (canonical section name, OQ-51 (a)) for the prototype's
   "Reading and Writing".
10. **Phone day strip** does not star the test day (the selected day's column does). The prototype
    has no phone layout.
11. **The paid setup popup at 390px** (fitted: the card shrinks to the screen and its body scrolls
    so Skip/Continue stay visible) is not captured: neither harness persona is a paid student
    without a profile.
