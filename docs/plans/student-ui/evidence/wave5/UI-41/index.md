# UI-41 shells: App shell (rail lock states), Focus shell, Bare card

Generated 2026-10-05T11:34:24.333Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-41` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844, and any extra size a shot names.
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
| desktop | light | ![app-dashboard-free desktop light](app-dashboard-free--desktop--light--built.png)<br>`/dashboard`, 140 KB, horizontal overflow 0px | ![prototype light](proto--Main--free--light.png), 141 KB |
| desktop | dark | ![app-dashboard-free desktop dark](app-dashboard-free--desktop--dark--built.png)<br>`/dashboard`, 140 KB, horizontal overflow 0px | ![prototype dark](proto--Main--free--dark.png), 142 KB |
| mobile | light | ![app-dashboard-free mobile light](app-dashboard-free--mobile--light--built.png)<br>`/dashboard`, 62 KB, horizontal overflow 0px | ![prototype light](proto--Main--free--light.png)<br>desktop prototype (no phone layout), 141 KB |
| mobile | dark | ![app-dashboard-free mobile dark](app-dashboard-free--mobile--dark--built.png)<br>`/dashboard`, 63 KB, horizontal overflow 0px | ![prototype dark](proto--Main--free--dark.png)<br>desktop prototype (no phone layout), 142 KB |

## App shell, /dashboard, paid (no locks)

Persona: `paid`. Route: `/dashboard`.
Prototype: `Main.dc.html` (Home, plan = paid).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-dashboard-paid desktop light](app-dashboard-paid--desktop--light--built.png)<br>`/dashboard`, 133 KB, horizontal overflow 0px | ![prototype light](proto--Main--paid--light.png), 147 KB |
| desktop | dark | ![app-dashboard-paid desktop dark](app-dashboard-paid--desktop--dark--built.png)<br>`/dashboard`, 134 KB, horizontal overflow 0px | ![prototype dark](proto--Main--paid--dark.png), 147 KB |
| mobile | light | ![app-dashboard-paid mobile light](app-dashboard-paid--mobile--light--built.png)<br>`/dashboard`, 55 KB, horizontal overflow 0px | ![prototype light](proto--Main--paid--light.png)<br>desktop prototype (no phone layout), 147 KB |
| mobile | dark | ![app-dashboard-paid mobile dark](app-dashboard-paid--mobile--dark--built.png)<br>`/dashboard`, 55 KB, horizontal overflow 0px | ![prototype dark](proto--Main--paid--dark.png)<br>desktop prototype (no phone layout), 147 KB |

## App shell, /calendar, free (rail lock shown, page navigates and upsells)

Persona: `free`. Route: `/calendar`.
Prototype: `Calendar.dc.html` (Calendar, plan = free).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-calendar-free desktop light](app-calendar-free--desktop--light--built.png)<br>`/calendar`, 83 KB, horizontal overflow 0px | ![prototype light](proto--Calendar--free--light.png), 106 KB |
| desktop | dark | ![app-calendar-free desktop dark](app-calendar-free--desktop--dark--built.png)<br>`/calendar`, 86 KB, horizontal overflow 0px | ![prototype dark](proto--Calendar--free--dark.png), 109 KB |
| mobile | light | ![app-calendar-free mobile light](app-calendar-free--mobile--light--built.png)<br>`/calendar`, 50 KB, horizontal overflow 0px | ![prototype light](proto--Calendar--free--light.png)<br>desktop prototype (no phone layout), 106 KB |
| mobile | dark | ![app-calendar-free mobile dark](app-calendar-free--mobile--dark--built.png)<br>`/calendar`, 52 KB, horizontal overflow 0px | ![prototype dark](proto--Calendar--free--dark.png)<br>desktop prototype (no phone layout), 109 KB |

## App shell, /chat, free (LISA locked)

Persona: `free`. Route: `/chat`.
Prototype: `Lisa.dc.html` (LISA, plan = free).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-chat-free desktop light](app-chat-free--desktop--light--built.png)<br>`/chat`, 46 KB, horizontal overflow 0px | ![prototype light](proto--Lisa--free--light.png), 45 KB |
| desktop | dark | ![app-chat-free desktop dark](app-chat-free--desktop--dark--built.png)<br>`/chat`, 47 KB, horizontal overflow 0px | ![prototype dark](proto--Lisa--free--dark.png), 46 KB |
| mobile | light | ![app-chat-free mobile light](app-chat-free--mobile--light--built.png)<br>`/chat`, 38 KB, horizontal overflow 0px | ![prototype light](proto--Lisa--free--light.png)<br>desktop prototype (no phone layout), 45 KB |
| mobile | dark | ![app-chat-free mobile dark](app-chat-free--mobile--dark--built.png)<br>`/chat`, 39 KB, horizontal overflow 0px | ![prototype dark](proto--Lisa--free--dark.png)<br>desktop prototype (no phone layout), 46 KB |

## Upgrade modal opened from the locked LISA rail item (free, on /dashboard)

Persona: `free`. Route: `/dashboard`.
Preset sessionStorage: `{"lyceon:diagnostic_modal_dismissed":"1"}`.
Step: click `{"desktop":"[data-testid=\"rail-lisa\"]","mobile":"[data-testid=\"tab-lisa\"]"}`.
Prototype: `Main.dc.html` (Home, plan = free, LISA rail item clicked); clicked: `button[aria-label^="LISA"]`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-upgrade-modal-lisa-free desktop light](app-upgrade-modal-lisa-free--desktop--light--built.png)<br>`/dashboard`, 157 KB, horizontal overflow 0px | ![prototype light](proto--Main--free--light--clicked.png), 161 KB |
| desktop | dark | ![app-upgrade-modal-lisa-free desktop dark](app-upgrade-modal-lisa-free--desktop--dark--built.png)<br>`/dashboard`, 154 KB, horizontal overflow 0px | ![prototype dark](proto--Main--free--dark--clicked.png), 158 KB |
| mobile | light | ![app-upgrade-modal-lisa-free mobile light](app-upgrade-modal-lisa-free--mobile--light--built.png)<br>`/dashboard`, 61 KB, horizontal overflow 0px | ![prototype light](proto--Main--free--light--clicked.png)<br>desktop prototype (no phone layout), 161 KB |
| mobile | dark | ![app-upgrade-modal-lisa-free mobile dark](app-upgrade-modal-lisa-free--mobile--dark--built.png)<br>`/dashboard`, 61 KB, horizontal overflow 0px | ![prototype dark](proto--Main--free--dark--clicked.png)<br>desktop prototype (no phone layout), 158 KB |

## App shell, /dashboard, paid: the avatar menu opened (390: Settings, Help, Sign out, in the page's theme; desktop: the rail, unchanged)

Persona: `paid`. Route: `/dashboard`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"button-user-menu\"]"}`.
Prototype: none. The prototypes have no phone layout (fixed 1440x900 canvas); the avatar menu is the owner ruling of 2026-10-05 (DESIGN.md §2 Mobile).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-avatar-menu-paid desktop light](app-avatar-menu-paid--desktop--light--built.png)<br>`/dashboard`, 133 KB, horizontal overflow 0px | none |
| desktop | dark | ![app-avatar-menu-paid desktop dark](app-avatar-menu-paid--desktop--dark--built.png)<br>`/dashboard`, 134 KB, horizontal overflow 0px | none |
| mobile | light | ![app-avatar-menu-paid mobile light](app-avatar-menu-paid--mobile--light--built.png)<br>`/dashboard`, 57 KB, horizontal overflow 0px | none |
| mobile | dark | ![app-avatar-menu-paid mobile dark](app-avatar-menu-paid--mobile--dark--built.png)<br>`/dashboard`, 57 KB, horizontal overflow 0px | none |

## App shell, /dashboard, free: the avatar menu opened (390: Settings, Help, Sign out, no Full-Length; desktop: the rail, unchanged)

Persona: `free`. Route: `/dashboard`.
Preset sessionStorage: `{"lyceon:diagnostic_modal_dismissed":"1"}`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"button-user-menu\"]"}`.
Prototype: none. The prototypes have no phone layout (fixed 1440x900 canvas); the avatar menu is the owner ruling of 2026-10-05 (DESIGN.md §2 Mobile).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-avatar-menu-free desktop light](app-avatar-menu-free--desktop--light--built.png)<br>`/dashboard`, 140 KB, horizontal overflow 0px | none |
| desktop | dark | ![app-avatar-menu-free desktop dark](app-avatar-menu-free--desktop--dark--built.png)<br>`/dashboard`, 140 KB, horizontal overflow 0px | none |
| mobile | light | ![app-avatar-menu-free mobile light](app-avatar-menu-free--mobile--light--built.png)<br>`/dashboard`, 61 KB, horizontal overflow 0px | none |
| mobile | dark | ![app-avatar-menu-free mobile dark](app-avatar-menu-free--mobile--dark--built.png)<br>`/dashboard`, 61 KB, horizontal overflow 0px | none |

## App shell, /practice/topics (a page still pinned light, OQ-49), paid: the avatar menu opened (390: a light menu in both themes, F-70)

Persona: `paid`. Route: `/practice/topics`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"button-user-menu\"]"}`.
Prototype: none. The prototypes have no phone layout (fixed 1440x900 canvas); the menu's theme is register §8 F-70.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-avatar-menu-light-locked desktop light](app-avatar-menu-light-locked--desktop--light--built.png)<br>`/practice/topics`, 56 KB, horizontal overflow 0px | none |
| desktop | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![app-avatar-menu-light-locked desktop dark](app-avatar-menu-light-locked--desktop--dark--built.png)<br>`/practice/topics`, 56 KB, horizontal overflow 0px | none |
| mobile | light | ![app-avatar-menu-light-locked mobile light](app-avatar-menu-light-locked--mobile--light--built.png)<br>`/practice/topics`, 41 KB, horizontal overflow 0px | none |
| mobile | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![app-avatar-menu-light-locked mobile dark](app-avatar-menu-light-locked--mobile--dark--built.png)<br>`/practice/topics`, 41 KB, horizontal overflow 0px | none |

## Upgrade modal opened from the locked Full-Length entry (390: Home's full-length card; desktop: the rail), free, on /dashboard

Persona: `free`. Route: `/dashboard`.
Preset sessionStorage: `{"lyceon:diagnostic_modal_dismissed":"1"}`.
Step: click `{"desktop":"[data-testid=\"rail-full-length\"]","mobile":"[data-testid=\"home-full-length-start\"]"}`.
Must then show `[data-testid="upgrade-modal"]` (the capture fails otherwise).
Prototype: `Main.dc.html` (Home, plan = free, Full-Length rail item clicked); clicked: `button[aria-label^="Full-Length"]`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-upgrade-modal-fulllength-free desktop light](app-upgrade-modal-fulllength-free--desktop--light--built.png)<br>`/dashboard`, 155 KB, horizontal overflow 0px | ![prototype light](proto--Main--free--light--full-length-clicked.png), 156 KB |
| desktop | dark | ![app-upgrade-modal-fulllength-free desktop dark](app-upgrade-modal-fulllength-free--desktop--dark--built.png)<br>`/dashboard`, 152 KB, horizontal overflow 0px | ![prototype dark](proto--Main--free--dark--full-length-clicked.png), 154 KB |
| mobile | light | ![app-upgrade-modal-fulllength-free mobile light](app-upgrade-modal-fulllength-free--mobile--light--built.png)<br>`/dashboard`, 54 KB, horizontal overflow 0px | ![prototype light](proto--Main--free--light--full-length-clicked.png)<br>desktop prototype (no phone layout), 156 KB |
| mobile | dark | ![app-upgrade-modal-fulllength-free mobile dark](app-upgrade-modal-fulllength-free--mobile--dark--built.png)<br>`/dashboard`, 54 KB, horizontal overflow 0px | ![prototype dark](proto--Main--free--dark--full-length-clicked.png)<br>desktop prototype (no phone layout), 154 KB |

## Focus shell, practice runner (open Reading and Writing session, 3 of 10 answered)

Persona: `free`. Route: `/practice/session/{free.openPracticeSessionId}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Prototype: `Runner.dc.html` (Question runner (no plan prop)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![focus-practice-runner desktop light](focus-practice-runner--desktop--light--built.png)<br>`/practice/session/db653484-f194-41d5-82d5-ccc85e2bc4b3`, 88 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light.png), 33 KB |
| desktop | dark | ![focus-practice-runner desktop dark](focus-practice-runner--desktop--dark--built.png)<br>`/practice/session/db653484-f194-41d5-82d5-ccc85e2bc4b3`, 91 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark.png), 33 KB |
| mobile | light | ![focus-practice-runner mobile light](focus-practice-runner--mobile--light--built.png)<br>`/practice/session/db653484-f194-41d5-82d5-ccc85e2bc4b3`, 71 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light.png)<br>desktop prototype (no phone layout), 33 KB |
| mobile | dark | ![focus-practice-runner mobile dark](focus-practice-runner--mobile--dark--built.png)<br>`/practice/session/db653484-f194-41d5-82d5-ccc85e2bc4b3`, 74 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark.png)<br>desktop prototype (no phone layout), 33 KB |

## Bare card, /login, signed out

Persona: `signed-out`. Route: `/login`.
Prototype: none. No prototype screen for the Bare card; DESIGN.md §2 describes it in words (a centered card on --paper).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![bare-login desktop light](bare-login--desktop--light--built.png)<br>`/login`, 43 KB, horizontal overflow 0px | none |
| desktop | dark | ![bare-login desktop dark](bare-login--desktop--dark--built.png)<br>`/login`, 44 KB, horizontal overflow 0px | none |
| mobile | light | ![bare-login mobile light](bare-login--mobile--light--built.png)<br>`/login`, 38 KB, horizontal overflow 0px | none |
| mobile | dark | ![bare-login mobile dark](bare-login--mobile--dark--built.png)<br>`/login`, 38 KB, horizontal overflow 0px | none |

## Bare card, 404 (signed in, paid)

Persona: `paid`. Route: `/no-such-page`.
Prototype: none. No prototype screen for the Bare card; DESIGN.md §2 describes it in words (a centered card on --paper).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![bare-404 desktop light](bare-404--desktop--light--built.png)<br>`/no-such-page`, 14 KB, horizontal overflow 0px | none |
| desktop | dark | ![bare-404 desktop dark](bare-404--desktop--dark--built.png)<br>`/no-such-page`, 15 KB, horizontal overflow 0px | none |
| mobile | light | ![bare-404 mobile light](bare-404--mobile--light--built.png)<br>`/no-such-page`, 11 KB, horizontal overflow 0px | none |
| mobile | dark | ![bare-404 mobile dark](bare-404--mobile--dark--built.png)<br>`/no-such-page`, 11 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"daa32fcf-d72e-4e14-90be-cb4c9d3db884","openPracticeSessionId":"db653484-f194-41d5-82d5-ccc85e2bc4b3","openReviewSessionId":null,"diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":13},"paid":{"completedPracticeSessionId":"74e8f0cc-30b8-4035-83b0-1933cf2eb44d","openPracticeSessionId":"21fefdb4-26c0-4c52-8bda-cdd379aa34c3","openReviewSessionId":null,"diagnosticSessionId":"b4ccc523-8fb8-4d20-82e2-a1ffdeb49139","scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":53}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- External hosts blocked: `fonts.googleapis.com`
