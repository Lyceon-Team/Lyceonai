# W6 UI-64 the free daily limit and the diagnostic length from the server config (1440, 1024, 390; light and dark)

Generated 2026-10-08T21:07:59.431Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts W6-UI-64` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844, and any extra size a shot names.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## Home, free: the diagnostic card's length, How Lyceon works, today's quota

Persona: `free`. Route: `/dashboard`.
Full page: the whole document, not just the viewport.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. Not compared with a prototype: a before/after pair for one row.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-free desktop light](home-free--desktop--light--built.png)<br>`/dashboard`, 141 KB, horizontal overflow 0px | none |
| desktop | dark | ![home-free desktop dark](home-free--desktop--dark--built.png)<br>`/dashboard`, 142 KB, horizontal overflow 0px | none |
| mobile | light | ![home-free mobile light](home-free--mobile--light--built.png)<br>`/dashboard`, 171 KB, horizontal overflow 0px | none |
| mobile | dark | ![home-free mobile dark](home-free--mobile--dark--built.png)<br>`/dashboard`, 172 KB, horizontal overflow 0px | none |
| w1024 | light | ![home-free w1024 light](home-free--w1024--light--built.png)<br>`/dashboard`, 112 KB, horizontal overflow 0px | none |
| w1024 | dark | ![home-free w1024 dark](home-free--w1024--dark--built.png)<br>`/dashboard`, 113 KB, horizontal overflow 0px | none |

## Help, paid: the plan FAQ (the first question, open)

Persona: `paid`. Route: `/help`.
Full page: the whole document, not just the viewport.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. Not compared with a prototype: a before/after pair for one row.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![help-paid desktop light](help-paid--desktop--light--built.png)<br>`/help`, 87 KB, horizontal overflow 0px | none |
| desktop | dark | ![help-paid desktop dark](help-paid--desktop--dark--built.png)<br>`/help`, 89 KB, horizontal overflow 0px | none |
| mobile | light | ![help-paid mobile light](help-paid--mobile--light--built.png)<br>`/help`, 122 KB, horizontal overflow 0px | none |
| mobile | dark | ![help-paid mobile dark](help-paid--mobile--dark--built.png)<br>`/help`, 125 KB, horizontal overflow 0px | none |
| w1024 | light | ![help-paid w1024 light](help-paid--w1024--light--built.png)<br>`/help`, 80 KB, horizontal overflow 0px | none |
| w1024 | dark | ![help-paid w1024 dark](help-paid--w1024--dark--built.png)<br>`/help`, 81 KB, horizontal overflow 0px | none |

## Help, free: the plan FAQ (the first question, open)

Persona: `free`. Route: `/help`.
Full page: the whole document, not just the viewport.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. Not compared with a prototype: a before/after pair for one row.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![help-free desktop light](help-free--desktop--light--built.png)<br>`/help`, 88 KB, horizontal overflow 0px | none |
| desktop | dark | ![help-free desktop dark](help-free--desktop--dark--built.png)<br>`/help`, 89 KB, horizontal overflow 0px | none |
| mobile | light | ![help-free mobile light](help-free--mobile--light--built.png)<br>`/help`, 123 KB, horizontal overflow 0px | none |
| mobile | dark | ![help-free mobile dark](help-free--mobile--dark--built.png)<br>`/help`, 125 KB, horizontal overflow 0px | none |
| w1024 | light | ![help-free w1024 light](help-free--w1024--light--built.png)<br>`/help`, 80 KB, horizontal overflow 0px | none |
| w1024 | dark | ![help-free w1024 dark](help-free--w1024--dark--built.png)<br>`/help`, 82 KB, horizontal overflow 0px | none |

## Settings → Billing, free: the free plan box

Persona: `free`. Route: `/profile?tab=billing`.
Full page: the whole document, not just the viewport.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. Not compared with a prototype: a before/after pair for one row.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![settings-billing-free desktop light](settings-billing-free--desktop--light--built.png)<br>`/profile`, 71 KB, horizontal overflow 0px | none |
| desktop | dark | ![settings-billing-free desktop dark](settings-billing-free--desktop--dark--built.png)<br>`/profile`, 72 KB, horizontal overflow 0px | none |
| mobile | light | ![settings-billing-free mobile light](settings-billing-free--mobile--light--built.png)<br>`/profile`, 56 KB, horizontal overflow 0px | none |
| mobile | dark | ![settings-billing-free mobile dark](settings-billing-free--mobile--dark--built.png)<br>`/profile`, 56 KB, horizontal overflow 0px | none |
| w1024 | light | ![settings-billing-free w1024 light](settings-billing-free--w1024--light--built.png)<br>`/profile`, 68 KB, horizontal overflow 0px | none |
| w1024 | dark | ![settings-billing-free w1024 dark](settings-billing-free--w1024--dark--built.png)<br>`/profile`, 69 KB, horizontal overflow 0px | none |

## Settings → Billing, paid: the status (no plan copy on this plan)

Persona: `paid`. Route: `/profile?tab=billing`.
Full page: the whole document, not just the viewport.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. Not compared with a prototype: a before/after pair for one row.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![settings-billing-paid desktop light](settings-billing-paid--desktop--light--built.png)<br>`/profile`, 57 KB, horizontal overflow 0px | none |
| desktop | dark | ![settings-billing-paid desktop dark](settings-billing-paid--desktop--dark--built.png)<br>`/profile`, 58 KB, horizontal overflow 0px | none |
| mobile | light | ![settings-billing-paid mobile light](settings-billing-paid--mobile--light--built.png)<br>`/profile`, 46 KB, horizontal overflow 0px | none |
| mobile | dark | ![settings-billing-paid mobile dark](settings-billing-paid--mobile--dark--built.png)<br>`/profile`, 46 KB, horizontal overflow 0px | none |
| w1024 | light | ![settings-billing-paid w1024 light](settings-billing-paid--w1024--light--built.png)<br>`/profile`, 54 KB, horizontal overflow 0px | none |
| w1024 | dark | ![settings-billing-paid w1024 dark](settings-billing-paid--w1024--dark--built.png)<br>`/profile`, 55 KB, horizontal overflow 0px | none |

## The plans page /upgrade, free: the free/paid sentences

Persona: `free`. Route: `/upgrade`.
Stubbed in the browser: `GET /api/billing/plans` is answered by the browser itself and never reaches the server. The real route reads prices from Stripe, which the harness never calls (no key). The body is built by the shared `billingPlansResponseSchema`; the prices are illustrative (upgrade.page.test.tsx's fixture amounts), not Lyceon's.
Full page: the whole document, not just the viewport.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. Not compared with a prototype: a before/after pair for one row.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![upgrade desktop light](upgrade--desktop--light--built.png)<br>`/upgrade`, 85 KB, horizontal overflow 0px | none |
| desktop | dark | ![upgrade desktop dark](upgrade--desktop--dark--built.png)<br>`/upgrade`, 85 KB, horizontal overflow 0px | none |
| mobile | light | ![upgrade mobile light](upgrade--mobile--light--built.png)<br>`/upgrade`, 76 KB, horizontal overflow 0px | none |
| mobile | dark | ![upgrade mobile dark](upgrade--mobile--dark--built.png)<br>`/upgrade`, 77 KB, horizontal overflow 0px | none |
| w1024 | light | ![upgrade w1024 light](upgrade--w1024--light--built.png)<br>`/upgrade`, 76 KB, horizontal overflow 0px | none |
| w1024 | dark | ![upgrade w1024 dark](upgrade--w1024--dark--built.png)<br>`/upgrade`, 77 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"2d96d3fe-d493-4a73-8186-8c667202e8a6","openPracticeSessionId":"1942a219-b173-4da5-b440-4b6d0eebe439","openReviewSessionId":null,"diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":13},"paid":{"completedPracticeSessionId":"66187288-0ca0-46a4-b7a4-176c4fcaf9dd","openPracticeSessionId":"8e733ac4-d3b0-4df4-8278-7176cdbe295b","openReviewSessionId":null,"diagnosticSessionId":"1f0c1d54-30ba-47a4-9832-ead218ccc70f","scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":53}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- Desmos (QA2-B, opt-in `STUDENT_HARNESS_DESMOS=1`): not loaded (a local-only run; the calculator shows its unavailable line)
- External hosts blocked: none
