# UI-54 Full-Length home (/tests), the exam report and the timed module: free and paid, light and dark, 1440 and 390

Generated 2026-10-08T03:35:07.445Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-54` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

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
| desktop | light | ![tests-free desktop light](tests-free--desktop--light--built.png)<br>`/tests`, 85 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--free--light.png), 67 KB |
| desktop | dark | ![tests-free desktop dark](tests-free--desktop--dark--built.png)<br>`/tests`, 86 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--free--dark.png), 68 KB |
| mobile | light | ![tests-free mobile light](tests-free--mobile--light--built.png)<br>`/tests`, 58 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--free--light.png)<br>desktop prototype (no phone layout), 67 KB |
| mobile | dark | ![tests-free mobile dark](tests-free--mobile--dark--built.png)<br>`/tests`, 58 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--free--dark.png)<br>desktop prototype (no phone layout), 68 KB |

## Full-Length, paid: Full-Length Test 1 scored (score + disclosure), Full-Length Test 2 in progress (Resume, the one primary), Full-Length Test 3 not started; Before you start; panel: score history and mastery

Persona: `paid`. Route: `/tests`.
Must then show the text `In progress: Reading & Writing, Module 2` (the capture fails otherwise).
Prototype: `FullLength.dc.html` (Full-Length, plan = paid).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![tests-paid desktop light](tests-paid--desktop--light--built.png)<br>`/tests`, 165 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--paid--light.png), 148 KB |
| desktop | dark | ![tests-paid desktop dark](tests-paid--desktop--dark--built.png)<br>`/tests`, 165 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--paid--dark.png), 150 KB |
| mobile | light | ![tests-paid mobile light](tests-paid--mobile--light--built.png)<br>`/tests`, 67 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--paid--light.png)<br>desktop prototype (no phone layout), 148 KB |
| mobile | dark | ![tests-paid mobile dark](tests-paid--mobile--dark--built.png)<br>`/tests`, 67 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--paid--dark.png)<br>desktop prototype (no phone layout), 150 KB |

## QA2-F (Karl, 2026-10-08: "Full-Length cards: no layout shift on load"): Full-Length, paid, while the tests list loads (`GET /api/tests/forms` held in the browser). The loading rows hold the loaded rows' size, so nothing moves when they land

Persona: `paid`. Route: `/tests`.
Held: the browser's `GET /api/tests/forms` is left unanswered through the screenshot, then aborted (it never reaches the server).
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. A loading state the prototype does not draw.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![tests-paid-loading desktop light](tests-paid-loading--desktop--light--built.png)<br>`/tests`, 119 KB, horizontal overflow 0px | none |
| desktop | dark | ![tests-paid-loading desktop dark](tests-paid-loading--desktop--dark--built.png)<br>`/tests`, 120 KB, horizontal overflow 0px | none |
| mobile | light | ![tests-paid-loading mobile light](tests-paid-loading--mobile--light--built.png)<br>`/tests`, 49 KB, horizontal overflow 0px | none |
| mobile | dark | ![tests-paid-loading mobile dark](tests-paid-loading--mobile--dark--built.png)<br>`/tests`, 49 KB, horizontal overflow 0px | none |
| w1024 | light | ![tests-paid-loading w1024 light](tests-paid-loading--w1024--light--built.png)<br>`/tests`, 112 KB, horizontal overflow 0px | none |
| w1024 | dark | ![tests-paid-loading w1024 dark](tests-paid-loading--w1024--dark--built.png)<br>`/tests`, 112 KB, horizontal overflow 0px | none |

## QA2-F: Full-Length, paid, loaded over a slow network (every `/api/` answer 600ms late): the page's layout shift during load must stay under 0.01 (the run fails otherwise); the measured sum and its largest shifts are under each shot

Persona: `paid`. Route: `/tests`.
Must then show the text `In progress: Reading & Writing, Module 2` (the capture fails otherwise).
Layout shift during load (QA2-F): the sum of the page's `layout-shift` entries without recent input, observed from before the first byte, must be at most 0.01; every `/api/` answer is delayed 600ms in the browser, as over a real network, so the loading state paints first (the run fails otherwise, after this index is written); the sum and the largest shifts are under each built shot.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. A measurement of the load; the loaded page is the tests-paid shot.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![tests-paid-load-shift desktop light](tests-paid-load-shift--desktop--light--built.png)<br>`/tests`, 165 KB, horizontal overflow 0px, layout shift 0.0002 (largest: 0.0002 at 1448ms by span span a[rail-lisa] span a[rail-calendar]; 0 at 135ms by span) | none |
| desktop | dark | ![tests-paid-load-shift desktop dark](tests-paid-load-shift--desktop--dark--built.png)<br>`/tests`, 165 KB, horizontal overflow 0px, layout shift 0.0002 (largest: 0.0002 at 1446ms by span span a[rail-lisa] span a[rail-calendar]; 0 at 130ms by span) | none |
| mobile | light | ![tests-paid-load-shift mobile light](tests-paid-load-shift--mobile--light--built.png)<br>`/tests`, 67 KB, horizontal overflow 0px, layout shift 0.0001 (largest: 0.0001 at 1413ms by span span span span span; 0 at 113ms by span) | none |
| mobile | dark | ![tests-paid-load-shift mobile dark](tests-paid-load-shift--mobile--dark--built.png)<br>`/tests`, 67 KB, horizontal overflow 0px, layout shift 0.0001 (largest: 0.0001 at 1454ms by span span span span span; 0 at 125ms by span) | none |
| w1024 | light | ![tests-paid-load-shift w1024 light](tests-paid-load-shift--w1024--light--built.png)<br>`/tests`, 136 KB, horizontal overflow 0px, layout shift 0.0009 (largest: 0.0009 at 1408ms by a[rail-help] div[rail-account] a[rail-lisa] button[button-notifications] a[rail-calendar]; 0 at 126ms by span) | none |
| w1024 | dark | ![tests-paid-load-shift w1024 dark](tests-paid-load-shift--w1024--dark--built.png)<br>`/tests`, 135 KB, horizontal overflow 0px, layout shift 0.0009 (largest: 0.0009 at 1463ms by a[rail-help] div[rail-account] a[rail-lisa] button[button-notifications] a[rail-calendar]; 0 at 125ms by span) | none |

## QA2-F: Home's Full-Length card (paid), loaded over a slow network (every `/api/` answer 600ms late): the page's layout shift during load must stay under 0.01 (the run fails otherwise); the measured sum and its largest shifts are under each shot

Persona: `paid`. Route: `/dashboard`.
Layout shift during load (QA2-F): the sum of the page's `layout-shift` entries without recent input, observed from before the first byte, must be at most 0.01; every `/api/` answer is delayed 600ms in the browser, as over a real network, so the loading state paints first (the run fails otherwise, after this index is written); the sum and the largest shifts are under each built shot.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. A measurement of the load; Home itself is UI-50's.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-full-length-load-shift desktop light](home-full-length-load-shift--desktop--light--built.png)<br>`/dashboard`, 133 KB, horizontal overflow 0px, layout shift 0.0002 (largest: 0.0002 at 1445ms by span span a[rail-lisa] span a[rail-calendar]; 0 at 132ms by span) | none |
| desktop | dark | ![home-full-length-load-shift desktop dark](home-full-length-load-shift--desktop--dark--built.png)<br>`/dashboard`, 134 KB, horizontal overflow 0px, layout shift 0.0002 (largest: 0.0002 at 1454ms by span span a[rail-lisa] span a[rail-calendar]; 0 at 141ms by span) | none |
| mobile | light | ![home-full-length-load-shift mobile light](home-full-length-load-shift--mobile--light--built.png)<br>`/dashboard`, 53 KB, horizontal overflow 0px, layout shift 0.0001 (largest: 0.0001 at 1437ms by span span span span span; 0 at 133ms by span) | none |
| mobile | dark | ![home-full-length-load-shift mobile dark](home-full-length-load-shift--mobile--dark--built.png)<br>`/dashboard`, 54 KB, horizontal overflow 0px, layout shift 0.0001 (largest: 0.0001 at 1434ms by span span span span span; 0 at 126ms by span) | none |
| w1024 | light | ![home-full-length-load-shift w1024 light](home-full-length-load-shift--w1024--light--built.png)<br>`/dashboard`, 116 KB, horizontal overflow 0px, layout shift 0.0009 (largest: 0.0009 at 1451ms by a[rail-help] div[rail-account] a[rail-lisa] button[button-notifications] a[rail-calendar]; 0 at 141ms by span) | none |
| w1024 | dark | ![home-full-length-load-shift w1024 dark](home-full-length-load-shift--w1024--dark--built.png)<br>`/dashboard`, 118 KB, horizontal overflow 0px, layout shift 0.0009 (largest: 0.0009 at 1422ms by a[rail-help] div[rail-account] a[rail-lisa] button[button-notifications] a[rail-calendar]; 0 at 132ms by span) | none |

## QA2-F: Home's Full-Length card (free: the locked action), loaded over a slow network: layout shift during load under 0.01

Persona: `free`. Route: `/dashboard`.
Layout shift during load (QA2-F): the sum of the page's `layout-shift` entries without recent input, observed from before the first byte, must be at most 0.01; every `/api/` answer is delayed 600ms in the browser, as over a real network, so the loading state paints first (the run fails otherwise, after this index is written); the sum and the largest shifts are under each built shot.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. A measurement of the load; Home itself is UI-50's.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-full-length-load-shift-free desktop light](home-full-length-load-shift-free--desktop--light--built.png)<br>`/dashboard`, 141 KB, horizontal overflow 0px, layout shift 0.0002 (largest: 0.0002 at 1454ms by span span a[rail-calendar] button[rail-lisa] span; 0 at 140ms by span) | none |
| desktop | dark | ![home-full-length-load-shift-free desktop dark](home-full-length-load-shift-free--desktop--dark--built.png)<br>`/dashboard`, 142 KB, horizontal overflow 0px, layout shift 0.0002 (largest: 0.0002 at 1458ms by span span a[rail-calendar] button[rail-lisa] span; 0 at 133ms by span) | none |
| mobile | light | ![home-full-length-load-shift-free mobile light](home-full-length-load-shift-free--mobile--light--built.png)<br>`/dashboard`, 63 KB, horizontal overflow 0px, layout shift 0.0001 (largest: 0.0001 at 1427ms by span span span span span; 0 at 127ms by span) | none |
| mobile | dark | ![home-full-length-load-shift-free mobile dark](home-full-length-load-shift-free--mobile--dark--built.png)<br>`/dashboard`, 64 KB, horizontal overflow 0px, layout shift 0.0001 (largest: 0.0001 at 1419ms by span span span span span; 0 at 119ms by span) | none |
| w1024 | light | ![home-full-length-load-shift-free w1024 light](home-full-length-load-shift-free--w1024--light--built.png)<br>`/dashboard`, 112 KB, horizontal overflow 0px, layout shift 0.0009 (largest: 0.0009 at 1434ms by button[button-notifications] a[rail-help] a[rail-calendar] button[rail-lisa] div[rail-account]; 0 at 119ms by span) | none |
| w1024 | dark | ![home-full-length-load-shift-free w1024 dark](home-full-length-load-shift-free--w1024--dark--built.png)<br>`/dashboard`, 113 KB, horizontal overflow 0px, layout shift 0.0009 (largest: 0.0009 at 1441ms by button[button-notifications] a[rail-help] a[rail-calendar] button[rail-lisa] div[rail-account]; 0 at 118ms by span) | none |

## Full-Length, paid, full page (on a phone the right panel stacks under the main column; the footer ends the column)

Persona: `paid`. Route: `/tests`.
Must then show the text `In progress: Reading & Writing, Module 2` (the capture fails otherwise).
Full page: the whole document, not just the viewport.
Prototype: `FullLength.dc.html` (Full-Length, plan = paid (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![tests-paid-full desktop light](tests-paid-full--desktop--light--built.png)<br>`/tests`, 165 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--paid--light.png), 148 KB |
| desktop | dark | ![tests-paid-full desktop dark](tests-paid-full--desktop--dark--built.png)<br>`/tests`, 165 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--paid--dark.png), 150 KB |
| mobile | light | ![tests-paid-full mobile light](tests-paid-full--mobile--light--built.png)<br>`/tests`, 199 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--paid--light.png)<br>desktop prototype (no phone layout), 148 KB |
| mobile | dark | ![tests-paid-full mobile dark](tests-paid-full--mobile--dark--built.png)<br>`/tests`, 201 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--paid--dark.png)<br>desktop prototype (no phone layout), 150 KB |

## Full-Length on a phone (OQ-63): Resume asks the shared pre-start check, "Full-length tests are built for a laptop or tablet, like test day." with Continue anyway and Close; nothing opened yet. Desktop: no tap, no notice (control)

Persona: `paid`. Route: `/tests`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"tests-resume\"]"}`.
Must then show `[data-testid="tests-home"]` (the capture fails otherwise).
Prototype: none. The prototypes have no phone layout; the notice is the owner ruling of 2026-10-05 (DESIGN.md §2 Mobile).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![tests-phone-notice desktop light](tests-phone-notice--desktop--light--built.png)<br>`/tests`, 165 KB, horizontal overflow 0px | none |
| desktop | dark | ![tests-phone-notice desktop dark](tests-phone-notice--desktop--dark--built.png)<br>`/tests`, 165 KB, horizontal overflow 0px | none |
| mobile | light | ![tests-phone-notice mobile light](tests-phone-notice--mobile--light--built.png)<br>`/tests`, 66 KB, horizontal overflow 0px | none |
| mobile | dark | ![tests-phone-notice mobile dark](tests-phone-notice--mobile--dark--built.png)<br>`/tests`, 64 KB, horizontal overflow 0px | none |

## Exam report (Focus shell), the scored Full-Length Test 1: total out of 1600, sections out of 800, the disclosure; Knowledge and skills, seven segments per domain

Persona: `paid`. Route: `/tests/{paid.scoredExamSessionId}/report`.
Prototype: `Report.dc.html` (Report).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![report-scored desktop light](report-scored--desktop--light--built.png)<br>`/tests/d5056fdb-a88c-46db-abfa-bfe47ef4e744/report`, 123 KB, horizontal overflow 0px | ![prototype light](proto--Report--noplan--light.png), 95 KB |
| desktop | dark | ![report-scored desktop dark](report-scored--desktop--dark--built.png)<br>`/tests/d5056fdb-a88c-46db-abfa-bfe47ef4e744/report`, 111 KB, horizontal overflow 0px | ![prototype dark](proto--Report--noplan--dark.png), 96 KB |
| mobile | light | ![report-scored mobile light](report-scored--mobile--light--built.png)<br>`/tests/d5056fdb-a88c-46db-abfa-bfe47ef4e744/report`, 55 KB, horizontal overflow 0px | ![prototype light](proto--Report--noplan--light.png)<br>desktop prototype (no phone layout), 95 KB |
| mobile | dark | ![report-scored mobile dark](report-scored--mobile--dark--built.png)<br>`/tests/d5056fdb-a88c-46db-abfa-bfe47ef4e744/report`, 55 KB, horizontal overflow 0px | ![prototype dark](proto--Report--noplan--dark.png)<br>desktop prototype (no phone layout), 96 KB |

## Exam report, full page (on a phone the score card stacks above Knowledge and skills)

Persona: `paid`. Route: `/tests/{paid.scoredExamSessionId}/report`.
Full page: the whole document, not just the viewport.
Prototype: `Report.dc.html` (Report (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![report-scored-full desktop light](report-scored-full--desktop--light--built.png)<br>`/tests/d5056fdb-a88c-46db-abfa-bfe47ef4e744/report`, 110 KB, horizontal overflow 0px | ![prototype light](proto--Report--noplan--light.png), 95 KB |
| desktop | dark | ![report-scored-full desktop dark](report-scored-full--desktop--dark--built.png)<br>`/tests/d5056fdb-a88c-46db-abfa-bfe47ef4e744/report`, 111 KB, horizontal overflow 0px | ![prototype dark](proto--Report--noplan--dark.png), 96 KB |
| mobile | light | ![report-scored-full mobile light](report-scored-full--mobile--light--built.png)<br>`/tests/d5056fdb-a88c-46db-abfa-bfe47ef4e744/report`, 55 KB, horizontal overflow 0px | ![prototype light](proto--Report--noplan--light.png)<br>desktop prototype (no phone layout), 95 KB |
| mobile | dark | ![report-scored-full mobile dark](report-scored-full--mobile--dark--built.png)<br>`/tests/d5056fdb-a88c-46db-abfa-bfe47ef4e744/report`, 55 KB, horizontal overflow 0px | ![prototype dark](proto--Report--noplan--dark.png)<br>desktop prototype (no phone layout), 96 KB |

## The timed module (Full-Length Test 2, Reading and Writing Module 2): Bluebook layout kept, no back arrow, light only; type on the student tokens

Persona: `paid`. Route: `/tests/{paid.inProgressExamSessionId}/RW/2`.
Must fit the viewport (F-69): document no taller than the viewport, window unscrolled, `[data-testid="focus-shell-header"]` wholly in view, nothing to scroll in `main#main` (the capture fails otherwise); the measurement is under each built shot.
Also shot at tablet 820x1180 (the mobile steps and selectors).
Prototype: none. No prototype draws the timed module: DESIGN.md §2 keeps its shipped Bluebook layout (E7b), light only.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![timed-module desktop light](timed-module--desktop--light--built.png)<br>`/tests/4e531e15-8350-426f-be63-a3695181535f/RW/2`, 97 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..58px, `main#main` 842px of content in 842px | none |
| mobile | light | ![timed-module mobile light](timed-module--mobile--light--built.png)<br>`/tests/4e531e15-8350-426f-be63-a3695181535f/RW/2`, 65 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..58px, `main#main` 786px of content in 786px | none |
| tablet | light | ![timed-module tablet light](timed-module--tablet--light--built.png)<br>`/tests/4e531e15-8350-426f-be63-a3695181535f/RW/2`, 103 KB, horizontal overflow 0px, document 1180px in a 1180px viewport, scrollY 0, top bar 0..58px, `main#main` 1122px of content in 1122px | none |

## Click path (paid): Resume, the page's one primary action (at 390 through the shared pre-start check's Continue anyway), lands on the exam session route and on to the active module

Persona: `paid`. Route: `/tests`.
Step: click `{"desktop":"[data-testid=\"tests-resume\"]","mobile":"[data-testid=\"tests-resume\"]"}`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"full-length-phone-continue\"]"}`.
Click path: must land on a path matching `^/tests/[0-9a-f-]{36}(/RW/[12])?$` (the capture fails otherwise); the path it landed on is under each built shot.
Prototype: none. A click path; its proof is the landing path (the prototype's Resume is not wired).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![click-paid-resume desktop light](click-paid-resume--desktop--light--built.png)<br>`/tests/4e531e15-8350-426f-be63-a3695181535f/RW/2`, 96 KB, horizontal overflow 0px | none |
| desktop | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![click-paid-resume desktop dark](click-paid-resume--desktop--dark--built.png)<br>`/tests/4e531e15-8350-426f-be63-a3695181535f/RW/2`, 97 KB, horizontal overflow 0px | none |
| mobile | light | ![click-paid-resume mobile light](click-paid-resume--mobile--light--built.png)<br>`/tests/4e531e15-8350-426f-be63-a3695181535f/RW/2`, 66 KB, horizontal overflow 0px | none |
| mobile | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![click-paid-resume mobile dark](click-paid-resume--mobile--dark--built.png)<br>`/tests/4e531e15-8350-426f-be63-a3695181535f/RW/2`, 66 KB, horizontal overflow 0px | none |

## QA item 5: a test's Start pressed (at 390 after Continue anyway), the create held in flight: 'Starting…' with a spinner, disabled

Persona: `paid`. Route: `/tests`.
Step: click `{"desktop":"[data-testid=\"tests-start\"]","mobile":"[data-testid=\"tests-start\"]"}`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"full-length-phone-continue\"]"}`.
Held: the browser's `POST /api/tests/sessions` is left unanswered through the screenshot, then aborted (it never reaches the server).
Must then show `[data-testid="tests-start"][aria-busy="true"]` (the capture fails otherwise).
Prototype: none. A pending state the prototype does not draw (owner QA list, 2026-10-07, item 5).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![click-paid-start-pending desktop light](click-paid-start-pending--desktop--light--built.png)<br>`/tests`, 166 KB, horizontal overflow 0px | none |
| desktop | dark | ![click-paid-start-pending desktop dark](click-paid-start-pending--desktop--dark--built.png)<br>`/tests`, 166 KB, horizontal overflow 0px | none |
| mobile | light | ![click-paid-start-pending mobile light](click-paid-start-pending--mobile--light--built.png)<br>`/tests`, 71 KB, horizontal overflow 0px | none |
| mobile | dark | ![click-paid-start-pending mobile dark](click-paid-start-pending--mobile--dark--built.png)<br>`/tests`, 70 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"6f28bda2-1f88-47db-bf2b-204da325047e","openPracticeSessionId":"1cf15540-9b66-427f-8ca8-aadf89c5f7fb","openReviewSessionId":null,"diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":13},"paid":{"completedPracticeSessionId":"48414eae-bcaa-40e4-9018-a0d3eefe6e90","openPracticeSessionId":"1b9ad708-cdeb-489b-9652-092dd882a1bb","openReviewSessionId":null,"diagnosticSessionId":"4cc8195b-6acd-486d-9bd5-8bfdf386f136","scoredExamSessionId":"d5056fdb-a88c-46db-abfa-bfe47ef4e744","inProgressExamSessionId":"4e531e15-8350-426f-be63-a3695181535f","lisaConversationId":null,"answered":178}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- Desmos (QA2-B, opt-in `STUDENT_HARNESS_DESMOS=1`): not loaded (a local-only run; the calculator shows its unavailable line)
- External hosts blocked: none
