# 01: Lyceon context

What the CMO needs to know about the company. Facts carry the date they were true. **Anything about current state (users, revenue, prices, what's live) must be re-verified from live data or the living files before you rely on it.** Stable facts (who the customer is, what the doctrine says) can be used directly.

## Contents
1. The company
2. The product (what you may say it does)
3. Customers and audiences
4. Positioning
5. Competitors and alternatives
6. Channels and owned assets
7. Acquisition reality (how people actually arrive)
8. Pricing and the founding cohort
9. The SAT calendar
10. Repo and documents you'll rely on

---

## 1. The company

- **Lyceon** (business name "Lyceon AI"), lyceon.ai. Direct-to-consumer SAT prep for students 13–18, with a guardian (parent) side. US market only; LISA and the service are US-scoped legally.
- **Founder/CEO:** Karl, about eight years as a tutor. Built the product; runs marketing personally today, including all Reddit posting.
- **Status (2026-10-15):** post-launch. "Lyceon is now live" email went to existing signups on 2026-10-07. First real external user signed up 2026-09-27.
- **Slogan:** "Study Smarter, Score Higher." Use it across the platform.
- **Business contact** (legal docs, marketing email footers): Lyceon AI, 5650 Central Ave # E7, Toledo, OH 43615; +1 (419) 415-1885. Karl's mailbox is amingwa@lyceon.ai; marketing email sends as "Karl from Lyceon".
- **Tooling philosophy:** free or cheap at Lyceon's scale (Supabase, Vercel, PostHog) as long as unit economics make sense; industry standard, nothing bespoke; one standard pattern per integration to avoid drift.
- **Repo:** `Lyceon-Team/Lyceonai`. Public as of 2026-10-11 to avoid GitHub/Vercel Pro costs at zero revenue; it goes private once revenue covers those costs. Because the repo is public, nothing proprietary goes in it, including in this skill's living files.

## 2. The product (what you may say it does)

Say what it does for the student; never how (SKILL.md rule 12). Verify each against `docs/marketing/cmo/product-facts.md` before public use.

| Feature | What you may say | Notes |
|---|---|---|
| Diagnostic | A free diagnostic shows where the student stands across the SAT's skill areas | Starting point; activation hinges on it |
| Study calendar | A plan from today to test day; targets weak spots while keeping strong ones from slipping; rebuilds around the test date | "Adaptive" is a stated differentiator; practice adaptivity happens through what the calendar picks |
| Practice | Practice by skill, with explanations | |
| Review | Brings back exactly what the student missed, by skill | |
| Full-length tests | Timed, adaptive full-length practice tests with score reports | |
| LISA | "LISA, your AI tutor": walks through any question step by step, any time; works from the student's own mastery data; knows weak and strong areas | Scoped to SAT only. Honest limit you can joke about: it won't tell you the capital of France |
| Mastery | Mastery by skill, earned from real answers, not guesses | Never explain how it's computed |
| Guardian view | Parent sees scores, the study calendar, test results; guardian accountability loop (plan-change and missed-day notifications, an evening digest) | Live 2026-10-13. Strong answer to "my kid will quit in two weeks" |
| Question of the Day | Daily question on the homepage (answerable logged out) and dashboard, with a streak; opt-in daily email | "% got this right" shown only after 5 entries |
| Score projections | Projected score from mastery | Never publish projection method |

## 3. Customers and audiences

- **Students (13–18):** the main users. Angles: overwhelmed, test-day nerves, late starter, retaker, stuck late at night, self-starter, daily habit (see `hook-bank.md`).
- **Parents/guardians:** usually the buyer. The core target Karl described: an AI-skeptical, middle-aged parent who uses Google and a little ChatGPT. Angles: the worried parent (is my kid actually studying?), the time-poor parent who'd tutor if they could, tutor cost, between tutor sessions, homeschool families.
- **Register:** separate registers. Parents get credibility-led messaging; students 13+ can get attention-led hooks. Audience priority: both, leaning parents (Karl, 2026-10-15). Positioning is not fixed to parent-first (Karl, 2026-10-06): student-first tests are open.
- **Never:** under-13s.

## 4. Positioning

- **What Lyceon is:** a more affordable, more consistent, always-available alternative to the traditional tutor, with a guardian view and mastery evidence that show progress before test day. Not "LISA replaces a live tutor".
- **Tutor framing (Karl, 2026-10-15):** both "instead of a tutor" and "alongside your tutor" are allowed, and should be tested against each other.
- **Price in messaging (Karl, 2026-10-15):** all three framings allowed: price as a hook ("a fraction of the cost"), price last after value, and affordability as a value ("good prep shouldn't depend on your budget"). Mentioning what tutors charge is fine. Cite any tutor-rate figure.
- **Homepage (2026-10-05):** parent-first hero with A/B variants "SAT prep that adapts to you" and "See real progress before test day"; "See how it works" walkthrough video below the hero; pricing at the bottom of the homepage, no separate pricing page.
- **Cost reframe Karl likes (2026-10-13):** about $60/month is roughly two tutor-hours a month; price in units buyers already understand (Sutherland's "horsepower" principle). Needs a cited tutor-rate source before public use.
- **No "AI" in headlines** (Karl, 2026-10-15). Lead with the experience, not the technology.
- **Founder story:** Karl's tutoring background is present but secondary (Karl, 2026-10-15).

## 5. Competitors and alternatives

What the parent actually compares Lyceon to (Dunford's "competitive alternatives"):
- Private in-home or online tutors (the familiar, expensive, trusted option).
- Kaplan-style prep courses and question banks.
- Free official practice (College Board's own materials, Bluebook practice tests).
- Prep books.
- Doing nothing / school support only. Often the biggest competitor.

Competitor comparison pages are deferred until activation is fixed and reviews exist, likely a December/January plan (Karl, 2026-10-15). See gate G7 in `05`.

## 6. Channels and owned assets

| Channel | Status | Notes |
|---|---|---|
| Reddit | Primary acquisition (see §7) | Karl posts manually in SAT subreddits (r/TheSATprep, r/satprep, others besides r/SAT). Never auto-post. Karl's own subreddit r/satquestions (created 2026-10-11) carries the daily QOTD. |
| Google search | Brand search is strong ("Lyceon AI" ranks first) | Non-branded SEO is early; blog runs 3 posts/week through the Doc 10B pipeline. Search Console is set up. Bing Webmaster partial. |
| Email (Resend) | Live | Founding-cohort automations, study reminders, QOTD email, guardian digest. Marketing broadcasts only to the "Marketing — students" and "Marketing — guardians" segments. UTM-tag every link. |
| Instagram | instagram.com/lyceon.ai | QOTD images; faceless short videos |
| X | x.com/lyceonai | |
| TikTok | tiktok.com/@lyceon.ai | Faceless short videos, 2 per week planned |
| YouTube | youtube.com/@lyceonai | Walkthrough video live (https://youtu.be/XLAScABaaoM) |
| Facebook groups | Karl posts in groups he's in | |
| Discord | Planned for founding members who actually engage | Not live as of 2026-10-15 |
| Slack | "Lyceon AI" workspace; #social carries content assets via the "Lyceon Social" app | CMO reports channel: see `07` |
| Trustpilot | The public review site | Review ask for all users (in-app plus email) is wanted |
| Paid ads (Meta, Google) | Not running | Gated (G1). No ad pixels; UTM links plus PostHog only, unless the privacy policy is updated first. |

## 7. Acquisition reality (how people actually arrive)

Karl, 2026-10-09 and 2026-10-15:
- Almost all post-launch signups come from Karl's Reddit posts.
- His posts tell people to DM him or search "Lyceon AI". Searchers find Lyceon on Google (it ranks first for the brand), so they show up in data as **organic search**. People who DM get a direct `lyceon.ai/login` link so they skip the homepage, so they show up as **direct**.
- Therefore: **branded Google search and direct traffic are mostly Reddit's echo**, not SEO. Don't credit SEO for branded search.
- Early users who landed on the homepage often didn't sign up; the /login link cut that friction.
- Known retention problem (2026-10-10): new users land on the dashboard and get lost.

Fixes agreed or proposed: UTM-tag the DM link (e.g. `lyceon.ai/login?utm_source=reddit&utm_medium=dm`), separate branded from non-branded queries in Search Console, and a "how did you hear about us?" question for every new account (approved 2026-10-15; options are the places customers actually are: Google, ChatGPT, Instagram, TikTok, Facebook, YouTube, Reddit, Discord, a friend, "my parent/guardian" for students, "my student" for parents, a school or teacher, other).

## 8. Pricing and the founding cohort

Verify live in Stripe before quoting; these are observations, not standing facts.
- **Observed 2026-10-15:** the live subscription is $59.99/month. Older $0.99/year subscriptions in Stripe are early test-price subscriptions, mostly Karl's own accounts. Treat them as internal.
- **Pricing restructuring** is an open area for Karl. You may propose price or free-tier changes with evidence and reasoning (Karl, 2026-10-15); Karl decides.
- **Founding cohort (from 2026-10-10):** target 30–50 students prepping for the Nov 7 / Dec 5 SAT. Code **ALPHA** gives 100% off, free for two months, no card at checkout; access lapses afterward unless they pay. Redeeming means joining the cohort and accepting study-reminder emails. A reminder email goes to non-redeemers.
- **The moment of truth:** when founding discounts lapse, roughly two months after each redemption (the first redemptions were 2026-10-10). That's the first real revenue test. Track the exact dates in Stripe and in `state.md`.
- **As of 2026-10-15:** real revenue is $0. All active premium entitlements are founding-code redemptions.

## 9. The SAT calendar

- Dates come only from `shared/sat-test-dates.ts` in the repo, or College Board directly. Never type a date from memory.
- Be calendar-aware in every plan: days to the next test, registration deadlines, score-release dates. The founding cohort targets Nov 7 and Dec 5, 2026.
- SAT news can trigger in-month suggestions, all approved by Karl (2026-10-10).

## 10. Repo and documents you'll rely on (Claude Code)

- `CLAUDE.md`, especially the Public Disclosure Doctrine.
- `docs/Spec/Lyceon_Doc_10A.md` (public surfaces, growth and content direction), `docs/Spec/Lyceon_Doc_10B.md` (content operations pipeline), and Doc 10 (brand, public narrative). Read-only.
- `docs/compliance/claim-inventory.md` (approved claims and sources).
- `docs/marketing/keyword-map/` (search demand; built from Karl's Google Keyword Planner export).
- `content/batches/` (the blog pipeline's plans, batches, rubric, review records).
- `shared/sat-test-dates.ts`, `shared/seo/sources.ts`.
- `.claude/skills/content-ops/SKILL.md` (the content department).
- `docs/marketing/cmo/` (your living files; see `07`).
