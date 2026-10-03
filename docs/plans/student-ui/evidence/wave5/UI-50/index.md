# UI-50 Home (/dashboard): free and paid, light and dark, 1440 and 390

Generated 2026-10-03T12:28:18.644Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-50` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## Home, free (diagnostic not taken): diagnostic card, How Lyceon works; panel: projection empty state, locked mastery, today's quota

Persona: `free`. Route: `/dashboard`.
Prototype: `Main.dc.html` (Home, plan = free).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-free desktop light](home-free--desktop--light--built.png)<br>`/dashboard`, 140 KB, horizontal overflow 0px | ![prototype light](proto--Main--free--light.png), 141 KB |
| desktop | dark | ![home-free desktop dark](home-free--desktop--dark--built.png)<br>`/dashboard`, 140 KB, horizontal overflow 0px | ![prototype dark](proto--Main--free--dark.png), 142 KB |
| mobile | light | ![home-free mobile light](home-free--mobile--light--built.png)<br>`/dashboard`, 63 KB, horizontal overflow 0px | ![prototype light](proto--Main--free--light.png)<br>desktop prototype (no phone layout), 141 KB |
| mobile | dark | ![home-free mobile dark](home-free--mobile--dark--built.png)<br>`/dashboard`, 63 KB, horizontal overflow 0px | ![prototype dark](proto--Main--free--dark.png)<br>desktop prototype (no phone layout), 142 KB |

## Home, paid (diagnostic taken, calendar set up): today's plan, mastery, pick up; panel: projection, this week, recent sessions

Persona: `paid`. Route: `/dashboard`.
Prototype: `Main.dc.html` (Home, plan = paid).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-paid desktop light](home-paid--desktop--light--built.png)<br>`/dashboard`, 130 KB, horizontal overflow 0px | ![prototype light](proto--Main--paid--light.png), 147 KB |
| desktop | dark | ![home-paid desktop dark](home-paid--desktop--dark--built.png)<br>`/dashboard`, 131 KB, horizontal overflow 0px | ![prototype dark](proto--Main--paid--dark.png), 147 KB |
| mobile | light | ![home-paid mobile light](home-paid--mobile--light--built.png)<br>`/dashboard`, 50 KB, horizontal overflow 0px | ![prototype light](proto--Main--paid--light.png)<br>desktop prototype (no phone layout), 147 KB |
| mobile | dark | ![home-paid mobile dark](home-paid--mobile--dark--built.png)<br>`/dashboard`, 50 KB, horizontal overflow 0px | ![prototype dark](proto--Main--paid--dark.png)<br>desktop prototype (no phone layout), 147 KB |

## Home, paid, full page (on a phone the right panel stacks under the main column; the footer ends the column)

Persona: `paid`. Route: `/dashboard`.
Full page: the whole document, not just the viewport.
Prototype: `Main.dc.html` (Home, plan = paid (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-paid-full desktop light](home-paid-full--desktop--light--built.png)<br>`/dashboard`, 130 KB, horizontal overflow 0px | ![prototype light](proto--Main--paid--light.png), 147 KB |
| desktop | dark | ![home-paid-full desktop dark](home-paid-full--desktop--dark--built.png)<br>`/dashboard`, 131 KB, horizontal overflow 0px | ![prototype dark](proto--Main--paid--dark.png), 147 KB |
| mobile | light | ![home-paid-full mobile light](home-paid-full--mobile--light--built.png)<br>`/dashboard`, 172 KB, horizontal overflow 0px | ![prototype light](proto--Main--paid--light.png)<br>desktop prototype (no phone layout), 147 KB |
| mobile | dark | ![home-paid-full mobile dark](home-paid-full--mobile--dark--built.png)<br>`/dashboard`, 176 KB, horizontal overflow 0px | ![prototype dark](proto--Main--paid--dark.png)<br>desktop prototype (no phone layout), 147 KB |

## Home, free, full page (on a phone the right panel stacks under the main column; the footer ends the column)

Persona: `free`. Route: `/dashboard`.
Full page: the whole document, not just the viewport.
Prototype: `Main.dc.html` (Home, plan = free (the canvas is a fixed 1440x900)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-free-full desktop light](home-free-full--desktop--light--built.png)<br>`/dashboard`, 140 KB, horizontal overflow 0px | ![prototype light](proto--Main--free--light.png), 141 KB |
| desktop | dark | ![home-free-full desktop dark](home-free-full--desktop--dark--built.png)<br>`/dashboard`, 140 KB, horizontal overflow 0px | ![prototype dark](proto--Main--free--dark.png), 142 KB |
| mobile | light | ![home-free-full mobile light](home-free-full--mobile--light--built.png)<br>`/dashboard`, 152 KB, horizontal overflow 0px | ![prototype light](proto--Main--free--light.png)<br>desktop prototype (no phone layout), 141 KB |
| mobile | dark | ![home-free-full mobile dark](home-free-full--mobile--dark--built.png)<br>`/dashboard`, 152 KB, horizontal overflow 0px | ![prototype dark](proto--Main--free--dark.png)<br>desktop prototype (no phone layout), 142 KB |

## Home, free: 'See what's included' on the locked mastery card opens the upgrade modal (mastery_detail)

Persona: `free`. Route: `/dashboard`.
Step: click `{"desktop":"[data-testid=\"locked-mastery-see-included\"]","mobile":"[data-testid=\"locked-mastery-see-included\"]"}`.
Prototype: `Main.dc.html` (Home, plan = free, 'See what's included' clicked).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-free-mastery-modal desktop light](home-free-mastery-modal--desktop--light--built.png)<br>`/dashboard`, 154 KB, horizontal overflow 0px | ![prototype light](proto--Main--free--light--clicked.png), 156 KB |
| desktop | dark | ![home-free-mastery-modal desktop dark](home-free-mastery-modal--desktop--dark--built.png)<br>`/dashboard`, 151 KB, horizontal overflow 0px | ![prototype dark](proto--Main--free--dark--clicked.png), 153 KB |
| mobile | light | ![home-free-mastery-modal mobile light](home-free-mastery-modal--mobile--light--built.png)<br>`/dashboard`, 53 KB, horizontal overflow 0px | ![prototype light](proto--Main--free--light--clicked.png)<br>desktop prototype (no phone layout), 156 KB |
| mobile | dark | ![home-free-mastery-modal mobile dark](home-free-mastery-modal--mobile--dark--built.png)<br>`/dashboard`, 53 KB, horizontal overflow 0px | ![prototype dark](proto--Main--free--dark--clicked.png)<br>desktop prototype (no phone layout), 153 KB |

## Click path (paid): 'Start today's plan' launches today's first open block and lands in its runner

Persona: `paid`. Route: `/dashboard`.
Step: click `{"desktop":"[data-testid=\"home-start-plan\"]","mobile":"[data-testid=\"home-start-plan\"]"}`.
Click path: must land on a path matching `^/(practice|review)/session/[0-9a-f-]{36}$|^/tests/[0-9a-f-]{36}$` (the capture fails otherwise); the path it landed on is under each built shot.
Prototype: none. A click path: the screenshot is where the click landed (the runner), proven by its pathname.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![click-paid-start-plan desktop light](click-paid-start-plan--desktop--light--built.png)<br>`/review/session/54ea4f1a-df02-4eec-b8ea-69802e9fcb1d`, 75 KB, horizontal overflow 0px | none |
| desktop | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![click-paid-start-plan desktop dark](click-paid-start-plan--desktop--dark--built.png)<br>`/review/session/54ea4f1a-df02-4eec-b8ea-69802e9fcb1d`, 41 KB, horizontal overflow 0px | none |
| mobile | light | ![click-paid-start-plan mobile light](click-paid-start-plan--mobile--light--built.png)<br>`/review/session/54ea4f1a-df02-4eec-b8ea-69802e9fcb1d`, 34 KB, horizontal overflow 0px | none |
| mobile | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![click-paid-start-plan mobile dark](click-paid-start-plan--mobile--dark--built.png)<br>`/review/session/54ea4f1a-df02-4eec-b8ea-69802e9fcb1d`, 34 KB, horizontal overflow 0px | none |

## Click path (free): 'Start diagnostic' starts the diagnostic and lands in its runner

Persona: `free`. Route: `/dashboard`.
Step: click `{"desktop":"[data-testid=\"home-start-diagnostic\"]","mobile":"[data-testid=\"home-start-diagnostic\"]"}`.
Click path: must land on a path matching `^/practice/session/[0-9a-f-]{36}$` (the capture fails otherwise); the path it landed on is under each built shot.
Prototype: none. A click path: the screenshot is where the click landed (the diagnostic runner), proven by its pathname.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![click-free-start-diagnostic desktop light](click-free-start-diagnostic--desktop--light--built.png)<br>`/practice/session/2ea2be15-930f-46cb-8dbe-ac5fc34890bd`, 51 KB, horizontal overflow 0px | none |
| desktop | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![click-free-start-diagnostic desktop dark](click-free-start-diagnostic--desktop--dark--built.png)<br>`/practice/session/2ea2be15-930f-46cb-8dbe-ac5fc34890bd`, 37 KB, horizontal overflow 0px | none |
| mobile | light | ![click-free-start-diagnostic mobile light](click-free-start-diagnostic--mobile--light--built.png)<br>`/practice/session/2ea2be15-930f-46cb-8dbe-ac5fc34890bd`, 31 KB, horizontal overflow 0px | none |
| mobile | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![click-free-start-diagnostic mobile dark](click-free-start-diagnostic--mobile--dark--built.png)<br>`/practice/session/2ea2be15-930f-46cb-8dbe-ac5fc34890bd`, 31 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"61fd52ef-dc02-4867-abe5-1e347292669f","openPracticeSessionId":"269c19b4-469a-4627-b534-11ba5a8e3799","diagnosticSessionId":null,"answered":13},"paid":{"completedPracticeSessionId":"2484dd09-5771-4dd9-9bc1-c20c36728f16","openPracticeSessionId":"863df41c-daa1-48f0-896c-4d8b86cc6703","diagnosticSessionId":"30a98c48-fa30-4064-a802-a34c09e02016","answered":53}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- External hosts blocked: `fonts.googleapis.com`
