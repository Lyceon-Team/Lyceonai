# OQ-51 to OQ-60: for Karl's ruling

Each question in full as recorded in the register (§9), with a recommendation. Rule per question (accept, or the alternative). Screenshot sign-off for the unprototyped pages (UI-57, UI-58's `/notifications` and `/upgrade`, UI-59) and the UI-39 mobile index ([`UI-39-mobile.md`](UI-39-mobile.md)) is yours, before the Codex audit.

## OQ-51

UI-50 choices taken conservatively: (a) "Reading & Writing" (canonical `section-display`, section-vocabulary rule) where the prototype and DESIGN.md say "Reading and Writing"; (b) the old diagnostic prompt modal is removed (no prototype or spec text requires it); (c) a paid student with no calendar set up gets "Set up your study calendar" (DESIGN.md's Settings wording) as the primary, since that state was not prototyped; (d) the prototype's "40 questions" and "Forty practice questions a day" state configurable values (diagnostic length, daily quota) and will drift if configuration changes; (e) the greeting uses the full display name, where the prototype shows a first name. Accept?

**Recommendation:** Accept (a), (b), (c), (e). (d): accept for now, and bind both figures to configuration in Wave 6 so the copy cannot drift from `diagnostic_total_questions` / `daily_quota_free`.

## OQ-52

UI-51 choices taken conservatively: (a) "Suggested for you" ranks measured domains by level first, unmeasured domains after them, ties in canonical order (the prototype shows only measured domains); (b) the diagnostic entry is removed from Practice, so Home is the only one; (c) at 0 remaining, Start is disabled and the shipped `PremiumUpgradePrompt` shows (it still uses the old card tokens); (d) "Weekly Activity" (day streak, questions in 7 days) is removed from Practice, as DESIGN.md has none; (e) "Pick up where you left off" (wiring table §4, not in the prototype) sits after "Suggested for you". Also: OQ-35's "this session is shorter" note is not built yet; the start response does not say the session is shorter, so it needs a server field or the runner row (UI-53). Accept?

**Recommendation:** Accept (a) to (e). The OQ-35 note is now built in the runner (UI-53, question 1). Restyle `PremiumUpgradePrompt` onto student tokens as a small follow-up.

## OQ-53

UI-52 choices taken conservatively: (a) full-length pool rows keep `filters: {test_form_name}` (a strict union with the four criteria keys) so "Practice Test 3" still shows; does that satisfy F-52's "only the four keys"? (b) Review uses the section switch plus own-queue domain chips (DESIGN.md §3/§4 and the prototype), where register §2 says Practice and Review share one filter bar; (c) open-session titles use OQ-22's canonical `sessionTitle` ("Algebra", "Review session") rather than the prototype's "Review queue: Math" / "Redo: …"; (d) domains with nothing waiting show as disabled chips with (0); (e) after F-52 the pool sends safe criteria, but Practice and Home recent-session rows still don't print them. Should they?

**Recommendation:** (a) Yes: the full-length row's single `test_form_name` key is the strict union's only other shape and carries no internals, so it meets F-52's intent. Accept (b), (c), (d). (e) Yes, print the same canonical criteria (`sessionTitle`) on Practice and Home recent rows, as a small follow-up.

## OQ-54

UI-53 choices taken conservatively: (a) the review runner stays on the light lock until its LISA panel moves onto student tokens; (b) the review-queue note shows on a practice miss only (a missed review item is already in the queue); should review show a sentence? (c) End Session is removed from the runner (sessions still end from the Practice and Review rows); (d) LISA stays in the review runner (ruling W4-4) though the prototype does not draw it; (e) the OQ-35 note shows on question 1 only; (f) "Question 1 of M" still states the shortened length, which tells the student how many questions matched (OQ-35 ruled "no number" for the note; M comes from `/next`); (g) `NumericEntryInput` and `MathReferenceSheet`, shared with the timed exam module, now draw on student tokens (the exam module is pinned light). Accept?

**Recommendation:** Accept (a) to (e) and (g). (f) Accept: M is the length of the session the student is in, not a bank count. If you read OQ-35's "no number" as covering it, the alternative is to drop "of M" only when the session is shortened. Add one follow-up row: `ScopedTutorPanel` onto student tokens, which lifts the review runner's light lock (same item as OQ-57 (f)).

## OQ-55

UI-54 choices taken conservatively: (a) the report keeps College Board's weight lines ("26% of the section, 12 to 14 questions", DESIGN.md §4, wiring table §8); `%` is banned everywhere else on the report; (b) completed tests keep the shipped "Take again" beside "View report" (the prototype shows only View report); (c) "Before you start" swaps bullet 2 for the shipped practice-timing line when practice timing is chosen, and bullet 1's "2 hours and 15 minutes" is the prototype's fixed figure; (d) the free right panel shows the locked mastery card (register §2) where the prototype's is empty; (e) the report shows a Timing line (the practice-timing option promises "Your report says so"); "Attempt N" is dropped; (f) Start lands on the session page, so the timer starts there; (g) score history is hidden when empty; (h) a lapsed report opens the upgrade modal once per visit and also offers "Continue". Accept?

**Recommendation:** Accept (a) to (h).

## OQ-56

**Spec vs design on the calendar.** Doc 05F §17.1 and §17.5 (LOCKED) describe the old layout: the left rail with the single edit entry point, the three-zone top bar with "Refresh plan", and the setup popup's free third panel. UI-55 follows DESIGN.md (signed off 2026-10-02) and the register instead, and keeps what the spec requires that the design omits (the streak line, Doc 05F §14; the facts strip, §17.1). Under CLAUDE.md the spec is canonical: does this need an SCL recording DESIGN.md's calendar layout as the V1.0 student layout? Also: (a) the free page has no Week/Month or Regenerate header (both would only answer 402), though the prototype draws one; (b) the free form stays visible and editable after saving, where OQ-25 says free students edit goals in Settings; (c) Edit goals links to `/profile` for both plans; (d) the guardian grid does not star the test day.

**Recommendation:** **Yes, allocate an SCL** amending Doc 05F §17.1 and §17.5 to DESIGN.md's calendar layout (signed off 2026-10-02, after the spec). §17 names `docs/design/calendar-prototype.html` as its visual contract, and DESIGN.md plus `Calendar.dc.html` replaced it. Keep the spec-only items UI-55 kept: the streak line (§14) and the facts strip (§17.1 item 7). Sub-items: accept (a) and (c); (b) make the free form read-only after the first save, with "Edit goals in Settings" per OQ-25; (d) starring the test day on the guardian grid belongs to the guardian vertical (follow-up there).

### OQ-56: spec and design text side by side

| | Doc 05F §17 (LOCKED, `docs/Spec/Lyceon_Doc_05F.md`) | DESIGN.md (signed off 2026-10-02, `docs/plans/student-ui/design/DESIGN.md`) | UI-55 as built |
|---|---|---|---|
| Visual contract | §17: "The visual contract is `docs/design/calendar-prototype.html`, committed and byte-identical to the approved design." | "Source of truth for Waves 4 and 5 of the student UI vertical." Prototype `Calendar.dc.html`. | DESIGN.md / `Calendar.dc.html` |
| Entry point | §17.1: "Reachable from the **Calendar tab in the app's top navigation**, and from a per-student link on the guardian dashboard." | Rail item Calendar (lock as a hint, still navigates); on mobile "Calendar moves off the tab bar … reachable from the avatar menu and from Home." | DESIGN.md |
| Left side | §17.1 (1): "**Left rail** — the Lyceon wordmark (links to the dashboard), the student's identity, a mini-month that navigates the main view, a **\"Your schedule\"** summary line, and block-type filters. The rail carries **no edit control**: **Edit schedule** in the header is the single entry point…" | App shell rail on the left; "Right panel: mini month, navigable; the **goal card** …; the **Show** category filters." | App shell; mini month, goal card, "Your schedule" and Show filters in the **right** panel; no calendar wordmark |
| Top bar | §17.1 (2): "three zones, two rows each. **Left:** **← Dashboard** on top; **Edit schedule** and **Refresh plan** side by side beneath. **Centre:** previous/next, **Today**, the visible range and the **Week / Month** toggle on top (Week default); `🔥 N day streak · N days to test` beneath. **Right:** the **target score** on top and the **projected range** beneath…" | "Header: Week/Month, Today and the arrows on the left; the date range centered (`M/D – M/D`); Edit schedule and **Regenerate plan** (`POST /api/calendar/plan/regenerate`) on the right." | DESIGN.md header; target and projected moved to the goal card; streak line kept (§14) |
| Test day | (not specified) | "**The test day is starred** in week view, month view and the mini month." | starred |
| Facts strip | §17.1 (7): "**Facts strip** — the §14 facts for the visible range." | (not drawn) | kept |
| Free student / setup | §17.5: "A free student sees a third panel after step 2 — what their plan would be, and the upgrade CTA — with their answers already saved either way." (two-step setup popup over a blurred plan) | "Free plan: setup form (test date and target) plus the plan upsell card." | DESIGN.md inline form + upsell card |

## OQ-57

UI-56 choices taken conservatively: (a) with no conversation open, the column is empty under New session with the composer ready and the first message creates the conversation (review panel's W4-4 pattern); "Welcome to LISA" and the subject shortcuts are removed; (b) the end-session confirm drops "It will close and leave your sessions list", false now that ended sessions stay listed (OQ-39 (f)); (c) the crisis and safeguarding cards keep their colour lanes through the `--lv4-*` and `--cat-rw-*` tokens (reusing mastery and calendar tokens); dedicated tokens? (d) Unlock LISA opens the upgrade modal where the prototype links to Settings; (e) the textarea is disabled while LISA thinks, where the prototype disables only Send; (f) the review runner's `ScopedTutorPanel` (frame, header chip, opener, and `LisaUpgradeCard` with the unapproved `LISA_UPGRADE_PITCH.body`) is not yet on student tokens, so the review runner stays on the light lock (OQ-54 (a)); a follow-up row?

**Recommendation:** Accept (a), (b), (d), (e). (c) Accept reusing the existing tokens for now; dedicated safety tokens only if they ever need to diverge. (f) Yes, a follow-up row (see OQ-54).

## OQ-58

UI-57 (not prototyped) choices for Karl's review: (a) the wide mastery row's pill track is 184px, not DESIGN.md's 132px, because the dashed "Not enough answers yet" pill overlapped the meter at 132px; this also moves the meter 52px left on Home; (b) the whole domain row opens its skills in place (several at once, with a chevron), replacing the old "Skills" button and separate screen; Home's "See every skill" lands with every domain closed (no deep link to one domain); (c) skill rows reuse the wide row, so skills are not visually lighter than domains; (d) the free locked card sits in the column, capped at 440px; (e) shipped copy kept: "Your mastery", its description, "Start practising", "Practise <domain>" — British spelling, where the rest of the app writes "Practice"; (f) a 402 still opens the upgrade modal automatically (mastery queries carry no inline meta, as before UI-44) as well as drawing the locked card. Accept?

**Recommendation:** Accept (a) to (d) and (f). (e) Recommend American spelling ("Start practicing", "Practice <domain>") to match the rest of the app; this is a copy change, so it needs your approval.

## OQ-59

UI-58 choices taken conservatively: (a) Help FAQ 5 uses the OQ-38 guardian sentence, where Help.dc.html still has the pre-OQ-38 "your mastery and your test scores"; (b) Billing shows the shipped status label ("Active") instead of "Renews on <date>", because `/api/billing/status` carries no cancel-at-period-end flag, so the date could be false; (c) `PATCH /api/profile/name` sits behind `requireStudentAccount` (students only, plus the under-13 link gate), like the background routes; (d) admins see Account and Appearance only (the name, link and billing routes refuse admins); (e) "Google" as the sign-in method when `hasPassword` is false is new wording; (f) "40 practice questions a day" (Help FAQ, free Billing box) states a configured value (as OQ-51 (d)); (g) the SCL-090 email-suppression notice sits in Account above Delete account, only when the address is suppressed; (h) **`/upgrade`'s shipped plan copy lists "projection access" as a paid feature, but §2 makes the projection free** (Step 2 ruling 4), and "Full KPI", "full-test analytics" and "One secure checkout flow for monthly, quarterly, and yearly subscriptions" are not the design's voice; the page is not prototyped. Replace with approved copy?

**Recommendation:** Accept (a) to (g). (h) Yes, replace `/upgrade`'s plan copy: drop "projection access" (the projection is free) and use approved wording. This needs your copy, or approval of the existing approved strings (UI-44 / OQ-44 modal copy) reused there.

## OQ-60

UI-59 (not prototyped) choices for Karl's review: (a) 404 drops "Did you forget to add the page to the router?" and adds a filled "Back to dashboard" to `/dashboard` (wording reused from the guardian exam results page; `RequireRole` forwards guardians and signed-out visitors); (b) the pending-deletion email note, the guardian-required "why" sentence and the sign-up verification message are no longer `role="alert"` (none is an error), so they are announced politely; (c) guardian-required has no filled button of its own (the link-code panel's actions are outline, from UI-58), its sentences run long in the 480px card, and the panel's email input is shorter than other fields; (d) the card heading is 28px, not the 42px page title; (e) `RequireRole`'s full-page loader stays pinned light, so a dark device sees a light flash on bare routes while auth loads; (f) the global `p { line-height: 1.75 }` loosens card text; (g) the default `Checkbox` variant now has no callers; (h) `autocomplete` tokens (email, name, bday) added, behaviour-neutral

**Recommendation:** Accept (a) to (d), (g), (h). (e) Fix: let `RequireRole`'s loader follow the device theme on Bare routes (a small change, removes the light flash). (f) Leave the global rule; tighten line-height inside the Bare card only.

