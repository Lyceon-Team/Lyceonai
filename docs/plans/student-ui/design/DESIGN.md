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
- **Full-Length is on neither the tab bar nor the avatar menu.** On a phone it is reached only from a scheduled full-length block on the calendar or Home's "Start a full-length test" card (§4 Home). The official SAT (Bluebook) can't be taken on a phone; full-length tests belong on a laptop or tablet.
- **Full-Length on a phone still works and is never blocked.** The notice "Full-length tests are built for a laptop or tablet, like test day." with **Continue anyway** is shown for every full-length start on a phone (Full-Length home, Home card, calendar block, Today's plan), one shared check (owner ruling, Karl, 2026-10-05, OQ-63). It opens as a student modal before the start goes ahead; Continue anyway performs the start and is remembered for the visit (this tab); closing it cancels the start and creates nothing. The notice's action is an outline button, never a filled primary. The exam session, module and report pages never show it.
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

---

## 4. Screens

**Home.**
- Paid: greeting and date line; today's plan (from the calendar) with "Start today's plan" as the primary action; Mastery (wide rows); "Pick up where you left off".
- Right panel: projected score, this week's seven-day strip, recent sessions.
- Free: the diagnostic card (ruler, "Start diagnostic") and "How Lyceon works" (three steps tagged Free or Paid plans). Right panel: projection empty state, locked mastery card, today's quota ruler.
- **"Start a full-length test" card**, on both plans and at every screen size (owner ruling, Karl, 2026-10-05; supersedes OQ-4, OQ-48 and the Full-Length part of OQ-62). Paid: after today's plan. Free: last in the main column, after "How Lyceon works". Titled "Full-Length", with the Full-Length page's subtitle ("Timed like test day: two modules per section, a break between sections, and a scored report at the end.") and the outline action "Start a full-length test", which goes to the Full-Length page. Locked for a free student: the action shows the lock and opens the upgrade modal in place, as the rail lock does (no navigation, no call to the gated endpoint). It is an outline button: Home keeps its one filled primary.

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

**Full-Length home.**
- The test list with status per test; the single primary action is the most relevant one (Resume, otherwise Start).
- "Before you start".
- Right panel: score history linking to reports, and mastery.
- Free plan: an in-page upgrade card.
- Page title "Full-Length" (owner naming ruling, Karl, 2026-10-05: every student-facing "Tests" label becomes "Full-Length"; the `/tests` route stays).
- Reached from the desktop rail, from Home's "Start a full-length test" card and from a scheduled full-length block on the calendar; on a phone only from the Home card and the calendar block (owner ruling, Karl, 2026-10-05; supersedes OQ-4, OQ-48 and the Full-Length part of OQ-62).
- On a phone: the laptop-or-tablet notice with Continue anyway is shown for every full-length start on a phone (Full-Length home, Home card, calendar block, Today's plan), one shared check (owner ruling, Karl, 2026-10-05, OQ-63; §2 Mobile). The home itself is not held: Start and Resume ask.

**Exam report** (Focus shell).
- Total score out of 1600 and section scores out of 800.
- The "Lyceon-modeled SAT score" disclosure and "Review your answers".
- "Knowledge and skills" with seven segments per domain. Domain weight lines come from College Board's published specification. **No percentiles, no correct/total.**

**Calendar** (Canvas-style).
- Header: Week/Month, Today and the arrows on the left; the date range centered (`M/D – M/D`); Edit schedule and **Regenerate plan** (`POST /api/calendar/plan/regenerate`) on the right. At most two rows at 1024px; below a ~1200px viewport Edit schedule and Regenerate plan move into a "⋯" menu ("More actions"), on a phone too (owner ruling, Karl, 2026-10-07, OQ-66 (c)).
- Week grid with category-striped blocks, and Month view.
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

**Question runner** (Focus shell).
- Top bar: back to Practice, session name, "Question N of M" with a progress strip, Calculator, Reference.
- Body: the stem and the choices, **lettered A–D by on-screen position** (ruled 2026-10-02). Then the feedback panel after submitting, showing the correct answer and the student's pick, the explanation, and the review-queue note on a miss.
- **Letters are display labels, never the canonical stored option letters.** "B" always means the second option on screen. Whatever LISA receives about this question must carry the choices in their displayed order with their display letters, so "the answer is B" means the same thing to the student and to LISA. No letter mapping may expose which option is correct before submission.
- Footer: Skip and Submit (disabled until a choice is made), then Next question.
- Keys: ↑/↓ choose, Enter submits, Enter or → goes next.

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
