# Notifications Rebuild — Evidence and Acceptance Record

> Branch `claude/notifications-rebuild-9c3f1a` off `origin/cleanup` @ `2924576`. Draft PR into `cleanup`.
> Nothing here was applied to production. Karl applies every migration by hand.
> Governing contract: `contracts/notifications.contract.md`. Brief: "Notifications: Full Deletion and Pure Rebuild" (2026-09-03).

## 0. Grounding

| Item                      | Value                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Repo root                 | `/home/user/Lyceonai`                                                                                                  |
| Base                      | `cleanup` @ `2924576` (`git status --porcelain` empty at start)                                                        |
| Node / pnpm               | v22.22.2 / 10.33.0                                                                                                     |
| Local Postgres for proofs | PostgreSQL 16.13 + pgvector, throwaway cluster; `scripts/ci/genesis-fresh-apply.sh` PASS on the base before any change |

## 1. Step 0 — read-only confirmation and push-back

### 1.1 Confirmed as specified

- FK cascade is safe for account deletion: the preflight guard in `execute_account_deletion_cascade` (`supabase/migrations/20260626010000_05e_anonymize_disposition.sql:98-151`) is a fixed VALUES list of 36 operator-attribution columns; it does not scan `pg_constraint`, so two new `ON DELETE CASCADE` edges from `profiles(id)` do not trip it. No CI gate asserts an FK-edge count.
- `create_active_guardian_link_audited` in prod is the body in `20260901000000_scl_080_guardian_link_code.sql` (`pg_proc` count 1, read-only). Recreating it whole is safe.
- `gen_random_uuid()`, `sha256()` are core; no extension dependency was added.
- Prod (read-only, 2026-09-03): `notification_outbox` has RLS on and 0 policies; `emit_guardian_linked` absent; `cron.job` empty; `supabase_realtime` publication has 0 tables; `notifications` / `user_notification_preferences` do not exist.

### 1.2 Manifest items reachable from surfaces the brief did not name (all handled in the deletion commit)

| Reference                                                                                | Why it had to go                                                                                                                 |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/routes/calendar.ts:19,481`                                                 | imports/calls `notification-authority`; root `tsconfig.json` includes `apps/**` so `pnpm run check` would break                  |
| `tests/ci/notifications.writer-authority.contract.test.ts`                               | asserts the deleted authority file exists — whole file deleted                                                                   |
| `tests/ci/calendar.csrf.ci.test.ts:88-91`, `tests/ci/auth-signup.contract.test.ts:80-82` | `vi.mock` of the deleted module paths                                                                                            |
| `client/src/pages/UserProfile.tsx` (preferences card, ~350 lines)                        | reads `/api/notifications/preferences`, a deleted route over a table that never existed                                          |
| `client/src/components/layout/app-shell.tsx:20,159`, `navigation.tsx:14,115`             | dropdown hosts                                                                                                                   |
| `server/index.ts:53`, `:403-409`, `:988-992`                                             | import, mount, startup log lines                                                                                                 |
| `tests/ci/guardian-link-code.pg.ci.test.ts:159`                                          | `DELETE FROM notification_outbox` in `beforeEach` throws once Migration B is in the pipeline; repointed to `notification_events` |
| `CLAUDE.md:60`                                                                           | workflow item 7 named the outbox and the deleted contract; repointed                                                             |
| `docs/route-registry.md:23`                                                              | `/reset-password` row; `pnpm run route:validate` fails otherwise                                                                 |
| `supabase/migrations-pending/README.md:32`                                               | row for a migration that had already moved                                                                                       |

Left as-is and reported: `contracts/auth-standard-flow.contract.md:11`, `contracts/auth-login-e2e.contract.md:16`, `docs/SpecAudit/notification-triggers.md` still name the deleted outbox contract (other lanes' documents).

### 1.3 Design conflicts — two of the three event types cannot be emitted under the specified DDL

| Event type                   | Conflict                                                                                                                                                                                                                                                                                | Action taken                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `guardian_consent_requested` | Recipient is `guardian_consent_requests.guardian_email` (`server/routes/profile-routes.ts:290-300`), an address that usually has no `profiles` row (Doc 01 §37.2 step 4 creates the account after the email). `notification_messages.recipient_profile_id` is `NOT NULL FK → profiles`. | In the CHECK as specified; **no emitter**. Needs an owner ruling on an address-recipient shape. |
| `account_deletion_scheduled` | The email's only content of value is the raw recovery token, generated once and never stored raw (`server/routes/account-deletion-routes.ts` keeps the sha256 only). Contract §8 forbids sensitive values in `payload`, which persists 90 days.                                         | In the CHECK as specified; **no emitter**. Needs an owner ruling on a render-time secret path.  |

Consequence: after this PR the deletion-scheduled email and the consent email are not sent by any path. They were not delivered before either — the deleted `server/lib/email.ts` sent from `contact@lyceon.ai`, which the brief states was never a verified Resend domain. The `/account/recover` route is unchanged; its link has no carrier until the ruling.

### 1.4 Other deviations from the brief, with reasons

- **`execute_account_deletion_cascade` comment correction** requires `CREATE OR REPLACE` of the whole 414-line function (the comment is inside the plpgsql body). Migration B does that with a verbatim copy; the regenerated snapshot diff shows exactly one changed line in that function: `-  -- abuse_scores, notification_outbox, legal_acceptances.` → `+  -- abuse_scores, notification_events, notification_messages, legal_acceptances.`
- **Startup env validation** lives in `apps/api/src/env.ts` `validateEnvironment()` (called from `server/index.ts:900`), not in `packages/shared/src/env.ts`, whose own header says it is consumed by nobody. Both were updated: the shared schema carries the shape (`notificationEnvSchema`); the startup validator enforces presence in production. **Set `RESEND_WEBHOOK_SECRET` and `NOTIFICATION_FROM_EMAIL` in Vercel before this deploys, or production will not boot.**
- **`scripts/ci/genesis-schema.expected.sql`** had to be regenerated (the `genesis-fresh-apply` job diffs it); the brief did not mention it.
- **Sweep cron**: implemented as a fifth `vercel.json` entry (`/api/internal/notification-dispatch-sweep`, `30 4 * * *`) and a new handler; the four existing entries are untouched. Whether the hobby plan accepts a fifth cron is only knowable at deploy.
- **Webhook race**: a delivery event that arrives before the dispatcher has written `provider_message_id` cannot be matched. It is stored `unmatched` (200) and reconciled when the send is recorded (contract §6.5). The same Resend account carries Supabase Auth mail, so unmatched receipts for mail this system never sent are expected and harmless.
- **`.env.example`** files were not edited (a read of `server/.env.example` was declined earlier in the session). The three variable names are listed in `packages/shared/src/env.ts` and the contract.
- **`Result` type**: `apps/workers/tutor-orchestrator/src/lib/vertex-client.ts:69` already defines one for the worker process (excluded from the root tsconfig). The app-side canonical one is now `packages/shared/src/result.ts`.

## 2. Step 2 — deletion commit

Commit `2bbc142`: 23 files, 3 insertions, 2,508 deletions. `pnpm -s exec tsc`: 41 errors before, 41 after, same six files (all in `ci/known-gaps.yaml`'s accepted set), none in a touched file. The three edited test suites (`forbidden-routes`, `calendar.csrf`, `auth-signup`) run: 24/24.

## 3. Steps 3–4 — migrations (commit `481b9c1`)

- `supabase/migrations/20260903000000_notifications_rebuild.sql` — Migration A.
- `supabase/migrations/20260903010000_drop_notification_outbox.sql` — Migration B.
- `scripts/ci/genesis-fresh-apply.sh`: first run FAIL on `SNAP` (expected drift), snapshot regenerated from the harness output, second run `GENESIS FRESH-APPLY GATE: PASS`.
- `node scripts/ci/no-hardcoded-constants.mjs`: PASS.
- psql smoke on the pipeline (throwaway DB): rollback → 0/0; commit → 1 event, 3 messages; replay → unchanged; failed send → `queued`, `attempts=1`, `last_error='boom'`; early webhook → `unmatched`; send record → `delivered` (reconciled); duplicate svix-id → `duplicate`; bounce after delivered → `applied`, status `bounced`; feed/unread/mark-all → 1/1/0; foreign `mark_notification` → 0 rows; as `authenticated`: own rows only, `read_at` update ok, `attempts` update → `ERROR: notification_messages: a recipient may change only seen_at, read_at and archived_at`.

## 4. Steps 5–8 — code and proof (commit `759e034`)

### 4.1 Local checks

| Check                                                                                | Result                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm -s exec tsc`                                                                   | 41 errors, unchanged accepted set                                                                                                                                                                                       |
| `pnpm -s exec tsc -p tsconfig.ci.json \| grep -c 'error TS'`                         | see §4.4                                                                                                                                                                                                                |
| `pnpm -s run build`                                                                  | PASS (`✓ No *_SECRET tokens found in built output.`) — after the bell import fix; the first build FAILED because `@lyceon/shared`'s index re-exports `env.ts` and its key names reached a client chunk                  |
| `pnpm -s exec vitest run tests/ci/notifications.pg.ci.test.ts` (PGHOST set)          | 17/17, three consecutive runs                                                                                                                                                                                           |
| `pnpm -s exec vitest run tests/ci/guardian-link-code.pg.ci.test.ts` (PGHOST set)     | 7/7                                                                                                                                                                                                                     |
| `pnpm -s exec vitest run packages/shared/src/__tests__/notifications-schema.test.ts` | 6/6                                                                                                                                                                                                                     |
| ESLint on every new file                                                             | 0 findings                                                                                                                                                                                                              |
| ESLint on touched legacy files (before → after)                                      | `server/index.ts` 60 → 60; `guardian-routes.ts` 1 → 1; `internal-cron-routes.ts` 0 → 0; `apps/api/src/env.ts` 18 → 18; `app-shell.tsx` 2 → 2; `UserProfile.tsx` unused-import findings 0                                |
| `node scripts/ci/scl-duplicate-check.mjs`                                            | PASS                                                                                                                                                                                                                    |
| `pnpm run route:validate`                                                            | PASS (35 ACTIVE routes)                                                                                                                                                                                                 |
| `pnpm run verify:csrf`                                                               | FAIL on the base branch too (`/retention/sweep`, `server/routes/internal-retention-routes.ts:153`, pre-existing, not in CI); the Resend webhook is listed among the 3 exempt routes by its `CSRF_EXEMPT_REASON` comment |

### 4.2 Mutation observations — every gate seen red once on the assertion it names

Script: `mutations.sh` (session scratchpad). Each mutation was applied to the working tree, the suite run, the red cases recorded, and the file restored with `git checkout --`; the tree was clean afterwards.

| #   | Mutation                                                       | Red cases                                                                     |
| --- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| M1  | remove the `PERFORM emit_notification_event` from the link RPC | C2.2, C2.3, C4.1, C5.3, C6.1, C7.2, C5.4, C6.5, C9.1, C9.2, C3.1, cursor (11) |
| M2  | messages→profiles FK becomes `ON DELETE NO ACTION`             | C1.3                                                                          |
| M3  | drop the recipient column-guard trigger                        | C9.2                                                                          |
| M4  | failed send sets `status='failed'` immediately                 | C4.1                                                                          |
| M5  | select-self policy becomes `USING (true)`                      | C9.1                                                                          |
| M6  | webhook receipt insert without `ON CONFLICT`                   | C5.4                                                                          |
| M7  | event insert without `ON CONFLICT`                             | C5.2                                                                          |
| M8  | transport drops the `Idempotency-Key` header                   | C5.3                                                                          |
| M9  | webhook skips signature verification                           | C7.2                                                                          |
| M10 | redeem route does not `await` the dispatch                     | C2.3, C4.1, C5.3, C6.1, C7.2, C5.4, C6.5 (7)                                  |
| M11 | feed route reads a fixed id instead of the caller              | C3.1/C9.4                                                                     |

The cascade negative control (contract C1.3) is also inside the suite itself: the FK is altered to `NO ACTION` in the throwaway database and the DELETE is asserted to raise `23503`, then the FK is restored and its `confdeltype` re-checked as `c`.

### 4.3 CI wiring

`.github/workflows/ci.yml` — step "Notifications rebuild → real PG proof" in the PG-backed job, after "Guardian link code → real PG proof". It echoes the vitest output, fails if the word `skipped` appears, and fails if the suite file name is absent from the output — the log line is the proof of execution, not the job colour.

### 4.4 Accepted-gap counts (ci/known-gaps.yaml) and the full suite

| Gate                                                                       | Measured on this tree                                               | Ceiling |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------- |
| `pnpm exec tsc -p tsconfig.ci.json \| grep -cE 'error TS'`                 | 41                                                                  | 41      |
| `pnpm run lint` problems                                                   | 1721                                                                | 1906    |
| `pnpm test` (no PGHOST; PG suites skip by design and run in their own job) | 183 files passed, 10 skipped; 1568 tests passed, 99 skipped; exit 0 | —       |

### 4.5 One intermittent failure found and fixed before push

Running the PG suite repeatedly, 1 run in 8 failed `feed cursor pagination walks every item exactly once` with an empty second page. Cause: the cursor carried `created_at` as an ISO string; over node-pg the value is a `Date` (millisecond precision) while Postgres keeps microseconds, so the keyset comparison `(created_at, message_id) < (cursor_ts, cursor_id)` could exclude a row created in the same millisecond. Fix: the cursor carries only the message id and `notification_feed(p_recipient_id, p_limit, p_before_message_id)` reads that row's `(created_at, message_id)` back at full precision (`20260903000000_notifications_rebuild.sql`, `notification_feed`). Six consecutive runs after the fix: 17/17 each. Snapshot regenerated; fresh-apply PASS.

## 5. Step 9 — acceptance evidence (owner-run; cannot be produced from this session)

Nothing below was executed. This session has no `RESEND_API_KEY`, no Vercel deploy, and no prod write access; the transport was proved against an in-memory fake that records requests.

1. **Karl applies Migration A.** Then, read-only:
   ```sql
   select relname, relrowsecurity from pg_class where relname in ('notification_events','notification_messages','notification_delivery_events');
   select conname, confdeltype from pg_constraint where conname in ('notification_events_subject_profile_id_fkey','notification_messages_recipient_profile_id_fkey');  -- both 'c'
   select policyname, cmd from pg_policies where tablename = 'notification_messages';  -- select_self, update_self
   select tgname from pg_trigger where tgrelid = 'public.notification_messages'::regclass and not tgisinternal;  -- notification_messages_recipient_guard
   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('emit_notification_event','notification_event_id','record_notification_send_attempt','apply_notification_delivery_event','notification_feed','notification_unread_count','mark_notification','mark_all_notifications_seen');
   select position('emit_notification_event' in pg_get_functiondef('public.create_active_guardian_link_audited'::regproc)) > 0 as rpc_emits;
   ```
2. **Set env in Vercel** (production): `RESEND_WEBHOOK_SECRET`, `NOTIFICATION_FROM_EMAIL=notifications@send.lyceon.ai` (`RESEND_API_KEY` exists). Register the Resend webhook endpoint `https://lyceon.ai/api/webhooks/resend` for `email.delivered`, `email.bounced`, `email.complained`, `email.failed`. Deploy.
3. **A guardian redeems a link code in production.** Then:
   ```sql
   select event_type, subject_profile_id, payload from public.notification_events order by created_at desc limit 1;
   select recipient_profile_id, channel, status, attempts, last_error, provider_message_id from public.notification_messages where event_id = (select event_id from public.notification_events order by created_at desc limit 1);
   -- expect: student in_app delivered; guardian in_app delivered; guardian email sent (then delivered)
   ```
4. **Bells**: the student's header shows an unread badge of 1; the guardian's shows 1. Opening the popover marks them seen.
5. **A real email** arrives at the guardian's inbox from `notifications@send.lyceon.ai` with subject `You're now linked to <student> on Lyceon`. Keep the headers.
6. **Webhook**: after Resend fires `email.delivered`:
   ```sql
   select status, delivered_at, provider_message_id from public.notification_messages where channel='email' order by created_at desc limit 1;  -- delivered, not null, re_...
   select provider_event_id, event_type, outcome, applied_at from public.notification_delivery_events order by received_at desc limit 3;
   ```
7. **Karl applies Migration B.** `select to_regclass('public.notification_outbox');` → NULL.

## 6. What this build does not do (by ruling or by limit)

- No emitter for `guardian_consent_requested` or `account_deletion_scheduled` (§1.3).
- No retention sweep (Phase 2; rule stated in contract §11; SCL-082 PROPOSED).
- No Realtime; the bell refetches on open and on window focus.
- No real email was sent from this session.

## 7. CI rounds on the PR (post-push)

| Head      | Failure                                                                                                             | Cause                                                                                                                                             | Fix                                                                                                                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `9fd12dd` | `practice-integration` — "FAIL: the SCL-080 PG suite SKIPPED rather than running" although the suite passed 7/7     | the step greps vitest output for the word `skipped`; the dispatcher's summary log carried `"skipped":0`                                           | counter renamed to `deferred` (`server/lib/notifications/dispatch.ts`); reproduced locally: both PG suites pass and `grep -q skipped` no longer matches (`9dee68d`)                                                                                                                            |
| `9fd12dd` | `ci` — boot probe: "the bundle does NOT boot" with the documented environment                                       | `validateEnvironment()` is fatal in production without the three notification variables, and they were not in `scripts/ci/boot-env.manifest.json` | added with fake values; local `pnpm run probe:boot`: sufficiency PASS, necessity PASS for all 9 (each of the three breaks the boot when removed); `boot-probe.selftest.sh` PASS. This is the review moment the manifest exists for: **the same three names must be set in Vercel production.** |
| `9fd12dd` | CodeQL high: "Incomplete URL substring sanitization" at the test's grep clause `read(f).includes("api.resend.com")` | a hostname substring check pattern, flagged regardless of intent                                                                                  | the clause is a regex test on file contents (`/api\.resend\.com/.test(...)`); suite 17/17                                                                                                                                                                                                      |

## 8. Owner rulings R7–R11 (2026-09-03) and what changed

| Ruling                                                          | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R7 — `guardian_consent_requested` is not a notification         | Dropped from the Migration A CHECK (file edit; A is unapplied), from `NOTIFICATION_EVENT_TYPES`, from the templates switch and the contract.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| R8 — `account_deletion_scheduled` is not a notification         | Same. Launch scope is one event type, `guardian_linked`. Snapshot regenerated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| R9 — both sends reinstated before merge                         | `server/lib/notifications/direct-sends.ts` (+ two templates) sends through `transport.ts` from `NOTIFICATION_FROM_EMAIL`. Consent: `profile-routes.ts`, key `guardian-consent-request:<guardian_consent_requests.id>` (the existing pending row's id when one is reused, else the new row's). Deletion: `account-deletion-routes.ts`, key `account-deletion-scheduled:<account_deletion_requests.id>`, the row read back by its token hash after the RPC. Both best-effort after commit, logged with redacted addresses. Proof: `tests/ci/notifications.direct-sends.test.ts` (keys, sender, links, escaping, no tracking, Result on failure, config_missing without a request, both call sites wired by grep). |
| R10 — the `skipped` grep is a gate that cannot recognise a pass | `scripts/ci/vitest-summary-gate.mjs` reads vitest's JSON report (`--reporter=default --reporter=json --outputFile=…`): `success`, passed/skipped/failed/todo counts, per-suite status, and a `passed` result with assertions for every named file. Text output is never inspected, so no log line can influence it. Its `--selftest` proves skipped / failed / zero-pass / missing-file / zero-assertion / unreadable each turn it red. All three PG steps in `ci.yml` use it; no `grep -q "skipped"` remains. Local: all three pipelines PASS on real reports; a no-PGHOST run (17 skipped) is refused with `no test passed` + `17 test(s) skipped`.                                                           |
| R11 — confirm the Vercel cron list                              | **Not confirmable from this session.** The Vercel API objects reachable here (`get_project`, `get_deployment` for the production deployment `dpl_3waiAsQBAZDb12HHCR288JPhRGq5`) carry no cron definitions. Owner action: Project → Settings → Cron Jobs in the dashboard; if fewer than five are listed, the four pre-existing crons (`legal-acceptance-drain`, `execute-deletions`, `stale-session-sweep`, `baseline-pending-sweep`) have been unscheduled, which is a larger finding than notifications. Notification timeliness does not depend on it: dispatch is inline.                                                                                                                                   |
