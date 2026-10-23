# LISA chat dock, follow-ups: the practice runner before and after submit (the dock only after), Send as the outline icon, the calculator clear of the bubble; light and dark, 1440, 1062, 1024 and 390

Generated 2026-10-23T05:35:30.450Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts LISA-DOCK-2` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844, and any extra size a shot names.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## Practice runner (paid), before submitting: no bubble (owner ruling 2 on #1300: the dock comes only after submit)

Persona: `paid`. Route: `/practice/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["RW"],"target_question_count":5}`.
Step: pick the first choice (resolved from the served item's stored order in the harness database).
Must then show no `[data-testid="chat-dock-bubble"]` (the capture fails otherwise).
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. No prototype draws the chat dock: it is the owner brief of 2026-10-22 ("LISA chat dock", floating bubble, no bar); DESIGN.md §3 and §4 describe it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-before-submit desktop light](practice-before-submit--desktop--light--built.png)<br>`/practice/session/89d81683-74ab-499e-ade3-85164941f493`, 93 KB, horizontal overflow 0px | none |
| desktop | dark | ![practice-before-submit desktop dark](practice-before-submit--desktop--dark--built.png)<br>`/practice/session/ab8ac414-ee7a-4caf-ae39-76c43bd93548`, 95 KB, horizontal overflow 0px | none |
| mobile | light | ![practice-before-submit mobile light](practice-before-submit--mobile--light--built.png)<br>`/practice/session/c1093197-3424-4e55-bfe0-d1b24a11d7f4`, 74 KB, horizontal overflow 0px | none |
| mobile | dark | ![practice-before-submit mobile dark](practice-before-submit--mobile--dark--built.png)<br>`/practice/session/b508cf10-92d3-4a3f-ab34-26ebc486e95e`, 77 KB, horizontal overflow 0px | none |
| w1024 | light | ![practice-before-submit w1024 light](practice-before-submit--w1024--light--built.png)<br>`/practice/session/5ffeca87-9f9b-4ca0-be87-645115385aec`, 100 KB, horizontal overflow 0px | none |
| w1024 | dark | ![practice-before-submit w1024 dark](practice-before-submit--w1024--dark--built.png)<br>`/practice/session/1b40c8a4-b83e-49a8-8135-2051644955ba`, 92 KB, horizontal overflow 0px | none |

## Practice runner (paid), after submitting: the bubble appears above the footer; opened, the dock is scoped to the answered question, with Send as the outline paper-plane icon button (rulings 2 and 4 on #1300). Phone: unchanged, no LISA in practice

Persona: `paid`. Route: `/practice/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `practice {"sections":["RW"],"target_question_count":5}`.
Step: pick the first choice (resolved from the served item's stored order in the harness database).
Step: click `{"desktop":"[data-testid=\"runner-submit\"]","mobile":"[data-testid=\"runner-submit\"]"}`.
Step: click `{"desktop":"[data-testid=\"chat-dock-bubble\"]","mobile":null}`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Prototype: none. No prototype draws the chat dock: it is the owner brief of 2026-10-22 ("LISA chat dock", floating bubble, no bar); DESIGN.md §3 and §4 describe it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![practice-after-submit-open desktop light](practice-after-submit-open--desktop--light--built.png)<br>`/practice/session/04aad454-01fd-47d4-85a4-e58bdb3b9614`, 134 KB, horizontal overflow 0px | none |
| desktop | dark | ![practice-after-submit-open desktop dark](practice-after-submit-open--desktop--dark--built.png)<br>`/practice/session/e37c7af7-4d2f-4ac1-a516-ce8d3dea5db4`, 138 KB, horizontal overflow 0px | none |
| mobile | light | ![practice-after-submit-open mobile light](practice-after-submit-open--mobile--light--built.png)<br>`/practice/session/2a99782b-f75f-4e00-b018-3d53fc1d22ac`, 52 KB, horizontal overflow 0px | none |
| mobile | dark | ![practice-after-submit-open mobile dark](practice-after-submit-open--mobile--dark--built.png)<br>`/practice/session/56d24c59-5a57-4b8e-8fa9-8b935345eb6f`, 50 KB, horizontal overflow 0px | none |
| w1024 | light | ![practice-after-submit-open w1024 light](practice-after-submit-open--w1024--light--built.png)<br>`/practice/session/205e1f60-c76c-4c89-a809-58786309af86`, 103 KB, horizontal overflow 0px | none |
| w1024 | dark | ![practice-after-submit-open w1024 dark](practice-after-submit-open--w1024--dark--built.png)<br>`/practice/session/e614a4a0-7aff-4aa9-8d76-0d8b95c5360b`, 99 KB, horizontal overflow 0px | none |

## Math review runner with the calculator open (ruling 5 on #1300): beside the question (1062, 1440) Desmos keeps the bubble's footprint clear at its bottom; stacked (1024) the column already clears it

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["M"]},"target_count":10}`.
Step: click `{"desktop":"[data-testid=\"practice-calculator-toggle\"]","mobile":"[data-testid=\"practice-calculator-toggle\"]"}`.
Also shot at w1024 1024x768 (the desktop steps and selectors).
Also shot at w1062 1062x800 (the desktop steps and selectors).
Prototype: none. No prototype draws the chat dock: it is the owner brief of 2026-10-22 ("LISA chat dock", floating bubble, no bar); DESIGN.md §3 and §4 describe it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![runner-calculator desktop light](runner-calculator--desktop--light--built.png)<br>`/review/session/f176f655-ad05-4c0e-83ad-74687264dd92`, 47 KB, horizontal overflow 0px | none |
| desktop | dark | ![runner-calculator desktop dark](runner-calculator--desktop--dark--built.png)<br>`/review/session/9d89c6e7-8cd7-4470-908c-24ec4c875d4b`, 47 KB, horizontal overflow 0px | none |
| mobile | light | ![runner-calculator mobile light](runner-calculator--mobile--light--built.png)<br>`/review/session/8950a64a-3f1f-425b-8c57-072047438bec`, 38 KB, horizontal overflow 0px | none |
| mobile | dark | ![runner-calculator mobile dark](runner-calculator--mobile--dark--built.png)<br>`/review/session/1c0f5133-c396-4755-a162-6cc7f7aabf0b`, 38 KB, horizontal overflow 0px | none |
| w1024 | light | ![runner-calculator w1024 light](runner-calculator--w1024--light--built.png)<br>`/review/session/f60794fb-330b-4e99-b592-f1080120d5d5`, 44 KB, horizontal overflow 0px | none |
| w1024 | dark | ![runner-calculator w1024 dark](runner-calculator--w1024--dark--built.png)<br>`/review/session/4643c9ef-361c-4613-8f9e-9734324aca4b`, 45 KB, horizontal overflow 0px | none |
| w1062 | light | ![runner-calculator w1062 light](runner-calculator--w1062--light--built.png)<br>`/review/session/ed14f3cf-2fbd-4a30-8293-f63f4a14ce34`, 45 KB, horizontal overflow 0px | none |
| w1062 | dark | ![runner-calculator w1062 dark](runner-calculator--w1062--dark--built.png)<br>`/review/session/1018b168-a805-41be-abd9-7be17e1bc4d5`, 45 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"dc29e46e-04a3-4eb8-8d82-0df9200fc261","openPracticeSessionId":"fcf22a0b-960b-47cb-8027-1934b9a052a5","openReviewSessionId":"30cda17d-74e0-461b-9337-5ea523c8b4c9","diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":39},"paid":{"completedPracticeSessionId":"8d8f1609-48fe-443f-b6ca-7887af81aaf4","openPracticeSessionId":"f31eabef-aa7c-4855-9886-66919944bafd","openReviewSessionId":"0bcbc5e3-926b-44e5-868f-cb5ed7b02145","diagnosticSessionId":"8da58286-d978-4a59-9ee4-c33881883873","scoredExamSessionId":"f9feea6a-3178-4f3a-8228-ebda45f630ab","inProgressExamSessionId":"38ec7b79-c1aa-4f16-b9be-24583d1d1eda","lisaConversationId":"7082c8ff-b692-433e-8ef4-fdddc7f12843","answered":204}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- Desmos (QA2-B, opt-in `STUDENT_HARNESS_DESMOS=1`): not loaded (a local-only run; the calculator shows its unavailable line)
- External hosts blocked: none
