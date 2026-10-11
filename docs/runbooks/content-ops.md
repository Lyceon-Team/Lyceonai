# Runbook — the blog pipeline (Doc 10B Phase 1)

> @spec [docs/Spec/Lyceon_Doc_10B.md §3A, §4, §5, §8; owner brief "Doc 10B Phase 1 — blog
>
> > pipeline" and owner answers on Step 0 (Karl, 2026-10-11)] | @implemented [2026-10-11]

Three posts a week (Monday, Wednesday and Friday at 07:00 Central), planned a month ahead around
the SAT calendar. Claude writes, Codex audits, Karl merges. Nothing publishes without Karl's merge.

## 1. The week and the month

| When (Central)          | Who                                         | What                                                                                               |
| ----------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 20th, 09:07             | Claude routine "Content: monthly plan"      | Next month's calendar: `content/batches/<YYYY-MM>-plan/PLAN.md`, self-audited, draft PR into `seo` |
| 22nd                    | Codex task "Content: monthly audit"         | Audits the plan into its review record                                                             |
| 23rd, 09:07             | Claude routine "Content: monthly revise"    | Answers Codex, marks the plan PR ready                                                             |
| by the 25th             | Karl                                        | Reads `REVIEW.md`, merges the plan PR                                                              |
| Wednesday, 09:07        | Claude routine "Content: weekly produce"    | Next week's three posts from the approved plan, gates run, self-audit, draft PR                    |
| Thursday                | Codex task "Content: weekly audit"          | APPROVE / REVISE / REJECT per post, with evidence                                                  |
| Friday, 09:07           | Claude routine "Content: weekly revise"     | Fixes each REVISE (one round), drops REJECTs, re-runs the gates, marks the PR ready                |
| Friday–Sunday           | Karl                                        | Reads `content/batches/<cycle>/REVIEW.md`; merges the batch PR into `seo`, then `seo` into `main`  |
| Mon/Wed/Fri 07:00–07:59 | Vercel cron `/api/internal/content-publish` | On a day a post is due, triggers the production deploy hook; the post goes live                    |

**What Karl's merge does.** Merging a batch PR into `seo` runs **Content batch approval**, which
stamps the cycle in `content/batches/approvals.json` (only Karl's merge stamps; only that workflow
writes the file). A post is approved exactly when its cycle has a stamp. Production builds from
`main`, so the batch reaches the site after the `seo` → `main` merge (two merges a week, owner
answer 2). From then on each post is withheld from the build until its date: not prerendered, not
in the sitemap, its URL a 404, its text in no bundle. On its date the cron rebuilds and it appears.
**Missed merge:** nothing publishes that week (Doc 10B §8.6).

**When a batch PR is marked ready** a summary goes to `#social` (titles, publish dates, Codex
verdicts, the PR link): `.github/workflows/content-batch-notify.yml`, set up in
`docs/runbooks/slack.md`.

## 2. One-time setup (Karl)

1. **Approver.** Repository **Settings → Secrets and variables → Actions → Variables**:
   `CONTENT_APPROVER_LOGIN` = your GitHub login. Only a merge by that login stamps an approval.
   Note: pull requests Claude opens from these sessions are authored under the same GitHub
   account (`kingk237`). The approval rests on who **merges**, and the routines never merge.
2. **Let the stamp reach `seo`.** If `seo` is protected against direct pushes, allow GitHub
   Actions to push to it (branch protection or ruleset bypass for `github-actions[bot]`).
   Otherwise the stamp commit fails, the **Content batch approval** run is red, and nothing in
   that batch publishes until it is fixed and re-run.
3. **Required check.** Make **Content batch checks / review-record** a required status check on
   `seo`. It blocks a ready batch without Codex's verdicts or without a Claude response to every
   REVISE, and any hand edit of `approvals.json`.
4. **Slack.** `SLACK_BOT_TOKEN` (secret) and `SOCIAL_SLACK_CHANNEL_ID` (variable, renamed from
   `QOTD_SLACK_CHANNEL_ID`): `docs/runbooks/slack.md`.
5. **Vercel.** The publish cron uses the existing `CRON_SECRET` and `VERCEL_DEPLOY_HOOK_URL`
   (the same deploy hook the QOTD schedule uses). Nothing new.
6. **Codex tasks.** Create the two Codex scheduled tasks in §4 with the text exactly as written.
   Until they exist, run the audit by hand with the same text (owner answer 9).
7. **Enable the four Claude routines** (§3) after the dry run. They were created disabled, from a
   cloud session, and that kind of creation stores **no repository and no connectors**: as created,
   a fired session would start without this repository and without GitHub tools. Before enabling
   each one, open it in claude.ai → Routines and add the repository `Lyceon-Team/lyceonai` and the
   GitHub connector (to open and update pull requests). IDs: weekly produce
   `trig_01NopMoZVoiGFHeNcWR53QDw`, weekly revise `trig_01Fgz5GBaWie9YFmrpjjgMZK`, monthly plan
   `trig_016Bdv7HPn16CYJFFqucMaYD`, monthly revise `trig_014BH4yEAeb9mqirH74rXrZt`.
8. **Marketing plugin.** `.claude/settings.json` declares `marketing@knowledge-work-plugins`.
   Claude Code's documentation says plugins declared by a project do not load in a cloud
   session, so the cloud routines may run without it. The `content-ops` and `ai-cmo` skills carry
   everything the pipeline needs; the plugin's skills are an aid, not a dependency.

## 3. The four Claude routines (created disabled, 2026-10-11)

Each fires a fresh Claude Code session on this repository (America/Chicago). The standing
prompts, exactly as stored:

**Content: weekly produce** (Wednesdays 09:07)

> Run the content-ops skill (.claude/skills/content-ops/SKILL.md), stage "Produce: weekly batch",
> for next week's cycle in Lyceon-Team/lyceonai. Read everything the skill says to read first.
> The skill is safe to re-run: if the cycle's branch, pull request or review record exists, update
> it. If a required input is missing (no approved plan covering next week), record that in the
> review record and stop. Never merge, never push to seo, never mark the pull request ready, never
> edit docs/Spec or content/batches/approvals.json. End with the cycle, the pull request link,
> each post and its publish date, and every gate's result.

**Content: weekly revise** (Fridays 09:07)

> Run the content-ops skill (.claude/skills/content-ops/SKILL.md), stage "Revise", for the
> current weekly batch in Lyceon-Team/lyceonai: the open draft pull request into seo titled
> "content: <cycle> batch" whose posts publish next week. Read everything the skill says to read
> first. Apply Codex's findings (one round), respond to every REVISE and REJECT in section 3 of
> the review record, re-run every gate, then mark the pull request ready for review. If Codex's
> audit is missing, record that in section 3 and stop without marking it ready. Safe to re-run.
> Never merge, never push to seo, never edit Codex's section except to copy Codex's pull request
> comment verbatim as the skill describes.

**Content: monthly plan** (20th of each month, 09:07)

> Run the content-ops skill (.claude/skills/content-ops/SKILL.md), stage "Produce: monthly plan",
> for next month in Lyceon-Team/lyceonai. Read everything the skill says to read first. Generate
> the skeleton with scripts/content/plan-skeleton.ts (never retype SAT dates), fill one row per
> slot, self-audit, and open or update the draft pull request "content: <YYYY-MM> plan" into seo.
> Safe to re-run. Never merge, never push to seo, never mark the pull request ready.

**Content: monthly revise** (23rd of each month, 09:07)

> Run the content-ops skill (.claude/skills/content-ops/SKILL.md), stage "Revise", for next
> month's plan in Lyceon-Team/lyceonai: the open draft pull request "content: <YYYY-MM> plan"
> into seo. Read everything the skill says to read first. Apply Codex's findings, respond in
> section 3 of the review record, re-run the gates, then mark the pull request ready for review.
> If Codex's audit is missing, record that and stop without marking it ready. Safe to re-run.
> Never merge, never push to seo.

## 4. The Codex tasks (Karl creates these)

Codex audits; it never edits content (Doc 10B §8.7). Paste each text as the task's prompt.

**Content: weekly audit** (Thursdays, morning Central)

```text
You are the independent auditor in Lyceon's blog pipeline (docs/Spec/Lyceon_Doc_10B.md §4 stage 5
and §8.7). You audit; you never edit content.

1. In Lyceon-Team/lyceonai, find the open pull request into `seo` titled "content: <cycle> batch",
   where <cycle> is next week's ISO week (for example 2026-W45). If there is none, stop and reply
   "No batch to audit for <cycle>."
2. Check out its head branch. Read content/batches/RUBRIC.md, docs/Spec/Lyceon_Doc_10B.md §2 and
   §5, and the "Public Disclosure Doctrine" in CLAUDE.md. Do NOT read "## 1. Claude self-audit" in
   content/batches/<cycle>/REVIEW.md before you have formed your verdicts.
3. The batch's posts are the files shared/content/posts/<slug>.ts whose `batch` is "<cycle>".
   For each post, check every rubric row R1-R12: open every cited source and confirm it says what
   the sentence citing it says; check every SAT fact against College Board's current pages;
   recompute any math; open every link; look for anything proprietary, any mention of AI,
   automation or process (LISA named as "your AI tutor" is the only exception), invented
   statistics or people, copied passages, and anything aimed at under-13s.
4. In content/batches/<cycle>/REVIEW.md, under "## 2. Codex audit" only:
   - set the Source line to "Source: Codex scheduled task, <today YYYY-MM-DD>";
   - replace the placeholder row with one row per post:
     | `<slug>` | APPROVE or REVISE or REJECT | reasons | evidence |
     Evidence is a URL with the quoted text, a recomputed figure, or a CI run link.
   REVISE means fixable by editing the post; REJECT means it cannot be fixed this cycle (see the
   rubric). Change nothing else in that file or in the repository.
5. Commit only that file. End the commit message with the trailer line:
   Audit-By: Codex
   Push it to the pull request's head branch. CI rejects a Codex commit that changes anything but
   that section.
6. If you cannot push to the branch, post the section instead as one comment on the pull request:
   the first line "Codex audit for <cycle>", then the table with its header row. Claude copies it
   into the review record verbatim and CI checks the copy against your comment.
7. Running again for the same batch: update your rows in place; never add a second set. Never
   merge, approve, or mark the pull request ready.
```

**Content: monthly audit** (22nd of each month)

```text
You are the independent auditor in Lyceon's blog pipeline (docs/Spec/Lyceon_Doc_10B.md §3A, §8.1
and §8.7). You audit; you never edit content.

1. In Lyceon-Team/lyceonai, find the open pull request into `seo` titled "content: <YYYY-MM> plan"
   for next month. If there is none, stop and reply "No plan to audit for <YYYY-MM>."
2. Check out its head branch. Read content/batches/RUBRIC.md, docs/Spec/Lyceon_Doc_10B.md §3A and
   §5, and the "Public Disclosure Doctrine" in CLAUDE.md. Do NOT read "## 1. Claude self-audit" in
   content/batches/<YYYY-MM>-plan/REVIEW.md before you have formed your verdict.
3. Audit content/batches/<YYYY-MM>-plan/PLAN.md:
   - every SAT date, deadline and score release matches College Board's current pages
     (https://satsuite.collegeboard.org/sat/dates-deadlines and
     https://satsuite.collegeboard.org/scores/score-release-dates) and shared/sat-test-dates.ts;
   - the days-to-test figures are right (recompute them);
   - every Monday, Wednesday and Friday of the month has one row;
   - no target keyword is already the targetKeyword of an existing page under shared/content/
     (case and plurals ignored), and no two rows share one;
   - each topic is helpful beyond the existing pages, fits the Public Disclosure Doctrine, names
     no AI, automation or process, and is not aimed at under-13s.
4. In content/batches/<YYYY-MM>-plan/REVIEW.md, under "## 2. Codex audit" only: set the Source line
   to "Source: Codex scheduled task, <today YYYY-MM-DD>" and write one row:
   | `plan` | APPROVE or REVISE or REJECT | reasons (name the rows) | evidence |
   Change nothing else in the repository.
5. Commit only that file with the trailer line "Audit-By: Codex" and push to the pull request's
   head branch. If you cannot push, post the section as one pull request comment starting
   "Codex audit for <YYYY-MM>-plan", with the table and its header row.
6. Running again: update your row in place. Never merge, approve, or mark the pull request ready.
```

## 5. When something goes wrong

| What                                      | What happens                                                                   | What to do                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A gate fails on a batch PR (CI red)       | The PR cannot be merged once the check is required                             | The revise routine fixes it; or ask Claude in the PR                                                                                                              |
| Codex did not audit by Friday             | The revise routine records it and does not mark the PR ready                   | Run the Codex task by hand, then re-run the revise routine                                                                                                        |
| Karl does not merge by Sunday             | Nothing publishes that week; the posts stay withheld                           | Merge later. The `seo` → `main` merge deploys production, and that build publishes every approved post whose date has passed; the rest go live on their own dates |
| The stamp did not land (approval run red) | The batch is merged but not approved; nothing publishes                        | Fix the push permission (§2.2) and re-run the **Content batch approval** run                                                                                      |
| The publish cron did not deploy           | `content_publish_deploy_failed` in the logs; the cron answers 500              | Check `VERCEL_DEPLOY_HOOK_URL`; redeploy by hand, which publishes everything due                                                                                  |
| A correction after publication            | Edit the post and set `updated`; it needs a new cycle's approval (Doc 10B §10) | Include it in the next batch PR                                                                                                                                   |

## 6. Checking a scheduled post went live

On its publish day after 08:00 Central:

```bash
curl -sI https://lyceon.ai/blog/<slug> | head -1          # 200
curl -s https://lyceon.ai/sitemap.xml | grep -c '/blog/<slug><'   # 1
```

And the day before, the same URL answers 404 and the sitemap has no entry.
