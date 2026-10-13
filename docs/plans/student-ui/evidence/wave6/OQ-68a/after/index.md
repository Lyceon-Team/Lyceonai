# OQ-68 (a) /practice/topics, paid: the retired topic browser and its redirect to Practice (1440, 1024, 390; light and dark)

Generated 2026-10-08T21:10:09.873Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts W6-OQ-68a` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844, and any extra size a shot names.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## /practice/topics, paid: before, the topic browser; after, Practice (history replace)

Persona: `paid`. Route: `/practice/topics`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Click path: must land on a path matching `^/practice(/topics)?$` (the capture fails otherwise); the path it landed on is under each built shot.
Prototype: none. Not compared with a prototype: a before/after pair for one ruling.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-topics-paid desktop light](practice-topics-paid--desktop--light--built.png)<br>`/practice`, 130 KB, horizontal overflow 0px | none |
| desktop | dark | ![practice-topics-paid desktop dark](practice-topics-paid--desktop--dark--built.png)<br>`/practice`, 132 KB, horizontal overflow 0px | none |
| mobile | light | ![practice-topics-paid mobile light](practice-topics-paid--mobile--light--built.png)<br>`/practice`, 49 KB, horizontal overflow 0px | none |
| mobile | dark | ![practice-topics-paid mobile dark](practice-topics-paid--mobile--dark--built.png)<br>`/practice`, 50 KB, horizontal overflow 0px | none |
| w1024 | light | ![practice-topics-paid w1024 light](practice-topics-paid--w1024--light--built.png)<br>`/practice`, 97 KB, horizontal overflow 0px | none |
| w1024 | dark | ![practice-topics-paid w1024 dark](practice-topics-paid--w1024--dark--built.png)<br>`/practice`, 99 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"30c27871-64df-46bd-9899-733c5edb2611","openPracticeSessionId":"e6839b95-7b59-4f35-9555-de516c64b49e","openReviewSessionId":null,"diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":13},"paid":{"completedPracticeSessionId":"921c574b-c4b1-46c2-bba0-f35a0d442769","openPracticeSessionId":"a639df9c-f56b-439f-a370-66c7767a03ad","openReviewSessionId":null,"diagnosticSessionId":"d4d2e750-4cc5-454d-bb70-401180438b4c","scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":53}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- Desmos (QA2-B, opt-in `STUDENT_HARNESS_DESMOS=1`): not loaded (a local-only run; the calculator shows its unavailable line)
- External hosts blocked: none
