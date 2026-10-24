# LISA chat dock: Home, Review and the review runner, bubble and open dock; the free lock modal; absent on phones and the timed module; light and dark, 1440, 1024 and 390

Generated 2026-10-22T22:16:20.969Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts LISA-DOCK` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844, and any extra size a shot names.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## Home (paid): the LISA bubble bottom-right, collapsed (it never opens by itself). Phone: no bubble, the LISA tab as before

Persona: `paid`. Route: `/dashboard`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. No prototype draws the chat dock: it is the owner brief of 2026-10-22 ("LISA chat dock", floating bubble, no bar); DESIGN.md §3 and §4 describe it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-paid-bubble desktop light](home-paid-bubble--desktop--light--built.png)<br>`/dashboard`, 159 KB, horizontal overflow 0px | none |
| desktop | dark | ![home-paid-bubble desktop dark](home-paid-bubble--desktop--dark--built.png)<br>`/dashboard`, 158 KB, horizontal overflow 0px | none |
| mobile | light | ![home-paid-bubble mobile light](home-paid-bubble--mobile--light--built.png)<br>`/dashboard`, 60 KB, horizontal overflow 0px | none |
| mobile | dark | ![home-paid-bubble mobile dark](home-paid-bubble--mobile--dark--built.png)<br>`/dashboard`, 62 KB, horizontal overflow 0px | none |
| w1024 | light | ![home-paid-bubble w1024 light](home-paid-bubble--w1024--light--built.png)<br>`/dashboard`, 128 KB, horizontal overflow 0px | none |
| w1024 | dark | ![home-paid-bubble w1024 dark](home-paid-bubble--w1024--dark--built.png)<br>`/dashboard`, 130 KB, horizontal overflow 0px | none |

## Home (paid): the bubble clicked, the dock open in general mode on the student's latest LISA conversation (the one heading the LISA page's history), Open in LISA, Minimize and Close

Persona: `paid`. Route: `/dashboard`.
Step: click `{"desktop":"[data-testid=\"chat-dock-bubble\"]","mobile":null}`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. No prototype draws the chat dock: it is the owner brief of 2026-10-22 ("LISA chat dock", floating bubble, no bar); DESIGN.md §3 and §4 describe it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-paid-open desktop light](home-paid-open--desktop--light--built.png)<br>`/dashboard`, 149 KB, horizontal overflow 0px | none |
| desktop | dark | ![home-paid-open desktop dark](home-paid-open--desktop--dark--built.png)<br>`/dashboard`, 151 KB, horizontal overflow 0px | none |
| mobile | light | ![home-paid-open mobile light](home-paid-open--mobile--light--built.png)<br>`/dashboard`, 60 KB, horizontal overflow 0px | none |
| mobile | dark | ![home-paid-open mobile dark](home-paid-open--mobile--dark--built.png)<br>`/dashboard`, 62 KB, horizontal overflow 0px | none |
| w1024 | light | ![home-paid-open w1024 light](home-paid-open--w1024--light--built.png)<br>`/dashboard`, 119 KB, horizontal overflow 0px | none |
| w1024 | dark | ![home-paid-open w1024 dark](home-paid-open--w1024--dark--built.png)<br>`/dashboard`, 121 KB, horizontal overflow 0px | none |

## Home (free): the bubble carries the rail's lock; clicked, it opens the existing upgrade modal for LISA (no tutor request)

Persona: `free`. Route: `/dashboard`.
Step: click `{"desktop":"[data-testid=\"chat-dock-bubble\"]","mobile":null}`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. No prototype draws the chat dock: it is the owner brief of 2026-10-22 ("LISA chat dock", floating bubble, no bar); DESIGN.md §3 and §4 describe it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-free-lock-modal desktop light](home-free-lock-modal--desktop--light--built.png)<br>`/dashboard`, 154 KB, horizontal overflow 0px | none |
| desktop | dark | ![home-free-lock-modal desktop dark](home-free-lock-modal--desktop--dark--built.png)<br>`/dashboard`, 151 KB, horizontal overflow 0px | none |
| mobile | light | ![home-free-lock-modal mobile light](home-free-lock-modal--mobile--light--built.png)<br>`/dashboard`, 64 KB, horizontal overflow 0px | none |
| mobile | dark | ![home-free-lock-modal mobile dark](home-free-lock-modal--mobile--dark--built.png)<br>`/dashboard`, 64 KB, horizontal overflow 0px | none |
| w1024 | light | ![home-free-lock-modal w1024 light](home-free-lock-modal--w1024--light--built.png)<br>`/dashboard`, 119 KB, horizontal overflow 0px | none |
| w1024 | dark | ![home-free-lock-modal w1024 dark](home-free-lock-modal--w1024--dark--built.png)<br>`/dashboard`, 117 KB, horizontal overflow 0px | none |

## Home (paid), the cookie banner not yet answered: the bubble sits above the banner (measured through lib/bottom-chrome.ts), never under it

Persona: `paid`. Route: `/dashboard`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. No prototype draws the chat dock: it is the owner brief of 2026-10-22 ("LISA chat dock", floating bubble, no bar); DESIGN.md §3 and §4 describe it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-paid-cookie-banner desktop light](home-paid-cookie-banner--desktop--light--built.png)<br>`/dashboard`, 162 KB, horizontal overflow 0px | none |
| desktop | dark | ![home-paid-cookie-banner desktop dark](home-paid-cookie-banner--desktop--dark--built.png)<br>`/dashboard`, 163 KB, horizontal overflow 0px | none |
| mobile | light | ![home-paid-cookie-banner mobile light](home-paid-cookie-banner--mobile--light--built.png)<br>`/dashboard`, 60 KB, horizontal overflow 0px | none |
| mobile | dark | ![home-paid-cookie-banner mobile dark](home-paid-cookie-banner--mobile--dark--built.png)<br>`/dashboard`, 61 KB, horizontal overflow 0px | none |
| w1024 | light | ![home-paid-cookie-banner w1024 light](home-paid-cookie-banner--w1024--light--built.png)<br>`/dashboard`, 126 KB, horizontal overflow 0px | none |
| w1024 | dark | ![home-paid-cookie-banner w1024 dark](home-paid-cookie-banner--w1024--dark--built.png)<br>`/dashboard`, 127 KB, horizontal overflow 0px | none |

## Review (paid): the LISA bubble, collapsed

Persona: `paid`. Route: `/review`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. No prototype draws the chat dock: it is the owner brief of 2026-10-22 ("LISA chat dock", floating bubble, no bar); DESIGN.md §3 and §4 describe it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-paid-bubble desktop light](review-paid-bubble--desktop--light--built.png)<br>`/review`, 142 KB, horizontal overflow 0px | none |
| desktop | dark | ![review-paid-bubble desktop dark](review-paid-bubble--desktop--dark--built.png)<br>`/review`, 144 KB, horizontal overflow 0px | none |
| mobile | light | ![review-paid-bubble mobile light](review-paid-bubble--mobile--light--built.png)<br>`/review`, 58 KB, horizontal overflow 0px | none |
| mobile | dark | ![review-paid-bubble mobile dark](review-paid-bubble--mobile--dark--built.png)<br>`/review`, 58 KB, horizontal overflow 0px | none |
| w1024 | light | ![review-paid-bubble w1024 light](review-paid-bubble--w1024--light--built.png)<br>`/review`, 110 KB, horizontal overflow 0px | none |
| w1024 | dark | ![review-paid-bubble w1024 dark](review-paid-bubble--w1024--dark--built.png)<br>`/review`, 111 KB, horizontal overflow 0px | none |

## Review (paid): the dock open in general mode

Persona: `paid`. Route: `/review`.
Step: click `{"desktop":"[data-testid=\"chat-dock-bubble\"]","mobile":null}`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. No prototype draws the chat dock: it is the owner brief of 2026-10-22 ("LISA chat dock", floating bubble, no bar); DESIGN.md §3 and §4 describe it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-paid-open desktop light](review-paid-open--desktop--light--built.png)<br>`/review`, 144 KB, horizontal overflow 0px | none |
| desktop | dark | ![review-paid-open desktop dark](review-paid-open--desktop--dark--built.png)<br>`/review`, 146 KB, horizontal overflow 0px | none |
| mobile | light | ![review-paid-open mobile light](review-paid-open--mobile--light--built.png)<br>`/review`, 58 KB, horizontal overflow 0px | none |
| mobile | dark | ![review-paid-open mobile dark](review-paid-open--mobile--dark--built.png)<br>`/review`, 58 KB, horizontal overflow 0px | none |
| w1024 | light | ![review-paid-open w1024 light](review-paid-open--w1024--light--built.png)<br>`/review`, 106 KB, horizontal overflow 0px | none |
| w1024 | dark | ![review-paid-open w1024 dark](review-paid-open--w1024--dark--built.png)<br>`/review`, 107 KB, horizontal overflow 0px | none |

## Review runner (paid), before submitting: no side panel; the bubble above the Submit footer and clear of the choices. Phone: unchanged (Show LISA in the bar, LISA closed)

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. No prototype draws the chat dock: it is the owner brief of 2026-10-22 ("LISA chat dock", floating bubble, no bar); DESIGN.md §3 and §4 describe it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![runner-collapsed desktop light](runner-collapsed--desktop--light--built.png)<br>`/review/session/d2607322-a6d4-4bb0-afb2-c570bebf087c`, 93 KB, horizontal overflow 0px | none |
| desktop | dark | ![runner-collapsed desktop dark](runner-collapsed--desktop--dark--built.png)<br>`/review/session/00218727-9a43-4fc1-8773-18859fc5eae4`, 96 KB, horizontal overflow 0px | none |
| mobile | light | ![runner-collapsed mobile light](runner-collapsed--mobile--light--built.png)<br>`/review/session/f2ab72a5-488e-4dbb-9e81-515c4d7ca2f8`, 72 KB, horizontal overflow 0px | none |
| mobile | dark | ![runner-collapsed mobile dark](runner-collapsed--mobile--dark--built.png)<br>`/review/session/91c3b25f-7827-418c-908a-6ef187bfac04`, 75 KB, horizontal overflow 0px | none |
| w1024 | light | ![runner-collapsed w1024 light](runner-collapsed--w1024--light--built.png)<br>`/review/session/b3d2929d-ca79-453c-8704-ca9dc1fbccaa`, 89 KB, horizontal overflow 0px | none |
| w1024 | dark | ![runner-collapsed w1024 dark](runner-collapsed--w1024--dark--built.png)<br>`/review/session/03c84bcf-c692-4b1a-8f7a-6c191c5e12a9`, 93 KB, horizontal overflow 0px | none |

## Review runner (paid): the dock open in the current question's scope (the 'Question N of M' chip, the opener), above the footer; the question stays usable

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: click `{"desktop":"[data-testid=\"chat-dock-bubble\"]","mobile":null}`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. No prototype draws the chat dock: it is the owner brief of 2026-10-22 ("LISA chat dock", floating bubble, no bar); DESIGN.md §3 and §4 describe it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![runner-open desktop light](runner-open--desktop--light--built.png)<br>`/review/session/23371fce-979a-4cfc-adc4-3c48adb76310`, 117 KB, horizontal overflow 0px | none |
| desktop | dark | ![runner-open desktop dark](runner-open--desktop--dark--built.png)<br>`/review/session/8d49411e-a1ab-402b-a7e9-44ffc782a402`, 120 KB, horizontal overflow 0px | none |
| mobile | light | ![runner-open mobile light](runner-open--mobile--light--built.png)<br>`/review/session/4abedaff-8db9-445d-a9c3-adccf329463d`, 73 KB, horizontal overflow 0px | none |
| mobile | dark | ![runner-open mobile dark](runner-open--mobile--dark--built.png)<br>`/review/session/b77b1796-fd38-4ae3-b0ec-ec52a1b97b86`, 75 KB, horizontal overflow 0px | none |
| w1024 | light | ![runner-open w1024 light](runner-open--w1024--light--built.png)<br>`/review/session/9b256878-1243-4446-ab19-4fa9d61d6320`, 101 KB, horizontal overflow 0px | none |
| w1024 | dark | ![runner-open w1024 dark](runner-open--w1024--dark--built.png)<br>`/review/session/16d419d1-6cfa-40aa-960b-a82807bdc880`, 103 KB, horizontal overflow 0px | none |

## The live timed module (Full-Length, Reading and Writing Module 2): no bubble and no dock (LISA never appears in a live test)

Persona: `paid`. Route: `/tests/{paid.inProgressExamSessionId}/RW/2`.
Must then show no `[data-testid="chat-dock-bubble"]` (the capture fails otherwise).
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. No prototype draws the chat dock: it is the owner brief of 2026-10-22 ("LISA chat dock", floating bubble, no bar); DESIGN.md §3 and §4 describe it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![timed-module desktop light](timed-module--desktop--light--built.png)<br>`/tests/e12218c7-14b6-4135-b6a9-e9e61dbe3a94/RW/2`, 97 KB, horizontal overflow 0px | none |
| mobile | light | ![timed-module mobile light](timed-module--mobile--light--built.png)<br>`/tests/e12218c7-14b6-4135-b6a9-e9e61dbe3a94/RW/2`, 64 KB, horizontal overflow 0px | none |
| w1024 | light | ![timed-module w1024 light](timed-module--w1024--light--built.png)<br>`/tests/e12218c7-14b6-4135-b6a9-e9e61dbe3a94/RW/2`, 97 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"b676a675-67f4-4ffd-9c75-1d6b5bfe1124","openPracticeSessionId":"a7a5cc51-3496-47bd-89da-2354f7b5b26c","openReviewSessionId":"39c54f3d-1957-4d3e-8a7f-781c5f31d64d","diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":39},"paid":{"completedPracticeSessionId":"34a67665-aca4-4851-babf-4d3d04ee5a16","openPracticeSessionId":"a3fc08c1-7850-4101-85e0-4fb8119a9751","openReviewSessionId":"5217892e-bd69-4dfd-9860-c6771b0f0433","diagnosticSessionId":"08861bcb-ae40-4d47-bd15-0b6bf3c8a666","scoredExamSessionId":"3ae24df9-120b-420f-958c-3a0690f78d4a","inProgressExamSessionId":"e12218c7-14b6-4135-b6a9-e9e61dbe3a94","lisaConversationId":"b9fde161-2304-4061-91e0-3a289cd44d71","answered":204}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- Desmos (QA2-B, opt-in `STUDENT_HARNESS_DESMOS=1`): not loaded (a local-only run; the calculator shows its unavailable line)
- External hosts blocked: none
