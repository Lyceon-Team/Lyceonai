# UI-51 Practice (/practice): free and paid, filters chosen, light and dark, 1440 and 390

Generated 2026-10-08T03:26:32.054Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-51` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

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
| desktop | light | ![practice-free desktop light](practice-free--desktop--light--built.png)<br>`/practice`, 124 KB, horizontal overflow 0px | ![prototype light](proto--Practice--free--light.png), 117 KB |
| desktop | dark | ![practice-free desktop dark](practice-free--desktop--dark--built.png)<br>`/practice`, 125 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--free--dark.png), 119 KB |
| mobile | light | ![practice-free mobile light](practice-free--mobile--light--built.png)<br>`/practice`, 50 KB, horizontal overflow 0px | ![prototype light](proto--Practice--free--light.png)<br>desktop prototype (no phone layout), 117 KB |
| mobile | dark | ![practice-free mobile dark](practice-free--mobile--dark--built.png)<br>`/practice`, 50 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--free--dark.png)<br>desktop prototype (no phone layout), 119 KB |

## Practice, paid: filter bar, Your session, pick up, Suggested for you, recent practice; panel: mastery rows, How practice counts

Persona: `paid`. Route: `/practice`.
Prototype: `Practice.dc.html` (Practice, plan = paid).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-paid desktop light](practice-paid--desktop--light--built.png)<br>`/practice`, 128 KB, horizontal overflow 0px | ![prototype light](proto--Practice--paid--light.png), 129 KB |
| desktop | dark | ![practice-paid desktop dark](practice-paid--desktop--dark--built.png)<br>`/practice`, 131 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--paid--dark.png), 131 KB |
| mobile | light | ![practice-paid mobile light](practice-paid--mobile--light--built.png)<br>`/practice`, 49 KB, horizontal overflow 0px | ![prototype light](proto--Practice--paid--light.png)<br>desktop prototype (no phone layout), 129 KB |
| mobile | dark | ![practice-paid mobile dark](practice-paid--mobile--dark--built.png)<br>`/practice`, 50 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--paid--dark.png)<br>desktop prototype (no phone layout), 131 KB |

## Practice, paid, full page (on a phone the right panel stacks under the main column; the footer ends the column)

Persona: `paid`. Route: `/practice`.
Full page: the whole document, not just the viewport.
Prototype: `Practice.dc.html` (Practice, plan = paid (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-paid-full desktop light](practice-paid-full--desktop--light--built.png)<br>`/practice`, 128 KB, horizontal overflow 0px | ![prototype light](proto--Practice--paid--light.png), 129 KB |
| desktop | dark | ![practice-paid-full desktop dark](practice-paid-full--desktop--dark--built.png)<br>`/practice`, 131 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--paid--dark.png), 131 KB |
| mobile | light | ![practice-paid-full mobile light](practice-paid-full--mobile--light--built.png)<br>`/practice`, 173 KB, horizontal overflow 0px | ![prototype light](proto--Practice--paid--light.png)<br>desktop prototype (no phone layout), 129 KB |
| mobile | dark | ![practice-paid-full mobile dark](practice-paid-full--mobile--dark--built.png)<br>`/practice`, 176 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--paid--dark.png)<br>desktop prototype (no phone layout), 131 KB |

## Practice, free, full page (on a phone the right panel stacks under the main column; the footer ends the column)

Persona: `free`. Route: `/practice`.
Full page: the whole document, not just the viewport.
Prototype: `Practice.dc.html` (Practice, plan = free (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-free-full desktop light](practice-free-full--desktop--light--built.png)<br>`/practice`, 124 KB, horizontal overflow 0px | ![prototype light](proto--Practice--free--light.png), 117 KB |
| desktop | dark | ![practice-free-full desktop dark](practice-free-full--desktop--dark--built.png)<br>`/practice`, 125 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--free--dark.png), 119 KB |
| mobile | light | ![practice-free-full mobile light](practice-free-full--mobile--light--built.png)<br>`/practice`, 127 KB, horizontal overflow 0px | ![prototype light](proto--Practice--free--light.png)<br>desktop prototype (no phone layout), 117 KB |
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
| desktop | light | ![practice-paid-filtered desktop light](practice-paid-filtered--desktop--light--built.png)<br>`/practice`, 132 KB, horizontal overflow 0px | ![prototype light](proto--Practice--paid--light--clicked.png), 128 KB |
| desktop | dark | ![practice-paid-filtered desktop dark](practice-paid-filtered--desktop--dark--built.png)<br>`/practice`, 134 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--paid--dark--clicked.png), 130 KB |
| mobile | light | ![practice-paid-filtered mobile light](practice-paid-filtered--mobile--light--built.png)<br>`/practice`, 47 KB, horizontal overflow 0px | ![prototype light](proto--Practice--paid--light--clicked.png)<br>desktop prototype (no phone layout), 128 KB |
| mobile | dark | ![practice-paid-filtered mobile dark](practice-paid-filtered--mobile--dark--built.png)<br>`/practice`, 47 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--paid--dark--clicked.png)<br>desktop prototype (no phone layout), 130 KB |

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
| mobile | dark | ![click-paid-start-pending mobile dark](click-paid-start-pending--mobile--dark--built.png)<br>`/practice`, 50 KB, horizontal overflow 0px | none |

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
| desktop | light | ![click-paid-start desktop light](click-paid-start--desktop--light--built.png)<br>`/practice/session/b8ef56cf-9454-4682-b836-1aa0cc97e245`, 40 KB, horizontal overflow 0px | none |
| desktop | dark | ![click-paid-start desktop dark](click-paid-start--desktop--dark--built.png)<br>`/practice/session/607ce03d-3f96-40e5-a60c-c2bd00d9f348`, 40 KB, horizontal overflow 0px | none |
| mobile | light | ![click-paid-start mobile light](click-paid-start--mobile--light--built.png)<br>`/practice/session/8704cbec-2b03-412f-ba7f-563659e4395d`, 25 KB, horizontal overflow 0px | none |
| mobile | dark | ![click-paid-start mobile dark](click-paid-start--mobile--dark--built.png)<br>`/practice/session/d31da1fd-1f4e-479f-b05c-63866c4f5466`, 32 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"1c9c2570-c6cd-48d5-b4f7-ca17bb008d3f","openPracticeSessionId":"5179dc09-52ca-4b49-af1e-4520547ca6ab","openReviewSessionId":null,"diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":13},"paid":{"completedPracticeSessionId":"e1706672-82d0-4c64-9655-063f89567442","openPracticeSessionId":"732c6703-6715-433a-9e4e-c9644d687575","openReviewSessionId":null,"diagnosticSessionId":"0b089992-af64-44c5-b18a-275c0de0b62d","scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":53}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- Desmos (QA2-B, opt-in `STUDENT_HARNESS_DESMOS=1`): not loaded (a local-only run; the calculator shows its unavailable line)
- External hosts blocked: none
