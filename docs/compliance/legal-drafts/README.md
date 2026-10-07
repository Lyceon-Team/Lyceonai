# Legal drafts for counsel (internal)

## Status (2026-10-07, SCL-221)

Karl is the approver; there is no external counsel. Every draft below was resolved on 2026-10-07 with the standard answers for a US-only consumer edtech service for minors with guardian involvement.

| Draft | Where it went |
|---|---|
| `privacy-policy-v5.md` | Retired; its launch items are in `legal/privacy-policy/v6` (SCL-220) |
| `childrens-privacy-notice.md` | Folded into Privacy Policy v6 §4 |
| `ca-notice-at-collection.md` | Folded into Privacy Policy v6 §8.1 |
| `ca-do-not-sell-share-gpc.md` | Folded into Privacy Policy v6 §5.4, §8.1 |
| `sub-processor-list.md` | Folded into Privacy Policy v6 §5.2 |
| `cookie-policy.md` | Published: `legal/cookie-policy/v1` |
| `ai-content-disclosure.md` | Published: `legal/ai-content-disclosure/v1` |
| `billing-terms-v3.md` | Published: `legal/billing-terms/v3` |
| `cookie-banner-text.md` | Internal: the banner text in the product; decisions in the file |
| `school-data-privacy-addendum.md` | Internal template, signed per school; decisions in the file |
| `parental-consent-mechanism.md` | Internal: the consent flow in the product; decisions in the file |
| `marketing-communications-consent.md` | Internal: the wording in the product; decisions in the file |

The rest of this file describes the folder as it was drafted.

**Nothing in this folder is published.** The folder is outside `legal/`, so the legal registry, the legal gates and the build never read it; it is not copied to `dist/public` and is linked from nothing in the product.

A draft is published only after counsel signs off and the owner approves; its text is then copied into `legal/<slug>/<version>/` through the normal legal versioning process. Status is tracked in `docs/compliance/README.md` → "Legal drafts and counsel sign-offs".

Each draft describes the service as at launch. It starts with the **DRAFT — NOT PUBLISHED — FOR COUNSEL REVIEW** header and ends with **Standard sources followed** and a **Counsel checklist**, which are removed on publication.

## The drafts

| # | File | Doc 10 | Replaces |
|---|---|---|---|
| 1 | `privacy-policy-v5.md` | §9.2 | `legal/privacy-policy/v4` |
| 2 | `cookie-policy.md` | §9.10 | — (new) |
| 3 | `cookie-banner-text.md` | §9.11 | — (new) |
| 4 | `childrens-privacy-notice.md` | §9.14 | — (new) |
| 5 | `ai-content-disclosure.md` | §9.16 | — (new) |
| 6 | `ca-notice-at-collection.md` | §9.12 | — (new) |
| 7 | `ca-do-not-sell-share-gpc.md` | §9.13 | — (new) |
| 8 | `marketing-communications-consent.md` | §9.21 | — (new) |
| 9 | `billing-terms-v3.md` | — | `legal/billing-terms/v2` |
| 10 | `school-data-privacy-addendum.md` | — | — (new) |
| 11 | `parental-consent-mechanism.md` | §9.15 | — (new) |
| 12 | `sub-processor-list.md` | §9.18 | — (new) |

## Where each requirement is met

Requirements are from Doc 10 (`docs/Spec/Lyceon — Document 10_ … Legal Document Program.md`). Departures are recorded in SCL-208.

| Requirement | Source | Draft and section |
|---|---|---|
| Cookie categories: strictly necessary, analytics (PostHog), none for advertising | §9.10 (:577) | Cookie Policy §2, §3 |
| First- vs third-party, data collected, lifetime | §9.10 | Cookie Policy §3, §5 |
| How to manage or decline; banner reference; Do-Not-Track | §9.10 | Cookie Policy §4 |
| One-click accept and equally prominent refuse; no dark patterns; granular choice | §9.11 (:587) | Banner text, first and second layer; banner requirements below |
| 6-month do-not-re-ask | §9.11 | Cookie Policy §3 (consent record); banner requirements below |
| Honour machine-readable browser signals | §9.11 | Banner GPC notice; Cookie Policy §4 |
| Consent log: timestamp and category | §9.11 | Banner requirements below |
| Withdrawal in settings | §9.11 | Banner footer link and account settings; Cookie Policy §4 |
| No sale; no sharing for cross-context behavioural advertising | §9.13 (:607) | Do-Not-Sell; Privacy v5 §5.4 |
| Analytics provider relationship is not "sharing" | §9.13 | Do-Not-Sell, "Service Providers" |
| Footer link plus GPC honoured | §9.13 | Do-Not-Sell, "Global Privacy Control" |
| Categories of marketing | §9.21 (:687) | Marketing Consent §2 |
| Opt-in separate from ToS acceptance | §9.21 | Marketing Consent §1 |
| One-click unsubscribe | §9.21 | Marketing Consent §4 (RFC 8058) |
| Transactional messages need no marketing consent | §9.21 | Marketing Consent §3 |
| Notice at collection: categories, purposes, sale/share, retention, link to policy | §9.12 (:597) | CA Notice |
| Children's notice: under-13 posture | §9.14 (:617), as amended by SCL-187 and SCL-208 | Children's Notice §2; Privacy v5 §4 |
| What is collected from minors; parent rights; LISA handling for minors; contact | §9.14 | Children's Notice §1, §3–§8 |
| Parental consent clickwrap and logging | §9.15 (:627) | Parental Consent §2, §3 |
| AI content disclosed as AI-generated; limitations; how to report | §9.16 (:637), narrowed by SCL-208 | AI Disclosure §1, §2, §5 |
| AI Act Art. 50 | §9.16 | AI Disclosure §1 (counsel item 1) |
| Sub-processors: name, category, data, location | §9.18 (:657) | Sub-Processor List |
| Privacy Policy content (collected, use, processors, children, retention, rights, cookies, international, changes, contact) | §9.2 (:495) | Privacy v5 §1–§12 |
| Retention: enforced periods only, no 12-month inactivity claim | §9.2, narrowed by SCL-208 / SCL-092 | Privacy v5 §6 |
| Launch-blocking: Privacy, Cookie Policy, Banner, Children's Notice, Parental Consent, AI Disclosure, CA Notice, CA Do-Not-Sell | §10.2 (:720-733) | Drafts 1, 2, 3, 4, 11, 5, 6, 7 |
| Launch-blocking, already published (Student ToS, Guardian Terms, Refund, Auto-Renewal) | §10.2 | Not in G7 scope; v2 versions are live in `legal/` |
| Strongly preferred: Sub-Processor List, Marketing Consent | §10.2 (:735-741) | Drafts 12, 8 |
| Strongly preferred, not drafted here: Data Retention Schedule (§9.19); Honor Code and Community Guidelines (already published) | §10.2 | Retention is carried in Privacy v5 §6 |
| Doc 00 §3.1: Phase-2 artifacts drafted, not approved for publication | Doc 00 :77-81 | This folder; every draft's header |

## Banner requirements (implementation, not published)

| Requirement | Source |
|---|---|
| Accept and reject equally prominent; no pre-ticked boxes; no colour or size nudging | Doc 10 §9.11; EDPB 03/2022; ICO |
| Nothing beyond strictly necessary storage before a choice | ePrivacy Art. 5(3) |
| GPC treated as reject; GPC notice shown instead of the banner | Doc 10 §9.11, §9.13; 11 CCR §7025 |
| Choice remembered for 6 months, then asked again | Doc 10 §9.11 |
| Withdrawing is as easy as consenting (footer link, account settings) | GDPR Art. 7(3) |
| Consent log: timestamp, categories accepted, banner text version | Doc 10 §9.11; GDPR Art. 7(1) |
| Under-13 accounts: analytics never loads, whatever the choice | SCL-201, SCL-204 |
| Reject means zero analytics requests | ePrivacy Art. 5(3) |

## Sub-processor evidence (internal)

| Provider | Evidence |
|---|---|
| Supabase | `client/src/lib/supabase.ts`; `server/lib/supabase-ssr.ts`; `server/middleware/supabase-auth.ts` |
| Vercel (hosting) | `vercel.json`; `api/index.ts`; IP in logs at `server/logger.ts` |
| Stripe | `server/lib/stripe/client.ts`; `server/routes/billing-routes.ts` |
| Google Cloud — tutor AI | `apps/workers/tutor-orchestrator/src/lib/vertex-client.ts`; endpoint `global` (`apps/workers/tutor-orchestrator/cloudbuild.yaml`) |
| Google Cloud — content safety | `server/services/tutor-model-armor.ts`; `server/services/tutor-crisis.ts` |
| Google Cloud — background processing | `server/services/cloud-tasks-enqueue.ts`; `infra/terraform/cloud-tasks.tf`, `cloud-scheduler*.tf`, `cloud-run.tf` |
| Google sign-in | `client/src/contexts/SupabaseAuthContext.tsx` |
| Resend | `server/lib/notifications/transport.ts` |
| Desmos | `client/src/components/math/DesmosCalculator.tsx` |
| Slack | `server/services/crisis-notification.ts` (payload: IDs, reason label, SLA, admin link) |
| PostHog | `client/src/lib/analytics/posthog-client.ts` (browser, after consent; US region); `server/lib/analytics/emit-event.ts` (server events, HMAC id only) |
| Cloudflare Turnstile | `server/lib/turnstile.ts`; `client/src/components/qotd/turnstile.tsx` |
| Trustpilot | Launch processor; not yet in the code |
| Not listed: error-monitoring webhook | `ERROR_MONITOR_WEBHOOK_URL` not configured on Vercel, verified 2026-10-03; `server/logger.ts` returns early while it is unset |
| Not listed: Google BigQuery | Never installed; nothing archived (SCL-106) |
| Not listed: Google Fonts | Self-hosted (#1088) |
