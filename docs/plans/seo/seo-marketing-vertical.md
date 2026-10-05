# SEO & Marketing Vertical — Closure Plan

**Status:** open · **Started:** 2026-10-02 · **Branch:** `seo` (all repo work = PR → `seo`; Codex audits `seo`; Karl merges `seo → main` and applies SQL)
**Repo path:** `docs/plans/seo/seo-marketing-vertical.md` — this file is the running state-of-vertical record.
**Inputs:** CC read-only audit of `main` @ `59997248` (2026-10-02); prod read-only checks (Supabase, live site); keyword map `docs/marketing/keyword-map/lyceon-sat-keyword-map.xlsx` (+ source CSVs).

---

## 0. Public Disclosure Doctrine — governs everything in this vertical

*(Karl, 2026-10-02 — wording approved. Copied into CLAUDE.md so every PR is checked against it.)*

1. **Industry standard only.** Every public surface (pages, metadata, structured data, legal text, social, email, ads, reviews) uses the patterns, wording conventions and claim types the category already uses. Nothing bespoke. Set and forget.
2. **Nothing proprietary goes out.** Never describe, or publish anything that lets someone work out: mastery computation; the scoring formula, constants or score conversion; LISA's prompts, logic, personality or guardrails; question selection/adaptation logic; internal architecture; question-bank size or structure. Public copy describes outcomes generically ("tracks progress by skill"), never mechanisms.
3. **General facts cite real sources.** Any statement about the SAT, scores, tutoring or studying cites a credible external source (College Board, published research, established publishers). Nothing invented.
4. **Proof stays internal.** Claim support, compliance reasoning and test evidence live in an internal register (`docs/compliance/`). Nothing is published as "evidence".
5. **Karl's approval gate.** Anything beyond generic — Lyceon-specific claims, outcome/performance claims, comparisons, statistics from our own data, anything pointing at a proof — needs Karl's written approval before publishing.
6. **Legal text** = standard industry clauses proposed for counsel to accept or tighten. No bespoke legal mechanisms.
7. **Under-13 users are excluded** from all marketing, analytics, email, reviews and public data.
8. **Compliant by default.** No spam patterns: no keyword stuffing, doorway/city pages, thin templated pages, review gating, fake or incentivised reviews, or synthetic people presented as real.

---

## 1. Rulings log — 2026-10-02

### Scope & positioning
| # | Ruling |
|---|---|
| R1 | Vertical covers technical SEO, AI-search visibility, content engine, social, email, paid, funnel/attribution — all in scope, prioritized by dependency and severity. Correct tool wiring is part of closure. Use available skills, plugins and connectors wherever they fit. |
| R2 | Audiences: parents and students, both. |
| R3 | Positioning: a cheaper, 24/7, consistent alternative to a traditional tutor, with guardian view and progress tracking before exam day. Not "LISA replaces a tutor". Competes with Kaplan/Princeton Review-type providers and live in-home tutors. Content frames to be A/B tested later. |
| R4 | Everything compliant, non-spam, best practice. Cheapest/free industry-standard tools first while pre-revenue; tools free at our scale are acceptable while unit economics hold. |
| R5 | Existing public pages may be fully rewritten. Homepage gets a full rebuild (clickable prototype on real data → Karl review → CC build). |

### Governance & spec
| # | Ruling |
|---|---|
| R6 | New spec doc **Doc 10A** (next available letter) owns public/marketing surfaces and the content engine; takes the "future Trust/Growth doc" role cited by Docs 01/02A/02B (SCL records it). |
| R7 | Public Disclosure Doctrine (§0) sits at the top of everything built in this vertical. |
| R8 | Proofs are internal only (screenshots, logs, prod queries, CI, manual walks — §2). Nothing public. |
| R9 | Doc 01 V8 is authoritative for Doc 10's references. `seo` row added to CLAUDE.md branch routing. |

### Technical foundation & analytics
| # | Ruling |
|---|---|
| R10 | Rendering fix = build-time prerender of public routes. |
| R11 | **PostHog** (free tier) on public pages, cookieless until consent, no `identify`, session replay per R32; Doc 07A server-side `emitEvent` for signed-in events incl. `user_signed_up.signup_source` from first-touch UTM; **Vercel Analytics retired**. SCL required (departs from Doc 07A §9.2/§9.3.1). **"Cookieless until consent" superseded by Karl's ruling, 2026-10-05 (G6 Step 0 answer 3):** nothing loads or sends before Accept, as built (`client/src/lib/analytics/posthog-client.ts:8-14`); Doc 10A draft §6.1. |
| R12 | Marketing data hub = PostHog (see §3). Supermetrics not kept beyond its trial. PostHog and BigQuery connectors added. |
| R12a | PostHog project settings: IP anonymization on, console-log capture off, cookieless mode on (stateful), timezone America/Chicago, session recording off. Applied 2026-10-02. **Superseded as a before-consent mode by Karl's ruling, 2026-10-05 (G6 Step 0 answer 3):** the project's cookieless setting stays as applied, but nothing runs before Accept, so it is not a before-consent analytics mode (Doc 10A draft §6.1). |
| R12b | Search Console bulk export lands in BigQuery `replit-cop`, location us-central1 (same as existing dataset). |
| R13 | Homepage hero A/B test removed; A/B testing returns later via PostHog experiments once traffic supports it. **Superseded for the homepage hero by Karl's ruling, 2026-10-05 (F13 Step 0 decision 6):** the PostHog experiment `homepage-hero` runs now, consent-gated, Variant A prerendered (SCL-213 IS 7). |
| R14 | Cookie banner and the missing legal artifacts are built **in this vertical**; legal text = industry-standard drafts for counsel. |
| R15 | Practice adaptivity happens via the study calendar (premium); the homepage claim is scoped to the paid plan. |

### Question of the Day
| # | Ruling |
|---|---|
| R16 | QOTD on the homepage, answerable without login; same rendering as practice, ungated. Pool = live `public.questions` minus retired and full-length test-form items. |
| R17 | Answer + pre-written explanation revealed on submit (not LISA); no free-quota charge; aggregate-only stats. The "% of students got this right" stat is approved and shown only once a day's question has at least 5 attempts. |
| R18 | One question per America/Chicago day, never repeated — enforced by a schedule table (`qotd_date` PK, `question_id` UNIQUE). |
| R19 | Abuse protection: Cloudflare Turnstile on submit + durable hashed-IP rate limit (SCL). |
| R20a | Public question exposure: the dated QOTD archive, plus each skill's public page may show up to 2 previous QOTD questions from that skill as a funnel. No other bank content goes public. |
| R20 | Reddit: owned subreddit, AI posting account and LISA public answering are post-launch. Other channels now; named-human r/SAT presence allowed. |

### Content, channels, email, paid
| # | Ruling |
|---|---|
| R21 | Content engine: quality first, no detectable AI markers in prose; synthetic people/voices/video labelled per platform rules; no fabricated testimonials or statistics. Karl approves briefs and publishing; automation increases after 3 consecutive approvals with no pushback. |
| R22 | AI CMO works with humans in Slack (Claude Tag). |
| R23 | Keyword map built from Karl's Keyword Planner export; saved in the repo and Google Drive. No city/near-me pages. Public score calculator dropped (doctrine rule 2). |
| R24 | Competitor comparison pages: later, with substantiation. |
| R25 | Social channels: X, Instagram, TikTok, Facebook, YouTube, Threads. Video faceless for now; on-camera is post-launch. `/brag` video via CC with script approved by Karl before production. |
| R26 | Marketing email bucketed by audience (student / guardian). Opt-in: own checkbox at signup, Settings toggle, reset bug fixed; guardians + students 13+; never under-13. |
| R27 | Paid: ~$100 across platforms to start (not hardcoded anywhere); parent targeting only. |

### Reviews & social proof
| # | Ruling |
|---|---|
| R28 | One neutral review prompt for everyone — no review gating. Options side by side: in-app anonymous review (all users 13+, bucketed student/guardian), Trustpilot (guardians + 18+; Trustpilot requires reviewers 18+), private feedback (always available). |
| R29 | Testimonials only from opted-in reviews, anonymous, labelled as testimonials, bucketed student/guardian; no first-party aggregate rating. |
| R30 | Review cadence = industry standard: success moments only, never during practice or exams, max once per 120 days, stop after a review or 2 dismissals, always dismissible. |
| R31 | Removed/parked by doctrine: `/trust/evidence`; Doc 10 §6 public counters. Average score improvement (baseline → projection → reported actual) is post-launch, with real data, n≥100, Karl-approved. |

### Analytics, session replay & FERPA (2026-10-02)
| # | Ruling |
|---|---|
| R32 | PostHog product analytics + session replay on PostHog's standard defaults (amends R11 and R12a; SCL G9 against Coding Standards §12.2, Doc 07E §10.2 and Doc 06A §5). Purpose: entry points, clicks, dead ends, drop-off. Scope: public and signed-in pages. The one standard exception: `ph-no-capture` on the question/answer area (practice, review, full-length exam) and on the LISA conversation, per Coding Standards §12 (student answers and tutor content are never captured); nothing else masked beyond defaults. Starts only after cookie consent; under-13 excluded; disclosed in the Privacy and Cookie Policies; PostHog DPA accepted. Nothing beyond industry standard. |
| R33 | School and after-school sales are in scope, so FERPA applies. Industry standard: sign the school's student data privacy agreement (SDPC National DPA is the common template) and operate within it. |

---

## 2. Proof standard (internal only)

Nothing closes on a merged PR or green CI alone. Every item names its proof before work starts; proof output is pasted into §9 when the item closes.

| Proof type | Code | Produced by | Example |
|---|---|---|---|
| Production HTTP check | **HTTP** | Claude (live `curl`) or CC script | `curl -A "OAI-SearchBot" https://lyceon.ai/blog/x` → own title, self-canonical, body text, status code |
| Production DB catalog / data query | **DB** | Claude (Supabase read-only) | constraint exists; zero overlap with `test_form_items` |
| Vercel runtime/build logs | **LOG** | Claude (Vercel connector) | route returns 200/404/429 as specified; no runtime errors after deploy |
| CI run | **CI** | CC | named test/gate green on `seo`, plus a planted mutation that turns it red |
| Screenshot | **SHOT** | Karl or CC | external consoles (Search Console, Bing, PostHog, Trustpilot, Turnstile), UI states |
| Manual walk | **WALK** | Karl | click-through in prod, observed result recorded |
| Connector read | **READ** | Claude | Claude reads the tool's data via its connector (proves wiring and access) |

---

## 3. Tool stack (free at our scale)

| Need | Tool | Cost basis | Claude/CC access |
|---|---|---|---|
| Product + web analytics, experiments, feature flags | PostHog | Free tier: 1M events, 5K recordings, 1M flag requests/month | PostHog connector |
| Marketing data hub (ad spend, campaigns, conversions) | PostHog Marketing Analytics + data warehouse sources: Google Ads, Meta Ads, TikTok Ads, Reddit Ads, LinkedIn Ads, Bing Ads | Warehouse row-sync allowance to verify before connecting | PostHog connector |
| Search Console data | GSC bulk export → BigQuery (Doc 07B warehouse), read by PostHog as a BigQuery source | GSC export free; BigQuery within free tier at our size (verify) | BigQuery connector + PostHog |
| Bing Webmaster data | Bing Webmaster Tools console | Free | Screenshots |
| Hosting, logs | Vercel | Current plan | Vercel connector |
| Database | Supabase | Current plan | Supabase connector (read-only) |
| Email | Resend | Current plan | Resend connector |
| Abuse protection | Cloudflare Turnstile | Free | none needed |
| Public reviews | Trustpilot | Free plan | Screenshots |
| AI CMO workspace | Slack + Claude Tag | Current plan | Slack connector |
| Keyword research | Google Ads Keyword Planner | Free | CSV exports |

---

## 4. External platforms — wiring & access

| Platform | Purpose | Account owner | Wiring proof |
|---|---|---|---|
| Google Search Console | Indexing, queries, AI-surface impressions | Karl | DNS TXT verified (SHOT); bulk export landing in BigQuery (READ) |
| Bing Webmaster Tools | Indexing (feeds ChatGPT search) | Karl | Imported from GSC, sitemap processed (SHOT) |
| PostHog | Analytics + marketing hub | Karl | Prod pageview + real signup with `signup_source` (SHOT/READ); ad source synced (READ) |
| BigQuery | GSC export landing | Karl | Export tables populated (READ) |
| Vercel | Hosting, headers, logs | Karl | Deploy READY; headers present (HTTP/LOG) |
| Supabase | QOTD, reviews, opt-in data | Karl (applies SQL) | Catalog + data checks (DB) |
| Cloudflare Turnstile | QOTD abuse protection | Karl (creates keys) | Submit without token rejected (HTTP/LOG) |
| Resend | Marketing email lane (Wave 4) | Karl | Test broadcast + one-click unsubscribe (SHOT/READ) |
| Trustpilot | Public reviews (18+) | Karl | Business profile claimed; invite received in test account (SHOT) |
| Slack + Claude Tag | AI CMO workspace | Karl | Thread: idea → brief → draft → approval (SHOT) |
| Google Ads / Meta Ads | Paid test (Wave 5) | Karl | Campaign live, parent targeting; spend visible in PostHog (SHOT/READ) |
| Social: X, Instagram, TikTok, Facebook, YouTube, Threads | QOTD distribution | Karl | Scheduled post published (SHOT) |
| Discord | Community (Doc 10 §8.5 V1) | Karl | Server live with channel structure (SHOT) |
| Reddit | Named-human r/SAT now; API app + subreddit post-launch | Karl | n/a until post-launch |

Secrets are created and stored by Karl only. No secret value appears in chat, PRs, logs or this file.

---

## 5. Waves

Tracks without a dependency run in parallel. A new finding becomes a new row with its own proof — it is not fixed on discovery (exception: active harm).

### Wave 0 — Governance (parallel with Wave 1)

| ID | Item | Proof |
|---|---|---|
| G1 | SCL: Doc 10A owns public/marketing surfaces (R6) | SCL entry in register |
| G2 | SCL: PostHog on public pages, Vercel Analytics retired (R11) | SCL entry; `@vercel/analytics` absent from build (CI) |
| G3 | SCL: anonymous-endpoint rate limiter (R19) | SCL entry |
| G4 | SCL: Doc 10 §6 public counters parked; `/trust/evidence` removed (R31) | SCL entry |
| G5 | Doctrine (§0) added to CLAUDE.md; `seo` row added to branch routing | File on `main` |
| G6 | Doc 10A pre-draft Q&A → draft → review → lock. Q&A answered 2026-10-05; draft at `docs/plans/seo/doc-10a-draft.md` (agents cannot write `docs/Spec/`; Karl moves it at lock, answer 1) | Locked doc in Spec folder |
| G7 | Legal drafts for counsel: Cookie Policy, Cookie Banner text, Children's Online Privacy Notice, AI Content Disclosure, CA Notice at Collection, CA Do-Not-Sell/GPC, Marketing Communications Consent, privacy policy update (PostHog replaces Vercel Analytics) | Published under `/legal/*`; counsel sign-off recorded internally (HTTP + register) |
| G8 | Internal compliance register `docs/compliance/` created | File on `main` |
| G9 | SCL: PostHog session replay per R32 — against Coding Standards §12.2, Doc 07E §10.2 and Doc 06A §5 | SCL entry in register |

### Wave 1 — Foundation

| ID | Item | Proof |
|---|---|---|
| F1 | Build-time prerender of every public route; per-route title, description, self-canonical, OG, JSON-LD (fix logo URL, drop SearchAction, FAQ schema = visible FAQ) | HTTP script over every sitemap URL as Googlebot + OAI-SearchBot, no JS: unique title, self-canonical, body text; script in CI |
| F2 | Real 404 status for unknown paths and unknown blog slugs | HTTP: 404 in prod |
| F3 | Sitemap generated from route registry with real `lastmod`; robots cleaned; 3 missing legal docs included | CI two-way parity; SHOT: GSC sitemap "Success" |
| F4 | Dead Express SSR path and the tests pinning it deleted | CI: grep zero refs; new tests on prerendered output |
| F5 | CSP + HSTS on static HTML via `vercel.json` (CTO-owned) | HTTP: `curl -I` shows headers |
| F6 | False/stale public claims corrected (digital-sat FAQ, "unlimited", free tutor CTA, unsourced "35%", OG image text, "difficulty adjusts" scoped to paid); internal claim inventory per doctrine | Internal inventory (each claim: doctrine category + source); CI check extended to all public pages |
| F7 | Hero A/B test removed (R13) | CI/Playwright: first visit writes no storage |
| F8 | Fonts trimmed to used weights; logo compressed; `maximum-scale` removed | Lighthouse mobile on 4 prod pages: Perf ≥90, SEO 100, A11y ≥95 (SHOT). **Targets raised by Karl's ruling, 2026-10-05 (G6 Step 0 answer 4):** Perf ≥90; Accessibility, Best Practices and SEO 100; manual evidence per release, no CI gate (Doc 10A draft §4.7). |
| F9 | GSC + Bing verified (DNS TXT), sitemap submitted; GSC bulk export → BigQuery | SHOT both consoles; READ export tables |
| F10 | PostHog per R11; server-side `emitEvent` per Doc 07A incl. `signup_source` (first-touch UTM); under-13 excluded | SHOT/READ prod signup with source; CI `ci/event-schema-registry-parity` + `ci/pii-redaction-conformance`; under-13 test |
| F11 | Cookie banner per Doc 10 §9.11 (equal accept/refuse, granular, 6-month memory, GPC = refuse, consent log) | Playwright: refuse → zero analytics requests; GPC → refuse; consent row (CI + DB) |
| F12 | `infra/route-surface-classification.yaml` (Doc 06A §5.3.1) | CI fails on unregistered route |
| F13 | Homepage rebuild (R5): prototype → Karl review → CC build; QOTD slot; diagnostic CTA | WALK + SHOT; HTTP prerender check |
| F14 | `/trust/evidence` removed / folded into generic trust page | HTTP: 404 or redirect; not in sitemap |
| F15 | PostHog replay per R32, behind F11 | CI shows no capture before consent or for under-13; SHOT of PostHog receiving pageviews and a replay; SHOT of a real practice replay with the question/answer area blank |

### Wave 2 — Funnel, Question of the Day, reviews

| ID | Item | Proof |
|---|---|---|
| Q1 | `qotd_schedule` + `qotd_daily_stats`; deterministic scheduler on America/Chicago; eligibility excludes retired, already-scheduled and `test_form_items` | DB: constraints in prod catalog; 30 days scheduled, zero overlap with `test_form_items`; duplicate insert rejected |
| Q2 | Public QOTD API: strict runtime-parsed student-safe DTO; submit → correctness + explanation; atomic stats; Turnstile + hashed-IP limiter; no quota charge; future dates never readable | CI route tests (pre-submit nulls, future date 404, 429, missing token rejected); LOG in prod |
| Q3 | QOTD on homepage + `/sat-question-of-the-day` hub + prerendered archive pages; "% got this right" hidden until ≥5 attempts | HTTP: archive pages unique meta, in sitemap; CI: stat absent below 5 attempts; WALK |
| Q4 | Every public CTA routes to the free diagnostic | Internal CTA inventory; WALK to diagnostic start |
| Q5 | Marketing opt-in per R26 | CI: PATCH omitting field preserves value; under-13 cannot set true; `consent_captured` emitted; DB check |
| Q6 | Review & feedback pipeline per R28–R30: neutral prompt, in-app anonymous reviews (student/guardian bucket), private feedback, cadence rules | CI cadence tests; DB rows; SHOT of prompt states |

### Wave 3 — Content engine (after Doc 10A locks)

| ID | Item | Proof |
|---|---|---|
| C1 | Zod content schema as single source; duplicate content copies deleted | CI: one source, schema tests |
| C2 | Keyword-map pages: practice hubs/skill pages (each skill page shows up to 2 previous QOTD questions from that skill, nothing else from the bank), good-SAT-score + score-level pages, free practice test → diagnostic, parent pages, online prep landing, how-to guides | GSC: each page indexed (SHOT/READ) |
| C3 | Publish gate: automated checks (doctrine rules, sources present, banned phrases, meta lengths, links resolve) + Karl approval; automation dial per R21 | CI: planted unsourced/proprietary claim is blocked |
| C4 | Rewrite the 5 existing posts | HTTP live + passes gate |
| C5 | AI CMO in Slack (Claude Tag) | SHOT: idea → brief → draft → approval thread |

### Wave 4 — Distribution

| ID | Item | Proof |
|---|---|---|
| D1 | QOTD to X, Instagram, TikTok, Facebook, YouTube, Threads via official APIs/schedulers | SHOT: published posts |
| D2 | Discord server; named-human r/SAT presence | SHOT |
| D3 | Marketing email lane: Resend broadcasts by audience bucket, one-click `List-Unsubscribe`, consent artifact live | READ/SHOT test broadcast + unsubscribe |
| D4 | Trustpilot invites (guardians + 18+) and testimonial display per R29 | SHOT; WALK |
| D5 | `/brag` video — script approved by Karl before production | Karl approval + published asset |

### Wave 5 — Paid & experiments

| ID | Item | Proof |
|---|---|---|
| P1 | ~$100 test on low-cost informational terms, parent targeting only; spend synced into PostHog | SHOT/READ campaign settings + spend |
| P2 | PostHog experiments when traffic supports a readable result. **The homepage hero experiment started early by Karl's ruling, 2026-10-05 (F13 decision 6; SCL-213 IS 7); further experiments stay here.** | SHOT experiment config + result |

### Post-launch (parked)
Average score improvement (R31) · owned subreddit + Reddit API approval · LISA public presence · AI agents on social · competitor comparison pages · SAT prep app page · on-camera video.

---

## 6. Routed to other owners (not this vertical)

- Practice free quota counts served items with a UTC reset; Doc 02B §13 says submissions, America/Chicago.
- Random selection where mastery data exists outside the calendar (Coding Standards §4.1).
- Practice pre-submit schema not runtime-parsed; exam-form questions can enter the practice pool.
- SCL-197 merge state.

## 7. Karl's pending actions

- Connect ad accounts to PostHog when Wave 5 starts.
- Search Console DNS verification + bulk export to BigQuery (`replit-cop`, us-central1); Bing Webmaster import.
- Trustpilot business profile (Wave 4).
- Turnstile keys (when Q2 is ready).
- Old video scripts from ChatGPT/Gemini (optional, before D5).

**Launch blockers**

- Repo `Lyceon-Team/Lyceonai` is public; must be made private before launch (conflicts with doctrine rules 2 and 4).

## 8. Open owner questions

None open as of 2026-10-02. Doc 10A pre-draft Q&A runs separately (G6): answered 2026-10-05; the draft's own open questions (§11.3, Q-10A-1 to Q-10A-4) were answered 2026-10-05.

## 9. Closure log

*(Each closed item: ID · date · proof output pasted verbatim.)*

- **Tooling — PostHog project settings (R12a)** · 2026-10-02 · READ via PostHog connector, project 641533, `project-settings-update` response: `anonymize_ips: true`, `capture_console_log_opt_in: false`, `cookieless_server_hash_mode: 2`, `timezone: America/Chicago`, `session_recording_opt_in: false`.
- **Tooling — connector access** · 2026-10-02 · READ: PostHog `project-get` returns project 641533; BigQuery `list_dataset_ids(replit-cop)` returns `lyceon_analytics_archive_prod` (us-central1).
- **G5 — Doctrine in CLAUDE.md; `seo` routing row** · 2026-10-03 · CI + file on `main`: merged to `seo` via #1042 (`eba93218`), on `main` at `3436e3ee`; `git merge-base --is-ancestor 474e4140 origin/main` → yes. `git show origin/main:CLAUDE.md | grep -n …` → `27:## Public Disclosure Doctrine (SEO & Marketing vertical)`, `236:## Branch targeting — eight integration branches, never `main``, `249:| `seo` | SEO & marketing vertical | SEO, marketing, public pages, content engine, analytics wiring |`. CI green on #1042 head `474e4140` (run 37085680571). Re-verified 2026-10-05 on `main` @ `a93d5dd`: `git merge-base --is-ancestor 474e4140 a93d5dd` → yes; `git show a93d5dd:CLAUDE.md` → `27:## Public Disclosure Doctrine (SEO & Marketing vertical)`, `249:| `seo` | SEO & marketing vertical | …`.
- **F1, F2, F3, F4, F12 — prerendered public routes, real 404s, generated sitemap, dead SSR removed, route registry** · 2026-10-05 · HTTP against production, `main` @ `a93d5dd`, no JavaScript executed, both user agents (Googlebot, OAI-SearchBot): `sitemap URLs: 21`; every URL → 200, a `<title>`, a self-referencing canonical and server-rendered body text; `duplicate titles: 0`. JSON-LD present on the 10 marketing URLs; `/trust`, `/legal` and the 9 legal documents carry none, by design (`shared/seo/head.ts:14`). `/this-page-does-not-exist -> 404`, `/blog/no-such-post -> 404`, `/trust/evidence -> 404`; `/privacy -> 301 https://lyceon.ai/legal/privacy-policy`, `/terms -> 301 https://lyceon.ai/legal/student-terms`; app shell `/dashboard -> 200 meta robots=noindex`, `/practice -> 200 meta robots=noindex`. F3's GSC "Success" screenshot is not part of this verification (F9).
- **F5 — HSTS and security headers** · 2026-10-05 · `curl -I https://lyceon.ai/legal/privacy-policy` on production (`main` @ `a93d5dd`): `strict-transport-security: max-age=63072000; includeSubDomains`, `content-security-policy: frame-ancestors 'none'`, `content-security-policy-report-only: default-src 'self'; …`, `x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin`, `permissions-policy: camera=(), microphone=(), geolocation=()`.
- **F6 — public claims corrected; internal claim inventory** · 2026-10-05 · On `main` @ `a93d5dd`: `git ls-tree --name-only a93d5dd docs/compliance/` → `docs/compliance/claim-inventory.md`.
- **F14 — `/trust/evidence` removed** · 2026-10-05 · Production: `/trust/evidence -> 404`; `curl -s https://lyceon.ai/sitemap.xml | grep -c trust/evidence` → `0`.

## 10. Follow-ups from G6 (Doc 10A drafting, 2026-10-05)

Found while drafting Doc 10A (`docs/plans/seo/doc-10a-draft.md`). Logged here, not fixed in the doc PR (owner G6 answers, 2026-10-05). Each becomes its own PR into `seo` with its own proof.

| # | Follow-up | Where | Proof when closed |
|---|---|---|---|
| FU1 | `robots.txt` disallows paths whose pages also carry `noindex`; a crawler that obeys the disallow never reads the `noindex`. Stop disallowing `noindex` pages (Doc 10A §4.4, INV-10A-05) | `client/public/robots.txt`; `tests/seo.route-registry.test.ts` | CI: robots ↔ registry test asserts no `noindex` path is disallowed |
| FU2 | Duplicate migration timestamp `20261027000000` (`audit_purge_keeps_guardian_consent` and `marketing_consent_and_product_reviews`) | `supabase/migrations/` | Unique timestamps; owner confirms no re-apply needed |
| FU3 | Stale references: `server/services/product-feedback/product-feedback-service.ts:20` names `tests/ci/product-feedback-routes.contract.test.ts` (does not exist; the test is `tests/ci/product-feedback.contract.test.ts`); `supabase/migrations/20261027000000_marketing_consent_and_product_reviews.sql:253` names `packages/shared/src/review-prompt.ts` (does not exist; the decision is `packages/shared/src/product-feedback-schema.ts:161`). **The migration is applied in production and immutable: never edited. Its stale comment is recorded here as known (Karl, 2026-10-05)** | the service file only | grep: zero references to the missing test path outside that applied migration |
| FU4 | Q5/Q6 closure-log entries (#1121 merged into `seo` 2026-10-05) | §9 above | Proof pasted per §2 after deploy |
| FU5 | QOTD e2e (`tests/e2e/qotd-answer-flow.spec.ts`), page-CSP flows (`tests/e2e/page-csp-flows.spec.ts`) and the crawl check (`scripts/seo/crawl-check.mjs`) are not run in CI (Doc 10A INV-10A-11, -17, -18) | `.github/workflows/ci.yml` | CI job runs each; a planted defect reddens it |
| FU6 | Blog author JSON-LD typed `Person` for "Lyceon Team"; move to `Organization` (Doctrine rule 8; Doc 10A §4.3) | `shared/seo/structured-data.ts:77-80` | Rendered-page test asserts Article `author.@type` = `Organization` |
| FU7 | QOTD stat wording "% of students got this right" → "N% answered correctly" (owner answer 7; Doc 10A §5.6). Counts are first attempts per hashed IP, not students | `client/src/components/qotd/QotdWidget.tsx:65`; `packages/shared/src/qotd-schema.ts:27` comment | Widget test asserts the new string; claim inventory row updated |
| FU8 | Turnstile production fail-closed: production with no `TURNSTILE_SECRET_KEY` answers 503 and logs an error; the always-pass test secret stays outside production (owner answer 8; Doc 10A §5.9, INV-10A-09) | `server/lib/turnstile.ts:42-55`; `tests/ci/public-ip-and-turnstile.test.ts:173` | CI: production-mode test reddens on the fallback |
| FU9 | At Doc 10A lock: registry `owning_doc` `Doc-10` → `Doc-10A` on the `unauth_marketing` content rows; claim inventory and guard messages move from a–e to Doc 10A §3.2's categories | `infra/route-surface-classification.yaml`; `docs/compliance/claim-inventory.md`; `tests/ci/public-copy-claims.contract.test.ts` | `route:validate` green; inventory carries the new labels |
| FU10 | CSP tightening audit: identify what needs `'unsafe-eval'` (Desmos today) and `style-src 'unsafe-inline'` (React style attributes, Radix positioning) and remove each where possible, for example by isolating Desmos in a sandboxed cross-origin iframe. Both are kept with the reason recorded until then (Karl, 2026-10-05; Doc 10A §4.6) | `vercel.json:52`; `tests/ci/page-security-headers.ci.test.ts:85-95` | Audit note per allowance; each removal proved by `tests/ci/page-security-headers.ci.test.ts` and the page-CSP gate (`ci.yml:163-167`) |
