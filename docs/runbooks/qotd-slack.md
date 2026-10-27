# Runbook — Question of the Day to Slack

> @spec [Doc 10A §7, §11, Doc 10B (Reddit posting stays manual); owner briefs 2026-10-10 (QOTD
>
> > social assets to Slack) and 2026-10-15 (add yesterday's reveal, for r/satquestions)] |
> > @implemented [2026-10-10; reveal 2026-10-15; TikTok carousel and canonical choice order,
> >
> > > > Karl's brief 2026-10-23]

Every night the **QOTD social assets** workflow (`.github/workflows/qotd-social.yml`, 04:05 UTC,
five minutes after the QOTD day turns over at 04:00 UTC: Karl, 2026-10-27) builds the new day's portrait and story images, the caption and the alt text. It uploads them as the
run's download, then posts them to `#social` as **five numbered items, always in this order**
(Karl, 2026-10-26). Each item opens with its label, and each finishes (a file upload only once
Slack confirms the files are shared in the channel) before the next starts:

1. **1/5 · Reddit: comment on yesterday's post**: yesterday's reveal (date, section and domain,
   the correct answer, the worked explanation as plain text, and the archive link). A withheld
   yesterday says so instead.
2. **2/5 · TikTok: title and caption**: the title (`SAT Question of the Day · Oct 22 · Math`, at
   most 90 characters) and the caption (follow line first), each in a code block.
3. **3/5 · TikTok: carousel**: **yesterday's** question as three 1080x1920 slides, in slide
   order (the question; "Lock in your answer"; the answer with a short "Why" and the link to
   today's question). Post them in order as a TikTok photo post. A long first sentence in the
   explanation is cut and ends "… Full explanation on lyceon.ai" (Karl, 2026-10-26).
4. **4/5 · Reddit: today's post**: a suggested title and today's question as plain text, each in
   a code block.
5. **5/5 · Today's question images**: both images (story and feed), then the caption and alt
   text, each in a code block.

When there is no carousel (yesterday withheld or missing on the archive, or its slides cannot
fit), items 2 and 3 still post, as "2/5 · TikTok: no title or caption today (reason)" and
"3/5 · TikTok: no carousel today (reason)", so the numbering never shifts.

Reddit posting stays manual (Doc 10B): Karl copies the title and body into a new post, and the
reveal into a comment on yesterday's post.

Choices are in the same canonical order everywhere (Karl, 2026-10-23): the site, the images,
the Reddit post, the archive and the reveal, so the reveal's letter is the letter the question
showed.

**The switch to the 04:00 UTC day (one time, SCL-248).** The code ships first, then the
migration, and the database switches at the Chicago midnight after the migration is applied.
Until then every 04:05 UTC run is refused and red (the site still serves the Chicago day; see the
table in section 3), and nothing is posted twice. The first new day starts at that Chicago
midnight, after that night's 04:05 run, so no scheduled run posts it. Once it has started (any
time that day), run the workflow by hand with no date: it posts the first new day, with the
reveal of the day before. From the next night the 04:05 run posts as normal.

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
| Yesterday was **withheld** (a repaired question; its archive page is not published)                                                              | The reveal message says so and carries nothing else. Today's post goes out as normal.                                                                                                                |
| Yesterday is withheld or missing, or its TikTok slides cannot fit                                                                                | No carousel. A one-line note in `#social` says why. Everything else is posted as normal.                                                                                                             |
| Yesterday's archive data cannot be read (anything but a 404)                                                                                     | The build step fails loudly, as for any other read. Nothing is posted.                                                                                                                               |
| `SLACK_BOT_TOKEN` is missing or isn't an `xoxb-` token                                                                                           | The download is uploaded first. Then **Post to Slack** fails and names the missing secret. The run is red.                                                                                           |
| `SOCIAL_SLACK_CHANNEL_ID` is missing or isn't a channel ID                                                                                       | Same: the download is uploaded and the run is red.                                                                                                                                                   |
| Slack is down, or returns an error (`not_in_channel`, `invalid_auth`, `missing_scope`…)                                                          | The download is uploaded first. Then the step fails with `NOT POSTED` and Slack's error code. The run is red.                                                                                        |

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
- For a past day, the build also checks the images, caption, alt text and Reddit title and body
  against that day's revealed answer and explanation (`socialAssetLeaks`). A day that fails is
  never posted.
- Yesterday's reveal is built **only** from yesterday's public archive data
  (`GET /api/public/qotd/<yesterday>`, the same data as its archive page). The server refuses
  today and later days there, and the build refuses any reveal that is not the day before the
  posted day, so today's answer can never be in it.
- The TikTok carousel is built from that same yesterday payload only. The build also checks its
  three slides, caption and title against today (`tiktokCarouselLeaks`): today's question text
  never appears, and for a past day rebuilt by hand, today's answer and explanation never appear
  either. A carousel that fails stops the whole post.
- No personal data: nothing about any student or account is read or posted.
- The run log shows the date, the section and Slack's status codes. It never shows the token or
  the question text.

## 5. Turning it off

Delete the `SLACK_BOT_TOKEN` secret. The run then turns red every morning, by design. To stop
the post without red runs, disable the workflow instead (**Actions** → **QOTD social assets** →
**…** → **Disable workflow**). That also stops the daily download.
