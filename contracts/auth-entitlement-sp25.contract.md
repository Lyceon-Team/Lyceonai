# Auth + Entitlement — SP-25 Single Entitlement Definition — Validation Contract (DRAFT for review)

> The first contract of the Auth + Entitlement wave. Defines **one** canonical answer to
> "is this profile entitled right now?" consumed identically by SQL (RLS, guardian mirror)
> and TS (route gates) — closing SP-25's TS↔SQL drift. Leads the wave: every entitlement gate
> downstream (transition writer, route repoint, the four-persona proof) consumes this.
> Defines correctness independently of implementation (Doc 00 V6 §10 Phase 1).
>
> **Grounding:** HEAD `bd2049a` (cleanup). Doc 01 V8 "Identity, Access, Billing & Guardian Trust"
> §20–§27 (billing/entitlement); genesis `00000000000000_genesis.sql` (`entitlements`,
> `idx_entitlements_active`, `entitlement_features`); `20260613010000_05b_domain_mastery_kpi.sql`
> (`entitlement_active`, `guardian_can_view_student`, guardian-mirror RLS).
> Owner HALT rulings 2026-06-14 (`docs/SpecAudit/50-auth-entitlement/PHASE-0-PLAN.md` §8).
> Branch policy: cut from `cleanup`; PR → `cleanup`.

## 0. The drift, stated — two definitions that disagree in both directions

| Definition | Location | Entitled set | Reads |
|---|---|---|---|
| SQL `entitlement_active(uuid)` | `…_05b…sql:107–119` | `status IN ('active','past_due')` | `entitlements.status` |
| TS `isEntitlementActive()` | `server/lib/account.ts` | `plan==='paid' && status IN ('active','trialing')` | `entitlement.plan` (**genesis has no `plan` col — it is `tier`**) |

The SQL form excludes `trialing`; the TS form excludes `past_due` (grace) **and** reads a column
that does not exist in the genesis schema. SP-25's OPEN residual (`gap-registry.md` GAP-SP-25): *"the
route-layer student premium gate (kpi-access) should consume the same definition to fully close
TS↔SQL drift."* This contract collapses both to one.

## 1. The canonical definition (HALT-1 ruling: `{active, past_due, trialing}`)

The single source of truth is the SQL function `public.entitlement_active(uuid)`. Per HALT-1 (launch
ships a 7-day **Stripe-native** trial; `trialing` is a first-class entitled state), the canonical
entitled set is **`{active, past_due, trialing}`**:

```sql
-- new migration (timestamp after 20260613020000); CREATE OR REPLACE — does not edit the landed file
CREATE OR REPLACE FUNCTION public.entitlement_active(p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.entitlements e
    WHERE e.profile_id = p_profile_id
      AND e.status IN ('active','past_due','trialing')   -- HALT-1: trial is entitled
  );
$$;
REVOKE ALL ON FUNCTION public.entitlement_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.entitlement_active(uuid) TO service_role;  -- no authenticated grant
```

The matching partial index is rebuilt to the **same** set so predicate and index can never drift:

```sql
DROP INDEX IF EXISTS public.idx_entitlements_active;
CREATE INDEX idx_entitlements_active ON public.entitlements (profile_id)
  WHERE status IN ('active','past_due','trialing');
```

State-vocabulary mapping (Doc 01 V8 §22 → genesis `(tier,status)`): `premium_trial` =
`(premium, trialing)`; `premium` = `(premium, active)`; grace = `(*, past_due)`; `free` =
`(free, *)` / `canceled` / `unpaid` / `incomplete*`. "Entitled" = `status ∈ {active,past_due,trialing}`.

> **HALT-10 (`canceled`-at-period-end) — RESOLVED 2026-06-14.** Doc 01 V8 §21 / Appendix C
> `isStatusActive` treat `canceled` + `cancel_at_period_end` + `current_period_end > now()` as still
> entitled. **Owner ruling: confirmed Stripe-native** — that window keeps Stripe `status='active'`, so
> `{active,past_due,trialing}` is the **complete** entitled set and a `canceled` row correctly means
> access-ended. **No temporal arm; E3 stands.** The §21/Appendix C temporal logic is a spec artifact
> reconciled owner-side (WS-S, `docs/Spec` read-only). The entitled set is now fully locked.

## 2. The TS consumer — one definition, asserted identical

The TS route layer MUST NOT re-derive entitlement. It resolves entitlement through the **one**
definition, via either:
- **(preferred) a service_role RPC** to `public.entitlement_active(p_profile_id)` — the DB is the
  single evaluator; TS holds no status set; **or**
- **a single shared TS predicate** in `packages/shared` whose status set is `ENTITLED_STATUSES =
  ['active','past_due','trialing']`, asserted **byte-identical** to the SQL set by a parity test.

Either way there is exactly one entitled-status set in the codebase. `server/lib/account.ts:
isEntitlementActive` is **deleted**, not re-pointed (HALT-7). All route gates
(`requireGuardianEntitlement`, the ad-hoc `kpi-access` helper, the GAP-ID-09 ungated premium routes)
resolve entitlement through this single definition + `canAccessFeature` over `entitlement_features`.

**Canonical consumer module (platform-native, not a per-handler call).** The RPC / shared predicate is
the *evaluator*; the canonical *consumer* is the `EntitlementService` module (Doc 01 V8 §25–§33) — "the
single authoritative source … No feature defines its own entitlement cache, webhook handler, or check
logic" (§25.1). Route gates call `EntitlementService`, not a raw per-request DB call. Its §25.2
in-process cache (60s TTL) + LISTEN/NOTIFY invalidation (on Stripe webhook + profile / guardian-link
change) is built with the transition writer (build steps 2/3) — **forward-ref**, not this contract;
SP-25 pins only the single entitled definition that module evaluates.

## 3. Guardian mirror — unchanged by construction, honors trial by source

`guardian_can_view_student(p_student_id)` already = `(active link) AND entitlement_active(student)`
(`…_05b…sql:129–139`). Because it calls `entitlement_active`, the guardian mirror honors
`{active,past_due,trialing}` **automatically** — no separate status set in the guardian path. A
guardian of a `trialing` linked student sees the mirror; a guardian of a `canceled` student does not.
This is HALT-1 + HALT-9 (confirmed 2026-06-14). The six guardian-mirror RLS policies (05B/05C) are untouched.

## 4. Post-conditions (falsifiable)

- **E1 — one entitled set, everywhere.** Exactly one entitled-status set exists across SQL + TS, and
  a **parity gate** asserts TS set ≡ SQL set ≡ `{active,past_due,trialing}`. *Falsifier:* any second
  hardcoded entitled-status list; any TS gate enumerating statuses outside the shared source.
- **E2 — canonical predicate shape + grant.** `entitlement_active(uuid)` = `EXISTS(entitlements
  WHERE profile_id AND status IN ('active','past_due','trialing'))`, `STABLE SECURITY DEFINER`,
  `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE … service_role` **only**. *Falsifier:* `authenticated`
  (or `anon`) can `EXECUTE` it; or any status added/removed without updating E3.
- **E3 — index ≡ predicate.** `idx_entitlements_active` WHERE-clause status set ≡ the function's set.
  *Falsifier:* the two sets differ.
- **E4 — fork deleted.** `server/lib/account.ts:isEntitlementActive` is removed; no symbol imports it;
  no code reads `entitlement.plan`. *Falsifier:* a grep-guard finds `isEntitlementActive` or
  `entitlement.plan` anywhere in `server/**` / `apps/**`.
- **E5 — route gates consume the one definition.** `requireGuardianEntitlement`, `kpi-access`, and the
  GAP-ID-09 premium routes resolve entitlement via the RPC / shared predicate (not an ad-hoc helper).
  *Falsifier:* any premium route computing entitlement from a local status check.
- **E6 — guardian mirror untouched + trial-honoring.** `guardian_can_view_student` still calls
  `entitlement_active` (no inline status set). Re-proof: guardian of `trialing` student → visible;
  guardian of `canceled` student → empty. *Falsifier:* a literal status set in the guardian path, or
  the guardian proof regressing.
- **E7 — `trialing` entitled end-to-end (no Stripe).** With entitlement state planted directly
  (status `trialing`), a student gets `200` on a premium route and that student's entitled guardian
  gets `200`; a `canceled` student gets `402/403`. *Falsifier:* `trialing` denied, or `canceled`
  allowed.
- **E8 — genesis-fresh-apply.** The new migration applies cleanly on a from-scratch genesis chain;
  `pnpm -s run build && pnpm test` green. *Falsifier:* fresh-apply or build/test failure.
- **E9 — no `service_role` to client.** No new authenticated/anon grant on `entitlement_active`; the
  client bundle (`dist/public/**`) contains no service_role key / secret. *Falsifier:* either appears.

## 5. Forward-refs (out of scope here)

- **FWD-AE-01 — Stripe trial mechanics + emit.** Starting the trial (`trial_period_days`), the
  `trial_will_end` webhook, and the `trialing → active | canceled` transitions are billing-wave work
  (Doc 01 V8 §22). This contract only makes `trialing` *entitled*; it does not start or end trials.
- The **entitlement transition writer** that *sets* `status='trialing'` (so the proof can plant it) is
  the next contract (build-order step 2); this contract assumes status can be set service-role-side.

## 6. CI gates (blocking)

Parity gate (E1) · predicate/grant assertion (E2) · index≡predicate (E3) · fork grep-guard (E4) ·
guardian-mirror trial re-proof (E6) · route-gate trial/cancel proof (E7) · genesis-fresh-apply (E8) ·
service_role-not-in-client guard (E9). All blocking; carry forward the WS-0 anti-leak probe.

## 7. Dependencies

Leads the wave — depends only on the HALT-1 ruling (locked). Consumed by: the transition writer
(step 2), the `server/**` repoint (step 3), and both load-bearing proofs (step 6). Owner runs the
live migration apply.
