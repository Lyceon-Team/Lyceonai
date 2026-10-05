# UI-52 Review (/review): free and paid, past sessions opened, light and dark, 1440 and 390

Generated 2026-10-05T14:14:38.695Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-52` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

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
| mobile | dark | ![review-free mobile dark](review-free--mobile--dark--built.png)<br>`/review`, 58 KB, horizontal overflow 0px | ![prototype dark](proto--Review--free--dark.png)<br>desktop prototype (no phone layout), 129 KB |

## Review, paid: queue card, pick up where you left off, review by topic, redo a past session (collapsed); panel: what's waiting, mastery rows

Persona: `paid`. Route: `/review`.
Prototype: `Review.dc.html` (Review, plan = paid).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-paid desktop light](review-paid--desktop--light--built.png)<br>`/review`, 139 KB, horizontal overflow 0px | ![prototype light](proto--Review--paid--light.png), 141 KB |
| desktop | dark | ![review-paid desktop dark](review-paid--desktop--dark--built.png)<br>`/review`, 142 KB, horizontal overflow 0px | ![prototype dark](proto--Review--paid--dark.png), 143 KB |
| mobile | light | ![review-paid mobile light](review-paid--mobile--light--built.png)<br>`/review`, 57 KB, horizontal overflow 0px | ![prototype light](proto--Review--paid--light.png)<br>desktop prototype (no phone layout), 141 KB |
| mobile | dark | ![review-paid mobile dark](review-paid--mobile--dark--built.png)<br>`/review`, 58 KB, horizontal overflow 0px | ![prototype dark](proto--Review--paid--dark.png)<br>desktop prototype (no phone layout), 143 KB |

## Review, paid, full page (on a phone the right panel stacks under the main column; the footer ends the column)

Persona: `paid`. Route: `/review`.
Full page: the whole document, not just the viewport.
Prototype: `Review.dc.html` (Review, plan = paid (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-paid-full desktop light](review-paid-full--desktop--light--built.png)<br>`/review`, 139 KB, horizontal overflow 0px | ![prototype light](proto--Review--paid--light.png), 141 KB |
| desktop | dark | ![review-paid-full desktop dark](review-paid-full--desktop--dark--built.png)<br>`/review`, 142 KB, horizontal overflow 0px | ![prototype dark](proto--Review--paid--dark.png), 143 KB |
| mobile | light | ![review-paid-full mobile light](review-paid-full--mobile--light--built.png)<br>`/review`, 155 KB, horizontal overflow 0px | ![prototype light](proto--Review--paid--light.png)<br>desktop prototype (no phone layout), 141 KB |
| mobile | dark | ![review-paid-full mobile dark](review-paid-full--mobile--dark--built.png)<br>`/review`, 158 KB, horizontal overflow 0px | ![prototype dark](proto--Review--paid--dark.png)<br>desktop prototype (no phone layout), 143 KB |

## Review, free, full page (on a phone the right panel stacks under the main column; the footer ends the column)

Persona: `free`. Route: `/review`.
Full page: the whole document, not just the viewport.
Prototype: `Review.dc.html` (Review, plan = free (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-free-full desktop light](review-free-full--desktop--light--built.png)<br>`/review`, 130 KB, horizontal overflow 0px | ![prototype light](proto--Review--free--light.png), 127 KB |
| desktop | dark | ![review-free-full desktop dark](review-free-full--desktop--dark--built.png)<br>`/review`, 132 KB, horizontal overflow 0px | ![prototype dark](proto--Review--free--dark.png), 129 KB |
| mobile | light | ![review-free-full mobile light](review-free-full--mobile--light--built.png)<br>`/review`, 131 KB, horizontal overflow 0px | ![prototype light](proto--Review--free--light.png)<br>desktop prototype (no phone layout), 127 KB |
| mobile | dark | ![review-free-full mobile dark](review-free-full--mobile--dark--built.png)<br>`/review`, 132 KB, horizontal overflow 0px | ![prototype dark](proto--Review--free--dark.png)<br>desktop prototype (no phone layout), 129 KB |

## Review, paid, 'Past sessions' opened: grouped by day, five rows, then Load more (no count, OQ-24); full page

Persona: `paid`. Route: `/review`.
Step: click `{"desktop":"[data-testid=\"review-past-toggle\"]","mobile":"[data-testid=\"review-past-toggle\"]"}`.
Full page: the whole document, not just the viewport.
Prototype: `Review.dc.html` (Review, plan = paid, 'Past sessions' clicked open on the canvas); clicked: `button[aria-controls="past-list"]`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-paid-past-open desktop light](review-paid-past-open--desktop--light--built.png)<br>`/review`, 136 KB, horizontal overflow 0px | ![prototype light](proto--Review--paid--light--clicked.png), 141 KB |
| desktop | dark | ![review-paid-past-open desktop dark](review-paid-past-open--desktop--dark--built.png)<br>`/review`, 139 KB, horizontal overflow 0px | ![prototype dark](proto--Review--paid--dark--clicked.png), 143 KB |
| mobile | light | ![review-paid-past-open mobile light](review-paid-past-open--mobile--light--built.png)<br>`/review`, 194 KB, horizontal overflow 0px | ![prototype light](proto--Review--paid--light--clicked.png)<br>desktop prototype (no phone layout), 141 KB |
| mobile | dark | ![review-paid-past-open mobile dark](review-paid-past-open--mobile--dark--built.png)<br>`/review`, 198 KB, horizontal overflow 0px | ![prototype dark](proto--Review--paid--dark--clicked.png)<br>desktop prototype (no phone layout), 143 KB |

## Review, free, 'Past sessions' opened (free has full review, SCL-110); full page

Persona: `free`. Route: `/review`.
Step: click `{"desktop":"[data-testid=\"review-past-toggle\"]","mobile":"[data-testid=\"review-past-toggle\"]"}`.
Full page: the whole document, not just the viewport.
Prototype: `Review.dc.html` (Review, plan = free, 'Past sessions' clicked open on the canvas); clicked: `button[aria-controls="past-list"]`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-free-past-open desktop light](review-free-past-open--desktop--light--built.png)<br>`/review`, 126 KB, horizontal overflow 0px | ![prototype light](proto--Review--free--light--clicked.png), 127 KB |
| desktop | dark | ![review-free-past-open desktop dark](review-free-past-open--desktop--dark--built.png)<br>`/review`, 128 KB, horizontal overflow 0px | ![prototype dark](proto--Review--free--dark--clicked.png), 129 KB |
| mobile | light | ![review-free-past-open mobile light](review-free-past-open--mobile--light--built.png)<br>`/review`, 170 KB, horizontal overflow 0px | ![prototype light](proto--Review--free--light--clicked.png)<br>desktop prototype (no phone layout), 127 KB |
| mobile | dark | ![review-free-past-open mobile dark](review-free-past-open--mobile--dark--built.png)<br>`/review`, 172 KB, horizontal overflow 0px | ![prototype dark](proto--Review--free--dark--clicked.png)<br>desktop prototype (no phone layout), 129 KB |

## Click path (paid): Start reviewing lands in the review runner

Persona: `paid`. Route: `/review`.
Step: click `{"desktop":"[data-testid=\"button-start-queue\"]","mobile":"[data-testid=\"button-start-queue\"]"}`.
Click path: must land on a path matching `^/review/session/[0-9a-f-]{36}$` (the capture fails otherwise); the path it landed on is under each built shot.
Prototype: none. A click path: the screenshot is where the click landed (the runner), proven by its pathname.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![click-paid-start desktop light](click-paid-start--desktop--light--built.png)<br>`/review/session/212b0954-58f7-4da1-8b12-51f4e0f5440a`, 59 KB, horizontal overflow 59px | none |
| desktop | dark | ![click-paid-start desktop dark](click-paid-start--desktop--dark--built.png)<br>`/review/session/74df366e-871e-40e0-975e-c76d425590ea`, 59 KB, horizontal overflow 59px | none |
| mobile | light | ![click-paid-start mobile light](click-paid-start--mobile--light--built.png)<br>`/review/session/75d914f6-1daf-49bb-8ae8-4dbaa622c19c`, 39 KB, horizontal overflow 26px | none |
| mobile | dark | ![click-paid-start mobile dark](click-paid-start--mobile--dark--built.png)<br>`/review/session/3e4d92ce-14e7-406d-b133-49665c74ce1e`, 39 KB, horizontal overflow 26px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"3d932e01-3298-4a85-bfe6-86413c96db6c","openPracticeSessionId":"17bf9b4f-ca11-498d-9b53-63380a03e1d9","openReviewSessionId":"5d113e1b-7a0c-433b-ae12-8853e9a9db09","diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":39},"paid":{"completedPracticeSessionId":"f0666cbe-c997-4dce-9bd3-49fdf5ccd5e0","openPracticeSessionId":"346aaea2-2976-44f1-b143-5fd837097c43","openReviewSessionId":"c90ee1f3-fbca-479c-9541-f6da0f20bfad","diagnosticSessionId":"eaf74fd7-608e-4889-80bb-0d190dd57455","scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":79}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- External hosts blocked: none
