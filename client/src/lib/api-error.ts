import { roleChoiceErrorCodeSchema } from "@lyceon/shared/profile-role-choice-schema";
import {
  GUARDIAN_LINK_REQUIRED,
  PROFILE_INCOMPLETE,
} from "@lyceon/shared/guardian-link-gate";
export type ApiError = {
  status: number;
  code?: string;
  message: string;
  reason?: string;
  retryable?: boolean;
  details?: unknown;
};

export type PremiumDenialReason =
  | "premium_required"
  | "payment_required"
  | "payment_past_due"
  | "subscription_canceled"
  | "subscription_expired";

export class HttpApiError extends Error implements ApiError {
  status: number;
  code?: string;
  reason?: string;
  retryable?: boolean;
  details?: unknown;

  constructor(input: ApiError) {
    super(input.message);
    this.name = "HttpApiError";
    this.status = input.status;
    this.code = input.code;
    this.reason = input.reason;
    this.retryable = input.retryable;
    this.details = input.details;
  }
}

function readNestedErrorPayload(payload: any): Partial<ApiError> {
  if (!payload || typeof payload !== "object") return {};
  const nested = payload.error;
  if (!nested || typeof nested !== "object") return {};

  return {
    code: typeof nested.code === "string" ? nested.code : undefined,
    message: typeof nested.message === "string" ? nested.message : undefined,
    retryable:
      typeof nested.retryable === "boolean" ? nested.retryable : undefined,
  };
}

export async function parseApiErrorFromResponse(
  response: Response,
  fallbackMessage = "Request failed",
): Promise<HttpApiError> {
  let payload: any = null;
  try {
    payload = await response.clone().json();
  } catch {
    payload = null;
  }

  const nested = readNestedErrorPayload(payload);
  const message =
    nested.message ||
    (payload && typeof payload.message === "string"
      ? payload.message
      : undefined) ||
    (payload && typeof payload.error === "string"
      ? payload.error
      : undefined) ||
    fallbackMessage;

  const code =
    nested.code ||
    (payload && typeof payload.code === "string" ? payload.code : undefined) ||
    undefined;

  const reason =
    payload && typeof payload.reason === "string"
      ? payload.reason
      : payload &&
          payload.entitlement &&
          typeof payload.entitlement.reason === "string"
        ? payload.entitlement.reason
        : undefined;

  const retryable =
    typeof nested.retryable === "boolean"
      ? nested.retryable
      : payload && typeof payload.retryable === "boolean"
        ? payload.retryable
        : response.status >= 500;

  return new HttpApiError({
    status: response.status,
    code,
    message,
    reason,
    retryable,
    details: payload,
  });
}

export function isApiError(error: unknown): error is ApiError {
  return Boolean(
    error &&
    typeof error === "object" &&
    "status" in (error as any) &&
    typeof (error as any).status === "number" &&
    "message" in (error as any) &&
    typeof (error as any).message === "string",
  );
}

/**
 * G3-04 (R7, audit G-AUD-06/19): a guardian's per-student read answered 404. The subject
 * resolver answers 404 for "no such student" and "not linked to you" alike, by design (Doc
 * 05B §10.3 — a 403 would confirm the student exists), so the status is the whole signal:
 * for a student the guardian picked from their own roster, it means the link is gone.
 */
export function isStudentNoLongerLinkedError(error: unknown): boolean {
  return isApiError(error) && error.status === 404;
}

function normalizeCode(value: string | undefined): string | undefined {
  return value ? value.trim().toUpperCase() : undefined;
}

function normalizeReason(value: string | undefined): string | undefined {
  return value ? value.trim().toLowerCase() : undefined;
}

/**
 * @spec [Guardian_Closure_Plan G2-06 (G-NEW-09)] | @implemented [2026-09-29]
 *
 * plain English: where a refused request should send the student, or null. A 403
 * `GUARDIAN_LINK_REQUIRED` (G-NEW-10) means an under-13 student has no active guardian link,
 * so they belong on /guardian-required. A 403
 * `PROFILE_INCOMPLETE` means the server will not serve learning until the profile — and so the
 * age — is known, so the student belongs on profile completion. Pure: the query client's caches
 * call it for every failed query and mutation (`redirectForOnboarding` in ./queryClient).
 */
export function onboardingRedirectFor(error: unknown): string | null {
  if (!isApiError(error)) return null;
  if (
    error.status === 403 &&
    normalizeCode(error.code) === PROFILE_INCOMPLETE
  ) {
    return "/profile/complete";
  }
  // G-NEW-10: the under-13 link gate (G2-04) refuses every learning request with this code
  // once the student has no active guardian link — including mid-session, after a revoke.
  if (
    error.status === 403 &&
    normalizeCode(error.code) === GUARDIAN_LINK_REQUIRED
  ) {
    return "/guardian-required";
  }
  return null;
}

const entitlementCodes = new Set([
  "PREMIUM_REQUIRED",
  "PAYMENT_REQUIRED",
  "SUBSCRIPTION_REQUIRED",
  "ENTITLEMENT_REQUIRED",
]);

export function getPremiumDenialReason(
  error: unknown,
): PremiumDenialReason | null {
  if (!isApiError(error)) return null;
  if (error.status !== 402 && error.status !== 403) return null;

  const code = normalizeCode(error.code);
  const reason = normalizeReason(error.reason);

  if (reason === "payment_past_due") return "payment_past_due";
  if (reason === "subscription_canceled") return "subscription_canceled";
  if (reason === "subscription_expired") return "subscription_expired";

  if (code === "PAYMENT_REQUIRED") return "payment_required";
  if (code === "PREMIUM_REQUIRED" || code === "SUBSCRIPTION_REQUIRED")
    return "premium_required";
  if (entitlementCodes.has(code || "")) return "premium_required";

  return null;
}

export function isEntitlementDenialError(error: unknown): boolean {
  return getPremiumDenialReason(error) !== null;
}

/**
 * Tutor-specific premium denial mapper. The tutor surface runs through
 * mutations (send-message) and queries (load-conversation) whose errors
 * carry the same entitlement codes as other premium surfaces. This named
 * mapper keeps the chat page's premium wiring explicit and auditable
 * per the premium-cta-wiring contract test.
 */
export function mapTutorErrorToPremiumReason(
  error: unknown,
): PremiumDenialReason | null {
  return getPremiumDenialReason(error);
}

export function isCsrfError(error: unknown): boolean {
  if (!isApiError(error)) return false;
  const code = normalizeCode(error.code);
  const reason = normalizeReason(error.reason);
  const message = error.message.trim().toLowerCase();
  return (
    code === "CSRF_BLOCKED" ||
    reason === "csrf_blocked" ||
    message.includes("csrf")
  );
}

export function isSessionError(error: unknown): boolean {
  if (!isApiError(error)) return false;
  if (isEntitlementDenialError(error)) return false;
  if (isCsrfError(error)) return true;
  return error.status === 401 || error.status === 403;
}

export function isTransportError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof SyntaxError) return true;
  if (isApiError(error)) {
    return error.status >= 500 || error.status === 0;
  }
  return false;
}

export type UserFacingErrorMessage = {
  title: string;
  message: string;
  action: "upgrade" | "billing" | "retry" | "refresh_session";
};

export function toUserFacingMessage(error: unknown): UserFacingErrorMessage {
  const premiumReason = getPremiumDenialReason(error);
  if (
    premiumReason === "payment_required" ||
    premiumReason === "payment_past_due"
  ) {
    return {
      title: "Payment update required",
      message: "Please update your billing details to continue.",
      action: "billing",
    };
  }

  if (premiumReason) {
    return {
      title: "Premium required",
      message: "Upgrade to an active premium plan to continue.",
      action: "upgrade",
    };
  }

  if (isSessionError(error)) {
    return {
      title: "Session refresh required",
      message: "Your session needs to be refreshed before continuing.",
      action: "refresh_session",
    };
  }

  return {
    title: "Unable to load right now",
    message: "Please try again. If this keeps happening, refresh the page.",
    action: "retry",
  };
}

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-2, AS-3 / §0] | @implemented 2026-06-20
 * plain English: the display chokepoint for the profile-completion (onboarding) surface — the
 * COPPA/DOB gate (AS-2 required-gate; AS-3 / §0 never-raw error UX). `PATCH /api/profile` returns `{ error: "<string>" }` with NO code, so
 * `HttpApiError.message` carries a raw server string; this mapper NEVER renders it. It maps the
 * server's own deterministic 400/403 validation conditions (matched by safe substring) to curated,
 * actionable copy, and falls back to a generic recoverable message (keyed by load/save) for every
 * 5xx, unmatched, leaky, plain-`Error` (e.g. the load query's "Failed to load profile (500)"), or
 * non-Error value. Anti-leak by construction: `error.message` is never returned.
 * Deliberately NOT routed through `resolveAuthErrorMessage` — that copy is sign-in-flavored, wrong
 * for onboarding. One curated, never-raw chokepoint per copy-domain.
 */
export function resolveOnboardingErrorMessage(
  error: unknown,
  kind: "load" | "save" = "save",
): string {
  const generic =
    kind === "load"
      ? "We couldn't load your profile just now. Please try again."
      : "We couldn't save your profile just now. Please try again.";

  if (!isApiError(error)) return generic;
  if (error.status !== 400 && error.status !== 403) return generic;

  // G1-02: a refusal the server CODED carries copy the server wrote for this person
  // (packages/shared profile-role-choice-schema). Show it as sent. This is AS-3-safe: the
  // code is from a closed list, so an uncurated string can never arrive this way.
  if (roleChoiceErrorCodeSchema.safeParse(error.code).success) {
    return error.message;
  }

  const message = error.message.toLowerCase();
  if (message.includes("date of birth")) {
    return "Please enter your date of birth to continue.";
  }
  if (message.includes("guardian email")) {
    return "A guardian email is required for students under 13.";
  }
  if (message.includes("invalid profile")) {
    return "Some details look incomplete — please review the form and try again.";
  }
  if (message.includes("role change") || message.includes("support-mediated")) {
    return "Role changes are handled by support. Please contact support to update your role.";
  }
  // Admin-onboarding-not-supported, or any other unmatched 400/403, falls through to generic —
  // a raw or leaky server string is never surfaced.
  return generic;
}
