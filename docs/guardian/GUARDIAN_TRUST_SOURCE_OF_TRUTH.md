# Guardian Trust Source of Truth

**Canonical Source of Truth:** `guardian_links` table.

## Access Rules

Guardian visibility and access MUST derive ONLY from:
1. An active Guardian Link.
2. An active Student Entitlement.

**Canonical Rule:**
`guardian_link.active == true AND student.entitlement.status == active`

## Excluded Fallbacks

- `profiles.guardian_profile_id` MUST NOT be used for live authorization checks. The legacy direct link via profiles has been superseded by the `guardian_links` canonical truth.
- Guardian payments DO NOT create intrinsic guardian-owned premium access. Entitlements are always allocated to the student boundary. Access is inherited transitively via active links.
- No "dual-read fallback" logic permitted in authorization flows.
