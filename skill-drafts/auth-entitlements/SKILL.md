---
name: auth-entitlements
description: Server-authoritative auth, role enforcement, entitlements, and the guardian trust model. Use whenever code authenticates a user, checks a role or entitlement, gates access to a resource, implements guardian visibility, or wires payment to access. Covers the fixed handler order and the derived-visibility rule.
---

# Auth, Roles & Entitlements (Coding Standards §6, §8.1 · canonical: docs/Spec, Doc 01)

Server is the only authority. The client is never trusted about who it is or what it may do.

## Non-negotiables

- **Identity provider:** Supabase Auth. **Session validation: server-side only.**
- Never trust client claims about role, entitlement, or session state.
- Entitlements are **student-scoped** and must be explicitly set. **Payment ≠ permissions** — a successful charge does not by itself grant access.

## Guardian trust model

Guardian visibility is derived **only if BOTH are true**:

1. the guardian link is active, AND
2. the student's entitlement is active.

Guardians are **view-only**: zero write access to student learning state under any circumstance, and (per Doc 03) zero LISA/tutor access of any kind. Guardian reads are derived-data-only.

## Fixed handler order (§8.1)

Every protected route handler does exactly this, in this order — no business logic in the handler, no auth logic in domain functions:

1. Auth + role enforcement
2. Entitlement enforcement (student-scoped)
3. Zod parse of input
4. Call domain function (pure)
5. Serialize and return

## Status codes

401 unauthenticated · 403 unauthorized (authenticated but not allowed) · 404 not found. Do not 200 a denied request with an empty body.

## RLS / identity helpers

Use the canonical identity helpers defined by Doc 01 (e.g. `current_student_id()`, `is_admin()`) in RLS — do not reimplement identity resolution in a handler or invent a parallel helper. If the canonical helper name/signature is unconfirmed, surface it as a coordination gap; don't guess.

## Self-check before done

- [ ] Session validated server-side; no client role/entitlement trust anywhere.
- [ ] Guardian path enforces (link active AND entitlement active) and is read-only.
- [ ] No guardian access to LISA.
- [ ] Entitlement is checked independently of payment state.
- [ ] Handler follows the fixed order; domain functions contain no auth logic.

## Proving mechanism

Denial tests: unauthenticated → 401; wrong role → 403; inactive link or inactive entitlement → guardian sees nothing; guardian write attempt → rejected. Any auth/role/entitlement change REQUIRES added denial tests (§14).
