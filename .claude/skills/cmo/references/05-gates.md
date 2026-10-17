# 05: Prerequisite gates

Karl's rule (2026-10-15): nothing is a yes-or-no question. Every initiative has a gate: a checklist of prerequisites. While a gate is closed, the CMO's job is to work toward opening it (and say which prerequisite is the bottleneck). When every box is checked, the CMO brings Karl a plan using the opening memo (`06`), Karl approves, and it executes.

The living version with current status is `docs/marketing/cmo/gates.md`. This file is the baseline catalog; status below is as of 2026-10-15 and must be re-checked live. Thresholds marked *(proposed)* are the CMO's proposals awaiting Karl's approval.

## Contents
- How to use a gate
- G1 Paid ads (Meta, Google)
- G2 A/B tests
- G3 Customer interviews and market research
- G4 Reviews program
- G5 School outreach
- G6 After-school programs, tutoring centers, counselors
- G7 Comparison pages (competitor and tutor)
- G8 Publishing score outcomes
- G9 Ambassador and referral rewards
- G10 Creators and influencers
- G11 Press, journals and research
- G12 Capped cohorts and real scarcity offers
- G13 Price changes
- G14 Free-tier changes
- G15 Launching a new channel
- G16 Email broadcasts and new sequences
- G17 Community (Discord)
- G18 Raising automation on a content stream
- G19 Conversational CMO in Slack
- Gate status table (baseline)

## How to use a gate

1. When Karl asks "should we do X?" or you want to propose X, find its gate.
2. Check every prerequisite live. For each: met, partly met, or not met, with the evidence (a query result, a file, Karl's statement).
3. All met: write the opening memo (`06`) with the plan template below.
4. Not all met: report which prerequisite is the bottleneck, what would close it, and an honest estimate of when. Propose the work that closes it if it's worth doing now.
5. Never open a gate by lowering a prerequisite yourself. Propose the change to Karl with the reason.
6. New initiative without a gate: draft one in the same format, mark it *(proposed)*, and bring it to Karl.

Every gate also inherits the universal prerequisites: the legal rules in SKILL.md, the disclosure line, true-as-shipped claims, and a success metric plus minimum run length set before launch.

---

## G1 Paid ads (Meta, Google)

**Why:** scale acquisition once organic shows what lands.
**Prerequisites:**
- Budget approved by Karl, with a monthly cap. *(Evidence: Karl's ruling.)*
- Ad accounts set up (Meta Business, Google Ads). *(Karl confirms; Karl says profiles exist.)*
- Ad assets exist and passed review: at least 3 creatives per angle for 2 angles. *(proposed)*
- Analytics wired: UTM convention defined; landing pages tagged; PostHog funnel from ad click → signup → first useful action works end to end. No ad pixels unless the privacy policy is updated first.
- Contribution per customer known: price minus AI cost per active student minus payment fees; a target cost per acquisition derived from it. *(Sanchez, Hormozi.)*
- The growth gate holds: a retention threshold Karl approves (e.g. a share of new students still active in week 4) *(proposed)*. Don't buy traffic into a leaky product. *(Altman.)*
- At least one organic angle with evidence it converts (signups per post or per page above the sample threshold).
**Plan template:** audience (parent or student, never under 13), angle and hook from the bank, creative, landing page, budget and duration, UTM tags, success metric and cut-off, stop conditions.
**Success / kill:** cost per activated student below target after the minimum run; pause immediately on policy flags or runaway spend.
**Status:** not open. Budget, assets, contribution margin and growth gate are open items.

## G2 A/B tests

**Why:** learn what message or page works.
**Prerequisites:**
- Enough traffic on the tested page to reach the sample rule in `03` §7 (≥100 visitors and ≥20 conversions per arm) within the test's run length. Compute the forecast first.
- One variable per test; the hypothesis written down; the success metric and run length fixed before launch.
- PostHog experiment or feature flag wired; both arms render correctly.
- Both variants pass the disclosure and claims rules.
**Status:** traffic is the bottleneck for most pages as of 2026-10-15. Recommend tests only where the forecast says they'll finish; otherwise collect qualitative evidence (interviews, replays) instead.

## G3 Customer interviews and market research

**Why:** real buyer language (Schwartz, Dunford, Sanchez's Money Story Audit).
**Prerequisites:**
- An interview guide approved by Karl (the CMO drafts it).
- Parents only for interviews; students only with a parent's knowledge and never about personal matters. Nothing identifying goes into any prompt or file.
- Karl conducts or approves who conducts.
- Desk research (web, public reviews, Reddit threads) has no gate beyond the universal rules; do it freely.
**Status:** desk research open; interviews ready to propose.

## G4 Reviews program

**Why:** proof for skeptical parents (Cialdini, Ogilvy).
**Prerequisites:**
- The review ask built to standard: same neutral ask to everyone, in-app and email, 13+ only, student and guardian buckets, Trustpilot link. No gating, no incentives tied to sentiment.
- Users have had enough time with the product to judge it (e.g. 14 days of activity) *(proposed)*.
- A plan for responding to negative reviews (Karl's voice, quick, specific).
**Status:** wanted (2026-10-15); not built.

## G5 School outreach

**Why:** a channel that reaches many families at once; credibility.
**Prerequisites:**
- Research done: what the target schools actually need (counselor workload, SAT prep gaps, budget cycles, data-privacy requirements such as FERPA and state student-privacy laws, district procurement and approval steps). Researcher brief exists.
- An offer designed for schools (pricing, licensing, what data a school sees), approved by Karl.
- Privacy and data handling ready for an institutional customer (data agreement template, what's shared with whom). Needs legal and engineering.
- Proof assets: outcome or usage evidence that meets G8, or a pilot proposal that doesn't depend on outcome claims.
- A named list of target schools and contacts, built from public information only.
- Karl approves every outreach message (it contacts people outside Lyceon).
**Status:** not open. Research can start now.

## G6 After-school programs, tutoring centers, counselors

**Why:** partners who already serve SAT students; "alongside your tutor" positioning.
**Prerequisites:** same shape as G5, lighter on procurement: research what the partner needs and earns; a partner offer (referral fee, bulk access) approved by Karl; disclosure of any paid relationship; Karl approves outreach.
**Status:** not open. Research can start now.

## G7 Comparison pages (competitor and tutor)

**Why:** buying-intent search; Dunford's "show where Lyceon fits".
**Prerequisites:**
- Activation fixed (Karl, 2026-10-15): the defined activation metric at a level Karl accepts.
- Reviews exist (G4) to support the claims.
- Every comparative statement is factual, sourced, current, and fair, including where the alternative wins.
- Karl approves each page.
**Status:** deferred to roughly Dec/Jan (Karl, 2026-10-15).

## G8 Publishing score outcomes

**Why:** the strongest proof there is, if honest.
**Prerequisites:**
- Enough students with a baseline and a real final score (self-reported official SAT score, collected with consent) to report a meaningful number *(proposed: at least 30)*.
- The metric defined: what's measured, over what period, for whom.
- Denominators and typical-result language; no cherry-picking; FTC endorsement and testimonial rules.
- Never reveal the projection or mastery method.
- Karl approves the exact wording.
**Status:** not open. Collecting final scores is the bottleneck; propose the collection mechanism early so data accrues.

## G9 Ambassador and referral rewards

**Why:** Karl wants an ambassador program (to build Reddit presence through users) eventually.
**Prerequisites:**
- The simple share link (no reward) live and measured first.
- Evidence of organic recommending (survey answers "a friend", referred signups).
- Reward design that never collects other minors' contact details, never conditions on reviews, and is disclosed wherever ambassadors post (FTC endorsement rules apply to ambassadors).
- Ambassador guidelines (no spam, follow each subreddit's rules, disclose the relationship).
- Karl approves.
**Status:** share link only (2026-10-15).

## G10 Creators and influencers

**Prerequisites:** a vetting checklist (audience age mix, past content, claims they've made); a disclosure plan; a brief that keeps them inside the claims rules; a tracking link per creator; budget approved; Karl approves each partner. Student creators require extra care: never ask a minor to make claims about results; work through a parent where needed.
**Status:** "when the need arises" (2026-10-15).

## G11 Press, journals and research

**Why:** credibility. Includes press pitches, guest articles, and academic or research collaboration (learning-science publication).
**Prerequisites:** a story worth telling (a real milestone, real data meeting G8, or a genuine point of view); a press kit (facts, founder bio, screenshots) approved by Karl; for research, data handling and consent reviewed, and nothing proprietary disclosed. Karl approves every pitch.
**Status:** not open.

## G12 Capped cohorts and real scarcity offers

**Prerequisites:** the cap is real and enforced; the offer's terms are written down (what, until when, what happens after); the deadline is honored; Karl approves.
**Status:** allowed when needed (2026-10-15).

## G13 Price changes

**Prerequisites:**
- Evidence: conversion at the current price, churn, competitor and tutor price points (sourced), interview findings on willingness to pay. *(Sutherland, Hormozi, Altman.)*
- A plan for existing payers (grandfathering, notice). *(Jobs.)*
- Stripe and app changes scoped (needs engineering).
- Karl decides.
**Status:** CMO may propose with evidence (2026-10-15).

## G14 Free-tier changes

**Prerequisites:**
- Evidence on how free users behave: how many convert, whether free usage covers what most students need, cost to serve free users.
- What the free tier must keep doing (the lead magnet: the diagnostic and QOTD).
- Karl decides.
**Status:** CMO may propose; Karl specifically wants to know if the free tier is too generous (2026-10-15).

## G15 Launching a new channel

**Prerequisites:** a reason (where the target audience actually is, with evidence); an owner and weekly time cost (Karl's time counts); a content plan for the minimum run; tracking (UTM, survey option); a kill criterion. Hormozi's rule: one channel working before adding the next; but building the second channel while the first works is the hedge against a single point of failure (Reddit).
**Status:** organic social channels exist; judge each by its own numbers, separately from Reddit.

## G16 Email broadcasts and new sequences

**Prerequisites:** the right segment only (opted-in guardians and students 13+; never manual imports); a reason the recipient will be glad to get it; sender name and subject conventions; UTM-tagged links; frequency check against Karl's "few, clear, recognizable" rule; Karl approves new broadcasts and new sequences.

## G17 Community (Discord)

**Prerequisites:** founding members who actually log in and engage (Karl, 2026-10-10); moderation plan and rules for a 13–18 community (safety first: no private contact between adults and minors via Lyceon; reporting tools); an owner; Karl approves.

## G18 Raising automation on a content stream

**Prerequisites:** 3 consecutive Karl approvals with no pushback on that stream (count recorded in PR descriptions); the publish gate and claims approval stay manual.

## G19 Conversational CMO in Slack

**Prerequisites:** Slack Pro (and Claude Team if the shared Claude Tag identity is wanted). Until then, scheduled routines post to Slack and conversation happens in Claude Code or the Claude app.
**Status:** post-launch (2026-10-07).

---

## Gate status table (baseline 2026-10-15; re-check live)

| Gate | Status | Bottleneck |
|---|---|---|
| G1 Paid ads | Closed | Budget, assets, contribution margin, growth gate |
| G2 A/B tests | Mostly closed | Traffic per page |
| G3 Research and interviews | Open (desk); ready (interviews) | Interview guide approval |
| G4 Reviews | Closed | Review ask not built |
| G5 Schools | Closed | Research, school offer, data agreements |
| G6 Partners | Closed | Research, partner offer |
| G7 Comparison pages | Deferred | Activation, reviews |
| G8 Score outcomes | Closed | Final-score collection |
| G9 Ambassadors | Share link only | Measured share link, reward design |
| G10 Creators | Closed | Need, budget, vetting |
| G11 Press/research | Closed | A story and proof |
| G12 Capped cohorts | Open when needed | — |
| G13 Price | Proposal open | Evidence |
| G14 Free tier | Proposal open | Evidence |
| G15 New channel | Per channel | Evidence, Karl's time |
| G16 Email | Per send | Karl approval |
| G17 Discord | Closed | Engaged founding members |
| G18 Automation | Per stream | Approval streak |
| G19 Slack CMO | Closed | Slack Pro |
