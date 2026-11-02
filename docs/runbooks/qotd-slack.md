# Runbook — Question of the Day to Slack

> @spec [Doc 10A §7, §11; owner briefs 2026-10-10 (QOTD social assets to Slack) and 2026-10-15 (add yesterday's reveal, for Reddit); Karl's ruling 2026-10-30 (Reddit QOTD discontinued)] | @implemented [2026-10-10; reveal 2026-10-15; TikTok carousel and canonical choice order, Karl's brief 2026-10-23; Reddit items removed 2026-10-30]

**Reddit QOTD is discontinued** (r/SatQuestion was banned by Reddit sitewide; Karl, 2026-10-30).
The QOTD goes to **TikTok, Instagram and Facebook only**. Nothing Reddit-related is built or
posted: the run no longer makes a suggested Reddit post or yesterday's reveal (the answer for the
comment on yesterday's Reddit post), the build's `post.json` carries neither (and is refused if it
does), and `#social` has no Reddit item.

Every night the **QOTD social assets** workflow (`.github/workflows/qotd-social.yml`, 04:05 UTC,
five minutes after the QOTD day turns over at 04:00 UTC: Karl, 2026-10-27) builds the new day's
portrait and story images and the captions. It uploads them as the run's download, then posts
them to `#social` as **one post per platform, always in this order** (Karl's rulings on the daily
#social messages, 2026-11-02). Each step finishes (a file upload only once Slack confirms the
files are shared in the channel) before the next starts. Each post is its one-word platform line,
its media, **one** caption block ready to paste (title, body and hashtags in posting order) and,
on TikTok only, a keywords block. Nothing else: no labels, metadata, alt text or links.

0. **Warnings** (only when there is one), outside any copy block, e.g. ":warning: SAT date list
   needs updating" (see below).
1. **TikTok**: **yesterday's** question as three 1080x1920 slides, in slide order (the
   question; "Lock in your answer"; the answer with a short "Why" and the link to today's
   question). Post them in order as a TikTok photo post. A long first sentence in the
   explanation is cut and ends "… Full explanation on lyceon.ai" (Karl, 2026-10-26). Then one
   message: the caption block and the keywords block (one keyword per line, for TikTok's
   keyword field).
2. **Instagram**: both images (story and feed), then the Instagram caption block.
3. **Facebook**: the Facebook caption block, for the same images as Instagram (they are not
   uploaded twice).

When there is no carousel (yesterday withheld or missing on the archive, or its slides cannot
fit), TikTok's place holds one QA line instead ("_TikTok_: no post today (reason)").

**The captions** (wording in `shared/social/posts.ts`). The test month is the month of the next
confirmed SAT on or after the post date, from `shared/sat-test-dates.ts`: "November" through
Nov 7, "December" from Nov 8.

| Post      | Caption                                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| TikTok    | `November SAT question of the day · Math` / `Follow for daily SAT questions 👆 Comment your answer 👇` / hashtags |
| Instagram | headline / `Comment your answer 👇` / `Taking the SAT Nov 7? Comment SAT and I'll send you the link` / hashtags   |
| Facebook  | headline / `How would you solve it? Share your approach below 👇` / hashtags (no link, no "comment a word" ask)   |

Hashtags, at most five: `#SAT #SATprep #digitalSAT #NovemberSAT` and `#SATMath` or `#SATEnglish`.

**TikTok keywords**, in this order without duplicates: `November SAT questions`; `SAT`,
`SAT prep`, `Digital SAT`, `College admissions`; the section's (`SAT math`, or `SAT english` and
`SAT reading`); then the domain's (e.g. Advanced Math → `Advanced math`, `Algebra 2`). A domain
that is not one of its section's canonical domains (`shared/canonical-domains.ts`) refuses the
post and the failure notice names it.

**When the SAT date list runs out.** With no confirmed SAT on or after the post date, the month is
left out of the headline, keywords and hashtags (never guessed), and the post opens with the
warning "SAT date list needs updating". Add the next College Board dates to
`shared/sat-test-dates.ts` as `confirmed`.

**Set once, not in the daily message:**

- The TikTok **bio link**: `lyceon.ai/start?utm_source=tiktok&utm_campaign=qotd`.
- The **link to send to people who comment SAT** on Instagram:
  `lyceon.ai/start?utm_source=instagram&utm_campaign=qotd`.
- The **alt text** goes with the image upload in Slack, not in the message.

Every link points at `lyceon.ai/start` and is tagged with its channel and campaign, so each sign-up
records where it came from (`signup_channel`, `signup_campaign`) and the Monday growth report can
count sign-ups by channel.

Choices are in the day's one served order everywhere (Karl, 2026-10-23; SCL-258, 2026-10-28):
the site, the images, the archive and the TikTok carousel, so the carousel's answer letter is the
letter the question showed.

**The switch to the 04:00 UTC day (one time, SCL-250).** The code ships first, then the
migration, and the database switches at the Chicago midnight after the migration is applied.
Until then every 04:05 UTC run is refused and red (the site still serves the Chicago day; see the
table in section 3), and nothing is posted twice. The first new day starts at that Chicago
midnight, after that night's 04:05 run, so no scheduled run posts it. Once it has started (any
time that day), run the workflow by hand with no date: it posts the first new day, with the
TikTok carousel of the day before. From the next night the 04:05 run posts as normal.

It uses a standard Slack app with three scopes. It works on Slack's free plan.

The app, token, channel variable and client are shared with every repo job that posts to Slack:
see `docs/runbooks/slack.md`.

## 1. One-time setup (Karl)

1. **Create the app.** Go to <https://api.slack.com/apps> → **Create New App** → **From
   scratch**. Name it `Lyceon bot` and pick the Lyceon workspace. Then open **OAuth &
   Permissions** → **Scopes** → **Bot Token Scopes** and add exactly these three:
   - `files:write` (upload the images);
   - `chat:write` (post the caption message);
   - `files:read` (confirm each upload is shared in the channel before the next item posts;
     Karl, 2026-10-26). **Already set up?** Add `files:read`, then **Reinstall to Workspace**.
     Without it, the post stops at the first upload with `missing_scope`.
2. **Install it and copy the token.** On the same page, click **Install to Workspace** →
   **Allow**. Copy the **Bot User OAuth Token**, which starts with `xoxb-`. Treat it like a
   password: don't paste it into Slack, email or a document.
3. **Invite the bot to `#social`.** In `#social`, send `/invite @Lyceon bot`. The bot can only
   post in channels it has been invited to.
4. **Add the token and channel to GitHub.** In the repository, go to **Settings** → **Secrets
   and variables** → **Actions**:
   - **Secrets** tab → **New repository secret**: name `SLACK_BOT_TOKEN`, value the `xoxb-` token.
   - **Variables** tab → **New repository variable**: name `SOCIAL_SLACK_CHANNEL_ID`, value the
     channel ID of `#social` (below).

**Finding a channel ID:** in Slack, open the channel, click its name at the top, and scroll
to the bottom of the **About** tab. The ID looks like `C0123456789`. It is an ID, not a
secret.

## 2. A test post

Do this before the first scheduled run:

1. Create a private test channel, for example `#qotd-test`, and `/invite @Lyceon bot` to it.
2. Copy that channel's ID.
3. Go to **Actions** → **QOTD social assets** → **Run workflow**. Leave **date** empty to post
   today's question, or enter a past day. Put the test channel's ID in **slack_channel**.
4. The run posts to the test channel only. `slack_channel` overrides the variable for that
   one run.

## 3. What the run does when something is wrong

The rule is that it never posts a day that failed a check, and it never fails quietly.

| Situation                                                                                                                                        | What happens                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The build fails a check (an answer in the caption or image, wrong reveal wording, bad input)                                                     | The build step fails. Nothing is uploaded and nothing is posted. The run page lists the problems.                                                                                                    |
| An image does not fit                                                                                                                            | The build step fails. No `post.json` is written, so nothing is posted.                                                                                                                               |
| At 04:05 UTC the site still serves the day that just ended as today's (the database has not switched to the 04:00 UTC day yet, or a stale cache) | The build refuses it: it is not today under the 04:00 UTC day, and that day was posted the night before. Nothing is posted. Once the site serves the new day, run the workflow by hand with no date. |
| Yesterday is withheld or missing, or its TikTok slides cannot fit                                                                                | No carousel. A TikTok QA line in `#social` says why. Everything else is posted as normal.                                                                                                            |
| Yesterday's domain has no TikTok keywords (not a canonical domain of its section)                                                                | The build refuses the post and the failure notice names the domain. Fix the question's domain or the map in `shared/social/posts.ts`.                                                                |
| `shared/sat-test-dates.ts` has no confirmed SAT left                                                                                             | Posted without a month, under the warning "SAT date list needs updating".                                                                                                                            |
| Yesterday's archive data cannot be read (anything but a 404)                                                                                     | The build step fails loudly, as for any other read. Nothing is posted.                                                                                                                               |
| `SLACK_BOT_TOKEN` is missing or isn't an `xoxb-` token                                                                                           | The download is uploaded first. Then **Post to Slack** fails and names the missing secret. The run is red.                                                                                           |
| `SOCIAL_SLACK_CHANNEL_ID` is missing or isn't a channel ID                                                                                       | Same: the download is uploaded and the run is red.                                                                                                                                                   |
| Slack is down, or returns an error (`not_in_channel`, `invalid_auth`, `missing_scope`…)                                                          | The download is uploaded first. Then the step fails with `NOT POSTED` and Slack's error code. The run is red.                                                                                        |

| The site refuses the day's stored answer order (`503 qotd_order_invalid`, SCL-258) | The build step fails, naming the code. Nothing is posted except the failure notice below. The day needs its schedule row checked, not a re-run. |

**Failure notice (SCL-258, Karl 2026-10-28).** Whenever a scheduled or hand-started run fails, a
last step (**Post the failure to Slack**) posts one message to the same channel: "QOTD social run
FAILED", the generator's refusal lines (from `failure.txt`, e.g.
`GET /api/public/qotd/today -> 503 (qotd_order_invalid)`) and the run link. It needs the same
token and channel as the post; if they are missing, that step fails too and the run stays red.

A red run e-mails whoever GitHub notifies for failed scheduled workflows. When the post fails,
the download is still on the run page, so the day can be shared by hand.

**Common Slack errors:**

- `not_in_channel`: invite the bot to the channel (step 3).
- `invalid_auth`: the token was revoked or mistyped. Reinstall the app and update the secret.
- `missing_scope`: add the scope, then reinstall the app.

**Re-running a run posts the day again.** Nothing records that a day was already posted. Re-run
only a run whose **Post to Slack** step failed, and delete any duplicate post in Slack. (Accepted
by Karl, 2026-10-10: re-runs are only for failed posts.)

## 4. What is posted, and what never is

- Only today's question and its options, as on the public homepage. Today's source is the public
  pre-submit payload, where the answer and explanation are always null.
- For a past day, the build also checks the images, caption, alt text and Instagram caption
  against that day's revealed answer and explanation (`socialAssetLeaks`). A day that fails is
  never posted.
- Yesterday is read **only** from yesterday's public archive data
  (`GET /api/public/qotd/<yesterday>`, the same data as its archive page). The server refuses
  today and later days there, and the build refuses a day that is not the one before the posted
  day, so today's answer can never be in it.
- Nothing Reddit-related: no Reddit post, no reveal for a Reddit comment, no Reddit link (the
  Reddit QOTD is discontinued, Karl 2026-10-30).
- The TikTok carousel is built from that yesterday payload only. The build also checks its
  three slides and caption against today (`tiktokCarouselLeaks`): today's question text
  never appears, and for a past day rebuilt by hand, today's answer and explanation never appear
  either. A carousel that fails stops the whole post.
- No personal data: nothing about any student or account is read or posted.
- The run log shows the date, the section and Slack's status codes. It never shows the token or
  the question text.

## 5. Turning it off

Delete the `SLACK_BOT_TOKEN` secret. The run then turns red every morning, by design. To stop
the post without red runs, disable the workflow instead (**Actions** → **QOTD social assets** →
**…** → **Disable workflow**). That also stops the daily download.

## 6. Breakdown pilot (2 weeks)

Karl's brief of 2026-11-02, Part C; SCL-266, as ruled by Karl on #1398 the same day (authored
scripts, his merge the approval, am_michael, the dates below). A second job in the same workflow,
`breakdown`, runs **after** the QOTD job, whatever that job's result, so the normal QOTD post always
goes first and nothing here can block or delay it.

**Re-running posts the breakdown again.** As with the QOTD set (Karl, 2026-10-10), nothing records
that a day's breakdown was already posted: a re-run of the `breakdown` job sends its Slack set a
second time. Re-run it only for a failed post.

**Dates.** `QOTD_BREAKDOWN_PILOT` (`shared/qotd/breakdown.ts`): posting days **2026-11-09 to
2026-11-22**, both inclusive (14 days, the schema's limit). On a posting day the run breaks down the
QOTD of the day before, so the QOTD dates covered are **2026-11-08 to 2026-11-21**.

**What posts.** Inside the window, yesterday's QOTD as a 30-60 s video, built with the
worked-example pipeline from the **authored script Karl merged for that date**
(`scripts/qotd-social/breakdown.ts`). The script speaks in Karl's order: the hook as a challenge to
the viewer, a one-sentence setup, the key move, the trap ("here's where people slip"), the answer
and a quick check, then the kit's call to action. The voice talks about the screen and never reads
it (S1, S2). The choices are shown in the day's stored order (`qotd_schedule.option_order`) and the
answer is named by the stored `correct_display_letter`, never the question's original order or
letter. The voice is Kokoro `am_michael`, committed with the script; nothing is voiced at render
time and the job sets up no Python. It goes to the same channel (`SOCIAL_SLACK_CHANNEL_ID`) as the
TikTok, Instagram and Facebook set: the video with its label and review line, the TikTok caption and
keywords, then the Instagram and Facebook captions (SCL-262 format, music credit last). **Karl
posts by hand.** Nothing is published automatically, and nothing posts anywhere but #social.

### 6.1 The weekly authoring flow

1. **Karl exports the schedule (owner-run, read-only).** Run
   `scripts/qotd-social/breakdown-schedule.sql` against production (the Supabase SQL editor, or
   `PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" -At -f
   scripts/qotd-social/breakdown-schedule.sql > ~/qotd-breakdown-schedule.json`). It returns one
   JSON array: for each scheduled day after today, up to today + 7, `qotd_date`, `question_id`,
   `option_order`, `correct_display_letter`, `section`. Give the file to the authoring session
   (attach or paste it in the session). **It holds the answers of QOTDs not yet published: never
   commit it, post it to Slack, paste it into a PR or issue, or keep it inside a repository
   checkout.**
2. **The authoring session (Claude Code) writes the scripts**, one per date, at
   `content/qotd-breakdowns/<YYYY-Www>/<qotd_date>/script.json` on a branch of `social` (the ISO
   week of the QOTD date). Each names the date, the question id, and the export's `option_order`
   and `correct_display_letter`, and carries the spoken script in the worked examples' fields
   (`hook.line`/`hook.voice`, `question_voice` as the one-sentence setup, 3-6 `steps` with notepad
   and voice, `trap.notepad`/`trap.voice`, `answer.notepad`/`answer.voice`). The question text
   comes from the seed SQL, never copied. A day that cannot have a breakdown (a grid-in, a paired
   or long passage) gets no script.
3. **It voices each script** on its machine:
   `pnpm exec tsx scripts/qotd-social/voice-breakdown.ts <social checkout>/content/qotd-breakdowns/<week>/<date>`
   (am_michael; writes `voice/*.wav` and `voice/manifest.json`; needs `HYPERFRAMES_PYTHON`).
4. **It checks them against the export:**
   `pnpm exec tsx scripts/qotd-social/check-breakdown-scripts.ts --content <social checkout> --schedule ~/qotd-breakdown-schedule.json`
   (the export must be outside every checkout; a mismatch names the date and the field, never a
   value). Without `--schedule` the same check runs on every pull request into `social` that
   touches `content/qotd-breakdowns/` (`.github/workflows/qotd-breakdown-checks.yml`): layout,
   schema, the question from the seed SQL, the order and letter fitting that question, H1-H6, S1,
   S2, the trap opener, the voice matching its text and passing the audio checks.
5. **It opens one batch PR into `social`** (draft), on the same review path as the worked
   examples. **Karl's merge is the approval** (read at render time from GitHub's record of the merge,
   `scripts/worked-examples/approval.ts`; the merger must be `CONTENT_APPROVER_LOGIN`). A later
   push to a script's folder that is not Karl's merge un-approves it.
6. **First batch:** the QOTD dates 2026-11-08 to 2026-11-14, merged by 2026-11-08; the second,
   2026-11-15 to 2026-11-21, merged by 2026-11-15. The scheduler fills 7 days ahead, so the export
   taken on the day before the first date covers the week.

**Leak risk, pending Karl's decision.** A merged script names the answer of a QOTD that has not been
published yet (so do the worked examples, which use questions kept out of the QOTD pool). That is
safe only while `social` is not publicly readable. The options for Karl: confirm the repository
stays private (and is never made public with this history), and/or land each script no earlier than
the day before its QOTD date (the run on posting day D reads the script for D-1, so a script merged
on D-1 is in time). Until he rules, the weekly batch lands as written above.

### 6.2 At render time

The job checks out `social` with full history and, for yesterday's QOTD:

1. reads the day from the public archive (`/api/public/qotd/<date>`; today is refused);
2. the QOTD's own suitability rules (grid-in, long or paired passage, stem repeats passage);
3. finds the date's script; none, or not merged by Karl: `no_approved_script`;
4. **the hard rule:** the script's `option_order` and `correct_display_letter` must equal the stored
   row the archive serves, or nothing renders (`order_mismatch`);
5. the script rules again on the question as served, and the captions;
6. the committed voice: am_michael, every line voiced from the text it has now (a script edited
   after voicing is refused), the audio checks;
7. composition, 30-60 s, `hyperframes check`, the layout check, the render, the MP4 check.

**Fallback.** If anything fails, there is no video: the post is yesterday's answer slide (the
carousel's slide 3 from the QOTD run) with `Breakdown skipped: <reason> (<code>)`, or the notice
alone when the QOTD run built no carousel. The run page lists the details.

| code | why |
|---|---|
| `script_too_long` | (a) the voiced script runs over 60 s |
| `script_too_short` | (a) under 30 s, which the MP4 check would refuse |
| `mp4_check_failed` | (a) the MP4 fails the 1080x1920, 30-60 s, audio check |
| `grid_in` | (c) a grid-in |
| `too_long_to_read` | (c) over the QOTD's quick-read length (`shared/qotd/readability.ts`) |
| `paired_passage` | (c) a paired passage |
| `stem_repeats_passage` | (c) the stem repeats the passage |
| `content_rules` | (d) a hook rule (H1-H6), the verbatim rule (S1, S2), the trap opener or a caption rule failed |
| `voice_check_failed` | (d) the committed voice is not am_michael, was voiced from other text, or fails the audio check |
| `hyperframes_check_failed` | (d) `hyperframes check` failed |
| `layout_check_failed` | (d) the safe-area or blank-paper check failed |
| `render_failed` | (d) the render failed |
| `withheld` | yesterday is withheld or missing on the archive |
| `no_approved_script` | no script for the date on `social`, or its folder was not last changed by Karl's merge |
| `order_mismatch` | the script's order or letter differs from the stored row (or the stored row is inconsistent): nothing is rendered |
| `build_failed` | the build did not finish (posted from the post step) |

The templated script's codes (`letter_named`, `no_explanation`, `too_many_steps`) are gone with it
(2026-11-02).

**Turning it off.** At once: set the repository variable `QOTD_BREAKDOWN_PAUSED` to `true`
(**Settings** → **Secrets and variables** → **Actions** → **Variables**); the QOTD post is
untouched. For good: change the dates in a PR (both `null` is off).

**End date.** After 2026-11-22 the job builds nothing, posts nothing and notes **pilot ended** on
the run page. Outside the window it does not install the browser or FFmpeg either.

**Pull requests** run the job as a dry run on the real fixture rows (`tests/fixtures/qotd/rows.json`,
2026-10-02) and the fixture script tree (`tests/fixtures/qotd-breakdowns/social`): the whole path,
the MP4 uploaded as the `qotd-breakdown` artifact, nothing sent.

**A hand-started run** breaks down the day before the run's QOTD day (the `date` input is the
QOTD job's only).
