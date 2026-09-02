# Stripe Vertical — Phase C Preflight

**Date:** 2026-08-20 · **Status: GATE HELD.** Phase C has not started; no Phase C code was written.
Records gate state, the environment-variable wiring contract, and two owner actions that are not
DDL and therefore have no home in `STRIPE_DDL_QUEUE.md`.

---

## 1. Gate status

| #      | Item                                                                           | Status                                                         | Evidence                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **0**  | **Vercel environment split** (new, ruled ahead of 1–4)                         | ❌ **Open.** Owner action.                                     | Not verifiable from this session — see §3. Recorded as an amendment to SCL-049.                                                          |
| **0b** | **"Needs Attention" badge** on `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` | ⛔ **BLOCKER — meaning unresolved.**                           | Owner-reported. Not readable from here. See §4.                                                                                          |
| 1      | Doc 01 V6 quarantined                                                          | ❌ **Still present.** Owner is deleting; re-verify.            | `docs/Spec/Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust (V6).md`, 103918 bytes, still git-tracked as of this commit. |
| 2      | Webhook endpoints deleted / one test-mode created                              | ❌ Not done per the stale sync mirror. Owner Dashboard action. | `stripe._managed_webhooks`: both `status='enabled'`, `last_synced_at` 2026-01-11/12. Mount-path finding in §5.                           |
| 3      | ToS URL set in Dashboard                                                       | ⚠️ **Unverifiable from this session.**                         | No Stripe credentials: `env \| grep '^STRIPE'` → empty; no `.env` file. Requires `GET /v1/account` with a secret key, or the Dashboard.  |
| 4      | $0.50 guardian charge removed                                                  | ⛔ **STOPPED, per the owner's own condition.**                 | §37.2 is not implemented. See `WS-GL_Guardian_Link_Data_Layer.md` §8. No edit made to `guardian-consent-routes.ts`.                      |

## 2. Environment variables — validate, do not invent

Seven variables exist and Phase C wires to exactly these. No new variable is introduced.

| Variable                        | Read at                                                            | Phase C use                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `STRIPE_ENV`                    | `server/lib/stripeClient.ts:14,24,52`; `billing-routes.ts:804,834` | Expected-mode source for the SCL-049 `livemode` assertion. **Only meaningful once per-environment scoped** — see §3. |
| `STRIPE_SECRET_KEY`             | `stripeClient.ts:12`; `billing-routes.ts:807,818,835,860`          | Stripe client construction                                                                                           |
| `STRIPE_PUBLISHABLE_KEY`        | `stripeClient.ts:22`; `billing-routes.ts:808,836`                  | Client-side key delivery                                                                                             |
| `STRIPE_WEBHOOK_SECRET`         | `webhookHandlers.ts:249`; `billing-routes.ts:837`                  | `constructEvent` signature verification                                                                              |
| `STRIPE_PRICE_PARENT_MONTHLY`   | `billing-routes.ts:40`                                             | Checkout line item                                                                                                   |
| `STRIPE_PRICE_PARENT_QUARTERLY` | `billing-routes.ts:41`                                             | Checkout line item                                                                                                   |
| `STRIPE_PRICE_PARENT_YEARLY`    | `billing-routes.ts:42`                                             | Checkout line item                                                                                                   |

Note the four suffixed variants `STRIPE_SECRET_KEY_LIVE` / `_TEST` and
`STRIPE_PUBLISHABLE_KEY_LIVE` / `_TEST` (`stripeClient.ts:15-16,25-26`) are **not** in the owner's
list of what exists. They are a code-invented fallback path (audit G-24) reached only when the
unsuffixed variable is unset. Phase C does not rely on them; whether they are retired is part of the
`stripeClient` rebuild.

## 3. Owner action — Vercel per-environment scoping (not DDL)

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_ENV` are scoped **All Environments**, so
production, preview, and development share one key, one signing secret, and one mode selector.

Full argument in SCL-049's 2026-08-20 amendment. The short form: with one shared `STRIPE_ENV`, every
environment computes the same expected mode, so a preview deployment holding the live key would
accept a live event, assert `livemode = true`, and pass. The handler assertion is structurally blind,
not merely weak. **The configuration fix precedes the code**, or Phase C ships a gate that passes
everywhere and proves nothing — which Charter §5 rejects by name.

This is also an existing spec violation. Doc 06B §4.1 (heading verified: `# **§4 — Secret-Class
Inventory & Per-Platform Binding (Q-06B-1 = a)**`) binds Vercel runtime secrets to "**Vercel
environment variables**, environment-scoped (`production` / `staging` / `development`)", and §4.3
hard rule 2 forbids a privileged secret in "any preview-env runtime."

**Not verifiable from this session.** The Vercel MCP surface here exposes `list_teams`,
`list_projects`, and `get_project` and no environment-variable read. Reachable and confirmed: team
`team_jMcpkTj06ExncZhZCxA2BPMC`, project `prj_Q7cVFOLY753OTXPiZAKfiLczGIIo` ("lyceonai"), domains
including `lyceon.ai`. `get_project` returns no env data. Verification requires the Vercel Dashboard
→ Settings → Environment Variables, or `vercel env ls` with a token.

## 4. BLOCKER — the "Needs Attention" badge

Both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` carry a Vercel "Needs Attention" badge whose
meaning the owner has flagged as unresolved. **It is not readable from this session** (§3).

Phase C does not proceed past it. The badge could mean a value was never set for some environment, a
rotation is pending, a decryption or sync failure, or a scope conflict — and each implies a different
Phase C precondition. Building against a secret in an unknown state and finding out at the first
webhook is the failure mode Charter §2 exists to prevent. Resolve, then proceed.

## 5. Owner action — endpoint URL must match the mounted path

Endpoint deletion and creation are owner Dashboard actions. The assertion is the vertical's.

Both existing endpoints target **`/api/stripe/webhook`**:

```sql
SELECT id, url, livemode, status FROM stripe._managed_webhooks ORDER BY created;
```

```
we_1SoYHjBqixZkD6HCeRTg2ozZ | https://3174c658-…-00-1e98bo7l3c3sh.spock.replit.dev/api/stripe/webhook | false | enabled
we_1SoaTPDPtjyWEVqEdguPV2TE | https://lyceon-web--amingwa08.replit.app/api/stripe/webhook          | true  | enabled
```

The application mounts the handler at **`/api/billing/webhook`** (`server/index.ts:118`). The paths
have never matched, which independently explains `stripe_webhook_events` holding zero rows — every
event Stripe delivered went to a path the app does not serve, on a host that is no longer the
deployment target.

Whichever path the rebuild settles on, Phase C **asserts** it rather than assuming: a test that reads
the mounted route path and fails if it diverges from the documented endpoint path. Caveat on the
evidence above: `last_synced_at` is 2026-01-11/12, seven months stale, and this is a sync mirror of a
Dashboard this session cannot reach — it is evidence the work is outstanding, not proof of current
Dashboard state.

## 6. Owner action — rename the `PARENT_` price variables (proposal only, not applied)

`STRIPE_PRICE_PARENT_{MONTHLY,QUARTERLY,YEARLY}` encode a payer assumption that SCL-043 breaks. Under
SCL-043 the payer is the Customer and may be the student, a guardian, or an unrelated third party;
under SCL-052 all three prices resolve to the single entitlement tier `premium`. **The same three
prices therefore serve every payer type.** The catalog is right; the names are wrong.

Proposed, for the owner to apply or reject:

| Current                         | Proposed                         |
| ------------------------------- | -------------------------------- |
| `STRIPE_PRICE_PARENT_MONTHLY`   | `STRIPE_PRICE_PREMIUM_MONTHLY`   |
| `STRIPE_PRICE_PARENT_QUARTERLY` | `STRIPE_PRICE_PREMIUM_QUARTERLY` |
| `STRIPE_PRICE_PARENT_YEARLY`    | `STRIPE_PRICE_PREMIUM_YEARLY`    |

`PREMIUM` matches the `entitlements.tier` value the prices resolve to, so the name states what the
price grants rather than who was assumed to buy it. **Not applied** — renaming touches Vercel
configuration, which is owner-only under Charter §7, and a code-side rename ahead of the config
rename would break every environment on deploy. Phase C wires to the current names.

## 7. Phase C scope, as ruled — recorded so it is not re-litigated

- **Consent: build the Stripe-native path only.** `consent_collection.terms_of_service: 'required'`
  plus payer affirmation in `custom_text.terms_of_service_acceptance`, plus the SCL-044 consent
  record. **Do not build the embedded-Checkout variant** — B2-Q1 is open with counsel and the two
  answers produce different consent surfaces; the Stripe-native one is reversible, so it goes first.
- **Webhook handler: rebuilt, not patched**, plus the mount-path assertion in §5.
- **Consent record**: if no table exists when Phase C reaches it, stop and report (Charter §7).
  `STRIPE_DDL_QUEUE.md` D-2 already records the need.

## 8. Owner actions — endpoint event set and API-version skew (verified 2026-09-02)

Read from the live account, not inferred: `we_1SnXJSDPtjyWEVqE9u3VYgAx`, `status: enabled`,
`url: https://lyceon.ai/api/billing/webhook`, **21 enabled events**.

**8.1 Two subscribed events are outside the 19-event surface.** `server/lib/stripe/event-surface.ts`
declares exactly 19; the endpoint sends 21. The extras are `customer.card.updated` and
`customer.bank_account.updated`, both Sources-era legacy events with no branch in `dispatch()`. They
arrive as unsubscribed and log at WARN — noise, not risk. **Owner removes them at the Dashboard**;
nothing in the code changes, and the surface is already correct.

**8.2 API-version skew — reported, endpoint unchanged.** The endpoint serializes at
`2025-12-15.clover`; the pinned SDK bundles `2026-02-25.clover` and `client.ts` pins no
`apiVersion`. So an event arrives under one version and every `retrieve()` this handler makes
answers under another. Not implicated in the 2026-09-02 grant failure, but it is the class that
produced the period-fields defect (`current_period_*` moved from Subscription to SubscriptionItem in
`2025-03-31.basil`), where the delivered shape and the retrieved shape disagreed silently. Changing
the endpoint version re-serializes every future delivery and needs its own verified change — not a
side effect of this one.

**Note on §5 above, now stale.** Both endpoints then targeted `/api/stripe/webhook`. The single live
endpoint now targets `/api/billing/webhook`, which matches the mounted route. That owner action
appears done; §5 is left as written because it is the record of the finding, not of current state.

## 9. Owner action — a period in the database that Stripe never sent (verified 2026-09-02)

**There is no fabricating fallback in the code. The value was written from outside the
application.** That is the finding; the brief expected a `now() + interval` fallback to delete, and
there is none to delete.

`entitlements` for student `3f18cbe2` holds:

```
current_period_start  NULL
current_period_end    2027-09-02 09:51:10.059762+00
updated_at            2026-08-26 22:55:07.402374+00   (= created_at, never moved)
```

Ruled out, each by a direct check rather than by inspection:

- **The only two writers of that column** are `webhook-handler.ts:706` and `:1365`, both
  `epochToIso(item…)`. `epochToIso` takes whole Stripe epoch seconds, so it cannot produce
  `.059762` microseconds. Nothing else in `server/`, `apps/`, `packages/` or `scripts/` writes
  `current_period_end`.
- **No column default and no trigger.** `information_schema.columns` gives `column_default: null`
  for both period columns; `pg_trigger` on `public.entitlements` returns zero non-internal rows.
- **No webhook ran at that moment.** `stripe_webhook_events` jumps 09:41:26 → 10:02:14 on
  2026-09-02; nothing is recorded at 09:51:10.
- **No Supabase Edge Functions exist** on the project.
- **The value matches neither subscription.** `sub_1U8pin…`'s item ends 2027-08-26 22:55:01;
  `sub_1U4bqZ…`'s ends 2027-08-15 07:17:36. `2027-09-02 09:51:10` is exactly one year after
  09:51:10 **on the day it was observed**.

`updated_at` not moving is consistent with either a direct `UPDATE` or an `upsertEntitlement` call,
because **nothing maintains `updated_at` on this table** — no trigger, and `upsertEntitlement` never
includes it, so the `now()` DEFAULT only ever applies on INSERT. Same class as `profiles.updated_at`.
It is therefore not evidence either way, and is reported as its own defect below.

**Owner action.** The row's period is not recoverable from anything this system holds, so it must be
set from Stripe or cleared. Read-only verification of the true value first:

```sql
-- what the row says now
SELECT profile_id, current_period_start, current_period_end, updated_at
  FROM public.entitlements WHERE profile_id::text LIKE '3f18cbe2%';
```

Stripe's answer for `sub_1U8pin…` item `si_V97ymukbvCzxjf` is
`current_period_start = 1787784901` (2026-08-26 22:55:01Z) and
`current_period_end = 1819320901` (2027-08-26 22:55:01Z).

Either set those two values, or set both to NULL and let the next
`customer.subscription.updated` for that subscription rewrite them from the item — the handler now
provably writes NULL rather than a computed date when the item carries no period, and writes the
item's own epochs when it does (`tests/ci/stripe-unresolvable-subject.contract.test.ts`).
**Leaving the fabricated date is the one option to avoid**: renewal, grace and dunning all read it.

**`updated_at` is maintained by nothing.** No trigger exists on `entitlements`, and no writer sets
the column, so it records insert time forever. `profiles.updated_at` has the same defect. Fixing it
is a migration (a `moddatetime`-style trigger, or adding the column to every writer) and belongs to
whoever owns that migration queue — recorded here rather than fixed, because a column nobody
maintains is silently misleading in exactly the way this section had to work around.
