# Retention and Deletion Architecture

## Deletion Request Lifecycle

Account deletion requests enter a 24-hour grace window via `POST /api/account/delete`. 

- **Pending**: Request registered, awaiting 24 hours. User may cancel explicitly.
- **Cancelled**: Explicit cancellation request invoked via `POST /api/account/cancel-deletion`.
- **Completed**: Execution run past grace window.

## De-identification Standards

Upon expiry of the grace window, the system strictly de-identifies the user via stored procedure `deidentify_user` rather than performing hard deletions. This achieves compliance removing identity constructs while preserving internal ID linkages.

### Removed Identifiers
- Full Name (`first_name`, `last_name`, `display_name` rewritten to "De-identified User")
- Email Address (scrambled to non-routable dummy format)
- Phone Number, DOB, and Address scrubbed (`NULL`)
- Stripe Metadata (`stripe_customer_id` dropped from `entitlements`)

### Preserved Links
- Internal Application IDs / Ledger Continuity preserved to not break aggregated learning telemetry where PII is not exposed.
