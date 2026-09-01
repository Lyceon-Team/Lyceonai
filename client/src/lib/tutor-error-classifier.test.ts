/**
 * @spec [Doc-03B_V2 §11 (Client Error Handling)]
 * @implemented 2026-08-28
 *
 * plain English: Verifies every mapped tutor error code produces its exact
 * student-facing copy and action. Each test fails if its case is removed from
 * the classifier — the test for an error code is NOT a snapshot, it asserts
 * the specific title, message, and action that code maps to.
 *
 * trade-offs: tests are per-code, not per-group, so removing or renaming a
 * single case causes exactly one failure with clear diagnostics.
 */

import { describe, expect, it } from "vitest";
import { HttpApiError } from "@/lib/api-error";
import {
  classifyTutorError,
  type TutorErrorNotice,
} from "./tutor-error-classifier";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tutorError(
  status: number,
  code: string,
  opts?: { retryAfterMs?: number },
): HttpApiError {
  const details: Record<string, unknown> = {};
  if (opts?.retryAfterMs !== undefined) {
    details.retry_after_ms = opts.retryAfterMs;
  }
  return new HttpApiError({
    status,
    code,
    message: "Server error message (must never surface)",
    details: Object.keys(details).length > 0 ? details : undefined,
  });
}

function expectNotice(
  error: HttpApiError,
  expected: {
    title: string;
    message: string;
    action: TutorErrorNotice["action"];
    retryAfterMs?: number;
  },
): void {
  const notice = classifyTutorError(error);
  expect(notice).not.toBeNull();
  expect(notice!.title).toBe(expected.title);
  expect(notice!.message).toBe(expected.message);
  expect(notice!.action).toBe(expected.action);
  if (expected.retryAfterMs !== undefined) {
    expect(notice!.retryAfterMs).toBe(expected.retryAfterMs);
  }
}

// ---------------------------------------------------------------------------
// Tests — one per mapped error code
// ---------------------------------------------------------------------------

describe("classifyTutorError — 503: orchestration_failed_recoverable", () => {
  it("maps to retry_delayed with server-provided retry_after_ms", () => {
    expectNotice(
      tutorError(503, "orchestration_failed_recoverable", {
        retryAfterMs: 3000,
      }),
      {
        title: "LISA couldn't respond right now",
        message: "This is temporary. Tap retry to try again.",
        action: "retry_delayed",
        retryAfterMs: 3000,
      },
    );
  });

  it("defaults to 2000ms when retry_after_ms is absent", () => {
    const notice = classifyTutorError(
      tutorError(503, "orchestration_failed_recoverable"),
    );
    expect(notice).not.toBeNull();
    expect(notice!.retryAfterMs).toBe(2000);
  });
});

describe("classifyTutorError — 500: orchestration_failed", () => {
  it("maps to retry_send", () => {
    expectNotice(tutorError(500, "orchestration_failed"), {
      title: "Something went wrong",
      message: "LISA ran into a problem. Try again in a moment.",
      action: "retry_send",
    });
  });
});

describe("classifyTutorError — 500: canonical_write_failed", () => {
  it("maps to retry_send", () => {
    expectNotice(tutorError(500, "canonical_write_failed"), {
      title: "Couldn't save your message",
      message: "Something went wrong on our end. Try sending again.",
      action: "retry_send",
    });
  });
});

describe("classifyTutorError — 500: idempotency_lookup_failed", () => {
  it("maps to retry_send (same copy as canonical_write_failed)", () => {
    expectNotice(tutorError(500, "idempotency_lookup_failed"), {
      title: "Couldn't save your message",
      message: "Something went wrong on our end. Try sending again.",
      action: "retry_send",
    });
  });
});

describe("classifyTutorError — 403: tutor_unavailable_during_live_exam", () => {
  it("maps to informational", () => {
    expectNotice(tutorError(403, "tutor_unavailable_during_live_exam"), {
      title: "LISA is paused during your exam",
      message: "You can use LISA again after you finish your current exam.",
      action: "informational",
    });
  });
});

describe("classifyTutorError — 403: role_not_permitted", () => {
  it("maps to informational", () => {
    expectNotice(tutorError(403, "role_not_permitted"), {
      title: "LISA is for students",
      message: "Only student accounts can use the tutor.",
      action: "informational",
    });
  });
});

describe("classifyTutorError — 403: age_restricted", () => {
  it("maps to informational", () => {
    expectNotice(tutorError(403, "age_restricted"), {
      title: "Age restriction",
      message:
        "Your account doesn't meet the age requirement for this feature.",
      action: "informational",
    });
  });
});

describe("classifyTutorError — 403: region_not_supported", () => {
  it("maps to informational", () => {
    expectNotice(tutorError(403, "region_not_supported"), {
      title: "Not available in your region",
      message: "LISA isn't available in your region yet.",
      action: "informational",
    });
  });
});

describe("classifyTutorError — 403: account_under_review", () => {
  it("maps to informational", () => {
    expectNotice(tutorError(403, "account_under_review"), {
      title: "Account under review",
      message:
        "Your account is being reviewed. LISA access is paused until the review is complete.",
      action: "informational",
    });
  });
});

describe("classifyTutorError — 403: entitlement_required", () => {
  it("maps to upgrade", () => {
    expectNotice(tutorError(403, "entitlement_required"), {
      title: "Premium required",
      message: "Upgrade to a premium plan to use LISA.",
      action: "upgrade",
    });
  });
});

describe("classifyTutorError — 429: quota_exceeded", () => {
  it("maps to upgrade", () => {
    expectNotice(tutorError(429, "quota_exceeded"), {
      title: "Message limit reached",
      message: "You've used all your tutor messages for now. Upgrade for more.",
      action: "upgrade",
    });
  });
});

describe("classifyTutorError — 429: rate_limited", () => {
  it("maps to retry_send", () => {
    expectNotice(tutorError(429, "rate_limited"), {
      title: "Too many messages",
      message: "Wait a moment before sending another message.",
      action: "retry_send",
    });
  });
});

describe("classifyTutorError — 404: conversation_not_found", () => {
  it("maps to navigate_tutor", () => {
    expectNotice(tutorError(404, "conversation_not_found"), {
      title: "Conversation not found",
      message: "This conversation doesn't exist. Start a new one.",
      action: "navigate_tutor",
    });
  });
});

describe("classifyTutorError — 409: conversation_closed", () => {
  it("maps to navigate_tutor", () => {
    expectNotice(tutorError(409, "conversation_closed"), {
      title: "Conversation ended",
      message: "This conversation has been closed. Start a new one.",
      action: "navigate_tutor",
    });
  });
});

describe("classifyTutorError — 409: conversation_already_closed", () => {
  it("maps to navigate_tutor (same copy as conversation_closed)", () => {
    expectNotice(tutorError(409, "conversation_already_closed"), {
      title: "Conversation ended",
      message: "This conversation has been closed. Start a new one.",
      action: "navigate_tutor",
    });
  });
});

describe("classifyTutorError — 409: idempotency_conflict", () => {
  it("maps to reload", () => {
    expectNotice(tutorError(409, "idempotency_conflict"), {
      title: "Duplicate message detected",
      message: "Your message was already sent. Try refreshing the page.",
      action: "reload",
    });
  });
});

describe("classifyTutorError — 400: invalid_input", () => {
  it("maps to retry_send", () => {
    expectNotice(tutorError(400, "invalid_input"), {
      title: "Couldn't send that message",
      message: "Something about your message didn't work. Try rephrasing it.",
      action: "retry_send",
    });
  });
});

describe("classifyTutorError — 401: unauthenticated", () => {
  it("maps to reload", () => {
    expectNotice(tutorError(401, "unauthenticated"), {
      title: "You've been signed out",
      message: "Sign in again to keep using LISA.",
      action: "reload",
    });
  });
});

describe("classifyTutorError — 401: token_expired", () => {
  it("maps to reload (same copy as unauthenticated)", () => {
    expectNotice(tutorError(401, "token_expired"), {
      title: "You've been signed out",
      message: "Sign in again to keep using LISA.",
      action: "reload",
    });
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("classifyTutorError — edge cases", () => {
  it("returns null for an unrecognized error code", () => {
    const notice = classifyTutorError(tutorError(500, "some_unknown_code"));
    expect(notice).toBeNull();
  });

  it("returns null for a non-error value", () => {
    expect(classifyTutorError(null)).toBeNull();
    expect(classifyTutorError(undefined)).toBeNull();
  });

  it("returns null for a plain Error (no code)", () => {
    expect(classifyTutorError(new Error("network failure"))).toBeNull();
  });

  it("is case-insensitive on the error code", () => {
    const upper = classifyTutorError(tutorError(429, "RATE_LIMITED"));
    const lower = classifyTutorError(tutorError(429, "rate_limited"));
    expect(upper).not.toBeNull();
    expect(lower).not.toBeNull();
    expect(upper!.title).toBe(lower!.title);
  });

  it("never surfaces a raw server message", () => {
    const err = tutorError(500, "orchestration_failed");
    const notice = classifyTutorError(err);
    expect(notice).not.toBeNull();
    expect(notice!.title).not.toContain("Server error message");
    expect(notice!.message).not.toContain("Server error message");
  });
});
