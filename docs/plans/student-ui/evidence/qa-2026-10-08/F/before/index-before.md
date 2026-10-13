# UI-54 Full-Length home (/tests), the exam report and the timed module: free and paid, light and dark, 1440 and 390

Generated 2026-10-08T02:07:01.426Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-54` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844, and any extra size a shot names.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## Full-Length, free: the in-page upgrade card; panel: the locked mastery card. No gated request

Persona: `free`. Route: `/tests`.
Must then show `[data-testid="tests-upgrade-card"]` (the capture fails otherwise).
Prototype: `FullLength.dc.html` (Full-Length, plan = free).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|

## Full-Length, paid: Full-Length Test 1 scored (score + disclosure), Full-Length Test 2 in progress (Resume, the one primary), Full-Length Test 3 not started; Before you start; panel: score history and mastery

Persona: `paid`. Route: `/tests`.
Must then show the text `In progress: Reading & Writing, Module 2` (the capture fails otherwise).
Prototype: `FullLength.dc.html` (Full-Length, plan = paid).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![tests-paid desktop light](tests-paid--desktop--light--built.png)<br>`/tests`, 164 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--paid--light.png), 148 KB |
| desktop | dark | ![tests-paid desktop dark](tests-paid--desktop--dark--built.png)<br>`/tests`, 164 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--paid--dark.png), 150 KB |
| mobile | light | ![tests-paid mobile light](tests-paid--mobile--light--built.png)<br>`/tests`, 67 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--paid--light.png)<br>desktop prototype (no phone layout), 148 KB |
| mobile | dark | ![tests-paid mobile dark](tests-paid--mobile--dark--built.png)<br>`/tests`, 66 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--paid--dark.png)<br>desktop prototype (no phone layout), 150 KB |

## QA2-F (Karl, 2026-10-08: "Full-Length cards: no layout shift on load"): Full-Length, paid, while the tests list loads (`GET /api/tests/forms` held in the browser). The loading rows hold the loaded rows' size, so nothing moves when they land

Persona: `paid`. Route: `/tests`.
Held: the browser's `GET /api/tests/forms` is left unanswered through the screenshot, then aborted (it never reaches the server).
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. A loading state the prototype does not draw.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![tests-paid-loading desktop light](tests-paid-loading--desktop--light--built.png)<br>`/tests`, 146 KB, horizontal overflow 0px | none |
| desktop | dark | ![tests-paid-loading desktop dark](tests-paid-loading--desktop--dark--built.png)<br>`/tests`, 148 KB, horizontal overflow 0px | none |
| mobile | light | ![tests-paid-loading mobile light](tests-paid-loading--mobile--light--built.png)<br>`/tests`, 49 KB, horizontal overflow 0px | none |
| mobile | dark | ![tests-paid-loading mobile dark](tests-paid-loading--mobile--dark--built.png)<br>`/tests`, 48 KB, horizontal overflow 0px | none |
| w1024 | light | ![tests-paid-loading w1024 light](tests-paid-loading--w1024--light--built.png)<br>`/tests`, 120 KB, horizontal overflow 0px | none |
| w1024 | dark | ![tests-paid-loading w1024 dark](tests-paid-loading--w1024--dark--built.png)<br>`/tests`, 121 KB, horizontal overflow 0px | none |

## QA2-F: Full-Length, paid, loaded over a slow network (every `/api/` answer 600ms late): the page's layout shift during load must stay under 0.01 (the run fails otherwise); the measured sum and its largest shifts are under each shot

Persona: `paid`. Route: `/tests`.
Must then show the text `In progress: Reading & Writing, Module 2` (the capture fails otherwise).
Layout shift during load (QA2-F): the sum of the page's `layout-shift` entries without recent input, observed from before the first byte, must be at most 0.01; every `/api/` answer is delayed 600ms in the browser, as over a real network, so the loading state paints first (the run fails otherwise, after this index is written); the sum and the largest shifts are under each built shot.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. A measurement of the load; the loaded page is the tests-paid shot.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![tests-paid-load-shift desktop light](tests-paid-load-shift--desktop--light--built.png)<br>`/tests`, 164 KB, horizontal overflow 0px, layout shift 0.0983 (largest: 0.0768 at 2255ms by div li li section[tests-before] section[tests-mastery]; 0.0143 at 2227ms by section[tests-before]; 0.0064 at 1601ms by footer[legal-footer]; 0.0008 at 1552ms by a a a[rail-lisa] a a[rail-calendar]) | none |
| desktop | dark | ![tests-paid-load-shift desktop dark](tests-paid-load-shift--desktop--dark--built.png)<br>`/tests`, 164 KB, horizontal overflow 0px, layout shift 0.0643 (largest: 0.0571 at 2160ms by section[tests-before] section[tests-mastery]; 0.0064 at 1517ms by footer[legal-footer]; 0.0008 at 1475ms by a a a[rail-lisa] a a[rail-calendar]; 0 at 161ms by span) | none |
| mobile | light | ![tests-paid-load-shift mobile light](tests-paid-load-shift--mobile--light--built.png)<br>`/tests`, 67 KB, horizontal overflow 0px, layout shift 0.0618 (largest: 0.056 at 1491ms by footer[legal-footer]; 0.0045 at 2134ms by section[tests-before]; 0.0014 at 1471ms by a a a a a; 0 at 169ms by span) | none |
| mobile | dark | ![tests-paid-load-shift mobile dark](tests-paid-load-shift--mobile--dark--built.png)<br>`/tests`, 66 KB, horizontal overflow 0px, layout shift 0.0766 (largest: 0.056 at 1446ms by footer[legal-footer]; 0.0159 at 2085ms by div li; 0.0033 at 2066ms by section[tests-before]; 0.0014 at 1429ms by a a a a a; 0 at 126ms by span) | none |
| w1024 | light | ![tests-paid-load-shift w1024 light](tests-paid-load-shift--w1024--light--built.png)<br>`/tests`, 136 KB, horizontal overflow 0px, layout shift 0.1135 (largest: 0.0929 at 2172ms by section[tests-before] section[tests-mastery]; 0.0187 at 1530ms by footer[legal-footer]; 0.002 at 1512ms by a[rail-help] div[rail-account] a[rail-lisa] div[rail-bell] a[rail-calendar]) | none |
| w1024 | dark | ![tests-paid-load-shift w1024 dark](tests-paid-load-shift--w1024--dark--built.png)<br>`/tests`, 135 KB, horizontal overflow 0px, layout shift 0.108 (largest: 0.0799 at 2233ms by div li li section[tests-mastery]; 0.0187 at 1552ms by footer[legal-footer]; 0.0075 at 2177ms by section[tests-before]; 0.002 at 1516ms by a[rail-help] div[rail-account] a[rail-lisa] div[rail-bell] a[rail-calendar]; 0 at 167ms by span) | none |

## Full-Length, paid, full page (on a phone the right panel stacks under the main column; the footer ends the column)

Persona: `paid`. Route: `/tests`.
Must then show the text `In progress: Reading & Writing, Module 2` (the capture fails otherwise).
Full page: the whole document, not just the viewport.
Prototype: `FullLength.dc.html` (Full-Length, plan = paid (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|

## Full-Length on a phone (OQ-63): Resume asks the shared pre-start check, "Full-length tests are built for a laptop or tablet, like test day." with Continue anyway and Close; nothing opened yet. Desktop: no tap, no notice (control)

Persona: `paid`. Route: `/tests`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"tests-resume\"]"}`.
Must then show `[data-testid="tests-home"]` (the capture fails otherwise).
Prototype: none. The prototypes have no phone layout; the notice is the owner ruling of 2026-10-05 (DESIGN.md §2 Mobile).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|

## Exam report (Focus shell), the scored Full-Length Test 1: total out of 1600, sections out of 800, the disclosure; Knowledge and skills, seven segments per domain

Persona: `paid`. Route: `/tests/{paid.scoredExamSessionId}/report`.
Prototype: `Report.dc.html` (Report).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|

## Exam report, full page (on a phone the score card stacks above Knowledge and skills)

Persona: `paid`. Route: `/tests/{paid.scoredExamSessionId}/report`.
Full page: the whole document, not just the viewport.
Prototype: `Report.dc.html` (Report (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|

## The timed module (Full-Length Test 2, Reading and Writing Module 2): Bluebook layout kept, no back arrow, light only; type on the student tokens

Persona: `paid`. Route: `/tests/{paid.inProgressExamSessionId}/RW/2`.
Must fit the viewport (F-69): document no taller than the viewport, window unscrolled, `[data-testid="focus-shell-header"]` wholly in view, nothing to scroll in `main#main` (the capture fails otherwise); the measurement is under each built shot.
Also shot at tablet 820x1180 (the mobile steps and selectors).
Prototype: none. No prototype draws the timed module: DESIGN.md §2 keeps its shipped Bluebook layout (E7b), light only.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|

## Click path (paid): Resume, the page's one primary action (at 390 through the shared pre-start check's Continue anyway), lands on the exam session route and on to the active module

Persona: `paid`. Route: `/tests`.
Step: click `{"desktop":"[data-testid=\"tests-resume\"]","mobile":"[data-testid=\"tests-resume\"]"}`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"full-length-phone-continue\"]"}`.
Click path: must land on a path matching `^/tests/[0-9a-f-]{36}(/RW/[12])?$` (the capture fails otherwise); the path it landed on is under each built shot.
Prototype: none. A click path; its proof is the landing path (the prototype's Resume is not wired).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|

## QA item 5: a test's Start pressed (at 390 after Continue anyway), the create held in flight: 'Starting…' with a spinner, disabled

Persona: `paid`. Route: `/tests`.
Step: click `{"desktop":"[data-testid=\"tests-start\"]","mobile":"[data-testid=\"tests-start\"]"}`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"full-length-phone-continue\"]"}`.
Held: the browser's `POST /api/tests/sessions` is left unanswered through the screenshot, then aborted (it never reaches the server).
Must then show `[data-testid="tests-start"][aria-busy="true"]` (the capture fails otherwise).
Prototype: none. A pending state the prototype does not draw (owner QA list, 2026-10-07, item 5).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"bb39d7b7-f442-433d-b192-758cbd38df36","openPracticeSessionId":"afb91fd9-aef4-401d-9919-62c366dedfb8","openReviewSessionId":null,"diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":13},"paid":{"completedPracticeSessionId":"020eedb2-6ede-4649-936b-e13f23cfb568","openPracticeSessionId":"0b6cdbff-dae6-4b5c-9a9f-e74506983b74","openReviewSessionId":null,"diagnosticSessionId":"0518bea0-026f-4e3c-83a9-27d8933f99d2","scoredExamSessionId":"85747f2f-3593-4257-ac07-04cfc02bfc37","inProgressExamSessionId":"8eca03fb-3a1f-44a2-bf86-95deae4898a3","lisaConversationId":null,"answered":178}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- Desmos (QA2-B, opt-in `STUDENT_HARNESS_DESMOS=1`): not loaded (a local-only run; the calculator shows its unavailable line)
- External hosts blocked: none
