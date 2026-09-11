/**
 * @spec [Doc-03B_V2 §5.9, §6.9] | @implemented 2026-08-09
 * plain English: Canonical tutor error codes with HTTP status mappings and a
 * single sendTutorError helper for consistent error responses across all
 * tutor-related route handlers.
 *
 * expected outcome: every tutor endpoint returns errors through sendTutorError,
 * producing the standard { error: { message, code, details? } } shape. No
 * ad-hoc error formatting in route handlers.
 *
 * trade-offs: error codes are string literals (not an enum) so they serialize
 * cleanly and match the spec's wire format. The TutorResult type is provided
 * for domain functions that produce expected failures without throwing.
 *
 * edge cases: orchestration_failed_recoverable includes retry_after_ms in
 * details so the client can implement backoff.
 */

import { Response } from "express";

// ── Error code definition ───────────────────────────────────────────

type TutorErrorCode = {
  readonly httpStatus: number;
  readonly code: string;
  readonly message: string;
};

// ── Error codes per Doc-03B §5.9, §6.9 ─────────────────────────────

/** @spec [Doc-03B_V2 §5.9] */
export const TUTOR_UNAUTHENTICATED: TutorErrorCode = {
  httpStatus: 401,
  code: "unauthenticated",
  message: "Authentication required.",
} as const;

/** @spec [Doc-03B_V2 §5.9] */
export const TUTOR_TOKEN_EXPIRED: TutorErrorCode = {
  httpStatus: 401,
  code: "token_expired",
  message: "Authentication token has expired.",
} as const;

/** @spec [Doc-03B_V2 §5.9] */
export const TUTOR_ROLE_NOT_PERMITTED: TutorErrorCode = {
  httpStatus: 403,
  code: "role_not_permitted",
  message: "Your role does not permit access to the tutor.",
} as const;

/** @spec [Doc-03B_V2 §5.9] */
export const TUTOR_ENTITLEMENT_REQUIRED: TutorErrorCode = {
  httpStatus: 403,
  code: "entitlement_required",
  message: "An active entitlement is required to use the tutor.",
} as const;

/** @spec [Doc-03B_V2 §5.9] */
export const TUTOR_AGE_RESTRICTED: TutorErrorCode = {
  httpStatus: 403,
  code: "age_restricted",
  message: "Age restriction prevents access to this feature.",
} as const;

/** @spec [Doc-03B_V2 §5.9] */
export const TUTOR_REGION_NOT_SUPPORTED: TutorErrorCode = {
  httpStatus: 403,
  code: "region_not_supported",
  message: "The tutor is not available in your region.",
} as const;

/** @spec [Doc-03B_V2 §5.9] */
export const TUTOR_UNAVAILABLE_DURING_LIVE_EXAM: TutorErrorCode = {
  httpStatus: 403,
  code: "tutor_unavailable_during_live_exam",
  message: "The tutor is unavailable while a live exam is in progress.",
} as const;

/** @spec [Doc-03B_V2 §5.9] */
export const TUTOR_ACCOUNT_UNDER_REVIEW: TutorErrorCode = {
  httpStatus: 403,
  code: "account_under_review",
  message:
    "Your account is under review. Tutor access is temporarily suspended.",
} as const;

/** @spec [Doc-03B_V2 §5.9] */
export const TUTOR_INVALID_INPUT: TutorErrorCode = {
  httpStatus: 400,
  code: "invalid_input",
  message: "The request input is invalid.",
} as const;

/** @spec [Doc-03B_V2 §5.9] */
export const TUTOR_PII_IN_ENVELOPE: TutorErrorCode = {
  httpStatus: 400,
  code: "pii_in_envelope",
  message: "The request envelope contains personally identifiable information.",
} as const;

/** @spec [Doc-03B_V2 §6.9] */
export const TUTOR_RATE_LIMITED: TutorErrorCode = {
  httpStatus: 429,
  code: "rate_limited",
  message: "Too many requests. Please wait before trying again.",
} as const;

/** @spec [Doc-03B_V2 §6.9] */
export const TUTOR_QUOTA_EXCEEDED: TutorErrorCode = {
  httpStatus: 429,
  code: "quota_exceeded",
  message: "Your tutor usage quota has been exceeded.",
} as const;

/** @spec [Doc-03B_V2 §5.9] */
export const TUTOR_CONVERSATION_NOT_FOUND: TutorErrorCode = {
  httpStatus: 404,
  code: "conversation_not_found",
  message: "The requested conversation was not found.",
} as const;

/** @spec [Doc-03B_V2 §5.9] */
export const TUTOR_CONVERSATION_CLOSED: TutorErrorCode = {
  httpStatus: 409,
  code: "conversation_closed",
  message: "This conversation has been closed.",
} as const;

/** @spec [Doc-03B_V2 §5.9] */
export const TUTOR_CONVERSATION_ALREADY_CLOSED: TutorErrorCode = {
  httpStatus: 409,
  code: "conversation_already_closed",
  message: "This conversation was already closed.",
} as const;

/** @spec [Doc-03B_V2 §5.9] */
export const TUTOR_IDEMPOTENCY_CONFLICT: TutorErrorCode = {
  httpStatus: 409,
  code: "idempotency_conflict",
  message:
    "A conflicting request with the same idempotency key was already processed.",
} as const;

/** @spec [Doc-03B_V2 §6.9, AUDIT-007] */
export const TUTOR_IDEMPOTENCY_LOOKUP_FAILED: TutorErrorCode = {
  httpStatus: 500,
  code: "idempotency_lookup_failed",
  message: "Could not verify request uniqueness. Please retry.",
} as const;

/** @spec [Doc-03B_V2 §6.9] */
export const TUTOR_CANONICAL_WRITE_FAILED: TutorErrorCode = {
  httpStatus: 500,
  code: "canonical_write_failed",
  message: "Failed to persist canonical data. Please retry.",
} as const;

/** @spec [Doc-03B_V2 §6.9] */
export const TUTOR_ORCHESTRATION_AUTH_FAILED: TutorErrorCode = {
  httpStatus: 503,
  code: "orchestration_auth_failed",
  message:
    "Failed to authenticate to the tutor orchestrator. Please try again.",
} as const;

/** @spec [Doc-03B_V2 §6.9] */
export const TUTOR_ORCHESTRATION_FAILED: TutorErrorCode = {
  httpStatus: 500,
  code: "orchestration_failed",
  message: "The tutor orchestration failed unexpectedly.",
} as const;

/** @spec [Doc-03B_V2 §6.9] */
export const TUTOR_ORCHESTRATION_FAILED_RECOVERABLE: TutorErrorCode = {
  httpStatus: 503,
  code: "orchestration_failed_recoverable",
  message: "The tutor orchestration failed but may succeed on retry.",
} as const;

/** @spec [Doc-03B_V2 §6.9] */
export const TUTOR_ENTITLEMENT_CHECK_UNAVAILABLE: TutorErrorCode = {
  httpStatus: 503,
  code: "entitlement_check_unavailable",
  message: "The entitlement service is temporarily unavailable.",
} as const;

// ── All codes as a lookup map ───────────────────────────────────────

export const TUTOR_ERROR_CODES = {
  unauthenticated: TUTOR_UNAUTHENTICATED,
  token_expired: TUTOR_TOKEN_EXPIRED,
  role_not_permitted: TUTOR_ROLE_NOT_PERMITTED,
  entitlement_required: TUTOR_ENTITLEMENT_REQUIRED,
  age_restricted: TUTOR_AGE_RESTRICTED,
  region_not_supported: TUTOR_REGION_NOT_SUPPORTED,
  tutor_unavailable_during_live_exam: TUTOR_UNAVAILABLE_DURING_LIVE_EXAM,
  account_under_review: TUTOR_ACCOUNT_UNDER_REVIEW,
  invalid_input: TUTOR_INVALID_INPUT,
  pii_in_envelope: TUTOR_PII_IN_ENVELOPE,
  rate_limited: TUTOR_RATE_LIMITED,
  quota_exceeded: TUTOR_QUOTA_EXCEEDED,
  conversation_not_found: TUTOR_CONVERSATION_NOT_FOUND,
  conversation_closed: TUTOR_CONVERSATION_CLOSED,
  conversation_already_closed: TUTOR_CONVERSATION_ALREADY_CLOSED,
  idempotency_conflict: TUTOR_IDEMPOTENCY_CONFLICT,
  idempotency_lookup_failed: TUTOR_IDEMPOTENCY_LOOKUP_FAILED,
  canonical_write_failed: TUTOR_CANONICAL_WRITE_FAILED,
  orchestration_auth_failed: TUTOR_ORCHESTRATION_AUTH_FAILED,
  orchestration_failed: TUTOR_ORCHESTRATION_FAILED,
  orchestration_failed_recoverable: TUTOR_ORCHESTRATION_FAILED_RECOVERABLE,
  entitlement_check_unavailable: TUTOR_ENTITLEMENT_CHECK_UNAVAILABLE,
} as const;

export type TutorErrorCodeKey = keyof typeof TUTOR_ERROR_CODES;

// ── Error response shape ────────────────────────────────────────────

type TutorErrorResponse = {
  error: {
    message: string;
    code: string;
    details?: unknown;
  };
};

// ── Result type for domain functions ────────────────────────────────

/**
 * Result type for tutor domain functions that produce expected failures.
 * Reserve `throw` for unrecoverable/programming errors only.
 * @spec [Coding Standards §3.6, §13]
 */
export type TutorResult<T, E = TutorErrorCodeKey> =
  | { ok: true; value: T }
  | { ok: false; errorCode: E; details?: unknown };

// ── Send helper ─────────────────────────────────────────────────────

/**
 * Sends a standardised tutor error response.
 *
 * For `orchestration_failed_recoverable`, pass `details: { retry_after_ms }`
 * so the client can implement backoff.
 *
 * @spec [Doc-03B_V2 §5.9, §6.9]
 */
export function sendTutorError(
  res: Response,
  errorCode: TutorErrorCodeKey,
  details?: unknown,
): Response {
  const entry = TUTOR_ERROR_CODES[errorCode];
  const body: TutorErrorResponse = {
    error: {
      message: entry.message,
      code: entry.code,
      ...(details !== undefined ? { details } : {}),
    },
  };
  return res.status(entry.httpStatus).json(body);
}

/**
 * Convenience: converts a failed TutorResult into an HTTP error response.
 * Returns true if the result was an error (response was sent), false if ok.
 *
 * Usage:
 *   const result = someDomainFn();
 *   if (sendTutorResultError(res, result)) return;
 *   // result.value is available here
 *
 * @spec [Doc-03B_V2 §5.9, §6.9]
 */
export function sendTutorResultError<T>(
  res: Response,
  result: TutorResult<T>,
): result is { ok: false; errorCode: TutorErrorCodeKey; details?: unknown } {
  if (!result.ok) {
    sendTutorError(res, result.errorCode, result.details);
    return true;
  }
  return false;
}
