# Legal drafts for counsel (internal)

**Nothing in this folder is published.** These are industry-standard drafts proposed for counsel to accept or tighten (Public Disclosure Doctrine rule 6; plan row G7). The folder:
- is outside `legal/`, so the legal registry, the legal gates and the build never read it;
- is not copied to `dist/public`;
- is linked from nothing in the product.

A draft is published only after:
1. counsel signs off;
2. Karl approves;
3. its text is copied into `legal/<slug>/<version>/` through the normal legal versioning process.

Status of each draft is tracked in `docs/compliance/README.md` → "Legal drafts and counsel sign-offs".

Every draft has the same shape:
- it starts with the **DRAFT — NOT PUBLISHED — FOR COUNSEL REVIEW** header;
- it ends with **Standard sources followed** and a **Counsel checklist**.

Sections marked **[Effective when F10/F11 ship]**, **[Effective when Q2 ships]**, **[Effective when Q5/D3 ship]** or **[Effective with the first school agreement]** describe features that are not live yet.

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
| 9 | `billing-terms-v3.md` | — (billing; plan F6) | `legal/billing-terms/v2` |
| 10 | `school-data-privacy-addendum.md` | — (plan R33) | — (new) |
| 11 | `parental-consent-mechanism.md` | §9.15 | — (new) |
| 12 | `sub-processor-list.md` | §9.18 | — (new) |

## Where each requirement is met

Requirements are from Doc 10 (`docs/Spec/Lyceon — Document 10_ … Legal Document Program.md`). Departures are recorded in SCL-208.

| Requirement | Source | Draft and section |
|---|---|---|
| Cookie categories: strictly necessary, analytics (PostHog), functional, none for advertising | §9.10 (:577) | Cookie Policy §2, §3 |
| First- vs third-party, data collected, lifetime | §9.10 | Cookie Policy §3 table, §5 |
| How to manage or decline; banner reference; Do-Not-Track | §9.10 | Cookie Policy §4 |
| One-click accept and equally prominent refuse; no dark patterns; granular choice | §9.11 (:587) | Banner text, first and second layer; behaviour table |
| 6-month do-not-re-ask | §9.11 | Banner behaviour table; Cookie Policy §3 (choice record) |
| Honour machine-readable browser signals | §9.11 | Banner GPC notice; Cookie Policy §4 |
| Consent log: timestamp and category | §9.11 | Banner behaviour table |
| Withdrawal in settings | §9.11 | Banner footer and account-settings entries; Cookie Policy §4 |
| No sale; no sharing for cross-context behavioural advertising | §9.13 (:607) | Do-Not-Sell §1; Privacy v5 §5.4 |
| Analytics provider relationship is not "sharing" | §9.13 | Do-Not-Sell §2 |
| Footer link plus GPC honoured | §9.13 | Do-Not-Sell (placement header; GPC section) |
| Categories of marketing | §9.21 (:687) | Marketing Consent §2 |
| Opt-in separate from ToS acceptance | §9.21 | Marketing Consent §1 |
| One-click unsubscribe | §9.21 | Marketing Consent §4 (RFC 8058) |
| Transactional messages need no marketing consent | §9.21 | Marketing Consent §3 |
| Notice at collection: categories, purposes, sale/share, retention, link to policy | §9.12 (:597) | CA Notice table and sections |
| Children's notice: under-13 posture | §9.14 (:617), as amended by SCL-187 and SCL-208 | Children's Notice §2; Privacy v5 §4 |
| What is collected from minors; parent rights; LISA handling for minors; contact | §9.14 | Children's Notice §3–§8 |
| Parental consent clickwrap and logging | §9.15 (:627) | Parental Consent §2, §3 |
| AI content disclosed as AI-generated; limitations; how to report | §9.16 (:637), narrowed by SCL-208 | AI Disclosure §1, §2, §5 (email is live; the in-conversation report control is marked not yet live) |
| AI Act Art. 50 | §9.16 | AI Disclosure §1 (counsel item 1) |
| Sub-processors: name, category, data, location | §9.18 (:657) | Sub-Processor List table |
| Privacy Policy content (collected, use, processors, children, retention, rights, cookies, international, changes, contact) | §9.2 (:495) | Privacy v5 §1–§12 |
| Retention: enforced periods only, no 12-month inactivity claim | §9.2, narrowed by SCL-208 / SCL-092 | Privacy v5 §6 |
| Launch-blocking: Privacy, Cookie Policy, Banner, Children's Notice, Parental Consent, AI Disclosure, CA Notice, CA Do-Not-Sell | §10.2 (:720-733) | Drafts 1, 2, 3, 4, 11, 5, 6, 7 |
| Launch-blocking, already published (Student ToS, Guardian Terms, Refund, Auto-Renewal) | §10.2 | Not in G7 scope; v2 versions are live in `legal/` |
| Strongly preferred: Sub-Processor List, Marketing Consent | §10.2 (:735-741) | Drafts 12, 8 |
| Strongly preferred, not drafted here: Data Retention Schedule (§9.19); Honor Code and Community Guidelines (already published) | §10.2 | Retention is carried in Privacy v5 §6 |
| Doc 00 §3.1: Phase-2 artifacts drafted, not approved for publication | Doc 00 :77-81 | This folder; every draft's header |
