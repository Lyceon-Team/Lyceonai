# Getting started checklist, Practice rows, target score (light and dark, 1440 and 390)

Generated 2026-10-13T10:01:54.761Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts GETTING-STARTED` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844, and any extra size a shot names.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## Home, free: greeting → the Getting started checklist (dots, 'N of M', the current step expanded) → today's question → 'Find your blind spots' → Practice and Review

Persona: `free`. Route: `/dashboard`.
Full page: the whole document, not just the viewport.
Prototype: none. NOT PROTOTYPED: the Getting started checklist, Practice's rows and the score question are new in final brief v2 (Karl, 2026-10-13) and its #1230 follow-ups; built to the approved v2 mocks and DESIGN.md's tokens.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-free-getting-started desktop light](home-free-getting-started--desktop--light--built.png)<br>`/dashboard`, 141 KB, horizontal overflow 0px | none |
| desktop | dark | ![home-free-getting-started desktop dark](home-free-getting-started--desktop--dark--built.png)<br>`/dashboard`, 143 KB, horizontal overflow 0px | none |
| mobile | light | ![home-free-getting-started mobile light](home-free-getting-started--mobile--light--built.png)<br>`/dashboard`, 171 KB, horizontal overflow 0px | none |
| mobile | dark | ![home-free-getting-started mobile dark](home-free-getting-started--mobile--dark--built.png)<br>`/dashboard`, 174 KB, horizontal overflow 0px | none |

## Home, Pro: the checklist's eight steps above today's question; today's plan outlined while it shows

Persona: `paid`. Route: `/dashboard`.
Full page: the whole document, not just the viewport.
Prototype: none. NOT PROTOTYPED: the Getting started checklist, Practice's rows and the score question are new in final brief v2 (Karl, 2026-10-13) and its #1230 follow-ups; built to the approved v2 mocks and DESIGN.md's tokens.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-paid-getting-started desktop light](home-paid-getting-started--desktop--light--built.png)<br>`/dashboard`, 152 KB, horizontal overflow 0px | none |
| desktop | dark | ![home-paid-getting-started desktop dark](home-paid-getting-started--desktop--dark--built.png)<br>`/dashboard`, 151 KB, horizontal overflow 0px | none |
| mobile | light | ![home-paid-getting-started mobile light](home-paid-getting-started--mobile--light--built.png)<br>`/dashboard`, 258 KB, horizontal overflow 0px | none |
| mobile | dark | ![home-paid-getting-started mobile dark](home-paid-getting-started--mobile--dark--built.png)<br>`/dashboard`, 264 KB, horizontal overflow 0px | none |

## Practice, free: the 'Find your blind spots' row below the filters, then 'Your session', then the locked 'Full-length test' row

Persona: `free`. Route: `/practice`.
Full page: the whole document, not just the viewport.
Prototype: none. NOT PROTOTYPED: the Getting started checklist, Practice's rows and the score question are new in final brief v2 (Karl, 2026-10-13) and its #1230 follow-ups; built to the approved v2 mocks and DESIGN.md's tokens.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-free-rows desktop light](practice-free-rows--desktop--light--built.png)<br>`/practice`, 120 KB, horizontal overflow 0px | none |
| desktop | dark | ![practice-free-rows desktop dark](practice-free-rows--desktop--dark--built.png)<br>`/practice`, 121 KB, horizontal overflow 0px | none |
| mobile | light | ![practice-free-rows mobile light](practice-free-rows--mobile--light--built.png)<br>`/practice`, 142 KB, horizontal overflow 0px | none |
| mobile | dark | ![practice-free-rows mobile dark](practice-free-rows--mobile--dark--built.png)<br>`/practice`, 143 KB, horizontal overflow 0px | none |

## Practice, free: the locked full-length Start opens the upgrade modal in place (phone and desktop)

Persona: `free`. Route: `/practice`.
Step: click `{"desktop":"[data-testid=\"practice-full-length-start\"]","mobile":"[data-testid=\"practice-full-length-start\"]"}`.
Must then show `[data-testid="upgrade-modal"]` (the capture fails otherwise).
Click path: must land on a path matching `^/practice$` (the capture fails otherwise); the path it landed on is under each built shot.
Prototype: none. NOT PROTOTYPED: the Getting started checklist, Practice's rows and the score question are new in final brief v2 (Karl, 2026-10-13) and its #1230 follow-ups; built to the approved v2 mocks and DESIGN.md's tokens.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-free-full-length-modal desktop light](practice-free-full-length-modal--desktop--light--built.png)<br>`/practice`, 139 KB, horizontal overflow 0px | none |
| desktop | dark | ![practice-free-full-length-modal desktop dark](practice-free-full-length-modal--desktop--dark--built.png)<br>`/practice`, 136 KB, horizontal overflow 0px | none |
| mobile | light | ![practice-free-full-length-modal mobile light](practice-free-full-length-modal--mobile--light--built.png)<br>`/practice`, 55 KB, horizontal overflow 0px | none |
| mobile | dark | ![practice-free-full-length-modal mobile dark](practice-free-full-length-modal--mobile--dark--built.png)<br>`/practice`, 54 KB, horizontal overflow 0px | none |

## Practice, Pro: the 'Full-length test' row, whose Start links to the Full-Length page

Persona: `paid`. Route: `/practice`.
Full page: the whole document, not just the viewport.
Prototype: none. NOT PROTOTYPED: the Getting started checklist, Practice's rows and the score question are new in final brief v2 (Karl, 2026-10-13) and its #1230 follow-ups; built to the approved v2 mocks and DESIGN.md's tokens.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-paid-full-length desktop light](practice-paid-full-length--desktop--light--built.png)<br>`/practice`, 125 KB, horizontal overflow 0px | none |
| desktop | dark | ![practice-paid-full-length desktop dark](practice-paid-full-length--desktop--dark--built.png)<br>`/practice`, 127 KB, horizontal overflow 0px | none |
| mobile | light | ![practice-paid-full-length mobile light](practice-paid-full-length--mobile--light--built.png)<br>`/practice`, 183 KB, horizontal overflow 0px | none |
| mobile | dark | ![practice-paid-full-length mobile dark](practice-paid-full-length--mobile--dark--built.png)<br>`/practice`, 186 KB, horizontal overflow 0px | none |

## Settings → Profile, free: SAT test date and target score shown to every student; the score reads 'Choose a score' until one is chosen

Persona: `free`. Route: `/profile?tab=profile`.
Prototype: none. NOT PROTOTYPED: the Getting started checklist, Practice's rows and the score question are new in final brief v2 (Karl, 2026-10-13) and its #1230 follow-ups; built to the approved v2 mocks and DESIGN.md's tokens.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![settings-profile-free-score desktop light](settings-profile-free-score--desktop--light--built.png)<br>`/profile`, 80 KB, horizontal overflow 0px | none |
| desktop | dark | ![settings-profile-free-score desktop dark](settings-profile-free-score--desktop--dark--built.png)<br>`/profile`, 80 KB, horizontal overflow 0px | none |
| mobile | light | ![settings-profile-free-score mobile light](settings-profile-free-score--mobile--light--built.png)<br>`/profile`, 51 KB, horizontal overflow 0px | none |
| mobile | dark | ![settings-profile-free-score mobile dark](settings-profile-free-score--mobile--dark--built.png)<br>`/profile`, 51 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"fd1f1897-a84a-48ce-9349-8ab1c3664605","openPracticeSessionId":"9732f23e-3831-455a-bf8a-a6819338f383","openReviewSessionId":null,"diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":13},"paid":{"completedPracticeSessionId":"53678d91-8d3f-49b9-b0e8-323c189668b1","openPracticeSessionId":"f52b20c9-d04b-4251-b95b-43e9c6f87ad7","openReviewSessionId":null,"diagnosticSessionId":"fc50a325-3279-421b-87ba-e07ebf4893d3","scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":53}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- Desmos (QA2-B, opt-in `STUDENT_HARNESS_DESMOS=1`): not loaded (a local-only run; the calculator shows its unavailable line)
- External hosts blocked: none
