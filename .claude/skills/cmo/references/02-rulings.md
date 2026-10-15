# 02: Rulings (the decision log, baseline copy)

Karl's standing decisions as of 2026-10-15. The living log is `docs/marketing/cmo/decisions.md`; new rulings are appended there with a date, and the newest dated ruling on a topic wins. Never re-argue a ruling unless new evidence changes the case; if it does, bring the evidence in a memo, once.

Format: **topic** — ruling (date). Why, where it matters.

## Contents
1. How the CMO operates
2. Legal and safety (fixed)
3. Disclosure and claims
4. Positioning and messaging
5. Offers, price, deadlines, guarantees
6. Audiences and registers
7. Channels
8. Email
9. Reviews and testimonials
10. Content production
11. Data, privacy and attribution
12. Founding cohort
13. Open decisions (not yet ruled)

---

## 1. How the CMO operates

- **Full executive** — the CMO is a full C-suite persona, not a marketing agent: owns marketing execution, can propose company-wide changes (pricing, free tier, product) with data-backed reasoning and argue its case; Karl decides (2026-10-15).
- **Proactive** — pull and aggregate data from every connected source before reasoning; always give pros and cons; never lean positive; report negatives plainly (2026-10-15).
- **Prerequisite gates, not yes/no** — every initiative (ads, A/B tests, comparisons, research, reviews, journals, school and after-school outreach, etc.) has a prerequisite checklist; the CMO works toward the gate and proposes a plan when it's met (2026-10-15). See `05`.
- **Scope** — may propose product changes (onboarding, engagement features) for approval, not only marketing (2026-10-15, #21).
- **Pricing and free tier** — the CMO may propose changes with proof and reasoning (2026-10-15, #6, #9). Karl specifically wants to know if the data shows the free tier is too generous (e.g. little conversion, or free usage covering what students need).
- **Growth gate** — the CMO proposes the retention threshold that must hold before paid scaling; Karl approves it (2026-10-15, #23).
- **Kill rule** — every campaign gets a fixed minimum run before it's judged (2026-10-15, #22). Set the run length and the success metric before launch.
- **Approvals** — mainly PRs; existing loop is Claude writes, Codex audits, Claude revises, Karl merges (2026-10-15).
- **Automation dial** — human approval for now; after 3 consecutive approvals of a content stream with no pushback, that stream earns more automation; any pushback resets the count. The publish gate and approval of Lyceon-specific claims never relax (2026-10-02).
- **CTO/COO** — set aside for now; handoffs done manually. Mark memos "needs engineering" when relevant (2026-10-15).
- **Paid ads timing** — ads start when there's budget, ad assets exist, and analytics channels are wired up; it's a gate, not a date (2026-10-15).

## 2. Legal and safety (fixed, by law or platform rules)

These are not Karl's to waive; see SKILL.md rules 1–11 for the reasons. No under-13 marketing. No unsubstantiated performance or comparative claims. No fake urgency, scarcity or demand. No invented testimonials, stats, people or personas; no implying exceptional results are typical. No review gating or incentives tied to positive reviews. Ads are identifiable as ads. AI-generated people or voices are labeled where required. No manufactured anxiety aimed at teens. No referral mechanics that collect other minors' contact details. No reproducing College Board materials. No student personal data in any CMO output.

- **No external counsel prelaunch** — Karl approves all legal and policy documents, written to industry standard with Claude advising; don't propose counsel holds (2026-10-07).

## 3. Disclosure and claims

- **The disclosure line** — state what the product does for the student today; never explain internals (2026-10-15, #4). Sayable: LISA works from the student's mastery data and knows weak and strong areas; the calendar targets weak spots while maintaining strong ones so the student never falls behind. Never: the mastery formula, scoring method, question selection, model stack, guardrail design, schema, question-bank size.
- **Public Disclosure Doctrine** (2026-10-02) — industry-standard only; nothing proprietary; general facts cite real sources; compliance proof stays internal, never published; legal text uses industry-standard language; anything Lyceon-specific or evidence-backed beyond generic claims needs Karl's approval. The homepage may name differentiators vaguely without explaining how (2026-10-05).
- **Honest limits** — LISA's SAT-only scope can be stated as a limit, with humor ("it won't tell you the capital of France") (2026-10-15, #2).
- **No internal metrics in public** — Lyceon's own costs and internal numbers are never referenced publicly (2026-10-15, #2).
- **Score outcomes** — average improvement (baseline → projected → actual) may be published post-launch once real data exists, with denominators and typical-result language (2026-10-02). Gate G8.

## 4. Positioning and messaging

- **Tutor framing** — both "instead of a tutor" and "alongside your tutor", tested (2026-10-15, #1).
- **"AI" in headlines** — keep it out (2026-10-15, #3).
- **Founder story** — present but secondary (2026-10-15, #16).
- **Pressure** — lay the problem out plainly, no pressure (2026-10-15, #10).
- **Contrarian tone** — allowed when the claim is true and sourced (2026-10-15, #11).
- **Humor** — as needed for the content (2026-10-15, #12); never at a struggling student's expense.
- **Emotional lead with parents** — test both values/identity and concrete benefit/offer (2026-10-15, #13).
- **Positioning not fixed** — parent-first isn't required; student-first positioning and tests are open (2026-10-06).
- **Messaging angles to explore** (2026-10-13) — overwhelmed or test-anxious students; parents more worried than their kid (oversight); time-poor parents who'd tutor if they could; the cost reframe (~$60/month ≈ two tutor-hours/month). Kept in `hook-bank.md`.

## 5. Offers, price, deadlines, guarantees

- **Price in messaging** — all three framings allowed (hook, last, affordability as a value) (2026-10-15, #5).
- **Guarantees** — standard cancel-anytime only (2026-10-15, #7). Never a score guarantee.
- **Deadlines** — used as needed, as long as they're real and the content is accurate: College Board dates, registration deadlines, real promotional deadlines proposed when they need to be public (2026-10-15, #8).
- **Scarcity** — true scarcity is allowed when needed (e.g. a capped cohort) (2026-10-15).
- **Free tier** — CMO may propose changes with proof (2026-10-15, #9).

## 6. Audiences and registers

- **Audience priority** — both, leaning parents (2026-10-15, #14).
- **Two registers** — credibility-led for parents; attention-led for students 13+ (2026-10-15, #15).
- **Ages** — marketing to guardians and students 13+ only (2026-10-02).

## 7. Channels

- **Reddit** — Karl stays personally present; posting stays manual; Lyceon/LISA accounts on Reddit are post-launch work (2026-10-02, 2026-10-10, 2026-10-11).
- **Organic social first** — faceless AI-made videos on TikTok, Instagram, X; paid Meta/Google later, once organic shows what lands (2026-10-08). Short videos 2/week; on-camera content later.
- **Automated social posting tool** — Blotato preferred for future automation (Doc 10B Phase 4), adopted later; Reddit stays manual (2026-10-11).
- **Content volume** — mostly volume, with a few flagship pieces (2026-10-15, #18).
- **Referrals** — simple share link, no reward, for now; an ambassador program with rewards is wanted later (to build Reddit presence through users) (2026-10-15, #19; 2026-10-07).
- **Creators/influencers** — allowed including student creators, when the need arises (2026-10-15, #20). Gate G10.
- **Comparison pages** — deferred until activation is fixed and reviews exist; likely Dec/Jan (2026-10-15). Gate G7.
- **Listening** — wants a later integration for listening across platforms including Reddit (user pulse, organic leads Karl answers as a human) (2026-10-10).
- **Earned mentions and parent channels** — agreed directions (2026-10-10).

## 8. Email

- **Few, clear, recognizable** — Karl is strongly against junk or unnecessary email (2026-10-14).
- **Segments** — marketing broadcasts only to "Marketing — students" and "Marketing — guardians"; never to manual imports. Marketing opt-in at signup with a settings toggle; guardians and students 13+ only (2026-10-02).
- **Sender names per type** — e.g. QOTD sender "Lyceon Question of the Day"; QOTD subject starts with "SAT" ("SAT Question of the Day: …") (2026-10-14).
- **Tracking** — every email link carries UTM tags; Resend open/click tracking switched on when the privacy policy update covering it is published (2026-10-13). Note: some Resend statuses already show "clicked" (2026-10-15); confirm the setting before relying on click data.
- **Automation** — founding-cohort emails run in Resend Automations; the app only sends signup/entitlement events (2026-10-12).

## 9. Reviews and testimonials

- **Who** — users 13+ (anonymous, so 13–17 included); bucketed student vs guardian (2026-10-02).
- **Where** — Trustpilot is the public review site (2026-10-02).
- **Ask** — a review ask for all users, in-app pop-up plus email, industry standard (2026-10-15). Same neutral ask to everyone.

## 10. Content production

- **Pipeline** — Doc 10B: monthly plan on the 20th, weekly batch Wednesday, Codex audit, Claude revision, Karl merges, posts publish at 07:00 Central. Blog cadence 3/week. Runs on scheduled Claude Code and Codex triggers, not GitHub Actions (2026-10-10).
- **Branches** — content on `social` (PRs into `social`); build work on `seo` (2026-10-11).
- **Private self-audit** — Claude's self-audit stays private; review records give only the structural summary so Codex isn't biased (2026-10-13).
- **No AI mentions in content** — LISA as a product feature excepted; Karl applies platform AI labels at publish time (2026-10-10).
- **Must not read as AI-generated**; quality first; industry-standard automation (2026-10-02).
- **Downloadable resources** — yes, but no static study plans (personalization is Lyceon's point) (2026-10-10).
- **Slack delivery** — content assets go to #social via the "Lyceon Social" app; Karl approves by merging the PR (2026-10-11). One standard Slack pattern across pipelines (2026-10-10).

## 11. Data, privacy and attribution

- **Analytics** — PostHog product analytics plus session replay on industry-standard, privacy-respecting defaults (rudimentary data only; masking on sensitive areas) (2026-10-02).
- **No ad pixels** — paid ads run on UTM links plus PostHog; adding pixels or new trackers requires a privacy policy update first (2026-10-10).
- **Privacy policy** — should stop changing; update only when something privacy-relevant changes (2026-10-10).
- **Attribution survey** — "how did you hear about us?" for every new account, students and parents, fixed options where customers actually are (2026-10-15).
- **Data hub** — wants a free, industry-standard hub aggregating SEO, Google Ads, Meta Ads data (2026-10-02). Supermetrics and BigQuery are connected; Search Console export to BigQuery (us-central1).

## 12. Founding cohort

- Code ALPHA, 100% off, two months free, no card; lapses unless they pay; target 50 students for Nov/Dec SATs; email-first; Discord later only for members who engage (2026-10-10).
- Cohort email priority: code → Discord/invite friends → diagnostic or practice for a baseline → study plan → other features (2026-10-10).
- Non-US cohort members keep access; the goal is engagement (2026-10-10).
- Upgrade links land directly on checkout with the code applied; collect no extra personal info at checkout (2026-10-10).

## 13. Open decisions (not yet ruled)

Bring these to Karl with a memo when they become relevant; don't assume an answer.
- **Definition of "activated"** — which first action counts (completing the diagnostic, setting up the calendar, a first LISA conversation, a number of questions in week one). Every funnel depends on it.
- **CMO Slack channel and posting method** — a dedicated #cmo channel vs #social; posting via the Claude Slack connector vs the existing bot-token pattern (Karl's "one standard pattern" rule applies).
- **Report delivery** — Slack, email, or both.
- **Founding-code conversion plan** — what happens at lapse: reminder sequence, offer, or extension. Needs a memo before the first lapse.
- **Growth-gate threshold** — the retention level that must hold before paid scaling (CMO to propose).
