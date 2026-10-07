# LYCEON — Counsel Package: Launch Legal Drafts

**Internal; prepared for outside counsel.** Prepared 2026-10-07. This package covers LYCEON's **single Privacy Policy**, version 6 (`legal/privacy-policy/v6`), and the 11 other launch-state legal drafts in `docs/compliance/legal-drafts/` (see that folder's `README.md`). v6 is the single final pre-launch version; the cleanup/guardian session owns it. It carries #1128's v5 (already published and sealed) plus the SEO items. **The v6 text in this package is from draft PR **#1138** (`claude/privacy-policy-v6`, into `cleanup`) at commit **`87b7f9d5`** (`87b7f9d5b856019f8bc1799cf659d347c52e8960`).** #1138 merges only after counsel signs off. The earlier draft `privacy-policy-v5.md` is **retired** and superseded by v6 (§2). **The legal text of the drafts is unchanged by this package.** The drafts follow in reading order after this note.

---

## 1. Cover note

**What LYCEON is.** LYCEON is an online preparation service for the SAT. It provides:

* daily practice questions with a worked explanation after each answer;
* a diagnostic test;
* full-length practice tests with score reports;
* a study plan and calendar;
* a progress view for a connected parent or guardian;
* LISA, an AI tutor.

A free plan covers daily practice (40 questions a day), worked explanations, review and the diagnostic. A paid monthly subscription adds full-length practice tests, the AI tutor and the study plan. A public "SAT Question of the Day" can be answered without an account.

**Who uses it.**

* **Students**, mainly aged 13 to 18.
* **Students under 13**, who can use the learning features only while a parent or guardian is connected to their account. LISA, analytics, session recording, marketing and review invitations are all closed to users under 13 (Children's Online Privacy Notice; Privacy Policy §4).
* **Parents and guardians**, who connect to a student's account and have a view-only progress view. Visibility requires an active connection and the student's active plan.
* **Schools and districts**, which may use LYCEON for their students under the SDPC National Data Privacy Agreement and the School Data Privacy Addendum (FERPA "school official").

**Where it operates.** **United States only at launch** (owner ruling, 2026-10-07). LISA and the whole service are US-scoped from a legal perspective. Please review the drafts against US law:

* **COPPA** (16 CFR Part 312);
* **FERPA** (34 CFR Part 99);
* **CAN-SPAM** (15 U.S.C. §7701 et seq.);
* **FTC Act §5**, including advertising substantiation for the claims in §6 below;
* **state privacy law**, including California (CCPA/CPRA, CalOPPA) and the universal opt-out laws of other states.

Some drafts also address the EU, UK, Ireland, Australia or Canada. Those passages remain in the drafts as written. The checklist questions that apply only to those markets are marked **"not applicable at launch: US only"** in §3 below and are kept for later. Counsel may advise whether those passages should stay in the published text for a US-only launch.

**Processors at launch** (Sub-Processor List):

| Provider | Role |
|---|---|
| Supabase | Database and authentication |
| Vercel | Hosting |
| Stripe | Payments |
| Google Cloud | AI services, content safety and background processing |
| Google | Sign in with Google |
| Resend | Email |
| Desmos | Graphing calculator |
| Slack | Internal team notifications (identifiers only) |
| PostHog | Product analytics and session recording; only after cookie consent, never for users under 13 |
| Cloudflare | Turnstile bot protection |
| Trustpilot | Customer reviews; adults and guardians only |

**Current state, for context:**

* Analytics loads only after the visitor accepts cookies, and a Global Privacy Control signal is treated as a refusal.
* Session recording is enabled, with the question-and-answer areas and the AI-tutor conversation excluded from capture.
* No personal information is sold or shared for cross-context behavioural advertising.

**What we ask counsel to do:**

1. Review and tighten the Privacy Policy and each of the 11 drafts. They are industry-standard drafts written to be accepted or tightened, not bespoke mechanisms.
2. Answer the 69 checklist questions in §3.
3. Supply or confirm the placeholders in §4 that are counsel's.
4. Confirm or tighten the public marketing claims in §5.
5. Record a sign-off per draft. Each signed-off draft is then published in the product's versioned legal folder.

---

## 2. The drafts, in reading order

| # | Draft | File | Replaces |
|---|---|---|---|
| 1 | Privacy Policy, version 6 | `legal/privacy-policy/v6/en.md` from #1138 @ `87b7f9d5` (draft PR into `cleanup`; merges after counsel sign-off) | published v5 (#1128) |
| 2 | Children's Online Privacy Notice | `childrens-privacy-notice.md` | new |
| 3 | Parental Consent Mechanism | `parental-consent-mechanism.md` | new |
| 4 | Cookie Policy | `cookie-policy.md` | new |
| 5 | Cookie Banner and Consent Notice text | `cookie-banner-text.md` | new |
| 6 | California Notice at Collection | `ca-notice-at-collection.md` | new |
| 7 | California Do Not Sell or Share / Global Privacy Control | `ca-do-not-sell-share-gpc.md` | new |
| 8 | AI Content Disclosure | `ai-content-disclosure.md` | new |
| 9 | Marketing Communications Consent | `marketing-communications-consent.md` | new |
| 10 | Billing Terms, version 3 | `billing-terms-v3.md` | published v2 |
| 11 | School Data Privacy Addendum | `school-data-privacy-addendum.md` | new |
| 12 | Sub-Processor List | `sub-processor-list.md` | new |

**Retired:** `privacy-policy-v5.md`, the earlier SEO Privacy Policy draft, is superseded by Privacy Policy v6 (Karl, 2026-10-07: one Privacy Policy for counsel; v5 is published and sealed, so the SEO items go into v6). It is not sent. Its 15 checklist questions are carried into v6 (§3.1).

The order runs from the Privacy Policy, through the children's and consent documents, cookies, California notices, AI, marketing and billing, to the school and processor documents. Each draft ends with "Standard sources followed" and its own "Counsel checklist". Both sections are removed on publication.

---

## 3. Counsel checklist questions (69), grouped by draft

Each question appears once, under the draft that raises it, numbered as in that draft. Where two drafts ask the same thing, a "See also" note cross-references the other. Answering one may answer both, but neither is dropped. Questions that apply only to markets outside the United States are marked **Not applicable at launch: US only**.

### 3.1 Privacy Policy, version 6 (PP, 15): carried into v6

These 15 questions were raised by the retired draft `privacy-policy-v5.md` and are **carried into Privacy Policy v6**, the single Privacy Policy, so the count stays traceable. Section numbers in the questions are the retired draft's. **Re-checked against v6 at #1138 @ `87b7f9d5`** (2026-10-07). The table maps each question to v6 and says where v6 already gives an answer for counsel to confirm. No question is added.

| Q | Retired draft | v6 | Re-check |
|---|---|---|---|
| PP-1 | §4.1 | §4.1, §4.5 | Open. v6 §4.5 says the connection is how consent is obtained and claims no particular verifiable-consent standard. |
| PP-2 | §4.1 | §4.1, §4.6, §6.4 | Open. Before connection v6 holds only the guardian email (§4.1); without a guardian the account is suspended and deleted (§4.6, §6.4). No period is stated. |
| PP-3 | §6.2 | §6.2, §6.3 | Open. Guardian consent record kept permanently (§6.2); Billing Terms consent at least three years (§6.3). |
| PP-4 | §6.6 | §6.6 | **Answered in v6, to confirm:** analytics events up to 12 months then deleted; session recordings 30 days. |
| PP-5 | §9 | §9 | Not applicable at launch: US only. |
| PP-6 | §5.2 | §5.2 | Open. v6 §5.2 lists neither Desmos nor Trustpilot as a provider; Trustpilot appears only as a link, with no data sent (paragraph after the table). |
| PP-7 | §8.2 | §2, §5.2 | Open. v6 describes an in-app review prompt and a Trustpilot link, not review invitations. |
| PP-8 | §10 | §10 | Not applicable at launch: US only. |
| PP-9 | §5.5 | none | Open. v6 has no schools / FERPA section; FERPA wording is in the School Data Privacy Addendum (§3.11). |
| PP-10 | §11 | §11 | Open. |
| PP-11 | §5.2 | §5.2 | Open. v6 §5.2 differs from the Sub-Processor List (draft 12), for example Google Cloud (BigQuery) in v6 only, and Desmos, Slack and Google sign-in in the list only. |
| PP-12 | §12 | §12 | Open. v6 §12 has no postal address line or placeholder (§4 below). |
| PP-13 | §1.1, §2 | §1.1, §2, §6.1 | **Answered in v6, to confirm:** reviews, private feedback and marketing-email choices are kept while the account is open and deleted with it. |
| PP-14 | §4.3 | §4.3 | Open. v6 §4.3 permits private feedback from under-13 accounts. |
| PP-15 | §2 | §6.1, §9.2 | Open. Marketing-choice records are kept until the account is deleted (§6.1); the legal basis is the open point. |



* **PP-1.** Confirm that the parental consent method in Section 4.1 meets 16 CFR §312.5(b). *See also CN-1, PC-1.*
* **PP-2.** Confirm whether 16 CFR §312.5(c)(1) requires deletion of an under-13 account's sign-up information if no parent or guardian connects within a set period. *See also CN-2.*
* **PP-3.** Confirm the retention of consent records in Section 6.2.
* **PP-4.** Complete the analytics and session recording retention periods in Section 6.6.
* **PP-5.** Confirm whether any analytics may run before a cookie choice is made in the EU and UK (ePrivacy Directive Article 5(3)). **Not applicable at launch: US only.**
* **PP-6.** Confirm the characterization of Desmos and Trustpilot as service providers. *See also DNS-2, SP-2.*
* **PP-7.** Confirm the legal basis for review invitations in Section 8.2.
* **PP-8.** Confirm the international transfer statement in Section 10. **Not applicable at launch: US only.** Processor locations remain in SP-1.
* **PP-9.** Confirm the FERPA wording in Section 5.5.
* **PP-10.** Confirm the change-notice wording in Section 11.
* **PP-11.** Confirm that Section 5.2 and the Sub-Processor List are complete on the publication date. *See also SP-5.*
* **PP-12.** Insert the postal address in Section 12. *See also CN-3, MC-3; §4.*
* **PP-13.** Set retention periods for in-app reviews, private feedback and marketing-consent records (Sections 1.1 and 2). No period is stated in this draft. As built, each is kept until the account is deleted and is deleted with it; marketing-consent records are not otherwise expired.
* **PP-14.** Confirm that accepting private feedback from users under 13 (Section 4.3) is covered by the parental notice and consent in Sections 4.1 and 4.5.
* **PP-15.** Confirm the legal basis for keeping marketing-consent records after consent is withdrawn (Section 2), and for how long (item 13). *See also MC-4.*

### 3.2 Children's Online Privacy Notice (CN, 6)

* **CN-1.** Confirm that the parental consent method in Section 2 meets 16 CFR §312.5(b). *See also PP-1, PC-1.*
* **CN-2.** Confirm whether 16 CFR §312.5(c) permits holding the information described in Section 2 before a parent or guardian connects, and for how long. *See also PP-2.*
* **CN-3.** Insert the postal address and telephone number in Section 1 (16 CFR §312.4(d)(1)). *See also PP-12, MC-3; §4.*
* **CN-4.** Confirm whether referring to the Privacy Policy satisfies the retention policy requirement in 16 CFR §312.10.
* **CN-5.** Confirm that retaining de-identified learning records after deletion is consistent with 16 CFR §312.10.
* **CN-6.** Confirm whether jurisdiction-specific sections are required (Ireland, Australia, UK Children's Code). **Not applicable at launch: US only.**

### 3.3 Parental Consent Mechanism (PC, 5)

* **PC-1.** Confirm whether the process in Sections 1 to 4 is a verifiable parental consent method under 16 CFR §312.5(b), or which method must be added. *See also PP-1, CN-1.*
* **PC-2.** Confirm whether a payment-card transaction at checkout may serve as a verification method for subscribing families.
* **PC-3.** Confirm the consent statement, including the 13 to 17 variant.
* **PC-4.** Confirm that the consent record is adequate evidence of consent.
* **PC-5.** Confirm the position for jurisdictions with a digital age of consent above 13 (for example Ireland). **Not applicable at launch: US only.**

### 3.4 Cookie Policy (CP, 5)

* **CP-1.** Complete each duration marked [●]. *See §4.*
* **CP-2.** Confirm the strictly necessary classification of each local storage and session storage item.
* **CP-3.** Confirm whether Desmos, Cloudflare Turnstile or any Trustpilot content on the website stores information in the browser, and whether any of it requires consent.
* **CP-4.** Confirm the 6-month duration of the cookie consent record. *See also CB-4.*
* **CP-5.** Confirm that the Do Not Track statement meets Cal. Bus. & Prof. Code §22575(b)(5).

### 3.5 Cookie Banner and Consent Notice text (CB, 5)

* **CB-1.** Confirm that the first layer provides clear and comprehensive information under ePrivacy Directive Article 5(3). **Not applicable at launch: US only.**
* **CB-2.** Confirm whether session recording requires a separate choice from analytics.
* **CB-3.** Confirm the Global Privacy Control handling for users in the EU and UK. **Not applicable at launch: US only.** US GPC handling is DNS-3.
* **CB-4.** Confirm the 6-month interval before the choice is requested again. *See also CP-4.*
* **CB-5.** Confirm the content and retention period of the consent record.

### 3.6 California Notice at Collection (CA, 5)

* **CA-1.** Confirm the category mapping, including "education information" (§1798.140(v)(1)(J)) and the category for tutor conversation text.
* **CA-2.** Confirm that the retention periods meet 11 CCR §7012(e)(4).
* **CA-3.** Confirm the classification of date of birth.
* **CA-4.** Confirm placement at sign-up and checkout under 11 CCR §7012(c).
* **CA-5.** Confirm whether LYCEON meets a CCPA applicability threshold.

### 3.7 California Do Not Sell or Share / Global Privacy Control (DNS, 4)

* **DNS-1.** Confirm whether this notice is required under 11 CCR §7013(a), and the title of the footer link.
* **DNS-2.** Confirm that the PostHog and Trustpilot relationships are service-provider relationships and not "sharing" under §1798.140(ah). *See also PP-6, SP-2.*
* **DNS-3.** Confirm how a GPC signal applies to a signed-in account under 11 CCR §7025(c)(1).
* **DNS-4.** Confirm the wording covers universal opt-out mechanisms under other state laws (for example Colorado, Connecticut and Texas).

### 3.8 AI Content Disclosure (AI, 5)

* **AI-1.** Confirm that Section 1 meets the transparency obligations in AI Act Article 50(1). **Not applicable at launch: US only.**
* **AI-2.** Assess whether the service is high-risk under AI Act Annex III. **Not applicable at launch: US only.**
* **AI-3.** Confirm the statement in Section 2 that no automated decisions with legal or similarly significant effects are made (GDPR Article 22). **Not applicable at launch: US only.**
* **AI-4.** Confirm whether an Australian automated decision-making disclosure is required. **Not applicable at launch: US only.**
* **AI-5.** Confirm whether an in-product reporting option is required in addition to email.

### 3.9 Marketing Communications Consent (MC, 5)

* **MC-1.** Confirm that marketing to students aged 13 to 17 who opt in is permitted in each launch market, and whether parental notice is required. At launch the only market is the United States.
* **MC-2.** Confirm that the checkbox wording meets CASL's express consent requirements. **Not applicable at launch: US only.**
* **MC-3.** Insert the postal address in Section 6 (CAN-SPAM §7704(a)(5); CASL). The CAN-SPAM requirement applies at launch. *See also PP-12, CN-3; §4.*
* **MC-4.** Confirm the consent record fields and their retention period after opt-out. *See also PP-15.*
* **MC-5.** Confirm the unsubscribe processing wording.

### 3.10 Billing Terms, version 3 (BT, 4)

* **BT-1.** Confirm that "practice beyond the free plan's daily limit" accurately describes the paid plan, and whether any per-session limit must be disclosed.
* **BT-2.** Confirm the description of parent and guardian access in Section 1.
* **BT-3.** Confirm whether the changes from version 2 require existing subscribers to consent again, or notice under Section 9.
* **BT-4.** Confirm consistency with the Subscription and Auto-Renewal Notice.

### 3.11 School Data Privacy Addendum (SA, 5)

* **SA-1.** Confirm the school authorization wording in Section 2.
* **SA-2.** Confirm the standard position on de-identified data after termination.
* **SA-3.** Name the security framework for the NDPA security exhibit.
* **SA-4.** Confirm which state exhibits to prepare first.
* **SA-5.** Confirm whether this addendum is published or supplied to schools on request.

### 3.12 Sub-Processor List (SP, 5)

* **SP-1.** Complete each location, and the transfer safeguard for each provider (standard contractual clauses, UK addendum or Data Privacy Framework). The locations apply at launch. **The transfer safeguards are not applicable at launch: US only.** *See §4.*
* **SP-2.** Confirm the processor characterization of Desmos, Slack and Trustpilot. *See also PP-6, DNS-2.*
* **SP-3.** Confirm whether to commit to a notice period before engaging a new sub-processor.
* **SP-4.** Confirm that a data processing agreement is in place with each provider.
* **SP-5.** Confirm that the list is complete on the publication date. *See also PP-11.*

**Count:** PP 15 + CN 6 + PC 5 + CP 5 + CB 5 + CA 5 + DNS 4 + AI 5 + MC 5 + BT 4 + SA 5 + SP 5 = **69**. **Not applicable at launch: US only:** PP-5, PP-8, CN-6, PC-5, CB-1, CB-3, AI-1, AI-2, AI-3, AI-4, MC-2, and the transfer-safeguard part of SP-1.

---

## 4. Open placeholders

Every placeholder left in the drafts: each `[●]`, `[POSTAL ADDRESS]`, `[TELEPHONE]` and `[link]`. The bracketed button labels in the cookie banner text (for example `[ Accept all ]`) are interface labels, not placeholders.

| Placeholder | Where | Who | Checklist |
|---|---|---|---|
| **Postal address** | Privacy Policy v6 §12 (no line or placeholder yet: "LYCEON AI" only); Children's Notice §1; Marketing Consent §6 | LYCEON (Karl) | PP-12, CN-3, MC-3 |
| **Telephone number** | Children's Notice §1 (`[TELEPHONE]`) | LYCEON (Karl) | CN-3 |
| **Analytics and session recording retention** | Privacy Policy v6 §6.6 states them (12 months; 30 days): no longer a placeholder, counsel to confirm | Counsel | PP-4 |
| **In-app review, private feedback and marketing-consent record retention** | Privacy Policy v6 §6.1 states it (while the account is open; deleted with it): no longer a placeholder, counsel to confirm | Counsel | PP-13, PP-15, MC-4 |
| **Cookie consent record retention** | Banner consent record | Counsel | CB-5 |
| **Cookie durations** (4) | Cookie Policy §3: `sb-<project>-auth-token`, `__Host-csrf`, the Turnstile security check, `ph_<project>_posthog` | Counsel with LYCEON | CP-1 |
| **Sub-processor locations** (11) | Sub-Processor List: Supabase, Vercel, Stripe, Google Cloud, Google, Resend, Desmos, Slack, PostHog, Cloudflare, Trustpilot | Counsel with LYCEON | SP-1 |
| **Privacy Policy link** | California Notice at Collection, final line (`Privacy Policy: [link]`) | Set on publication (the published Privacy Policy URL) | — |
| **Effective date** (11) | Every draft's header except the Sub-Processor List | Set on publication | — |
| **Last updated** (1) | Sub-Processor List header | Set on publication | — |

---

## 5. Public claims for counsel to confirm

These are on LYCEON's public pages. Karl has approved each one, and each is recorded with its support in the internal claim inventory (`docs/compliance/claim-inventory.md`). We ask counsel to confirm each as acceptable under FTC advertising standards, or to tighten it.

1. **"Study Smarter, Score Higher"** (slogan, on the homepage and every public footer; inventory X1, H43). It is an implied score-improvement claim. Test-prep score claims are the kind regulators expect substantiation for. LYCEON publishes no score-improvement statistic. Is it acceptable as a slogan, or should it be tightened?
2. **"SAT prep that adapts to you."** (homepage headline; inventory H32). Adaptivity is part of the paid study plan only. The line directly beneath it (H33) names the paid plan. Is that scoping sufficient?
3. **"An always-available alternative to private tutoring"** (homepage; inventory H33). This is a category comparison with private tutoring, not with a named company. Is any additional disclosure needed?
4. **Competitor price data and the LYCEON-versus-a-tutor comparison** (parent pages `/sat-tutor-cost`, `/lyceon-vs-sat-tutor`, `/is-sat-tutoring-worth-it`; inventory W7–W9 and their sources). Third-party tutoring prices are cited, dated "as viewed" and sourced. LYCEON's own price is read live from Stripe and never written into the page. Is the presentation acceptable, and how often must cited prices be re-checked?
5. **Free-plan claims:** "40 practice questions a day", "A worked explanation after every question", "A full diagnostic test", "No credit card required" (inventory W1, H37, H39, H43, M9). Are these free-plan statements acceptable, given that the paid plan is described alongside them?

---

## 6. Rebuilding this package

The PDF in `out/` is generated from this file, Privacy Policy v6 and the 11 drafts by `pnpm run build:counsel-pdf`, which uses no new dependencies. v6 is read from #1138 at the pinned commit recorded above (`git fetch origin claude/privacy-policy-v6` first); the build fails if this file names a different commit. Each page footer names this repository's source commit and the v6 pin. If #1138 changes, re-pin, re-check §3.1 and regenerate before sending.
