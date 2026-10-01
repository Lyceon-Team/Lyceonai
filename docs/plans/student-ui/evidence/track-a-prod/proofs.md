# Track A: production proofs (Brief 9)

Measured 2026-10-01 against `https://lyceon.ai`, in a full-network session. Register: [`student-ui-vertical.md`](../../student-ui-vertical.md) §6 and §8.

## 0. What was measured

- **Production deployment:** `dpl_yLMAZFM2kPTybJ3gGQTZb9uMKPJ2`, target `production`, region `iad1`, built from `main` @ `4097e2e7` ("Merge pull request #984 from Lyceon-Team/cleanup"), ready 2026-10-01 03:49 UTC. Its aliases include `lyceon.ai` and `www.lyceon.ai` (Vercel `get_deployment`). Every check in §1 and the Lighthouse runs (03:49–04:28 UTC) were served by it; the runtime log lines quoted for them carry `dep=dpl_yLMAZFM2kPTybJ3gGQTZb9uMKPJ2`. **The UI-18 cold probe is the exception:** `main` moved during its idle window, and it ran on `dpl_J3hLQkZCfP64c1EibTAWKce2TaZE` (`main` @ `fc6fb851`, a descendant of `4097e2e7`; §2). Independent check: production `/` no longer serves `replit-dev-banner.js` (UI-12), which the Wave 0 deployment did.
- **Test accounts** (free, created through the normal `/login` → Sign Up form, then `/profile/complete` as Student with an invented date of birth giving age 16; passwords generated in the session scratchpad and recorded nowhere):
  - `lyceon-qa-student-ui-free-20261001@example.com`: general checks. Signup `POST /api/auth/signup` → 201, `PATCH /api/profile` → 200, landed on `/dashboard`.
  - `lyceon-qa-student-ui-f32-20261001@example.com`: the F-32 deletion test. Same flow. It is now pending deletion (requested 04:18:48 UTC); it hard-deletes after the 7-day grace unless cancelled.
  - Both are listed in the register header and in UI-63 for deletion at close.
- **No production data was changed** beyond creating these two accounts and the F-32 deletion request on the second one. The calendar denial was taken on a route that refuses before it reads the body (`POST /api/calendar/plan/regenerate`, `entitled()` first), so nothing was written. No practice, review, LISA or exam session was started.
- **Tooling (session only, not repo dependencies):** Chromium 141.0.7390.37 (pre-installed Playwright build), playwright-core 1.63.0, Lighthouse 12.8.2, chrome-launcher 1.2.2 and puppeteer-core 24.43.1, installed into the session scratchpad. `package.json` is unchanged.

### Network constraints (as in Wave 0)

1. **Egress proxy.** Chromium's traffic is re-terminated by the session's egress gateway (`Egress Gateway SDS Issuing CA (production)`). Chromium trusted that one CA by SPKI pin (`--ignore-certificate-errors-spki-list=<sha256 of the sandbox-egress-gateway-production CA key>`); no other certificate error is ignored. curl reaches `lyceon.ai` with its real Let's Encrypt chain (`YR1` → `ISRG Root YR`).
2. **Host allowlist.** Chromium ran with a PAC file that sends only `lyceon.ai` (and subdomains), `fonts.googleapis.com`, `fonts.gstatic.com` and `*.supabase.co` through the proxy, and every other host to a dead port. Background networking, sync, component update and pings were disabled by flag. Every page load observed contacted only `lyceon.ai`, `fonts.googleapis.com` and `fonts.gstatic.com`.
3. **Cookies and tokens.** API checks ran through the signed-in browser context's own request client, so the session cookie stayed in the browser and was never written to a file or printed. Lighthouse's signed-in runs put the cookies into the fresh profile's jar for `lyceon.ai` only (CDP `Storage.setCookies`), as in Wave 0. The cold probe held its session in memory in one process for the whole idle window.
4. **Redaction.** In the raw files here the test account's id, email, username and date of birth are replaced by placeholders. The Lighthouse JSON has its thumbnail images removed (as in Wave 0) and was scanned for the account's id and email, JWTs, `sb-*-auth` cookie names, `access_token`/`refresh_token` and `@example.com`: no hits.

---

## 1. Free-account checks

Raw output: [`api-checks.txt`](api-checks.txt), [`cal-deny.txt`](cal-deny.txt), [`browser-checks.txt`](browser-checks.txt), [`f28-preflight.txt`](f28-preflight.txt), [`f32.txt`](f32.txt).

### UI-01: entitlement denials (free account, 04:15 UTC)

| Surface | Request | Status | Body |
|---|---|---|---|
| Exam | `GET /api/tests/forms` | **403** | `{"error":{"code":"entitlement_required","message":"Full-length exams need an active subscription.","details":{"feature":"exam_full_length"}},"requestId":"ef4c95f8-…"}` |
| Calendar | `POST /api/calendar/plan/regenerate` | **402** | `{"error":"Subscription required","code":"entitlement_required","message":"An active subscription is required to see this.","details":{"feature":"calendar_access"},"requestId":"d460a81f-…"}` (flat shape) |
| LISA | `GET /api/tutor/conversations` | **403** | `{"error":{"message":"An active entitlement is required to use the tutor.","code":"entitlement_required","details":{"feature":"tutor_access"}}}` |
| Mastery | `GET /api/students/<own-id>/mastery/domains` | **402** | `{"error":"Subscription required","code":"entitlement_required","message":"An active subscription is required to see this.","details":{"feature":"mastery_detail"},"requestId":"3f0dc736-…"}` |

`GET /api/calendar` for this account returns **200** `{"status":"setup_required", …, "entitled":false}`: the account has no study profile, and setup renders before the gate (SCL-130, `calendar-routes.ts:496-530`). That is the ruled behavior, so the calendar denial is shown on a gated route instead.

### UI-03: return path

Signed out, opened `/calendar` → `/login?next=%2Fcalendar`. Signed in → **`/calendar`** (the setup popup renders; [screenshot](screenshots/ui03-calendar-after-signin.png)).

### UI-04: `/tutor`

Signed in: `/tutor` → **`/chat`**. Signed out: `/tutor` → `/login?next=%2Fchat`.

### UI-05, UI-06: deleted routes (signed in, CSRF token sent on POSTs)

All **404**:
- `GET /api/questions`, `/recent`, `/random`, `/count`, `/feed`, `/api/questions/SATMATH000001`, plus `POST /api/questions/feedback`.
- `GET /api/auth/debug`, `/api/legal/acceptances`, `/api/billing/publishable-key`, `/api/account/status`, `/api/health/practice`, `/api/_whoami`.
- `POST /api/auth/admin-provision`, `/api/legal/accept`, `/api/account/select`.

GETs answer `{"error":"API endpoint not found"}`. POSTs answer Express's default HTML `Cannot POST …` page (§8 F-42). Controls in the same session: `GET /api/health` → 200 `{"status":"ok"}`; `GET /api/progress/kpis` → 200.

### UI-07: bank counts

`GET /api/questions/stats` as the student → **403** `{"error":"Admin access required","message":"You do not have permission to access this resource",…}`. `/practice` ([screenshot](screenshots/ui07-ui1a-practice.png)) shows no bank count. The section buttons and the Domain Library carry no numbers. The only "N questions" strings on the page are the session-size selector ("10 questions"). On `/dashboard` they are "0 questions solved this week" (own activity) and the diagnostic's length ("40 questions").

### UI-1A: no raw accuracy figure

Rendered text of `/dashboard` (1,850 chars) and `/practice` (2,191 chars): no `%` figure and no "accura…" string ([dashboard](screenshots/ui1a-dashboard.png), [practice](screenshots/ui07-ui1a-practice.png)). The absence is meaningful on an empty account: the Wave 0 code rendered the "Accuracy (7d)" and "Accuracy" labels whatever the data (`682c71c3`, `lyceon-dashboard.tsx:251-252`, `practice.tsx:871`), and neither label is on the page now. A percentage would only ever have shown with answered questions, and no runner was opened (starting a session writes data), so the runner pill is not covered here.

### UI-14: one `/dashboard` load (04:17:11 UTC)

37 requests, hosts `lyceon.ai`, `fonts.googleapis.com`, `fonts.gstatic.com`. API requests, each **once**: `GET /api/csrf-token`, `/api/notifications/unread-count`, `/api/profile`, `/api/progress/kpis`, `/api/progress/projection`. Duplicates: 0.

### UI-16: cursors

- `GET /api/review/pool?tz=America/New_York` → 200 `{"total":0,…,"sessions":[],"sessions_next_cursor":null}`: the cursor field is on the live response, `null` for an empty list.
- `GET /api/tutor/conversations` → 403 for the free account (UI-01).
- A page 2 needs more than one page of data: more than 20 review source sessions (`REVIEW_POOL_SESSIONS_PAGE_SIZE = 20`), or at least two LISA conversations with `?limit=1`. A fresh free account has neither, and creating it would change production data, so page 1 ≠ page 2 goes to Karl's script (§3, item 4).

### F-27: cache-control

`GET /api/profile` (signed in) → `cache-control: private, no-store`. Every other `/api` response whose headers were recorded ([`api-checks.txt`](api-checks.txt), [`cal-deny.txt`](cal-deny.txt)) carries the same header, including the 402, 403 and 404 responses.

### F-28: CORS

Preflight `OPTIONS /api/profile` with `Access-Control-Request-Method: GET`, 04:16 UTC:

| Origin | Status | `access-control-allow-origin` |
|---|---|---|
| `https://lyceon.ai` (control) | 204 | `https://lyceon.ai` |
| `https://www.lyceon.ai` (control) | 204 | `https://www.lyceon.ai` |
| `http://localhost:5173` | 401 | **absent** (no `access-control-*` header at all) |
| `http://localhost:5000` | 401 | **absent** |
| `http://localhost:3000` | 401 | **absent** |

Boot log on this deployment (Vercel runtime logs, e.g. 04:13:38 and 04:01:44 UTC): `[CORS] Allowed origins (raw): [ 'https://lyceon.ai', 'https://www.lyceon.ai' ]`.

### F-29: masked recipient (side evidence)

The deletion-scheduled email for the F-32 account logged `"recipientProfileId":"22bd87e8"` (digested) and no address in any form (`email_send_rejected`, `deletion_scheduled_email_failed`, 04:18:49 UTC). Resend refused the send with 422, as expected for a reserved `example.com` address.

### F-32: deletion revokes every session (04:18 UTC)

Deletion-test account, two separate browser contexts (no shared cookies), both signed in (`POST /api/auth/signin` → 200 each).

1. Presence: context B `GET /api/profile` → **200** `authenticated=true`.
2. Context A, through the product UI (`/profile?tab=settings` → Delete account → type `DELETE` → confirm): `POST /api/account/delete` → **200** at 04:18:48.223Z (`x-request-id 0ee76b6c-651b-445e-9eba-13ef0c6ad247`). Server log for that request: `user_authenticated`, then `requested` ("User requested account deletion (v2 soft-delete)"), then `POST /delete 200` in 592 ms, with **no `signout_best_effort_failed` line**, so the revoke call succeeded. Context A's own redirect landed on `/login` (it is signed out too: the `'global'` scope; §8 F-44).
3. Context B, next refresh (`reload` of `/dashboard` at 04:18:56): `GET /api/profile` → **401**, landed on **`/login?next=%2Fdashboard`** ([screenshot](screenshots/f32-context-b-after-refresh.png)). A direct `GET /api/profile` from B afterwards → 401 `Authentication required`. B's cookie jar for `lyceon.ai` then holds only `__Host-csrf` (the Supabase auth cookies are gone).

---

## 2. Performance

### UI-18: cold start

Wave 0 method ([`wave0-baseline.md`](../wave0/wave0-baseline.md) §3.3): free account, five concurrent signed-in requests after a quiet window. Raw: [`ui18-cold.txt`](ui18-cold.txt).

- **Quiet window.** Project-wide runtime logs show no function request from 04:54:12Z, this session's sign-in, whose page was closed straight after so the session lived only in the process's memory, to 05:15:04Z. At 05:15:04Z there is one cron, `POST /api/internal/crisis-sla-sweep`, on the new deployment. Then nothing until the probe at **05:22:00Z**.
- **Deployment.** `main` moved during the window: `dpl_6NnvoQWwuEWBDBYdwiy8V7Knsuot` (`49c5644a`, a Dependabot `uv` bump) and then `dpl_J3hLQkZCfP64c1EibTAWKce2TaZE` (`fc6fb851`, "Merge branch 'guardian' into main") went to production at about 05:15–05:17Z. All five probe requests were served by `dpl_J3hLQkZCfP64c1EibTAWKce2TaZE`. `fc6fb851` descends from `4097e2e7`, and `package.json` (the minified `build:vercel` command) and `vercel.json` are identical between them, so the function bundle is built the same way.
- **Cold.** Each of the five requests logged its own boot block (`[API] Starting Lyceon API server…`, environment validation, `[SUPABASE-HTTP] Client initialized`), so five instances started.

| Endpoint | Client total (through the proxy) | Handler `duration_ms` | UI-00b client | UI-00b handler |
|---|---|---|---|---|
| `/api/profile` (×3) | **2.92 s, 2.93 s, 2.95 s** | 1612, 1470, 1479 | 3.52, 3.60, 3.61 s | 2042, 2050, 2037 |
| `/api/progress/kpis` | **3.17 s** | 1582 | 3.79 s | 2185 |
| `/api/practice/sessions/open` | **2.75 s** | 1179 | 3.39 s | 1891 |

About **0.6 s faster** end to end, mostly in the handler's first run (about 0.4–0.7 s less). Boot to environment check is about 1.6–1.8 s after sending, against about 1.5 s in Wave 0, so the boot itself is not visibly faster through the proxy.

**Discarded attempt.** A first probe fired at 04:53:30Z (client 0.77–1.89 s) does not count. The probe process had left the post-sign-in `/dashboard` page open, and the dashboard refetches `/api/progress/kpis` every 60 s (`QUERY_FRESHNESS.kpis`, `lyceon-dashboard.tsx:117`). The free account's own requests, once a minute until 04:53:13Z, kept the function warm. The rerun closed the page before the quiet window.

### UI-60 (interim, "after Track A"): Lighthouse

Same method as UI-00a ([`wave0-baseline.md`](../wave0/wave0-baseline.md) §2): Lighthouse 12.8.2, mobile preset, Performance only, 3 accepted runs per page, fresh Chrome profile per run, `/dashboard` and `/practice` signed in as the free account via the profile's cookie jar. Runs were rejected for a failed request, a ≥400 response other than the signed-out `/api/profile` 401, a runtime error, or a final URL different from the requested one; **none was rejected** this time. Every accepted run's final URL is the requested page.

**Read the numbers with the benchmark beside them.** Lighthouse's simulated 4× CPU slowdown is applied on top of the host. This container's benchmark index was about **1,150–1,650**, against about **2,600–3,070** in Wave 0, so the host was roughly half as fast. That inflates TBT and depresses the Performance score here relative to Wave 0. LCP, FCP and CLS are dominated by the simulated network and are the fairer comparison. Karl's DevTools run (§3, item 3) is the reference without the proxy.

| Page | State | Performance | LCP | TBT | CLS | FCP | Benchmark index (3 runs) |
|---|---|---|---|---|---|---|---|
| `/` | signed out | **77** (UI-00a 84) | **3.02 s** (3.28) | **375 ms** (149) | **0.080** (0.022) | 2.60 s (3.20) | 1168, 1605, 1607 |
| `/login` | signed out | **80** (82) | **3.76 s** (3.74) | **82 ms** (20) | **0.001** (0.001) | 3.63 s (3.16) | 1586, 1528, 1148 |
| `/dashboard` | free account | **72** (58) | **3.90 s** (5.59) | **198 ms** (11) | **0.178** (0.193) | 2.62 s (3.38) | 1641, 1619, 1576 |
| `/practice` | free account | **74** (61) | **3.90 s** (5.81) | **118 ms** (51) | **0.188** (0.188) | 2.62 s (3.52) | 1646, 1541, 1577 |

Median of 3 per metric; UI-00a values in brackets.

Per run:

| Report | Fetch time (UTC) | Perf | LCP ms | TBT ms | CLS | FCP ms | Speed Index ms | Benchmark |
|---|---|---|---|---|---|---|---|---|
| `home-run1` | 04:20:28 | 77 | 2978 | 485 | 0.073 | 2561 | 2561 | 1168 |
| `home-run2` | 04:21:24 | 72 | 3859 | 307 | 0.080 | 3566 | 3566 | 1605 |
| `home-run3` | 04:22:18 | 80 | 3020 | 375 | 0.080 | 2597 | 2597 | 1607 |
| `login-run1` | 04:23:26 | 80 | 3760 | 82 | 0.001 | 3628 | 3628 | 1586 |
| `login-run2` | 04:24:20 | 79 | 3826 | 114 | 0.001 | 3656 | 3656 | 1528 |
| `login-run3` | 04:25:15 | 85 | 3320 | 67 | 0.001 | 3199 | 3199 | 1148 |
| `dashboard-run1` | 04:26:17 | 68 | 4015 | 307 | 0.178 | 2621 | 3307 | 1641 |
| `dashboard-run2` | 04:26:27 | 72 | 3904 | 198 | 0.183 | 2624 | 3314 | 1619 |
| `dashboard-run3` | 04:26:37 | 76 | 3766 | 77 | 0.176 | 2649 | 3205 | 1576 |
| `practice-run1` | 04:26:57 | 78 | 3743 | 107 | 0.153 | 2651 | 2651 | 1646 |
| `practice-run2` | 04:27:08 | 74 | 3895 | 118 | 0.188 | 2624 | 2624 | 1541 |
| `practice-run3` | 04:27:18 | 71 | 3934 | 233 | 0.188 | 2616 | 2616 | 1577 |

Redacted JSON: [`lighthouse/`](lighthouse/) (`<page>-run<n>.json`).

**Render-blocking (UI-12), every page, every run:** two items, down from four in Wave 0:
1. `https://lyceon.ai/assets/index-CKufJhu7.css`
2. `https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,100..900;1,100..900&family=Poppins:…&display=swap` (Inter and Poppins only)

`replit-dev-banner.js` and the 25-family Google Fonts stylesheet are gone. The list is not empty.

**Bytes from `lyceon.ai` (run 1 of each page, `network-requests`; transfer / decoded):**

| Page | Scripts now | Scripts UI-00a | Stylesheets now | Stylesheets UI-00a |
|---|---|---|---|---|
| `/` | 241,319 / 781,304 B (2 files) | 254,511 / 830,257 B (2) | 17,610 / 108,049 B | 29,337 / 160,775 B |
| `/login` | 241,322 / 781,304 B (2) | 254,511 / 830,257 B (2) | 17,609 / 108,049 B | 29,337 / 160,775 B |
| `/dashboard` | 303,175 / 945,215 B (24) | 296,999 / 929,517 B (15) | 17,609 / 108,049 B | 29,337 / 160,775 B |
| `/practice` | 319,851 / 982,644 B (32) | 328,970 / 993,203 B (27) | 17,632 / 108,049 B | 29,337 / 160,775 B |

The entry bundle that every page loads first is 13.2 KB smaller on the wire, and the main stylesheet is 11.7 KB smaller (the KaTeX CSS left it, UI-11). `/dashboard` now loads more, smaller chunks (24 against 15), for 6.2 KB more script in total.

**Image audits on `/` (UI-13):** `modern-image-formats`, `uses-optimized-images`, `uses-responsive-images`, `offscreen-images`, `unsized-images` and `image-delivery-insight` all score 1 with no items, in all three runs.

**`unminified-javascript` (F-30):** score 1, no items, in all 12 runs.

---

## 3. Paid account: Karl's manual script

Use your **paid student** account. Please report the date and time and what you saw for each item.

1. **UI-01, allow side.** In a normal Chrome window, signed in:
   1. Open `https://lyceon.ai/tests`. The practice-test list loads, with no "couldn't load" message and no upgrade prompt.
   2. Open `https://lyceon.ai/calendar`. Your plan renders (week grid with blocks), with no premium gate.
   3. Open `https://lyceon.ai/mastery`. The domain cards render.
   4. Open `https://lyceon.ai/chat`, start a conversation and send one message. LISA replies.
2. **UI-19, seven-segment report.**
   1. Open a completed practice test's report (`/tests` → a completed test → its report, `/tests/<id>/report`).
   2. Open the **Score breakdown** tab. Each domain shows **seven segments**, and no "N of M" or "correct" count appears anywhere on the page.
   3. DevTools (F12) → **Network** → reload → click the `report` request → **Response**. Each row of `domain_segments` has `segments_filled` (0–7) and no `correct` or `total`.
3. **UI-60 interim, paid `/dashboard` Lighthouse.**
   1. Open a new **Incognito** window (Ctrl+Shift+N, or Cmd+Shift+N on a Mac) and sign in to the paid account. Wait until `/dashboard` has fully loaded.
   2. DevTools (F12, or Cmd+Option+I) → **Lighthouse** tab (under `»` if hidden).
   3. **Mode: Navigation**, **Device: Mobile**, **Categories: Performance only**. Leave everything else at its defaults.
   4. Click **Analyze page load** and do not touch the window until the report appears.
   5. Send back the **Performance** score, **LCP**, **TBT** and **CLS**. If you can, run it three times and send all three; the median is recorded.
4. **UI-16 / F-01, LISA page 2.** You need at least two LISA conversations (item 1.4 makes one if needed). Same signed-in window:
   1. Open `https://lyceon.ai/api/tutor/conversations?limit=1`. Note the conversation `id` and copy `data.pagination.next_cursor`. `has_more` should be `true`.
   2. Open `https://lyceon.ai/api/tutor/conversations?limit=1&cursor=<the cursor you copied>`. Its conversation `id` is **different** from step 1's.
   3. Send back both ids (or just "different") and whether step 1 showed `has_more: true`. The cursor itself is opaque and safe to share, but you don't need to.
