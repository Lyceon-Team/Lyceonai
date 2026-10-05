# UI-51 Practice (/practice): free and paid, filters chosen, light and dark, 1440 and 390

Generated 2026-10-03T13:16:27.633Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-51` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844.
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
| desktop | light | ![practice-paid desktop light](practice-paid--desktop--light--built.png)<br>`/practice`, 130 KB, horizontal overflow 0px | ![prototype light](proto--Practice--paid--light.png), 129 KB |
| desktop | dark | ![practice-paid desktop dark](practice-paid--desktop--dark--built.png)<br>`/practice`, 132 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--paid--dark.png), 131 KB |
| mobile | light | ![practice-paid mobile light](practice-paid--mobile--light--built.png)<br>`/practice`, 49 KB, horizontal overflow 0px | ![prototype light](proto--Practice--paid--light.png)<br>desktop prototype (no phone layout), 129 KB |
| mobile | dark | ![practice-paid mobile dark](practice-paid--mobile--dark--built.png)<br>`/practice`, 49 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--paid--dark.png)<br>desktop prototype (no phone layout), 131 KB |

## Practice, paid, full page (on a phone the right panel stacks under the main column; the footer ends the column)

Persona: `paid`. Route: `/practice`.
Full page: the whole document, not just the viewport.
Prototype: `Practice.dc.html` (Practice, plan = paid (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-paid-full desktop light](practice-paid-full--desktop--light--built.png)<br>`/practice`, 130 KB, horizontal overflow 0px | ![prototype light](proto--Practice--paid--light.png), 129 KB |
| desktop | dark | ![practice-paid-full desktop dark](practice-paid-full--desktop--dark--built.png)<br>`/practice`, 132 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--paid--dark.png), 131 KB |
| mobile | light | ![practice-paid-full mobile light](practice-paid-full--mobile--light--built.png)<br>`/practice`, 175 KB, horizontal overflow 0px | ![prototype light](proto--Practice--paid--light.png)<br>desktop prototype (no phone layout), 129 KB |
| mobile | dark | ![practice-paid-full mobile dark](practice-paid-full--mobile--dark--built.png)<br>`/practice`, 178 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--paid--dark.png)<br>desktop prototype (no phone layout), 131 KB |

## Practice, free, full page (on a phone the right panel stacks under the main column; the footer ends the column)

Persona: `free`. Route: `/practice`.
Full page: the whole document, not just the viewport.
Prototype: `Practice.dc.html` (Practice, plan = free (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-free-full desktop light](practice-free-full--desktop--light--built.png)<br>`/practice`, 122 KB, horizontal overflow 0px | ![prototype light](proto--Practice--free--light.png), 117 KB |
| desktop | dark | ![practice-free-full desktop dark](practice-free-full--desktop--dark--built.png)<br>`/practice`, 123 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--free--dark.png), 119 KB |
| mobile | light | ![practice-free-full mobile light](practice-free-full--mobile--light--built.png)<br>`/practice`, 125 KB, horizontal overflow 0px | ![prototype light](proto--Practice--free--light.png)<br>desktop prototype (no phone layout), 117 KB |
| mobile | dark | ![practice-free-full mobile dark](practice-free-full--mobile--dark--built.png)<br>`/practice`, 127 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--free--dark.png)<br>desktop prototype (no phone layout), 119 KB |

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
Prototype: `Practice.dc.html` (Practice, plan = paid, the same three choices clicked on the canvas).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-paid-filtered desktop light](practice-paid-filtered--desktop--light--built.png)<br>`/practice`, 129 KB, horizontal overflow 0px | ![prototype light](proto--Practice--paid--light--clicked.png), 128 KB |
| desktop | dark | ![practice-paid-filtered desktop dark](practice-paid-filtered--desktop--dark--built.png)<br>`/practice`, 131 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--paid--dark--clicked.png), 130 KB |
| mobile | light | ![practice-paid-filtered mobile light](practice-paid-filtered--mobile--light--built.png)<br>`/practice`, 46 KB, horizontal overflow 0px | ![prototype light](proto--Practice--paid--light--clicked.png)<br>desktop prototype (no phone layout), 128 KB |
| mobile | dark | ![practice-paid-filtered mobile dark](practice-paid-filtered--mobile--dark--built.png)<br>`/practice`, 46 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--paid--dark--clicked.png)<br>desktop prototype (no phone layout), 130 KB |

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
| desktop | light | ![click-paid-start desktop light](click-paid-start--desktop--light--built.png)<br>`/practice/session/202ec5b3-2fdd-4945-9857-d3f9c0fc97ea`, 53 KB, horizontal overflow 0px | none |
| desktop | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![click-paid-start desktop dark](click-paid-start--desktop--dark--built.png)<br>`/practice/session/ffbfaa02-8722-4053-bae7-46bf1b2b2ee9`, 53 KB, horizontal overflow 0px | none |
| mobile | light | ![click-paid-start mobile light](click-paid-start--mobile--light--built.png)<br>`/practice/session/4aa47078-5fd6-44bd-9145-19bc2665606d`, 48 KB, horizontal overflow 0px | none |
| mobile | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![click-paid-start mobile dark](click-paid-start--mobile--dark--built.png)<br>`/practice/session/9c33a209-2872-44ed-adcc-e8b381e202c3`, 48 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"6f3f743a-47b7-4495-8b18-47111a9c8141","openPracticeSessionId":"c356677c-abb8-4629-acb5-8d08bddb09c6","diagnosticSessionId":null,"answered":13},"paid":{"completedPracticeSessionId":"3c9dfb99-d77e-4b1c-a044-10665986db85","openPracticeSessionId":"12cc6541-298c-496b-a5bc-c53c07851c60","diagnosticSessionId":"b2ad0c05-ca1d-4995-a06b-3717328352fe","answered":53}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- External hosts blocked: `fonts.googleapis.com`
