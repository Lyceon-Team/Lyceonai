# UI-53 Practice and review runners (Focus shell): selected, correct, incorrect, light and dark, 1440 and 390

Generated 2026-10-23T05:39:27.593Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts UI-53` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

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
| desktop | light | ![practice-selected desktop light](practice-selected--desktop--light--built.png)<br>`/practice/session/ada2cbc1-ced0-4ed1-9803-2c265ed31825`, 37 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | ![prototype light](proto--Runner--noplan--light--selected.png), 33 KB |
| desktop | dark | ![practice-selected desktop dark](practice-selected--desktop--dark--built.png)<br>`/practice/session/62fac8fa-00fc-4512-8ca0-2aa7c868ec63`, 38 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | ![prototype dark](proto--Runner--noplan--dark--selected.png), 33 KB |
| mobile | light | ![practice-selected mobile light](practice-selected--mobile--light--built.png)<br>`/practice/session/ab008bf0-969c-4fb5-9a14-53bb7acdd278`, 29 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | ![prototype light](proto--Runner--noplan--light--selected.png)<br>desktop prototype (no phone layout), 33 KB |
| mobile | dark | ![practice-selected mobile dark](practice-selected--mobile--dark--built.png)<br>`/practice/session/0a83f1f3-8a0c-41c6-91ac-c6010e7d7e99`, 30 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | ![prototype dark](proto--Runner--noplan--dark--selected.png)<br>desktop prototype (no phone layout), 33 KB |

## Practice runner, answered right: 'Correct answer' on the pick, the 'Correct' panel with the explanation, Next question

Persona: `paid`. Route: `/practice/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["M"],"target_question_count":10}`.
Step: pick the correct choice (resolved from the served item's stored order in the harness database).
Step: click `{"desktop":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")","mobile":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")"}`.
Prototype: `Runner.dc.html` (the correct (second) choice, then Submit); clicked: `[role="radio"] >> nth=1`, `button:has-text("Submit")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-correct desktop light](practice-correct--desktop--light--built.png)<br>`/practice/session/8d8c009b-d780-418a-b360-cdc0d66a66f5`, 45 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--correct.png), 41 KB |
| desktop | dark | ![practice-correct desktop dark](practice-correct--desktop--dark--built.png)<br>`/practice/session/40ab4229-e43d-4052-8b51-80422c42dc44`, 45 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--correct.png), 42 KB |
| mobile | light | ![practice-correct mobile light](practice-correct--mobile--light--built.png)<br>`/practice/session/fc437917-43bd-42d9-8c7a-7b7e8f3b022b`, 33 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--correct.png)<br>desktop prototype (no phone layout), 41 KB |
| mobile | dark | ![practice-correct mobile dark](practice-correct--mobile--dark--built.png)<br>`/practice/session/d9a97326-3a8b-4121-bedf-389011ef2d62`, 36 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--correct.png)<br>desktop prototype (no phone layout), 42 KB |

## Practice runner, answered wrong: 'Your answer' and 'Correct answer' tags, 'Not quite', the explanation, the review-queue note

Persona: `paid`. Route: `/practice/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["M"],"target_question_count":10}`.
Step: pick the incorrect choice (resolved from the served item's stored order in the harness database).
Step: click `{"desktop":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")","mobile":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")"}`.
Prototype: `Runner.dc.html` (a wrong (first) choice, then Submit); clicked: `[role="radio"] >> nth=0`, `button:has-text("Submit")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-incorrect desktop light](practice-incorrect--desktop--light--built.png)<br>`/practice/session/461c97f8-dcc6-440c-b982-bb934c38c759`, 49 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--incorrect.png), 46 KB |
| desktop | dark | ![practice-incorrect desktop dark](practice-incorrect--desktop--dark--built.png)<br>`/practice/session/afd2f088-e89b-436f-9307-3e73cd00d039`, 49 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--incorrect.png), 48 KB |
| mobile | light | ![practice-incorrect mobile light](practice-incorrect--mobile--light--built.png)<br>`/practice/session/fe868522-3478-4bd0-9493-182eb8f5986a`, 35 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--incorrect.png)<br>desktop prototype (no phone layout), 46 KB |
| mobile | dark | ![practice-incorrect mobile dark](practice-incorrect--mobile--dark--built.png)<br>`/practice/session/f6c062cf-75d4-4512-af81-273506d41e4a`, 37 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--incorrect.png)<br>desktop prototype (no phone layout), 48 KB |

## Review runner, a choice selected, before submitting (from 768px LISA is the chat dock's bubble, bottom-right)

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: pick the first choice (resolved from the served item's stored order in the harness database).
Must fit the viewport (F-69): document no taller than the viewport, window unscrolled, `[data-testid="focus-shell-header"]` wholly in view, nothing to scroll in `main#main` (the capture fails otherwise); the measurement is under each built shot.
Prototype: `Runner.dc.html` (the first choice clicked (the canvas draws the practice runner; there is no review canvas)); clicked: `[role="radio"] >> nth=0`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-selected desktop light](review-selected--desktop--light--built.png)<br>`/review/session/62a5334e-f323-400f-8c4d-a8b635210357`, 91 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | ![prototype light](proto--Runner--noplan--light--selected.png), 33 KB |
| desktop | dark | ![review-selected desktop dark](review-selected--desktop--dark--built.png)<br>`/review/session/b6668d3d-a9f5-45e5-97bb-b73220f4b629`, 94 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | ![prototype dark](proto--Runner--noplan--dark--selected.png), 33 KB |
| mobile | light | ![review-selected mobile light](review-selected--mobile--light--built.png)<br>`/review/session/f7872883-be0a-4ece-b7ee-bdc01efddd3e`, 72 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | ![prototype light](proto--Runner--noplan--light--selected.png)<br>desktop prototype (no phone layout), 33 KB |
| mobile | dark | ![review-selected mobile dark](review-selected--mobile--dark--built.png)<br>`/review/session/6e200dc1-78a6-42f1-8149-c175711fb137`, 74 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | ![prototype dark](proto--Runner--noplan--dark--selected.png)<br>desktop prototype (no phone layout), 33 KB |

## Review runner, answered right

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: pick the correct choice (resolved from the served item's stored order in the harness database).
Step: click `{"desktop":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")","mobile":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")"}`.
Prototype: `Runner.dc.html` (the correct (second) choice, then Submit); clicked: `[role="radio"] >> nth=1`, `button:has-text("Submit")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-correct desktop light](review-correct--desktop--light--built.png)<br>`/review/session/2b3bfd4c-6a70-4514-9530-4999417ffa3a`, 98 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--correct.png), 41 KB |
| desktop | dark | ![review-correct desktop dark](review-correct--desktop--dark--built.png)<br>`/review/session/3a0b1bf7-9252-48ad-8e54-321cd03fba44`, 103 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--correct.png), 42 KB |
| mobile | light | ![review-correct mobile light](review-correct--mobile--light--built.png)<br>`/review/session/1a6f47f2-6015-410b-8cfc-e07f1bcd5d90`, 53 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--correct.png)<br>desktop prototype (no phone layout), 41 KB |
| mobile | dark | ![review-correct mobile dark](review-correct--mobile--dark--built.png)<br>`/review/session/c05385f3-feb5-4ea8-b1e2-0d36c55eac97`, 55 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--correct.png)<br>desktop prototype (no phone layout), 42 KB |

## Review runner, answered wrong (no review-queue note: the question is already in the queue)

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: pick the incorrect choice (resolved from the served item's stored order in the harness database).
Step: click `{"desktop":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")","mobile":"[data-testid=\"runner-footer\"] button:has-text(\"Submit\")"}`.
Prototype: `Runner.dc.html` (a wrong (first) choice, then Submit); clicked: `[role="radio"] >> nth=0`, `button:has-text("Submit")`.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-incorrect desktop light](review-incorrect--desktop--light--built.png)<br>`/review/session/624ef2c8-6ecd-41cc-befa-d5988da83aa4`, 102 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--incorrect.png), 46 KB |
| desktop | dark | ![review-incorrect desktop dark](review-incorrect--desktop--dark--built.png)<br>`/review/session/266f8e21-5a87-4f78-a789-b0924f94ed64`, 102 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--incorrect.png), 48 KB |
| mobile | light | ![review-incorrect mobile light](review-incorrect--mobile--light--built.png)<br>`/review/session/f4fcb0fa-6063-4d59-9f8e-e96011a736d4`, 52 KB, horizontal overflow 0px | ![prototype light](proto--Runner--noplan--light--incorrect.png)<br>desktop prototype (no phone layout), 46 KB |
| mobile | dark | ![review-incorrect mobile dark](review-incorrect--mobile--dark--built.png)<br>`/review/session/09a1dbe3-3c57-4187-8245-333e49ac4162`, 53 KB, horizontal overflow 0px | ![prototype dark](proto--Runner--noplan--dark--incorrect.png)<br>desktop prototype (no phone layout), 48 KB |

## Review runner, LISA in use (OQ-54 (a), ruling 2026-10-05: student tokens, follows the device theme): at 1024 and 1440 in the chat dock (#1300), on a phone in the panel under the question. A first message typed and sent creates the item's conversation (real POST /api/tutor/conversations); the student's bubble and LISA's typing dots show, and Send (the outline icon button, ruling 4 on #1300) is pending (QA 2026-10-07 item 5). The turn request is held in the browser, so no turn runs

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: click `{"desktop":"[data-testid=\"chat-dock-bubble\"]","mobile":"[data-testid=\"practice-tutor-toggle\"]"}`.
Step: type `How should I start this one?` into `{"desktop":"[data-testid=\"chat-dock-panel\"] textarea[aria-label=\"Message\"]","mobile":"[data-testid=\"scoped-tutor-panel\"] textarea[aria-label=\"Message\"]"}`.
Step: click `{"desktop":"[data-testid=\"chat-dock-panel\"] button[aria-label=\"Send\"]","mobile":"[data-testid=\"scoped-tutor-panel\"] button[aria-label=\"Send\"]"}`.
Held: the browser's `POST /api/tutor/messages` is left unanswered through the screenshot, then aborted (it never reaches the server).
Must then show `[data-testid="chat-dock-panel"] button[aria-label="Send"][data-pending="true"], [data-testid="scoped-tutor-panel"] button[aria-label="Send"][data-pending="true"]` (the capture fails otherwise).
Must fit the viewport (F-69): document no taller than the viewport, window unscrolled, `[data-testid="focus-shell-header"]` wholly in view, nothing to scroll in `main#main` (the capture fails otherwise); the measurement is under each built shot.
Prototype: none. Not prototyped: Runner.dc.html does not draw LISA (OQ-54 (d), ruling W4-4 keeps LISA in the review runner). The panel reuses the UI-56 thread parts (Lisa.dc.html).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-lisa-typing desktop light](review-lisa-typing--desktop--light--built.png)<br>`/review/session/99645167-8322-449d-bb30-642681e2a7d9`, 107 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| desktop | dark | ![review-lisa-typing desktop dark](review-lisa-typing--desktop--dark--built.png)<br>`/review/session/2b7eb811-2207-4bea-a235-3d86a82643cd`, 111 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| mobile | light | ![review-lisa-typing mobile light](review-lisa-typing--mobile--light--built.png)<br>`/review/session/e986653d-4c62-493c-96b7-fa202fcc4e0a`, 26 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |
| mobile | dark | ![review-lisa-typing mobile dark](review-lisa-typing--mobile--dark--built.png)<br>`/review/session/8645924f-c374-44d0-a700-49a9f23df38d`, 26 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |

## Review runner, the LISA composer focused (F-69, owner ruling 2026-10-05): the Focus shell's top bar stays in view and the document is the viewport's height (no blank band under the footer); at 1024 and 1440 the composer is the open chat dock's (#1300); on a phone the focus scrolls the panel into view inside the shell, never the window

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: click `{"desktop":"[data-testid=\"chat-dock-bubble\"]","mobile":"[data-testid=\"practice-tutor-toggle\"]"}`.
Step: focus `{"desktop":"[data-testid=\"chat-dock-panel\"] textarea[aria-label=\"Message\"]","mobile":"[data-testid=\"scoped-tutor-panel\"] textarea[aria-label=\"Message\"]"}` (no typing).
Must fit the viewport (F-69): document no taller than the viewport, window unscrolled, `[data-testid="focus-shell-header"]` wholly in view, nothing to scroll in `main#main` (the capture fails otherwise); the measurement is under each built shot.
Prototype: none. Not prototyped: Runner.dc.html does not draw LISA (OQ-54 (d)). F-69's proof shot: the shell's top bar with the composer focused.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-lisa-focused desktop light](review-lisa-focused--desktop--light--built.png)<br>`/review/session/2496093d-3d4d-4bc1-b7b4-7eca51c25e9e`, 116 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| desktop | dark | ![review-lisa-focused desktop dark](review-lisa-focused--desktop--dark--built.png)<br>`/review/session/286628ce-a0cb-4b07-9993-ad30aa920091`, 119 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| mobile | light | ![review-lisa-focused mobile light](review-lisa-focused--mobile--light--built.png)<br>`/review/session/37bb13f6-5b2f-4c32-98c7-346bcc06e54b`, 33 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |
| mobile | dark | ![review-lisa-focused mobile dark](review-lisa-focused--mobile--dark--built.png)<br>`/review/session/9169626b-9bff-423e-9680-3991a71d325b`, 33 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |

## QA 2026-10-07 item 8 and QA2-D (2026-10-08): at 1024 and 1440 the chat dock's bubble opens LISA (#1300; nothing scrolls). On a phone LISA starts closed, and one tap on the bar's LISA icon opens it scrolled into view inside the shell, its header at the top of the runner's scroll area

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: click `{"desktop":"[data-testid=\"chat-dock-bubble\"]","mobile":"[data-testid=\"practice-tutor-toggle\"]"}`.
Must then show `[data-testid="scoped-tutor-panel"], [data-testid="chat-dock-panel"]` (the capture fails otherwise).
Must then have `[data-testid="scoped-tutor-panel"], [data-testid="chat-dock-panel"]` in view: its top edge inside the viewport (the capture fails otherwise).
Must fit the viewport (F-69): document no taller than the viewport, window unscrolled, `[data-testid="focus-shell-header"]` wholly in view, nothing to scroll in `main#main` (the capture fails otherwise); the measurement is under each built shot.
Prototype: none. Not prototyped: Runner.dc.html does not draw LISA (OQ-54 (d)). QA item 8's proof shot: Show LISA on a phone brings the panel into view.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-lisa-show desktop light](review-lisa-show--desktop--light--built.png)<br>`/review/session/387e0a6e-4772-47a6-bd8f-db386b2f195f`, 115 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| desktop | dark | ![review-lisa-show desktop dark](review-lisa-show--desktop--dark--built.png)<br>`/review/session/ba800f94-7874-4f87-af88-58d016d527a0`, 119 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| mobile | light | ![review-lisa-show mobile light](review-lisa-show--mobile--light--built.png)<br>`/review/session/65f87b86-4204-4b99-86d2-c1a5140f9278`, 32 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |
| mobile | dark | ![review-lisa-show mobile dark](review-lisa-show--mobile--dark--built.png)<br>`/review/session/8f9e5214-0cb2-44f1-a177-c5b6e3a5a699`, 32 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |

## QA2-D (Karl, 2026-10-08: "tapping the icon always brings it into view"): on a phone LISA opened, then the runner scrolled back up to the question (the first choice focused), then the LISA icon tapped again: the open panel is brought back into view, not closed. Desktop: the chat dock bubble, untouched (control; #1300)

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"practice-tutor-toggle\"]"}`.
Step: focus `{"desktop":null,"mobile":"[data-testid=\"runner-choice\"]"}` (no typing).
Step: click `{"desktop":null,"mobile":"[data-testid=\"practice-tutor-toggle\"]"}`.
Must then show `[data-testid="scoped-tutor-panel"], [data-testid="chat-dock-panel"], [data-testid="chat-dock-bubble"]` (the capture fails otherwise).
Must then have `[data-testid="scoped-tutor-panel"], [data-testid="chat-dock-panel"], [data-testid="chat-dock-bubble"]` in view: its top edge inside the viewport (the capture fails otherwise).
Must fit the viewport (F-69): document no taller than the viewport, window unscrolled, `[data-testid="focus-shell-header"]` wholly in view, nothing to scroll in `main#main` (the capture fails otherwise); the measurement is under each built shot.
Prototype: none. Not prototyped: Runner.dc.html does not draw LISA (OQ-54 (d)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-lisa-phone-return desktop light](review-lisa-phone-return--desktop--light--built.png)<br>`/review/session/e023327b-e964-4959-9d8d-81d28e238d25`, 91 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| desktop | dark | ![review-lisa-phone-return desktop dark](review-lisa-phone-return--desktop--dark--built.png)<br>`/review/session/b3f6427f-a571-4a96-aead-f4fa7bb21420`, 95 KB, horizontal overflow 0px, document 900px in a 900px viewport, scrollY 0, top bar 0..73px, `main#main` 827px of content in 827px | none |
| mobile | light | ![review-lisa-phone-return mobile light](review-lisa-phone-return--mobile--light--built.png)<br>`/review/session/efdc8f1c-f8ef-4f8e-b40c-d2e8c9e7eaa8`, 32 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |
| mobile | dark | ![review-lisa-phone-return mobile dark](review-lisa-phone-return--mobile--dark--built.png)<br>`/review/session/6c7a4973-b972-4c7e-bb47-9d4ea0b26ced`, 32 KB, horizontal overflow 0px, document 844px in a 844px viewport, scrollY 0, top bar 0..73px, `main#main` 771px of content in 771px | none |

## Review runner, free student: the server refuses LISA's on-load lookup, so the panel shows the LISA card (approved copy: LISA's headline and the prototype body, OQ-44) with Unlock LISA in place of the composer. The app's upgrade modal opens on the refusal (UI-44) and is closed with Not now before the shot; a click on the panel's question chip scrolls the panel into view (on a phone it stacks under the question)

Persona: `free`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: click `{"desktop":"[data-testid=\"chat-dock-bubble\"]","mobile":"[data-testid=\"practice-tutor-toggle\"]"}`.
Step: click `{"desktop":"[data-testid=\"upgrade-modal\"] button:has-text(\"Not now\")","mobile":"[data-testid=\"upgrade-modal\"] button:has-text(\"Not now\")"}`.
Step: click `{"desktop":null,"mobile":"[data-testid=\"tutor-question-chip\"]"}`.
Must then show `[data-testid="lisa-upgrade-unlock"], [data-testid="chat-dock-lock"]` (the capture fails otherwise).
Must then show no `[data-testid="upgrade-modal"]` (the capture fails otherwise).
Prototype: none. Not prototyped in the runner: the card is the Lisa.dc.html free card (plan = free) sized for the review runner's LISA panel.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-lisa-locked desktop light](review-lisa-locked--desktop--light--built.png)<br>`/review/session/4d5a9bb5-c1dc-4ed0-b883-ac8438c745c3`, 107 KB, horizontal overflow 0px | none |
| desktop | dark | ![review-lisa-locked desktop dark](review-lisa-locked--desktop--dark--built.png)<br>`/review/session/3762c11d-5e28-4e72-a18e-2cabed2e8f50`, 112 KB, horizontal overflow 0px | none |
| mobile | light | ![review-lisa-locked mobile light](review-lisa-locked--mobile--light--built.png)<br>`/review/session/f8aa6dcc-bfe0-4a18-bab5-bd07ad058397`, 29 KB, horizontal overflow 0px | none |
| mobile | dark | ![review-lisa-locked mobile dark](review-lisa-locked--mobile--dark--built.png)<br>`/review/session/89c4508c-ec06-4ef8-9852-5e33ccfa5c35`, 30 KB, horizontal overflow 0px | none |

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
| desktop | light | ![practice-calculator desktop light](practice-calculator--desktop--light--built.png)<br>`/practice/session/ce018b14-2cc4-4bf9-9452-bba4a1914598`, 44 KB, horizontal overflow 0px | none |
| desktop | dark | ![practice-calculator desktop dark](practice-calculator--desktop--dark--built.png)<br>`/practice/session/5fce3173-3d20-41f3-bb67-ed24130139d3`, 48 KB, horizontal overflow 0px | none |
| mobile | light | ![practice-calculator mobile light](practice-calculator--mobile--light--built.png)<br>`/practice/session/fb02e6ea-f552-49b0-a175-51d00d3411eb`, 39 KB, horizontal overflow 0px | none |
| mobile | dark | ![practice-calculator mobile dark](practice-calculator--mobile--dark--built.png)<br>`/practice/session/532bb699-14de-4e84-8cd5-25438f0d966d`, 40 KB, horizontal overflow 0px | none |
| w1024 | light | ![practice-calculator w1024 light](practice-calculator--w1024--light--built.png)<br>`/practice/session/eacddbb8-1734-4e8f-87c7-356059a7e5cc`, 45 KB, horizontal overflow 0px | none |
| w1024 | dark | ![practice-calculator w1024 dark](practice-calculator--w1024--dark--built.png)<br>`/practice/session/48ecfca8-055d-4d2d-89a4-4b3cdb842276`, 44 KB, horizontal overflow 0px | none |

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
| desktop | light | ![practice-calculator-scientific desktop light](practice-calculator-scientific--desktop--light--built.png)<br>`/practice/session/ae1e63c1-7107-44f1-b91d-4197b53f623e`, 45 KB, horizontal overflow 0px | none |
| desktop | dark | ![practice-calculator-scientific desktop dark](practice-calculator-scientific--desktop--dark--built.png)<br>`/practice/session/7fd7b3b3-82a9-4316-85ba-6a3c59a7105a`, 47 KB, horizontal overflow 0px | none |
| mobile | light | ![practice-calculator-scientific mobile light](practice-calculator-scientific--mobile--light--built.png)<br>`/practice/session/37277997-ac3d-488d-899e-69f16219a797`, 39 KB, horizontal overflow 0px | none |
| mobile | dark | ![practice-calculator-scientific mobile dark](practice-calculator-scientific--mobile--dark--built.png)<br>`/practice/session/d294f4b6-17c2-44c1-8e5c-7750f1edaac5`, 40 KB, horizontal overflow 0px | none |
| w1024 | light | ![practice-calculator-scientific w1024 light](practice-calculator-scientific--w1024--light--built.png)<br>`/practice/session/9d1731c7-b59d-47af-b319-6d1076fbc876`, 43 KB, horizontal overflow 0px | none |
| w1024 | dark | ![practice-calculator-scientific w1024 dark](practice-calculator-scientific--w1024--dark--built.png)<br>`/practice/session/a5fc51eb-e2fd-49a5-b4ac-076d77ffd011`, 44 KB, horizontal overflow 0px | none |

## QA2-D (Karl, 2026-10-08: "Phone: the LISA panel defaults closed"): the review runner on load. At 390 (LISA stacks under the question) the panel is closed and the bar's LISA icon offers it; at 1024 and 1440 LISA is the chat dock's bubble, collapsed (#1300)

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. Not prototyped: Runner.dc.html does not draw LISA (OQ-54 (d)).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-lisa-phone-default desktop light](review-lisa-phone-default--desktop--light--built.png)<br>`/review/session/1ca351a9-86a3-4047-b783-6e0923ea6dc8`, 91 KB, horizontal overflow 0px | none |
| desktop | dark | ![review-lisa-phone-default desktop dark](review-lisa-phone-default--desktop--dark--built.png)<br>`/review/session/d9617b47-c7d5-43a6-b22c-28ba138570e0`, 94 KB, horizontal overflow 0px | none |
| mobile | light | ![review-lisa-phone-default mobile light](review-lisa-phone-default--mobile--light--built.png)<br>`/review/session/4acf030f-ddb1-4c94-914c-b60c4c9ccf47`, 72 KB, horizontal overflow 0px | none |
| mobile | dark | ![review-lisa-phone-default mobile dark](review-lisa-phone-default--mobile--dark--built.png)<br>`/review/session/a66b58ae-5e35-41df-a5a2-d4f4083d8b0f`, 75 KB, horizontal overflow 0px | none |
| w1024 | light | ![review-lisa-phone-default w1024 light](review-lisa-phone-default--w1024--light--built.png)<br>`/review/session/a810ad4d-4a7f-4e07-9fe7-114e11865101`, 88 KB, horizontal overflow 0px | none |
| w1024 | dark | ![review-lisa-phone-default w1024 dark](review-lisa-phone-default--w1024--dark--built.png)<br>`/review/session/5cda90db-f1c5-4136-97a9-c0d7cf558fba`, 91 KB, horizontal overflow 0px | none |

## Practice runner, a session shorter than asked for: OQ-35's sentence, no number

Persona: `paid`. Route: `/practice/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["M"],"domains":["Geometry and Trigonometry"],"target_question_count":30}`.
Prototype: none. Not prototyped: OQ-35's ruled sentence (owner ruling 2026-10-02), shown on the first question of a shortened session.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-shortened desktop light](practice-shortened--desktop--light--built.png)<br>`/practice/session/6f1324b2-e39e-462b-862a-591dfca90c38`, 47 KB, horizontal overflow 0px | none |
| desktop | dark | ![practice-shortened desktop dark](practice-shortened--desktop--dark--built.png)<br>`/practice/session/e4ee2191-ce7b-44ef-877d-eae2cb136901`, 47 KB, horizontal overflow 0px | none |
| mobile | light | ![practice-shortened mobile light](practice-shortened--mobile--light--built.png)<br>`/practice/session/71987a8e-c07a-48c5-a5b5-de8ca434d66e`, 36 KB, horizontal overflow 0px | none |
| mobile | dark | ![practice-shortened mobile dark](practice-shortened--mobile--dark--built.png)<br>`/practice/session/c9bf046b-6da8-4a22-9f09-1a619fd51c9b`, 37 KB, horizontal overflow 0px | none |

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
| desktop | light | ![click-practice-next desktop light](click-practice-next--desktop--light--built.png)<br>`/practice/session/599e29d7-d876-40d8-8558-b3d0f6eb4eb1`, 42 KB, horizontal overflow 0px | none |
| desktop | dark | ![click-practice-next desktop dark](click-practice-next--desktop--dark--built.png)<br>`/practice/session/b1d938af-14d7-4359-b69b-2f2eedbc638e`, 37 KB, horizontal overflow 0px | none |
| mobile | light | ![click-practice-next mobile light](click-practice-next--mobile--light--built.png)<br>`/practice/session/42fdedb3-cb2e-4c1e-837d-ce6c4986ccbc`, 32 KB, horizontal overflow 0px | none |
| mobile | dark | ![click-practice-next mobile dark](click-practice-next--mobile--dark--built.png)<br>`/practice/session/e7c59d54-fee5-4da3-8d32-6a083b451c91`, 32 KB, horizontal overflow 0px | none |

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
| desktop | light | ![practice-skip-pending desktop light](practice-skip-pending--desktop--light--built.png)<br>`/practice/session/47f702c0-a247-4154-8f98-ed449f957e43`, 37 KB, horizontal overflow 0px | none |
| desktop | dark | ![practice-skip-pending desktop dark](practice-skip-pending--desktop--dark--built.png)<br>`/practice/session/68db2b5f-ae32-465e-bd7d-22a9865e652e`, 40 KB, horizontal overflow 0px | none |
| mobile | light | ![practice-skip-pending mobile light](practice-skip-pending--mobile--light--built.png)<br>`/practice/session/f4628c90-720d-454f-8a1a-486b3adb08e5`, 31 KB, horizontal overflow 0px | none |
| mobile | dark | ![practice-skip-pending mobile dark](practice-skip-pending--mobile--dark--built.png)<br>`/practice/session/890d1dff-7b73-40d6-8f0b-b733cb04b070`, 31 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"b4a200cc-458f-4ba0-b37c-5b72692f0104","openPracticeSessionId":"7d5faaf2-6d97-4669-b544-bb3a5d986119","openReviewSessionId":null,"diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":13},"paid":{"completedPracticeSessionId":"6f2ffa1d-1abe-4613-8b84-bd63d322de2e","openPracticeSessionId":"d2e20193-4649-4038-89d8-b5a5f5b34296","openReviewSessionId":null,"diagnosticSessionId":"51c49159-3fbb-43f5-9896-82d59e3c95e4","scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":53}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- Desmos (QA2-B, opt-in `STUDENT_HARNESS_DESMOS=1`): not loaded (a local-only run; the calculator shows its unavailable line)
- External hosts blocked: none
