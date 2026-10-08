# Student UI reachability audit: re-run (UI-61)

Register row **UI-61**: "Reachability audit re-run with the original brief". Proof: "Three shells on student surfaces; no unreferenced student endpoints except those held in UI-06."

Paths are relative to the repository root. `App.tsx` means `client/src/App.tsx`.

| File | Contents |
|---|---|
| [`pass1.md`](pass1.md) | Page inventory. Every route in `App.tsx`, with its shell, any chrome the page body draws itself, and the endpoints it calls. |
| [`pass2.md`](pass2.md) | API inventory. Every endpoint mounted in `server/`, with its guard and its `client/src` caller. |
| [`pass3.md`](pass3.md) | Reachability. The click path to every student page, the orphan pages, and the endpoints that have no client caller. |
| [`findings.md`](findings.md) | Every finding, with file:line and a proposed owner. |

## 1. Commit audited

`origin/claude/student-ui-wave6` @ **`d8d8a3c17670896618e746e27855fb3af276801a`**: "QA2-C follow-up: regenerate the guardian type floor for calendar.css's '> span' selector", 2026-10-08 03:49:10 +0000. This is the branch of the open re-test PR #1157.

I read it in a clean worktree on branch `claude/w6-reachability`, created from that head (`git status`: "nothing to commit, working tree clean"). The audit is a repo read. I changed no product code.

## 2. Method

**The original brief is not in the repo.** I recovered its structure from the audit it produced: `docs/plans/student-ui/audit/student-ui-surface-audit.md` at commit `c0155007`, audited on `origin/main` @ `d2902eec`, 2026-09-28. That audit used three passes:

| Pass | Original | This re-run |
|---|---|---|
| 1. Page inventory | §3, `pass1-A/B/C.md`: per route, the shell, components, states and endpoints | Every `App.tsx` route, with its shell from `client/src/lib/route-shells.ts`, any chrome its body draws, and its endpoints |
| 2. API inventory | §4, `pass2-A/B.md`: every mount and endpoint, with guard and client caller | Same, for every `app.*` and router handler in `server/` |
| 3. Reachability | §5: page click paths and endpoint references | Same, plus a check of every orphan against the UI-06 holds and the open OQs |

The original also had a consistency summary (§6). Its shell question is answered here by the re-run's §6.1 equivalent (pass1 §3). The design-consistency rows are out of this row's scope.

**Commands and aids.** Every command was run from the worktree root at `d8d8a3c1`. The outputs are pasted in the pass files.

| Aid | Command | Result |
|---|---|---|
| Route registry | `pnpm run route:validate` | `✅ All routes are properly documented! 75 routes in App.tsx, 75 rows in the registry, 75 ACTIVE routes in docs/route-registry.md` (exit 0) |
| Retired endpoints | `node scripts/ci/retired-endpoints-gate.mjs` | `OK: retired endpoints — 3543 file(s) scanned, no caller remains for 14 retired path(s)` (exit 0) |
| Shell test | `pnpm exec vitest run client/src/lib/route-shells.test.tsx` | `Test Files 1 passed (1)  Tests 61 passed (61)` |
| Client dead code (whole repo) | `pnpm run deadcode:production` | knip: `Unused files (31)`, `Unused exports (165)`, `Unused exported types (139)` (exit 1). Client rows are classified in pass3 §4. |
| Client dead code (student scope) | `pnpm run deadcode:student` | `DEADCODE:STUDENT: PASS — 0 unused files, exports, types or duplicate exports in the student-UI scope` |
| Server routes | a script that lists every `router.<method>(` and `app.<method>(` with its path and inline guards (pass2 §1) | 148 endpoints: 136 router handlers in 27 files (132 call sites; the `resource()` helper at `student-resources.ts:244` registers 5), plus 12 `app.<method>` handlers in `server/index.ts`. The `*` SPA fallback (`server/index.ts:622`) is not counted. |
| Client callers | `git grep` for each path and for each path constant (`CALENDAR_ROOT`, `EXAM_ROOT`, `TUTOR_API_BASE`, `NOTIFICATIONS_QUERY_ROOT`, `FEEDBACK_API`, `studentResourceUrl`, `student*Url`), excluding tests, fixtures and harnesses | pass2 §3 |

**A difference from the original.** The original extracted the tree with `git archive`. Here I read a clean worktree checked out at the same commit, which holds the same files.

## 3. Summary: the proof questions against the original audit

| Question | Original (`d2902eec`, 2026-09-28) | Re-run (`d8d8a3c1`, 2026-10-08) |
|---|---|---|
| Shell treatments on authenticated or account student surfaces | **7** (of 9 in scope): AppShell + Footer, AppShell without footer, PracticeShell, three exam local shells, calendar chrome, chat sidebar and header, no shell (original §6.1) | **3**: `app`, `focus` and `bare` (`route-shells.ts:36`). 23 student routes are keyed in `STUDENT_ROUTE_SHELLS` (`route-shells.ts:120-170`). Three more Bare surfaces render `BareCard` directly: the 404 (`App.tsx:142-147`), the error screen (`App.tsx:568-588`) and the pending-deletion screen (`App.tsx:610-616`). `route-shells.test.tsx`: 61/61 pass. |
| Student page bodies that still draw chrome of their own | Every page drew its own: a local header on chat, exam session, exam report and the module; the calendar rail; in-body back links on mastery and browse-topics; centered cards on 6 pages (original §3a) | **2 page bodies, plus 1 sanctioned layout.** `/practice/topics` still draws its old body: a "Back to Practice" link, `PageCard` and shadcn `Card` (`browse-topics.tsx:4,8,124-128,139`). This is held by OQ-3. `/score-report` draws three `<main>` containers inside the Focus shell's `<main>` (`score-report.tsx:120,128,158`): finding F-2. The timed module's `ExamHeader` and footer bar (`ExamModulePage.tsx:580,693`) are the Bluebook layout that DESIGN.md §2:57 keeps, but its nested `<main>` (`:595`) is finding F-3. |
| Student pages with no in-app path | **3**: `/tutor` (reached only from the public trust pages), `/update-password` and `/account/recover` (email only) (original §5a) | **1**: `/practice/topics`, which no link or button reaches. It is held by OQ-3. The other entries are reached only through server-sent links or guard redirects, as before (pass3 §2): `/update-password` and `/account/recover` (email), `/score-report` (notification and email `href`), and `/profile/complete` and `/guardian-required` (guard redirects). `/tutor` is now a redirect to `/chat` (`App.tsx:283`). |
| Mounted endpoints with no client caller (all roles) | **30** (original §5b: rows 4-6, 10, 13, 16, 18, 31-33, 39-40, 43-46, 48-50, 54, 99-100, 102-103, 128-129, 138-140, and apps/api healthz) | **17** (pass3 §3). Student-callable: 12. Admin: 3. Internal: 2. |
| Student-callable endpoints with no client caller | **23** of the 30 (the original did not count them separately; here they are recounted from its rows 5-6, 10, 13, 16, 18, 31-33, 39-40, 43-46, 48-50, 54, 99-100 and 102-103) | **12**. **7 are held in UI-06**: `kpi/sections`, `kpi/domains`, `kpi/overall`, `projections/snapshots`, `weakest-skills`, `/api/health` and `/healthz`. **4 are held by UI-S8** (open) **and OQ-37**: `GET` and `PUT /api/profile/background`, `GET /api/reference/colleges` and `GET /api/reference/high-schools`. **1 is not held by anything**: `GET /api/progress/kpis` (finding F-1). |
| Endpoints whose only caller is an orphan page | 1 UI-ORPHAN: `/api/account/recover-deletion` | 1 page-orphaned endpoint: `GET /api/practice/reference/questions`, called only from `/practice/topics` (`browse-topics.tsx:88`). It is held with OQ-3 (and see F-11). The email-reached pages keep their single callers (pass3 §3). |
| UI-06 deletions still gone | — | Yes. 0 handlers for any of the 9 deleted paths (pass2 §4), and `apps/api/src/routes/` does not exist. |
| Retired endpoints with a remaining caller | — | 0 (`retired-endpoints-gate`, 14 paths, including the student streak read retired by SCL-212 (OQ-61 (a))) |
| Client modules with no production importer | About 20 modules plus 21 unused `components/ui` primitives (original §5a; all deleted by UI-06) | 2: `client/src/lib/tutor-error-classifier.ts` and `client/src/components/ui/tooltip.tsx` (finding F-4). knip lists 13 `client/src` files in all. Of the other 11, 8 are test support and 3 are SEO build inputs that knip's entry list misses (pass3 §4, handoff H-3) |

## 4. Verdict on UI-61's proof

1. **"Three shells on student surfaces": met for the route table, with two exceptions inside page bodies.** Every student route renders inside exactly one of `app`, `focus` or `bare`, and the route test passes. Two page bodies still carry structure of their own: `/practice/topics` (held by OQ-3) and `/score-report` (F-2, not held by any row). The timed module keeps the Bluebook bar that the design sanctions, but nests a second `<main>` (F-3).
2. **"No unreferenced student endpoints except those held in UI-06": not met as worded.** Three things stand in the way:
   - `GET /api/progress/kpis` has no reader (F-1).
   - The UI-S8 holds (`/api/profile/background`, `/api/reference/*`) are not UI-06 holds. They need Karl to accept UI-S8 as a hold for this proof, or to reword it (findings §"For Karl").
   - `GET /api/practice/reference/questions` is referenced only by the OQ-3 orphan page.

UI-61 cannot close until OQ-3 is ruled (as the reconciliation report said), F-1 is resolved or held, and the UI-S8 hold is accepted.
