# Guardian Trust Source of Truth

This document outlines the source of truth for guardian authentication, authorization, linked-student visibility, and premium gating.

## 1. Canonical Table: `guardian_links`
The single source of truth for guardian↔student relationships is the `public.guardian_links` table.

```sql
CREATE TABLE public.guardian_links (
  id UUID PRIMARY KEY,
  guardian_profile_id UUID NOT NULL REFERENCES public.profiles(id),
  student_user_id UUID NOT NULL REFERENCES public.profiles(id),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  linked_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  UNIQUE(guardian_profile_id, student_user_id)
);
```

- Active link means `status = 'active'` for a specific `(guardian_profile_id, student_user_id)` pair.
- Revoked links are soft-revoked (`status = 'revoked'`, `revoked_at` set), not hard-deleted.
- Runtime enforcement is locked to **1 active guardian ↔ 1 active student**. Conflicting second active links are denied and treated as invariant violations.

## 2. Exact Visibility Rule
Guardian visibility to student-derived product surfaces requires two independent conditions:

1. Active link: the guardian is actively linked to that student in `guardian_links`.
2. Active premium on the linked student account: the linked student has active paid entitlement (`plan='paid'` and `status IN ('active','trialing')` and not expired).

If link or linked student entitlement becomes inactive, guardian visibility is revoked immediately.

## 3. Route Flow & Middleware
Guardian routes that expose student-derived data must pass:

1. Authentication: `requireSupabaseAuth`
2. Role verification: `requireGuardianRole`
3. Link + linked-student-entitlement enforcement: `requireGuardianEntitlement`

`requireGuardianEntitlement` is resolved via `resolveLinkedPairPremiumAccessForGuardian(...)` and denies when:
- guardian has no active link to requested student (`NO_LINKED_STUDENT`, 403)
- linked student has no active premium (`PAYMENT_REQUIRED`, 402)

## 4. Canonical Runtime Paths
- `POST /api/guardian/link` -> `createGuardianLink(...)` in `server/lib/account.ts`
- `DELETE /api/guardian/link/:studentId` -> `revokeGuardianLink(...)`
- `GET /api/guardian/students` -> `getAllGuardianStudentLinks(...)`
- `GET /api/guardian/students/:studentId/*` -> guarded by `requireGuardianEntitlement`

## 5. Denial Cases
- Unlinked guardian requests linked-student data: denied.
- Revoked link requests: denied immediately.
- Linked guardian with no active premium on the linked student account: denied (402).
- Second-link conflicts:
  - guardian already linked to different student: denied (`GUARDIAN_ALREADY_LINKED`, 409)
  - student already linked to different guardian: denied with anti-enumeration contract (404)

## 6. Deprecated Paths Removed
- `profiles.guardian_profile_id` is not authorization truth.
- Runtime guardian visibility is not derived from passive profile fields.
- Runtime relationship truth is `guardian_links` + the linked student's entitlement state.
