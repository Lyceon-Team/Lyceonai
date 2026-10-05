# UI-55 Calendar — remaining differences from Calendar.dc.html

Captured 2026-10-03 with `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-55`
(`STUDENT_HARNESS_DB=student_e2e_ui55 HARNESS_PORT=5076 STUDENT_HARNESS_VITE_PORT=5195`);
re-captured 2026-10-05 after SCL-211 / OQ-56 (`STUDENT_HARNESS_DB=student_e2e_oq56
HARNESS_PORT=5092 STUDENT_HARNESS_VITE_PORT=5192`).
28 built captures, every one with 0px horizontal overflow and no theme lock (`/calendar` follows
the device theme). See `index.md` for the shot-by-shot table.

Data: the paid student's plan is what the real generator builds on first open, with the SAT date
set (seed `calendar-goal`, real `PUT /api/calendar/profile`) to the Sunday of the capture week, so
"1 days until your SAT" and mostly rest days before today are real output, not a layout choice.

Ruled 2026-10-05 (OQ-56, SCL-211): the streak line under the title and the facts strip under the
grid are gone, matching the prototype; the free card is read-only once a profile exists, with
"Edit goals in Settings" (`free-save` ends on it; `free-saved` reloads it). `free-save` deletes the
free student's study profile before each capture so every viewport and theme makes a first save.

Differences kept, and why:

1. (Removed: the streak line, SCL-211.)
2. **"Your schedule" in the right panel.** Not in the prototype; register §2 moves the calendar's
   schedule summary into the right panel (register wins over DESIGN.md).
3. (Removed: the facts strip, SCL-211.)
4. **No "Training for".** OQ-37 holds the dream school until UI-S8 closes.
5. **Free page has no Week/Month header.** The prototype draws the plan controls over the free
   setup form; a free student has no plan to step through or regenerate (both would 402), so the
   free page starts with the form, whose heading is the page H1 (OQ-56 (a), not ruled; kept). After
   the first save the card keeps its heading and sentence ("Set up your study plan") above the
   read-only answers: existing copy, not new.
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
