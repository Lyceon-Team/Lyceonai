# Role And Entitlement Runtime Contract

## Role truth

- Canonical role normalization: `server/lib/auth-role.ts`
- Supported runtime roles:
  - `student`
  - `guardian`
  - `admin`
- `parent` is normalized to `guardian` only for legacy compatibility.
- Any other missing or invalid role normalizes to `student`.

## Entitlement truth

- Entitlements are student-owned and stored in `entitlements`.
- Guardian payment metadata is allowed, but payment does not create guardian-owned premium access.
- Guardian premium visibility is derived from:
  1. an active guardian link
  2. the linked student entitlement being active or trialing and not expired

## Canonical entitlement readers

- Student access: `resolveLinkedPairPremiumAccessForStudent(...)` in `server/lib/account.ts`
- Guardian access: `resolveLinkedPairPremiumAccessForGuardian(...)` in `server/lib/account.ts`
- Guardian premium gate middleware: `server/middleware/guardian-entitlement.ts`
- Student KPI gating: `server/services/kpi-access.ts`
- Billing status and checkout ownership: `server/routes/billing-routes.ts`

## Locked guardian states

- No linked student:
  - billing status returns `linkRequiredForPremium: true`
  - premium guardian surfaces stay locked
- Linked student without active entitlement:
  - guardian summary/report/calendar routes return `402 PAYMENT_REQUIRED`
  - billing status returns `requiresStudentSubscription: true`
- Linked student with expired or past-due entitlement:
  - guardian visibility is removed immediately
  - billing status returns `lockedReason` aligned to the linked student entitlement state

## Middleware order

Protected endpoints must enforce, in order:

1. authenticated session
2. role permission
3. allowed student context or guardian link
4. entitlement if required
5. request validation / state mutation

This ordering is enforced across:

- `server/routes/guardian-routes.ts`
- `server/routes/billing-routes.ts`
- `server/routes/full-length-exam-routes.ts`
- mounted review/question feedback POST routes in `server/index.ts`

## Role-switch safety

- Direct runtime role switching is not implemented by design.
- `PATCH /api/profile` rejects `role` mutations.
- Operational fallback is `support@lyceon.ai`.

## Evidence-backed regression coverage

- `tests/ci/guardian.anti-leak.ci.test.ts`
- `tests/ci/guardian-reporting.contract.test.ts`
- `tests/ci/kpi.gating.contract.test.ts`
- `tests/ci/identity-entitlement.contract.test.ts`
- `tests/entitlements.webhook.test.ts`
