# UI-53 Practice and review runners (Focus shell): selected, correct, incorrect, light and dark, 1440 and 390

Generated 2026-10-07T09:44:51.804Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-53` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844, and any extra size a shot names.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## Practice runner, a choice selected (Submit enabled), before submitting

Persona: `paid`. Route: `/practice/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["M"],"target_question_count":10}`.
Step: pick the first choice (resolved from the served item's stored order in the harness database).
Must fit the viewport (F-69): document no taller than the viewport, window unscrolled, `[data-testid="focus-shell-header"]` wholly in view, nothing to scroll in `main#main` (the capture fails otherwise); the measurement is under each built shot.
Prototype: `Runner.dc.html` (the first choice clicked); clicked: `[role="radio"] >> nth=0`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-selected desktop light](practice-selected--desktop--light--built.png)<br>`/practice/session/e8e29800-2c2f-4903-b5c1-9fd068c34a39`, 33 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | ![prototype light](proto--Runner--noplan--light--selected.png), 33 KB |
| desktop | dark | ![practice-selected desktop dark](practice-selected--desktop--dark--built.png)<br>`/practice/session/e31e9235-bf0d-4214-8dfa-cb0db1de66fc`, 34 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | ![prototype dark](proto--Runner--noplan--dark--selected.png), 33 KB |
| mobile | light | ![practice-selected mobile light](practice-selected--mobile--light--built.png)<br>`/practice/session/75eae138-176d-4e55-b66c-fbf21e22a87c`, 26 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | ![prototype light](proto--Runner--noplan--light--selected.png)<br>desktop prototype (no phone layout), 33 KB |
| mobile | dark | ![practice-selected mobile dark](practice-selected--mobile--dark--built.png)<br>`/practice/session/00a47017-12a0-4db1-83ce-21026fc0aa02`, 26 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | ![prototype dark](proto--Runner--noplan--dark--selected.png)<br>desktop prototype (no phone layout), 33 KB |

## Practice runner, answered right: 'Correct answer' on the pick, the 'Correct' panel with the explanation, Next question

Persona: `paid`. Route: `/practice/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["M"],"target_question_count":10}`.
Step: pick the correct choice (resolved from the served item's stored order in the harness database).
Step: click `{"desktop":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")","mobile":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")"}`.
Prototype: `Runner.dc.html` (the correct (second) choice, then Submit); clicked: `[role="radio"] >> nth=1`, `button:has-text("Submit")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-correct desktop light](practice-correct--desktop--light--built.png)<br>`/practice/session/dd09f25a-3715-41e5-8022-9a6e42de7028`, 39 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--correct.png), 41 KB |
| desktop | dark | ![practice-correct desktop dark](practice-correct--desktop--dark--built.png)<br>`/practice/session/3122f53d-071c-48db-9765-2208c0bde875`, 39 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--correct.png), 42 KB |
| mobile | light | ![practice-correct mobile light](practice-correct--mobile--light--built.png)<br>`/practice/session/0b171cbc-489c-43ba-b904-6da138ecb853`, 32 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--correct.png)<br>desktop prototype (no phone layout), 41 KB |
| mobile | dark | ![practice-correct mobile dark](practice-correct--mobile--dark--built.png)<br>`/practice/session/69b9dec1-d56c-45b5-aac0-d2835a2d4d48`, 33 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--correct.png)<br>desktop prototype (no phone layout), 42 KB |

## Practice runner, answered wrong: 'Your answer' and 'Correct answer' tags, 'Not quite', the explanation, the review-queue note

Persona: `paid`. Route: `/practice/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["M"],"target_question_count":10}`.
Step: pick the incorrect choice (resolved from the served item's stored order in the harness database).
Step: click `{"desktop":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")","mobile":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")"}`.
Prototype: `Runner.dc.html` (a wrong (first) choice, then Submit); clicked: `[role="radio"] >> nth=0`, `button:has-text("Submit")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-incorrect desktop light](practice-incorrect--desktop--light--built.png)<br>`/practice/session/0182ca3f-8e75-4b98-8f3d-e8876222fc68`, 44 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--incorrect.png), 46 KB |
| desktop | dark | ![practice-incorrect desktop dark](practice-incorrect--desktop--dark--built.png)<br>`/practice/session/9dab1ad4-5ad7-4f14-816e-6dd40efe1d6e`, 44 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--incorrect.png), 48 KB |
| mobile | light | ![practice-incorrect mobile light](practice-incorrect--mobile--light--built.png)<br>`/practice/session/a7fa4adb-15ff-48e9-a15f-bb116cca6cb9`, 36 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--incorrect.png)<br>desktop prototype (no phone layout), 46 KB |
| mobile | dark | ![practice-incorrect mobile dark](practice-incorrect--mobile--dark--built.png)<br>`/practice/session/98bd8ccd-88a9-498f-ac69-50b063347024`, 38 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--incorrect.png)<br>desktop prototype (no phone layout), 48 KB |

## Review runner, a choice selected, before submitting (LISA beside the question at 1440)

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: pick the first choice (resolved from the served item's stored order in the harness database).
Must fit the viewport (F-69): document no taller than the viewport, window unscrolled, `[data-testid="focus-shell-header"]` wholly in view, nothing to scroll in `main#main` (the capture fails otherwise); the measurement is under each built shot.
Prototype: `Runner.dc.html` (the first choice clicked (the canvas draws the practice runner; there is no review canvas)); clicked: `[role="radio"] >> nth=0`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-selected desktop light](review-selected--desktop--light--built.png)<br>`/review/session/541e050a-95a4-49bf-acd5-a83addd18e02`, 117 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | ![prototype light](proto--Runner--noplan--light--selected.png), 33 KB |
| desktop | dark | ![review-selected desktop dark](review-selected--desktop--dark--built.png)<br>`/review/session/7b9fa685-3b44-4bf5-a5e4-a20aa5b1e63f`, 119 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | ![prototype dark](proto--Runner--noplan--dark--selected.png), 33 KB |
| mobile | light | ![review-selected mobile light](review-selected--mobile--light--built.png)<br>`/review/session/06ca9e46-b17b-4348-a5bf-fe183ce95e6a`, 74 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | ![prototype light](proto--Runner--noplan--light--selected.png)<br>desktop prototype (no phone layout), 33 KB |
| mobile | dark | ![review-selected mobile dark](review-selected--mobile--dark--built.png)<br>`/review/session/ec3776cc-3b10-40df-98b1-74dbac247180`, 74 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | ![prototype dark](proto--Runner--noplan--dark--selected.png)<br>desktop prototype (no phone layout), 33 KB |

## Review runner, answered right

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: pick the correct choice (resolved from the served item's stored order in the harness database).
Step: click `{"desktop":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")","mobile":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")"}`.
Prototype: `Runner.dc.html` (the correct (second) choice, then Submit); clicked: `[role="radio"] >> nth=1`, `button:has-text("Submit")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-correct desktop light](review-correct--desktop--light--built.png)<br>`/review/session/9244453e-c5ed-4145-8176-9b12a14ea4d5`, 123 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--correct.png), 41 KB |
| desktop | dark | ![review-correct desktop dark](review-correct--desktop--dark--built.png)<br>`/review/session/ea6607b4-2ef7-4564-b0a9-179bf80ce93b`, 126 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--correct.png), 42 KB |
| mobile | light | ![review-correct mobile light](review-correct--mobile--light--built.png)<br>`/review/session/3130469d-3fbc-44d9-adfe-30623ce8aae6`, 73 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--correct.png)<br>desktop prototype (no phone layout), 41 KB |
| mobile | dark | ![review-correct mobile dark](review-correct--mobile--dark--built.png)<br>`/review/session/83d4a664-5618-4d59-8da9-b53f13ac8ffc`, 76 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--correct.png)<br>desktop prototype (no phone layout), 42 KB |

## Review runner, answered wrong (no review-queue note: the question is already in the queue)

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: pick the incorrect choice (resolved from the served item's stored order in the harness database).
Step: click `{"desktop":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")","mobile":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")"}`.
Prototype: `Runner.dc.html` (a wrong (first) choice, then Submit); clicked: `[role="radio"] >> nth=0`, `button:has-text("Submit")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-incorrect desktop light](review-incorrect--desktop--light--built.png)<br>`/review/session/1bf4feb9-8f80-438a-9b9e-7adaa015c810`, 137 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--incorrect.png), 46 KB |
| desktop | dark | ![review-incorrect desktop dark](review-incorrect--desktop--dark--built.png)<br>`/review/session/a854ddf0-614e-419f-9acc-6dcceca7f015`, 140 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--incorrect.png), 48 KB |
| mobile | light | ![review-incorrect mobile light](review-incorrect--mobile--light--built.png)<br>`/review/session/2881e4c3-5752-42f6-83dd-159c61042e4a`, 73 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--incorrect.png)<br>desktop prototype (no phone layout), 46 KB |
| mobile | dark | ![review-incorrect mobile dark](review-incorrect--mobile--dark--built.png)<br>`/review/session/b4c7fb8e-b50b-4bb3-9c1a-eb3faad134f6`, 82 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--incorrect.png)<br>desktop prototype (no phone layout), 48 KB |

## Review runner, LISA panel in use (OQ-54 (a), ruling 2026-10-05: student tokens, follows the device theme): a first message typed and sent creates the item's conversation (real POST /api/tutor/conversations); the student's bubble and LISA's typing dots show in the panel, and Send reads 'Sending…' (QA 2026-10-07 item 5). The turn request is held in the browser, so no turn runs. On a phone the panel stacks under the question; typing into it scrolls it into view

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: type `How should I start this one?` into `{"desktop":"[data-testid=\"scoped-tutor-panel\"] textarea[aria-label=\"Message\"]","mobile":"[data-testid=\"scoped-tutor-panel\"] textarea[aria-label=\"Message\"]"}`.
Step: click `{"desktop":"[data-testid=\"scoped-tutor-panel\"] button[aria-label=\"Send message\"]","mobile":"[data-testid=\"scoped-tutor-panel\"] button[aria-label=\"Send message\"]"}`.
Held: the browser's `POST /api/tutor/messages` is left unanswered through the screenshot, then aborted (it never reaches the server).
Must then show `[data-testid="scoped-tutor-panel"] button[aria-label="Send message"][data-pending="true"]` (the capture fails otherwise).
Must fit the viewport (F-69): document no taller than the viewport, window unscrolled, `[data-testid="focus-shell-header"]` wholly in view, nothing to scroll in `main#main` (the capture fails otherwise); the measurement is under each built shot.
Prototype: none. Not prototyped: Runner.dc.html does not draw LISA (OQ-54 (d), ruling W4-4 keeps LISA in the review runner). The panel reuses the UI-56 thread parts (Lisa.dc.html).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-lisa-typing desktop light](review-lisa-typing--desktop--light--built.png)<br>`/review/session/e95f37e7-30e3-4868-acf2-5d6eba4617ee`, 108 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| desktop | dark | ![review-lisa-typing desktop dark](review-lisa-typing--desktop--dark--built.png)<br>`/review/session/9cff6491-5b66-493a-aec3-4ff08c25f5a7`, 110 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| mobile | light | ![review-lisa-typing mobile light](review-lisa-typing--mobile--light--built.png)<br>`/review/session/2b7f4255-1ddb-4c71-bce3-2083bfd99c9e`, 28 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |
| mobile | dark | ![review-lisa-typing mobile dark](review-lisa-typing--mobile--dark--built.png)<br>`/review/session/c5e5d1bd-ae71-4016-a71a-6df118d30d30`, 28 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |

## Review runner, the LISA composer focused (F-69, owner ruling 2026-10-05): the Focus shell's top bar stays in view and the document is the viewport's height (no blank band under the footer); on a phone the focus scrolls the panel into view inside the shell, never the window

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: focus `{"desktop":"[data-testid=\"scoped-tutor-panel\"] textarea[aria-label=\"Message\"]","mobile":"[data-testid=\"scoped-tutor-panel\"] textarea[aria-label=\"Message\"]"}` (no typing).
Must fit the viewport (F-69): document no taller than the viewport, window unscrolled, `[data-testid="focus-shell-header"]` wholly in view, nothing to scroll in `main#main` (the capture fails otherwise); the measurement is under each built shot.
Prototype: none. Not prototyped: Runner.dc.html does not draw LISA (OQ-54 (d)). F-69's proof shot: the shell's top bar with the composer focused.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-lisa-focused desktop light](review-lisa-focused--desktop--light--built.png)<br>`/review/session/bae68537-5b3a-4396-ac8d-3209f2f3031e`, 115 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| desktop | dark | ![review-lisa-focused desktop dark](review-lisa-focused--desktop--dark--built.png)<br>`/review/session/de94dc40-c64d-4c76-937e-7028c999b1ee`, 118 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| mobile | light | ![review-lisa-focused mobile light](review-lisa-focused--mobile--light--built.png)<br>`/review/session/d4bbe804-04ae-4b0e-8ae6-bc937b3b0b58`, 34 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |
| mobile | dark | ![review-lisa-focused mobile dark](review-lisa-focused--mobile--dark--built.png)<br>`/review/session/be278a9a-e59b-4bd4-8b26-9880f134f07c`, 34 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |

## QA 2026-10-07 item 8: LISA hidden with the bar's toggle, then opened again with Show LISA. On a phone (LISA stacks under the question) the panel opens scrolled into view inside the shell, its header at the top of the runner's scroll area; at 1440 it is beside the question and nothing scrolls

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: click `{"desktop":"[data-testid=\"practice-tutor-toggle\"]","mobile":"[data-testid=\"practice-tutor-toggle\"]"}`.
Step: click `{"desktop":"[data-testid=\"practice-tutor-toggle\"]","mobile":"[data-testid=\"practice-tutor-toggle\"]"}`.
Must then show `[data-testid="scoped-tutor-panel"]` (the capture fails otherwise).
Must fit the viewport (F-69): document no taller than the viewport, window unscrolled, `[data-testid="focus-shell-header"]` wholly in view, nothing to scroll in `main#main` (the capture fails otherwise); the measurement is under each built shot.
Prototype: none. Not prototyped: Runner.dc.html does not draw LISA (OQ-54 (d)). QA item 8's proof shot: Show LISA on a phone brings the panel into view.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-lisa-show desktop light](review-lisa-show--desktop--light--built.png)<br>`/review/session/31da5d70-ea71-4083-850f-8295219bdf69`, 114 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| desktop | dark | ![review-lisa-show desktop dark](review-lisa-show--desktop--dark--built.png)<br>`/review/session/02c80e49-e7cf-4d8d-804b-1438fa76c412`, 117 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| mobile | light | ![review-lisa-show mobile light](review-lisa-show--mobile--light--built.png)<br>`/review/session/5bdec328-f017-42c1-b8b4-633863bd8bad`, 34 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |
| mobile | dark | ![review-lisa-show mobile dark](review-lisa-show--mobile--dark--built.png)<br>`/review/session/47876d74-468c-43e7-acd4-8fc8636eeeb1`, 34 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |

## Review runner, free student: the server refuses LISA's on-load lookup, so the panel shows the LISA card (approved copy: LISA's headline and the prototype body, OQ-44) with Unlock LISA in place of the composer. The app's upgrade modal opens on the refusal (UI-44) and is closed with Not now before the shot; a click on the panel's question chip scrolls the panel into view (on a phone it stacks under the question)

Persona: `free`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: click `{"desktop":"[data-testid=\"upgrade-modal\"] button:has-text(\"Not now\")","mobile":"[data-testid=\"upgrade-modal\"] button:has-text(\"Not now\")"}`.
Step: click `{"desktop":"[data-testid=\"tutor-question-chip\"]","mobile":"[data-testid=\"tutor-question-chip\"]"}`.
Must then show `[data-testid="lisa-upgrade-unlock"]` (the capture fails otherwise).
Must then show no `[data-testid="upgrade-modal"]` (the capture fails otherwise).
Prototype: none. Not prototyped in the runner: the card is the Lisa.dc.html free card (plan = free) sized for the review runner's LISA panel.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-lisa-locked desktop light](review-lisa-locked--desktop--light--built.png)<br>`/review/session/110f3cc2-1bcb-40ef-b4ad-fe6fdd24069d`, 113 KB, horizontal overflow 0px | none |
| desktop | dark | ![review-lisa-locked desktop dark](review-lisa-locked--desktop--dark--built.png)<br>`/review/session/2284f840-dc3a-4413-852a-d791be71f9b5`, 118 KB, horizontal overflow 0px | none |
| mobile | light | ![review-lisa-locked mobile light](review-lisa-locked--mobile--light--built.png)<br>`/review/session/93945dab-f29a-49a1-a2ac-40108a65e0cc`, 49 KB, horizontal overflow 0px | none |
| mobile | dark | ![review-lisa-locked mobile dark](review-lisa-locked--mobile--dark--built.png)<br>`/review/session/f6a23210-7489-4607-bb1a-9293055d44ff`, 51 KB, horizontal overflow 0px | none |

## Practice runner, a session shorter than asked for: OQ-35's sentence, no number

Persona: `paid`. Route: `/practice/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["M"],"domains":["Geometry and Trigonometry"],"target_question_count":30}`.
Prototype: none. Not prototyped: OQ-35's ruled sentence (owner ruling 2026-10-02), shown on the first question of a shortened session.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-shortened desktop light](practice-shortened--desktop--light--built.png)<br>`/practice/session/e77163eb-cbfb-452d-870a-6f272d57fdc1`, 42 KB, horizontal overflow 0px | none |
| desktop | dark | ![practice-shortened desktop dark](practice-shortened--desktop--dark--built.png)<br>`/practice/session/c2b1043e-8589-4747-8fe9-c8538a8677c2`, 43 KB, horizontal overflow 0px | none |
| mobile | light | ![practice-shortened mobile light](practice-shortened--mobile--light--built.png)<br>`/practice/session/a185ee9b-4da2-4130-98fb-88955a643e23`, 32 KB, horizontal overflow 0px | none |
| mobile | dark | ![practice-shortened mobile dark](practice-shortened--mobile--dark--built.png)<br>`/practice/session/2328e86e-5dfb-4a21-b8bb-8f525f82a4cb`, 33 KB, horizontal overflow 0px | none |

## Click path (practice): choose, Submit, Next question lands on 'Question 2 of M'

Persona: `paid`. Route: `/practice/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["M"],"target_question_count":10}`.
Step: pick the first choice (resolved from the served item's stored order in the harness database).
Step: click `{"desktop":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")","mobile":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")"}`.
Step: click `{"desktop":"[data-testid=\"runner-footer\"] button:has-text(\"Next question\")","mobile":"[data-testid=\"runner-footer\"] button:has-text(\"Next question\")"}`.
Must then show the text `Question 2 of 10` (the capture fails otherwise).
Prototype: none. A click path: the screenshot is where Next landed, proven by the 'Question 2 of 10' text the capture waited for.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![click-practice-next desktop light](click-practice-next--desktop--light--built.png)<br>`/practice/session/a73327b3-573d-4e57-8cef-ce4e0ef7c71b`, 33 KB, horizontal overflow 0px | none |
| desktop | dark | ![click-practice-next desktop dark](click-practice-next--desktop--dark--built.png)<br>`/practice/session/ca1a006f-b744-467c-8294-84e78afca66d`, 39 KB, horizontal overflow 0px | none |
| mobile | light | ![click-practice-next mobile light](click-practice-next--mobile--light--built.png)<br>`/practice/session/bf2a7244-c960-47b3-9e01-83d50ecd3cc6`, 26 KB, horizontal overflow 0px | none |
| mobile | dark | ![click-practice-next mobile dark](click-practice-next--mobile--dark--built.png)<br>`/practice/session/ed5123b5-17ba-4320-af91-0fb40d320bc1`, 26 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"098514a3-7eaa-4b80-b568-0f7ccdf96543","openPracticeSessionId":"3ceb889f-30b8-4bb2-9604-58b20835cc11","openReviewSessionId":null,"diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":13},"paid":{"completedPracticeSessionId":"4b7b5e6d-87b2-4df9-a0a8-da5b6264e89f","openPracticeSessionId":"3f1722b5-e18c-4b33-a248-9c95b71e7dba","openReviewSessionId":null,"diagnosticSessionId":"a573c3b2-645a-4bec-a1ef-8b5db70e4543","scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":53}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- External hosts blocked: none
