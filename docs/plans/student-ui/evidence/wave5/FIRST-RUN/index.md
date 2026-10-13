# First-run activation fixes: session summaries, Home, in-shell error screen, QOTD prompt, sign-in (light and dark, 1440 and 390)

Generated 2026-10-13T09:01:37.375Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts FIRST-RUN` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844, and any extra size a shot names.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## Practice session summary: score with skips, streak kept, sent to review, the recorded mastery change if any; Review misses (primary) and Another 5

Persona: `paid`. Route: `/practice/session/{session}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["M"],"target_question_count":5}`.
Full page: the whole document, not just the viewport.
Prototype: none. NOT PROTOTYPED: new in the first-run activation brief (Karl, 2026-10-13), built to DESIGN.md §5; these screenshots go to Karl before merge.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![summary-practice desktop light](summary-practice--desktop--light--built.png)<br>`/practice/session/8595db7f-2d4d-4f0b-82e1-ecb16eecf963`, 43 KB, horizontal overflow 0px | none |
| desktop | dark | ![summary-practice desktop dark](summary-practice--desktop--dark--built.png)<br>`/practice/session/dc9a245a-9478-4c6c-92e9-7fd010f55d6a`, 37 KB, horizontal overflow 0px | none |
| mobile | light | ![summary-practice mobile light](summary-practice--mobile--light--built.png)<br>`/practice/session/584ea59a-3a67-4bb7-8a4e-3aea05232701`, 30 KB, horizontal overflow 0px | none |
| mobile | dark | ![summary-practice mobile dark](summary-practice--mobile--dark--built.png)<br>`/practice/session/14dfc1da-cb12-4d57-af5e-89456b5f523f`, 37 KB, horizontal overflow 0px | none |

## Review session summary: the same pattern ('back in your review queue')

Persona: `paid`. Route: `/review/session/{session}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":3}`.
Full page: the whole document, not just the viewport.
Prototype: none. NOT PROTOTYPED: new in the first-run activation brief (Karl, 2026-10-13), built to DESIGN.md §5; these screenshots go to Karl before merge.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![summary-review desktop light](summary-review--desktop--light--built.png)<br>`/review/session/5fb8763c-2c79-4e24-8f63-22087c54a7d8`, 44 KB, horizontal overflow 0px | none |
| desktop | dark | ![summary-review desktop dark](summary-review--desktop--dark--built.png)<br>`/review/session/5fac1b3e-619c-4036-992d-1069279de1dc`, 45 KB, horizontal overflow 0px | none |
| mobile | light | ![summary-review mobile light](summary-review--mobile--light--built.png)<br>`/review/session/3abe0d9d-d44d-44a4-bfde-11173c3f103c`, 37 KB, horizontal overflow 0px | none |
| mobile | dark | ![summary-review mobile dark](summary-review--mobile--dark--built.png)<br>`/review/session/b0a5d6e2-b659-401c-99c6-d15234f7a943`, 37 KB, horizontal overflow 0px | none |

## Home, paid: the QOTD card in place, today's plan rows as text links ('Start today's plan' the one filled button), 'This week' ticks

Persona: `paid`. Route: `/dashboard`.
Today's question unanswered before each capture (scheduled if missing; the persona's answer, qotd session and email-prompt state deleted).
Full page: the whole document, not just the viewport.
Prototype: none. NOT PROTOTYPED: new in the first-run activation brief (Karl, 2026-10-13), built to DESIGN.md §5; these screenshots go to Karl before merge.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-paid desktop light](home-paid--desktop--light--built.png)<br>`/dashboard`, 131 KB, horizontal overflow 0px | none |
| desktop | dark | ![home-paid desktop dark](home-paid--desktop--dark--built.png)<br>`/dashboard`, 132 KB, horizontal overflow 0px | none |
| mobile | light | ![home-paid mobile light](home-paid--mobile--light--built.png)<br>`/dashboard`, 249 KB, horizontal overflow 0px | none |
| mobile | dark | ![home-paid mobile dark](home-paid--mobile--dark--built.png)<br>`/dashboard`, 254 KB, horizontal overflow 0px | none |

## Home, paid, scrolled to today's plan (the first row's link focused): each row acts through a text link, 'Start today's plan' the one filled button

Persona: `paid`. Route: `/dashboard`.
Step: focus `{"desktop":"[data-testid=\"home-plan-start\"]","mobile":"[data-testid=\"home-plan-start\"]"}` (no typing).
Must then show `[data-testid="home-start-plan"]` (the capture fails otherwise).
Prototype: none. NOT PROTOTYPED: new in the first-run activation brief (Karl, 2026-10-13), built to DESIGN.md §5; these screenshots go to Karl before merge.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-paid-plan desktop light](home-paid-plan--desktop--light--built.png)<br>`/dashboard`, 132 KB, horizontal overflow 0px | none |
| desktop | dark | ![home-paid-plan desktop dark](home-paid-plan--desktop--dark--built.png)<br>`/dashboard`, 132 KB, horizontal overflow 0px | none |
| mobile | light | ![home-paid-plan mobile light](home-paid-plan--mobile--light--built.png)<br>`/dashboard`, 48 KB, horizontal overflow 0px | none |
| mobile | dark | ![home-paid-plan mobile dark](home-paid-plan--mobile--dark--built.png)<br>`/dashboard`, 48 KB, horizontal overflow 0px | none |

## Home, paid, at the review cap: the notice's 'Continue your open session' wraps inside the panel

Persona: `paid`. Route: `/dashboard`.
At the review-session cap before each capture: queue review sessions are opened through the real `POST /api/review/sessions` until the server itself refuses one with `SESSION_LIMIT_EXCEEDED`; the ones opened are ended through the real terminate route after the shot.
Must then show `[data-testid="review-cap"]` wholly inside the viewport (the capture fails otherwise).
Step: click `{"desktop":"[data-testid=\"home-recent-review\"]","mobile":"[data-testid=\"home-recent-review\"]"}`.
Prototype: none. NOT PROTOTYPED: new in the first-run activation brief (Karl, 2026-10-13), built to DESIGN.md §5; these screenshots go to Karl before merge.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-review-cap desktop light](home-review-cap--desktop--light--built.png)<br>`/dashboard`, 126 KB, horizontal overflow 0px | none |
| desktop | dark | ![home-review-cap desktop dark](home-review-cap--desktop--dark--built.png)<br>`/dashboard`, 128 KB, horizontal overflow 0px | none |
| mobile | light | ![home-review-cap mobile light](home-review-cap--mobile--light--built.png)<br>`/dashboard`, 58 KB, horizontal overflow 0px | none |
| mobile | dark | ![home-review-cap mobile dark](home-review-cap--mobile--dark--built.png)<br>`/dashboard`, 59 KB, horizontal overflow 0px | none |

## A page's code chunk fails twice: one automatic reload, then the error screen inside the App shell (rail; tab bar on a phone)

Persona: `paid`. Route: `/mastery`.
Failed in the browser: requests whose path matches `^/assets/mastery-[^/]+\.js$` get a network error and never reach the server. The Mastery page's lazy chunk fails to load, as after a deploy replaces it; the first failure reloads once, the second shows the in-shell error screen.
Prototype: none. NOT PROTOTYPED: new in the first-run activation brief (Karl, 2026-10-13), built to DESIGN.md §5; these screenshots go to Karl before merge.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![route-error-in-shell desktop light](route-error-in-shell--desktop--light--built.png)<br>`/mastery`, 41 KB, horizontal overflow 0px | none |
| desktop | dark | ![route-error-in-shell desktop dark](route-error-in-shell--desktop--dark--built.png)<br>`/mastery`, 41 KB, horizontal overflow 0px | none |
| mobile | light | ![route-error-in-shell mobile light](route-error-in-shell--mobile--light--built.png)<br>`/mastery`, 30 KB, horizontal overflow 0px | none |
| mobile | dark | ![route-error-in-shell mobile dark](route-error-in-shell--mobile--dark--built.png)<br>`/mastery`, 29 KB, horizontal overflow 0px | none |

## QOTD answered: the explanation with Done, and no email prompt over it

Persona: `paid`. Route: `/dashboard`.
Today's question unanswered before each capture (scheduled if missing; the persona's answer, qotd session and email-prompt state deleted).
Step: click `{"desktop":"[data-testid=\"home-qotd\"] [data-testid=\"runner-choice\"]","mobile":"[data-testid=\"home-qotd\"] [data-testid=\"runner-choice\"]"}`.
Step: click `{"desktop":"[data-testid=\"home-qotd-submit\"]","mobile":"[data-testid=\"home-qotd-submit\"]"}`.
Must then show `[data-testid="home-qotd-done"]` (the capture fails otherwise).
Must then show no `[data-testid="qotd-email-prompt"]` (the capture fails otherwise).
Prototype: none. NOT PROTOTYPED: new in the first-run activation brief (Karl, 2026-10-13), built to DESIGN.md §5; these screenshots go to Karl before merge.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![qotd-explanation-first desktop light](qotd-explanation-first--desktop--light--built.png)<br>`/dashboard`, 133 KB, horizontal overflow 0px | none |
| desktop | dark | ![qotd-explanation-first desktop dark](qotd-explanation-first--desktop--dark--built.png)<br>`/dashboard`, 134 KB, horizontal overflow 0px | none |
| mobile | light | ![qotd-explanation-first mobile light](qotd-explanation-first--mobile--light--built.png)<br>`/dashboard`, 36 KB, horizontal overflow 0px | none |
| mobile | dark | ![qotd-explanation-first mobile dark](qotd-explanation-first--mobile--dark--built.png)<br>`/dashboard`, 36 KB, horizontal overflow 0px | none |

## QOTD: Done closes the explanation, then the email prompt opens

Persona: `paid`. Route: `/dashboard`.
Today's question unanswered before each capture (scheduled if missing; the persona's answer, qotd session and email-prompt state deleted).
Step: click `{"desktop":"[data-testid=\"home-qotd\"] [data-testid=\"runner-choice\"]","mobile":"[data-testid=\"home-qotd\"] [data-testid=\"runner-choice\"]"}`.
Step: click `{"desktop":"[data-testid=\"home-qotd-submit\"]","mobile":"[data-testid=\"home-qotd-submit\"]"}`.
Step: click `{"desktop":"[data-testid=\"home-qotd-done\"]","mobile":"[data-testid=\"home-qotd-done\"]"}`.
Must then show the text `Keep your streak alive 🔥` (the capture fails otherwise).
Prototype: none. NOT PROTOTYPED: new in the first-run activation brief (Karl, 2026-10-13), built to DESIGN.md §5; these screenshots go to Karl before merge.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![qotd-prompt-after-done desktop light](qotd-prompt-after-done--desktop--light--built.png)<br>`/dashboard`, 158 KB, horizontal overflow 0px | none |
| desktop | dark | ![qotd-prompt-after-done desktop dark](qotd-prompt-after-done--desktop--dark--built.png)<br>`/dashboard`, 154 KB, horizontal overflow 0px | none |
| mobile | light | ![qotd-prompt-after-done mobile light](qotd-prompt-after-done--mobile--light--built.png)<br>`/dashboard`, 54 KB, horizontal overflow 0px | none |
| mobile | dark | ![qotd-prompt-after-done mobile dark](qotd-prompt-after-done--mobile--dark--built.png)<br>`/dashboard`, 53 KB, horizontal overflow 0px | none |

## Sign in: the Lyceon logo (a link to /) and the 'Password' placeholder

Persona: `signed-out`. Route: `/login`.
Cookie banner already answered (the real `lyceon_consent` cookie, analytics rejected, current banner version).
Prototype: none. NOT PROTOTYPED: new in the first-run activation brief (Karl, 2026-10-13), built to DESIGN.md §5; these screenshots go to Karl before merge.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![sign-in desktop light](sign-in--desktop--light--built.png)<br>`/login`, 43 KB, horizontal overflow 0px | none |
| desktop | dark | ![sign-in desktop dark](sign-in--desktop--dark--built.png)<br>`/login`, 43 KB, horizontal overflow 0px | none |
| mobile | light | ![sign-in mobile light](sign-in--mobile--light--built.png)<br>`/login`, 37 KB, horizontal overflow 0px | none |
| mobile | dark | ![sign-in mobile dark](sign-in--mobile--dark--built.png)<br>`/login`, 38 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"1b3b16cd-3461-4731-9723-7a7af2fc5fcd","openPracticeSessionId":"3fc48003-4fb5-47f3-9aaf-4e6a9bfe93ef","openReviewSessionId":"21470d4d-2903-4573-abc2-b1c602346ddf","diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":39},"paid":{"completedPracticeSessionId":"41324c45-1cc7-43e0-b992-034c13fbe429","openPracticeSessionId":"061d9292-25c8-4c65-8c45-808bd41c7b5a","openReviewSessionId":"d10f2b3c-c1ea-46f5-add6-4f2f7f5ead0d","diagnosticSessionId":"554ac3e0-0741-429a-82d8-ba0eeee277d9","scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":79}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- Desmos (QA2-B, opt-in `STUDENT_HARNESS_DESMOS=1`): not loaded (a local-only run; the calculator shows its unavailable line)
- External hosts blocked: none
