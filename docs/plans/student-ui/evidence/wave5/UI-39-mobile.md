# UI-39 Mobile: every student page at 390px, light and dark

Register row UI-39 ("Mobile: bottom tab bar and one page per shell"; proof: Karl's sign-off). This index collects the phone (390x844) captures that each Wave 4/5 page group already took with the student harness (`tests/e2e/student-harness/capture.ts`), so the mobile layout can be signed off in one place. Nothing here is newly captured; each row links the group's own capture, and that group's `index.md` has the conditions, the personas and the desktop/prototype pairs.

- **Tab bar and avatar menu:** UI-41 (App shell). The five-tab bar (Home, Review, Practice, Calendar, LISA; Practice in the middle) replaces the rail below the `lg` breakpoint; the avatar menu reads Settings, Help, Sign out, and follows the page theme (F-70; `app-avatar-menu-light-locked` shows a page pinned light). Full-Length is on neither: on a phone it is reached from Home's "Start a full-length test" card (UI-50 `click-paid-full-length-card`, `home-free-full-length-modal`; UI-41 `app-upgrade-modal-fulllength-free`) or a scheduled calendar block (owner ruling, Karl, 2026-10-05; supersedes OQ-4, OQ-48 and the Full-Length part of OQ-62). On a phone the Full-Length home first shows "Full-length tests are built for a laptop or tablet, like test day." with Continue anyway (UI-54 `tests-phone-notice`).
- **One page per shell:** the App shell pages (UI-50, 51, 52, 54 home, 55, 56, 57, 58) carry the tab bar; the Focus shell pages (UI-53 runners, UI-54 exam session and report) have the back arrow and no tab bar; the Bare card pages (UI-59) have neither.
- **Overflow:** every group's `index.md` records 0px horizontal overflow on every phone capture (UI-41 to UI-59).
- **Prototypes:** the prototypes are a fixed 1440x900 canvas with no phone layout, so no phone prototype exists to compare against; these are built-only.

**199 phone captures** across 11 page groups.

## UI-41: Shells: App shell (rail, mobile tab bar, avatar menu), Focus shell, Bare card

Full index with conditions: [`UI-41/index.md`](UI-41/index.md).

| State | Light | Dark |
|---|---|---|
| `app-avatar-menu-free` | ![app-avatar-menu-free light](UI-41/app-avatar-menu-free--mobile--light--built.png) | ![app-avatar-menu-free dark](UI-41/app-avatar-menu-free--mobile--dark--built.png) |
| `app-avatar-menu-light-locked` | ![app-avatar-menu-light-locked light](UI-41/app-avatar-menu-light-locked--mobile--light--built.png) | ![app-avatar-menu-light-locked dark](UI-41/app-avatar-menu-light-locked--mobile--dark--built.png) |
| `app-avatar-menu-paid` | ![app-avatar-menu-paid light](UI-41/app-avatar-menu-paid--mobile--light--built.png) | ![app-avatar-menu-paid dark](UI-41/app-avatar-menu-paid--mobile--dark--built.png) |
| `app-calendar-free` | ![app-calendar-free light](UI-41/app-calendar-free--mobile--light--built.png) | ![app-calendar-free dark](UI-41/app-calendar-free--mobile--dark--built.png) |
| `app-chat-free` | ![app-chat-free light](UI-41/app-chat-free--mobile--light--built.png) | ![app-chat-free dark](UI-41/app-chat-free--mobile--dark--built.png) |
| `app-dashboard-free` | ![app-dashboard-free light](UI-41/app-dashboard-free--mobile--light--built.png) | ![app-dashboard-free dark](UI-41/app-dashboard-free--mobile--dark--built.png) |
| `app-dashboard-paid` | ![app-dashboard-paid light](UI-41/app-dashboard-paid--mobile--light--built.png) | ![app-dashboard-paid dark](UI-41/app-dashboard-paid--mobile--dark--built.png) |
| `app-upgrade-modal-fulllength-free` | ![app-upgrade-modal-fulllength-free light](UI-41/app-upgrade-modal-fulllength-free--mobile--light--built.png) | ![app-upgrade-modal-fulllength-free dark](UI-41/app-upgrade-modal-fulllength-free--mobile--dark--built.png) |
| `app-upgrade-modal-lisa-free` | ![app-upgrade-modal-lisa-free light](UI-41/app-upgrade-modal-lisa-free--mobile--light--built.png) | ![app-upgrade-modal-lisa-free dark](UI-41/app-upgrade-modal-lisa-free--mobile--dark--built.png) |
| `bare-404` | ![bare-404 light](UI-41/bare-404--mobile--light--built.png) | ![bare-404 dark](UI-41/bare-404--mobile--dark--built.png) |
| `bare-login` | ![bare-login light](UI-41/bare-login--mobile--light--built.png) | ![bare-login dark](UI-41/bare-login--mobile--dark--built.png) |
| `focus-practice-runner` | ![focus-practice-runner light](UI-41/focus-practice-runner--mobile--light--built.png) | ![focus-practice-runner dark](UI-41/focus-practice-runner--mobile--dark--built.png) |

## UI-50: Home

Full index with conditions: [`UI-50/index.md`](UI-50/index.md).

| State | Light | Dark |
|---|---|---|
| `click-free-start-diagnostic` | ![click-free-start-diagnostic light](UI-50/click-free-start-diagnostic--mobile--light--built.png) | ![click-free-start-diagnostic dark](UI-50/click-free-start-diagnostic--mobile--dark--built.png) |
| `click-paid-full-length-card` | ![click-paid-full-length-card light](UI-50/click-paid-full-length-card--mobile--light--built.png) | ![click-paid-full-length-card dark](UI-50/click-paid-full-length-card--mobile--dark--built.png) |
| `click-paid-start-plan` | ![click-paid-start-plan light](UI-50/click-paid-start-plan--mobile--light--built.png) | ![click-paid-start-plan dark](UI-50/click-paid-start-plan--mobile--dark--built.png) |
| `home-free` | ![home-free light](UI-50/home-free--mobile--light--built.png) | ![home-free dark](UI-50/home-free--mobile--dark--built.png) |
| `home-free-full` | ![home-free-full light](UI-50/home-free-full--mobile--light--built.png) | ![home-free-full dark](UI-50/home-free-full--mobile--dark--built.png) |
| `home-free-full-length-modal` | ![home-free-full-length-modal light](UI-50/home-free-full-length-modal--mobile--light--built.png) | ![home-free-full-length-modal dark](UI-50/home-free-full-length-modal--mobile--dark--built.png) |
| `home-free-mastery-modal` | ![home-free-mastery-modal light](UI-50/home-free-mastery-modal--mobile--light--built.png) | ![home-free-mastery-modal dark](UI-50/home-free-mastery-modal--mobile--dark--built.png) |
| `home-paid` | ![home-paid light](UI-50/home-paid--mobile--light--built.png) | ![home-paid dark](UI-50/home-paid--mobile--dark--built.png) |
| `home-paid-full` | ![home-paid-full light](UI-50/home-paid-full--mobile--light--built.png) | ![home-paid-full dark](UI-50/home-paid-full--mobile--dark--built.png) |

## UI-51: Practice

Full index with conditions: [`UI-51/index.md`](UI-51/index.md).

| State | Light | Dark |
|---|---|---|
| `click-paid-start` | ![click-paid-start light](UI-51/click-paid-start--mobile--light--built.png) | ![click-paid-start dark](UI-51/click-paid-start--mobile--dark--built.png) |
| `practice-free` | ![practice-free light](UI-51/practice-free--mobile--light--built.png) | ![practice-free dark](UI-51/practice-free--mobile--dark--built.png) |
| `practice-free-full` | ![practice-free-full light](UI-51/practice-free-full--mobile--light--built.png) | ![practice-free-full dark](UI-51/practice-free-full--mobile--dark--built.png) |
| `practice-paid` | ![practice-paid light](UI-51/practice-paid--mobile--light--built.png) | ![practice-paid dark](UI-51/practice-paid--mobile--dark--built.png) |
| `practice-paid-filtered` | ![practice-paid-filtered light](UI-51/practice-paid-filtered--mobile--light--built.png) | ![practice-paid-filtered dark](UI-51/practice-paid-filtered--mobile--dark--built.png) |
| `practice-paid-full` | ![practice-paid-full light](UI-51/practice-paid-full--mobile--light--built.png) | ![practice-paid-full dark](UI-51/practice-paid-full--mobile--dark--built.png) |

## UI-52: Review

Full index with conditions: [`UI-52/index.md`](UI-52/index.md).

| State | Light | Dark |
|---|---|---|
| `click-paid-start` | ![click-paid-start light](UI-52/click-paid-start--mobile--light--built.png) | ![click-paid-start dark](UI-52/click-paid-start--mobile--dark--built.png) |
| `review-free` | ![review-free light](UI-52/review-free--mobile--light--built.png) | ![review-free dark](UI-52/review-free--mobile--dark--built.png) |
| `review-free-full` | ![review-free-full light](UI-52/review-free-full--mobile--light--built.png) | ![review-free-full dark](UI-52/review-free-full--mobile--dark--built.png) |
| `review-free-past-open` | ![review-free-past-open light](UI-52/review-free-past-open--mobile--light--built.png) | ![review-free-past-open dark](UI-52/review-free-past-open--mobile--dark--built.png) |
| `review-paid` | ![review-paid light](UI-52/review-paid--mobile--light--built.png) | ![review-paid dark](UI-52/review-paid--mobile--dark--built.png) |
| `review-paid-full` | ![review-paid-full light](UI-52/review-paid-full--mobile--light--built.png) | ![review-paid-full dark](UI-52/review-paid-full--mobile--dark--built.png) |
| `review-paid-past-open` | ![review-paid-past-open light](UI-52/review-paid-past-open--mobile--light--built.png) | ![review-paid-past-open dark](UI-52/review-paid-past-open--mobile--dark--built.png) |

## UI-53: Practice and review runners (Focus shell)

Full index with conditions: [`UI-53/index.md`](UI-53/index.md).

| State | Light | Dark |
|---|---|---|
| `click-practice-next` | ![click-practice-next light](UI-53/click-practice-next--mobile--light--built.png) | ![click-practice-next dark](UI-53/click-practice-next--mobile--dark--built.png) |
| `practice-correct` | ![practice-correct light](UI-53/practice-correct--mobile--light--built.png) | ![practice-correct dark](UI-53/practice-correct--mobile--dark--built.png) |
| `practice-incorrect` | ![practice-incorrect light](UI-53/practice-incorrect--mobile--light--built.png) | ![practice-incorrect dark](UI-53/practice-incorrect--mobile--dark--built.png) |
| `practice-selected` | ![practice-selected light](UI-53/practice-selected--mobile--light--built.png) | ![practice-selected dark](UI-53/practice-selected--mobile--dark--built.png) |
| `practice-shortened` | ![practice-shortened light](UI-53/practice-shortened--mobile--light--built.png) | ![practice-shortened dark](UI-53/practice-shortened--mobile--dark--built.png) |
| `review-correct` | ![review-correct light](UI-53/review-correct--mobile--light--built.png) | ![review-correct dark](UI-53/review-correct--mobile--dark--built.png) |
| `review-incorrect` | ![review-incorrect light](UI-53/review-incorrect--mobile--light--built.png) | ![review-incorrect dark](UI-53/review-incorrect--mobile--dark--built.png) |
| `review-lisa-focused` | ![review-lisa-focused light](UI-53/review-lisa-focused--mobile--light--built.png) | ![review-lisa-focused dark](UI-53/review-lisa-focused--mobile--dark--built.png) |
| `review-lisa-locked` | ![review-lisa-locked light](UI-53/review-lisa-locked--mobile--light--built.png) | ![review-lisa-locked dark](UI-53/review-lisa-locked--mobile--dark--built.png) |
| `review-lisa-typing` | ![review-lisa-typing light](UI-53/review-lisa-typing--mobile--light--built.png) | ![review-lisa-typing dark](UI-53/review-lisa-typing--mobile--dark--built.png) |
| `review-selected` | ![review-selected light](UI-53/review-selected--mobile--light--built.png) | ![review-selected dark](UI-53/review-selected--mobile--dark--built.png) |

## UI-54: Full-Length home, exam session, report

Full index with conditions: [`UI-54/index.md`](UI-54/index.md).

| State | Light | Dark |
|---|---|---|
| `click-paid-resume` | ![click-paid-resume light](UI-54/click-paid-resume--mobile--light--built.png) | ![click-paid-resume dark](UI-54/click-paid-resume--mobile--dark--built.png) |
| `report-scored` | ![report-scored light](UI-54/report-scored--mobile--light--built.png) | ![report-scored dark](UI-54/report-scored--mobile--dark--built.png) |
| `report-scored-full` | ![report-scored-full light](UI-54/report-scored-full--mobile--light--built.png) | ![report-scored-full dark](UI-54/report-scored-full--mobile--dark--built.png) |
| `tests-free` | ![tests-free light](UI-54/tests-free--mobile--light--built.png) | ![tests-free dark](UI-54/tests-free--mobile--dark--built.png) |
| `tests-paid` | ![tests-paid light](UI-54/tests-paid--mobile--light--built.png) | ![tests-paid dark](UI-54/tests-paid--mobile--dark--built.png) |
| `tests-paid-full` | ![tests-paid-full light](UI-54/tests-paid-full--mobile--light--built.png) | ![tests-paid-full dark](UI-54/tests-paid-full--mobile--dark--built.png) |
| `tests-phone-notice` | ![tests-phone-notice light](UI-54/tests-phone-notice--mobile--light--built.png) | ![tests-phone-notice dark](UI-54/tests-phone-notice--mobile--dark--built.png) |
| `timed-module` | ![timed-module light](UI-54/timed-module--mobile--light--built.png) | — |

## UI-55: Calendar

Full index with conditions: [`UI-55/index.md`](UI-55/index.md).

| State | Light | Dark |
|---|---|---|
| `free-save` | ![free-save light](UI-55/free-save--mobile--light--built.png) | ![free-save dark](UI-55/free-save--mobile--dark--built.png) |
| `free-saved` | ![free-saved light](UI-55/free-saved--mobile--light--built.png) | ![free-saved dark](UI-55/free-saved--mobile--dark--built.png) |
| `free-setup` | ![free-setup light](UI-55/free-setup--mobile--light--built.png) | ![free-setup dark](UI-55/free-setup--mobile--dark--built.png) |
| `paid-full-length-continue` | ![paid-full-length-continue light](UI-55/paid-full-length-continue--mobile--light--built.png) | ![paid-full-length-continue dark](UI-55/paid-full-length-continue--mobile--dark--built.png) |
| `paid-full-length-notice` | ![paid-full-length-notice light](UI-55/paid-full-length-notice--mobile--light--built.png) | ![paid-full-length-notice dark](UI-55/paid-full-length-notice--mobile--dark--built.png) |
| `paid-month` | ![paid-month light](UI-55/paid-month--mobile--light--built.png) | ![paid-month dark](UI-55/paid-month--mobile--dark--built.png) |
| `paid-regenerate` | ![paid-regenerate light](UI-55/paid-regenerate--mobile--light--built.png) | ![paid-regenerate dark](UI-55/paid-regenerate--mobile--dark--built.png) |
| `paid-week` | ![paid-week light](UI-55/paid-week--mobile--light--built.png) | ![paid-week dark](UI-55/paid-week--mobile--dark--built.png) |
| `paid-week-full` | ![paid-week-full light](UI-55/paid-week-full--mobile--light--built.png) | ![paid-week-full dark](UI-55/paid-week-full--mobile--dark--built.png) |

## UI-56: LISA

Full index with conditions: [`UI-56/index.md`](UI-56/index.md).

| State | Light | Dark |
|---|---|---|
| `free` | ![free light](UI-56/free--mobile--light--built.png) | ![free dark](UI-56/free--mobile--dark--built.png) |
| `free-unlock` | ![free-unlock light](UI-56/free-unlock--mobile--light--built.png) | ![free-unlock dark](UI-56/free-unlock--mobile--dark--built.png) |
| `paid-conversation` | ![paid-conversation light](UI-56/paid-conversation--mobile--light--built.png) | ![paid-conversation dark](UI-56/paid-conversation--mobile--dark--built.png) |
| `paid-conversation-full` | ![paid-conversation-full light](UI-56/paid-conversation-full--mobile--light--built.png) | ![paid-conversation-full dark](UI-56/paid-conversation-full--mobile--dark--built.png) |
| `paid-new-session` | ![paid-new-session light](UI-56/paid-new-session--mobile--light--built.png) | ![paid-new-session dark](UI-56/paid-new-session--mobile--dark--built.png) |
| `paid-typing` | ![paid-typing light](UI-56/paid-typing--mobile--light--built.png) | ![paid-typing dark](UI-56/paid-typing--mobile--dark--built.png) |

## UI-57: Mastery (not prototyped)

Full index with conditions: [`UI-57/index.md`](UI-57/index.md).

| State | Light | Dark |
|---|---|---|
| `click-home-see-every-skill` | ![click-home-see-every-skill light](UI-57/click-home-see-every-skill--mobile--light--built.png) | ![click-home-see-every-skill dark](UI-57/click-home-see-every-skill--mobile--dark--built.png) |
| `mastery-free` | ![mastery-free light](UI-57/mastery-free--mobile--light--built.png) | ![mastery-free dark](UI-57/mastery-free--mobile--dark--built.png) |
| `mastery-free-modal` | ![mastery-free-modal light](UI-57/mastery-free-modal--mobile--light--built.png) | ![mastery-free-modal dark](UI-57/mastery-free-modal--mobile--dark--built.png) |
| `mastery-paid` | ![mastery-paid light](UI-57/mastery-paid--mobile--light--built.png) | ![mastery-paid dark](UI-57/mastery-paid--mobile--dark--built.png) |
| `mastery-paid-skills` | ![mastery-paid-skills light](UI-57/mastery-paid-skills--mobile--light--built.png) | ![mastery-paid-skills dark](UI-57/mastery-paid-skills--mobile--dark--built.png) |

## UI-58: Settings, Help, notifications, plans page

Full index with conditions: [`UI-58/index.md`](UI-58/index.md).

| State | Light | Dark |
|---|---|---|
| `click-help-from-rail` | ![click-help-from-rail light](UI-58/click-help-from-rail--mobile--light--built.png) | ![click-help-from-rail dark](UI-58/click-help-from-rail--mobile--dark--built.png) |
| `click-settings-section` | ![click-settings-section light](UI-58/click-settings-section--mobile--light--built.png) | ![click-settings-section dark](UI-58/click-settings-section--mobile--dark--built.png) |
| `help` | ![help light](UI-58/help--mobile--light--built.png) | ![help dark](UI-58/help--mobile--dark--built.png) |
| `notifications` | ![notifications light](UI-58/notifications--mobile--light--built.png) | ![notifications dark](UI-58/notifications--mobile--dark--built.png) |
| `settings-account-paid` | ![settings-account-paid light](UI-58/settings-account-paid--mobile--light--built.png) | ![settings-account-paid dark](UI-58/settings-account-paid--mobile--dark--built.png) |
| `settings-appearance` | ![settings-appearance light](UI-58/settings-appearance--mobile--light--built.png) | ![settings-appearance dark](UI-58/settings-appearance--mobile--dark--built.png) |
| `settings-billing-free` | ![settings-billing-free light](UI-58/settings-billing-free--mobile--light--built.png) | ![settings-billing-free dark](UI-58/settings-billing-free--mobile--dark--built.png) |
| `settings-billing-managed` | ![settings-billing-managed light](UI-58/settings-billing-managed--mobile--light--built.png) | ![settings-billing-managed dark](UI-58/settings-billing-managed--mobile--dark--built.png) |
| `settings-billing-paid` | ![settings-billing-paid light](UI-58/settings-billing-paid--mobile--light--built.png) | ![settings-billing-paid dark](UI-58/settings-billing-paid--mobile--dark--built.png) |
| `settings-guardian-free` | ![settings-guardian-free light](UI-58/settings-guardian-free--mobile--light--built.png) | ![settings-guardian-free dark](UI-58/settings-guardian-free--mobile--dark--built.png) |
| `settings-guardian-paid` | ![settings-guardian-paid light](UI-58/settings-guardian-paid--mobile--light--built.png) | ![settings-guardian-paid dark](UI-58/settings-guardian-paid--mobile--dark--built.png) |
| `settings-profile-free` | ![settings-profile-free light](UI-58/settings-profile-free--mobile--light--built.png) | ![settings-profile-free dark](UI-58/settings-profile-free--mobile--dark--built.png) |
| `settings-profile-paid` | ![settings-profile-paid light](UI-58/settings-profile-paid--mobile--light--built.png) | ![settings-profile-paid dark](UI-58/settings-profile-paid--mobile--dark--built.png) |
| `upgrade` | ![upgrade light](UI-58/upgrade--mobile--light--built.png) | ![upgrade dark](UI-58/upgrade--mobile--dark--built.png) |

## UI-59: Bare card pages (not prototyped)

Full index with conditions: [`UI-59/index.md`](UI-59/index.md).

| State | Light | Dark |
|---|---|---|
| `account-recover-invalid` | ![account-recover-invalid light](UI-59/account-recover-invalid--mobile--light--built.png) | ![account-recover-invalid dark](UI-59/account-recover-invalid--mobile--dark--built.png) |
| `error-screen` | ![error-screen light](UI-59/error-screen--mobile--light--built.png) | ![error-screen dark](UI-59/error-screen--mobile--dark--built.png) |
| `guardian-required` | ![guardian-required light](UI-59/guardian-required--mobile--light--built.png) | ![guardian-required dark](UI-59/guardian-required--mobile--dark--built.png) |
| `login-redirect-error` | ![login-redirect-error light](UI-59/login-redirect-error--mobile--light--built.png) | ![login-redirect-error dark](UI-59/login-redirect-error--mobile--dark--built.png) |
| `login-reset` | ![login-reset light](UI-59/login-reset--mobile--light--built.png) | ![login-reset dark](UI-59/login-reset--mobile--dark--built.png) |
| `login-signin` | ![login-signin light](UI-59/login-signin--mobile--light--built.png) | ![login-signin dark](UI-59/login-signin--mobile--dark--built.png) |
| `login-signup` | ![login-signup light](UI-59/login-signup--mobile--light--built.png) | ![login-signup dark](UI-59/login-signup--mobile--dark--built.png) |
| `not-found` | ![not-found light](UI-59/not-found--mobile--light--built.png) | ![not-found dark](UI-59/not-found--mobile--dark--built.png) |
| `not-found-home` | ![not-found-home light](UI-59/not-found-home--mobile--light--built.png) | ![not-found-home dark](UI-59/not-found-home--mobile--dark--built.png) |
| `pending-deletion` | ![pending-deletion light](UI-59/pending-deletion--mobile--light--built.png) | ![pending-deletion dark](UI-59/pending-deletion--mobile--dark--built.png) |
| `profile-complete` | ![profile-complete light](UI-59/profile-complete--mobile--light--built.png) | ![profile-complete dark](UI-59/profile-complete--mobile--dark--built.png) |
| `update-password` | ![update-password light](UI-59/update-password--mobile--light--built.png) | ![update-password dark](UI-59/update-password--mobile--dark--built.png) |
| `update-password-refused` | ![update-password-refused light](UI-59/update-password-refused--mobile--light--built.png) | ![update-password-refused dark](UI-59/update-password-refused--mobile--dark--built.png) |
