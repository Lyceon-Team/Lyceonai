# UI-56 LISA — remaining differences from Lisa.dc.html

Captured 2026-10-03 with `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-56`
(`STUDENT_HARNESS_DB=student_e2e_ui56 HARNESS_PORT=5086 STUDENT_HARNESS_VITE_PORT=5206`).
24 built captures, every one with 0px horizontal overflow and no theme lock (`/chat` follows the
device theme). See `index.md` for the shot-by-shot table.

Data: the paid student's four conversations are created through the real
`POST /api/tutor/conversations`; their turns are rows written the way the tutor's own route tests
seed them (no tutor turn runs in the harness: `POST /api/tutor/messages` would call the model and
Google's safety services, so the harness refuses it, and the typing shot holds the browser's
request instead). The words are the prototype's own sample conversation.

Differences kept, and why:

1. **No subject line under the header** ("Math, today" in the prototype). OQ-39 (g) ruled it
   dropped.
2. **Unlock LISA opens the upgrade modal** (the brief and DESIGN.md §3); in the prototype it is a
   plain link to Settings.
3. **No conversation open** (landing on `/chat`): not drawn by the prototype. Built as an empty
   column under "New session" with the composer ready; the first message creates the
   conversation and is sent there (the in-review panel's W4-4 pattern). The old "Welcome to
   LISA" card and the "What are we working on?" Math / Reading & Writing shortcuts are gone
   (owner question).
4. **The composer's textarea is disabled while LISA is thinking** (shipped behaviour); the
   prototype disables only Send.
5. **Right panel padding** is the App shell's (32px / 48px); the prototype's LISA panel uses
   22px / 28px.
6. **"Show older"** appears only when the server reports another page (more than 20 sessions);
   the seed has four, so the shot does not show it (the test does: 21 sessions, cursor page 2).
7. **History dates** read "Today" or, since owner ruling OQ-66 (g) (Karl, 2026-10-07: US dates
   through the shared formatter), "September 24" where the prototype wrote "24 September"; the
   shipped subject prefix ("Practice ·") is dropped with the header subject.
8. **Phone**: opening a conversation scrolls the page to the newest turn, so the composer is in
   view; the right panel stacks under the composer (DESIGN.md §2 Mobile). The prototype has no
   phone layout.
9. **The typing prototype** is shown idle: its typing state needs a typed draft and the canvas
   steps are clicks only.
10. **Under 13** is not captured: both harness personas are 13 or older. The age state (the
    headline, the server's age message, no button, no request) is covered by
    `client/src/pages/chat.ui56.test.tsx`.

## QA 2026-10-07 (branch `claude/qa-lisa`)

Re-captured with `STUDENT_HARNESS_DB=student_e2e_qalisa HARNESS_PORT=6731
STUDENT_HARNESS_VITE_PORT=6732`; 28 built captures, 0px horizontal overflow in every one, no
theme lock. Before/after pairs are in `../../qa-2026-10-07/lisa-*/`.

- **Send pending (item 5).** From the click until LISA answers, Send reads "Sending…", disabled
  and busy, at full strength (`paid-typing`). It keeps a 118px minimum width so the textarea does
  not jump when the label changes; the prototype's idle Send is narrower (about 84px).
- **New session (item 9)** creates nothing: it opens the empty column; the first message creates
  the conversation (`paid-new-session`: the history keeps five rows, no blank "New session").
  This replaces difference 3's "created then" wording only in that New session no longer
  creates in advance.
- **Empty prompt (item 15)**: the empty column shows "Ask LISA about a question you missed or a
  skill you're working on." PROPOSED copy, awaiting Karl's approval. Not in the prototype.
- **Picked session on a phone (item 15)**: picking a session from the history (under the
  composer) brings the conversation and its composer to the bottom of the screen
  (`paid-pick-session`); difference 8 now also holds for a pick, not only for the first open.
- **Crisis titles (item 1, UI part)**: the seed adds a crisis-flagged conversation whose server
  title is its first message; the history and header show "Conversation" (every paid shot).
- **Composer textarea (difference 4)**: still disabled while a message is on its way.
