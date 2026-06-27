# Retention and Deletion Architecture

> **Internal engineering/compliance document — not user-facing.**
> Describes the technical deletion mechanism (anonymize-retain per Doc 05E).
> The user-facing presentation is "permanently deleted" — see PR-5e copy spec.

## Deletion Request Lifecycle

Account deletion requests enter a 7-day grace window via `POST /api/account/delete`.

- **Pending**: Request registered, awaiting 7 days. User may cancel explicitly.
- **Cancelled**: Explicit cancellation request invoked via `POST /api/account/cancel-deletion`.
- **Completed**: Execution run past grace window.

Execution is run through a cron-only endpoint (`GET /api/internal/execute-deletions`),
gated by `CRON_SECRET` and the `ACCOUNT_DELETION_LIFECYCLE_V2` feature flag.

## De-identification Standards

Upon expiry of the grace window, the system de-identifies the user via stored procedure `deidentify_user` and then invokes the anonymize cascade (`execute_account_deletion_cascade` with mode `anonymize` per Doc 05E). This removes identity constructs while preserving anonymized learning activity for world-model training.

### Removed Identifiers
- Full Name (`first_name`, `last_name`, `display_name` rewritten to "De-identified User")
- Email Address (scrambled to deterministic `deleted_<user_id>@deleted.lyceon.ai`)
- Phone Number, DOB, and Address scrubbed (`NULL`)
- Student link and legacy guardian profile link removed (`student_link_code`, `guardian_profile_id` → `NULL`)

### Access Revocation
- Supabase auth identity is deleted (cascade `DELETE FROM auth.users`).
- Guardian links for the user are revoked (`guardian_links.status='revoked'`) without altering student entitlements.

### Anonymized Data (Retained, Identity-Decoupled per Doc 05E)
- Learning activity rows (practice answers, exam responses) are retained with identity links severed and a synthetic grouping identifier preserved for world-model training.
- Client/device/session fingerprints are removed at anonymization.
- The identity↔synthetic-identifier linkage is irreversibly destroyed.

### Deleted Data (Derived State — Recomputable)
- Mastery, KPI, projections, scheduling — derived state deleted (recomputable from retained activity if needed).
- Tutor interaction telemetry (ephemeral by design).
- Notifications and user notification preferences.
- Guardian consent requests involving the user.

### Preserved Links
- Internal Application IDs / Ledger Continuity preserved to not break aggregated learning telemetry where PII is not exposed.

### Minimal Retained Records (Scrubbed)
- `entitlements` retained for ledger continuity but Stripe identifiers removed and plan/status reset to free/inactive.
- `legal_acceptances` retained for compliance but `ip_address` and `user_agent` are nullified.
