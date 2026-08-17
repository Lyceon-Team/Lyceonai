# Notes — GitHub tooling from an agent session

Short, factual notes about how the GitHub MCP tooling behaves against this repo, so
the same things are not re-diagnosed from scratch each session.

## `get_reviews` and `get_comments` return 404 — this is a token scope gap, NOT a PR state signal

**Observed:** 2026-08-17, repeatedly, on PRs #598 and #603.

```
mcp__github__pull_request_read  method: "get_reviews"
  -> failed to get pull request reviews: GET .../pulls/603/reviews?page=1&per_page=30: 404 Not Found []

mcp__github__pull_request_read  method: "get_comments"
  -> failed to get issue comments: GET .../issues/603/comments?page=1&per_page=30: 404 Not Found []
```

Both fail for every PR, including PRs that are open, accessible, and actively being
worked on. The cause is the session token's scope on the reviews and issue-comments
endpoints — GitHub answers 404 rather than 403 for an endpoint the token cannot
see, which is what makes this look like a deleted PR.

**Do not read a 404 from these two methods as "the PR is gone."** It was first
diagnosed as a transient blip after an MCP reconnect; it is not transient, and it
is not PR-specific.

### What works instead

| Need | Use |
|---|---|
| PR state, draft/merged, mergeability, comment COUNT, `updated_at` | `pull_request_read` `method: "get"` |
| CI results per check | `pull_request_read` `method: "get_check_runs"` |
| Commit statuses (Vercel etc.) | `pull_request_read` `method: "get_status"` |
| Branch movement | `git ls-remote origin <ref>` — no token scope involved |

`get` returns `comments` and `updated_at`, so a **new comment is still detectable**
(the count or the timestamp moves) even though its text cannot be read through
these tools. Read the text on the web UI, or ask.

### Practical shape of a PR check-in

1. `git fetch` + `git ls-remote` for the base and the branch heads — cheap, and it
   answers "did anything get pushed" without touching the API at all.
2. `pull_request_read` `get` on each PR, comparing `state`, `draft`, `merged`,
   `mergeable_state`, `comments`, `updated_at` against the previous reading. A
   reviewer comment moves `comments`/`updated_at` **without** moving the head, so
   the git probe alone is not sufficient.
3. `get_check_runs` only when the head SHA has changed, or when something else
   suggests CI is worth re-reading.

## Vercel cron limits bite at deploy time, not at review time

**Observed:** 2026-08-17, PR #603.

Adding a cron entry to `vercel.json` with an hourly expression failed the whole
deployment:

```
Hobby accounts are limited to daily cron jobs. This cron expression (0 * * * *)
would run more than once per day.
```

It is a hard deploy failure, not a downgrade — the preview never builds. Any cron
added to `vercel.json` on the current plan must run **at most once per day**.

Adding a third and fourth entry was accepted, so on this plan the constraint that
bit was frequency and not the number of jobs.
