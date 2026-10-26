# Lyceon Student UI: Design Spec

Source of truth for Waves 4 and 5 of the student UI vertical. Signed off by Karl on 2026-10-02.

- **Prototype screens:** `prototype/*.dc.html`. Open them in a browser to inspect layout and behavior; they are reference, not code to copy. The live canvas is https://claude.ai/artifact/ATJjfZK3wmGY3KDTajZoe4.
- **Tokens:** `tokens.css` holds every color in both themes. Port them into the Tailwind theme and CSS variables. No raw hex in components.
- **Where this spec and the register disagree, the register wins.** Report the conflict as an owner question.

Data in the prototype is illustrative. Every number in production comes from an existing endpoint (see the wiring table the brief asks for).

---

## 1. Visual system

**Direction.** A textbook: cream paper, navy ink, hairline rules instead of shadows and glows, no gradients, serif headings.

**Typography.**
- Headings: Source Serif 4 (600). Body and UI: Source Sans 3 (400, 500, 600). Self-host both (closes UI-12).
- Scale used: page title 42px; section heading 28px; panel heading 20px; body 16–19px; meta 14–15px.
- **Nothing below 14px anywhere.**

**Color.**
- All colors come from `tokens.css`, in two sets: light (`.lyc`) and dark (`.lyc.dark`).
- **Mastery ramp** (`--lv0` to `--lv4`): Foundations amber, Building orange, Developing sky, Proficient blue, Strong emerald. It follows `LevelPill.tsx`.
- **Calendar categories** (`--cat-*`): Math blue, Reading and Writing plum, Review amber, practice test navy.
- **Dark theme:** deep ink-blue page and warm off-white text, not pure black. The primary button inverts to a cream fill with navy text.

**Hierarchy.**
- One primary action per screen, filled `--primary-bg`. Everything else is outline (`--ink-strong` 1px border) or a text link.
- Only real inline links are underlined.

**Focus and motion.**
- Visible focus ring on every interactive element: 3px `--focus`, 2px offset.
- Motion is limited to the LISA typing dots, and those respect `prefers-reduced-motion`.

---

## 2. Shells (exactly three)

### App shell
- **Left rail,** 96px, `--rail` background:
  - top: logo mark with the "Lyceon" wordmark under it;
  - then Home, Practice, Review, Full-Length, Calendar, LISA, with icon above label;
  - bottom: the bell, labelled **Notifications** and drawn as a rail item (icon above label, the rail's shared current style on `/notifications`, light and dark; production re-test, Karl, 2026-10-08, item H), then Help, then the account avatar. The avatar opens the account menu (**Settings, Help, Sign out**) at every width, desktop included (owner QA list, Karl, 2026-10-07, item 3; it used to open Settings directly, which left desktop with no Sign out in the shell).
- **Middle column:** the only part that scrolls. Content max-width 800px, padding 56px 72px.
- **Right panel,** 360px (Calendar 340px, LISA 320px), `--margin` background, hairline left rule. Its content depends on the page.
- **Fit to screen:** the rail and the right panel are fixed to the viewport height. The right panel scrolls on its own only when its content is taller than the screen. Only the middle column scrolls the page.
- **Slim legal footer** at the end of the middle column on Home, Practice, Review, Full-Length, Settings and Help: `© 2026 Lyceon · Privacy Policy · Terms · Trust and Safety · Help and FAQs`. 14px, muted, underline on hover. Calendar and LISA rely on the Help page for these links.
- **Free plan:**
  - Full-Length and LISA show a small lock on the rail. Clicking either opens the upgrade modal in place, with no navigation and no call to the gated endpoint.
  - Calendar shows the lock as a hint but navigates to its page, which does its own upsell (Doc 05F).

### Focus shell
- No rail and no right panel.
- Top bar: back arrow plus the section name on the left, then context. The back target goes to the previous in-app page, or else the section's home, with no full reloads.
- Used by: the practice and review runners, the exam session and report pages.
- **The timed exam module** keeps its Bluebook layout, with no back arrow and **light theme only**.

### Bare card
- A centered card on `--paper`.
- Used by: login, signup, profile completion, update password, account recovery, the pending-deletion screen, 404, and the error screen.

**Mobile (OQ-4, ruled 2026-10-02; navigation per owner ruling, Karl, 2026-10-05; supersedes OQ-4, OQ-48 and the Full-Length part of OQ-62).**
- Below `lg` (1024px) the rail becomes a bottom tab bar of five: **Home, Review, Practice, Calendar, LISA**, with Practice in the middle. The bar has its own order; the desktop rail keeps its own (Home, Practice, Review, Full-Length, Calendar, LISA, unchanged). Calendar keeps its lock as a hint and navigates; LISA's lock opens the upgrade modal, as on the rail.
- A top bar carries the logo, the bell and the account avatar. The avatar menu holds **Settings, Help, Sign out**, in that order. An admin keeps the avatar menu at every width, with Crisis review before Sign out.
- The avatar menu follows the page theme: a light page has a light menu, a dark page a dark one, and a page pinned light a light one (register §8 F-70).
- **Full-Length is on neither the tab bar nor the avatar menu.** On a phone it is reached only from a scheduled full-length block on the calendar, Home's "Take a full-length test" row, or the Practice page's Full-length row (§4 Home; owner ruling, Karl, 2026-10-15, on #1233). The official SAT (Bluebook) can't be taken on a phone; full-length tests belong on a laptop or tablet.
- **Full-Length on a phone still works and is never blocked.** The notice "Full-length tests are built for a laptop or tablet, like test day." with **Continue anyway** is shown for every full-length start on a phone (Full-Length home, calendar block, Today's plan, Pick up), one shared check (owner ruling, Karl, 2026-10-05, OQ-63). Home's and Practice's Full-Length rows only open the Full-Length page, whose starts ask. It opens as a student modal before the start goes ahead; Continue anyway performs the start and is remembered for the visit (this tab); closing it cancels the start and creates nothing. The notice's action is an outline button, never a filled primary. The exam session, module and report pages never show it.
- Students still land on Home after sign-in.
- The right panel's content stacks below the main content.
- The Focus shell and the Bare card are unchanged on mobile.

---

## 3. Shared components

| Component | Where | Notes |
|---|---|---|
| Mastery row | Home (wide), Practice, Review, Full-Length (compact), Mastery page | Five segments filled to the level, plus a level pill. Unmeasured shows empty segments and a dashed "Not enough answers yet" pill. Values: `mastery_level` only. |
| Locked mastery card | Right panel, free plan | "Track mastery by domain and skills", empty segment outlines (never fake data), "See what's included" opens the modal. |
| Upgrade modal | Rail locks, locked cards, any `entitlement_required` response | Feature-keyed copy. LISA uses the shipped headline "A Tutor That Knows The SAT And Knows You". "See plans" goes to Settings → Billing. |
| Filter bar | Practice | Section switch; criteria chips with "Clear all"; Domain, Skill and Difficulty dropdowns that cascade. **No bank counts anywhere.** |
| Domain chips | Review | Counts come from the student's own queue, which is allowed. |
| Report segments | Exam report | Seven flat navy segments per domain from `segmentsFilled`. Deliberately not the mastery colors. |
| Ruler progress | Diagnostic card, free daily quota | 40 ticks, a taller tick every fifth. |
| Typing indicator | LISA | A LISA-labelled bubble with three pulsing dots. Send is disabled while LISA is thinking. |
| Footer | See App shell | |
| Keyboard hook | Runner, LISA, modals | One shared hook. The prototype shows **no keystroke hint text** (Karl's ruling). |
| SAT-date picker | Onboarding, Settings, Home's date card, the calendar (setup, free plan, schedule sheet) | One component, `components/sat-dates/SatDatePicker.tsx`: a dropdown multi-select. Closed: "Not sure yet", one date, or "first date + N more". Open: "Not sure yet" pinned first, then the future official dates with checkboxes, scrolling inside the menu; each choice clears the other. Offers no date past the furthest one the profile write accepts, served as `latest_test_date` by the role-agnostic `GET /api/sat-dates/bound` (one bound for every surface and every signed-in account; Karl, ruling 2 on #1204, 2026-10-11, and the ruling on #1211, 2026-10-12). Added 2026-10-11 (Karl). Under the question, the helper line "Pick every date you might take"; only the date list scrolls, so Done is always on screen (first-run activation brief, Karl, 2026-10-13). |
| Clamped label | Any long label in a row or card | `ClampedLabel` (`components/student-ui`): two lines and an ellipsis; full text on hover and on focus within its row. Added 2026-10-11 (Karl). |
| Pill | The question runner's header, LISA's question chip | `Pill` (`components/student-ui`): a small neutral pill, `--chip` fill, `--rule` border, 14px semibold `--ink`. No colour variants: a pill names something, it never grades it. Added 2026-10-13 (Karl, ruling on #1225). |
| LISA chat dock | Home, Review, the review runner, the practice runner after submit; tablet and desktop only (768px and up) | `ChatDock` (`components/tutor/ChatDock.tsx`), one component for all three. **Collapsed: the "Ask LISA" launcher** (`components/tutor/LisaLauncher.tsx`; owner brief "LISA launcher redesign + placement", Karl, 2026-10-23, option D, which replaced the round 56px bubble): a speech-bubble-shaped button, one line and 40px tall (132px wide), 14px corners with the bottom-right one 4px, the sparkle icon (lucide `Sparkles`, one component, `LisaSparkle`; owner ruling 2026-10-23: "Tabler sparkles" meant the sparkle, not the package) and the label "Ask LISA", filled with the accent `--primary-bg` and its on-accent `--primary-ink`, the focus ring; accessible name "Ask LISA". **The launcher is the one filled control allowed beside a page's own primary action:** the owner chose its accent fill (option D), so §5's one-filled-action rule counts the page's actions, not LISA's entry (the Home and Review tests pin that it is the only exception). **Expanded:** it grows upward from the launcher into a panel, min(380px, the column's width − 24px) wide and up to 70vh, `--sheet` with a `--rule-strong` hairline (no shadow); the header has the sparkle, "LISA", the question chip in a runner, and **Minimize** (back to the launcher, the draft and thread kept) and **Close** (back to the launcher, the panel's state dropped). Non-modal: no overlay, no focus trap, `role="dialog"`, `aria-modal="false"`, named by its header; it takes focus when opened and Esc minimizes (the shared keyboard hook). It never opens by itself; its state lasts the page visit. **Placement (2026-10-23): LISA belongs to the column where the student is working, never over the rail or the right panel.** On Home and Review it is anchored to the bottom-right of the middle column (the shell's `main`), 16px in, and stays in view while that column scrolls; below lg, where the right panel stacks under the column, it rides up with the column's bottom edge rather than over the panel. In a runner it is anchored to the bottom-right of the question area, above the Submit/Next row and clear of the calculator. Always above whatever fixed chrome is at the bottom, measured through `lib/bottom-chrome.ts` (the phone tab bar and the cookie banner, which stack; the runner's Submit/Next footer), plus the safe area; below the toast layer and every modal. **Opening lines (owner copy, 2026-10-23):** Home "What do you want to work on?"; Review "Want help with your past mistakes?"; in a runner before submit the W4-4 opener, unchanged ("Need help with this question? I can walk you through it. I won't give you the answer before you submit."), and after submit "Want to walk through this one? Ask me about any step." (owner ruling, Karl, 2026-10-23). **Free plan:** the same launcher with the rail's lock in the sparkle's place; it opens the upgrade modal for LISA in place (the rail's own `featureLockReason`; no tutor request). **Phones (below 768px): no launcher and no dock**; the LISA tab and the runner's stacked panel are unchanged. **Send** (in the dock and the runner's phone panel) is an outline icon button, a paper plane named "Send", so the page under it keeps its one filled button (ruling 4, Karl, 2026-10-23, on #1300; /chat keeps its labelled Send). **Calculator:** the launcher never covers it; beside the question Desmos keeps the launcher's measured footprint (the `dock-bubble` layer of `lib/bottom-chrome.ts`) clear at its bottom (ruling 5, 2026-10-23). "Open in LISA" is approved wording (ruling 3, 2026-10-23). Owner brief, Karl, 2026-10-22 ("floating bubble, no bar"); rulings on #1300, 2026-10-23; launcher brief, Karl, 2026-10-23 (option D). |

---

## 4. Screens

**Home.**
- Paid: greeting and date line; today's plan (from the calendar) with "Start today's plan" as the primary action; Mastery (wide rows); "Pick up where you left off".
- Today's plan rows act through text links; "Start today's plan" is Home's only filled button. "This week" ticks each day with an answered question (the streak's own days); the plan's completion is the line under the strip. The diagnostic card's action reads "Find your blind spots", or "Resume · question N of 40" while one is open (a sitting in progress is resumed from "Pick up where you left off"). The Question of the Day's email prompt opens only after the explanation is closed (Done), never over it; a student who answered and left before Done is asked once on the next Home visit the same America/Chicago day (first-run activation brief, Karl, 2026-10-13; ruling on #1233, 2026-10-15).
- Right panel: projected score, this week's seven-day strip, recent sessions.
- **The LISA chat dock** (§3), tablet and desktop: the "Ask LISA" launcher at the bottom-right of the middle column (never over the rail or the right panel) opens LISA in general mode, on the same thread as the LISA page (below), opening with "What do you want to work on?". Free: the launcher's lock opens the upgrade modal. Not on a phone (owner brief, Karl, 2026-10-22; launcher brief, 2026-10-23).
- Free: the diagnostic card (ruler, "Start diagnostic") and "How Lyceon works" (three steps tagged Free or Paid plans). Right panel: projection empty state, locked mastery card, today's quota ruler.
- **Three equal entry points**, on both plans and at every screen size, as one compact section at the bottom of the main column (owner ruling, Karl, 2026-10-15, on #1233; supersedes the 2026-10-05 "Start a full-length test" card, final brief v2 §4's removal of it, and that brief's "Go to Practice" / "Go to Review" outline buttons). Three rows of equal weight and one height, in order (wording: owner ruling, Karl, 2026-10-15, superseding the first copy and its failed-read fallback): **"Work on new questions"** ("Any skill, any difficulty", Start → Practice), **"Fix past mistakes"** ("{N} waiting", or "All caught up" at 0, from the review pool's own total; no line at all when that read fails; Start → Review), **"Take a full-length test"** ("Timed, like test day", Start → the Full-Length page). The titles say what the student does and do not repeat the rail's section names. Each row is a title, one muted line and a text-link action, the size of a "Pick up" row; no filled button, so Home keeps its one primary. All three links say "Start", so each is named with its row's title ("Start Work on new questions"). Locked for a free student, Full-Length's Start shows the lock and opens the upgrade modal in place, as the rail lock does (no navigation, no call to the gated endpoint). On a phone this row is Home's way to Full-Length; starting a test there still asks the laptop-or-tablet check.

**Practice.**
- The filter bar, then "Your session": a plain-language summary of the selection, "Questions per session" (5–30 in steps of 5) and Start. Free plans add the quota line.
- "Suggested for you" (paid only): the two lowest-level domains in the section; the button sets the filter. Then "Recent practice".
- Right panel: compact mastery rows and "How practice counts".

**Review.**
- Queue card ("N questions to review", Start reviewing).
- Open sessions, each named by its criteria, with End and Continue.
- Review by topic: section switch and own-queue domain chips.
- "Redo a past session" as a collapsed dropdown, "Past sessions (N)": grouped by date, 5 shown, then Load more (UI-16 cursor).
- Right panel: what's waiting by section, and mastery.
- **The LISA chat dock** (§3), tablet and desktop, in general mode, as on Home, in the middle column, opening with "Want help with your past mistakes?" (owner brief, Karl, 2026-10-22; launcher brief, 2026-10-23).

**Full-Length home.**
- The test list with status per test; the single primary action is the most relevant one (Resume, otherwise Start).
- "Before you start".
- Right panel: score history linking to reports, and mastery.
- Free plan: an in-page upgrade card.
- Page title "Full-Length" (owner naming ruling, Karl, 2026-10-05: every student-facing "Tests" label becomes "Full-Length"; the `/tests` route stays).
- Reached from the desktop rail, from Home's "Take a full-length test" row, from the Practice page's Full-length row and from a scheduled full-length block on the calendar; on a phone only from those two rows and the calendar block (owner ruling, Karl, 2026-10-05; Home's row per the ruling of 2026-10-15 on #1233).
- On a phone: the laptop-or-tablet notice with Continue anyway is shown for every full-length start on a phone (Full-Length home, calendar block, Today's plan, Pick up), one shared check (owner ruling, Karl, 2026-10-05, OQ-63; §2 Mobile). The home itself is not held: Start and Resume ask.

**Exam report** (Focus shell).
- Total score out of 1600 and section scores out of 800.
- The "Lyceon-modeled SAT score" disclosure and "Review your answers".
- "Knowledge and skills" with seven segments per domain. Domain weight lines come from College Board's published specification. **No percentiles, no correct/total.**

**Calendar** (Canvas-style).
- Header: Week/Month, Today and the arrows on the left; the date range centered (`M/D – M/D`); Edit schedule and **Regenerate plan** (`POST /api/calendar/plan/regenerate`) on the right. At most two rows at 1024px; below a ~1200px viewport Edit schedule and Regenerate plan move into a "⋯" menu ("More actions"), on a phone too (owner ruling, Karl, 2026-10-07, OQ-66 (c)).
- Week grid with category-striped blocks, and Month view. Where a column is too narrow for a block's full title (under 130px), the card and the month chip show the compact label that keeps the count, in the block's colour: "Rev 15", "Math 5", "R&W 15"; a full-length test keeps its words. Never a single letter, never a word split; a scope chip keeps one line and cuts its name with an ellipsis, its count whole. The full title stays in the accessible name (owner ruling, Karl, 2026-10-08, production re-test item C).
- **The test day is starred** in week view, month view and the mini month.
- Right panel:
  - mini month, navigable;
  - the **goal card**, centered and large: days until the SAT, a ★ date pill, Target and Projected side by side (free: Target only), "Training for" the dream school, and "Edit goals";
  - the **Show** category filters.
- Free plan: setup form (test date and target) plus the plan upsell card.

**LISA.**
- The conversation in a 760px reading column; the composer; Enter sends, Shift+Enter adds a new line; the disclaimer "LISA can make mistakes; your practice results are the source of truth".
- Right panel: New session, the history list with "Show older" (UI-16 cursor).
- Free plan: the shipped headline and "Unlock LISA".
- **One thread with the chat dock** (owner brief, Karl, 2026-10-22). The dock in general mode (Home, Review) opens on the student's most recent active session, the one at the top of "Your sessions", and its first message, with none open, starts a session exactly as this page does, so it appears here. The dock's "Open in LISA" opens that session on this page. A runner's dock is scoped to its question and keeps the question's own conversation (one per item, as before). **Since F-91 (ruling 1, Karl, 2026-10-23, on #1300) those conversations are listed in "Your sessions" too**, each labelled with its question ("Review question" or "Practice question", from the conversation's own surface: never the stem, the answer or the explanation), and open here read-only, with the line "This conversation is about one question. To keep going, open LISA on that question." (proposed wording, awaiting Karl). The page itself has no bubble.

**Question runner** (Focus shell).
- Top bar: back to Practice, session name, "Question N of M" with a progress strip, Calculator, Reference.
- **Question header** (owner brief, Karl, 2026-10-13; style ruled on #1225 the same day), above the stem on the **practice, review and diagnostic** runners. **The timed full-length module has none**: it stays Bluebook-like, and its payload carries no domain, skill or difficulty.
  - Three small pills: the domain, the skill and the difficulty (Easy, Medium or Hard). All three use the shared neutral pill (`Pill` in `components/student-ui`: `--chip` fill, `--rule` border, 14px semibold `--ink`), the same one as LISA's question chip. The difficulty is **not colour-coded**: no green, amber or red.
  - Desktop (from `lg`, 1024px): one row, domain, skill, difficulty.
  - Phone: row 1 is domain and difficulty; row 2 is the skill alone, clamped to two lines with `ClampedLabel`.
  - The skill pill is the header's **one keyboard focus stop**, with the focus ring; focusing it shows the full skill name, as hovering does (§5 Long labels). Screen readers read domain, skill, difficulty in that order, with the difficulty as "Difficulty: Easy".
  - A part the question lacks is left out; with nothing to show there is no header.
- Body: the stem and the choices, **lettered A–D by on-screen position** (ruled 2026-10-02). Then the feedback panel after submitting, showing the correct answer and the student's pick, the explanation, and the review-queue note on a miss.
- **Letters are display labels, never the canonical stored option letters.** "B" always means the second option on screen. Whatever LISA receives about this question must carry the choices in their displayed order with their display letters, so "the answer is B" means the same thing to the student and to LISA. No letter mapping may expose which option is correct before submission.
- Footer: Skip and Submit (disabled until a choice is made), then Next question.
- **LISA** (review runner throughout; the practice runner **after submit only**, ruling 2, Karl, 2026-10-23, on #1300: no bubble before the current question is submitted, and Next takes it away; the diagnostic has none, and practice has none on a phone). From 768px up it is the chat dock (§3), opened in the current question's scope (the "Question N of M" chip, the item's own conversation): the launcher sits at the bottom-right of the question area, above the footer and clear of the choices (below 1040px the question column keeps the launcher's 156px clear on its right; it was 888px and 80px for the round bubble), and the open panel sits above the footer too, so Submit, Next and the choices stay usable. **After a wrong answer** (practice after submit, and review; never after a correct answer, before submit, in the diagnostic or the full-length test), one muted text link under the explanation, "Still confused? Ask LISA", opens the panel already scoped to that question; whether the answer was wrong is the server's submit response the page already has (owner brief "LISA launcher", Karl, 2026-10-23). This replaces the 360px panel beside the question and its Show/Hide LISA toggle on desktop (owner brief, Karl, 2026-10-22). On a phone nothing changed: LISA stacks under the question, closed until the bar's LISA icon opens it (QA2-D). What LISA can and cannot do before and after submit is unchanged; the server decides.
- Keys: ↑/↓ choose, Enter submits, Enter or → goes next.
- On a phone, after Submit the feedback panel is scrolled into view (no animation).
- After the last question of a practice or review session: the session summary, in the Focus shell: score (correct of answered, and skips), the streak kept today, how many questions went to review, and the skills whose mastery level the server recorded changing (nothing drawn when none did). Without mastery detail (free), one muted locked line instead: "Track how this moves your mastery — included with paid plans", a link to the plans page. Actions: "Review misses" (the filled primary when there are misses) and "Another 5". A finished diagnostic keeps its card (first-run activation brief, Karl, 2026-10-13; rulings on #1233, 2026-10-15).

**Settings** (App shell, no right panel; a section list on the left).
- **Profile:**
  - Name.
  - Test date and target, **only when a calendar profile exists**; otherwise "Set up your study calendar" (OQ-20). Saved via `PUT /api/calendar/profile`.
  - "About you": graduation year, GPA range, high school search, up to three dream schools. **Hidden until the privacy-policy row UI-S8 closes.**
- **Account:** email and sign-in method, read-only. Change password with the current password required; hidden for Google-only accounts (F-38). The Delete account box.
- **Guardian:** link status, the code with copy, email and new-code actions, and the "what a guardian can see" sentence.
- **Billing:** three states from `managedBy` and the plan: self (Manage billing, which opens Stripe), guardian ("Managed by your guardian", no button), free (See plans).
- **Notifications:** the standard "Email notifications" switch only.
- **Appearance:** Match device, Light or Dark, stored per device. The timed exam module is always light.

**Help.**
- Seven FAQs, which are approved copy; "Contact support"; the Policies list; the footer.
- The Help rail item opens it.

**Not prototyped; build to the shell spec and send Karl screenshots before merge:**
- the Mastery page (domain grid with mastery rows, then the skills list per domain);
- Notifications;
- the upgrade/plans page;
- the bare-card pages;
- the pending-deletion screen.

---

## 5. UI standards

Standing rules for every student screen, new or changed. Added by Karl on 2026-10-11, and referenced from the repo's `CLAUDE.md` so every session applies them. **Every new screen is checked against this list in its PR description (a short checklist), with screenshots attached** (light and dark, 1440 and 390).

**Choosing from options.**
- 2–3 options: a segmented control or radio buttons (the student `Tabs` for switching views; a chip row with radio semantics for a setting).
- 4 or more options: a dropdown (`Select` with `variant="lyc"`).
- Multi-select: a dropdown with checkboxes (`DropdownMenu` with `DropdownMenuCheckboxItem`, as the filter bar and the SAT-date picker do; the menu stays open while choosing).
- More than about 10 options of names or text: a dropdown with type-to-filter search.
- More than about 10 options in a natural order (dates, numbers): a scrollable dropdown, no filter (the list is already sorted, so the student scrolls to the value; e.g. the SAT-date picker). Amended by Karl on 2026-10-11 (ruling 1 on #1204).
- Never render a long option list inline on the page.

**Actions.** One filled primary action per screen. Everything else is outline or a text link.

**Type and color.** Text is never below 14px. Tokens only; no raw hex.

**Lists on a card.** A list longer than about 5 rows shows 5, then "Show more" or "Load more".

**Long labels.** Truncate to 2 lines with an ellipsis, with the full text on hover and focus (`ClampedLabel`). A label never pushes the layout.

**States.** Every data area has an empty, a loading and an error state: the student `EmptyState`, the still `Skeleton variant="lyc"` (or `FullPageLoader` for a whole page) and a `Notice`. Never blank space, and never a bare "Loading…".

