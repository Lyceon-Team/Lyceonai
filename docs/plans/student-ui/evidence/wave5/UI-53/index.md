# UI-53 Practice and review runners (Focus shell): selected, correct, incorrect, light and dark, 1440 and 390

Generated 2026-10-08T02:42:51.104Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-53` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

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
| desktop | light | ![practice-selected desktop light](practice-selected--desktop--light--built.png)<br>`/practice/session/07ab6b0a-3dac-4cb1-8cec-3ff70d5c7196`, 32 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | ![prototype light](proto--Runner--noplan--light--selected.png), 33 KB |
| desktop | dark | ![practice-selected desktop dark](practice-selected--desktop--dark--built.png)<br>`/practice/session/174c9eb6-f7ca-4b62-be3a-7ad659297c52`, 33 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | ![prototype dark](proto--Runner--noplan--dark--selected.png), 33 KB |
| mobile | light | ![practice-selected mobile light](practice-selected--mobile--light--built.png)<br>`/practice/session/1b118d2c-1ec9-42cb-894e-247127e2bf72`, 25 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | ![prototype light](proto--Runner--noplan--light--selected.png)<br>desktop prototype (no phone layout), 33 KB |
| mobile | dark | ![practice-selected mobile dark](practice-selected--mobile--dark--built.png)<br>`/practice/session/1388f7d3-6aaa-495d-8fbc-16db43edb9d9`, 25 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | ![prototype dark](proto--Runner--noplan--dark--selected.png)<br>desktop prototype (no phone layout), 33 KB |

## Practice runner, answered right: 'Correct answer' on the pick, the 'Correct' panel with the explanation, Next question

Persona: `paid`. Route: `/practice/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["M"],"target_question_count":10}`.
Step: pick the correct choice (resolved from the served item's stored order in the harness database).
Step: click `{"desktop":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")","mobile":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")"}`.
Prototype: `Runner.dc.html` (the correct (second) choice, then Submit); clicked: `[role="radio"] >> nth=1`, `button:has-text("Submit")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-correct desktop light](practice-correct--desktop--light--built.png)<br>`/practice/session/07dd43d5-6f20-4fbc-af03-6107fb87ef46`, 38 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--correct.png), 41 KB |
| desktop | dark | ![practice-correct desktop dark](practice-correct--desktop--dark--built.png)<br>`/practice/session/93aae753-7aa2-4a3e-a055-e3636d8b8d53`, 38 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--correct.png), 42 KB |
| mobile | light | ![practice-correct mobile light](practice-correct--mobile--light--built.png)<br>`/practice/session/13ea9122-edae-41fa-bd16-29d89db7377e`, 30 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--correct.png)<br>desktop prototype (no phone layout), 41 KB |
| mobile | dark | ![practice-correct mobile dark](practice-correct--mobile--dark--built.png)<br>`/practice/session/ea0b3f4c-3d35-4157-af7d-7323c3cf3dce`, 30 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--correct.png)<br>desktop prototype (no phone layout), 42 KB |

## Practice runner, answered wrong: 'Your answer' and 'Correct answer' tags, 'Not quite', the explanation, the review-queue note

Persona: `paid`. Route: `/practice/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["M"],"target_question_count":10}`.
Step: pick the incorrect choice (resolved from the served item's stored order in the harness database).
Step: click `{"desktop":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")","mobile":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")"}`.
Prototype: `Runner.dc.html` (a wrong (first) choice, then Submit); clicked: `[role="radio"] >> nth=0`, `button:has-text("Submit")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-incorrect desktop light](practice-incorrect--desktop--light--built.png)<br>`/practice/session/b8e6a1a6-9570-4eae-a59f-166ad6853872`, 44 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--incorrect.png), 46 KB |
| desktop | dark | ![practice-incorrect desktop dark](practice-incorrect--desktop--dark--built.png)<br>`/practice/session/f3eab722-8399-4a58-8861-096cf2ba4724`, 45 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--incorrect.png), 48 KB |
| mobile | light | ![practice-incorrect mobile light](practice-incorrect--mobile--light--built.png)<br>`/practice/session/f967592f-3f2c-44ea-90aa-bdf4ec6eadfb`, 35 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--incorrect.png)<br>desktop prototype (no phone layout), 46 KB |
| mobile | dark | ![practice-incorrect mobile dark](practice-incorrect--mobile--dark--built.png)<br>`/practice/session/b996ed44-5ef5-4e69-b291-d6db8afe952d`, 36 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--incorrect.png)<br>desktop prototype (no phone layout), 48 KB |

## Review runner, a choice selected, before submitting (LISA beside the question at 1440)

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: pick the first choice (resolved from the served item's stored order in the harness database).
Must fit the viewport (F-69): document no taller than the viewport, window unscrolled, `[data-testid="focus-shell-header"]` wholly in view, nothing to scroll in `main#main` (the capture fails otherwise); the measurement is under each built shot.
Prototype: `Runner.dc.html` (the first choice clicked (the canvas draws the practice runner; there is no review canvas)); clicked: `[role="radio"] >> nth=0`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-selected desktop light](review-selected--desktop--light--built.png)<br>`/review/session/74ba04e6-e0b0-4010-9c01-4ae58d474a4f`, 117 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | ![prototype light](proto--Runner--noplan--light--selected.png), 33 KB |
| desktop | dark | ![review-selected desktop dark](review-selected--desktop--dark--built.png)<br>`/review/session/fe38d6cb-9721-4e31-87df-1f8185566cb1`, 120 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | ![prototype dark](proto--Runner--noplan--dark--selected.png), 33 KB |
| mobile | light | ![review-selected mobile light](review-selected--mobile--light--built.png)<br>`/review/session/62fb15b0-91a1-4d9e-b54f-3807894390be`, 71 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | ![prototype light](proto--Runner--noplan--light--selected.png)<br>desktop prototype (no phone layout), 33 KB |
| mobile | dark | ![review-selected mobile dark](review-selected--mobile--dark--built.png)<br>`/review/session/79478452-0a4a-44d2-8771-49e27084e8d1`, 76 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | ![prototype dark](proto--Runner--noplan--dark--selected.png)<br>desktop prototype (no phone layout), 33 KB |

## Review runner, answered right

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: pick the correct choice (resolved from the served item's stored order in the harness database).
Step: click `{"desktop":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")","mobile":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")"}`.
Prototype: `Runner.dc.html` (the correct (second) choice, then Submit); clicked: `[role="radio"] >> nth=1`, `button:has-text("Submit")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-correct desktop light](review-correct--desktop--light--built.png)<br>`/review/session/9f3b2d26-bb14-4cd1-bcff-38feb1e42b78`, 123 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--correct.png), 41 KB |
| desktop | dark | ![review-correct desktop dark](review-correct--desktop--dark--built.png)<br>`/review/session/cb82e823-e119-440d-8ebe-e4066208ad32`, 126 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--correct.png), 42 KB |
| mobile | light | ![review-correct mobile light](review-correct--mobile--light--built.png)<br>`/review/session/7992838e-3fd0-4097-92de-de590c86dc65`, 77 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--correct.png)<br>desktop prototype (no phone layout), 41 KB |
| mobile | dark | ![review-correct mobile dark](review-correct--mobile--dark--built.png)<br>`/review/session/df35e331-acda-40c2-b404-36dbb3bc2893`, 74 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--correct.png)<br>desktop prototype (no phone layout), 42 KB |

## Review runner, answered wrong (no review-queue note: the question is already in the queue)

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: pick the incorrect choice (resolved from the served item's stored order in the harness database).
Step: click `{"desktop":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")","mobile":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")"}`.
Prototype: `Runner.dc.html` (a wrong (first) choice, then Submit); clicked: `[role="radio"] >> nth=0`, `button:has-text("Submit")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-incorrect desktop light](review-incorrect--desktop--light--built.png)<br>`/review/session/f2d9ba0f-4f53-4b69-b316-8485c85d6598`, 126 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--incorrect.png), 46 KB |
| desktop | dark | ![review-incorrect desktop dark](review-incorrect--desktop--dark--built.png)<br>`/review/session/bd716fbc-28d6-4fa5-b9fd-b47343c273c6`, 128 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--incorrect.png), 48 KB |
| mobile | light | ![review-incorrect mobile light](review-incorrect--mobile--light--built.png)<br>`/review/session/2e52bd11-826a-4cf3-8e4b-1a9114aa2e82`, 78 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--incorrect.png)<br>desktop prototype (no phone layout), 46 KB |
| mobile | dark | ![review-incorrect mobile dark](review-incorrect--mobile--dark--built.png)<br>`/review/session/920a6a3e-af2b-41c1-ac13-5568fd1a519c`, 75 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--incorrect.png)<br>desktop prototype (no phone layout), 48 KB |

## Review runner, LISA panel in use (OQ-54 (a), ruling 2026-10-05: student tokens, follows the device theme): a first message typed and sent creates the item's conversation (real POST /api/tutor/conversations); the student's bubble and LISA's typing dots show in the panel, and Send reads 'Sending…' (QA 2026-10-07 item 5). The turn request is held in the browser, so no turn runs. On a phone the panel stacks under the question; typing into it scrolls it into view

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"practice-tutor-toggle\"]"}`.
Step: type `How should I start this one?` into `{"desktop":"[data-testid=\"scoped-tutor-panel\"] textarea[aria-label=\"Message\"]","mobile":"[data-testid=\"scoped-tutor-panel\"] textarea[aria-label=\"Message\"]"}`.
Step: click `{"desktop":"[data-testid=\"scoped-tutor-panel\"] button[aria-label=\"Send message\"]","mobile":"[data-testid=\"scoped-tutor-panel\"] button[aria-label=\"Send message\"]"}`.
Held: the browser's `POST /api/tutor/messages` is left unanswered through the screenshot, then aborted (it never reaches the server).
Must then show `[data-testid="scoped-tutor-panel"] button[aria-label="Send message"][data-pending="true"]` (the capture fails otherwise).
Must fit the viewport (F-69): document no taller than the viewport, window unscrolled, `[data-testid="focus-shell-header"]` wholly in view, nothing to scroll in `main#main` (the capture fails otherwise); the measurement is under each built shot.
Prototype: none. Not prototyped: Runner.dc.html does not draw LISA (OQ-54 (d), ruling W4-4 keeps LISA in the review runner). The panel reuses the UI-56 thread parts (Lisa.dc.html).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-lisa-typing desktop light](review-lisa-typing--desktop--light--built.png)<br>`/review/session/80dfce35-ba58-4c14-a065-2f709a5a4be6`, 109 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| desktop | dark | ![review-lisa-typing desktop dark](review-lisa-typing--desktop--dark--built.png)<br>`/review/session/3ce5c664-1e35-4fd3-ba61-17986064f793`, 113 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| mobile | light | ![review-lisa-typing mobile light](review-lisa-typing--mobile--light--built.png)<br>`/review/session/541ec137-8075-4aac-bd02-4f7142926f22`, 27 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |
| mobile | dark | ![review-lisa-typing mobile dark](review-lisa-typing--mobile--dark--built.png)<br>`/review/session/4b9dee26-20d7-4da0-86a9-0a76f2de1f3d`, 27 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |

## Review runner, the LISA composer focused (F-69, owner ruling 2026-10-05): the Focus shell's top bar stays in view and the document is the viewport's height (no blank band under the footer); on a phone the focus scrolls the panel into view inside the shell, never the window

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"practice-tutor-toggle\"]"}`.
Step: focus `{"desktop":"[data-testid=\"scoped-tutor-panel\"] textarea[aria-label=\"Message\"]","mobile":"[data-testid=\"scoped-tutor-panel\"] textarea[aria-label=\"Message\"]"}` (no typing).
Must fit the viewport (F-69): document no taller than the viewport, window unscrolled, `[data-testid="focus-shell-header"]` wholly in view, nothing to scroll in `main#main` (the capture fails otherwise); the measurement is under each built shot.
Prototype: none. Not prototyped: Runner.dc.html does not draw LISA (OQ-54 (d)). F-69's proof shot: the shell's top bar with the composer focused.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-lisa-focused desktop light](review-lisa-focused--desktop--light--built.png)<br>`/review/session/f9c67427-ee7e-4ce8-a262-b2f30ff1cab7`, 117 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| desktop | dark | ![review-lisa-focused desktop dark](review-lisa-focused--desktop--dark--built.png)<br>`/review/session/b8e6ca9d-39a2-4874-94b1-8365d58dbb46`, 120 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| mobile | light | ![review-lisa-focused mobile light](review-lisa-focused--mobile--light--built.png)<br>`/review/session/31fa8bb3-62c8-4ea2-a2ec-af4e5c7282cf`, 33 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |
| mobile | dark | ![review-lisa-focused mobile dark](review-lisa-focused--mobile--dark--built.png)<br>`/review/session/c09d7c14-a11c-4144-9f23-623320e4417f`, 33 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |

## QA 2026-10-07 item 8 and QA2-D (2026-10-08): at 1440 LISA hidden with the bar's toggle, then shown again beside the question (nothing scrolls). On a phone LISA starts closed, and one tap on the bar's LISA icon opens it scrolled into view inside the shell, its header at the top of the runner's scroll area

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: click `{"desktop":"[data-testid=\"practice-tutor-toggle\"]","mobile":null}`.
Step: click `{"desktop":"[data-testid=\"practice-tutor-toggle\"]","mobile":"[data-testid=\"practice-tutor-toggle\"]"}`.
Must then show `[data-testid="scoped-tutor-panel"]` (the capture fails otherwise).
Must then have `[data-testid="scoped-tutor-panel"]` in view: its top edge inside the viewport (the capture fails otherwise).
Must fit the viewport (F-69): document no taller than the viewport, window unscrolled, `[data-testid="focus-shell-header"]` wholly in view, nothing to scroll in `main#main` (the capture fails otherwise); the measurement is under each built shot.
Prototype: none. Not prototyped: Runner.dc.html does not draw LISA (OQ-54 (d)). QA item 8's proof shot: Show LISA on a phone brings the panel into view.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-lisa-show desktop light](review-lisa-show--desktop--light--built.png)<br>`/review/session/732c5ccf-c333-48ef-a9a2-21dac527f72c`, 117 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| desktop | dark | ![review-lisa-show desktop dark](review-lisa-show--desktop--dark--built.png)<br>`/review/session/0a1ed1fe-af8f-49a3-9d1b-84f9bfc63ce5`, 119 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| mobile | light | ![review-lisa-show mobile light](review-lisa-show--mobile--light--built.png)<br>`/review/session/961c7ee4-7e42-4f30-96c0-dbf193f5ba53`, 32 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |
| mobile | dark | ![review-lisa-show mobile dark](review-lisa-show--mobile--dark--built.png)<br>`/review/session/1d40a3bf-17dd-41c0-8b72-3ea08ab4ddd7`, 32 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |

## QA2-D (Karl, 2026-10-08: "tapping the icon always brings it into view"): on a phone LISA opened, then the runner scrolled back up to the question (the first choice focused), then the LISA icon tapped again: the open panel is brought back into view, not closed. Desktop: LISA beside the question, untouched (control)

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"practice-tutor-toggle\"]"}`.
Step: focus `{"desktop":null,"mobile":"[data-testid=\"runner-choice\"]"}` (no typing).
Step: click `{"desktop":null,"mobile":"[data-testid=\"practice-tutor-toggle\"]"}`.
Must then show `[data-testid="scoped-tutor-panel"]` (the capture fails otherwise).
Must then have `[data-testid="scoped-tutor-panel"]` in view: its top edge inside the viewport (the capture fails otherwise).
Must fit the viewport (F-69): document no taller than the viewport, window unscrolled, `[data-testid="focus-shell-header"]` wholly in view, nothing to scroll in `main#main` (the capture fails otherwise); the measurement is under each built shot.
Prototype: none. Not prototyped: Runner.dc.html does not draw LISA (OQ-54 (d)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-lisa-phone-return desktop light](review-lisa-phone-return--desktop--light--built.png)<br>`/review/session/8bcb297f-6f8b-460d-a4cf-335fba6f826b`, 116 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| desktop | dark | ![review-lisa-phone-return desktop dark](review-lisa-phone-return--desktop--dark--built.png)<br>`/review/session/1abc3022-5589-4b9c-9041-e0be98895c34`, 119 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| mobile | light | ![review-lisa-phone-return mobile light](review-lisa-phone-return--mobile--light--built.png)<br>`/review/session/1ce98fb7-5015-404d-a692-c977914c0b52`, 32 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |
| mobile | dark | ![review-lisa-phone-return mobile dark](review-lisa-phone-return--mobile--dark--built.png)<br>`/review/session/4663db48-5b5d-46ad-9238-00e1db7d0cf7`, 32 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |

## Review runner, free student: the server refuses LISA's on-load lookup, so the panel shows the LISA card (approved copy: LISA's headline and the prototype body, OQ-44) with Unlock LISA in place of the composer. The app's upgrade modal opens on the refusal (UI-44) and is closed with Not now before the shot; a click on the panel's question chip scrolls the panel into view (on a phone it stacks under the question)

Persona: `free`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"practice-tutor-toggle\"]"}`.
Step: click `{"desktop":"[data-testid=\"upgrade-modal\"] button:has-text(\"Not now\")","mobile":"[data-testid=\"upgrade-modal\"] button:has-text(\"Not now\")"}`.
Step: click `{"desktop":"[data-testid=\"tutor-question-chip\"]","mobile":"[data-testid=\"tutor-question-chip\"]"}`.
Must then show `[data-testid="lisa-upgrade-unlock"]` (the capture fails otherwise).
Must then show no `[data-testid="upgrade-modal"]` (the capture fails otherwise).
Prototype: none. Not prototyped in the runner: the card is the Lisa.dc.html free card (plan = free) sized for the review runner's LISA panel.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-lisa-locked desktop light](review-lisa-locked--desktop--light--built.png)<br>`/review/session/6f7758e4-ace6-478e-a7de-1f82f5913f81`, 126 KB, horizontal overflow 0px | none |
| desktop | dark | ![review-lisa-locked desktop dark](review-lisa-locked--desktop--dark--built.png)<br>`/review/session/a791d516-3df7-457e-bea8-0a9ba096f906`, 131 KB, horizontal overflow 0px | none |
| mobile | light | ![review-lisa-locked mobile light](review-lisa-locked--mobile--light--built.png)<br>`/review/session/edc697ec-4b40-4e4e-954a-e186efa5a343`, 29 KB, horizontal overflow 0px | none |
| mobile | dark | ![review-lisa-locked mobile dark](review-lisa-locked--mobile--dark--built.png)<br>`/review/session/c0067b93-23e7-44a2-aecf-53286d223bb8`, 30 KB, horizontal overflow 0px | none |

## QA2-B (Karl, 2026-10-08: "Desmos: invertedColors when the app theme is dark"): the practice runner with the Graphing calculator open. Dark: Desmos draws inverted (dark) to match the page; light: Desmos's own light look. Desmos itself shows only in a run with STUDENT_HARNESS_DESMOS=1 (see Run facts)

Persona: `paid`. Route: `/practice/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["M"],"target_question_count":10}`.
Step: click `{"desktop":"[data-testid=\"practice-calculator-toggle\"]","mobile":"[data-testid=\"practice-calculator-toggle\"]"}`.
Must then show `[data-testid="desmos-calculator"]` (the capture fails otherwise).
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. Not prototyped: Runner.dc.html draws no calculator content; Desmos's own UI is Desmos's.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-calculator desktop light](practice-calculator--desktop--light--built.png)<br>`/practice/session/25f79148-2d71-45f4-86a3-2fd372549706`, 73 KB, horizontal overflow 0px | none |
| desktop | dark | ![practice-calculator desktop dark](practice-calculator--desktop--dark--built.png)<br>`/practice/session/37349df6-bd63-44f6-8f45-12c06e59f02f`, 67 KB, horizontal overflow 0px | none |
| mobile | light | ![practice-calculator mobile light](practice-calculator--mobile--light--built.png)<br>`/practice/session/24f904fa-2880-4ed9-90d5-d74bd99bae50`, 32 KB, horizontal overflow 0px | none |
| mobile | dark | ![practice-calculator mobile dark](practice-calculator--mobile--dark--built.png)<br>`/practice/session/40f9e01f-ee30-4fb7-ad9b-6e400f88f3c7`, 32 KB, horizontal overflow 0px | none |
| w1024 | light | ![practice-calculator w1024 light](practice-calculator--w1024--light--built.png)<br>`/practice/session/25c60dbd-ba47-4230-88d7-45c3dd1e898d`, 40 KB, horizontal overflow 0px | none |
| w1024 | dark | ![practice-calculator w1024 dark](practice-calculator--w1024--dark--built.png)<br>`/practice/session/cba0d04b-7053-47a3-abdf-8b77a1a92c0b`, 40 KB, horizontal overflow 0px | none |

## QA2-B: the same runner with the calculator switched to Scientific (our mode switch, then Desmos's scientific calculator, inverted in dark)

Persona: `paid`. Route: `/practice/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["M"],"target_question_count":10}`.
Step: click `{"desktop":"[data-testid=\"practice-calculator-toggle\"]","mobile":"[data-testid=\"practice-calculator-toggle\"]"}`.
Step: click `{"desktop":"[data-testid=\"desmos-mode-scientific\"]","mobile":"[data-testid=\"desmos-mode-scientific\"]"}`.
Must then show `[data-testid="desmos-mode-scientific"][aria-checked="true"]` (the capture fails otherwise).
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. Not prototyped: Runner.dc.html draws no calculator content; Desmos's own UI is Desmos's.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-calculator-scientific desktop light](practice-calculator-scientific--desktop--light--built.png)<br>`/practice/session/6905ccc9-bd1f-4f6b-be7c-1ca97998f369`, 60 KB, horizontal overflow 0px | none |
| desktop | dark | ![practice-calculator-scientific desktop dark](practice-calculator-scientific--desktop--dark--built.png)<br>`/practice/session/b6c530f3-ba80-4566-bad4-22606b9bbf3c`, 61 KB, horizontal overflow 0px | none |
| mobile | light | ![practice-calculator-scientific mobile light](practice-calculator-scientific--mobile--light--built.png)<br>`/practice/session/a30302b4-d241-4254-a52f-33a7e575bc4f`, 35 KB, horizontal overflow 0px | none |
| mobile | dark | ![practice-calculator-scientific mobile dark](practice-calculator-scientific--mobile--dark--built.png)<br>`/practice/session/1f404a5a-af10-43bb-b3a0-078373a407de`, 36 KB, horizontal overflow 0px | none |
| w1024 | light | ![practice-calculator-scientific w1024 light](practice-calculator-scientific--w1024--light--built.png)<br>`/practice/session/16094ddd-a440-43dc-87d6-0c3ff3b0ba98`, 40 KB, horizontal overflow 0px | none |
| w1024 | dark | ![practice-calculator-scientific w1024 dark](practice-calculator-scientific--w1024--dark--built.png)<br>`/practice/session/d7933b91-dffd-4b73-98d7-9f12a07fc9d8`, 42 KB, horizontal overflow 0px | none |

## QA2-D (Karl, 2026-10-08: "Phone: the LISA panel defaults closed"): the review runner on load. At 390 (LISA stacks under the question) the panel is closed and the bar's LISA icon offers it; at 1024 and 1440 LISA is beside the question, open, as before

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. Not prototyped: Runner.dc.html does not draw LISA (OQ-54 (d)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-lisa-phone-default desktop light](review-lisa-phone-default--desktop--light--built.png)<br>`/review/session/771d1687-b342-4dbd-821d-dcb3d1d21433`, 116 KB, horizontal overflow 0px | none |
| desktop | dark | ![review-lisa-phone-default desktop dark](review-lisa-phone-default--desktop--dark--built.png)<br>`/review/session/22a3c4e8-d182-40c2-a304-d57494e2170c`, 119 KB, horizontal overflow 0px | none |
| mobile | light | ![review-lisa-phone-default mobile light](review-lisa-phone-default--mobile--light--built.png)<br>`/review/session/c9780e09-bb4a-44af-8698-4bd453c79214`, 72 KB, horizontal overflow 0px | none |
| mobile | dark | ![review-lisa-phone-default mobile dark](review-lisa-phone-default--mobile--dark--built.png)<br>`/review/session/78882c95-b29e-40d8-8f3d-8140098f7d93`, 76 KB, horizontal overflow 0px | none |
| w1024 | light | ![review-lisa-phone-default w1024 light](review-lisa-phone-default--w1024--light--built.png)<br>`/review/session/b4b12833-3580-4626-b61f-3ebd8073de7f`, 108 KB, horizontal overflow 0px | none |
| w1024 | dark | ![review-lisa-phone-default w1024 dark](review-lisa-phone-default--w1024--dark--built.png)<br>`/review/session/c0822aab-7974-49cc-b9a0-f62d6d15e300`, 111 KB, horizontal overflow 0px | none |

## Practice runner, a session shorter than asked for: OQ-35's sentence, no number

Persona: `paid`. Route: `/practice/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["M"],"domains":["Geometry and Trigonometry"],"target_question_count":30}`.
Prototype: none. Not prototyped: OQ-35's ruled sentence (owner ruling 2026-10-02), shown on the first question of a shortened session.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-shortened desktop light](practice-shortened--desktop--light--built.png)<br>`/practice/session/3fd030b3-adc8-4747-a5a6-77784f5d35ae`, 42 KB, horizontal overflow 0px | none |
| desktop | dark | ![practice-shortened desktop dark](practice-shortened--desktop--dark--built.png)<br>`/practice/session/4d7c4246-b6bf-41d6-8f7e-b2bb337adcb6`, 43 KB, horizontal overflow 0px | none |
| mobile | light | ![practice-shortened mobile light](practice-shortened--mobile--light--built.png)<br>`/practice/session/57533525-c594-4174-8b81-8f4dfa578907`, 31 KB, horizontal overflow 0px | none |
| mobile | dark | ![practice-shortened mobile dark](practice-shortened--mobile--dark--built.png)<br>`/practice/session/84f23490-bd0d-42a0-ad12-976373f3e550`, 32 KB, horizontal overflow 0px | none |

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
| desktop | light | ![click-practice-next desktop light](click-practice-next--desktop--light--built.png)<br>`/practice/session/0b778e98-76a5-4928-ad70-bf4559f80ab9`, 33 KB, horizontal overflow 0px | none |
| desktop | dark | ![click-practice-next desktop dark](click-practice-next--desktop--dark--built.png)<br>`/practice/session/ded02ac1-9cd5-4bff-9b82-bfd095c5f921`, 33 KB, horizontal overflow 0px | none |
| mobile | light | ![click-practice-next mobile light](click-practice-next--mobile--light--built.png)<br>`/practice/session/02324976-0f7a-4fc1-a047-f8e93808f396`, 31 KB, horizontal overflow 0px | none |
| mobile | dark | ![click-practice-next mobile dark](click-practice-next--mobile--dark--built.png)<br>`/practice/session/96f7f51d-8b52-4429-8337-194e49fd3f44`, 25 KB, horizontal overflow 0px | none |

## QA item 5: Skip pressed, the skip held in flight: 'Skipping…' with a spinner, Skip and Submit disabled

Persona: `paid`. Route: `/practice/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["M"],"target_question_count":10}`.
Step: click `{"desktop":"[data-testid=\"runner-skip\"]","mobile":"[data-testid=\"runner-skip\"]"}`.
Held: the browser's `POST /api/practice/sessions/*/skip` is left unanswered through the screenshot, then aborted (it never reaches the server).
Must then show `[data-testid="runner-skip"][aria-busy="true"]` (the capture fails otherwise).
Prototype: none. A pending state the prototype does not draw (owner QA list, 2026-10-07, item 5).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-skip-pending desktop light](practice-skip-pending--desktop--light--built.png)<br>`/practice/session/0a861691-e6e9-433a-8f74-c30805395508`, 34 KB, horizontal overflow 0px | none |
| desktop | dark | ![practice-skip-pending desktop dark](practice-skip-pending--desktop--dark--built.png)<br>`/practice/session/209dc65b-de4e-45fd-ab5e-8d8c398f964b`, 34 KB, horizontal overflow 0px | none |
| mobile | light | ![practice-skip-pending mobile light](practice-skip-pending--mobile--light--built.png)<br>`/practice/session/192316f4-fe01-49f1-be7f-bf341a3deb64`, 26 KB, horizontal overflow 0px | none |
| mobile | dark | ![practice-skip-pending mobile dark](practice-skip-pending--mobile--dark--built.png)<br>`/practice/session/2266e787-dcdb-4edf-aef8-26bde9748966`, 26 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"292a6d29-65de-4dac-b173-732c5d346b51","openPracticeSessionId":"5fcac1e3-6767-45fa-a654-1611f5b2e95d","openReviewSessionId":null,"diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":13},"paid":{"completedPracticeSessionId":"aa35c865-fef6-459e-9136-3858383dc9bb","openPracticeSessionId":"9be2e23e-9883-4033-ac99-f38d064adaf7","openReviewSessionId":null,"diagnosticSessionId":"d64d84e9-48db-4e89-9dc0-a806fcf52d4f","scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":53}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- Desmos (QA2-B, opt-in `STUDENT_HARNESS_DESMOS=1`): the real calculator script, fetched once from `www.desmos.com` and answered from a local cache
- External hosts blocked: none
