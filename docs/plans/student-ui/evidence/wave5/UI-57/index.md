# UI-57 Mastery (/mastery, not prototyped): paid domains and an opened skills list, free locked card; light and dark, 1440 and 390

Generated 2026-10-05T06:46:26.376Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-57` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## Mastery, paid: the eight domains as wide mastery rows, Math then Reading & Writing (no right panel, no footer)

Persona: `paid`. Route: `/mastery`.
Full page: the whole document, not just the viewport.
Prototype: `Main.dc.html` (NOT PROTOTYPED. Visual reference only: Home, plan = paid (its Mastery block uses the same wide rows)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![mastery-paid desktop light](mastery-paid--desktop--light--built.png)<br>`/mastery`, 85 KB, horizontal overflow 0px | ![prototype light](proto--Main--paid--light.png), 147 KB |
| desktop | dark | ![mastery-paid desktop dark](mastery-paid--desktop--dark--built.png)<br>`/mastery`, 88 KB, horizontal overflow 0px | ![prototype dark](proto--Main--paid--dark.png), 147 KB |
| mobile | light | ![mastery-paid mobile light](mastery-paid--mobile--light--built.png)<br>`/mastery`, 71 KB, horizontal overflow 0px | ![prototype light](proto--Main--paid--light.png)<br>desktop prototype (no phone layout), 147 KB |
| mobile | dark | ![mastery-paid mobile dark](mastery-paid--mobile--dark--built.png)<br>`/mastery`, 74 KB, horizontal overflow 0px | ![prototype dark](proto--Main--paid--dark.png)<br>desktop prototype (no phone layout), 147 KB |

## Mastery, paid, Algebra opened: its skills listed beneath it, measured and unmeasured, with one outline 'Practice Algebra'

Persona: `paid`. Route: `/mastery`.
Step: click `{"desktop":"[data-testid=\"mastery-domain\"][data-domain=\"Algebra\"] > button","mobile":"[data-testid=\"mastery-domain\"][data-domain=\"Algebra\"] > button"}`.
Must then show `[data-testid="skill-list"]` (the capture fails otherwise).
Full page: the whole document, not just the viewport.
Prototype: `Main.dc.html` (NOT PROTOTYPED. Visual reference only: Home, plan = paid (its Mastery block uses the same wide rows)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![mastery-paid-skills desktop light](mastery-paid-skills--desktop--light--built.png)<br>`/mastery`, 101 KB, horizontal overflow 0px | ![prototype light](proto--Main--paid--light.png), 147 KB |
| desktop | dark | ![mastery-paid-skills desktop dark](mastery-paid-skills--desktop--dark--built.png)<br>`/mastery`, 103 KB, horizontal overflow 0px | ![prototype dark](proto--Main--paid--dark.png), 147 KB |
| mobile | light | ![mastery-paid-skills mobile light](mastery-paid-skills--mobile--light--built.png)<br>`/mastery`, 115 KB, horizontal overflow 0px | ![prototype light](proto--Main--paid--light.png)<br>desktop prototype (no phone layout), 147 KB |
| mobile | dark | ![mastery-paid-skills mobile dark](mastery-paid-skills--mobile--dark--built.png)<br>`/mastery`, 118 KB, horizontal overflow 0px | ![prototype dark](proto--Main--paid--dark.png)<br>desktop prototype (no phone layout), 147 KB |

## Mastery, free: the locked mastery card, no mastery request (the feature-access map locks mastery_detail)

Persona: `free`. Route: `/mastery`.
Prototype: `Practice.dc.html` (NOT PROTOTYPED. Visual reference only: Practice, plan = free (the locked mastery card in its right panel)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![mastery-free desktop light](mastery-free--desktop--light--built.png)<br>`/mastery`, 52 KB, horizontal overflow 0px | ![prototype light](proto--Practice--free--light.png), 117 KB |
| desktop | dark | ![mastery-free desktop dark](mastery-free--desktop--dark--built.png)<br>`/mastery`, 53 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--free--dark.png), 119 KB |
| mobile | light | ![mastery-free mobile light](mastery-free--mobile--light--built.png)<br>`/mastery`, 44 KB, horizontal overflow 0px | ![prototype light](proto--Practice--free--light.png)<br>desktop prototype (no phone layout), 117 KB |
| mobile | dark | ![mastery-free mobile dark](mastery-free--mobile--dark--built.png)<br>`/mastery`, 44 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--free--dark.png)<br>desktop prototype (no phone layout), 119 KB |

## Mastery, free: 'See what's included' opens the upgrade modal for mastery_detail

Persona: `free`. Route: `/mastery`.
Step: click `{"desktop":"[data-testid=\"locked-mastery-see-included\"]","mobile":"[data-testid=\"locked-mastery-see-included\"]"}`.
Must then show `[data-testid="upgrade-modal"]` (the capture fails otherwise).
Prototype: `Practice.dc.html` (NOT PROTOTYPED. Visual reference only: Practice, plan = free (the canvas is not clicked; its modal copy is the same mastery_detail copy)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![mastery-free-modal desktop light](mastery-free-modal--desktop--light--built.png)<br>`/mastery`, 77 KB, horizontal overflow 0px | ![prototype light](proto--Practice--free--light.png), 117 KB |
| desktop | dark | ![mastery-free-modal desktop dark](mastery-free-modal--desktop--dark--built.png)<br>`/mastery`, 76 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--free--dark.png), 119 KB |
| mobile | light | ![mastery-free-modal mobile light](mastery-free-modal--mobile--light--built.png)<br>`/mastery`, 53 KB, horizontal overflow 0px | ![prototype light](proto--Practice--free--light.png)<br>desktop prototype (no phone layout), 117 KB |
| mobile | dark | ![mastery-free-modal mobile dark](mastery-free-modal--mobile--dark--built.png)<br>`/mastery`, 53 KB, horizontal overflow 0px | ![prototype dark](proto--Practice--free--dark.png)<br>desktop prototype (no phone layout), 119 KB |

## Click path (paid): Home's 'See every skill' lands on /mastery

Persona: `paid`. Route: `/dashboard`.
Step: click `{"desktop":"[data-testid=\"home-mastery\"] a[href=\"/mastery\"]","mobile":"[data-testid=\"home-mastery\"] a[href=\"/mastery\"]"}`.
Must then show `[data-testid="mastery-domain"]` (the capture fails otherwise).
Click path: must land on a path matching `^/mastery$` (the capture fails otherwise); the path it landed on is under each built shot.
Prototype: none. A click path: the screenshot is where the click landed (/mastery), proven by its pathname.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![click-home-see-every-skill desktop light](click-home-see-every-skill--desktop--light--built.png)<br>`/mastery`, 86 KB, horizontal overflow 0px | none |
| desktop | dark | ![click-home-see-every-skill desktop dark](click-home-see-every-skill--desktop--dark--built.png)<br>`/mastery`, 88 KB, horizontal overflow 0px | none |
| mobile | light | ![click-home-see-every-skill mobile light](click-home-see-every-skill--mobile--light--built.png)<br>`/mastery`, 50 KB, horizontal overflow 0px | none |
| mobile | dark | ![click-home-see-every-skill mobile dark](click-home-see-every-skill--mobile--dark--built.png)<br>`/mastery`, 51 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"bcff02fd-a9eb-47fe-a1bc-607a3c1cf478","openPracticeSessionId":"bdb905c0-0125-402a-9f01-0ffd14213ee6","openReviewSessionId":null,"diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":13},"paid":{"completedPracticeSessionId":"3d5843c1-43db-42d1-9af6-da26cc3cd609","openPracticeSessionId":"c4b1b525-9010-4199-bdae-e04072a2b603","openReviewSessionId":null,"diagnosticSessionId":"844e6893-4d93-4383-9d1b-53cf12c0d975","scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":53}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- External hosts blocked: `fonts.googleapis.com`
