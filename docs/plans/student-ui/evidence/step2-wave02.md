# Step 2 — Wave 0 / Wave 2 feasibility check (read-only)

Repo: /home/user/Lyceonai, branch claude/student-ui-docs. Plan: docs/plans/student-ui/student-ui-vertical.md §6 (Wave 0 lines 129-137, Wave 2 lines 154-165). Date 2026-09-29.
No repo files modified. `node_modules` is NOT installed in this checkout, so no build/esbuild could run.

## Container limits (affect UI-00a, UI-00c)

- `curl -sI https://lyceon.ai` -> `HTTP/1.1 403 Forbidden` from the agent proxy; proxy status shows
  `connect_rejected ... gateway answered 403 to CONNECT (policy denial or upstream failure)` for `lyceon.ai:443`.
  `www.lyceon.ai`, `*.vercel.app` and even `example.com` return 000. Only npm/pypi etc. are reachable (noProxy list).
  => **Neither Lighthouse nor header checks against production can run from this container.**
- Chromium present: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (Chromium 141.0.7390.37, `--version` works).
  Also `chromium_headless_shell-1194/.../headless_shell`. `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm dlx lighthouse ...` would be usable (registry.npmjs.org reachable) — against a reachable target only.
- Options: (a) Karl runs Lighthouse / PageSpeed Insights from his machine; (b) Vercel MCP `web_fetch_vercel_url` for headers (not called); (c) local `vite preview` Lighthouse — needs `pnpm install` (not allowed here) and would not measure the CDN/cold start.

## UI-00a — Lighthouse baseline

- Unauthenticated `/dashboard` and `/practice`: vercel.json routes `^/(?!api/).*` -> `/index.html` (static SPA). Client boots,
  `SupabaseAuthContext.tsx:84` fetches `/api/profile` (401 -> signed out), `RequireRole.tsx:67-76` shows a "Loading..." spinner
  while auth resolves, then `RequireRole.tsx:78-88` renders `<Redirect to={loginPathWithReturn(intended)} replace />`
  => `/login?next=%2Fdashboard` (`packages/shared/src/return-path.ts:94-98`). The lazy `LyceonDashboard` chunk is never
  requested (child of RequireRole is not rendered). So a logged-out run of `/dashboard` and `/practice` measures:
  index.html + entry bundle + one `/api/profile` 401 (function invocation, possibly cold) + client redirect to the eagerly-bundled Login page.
  It is effectively a second `/login` measurement plus a spinner and one API round trip — not the dashboard.
  A meaningful baseline needs an authenticated run (Lighthouse `--extra-headers` with a session cookie, or Chrome DevTools with a test student).

## UI-00b — API timing / bundle / Fluid

- Timing: obtainable from Vercel runtime data via the session's Vercel MCP (`get_runtime_logs`, `create_observability_query`, `get_project`) — not called here.
- `package.json:19` `build:vercel` = `pnpm -s run build && pnpm -s exec esbuild server/index.ts --bundle --platform=node --format=cjs --external:@google-cloud/bigquery --outfile=dist/vercel-api.cjs`.
  Everything except BigQuery is bundled (no `--packages=external`), no `--minify`, no `--metafile`. `api/index.ts:1` imports `../dist/vercel-api.cjs`.
- `esbuild.config.js` is **0 bytes** (empty file, unused) — the plan should not cite it as config; all config is the CLI flags above.
- Size could not be measured (no node_modules). Adding `--metafile` would give a per-dependency breakdown; alternatively Vercel MCP `list_deployment_files`/`get_deployment` gives the deployed size.
- Fluid compute: `vercel.json` has no `functions`, `fluid`, `maxDuration`, `memory` or `regions` keys (file: installCommand, buildCommand, outputDirectory, 8 crons, 4 routes). Fluid is a project setting (or `"fluid": true` in vercel.json) — check via Vercel MCP `get_project`.

## UI-00c — compression and pooling

- Header check blocked (403 from egress proxy for `/api/public/pricing`, `/api/health`, `/api/healthz`). No headers to paste.
- Server has no compression middleware (grep `compression|gzip|brotli` in server/ non-test: no hits). Vercel's CDN compresses
  function responses itself when the client sends Accept-Encoding; must be confirmed with real headers (Karl or Vercel MCP `web_fetch_vercel_url`).
- Direct Postgres grep (`from 'pg'`, `require('pg')`, `postgres(`, `DATABASE_URL`, `new Pool`, `drizzle`) over server/ apps/ packages/ api/:
  ```
  apps/api/src/config.ts:14:  // Database - Supabase only (no Neon/DATABASE_URL)
  packages/shared/src/__tests__/guardian-student-schema.test.ts:27:import type { Client } from "pg";
  packages/shared/src/__tests__/env.test.ts:38/40: DATABASE_URL test values
  packages/shared/src/env.ts:33:  DATABASE_URL: z.string().url().optional(),
  ```
  No runtime use. `pg` is a **devDependency** (`package.json:173`, devDependencies open at :139), used by tests/scripts only
  (tests/helpers/pg-supabase.ts, scripts/ci/*.ts, scripts/apply_migrations.ts, ...). No drizzle, no postgres.js.
  => Server is supabase-js only. `DATABASE_URL` in env.ts:33 is optional and unused by runtime code (UI-15 candidate).

## UI-00e — LevelPill colours

`client/src/components/mastery/LevelPill.tsx:16-34` (`levelTone`), pill at :44-50 (`rounded-full border px-2.5 py-0.5 text-xs font-medium`):

| level | line | classes | hex (Tailwind 3.4 default palette) |
|---|---|---|---|
| unmeasured | :22 | `bg-muted text-muted-foreground border-border` | light: #F0EAE0 / rgba(15,46,72,.6) / rgba(15,46,72,.12) (index.css:23,24,29); dark: #1A3D5C / rgba(255,250,239,.6) / rgba(255,250,239,.15) (index.css:80,81,86) |
| L0 Foundations | :24 | `bg-amber-100 text-amber-900 border-amber-200` | #FEF3C7 / #78350F / #FDE68A |
| L1 Building | :26 | `bg-orange-100 text-orange-900 border-orange-200` | #FFEDD5 / #7C2D12 / #FED7AA |
| L2 Developing | :28 | `bg-sky-100 text-sky-900 border-sky-200` | #E0F2FE / #0C4A6E / #BAE6FD |
| L3 Proficient | :30 | `bg-blue-100 text-blue-900 border-blue-200` | #DBEAFE / #1E3A8A / #BFDBFE |
| L4 Strong | :32 | `bg-emerald-100 text-emerald-900 border-emerald-200` | #D1FAE5 / #064E3B / #A7F3D0 |

- There are **no level tokens**: not in `tailwind.config.ts` (theme.extend.colors :15-~70 has brand-cream/surface/navy + CSS-var semantics only; defaults like amber/sky are the stock Tailwind palette because colors are under `extend`), not in `client/src/styles/tokens.css`, not in `index.css`.
- No `dark:` variants: L0-L4 render the same light pastel on the dark theme.
- Consumers: `pages/mastery.tsx`, `pages/guardian-dashboard.tsx`.
- Side note for UI-40: `tokens.css` (imported App.tsx:15) and `index.css` both define `--primary`, `--font-sans` etc. with different values (tokens.css:4 `--primary: 20 14% 12%` HSL triplet vs index.css `--primary: #0F2E48`) — two token layers, cascade order decides.

## UI-11 — code splitting

- `App.tsx` already has **32 `lazy()` routes**. Eager page imports: `HomePage` (:18), `Login` (:19), `NotFound` (:20), `UpdatePassword` (:22), `NotificationsPage` (:23); plus `RequireRole` (:21), `PendingDeletionScreen` (:10), `UIProvider` (:11), `Analytics` (:12). Home/Login/NotFound being eager is arguably correct for `/` and `/login` LCP; `UpdatePassword` and `NotificationsPage` are the real candidates.
- Desmos: `components/math/DesmosCalculator.tsx:95-104` injects `https://www.desmos.com/api/v1.11/calculator.js` at runtime (async/defer) — not bundled. Imported only by `CanonicalPracticePage.tsx:32` and `ExamModulePage.tsx:33`, both behind lazy routes.
- MathReferenceSheet: `CanonicalPracticePage.tsx:46`, `ExamModulePage.tsx:36` — lazy routes only.
- MathRenderer/katex JS (`components/MathRenderer.tsx:2-3`): importers are question-renderer, NumericEntryInput, exam components, TutorThreadParts (via ScopedTutorPanel/chat), browse-topics, MathReferenceSheet — all under lazy routes.
- **The one real leak: `client/src/main.tsx:6` `import "katex/dist/katex.min.css"`** — KaTeX CSS (and its @font-face table) goes into the entry CSS on every page, render-blocking. MathRenderer.tsx:3 already imports it, so main.tsx:6 can simply go.
- `vite.config.ts`: no `manualChunks`; rollupOptions.output only sets file-name patterns; `chunkSizeWarningLimit: 500`. No bundle visualizer. Build report for "initial JS for /dashboard" needs `vite build` output (not runnable here).
- Also `main.tsx:15` `console.log("[Build]", ...)` in production (Standards §16).
- Route definitions use `component={() => (<RequireRole>...)}` inline arrows (App.tsx:156-178 etc.) — a new component type every App render, which is why RequireRole remounts on navigation (its own comment at RequireRole.tsx:~38). Perf-relevant, not in the plan.

## UI-12 — fonts / render blocking

- `client/src/index.css:1` `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:wght@300;400;500;600;700&display=swap')`.
- **`client/index.html:39-41` already has preconnect + a `<link>` stylesheet — loading ~25 families** (Architects Daughter, DM Sans, Fira Code, Geist Mono, Geist, IBM Plex Mono/Sans, Inter, JetBrains Mono, Libre Baskerville, Lora, Merriweather, Montserrat, Open Sans, Outfit, Oxanium, Playfair Display, Plus Jakarta Sans, Poppins (18 weights), Roboto Mono, Roboto, Source Code Pro, Source Serif 4, Space Grotesk, Space Mono). This is the dominant render-blocking font cost; the plan's "@import -> link with preconnect" misses it.
  Actually used: `--font-sans` = Poppins, Inter (index.css:51, tokens.css:30-32); `--font-serif` = Georgia (system); `--font-mono` = SF Mono/Menlo (system). So one link for Inter + Poppins (the weights in index.css:1) replaces both.
- **`client/index.html:47` loads `https://replit.com/public/js/replit-dev-banner.js`** — a synchronous (no async/defer), third-party, dev-only script at end of body in production HTML. Render-blocking-ish and a third-party request on a minors' site. Remove.
- `calendar.css`: "Bricolage Grotesque" at 10 lines — 107, 143, 208, 264, 353, 444, 515, 695, 754, 807. Never loaded anywhere (falls back to UA default, not the app sans). Calendar.css:68 uses `Inter, system-ui`.
- katex.min.css in entry (main.tsx:6) — see UI-11; it is also render-blocking CSS.

## UI-13 — images

- `client/public`: favicon-192.png (24,199 B, 192x192), favicon-32.png (1,308 B), favicon.ico (1,308 B, actually a PNG), **lyceon-logo.png (887,895 B, 1024x1024 RGBA)**, og-image.jpg (36,133 B, 1200x630), robots.txt, sitemap.xml. No `client/src/assets` dir.
- **There is no `<img>` element anywhere in `client/src`** (grep `<img\b`, `backgroundImage`, `url(/`: none). lyceon-logo.png is referenced by no code. og-image.jpg is only in meta tags (index.html:26,35; server/index.ts:273).
  => UI-13 as written (WebP + width/height + lazy on public-page images) has nothing to act on. Real items: delete or shrink the unreferenced 888 KB logo; fix `components/SEO.tsx:19` (`/og-image.png`, file is .jpg) and `SEO.tsx:141,214` (`/logo.png`, file does not exist) — broken JSON-LD/OG URLs.
- Related: vercel.json sends every non-/api path to `/index.html` after `filesystem`, so the SSR public routes in `server/index.ts:760-787` (PUBLIC_SSR_ROUTES, JSON-LD injection, index.html:37 comment) are **not reached on Vercel** — only `/api/*` and `/auth/callback` go to the function. Public pages are pure CSR in production; matters for LCP on `/` and for SEO.

## UI-14 — query hygiene

`["/api/profile"]` queryFns:
- `RequireRole.tsx:45-64` (key :47; custom csrfFetch, 401/403 -> `{authenticated:false,user:null}`, `enabled: !!user`).
- `profile-complete.tsx:100-110+` (key :101; same shape, different error text).
- `UserProfile.tsx:130-133` (key :131; **default** queryFn — `queryClient.ts:95-123` throws on 401 and different shape type).
- **A fourth fetch outside React Query**: `SupabaseAuthContext.tsx:80-84` `fetchUserFromBackend` -> `csrfFetch("/api/profile")`. So every authenticated page load requests `/api/profile` at least twice (context + RequireRole query) regardless of key unification. The plan's "each endpoint requested once" needs the context to seed/consume the query cache.
- Invalidations: ReconsentModal.tsx:126, profile-complete.tsx:162.

Billing status — **three** keys, not two:
- `["billing-status"]`: CheckoutReturnPoller.tsx:106, PremiumUpgradePrompt.tsx:153
- `["/api/billing/status"]`: UserProfile.tsx:142
- `["guardian-billing-status"]`: guardian-dashboard.tsx:211

Defaults `client/src/lib/queryClient.ts:126-137`: `staleTime: Infinity`, `refetchOnWindowFocus: false`, `refetchInterval: false`, `retry: false`. So staleness is already "never" globally — the plan's "set long staleTime for taxonomy and pricing" is backwards; the work is choosing SHORTER staleTime for volatile data (progress, notifications, sessions) and leaving Infinity for taxonomy/pricing. With Infinity + same key, React Query already dedupes; duplicate requests come from the non-Query fetch and from different keys.

## UI-15 — dependency report tooling

Monorepo is pnpm workspaces (`pnpm-workspace.yaml`: apps/*, packages/*; root package.json has ~90 runtime deps :49-138). Recommend `pnpm dlx knip` (workspace-aware, reports unused deps, devDeps, files and exports per workspace; can take a `knip.json` passed via `--config` from outside package.json). `depcheck` is not workspace-aware and largely unmaintained. Not run. Known candidates already visible: `DATABASE_URL` env (env.ts:33), `esbuild-wasm` alongside `esbuild` (package.json devDeps), empty `esbuild.config.js`.

## UI-16 — pagination

- "Review past sessions": there is **no past-sessions endpoint**. The review page's "Review a past session" picker (`client/src/pages/review.tsx:~514-530`) is fed by `GET /api/review/pool` (`review-canonical.ts:1411-1445` -> `server/services/review-pool.ts:456` `buildReviewPoolSummary`), which returns `sessions` = every source session that still has open review-queue items, unpaginated, newest first (review-pool.ts:~570-577). `GET /api/review/sessions/open` (`review-canonical.ts:1447-1499`) lists only `created|active` review sessions (OPEN_STATUSES :88), bounded in practice by `maxConcurrentSessions`; no pagination.
- Notifications: **already cursor-paginated, default 20.** `server/routes/notifications.ts:101-193` (limit+1 fetch, base64url keyset cursor `{messageId}`, `nextCursor`), schema `packages/shared/src/notifications-schema.ts:222-232` (default `NOTIFICATION_FEED_DEFAULT_LIMIT`=20 per test notifications-schema.test.ts:81; max 50), contract `contracts/notifications.contract.md` C3.1 (:112) "keyset cursor", tests at :371, :377. UI-16 has nothing to build here beyond boundary tests.
- LISA conversation list: `server/routes/tutor-runtime.ts:2195-2340` `GET /api/tutor/conversations`. `limit ?? 20` (schema `packages/shared/src/tutor-lifecycle-schema.ts:66-78`, max 100). **Cursor accepted by the schema (:68) but ignored by the handler** — the query is always the newest `limit` rows. Response emits `next_cursor` = last conversation_id and `has_more: conversations.length === limit` (off-by-one: exactly 20 rows reports has_more=true; page 2 with that cursor returns page 1 again). Real defect.

## UI-17 — per-row queries

- `GET /api/review/sessions/open` (`review-canonical.ts:1473-1491`): `Promise.all` over sessions, each calling `getSessionProgressCounts` (:307, one select) + `countSessionItems` (:290, one count) => **1 + 2N queries** (+ loadPracticeConfig). N bounded by maxConcurrentSessions, so small in practice. Could be one grouped query/RPC.
- `GET /api/notifications` (`notifications.ts:117-193`): **1 RPC** (`notification_feed`), rendering is in-memory. Constant. (`/unread-count` also 1 RPC.)
- `GET /api/review/pool` (`review-pool.ts`): loadOpenQueueEntries (1, `review_schedule`, no limit :92-~120) + loadServableQuestions chunked by `ID_CHUNK = 200` (:~154-175) => ceil(Q/200) queries + describeSourceSessions 2 batched `.in()` queries. Near-constant. Note `describeSourceSessions` discards `error` from both reads (`const { data } = await ...`, review-pool.ts ~:545, ~:559) — silent failure (Standards §13).
- Not in the plan but the worst N+1 found: `GET /api/tutor/conversations` (`tutor-runtime.ts:2256-2320`): per row, 1 query for last message + 1 exact count + `serializeTutorOutput` scan => **1 + 2N (+scan) queries, N up to 100**.

## UI-18

Depends on UI-00b only. Fluid is a project setting / `"fluid": true` in vercel.json; bundle trimming options: `--minify`, `--packages=external` (let Vercel's nft trace node_modules) or externalise heavy SDKs (@google/genai, @google-cloud/documentai, @napi-rs/canvas) — measure with `--metafile` first.

## Platform-native / cheaper options and plan corrections

1. `@vercel/analytics` is installed (package.json:88, App.tsx:12/444). `@vercel/speed-insights` is **not** installed. Speed Insights gives real-user LCP/CLS/INP/TTFB per route, including authenticated `/dashboard` and `/practice`, with no auth plumbing — better baseline for UI-00a/UI-60 than logged-out Lighthouse. Needs a dependency add (Karl approval) + enabling in Vercel project.
2. UI-00a cannot run from this container (egress blocks lyceon.ai); logged-out `/dashboard`/`/practice` measure the login redirect.
3. UI-00b: `esbuild.config.js` is empty; config is package.json:19 flags. Timing/size/Fluid via Vercel MCP.
4. UI-12 misses the 25-family Google Fonts link (index.html:41) and the Replit banner script (index.html:47); katex CSS in main.tsx:6.
5. UI-13 has no images to convert; replace with: delete/shrink unreferenced lyceon-logo.png (888 KB), fix SEO.tsx broken image URLs.
6. UI-14: four /api/profile fetch sites (add SupabaseAuthContext.tsx:84), three billing keys (add guardian-billing-status), staleTime is already Infinity.
7. UI-16: notifications already done; "past sessions" = /api/review/pool summary; tutor list has a broken cursor (ignored + off-by-one has_more).
8. UI-17: add tutor conversations list (worst N+1).
9. SSR public routes unreachable on Vercel (vercel.json routes) — affects `/` LCP and SEO assumptions.
