# UI-54 Full-Length home (/tests), the exam report and the timed module: free and paid, light and dark, 1440 and 390

Generated 2026-10-05T09:45:08.255Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-54` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## Full-Length, free: the in-page upgrade card; panel: the locked mastery card. No gated request (390: after Continue anyway)

Persona: `free`. Route: `/tests`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"tests-phone-notice\"] button"}`.
Must then show `[data-testid="tests-upgrade-card"]` (the capture fails otherwise).
Prototype: `FullLength.dc.html` (Full-Length, plan = free).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![tests-free desktop light](tests-free--desktop--light--built.png)<br>`/tests`, 84 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--free--light.png), 67 KB |
| desktop | dark | ![tests-free desktop dark](tests-free--desktop--dark--built.png)<br>`/tests`, 84 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--free--dark.png), 68 KB |
| mobile | light | ![tests-free mobile light](tests-free--mobile--light--built.png)<br>`/tests`, 57 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--free--light.png)<br>desktop prototype (no phone layout), 67 KB |
| mobile | dark | ![tests-free mobile dark](tests-free--mobile--dark--built.png)<br>`/tests`, 57 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--free--dark.png)<br>desktop prototype (no phone layout), 68 KB |

## Full-Length, paid: Practice Test 1 scored (score + disclosure), Practice Test 2 in progress (Resume, the one primary), Practice Test 3 not started; Before you start; panel: score history and mastery (390: after Continue anyway)

Persona: `paid`. Route: `/tests`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"tests-phone-notice\"] button"}`.
Must then show the text `In progress: Reading & Writing, Module 2` (the capture fails otherwise).
Prototype: `FullLength.dc.html` (Full-Length, plan = paid).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![tests-paid desktop light](tests-paid--desktop--light--built.png)<br>`/tests`, 170 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--paid--light.png), 148 KB |
| desktop | dark | ![tests-paid desktop dark](tests-paid--desktop--dark--built.png)<br>`/tests`, 171 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--paid--dark.png), 150 KB |
| mobile | light | ![tests-paid mobile light](tests-paid--mobile--light--built.png)<br>`/tests`, 64 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--paid--light.png)<br>desktop prototype (no phone layout), 148 KB |
| mobile | dark | ![tests-paid mobile dark](tests-paid--mobile--dark--built.png)<br>`/tests`, 63 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--paid--dark.png)<br>desktop prototype (no phone layout), 150 KB |

## Full-Length, paid, full page (on a phone, after Continue anyway, the right panel stacks under the main column; the footer ends the column)

Persona: `paid`. Route: `/tests`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"tests-phone-notice\"] button"}`.
Must then show the text `In progress: Reading & Writing, Module 2` (the capture fails otherwise).
Full page: the whole document, not just the viewport.
Prototype: `FullLength.dc.html` (Full-Length, plan = paid (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![tests-paid-full desktop light](tests-paid-full--desktop--light--built.png)<br>`/tests`, 170 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--paid--light.png), 148 KB |
| desktop | dark | ![tests-paid-full desktop dark](tests-paid-full--desktop--dark--built.png)<br>`/tests`, 171 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--paid--dark.png), 150 KB |
| mobile | light | ![tests-paid-full mobile light](tests-paid-full--mobile--light--built.png)<br>`/tests`, 195 KB, horizontal overflow 0px | ![prototype light](proto--FullLength--paid--light.png)<br>desktop prototype (no phone layout), 148 KB |
| mobile | dark | ![tests-paid-full mobile dark](tests-paid-full--mobile--dark--built.png)<br>`/tests`, 197 KB, horizontal overflow 0px | ![prototype dark](proto--FullLength--paid--dark.png)<br>desktop prototype (no phone layout), 150 KB |

## Full-Length on a phone (owner ruling 2026-10-05): the title and "Full-length tests are built for a laptop or tablet, like test day." with Continue anyway. Desktop: no notice (control)

Persona: `paid`. Route: `/tests`.
Must then show `[data-testid="tests-home"]` (the capture fails otherwise).
Prototype: none. The prototypes have no phone layout; the notice is the owner ruling of 2026-10-05 (DESIGN.md §2 Mobile).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![tests-phone-notice desktop light](tests-phone-notice--desktop--light--built.png)<br>`/tests`, 170 KB, horizontal overflow 0px | none |
| desktop | dark | ![tests-phone-notice desktop dark](tests-phone-notice--desktop--dark--built.png)<br>`/tests`, 171 KB, horizontal overflow 0px | none |
| mobile | light | ![tests-phone-notice mobile light](tests-phone-notice--mobile--light--built.png)<br>`/tests`, 41 KB, horizontal overflow 0px | none |
| mobile | dark | ![tests-phone-notice mobile dark](tests-phone-notice--mobile--dark--built.png)<br>`/tests`, 40 KB, horizontal overflow 0px | none |

## Exam report (Focus shell), the scored Practice Test 1: total out of 1600, sections out of 800, the disclosure; Knowledge and skills, seven segments per domain

Persona: `paid`. Route: `/tests/{paid.scoredExamSessionId}/report`.
Prototype: `Report.dc.html` (Report).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![report-scored desktop light](report-scored--desktop--light--built.png)<br>`/tests/ce091500-944b-40b4-b983-66abed876287/report`, 109 KB, horizontal overflow 0px | ![prototype light](proto--Report--noplan--light.png), 95 KB |
| desktop | dark | ![report-scored desktop dark](report-scored--desktop--dark--built.png)<br>`/tests/ce091500-944b-40b4-b983-66abed876287/report`, 110 KB, horizontal overflow 0px | ![prototype dark](proto--Report--noplan--dark.png), 96 KB |
| mobile | light | ![report-scored mobile light](report-scored--mobile--light--built.png)<br>`/tests/ce091500-944b-40b4-b983-66abed876287/report`, 55 KB, horizontal overflow 0px | ![prototype light](proto--Report--noplan--light.png)<br>desktop prototype (no phone layout), 95 KB |
| mobile | dark | ![report-scored mobile dark](report-scored--mobile--dark--built.png)<br>`/tests/ce091500-944b-40b4-b983-66abed876287/report`, 55 KB, horizontal overflow 0px | ![prototype dark](proto--Report--noplan--dark.png)<br>desktop prototype (no phone layout), 96 KB |

## Exam report, full page (on a phone the score card stacks above Knowledge and skills)

Persona: `paid`. Route: `/tests/{paid.scoredExamSessionId}/report`.
Full page: the whole document, not just the viewport.
Prototype: `Report.dc.html` (Report (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![report-scored-full desktop light](report-scored-full--desktop--light--built.png)<br>`/tests/ce091500-944b-40b4-b983-66abed876287/report`, 109 KB, horizontal overflow 0px | ![prototype light](proto--Report--noplan--light.png), 95 KB |
| desktop | dark | ![report-scored-full desktop dark](report-scored-full--desktop--dark--built.png)<br>`/tests/ce091500-944b-40b4-b983-66abed876287/report`, 110 KB, horizontal overflow 0px | ![prototype dark](proto--Report--noplan--dark.png), 96 KB |
| mobile | light | ![report-scored-full mobile light](report-scored-full--mobile--light--built.png)<br>`/tests/ce091500-944b-40b4-b983-66abed876287/report`, 55 KB, horizontal overflow 0px | ![prototype light](proto--Report--noplan--light.png)<br>desktop prototype (no phone layout), 95 KB |
| mobile | dark | ![report-scored-full mobile dark](report-scored-full--mobile--dark--built.png)<br>`/tests/ce091500-944b-40b4-b983-66abed876287/report`, 55 KB, horizontal overflow 0px | ![prototype dark](proto--Report--noplan--dark.png)<br>desktop prototype (no phone layout), 96 KB |

## The timed module (Practice Test 2, Reading and Writing Module 2): Bluebook layout kept, no back arrow, light only; type on the student tokens

Persona: `paid`. Route: `/tests/{paid.inProgressExamSessionId}/RW/2`.
Prototype: none. No prototype draws the timed module: DESIGN.md §2 keeps its shipped Bluebook layout (E7b), light only.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![timed-module desktop light](timed-module--desktop--light--built.png)<br>`/tests/dc9072a8-0106-4b6f-a546-048e3a71073e/RW/2`, 96 KB, horizontal overflow 0px | none |
| mobile | light | ![timed-module mobile light](timed-module--mobile--light--built.png)<br>`/tests/dc9072a8-0106-4b6f-a546-048e3a71073e/RW/2`, 63 KB, horizontal overflow 0px | none |

## Click path (paid): Resume, the page's one primary action, lands on the exam session route and on to the active module

Persona: `paid`. Route: `/tests`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"tests-phone-notice\"] button"}`.
Step: click `{"desktop":"[data-testid=\"tests-resume\"]","mobile":"[data-testid=\"tests-resume\"]"}`.
Click path: must land on a path matching `^/tests/[0-9a-f-]{36}(/RW/[12])?$` (the capture fails otherwise); the path it landed on is under each built shot.
Prototype: none. A click path; its proof is the landing path (the prototype's Resume is not wired).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![click-paid-resume desktop light](click-paid-resume--desktop--light--built.png)<br>`/tests/dc9072a8-0106-4b6f-a546-048e3a71073e/RW/2`, 97 KB, horizontal overflow 0px | none |
| desktop | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![click-paid-resume desktop dark](click-paid-resume--desktop--dark--built.png)<br>`/tests/dc9072a8-0106-4b6f-a546-048e3a71073e/RW/2`, 97 KB, horizontal overflow 0px | none |
| mobile | light | ![click-paid-resume mobile light](click-paid-resume--mobile--light--built.png)<br>`/tests/dc9072a8-0106-4b6f-a546-048e3a71073e/RW/2`, 64 KB, horizontal overflow 0px | none |
| mobile | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![click-paid-resume mobile dark](click-paid-resume--mobile--dark--built.png)<br>`/tests/dc9072a8-0106-4b6f-a546-048e3a71073e/RW/2`, 64 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"8a548661-bcc8-4fd4-a66f-17a7f1fa5602","openPracticeSessionId":"8c2f12e8-93ea-4101-949e-d4890e2a0265","openReviewSessionId":null,"diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":13},"paid":{"completedPracticeSessionId":"2234c8a1-7715-4175-86a5-3c2c8a948cb3","openPracticeSessionId":"ce3e43da-8ba9-4f84-a9e8-139e33162385","openReviewSessionId":null,"diagnosticSessionId":"5455e7ed-a044-4102-8548-30d9c909bba1","scoredExamSessionId":"ce091500-944b-40b4-b983-66abed876287","inProgressExamSessionId":"dc9072a8-0106-4b6f-a546-048e3a71073e","lisaConversationId":null,"answered":178}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- External hosts blocked: `fonts.googleapis.com`
