# Retention and Deletion Architecture

## Deletion Request Lifecycle

Account deletion requests enter a 24-hour grace window via `POST /api/account/delete`. 

- **Pending**: Request registered, awaiting 24 hours. User may cancel explicitly.
- **Cancelled**: Explicit cancellation request invoked via `POST /api/account/cancel-deletion`.
- **Completed**: Execution run past grace window.

Execution is run through an admin-only endpoint (`POST /api/account/execute-deletions`).

## De-identification Standards

Upon expiry of the grace window, the system strictly de-identifies the user via stored procedure `deidentify_user` rather than performing hard deletions. This removes identity constructs while preserving internal ID linkages needed for minimal audit continuity.

### Removed Identifiers
- Full Name (`first_name`, `last_name`, `display_name` rewritten to "De-identified User")
- Email Address (scrambled to deterministic `deleted_<user_id>@deleted.lyceon.ai`)
- Phone Number, DOB, and Address scrubbed (`NULL`)
- Student link and legacy guardian profile link removed (`student_link_code`, `guardian_profile_id` → `NULL`)

### Access Revocation
- Supabase auth identity is disabled (email updated, long-lived ban set) and metadata marks deletion completion.
- Guardian links for the user are revoked (`guardian_links.status='revoked'`) without altering student entitlements.

### Deleted User Data (Hard Delete)
- Practice, review, mastery, and exam runtime tables tied to `user_id`/`student_id`
- Tutor interaction telemetry
- Study calendar profiles and plan tasks
- KPI counters/snapshots
- Notifications and user notification preferences
- Guardian consent requests involving the user
- Usage records by account_id(s)

### Preserved Links
- Internal Application IDs / Ledger Continuity preserved to not break aggregated learning telemetry where PII is not exposed.

### Minimal Retained Records (Scrubbed)
- `entitlements` retained for ledger continuity but Stripe identifiers removed and plan/status reset to free/inactive.
- `legal_acceptances` retained for compliance but `ip_address` and `user_agent` are nullified.
