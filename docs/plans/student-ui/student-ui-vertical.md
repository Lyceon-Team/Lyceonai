# Student UI Vertical: Closure Register and Build Brief

| | |
|---|---|
| Status | Open |
| Scope | Student-facing surfaces only. Guardian and admin surfaces are out of scope (separate verticals). |
| Branch | `cleanup` integration branch. Codex audits there; QA-passed code merges to `main`. |
| Audit baseline | `origin/main` @ `d2902eec185eeff9d3a821f69cb0317e141e6069` |
| Design source | Prototype canvas "Lyceon Student UI": https://claude.ai/artifact/ATJjfZK3wmGY3KDTajZoe4 |
| Owner | Karl |

This file is the running record for the vertical. It lives in the repo and is updated every time an item closes. The register rows below are the work; the proof column is filled only with output observed in production.

---

## 1. Instructions to CC

1. **Start read-only.** Read this whole document, the audit evidence ([`student-ui-surface-audit.md`](audit/student-ui-surface-audit.md), [`pass1-A`](audit/pass1-A.md)/[`B`](audit/pass1-B.md)/[`C.md`](audit/pass1-C.md), [`pass2-A`](audit/pass2-A.md)/[`B.md`](audit/pass2-B.md)), and the locked spec sections named in §5. Confirm the plan end to end in one reply before changing anything.
2. **Push back before building.** If any item is wrong about the repo, conflicts with a locked spec, or has a cheaper platform-native path, say so with file:line evidence. Do not resolve ambiguity from the repo; raise it as a numbered owner question in §9.
3. **Scope for this pass: Track A (§4).** Wave 0, then Wave 1 and Wave 2. Wave 3 is design work between Karl and Claude and needs nothing from you except item UI-00e.
4. **One item, one proof.** Each row names its proof. An item is closed only when that proof is observed in production and pasted into the row's proof cell. A merged PR, green CI or a passing test is not proof on its own.
5. **Status values are Open, In progress, Closed.** There is no partial.
6. **New findings are not fixed on discovery.** Add a row to §8 with its own proof. The only exception is active harm (a live leak or security hole), which pre-empts everything; report it immediately.
7. **Standards.** `pnpm` only. No dependency changes without Karl's approval (UI-15 presents the list). Zod schemas live in `packages/shared` and types are inferred from them. Every new guard or test must be observed failing at least once before it counts. Tests follow rulings: when behavior changes, tests written for the old behavior are updated, not preserved.
8. **Referencing work.** Do not cite PR numbers when directing audits; audits fetch the latest head of `cleanup`.
9. **Evidence.** Lighthouse reports and other proof artifacts are saved under [`evidence/`](evidence/).

---

## 2. Locked rulings (Karl)

These are decided. Do not relitigate them; raise a conflict in §9 if a spec disagrees.

**Shell and navigation**
- Three shells only: **App shell** (left rail + content + right margin panel), **Focus shell** (no rail; back arrow), **Bare card** (auth and account pages).
- Left rail, permanent, Canvas-style: Lyceon logo with the wordmark under it at the top, then Home, Practice, Review, Full-Length, Calendar, LISA. Help and account at the bottom. Icon above label. No top nav bar, no breadcrumb.
- Right margin panel holds page context: KPIs, mastery, what's next, filters for Calendar. Its content changes per page; its presence does not change between free and paid.
- The calendar's current left column (mini month, schedule summary, show filters) moves into the right panel. The calendar keeps its week and month grid.
- Mobile: the rail becomes a bottom tab bar.
- Full-length exam module (timed) drops both panels and has **no** back arrow, as in Bluebook. Exam session and report pages, and the practice and review runners, use the Focus shell with a back arrow.
- Back arrow target is defined, never guessed: the previous in-app page if the student came from inside Lyceon, otherwise the section's home (runner → Practice or Review). No full-page reloads.
- Marketing footer is removed from app pages; legal links move under Help.

**Free versus paid**
- Free: the diagnostic and its projection, 40 practice questions a day, unlimited review.
- Paid: Calendar, LISA, Full-Length, mastery and KPIs, and every projection after the diagnostic.
- Locked rail items show a small lock. Clicking one opens a feature-specific upgrade modal in place, with no navigation and no call to the gated endpoint. The server still enforces every gate.
- The free user's mastery slot is a locked card: "Track mastery by domain and skills". It shows empty bar outlines only, never fake data.
- "Suggested for you" on Practice is paid-only because it is derived from mastery.
- No progress indicator ever points at payment. Progress indicators are server-derived and true.

**Content and data rules**
- **Students never see question bank counts.** No "questions in bank", no per-domain or per-skill counts, no "N questions match". Counts of the student's own data (review queue, sessions, answered questions, daily quota) are allowed. `/api/questions/stats` is admin-only.
- Student read surfaces show `mastery_level` only (Doc 05). No raw accuracy percentages. No confidence metrics (coding standards §10, §17).
- Mastery is shown as a five-segment bar filled to the level, plus the level label, on the production ladder (`mastery_levels`): Foundations, Building, Developing, Proficient, Strong, or "Not enough answers yet". The same row component is used on Home, Practice, Review, Full-Length home, the Mastery page, and the exam report's domain breakdown.
- There is no Mastery tab. Home, Practice, Review and Full-Length home carry the mastery breakdown and link to `/mastery`.
- No developer copy in the student UI (for example "The Stitch mock shows placeholder cards", "not exposed by this runtime contract").
- Slogan "Study Smarter, Score Higher." may be reused where it fits.

**Filters**
- Practice and Review share one filter bar modeled on the College Board Question Bank: a criteria row of removable chips with "Clear all", a Section selector, and Domain, Skill and Difficulty dropdowns. No state standards.
- Cascade: Domain options depend on Section; Skill options depend on the chosen domains. Changing Section clears choices that no longer apply.
- The filter bar shows no bank counts (see above).
- Review's past sessions are a collapsed dropdown ("Past sessions (N)"), grouped by date, with "Load more".

**Visual system**
- Textbook direction: cream paper, navy ink, hairline rules instead of shadows and glows, no gradients, serif headings.
- Brand tokens already exist: `brand-navy #0F2E48`, `brand-cream #FFFAEF` (`tailwind.config.ts:17-19`). Raw hex in components is replaced by tokens.
- Typography: serif headings (prototype uses Source Serif 4), sans body (prototype uses Source Sans 3). Body text 16px minimum; nothing below 14px anywhere.
- One primary action per screen, filled navy. Everything else is outline or text. Only real inline links are underlined.

**Keyboard** (one shared hook, not wired per route)
| Surface | Keys |
|---|---|
| Practice and review | ↑/↓ move between options; Enter submits the selected option; for grid-in, Enter submits the typed answer; after feedback, Enter or → goes to the next question |
| Exam module | ← / → move between questions; Enter selects but never submits the module (submit stays behind its confirmation dialog) |
| LISA | Enter sends; Shift+Enter adds a new line |
| Everywhere | Esc closes the open modal or sheet |

The hook ignores keys typed into text fields except where listed, and removes its listener on unmount.

**Performance**
- Only work that leaves the core structure intact. No new infrastructure: Vercel already provides the CDN, edge compression and scaling; Supabase's API layer already pools connections; mastery, KPIs and projections are already precomputed tables; caching doctrine is owned by Doc 01A Part III.

---

## 3. Evidence already gathered

- **Surface audit** of `main` @ `d2902eec`: 9 shell treatments (7 on student surfaces), 141 endpoint rows, about 30 unreferenced endpoints, duplicated buttons, cards, headers, empty states, alerts and spinners. Files: [`audit/student-ui-surface-audit.md`](audit/student-ui-surface-audit.md) and the five pass files in [`audit/`](audit/).
- **Production database (2026-09-29):**
  - `pg_stat_statements`: nearly all query time is Supabase dashboard introspection. The heaviest recurring app query is `exam_abandonment_sweep` at about 56 ms mean. The database is not the current bottleneck.
  - Performance advisor: 98 unindexed foreign keys (about 14 on hot paths, listed in UI-08), 42 RLS policies re-evaluating `auth.uid()` per row (UI-09), 65 "unused" indexes (meaningless before launch; not acted on).
  - Mastery ladder: `mastery_levels` rows 0 Foundations, 1 Building, 2 Developing, 3 Proficient, 4 Strong; `unmeasured` = "Not enough answers yet".
  - Taxonomy: `canonical_skill_catalog` holds 29 skills across 8 domains; roughly 210 published questions per skill.
- **Likely cause of felt slowness:** front-end bundle and render blocking, plus cold starts of the single API function (`api/index.ts` → `dist/vercel-api.cjs`). Wave 0 measures this before anything changes.

---

## 4. How the work runs (concurrency)

Karl's ruling: run things concurrently wherever there is no dependency.

| Track | Who | Contents | Can start |
|---|---|---|---|
| A | CC | Wave 0, then Waves 1 and 2 in parallel | Now. Wave 2 PRs merge only after the UI-00a baseline is recorded. UI-15 runs after UI-06. |
| B | Claude + Karl | Wave 3 design on the canvas | Now |
| C | CC | Wave 4 shell and shared components | Shell, tokens and cross-page components: once Home and Practice are signed off (UI-30, UI-31). Page-specific components: once their screen is signed off. |
| D | CC | Wave 5 page migrations | Per page: once its screen is signed off and the Wave 4 shell is closed |
| E | CC | Wave 6 close-out | When every other row is closed |

---

## 5. Spec references to read before building

- [Doc 01](<../../Spec/Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md>) (current version) and [Doc 01A](<../../Spec/Lyceon — Document 01A_ Platform Primitives.md>): entitlement checks, denial semantics, error shape, caching (Part III), observability (Part II). Used by UI-00d and UI-01.
- [Doc 05](<../../Spec/Doc 05 — Mastery, KPI Rollups, Projections & Audit (Parent).md>) and [05C](<../../Spec/Doc 05C — Score Projections & Snapshots.md>): student read surfaces limited to `mastery_level`; projection rules.
- [Doc 04C](<../../Spec/Doc 04C — Score Reports, Review Unlock & Student_Guardian Exam Surfaces.md>): exam report disclosure.
- [Doc 08](<../../Spec/Lyceon — Document 08_ Expansion.md>): calendar engine launch and completion contract.
- [`lyceon-coding-standards.md`](../../Spec/lyceon-coding-standards.md) (Lyceon Coding Standards & AI Instructions): §8.2 error shape, §8.3 status codes, §11 frontend rules, §12 logging, §14 tests.

If a spec is silent or conflicts with a ruling in §2, stop and add an owner question to §9.

---

## 6. Register

Columns: **Proof** is written before work starts. **Proof output** is filled only with production-observed evidence at close.

### Wave 0: Baseline (measurement only, no code changes)

| ID | Item | Proof | Status | Proof output |
|---|---|---|---|---|
| UI-00a | Lighthouse baseline, mobile profile, on `/`, `/login`, `/dashboard`, `/practice` against production | The four reports' Performance, LCP, TBT and CLS values pasted here, with the run date | Open | — |
| UI-00b | API timing: cold-start and warm response times for `/api/profile`, `/api/progress/kpis`, `/api/practice/sessions/open`; size of `dist/vercel-api.cjs`; whether Vercel Fluid compute is enabled | Numbers from Vercel runtime data and the build output pasted here | Open | — |
| UI-00c | Compression and pooling: confirm `/api/*` responses are compressed at the edge; confirm the server opens no direct Postgres connections (supabase-js only) | Response headers showing `content-encoding`; grep for `pg`, `postgres`, `DATABASE_URL` connection use with output | Open | — |
| UI-00d | Entitlement denial contract checked against Doc 01 / 01A | Section references quoted here, or owner question(s) added to §9 | Open | — |
| UI-00e | Current mastery level pill colors (the component `LevelPill` and wherever its colors are defined) | File:line and the exact color values per level pasted here; they become the level-ramp tokens in UI-40 | Open | — |

### Wave 1: Server and contract fixes (no visual redesign)

| ID | Item | Proof | Status | Proof output |
|---|---|---|---|---|
| UI-01 | **One entitlement denial contract.** Every paid-feature denial returns `402` with the standard error shape: `{ error: { message, code: "entitlement_required", details: { feature } } }`, where `feature` is the existing `canAccessFeature` key (`exam_full_length`, `calendar_access`, `mastery_detail`, and the tutor key). The Zod schema for the error body and the feature enum lives in `packages/shared`.<br>Changes: exam runtime moves from 403 to this (`server/routes/exam-runtime-routes.ts:129-146`); calendar keeps 402 and adopts the shape (`calendar-routes.ts:179-197`); `entitlementGate` and `resolveSubject` adopt the shape (`student-resources.ts:199`, `subject-resolver.ts:83`); LISA replaces its own predicate `isEntitlementActiveForProfile` with the shared `canAccessFeature` (`tutor-runtime.ts:205-210`). The practice daily quota keeps its own code (`practice_quota_exhausted`) in the same shape.<br>Client: pages that branched on the old 403 or ad hoc 402 keep working until Wave 4 replaces them with the upgrade modal. | For each surface: a denial test (unpaid student → 402 with the right `feature`) and an allow test (paid student → 200), each observed failing once. In production with a free test account and a paid test account: one request per surface, status and body pasted here | Open | — |
| UI-02 | Gate `PUT /api/calendar/profile` (`calendar-routes.ts:555-572`) with the calendar entitlement | Denial test observed failing once; production request with the free test account returns the UI-01 402 body | Open | — |
| UI-03 | Return paths: add `/calendar` and `/tests` (and the exact paths used by the full-length notification emails, `server/lib/notifications/templates/full-length.ts:83,145,174`) to `RETURN_PATH_ALLOWLIST` (`packages/shared/src/return-path.ts:24-47`). `/profile/complete` preserves `?next=` (`profile-complete.tsx:177`). `/chat` is on the list (needed by UI-04). | Unit tests for each path. In production: signed out, open `/calendar`, sign in, land on `/calendar` | Open | — |
| UI-04 | Retire `/tutor`: the route redirects to `/chat` (`App.tsx:135-142`); delete `pages/tutor.tsx`; repoint the trust-page links (`trust.tsx:159`, `trust-evidence.tsx:170`); remove `/tutor` from the server's public page list (`server/seo-content.ts:796`) | Grep for `pages/tutor` shows no importers; in production `/tutor` lands on `/chat` (after sign-in if signed out) | Open | — |
| UI-05 | Delete the unused `/api/questions*` routes (`server/index.ts:518-601`: list, `recent`, `random`, `count`, `feed`, `:id`, `feedback`). Before deleting, confirm `/api/questions/recent` (anonymous) never returned answer or explanation columns: paste the `QUESTION_SAFE_SELECT` column list | Column list pasted; each route returns 404 in production | Open | — |
| UI-06 | Delete dead code.<br>Endpoints: `/api/auth/admin-provision` (Karl: not used), `/api/auth/debug`, `/api/legal/accept`, `/api/legal/acceptances`, `/api/billing/publishable-key`, `/api/account/status`, `/api/account/select`, `/api/health/practice`, `/api/_whoami`, and the unmounted `apps/api/src/routes/healthz.ts`.<br>Client: `components/NavBar.tsx`, `components/navigation.tsx`, `components/progress-sidebar.tsx`, `components/test-options.tsx`, `components/progress/ScoreProjectionCard.tsx`, `lib/legal.ts` acceptance helpers, the orphan modules listed in [pass1-C §6.2](audit/pass1-C.md#62-componentsmodules-with-no-non-test-importer), the 21 unused `components/ui` primitives, the `RuntimeContractDisabledCard` branch (`CanonicalPracticePage.tsx:451-455`), and the unreached methods in `hooks/usePractice.ts` (`:334-337`, `:412`, `:494`, `:557`, `:616`).<br>Held, not deleted: `/api/students/:id/kpi/*` and `/projections/*` (guardian vertical decides), `/api/practice/diagnostic/sessions/:id/weakest-skills` (funnel audit), `/api/internal/async/*` (LISA backlog), `/api/health` and `/healthz` (may be used by monitors). | For each deletion: grep command and empty output pasted; `pnpm -s run build` and `pnpm test` pass; deleted routes return 404 in production | Open | — |
| UI-07 | **Hide question bank counts from students.** `/api/questions/stats` becomes admin-only (`requireSupabaseAdmin`). Remove every student-visible bank count: the Practice section cards ("327 questions in bank", `practice.tsx:144`), the Domain Library counts, the topic explorer, and any count or total fields in student responses from `/api/practice/topics` and `/api/practice/reference/questions`. Counts of the student's own data stay. If a filter combination yields no questions at session start, the server returns a defined error and the UI shows "No questions match these filters". | Student request to `/api/questions/stats` → 403 (test observed failing once); a schema test proves student responses of the two practice endpoints carry no count or total fields; grep of `client/src` for the removed strings is empty; production screenshots of Practice show no counts | Open | — |
| UI-08 | Hot-path foreign-key indexes, one additive migration, each `CREATE INDEX CONCURRENTLY` (outside a transaction): `practice_session_items(question_id)`, `review_session_items(question_id)`, `review_session_items(queue_entry_id)`, `review_schedule(question_id)`, `review_error_attempts(question_id)`, `test_session_items(question_id)`, `test_form_items(question_id)`, `test_sessions(test_form_id)`, `calendar_block_launches(student_id)`, `calendar_block_launches(block_id, student_id)`, `usage_rate_limit_ledger(student_user_id)`, `notification_events(subject_profile_id)`, `account_deletion_requests(profile_id)`, `guardian_consent_requests(student_profile_id)`, `profiles(guardian_profile_id)`. Karl applies the SQL. | `pg_indexes` query output listing all 15; the performance advisor no longer flags these foreign keys | Open | — |
| UI-09 | RLS policies re-evaluating `auth.uid()` per row (42). **Deferred:** only matters for queries run as the user. Record whether the server ever queries as the user rather than with the service role. | File:line of how the server's Supabase client is created, pasted here. If user-scoped queries exist, this becomes a post-launch hardening item with denial tests | Open | — |
| UI-10 | Coding-standard hits from the audit. Fixed as part of any file this vertical rewrites: `any` (`RequireRole.tsx:30`, `App.tsx:376`, `lib/runtime-contract-disable.ts:42`, `practice.tsx:196,199,749,775`), silent `catch` (`server/routes/legacy/progress.ts:111`, `guardian-routes.ts:75`), `console.*` (`App.tsx:377`, `CanonicalPracticePage.tsx:321`, `home.tsx:92,126`, `SupabaseAuthContext.tsx:99,141,146,185,199`), raw `error.message` shown to users (`App.tsx:389`). Hits in files the vertical does not touch get their own row in §8. | Grep for each pattern in the listed files returns empty | Open | — |

### Wave 2: Performance (structure unchanged)

| ID | Item | Proof | Status | Proof output |
|---|---|---|---|---|
| UI-11 | Route-level code splitting: every route in `App.tsx` lazy-loaded; Desmos, the math reference sheet and math rendering load only on question screens | Initial JS for `/dashboard` from the build report, before and after | Open | — |
| UI-12 | Fonts load via `<link>` with preconnect instead of the CSS `@import` (`index.css:1`); non-critical scripts deferred; the unloaded "Bricolage Grotesque" reference removed from `calendar.css` | Lighthouse "render-blocking resources" is empty on the four pages | Open | — |
| UI-13 | Public-page images served as WebP with explicit width and height; below-the-fold images `loading="lazy"` | Lighthouse image audits pass on `/` | Open | — |
| UI-14 | Query hygiene: one `queryFn` for `["/api/profile"]` (today three: `RequireRole.tsx:44-62`, `profile-complete.tsx:100-110`, `UserProfile.tsx:130-133`); one key for billing status (today `["/api/billing/status"]` and `["billing-status"]`); default `staleTime` set per data type, long for taxonomy and pricing | Network log for a `/dashboard` load shows each endpoint requested once | Open | — |
| UI-15 | Remove unused dependencies (after UI-06): run a dead-code and dependency report; present the removal list to Karl for approval before changing `package.json` | Report shows zero unused dependencies; Karl's approval recorded here | Open | — |
| UI-16 | Pagination, 20 per page with a cursor: review past sessions, notifications, LISA conversation history | Boundary tests (20, 21, empty); production responses show the cursor | Open | — |
| UI-17 | Per-row queries in loops: check the past-sessions and notifications handlers | Query count per request pasted here; if more than a constant, a row goes in §8 | Open | — |
| UI-18 | Cold starts: act on UI-00b only if cold-start time is material. Options that keep the structure: enable Vercel Fluid compute, trim the function bundle. Any plan change is an owner question. | UI-00b numbers before and after | Open | — |

### Wave 3: Design completion (Claude + Karl, on the canvas)

| ID | Item | Proof | Status | Proof output |
|---|---|---|---|---|
| UI-30 | Home, free and paid | Karl's sign-off on the canvas | In progress (layout approved; bank counts must be removed) | — |
| UI-31 | Practice, free and paid: remove all bank counts from the filter bar and result line (UI-07 ruling) | Karl's sign-off | In progress | — |
| UI-32 | Review home, including the past-sessions dropdown | Karl's sign-off | Open | — |
| UI-33 | Full-Length home | Karl's sign-off | Open | — |
| UI-34 | Exam report domain breakdown using the mastery row | Karl's sign-off | Open | — |
| UI-35 | Calendar: Canvas-style layout, right panel with mini month, schedule summary, filters, target, projection, streak, days to test | Karl's sign-off | Open | — |
| UI-36 | LISA (`/chat`): conversation history in the right panel, reading-width input | Karl's sign-off | Open | — |
| UI-37 | Mastery page | Karl's sign-off | Open | — |
| UI-38 | Question runner (Focus shell): back arrow, keyboard rules, feedback state | Karl's sign-off | Open | — |
| UI-39 | Mobile: bottom tab bar and one page per shell | Karl's sign-off | Open | — |
| UI-3A | Bare card pages: login, profile completion, update password, account recovery, pending deletion, 404, error screen | Karl's sign-off | Open | — |
| UI-3B | Upgrade modal copy per feature (Full-Length, Calendar, LISA, mastery) | Karl's sign-off | In progress | — |

### Wave 4: Shell and shared components

| ID | Item | Proof | Status | Proof output |
|---|---|---|---|---|
| UI-40 | Design tokens: colors (brand, level ramp from UI-00e), type scale (16px body, 14px floor), serif and sans families, spacing, radius | Grep of `client/src` for `text-[10px]`, `text-[11px]` and raw hex outside the token files is empty | Open | — |
| UI-41 | App shell: left rail (with lock states), content column, right margin panel; Focus shell with back arrow; Bare card | Every student route renders inside exactly one of the three shells (route table check pasted here) | Open | — |
| UI-42 | Mastery row component (five-segment bar + level pill, compact and wide variants, unmeasured state) | Used on Home, Practice, Review, Full-Length home, Mastery page, exam report; grep shows no other mastery rendering | Open | — |
| UI-43 | Filter bar component (Section, Domain, Skill, Difficulty; chips; cascade; no bank counts) | Used by Practice and Review; unit tests for the cascade rules | Open | — |
| UI-44 | Upgrade modal, keyed by `feature`; opened by locked rail items and by any UI-01 `entitlement_required` response | Test: a 402 `entitlement_required` for each feature opens the matching modal | Open | — |
| UI-45 | Shared keyboard hook (§2 table), with listener cleanup | Tests per surface; a test that fails if the unmount cleanup is removed | Open | — |
| UI-46 | Shared primitives replacing the duplicates in the audit ([§6.2 of the audit](audit/student-ui-surface-audit.md#62-ui-elements-implemented-more-than-once)): button variants, page header, empty state, notice, skeletons, tabs, modal and sheet | Grep shows zero remaining duplicate implementations listed in audit §6.2 | Open | — |

### Wave 5: Page migrations

Each page moves onto the new shell in its own PR once its screen is signed off. Proof for every row: side-by-side screenshot with the signed-off prototype in the PR, and the page's main click path exercised in production.

| ID | Page(s) | Status | Proof output |
|---|---|---|---|
| UI-50 | Home (`/dashboard`) | Open | — |
| UI-51 | Practice (`/practice`), including retiring the Domain Library card | Open | — |
| UI-52 | Review (`/review`) | Open | — |
| UI-53 | Practice and review runners (Focus shell) | Open | — |
| UI-54 | Full-Length home (`/tests`), exam session and report pages (the timed module keeps its Bluebook layout; typography tokens only) | Open | — |
| UI-55 | Calendar (`/calendar`) | Open | — |
| UI-56 | LISA (`/chat`) | Open | — |
| UI-57 | Mastery (`/mastery`) | Open | — |
| UI-58 | Upgrade, profile, notifications | Open | — |
| UI-59 | Bare card pages (UI-3A list) | Open | — |

### Wave 6: Close-out

| ID | Item | Proof | Status | Proof output |
|---|---|---|---|---|
| UI-60 | Lighthouse after-run on the UI-00a pages | Values pasted beside the baseline | Open | — |
| UI-61 | Reachability audit re-run with the original brief | Three shells on student surfaces; no unreferenced student endpoints except those held in UI-06 | Open | — |
| UI-62 | Invariant sweep | Greps empty for: text below 14px, raw hex outside tokens, bank counts in student UI, `console.*` in touched files | Open | — |

---

## 7. Out of scope

- Guardian and admin surfaces.
- The end-to-end funnel audit (diagnostic → payment); it runs separately after this vertical.
- Mastery, scoring and projection formulas; no RPC or formula changes.
- The exam's timed module layout, beyond typography tokens.
- New infrastructure (CDN, load balancer, cache layer, separate API services).

---

## 8. Findings added during work

New findings become rows here with their own proof. They are not fixed on discovery unless they are active harm.

| ID | Finding | Proof | Status | Proof output |
|---|---|---|---|---|
| — | — | — | — | — |

---

## 9. Owner questions

| # | Question | Status | Ruling |
|---|---|---|---|
| OQ-1 | Is `/api/auth/admin-provision` used to create test accounts? | Closed | No; delete (UI-06) |
| OQ-2 | Run Wave 3 design alongside Waves 1 and 2? | Closed | Yes; run concurrently wherever there is no dependency (§4) |
| OQ-3 | Should `/practice/topics` (topic explorer) be retired, since the filter bar replaces it? | Open | — |
| OQ-4 | Mobile tab bar has six items; platform guidance is five. Which item moves under a "More" tab, or does LISA become a floating button? | Open | — |
| OQ-5 | A student whose plan lapsed opens a past exam report: keep today's in-page "unavailable" state, or use the UI-01 402 and the upgrade modal? | Open | — |
| OQ-6 | Confirm the typefaces: Source Serif 4 (headings) and Source Sans 3 (body), self-hosted or via Google Fonts | Open | — |

---

## 10. Change log

| Date | Change |
|---|---|
| 2026-09-29 | Document created from the student UI surface audit, production checks and Karl's rulings. |
