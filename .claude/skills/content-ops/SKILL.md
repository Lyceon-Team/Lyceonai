---
name: content-ops
description: Lyceon's blog pipeline (Doc 10B). Use when a standing trigger or Karl asks to produce a weekly blog batch, produce a monthly content plan, or revise a batch or plan after Codex's audit. Drafts, self-audits and opens pull requests into social; never merges, never publishes.
---

# Content operations (Doc 10B pipeline)

You run one stage of the blog pipeline per invocation: **produce weekly**, **produce monthly**, **revise weekly** or **revise monthly**. The standing trigger prompt names which one. Karl's merge of a pull request is the only approval; nothing you do publishes anything.

## Read first, every time

1. `docs/Spec/Lyceon_Doc_10B.md` (the pipeline, gates §5, schedule §8) and `docs/Spec/Lyceon_Doc_10A.md`. Read-only.
2. `CLAUDE.md`, especially the **Public Disclosure Doctrine**.
3. `content/batches/README.md`, `content/batches/RUBRIC.md` (what Codex will audit against) and `content/batches/REVIEW.template.md`.
4. `docs/compliance/claim-inventory.md` (approved claims and the Sources tables).
5. `.claude/skills/ai-cmo/SKILL.md` (voice and guardrails) and the marketing plugin's skills when the session has them.

## Rules that never bend

- **Branches.** Content lives on `social` (Karl, 2026-10-11; `seo` is for build work). Work on `claude/content-<cycle>` (e.g. `claude/content-2026-W45`, `claude/content-2026-11-plan`), cut from `origin/social`. Pull requests are **drafts into `social`**. Never push to `social` or `main`, never merge a pull request, never force-push. A batch or plan pull request into any other base fails CI.
- **Keep `social` current.** Right after cutting the branch, merge `origin/main` into it (`git merge --no-edit origin/main`, a normal merge commit, never a rebase or force-push), so the batch carries the latest site and pipeline code when Karl merges it into `social`. A conflict you cannot resolve without changing someone else's work: record it and stop.
- **Safe to re-run.** First look for the cycle's branch, open pull request and `content/batches/<cycle>/REVIEW.md`. If they exist, update them; never open a second pull request for a cycle.
- **Missing input: record and stop.** If something the stage needs is missing (no approved plan for the week, no batch pull request, no Codex audit), write one dated line saying so in the review record (section 1 for produce, section 3 for revise), push it, and stop.
- **Never write** `content/batches/approvals.json` (only the merge workflow does), Codex's section of a review record (except the verbatim copy below), anything under `docs/Spec/`, or `approved:` on a page.
- **Content never mentions AI, models, automation, or how it was made.** The one exception is LISA named as a product feature ("LISA, your AI tutor"). Nothing proprietary (Doctrine rule 2). No invented statistics, people, quotes or testimonials.
- **Every fact about the SAT, scores, tutoring or studying cites a source**, College Board first. SAT dates come only from `shared/sat-test-dates.ts`. A source you add goes in `shared/seo/sources.ts` and in a Sources table in `docs/compliance/claim-inventory.md` with the quoted text and the date you read it.
- **Lyceon-specific claims** (what the product does, outcomes, comparisons, our own numbers) use only approved claim-inventory rows. Never add a Lyceon-specific row; flag the need for Karl in the self-audit instead.
- **Under-13s** are never the audience.

## The gates (run before every push)

```bash
pnpm -s run build && pnpm -s run gate:seo-output
pnpm exec vitest run tests/ci/content-drafts-gate.test.ts tests/ci/content-quality-gates.test.ts \
  tests/ci/content-publish-gate.test.ts tests/ci/content-schedule.test.ts
scripts/content/lint-prose.sh          # Vale (Microsoft + ai-tells) and lychee
```

`tests/ci/content-drafts-gate.test.ts` is the publish gate run on your unapproved posts as they will be on their publish day: sources, claims, banned phrases, gate 11 against every live page, links, headings, no AI or process. `lint-prose.sh` needs `vale` and `lychee`. If they are not on PATH, install the pinned builds exactly as `.github/actions/content-tools/action.yml` does (same URLs, same sha256) into a scratch directory. If the network refuses, say so in the self-audit and rely on the pull request's CI run; never report a gate as passed that you did not run.

## Produce: weekly batch (Wednesday)

1. **The cycle.** The batch is next week's: `pnpm exec tsx -e 'import("./shared/content/schedule.ts").then(m=>console.log(m.isoWeekCycle(process.argv[1])))' <next Monday YYYY-MM-DD>`. Its three slots are that week's Monday, Wednesday and Friday at 07:00 (`publishSlots` in the same module).
2. **The topics** come from the approved plan for that month, `content/batches/<YYYY-MM>-plan/PLAN.md` on `origin/social`. No merged plan covers the week: record it and stop.
3. **Each post** is one module, `shared/content/posts/<slug>.ts`, default-exporting a `ScheduledPostSpec` (`shared/content/posts/types.ts`):
   - `batch: "<cycle>"`, `publishAt: "YYYY-MM-DDT07:00"` (its slot), `targetKeyword` (the plan's);
   - `page`: `title` ≤ 60 characters, `description` 120–160, one `h1`, `intro`, `sections`, `faq` if useful, the standard CTA as the existing posts end;
   - every block carries `sources` or `claims`;
   - at least one link to `/sat-practice-questions`, `/free-sat-practice-test` or `/what-is-a-good-sat-score`, where it helps the reader.
     Add one import per post to `shared/content/posts/index.ts`. Copy the shape of an existing post in `shared/content/blog.ts`; do not invent fields.
4. **Write like a person** for a student or parent: specific, plain, short sentences, straight to the point. Helpful beyond any existing Lyceon page (RUBRIC R7). No filler, no "in today's…", no rule-of-three lists for their own sake.
5. **Run the gates.** Fix until green.
6. **The review record.** Copy the template to `content/batches/<cycle>/REVIEW.md`, fill `Cycle` and `Batch PR`, and write section 1: one row per post, the gates you ran, and anything Karl should know (a source you added, a claim that needs him). Leave sections 2–4 as the template has them.
7. **Commit, push, open the draft pull request** into `social`, titled `content: <cycle> batch`, body listing each post (slug, publish date, title, target keyword). Do not mark it ready.

## Produce: monthly plan (20th)

1. **The cycle** is next month: `<YYYY-MM>-plan`.
2. **The skeleton:** `pnpm exec tsx scripts/content/plan-skeleton.ts <YYYY-MM> > content/batches/<YYYY-MM>-plan/PLAN.md`. It lists the month's College Board dates (cited) and every Mon/Wed/Fri slot with the days to the next test. Do not retype or edit the dates.
3. **Fill one row per slot:** slug, target keyword, audience (students, parents, both), search intent, and why now (tie it to the SAT calendar: final-weeks review before a test, test-day preparation, what scores mean after release, registration reminders before a deadline; Doc 10B §3A). Sources: `docs/marketing/keyword-map/`, the backlog, last month's performance where available.
4. **No duplicate targeting.** Every target keyword must be new: compare against every `targetKeyword` in `shared/content/` (the gate normalises case and plurals; `normalizedKeyword` in `shared/seo/content-gate.ts`). A covered topic is an update to the existing page, listed as such.
5. **Review record** with one item, `plan`; self-audit row in section 1.
6. **Draft pull request** into `social`, titled `content: <YYYY-MM> plan`.

## Revise (Friday for a batch; 23rd for a plan)

1. Find the cycle's draft pull request and its `REVIEW.md`. None: record and stop.
2. **Codex's audit.** Section 2 is written by Codex (commit trailer `Audit-By: Codex`). If Codex instead posted its audit as a pull request comment, copy its table into section 2 **verbatim**, set the `Source:` line to the comment's URL, and change nothing else in that section (CI compares the copy with the comment). No audit at all: record it in section 3 and stop; do not mark the pull request ready.
3. **For each verdict:**
   - **APPROVE:** nothing.
   - **REVISE:** fix exactly the finding, re-run the gates, and add a section 3 row: the finding, what changed, the commit. If you disagree, say why with evidence instead. One revision round only.
   - **REJECT:** remove the post's module and its import, and add a row: `Dropped.`
   - An item you cannot fix this round: remove it from the batch and add a row `Carried to <next cycle>.`
4. Re-run every gate. Fix until green.
5. **Mark the pull request ready for review.** CI then requires Codex's verdict on every remaining item and your response to every REVISE (`Content batch checks`), and posts the summary to `#social`.

## When done

Reply in the trigger session with: the cycle, the pull request link, each item and its state, every gate's result, and anything waiting on Karl.
