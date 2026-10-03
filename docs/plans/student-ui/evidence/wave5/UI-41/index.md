# UI-41 shells: App shell (rail lock states), Focus shell, Bare card

Generated 2026-10-03T11:53:28.395Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-41` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page): desktop 1440x900, phone 390x844.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## App shell, /dashboard, free (Full-Length, Calendar and LISA locked)

Persona: `free`. Route: `/dashboard`.
Preset sessionStorage: `{"lyceon:diagnostic_modal_dismissed":"1"}`.
Prototype: `Main.dc.html` (Home, plan = free).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-dashboard-free desktop light](app-dashboard-free--desktop--light--built.png)<br>`/dashboard`, 95 KB | ![prototype light](proto--Main--free--light.png), 141 KB |
| desktop | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![app-dashboard-free desktop dark](app-dashboard-free--desktop--dark--built.png)<br>`/dashboard`, 95 KB | ![prototype dark](proto--Main--free--dark.png), 142 KB |
| mobile | light | ![app-dashboard-free mobile light](app-dashboard-free--mobile--light--built.png)<br>`/dashboard`, 53 KB | ![prototype light](proto--Main--free--light.png)<br>desktop prototype (no phone layout), 141 KB |
| mobile | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![app-dashboard-free mobile dark](app-dashboard-free--mobile--dark--built.png)<br>`/dashboard`, 53 KB | ![prototype dark](proto--Main--free--dark.png)<br>desktop prototype (no phone layout), 142 KB |

## App shell, /dashboard, paid (no locks)

Persona: `paid`. Route: `/dashboard`.
Prototype: `Main.dc.html` (Home, plan = paid).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-dashboard-paid desktop light](app-dashboard-paid--desktop--light--built.png)<br>`/dashboard`, 102 KB | ![prototype light](proto--Main--paid--light.png), 147 KB |
| desktop | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![app-dashboard-paid desktop dark](app-dashboard-paid--desktop--dark--built.png)<br>`/dashboard`, 102 KB | ![prototype dark](proto--Main--paid--dark.png), 147 KB |
| mobile | light | ![app-dashboard-paid mobile light](app-dashboard-paid--mobile--light--built.png)<br>`/dashboard`, 52 KB | ![prototype light](proto--Main--paid--light.png)<br>desktop prototype (no phone layout), 147 KB |
| mobile | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![app-dashboard-paid mobile dark](app-dashboard-paid--mobile--dark--built.png)<br>`/dashboard`, 52 KB | ![prototype dark](proto--Main--paid--dark.png)<br>desktop prototype (no phone layout), 147 KB |

## App shell, /calendar, free (rail lock shown, page navigates and upsells)

Persona: `free`. Route: `/calendar`.
Prototype: `Calendar.dc.html` (Calendar, plan = free).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-calendar-free desktop light](app-calendar-free--desktop--light--built.png)<br>`/calendar`, 143 KB | ![prototype light](proto--Calendar--free--light.png), 106 KB |
| desktop | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![app-calendar-free desktop dark](app-calendar-free--desktop--dark--built.png)<br>`/calendar`, 143 KB | ![prototype dark](proto--Calendar--free--dark.png), 109 KB |
| mobile | light | ![app-calendar-free mobile light](app-calendar-free--mobile--light--built.png)<br>`/calendar`, 53 KB | ![prototype light](proto--Calendar--free--light.png)<br>desktop prototype (no phone layout), 106 KB |
| mobile | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![app-calendar-free mobile dark](app-calendar-free--mobile--dark--built.png)<br>`/calendar`, 53 KB | ![prototype dark](proto--Calendar--free--dark.png)<br>desktop prototype (no phone layout), 109 KB |

## App shell, /chat, free (LISA locked)

Persona: `free`. Route: `/chat`.
Prototype: `Lisa.dc.html` (LISA, plan = free).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-chat-free desktop light](app-chat-free--desktop--light--built.png)<br>`/chat`, 37 KB | ![prototype light](proto--Lisa--free--light.png), 45 KB |
| desktop | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![app-chat-free desktop dark](app-chat-free--desktop--dark--built.png)<br>`/chat`, 37 KB | ![prototype dark](proto--Lisa--free--dark.png), 46 KB |
| mobile | light | ![app-chat-free mobile light](app-chat-free--mobile--light--built.png)<br>`/chat`, 22 KB | ![prototype light](proto--Lisa--free--light.png)<br>desktop prototype (no phone layout), 45 KB |
| mobile | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![app-chat-free mobile dark](app-chat-free--mobile--dark--built.png)<br>`/chat`, 22 KB | ![prototype dark](proto--Lisa--free--dark.png)<br>desktop prototype (no phone layout), 46 KB |

## Upgrade modal opened from the locked LISA rail item (free, on /dashboard)

Persona: `free`. Route: `/dashboard`.
Preset sessionStorage: `{"lyceon:diagnostic_modal_dismissed":"1"}`.
Step: click `{"desktop":"[data-testid=\"rail-lisa\"]","mobile":"[data-testid=\"tab-lisa\"]"}`.
Prototype: `Main.dc.html` (Home, plan = free, LISA rail item clicked).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-upgrade-modal-lisa-free desktop light](app-upgrade-modal-lisa-free--desktop--light--built.png)<br>`/dashboard`, 102 KB | ![prototype light](proto--Main--free--light--clicked.png), 161 KB |
| desktop | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![app-upgrade-modal-lisa-free desktop dark](app-upgrade-modal-lisa-free--desktop--dark--built.png)<br>`/dashboard`, 100 KB | ![prototype dark](proto--Main--free--dark--clicked.png), 158 KB |
| mobile | light | ![app-upgrade-modal-lisa-free mobile light](app-upgrade-modal-lisa-free--mobile--light--built.png)<br>`/dashboard`, 55 KB | ![prototype light](proto--Main--free--light--clicked.png)<br>desktop prototype (no phone layout), 161 KB |
| mobile | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![app-upgrade-modal-lisa-free mobile dark](app-upgrade-modal-lisa-free--mobile--dark--built.png)<br>`/dashboard`, 55 KB | ![prototype dark](proto--Main--free--dark--clicked.png)<br>desktop prototype (no phone layout), 158 KB |

## Focus shell, practice runner (open Reading and Writing session, 3 of 10 answered)

Persona: `free`. Route: `/practice/session/{free.openPracticeSessionId}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Prototype: `Runner.dc.html` (Question runner (no plan prop)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![focus-practice-runner desktop light](focus-practice-runner--desktop--light--built.png)<br>`/practice/session/f47f85f1-4ec1-41ec-b62a-e8295e171ce5`, 92 KB | ![prototype light](proto--Runner--noplan--light.png), 33 KB |
| desktop | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![focus-practice-runner desktop dark](focus-practice-runner--desktop--dark--built.png)<br>`/practice/session/f47f85f1-4ec1-41ec-b62a-e8295e171ce5`, 92 KB | ![prototype dark](proto--Runner--noplan--dark.png), 33 KB |
| mobile | light | ![focus-practice-runner mobile light](focus-practice-runner--mobile--light--built.png)<br>`/practice/session/f47f85f1-4ec1-41ec-b62a-e8295e171ce5`, 58 KB | ![prototype light](proto--Runner--noplan--light.png)<br>desktop prototype (no phone layout), 33 KB |
| mobile | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![focus-practice-runner mobile dark](focus-practice-runner--mobile--dark--built.png)<br>`/practice/session/f47f85f1-4ec1-41ec-b62a-e8295e171ce5`, 58 KB | ![prototype dark](proto--Runner--noplan--dark.png)<br>desktop prototype (no phone layout), 33 KB |

## Bare card, /login, signed out

Persona: `signed-out`. Route: `/login`.
Prototype: none. No prototype screen for the Bare card; DESIGN.md §2 describes it in words (a centered card on --paper).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![bare-login desktop light](bare-login--desktop--light--built.png)<br>`/login`, 36 KB | none |
| desktop | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![bare-login desktop dark](bare-login--desktop--dark--built.png)<br>`/login`, 36 KB | none |
| mobile | light | ![bare-login mobile light](bare-login--mobile--light--built.png)<br>`/login`, 32 KB | none |
| mobile | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![bare-login mobile dark](bare-login--mobile--dark--built.png)<br>`/login`, 32 KB | none |

## Bare card, 404 (signed in, paid)

Persona: `paid`. Route: `/no-such-page`.
Prototype: none. No prototype screen for the Bare card; DESIGN.md §2 describes it in words (a centered card on --paper).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![bare-404 desktop light](bare-404--desktop--light--built.png)<br>`/no-such-page`, 15 KB | none |
| desktop | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![bare-404 desktop dark](bare-404--desktop--dark--built.png)<br>`/no-such-page`, 15 KB | none |
| mobile | light | ![bare-404 mobile light](bare-404--mobile--light--built.png)<br>`/no-such-page`, 12 KB | none |
| mobile | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![bare-404 mobile dark](bare-404--mobile--dark--built.png)<br>`/no-such-page`, 12 KB | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"984d4391-1634-48b0-8a27-02e1f2baec8c","openPracticeSessionId":"f47f85f1-4ec1-41ec-b62a-e8295e171ce5","diagnosticSessionId":null,"answered":13},"paid":{"completedPracticeSessionId":"11f21d89-0d94-43d7-931e-d29b2b365c63","openPracticeSessionId":"5b945821-43c7-417e-bf97-cd4bf9916c68","diagnosticSessionId":"d9f55ce5-fa48-4ac6-a682-f0775f99a2bb","answered":53}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- External hosts blocked: `fonts.googleapis.com`
