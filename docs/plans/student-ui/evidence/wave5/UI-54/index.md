# UI-54 Full-Length home (/tests), the exam report and the timed module: free and paid, light and dark, 1440 and 390

Generated 2026-10-05T09:44:49.841Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-54` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844, and any extra size a shot names.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## Full-Length, free: the in-page upgrade card; panel: the locked mastery card. No gated request

Persona: `free`. Route: `/tests`.
Prototype: `FullLength.dc.html` (Full-Length, plan = free).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![tests-free desktop light](tests-free--desktop--light--built.png)<br>`/tests`, 89 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--free--light.png), 67 KB |
| desktop | dark | ![tests-free desktop dark](tests-free--desktop--dark--built.png)<br>`/tests`, 90 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--free--dark.png), 68 KB |
| mobile | light | ![tests-free mobile light](tests-free--mobile--light--built.png)<br>`/tests`, 61 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--free--light.png)<br>desktop prototype (no phone layout), 67 KB |
| mobile | dark | ![tests-free mobile dark](tests-free--mobile--dark--built.png)<br>`/tests`, 62 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--free--dark.png)<br>desktop prototype (no phone layout), 68 KB |

## Full-Length, paid: Practice Test 1 scored (score + disclosure), Practice Test 2 in progress (Resume, the one primary), Practice Test 3 not started; Before you start; panel: score history and mastery

Persona: `paid`. Route: `/tests`.
Must then show the text `In progress: Reading & Writing, Module 2` (the capture fails otherwise).
Prototype: `FullLength.dc.html` (Full-Length, plan = paid).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![tests-paid desktop light](tests-paid--desktop--light--built.png)<br>`/tests`, 175 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--paid--light.png), 148 KB |
| desktop | dark | ![tests-paid desktop dark](tests-paid--desktop--dark--built.png)<br>`/tests`, 176 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--paid--dark.png), 150 KB |
| mobile | light | ![tests-paid mobile light](tests-paid--mobile--light--built.png)<br>`/tests`, 68 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--paid--light.png)<br>desktop prototype (no phone layout), 148 KB |
| mobile | dark | ![tests-paid mobile dark](tests-paid--mobile--dark--built.png)<br>`/tests`, 67 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--paid--dark.png)<br>desktop prototype (no phone layout), 150 KB |

## Full-Length, paid, full page (on a phone the right panel stacks under the main column; the footer ends the column)

Persona: `paid`. Route: `/tests`.
Must then show the text `In progress: Reading & Writing, Module 2` (the capture fails otherwise).
Full page: the whole document, not just the viewport.
Prototype: `FullLength.dc.html` (Full-Length, plan = paid (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![tests-paid-full desktop light](tests-paid-full--desktop--light--built.png)<br>`/tests`, 175 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--paid--light.png), 148 KB |
| desktop | dark | ![tests-paid-full desktop dark](tests-paid-full--desktop--dark--built.png)<br>`/tests`, 176 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--paid--dark.png), 150 KB |
| mobile | light | ![tests-paid-full mobile light](tests-paid-full--mobile--light--built.png)<br>`/tests`, 198 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--paid--light.png)<br>desktop prototype (no phone layout), 148 KB |
| mobile | dark | ![tests-paid-full mobile dark](tests-paid-full--mobile--dark--built.png)<br>`/tests`, 200 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--paid--dark.png)<br>desktop prototype (no phone layout), 150 KB |

## Exam report (Focus shell), the scored Practice Test 1: total out of 1600, sections out of 800, the disclosure; Knowledge and skills, seven segments per domain

Persona: `paid`. Route: `/tests/{paid.scoredExamSessionId}/report`.
Prototype: `Report.dc.html` (Report).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![report-scored desktop light](report-scored--desktop--light--built.png)<br>`/tests/9856a4dc-6873-4d28-bf4f-372005c9e7af/report`, 108 KB, horizontal overflow 0px | ![prototype light](proto--Report--noplan--light.png), 95 KB |
| desktop | dark | ![report-scored desktop dark](report-scored--desktop--dark--built.png)<br>`/tests/9856a4dc-6873-4d28-bf4f-372005c9e7af/report`, 110 KB, horizontal overflow 0px | ![prototype dark](proto--Report--noplan--dark.png), 96 KB |
| mobile | light | ![report-scored mobile light](report-scored--mobile--light--built.png)<br>`/tests/9856a4dc-6873-4d28-bf4f-372005c9e7af/report`, 54 KB, horizontal overflow 0px | ![prototype light](proto--Report--noplan--light.png)<br>desktop prototype (no phone layout), 95 KB |
| mobile | dark | ![report-scored mobile dark](report-scored--mobile--dark--built.png)<br>`/tests/9856a4dc-6873-4d28-bf4f-372005c9e7af/report`, 55 KB, horizontal overflow 0px | ![prototype dark](proto--Report--noplan--dark.png)<br>desktop prototype (no phone layout), 96 KB |

## Exam report, full page (on a phone the score card stacks above Knowledge and skills)

Persona: `paid`. Route: `/tests/{paid.scoredExamSessionId}/report`.
Full page: the whole document, not just the viewport.
Prototype: `Report.dc.html` (Report (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![report-scored-full desktop light](report-scored-full--desktop--light--built.png)<br>`/tests/9856a4dc-6873-4d28-bf4f-372005c9e7af/report`, 108 KB, horizontal overflow 0px | ![prototype light](proto--Report--noplan--light.png), 95 KB |
| desktop | dark | ![report-scored-full desktop dark](report-scored-full--desktop--dark--built.png)<br>`/tests/9856a4dc-6873-4d28-bf4f-372005c9e7af/report`, 110 KB, horizontal overflow 0px | ![prototype dark](proto--Report--noplan--dark.png), 96 KB |
| mobile | light | ![report-scored-full mobile light](report-scored-full--mobile--light--built.png)<br>`/tests/9856a4dc-6873-4d28-bf4f-372005c9e7af/report`, 54 KB, horizontal overflow 0px | ![prototype light](proto--Report--noplan--light.png)<br>desktop prototype (no phone layout), 95 KB |
| mobile | dark | ![report-scored-full mobile dark](report-scored-full--mobile--dark--built.png)<br>`/tests/9856a4dc-6873-4d28-bf4f-372005c9e7af/report`, 55 KB, horizontal overflow 0px | ![prototype dark](proto--Report--noplan--dark.png)<br>desktop prototype (no phone layout), 96 KB |

## The timed module (Practice Test 2, Reading and Writing Module 2): Bluebook layout kept, no back arrow, light only; type on the student tokens

Persona: `paid`. Route: `/tests/{paid.inProgressExamSessionId}/RW/2`.
Must fit the viewport (F-69): document no taller than the viewport, window unscrolled, `[data-testid="focus-shell-header"]` wholly in view, nothing to scroll in `main#main` (the capture fails otherwise); the measurement is under each built shot.
Also shot at tablet 820x1180 (the mobile steps and selectors).
Prototype: none. No prototype draws the timed module: DESIGN.md §2 keeps its shipped Bluebook layout (E7b), light only.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![timed-module desktop light](timed-module--desktop--light--built.png)<br>`/tests/fcabe8f3-1fca-447d-bca9-0d1561d2fac5/RW/2`, 96 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..58px, `main#main` 842px of content in 842px | none |
| mobile | light | ![timed-module mobile light](timed-module--mobile--light--built.png)<br>`/tests/fcabe8f3-1fca-447d-bca9-0d1561d2fac5/RW/2`, 65 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..58px, `main#main` 786px of content in 786px | none |
| tablet | light | ![timed-module tablet light](timed-module--tablet--light--built.png)<br>`/tests/fcabe8f3-1fca-447d-bca9-0d1561d2fac5/RW/2`, 103 KB, horizontal overflow 0px, document 1180px in a 1180px viewport, scrollY 0, top bar 0..58px, `main#main` 1122px of content in 1122px | none |

## Click path (paid): Resume, the page's one primary action, lands on the exam session route and on to the active module

Persona: `paid`. Route: `/tests`.
Step: click `{"desktop":"[data-testid=\"tests-resume\"]","mobile":"[data-testid=\"tests-resume\"]"}`.
Click path: must land on a path matching `^/tests/[0-9a-f-]{36}(/RW/[12])?$` (the capture fails otherwise); the path it landed on is under each built shot.
Prototype: none. A click path; its proof is the landing path (the prototype's Resume is not wired).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![click-paid-resume desktop light](click-paid-resume--desktop--light--built.png)<br>`/tests/fcabe8f3-1fca-447d-bca9-0d1561d2fac5/RW/2`, 97 KB, horizontal overflow 0px | none |
| desktop | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![click-paid-resume desktop dark](click-paid-resume--desktop--dark--built.png)<br>`/tests/fcabe8f3-1fca-447d-bca9-0d1561d2fac5/RW/2`, 97 KB, horizontal overflow 0px | none |
| mobile | light | ![click-paid-resume mobile light](click-paid-resume--mobile--light--built.png)<br>`/tests/fcabe8f3-1fca-447d-bca9-0d1561d2fac5/RW/2`, 65 KB, horizontal overflow 0px | none |
| mobile | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![click-paid-resume mobile dark](click-paid-resume--mobile--dark--built.png)<br>`/tests/fcabe8f3-1fca-447d-bca9-0d1561d2fac5/RW/2`, 66 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"a7517c9c-0dc2-4405-9ab8-e6a8794577e8","openPracticeSessionId":"445c9009-1ae3-4b5a-80a0-c8e52ebdc96d","openReviewSessionId":null,"diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":13},"paid":{"completedPracticeSessionId":"70d575de-19b7-42fd-bf62-b6639ea9374c","openPracticeSessionId":"d83bb1a8-3d85-4eff-854b-2dc0843e89b6","openReviewSessionId":null,"diagnosticSessionId":"d1e0b7dc-f67a-4ebe-9ee2-84fe90b07d42","scoredExamSessionId":"9856a4dc-6873-4d28-bf4f-372005c9e7af","inProgressExamSessionId":"fcabe8f3-1fca-447d-bca9-0d1561d2fac5","lisaConversationId":null,"answered":178}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- External hosts blocked: `fonts.googleapis.com`
