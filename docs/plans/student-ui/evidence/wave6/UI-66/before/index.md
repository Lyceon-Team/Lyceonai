# W6 UI-66 Home and Practice, paid: recent-session rows named by their criteria (1440, 1024, 390; light and dark)

Generated 2026-10-08T04:22:25.649Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts W6-UI-66` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844, and any extra size a shot names.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## Home, paid: Recent sessions in the right panel

Persona: `paid`. Route: `/dashboard`.
Full page: the whole document, not just the viewport.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. Not compared with a prototype: a before/after pair for one row.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-paid-recent desktop light](home-paid-recent--desktop--light--built.png)<br>`/dashboard`, 148 KB, horizontal overflow 0px | none |
| desktop | dark | ![home-paid-recent desktop dark](home-paid-recent--desktop--dark--built.png)<br>`/dashboard`, 149 KB, horizontal overflow 0px | none |
| mobile | light | ![home-paid-recent mobile light](home-paid-recent--mobile--light--built.png)<br>`/dashboard`, 213 KB, horizontal overflow 0px | none |
| mobile | dark | ![home-paid-recent mobile dark](home-paid-recent--mobile--dark--built.png)<br>`/dashboard`, 217 KB, horizontal overflow 0px | none |
| w1024 | light | ![home-paid-recent w1024 light](home-paid-recent--w1024--light--built.png)<br>`/dashboard`, 118 KB, horizontal overflow 0px | none |
| w1024 | dark | ![home-paid-recent w1024 dark](home-paid-recent--w1024--dark--built.png)<br>`/dashboard`, 119 KB, horizontal overflow 0px | none |

## Practice, paid: Recent practice

Persona: `paid`. Route: `/practice`.
Full page: the whole document, not just the viewport.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. Not compared with a prototype: a before/after pair for one row.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-paid-recent desktop light](practice-paid-recent--desktop--light--built.png)<br>`/practice`, 130 KB, horizontal overflow 0px | none |
| desktop | dark | ![practice-paid-recent desktop dark](practice-paid-recent--desktop--dark--built.png)<br>`/practice`, 133 KB, horizontal overflow 0px | none |
| mobile | light | ![practice-paid-recent mobile light](practice-paid-recent--mobile--light--built.png)<br>`/practice`, 184 KB, horizontal overflow 0px | none |
| mobile | dark | ![practice-paid-recent mobile dark](practice-paid-recent--mobile--dark--built.png)<br>`/practice`, 187 KB, horizontal overflow 0px | none |
| w1024 | light | ![practice-paid-recent w1024 light](practice-paid-recent--w1024--light--built.png)<br>`/practice`, 97 KB, horizontal overflow 0px | none |
| w1024 | dark | ![practice-paid-recent w1024 dark](practice-paid-recent--w1024--dark--built.png)<br>`/practice`, 99 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"5b3429ca-8026-4312-825f-ddd7e04af8e7","openPracticeSessionId":"d24fdf74-a53f-4c5a-82aa-1202a23b36f1","openReviewSessionId":"05b794e9-641a-499b-b62d-3f9c4263d0bb","diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":39},"paid":{"completedPracticeSessionId":"4d6eb1e1-80b2-4dfe-bf2c-0f0b9aac2930","openPracticeSessionId":"f7384560-2a20-4bf5-9730-fcc098887989","openReviewSessionId":"f638e673-7981-4137-b1ae-bfc4b291dd1b","diagnosticSessionId":"cf4b4d49-13ff-4952-8a12-9d107e6efb27","scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":79}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- Desmos (QA2-B, opt-in `STUDENT_HARNESS_DESMOS=1`): not loaded (a local-only run; the calculator shows its unavailable line)
- External hosts blocked: none
