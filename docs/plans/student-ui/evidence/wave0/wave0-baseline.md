# Wave 0: production baseline (UI-00a, UI-00b, UI-00c)

Measured 2026-09-29 against `https://lyceon.ai`, in a full-network session. Register: [`student-ui-vertical.md`](../../student-ui-vertical.md) §6, Wave 0.

## 0. What was measured

- **Production deployment:** `dpl_BVg8L2SH73rP3RuQvLbqR3hS5FgN`, target `production`, region `iad1`, built from `main` @ `682c71c3` ("Merge pull request #981 from Lyceon-Team/cleanup"). This is before the Track A merge into `cleanup` (`426c3c1c`, #982), so the baseline does not include this vertical's changes. Independent check: production `/` still serves the synchronous `replit-dev-banner.js` script that `cleanup` removed in `1f18fc7` (UI-12).
- **Free test account:** `lyceon-qa-student-ui-free-20260929@example.com`. Created through the normal `/login` → Sign Up form (`POST /api/auth/signup` → 201, no email verification), then `/profile/complete` (role Student, an invented date of birth giving age 16; `PATCH /api/profile` → 200), landing on `/dashboard`. The password was generated in the session scratchpad and is recorded nowhere. Deletion is UI-63.
- **Tooling (session container only, not repo dependencies):** Chromium 141.0.7390.37 (the pre-installed Playwright build), Lighthouse 12.8.2 and playwright-core 1.63.0, both installed into the session scratchpad. `package.json` is unchanged.

### Network constraints on this session (they bear on how to read the numbers)

1. **Egress proxy.** Every request left through the session's egress proxy. For Chromium, the proxy re-terminates TLS with its own CA (`CCR Upstream Proxy CA`). Chromium was told to trust that one CA by SPKI pin (`--ignore-certificate-errors-spki-list=<sha256 of that CA's key>`), which is the scoped equivalent of adding it to the trust store. No other certificate error is ignored. curl reaches `lyceon.ai` with its real Let's Encrypt chain.
2. **Host allowlist.** Chromium ran with a PAC file that sends only `lyceon.ai` (and subdomains), `fonts.googleapis.com`, `fonts.gstatic.com`, `*.supabase.co` and `replit.com` through the proxy. Every other host is sent to a dead port. This stopped Chromium's own background calls (`mtalk.google.com`, `clients2.google.com`) seen in the first minutes of setup. Background networking, sync, component update and pings were also disabled by flag.
3. **Proxy reliability.** The proxy dropped or 502'd a share of connections (curl alone: 2 failures in 5). **Production served no 5xx in the window:** Vercel runtime logs for the deployment, 20:30 to 21:25Z, grouped by status, show only 200, 304, 401 and 201, and a `5xx` filter returns nothing. Every Lighthouse run with a failed request, a ≥400 response other than the expected signed-out 401 on `/api/profile`, a runtime error, or a final URL different from the requested one was rejected and rerun (§2.3).
4. **Latency.** Lighthouse's mobile preset uses simulated throttling (Lantern), which models RTT and throughput from what it observes, so the proxy hop inflates LCP and FCP somewhat. Treat these as a lab baseline taken the same way the UI-60 after-run will be taken. Karl's DevTools run (§2.5) is the reference without the proxy.

---

## 1. Origins (task 2, before Lighthouse)

Every origin requested by `/`, `/login` (signed out), `/dashboard` and `/practice` (signed in as the free test account), summed over the three accepted Lighthouse runs per page (`network-requests` audit):

| Page | Origin | Requests (3 runs) | Status |
|---|---|---|---|
| `/` | `https://lyceon.ai` | 27 | 24 × 200, 3 × 401 (`/api/profile`, signed out, expected) |
| | `https://fonts.googleapis.com` | 6 | 6 × 200 |
| | `https://fonts.gstatic.com` | 15 | 15 × 200 |
| | `https://replit.com` | 3 | 3 × 200 |
| `/login` | `https://lyceon.ai` | 24 | 21 × 200, 3 × 401 (`/api/profile`, signed out, expected) |
| | `https://fonts.googleapis.com` | 6 | 6 × 200 |
| | `https://fonts.gstatic.com` | 9 | 9 × 200 |
| | `https://replit.com` | 3 | 3 × 200 |
| `/dashboard` | `https://lyceon.ai` | 72 | 72 × 200 |
| | `https://fonts.googleapis.com` | 6 | 6 × 200 |
| | `https://fonts.gstatic.com` | 15 | 15 × 200 |
| | `https://replit.com` | 3 | 3 × 200 |
| `/practice` | `https://lyceon.ai` | 120 | 120 × 200 |
| | `https://fonts.googleapis.com` | 6 | 6 × 200 |
| | `https://fonts.gstatic.com` | 12 | 12 × 200 |
| | `https://replit.com` | 3 | 3 × 200 |

**No origin fails in production.** Four origins, the same on every page. The browser never contacts Supabase directly (auth is the server-side `sb-<ref>-auth-token` cookie). Vercel Web Analytics is same-origin (`/_vercel/insights/script.js`).

A first pass in Playwright ([`origins-playwright-first-pass.txt`](origins-playwright-first-pass.txt)) saw two transient faults that did not come from production. One was 502s with no `server: Vercel` or `x-vercel-id` header, which came from the session proxy. The other was `replit-dev-banner.js` blocked by Chromium ORB. It loaded with 200 in all 12 accepted runs.

`replit.com/public/js/replit-dev-banner.js` is a third-party, synchronous script in production's `<head>`, and it is render-blocking on every page (§2.4). UI-12 has already removed it on `cleanup` (`1f18fc7`).

---

## 2. UI-00a: Lighthouse

Lighthouse 12.8.2, default config (mobile: Moto G Power emulation, simulated slow 4G, 4× CPU slowdown), Performance category only, 3 accepted runs per page, fresh Chrome profile per run, cold HTTP cache per run (Lighthouse's default reset).

- `/` and `/login`: signed out (fresh profile, no cookies).
- `/dashboard` and `/practice`: signed in as the free test account. **Deviation from the brief (`--extra-headers`), deliberately:** Lighthouse's `--extra-headers` applies to every request, so the session cookie would also have been sent to `fonts.googleapis.com`, `fonts.gstatic.com` and `replit.com`. Instead, the account's cookies were written into the fresh Chrome profile's cookie jar for `lyceon.ai` only (CDP `Storage.setCookies`) before Lighthouse attached. Lighthouse does not clear cookies (its default `clearStorageTypes` is `file_systems, shader_cache, service_workers, cache_storage`), so the page loads signed in and the cookie goes to `lyceon.ai` only. Each signed-in batch began with a fresh sign-in through `/login`. Every accepted signed-in run's `finalDisplayedUrl` is the requested page, not `/login`.

### 2.1 Result (median of 3, per metric)

| Page | State | Performance | LCP | TBT | CLS | FCP (context) |
|---|---|---|---|---|---|---|
| `/` | signed out | **84** | **3.28 s** | **149 ms** | **0.022** | 3.20 s |
| `/login` | signed out | **82** | **3.74 s** | **20 ms** | **0.001** | 3.16 s |
| `/dashboard` | free account | **58** | **5.59 s** | **11 ms** | **0.193** | 3.38 s |
| `/practice` | free account | **61** | **5.81 s** | **51 ms** | **0.188** | 3.52 s |

### 2.2 Per run

| Report | Fetch time (UTC) | Perf | LCP ms | TBT ms | CLS | FCP ms | Speed Index ms | Benchmark index |
|---|---|---|---|---|---|---|---|---|
| `home-run1` | 21:08:47 | 85 | 3249 | 149 | 0.022 | 3185 | 3297 | 2617 |
| `home-run2` | 21:09:18 | 84 | 3277 | 141 | 0.007 | 3198 | 3346 | 2721 |
| `home-run3` | 21:09:34 | 82 | 3394 | 165 | 0.022 | 3316 | 3659 | 2712 |
| `login-run1` | 21:11:42 | 82 | 3742 | 16 | 0.001 | 3155 | 3489 | 2853 |
| `login-run2` | 21:11:57 | 83 | 3734 | 20 | 0.001 | 3161 | 3297 | 2805 |
| `login-run3` | 21:12:26 | 81 | 3896 | 21 | 0.001 | 3308 | 3405 | 2887 |
| `dashboard-run1` | 21:12:47 | 56 | 5539 | 16 | 0.193 | 3402 | 8477 | 3008 |
| `dashboard-run2` | 21:13:42 | 58 | 5654 | 11 | 0.193 | 3378 | 6781 | 3009 |
| `dashboard-run3` | 21:14:14 | 60 | 5594 | 11 | 0.176 | 3359 | 6006 | 2881 |
| `practice-run1` | 21:18:02 | 61 | 5525 | 26 | 0.188 | 3515 | 4722 | 2892 |
| `practice-run2` | 21:19:18 | 63 | 5829 | 55 | 0.153 | 3653 | 4598 | 3070 |
| `practice-run3` | 21:20:21 | 54 | 5805 | 51 | 0.295 | 3452 | 4873 | 2983 |

Redacted JSON: [`lighthouse/`](lighthouse/) (`<page>-run<n>.json`).

### 2.3 Rejected runs

Reported batch: 12 attempts were rejected and rerun, from the runner logs. `/`: 1 (`/_vercel/insights/script.js` aborted, status -1). `/login`: 2 (one "unable to reliably load the page", one `NO_FCP`). `/dashboard`: 2 (one each of the same). `/practice`: 7 (three `NO_FCP`; four proxy 502s, on `/favicon.ico`, `/api/me/streak` and two `/assets/*` chunks). None of these reached production as an error (§0, item 3). An earlier batch of 12 was discarded whole: stale Chrome processes from timed-out attempts were still holding the debugging port, and the "signed-out" `/login` runs attached to one of them and landed signed in on `/dashboard`. The runner was then changed to use a random free port per run, verify that the port answers from the browser it had just started, kill that browser on every exit path, and reject any run whose final URL is not the requested one. Only the second batch is reported.

### 2.4 Render-blocking resources (the UI-12 baseline)

The same four on every page (`render-blocking-insight`):

1. `https://lyceon.ai/assets/index-CaEjPTTn.css`
2. `https://replit.com/public/js/replit-dev-banner.js`
3. `https://fonts.googleapis.com/css2?family=Architects+Daughter&family=DM+Sans…` (one stylesheet requesting 25 families)
4. `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins…`

### 2.5 Paid `/dashboard`: Karl's run (pending)

Script:

1. In Chrome, open a new **Incognito** window (Ctrl+Shift+N, or Cmd+Shift+N on a Mac). Incognito starts without extensions or cached files.
2. Go to `https://lyceon.ai/login` and sign in with your **paid** student account. Wait until `/dashboard` has fully loaded.
3. Open DevTools (F12, or Cmd+Option+I) and choose the **Lighthouse** tab (under `»` if hidden).
4. Set **Mode: Navigation**, **Device: Mobile**, **Categories: Performance only**. Leave everything else at its defaults.
5. Click **Analyze page load** and do not touch the window until the report appears.
6. Send back: the date and time, the **Performance** score, **Largest Contentful Paint**, **Total Blocking Time** and **Cumulative Layout Shift**. If you have time, run it three times and send all three; the median is recorded.

---

## 3. UI-00b: API timing

### 3.1 Bundle size

Built locally from the production commit (`git worktree` at `682c71c3`, `pnpm install --frozen-lockfile`, `pnpm -s run build:vercel`, Node 22.22.2):

```
dist/vercel-api.cjs  5.4mb ⚠️          (esbuild summary)
$ du -b dist/vercel-api.cjs
5618816 dist/vercel-api.cjs
$ gzip -9c dist/vercel-api.cjs | wc -c
1109294
```

5,618,816 bytes (5.36 MiB) unminified CJS, 1.11 MB gzipped. It is the only function: `vercel.json` routes `^/api(?:/.*)?$` and `/auth/callback` to `/api/index`, and `api/index.ts` is `import app from "../dist/vercel-api.cjs"`. This is a reproduction from the production commit, not the deployed artifact. The local client asset hashes differ from production's (build-time env), which does not affect the server bundle's structure.

### 3.2 Warm

All three endpoints are routes of the one function, so "warm" means requests to an instance that has already booted. Ten sequential requests per endpoint, signed in as the free test account, 21:21:24 to 21:21:58Z.

| Endpoint | Server `duration_ms` median (n) | Server range | Client TTFB median (through proxy) | Response size |
|---|---|---|---|---|
| `/api/profile` | **438 ms** (10) | 304 to 1582 | 0.64 s | 662 B |
| `/api/progress/kpis` | **548 ms** (10) | 479 to 831 | 0.74 s | 2,590 B (874 B br) |
| `/api/practice/sessions/open` | **193 ms** (8) | 174 to 217 | 0.37 s | 92 B |

Server-side `duration_ms` is the app's own `request` log event (`component: API`), read from Vercel runtime logs and matched to each client request by `x-request-id`. Raw data: [`ui00b-warm-server.txt`](ui00b-warm-server.txt) and [`ui00b-warm-client.txt`](ui00b-warm-client.txt). Two `sessions/open` log entries carried no body. The first `/api/profile` of the series took 1,582 ms with no boot lines, and the slow first request after idle repeats elsewhere in the logs (20:48:36, 2,349 ms; 20:54:44, 1,825 ms, which also loaded `tutor_context_runtime_config`). So the first request per instance pays a warm-up inside the handler, separate from the cold boot.

### 3.3 Cold

Production was idle for 21 minutes: the runtime logs show no request between 21:22:10 and 21:43:19Z. At 21:43:19Z, five concurrent signed-in requests went out: the three endpoints plus two more `/api/profile`. Raw data: [`ui00b-cold.txt`](ui00b-cold.txt).

| Endpoint | Client total (through proxy) | Server handler `duration_ms` | Warm server median (§3.2) |
|---|---|---|---|
| `/api/profile` (×3) | 3.52 s, 3.60 s, 3.61 s | 2042, 2050, 2037 | 438 |
| `/api/progress/kpis` | 3.79 s | 2185 | 548 |
| `/api/practice/sessions/open` | 3.39 s | 1891 | 193 |

Every one of the five requests carries its own boot block (`[API] Starting Lyceon API server…`, environment validation, `[SUPABASE-HTTP] Client initialized`), so five instances started. Timeline for the `/api/profile` request `e21d83de`: sent 21:43:19.27Z; the boot's environment check logged at 20.744Z; the handler ran about 20.78 to 22.83Z (2,042 ms, which includes loading `tutor_context_runtime_config` at 22.31Z); the client had the response at 3.52 s.

**Cold start, end to end: 3.4 to 3.8 s client-side against 0.37 to 0.74 s warm, about 3 s extra.** That splits into roughly 1.4 to 1.5 s from request to the end of the boot, plus a first-request handler of 1.9 to 2.2 s against 0.19 to 0.55 s warm. The two instances that booted during the burst in §3.4 ran their first handler in 338 and 375 ms after a boot of about 0.9 s, and came back in 1.85 s client-side. So the 2-second handler after the long idle is not intrinsic to a new instance; it looks like upstream warm-up after idle (Supabase auth and data calls), which is unverified from here. **Cold start is material:** after an idle period, the first dashboard load pays about 3 extra seconds on every API call it makes in parallel. UI-18 acts on this number.

### 3.4 Fluid compute

**Enabled, as observed from behavior.** The flag itself is not readable here: the Vercel tools' `get_project` and `get_deployment` return no `fluid` or `resourceConfig` field, the deployment has no file tree, and `vercel.json` has no `fluid` key, so any setting is at project level. The behavior test decides it:

- 30 s after the cold probe, with its 5 instances warm, 15 concurrent signed-in `GET /api/practice/sessions/open` were sent (21:43:50.65Z). The logs for 21:22:10 to 21:44:10Z contain exactly those 20 requests and nothing else.
- All 15 were handled at the same time: authenticated between 21:43:51.359 and 52.386Z, the 13 on warm instances between .359 and .542, with handlers of 399 to 600 ms against 174 to 217 ms sequential.
- Only **2** of the 15 carry a boot block. So 15 overlapping requests ran on at most **7** instances (5 warm + 2 new). Several instances served more than one request at a time, which only Fluid compute's in-function concurrency does; classic functions run one request per instance and would have booted at least 10.

Raw data: [`ui00b-fluid-burst.txt`](ui00b-fluid-burst.txt). Karl can confirm the setting in one look: Vercel → `lyceonai` → Settings → Functions → Fluid Compute.

---

## 4. UI-00c: compression and pooling

### 4.1 Compression (production response headers)

`curl` with `Accept-Encoding: gzip, deflate, br, zstd` and the free account's cookie, 2026-09-29 21:00:29Z. Full headers (set-cookie, `x-vercel-id`, date, HSTS and CSP lines omitted) are in [`ui00c-response-headers.txt`](ui00c-response-headers.txt).

| Endpoint | `content-encoding` | Body | `x-vercel-cache` |
|---|---|---|---|
| `/api/profile` | *(none)* | `content-length: 662` | MISS |
| `/api/progress/kpis` | **`br`** | 874 B on the wire, 2,590 B uncompressed (`Accept-Encoding: identity`) | MISS |
| `/api/practice/sessions/open` | *(none)* | `content-length: 92` | MISS |

For comparison, `/` (HTML) and `/assets/*.js` are served with `content-encoding: br`, and `/api/practice/topics` with `br`. **`/api/*` responses are compressed at the edge.** The compression is Vercel's, not the app's: at `682c71c3` there is no compression middleware in `server/` or `apps/api/src` (`grep -rnE "from ['\"]compression['\"]|require\(['\"]compression['\"]\)|shrink-ray|zlib\.create(Brotli|Gzip)"` returns nothing, and `compression` is not in `package.json`). The two uncompressed responses are the smallest bodies, 662 B and 92 B. The edge left them uncompressed on every request observed. Vercel's documentation, as searched here, does not state a size threshold, so the reason is unconfirmed; at these sizes compression would save a few hundred bytes at most.

### 4.2 Pooling

Answered in Step 2 and in UI-09 ([`../step2-wave1.md`](../step2-wave1.md) UI-09): every data query runs on the service-role supabase-js client (`apps/api/src/lib/supabase-server.ts:50`, used at `server/middleware/supabase-auth.ts:404`). `pg` is a devDependency used only by tests and scripts (`package.json:173`), and `DATABASE_URL` is optional and unused at runtime (`packages/shared/src/env.ts:33`, §8 F-13). Re-run against the production commit (`682c71c3`):

```
$ grep -rnE "from [\"']pg[\"']|require\([\"']pg[\"']\)|from [\"']postgres[\"']|new Pool\(|new Client\(|DATABASE_URL" server apps/api/src api packages/shared/src
server/.env.example:14:DATABASE_URL=
apps/api/src/config.ts:14:  // Database - Supabase only (no Neon/DATABASE_URL)
packages/shared/src/__tests__/guardian-student-schema.test.ts:27:import type { Client } from "pg";
packages/shared/src/__tests__/env.test.ts:38:    const env = parseEnv({ ...valid, GEMINI_API_KEY: "k", DATABASE_URL: "postgres://h:5432/db" });
packages/shared/src/__tests__/env.test.ts:40:    expect(env.DATABASE_URL).toBe("postgres://h:5432/db");
packages/shared/src/env.ts:33:  DATABASE_URL: z.string().url().optional(),
```

The hits are an example-env placeholder, a comment, the optional schema field, and tests. None is a runtime connection. The server opens no direct Postgres connection, so there is no pool to manage: supabase-js talks to Supabase's HTTP API, which pools on Supabase's side. Production agrees: the function boot logged at 2026-09-29 20:54:42Z (on `GET /api/csrf-token`) prints `[SUPABASE-HTTP] Client initialized` and no Postgres connection line.

---

## 5. Side observations (added to the register §8)

- **F-27:** authenticated `/api/*` responses carry `cache-control: public, max-age=0, must-revalidate`, for example `/api/profile`, which is per-user. Vercel does not cache them (`x-vercel-cache: MISS`), but `public` allows any shared cache between the browser and Vercel to store per-user bodies.
- **F-28:** the production CORS allowlist, printed at every boot, includes `http://localhost:5000`, `http://localhost:3000`, `http://localhost:5173` and a `*.kirk.replit.dev` workspace origin next to `https://lyceon.ai` and `https://www.lyceon.ai`.
