# Student screenshot harness (Wave 5)

Side-by-side screenshots of a built student page and its signed-off prototype
(`docs/plans/student-ui/design/prototype/*.dc.html`), light and dark, desktop (1440x900) and
phone (390x844), for the Wave 5 page PRs (register §6 Wave 5, OQ-4).

## Run one page group

```bash
pnpm exec tsx tests/e2e/student-harness/capture.ts UI-41
```

Needs the local Postgres (`localhost:5432`, `postgres`/`postgres`; override with `PGHOST`,
`PGPORT`, `PGUSER`, `PGPASSWORD`) and a Chromium. If the Chromium that `@playwright/test` pins is
not installed, the script falls back to `/opt/pw-browsers/chromium`; `E2E_CHROMIUM=<path>` names
one explicitly. It never runs `playwright install`.

Two groups at once (parallel page PRs): give each run its own database and ports, e.g.
`STUDENT_HARNESS_DB=student_e2e_ui50 HARNESS_PORT=5066 STUDENT_HARNESS_VITE_PORT=5184`.

A shot may name `expectPath` (a pathname pattern): its `steps` are then a click path, and the
capture fails unless the page lands on a matching path (UI-50's "Start today's plan" and
"Start diagnostic").

Runner shots (UI-53) add three fields. `freshSession` starts a new practice or review session
through the real create route before every capture (`{session}` in the route is its id) and ends
it through the real terminate route afterwards, so every viewport and theme shows the same step.
A `{ pick: "correct" | "incorrect" | "first" }` step clicks a choice by what it is, resolved from
the served item's stored order and correct key in the harness database (the page never knows).
`expectText` makes the capture wait for a text after the steps ("Question 2 of 10"). A
prototype pairing's `state` names a clicked prototype state in its PNG file name.

Output: `docs/plans/student-ui/evidence/wave5/<group>/` — one PNG per built shot
(`<shot>--<desktop|mobile>--<light|dark>--built.png`), one per prototype state
(`proto--<Screen>--<plan>--<theme>[--clicked].png`), and `index.md` with a built | prototype
table per shot x viewport x theme. The directory is replaced on every run. Logs of the run's
server, Vite build and preview go to `test-results/student-harness/` (git-ignored).

The UI-41 run (32 rows) took 73 s end to end on the development container (2026-10-03):
migrations and seed, a production client build, then the shots. The stack is stopped on exit.

## What runs

- `server.ts` — the REAL routers the student pages read (profile, legal, practice, diagnostic,
  review, full-length, calendar, progress, notifications, billing, account, students, guardian),
  mounted as `server/index.ts` mounts them, over a throwaway database (`student_e2e_harness`)
  built from this repo's migrations. It reuses the exam harness's module hooks
  (`../exam-harness/hooks.mjs`), Postgres transport (`../exam-harness/pg.ts`), database
  (`../exam-harness/db.ts`) and auth stub, but keeps the PRODUCTION `EntitlementService`, so
  free/paid and the profile's feature-access map (the rail locks) come from real
  `entitlements` rows.
- `personas.ts` — `free` (Alex Moreno, no entitlement row) and `paid` (Sam Rivera, the exam
  harness's student: premium/active, finished calendar setup, linked guardian), both 13+ with a
  completed profile; `signed-out` sends no persona. The browser picks one with the
  `x-harness-as` header.
- `seed.ts` — after start-up, through the real routes only: the current Terms and Privacy Policy
  accepted (`POST /api/legal/reaccept`); the paid student's diagnostic answered (40); for each
  persona a 10-question Math session answered to the end and a Reading and Writing session
  answered 3/10 and left open. The ids are printed on the `student harness ready {...}` line and
  can be used in routes as `{free.openPracticeSessionId}` etc.
- `capture.ts` — starts the server, builds the client and serves it with `vite preview`
  (`STUDENT_HARNESS_CLIENT=dev` uses the dev server instead; the dev server's StrictMode double
  effects make the runner ask `/next` twice at once), drives Chromium, writes the PNGs and index.
  `STUDENT_HARNESS_BASE_URL` + `STUDENT_HARNESS_MANIFEST` (the ready-line JSON) reuse a stack you
  started yourself.
- `prototype-runtime.js` — a local stand-in for the canvas runtime (`support.js`) the prototypes
  load, which is not in the repo. It renders the grammar the ten prototypes use (`{{path}}`,
  `<sc-if>`, `<sc-for>`, `on*` handlers, `DCLogic` props/state) and throws on anything else.

## How state is driven

- **Built theme:** the app's own per-device setting, `localStorage["lyceon-theme"]` (read by the
  boot script in `client/index.html` and `client/src/lib/theme.ts`), plus the colour-scheme media
  feature. The index records what rendered (`html[data-theme]`, and `data-theme-lock` on the
  shell): a page still pinned light (OQ-49) is labelled "dark requested; page pinned light".
- **Prototype theme and plan:** the canvas props `theme` (`light`/`dark`, which adds `.dark` to the
  `.lyc` root) and `plan` (`paid`/`free`/`guardian-paid`) from each file's `data-props`, set
  through `window.__DC_PROPS__` before the page loads. Clicks (e.g. the locked LISA rail item,
  which opens the canvas's upgrade modal) are `steps` in the group file.
- **Prototype size:** the canvas is a fixed 1440x900 with no phone layout; phone rows show the
  desktop prototype and say so.
- **Network:** local only. Every request that is not localhost, `file:` or `data:` is aborted and
  listed in the index; the prototypes' Google Fonts stylesheet is answered with the app's own
  self-hosted Source Sans 3 / Source Serif 4 (`client/public/fonts/`), so both sides use the same
  faces. The built app's Google Fonts (Inter, Poppins, used by legacy page bodies) are blocked.

## Add a page group

Add `groups/<id>.ts` exporting a `PageGroup` (see `groups/types.ts`) and register it in
`groups/index.ts`. A shot names a persona, a route, the prototype screen (file, plan, optional
click steps) or `{ kind: "none", reason }`, and optionally `waitFor`, `steps` (per viewport:
the rail is a bottom tab bar below `lg`), `localStorage` and `sessionStorage` presets. Endpoints a
page asks for that the server does not mount are answered 404 and listed in the index under
"Run facts": mount the real router in `server.ts` rather than stubbing a payload.

## Not part of any test run

Nothing here matches Playwright's `testMatch` (`*.spec.ts` / `*.test.ts`) or vitest's `include`
(`**/*.test.{ts,tsx}`), and the CI e2e job names its spec files explicitly, so the harness runs
only when invoked by the command above. Like the exam harness, it refuses
`NODE_ENV=production`, and nothing under `server/` or `client/` imports it.
