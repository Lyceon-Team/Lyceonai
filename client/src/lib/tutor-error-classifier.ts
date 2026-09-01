/**
 * @spec [Doc-03B_V2 §11 (Client Error Handling)]
 * @implemented 2026-08-28
 *
 * plain English: Maps tutor-specific error codes to student-facing recovery
 * notices. Replaces the two-bin (premium / generic) classifier with a
 * code-dispatched handler so each error state gets an appropriate message
 * and action. All copy is grade 9-10 reading level per Doc 03D §2.3.
 *
 * expected outcome: every tutor error code renders a specific, actionable
 * notice instead of a misleading "refresh your session" or "try again."
 *
 * trade-offs: codes not yet enforced by the backend (region_not_supported,
 * account_under_review, quota_exceeded) are pre-wired so they work the
 * moment the backend ships them — preventing the exact bug this fixes.
 *
 * edge cases: unknown codes fall through to the generic recovery notice.
 * The classifier never surfaces raw server error messages.
 */

import { isApiError, type ApiError } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// Notice types — what the chat page renders for each error class
// ---------------------------------------------------------------------------

export type TutorErrorAction =
  | "retry_send" // Reset mutation, let student resend
  | "retry_delayed" // Reset mutation after retry_after_ms, auto-resend
  | "navigate_tutor" // Redirect to /tutor (conversation invalid)
  | "upgrade" // Show premium upgrade CTA
  | "reload" // Refresh the page (session issues)
  | "informational"; // Show message, no action (denial states)

export type TutorErrorNotice = {
  title: string;
  message: string;
  action: TutorErrorAction;
  retryAfterMs?: number;
};

// ---------------------------------------------------------------------------
// Code → notice mapping
//
// Copy is student-facing, grade 9-10 reading level (Doc 03D §2.3).
// No raw server messages are surfaced — every code gets curated copy.
// ---------------------------------------------------------------------------

function extractRetryAfterMs(error: unknown): number | undefined {
  if (!isApiError(error)) return undefined;
  const details = error.details as Record<string, unknown> | null | undefined;
  if (!details || typeof details !== "object") return undefined;

  // Tutor errors nest details under { error: { details: { retry_after_ms } } }
  // or directly under { details: { retry_after_ms } }
  const nested = details.error as Record<string, unknown> | undefined;
  const detailsObj = (nested?.details ?? details) as Record<string, unknown>;
  const ms = detailsObj?.retry_after_ms;
  return typeof ms === "number" && ms > 0 ? ms : undefined;
}

function extractErrorCode(error: unknown): string | null {
  if (!isApiError(error)) return null;

  // Tutor errors: { error: { code: "..." } }
  const code = (error as ApiError).code;
  if (code && typeof code === "string") return code.toLowerCase();

  return null;
}

export function classifyTutorError(error: unknown): TutorErrorNotice | null {
  if (!error) return null;

  const code = extractErrorCode(error);
  const retryAfterMs = extractRetryAfterMs(error);

  switch (code) {
    // ── 503: Recoverable orchestration failure ──────────────────────────
    case "orchestration_failed_recoverable":
      return {
        title: "LISA couldn't respond right now",
        message: "This is temporary. Tap retry to try again.",
        action: "retry_delayed",
        retryAfterMs: retryAfterMs ?? 2000,
      };

    // ── 500: Permanent orchestration failure ────────────────────────────
    case "orchestration_failed":
      return {
        title: "Something went wrong",
        message: "LISA ran into a problem. Try again in a moment.",
        action: "retry_send",
      };

    // ── 500: DB write failures ──────────────────────────────────────────
    case "canonical_write_failed":
    case "idempotency_lookup_failed":
      return {
        title: "Couldn't save your message",
        message: "Something went wrong on our end. Try sending again.",
        action: "retry_send",
      };

    // ── 403: Live exam block ────────────────────────────────────────────
    case "tutor_unavailable_during_live_exam":
      return {
        title: "LISA is paused during your exam",
        message: "You can use LISA again after you finish your current exam.",
        action: "informational",
      };

    // ── 403: Role/age denials ───────────────────────────────────────────
    case "role_not_permitted":
      return {
        title: "LISA is for students",
        message: "Only student accounts can use the tutor.",
        action: "informational",
      };

    case "age_restricted":
      return {
        title: "Age restriction",
        message:
          "Your account doesn't meet the age requirement for this feature.",
        action: "informational",
      };

    // ── 403: Region/review denials ──────────────────────────────────────
    case "region_not_supported":
      return {
        title: "Not available in your region",
        message: "LISA isn't available in your region yet.",
        action: "informational",
      };

    case "account_under_review":
      return {
        title: "Account under review",
        message:
          "Your account is being reviewed. LISA access is paused until the review is complete.",
        action: "informational",
      };

    // ── 403: Entitlement required ───────────────────────────────────────
    // Handled by the premium-code path in api-error.ts (ENTITLEMENT_REQUIRED
    // is now in the premium-code set). This case exists as defense-in-depth
    // in case the server returns the lowercase code instead of the uppercase
    // code that api-error.ts normalizes.
    case "entitlement_required":
      return {
        title: "Premium required",
        message: "Upgrade to a premium plan to use LISA.",
        action: "upgrade",
      };

    // ── 429: Quota exceeded (Doc 03 §13 — backend not yet built) ───────
    case "quota_exceeded":
      return {
        title: "Message limit reached",
        message:
          "You've used all your tutor messages for now. Upgrade for more.",
        action: "upgrade",
      };

    // ── 429: Rate limited ───────────────────────────────────────────────
    case "rate_limited":
      return {
        title: "Too many messages",
        message: "Wait a moment before sending another message.",
        action: "retry_send",
      };

    // ── 404: Conversation not found ─────────────────────────────────────
    case "conversation_not_found":
      return {
        title: "Conversation not found",
        message: "This conversation doesn't exist. Start a new one.",
        action: "navigate_tutor",
      };

    // ── 409: Conversation closed ────────────────────────────────────────
    case "conversation_closed":
    case "conversation_already_closed":
      return {
        title: "Conversation ended",
        message: "This conversation has been closed. Start a new one.",
        action: "navigate_tutor",
      };

    // ── 409: Idempotency conflict ───────────────────────────────────────
    case "idempotency_conflict":
      return {
        title: "Duplicate message detected",
        message: "Your message was already sent. Try refreshing the page.",
        action: "reload",
      };

    // ── 400: Invalid input ──────────────────────────────────────────────
    case "invalid_input":
      return {
        title: "Couldn't send that message",
        message: "Something about your message didn't work. Try rephrasing it.",
        action: "retry_send",
      };

    // ── 401: Auth issues ────────────────────────────────────────────────
    case "unauthenticated":
    case "token_expired":
      return {
        title: "You've been signed out",
        message: "Sign in again to keep using LISA.",
        action: "reload",
      };

    // ── Unrecognized code or no code at all ─────────────────────────────
    default:
      return null;
  }
}
