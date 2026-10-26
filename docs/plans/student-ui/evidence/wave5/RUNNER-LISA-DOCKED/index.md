# Runner with LISA docked as the right column: LISA alone, the calculator between the question and LISA (360px and 300px tiers), the below-W3 turn-taking, LISA minimized to the launcher; light and dark, 1440x900, 1366x650, 1280x650, 1277x650 and 390

Generated 2026-10-26T20:56:35.031Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts RUNNER-LISA-DOCKED` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844, and any extra size a shot names.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## Review runner (paid), on entry: LISA open as the docked right column, full height of the runner body, inset from the top-right corner. Phone: unchanged

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Also shot at w1366 1366x650 (the desktop steps and selectors).
Also shot at w1280 1280x650 (the desktop steps and selectors).
Prototype: none. The runner prototype (Runner.dc.html) has no LISA column; this is the pre-#1300 layout restored by the owner brief of 2026-10-26 ("restore the pre-#1300 runner layout"); DESIGN.md §4 Question runner describes it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![docked-alone desktop light](docked-alone--desktop--light--built.png)<br>`/review/session/620b1eed-be43-4369-acb6-7688e71c2a50`, 116 KB, horizontal overflow 0px | none |
| desktop | dark | ![docked-alone desktop dark](docked-alone--desktop--dark--built.png)<br>`/review/session/da71bdd3-5f19-4cb3-b396-1b85eedfee7a`, 119 KB, horizontal overflow 0px | none |
| mobile | light | ![docked-alone mobile light](docked-alone--mobile--light--built.png)<br>`/review/session/6f91c3f6-1937-4e95-bd2e-830f1b946311`, 72 KB, horizontal overflow 0px | none |
| mobile | dark | ![docked-alone mobile dark](docked-alone--mobile--dark--built.png)<br>`/review/session/612f5705-5785-482f-b2b3-c8497b8019ee`, 75 KB, horizontal overflow 0px | none |
| w1366 | light | ![docked-alone w1366 light](docked-alone--w1366--light--built.png)<br>`/review/session/1b78e44a-2680-4517-a9fb-87e3744207c6`, 103 KB, horizontal overflow 0px | none |
| w1366 | dark | ![docked-alone w1366 dark](docked-alone--w1366--dark--built.png)<br>`/review/session/2c130e73-568d-46c7-ac07-34e51b01858a`, 106 KB, horizontal overflow 0px | none |
| w1280 | light | ![docked-alone w1280 light](docked-alone--w1280--light--built.png)<br>`/review/session/9d8f2b65-8139-49d6-9a40-daef778b0ade`, 102 KB, horizontal overflow 0px | none |
| w1280 | dark | ![docked-alone w1280 dark](docked-alone--w1280--dark--built.png)<br>`/review/session/c40530c5-6f31-4230-8974-f18e361a6fb0`, 105 KB, horizontal overflow 0px | none |

## Math review runner (paid), the calculator opened: between the question and LISA, its right edge LISA's left edge; LISA 360px from 1338px, 300px from W3 (1278px) to 1337px, so 1280x650 keeps all three side by side (owner ruling on #1322, Karl, 2026-10-26)

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["M"]},"target_count":10}`.
Step: click `{"desktop":"[data-testid=\"practice-calculator-toggle\"]","mobile":"[data-testid=\"practice-calculator-toggle\"]"}`.
Also shot at w1366 1366x650 (the desktop steps and selectors).
Also shot at w1280 1280x650 (the desktop steps and selectors).
Prototype: none. The runner prototype (Runner.dc.html) has no LISA column; this is the pre-#1300 layout restored by the owner brief of 2026-10-26 ("restore the pre-#1300 runner layout"); DESIGN.md §4 Question runner describes it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![calculator-and-lisa desktop light](calculator-and-lisa--desktop--light--built.png)<br>`/review/session/78e6177c-b612-4ae2-83b0-c8355355abcb`, 71 KB, horizontal overflow 0px | none |
| desktop | dark | ![calculator-and-lisa desktop dark](calculator-and-lisa--desktop--dark--built.png)<br>`/review/session/cb556f4d-e1a1-4822-8473-7322e4e3a212`, 71 KB, horizontal overflow 0px | none |
| mobile | light | ![calculator-and-lisa mobile light](calculator-and-lisa--mobile--light--built.png)<br>`/review/session/8a0ebf75-dffe-48cf-9d06-8b07ae31d70d`, 38 KB, horizontal overflow 0px | none |
| mobile | dark | ![calculator-and-lisa mobile dark](calculator-and-lisa--mobile--dark--built.png)<br>`/review/session/8324e7c9-3d12-4205-9e6c-a471a3b8f075`, 38 KB, horizontal overflow 0px | none |
| w1366 | light | ![calculator-and-lisa w1366 light](calculator-and-lisa--w1366--light--built.png)<br>`/review/session/53b85ddc-049c-47e6-a6ac-3ec7a235c4af`, 69 KB, horizontal overflow 0px | none |
| w1366 | dark | ![calculator-and-lisa w1366 dark](calculator-and-lisa--w1366--dark--built.png)<br>`/review/session/a833edfe-8822-4cf6-a64b-45dd29643d66`, 69 KB, horizontal overflow 0px | none |
| w1280 | light | ![calculator-and-lisa w1280 light](calculator-and-lisa--w1280--light--built.png)<br>`/review/session/df33f571-179f-4576-a545-d462e124ae07`, 69 KB, horizontal overflow 0px | none |
| w1280 | dark | ![calculator-and-lisa w1280 dark](calculator-and-lisa--w1280--dark--built.png)<br>`/review/session/c591a244-45c3-45d6-ac5b-c2dfe04e3d5f`, 68 KB, horizontal overflow 0px | none |

## Below W3 (1277x650): the calculator opened takes LISA's place; LISA shows as its launcher (the last tool opened wins). At 1440 and on the phone the same steps show the wide and phone layouts

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["M"]},"target_count":10}`.
Step: click `{"desktop":"[data-testid=\"practice-calculator-toggle\"]","mobile":"[data-testid=\"practice-calculator-toggle\"]"}`.
Also shot at w1277 1277x650 (the desktop steps and selectors).
Prototype: none. The runner prototype (Runner.dc.html) has no LISA column; this is the pre-#1300 layout restored by the owner brief of 2026-10-26 ("restore the pre-#1300 runner layout"); DESIGN.md §4 Question runner describes it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![below-w3-calculator desktop light](below-w3-calculator--desktop--light--built.png)<br>`/review/session/d63c302a-4701-4aeb-97c5-45df421c01fe`, 71 KB, horizontal overflow 0px | none |
| desktop | dark | ![below-w3-calculator desktop dark](below-w3-calculator--desktop--dark--built.png)<br>`/review/session/dcb17075-57fd-4d64-a8d4-926a4ee4d384`, 71 KB, horizontal overflow 0px | none |
| mobile | light | ![below-w3-calculator mobile light](below-w3-calculator--mobile--light--built.png)<br>`/review/session/fca28608-e938-40d5-83d4-b72a26c9a8f4`, 38 KB, horizontal overflow 0px | none |
| mobile | dark | ![below-w3-calculator mobile dark](below-w3-calculator--mobile--dark--built.png)<br>`/review/session/abe4f6d6-b606-4db7-ac84-52a12f7e5c10`, 38 KB, horizontal overflow 0px | none |
| w1277 | light | ![below-w3-calculator w1277 light](below-w3-calculator--w1277--light--built.png)<br>`/review/session/db8438dd-77de-431b-9b83-129399665a30`, 45 KB, horizontal overflow 0px | none |
| w1277 | dark | ![below-w3-calculator w1277 dark](below-w3-calculator--w1277--dark--built.png)<br>`/review/session/58ca5798-f8fc-4bd5-9c27-05ed20457e2b`, 45 KB, horizontal overflow 0px | none |

## Below W3 (1277x650): LISA reopened from its launcher; the calculator closes (its state kept) and LISA's column is back

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["M"]},"target_count":10}`.
Step: click `{"desktop":"[data-testid=\"practice-calculator-toggle\"]","mobile":"[data-testid=\"practice-calculator-toggle\"]"}`.
Step: click `{"desktop":"[data-testid=\"chat-dock-bubble\"]:visible, [data-testid=\"tutor-question-chip\"]:visible","mobile":null}`.
Also shot at w1277 1277x650 (the desktop steps and selectors).
Prototype: none. The runner prototype (Runner.dc.html) has no LISA column; this is the pre-#1300 layout restored by the owner brief of 2026-10-26 ("restore the pre-#1300 runner layout"); DESIGN.md §4 Question runner describes it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![below-w3-lisa desktop light](below-w3-lisa--desktop--light--built.png)<br>`/review/session/a06d1eed-d484-4f3e-93c7-8561cdc61c08`, 71 KB, horizontal overflow 0px | none |
| desktop | dark | ![below-w3-lisa desktop dark](below-w3-lisa--desktop--dark--built.png)<br>`/review/session/b8737e4c-065e-4957-b61a-1da2a3566fe7`, 71 KB, horizontal overflow 0px | none |
| mobile | light | ![below-w3-lisa mobile light](below-w3-lisa--mobile--light--built.png)<br>`/review/session/b30b6b2a-8c82-498b-b114-332c022c5f00`, 38 KB, horizontal overflow 0px | none |
| mobile | dark | ![below-w3-lisa mobile dark](below-w3-lisa--mobile--dark--built.png)<br>`/review/session/b23e84c8-7528-4c68-8105-4ac95c8854f9`, 38 KB, horizontal overflow 0px | none |
| w1277 | light | ![below-w3-lisa w1277 light](below-w3-lisa--w1277--light--built.png)<br>`/review/session/3b1943b4-40f6-4532-aae3-90304bbfea32`, 59 KB, horizontal overflow 0px | none |
| w1277 | dark | ![below-w3-lisa w1277 dark](below-w3-lisa--w1277--dark--built.png)<br>`/review/session/e16b7837-48ca-450f-8de3-0ab32f1e45ab`, 59 KB, horizontal overflow 0px | none |

## Review runner (paid), LISA minimized: the column goes, the question takes the width back, and LISA is the 'Ask LISA' launcher above the footer

Persona: `paid`. Route: `/review/session/{session}`.
Preset localStorage: `{"lyceon_client_instance_id":"student-harness-seed"}`.
Fresh session per capture (real create route, ended after the shot): `review {"mode":"filter","filters":{"sections":["RW"]},"target_count":10}`.
Step: click `{"desktop":"[data-testid=\"chat-dock-minimize\"]","mobile":null}`.
Also shot at w1366 1366x650 (the desktop steps and selectors).
Also shot at w1280 1280x650 (the desktop steps and selectors).
Prototype: none. The runner prototype (Runner.dc.html) has no LISA column; this is the pre-#1300 layout restored by the owner brief of 2026-10-26 ("restore the pre-#1300 runner layout"); DESIGN.md §4 Question runner describes it.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![minimized desktop light](minimized--desktop--light--built.png)<br>`/review/session/c16e53aa-20d7-4e48-98b4-d26b6e489bda`, 92 KB, horizontal overflow 0px | none |
| desktop | dark | ![minimized desktop dark](minimized--desktop--dark--built.png)<br>`/review/session/3dd2d765-6322-4dce-91c5-cfb931bdf439`, 95 KB, horizontal overflow 0px | none |
| mobile | light | ![minimized mobile light](minimized--mobile--light--built.png)<br>`/review/session/92d65d16-2cef-48e8-98fe-006d3d60bbbe`, 72 KB, horizontal overflow 0px | none |
| mobile | dark | ![minimized mobile dark](minimized--mobile--dark--built.png)<br>`/review/session/6d07ed8b-18a9-4cc6-9277-824726329fe7`, 77 KB, horizontal overflow 0px | none |
| w1366 | light | ![minimized w1366 light](minimized--w1366--light--built.png)<br>`/review/session/f5435218-f7bb-4c1d-90b7-c4b4c7e5d079`, 78 KB, horizontal overflow 0px | none |
| w1366 | dark | ![minimized w1366 dark](minimized--w1366--dark--built.png)<br>`/review/session/8aa0e22a-cdfe-4dfa-9a80-7a249b1e80a6`, 82 KB, horizontal overflow 0px | none |
| w1280 | light | ![minimized w1280 light](minimized--w1280--light--built.png)<br>`/review/session/0aafe12e-a82e-4cc0-b003-971ca388a200`, 78 KB, horizontal overflow 0px | none |
| w1280 | dark | ![minimized w1280 dark](minimized--w1280--dark--built.png)<br>`/review/session/bd6b1182-e5fc-4b3d-b1c9-4bc7f2c00c8f`, 81 KB, horizontal overflow 0px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"e044fafa-21ed-45c8-bf19-3d0241bfadc5","openPracticeSessionId":"b11ce42e-9362-422f-89c4-1648328e5f30","openReviewSessionId":"b0084bf2-6b0d-41a9-a537-80e6dd6e95ac","diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":39},"paid":{"completedPracticeSessionId":"fb09762a-0503-45ec-bee7-140939b0c985","openPracticeSessionId":"4f5c0132-4e09-4e64-bb04-a1615492d410","openReviewSessionId":"fa5baa87-8f12-439f-99fb-8c9b4311b648","diagnosticSessionId":"9a330c1b-4b3f-44b0-9633-8ef65b24b1c0","scoredExamSessionId":"41a44bb1-5f49-4976-91fe-131896509cde","inProgressExamSessionId":"dfec050f-93df-4909-9de8-d725a30e7a1d","lisaConversationId":"f260bb7e-0460-4175-98f3-6037afef9cee","answered":204}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): none
- Desmos (QA2-B, opt-in `STUDENT_HARNESS_DESMOS=1`): not loaded (a local-only run; the calculator shows its unavailable line)
- External hosts blocked: none
