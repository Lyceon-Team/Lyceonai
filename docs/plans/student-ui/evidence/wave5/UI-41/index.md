# UI-41 shells: App shell (rail lock states), Focus shell, Bare card

Generated 2026-10-08T02:31:00.838Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-41` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

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
| desktop | light | ![app-dashboard-free desktop light](app-dashboard-free--desktop--light--built.png)<br>`/dashboard`, 141 KB, horizontal overflow 0px | ![prototype light](proto--Main--free--light.png), 141 KB |
| desktop | dark | ![app-dashboard-free desktop dark](app-dashboard-free--desktop--dark--built.png)<br>`/dashboard`, 142 KB, horizontal overflow 0px | ![prototype dark](proto--Main--free--dark.png), 142 KB |
| mobile | light | ![app-dashboard-free mobile light](app-dashboard-free--mobile--light--built.png)<br>`/dashboard`, 63 KB, horizontal overflow 0px | ![prototype light](proto--Main--free--light.png)<br>desktop prototype (no phone layout), 141 KB |
| mobile | dark | ![app-dashboard-free mobile dark](app-dashboard-free--mobile--dark--built.png)<br>`/dashboard`, 64 KB, horizontal overflow 0px | ![prototype dark](proto--Main--free--dark.png)<br>desktop prototype (no phone layout), 142 KB |

## App shell, /dashboard, paid (no locks)

Persona: `paid`. Route: `/dashboard`.
Prototype: `Main.dc.html` (Home, plan = paid).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-dashboard-paid desktop light](app-dashboard-paid--desktop--light--built.png)<br>`/dashboard`, 140 KB, horizontal overflow 0px | ![prototype light](proto--Main--paid--light.png), 147 KB |
| desktop | dark | ![app-dashboard-paid desktop dark](app-dashboard-paid--desktop--dark--built.png)<br>`/dashboard`, 141 KB, horizontal overflow 0px | ![prototype dark](proto--Main--paid--dark.png), 147 KB |
| mobile | light | ![app-dashboard-paid mobile light](app-dashboard-paid--mobile--light--built.png)<br>`/dashboard`, 56 KB, horizontal overflow 0px | ![prototype light](proto--Main--paid--light.png)<br>desktop prototype (no phone layout), 147 KB |
| mobile | dark | ![app-dashboard-paid mobile dark](app-dashboard-paid--mobile--dark--built.png)<br>`/dashboard`, 56 KB, horizontal overflow 0px | ![prototype dark](proto--Main--paid--dark.png)<br>desktop prototype (no phone layout), 147 KB |

## App shell, /calendar, free (rail lock shown, page navigates and upsells)

Persona: `free`. Route: `/calendar`.
Prototype: `Calendar.dc.html` (Calendar, plan = free).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-calendar-free desktop light](app-calendar-free--desktop--light--built.png)<br>`/calendar`, 85 KB, horizontal overflow 0px | ![prototype light](proto--Calendar--free--light.png), 106 KB |
| desktop | dark | ![app-calendar-free desktop dark](app-calendar-free--desktop--dark--built.png)<br>`/calendar`, 87 KB, horizontal overflow 0px | ![prototype dark](proto--Calendar--free--dark.png), 109 KB |
| mobile | light | ![app-calendar-free mobile light](app-calendar-free--mobile--light--built.png)<br>`/calendar`, 50 KB, horizontal overflow 0px | ![prototype light](proto--Calendar--free--light.png)<br>desktop prototype (no phone layout), 106 KB |
| mobile | dark | ![app-calendar-free mobile dark](app-calendar-free--mobile--dark--built.png)<br>`/calendar`, 53 KB, horizontal overflow 0px | ![prototype dark](proto--Calendar--free--dark.png)<br>desktop prototype (no phone layout), 109 KB |

## App shell, /chat, free (LISA locked)

Persona: `free`. Route: `/chat`.
Prototype: `Lisa.dc.html` (LISA, plan = free).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-chat-free desktop light](app-chat-free--desktop--light--built.png)<br>`/chat`, 48 KB, horizontal overflow 0px | ![prototype light](proto--Lisa--free--light.png), 45 KB |
| desktop | dark | ![app-chat-free desktop dark](app-chat-free--desktop--dark--built.png)<br>`/chat`, 49 KB, horizontal overflow 0px | ![prototype dark](proto--Lisa--free--dark.png), 46 KB |
| mobile | light | ![app-chat-free mobile light](app-chat-free--mobile--light--built.png)<br>`/chat`, 38 KB, horizontal overflow 0px | ![prototype light](proto--Lisa--free--light.png)<br>desktop prototype (no phone layout), 45 KB |
| mobile | dark | ![app-chat-free mobile dark](app-chat-free--mobile--dark--built.png)<br>`/chat`, 39 KB, horizontal overflow 0px | ![prototype dark](proto--Lisa--free--dark.png)<br>desktop prototype (no phone layout), 46 KB |

## Upgrade modal opened from the locked LISA rail item (free, on /dashboard)

Persona: `free`. Route: `/dashboard`.
Preset sessionStorage: `{"lyceon:diagnostic_modal_dismissed":"1"}`.
Step: click `{"desktop":"[data-testid=\"rail-lisa\"]","mobile":"[data-testid=\"tab-lisa\"]"}`.
Prototype: `Main.dc.html` (Home, plan = free, LISA rail item clicked); clicked: `button[aria-label^="LISA"]`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-upgrade-modal-lisa-free desktop light](app-upgrade-modal-lisa-free--desktop--light--built.png)<br>`/dashboard`, 159 KB, horizontal overflow 0px | ![prototype light](proto--Main--free--light--clicked.png), 161 KB |
| desktop | dark | ![app-upgrade-modal-lisa-free desktop dark](app-upgrade-modal-lisa-free--desktop--dark--built.png)<br>`/dashboard`, 155 KB, horizontal overflow 0px | ![prototype dark](proto--Main--free--dark--clicked.png), 158 KB |
| mobile | light | ![app-upgrade-modal-lisa-free mobile light](app-upgrade-modal-lisa-free--mobile--light--built.png)<br>`/dashboard`, 62 KB, horizontal overflow 0px | ![prototype light](proto--Main--free--light--clicked.png)<br>desktop prototype (no phone layout), 161 KB |
| mobile | dark | ![app-upgrade-modal-lisa-free mobile dark](app-upgrade-modal-lisa-free--mobile--dark--built.png)<br>`/dashboard`, 61 KB, horizontal overflow 0px | ![prototype dark](proto--Main--free--dark--clicked.png)<br>desktop prototype (no phone layout), 158 KB |

## App shell, /dashboard, paid: the avatar menu opened (390: Settings, Help, Sign out, in the page's theme; desktop since QA 2026-10-07 item 3: the same menu, opened beside the rail)

Persona: `paid`. Route: `/dashboard`.
Step: click `{"desktop":"[data-testid=\"button-user-menu\"]","mobile":"[data-testid=\"button-user-menu\"]"}`.
Prototype: none. The prototypes have no phone layout (fixed 1440x900 canvas); the avatar menu is the owner ruling of 2026-10-05 (DESIGN.md §2 Mobile).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-avatar-menu-paid desktop light](app-avatar-menu-paid--desktop--light--built.png)<br>`/dashboard`, 145 KB, horizontal overflow 0px | none |
| desktop | dark | ![app-avatar-menu-paid desktop dark](app-avatar-menu-paid--desktop--dark--built.png)<br>`/dashboard`, 145 KB, horizontal overflow 0px | none |
| mobile | light | ![app-avatar-menu-paid mobile light](app-avatar-menu-paid--mobile--light--built.png)<br>`/dashboard`, 59 KB, horizontal overflow 0px | none |
| mobile | dark | ![app-avatar-menu-paid mobile dark](app-avatar-menu-paid--mobile--dark--built.png)<br>`/dashboard`, 58 KB, horizontal overflow 0px | none |

## App shell, /dashboard, free: the avatar menu opened (390: Settings, Help, Sign out, no Full-Length; desktop since QA 2026-10-07 item 3: the same menu, beside the rail)

Persona: `free`. Route: `/dashboard`.
Preset sessionStorage: `{"lyceon:diagnostic_modal_dismissed":"1"}`.
Step: click `{"desktop":"[data-testid=\"button-user-menu\"]","mobile":"[data-testid=\"button-user-menu\"]"}`.
Prototype: none. The prototypes have no phone layout (fixed 1440x900 canvas); the avatar menu is the owner ruling of 2026-10-05 (DESIGN.md §2 Mobile).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-avatar-menu-free desktop light](app-avatar-menu-free--desktop--light--built.png)<br>`/dashboard`, 145 KB, horizontal overflow 0px | none |
| desktop | dark | ![app-avatar-menu-free desktop dark](app-avatar-menu-free--desktop--dark--built.png)<br>`/dashboard`, 146 KB, horizontal overflow 0px | none |
| mobile | light | ![app-avatar-menu-free mobile light](app-avatar-menu-free--mobile--light--built.png)<br>`/dashboard`, 61 KB, horizontal overflow 0px | none |
| mobile | dark | ![app-avatar-menu-free mobile dark](app-avatar-menu-free--mobile--dark--built.png)<br>`/dashboard`, 62 KB, horizontal overflow 0px | none |

## App shell, /practice/topics (a page still pinned light, OQ-49), paid: the avatar menu opened (a light menu in both themes at both widths, F-70; desktop since QA 2026-10-07 item 3)

Persona: `paid`. Route: `/practice/topics`.
Step: click `{"desktop":"[data-testid=\"button-user-menu\"]","mobile":"[data-testid=\"button-user-menu\"]"}`.
Prototype: none. The prototypes have no phone layout (fixed 1440x900 canvas); the menu's theme is register §8 F-70.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-avatar-menu-light-locked desktop light](app-avatar-menu-light-locked--desktop--light--built.png)<br>`/practice/topics`, 65 KB, horizontal overflow 0px | none |
| desktop | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![app-avatar-menu-light-locked desktop dark](app-avatar-menu-light-locked--desktop--dark--built.png)<br>`/practice/topics`, 65 KB, horizontal overflow 0px | none |
| mobile | light | ![app-avatar-menu-light-locked mobile light](app-avatar-menu-light-locked--mobile--light--built.png)<br>`/practice/topics`, 42 KB, horizontal overflow 0px | none |
| mobile | dark requested; page pinned light (`data-theme-lock=light`, OQ-49) | ![app-avatar-menu-light-locked mobile dark](app-avatar-menu-light-locked--mobile--dark--built.png)<br>`/practice/topics`, 42 KB, horizontal overflow 0px | none |

## Upgrade modal opened from the locked Full-Length entry (390: Home's full-length card; desktop: the rail), free, on /dashboard

Persona: `free`. Route: `/dashboard`.
Preset sessionStorage: `{"lyceon:diagnostic_modal_dismissed":"1"}`.
Step: click `{"desktop":"[data-testid=\"rail-full-length\"]","mobile":"[data-testid=\"home-full-length-start\"]"}`.
Must then show `[data-testid="upgrade-modal"]` (the capture fails otherwise).
Prototype: `Main.dc.html` (Home, plan = free, Full-Length rail item clicked); clicked: `button[aria-label^="Full-Length"]`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![app-upgrade-modal-fulllength-free desktop light](app-upgrade-modal-fulllength-free--desktop--light--built.png)<br>`/dashboard`, 155 KB, horizontal overflow 0px | ![prototype light](proto--Main--free--light--full-length-clicked.png), 156 KB |
| desktop | dark | ![app-upgrade-modal-fulllength-free desktop dark](app-upgrade-modal-fulllength-free--desktop--dark--built.png)<br>`/dashboard`, 151 KB, horizontal overflow 0px | ![prototype dark](proto--Main--free--dark--full-length-clicked.png), 154 KB |
| mobile | light | ![app-upgrade-modal-fulllength-free mobile light](app-upgrade-modal-fulllength-free--mobile--light--built.png)<br>`/dashboard`, 53 KB, horizontal overflow 0px | ![prototype light](proto--Main--free--light--full-length-clicked.png)<br>desktop prototype (no phone layout), 156 KB |
| mobile | dark | ![app-upgrade-modal-fulllength-free mobile dark](app-upgrade-modal-fulllength-free--mobile--dark--built.png)<br>`/dashboard`, 52 KB, horizontal overflow 0px | ![prototype dark](proto--Main--free--dark--full-length-clicked.png)<br>desktop prototype (no phone layout), 154 KB |

## Focus shell, practice runner (open Reading and Writing session, 3 of 10 answered)

Persona: `free`. Route: `/practice/session/{free.openPracticeSessionId}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Prototype: `Runner.dc.html` (Question runner (no plan prop)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![focus-practice-runner desktop light](focus-practice-runner--desktop--light--built.png)<br>`/practice/session/e1a6a1d8-9153-4ae5-ad9d-7e5cd798c5bf`, 88 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light.png), 33 KB |
| desktop | dark | ![focus-practice-runner desktop dark](focus-practice-runner--desktop--dark--built.png)<br>`/practice/session/e1a6a1d8-9153-4ae5-ad9d-7e5cd798c5bf`, 91 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark.png), 33 KB |
| mobile | light | ![focus-practice-runner mobile light](focus-practice-runner--mobile--light--built.png)<br>`/practice/session/e1a6a1d8-9153-4ae5-ad9d-7e5cd798c5bf`, 72 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light.png)<br>desktop prototype (no phone layout), 33 KB |
| mobile | dark | ![focus-practice-runner mobile dark](focus-practice-runner--mobile--dark--built.png)<br>`/practice/session/e1a6a1d8-9153-4ae5-ad9d-7e5cd798c5bf`, 75 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark.png)<br>desktop prototype (no phone layout), 33 KB |

## Bare card, /login, signed out

Persona: `signed-out`. Route: `/login`.
Prototype: none. No prototype screen for the Bare card; DESIGN.md §2 describes it in words (a centered card on --paper).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![bare-login desktop light](bare-login--desktop--light--built.png)<br>`/login`, 38 KB, horizontal overflow 0px | none |
| desktop | dark | ![bare-login desktop dark](bare-login--desktop--dark--built.png)<br>`/login`, 39 KB, horizontal overflow 0px | none |
| mobile | light | ![bare-login mobile light](bare-login--mobile--light--built.png)<br>`/login`, 33 KB, horizontal overflow 0px | none |
| mobile | dark | ![bare-login mobile dark](bare-login--mobile--dark--built.png)<br>`/login`, 34 KB, horizontal overflow 0px | none |

## Bare card, 404 (signed in, paid)

Persona: `paid`. Route: `/no-such-page`.
Prototype: none. No prototype screen for the Bare card; DESIGN.md §2 describes it in words (a centered card on --paper).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![bare-404 desktop light](bare-404--desktop--light--built.png)<br>`/no-such-page`, 17 KB, horizontal overflow 0px | none |
| desktop | dark | ![bare-404 desktop dark](bare-404--desktop--dark--built.png)<br>`/no-such-page`, 17 KB, horizontal overflow 0px | none |
| mobile | light | ![bare-404 mobile light](bare-404--mobile--light--built.png)<br>`/no-such-page`, 14 KB, horizontal overflow 0px | none |
| mobile | dark | ![bare-404 mobile dark](bare-404--mobile--dark--built.png)<br>`/no-such-page`, 14 KB, horizontal overflow 0px | none |

## QA 13: the bell with its unread badge (three unread in-app notifications, seed 'notifications'), paid, /dashboard

Persona: `paid`. Route: `/dashboard`.
Prototype: none. The prototypes draw no bell (OQ-47 placed it after sign-off); contracts/notifications.contract.md §3.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![qa-bell-unread-badge-paid desktop light](qa-bell-unread-badge-paid--desktop--light--built.png)<br>`/dashboard`, 140 KB, horizontal overflow 0px | none |
| desktop | dark | ![qa-bell-unread-badge-paid desktop dark](qa-bell-unread-badge-paid--desktop--dark--built.png)<br>`/dashboard`, 141 KB, horizontal overflow 0px | none |
| mobile | light | ![qa-bell-unread-badge-paid mobile light](qa-bell-unread-badge-paid--mobile--light--built.png)<br>`/dashboard`, 56 KB, horizontal overflow 0px | none |
| mobile | dark | ![qa-bell-unread-badge-paid mobile dark](qa-bell-unread-badge-paid--mobile--dark--built.png)<br>`/dashboard`, 56 KB, horizontal overflow 0px | none |

## QA 13: the notifications popover while its feed loads (GET /api/notifications held): the skeleton, not 'Loading…'

Persona: `paid`. Route: `/dashboard`.
Step: click `{"desktop":"[data-testid=\"button-notifications\"]","mobile":"[data-testid=\"button-notifications\"]"}`.
Held: the browser's `GET /api/notifications` is left unanswered through the screenshot, then aborted (it never reaches the server).
Prototype: none. The prototypes draw no bell (OQ-47 placed it after sign-off); contracts/notifications.contract.md §3.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![qa-notifications-popover-loading-paid desktop light](qa-notifications-popover-loading-paid--desktop--light--built.png)<br>`/dashboard`, 137 KB, horizontal overflow 0px | none |
| desktop | dark | ![qa-notifications-popover-loading-paid desktop dark](qa-notifications-popover-loading-paid--desktop--dark--built.png)<br>`/dashboard`, 138 KB, horizontal overflow 0px | none |
| mobile | light | ![qa-notifications-popover-loading-paid mobile light](qa-notifications-popover-loading-paid--mobile--light--built.png)<br>`/dashboard`, 43 KB, horizontal overflow 0px | none |
| mobile | dark | ![qa-notifications-popover-loading-paid mobile dark](qa-notifications-popover-loading-paid--mobile--dark--built.png)<br>`/dashboard`, 42 KB, horizontal overflow 0px | none |

## QA 12/13: the notifications popover open with its items, on the student tokens, light and dark

Persona: `paid`. Route: `/dashboard`.
Step: click `{"desktop":"[data-testid=\"button-notifications\"]","mobile":"[data-testid=\"button-notifications\"]"}`.
Must then show `[data-testid="notification-feed"] li` (the capture fails otherwise).
Prototype: none. The prototypes draw no bell (OQ-47 placed it after sign-off); contracts/notifications.contract.md §3.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![qa-notifications-popover-paid desktop light](qa-notifications-popover-paid--desktop--light--built.png)<br>`/dashboard`, 158 KB, horizontal overflow 0px | none |
| desktop | dark | ![qa-notifications-popover-paid desktop dark](qa-notifications-popover-paid--desktop--dark--built.png)<br>`/dashboard`, 160 KB, horizontal overflow 0px | none |
| mobile | light | ![qa-notifications-popover-paid mobile light](qa-notifications-popover-paid--mobile--light--built.png)<br>`/dashboard`, 67 KB, horizontal overflow 0px | none |
| mobile | dark | ![qa-notifications-popover-paid mobile dark](qa-notifications-popover-paid--mobile--dark--built.png)<br>`/dashboard`, 67 KB, horizontal overflow 0px | none |

## QA 5/12: Home → 'See every skill' with the Mastery page's code chunk held: what shows while the route loads

Persona: `paid`. Route: `/dashboard`.
Step: click `{"desktop":"[data-testid=\"home-mastery\"] a[href=\"/mastery\"]","mobile":"[data-testid=\"home-mastery\"] a[href=\"/mastery\"]"}`.
Held: the browser's `GET ^/assets/mastery-[A-Za-z0-9_-]{8}\.js$` is left unanswered through the screenshot, then aborted (it never reaches the server).
Prototype: none. A loading state; the prototypes draw none.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![qa-route-skeleton-nav-paid desktop light](qa-route-skeleton-nav-paid--desktop--light--built.png)<br>`/mastery`, 24 KB, horizontal overflow 0px | none |
| desktop | dark | ![qa-route-skeleton-nav-paid desktop dark](qa-route-skeleton-nav-paid--desktop--dark--built.png)<br>`/mastery`, 24 KB, horizontal overflow 0px | none |
| mobile | light | ![qa-route-skeleton-nav-paid mobile light](qa-route-skeleton-nav-paid--mobile--light--built.png)<br>`/mastery`, 14 KB, horizontal overflow 0px | none |
| mobile | dark | ![qa-route-skeleton-nav-paid mobile dark](qa-route-skeleton-nav-paid--mobile--dark--built.png)<br>`/mastery`, 14 KB, horizontal overflow 0px | none |

## QA 5/12: /mastery opened cold (a reload) with its code chunk held: the first paint while the route loads

Persona: `paid`. Route: `/mastery`.
Held: the browser's `GET ^/assets/mastery-[A-Za-z0-9_-]{8}\.js$` is left unanswered through the screenshot, then aborted (it never reaches the server).
Prototype: none. A loading state; the prototypes draw none.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![qa-route-skeleton-cold-paid desktop light](qa-route-skeleton-cold-paid--desktop--light--built.png)<br>`/mastery`, 24 KB, horizontal overflow 0px | none |
| desktop | dark | ![qa-route-skeleton-cold-paid desktop dark](qa-route-skeleton-cold-paid--desktop--dark--built.png)<br>`/mastery`, 24 KB, horizontal overflow 0px | none |
| mobile | light | ![qa-route-skeleton-cold-paid mobile light](qa-route-skeleton-cold-paid--mobile--light--built.png)<br>`/mastery`, 14 KB, horizontal overflow 0px | none |
| mobile | dark | ![qa-route-skeleton-cold-paid mobile dark](qa-route-skeleton-cold-paid--mobile--dark--built.png)<br>`/mastery`, 14 KB, horizontal overflow 0px | none |

## QA 2: the Math reference sheet opened from the practice runner (30-60-90 and 45-45-90 figures)

Persona: `paid`. Route: `/practice/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["M"],"target_question_count":10}`.
Step: click `{"desktop":"button[aria-label=\"Reference\"]","mobile":"button[aria-label=\"Reference\"]"}`.
Must then show `[data-testid="math-reference-sheet"]` (the capture fails otherwise).
Prototype: none. Runner.dc.html has a Reference button but no sheet; the figures follow the College Board SAT reference sheet.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![qa-reference-sheet desktop light](qa-reference-sheet--desktop--light--built.png)<br>`/practice/session/888b3208-e874-48c3-8e94-5980d04956c9`, 78 KB, horizontal overflow 0px | none |
| desktop | dark | ![qa-reference-sheet desktop dark](qa-reference-sheet--desktop--dark--built.png)<br>`/practice/session/6b216704-df2a-4eb7-afa9-830c93084140`, 79 KB, horizontal overflow 0px | none |
| mobile | light | ![qa-reference-sheet mobile light](qa-reference-sheet--mobile--light--built.png)<br>`/practice/session/afc993d0-fbdb-46e1-853f-e7dfaf45a128`, 53 KB, horizontal overflow 0px | none |
| mobile | dark | ![qa-reference-sheet mobile dark](qa-reference-sheet--mobile--dark--built.png)<br>`/practice/session/aaee34cc-8b69-4c9f-8fe9-97a2309ed540`, 53 KB, horizontal overflow 0px | none |

## QA 12: the calculator panel in the practice runner, Scientific selected (our mode switch around Desmos; Desmos itself is not loaded in the local-only harness)

Persona: `paid`. Route: `/practice/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["M"],"target_question_count":10}`.
Step: click `{"desktop":"button[aria-label=\"Calculator\"]","mobile":"button[aria-label=\"Calculator\"]"}`.
Step: click `{"desktop":"[data-testid=\"desmos-mode-scientific\"]","mobile":"[data-testid=\"desmos-mode-scientific\"]"}`.
Prototype: none. Runner.dc.html draws no calculator panel.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![qa-calculator-scientific desktop light](qa-calculator-scientific--desktop--light--built.png)<br>`/practice/session/63402094-ff4d-4396-bdfb-999afdbfe708`, 42 KB, horizontal overflow 0px | none |
| desktop | dark | ![qa-calculator-scientific desktop dark](qa-calculator-scientific--desktop--dark--built.png)<br>`/practice/session/83813814-3835-43a2-b8ac-85846d984bec`, 43 KB, horizontal overflow 0px | none |
| mobile | light | ![qa-calculator-scientific mobile light](qa-calculator-scientific--mobile--light--built.png)<br>`/practice/session/48e23c5e-048e-443f-98d1-47dc3dbf359d`, 33 KB, horizontal overflow 0px | none |
| mobile | dark | ![qa-calculator-scientific mobile dark](qa-calculator-scientific--mobile--dark--built.png)<br>`/practice/session/bda108bf-812c-4de0-9434-7c0952afc495`, 34 KB, horizontal overflow 0px | none |

## QA 12: a grid-in answered and submitted in the practice runner: the submitted answer's contrast

Persona: `paid`. Route: `/practice/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["M"],"target_question_count":10}`.
Step: type `12` into `{"desktop":"input[aria-label=\"Enter your answer\"]","mobile":"input[aria-label=\"Enter your answer\"]"}`.
Step: click `{"desktop":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")","mobile":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")"}`.
Prototype: none. Runner.dc.html draws a multiple-choice item only.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![qa-grid-in-submitted desktop light](qa-grid-in-submitted--desktop--light--built.png)<br>`/practice/session/406f36b5-3941-489b-913f-dc5cb223065f`, 49 KB, horizontal overflow 0px | none |
| desktop | dark | ![qa-grid-in-submitted desktop dark](qa-grid-in-submitted--desktop--dark--built.png)<br>`/practice/session/10dd971c-5042-4128-8053-1e0b61186bae`, 50 KB, horizontal overflow 0px | none |
| mobile | light | ![qa-grid-in-submitted mobile light](qa-grid-in-submitted--mobile--light--built.png)<br>`/practice/session/32a3f179-8043-4b44-a49e-62267a7d14e4`, 41 KB, horizontal overflow 0px | none |
| mobile | dark | ![qa-grid-in-submitted mobile dark](qa-grid-in-submitted--mobile--dark--built.png)<br>`/practice/session/5af4b13e-1faa-4c33-b0e4-e386be281189`, 42 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"89ff6973-7a06-4042-aad7-d962934944e2","openPracticeSessionId":"e1a6a1d8-9153-4ae5-ad9d-7e5cd798c5bf","openReviewSessionId":null,"diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":13},"paid":{"completedPracticeSessionId":"1b20feb1-8157-4c17-9622-113a39d53b53","openPracticeSessionId":"027233dc-5533-4b14-8a08-0f8f3ffd9869","openReviewSessionId":null,"diagnosticSessionId":"1fb193f1-e2d0-4f4b-a99f-626903a0a6bd","scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":53}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- External hosts blocked: none
