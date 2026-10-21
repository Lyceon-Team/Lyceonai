# Runbook — posting to Slack from repo jobs

> @spec [owner brief 2026-10-10 (QOTD social assets to Slack: bot token as a GitHub secret,
>
> > channel ID as a variable, fail loudly); owner brief "Doc 10B Phase 1" (Karl, 2026-10-11) scope 4
> > and answers 11 and 12] | @implemented [2026-10-11]

Every repo job that posts to Slack uses one app, one token, one channel variable and one client.
Don't add a second.

| Piece   | What                                                    | Where                                     |
| ------- | ------------------------------------------------------- | ----------------------------------------- |
| App     | `Lyceon bot`, bot scopes `chat:write` and `files:write` | api.slack.com/apps                        |
| Token   | the `xoxb-` Bot User OAuth Token                        | GitHub secret `SLACK_BOT_TOKEN`           |
| Channel | the ID of `#social` (e.g. `C0123456789`)                | GitHub variable `SOCIAL_SLACK_CHANNEL_ID` |
| Client  | reads both, calls Slack, parses every reply             | `shared/slack/client.ts` (re-exported by `scripts/slack/client.ts`) |

The credential lives where the job runs: GitHub Actions secrets, read only in the one step that
posts. It is never logged and never in the repository.

**Since 2026-10-20 the server also posts** (final brief "Trustpilot card + Feedback", Karl, §5):
each new piece of private feedback goes to `#social` as one line (`server/lib/feedback-slack.ts`).
So the same two values are also needed in **Vercel** (Production), under the same names:
`SLACK_BOT_TOKEN` (Sensitive) and `SOCIAL_SLACK_CHANNEL_ID`. They are read through the env schema
(`packages/shared/src/env.ts`). Unset means feedback is still stored and no line is posted (a WARN
per submission). Moving the line to a dedicated `#feedback` channel later is a change of
`SOCIAL_SLACK_CHANNEL_ID` in Vercel only (invite the bot to that channel first).

## Jobs that post

| Job                  | Workflow                   | When                                                       | What it posts                                                | Runbook                        |
| -------------------- | -------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------ |
| QOTD social assets   | `qotd-social.yml`          | daily, 06:20 UTC                                           | the day's two images, then the caption and alt text          | `docs/runbooks/qotd-slack.md`  |
| Content batch notify | `content-batch-notify.yml` | a batch or plan pull request into `social` is marked ready | titles, publish dates, Codex verdicts, the pull request link | `docs/runbooks/content-ops.md` |
| Oct scores TikTok    | `oct-scores-tiktok.yml`    | manual run, or the `post-to-social` label on its PR        | the MP4 for review, then its caption                         | `brag-output-2026-10-16-oct-scores/brag-plan.md` |
| New feedback (server) | the API, `POST /api/feedback/feedback` | each new piece of private feedback | type, page (route pattern), role, age band, reply OK; the text only for 18+, at most 300 characters; never a name, email or id (SCL-237) | this file |

## One-time setup (Karl)

Steps 1–3 of `docs/runbooks/qotd-slack.md` §1 create the app, install it and invite it to
`#social`. Then, in the repository, **Settings** → **Secrets and variables** → **Actions**:

- **Secrets**: `SLACK_BOT_TOKEN` = the `xoxb-` token.
- **Variables**: `SOCIAL_SLACK_CHANNEL_ID` = the channel ID of `#social`.

**Renamed 2026-10-11.** The channel variable was `QOTD_SLACK_CHANNEL_ID` (#1186). Both jobs now
read `SOCIAL_SLACK_CHANNEL_ID` (owner answer 11). If the old variable was already created, create
the new one with the same value, then delete the old one. Until the new one exists, both jobs fail
with "SLACK_CHANNEL_ID is not set … (GitHub variable SOCIAL_SLACK_CHANNEL_ID …)".

## When a post fails

The job's run turns red and names the reason; nothing fails quietly. Slack's common errors:

- `not_in_channel`: `/invite @Lyceon bot` in the channel.
- `invalid_auth`: the token was revoked or mistyped. Reinstall the app and update the secret.
- `missing_scope`: add the scope, then reinstall the app.

Neither job records what it posted, so a re-run posts again (accepted: QOTD by Karl 2026-10-10,
batch notifications by owner answer 12, 2026-10-11).

## Adding a job that posts

Import `slackConfig`, `postMessage` (or `slackCall` for other methods) and `escapeMrkdwn` from
`scripts/slack/client.ts` (a job) or `shared/slack/client.ts` (the server). Put `SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}` and
`SLACK_CHANNEL_ID: ${{ vars.SOCIAL_SLACK_CHANNEL_ID }}` in the env of the posting step only, add the
job to the table above, and test it against a fake Slack (`tests/ci/content-batch-notify.test.ts`
is the pattern). If it needs a scope beyond the two above, that is Karl's call first.
