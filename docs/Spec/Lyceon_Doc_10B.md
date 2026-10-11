# Lyceon — Document 10B: Content Operations

**Version:** V1.0 (draft for Karl's approval)
**Date:** 2026-10-10
**Owner and approver:** Karl
**Family:** Doc 10 (brand, voice, claim control) → Doc 10A (public surfaces, growth and content direction) → **Doc 10B (how content is produced, checked and published)**
**Status:** Draft. Becomes locked when Karl commits it to `docs/Spec/`.

---

## 1. Purpose

Lyceon publishes content on several channels every week. This document sets **how** that content is planned, written, checked, approved and published, so that it can run on a schedule with minimal day-to-day involvement from Karl, without lowering quality.

It works the way the question bank does: every item passes through fixed stages and automated gates, an independent check, and a recorded human approval before anything goes public.

Doc 10A remains the authority on **what** Lyceon says publicly (positioning, guardrails, disclosure doctrine). This document governs **process**. Where they overlap, Doc 10A wins.

## 2. Principles

1. **Industry standard only.** Standard formats, standard editorial practice and proven tools. Nothing bespoke.
2. **Doc 10A guardrails always apply:**
   - the Public Disclosure Doctrine;
   - claims true as shipped;
   - general facts cite real sources;
   - nothing proprietary (no mechanisms, no bank size, no scoring or mastery logic, no LISA internals);
   - never marketing to under-13s.
3. **Quality before volume.** A missed publish date is acceptable; publishing something wrong is not.
4. **Human approval is recorded.** Karl's approval is a merge of the batch pull request. Nothing reaches the public without it. The automation dial (§7) changes how much of each batch Karl reads, never whether he approves it.
5. **Reads as written by a person.** No AI tells, filler, keyword stuffing, invented statistics, invented testimonials or synthetic people presented as real.
6. **No privacy changes.** Content operations add no trackers, pixels or new data collection. Anything that would change what the Privacy Policy must say is out of scope until the policy is updated first.
7. **Cheap and standard tools.** Prefer what is already in the stack or free and open source (§9).
8. **Disclose the connection.** Whenever Karl (or anyone acting for Lyceon) posts in a community, answers a journalist or writes a guest article, the Lyceon connection is disclosed, in line with FTC endorsement guidance. No undisclosed endorsements, paid or incentivised reviews, or posts presented as coming from an unconnected user.
9. **Helpful, not scaled.** Every item must give a reader something useful they would not get from an existing Lyceon page. No near-duplicate pages, doorway pages or volume produced mainly to rank, consistent with search engines' spam policies on scaled content.
10. **Own or licensed material only.** Images, music and footage are Lyceon's own or properly licensed. Official SAT questions and other copyrighted test material are never reproduced. "SAT" is used as College Board's registered trademark, with the standard non-affiliation notice on long-form content.
11. **Accessible by default.** Images carry alt text; every video carries captions.
12. **Labelling at publish time, not in the artifact.** Content never mentions AI, automation or how it was made; the only AI it names is LISA, as a product feature. Where a platform's rules require a label for AI-generated or synthetic content (e.g. a platform's AI-content toggle), Karl applies it when publishing. Blog posts carry no AI label.
13. **Straight to the point.** Content delivers the information succinctly. It never explains Lyceon's process, how content or the product is built, or any internal workings (Doc 10A disclosure doctrine).
14. **Engineering standards.** Pipeline code follows the Lyceon coding standards: tests with planted defects, idempotent scheduled jobs, structured logs with no secrets or personal data.

## 3. Channels and cadence

| Channel | Format | Cadence | Delivery |
|---|---|---|---|
| Question of the Day | One SAT question on the site, with a dated archive | Daily | Automatic (existing scheduler and readability rules) |
| QOTD social | Portrait and story images, caption, alt text | Daily | Posted to Slack `#social` each morning; Karl posts manually until automated posting (Phase 4) |
| Blog | SEO articles targeting the keyword map | **3 a week:** Monday, Wednesday and Friday, 07:00 America/Chicago | Scheduled publishing (§8) |
| Short video | 20–40 s clips (study tips, product moments) for Shorts, Reels and TikTok | **2 a week** | Later: rendered and delivered to Slack (Phase 3) |
| YouTube long-form | Walkthroughs and guides | Monthly | Manual for now |
| Email newsletter | Monthly update to opted-in users, with a parent-focused section | Monthly | Later (Phase 5); synced marketing segments only |
| Downloadable resources | Free reference material (e.g. SAT math formula sheet, test-day checklist) | 1 a month | Same pipeline. Free to download with no email required; never gated behind an email form for visitors without an account (that would be new data collection). No static "study plans" (personalization is the product) |
| Reddit presence | Founder-led, genuinely helpful answers in SAT communities, following each community's rules and disclosing the Lyceon connection | A few times a week | AI CMO may draft; **Karl posts as himself. Never automated posting** |
| Earned mentions | Journalist queries (e.g. Qwoted, Featured) and guest articles for education and parenting sites | About 2 a month | Same pipeline; Karl approves every submission |
| Parent channels | Helpful posts in parent communities Karl already belongs to, disclosing the Lyceon connection | As opportunities arise | Karl posts; never automated |

## 3A. SAT timeline awareness

The plan (stage 1) is built around the SAT calendar, not just the keyword map.

1. **Calendar source:** official SAT test dates, registration deadlines and score release dates from College Board, kept as configuration in the repo and refreshed each testing year.
2. **Days to test:** every monthly calendar shows the days remaining to each upcoming test and lines up content with them: what to review in the final weeks, test-day preparation, what your score means after release, registration reminders.
3. **News triggers:** official SAT changes, College Board announcements and significant coverage in the space (§3B) prompt the AI CMO to propose timely items **within** the month, in addition to the monthly calendar.
4. **Approval:** every triggered item goes through the full pipeline (§4) and Karl's approval. Nothing is published because a trigger fired.

## 3B. Listening and triggers

Lyceon keeps a pulse on the SAT space: what students and parents are asking, what is changing, and where Lyceon can genuinely help.

**Cadence**
- **Daily:** a short digest to Slack of new, relevant conversations and questions (potential organic leads) for Karl to answer personally if he chooses, plus any SAT news.
- **Weekly:** a "pulse" summary: recurring questions and pain points, emerging topics, and content suggestions for the AI CMO.

**Sources, by priority**
1. Official sources: College Board newsroom and SAT pages.
2. News and search alerts: standard news alerts and RSS feeds.
3. Reddit: through Reddit's official channels only (its Data API with a registered app, and the public RSS feeds Reddit provides), or keyword-alert services verified to operate within Reddit's terms. **Before Phase 6 starts**, Reddit's current Data API terms are checked for this kind of business use; if they require an agreement or approval, it is obtained first. Until then, monitoring is manual plus low-volume use of Reddit's RSS feeds.
4. Other platforms (X, TikTok, YouTube, Instagram): through each platform's official API, where available and within its terms.

**Compliance rules (non-negotiable)**
- **Official access only:** official APIs, RSS feeds or services that operate within each platform's terms. No scraping that ignores `robots.txt` or terms of service, no circumventing blocks (proxies, CAPTCHA solvers, disguised user agents), and no logged-in scraping with personal accounts. Platforms such as Reddit actively prohibit unauthorised commercial scraping and have taken legal action over it.
- **Minimal data:** store a link, the community, the date and a short topic summary. **No usernames, profiles or personal details** are stored or analysed. Many SAT-community participants are minors.
- **Humans respond:** Lyceon never auto-replies, auto-posts, auto-messages or auto-votes. Any response is written and posted by Karl (or a future team member) as a person, following each community's rules.
- **No privacy change:** this collects public discussion topics, not data about Lyceon's users. If a proposed tool or source would change what the Privacy Policy must say, it is out of scope until the policy is updated first.
- **New tools:** any listening tool (open source or hosted) is adopted only after a check that it uses official access and complies with these rules. Karl approves.

## 4. The pipeline

Every item, on every channel, passes these stages in order.

| # | Stage | Done by | Exit condition |
|---|---|---|---|
| 1 | **Plan** | AI CMO skill proposes next month's calendar from the keyword map, the backlog and last month's performance | Karl approves the monthly calendar |
| 2 | **Brief** | AI CMO skill | Each item has: target keyword and search intent, audience (student, parent or both), outline, sources to cite, call to action, and any Lyceon-specific claims flagged for approval |
| 3 | **Draft** | Writer agent (Claude Code with the marketing plugin skills) | Draft complete in the repo content model |
| 4 | **Automated gates** | CI | Every gate in §5 passes |
| 5 | **Independent review** | Codex, on its own trigger (§8.7), with the review rubric and no access to the writer's reasoning | APPROVE in the review record. A REVISE returns to Claude for one revision round; anything still not approved is carried to the next cycle |
| 6 | **Approval** | Karl | Weekly batch pull request merged |
| 7 | **Scheduled publish** | Automation (§8) | Item live on its date |
| 8 | **Post-publish checks** | Automation | Live, in the sitemap, links resolve, page speed within budget; results in the weekly summary |

## 5. Quality gates (stage 4)

Automated; a failure blocks the item.

1. **Claims:** every product or outcome claim matches an approved row in the claim inventory. Banned phrases and unapproved outcome language are rejected (existing guards).
2. **Disclosure doctrine:** no mechanisms, no proprietary details, no bank size, no internal labels.
3. **Sources:** every factual statement about the SAT, scores, tutoring or studying carries a citation. College Board is first choice where it applies.
4. **Source fidelity:** the reviewer agent re-reads each cited source and confirms it supports the sentence that cites it.
5. **Accuracy:** statements about the SAT (format, timing, scoring, dates, policies) are checked against College Board's current official pages; any math is recomputed.
6. **Style:** prose passes the Vale linter with the agreed style guide and an AI-tells rule set.
7. **SEO and structure:** title and meta lengths, one H1, heading order, internal links to the relevant practice and score pages, image alt text.
8. **Links:** all links resolve.
9. **Originality:** the reviewer compares the draft with its cited sources; no copied passages beyond short, attributed quotations, and no reproduced official SAT questions.
10. **Social only:** no answer revealed (existing `socialAssetLeaks` check) and readability rules met.
11. **No duplication:** a new item may not target a search term an existing Lyceon page already covers; if the topic is covered, the existing page is updated instead.
12. **Trademark and captions:** long-form content carries the SAT trademark notice; video carries captions. No mention of AI, automation or process in any artifact (LISA as a product feature excepted).

## 6. Roles

| Role | Who | Responsibility |
|---|---|---|
| Owner and approver | Karl | Approves the monthly calendar and the weekly batch; approves any Lyceon-specific claim; rules on exceptions |
| AI CMO | Claude Code with `.claude/skills/ai-cmo/SKILL.md`, on its scheduled trigger | Planning, briefs, performance summaries |
| Writer | Claude Code, on its scheduled trigger, with the marketing plugin skills | Drafts, self-audits, and applies the auditor's findings |
| Independent auditor | Codex, on its own scheduled trigger | Audits every item and records APPROVE / REVISE / REJECT with evidence (stage 5); never edits content |
| CI and server jobs | GitHub Actions (gates on pull requests) and the existing server cron | Automated gates; scheduled publishing and post-publish checks |
| Claude (chat) | Advisor | Production verification after changes ship |

## 7. Automation dial

Karl's involvement decreases as quality is proven, per channel.

| Level | Karl's involvement | Entry condition |
|---|---|---|
| 1. Full review (start) | Approves the monthly calendar and reviews every item in the weekly batch | Default |
| 2. Spot check | Approves the calendar; reviews about 1 in 5 items, chosen at random | 3 consecutive weekly batches approved with no changes requested |
| 3. Steady state | Approves the calendar; reads the weekly summary and merges the batch without reading every item | 3 further consecutive clean batches at level 2 |

Rules:
- Any change Karl requests resets that channel to level 1.
- Items containing a **Lyceon-specific claim** (product capability, outcome, comparison, own statistics) always require Karl's explicit approval, at every level.
- Automated gates (§5) and the independent review (stage 5) never relax at any level.

## 8. Scheduling mechanics

1. **Monthly:** on the 20th, the AI CMO opens the next month's calendar (audited and revised per §8.7) for Karl's approval by the 25th, built around the SAT calendar (§3A). Timely items prompted by triggers are added mid-month through the same approval.
2. **Weekly:** each Wednesday, the weekly batch trigger (§8.7) opens one pull request with the next week's batch (three blog posts, plus two short videos once Phase 3 ships). By Friday every item has passed stages 1–5; Karl merges to approve.
3. **Publish dates:** each item carries a `publishAt` date (America/Chicago). An approved item is public only once its date arrives. Before then it is not prerendered, not in the sitemap or index, and returns 404.
4. **Daily rebuild:** a daily job triggers the production deploy hook only on days when an item's date arrives, so scheduled items go live without manual action.
5. **Delivery to Slack:** the daily QOTD social assets, and later short videos, are posted to `#social` for posting.
6. **Missed batch:** if a batch is not approved in time, nothing publishes that week. The schedule pauses; it never publishes unapproved content.
7. **Automated triggers (for now):** the pipeline runs on scheduled triggers in Claude Code and Codex (their built-in scheduled-task features). Each trigger carries a short standing prompt that names exactly which repo skill, documents (Doc 10A, this document) and inputs to use. No agent runs unattended in GitHub Actions; CI still runs the automated gates on every pull request, and scheduled publishing (§8.3–8.4) uses the existing server cron.

   **Trigger cadence**

   | Cycle | Claude Code: produce | Codex: independent audit | Claude Code: revise | Karl |
   |---|---|---|---|---|
   | Monthly plan | 20th: proposes next month's calendar (§3A), self-audits it, opens the plan PR | 22nd: audits the plan | 23rd: applies Codex's findings | By the 25th: reads the review record, approves (merge) |
   | Weekly batch | Wednesday: drafts next week's items, runs the gates, self-audits, opens the batch PR | Thursday: audits every item | Friday: applies findings, re-runs the gates, marks the PR ready | Friday to Sunday: reads the review record, merges. Monday's item publishes on schedule |

   **Rules for the triggers**
   - **One review record per cycle** (e.g. `content/batches/<week>/REVIEW.md`), written in order: Claude's self-audit, Codex's audit with a verdict per item (**APPROVE**, **REVISE** or **REJECT**, each with reasons and evidence), Claude's response to each finding, then Karl's decision. Karl reads this one file.
   - **Codex audits, it doesn't edit.** It independently re-checks facts against sources, links, claims, math, artifacts and the gates, and records findings. Claude makes the changes. This keeps the auditor independent of the author.
   - **One revision round.** An item still not approved after Claude's revision is dropped from the batch and carried to the next cycle, flagged in the review record. REJECTed items are dropped.
   - **Safe to re-run.** A trigger that finds its work already done updates it rather than duplicating it. A trigger that finds a required input missing (e.g. no batch PR for Codex to audit) records that in the review record and stops.
   - **Triggers never merge.** Only Karl's merge publishes anything. If the review record isn't approved in time, nothing publishes that cycle (§8.6).
8. **Later:** content operations move to a dedicated Lyceon app with its own triggers and scheduling. That app is a separate project, specified separately; this document's pipeline, gates, review record and approvals carry over to it unchanged.

## 9. Tool stack

| Stage | Tool | Licence / cost | Status |
|---|---|---|---|
| Research, briefs, drafting, review | Claude Code with Anthropic's marketing plugin skills (draft-content, content-creation, seo-audit, brand-review, campaign-plan, email-sequence, performance-report) and web search with citations | Existing Claude and Codex plans (scheduled triggers, §8.7) | Adopt; install the plugin for Claude Code in Phase 1 |
| Prose style and AI-tells checks | Vale, with a standard style guide and a third-party AI-tells style package (chosen and version-pinned in Phase 1) | MIT, free | Adopt (CI gate) |
| Claims and compliance | Existing publish gate and claim inventory | Built | Reuse |
| Links, SEO, page speed | Existing crawl check, link check, Lighthouse | Free | Reuse |
| Images | Existing QOTD card renderer (Playwright, KaTeX) | Built | Reuse |
| Video | Hyperframes via the /brag skill, Kokoro voice, licensed music | Free | Reuse |
| Social posting | Postiz (30+ platforms incl. X, Instagram, TikTok, YouTube) | AGPL-3.0; hosted plan or self-hosted | Phase 4 decision |
| Newsletter | Resend broadcasts with React Email templates | Resend free tier at current volume / MIT | Phase 5 |
| Performance | PostHog, Google Search Console | Free | Existing |

Adding a tool not on this list needs Karl's approval and must not change what the Privacy Policy says.

## 10. Corrections and takedowns

- **Errors:** an error found after publishing is fixed, or the item unpublished, within 24 hours. A correction note is added where the error was substantive.
- **Takedown requests** (copyright, inaccuracy, privacy) are handled within 24 hours, with Karl informed.
- **Every correction** is recorded in the item's history in the repo.

## 11. Measurement

A weekly summary, produced automatically, covers:
- items published, by channel;
- organic search clicks and impressions (Search Console; needs the Search Console data connection, which is still to be set up);
- page views and signups attributed to content (PostHog);
- top and bottom performers, with one suggested change.

No individual user is ever reported on.

## 12. Implementation phases

| Phase | Scope |
|---|---|
| 1 | Blog pipeline: `publishAt` and scheduled publishing, daily rebuild, Vale gate, the review record, the repo skills and standing trigger prompts for Claude Code (produce, revise) and Codex (audit), first month's calendar |
| 2 | QOTD social assets delivered to Slack |
| 3 | Short-video automation with /brag, delivered to Slack |
| 4 | Automated social posting (Postiz or equivalent), after Karl's tool decision. Platform requirements apply: for example Instagram publishing needs a professional account, and TikTok and Meta review apps before they can post publicly |
| 5 | Monthly newsletter to synced marketing segments; daily QOTD email (separate opt-in) |
| 6 | Listening and triggers (§3B): daily Slack digest and weekly pulse, using official access only; SAT calendar configuration and news triggers (§3A) |
| 7 | Downloadable resources and earned-mention workflow |

## 13. Out of scope

- The AI CMO in Slack (post-launch; needs Slack Pro and possibly Claude Team).
- Paid advertising creative.
- On-camera content.
- Any content requiring new tracking or data collection.
- The dedicated content-operations app (§8.8), which gets its own specification.

## 14. Change control

Changes to this document are proposed through the Spec Change Log (SCL) and ruled by Karl. Process improvements that don't change a rule here (for example a new style-guide entry) are made directly in the repo and noted in the weekly summary.
