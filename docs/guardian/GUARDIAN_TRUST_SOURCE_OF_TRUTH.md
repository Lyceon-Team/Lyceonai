# Guardian Trust Source of Truth

This document outlines the source of truth for guardian authentication, authorization, and student data visibility.

## 1. Canonical Table: `guardian_links`
The single source of truth for all guardian↔student relationships is the `public.guardian_links` table.

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
- **Active Link:** Defined strictly as `{ guardian_profile_id, student_user_id }` where `status = 'active'`.
- **Revoked Link:** Links are never hard-deleted. They are marked `status = 'revoked'` with a `revoked_at` timestamp.

## 2. Exact Visibility Rule
Guardian visibility to any student data requires **two independent, active states**:
1. **Active Link:** A row in `guardian_links` with `status = 'active'` for the specific `(guardian, student)` pair.
2. **Active Student Entitlement:** The linked student must have an **active paid subscription** (`entitlements.status = 'active' OR 'trialing'` AND `current_period_end > NOW()`). Payment does not bypass this. The entitlement belongs to the student's *account*.

If either state changes to inactive/revoked, visibility is revoked **immediately**.

## 3. Route Flow & Middleware
Any guardian route involving student data must pass through:
1. **Authentication:** `requireSupabaseAuth` validates the parent's session.
2. **Role Verification:** `requireGuardianRole` asserts `role === 'guardian'`.
3. **Entitlement & Link Verification:** `requireGuardianEntitlement` assertions:
   - Validates `guardian_links` (`status = 'active'`) for the requested student.
   - Retrieves the student's `entitlement` record.
   - Asserts `entitlement.plan === 'paid'` AND `status IN ('active', 'trialing')` AND `current_period_end > NOW()`.

### Code Paths
- `POST /api/guardian/link` -> `createGuardianLink()` Inserts/Upserts `guardian_links` status to 'active'.
- `DELETE /api/guardian/link/:studentId` -> `revokeGuardianLink()` Updates `guardian_links` status to 'revoked'.
- `GET /api/guardian/students` -> `getAllGuardianStudentLinks()` queries `guardian_links WHERE status = 'active'`.
- `GET /api/guardian/students/:studentId/*` -> Evaluates `isGuardianLinkedToStudent` and checks entitlement.

## 4. Denial Cases
The system enforces the following explicit denial scenarios with 403 or 404 responses:
- **Unlinked Guardian:** Guardian requesting access for a student they have not linked. (403/404)
- **Revoked Link:** Guardian requesting access for a student whose link was revoked (even if it was previously active). (403/404)
- **Inactive Student Entitlement:** Guardian linked to a student with no active paid subscription, or an expired one. (402 Payment Required)
- **Immediate Revocation:** Once `revokeGuardianLink()` is called, the next and all subsequent API requests for that student fail immediately.
- **Entitlement Expiration:** Once the student's `current_period_end` passes, guardian visibility fails immediately, regardless of link status.

## 5. Deprecated Paths Removed
- ❌ **`profiles.guardian_profile_id`:** Deprecated. A user's profile is NO LONGER the source of truth for who their guardian is. The `guardian_links` table enables many-to-many, time-bound, and verifiable relationships.
- Due to the nature of the migration, `profiles.guardian_profile_id` is maintained passively, but no authorization decisions are made from it.
