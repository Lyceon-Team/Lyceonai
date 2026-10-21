# F-98 homepage hero (one primary button, two text links) and Part G legal pages in the student tokens; light and dark, 1440 and 390

Generated 2026-10-21T05:27:18.515Z by `pnpm exec tsx tests/e2e/student-harness/capture.ts HOMEPAGE-HERO` (see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness (real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.

Conditions, read before comparing:
- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844, and any extra size a shot names.
- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.
- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.
- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.
- Prototype data is illustrative; built data is the seeded personas' real payloads.

## Homepage hero: H1, one sentence, 'Start free diagnostic' (the one filled button), 'Sign in' and 'I'm a parent or guardian' as text links

Persona: `signed-out`. Route: `/`.
Must then show `[data-testid="hero-secondary-links"]` (the capture fails otherwise).
Prototype: none. SEO-owned public pages; no student prototype covers them.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![home-hero desktop light](home-hero--desktop--light--built.png)<br>`/`, 81 KB, horizontal overflow 0px | none |
| desktop | dark | ![home-hero desktop dark](home-hero--desktop--dark--built.png)<br>`/`, 81 KB, horizontal overflow 0px | none |
| mobile | light | ![home-hero mobile light](home-hero--mobile--light--built.png)<br>`/`, 58 KB, horizontal overflow 0px | none |
| mobile | dark | ![home-hero mobile dark](home-hero--mobile--dark--built.png)<br>`/`, 58 KB, horizontal overflow 0px | none |

## /legal in the student token set (dark follows the device)

Persona: `signed-out`. Route: `/legal`.
Prototype: none. SEO-owned public pages; no student prototype covers them.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![legal-hub desktop light](legal-hub--desktop--light--built.png)<br>`/legal`, 75 KB, horizontal overflow 0px | none |
| desktop | dark | ![legal-hub desktop dark](legal-hub--desktop--dark--built.png)<br>`/legal`, 76 KB, horizontal overflow 0px | none |
| mobile | light | ![legal-hub mobile light](legal-hub--mobile--light--built.png)<br>`/legal`, 48 KB, horizontal overflow 0px | none |
| mobile | dark | ![legal-hub mobile dark](legal-hub--mobile--dark--built.png)<br>`/legal`, 48 KB, horizontal overflow 0px | none |

## /legal/privacy-policy in the student token set; body text 16px, nothing below 14px

Persona: `signed-out`. Route: `/legal/privacy-policy`.
Prototype: none. SEO-owned public pages; no student prototype covers them.

| Viewport | Theme (as rendered) | Built | Prototype |
|---|---|---|---|
| desktop | light | ![legal-doc desktop light](legal-doc--desktop--light--built.png)<br>`/legal/privacy-policy`, 123 KB, horizontal overflow 0px | none |
| desktop | dark | ![legal-doc desktop dark](legal-doc--desktop--dark--built.png)<br>`/legal/privacy-policy`, 127 KB, horizontal overflow 0px | none |
| mobile | light | ![legal-doc mobile light](legal-doc--mobile--light--built.png)<br>`/legal/privacy-policy`, 59 KB, horizontal overflow 21px | none |
| mobile | dark | ![legal-doc mobile dark](legal-doc--mobile--dark--built.png)<br>`/legal/privacy-policy`, 62 KB, horizontal overflow 21px | none |

## Run facts

- Seeded ids: `{"free":{"completedPracticeSessionId":"9f765e35-5ac0-4aeb-a50a-041356f69594","openPracticeSessionId":"b1e81f1c-c136-477a-853f-ec1ec605dacc","openReviewSessionId":null,"diagnosticSessionId":null,"scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":13},"paid":{"completedPracticeSessionId":"ced739bb-c62f-4e09-9e3d-c93b6eb6d577","openPracticeSessionId":"ea7cdd24-0b72-49ea-bc3c-fd2f4475b4d5","openReviewSessionId":null,"diagnosticSessionId":"e15e1525-603b-48de-9837-8943f08769ff","scoredExamSessionId":null,"inProgressExamSessionId":null,"lisaConversationId":null,"answered":53}}`
- Endpoints the pages asked for that the harness does not serve (answered 404): `GET /public/pricing`
- Desmos (QA2-B, opt-in `STUDENT_HARNESS_DESMOS=1`): not loaded (a local-only run; the calculator shows its unavailable line)
- External hosts blocked: none
