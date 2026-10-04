# Compliance register (internal)

**Purpose:** the internal evidence register required by Public Disclosure Doctrine rule 4
(`CLAUDE.md`; `docs/plans/seo/seo-marketing-vertical.md` §0): claim support, compliance
reasoning and test evidence live here. Nothing in this folder is published as "evidence".

**Notice:**
- This register is internal.
- It is not linked from the product, a public page, the sitemap, or any email.
- The repository is currently public. Making it private is a tracked launch blocker (plan §7), and that applies to everything in this folder.

## Sections

| Section | Contents | Filled by (plan row) |
|---|---|---|
| Claim inventory | Every public claim, with its doctrine category and source | F6 |
| Consent and analytics configuration | Cookie-consent behaviour, PostHog settings, replay exclusions and their proof | F10, F11, F15 |
| Legal drafts and counsel sign-offs | Industry-standard drafts proposed for counsel, and the recorded sign-off for each | G7 |
| School agreements | Each school's student data privacy agreement (the SDPC National DPA is the common template) and the terms Lyceon operates within | R33 |

Filled so far: **Claim inventory**, `claim-inventory.md` (F6, SEO Wave 1B, 2026-10-03); **Legal drafts and counsel sign-offs**, below (G7, 2026-10-03).

## Legal drafts and counsel sign-offs

Drafts live in `docs/compliance/legal-drafts/` (see its README). They are not published. A draft becomes publishable only after counsel signs off and Karl approves; it is then copied into `legal/<slug>/<version>/`.

| Draft | File | Doc 10 | Status | Counsel sign-off |
|---|---|---|---|---|
| Privacy Policy v5 | `legal-drafts/privacy-policy-v5.md` | §9.2 | Awaiting counsel | — |
| Cookie Policy | `legal-drafts/cookie-policy.md` | §9.10 | Awaiting counsel | — |
| Cookie banner text | `legal-drafts/cookie-banner-text.md` | §9.11 | Awaiting counsel | — |
| Children's Online Privacy Notice | `legal-drafts/childrens-privacy-notice.md` | §9.14 | Awaiting counsel | — |
| AI Content Disclosure | `legal-drafts/ai-content-disclosure.md` | §9.16 | Awaiting counsel | — |
| California Notice at Collection | `legal-drafts/ca-notice-at-collection.md` | §9.12 | Awaiting counsel | — |
| California Do-Not-Sell/Share and GPC | `legal-drafts/ca-do-not-sell-share-gpc.md` | §9.13 | Awaiting counsel | — |
| Marketing Communications Consent | `legal-drafts/marketing-communications-consent.md` | §9.21 | Awaiting counsel | — |
| Billing Terms v3 | `legal-drafts/billing-terms-v3.md` | — | Awaiting counsel | — |
| School Data Privacy Addendum | `legal-drafts/school-data-privacy-addendum.md` | — (R33) | Awaiting counsel | — |
| Parental Consent Mechanism | `legal-drafts/parental-consent-mechanism.md` | §9.15 | Awaiting counsel | — |
| Sub-Processor List | `legal-drafts/sub-processor-list.md` | §9.18 | Awaiting counsel | — |

Spec departures in these drafts are recorded in SCL-208. Open owner actions:
- error-monitoring vendor: confirm or turn off;
- Google Fonts: self-hosted on `seo` by #1088 (SEO-1); must be live in production before Privacy Policy v5 publishes;
- postal address and telephone, for the children's notice and marketing emails.
