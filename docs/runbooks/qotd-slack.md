# Runbook — Question of the Day to Slack

> @spec [Doc 10A §7, §11; owner brief 2026-10-10 (QOTD social assets to Slack)] |
> @implemented [2026-10-10]

Every morning the **QOTD social assets** workflow (`.github/workflows/qotd-social.yml`, 06:20 UTC)
builds the day's portrait and story images, the caption and the alt text. It uploads them as the
run's download, then posts them to `#social`:

1. both images, with the date and section (`SAT Question of the Day · Friday, October 10, 2026 · Math`);
2. a second message with the caption and the alt text, each in a code block, ready to copy.

It uses a standard Slack app with two scopes. It works on Slack's free plan.

## 1. One-time setup (Karl)

1. **Create the app.** Go to <https://api.slack.com/apps> → **Create New App** → **From
   scratch**. Name it `Lyceon bot` and pick the Lyceon workspace. Then open **OAuth &
   Permissions** → **Scopes** → **Bot Token Scopes** and add exactly these two:
   - `files:write` (upload the images);
   - `chat:write` (post the caption message).
2. **Install it and copy the token.** On the same page, click **Install to Workspace** →
   **Allow**. Copy the **Bot User OAuth Token**, which starts with `xoxb-`. Treat it like a
   password: don't paste it into Slack, email or a document.
3. **Invite the bot to `#social`.** In `#social`, send `/invite @Lyceon bot`. The bot can only
   post in channels it has been invited to.
4. **Add the token and channel to GitHub.** In the repository, go to **Settings** → **Secrets
   and variables** → **Actions**:
   - **Secrets** tab → **New repository secret**: name `SLACK_BOT_TOKEN`, value the `xoxb-` token.
   - **Variables** tab → **New repository variable**: name `QOTD_SLACK_CHANNEL_ID`, value the
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

| Situation                                                                                    | What happens                                                                                                                                                           |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The build fails a check (an answer in the caption or image, wrong reveal wording, bad input) | The build step fails. Nothing is uploaded and nothing is posted. The run page lists the problems.                                                                      |
| An image does not fit                                                                        | The build step fails. No `post.json` is written, so nothing is posted.                                                                                                 |
| At 06:20 UTC the site still serves yesterday's question as today's                           | The build refuses it: that day's answer is already public, so it would have to pass the past-day leak check. Nothing is posted. Rebuild it by hand with that **date**. |
| `SLACK_BOT_TOKEN` is missing or isn't an `xoxb-` token                                       | The download is uploaded first. Then **Post to Slack** fails and names the missing secret. The run is red.                                                             |
| `QOTD_SLACK_CHANNEL_ID` is missing or isn't a channel ID                                     | Same: the download is uploaded and the run is red.                                                                                                                     |
| Slack is down, or returns an error (`not_in_channel`, `invalid_auth`, `missing_scope`…)      | The download is uploaded first. Then the step fails with `NOT POSTED` and Slack's error code. The run is red.                                                          |

A red run e-mails whoever GitHub notifies for failed scheduled workflows. When the post fails,
the download is still on the run page, so the day can be shared by hand.

**Common Slack errors:**

- `not_in_channel`: invite the bot to the channel (step 3).
- `invalid_auth`: the token was revoked or mistyped. Reinstall the app and update the secret.
- `missing_scope`: add the scope, then reinstall the app.

**Re-running a run posts the day again.** Re-run only a run whose **Post to Slack** step
failed. Delete a duplicate post in Slack.

## 4. What is posted, and what never is

- Only today's question and its options, as on the public homepage. Today's source is the public
  pre-submit payload, where the answer and explanation are always null.
- For a past day, the build also checks the images, caption and alt text against that day's
  revealed answer and explanation (`socialAssetLeaks`). A day that fails is never posted.
- No personal data: nothing about any student or account is read or posted.
- The run log shows the date, the section and Slack's status codes. It never shows the token or
  the question text.

## 5. Turning it off

Delete the `SLACK_BOT_TOKEN` secret. The run then turns red every morning, by design. To stop
the post without red runs, disable the workflow instead (**Actions** → **QOTD social assets** →
**…** → **Disable workflow**). That also stops the daily download.
