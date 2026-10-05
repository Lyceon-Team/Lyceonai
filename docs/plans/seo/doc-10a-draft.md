# **Lyceon — Document 10A: Public Surfaces & Content Engine**

**Version:** V0.1 **Status:** Draft for review (not locked) **Last updated:** 2026-10-05 **Owners:** Karl (founder) **Governed by:** Doc 00 (Authoritative Platform Directive); Doc 10 V1.0 (parent); the Public Disclosure Doctrine (§2).

**Where this draft lives.** Drafted at `docs/plans/seo/doc-10a-draft.md`, because `docs/Spec/` is read-only to agents (`CLAUDE.md` "Canonical truth lives in `docs/Spec`"; `.claude/hooks/block-spec-and-secrets.mjs`). Karl sends it for external review and moves it into `docs/Spec/` at lock (owner answer 1, G6 Step 0, 2026-10-05). Plan row G6 closes on the locked file being in `docs/Spec/`.

> **Reading rule.** Where this document names a mechanism another document owns, it says *"defined in Doc XX §Y; that file is canonical"* and adds only the public-surface contract. A line here that restates a body owned elsewhere is a defect. Every rule carries its source: a ruling (plan `docs/plans/seo/seo-marketing-vertical.md` §1, cited **R**n, or an owner answer with its date), an SCL, or a test or gate (`file:line`). File references are to `origin/seo` @ `bf5c989c` unless stated.
>
> **SCL footing.** SCL-200 to SCL-217 are all PROPOSED. A rule resting on one is marked **(subject to SCL-NNN)**: it is the operative direction now, pending Karl's ruling on that entry (owner answer 2, 2026-10-05). If the ruling changes the entry, the rule changes with it.

**What this document is.** Doc 10A is the contract for everything Lyceon publishes to someone who is not signed in, and for the machinery that publishes it. That covers:

- the public pages and their metadata;
- the Question of the Day;
- browser analytics and consent;
- the review and marketing-consent surfaces;
- the content engine;
- distribution direction.

It takes the "future Doc 05 (Trust, Growth, Compliance)" role for public and marketing surfaces that four locked documents cite (**subject to SCL-200**; plan R6 :38). Doc 10 holds the brand-and-trust direction and the legal-document program. Doc 10A holds the operational rules for the public surfaces that carry them. Doc 10A is **not** a copy deck: copy is governed by the rules here (§2, §3) and stays out of spec lock, as Doc 10 :58 and §11.9 (:929-957) already establish.

**Depends on:**

* **Doc 00** (server-authoritative, deterministic, auditable; never restated)
* **Doc 10 V1.0**:
  * §2.4 age taxonomy (:186-206);
  * §4.3 brand voice (:268);
  * §8.1–§8.5 community direction (:404-454);
  * §9 legal-document inventory (:456), including §9.10 Cookie Policy (:571), §9.11 Cookie Banner (:581) and §9.21 Marketing Communications Consent (:681);
  * §11.6 claim control (:858-877);
  * §11.9 brand-design track (:929).

  Referenced, never restated.
* **Doc 01A §39–§47** (RateLimitLedger: canonical limiter), as amended for anonymous buckets (**subject to SCL-202**)
* **Doc 06A §5.2–§5.3.1** (replay compliance gate; route-surface-classification registry), as amended (**subject to SCL-204**)
* **Doc 07A §6, §7.1, §9** (event schemas, `analytics_user_id`, the `emitEvent` wrapper), as amended (**subject to SCL-201, SCL-213**)
* **Doc 07E §10** (under-13 cascade, including `delete_recordings`; never restated)
* **Coding Standards §5.2** (pre-submit nulls), **§12** (never-log list; minimal collection on student surfaces)
* **Plan §0 and §1** (doctrine; rulings R1–R33): the operative direction until this document locks (SCL-200 IS bullet 2)

**Forward-references (bounded):** FWD-10A-A to FWD-10A-E (§11.1).

**Applies to:**

* every route the registry classes `unauth_marketing` (§1.2);
* the consent banner and the browser analytics SDK on every page, signed-in pages included (§6);
* the review prompt, private feedback and marketing opt-in surfaces, wherever they are mounted (§7);
* the content engine (§8);
* distribution direction (§9).

**Explicitly excludes:**

* The signed-in learning product: practice, review, exams, calendar, LISA, guardian views (Docs 01–05F own them; §1.3).
* The text of each legal document (Doc 10 §9; drafts in `docs/compliance/legal-drafts/`).
* Brand assets and the copy itself (Doc 10 §11.9). Doc 10A governs what copy may claim, not what it says.
* Event schemas, KPI definitions and dashboards (Doc 07 family).
* Doc 02B §34 B7 (cross-domain writes), which SCL-200 records as UNASSIGNED and which Doc 10A does not take.
* Pricing magnitudes (Stripe canonical, Doc 09 §1.4).

---

# **§1 — What Doc 10A Is, and Its Boundary**

## **1.1 Role**

Four locked documents send public and marketing surfaces to a "future Doc 05" that was never written. The name "Doc 05" was then reused for the Mastery family. SCL-200 assigns that role to Doc 10A (**subject to SCL-200**). The citations are:

* D01:45;
* D02A:80;
* Preamble:492;
* D02B:2007 (and §34 B7 at :1819-1821, which stays unassigned).

SCL-200's WAS list omits four further "future Doc 05" citations: D02B:79, Preamble:156, D01:2034 and D01A:1878. SCL-200 now names them, by a dated in-place note (Karl, 2026-10-05, answer to Q-10A-1). What Doc 10A takes from each:

* **D02B:79**, "public-facing marketing surfaces": in full.
* **Preamble:156**, "Future Document 05 (Trust / Growth / Compliance)": the public / marketing half only.
* **D01A:1878**, "Future Doc 05 (Growth) | Observability | Instrumentation": only the consent-gated browser analytics on public surfaces (§6). Server instrumentation stays with the Doc 07 family.
* **D01:2034**, "Guardian linking and consent flows | Doc 05 (Growth)": **not taken**. It is not a public surface.

## **1.2 Surface inventory**

`infra/route-surface-classification.yaml` is the one inventory of client routes (header :1-25), and CI fails on an unregistered route (`ci.yml:48`, `pnpm run route:validate`). Doc 10A owns every row with `surface_class: unauth_marketing` that serves content:

| Surface | Routes | Prerendered / indexable | Today's `owning_doc` |
|---|---|---|---|
| Homepage | `/` | yes / yes | Doc-10 |
| Digital SAT guides | `/digital-sat`, `/digital-sat/math`, `/digital-sat/reading-writing` | yes / yes | Doc-10 |
| Blog | `/blog`, `/blog/:slug` (`content_source: blog`) | yes / yes | Doc-10 |
| QOTD hub and archive | `/sat-question-of-the-day`, `/sat-question-of-the-day/:date` (`content_source: qotd`) | yes / yes | Doc-10 |
| Trust and legal hubs | `/trust`, `/legal`, `/legal/:slug` (`content_source: legal`) | yes / yes | Doc-10 |
| Legacy redirects | `/privacy`, `/terms` (301 via `redirect_to`) | no / no | Doc-10 |
| Future keyword-map pages | §8.3 page types | yes / yes when built | Doc-10A |

Each row's `owning_doc` moves from `Doc-10` to `Doc-10A` when this document locks (plan §10 follow-up).

Public non-content routes stay with their owners: `/login`, `/signup` and `/account/recover` (Doc-01), `/tutor` (Doc-03B), and the practice landing routes (Doc-02B). Doc 10A's consent and analytics rules (§6) still apply on them.

## **1.3 Boundary with the signed-in app**

Doc 10A ends at the role gate (`RequireRole`). Behind it, three things are Doc 10A's:

* the consent banner and browser SDK rules (§6);
* `mask_all_text` on signed-in surfaces (§6.5);
* the review, feedback and opt-in components (§7). Their placement, the moments a review prompt may appear, and their server rules are Doc 10A's. The pages that mount them belong to their owning documents.

Nothing in Doc 10A grants a signed-in surface any capability, entitlement or data.

## **1.4 Boundary with Doc 10**

Doc 10 keeps its direction. Doc 10A references it, and records where the as-built or ruled position differs:

| Doc 10 | Relationship in Doc 10A |
|---|---|
| §4.3 brand voice (:268) | Referenced. Copy follows it. |
| §6.2 four public counters (:324-334) | Parked (**subject to SCL-203**; R31 :82). Doc 10A ships none (§3.6). |
| §7.1 progress-sharing visualizations (:370-378); §7.2 written testimonials (:380-390) | Testimonials only from opted-in, anonymous in-app reviews (R29 :80; §7.6; **subject to SCL-218**). Progress-sharing visualizations: not built, no ruling; FWD-10A-C. |
| §8.2 QOTD brand intent (:412-421) | Referenced. One departure: :419 "LISA's explanation of each QOTD". The QOTD reveals the **pre-written** explanation, not LISA (R17 :59; §5.3). **Subject to SCL-218.** |
| §8.3 Discord (:423-430); §8.5 V1 community (:443-454) | Referenced. Distribution direction only (§9). |
| §9 legal inventory (:456); §9.11 banner (:581); §9.21 marketing consent (:681) | Referenced. Doc 10A owns the operational surfaces (§6.2, §7.1), not the legal text. |
| §11.6 claim control (:858-877) | Adopted, with doctrine rule 5 layered on top (CR-10A-02; §3.1; **subject to SCL-218**). |
| §2.4 under-13 hard-delete (:199) | Superseded for the launch posture by SCL-187/SCL-208 (**subject to SCL-208**). Doc 10A's under-13 rule is doctrine rule 7 (§6.4, §7). |
| FWD-10-D brand/trust analytics surfaces (:35) | Lands in Doc 10A when introduced (SCL-200 IS bullet 1; FWD-10A-D). |

## **1.5 Copy is governed, not locked**

Doc 10A locks rules, guards and the approval path. Individual strings change without a spec amendment, as long as they pass the guards (§3.4) and carry the approval §3.5 requires. This matches Doc 10's own split (:58; §11.9 lifecycle :947-953).

---

# **§2 — Public Disclosure Doctrine**

## **2.1 The rules**

The doctrine governs every public surface and every PR that touches one (plan R7 :39). The canonical wording is plan §0 (:13-20, Karl 2026-10-02, wording approved), mirrored in `CLAUDE.md` "Public Disclosure Doctrine". Doc 10A cites it by rule number and does not paraphrase it:

1. Industry standard only.
2. Nothing proprietary goes out.
3. General facts cite real sources.
4. Proof stays internal.
5. Karl's approval gate.
6. Legal text = standard industry clauses proposed for counsel.
7. Under-13 users are excluded.
8. Compliant by default.

## **2.2 Karl's clarifications (G6 brief, 2026-10-05)**

* **C1.** Rule 2 (no mechanisms) governs legal and explanatory text as well as marketing. The AI Content Disclosure already follows it (**subject to SCL-208**, IS 1).
* **C2.** Marketing may name a differentiator at a high level ("an adaptive study plan", "a progress view for parents"), never how it works.
* **C3.** A claim must be true **as shipped**: true of the product a visitor can buy on the day the claim is live, for the plan it names. A claim true only of a paid plan names the plan or is scoped by adjacent copy (H32/H33, §3.6).
* **C4.** Anything Lyceon-specific needs Karl's written approval (rule 5), whatever its Doc 10 §11.6 category (§3.1).

## **2.3 Where the doctrine is enforced**

* Mechanically: the claims guard (§3.4), the QOTD page test that pins "nothing describes how a day's question is chosen" (`tests/seo.qotd-pages.test.ts`; `claim-inventory.md` open item 4), and the publish gate when built (§8.4).
* By approval: §3.5.
* Proof stays internal (rule 4; R8 :40): `docs/compliance/` is never linked from the product, a public page, the sitemap or an email (`claim-inventory.md:3`).

---

# **§3 — Claim Control**

## **3.1 Categories**

Every public claim takes one of Doc 10 §11.6's four categories (:862-867): **1** product-demonstrable today, **2** internally measured, **3** counsel-approved legal claim, **4** future aspiration. Doc 10 §11.6's operational rules (:869-875) apply, with one change (CR-10A-02, owner answer 5, 2026-10-05):

> **Rule 5 overlay.** A Category 1 claim that is Lyceon-specific needs Karl's written approval before it is published, although Doc 10 §11.6 (:871) lets Category 1 appear "without founder review". Generic, industry-standard wording (rule 1) needs none.

Two further constraints sit on the categories:

* **Rule 2 overrides the category.** A claim that describes a mechanism is refused whatever its category. Doc 10 §11.6's own Category 1 example (:864, "Lyceon adapts question difficulty to your mastery level") is not usable public copy: it describes selection logic (rule 2) and is true only of the paid plan (R15 :53).
* **Rule 3 applies across the categories.** A general fact about the SAT, scores, tutoring or studying cites a source in `shared/seo/sources.ts` (:15-49), each fetched and recorded in `claim-inventory.md` "Sources" (:31-40).

## **3.2 Retiring the inventory's a–e labels**

`claim-inventory.md` (:15-21) labels rows a–e. Those labels mix one claim type (a, e) with three reasons a claim was removed (b, c, d). Doc 10A retires them in favour of Doc 10's categories plus a disposition (owner answer 5):

| Old label | Meaning (`claim-inventory.md:17-21`) | Doc 10A category | Disposition |
|---|---|---|---|
| a | generic, industry-standard wording | 1 (generic) | Publishable; no approval (rule 1) |
| b | contradicts the product or a ruling | — | **Refused**: fails "true as shipped" (C3) |
| c | describes a mechanism | — | **Refused**: rule 2 |
| d | unsourced general fact | — | **Refused** until sourced: rule 3 |
| e | Lyceon-specific or outcome claim | 1 (Lyceon-specific) or 2 (outcome / own-data statistic) | Karl's written approval (rule 5); Category 2 also needs Doc 10 §11.6's cohort, denominator, date range and cardinality check |
| — | privacy, security or compliance assertion | 3 | Counsel (Doc 10 §11.6), consistent with the published legal text |
| — | future direction | 4 | Explicit future tag (Doc 10 §11.6) |

The inventory and the guard's messages move to the new labels at lock (plan §10 follow-up). Until then the two schemes coexist through this table.

## **3.3 The register**

`docs/compliance/claim-inventory.md` is the claim register. Each public claim is a row, carrying its location, category, decision, source or approval, and the owner answer that decided it. The register is internal (rule 4). The register's "Product facts" block (:23-27) is what Category 1 claims are checked against.

## **3.4 Guards**

| Guard | What it enforces | Where |
|---|---|---|
| Banned phrases | Removed phrasings cannot return; each entry names its reason | `shared/seo/banned-phrases.ts:18` (`BANNED`), `:154` (`firstBannedPhrase`) |
| Outcome guard | Any outcome-shaped phrase must be on the approved list | `shared/seo/banned-phrases.ts:115` (`APPROVED_OUTCOME_PHRASES`), `:126` (`OUTCOME_PATTERNS`), `:146` |
| Rendered-page scan | Every prerendered public page's body, head, OG tags and JSON-LD, plus the OG image's text, checked against both lists; presence asserted before absence | `tests/ci/public-copy-claims.contract.test.ts:1-28`, run in CI's suite (`ci.yml:122`) |
| QOTD selection disclosure | QOTD pages say nothing about how a day's question is chosen | `tests/seo.qotd-pages.test.ts` |

**Known gap.** The scan covers prerendered pages only. Public routes served by the SPA (`/login`, `/signup`, the practice landing routes) are not scanned (INV-10A-03 status).

## **3.5 Approval flow for new copy**

1. The author adds or changes the claim's register row: category (§3.1), source (rule 3) or approval need (rule 5).
2. Generic Category 1 copy and sourced general facts need no approval. Everything else is listed for Karl in the PR with the proposed wording.
3. Karl's written approval is quoted into the register row with its date. Wording is published only after it is quoted.
4. A phrasing that is removed is added to `BANNED` with its reason, so it cannot return (§3.4).
5. Content-engine output follows the same path through the publish gate (§8.4).

## **3.6 Standing claim decisions**

* **H32** "SAT prep that adapts to you." stays (Karl-approved; owner answer 6, 2026-10-05). It is scoped by **H33**, the sub-line naming the paid study plan (`claim-inventory.md:70-71`; R15 :53). The pair is approved as a unit: H32 does not appear without H33's scoping on the same view.
* **P4** "SAT score calculator (Lyceon-modeled)" (keyword map `lyceon-sat-keyword-map.xlsx`, sheet "Page Map", row P4) stays **dropped** (R23 :70; owner answer 6). No public page computes, estimates or converts scores (rule 2).
* **Public counters** (Doc 10 §6.2): none at launch (**subject to SCL-203**). The post-launch candidate is average score improvement, with real data, n≥100 and Karl's approval (R31 :82).
* **Comparisons**: "an always-available alternative to private tutoring" is approved (H33). Named-competitor comparison pages are later, with substantiation (R24 :71; FWD-10A-B).

---

# **§4 — Rendering & SEO Contract**

## **4.1 One registry, several consumers**

`infra/route-surface-classification.yaml` is canonical. `shared/seo/route-registry.ts` parses it under a strict Zod schema (:37-104) and derives every consumer from it:

* the prerender set (`expandPrerenderPages` :215);
* the sitemap (`buildSitemapXml` :297);
* the SPA-shell routes and 301s that `vercel.json` carries (`buildVercelRoutes` :376-400; `edgeRedirects` :318).

The schema's rules are part of this contract (:63-103):

* only `unauth_marketing` rows may be prerendered or indexed;
* an indexable row must be prerendered;
* a parameterised prerendered row needs a `content_source`;
* a static prerendered row needs `last_modified` ("the sitemap never invents a date");
* a redirect row is neither prerendered nor indexed.

CI: `ci.yml:48` (registry validation) and `ci.yml:152-153` (SEO output gate: sitemap ↔ registry ↔ prerendered pages).

## **4.2 Prerendering**

Every indexable route is built to static HTML at deploy time (R10 :46; F1 closed, plan :260) by `scripts/build/prerender.mjs` through `client/src/prerender/entry-server.tsx`. The HTML carries real body text, so a crawler that runs no JavaScript sees the page.

The browser mounts with `createRoot`, which replaces the static markup with an identical client render rather than hydrating it (`entry-server.tsx:15-18`; `client/src/main.tsx:43`). This is accepted as built. Doc 10A's performance targets (§4.7) are measured against it.

## **4.3 Per-route metadata and structured data**

* Each prerendered page gets its own title, description, self-canonical and Open Graph tags (`shared/seo/public-meta.ts`, `PUBLIC_META` :264, `qotdArchiveMeta` :448; head rendered by `shared/seo/head.ts:40`).
* JSON-LD is optional per page. A page with none gets no JSON-LD script (`head.ts:14`). Legal and trust pages carry none by design (plan :260).
* JSON-LD types in use come from `shared/seo/structured-data.ts`: Organization (:11), WebSite (:21), BreadcrumbList (:30), FAQPage (:43; FAQ schema = the visible FAQ, F1 :171), Article (:59) and Quiz (:101). No SearchAction (F1).
* Structured data never names a synthetic person (rule 8). Blog articles currently type the author "Lyceon Team" as a `Person` (`structured-data.ts:77-80`). That moves to `Organization` (plan §10 follow-up).

## **4.4 Sitemap and robots**

* `sitemap.xml` lists exactly the indexable registry rows with real `lastmod` (F3; `route-registry.ts:297`). Parity is gated (`ci.yml:152-153`).
* `client/public/robots.txt` allows the public sections and disallows signed-in and non-content prefixes. `tests/seo.route-registry.test.ts` keeps it in step with the registry.
* **Contract rule (new):** a path that relies on `noindex` must not also be disallowed in `robots.txt`, because a crawler that obeys the disallow never fetches the page and never reads the `noindex`. Today's file disallows prefixes whose pages also carry `noindex` (for example `/dashboard`, `/practice`; plan :260). The fix is a plan §10 follow-up. Until it lands, this rule is not met (INV-10A-05 status).

## **4.5 Real 404s and redirects**

* An unknown path and an unknown content slug return HTTP 404 with `noindex` and no canonical (`head.ts:67`, `NOT_FOUND_META` `public-meta.ts:33`). F2 closed: production `/this-page-does-not-exist -> 404`, `/blog/no-such-post -> 404` (plan :260).
* Moved public URLs are 301s declared as registry `redirect_to` rows (`/privacy`, `/terms`; plan :260).

## **4.6 Security headers and CSP**

* HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and `Permissions-Policy` are served on static HTML through `vercel.json`. F5 closed, production headers recorded in plan :261.
* The page CSP (`vercel.json:52`) admits each inline script only by its sha256. Hashes are checked against the built page in CI (`ci.yml:163-167`, with a self-test proving each rule reddens), and by `tests/ci/csp-hero-hash.ci.test.ts` and `tests/ci/csp-theme-hash.ci.test.ts`.
* **Accepted with reason:** the CSP carries `'unsafe-eval'` in `script-src` and `'unsafe-inline'` in `style-src` (`vercel.json:52`). The reasons are on record (`tests/ci/page-security-headers.ci.test.ts:85-95`):
  * `'unsafe-eval'`: the Desmos calculator evals. With the CSP report-only there were 261 reports per session; when enforced without it, the calculator renders blank. Allowed page-wide by Karl's ruling, 2026-10-03, because the SPA is one document and cannot carry a per-route CSP.
  * `style-src 'unsafe-inline'`: React style attributes and Radix positioning, on every page.

  Both are kept with these reasons (Karl, 2026-10-05, answer to Q-10A-4). A CSP tightening audit, which identifies what needs each and removes them where possible, is plan follow-up FU10.

## **4.7 Performance targets**

Lighthouse, mobile profile, on production public pages (owner answer 4, 2026-10-05):

| Category | Target |
|---|---|
| Performance | ≥ 90 |
| Accessibility | 100 |
| Best Practices | 100 |
| SEO | 100 |

* **Evidence:** manual, per release that changes a public page (proof type SHOT, plan §2 :96-104). No CI gate.
* These targets supersede F8's (plan :178: "Perf ≥90, SEO 100, A11y ≥95"; F8 annotated).

---

# **§5 — Question of the Day**

## **5.1 Scope**

Doc 10 §8.2 (:412-421) owns QOTD's brand-and-trust intent and Doc 08 Dimension 6 owns the channel strategy. Doc 10A owns the public runtime: schedule, reveal, stats, exposure and abuse protection. Rulings R16–R20a (:58-62).

## **5.2 Schedule and eligibility**

* **One question per America/Chicago day, never repeated** (R18 :60). Enforced by the database, not the caller:
  * `qotd_schedule.qotd_date` PRIMARY KEY, `question_id` UNIQUE (`supabase/migrations/20261020000000_qotd_schema.sql:45-47`);
  * "today" is computed from `now()` in America/Chicago (:142-148).
* **Eligibility**, in one predicate used by both the candidate list and the insert (`qotd_question_is_eligible`, :73-88):
  * `published`;
  * no issue flags;
  * no assets;
  * not on any full-length test form (`test_form_items`);
  * not already scheduled.

  This implements R16's "live questions minus retired and full-length test-form items" (:58).
* **Deterministic scheduler.** It fills days ahead in canonical domain order and canonical-id candidate order, with no randomness (`server/services/qotd/schedule-job.ts:1-25`; Coding Standards §4.1).

## **5.3 Read and reveal rules**

* **Before submit.** Today's question is served with `correct_answer` and `explanation` null (Coding Standards §5.2; `server/routes/public-qotd-routes.ts:1-23`).
* **Future dates.** Never readable: the database function returns nothing for them, and `/:date` refuses today and later (`public-qotd-routes.ts:20-22`).
* **On submit.** The response carries:
  * correctness;
  * the correct option's token;
  * for grid-in only, the correct answer;
  * the **pre-written** explanation (R17 :59; `public-qotd-routes.ts:308-317`).

  LISA is not involved (departure from Doc 10 §8.2 :419; §1.4).
* **Past days** (the archive) are served with answer and explanation (`public-qotd-routes.ts:5`).
* **No charge.** No practice quota is charged and no account is read (`public-qotd-routes.ts:17-18`).
* **No logging of answers.** The submitted answer is never logged (Coding Standards §12.1).

## **5.4 One answer per visit**

As built, and recorded as such (owner answer 7, 2026-10-05):

* **Client rule.** Once a submit succeeds, the widget locks for that page view: the choice cannot change and nothing can be resubmitted. Nothing is stored, so a reload can answer again (`client/src/components/qotd/QotdWidget.tsx:18-20`).
* **Server counting.** The server grades and reveals every Turnstile-verified submit within the limiter (§5.9). It **counts** only the first submit per hashed IP per Chicago day (`qotd_stat_ip`, 1 per day: `supabase/migrations/20261020010000_rate_limit_ledger_anon.sql:26-27, :113`; `public-qotd-routes.ts:271-306`).
* **Counting never blocks.** A limiter or counter failure means "not counted", never a refused reveal (`public-qotd-routes.ts:272-273, :292-296`).

## **5.5 Options and tokens**

* **Shuffle.** Options are shuffled on every request (`server/services/qotd/qotd-service.ts:137-170`). Each option is identified only by an opaque token, lettered A–D by on-screen position (`QotdWidget.tsx:15-17`).
* **Tokens are stable per day, as built** (owner answer 7). `token = HMAC(K, "<date>:<option>")` under a key derived from the server secret. They are the same for every visitor that day and stateless: nothing is stored, and submit recomputes them (`server/services/qotd/option-tokens.ts:10-19`).
* **Why per-day is enough.** The trade-off is recorded at the source: once anyone submits, the answer is public, so a per-visitor token would protect nothing more (:18-19).
* **Determinism.** The shuffle is presentation of a public, already-chosen item. It is not question selection, so Coding Standards §4.1 is not engaged.

## **5.6 Aggregate stat**

* **Aggregate only.** Only an aggregate is ever shown (R17 :59).
* **Threshold.** The stat is hidden until the day has at least **5** counted attempts (`QOTD_MIN_ATTEMPTS_FOR_STAT`, `packages/shared/src/qotd-schema.ts:27-28`; Q3 :193).
* **Wording.** The stat reads **"N% answered correctly"** (owner answer 7, 2026-10-05). It counts first attempts per hashed IP (§5.4), not students, so "% of students got this right" is not true as shipped (C3). Today's string is `QotdWidget.tsx:65`; the code change is a plan §10 follow-up.

## **5.7 Public exposure of the question bank**

Two places expose bank content publicly, and no others (R20a :62):

* the dated QOTD archive;
* up to 2 previous QOTD questions from a skill on that skill's public page (when built, §8.3).

Every exposed item has already been a QOTD, so it passed §5.2's eligibility. No full-length test-form item can appear.

## **5.8 Archive pages**

Each past day is a prerendered, indexable page (`content_source: qotd`, read at build time), with:

* its own title and description (`qotdArchiveMeta`, `public-meta.ts:448`);
* Quiz JSON-LD (`structured-data.ts:101`);
* a sitemap entry (Q3 :193).

The approved copy strings are in `claim-inventory.md` open item 4 (closed).

## **5.9 Abuse protection**

(**subject to SCL-202**)

* **Order on submit.** Turnstile is verified server-side before any other work. Missing or invalid → 403. Verifier unreachable → 503, never a pass (`public-qotd-routes.ts:182-207`; `server/lib/turnstile.ts:1-12`).
* **Submit limiter.** The anonymous ledger bucket `qotd_submit_ip` allows 30 per hour per hashed IP (`20261020010000_rate_limit_ledger_anon.sql:26, :112`).
* **Ledger key.** The ledger keys on `HMAC-SHA256(server_secret, client_ip)`, and the raw IP is never stored or logged (SCL-202 IS 1). Doc 01A remains the canonical limiter.
* **Production fail-closed (contract rule; code follow-up)** (owner answer 8, 2026-10-05):
  * In production, a missing `TURNSTILE_SECRET_KEY` must fail closed: every submit gets 503 and an error is logged.
  * Today the server falls back to Cloudflare's always-pass test secret with a one-time warning, in every environment (`turnstile.ts:42-55`), and a test asserts the fallback (`tests/ci/public-ip-and-turnstile.test.ts:173`).
  * The test secret stays available outside production.
  * The guard is a follow-up code PR, not this document (plan §10). Until then this rule is not met (INV-10A-09 status).

---

# **§6 — Analytics & Consent**

## **6.1 Consent posture: nothing loads before Accept**

**No analytics code is downloaded and no analytics request is sent before the visitor accepts** (owner answer 3, 2026-10-05; owner Step 0 decision 1, 2026-10-05; F7 :177).

* `posthog-js` is a dynamic import, called only after Accept (`client/src/lib/analytics/posthog-client.ts:8-14`; `client/src/components/consent/CookieConsentRoot.tsx:142-150`).
* Refuse means zero analytics requests, proved in a browser (`tests/e2e/analytics-consent.spec.ts`, CI job `ci.yml:2896-2944`).

**Superseded.** The earlier "cookieless until consent" wording no longer describes the build and is superseded by this rule:

* R11 (:47) and R12a (:49);
* SCL-201 IS 1's "(cookieless before it)" (SCL-201 annotated in place, 2026-10-05).

PostHog's project-level cookieless setting (R12a) stays as applied. It has no before-consent role, because before consent nothing runs.

## **6.2 Banner and consent log**

Doc 10 §9.11 (:581-589) owns the banner's requirements. As built:

* equal one-click Accept and Refuse;
* granular settings;
* a strictly necessary consent cookie for 6 months (182 days: `packages/shared/src/analytics-consent-schema.ts:35-36`), after which the banner asks again;
* each choice POSTed to the consent log (`client/src/lib/analytics/consent.ts:1-20`; `supabase/migrations/20261026000000_analytics_identity_and_cookie_consent.sql`);
* withdrawal as easy as consent: stopping deletes PostHog's cookies and storage and reloads (`posthog-client.ts:21-23, :126-160`).

The banner text is legal text (`docs/compliance/legal-drafts/cookie-banner-text.md`).

## **6.3 Global Privacy Control**

A browser sending GPC is treated as Refuse, and the GPC notice replaces the banner (`consent.ts:69-70, :94`). An explicit choice the visitor later makes in Cookie settings overrides GPC, and the notice says so (`consent.ts:17-18`). Proved in CI (`ci.yml:2939`).

## **6.4 Under-13 and unknown-age exclusion**

(Rule 7; **subject to SCL-201**)

* **Signed-in accounts.** The browser SDK starts only for an account known to be 13 or over (`is_under_13 === false`). Under-13 and unknown age are excluded (`CookieConsentRoot.tsx:122-132`).
* **Late exclusion.** An excluded account that signs in on a running tab stops the SDK.
* **Server events.** The server wrapper refuses events for the same accounts (`excluded_under_13_or_age_unknown`, SCL-213 IS 5(a)).
* **Signed-out visitors** have no age on record and are not age-gated. This is the **standard general-audience posture**: a public page cannot know a visitor's age, so rule 7 applies once age is known. Signed-in under-13 and unknown-age accounts are excluded as above (Karl, 2026-10-05, answer to Q-10A-3).
* **Later detection.** A recording made for a user later found to be under 13 is removed by Doc 07E §10's cascade (`delete_recordings`; **subject to SCL-204** IS 2).

## **6.5 Masking and session replay**

* **Signed-in pages.** Autocapture records no element text there: `mask_all_text: true` while a `RequireRole` surface is mounted (**subject to SCL-213** IS 6; `posthog-client.ts:18-19, :64, :81`). Public pages keep PostHog's default.
* **Replay** (**subject to SCL-204**; R32 :87). On PostHog's defaults, after consent, never for under-13. `ph-no-capture` covers:
  * the question/answer areas: practice and review (`client/src/components/question-renderer.tsx`), full-length exam (`client/src/features/exam/components/ExamQuestionView.tsx`), the QOTD (`QotdWidget.tsx:24-26`);
  * the LISA conversation (`client/src/pages/chat.tsx`, `client/src/components/tutor/ScopedTutorPanel.tsx`);
  * the review and feedback text areas (`client/src/components/product-feedback/ReviewPrompt.tsx:237`, `FeedbackDialog.tsx`).
* **Replay is off until F15's evidence exists.** Recording follows the PostHog project setting, which stays off until F15 ships (`posthog-client.ts:20`). Replay on signed-in pages is a Doc 06A §5.2 compliance gate whose evidence is F15's proof (SCL-204 IS 3).

## **6.6 Server events**

Signed-in business events go only through the server `emitEvent` wrapper (Doc 07A §9; **subject to SCL-201** IS 1(a)).

* **Launch set.** Seven registered events (**subject to SCL-213**). A deferred or unregistered event is refused at runtime, and `ci/event-schema-registry-parity` fails code that emits one (`ci.yml:310`).
* **PII.** Redaction conformance is gated (`ci.yml:313`).
* **Joining.** The browser SDK never calls `identify` or `alias`, so browser events are never joined to `analytics_user_id` (SCL-201 IS 1; `posthog-client.ts:15-16`).

## **6.7 First-touch attribution**

`user_signed_up.signup_source` comes from the visitor's first touch (**subject to SCL-201** IS 6).

* **Derivation.** The landing address and referrer reduce to one of five words: `direct`, `referral`, `paid_ad`, `organic_search`, `unknown` (`analytics-consent-schema.ts:99-106, :144`). No campaign name, click id or URL is kept.
* **Storage under the consent rule** (owner report 2026-10-05; `client/src/lib/analytics/first-touch.ts:1-28`):
  * after Accept, the word is kept in sessionStorage for the tab;
  * after Refuse or GPC, it is never written, and is removed if present;
  * while undecided, it is held in memory only.

  Proof: `tests/e2e/first-touch-attribution.spec.ts` (`ci.yml:2944`) and `client/src/lib/analytics/first-touch.test.ts`.
* **Accepted gap.** A visitor who leaves the landing page before answering the banner is attributed by the page they sign up on. Karl accepts this as the standard consent behaviour (2026-10-05).

## **6.8 Experiments**

PostHog experiments run on PostHog's feature-flag mechanism, browser-only, after consent (P2 :223).

* **The one running experiment** is `homepage-hero` (**subject to SCL-213** IS 7; R13 superseded for the hero, :51):
  * Variant A is prerendered, and is all a visitor without consent ever sees;
  * an assigned variant is kept under a `ph_`-prefixed key and shown from the next view, before first paint, through a CSP-hashed inline script;
  * exposure is sent only on a view that displays the variant (`client/src/lib/analytics/hero-experiment.ts:1-12`; `posthog-client.ts:88-99`).
* **F7's "first visit writes no storage"** (:177) holds in the sense of §6.1: nothing is written before consent.
* **New experiments.** Further experiments wait for traffic that supports a readable result (P2). Every variant's copy passes §3 like any other copy.

## **6.9 What is never sent or stored**

Never sent to analytics or written to logs:

* secrets, cookies, tokens;
* student answers;
* tutor content (Coding Standards §12.1);
* raw IPs (SCL-202 IS 1; R12a IP anonymization);
* credential-shaped URL parameters (scrubbed in `before_send`: `posthog-client.ts:17`, `client/src/lib/analytics/url-scrub.ts`);
* review and feedback text (`server/routes/product-feedback-routes.ts:24`).

---

# **§7 — Reviews, Feedback & Marketing Consent**

As built in Q5/Q6 (#1121, merged into `seo` 2026-10-05). The legal text is Doc 10 §9.21's artifact (`docs/compliance/legal-drafts/marketing-communications-consent.md`).

## **7.1 Marketing opt-in**

(R26 :73; owner Q5/Q6 answers 2026-10-05)

* **Where it is asked.** Its own unticked checkbox at signup, separate from Terms acceptance, plus a Settings toggle. Audiences are bucketed student/guardian.
* **Age rule.** Under-13 is **never** eligible: a database trigger refuses any change that turns `marketing_opt_in` on unless the date of birth is known and is 13 or more years ago (`supabase/migrations/20261027000000_marketing_consent_and_product_reviews.sql:14-16, :77-104`). The client mirrors this for display only (`client/src/lib/product-feedback-api.ts:69-83`).
* **Revocation always works.** An on-flag on an ineligible row is still shown so it can be turned off (`product-feedback-api.ts:77-78`).
* **Consent log.** Every change writes `marketing_consent_log`: when, where, which wording version. Every grant carries a version (`marketing_consent_and_product_reviews.sql:50-67`). The wording version is `1.0.0` (`packages/shared/src/marketing-consent-schema.ts:22`), unchanged prelaunch per Karl's ruling (2026-10-05).
* **PATCH fix.** A profile PATCH that omits the field preserves it (Q5 :195).
* **Proof:** `tests/ci/marketing-consent-routes.pg.ci.test.ts`; `ci.yml:2040` (real Postgres) and `ci.yml:919-925` (mutations).

## **7.2 The review prompt**

* **One neutral prompt, no review gating** (R28 :79; rule 8):
  * three options side by side: in-app review, Trustpilot, private feedback;
  * nothing asks how the person feels before the options appear;
  * the rating never changes what is offered (`client/src/components/product-feedback/ReviewPrompt.tsx:19-20`).
* **Cadence** (R30 :81), decided in one pure function (`packages/shared/src/product-feedback-schema.ts:161-188`; constants :31-36):
  * eligibility: 13+, student or guardian;
  * a review stops it for good;
  * two dismissals stop it for good;
  * otherwise at most once per 120 days.
* **Moments** are a closed list, each verified on the server against existing data: `exam_report`, `study_week`, `guardian_week` (`product-feedback-schema.ts:16-23, :38-42`). No moment names a practice or exam screen, so the prompt cannot appear during either.
* **Shown is a claim.** A "show" answer is also the record that the prompt was shown. It is never cached or refetched (`server/routes/product-feedback-routes.ts:166-167`; `product-feedback-api.ts:11-13`).

## **7.3 In-app reviews**

* **Eligibility.** 13+ only, one per profile, bucketed student/guardian (`marketing_consent_and_product_reviews.sql:217-227`; `product-feedback-schema.ts:117-127`).
* **Anonymous by construction.** `profile_id` serves dedupe and deletion only and is never served. Quote permission is an unticked "Lyceon may quote this anonymously" (`ReviewPrompt.tsx:270-284`).
* **No public aggregate.** No first-party aggregate rating is ever published (R29 :80).

## **7.4 Private feedback**

* **Audience.** Open to every student and guardian at any age (R28 "always available"; `product-feedback-schema.ts:129-135`).
* **Storage.** Stored only, never displayed or forwarded (`marketing_consent_and_product_reviews.sql:229-240`).
* **Writes.** Idempotent by key and rate-limited (`product-feedback-routes.ts:247-289`).

## **7.5 Trustpilot**

* **Eligibility.** Offered to guardians and to students 18+ only, because Trustpilot requires reviewers to be 18+ (R28; `product-feedback-schema.ts:34-35, :137-145`). The server refuses the record for anyone else with 403 (`product-feedback-routes.ts:189-196`).
* **When it renders.** Only when `VITE_TRUSTPILOT_REVIEW_URL` is an `https://` URL (`product-feedback-api.ts:46-52`).
* **Invites.** Trustpilot invites are Wave 4 (D4 :215).

## **7.6 Testimonials**

* **Source.** Testimonials come only from opted-in in-app reviews: anonymous, labelled as testimonials, bucketed student/guardian (R29 :80). This governs Doc 10 §7.2's "written testimonials" (:384).
* **What is never used.** Paid, incentivised, fabricated or synthetic-person testimonials, and LISA excerpts (rule 8; Doc 10 §7.2 :388).
* **Not built.** Testimonial display is D4 (:215). Progress-sharing visualizations (Doc 10 §7.1) are not built and have no ruling (FWD-10A-C).

---

# **§8 — Content Engine (contract for C1–C5; NOT BUILT)**

## **8.1 Status**

Nothing in this section is built. Wave 3 starts after Doc 10A locks (plan :198). This section is the contract C1–C5 must meet; it is not a description of code. Today:

* blog posts are a hand-written TypeScript array with no Zod schema and no publish flag (`shared/content/blog.ts:19-31`);
* dates and author are unchanged until C4 (`claim-inventory.md` open item 3).

## **8.2 One content schema**

(C1 :202)

* **Single source.** All public content is defined by one Zod schema in `packages/shared`, with types inferred from it (Coding Standards §7.2). Duplicate copies of content are deleted.
* **Required fields** at minimum:
  * slug;
  * page type (§8.3);
  * title and description, within metadata length limits;
  * the claims the page makes, with their sources (rule 3);
  * author as an Organization or a named real person (rule 8);
  * `datePublished` / `dateModified`;
  * publish state;
  * the approval record (§8.4).
* **Indexability follows the registry.** Prerendering and indexing still come from the registry (§4.1). A content page is a registry row with a `content_source`.

## **8.3 Page types**

From the keyword map (`docs/marketing/keyword-map/lyceon-sat-keyword-map.xlsx`, sheet "Page Map"; C2 :203):

| Id | Page type | Constraint |
|---|---|---|
| P1 | QOTD hub and archive | Built (§5.8) |
| P2 | Practice hubs and ~30 skill pages | A skill page may show up to 2 previous QOTD questions from that skill and nothing else from the bank (R20a) |
| P3 | Good SAT score and score-level pages | General facts sourced to College Board (rule 3); no Lyceon score modelling (rule 2) |
| P4 | Score calculator | **Dropped** (R23; §3.6) |
| P5 | Free practice test → free diagnostic | Every public CTA routes to the free diagnostic (Q4 :194) |
| P6 | Parent pages (tutor cost, tutor vs Lyceon, is tutoring worth it) | Comparison claims are Lyceon-specific: Karl's approval (rule 5); costs cited (rule 3) |
| P7 | Online SAT prep landing | Rule 2 (no mechanisms); differentiators at a high level only (C2) |
| P8 | How-to-study guides (blog) | Research claims cited (rule 3) |
| L1, L2 | Competitor comparison, SAT prep app | Later (R24; post-launch list :226) |
| SKIP | Near-me / city pages, books | Never (R23; rule 8: no doorway or city pages) |

No page type is a thin templated variant of another (rule 8). A page exists only if it carries content of its own.

## **8.4 The publish gate**

(C3 :204)

**Automated checks.** A page publishes only when every check passes:

* doctrine rules 2 and 3 (no mechanism; sources present);
* banned phrases and outcome guard (§3.4);
* metadata lengths;
* every link resolves;
* the register rows exist (§3.3).

Proof named in C3: a planted unsourced claim and a planted proprietary claim are both blocked in CI.

**Karl's approval.** Karl approves briefs and publishing (R21 :68). The approval is recorded against the content item.

## **8.5 The automation dial**

(R21 :68)

* **Raising it.** Automation increases one step after **3 consecutive approvals with no pushback** for a content stream.
* **Resetting it.** Any pushback resets the count.
* **Fixed parts.** The automated checks (§8.4) never relax, and rule-5 claims always need Karl's approval, whatever the dial.

## **8.6 AI-written content**

(R21 :68)

* **Quality bar.** Content is held to a human-quality bar, with no detectable AI markers in prose.
* **Labelling.** Synthetic people, voices or video are labelled per each platform's rules and are never presented as real (rule 8).
* **No fabrication.** No fabricated testimonials or statistics.
* **No PII in prompts.** No PII or student data in any prompt (Coding Standards §12; CLAUDE.md privacy invariant).

## **8.7 The AI CMO in Slack**

(R22 :69; C5 :206)

* **Role.** The content workflow runs with humans in Slack (Claude Tag): idea → brief → draft → approval, visible in one thread.
* **No publishing authority.** The AI CMO only proposes. Its drafts go through §8.4 like any other content.

---

# **§9 — Distribution (direction only)**

Direction, not contract. Each channel gets its own rules when it is built.

* **Social** (R25 :72; D1 :212): X, Instagram, TikTok, Facebook, YouTube and Threads, through official APIs and schedulers. QOTD is the first stream. Video is faceless for now; on-camera is post-launch. The `/brag` video script needs Karl's approval before production (D5 :216).
* **Email lane** (R26; D3 :214):
  * Resend broadcasts, bucketed by audience;
  * sent only to `marketing_opt_in` holders (§7.1);
  * one-click `List-Unsubscribe`;
  * never under-13 (rule 7).
* **Reviews** (D4 :215): Trustpilot invites to guardians and adults (§7.5), and testimonial display per §7.6.
* **Community** (D2 :213): a Discord server and a named-human r/SAT presence. Brand intent is Doc 10 §8.3 and §8.5.
* **Paid** (R27 :74; P1 :222): about $100 to start, not hardcoded anywhere. **Parent targeting only.** Spend is synced into PostHog.
* **Post-launch** (plan :226; R20 :63):
  * average score improvement (R31);
  * an owned subreddit and Reddit API;
  * LISA public presence;
  * AI agents on social;
  * competitor comparison pages;
  * an SAT prep app page;
  * on-camera video.

---

# **§10 — Invariants and Proofs (internal)**

The proof lives in the repo and the internal register, never on a public page (rule 4). "Gated" means a CI step fails on violation. "Tested" means a test exists but CI does not run it. "Not met" means the rule is new in this document and its fix is a follow-up.

| Id | Invariant | Proof | Status |
|---|---|---|---|
| INV-10A-01 | Every client route is registered, and only `unauth_marketing` rows are prerendered or indexed | `route-registry.ts:63-103`; `ci.yml:48` | Gated |
| INV-10A-02 | Sitemap = indexable registry rows = prerendered pages, with real `lastmod` | `ci.yml:152-153` (`scripts/ci/seo-output-gate.ts`) | Gated |
| INV-10A-03 | No banned or unapproved outcome phrase on any public page | `tests/ci/public-copy-claims.contract.test.ts`; `ci.yml:122` | Gated for prerendered pages; SPA public routes unscanned |
| INV-10A-04 | Unknown paths and slugs are real 404s | F2 production proof (plan :260); `head.ts:67` | Verified in production; route tests |
| INV-10A-05 | No `noindex` path is disallowed in `robots.txt` | — | **Not met**: plan §10 follow-up |
| INV-10A-06 | Inline scripts are admitted only by hash; headers present on static HTML | `ci.yml:163-167`; `tests/ci/page-security-headers.ci.test.ts`; F5 (plan :261) | Gated |
| INV-10A-07 | QOTD pre-submit `correct_answer` / `explanation` null; future dates unreadable; missing token rejected; 429 enforced | `tests/ci/public-qotd-routes.contract.test.ts` (`ci.yml:122`); `scripts/ci/qotd-schema-gates.sql` (`ci.yml:896-902`); `scripts/ci/qotd.mutations.sh` (`ci.yml:906-912`) | Gated |
| INV-10A-08 | QOTD one per day, never repeated, eligibility excludes test-form items | `qotd_schema.sql:45-47, :73-88`; `ci.yml:896-912` | Gated |
| INV-10A-09 | Production never verifies Turnstile with the test secret | — (`turnstile.ts:42-55` falls back today) | **Not met**: follow-up code PR (§5.9) |
| INV-10A-10 | QOTD stat hidden below 5 counted attempts; counts first per hashed IP per day | `qotd-schema.ts:27-28`; `public-qotd-routes.ts:271-306`; route contract test | Gated (unit/contract) |
| INV-10A-11 | QOTD answer flow in a real browser (lock, reveal, Turnstile on interaction) | `tests/e2e/qotd-answer-flow.spec.ts` | **Tested, not in CI**: plan §10 follow-up |
| INV-10A-12 | Nothing loads or sends before Accept; Refuse = zero requests; GPC = Refuse; under-13 never loads; withdrawal deletes storage | `tests/e2e/analytics-consent.spec.ts`; `ci.yml:2896-2944` | Gated |
| INV-10A-13 | First-touch survives redirects only under consent | `tests/e2e/first-touch-attribution.spec.ts`; `ci.yml:2944`; `first-touch.test.ts` | Gated |
| INV-10A-14 | Only registered events emit; no PII in event properties | `ci.yml:310`, `ci.yml:313` | Gated |
| INV-10A-15 | Consent log rows written for each cookie choice; marketing opt-in never true under 13 or with unknown age | `ci.yml:2023`, `ci.yml:2040`; `ci.yml:919-925` | Gated |
| INV-10A-16 | Review cadence (120 days, 2 dismissals, review stops it); no gating; Trustpilot 18+ only | `tests/ci/product-feedback.contract.test.ts`; `tests/ci/marketing-consent-reviews.pg.ci.test.ts` (`ci.yml:2040`) | Gated |
| INV-10A-17 | Page CSP holds across real page flows (QOTD, Turnstile, PostHog) | `tests/e2e/page-csp-flows.spec.ts` | **Tested, not in CI**: plan §10 follow-up |
| INV-10A-18 | Every sitemap URL is crawlable without JavaScript (title, self-canonical, body) | `scripts/seo/crawl-check.mjs` (F1, plan :171); F1 production proof (plan :260) | **Not in CI**: plan §10 follow-up |
| INV-10A-19 | Content publish gate blocks a planted unsourced or proprietary claim | C3 (plan :204) | **Not built** (§8) |
| INV-10A-20 | Lighthouse targets (§4.7) | Manual SHOT per release | Manual by ruling (owner answer 4) |

---

# **§11 — Open Questions, Forward-References and SCL Dependencies**

## **11.1 Forward-references (bounded)**

* **FWD-10A-A**: the content engine (§8; C1–C5). Contract here, build in Wave 3.
* **FWD-10A-B**: competitor comparison pages, with substantiation (R24; L1).
* **FWD-10A-C**: progress-sharing visualizations (Doc 10 §7.1). No ruling; not planned.
* **FWD-10A-D**: public analytics surfaces (Doc 10 §6, FWD-10-D). Post-launch, n≥100, Karl's approval (SCL-203 IS; R31).
* **FWD-10A-E**: post-launch distribution (plan :226).

## **11.2 SCL dependencies**

Every entry Doc 10A rests on is PROPOSED (owner answer 2):

| SCL | Doc 10A rests on it for |
|---|---|
| SCL-200 | Doc 10A's existence and scope (§1.1) |
| SCL-201 | Browser PostHog; no `identify`; under-13 exclusion; `signup_source` (§6.4, §6.6, §6.7). Its IS 1 "cookieless before it" is superseded (§6.1) |
| SCL-202 | Anonymous ledger buckets; Turnstile on submit (§5.9) |
| SCL-203 | No public counters at launch (§3.6) |
| SCL-204 | Session replay scope and `ph-no-capture` (§6.5) |
| SCL-208 | Legal drafts' departures from Doc 10, under-13 posture (§1.4, §2.2 C1) |
| SCL-213 | Seven launch events; `mask_all_text`; `homepage-hero` (§6.5, §6.6, §6.8) |
| SCL-218 | Doc 10A's departures from locked Doc 10: §8.2 explanation source, the testimonials direction, Category 1 under the approval rule (§1.4, §3.1, §7.6) |

SCL-205–207, 209–212 and 214–217 belong to other verticals. Doc 10A does not rest on them.

## **11.3 Open questions**

All four were answered by Karl on 2026-10-05:

* **Q-10A-1. Answered: widen SCL-200 in place.** A dated note in SCL-200 names the four omitted "future Doc 05" citations: D02B:79, Preamble:156, D01:2034, D01A:1878. It records what Doc 10A takes from each; D01:2034, guardian linking, is not taken (§1.1).
* **Q-10A-2. Answered: one PROPOSED SCL, ruled at lock.** **SCL-218** records Doc 10A's three departures from locked Doc 10:
  * §8.2 :419, the explanation source: pre-written, not LISA;
  * §7.1 and §7.2, the testimonials direction (R29);
  * §11.6 :871, Lyceon-specific Category 1 claims now under Karl's approval rule (CR-10A-02).
* **Q-10A-3. Answered: acceptable.** The standard general-audience posture: public pages cannot know a visitor's age; rule 7 applies once age is known (§6.4).
* **Q-10A-4. Answered: keep both, with the reason recorded** (§4.6). The CSP tightening audit is FU10.

No question is open. New ones raised in external review are added here as Q-10A-5 onward.

## **11.4 Follow-ups routed to the plan**

The repairs found while drafting are a numbered list in plan §10, not rules here, except where a rule above names its own follow-up.

---

# **§12 — Conventions Adopted**

* **Reading rule** (header): reference other documents by name and section; never restate.
* **Traceability:** every rule cites a ruling, an SCL, or a `file:line`. A rule with no citation is a defect.
* **"Subject to SCL-NNN"** marks a rule resting on a PROPOSED entry. It is dropped when the entry is ruled.
* **Ids:** INV-10A-NN (§10), FWD-10A-X (§11.1), Q-10A-N (§11.3), CR-10A-NN (§14). Doc 10 declined forced id scaffolding (:12). Doc 10A uses ids because it does assert executable rules, which Doc 10 does not (:967, :969).
* **Annotations that describe a status** (CLAUDE.md, "An annotation that describes its own status must be updated when that status changes") are updated with the ruling and its date when the status changes. The R11/R12a/F8 annotations in the plan are the first instances.
* **Copy stays out of lock** (§1.5).

---

# **§13 — Acceptance Criteria**

Doc 10A V1.0 is acceptable for lock when:

1. §1 names an owner for every `unauth_marketing` content route in the registry, and states the boundary with the signed-in app and with Doc 10.
2. §2 carries the doctrine by reference, plus Karl's four clarifications.
3. §3 maps every claim category onto Doc 10 §11.6 with rule 5 layered on top (CR-10A-02), and names the register, the guards and the approval flow.
4. §4–§7 state each rule with a citation, and every "not met" rule has a plan follow-up.
5. §8 is marked NOT BUILT and states the contract C1–C5 must meet.
6. §10 maps every invariant to a gate, test or manual proof, with an honest status.
7. Every rule resting on a PROPOSED SCL is marked "subject to".
8. External review is complete, every §11.3 question is answered or deferred, and SCL-218 is ruled.
9. Karl moves the file into `docs/Spec/` (G6 proof).

---

# **§14 — Change Records**

**CR-10A-01.** Doc 10A V0.1 drafted, 2026-10-05, per plan row G6 and owner answers 1–8 to G6 Step 0 (2026-10-05):

* answer 1: drafted in `docs/plans/seo/`; Karl moves it at lock;
* answer 2: SCL-200–217 cited "subject to";
* answer 3: nothing loads before Accept, with R11, R12a and SCL-201 IS 1's "cookieless before consent" marked superseded;
* answer 4: Lighthouse Performance ≥90 and Accessibility/Best Practices/SEO 100, manual per release;
* answer 5: Doc 10 §11.6 categories with rule 5 layered on top; a–e retired by a mapping table;
* answer 6: H32 kept, P4 dropped;
* answer 7: QOTD one-answer-per-visit as built, the stat reads "% answered correctly", tokens stable per day;
* answer 8: Turnstile production fail-closed as a contract rule, with the code as a follow-up.

Doc 10 is referenced, never restated (§8.2, §8.3, §9, §4.3). §8 is written as the not-built contract for C1–C5. Status: Draft for review.

**CR-10A-02.** Claim control adopts Doc 10 §11.6's four categories (:862-867) and layers doctrine rule 5 on top. A **Lyceon-specific** Category 1 claim needs Karl's written approval, although Doc 10 §11.6 (:871) lets Category 1 claims appear "without founder review". Generic, industry-standard Category 1 wording (rule 1) needs none. Doc 10 §11.6's Category 1 example at :864 is a mechanism (rule 2) and is not usable public copy. The inventory's a–e labels are retired via §3.2. Owner answer 5, 2026-10-05. The departure from locked Doc 10 is recorded in **SCL-218** (PROPOSED; ruled at lock).

**CR-10A-03.** Karl's answers to §11.3, 2026-10-05:

* Q-10A-1: SCL-200 widened in place to name the four omitted citations.
* Q-10A-2: SCL-218 allocated (PROPOSED) for the three Doc 10 departures.
* Q-10A-3: the general-audience posture is recorded in §6.4.
* Q-10A-4: the CSP allowances are kept with their reason in §4.6, and FU10 (CSP tightening audit) is added to the plan.

---

# **§15 — Closing**

Doc 10A turns the doctrine and the SEO vertical's rulings into a contract for the public side of Lyceon: what a visitor may be told, how a public page is built and found, how the Question of the Day is served without leaking, and what is measured only after consent. Most of it is already built and gated (§10). Where it is not, the gap is named with its follow-up rather than written as if it held.

**End of Doc 10A V0.1 Draft.**
