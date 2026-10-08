# QA2-A The review cap on Home and Review: the refusal at the clicked button, with its two actions (1440, 1024, 390; light and dark)

Generated 2026-10-08T03:46:47.014Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts QA2-A` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844, and any extra size a shot names.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## Home, paid, at the review cap: 'Review this session' (the first recent session) pressed; the server refuses

Persona: `paid`. Route: `/dashboard`.
At the review-session cap before each capture: queue review sessions are opened through the real `POST /api/review/sessions` until the server itself refuses one with `SESSION_LIMIT_EXCEEDED`; the ones opened are ended through the real terminate route after the shot.
Must then show `[data-testid="review-cap"]` wholly inside the viewport (the capture fails otherwise).
Step: click `{"desktop":"[data-testid=\"home-recent-review\"]","mobile":"[data-testid=\"home-recent-review\"]"}`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. A refusal state the prototype does not draw (owner re-test, 2026-10-08, item A).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-cap-recent desktop light](home-cap-recent--desktop--light--built.png)<br>`/dashboard`, 150 KB, horizontal overflow 0px | none |
| desktop | dark | ![home-cap-recent desktop dark](home-cap-recent--desktop--dark--built.png)<br>`/dashboard`, 151 KB, horizontal overflow 0px | none |
| mobile | light | ![home-cap-recent mobile light](home-cap-recent--mobile--light--built.png)<br>`/dashboard`, 56 KB, horizontal overflow 0px | none |
| mobile | dark | ![home-cap-recent mobile dark](home-cap-recent--mobile--dark--built.png)<br>`/dashboard`, 57 KB, horizontal overflow 0px | none |
| w1024 | light | ![home-cap-recent w1024 light](home-cap-recent--w1024--light--built.png)<br>`/dashboard`, 116 KB, horizontal overflow 0px | none |
| w1024 | dark | ![home-cap-recent w1024 dark](home-cap-recent--w1024--dark--built.png)<br>`/dashboard`, 117 KB, horizontal overflow 0px | none |

## Review, paid, at the review cap: 'Start reviewing' pressed; the server refuses

Persona: `paid`. Route: `/review`.
At the review-session cap before each capture: queue review sessions are opened through the real `POST /api/review/sessions` until the server itself refuses one with `SESSION_LIMIT_EXCEEDED`; the ones opened are ended through the real terminate route after the shot.
Must then show `[data-testid="review-cap"]` wholly inside the viewport (the capture fails otherwise).
Step: click `{"desktop":"[data-testid=\"button-start-queue\"]","mobile":"[data-testid=\"button-start-queue\"]"}`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. A refusal state the prototype does not draw (owner re-test, 2026-10-08, item A).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-cap-start desktop light](review-cap-start--desktop--light--built.png)<br>`/review`, 136 KB, horizontal overflow 0px | none |
| desktop | dark | ![review-cap-start desktop dark](review-cap-start--desktop--dark--built.png)<br>`/review`, 137 KB, horizontal overflow 0px | none |
| mobile | light | ![review-cap-start mobile light](review-cap-start--mobile--light--built.png)<br>`/review`, 58 KB, horizontal overflow 0px | none |
| mobile | dark | ![review-cap-start mobile dark](review-cap-start--mobile--dark--built.png)<br>`/review`, 59 KB, horizontal overflow 0px | none |
| w1024 | light | ![review-cap-start w1024 light](review-cap-start--w1024--light--built.png)<br>`/review`, 107 KB, horizontal overflow 0px | none |
| w1024 | dark | ![review-cap-start w1024 dark](review-cap-start--w1024--dark--built.png)<br>`/review`, 109 KB, horizontal overflow 0px | none |

## Review, paid, at the review cap: 'Past sessions' opened and the first Redo pressed; the server refuses

Persona: `paid`. Route: `/review`.
At the review-session cap before each capture: queue review sessions are opened through the real `POST /api/review/sessions` until the server itself refuses one with `SESSION_LIMIT_EXCEEDED`; the ones opened are ended through the real terminate route after the shot.
Must then show `[data-testid="review-cap"]` wholly inside the viewport (the capture fails otherwise).
Step: click `{"desktop":"[data-testid=\"review-past-toggle\"]","mobile":"[data-testid=\"review-past-toggle\"]"}`.
Step: click `{"desktop":"[data-testid=\"review-past-redo\"]","mobile":"[data-testid=\"review-past-redo\"]"}`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. A refusal state the prototype does not draw (owner re-test, 2026-10-08, item A).

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![review-cap-redo desktop light](review-cap-redo--desktop--light--built.png)<br>`/review`, 143 KB, horizontal overflow 0px | none |
| desktop | dark | ![review-cap-redo desktop dark](review-cap-redo--desktop--dark--built.png)<br>`/review`, 145 KB, horizontal overflow 0px | none |
| mobile | light | ![review-cap-redo mobile light](review-cap-redo--mobile--light--built.png)<br>`/review`, 60 KB, horizontal overflow 0px | none |
| mobile | dark | ![review-cap-redo mobile dark](review-cap-redo--mobile--dark--built.png)<br>`/review`, 62 KB, horizontal overflow 0px | none |
| w1024 | light | ![review-cap-redo w1024 light](review-cap-redo--w1024--light--built.png)<br>`/review`, 111 KB, horizontal overflow 0px | none |
| w1024 | dark | ![review-cap-redo w1024 dark](review-cap-redo--w1024--dark--built.png)<br>`/review`, 112 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"04034662-0feb-4d5c-b434-335691ba6d79","openPracticeSessionId":"32dab5ab-901b-4854-8b7d-9e84f3d81086","openReviewSessionId":"952ceba3-57a9-4f2e-a7a6-0e0a8cc1c62b","diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":39},"paid":{"completedPracticeSessionId":"9e78d5d6-c4e8-48a8-b09a-433749279cc8","openPracticeSessionId":"9dcd3c8c-d858-4bed-a930-813e5b7f6ea1","openReviewSessionId":"ed2c7cfa-2a05-481d-88b2-bb0fc1ebb937","diagnosticSessionId":"93ba6f24-d6f0-4106-b9f3-40081bb55159","scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":79}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- Desmos (QA2-B, opt-in `STUDENT_HARNESS_DESMOS=1`): not loaded (a local-only run; the calculator shows its unavailable line)
- External hosts blocked: none
