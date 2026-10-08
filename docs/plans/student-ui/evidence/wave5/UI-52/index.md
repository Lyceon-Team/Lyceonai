# UI-52 Review (/review): free and paid, past sessions opened, light and dark, 1440 and 390

Generated 2026-10-08T03:28:06.833Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-52` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844, and any extra size a shot names.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## Review, free: queue card, pick up where you left off, review by topic, redo a past session (collapsed); panel: what's waiting, locked mastery

Persona: `free`. Route: `/review`.
Prototype: `Review.dc.html` (Review, plan = free).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-free desktop light](review-free--desktop--light--built.png)<br>`/review`, 130 KB, horizontal overflow 0px | ![prototype light](proto--Review--free--light.png), 127 KB |
| desktop | dark | ![review-free desktop dark](review-free--desktop--dark--built.png)<br>`/review`, 132 KB, horizontal overflow 0px | ![prototype dark](proto--Review--free--dark.png), 129 KB |
| mobile | light | ![review-free mobile light](review-free--mobile--light--built.png)<br>`/review`, 58 KB, horizontal overflow 0px | ![prototype light](proto--Review--free--light.png)<br>desktop prototype (no phone layout), 127 KB |
| mobile | dark | ![review-free mobile dark](review-free--mobile--dark--built.png)<br>`/review`, 59 KB, horizontal overflow 0px | ![prototype dark](proto--Review--free--dark.png)<br>desktop prototype (no phone layout), 129 KB |

## Review, paid: queue card, pick up where you left off, review by topic, redo a past session (collapsed); panel: what's waiting, mastery rows

Persona: `paid`. Route: `/review`.
Prototype: `Review.dc.html` (Review, plan = paid).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-paid desktop light](review-paid--desktop--light--built.png)<br>`/review`, 141 KB, horizontal overflow 0px | ![prototype light](proto--Review--paid--light.png), 141 KB |
| desktop | dark | ![review-paid desktop dark](review-paid--desktop--dark--built.png)<br>`/review`, 143 KB, horizontal overflow 0px | ![prototype dark](proto--Review--paid--dark.png), 143 KB |
| mobile | light | ![review-paid mobile light](review-paid--mobile--light--built.png)<br>`/review`, 58 KB, horizontal overflow 0px | ![prototype light](proto--Review--paid--light.png)<br>desktop prototype (no phone layout), 141 KB |
| mobile | dark | ![review-paid mobile dark](review-paid--mobile--dark--built.png)<br>`/review`, 58 KB, horizontal overflow 0px | ![prototype dark](proto--Review--paid--dark.png)<br>desktop prototype (no phone layout), 143 KB |

## Review, paid, full page (on a phone the right panel stacks under the main column; the footer ends the column)

Persona: `paid`. Route: `/review`.
Full page: the whole document, not just the viewport.
Prototype: `Review.dc.html` (Review, plan = paid (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-paid-full desktop light](review-paid-full--desktop--light--built.png)<br>`/review`, 141 KB, horizontal overflow 0px | ![prototype light](proto--Review--paid--light.png), 141 KB |
| desktop | dark | ![review-paid-full desktop dark](review-paid-full--desktop--dark--built.png)<br>`/review`, 143 KB, horizontal overflow 0px | ![prototype dark](proto--Review--paid--dark.png), 143 KB |
| mobile | light | ![review-paid-full mobile light](review-paid-full--mobile--light--built.png)<br>`/review`, 156 KB, horizontal overflow 0px | ![prototype light](proto--Review--paid--light.png)<br>desktop prototype (no phone layout), 141 KB |
| mobile | dark | ![review-paid-full mobile dark](review-paid-full--mobile--dark--built.png)<br>`/review`, 159 KB, horizontal overflow 0px | ![prototype dark](proto--Review--paid--dark.png)<br>desktop prototype (no phone layout), 143 KB |

## Review, free, full page (on a phone the right panel stacks under the main column; the footer ends the column)

Persona: `free`. Route: `/review`.
Full page: the whole document, not just the viewport.
Prototype: `Review.dc.html` (Review, plan = free (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-free-full desktop light](review-free-full--desktop--light--built.png)<br>`/review`, 130 KB, horizontal overflow 0px | ![prototype light](proto--Review--free--light.png), 127 KB |
| desktop | dark | ![review-free-full desktop dark](review-free-full--desktop--dark--built.png)<br>`/review`, 132 KB, horizontal overflow 0px | ![prototype dark](proto--Review--free--dark.png), 129 KB |
| mobile | light | ![review-free-full mobile light](review-free-full--mobile--light--built.png)<br>`/review`, 131 KB, horizontal overflow 0px | ![prototype light](proto--Review--free--light.png)<br>desktop prototype (no phone layout), 127 KB |
| mobile | dark | ![review-free-full mobile dark](review-free-full--mobile--dark--built.png)<br>`/review`, 133 KB, horizontal overflow 0px | ![prototype dark](proto--Review--free--dark.png)<br>desktop prototype (no phone layout), 129 KB |

## Review, paid, 'Past sessions' opened: grouped by day, five rows, then Load more (no count, OQ-24); full page

Persona: `paid`. Route: `/review`.
Step: click `{"desktop":"[data-testid=\"review-past-toggle\"]","mobile":"[data-testid=\"review-past-toggle\"]"}`.
Full page: the whole document, not just the viewport.
Prototype: `Review.dc.html` (Review, plan = paid, 'Past sessions' clicked open on the canvas); clicked: `button[aria-controls="past-list"]`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-paid-past-open desktop light](review-paid-past-open--desktop--light--built.png)<br>`/review`, 139 KB, horizontal overflow 0px | ![prototype light](proto--Review--paid--light--clicked.png), 141 KB |
| desktop | dark | ![review-paid-past-open desktop dark](review-paid-past-open--desktop--dark--built.png)<br>`/review`, 141 KB, horizontal overflow 0px | ![prototype dark](proto--Review--paid--dark--clicked.png), 143 KB |
| mobile | light | ![review-paid-past-open mobile light](review-paid-past-open--mobile--light--built.png)<br>`/review`, 196 KB, horizontal overflow 0px | ![prototype light](proto--Review--paid--light--clicked.png)<br>desktop prototype (no phone layout), 141 KB |
| mobile | dark | ![review-paid-past-open mobile dark](review-paid-past-open--mobile--dark--built.png)<br>`/review`, 199 KB, horizontal overflow 0px | ![prototype dark](proto--Review--paid--dark--clicked.png)<br>desktop prototype (no phone layout), 143 KB |

## Review, free, 'Past sessions' opened (free has full review, SCL-110); full page

Persona: `free`. Route: `/review`.
Step: click `{"desktop":"[data-testid=\"review-past-toggle\"]","mobile":"[data-testid=\"review-past-toggle\"]"}`.
Full page: the whole document, not just the viewport.
Prototype: `Review.dc.html` (Review, plan = free, 'Past sessions' clicked open on the canvas); clicked: `button[aria-controls="past-list"]`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-free-past-open desktop light](review-free-past-open--desktop--light--built.png)<br>`/review`, 125 KB, horizontal overflow 0px | ![prototype light](proto--Review--free--light--clicked.png), 127 KB |
| desktop | dark | ![review-free-past-open desktop dark](review-free-past-open--desktop--dark--built.png)<br>`/review`, 127 KB, horizontal overflow 0px | ![prototype dark](proto--Review--free--dark--clicked.png), 129 KB |
| mobile | light | ![review-free-past-open mobile light](review-free-past-open--mobile--light--built.png)<br>`/review`, 170 KB, horizontal overflow 0px | ![prototype light](proto--Review--free--light--clicked.png)<br>desktop prototype (no phone layout), 127 KB |
| mobile | dark | ![review-free-past-open mobile dark](review-free-past-open--mobile--dark--built.png)<br>`/review`, 172 KB, horizontal overflow 0px | ![prototype dark](proto--Review--free--dark--clicked.png)<br>desktop prototype (no phone layout), 129 KB |

## QA item 5: Start reviewing pressed, the create held in flight: 'Starting…' with a spinner; the other starts wait

Persona: `paid`. Route: `/review`.
Step: click `{"desktop":"[data-testid=\"button-start-queue\"]","mobile":"[data-testid=\"button-start-queue\"]"}`.
Held: the browser's `POST /api/review/sessions` is left unanswered through the screenshot, then aborted (it never reaches the server).
Must then show `[data-testid="button-start-queue"][aria-busy="true"]` (the capture fails otherwise).
Prototype: none. A pending state the prototype does not draw (owner QA list, 2026-10-07, item 5).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![click-paid-start-pending desktop light](click-paid-start-pending--desktop--light--built.png)<br>`/review`, 141 KB, horizontal overflow 0px | none |
| desktop | dark | ![click-paid-start-pending desktop dark](click-paid-start-pending--desktop--dark--built.png)<br>`/review`, 143 KB, horizontal overflow 0px | none |
| mobile | light | ![click-paid-start-pending mobile light](click-paid-start-pending--mobile--light--built.png)<br>`/review`, 57 KB, horizontal overflow 0px | none |
| mobile | dark | ![click-paid-start-pending mobile dark](click-paid-start-pending--mobile--dark--built.png)<br>`/review`, 58 KB, horizontal overflow 0px | none |

## Click path (paid): Start reviewing lands in the review runner

Persona: `paid`. Route: `/review`.
Step: click `{"desktop":"[data-testid=\"button-start-queue\"]","mobile":"[data-testid=\"button-start-queue\"]"}`.
Click path: must land on a path matching `^/review/session/[0-9a-f-]{36}$` (the capture fails otherwise); the path it landed on is under each built shot.
Prototype: none. A click path: the screenshot is where the click landed (the runner), proven by its pathname.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![click-paid-start desktop light](click-paid-start--desktop--light--built.png)<br>`/review/session/3ae99ed3-6214-4ff3-a0d5-1665e6e83316`, 63 KB, horizontal overflow 0px | none |
| desktop | dark | ![click-paid-start desktop dark](click-paid-start--desktop--dark--built.png)<br>`/review/session/5cf8131a-22c0-42df-9501-a612371dbb59`, 63 KB, horizontal overflow 0px | none |
| mobile | light | ![click-paid-start mobile light](click-paid-start--mobile--light--built.png)<br>`/review/session/00f59d54-54d2-4e43-9660-eaa131c4d655`, 25 KB, horizontal overflow 0px | none |
| mobile | dark | ![click-paid-start mobile dark](click-paid-start--mobile--dark--built.png)<br>`/review/session/0783b9b5-ce37-4d35-a16f-42b80d871f96`, 25 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"a4339724-ec94-4dce-9f44-9d173be2d4a6","openPracticeSessionId":"f48e059b-ba79-46a0-911f-d7d4f82fa482","openReviewSessionId":"b3d7360c-307b-4c93-916d-aaa8dc8124f2","diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":39},"paid":{"completedPracticeSessionId":"79523b3e-79bb-4e16-a512-370a1c63f9ca","openPracticeSessionId":"03c8a54a-9075-47e7-9da8-7dc2bbb86920","openReviewSessionId":"aee1b9d8-cf92-45b5-ae2c-5805c5de0dfb","diagnosticSessionId":"55ebae7e-0f79-4b8f-bcc3-56842e6693f1","scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":79}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- Desmos (QA2-B, opt-in `STUDENT_HARNESS_DESMOS=1`): not loaded (a local-only run; the calculator shows its unavailable line)
- External hosts blocked: none
