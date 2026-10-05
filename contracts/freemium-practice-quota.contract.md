# Freemium Practice Quota — Contract (HALT-5; folds into the auth wave's entitlement-route-gating)

> Registered 2026-06-15 from the owner's HALT-5 ruling. Follow-on lane (after this PR's re-audit);
> it folds into the auth wave's entitlement-route-gating, consuming the already-shipped pieces.
> No new product logic — wire two existing primitives together.

## The rule

- **Unpaid:** 40 free practice questions/day. **Paid (entitled):** unlimited.
- **What counts (owner rulings):** a practice question counts once it is **answered or
  skipped**, dated by `practice_session_items.occurred_at`, in the local day of
  `practice_runtime_config.quota_reset_timezone` (America/Chicago at launch). A question served
  and not yet answered or skipped counts nothing; an idempotent replay is the same row and
  counts once. **Diagnostic** questions (`practice_sessions.mode = 'diagnostic'`) count nothing,
  and the diagnostic's own next question is served past the limit. Sources: OQ-43 / F-61 (Karl,
  2026-10-03: Doc 02B §13, Chicago midnight, one function for the 402 and the read; migration
  `20261023000000`), OQ-50 (Karl, 2026-10-05: "skips count, diagnostic doesn't"; SCL-209;
  migration `20261024000000`). Refusal is at session start and next question only; a question
  already on screen can still be answered or skipped (OQ-50 (b), not ruled, kept as built).

## Consume, never hardcode (the two primitives already exist)

1. **The quota constant is already seeded — read it from the table.** The value lives at
   `public.practice_runtime_config.key = 'daily_quota_free'` = `40` (integer), seeded in
   `supabase/migrations/20260610000000_ws2_config_constants.sql:82` (Doc 02B §41, GAP-ID-06,
   tz America/Chicago). **No hardcoded `40`** anywhere — the config grep-guard enforces it.
   Read the value from `practice_runtime_config` at request time (the `*_runtime_config` family
   has NOTIFY-based invalidation per genesis §98).
2. **The entitlement decision is the single evaluator.** Gate on **`EntitlementService` →
   `entitlement_active(profile_id)`** (the one route-facing consumer, SP-25 / `auth-entitlement-
sp25.contract.md`). Unpaid (`entitlement_active` = false) → enforce the `daily_quota_free`
   cap; entitled (`entitlement_active` = true) → unlimited. **No second status set** in the
   quota path — it asks `EntitlementService`, it does not re-derive entitlement.

## Where it wires

The practice serving routes (`practice-canonical.ts` "next" / session-start) gain an
entitlement-aware quota check: `EntitlementService.isActive(profileId)` → if not active, count
today's practice questions for the profile against `practice_runtime_config.daily_quota_free`
and 429 / block on exceed; if active, skip the cap. This is the entitlement-route-gating step of
the auth wave applied to practice (the seam already reconciled those routes; this layers on top).

## HALT — reconcile the "entitled" status set with the single evaluator (owner ruling)

The ruling lists entitled as **`active / trialing / past_due`**, but the canonical single
evaluator `entitlement_active` is **`{active, past_due}`** (grace-inclusive; trialing NOT
included) per `auth-entitlement-sp25.contract.md`. SP-25 forbids a second status set, so the
quota gate MUST consume `entitlement_active` as-is. **If `trialing` should grant unlimited
practice, that is a one-line change to `entitlement_active`'s status set (the single source) —
not a trialing-only branch in the quota path.** Owner to confirm: include `trialing` in
`entitlement_active`, or keep the quota gate on the canonical `{active, past_due}`.

## Status

Registered. Built as part of / after the auth wave's entitlement-route-gating, post-re-audit.
No custom quota logic; consume `practice_runtime_config.daily_quota_free` + `entitlement_active`.
