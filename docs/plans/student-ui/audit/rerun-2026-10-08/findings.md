# UI-61 re-run: findings (`d8d8a3c1`)

Paths are relative to the repository root. This audit fixes nothing.

- **Student-UI findings** (F-n) carry a proposed fix.
- **Other verticals' findings** (H-n) are handoff lines.
- **Held items** are orphans that a register row or an open OQ already holds. They are not findings, but they bear on UI-61's proof.

## Student-UI findings

### F-1. `GET /api/progress/kpis` has no reader

| | |
|---|---|
| Where | Route: `server/index.ts:436-441` → `getRecencyKpis` (`server/routes/legacy/progress.ts:393`). Client: `client/src/hooks/useProgressKpis.ts:26-41`. The key is still invalidated at `client/src/features/exam/pages/ExamModulePage.tsx:319` and `client/src/hooks/useCanonicalPractice.ts:629`. The freshness entry is at `client/src/lib/query-freshness.ts:68` |
| Evidence | `useProgressKpis` (`useProgressKpis.ts:28`) has no production caller. `git grep -n useProgressKpis -- client/src` returns the definition and its test only. knip (`pnpm run deadcode:production`) reports `client/src/hooks/useProgressKpis.ts: PROGRESS_KPIS_QUERY_KEY, useProgressKpis`. `invalidateQueries` refetches only active queries, so no request is ever made. The file's header already says "no page reads it today" (`useProgressKpis.ts:12-13`). The reader went when UI-50 and UI-51 removed the KPI tiles |
| Held? | No. It is not in UI-06's held list (register row UI-06) and no OQ covers it. OQ-36 retires `/api/progress/projection` except `estimateStatus`; it says nothing about `/kpis` |
| Proposed owner | Student UI for the client half; `cleanup` for the route (H-2) |
| Proposed fix | Client: delete `useProgressKpis.ts` and its test, the two `invalidateProgressKpis` calls, and the `kpis` entry in `query-freshness.ts:63-68`. Server (H-2): retire the route and add it to `scripts/ci/retired-endpoints-gate.mjs`. Alternatively Karl holds the route for a future reader, and the hold is recorded in the register. Retirement also makes register F-17 ("`/api/progress/kpis` still sends `accuracy`") moot |

### F-2. `/score-report` draws its own `<main>` containers, off student tokens, inside the Focus shell

| | |
|---|---|
| Where | `client/src/pages/score-report.tsx:120` (`<main className="p-6">Loading…</main>`), `:128` (`<main className="mx-auto max-w-xl p-6">`), `:158` (`<main className="mx-auto max-w-xl space-y-8 p-6">`) and `:159` (its own `<header>`). Each renders inside the Focus shell's `<main>` (`client/src/components/layout/FocusShell.tsx:137`). Styling uses app tokens, e.g. `text-muted-foreground` (`:166`) and `text-xl font-semibold` (`:160`). The route keeps the light lock: `"/score-report": focus("Full-Length", "/tests")` (`client/src/lib/route-shells.ts:163`), whose default `themeLock` is `"light"` (`route-shells.ts:100-113`). The page is not in `scripts/ci/deadcode-student.scope.json` |
| Why it is a finding | 1. It is the only student page body that still lays out its own container. 2. A `<main>` nested in a `<main>` is not a hierarchically correct `main` element under the HTML standard, which leaves two main landmarks. 3. No register row rebuilds it: SCL-191 added the page, and it is not in Wave 5's list of themed routes (`route-shells.ts:41-51`) |
| Proposed owner | Student UI (a new row, or folded into a Wave 6 row) |
| Proposed fix | Rebuild the body on `lyc-*` tokens, as UI-54 did for the exam session and report pages: replace the three `<main>`s with `<div>`s, keep one page title, and set `"/score-report": focus("Full-Length", "/tests", false, null)` to lift the light lock. Add `client/src/pages/score-report.tsx` to the deadcode-student scope. Prove it with light and dark screenshots at 1440, 1024 and 390, and a page-level plant |

### F-3. The timed exam module nests a `<main>` inside the Focus shell's `<main>`

| | |
|---|---|
| Where | `client/src/features/exam/pages/ExamModulePage.tsx:595` (`<main className="flex min-h-0 flex-1">`), rendered inside `client/src/components/layout/FocusShell.tsx:137` |
| Context | The module's `ExamHeader` (`ExamModulePage.tsx:580`; `client/src/features/exam/components/ExamHeader.tsx:27`) and footer bar (`:693`) are the Bluebook layout that DESIGN.md §2 keeps ("The timed exam module keeps its Bluebook layout", `docs/plans/student-ui/design/DESIGN.md:57`). Only the second `main` landmark is the finding |
| Proposed owner | Student UI |
| Proposed fix | Change `ExamModulePage.tsx:595` from `<main>` to `<div>`. The layout classes are unchanged. Add a test that the module renders exactly one `main` landmark (`getAllByRole("main")` has length 1) and a plant that restores the `<main>` |

### F-4. Two client modules have no production importer

| | |
|---|---|
| Where | `client/src/lib/tutor-error-classifier.ts`, imported only by `client/src/lib/tutor-error-classifier.test.ts`. Its last production importer, `client/src/pages/tutor.tsx`, was deleted by `7343efd6` (UI-04). And `client/src/components/ui/tooltip.tsx`, which nothing imports (`grep -rlnE "components/ui/tooltip\|ui/tooltip\"" client scripts tests` → empty) |
| Evidence | knip `Unused files` lists both (`pnpm run deadcode:production`). `pnpm run deadcode:student` passes only because neither file is in its scope (`scripts/ci/deadcode-student.scope.json` includes no `lib/` or `components/ui/` path) |
| Proposed owner | Student UI (UI-06 deleted this vertical's earlier orphans, including 21 `components/ui` primitives) |
| Proposed fix | Delete both files and the classifier's test. `@radix-ui/react-tooltip` (`package.json:79`) then has no importer: its removal is a dependency change and needs Karl's approval, as UI-15 did |

## Held items (not findings)

| Item | Held by | Evidence |
|---|---|---|
| `/practice/topics` has no in-app path, and still draws its old body: "Back to Practice" (`client/src/pages/browse-topics.tsx:124-128`), `PageCard` (`:139` and others), shadcn `Card` (`:8`), `text-xs` (`:325`), light lock (`client/src/lib/route-shells.ts:127`) | **OQ-3** (open) | pass3 §2. `client/src/pages/practice.tsx:36`: "`/practice/topics` itself stays routed (OQ-3 is open)" |
| `GET /api/practice/reference/questions` (`server/index.ts:529`): its only caller is the OQ-3 page (`client/src/pages/browse-topics.tsx:88`) | **OQ-3**; register F-11 (it always returns an empty list) | pass3 §3 |
| `GET` and `PUT /api/profile/background`, `GET /api/reference/colleges`, `GET /api/reference/high-schools` (`server/routes/student-background-routes.ts:77,88,162,167`): no caller | **UI-S8** (open, "blocks the Settings Profile UI"); **OQ-37**; OQ-42 | `client/src/components/settings/ProfileSection.tsx:9,22` ("About you" hidden until UI-S8 closes) |
| `kpi/sections`, `kpi/domains`, `kpi/overall`, `projections/snapshots` (`server/routes/student-resources.ts:415,422,437,460`); `weakest-skills` (`server/routes/diagnostic-routes.ts:469`); `/healthz`, `/api/health` (`server/index.ts:239-240`); `/api/internal/async/*` (`server/routes/internal-memory-routes.ts:193,300`) | **UI-06** "Held, not deleted" | register row UI-06 |
| `PremiumUpgradePrompt`'s shadcn card shell on `/practice` at quota (`client/src/pages/practice.tsx:430`) | **UI-65** (open) | reconciliation report, Bucket 3 |

## Handoffs (other verticals)

- **H-1 (`cleanup`, admin):** three admin endpoints have no client caller.
  - `GET /api/admin/crisis-review/sla-breaches` (`server/routes/admin-crisis-review.ts:304`).
  - `GET /api/admin/db-health` (`server/index.ts:443`).
  - `GET /api/questions/stats` (`server/index.ts:472`), admin-only since UI-07; nothing in `client/src` calls it, and `client/src/pages/practice.test.tsx:825` asserts that `/practice` does not.

  Each is either kept for an operator or monitor, with the reason recorded, or deleted. The first two were also unreferenced in the original audit (rows 138, 139).
- **H-2 (`cleanup`):** if F-1 is resolved by retirement, delete the route (`server/index.ts:436-441`, `getRecencyKpis` at `server/routes/legacy/progress.ts:393`) and add `/api/progress/kpis` to `scripts/ci/retired-endpoints-gate.mjs`.
- **H-3 (`seo`):** `knip.json`'s entry list has no entry for `client/src/prerender/entry-server.tsx` (`package.json` `build:prerender`). So `pnpm run deadcode:production` reports `client/src/prerender/entry-server.tsx` and `client/src/prerender/qotd-archive-source.ts` as unused files, although both are live build inputs. `client/src/components/qotd/QotdSocialCard.tsx` is reported for the same reason; its importer is `scripts/qotd-social/generate.ts`. Adding the prerender entry removes two false positives from the repo-wide report.

## For Karl

1. **OQ-3:** retire or keep `/practice/topics`. UI-61 cannot close while the page is routed with no in-app path, unless the ruling is "keep it URL-only".
2. **UI-61's proof names only UI-06 holds.** Four unreferenced student endpoints are held by UI-S8 and OQ-37 instead: `/api/profile/background` GET and PUT, `/api/reference/colleges` and `/api/reference/high-schools`. Either accept UI-S8 as a hold for this proof, or reword the proof to "except those held in UI-06 or by an open row or OQ".
3. **F-1:** retire `GET /api/progress/kpis`, or hold it for a future reader. Each answer closes F-1. Without one, UI-61's second proof clause is false.
