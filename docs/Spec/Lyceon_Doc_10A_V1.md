# **Lyceon — Document 10A: Public Surfaces, Growth & Content Engine**

**Version:** V1.0 **Status:** DRAFT (for external review) **Last updated:** 2026-10-06 **Owners:** Founder / CTO review **Governed by:** Doc 00 (Authoritative Platform Directive). **Parent:** Doc 10 V1.0.

**What this document is:** Doc 10A is a **general-direction document** for how Lyceon shows up to the public and grows: the public site, search and AI search, the Question of the Day, content, measurement and experimentation, reviews, and distribution. It names the ideas and tools Lyceon has chosen and the few guardrails that always apply. It is deliberately open-ended. It does not lock audiences, positioning, copy, page lists or tactics; those are expected to change through testing and judgment. Anything not ruled out by the guardrails in §3 is open.

**Depends on:**

* **Doc 00** (never restated)
* **Doc 10 V1.0** (parent — proof-over-gimmicks, brand voice, social proof, community direction, legal-document program, claim control; referenced, never restated)
* **Doc 01** (identity, roles, guardian model, age posture)
* **Doc 07 family** (events, analytics identity, retention)
* **Doc 08 Dimension 6** (channel and community strategy)
* **Doc 09** (pricing canonical in Stripe)

**Applies to:** Lyceon's public, unauthenticated surfaces; consent and analytics wherever they run; reviews, feedback and marketing consent; content and distribution.

**Explicitly excludes:** the signed-in learning product (Docs 01–05, 08); legal-document text (Doc 10 §9); event schemas and KPIs (Doc 07); pricing magnitudes (Doc 09); brand assets and copy themselves (Doc 10 §11.9).

---

# **§1 — What Doc 10A Is**

## **1.1 Role**

Doc 10A takes the "future Doc 05 (Trust, Growth, Compliance)" role that earlier locked documents assigned to public and marketing surfaces (SCL-200). Doc 10 sets Lyceon's brand-and-trust posture; Doc 10A carries it into the public surfaces and growth work.

## **1.2 The principle: show the product honestly**

Lyceon grows by letting people experience the product and by telling the truth about it. A free question, a free diagnostic, useful pages that answer real questions, and real product screens do the persuading. This is Doc 10's proof-over-gimmicks posture applied to growth.

## **1.3 How to use this document**

Treat it as direction, not a checklist. Audiences, messages, channels, page types and experiments are all open to change. The only fixed parts are the guardrails in §3. When in doubt, the test is simple: is it honest, is it industry standard, does it respect privacy, and does it keep what makes Lyceon work private?

---

# **§2 — Scope & Boundary**

## **2.1 In scope**

* The public website and its pages
* Search and AI-search visibility
* The SAT Question of the Day
* Content and the content workflow
* Measurement, experimentation and consent
* Reviews, feedback and marketing consent
* Distribution channels and paid acquisition

## **2.2 Boundary with Doc 10 and the product**

Doc 10 keeps brand voice, competitive positioning, community intent, social-proof principles and the legal-document program. The signed-in product belongs to its own documents; Doc 10A only covers the growth components that appear inside it (consent banner, analytics, review prompt, feedback, marketing opt-in).

---

# **§3 — Guardrails**

These are the only fixed rules. Everything else in this document is direction.

## **3.1 Public Disclosure Doctrine**

1. **Industry standard only.** Use the patterns the category already uses; nothing bespoke.
2. **Nothing proprietary goes out.** Never describe or reveal how mastery is computed, how tests are scored, how questions are selected, how LISA works, internal architecture, or the size and structure of the question bank. Marketing may name a benefit at a high level ("adapts to you", "progress you can see") without explaining how.
3. **General facts cite real sources.** Statements about the SAT, scores, tutoring or studying cite a credible source.
4. **Proof stays internal.** Evidence and compliance reasoning are never published.
5. **Founder approval** for anything Lyceon-specific: product claims, outcomes, comparisons, statistics from Lyceon's own data.
6. **Legal text** is standard industry wording, reviewed by counsel.
7. **Under-13 users are excluded** from marketing, analytics, email, reviews and public data.
8. **Compliant by default.** No keyword stuffing, doorway pages, fake or incentivised reviews, review gating, or synthetic people presented as real.

## **3.2 Honesty**

Claims are true of the product a person can actually get. Outcome claims and statistics follow Doc 10's claim-control categories and wait until real data supports them.

## **3.3 Privacy and consent**

Analytics runs only with consent, using the standard cookie-banner pattern, and respects browser privacy signals. Student answers, tutor conversations, secrets and raw personal identifiers are never collected for analytics. School-provisioned accounts follow the school's data-privacy agreement, which rules out targeted advertising to those students.

## **3.4 The law**

Public surfaces and outreach follow the applicable rules — FTC advertising and endorsement guidance, COPPA, FERPA where schools are involved, CAN-SPAM for email, state privacy laws, accessibility standards — with counsel as the authority (Doc 10 §9).

---

# **§4 — Audiences & Positioning**

Lyceon speaks to **both students and parents or guardians**, and to schools and programs as that channel opens. Which audience leads, on which page, in which campaign, is a choice to make and test, not a fixed rule.

Positioning themes Lyceon has worked with so far:

* An affordable, always-available alternative to private tutoring
* Practice that fits the student's schedule, with explanations every time
* Progress families can see before test day
* The slogan **"Study Smarter, Score Higher"**

These are starting points. New angles, headlines and audiences are expected, and the homepage and ads are where they get tested.

---

# **§5 — The Public Site & Search**

## **5.1 Direction**

The public site is Lyceon's front door and its search presence. It should be fast, accessible, readable by search engines and AI assistants without JavaScript, and built around real questions people ask about the SAT.

## **5.2 What the site includes**

The site grows over time. Current direction includes the homepage, SAT practice-question pages, good-SAT-score pages, a free practice test page, pages for parents (tutor cost, comparisons with tutoring), an online SAT prep page, study guides and a blog, the Question of the Day, and trust and legal pages. Pages are added, merged or retired as search data and results suggest.

## **5.3 Standards**

* Industry-standard SEO: proper titles and descriptions, canonical URLs, standard structured data, an accurate sitemap, real 404s, permanent redirects for retired URLs.
* Industry-standard security headers.
* Strong performance and accessibility (Lighthouse targets near the top of the scale; WCAG 2.1 AA as the accessibility standard).
* Facts on pages are kept current against their sources.

## **5.4 Search tools**

Google Search Console and Bing Webmaster Tools (Bing feeds major AI assistants), with Search Console data exported to BigQuery for analysis.

---

# **§6 — The Homepage**

The homepage is the main conversion surface and the main place to test messaging. Its structure, sections, headlines and calls to action change through A/B testing and judgment. Current direction: a clear hero with a primary call to action, a short "see how it works" product walkthrough (video when it exists, real product screens until then), the Question of the Day, who Lyceon is for, pricing with the live Stripe price, an FAQ, and a closing call to action. A free diagnostic is the natural first step for new visitors.

---

# **§7 — The Question of the Day**

A free SAT question every day that anyone can answer without an account, with a worked explanation after answering, and a public archive of past days. It serves three purposes at once: a real sample of the product, a daily reason to come back, and searchable content. It can appear on the homepage, its own pages, related content pages and social channels.

Standing protections: questions come from the canonical bank but never from full-length test forms; no answer is revealed before submitting; nothing about how the question is chosen is published; abuse is controlled with Cloudflare Turnstile and rate limiting; aggregate stats only.

---

# **§8 — The Content Engine**

## **8.1 Direction**

Content is how Lyceon earns search and AI-search traffic and builds trust: useful, accurate, human-quality pages and posts answering what students and parents actually search for. The keyword map (Google Keyword Planner research) is the starting guide; search performance decides what comes next.

## **8.2 How content is made**

* AI-assisted drafting, held to a human-quality bar with no detectable AI markers.
* The founder approves content; automation increases as the founder approves streams without pushback (three in a row moves it up a step).
* Every page is checked automatically before publishing (sources, approved claims, standard SEO quality) so quality does not depend on memory.
* One content model feeds every page and blog post.

## **8.3 The AI CMO**

An AI CMO in Slack (Claude Tag) runs the content workflow with the team: ideas, briefs, drafts and approvals in one place. It proposes; people approve. Planned for after launch, when Lyceon moves to Slack Pro (and a Claude Team plan for Claude Tag). Until then the same workflow runs through Claude Code sessions using the AI CMO skill.

## **8.4 Video**

Faceless video for now, produced with Lyceon's video tooling, with scripts approved before production. On-camera video comes later.

---

# **§9 — Measurement, Experimentation & Consent**

## **9.1 Direction**

Lyceon measures enough to learn where people come from, what they do, where they get stuck and what converts, and no more. Measurement is consent-first.

## **9.2 Tools**

* **PostHog** is the analytics hub: product analytics, session replay (with sensitive areas such as questions, answers and tutor conversations masked), experiments and feature flags, and its data warehouse for pulling in ad-platform and other data.
* **BigQuery** holds Search Console exports.
* A server-side event set, defined in Doc 07, covers key growth moments such as signup and where the visitor came from.

## **9.3 Experiments**

A/B testing is how messaging, layout, audiences and offers get decided. Any part of the public site and any campaign can be tested.

## **9.4 Consent**

A standard cookie banner (Accept all, Reject all, Cookie settings) controls analytics. Nothing analytic runs before consent; withdrawing is as easy as consenting; browser privacy signals are respected; under-13 accounts are never measured.

---

# **§10 — Reviews, Feedback & Testimonials**

Lyceon collects honest feedback and lets satisfied users share it:

* **In-app reviews** and **private feedback**, offered through one neutral prompt at good moments, never during study, never gated by rating, and not repeated too often.
* **Trustpilot** for adult users and guardians, following Trustpilot's rules.
* **Testimonials** only from people who opted in, anonymous by default, never paid or invented.

---

# **§11 — Distribution**

Lyceon may use any channel that fits the guardrails. Current direction:

* **Social:** X, Instagram, TikTok, Facebook, YouTube and Threads, through official APIs and schedulers; the Question of the Day is a natural first stream.
* **Email:** to people who opted in (marketing opt-in at signup and in Settings), by audience, via Resend, with standard unsubscribe and CAN-SPAM compliance.
* **Community:** a Discord server, and real, named Lyceon people helping on r/SAT (Doc 10 §8).
* **Paid acquisition:** starting with small tests; platforms such as Google, Meta, TikTok and Reddit, with spend synced into PostHog. Audiences and creative are tested; anything aimed at students follows platform rules for minors and never targets under-13s.
* **Reviews:** Trustpilot and in-app reviews (§10).
* **Schools and programs:** as that channel opens, under signed data-privacy agreements.

---

# **§12 — Tool Stack**

| Tool | Use |
| ----- | ----- |
| PostHog | Analytics hub, session replay, experiments, feature flags, data warehouse |
| BigQuery | Search Console data export |
| Google Search Console, Bing Webmaster Tools | Search visibility and indexing |
| Vercel | Hosting the public site |
| Supabase | Data for public features (Question of the Day, consent and review records) |
| Stripe | Live pricing on public pages |
| Resend | Marketing and transactional email |
| Cloudflare Turnstile | Abuse protection for public interactive features |
| Trustpilot | Public reviews |
| Slack + Claude Tag | AI CMO and content workflow |
| Claude Code (/brag) | Product walkthrough and social video |

Tools are expected to change as Lyceon grows; free and low-cost options are preferred before revenue.

---

# **§13 — Launch & Beyond**

## **13.1 At launch**

The public site with its first content, the homepage and its experiments, the Question of the Day, consent and analytics, the review and feedback prompt, marketing opt-in, and search tools connected. Before launch, the legal documents are counsel-reviewed and published (Doc 10 §9) and the source repository is private.

## **13.2 After launch**

Ideas Lyceon intends to pursue: outcome statistics once real data supports them (Doc 10 §6), the AI CMO in Slack, comparison pages against named competitors with substantiation, a fuller social presence (owned subreddit, LISA as a public voice, on-camera video), progress-sharing that students choose to post, more experiments and audiences, and growth in schools and programs. None of these is a commitment to a date or form.

---

# **§14 — Conventions & Departures**

## **14.1 Conventions**

Doc 10A follows Doc 10's light conventions: directional register, no invariant numbering, references rather than restatement, in-lock-cycle cleanup without version bumps, and change records. Doc 10A relies on SCL-200 (its role), SCL-201 (browser analytics and consent), SCL-202 (public abuse protection), SCL-203 (no public counters at launch), SCL-204 (session replay), SCL-208 (legal-draft posture), SCL-213 (growth events and experiments) and SCL-218 (departures from Doc 10).

## **14.2 Departures from Doc 10 (SCL-218)**

* The Question of the Day shows a pre-written explanation rather than a LISA explanation (Doc 10 §8.2).
* Testimonials come only from opted-in reviews (Doc 10 §7).
* Lyceon-specific claims need founder approval regardless of category (Doc 10 §11.6), and claims that describe how the product works are not used publicly.
* No public counters at launch (Doc 10 §6.2).

---

# **§15 — Acceptance Criteria**

Doc 10A V1.0 is acceptable for lock when it states the direction for each area in §4–§13, the guardrails in §3, the tools in §12, and the departures from Doc 10; references other documents rather than restating them; and has completed external review.

---

# **§16 — Change Records**

**CR-10A-01** — Doc 10A V1.0 drafted 2026-10-06 as an open-ended general-direction document for Lyceon's public surfaces, growth and content, in Doc 10's format, from the founder's direction during the SEO and marketing work (2026-10-02 to 2026-10-06). Intentionally avoids fixing audiences, positioning, copy or tactics; only the §3 guardrails are fixed. Status DRAFT pending external review.

---

# **§17 — Closing**

Doc 10A points Lyceon's growth in one direction — let people experience the product, tell the truth about it, respect their privacy, keep what makes Lyceon work private — and leaves the how open. The tools are chosen, the ideas are on the table, and testing decides the rest.

**End of Doc 10A V1.0 Draft.**
