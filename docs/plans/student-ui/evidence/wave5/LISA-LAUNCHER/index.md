# LISA launcher: Home and Review, collapsed and expanded, in the middle column (never over the rail or the right panel); the free lock; light and dark, 1440, 1024 and 390

Generated 2026-10-23T08:06:39.605Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts LISA-LAUNCHER` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844, and any extra size a shot names.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## Home (paid): the 'Ask LISA' launcher at the bottom-right of the middle column, left of the right panel. Phone: no launcher, the LISA tab as before

Persona: `paid`. Route: `/dashboard`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. No prototype draws the launcher: it is the owner brief of 2026-10-23 ("LISA launcher redesign + placement", option D); DESIGN.md §3 and §4 describe it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-collapsed desktop light](home-collapsed--desktop--light--built.png)<br>`/dashboard`, 159 KB, horizontal overflow 0px | none |
| desktop | dark | ![home-collapsed desktop dark](home-collapsed--desktop--dark--built.png)<br>`/dashboard`, 158 KB, horizontal overflow 0px | none |
| mobile | light | ![home-collapsed mobile light](home-collapsed--mobile--light--built.png)<br>`/dashboard`, 61 KB, horizontal overflow 0px | none |
| mobile | dark | ![home-collapsed mobile dark](home-collapsed--mobile--dark--built.png)<br>`/dashboard`, 62 KB, horizontal overflow 0px | none |
| w1024 | light | ![home-collapsed w1024 light](home-collapsed--w1024--light--built.png)<br>`/dashboard`, 122 KB, horizontal overflow 0px | none |
| w1024 | dark | ![home-collapsed w1024 dark](home-collapsed--w1024--dark--built.png)<br>`/dashboard`, 123 KB, horizontal overflow 0px | none |

## Home (paid): the launcher clicked; the panel (the sparkle and LISA in its header) opens upward inside the middle column, min(380px, column - 24px) wide

Persona: `paid`. Route: `/dashboard`.
Step: click `{"desktop":"[data-testid=\"chat-dock-bubble\"]","mobile":null}`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. No prototype draws the launcher: it is the owner brief of 2026-10-23 ("LISA launcher redesign + placement", option D); DESIGN.md §3 and §4 describe it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-expanded desktop light](home-expanded--desktop--light--built.png)<br>`/dashboard`, 178 KB, horizontal overflow 0px | none |
| desktop | dark | ![home-expanded desktop dark](home-expanded--desktop--dark--built.png)<br>`/dashboard`, 179 KB, horizontal overflow 0px | none |
| mobile | light | ![home-expanded mobile light](home-expanded--mobile--light--built.png)<br>`/dashboard`, 61 KB, horizontal overflow 0px | none |
| mobile | dark | ![home-expanded mobile dark](home-expanded--mobile--dark--built.png)<br>`/dashboard`, 62 KB, horizontal overflow 0px | none |
| w1024 | light | ![home-expanded w1024 light](home-expanded--w1024--light--built.png)<br>`/dashboard`, 112 KB, horizontal overflow 0px | none |
| w1024 | dark | ![home-expanded w1024 dark](home-expanded--w1024--dark--built.png)<br>`/dashboard`, 113 KB, horizontal overflow 0px | none |

## Review (paid): the launcher at the bottom-right of the middle column

Persona: `paid`. Route: `/review`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. No prototype draws the launcher: it is the owner brief of 2026-10-23 ("LISA launcher redesign + placement", option D); DESIGN.md §3 and §4 describe it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-collapsed desktop light](review-collapsed--desktop--light--built.png)<br>`/review`, 143 KB, horizontal overflow 0px | none |
| desktop | dark | ![review-collapsed desktop dark](review-collapsed--desktop--dark--built.png)<br>`/review`, 146 KB, horizontal overflow 0px | none |
| mobile | light | ![review-collapsed mobile light](review-collapsed--mobile--light--built.png)<br>`/review`, 58 KB, horizontal overflow 0px | none |
| mobile | dark | ![review-collapsed mobile dark](review-collapsed--mobile--dark--built.png)<br>`/review`, 58 KB, horizontal overflow 0px | none |
| w1024 | light | ![review-collapsed w1024 light](review-collapsed--w1024--light--built.png)<br>`/review`, 111 KB, horizontal overflow 0px | none |
| w1024 | dark | ![review-collapsed w1024 dark](review-collapsed--w1024--dark--built.png)<br>`/review`, 112 KB, horizontal overflow 0px | none |

## Review (paid): the panel open in the middle column

Persona: `paid`. Route: `/review`.
Step: click `{"desktop":"[data-testid=\"chat-dock-bubble\"]","mobile":null}`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. No prototype draws the launcher: it is the owner brief of 2026-10-23 ("LISA launcher redesign + placement", option D); DESIGN.md §3 and §4 describe it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-expanded desktop light](review-expanded--desktop--light--built.png)<br>`/review`, 169 KB, horizontal overflow 0px | none |
| desktop | dark | ![review-expanded desktop dark](review-expanded--desktop--dark--built.png)<br>`/review`, 171 KB, horizontal overflow 0px | none |
| mobile | light | ![review-expanded mobile light](review-expanded--mobile--light--built.png)<br>`/review`, 58 KB, horizontal overflow 0px | none |
| mobile | dark | ![review-expanded mobile dark](review-expanded--mobile--dark--built.png)<br>`/review`, 58 KB, horizontal overflow 0px | none |
| w1024 | light | ![review-expanded w1024 light](review-expanded--w1024--light--built.png)<br>`/review`, 113 KB, horizontal overflow 0px | none |
| w1024 | dark | ![review-expanded w1024 dark](review-expanded--w1024--dark--built.png)<br>`/review`, 114 KB, horizontal overflow 0px | none |

## Home (free): the same launcher with the lock in the sparkle's place ('Ask LISA, included with a paid plan')

Persona: `free`. Route: `/dashboard`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. No prototype draws the launcher: it is the owner brief of 2026-10-23 ("LISA launcher redesign + placement", option D); DESIGN.md §3 and §4 describe it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-free-lock desktop light](home-free-lock--desktop--light--built.png)<br>`/dashboard`, 143 KB, horizontal overflow 0px | none |
| desktop | dark | ![home-free-lock desktop dark](home-free-lock--desktop--dark--built.png)<br>`/dashboard`, 144 KB, horizontal overflow 0px | none |
| mobile | light | ![home-free-lock mobile light](home-free-lock--mobile--light--built.png)<br>`/dashboard`, 64 KB, horizontal overflow 0px | none |
| mobile | dark | ![home-free-lock mobile dark](home-free-lock--mobile--dark--built.png)<br>`/dashboard`, 64 KB, horizontal overflow 0px | none |
| w1024 | light | ![home-free-lock w1024 light](home-free-lock--w1024--light--built.png)<br>`/dashboard`, 123 KB, horizontal overflow 0px | none |
| w1024 | dark | ![home-free-lock w1024 dark](home-free-lock--w1024--dark--built.png)<br>`/dashboard`, 125 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"b2a800b0-cd96-4a54-bfaa-10a4ecfc6e22","openPracticeSessionId":"8f3484b5-9c5f-4b2e-afc2-46d438715bc8","openReviewSessionId":"3f307a91-839b-4efe-88da-2e6adb316471","diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":39},"paid":{"completedPracticeSessionId":"77cdc036-1e76-4c8f-bddb-38ddc6a23090","openPracticeSessionId":"8f984c13-faa7-4b70-8776-261bd7a53203","openReviewSessionId":"dbc9177e-b35f-49d1-afc1-a3aa5327af53","diagnosticSessionId":"b1e0733f-8ee4-4fbc-a3a6-12e2622d5d67","scoredExamSessionId":"efeba3cc-89cd-4ee7-a3e5-fc61cf49545d","inProgressExamSessionId":"074e3b77-c272-4e63-8763-37b004a0d1d2","lisaConversationId":"57eb2791-cbed-4d6f-ad4e-874b96170b3d","answered":204}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- Desmos (QA2-B, opt-in `STUDENT_HARNESS_DESMOS=1`): not loaded (a local-only run; the calculator shows its unavailable line)
- External hosts blocked: none
