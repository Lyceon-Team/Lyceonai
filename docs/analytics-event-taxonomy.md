# Analytics Event Taxonomy

**Last Updated:** 2026-02-02 (Sprint 2 PR-4)

## Overview

This document defines the event taxonomy for analytics tracking in the SAT Learning Copilot application. Currently, only Microsoft Clarity is integrated for session recording and heatmaps.

## Microsoft Clarity Integration

**Status:** ACTIVE (production-only, consent-gated)

**Implementation:**
- File: `client/src/main.tsx`
- Initialization: Conditional on production environment and user consent
- Project ID: Configured via `VITE_CLARITY_PROJECT_ID` environment variable
- Consent mechanism: User opt-in via `lyceon_analytics_consent` localStorage flag

**Privacy Safeguards:**
- Only runs in production builds (`import.meta.env.MODE === "production"`)
- Requires explicit user consent before initialization
- Session recording can be disabled by user
- No PII is explicitly sent to Clarity (relies on Clarity's built-in PII masking)

## Future Event Taxonomy

When custom event tracking is added, events should follow this structure:

### Core Events (Skeleton - Not Yet Implemented)

**Authentication Events**
- `auth_signup_started`
- `auth_signup_completed`
- `auth_signin_completed`
- `auth_signout`

**Profile Events**
- `profile_completion_started`
- `profile_completion_completed`
- `profile_updated`

**Practice Events**
- `practice_session_started`
- `practice_question_answered`
- `practice_session_completed`

**Learning Events**
- `mastery_page_viewed`
- `weakness_identified`
- `tutor_chat_started`
- `tutor_message_sent`

**Billing Events**
- `checkout_initiated`
- `subscription_activated`
- `subscription_cancelled`

## Event Properties (Future)

When implementing custom events, include these standard properties:

```typescript
interface BaseEventProperties {
  userId?: string;        // Omit if not authenticated
  sessionId: string;      // Generated session identifier
  timestamp: string;      // ISO 8601 timestamp
  environment: 'development' | 'production';
  userRole?: 'student' | 'guardian' | 'admin';
  entitlementStatus?: 'free' | 'entitled';
}
```

## Implementation Notes

1. **No SDK changes beyond Clarity**: This taxonomy is for planning purposes. No additional analytics SDKs (e.g., Segment, Amplitude, Mixpanel) should be added without explicit approval.

2. **Event naming convention**: Use lowercase with underscores (snake_case)

3. **PII handling**: Never include email, phone numbers, or other PII in event properties

4. **Consent enforcement**: All analytics tracking must respect user consent preferences

## References

- Microsoft Clarity Documentation: https://learn.microsoft.com/en-us/clarity/
- Integration Code: `client/src/main.tsx:41-69`
