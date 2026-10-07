# UI-51 Practice (/practice): free and paid, filters chosen, light and dark, 1440 and 390

Generated 2026-10-07T10:14:38.210Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-51` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844, and any extra size a shot names.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## Practice, free: filter bar, Your session with the quota line, recent practice; panel: locked mastery, How practice counts

Persona: `free`. Route: `/practice`.
Prototype: `Practice.dc.html` (Practice, plan = free).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-free desktop light](practice-free--desktop--light--built.png)<br>`/practice`, 122 KB, horizontal overflow 0px | ![prototype light](proto--Practice--free--light.png), 117 KB |
| desktop | dark | ![practice-free desktop dark](practice-free--desktop--dark--built.png)<br>`/practice`, 123 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--free--dark.png), 119 KB |
| mobile | light | ![practice-free mobile light](practice-free--mobile--light--built.png)<br>`/practice`, 49 KB, horizontal overflow 0px | ![prototype light](proto--Practice--free--light.png)<br>desktop prototype (no phone layout), 117 KB |
| mobile | dark | ![practice-free mobile dark](practice-free--mobile--dark--built.png)<br>`/practice`, 50 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--free--dark.png)<br>desktop prototype (no phone layout), 119 KB |

## Practice, paid: filter bar, Your session, pick up, Suggested for you, recent practice; panel: mastery rows, How practice counts

Persona: `paid`. Route: `/practice`.
Prototype: `Practice.dc.html` (Practice, plan = paid).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-paid desktop light](practice-paid--desktop--light--built.png)<br>`/practice`, 128 KB, horizontal overflow 0px | ![prototype light](proto--Practice--paid--light.png), 129 KB |
| desktop | dark | ![practice-paid desktop dark](practice-paid--desktop--dark--built.png)<br>`/practice`, 131 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--paid--dark.png), 131 KB |
| mobile | light | ![practice-paid mobile light](practice-paid--mobile--light--built.png)<br>`/practice`, 49 KB, horizontal overflow 0px | ![prototype light](proto--Practice--paid--light.png)<br>desktop prototype (no phone layout), 129 KB |
| mobile | dark | ![practice-paid mobile dark](practice-paid--mobile--dark--built.png)<br>`/practice`, 49 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--paid--dark.png)<br>desktop prototype (no phone layout), 131 KB |

## Practice, paid, full page (on a phone the right panel stacks under the main column; the footer ends the column)

Persona: `paid`. Route: `/practice`.
Full page: the whole document, not just the viewport.
Prototype: `Practice.dc.html` (Practice, plan = paid (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-paid-full desktop light](practice-paid-full--desktop--light--built.png)<br>`/practice`, 128 KB, horizontal overflow 0px | ![prototype light](proto--Practice--paid--light.png), 129 KB |
| desktop | dark | ![practice-paid-full desktop dark](practice-paid-full--desktop--dark--built.png)<br>`/practice`, 131 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--paid--dark.png), 131 KB |
| mobile | light | ![practice-paid-full mobile light](practice-paid-full--mobile--light--built.png)<br>`/practice`, 174 KB, horizontal overflow 0px | ![prototype light](proto--Practice--paid--light.png)<br>desktop prototype (no phone layout), 129 KB |
| mobile | dark | ![practice-paid-full mobile dark](practice-paid-full--mobile--dark--built.png)<br>`/practice`, 177 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--paid--dark.png)<br>desktop prototype (no phone layout), 131 KB |

## Practice, free, full page (on a phone the right panel stacks under the main column; the footer ends the column)

Persona: `free`. Route: `/practice`.
Full page: the whole document, not just the viewport.
Prototype: `Practice.dc.html` (Practice, plan = free (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-free-full desktop light](practice-free-full--desktop--light--built.png)<br>`/practice`, 122 KB, horizontal overflow 0px | ![prototype light](proto--Practice--free--light.png), 117 KB |
| desktop | dark | ![practice-free-full desktop dark](practice-free-full--desktop--dark--built.png)<br>`/practice`, 123 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--free--dark.png), 119 KB |
| mobile | light | ![practice-free-full mobile light](practice-free-full--mobile--light--built.png)<br>`/practice`, 126 KB, horizontal overflow 0px | ![prototype light](proto--Practice--free--light.png)<br>desktop prototype (no phone layout), 117 KB |
| mobile | dark | ![practice-free-full mobile dark](practice-free-full--mobile--dark--built.png)<br>`/practice`, 128 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--free--dark.png)<br>desktop prototype (no phone layout), 119 KB |

## Practice, paid, with Domain: Algebra, a skill (the harness bank's one fixture skill) and Difficulty: Medium chosen through the filter bar's menus (chips and summary follow)

Persona: `paid`. Route: `/practice`.
Step: click `{"desktop":"[data-testid=\"filter-menu-domain\"]","mobile":"[data-testid=\"filter-menu-domain\"]"}`.
Step: click `{"desktop":"[role=\"menuitemcheckbox\"]:text-is(\"Algebra\")","mobile":"[role=\"menuitemcheckbox\"]:text-is(\"Algebra\")"}`.
Step: click `{"desktop":"[role=\"menuitem\"]:text-is(\"Done\")","mobile":"[role=\"menuitem\"]:text-is(\"Done\")"}`.
Step: click `{"desktop":"[data-testid=\"filter-menu-skill\"]","mobile":"[data-testid=\"filter-menu-skill\"]"}`.
Step: click `{"desktop":"[role=\"menuitemcheckbox\"]","mobile":"[role=\"menuitemcheckbox\"]"}`.
Step: click `{"desktop":"[role=\"menuitem\"]:text-is(\"Done\")","mobile":"[role=\"menuitem\"]:text-is(\"Done\")"}`.
Step: click `{"desktop":"[data-testid=\"filter-menu-difficulty\"]","mobile":"[data-testid=\"filter-menu-difficulty\"]"}`.
Step: click `{"desktop":"[role=\"menuitemcheckbox\"]:text-is(\"Medium\")","mobile":"[role=\"menuitemcheckbox\"]:text-is(\"Medium\")"}`.
Step: click `{"desktop":"[role=\"menuitem\"]:text-is(\"Done\")","mobile":"[role=\"menuitem\"]:text-is(\"Done\")"}`.
Prototype: `Practice.dc.html` (Practice, plan = paid, the same three choices clicked on the canvas); clicked: `button[aria-expanded]:has-text("Domain")`, `label:has-text("Algebra")`, `button:text-is("Done")`, `button[aria-expanded]:has-text("Skill")`, `label:has-text("Linear Functions")`, `button:text-is("Done")`, `button[aria-expanded]:has-text("Difficulty")`, `label:has-text("Medium")`, `button:text-is("Done")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-paid-filtered desktop light](practice-paid-filtered--desktop--light--built.png)<br>`/practice`, 129 KB, horizontal overflow 0px | ![prototype light](proto--Practice--paid--light--clicked.png), 128 KB |
| desktop | dark | ![practice-paid-filtered desktop dark](practice-paid-filtered--desktop--dark--built.png)<br>`/practice`, 131 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--paid--dark--clicked.png), 130 KB |
| mobile | light | ![practice-paid-filtered mobile light](practice-paid-filtered--mobile--light--built.png)<br>`/practice`, 46 KB, horizontal overflow 0px | ![prototype light](proto--Practice--paid--light--clicked.png)<br>desktop prototype (no phone layout), 128 KB |
| mobile | dark | ![practice-paid-filtered mobile dark](practice-paid-filtered--mobile--dark--built.png)<br>`/practice`, 46 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--paid--dark--clicked.png)<br>desktop prototype (no phone layout), 130 KB |

## QA item 5: Start pressed, the create held in flight: 'Starting…' with a spinner, disabled

Persona: `paid`. Route: `/practice`.
Step: click `{"desktop":"[data-testid=\"practice-start\"]","mobile":"[data-testid=\"practice-start\"]"}`.
Held: the browser's `POST /api/practice/sessions` is left unanswered through the screenshot, then aborted (it never reaches the server).
Must then show `[data-testid="practice-start"][aria-busy="true"]` (the capture fails otherwise).
Prototype: none. A pending state the prototype does not draw (owner QA list, 2026-10-07, item 5).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![click-paid-start-pending desktop light](click-paid-start-pending--desktop--light--built.png)<br>`/practice`, 128 KB, horizontal overflow 0px | none |
| desktop | dark | ![click-paid-start-pending desktop dark](click-paid-start-pending--desktop--dark--built.png)<br>`/practice`, 130 KB, horizontal overflow 0px | none |
| mobile | light | ![click-paid-start-pending mobile light](click-paid-start-pending--mobile--light--built.png)<br>`/practice`, 49 KB, horizontal overflow 0px | none |
| mobile | dark | ![click-paid-start-pending mobile dark](click-paid-start-pending--mobile--dark--built.png)<br>`/practice`, 49 KB, horizontal overflow 0px | none |

## Click path (paid): choose a domain, a skill and a difficulty, then Start lands in the practice runner

Persona: `paid`. Route: `/practice`.
Step: click `{"desktop":"[data-testid=\"filter-menu-domain\"]","mobile":"[data-testid=\"filter-menu-domain\"]"}`.
Step: click `{"desktop":"[role=\"menuitemcheckbox\"]:text-is(\"Algebra\")","mobile":"[role=\"menuitemcheckbox\"]:text-is(\"Algebra\")"}`.
Step: click `{"desktop":"[role=\"menuitem\"]:text-is(\"Done\")","mobile":"[role=\"menuitem\"]:text-is(\"Done\")"}`.
Step: click `{"desktop":"[data-testid=\"filter-menu-skill\"]","mobile":"[data-testid=\"filter-menu-skill\"]"}`.
Step: click `{"desktop":"[role=\"menuitemcheckbox\"]","mobile":"[role=\"menuitemcheckbox\"]"}`.
Step: click `{"desktop":"[role=\"menuitem\"]:text-is(\"Done\")","mobile":"[role=\"menuitem\"]:text-is(\"Done\")"}`.
Step: click `{"desktop":"[data-testid=\"filter-menu-difficulty\"]","mobile":"[data-testid=\"filter-menu-difficulty\"]"}`.
Step: click `{"desktop":"[role=\"menuitemcheckbox\"]:text-is(\"Medium\")","mobile":"[role=\"menuitemcheckbox\"]:text-is(\"Medium\")"}`.
Step: click `{"desktop":"[role=\"menuitem\"]:text-is(\"Done\")","mobile":"[role=\"menuitem\"]:text-is(\"Done\")"}`.
Step: click `{"desktop":"[data-testid=\"practice-start\"]","mobile":"[data-testid=\"practice-start\"]"}`.
Click path: must land on a path matching `^/practice/session/[0-9a-f-]{36}$` (the capture fails otherwise); the path it landed on is under each built shot.
Prototype: none. A click path: the screenshot is where the click landed (the runner), proven by its pathname.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![click-paid-start desktop light](click-paid-start--desktop--light--built.png)<br>`/practice/session/c8f74c33-9e0a-4b60-b710-012ca756a506`, 39 KB, horizontal overflow 0px | none |
| desktop | dark | ![click-paid-start desktop dark](click-paid-start--desktop--dark--built.png)<br>`/practice/session/fdafdb52-5ead-43c2-b5ea-34ae54fdf556`, 40 KB, horizontal overflow 0px | none |
| mobile | light | ![click-paid-start mobile light](click-paid-start--mobile--light--built.png)<br>`/practice/session/25961614-b761-461e-a283-de97c22bd3c2`, 26 KB, horizontal overflow 0px | none |
| mobile | dark | ![click-paid-start mobile dark](click-paid-start--mobile--dark--built.png)<br>`/practice/session/c007f2df-b37d-4bf0-a2ac-b0b90876414a`, 33 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"6db0a2d2-8297-441e-892e-c3685df541b1","openPracticeSessionId":"4a1d5533-e137-4492-a2f1-d96bfda363e0","openReviewSessionId":null,"diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":13},"paid":{"completedPracticeSessionId":"d333f9d6-9812-4ef5-867e-df4a66ce4ca9","openPracticeSessionId":"73a158d2-abce-42b0-b9a4-2cfb30aa64ac","openReviewSessionId":null,"diagnosticSessionId":"90b58e6b-a62f-4301-b589-1dffc621e45e","scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":53}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- External hosts blocked: none
