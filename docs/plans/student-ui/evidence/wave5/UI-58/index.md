# UI-58 Settings (each section; paid self-billing, free, guardian-managed), Help, Notifications and the plans page (both NOT PROTOTYPED); light and dark, 1440 and 390

Generated 2026-10-03T20:43:53.772Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-58` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## Settings → Profile, paid: name, test date and target (a calendar profile exists, OQ-20); no About you (UI-S8)

Persona: `paid`. Route: `/profile`.
Full page: the whole document, not just the viewport.
Prototype: `Settings.dc.html` (Settings, plan = paid, Profile (the canvas also draws About you, held by UI-S8)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![settings-profile-paid desktop light](settings-profile-paid--desktop--light--built.png)<br>`/profile`, 66 KB, horizontal overflow 0px | ![prototype light](proto--Settings--paid--light.png), 83 KB |
| desktop | dark | ![settings-profile-paid desktop dark](settings-profile-paid--desktop--dark--built.png)<br>`/profile`, 66 KB, horizontal overflow 0px | ![prototype dark](proto--Settings--paid--dark.png), 84 KB |
| mobile | light | ![settings-profile-paid mobile light](settings-profile-paid--mobile--light--built.png)<br>`/profile`, 53 KB, horizontal overflow 0px | ![prototype light](proto--Settings--paid--light.png)<br>desktop prototype (no phone layout), 83 KB |
| mobile | dark | ![settings-profile-paid mobile dark](settings-profile-paid--mobile--dark--built.png)<br>`/profile`, 53 KB, horizontal overflow 0px | ![prototype dark](proto--Settings--paid--dark.png)<br>desktop prototype (no phone layout), 84 KB |

## Settings → Profile, free: name, and 'Set up your study calendar' (no calendar profile, OQ-20)

Persona: `free`. Route: `/profile`.
Full page: the whole document, not just the viewport.
Prototype: `Settings.dc.html` (Settings, plan = free, Profile).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![settings-profile-free desktop light](settings-profile-free--desktop--light--built.png)<br>`/profile`, 55 KB, horizontal overflow 0px | ![prototype light](proto--Settings--free--light.png), 84 KB |
| desktop | dark | ![settings-profile-free desktop dark](settings-profile-free--desktop--dark--built.png)<br>`/profile`, 56 KB, horizontal overflow 0px | ![prototype dark](proto--Settings--free--dark.png), 85 KB |
| mobile | light | ![settings-profile-free mobile light](settings-profile-free--mobile--light--built.png)<br>`/profile`, 44 KB, horizontal overflow 0px | ![prototype light](proto--Settings--free--light.png)<br>desktop prototype (no phone layout), 84 KB |
| mobile | dark | ![settings-profile-free mobile dark](settings-profile-free--mobile--dark--built.png)<br>`/profile`, 44 KB, horizontal overflow 0px | ![prototype dark](proto--Settings--free--dark.png)<br>desktop prototype (no phone layout), 85 KB |

## Settings → Account: email, sign-in method, Change password (current password required), Delete account

Persona: `paid`. Route: `/profile?tab=account`.
Full page: the whole document, not just the viewport.
Prototype: `Settings.dc.html` (Settings, plan = paid, Account clicked); clicked: `nav[aria-label="Settings sections"] button:has-text("Account")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![settings-account-paid desktop light](settings-account-paid--desktop--light--built.png)<br>`/profile`, 68 KB, horizontal overflow 0px | ![prototype light](proto--Settings--paid--light--account.png), 74 KB |
| desktop | dark | ![settings-account-paid desktop dark](settings-account-paid--desktop--dark--built.png)<br>`/profile`, 69 KB, horizontal overflow 0px | ![prototype dark](proto--Settings--paid--dark--account.png), 76 KB |
| mobile | light | ![settings-account-paid mobile light](settings-account-paid--mobile--light--built.png)<br>`/profile`, 70 KB, horizontal overflow 0px | ![prototype light](proto--Settings--paid--light--account.png)<br>desktop prototype (no phone layout), 74 KB |
| mobile | dark | ![settings-account-paid mobile dark](settings-account-paid--mobile--dark--built.png)<br>`/profile`, 72 KB, horizontal overflow 0px | ![prototype dark](proto--Settings--paid--dark--account.png)<br>desktop prototype (no phone layout), 76 KB |

## Settings → Guardian, paid: the linked guardian, the OQ-38 sentence, the code with Copy, Get a new code and email

Persona: `paid`. Route: `/profile?tab=guardian`.
Full page: the whole document, not just the viewport.
Prototype: `Settings.dc.html` (Settings, plan = paid, Guardian clicked (the canvas shows no guardian linked)); clicked: `nav[aria-label="Settings sections"] button:has-text("Guardian")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![settings-guardian-paid desktop light](settings-guardian-paid--desktop--light--built.png)<br>`/profile`, 94 KB, horizontal overflow 0px | ![prototype light](proto--Settings--paid--light--guardian.png), 79 KB |
| desktop | dark | ![settings-guardian-paid desktop dark](settings-guardian-paid--desktop--dark--built.png)<br>`/profile`, 97 KB, horizontal overflow 0px | ![prototype dark](proto--Settings--paid--dark--guardian.png), 80 KB |
| mobile | light | ![settings-guardian-paid mobile light](settings-guardian-paid--mobile--light--built.png)<br>`/profile`, 101 KB, horizontal overflow 0px | ![prototype light](proto--Settings--paid--light--guardian.png)<br>desktop prototype (no phone layout), 79 KB |
| mobile | dark | ![settings-guardian-paid mobile dark](settings-guardian-paid--mobile--dark--built.png)<br>`/profile`, 103 KB, horizontal overflow 0px | ![prototype dark](proto--Settings--paid--dark--guardian.png)<br>desktop prototype (no phone layout), 80 KB |

## Settings → Guardian, free: no guardian linked, and the code

Persona: `free`. Route: `/profile?tab=guardian`.
Full page: the whole document, not just the viewport.
Prototype: `Settings.dc.html` (Settings, plan = free, Guardian clicked); clicked: `nav[aria-label="Settings sections"] button:has-text("Guardian")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![settings-guardian-free desktop light](settings-guardian-free--desktop--light--built.png)<br>`/profile`, 102 KB, horizontal overflow 0px | ![prototype light](proto--Settings--free--light--guardian.png), 80 KB |
| desktop | dark | ![settings-guardian-free desktop dark](settings-guardian-free--desktop--dark--built.png)<br>`/profile`, 105 KB, horizontal overflow 0px | ![prototype dark](proto--Settings--free--dark--guardian.png), 81 KB |
| mobile | light | ![settings-guardian-free mobile light](settings-guardian-free--mobile--light--built.png)<br>`/profile`, 97 KB, horizontal overflow 0px | ![prototype light](proto--Settings--free--light--guardian.png)<br>desktop prototype (no phone layout), 80 KB |
| mobile | dark | ![settings-guardian-free mobile dark](settings-guardian-free--mobile--dark--built.png)<br>`/profile`, 100 KB, horizontal overflow 0px | ![prototype dark](proto--Settings--free--dark--guardian.png)<br>desktop prototype (no phone layout), 81 KB |

## Settings → Billing, paid and self-managed: the status and Manage billing (not clicked: it opens Stripe)

Persona: `paid`. Route: `/profile?tab=billing`.
Full page: the whole document, not just the viewport.
Prototype: `Settings.dc.html` (Settings, plan = paid, Billing clicked); clicked: `nav[aria-label="Settings sections"] button:has-text("Billing")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![settings-billing-paid desktop light](settings-billing-paid--desktop--light--built.png)<br>`/profile`, 54 KB, horizontal overflow 0px | ![prototype light](proto--Settings--paid--light--billing.png), 58 KB |
| desktop | dark | ![settings-billing-paid desktop dark](settings-billing-paid--desktop--dark--built.png)<br>`/profile`, 55 KB, horizontal overflow 0px | ![prototype dark](proto--Settings--paid--dark--billing.png), 59 KB |
| mobile | light | ![settings-billing-paid mobile light](settings-billing-paid--mobile--light--built.png)<br>`/profile`, 44 KB, horizontal overflow 0px | ![prototype light](proto--Settings--paid--light--billing.png)<br>desktop prototype (no phone layout), 58 KB |
| mobile | dark | ![settings-billing-paid mobile dark](settings-billing-paid--mobile--dark--built.png)<br>`/profile`, 44 KB, horizontal overflow 0px | ![prototype dark](proto--Settings--paid--dark--billing.png)<br>desktop prototype (no phone layout), 59 KB |

## Settings → Billing, free: the free plan and See plans

Persona: `free`. Route: `/profile?tab=billing`.
Full page: the whole document, not just the viewport.
Prototype: `Settings.dc.html` (Settings, plan = free, Billing clicked); clicked: `nav[aria-label="Settings sections"] button:has-text("Billing")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![settings-billing-free desktop light](settings-billing-free--desktop--light--built.png)<br>`/profile`, 66 KB, horizontal overflow 0px | ![prototype light](proto--Settings--free--light--billing.png), 65 KB |
| desktop | dark | ![settings-billing-free desktop dark](settings-billing-free--desktop--dark--built.png)<br>`/profile`, 67 KB, horizontal overflow 0px | ![prototype dark](proto--Settings--free--dark--billing.png), 66 KB |
| mobile | light | ![settings-billing-free mobile light](settings-billing-free--mobile--light--built.png)<br>`/profile`, 53 KB, horizontal overflow 0px | ![prototype light](proto--Settings--free--light--billing.png)<br>desktop prototype (no phone layout), 65 KB |
| mobile | dark | ![settings-billing-free mobile dark](settings-billing-free--mobile--dark--built.png)<br>`/profile`, 53 KB, horizontal overflow 0px | ![prototype dark](proto--Settings--free--dark--billing.png)<br>desktop prototype (no phone layout), 66 KB |

## Settings → Billing, guardian-managed (F-40): 'Managed by your guardian', no button

Persona: `managed`. Route: `/profile?tab=billing`.
Full page: the whole document, not just the viewport.
Prototype: `Settings.dc.html` (Settings, plan = guardian-paid, Billing clicked); clicked: `nav[aria-label="Settings sections"] button:has-text("Billing")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![settings-billing-managed desktop light](settings-billing-managed--desktop--light--built.png)<br>`/profile`, 53 KB, horizontal overflow 0px | ![prototype light](proto--Settings--guardian-paid--light--billing.png), 54 KB |
| desktop | dark | ![settings-billing-managed desktop dark](settings-billing-managed--desktop--dark--built.png)<br>`/profile`, 54 KB, horizontal overflow 0px | ![prototype dark](proto--Settings--guardian-paid--dark--billing.png), 54 KB |
| mobile | light | ![settings-billing-managed mobile light](settings-billing-managed--mobile--light--built.png)<br>`/profile`, 42 KB, horizontal overflow 0px | ![prototype light](proto--Settings--guardian-paid--light--billing.png)<br>desktop prototype (no phone layout), 54 KB |
| mobile | dark | ![settings-billing-managed mobile dark](settings-billing-managed--mobile--dark--built.png)<br>`/profile`, 43 KB, horizontal overflow 0px | ![prototype dark](proto--Settings--guardian-paid--dark--billing.png)<br>desktop prototype (no phone layout), 54 KB |

## Settings → Appearance: Match device, Light, Dark (saved on this device); no Notifications section (OQ-27)

Persona: `paid`. Route: `/profile?tab=appearance`.
Full page: the whole document, not just the viewport.
Prototype: `Settings.dc.html` (Settings, plan = paid, Appearance clicked); clicked: `nav[aria-label="Settings sections"] button:has-text("Appearance")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![settings-appearance desktop light](settings-appearance--desktop--light--built.png)<br>`/profile`, 59 KB, horizontal overflow 0px | ![prototype light](proto--Settings--paid--light--appearance.png), 59 KB |
| desktop | dark | ![settings-appearance desktop dark](settings-appearance--desktop--dark--built.png)<br>`/profile`, 59 KB, horizontal overflow 0px | ![prototype dark](proto--Settings--paid--dark--appearance.png), 59 KB |
| mobile | light | ![settings-appearance mobile light](settings-appearance--mobile--light--built.png)<br>`/profile`, 49 KB, horizontal overflow 0px | ![prototype light](proto--Settings--paid--light--appearance.png)<br>desktop prototype (no phone layout), 59 KB |
| mobile | dark | ![settings-appearance mobile dark](settings-appearance--mobile--dark--built.png)<br>`/profile`, 49 KB, horizontal overflow 0px | ![prototype dark](proto--Settings--paid--dark--appearance.png)<br>desktop prototype (no phone layout), 59 KB |

## Click path: Settings → choosing Billing in the section list shows Billing (the URL carries ?tab=billing)

Persona: `paid`. Route: `/profile`.
Step: click `{"desktop":"[data-testid=\"settings-section-billing\"]","mobile":"[data-testid=\"settings-section-billing\"]"}`.
Must then show `[data-testid="settings-billing-self"]` (the capture fails otherwise).
Click path: must land on a path matching `^/profile$` (the capture fails otherwise); the path it landed on is under each built shot.
Prototype: none. A click path: the screenshot is where the click landed (Billing on /profile), proven by the section on screen.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![click-settings-section desktop light](click-settings-section--desktop--light--built.png)<br>`/profile`, 54 KB, horizontal overflow 0px | none |
| desktop | dark | ![click-settings-section desktop dark](click-settings-section--desktop--dark--built.png)<br>`/profile`, 55 KB, horizontal overflow 0px | none |
| mobile | light | ![click-settings-section mobile light](click-settings-section--mobile--light--built.png)<br>`/profile`, 44 KB, horizontal overflow 0px | none |
| mobile | dark | ![click-settings-section mobile dark](click-settings-section--mobile--dark--built.png)<br>`/profile`, 44 KB, horizontal overflow 0px | none |

## Help: the seven questions (the first open), Still need help? with Contact support, the Policies, the footer

Persona: `paid`. Route: `/help`.
Full page: the whole document, not just the viewport.
Prototype: `Help.dc.html` (Help, plan = paid (first question open)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![help desktop light](help--desktop--light--built.png)<br>`/help`, 87 KB, horizontal overflow 0px | ![prototype light](proto--Help--paid--light.png), 91 KB |
| desktop | dark | ![help desktop dark](help--desktop--dark--built.png)<br>`/help`, 88 KB, horizontal overflow 0px | ![prototype dark](proto--Help--paid--dark.png), 93 KB |
| mobile | light | ![help mobile light](help--mobile--light--built.png)<br>`/help`, 106 KB, horizontal overflow 0px | ![prototype light](proto--Help--paid--light.png)<br>desktop prototype (no phone layout), 91 KB |
| mobile | dark | ![help mobile dark](help--mobile--dark--built.png)<br>`/help`, 108 KB, horizontal overflow 0px | ![prototype dark](proto--Help--paid--dark.png)<br>desktop prototype (no phone layout), 93 KB |

## Click path: Help from the rail (desktop) or the avatar menu (390) lands on /help

Persona: `paid`. Route: `/dashboard`.
Step: click `{"desktop":"[data-testid=\"rail-help\"]","mobile":"[data-testid=\"button-user-menu\"]"}`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"menu-help\"]"}`.
Must then show `[data-testid="help-page"]` (the capture fails otherwise).
Click path: must land on a path matching `^/help$` (the capture fails otherwise); the path it landed on is under each built shot.
Prototype: none. A click path: the screenshot is where the click landed (/help), proven by its pathname.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![click-help-from-rail desktop light](click-help-from-rail--desktop--light--built.png)<br>`/help`, 87 KB, horizontal overflow 0px | none |
| desktop | dark | ![click-help-from-rail desktop dark](click-help-from-rail--desktop--dark--built.png)<br>`/help`, 88 KB, horizontal overflow 0px | none |
| mobile | light | ![click-help-from-rail mobile light](click-help-from-rail--mobile--light--built.png)<br>`/help`, 65 KB, horizontal overflow 0px | none |
| mobile | dark | ![click-help-from-rail mobile dark](click-help-from-rail--mobile--dark--built.png)<br>`/help`, 67 KB, horizontal overflow 0px | none |

## Notifications (NOT PROTOTYPED): the inbox on the student tokens

Persona: `paid`. Route: `/notifications`.
Full page: the whole document, not just the viewport.
Prototype: none. NOT PROTOTYPED (DESIGN.md §4): built to the shell spec; these screenshots go to Karl before merge.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![notifications desktop light](notifications--desktop--light--built.png)<br>`/notifications`, 44 KB, horizontal overflow 0px | none |
| desktop | dark | ![notifications desktop dark](notifications--desktop--dark--built.png)<br>`/notifications`, 44 KB, horizontal overflow 0px | none |
| mobile | light | ![notifications mobile light](notifications--mobile--light--built.png)<br>`/notifications`, 31 KB, horizontal overflow 0px | none |
| mobile | dark | ![notifications mobile dark](notifications--mobile--dark--built.png)<br>`/notifications`, 31 KB, horizontal overflow 0px | none |

## The plans page /upgrade (NOT PROTOTYPED): three plans, the best value filled; no in-body back link

Persona: `free`. Route: `/upgrade`.
Stubbed in the browser: `GET /api/billing/plans` is answered by the browser itself and never reaches the server. The real route reads prices from Stripe, which the harness never calls (no key). The body is built by the shared `billingPlansResponseSchema`; the prices are illustrative (upgrade.page.test.tsx's fixture amounts), not Lyceon's.
Full page: the whole document, not just the viewport.
Prototype: none. NOT PROTOTYPED (DESIGN.md §4): built to the shell spec; these screenshots go to Karl before merge.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![upgrade desktop light](upgrade--desktop--light--built.png)<br>`/upgrade`, 95 KB, horizontal overflow 0px | none |
| desktop | dark | ![upgrade desktop dark](upgrade--desktop--dark--built.png)<br>`/upgrade`, 96 KB, horizontal overflow 0px | none |
| mobile | light | ![upgrade mobile light](upgrade--mobile--light--built.png)<br>`/upgrade`, 83 KB, horizontal overflow 0px | none |
| mobile | dark | ![upgrade mobile dark](upgrade--mobile--dark--built.png)<br>`/upgrade`, 84 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"7e6a5d49-5c12-41bb-a4b5-9030d619b405","openPracticeSessionId":"5dea1646-3c4c-40b5-878c-2b56d32fa35d","openReviewSessionId":null,"diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":13},"paid":{"completedPracticeSessionId":"d19542bb-9e0e-4e8d-8dc6-a892e0c6812e","openPracticeSessionId":"801cd9ac-fc1d-4f77-9a7a-12543f338441","openReviewSessionId":null,"diagnosticSessionId":"e9bdc79b-6e43-4f6c-8ea7-cc1867578f9c","scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":53}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- External hosts blocked: `fonts.googleapis.com`

## Remaining differences (built vs prototype), and how this run was made

- Run: `ACCOUNT_DELETION_LIFECYCLE_V2=true STUDENT_HARNESS_DB=student_e2e_ui58 HARNESS_PORT=5078 STUDENT_HARNESS_VITE_PORT=5198 pnpm exec tsx tests/e2e/student-harness/capture.ts UI-58` (the flag only reveals the Delete account box; nothing was deleted). A third persona, `managed` (guardian-paid: subscription id, no Stripe customer), was added for the Billing guardian state.
- Settings: the section list and the form sit inside the shell's 800px reading column, so the form column is narrower than the prototype's (which has no column cap on this page).
- Profile: "About you" is absent (UI-S8 open); the canvas draws it. The Save button is disabled until something changes.
- Account: no "Sign-in method" line in these shots, because the harness has no identity service and `/api/profile` answers `hasPassword: null` (OQ-41: unknown shows the form, and no method line). With `true` it reads "Email and password"; with `false` "Google".
- Guardian: the shipped expiry line and the SCL-080 consequence paragraph sit under the code; the email action is the shipped inline form (its button reads "Email it to my guardian"); the paid student shows the linked guardian (the canvas shows none linked). The status sentence is the OQ-38 ruled wording, not the canvas's.
- Billing (paid): the status line is the shipped label ("Active"); the canvas's "Renews on <date>" is not shown (the status carries no cancel-at-period-end flag, so a renewal claim could be false; owner question).
- Help: answer 5 ("What can my guardian see?") is the OQ-38 sentence (owner question). Rows are a few pixels taller than the canvas (the global heading line height).
- Rail: the built rail carries the notification bell (OQ-47) and does not ring the avatar on Settings as the canvas does (shell, not this row).
- Notifications (NOT PROTOTYPED): the harness student has no notification rows, so the inbox shows its empty state; the feed's behaviour is proven in `client/src/pages/notifications.test.tsx`.
- Plans page (NOT PROTOTYPED): `GET /api/billing/plans` is answered by the browser (prices are illustrative test-fixture amounts) because the real route reads Stripe, which the harness never calls.
- Full-page phone shots show the fixed tab bar mid-page (a screenshot artefact of a fixed element, as in earlier groups).
