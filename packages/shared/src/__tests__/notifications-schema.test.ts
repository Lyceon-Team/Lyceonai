/**
 * @spec [contracts/notifications.contract.md §3, §7.4, §9.4] | @implemented [2026-09-03]
 * plain English: the shared shapes reject what the routes must never accept.
 */
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_EVENT_TYPES,
  fullLengthNoticePayloadSchema,
  postExamNoticePayloadSchema,
  guardianLinkedPayloadSchema,
  isResendStatusEvent,
  notificationFeedQuerySchema,
  notificationPatchBodySchema,
  resendWebhookEventSchema,
} from "../notifications-schema";

describe("notifications schema", () => {
  // WAS "names exactly the two event types", then four. Rewritten each time, never loosened: this
  // list is the mirror of `notification_events_type_check`, and the value of the assertion is that
  // a type cannot appear in one without somebody naming it in the other. The two practice-test
  // notices joined on 2026-09-27 (Brief 14 Step 5, 20261012000000); the two post-exam notices on
  // 2026-09-30 (SCL-191, 20261015000000).
  it("names exactly the six event types, in the CHECK's own order", () => {
    expect([...NOTIFICATION_EVENT_TYPES]).toEqual([
      "guardian_linked",
      "guardian_unlinked",
      "full_length_week",
      "full_length_tomorrow",
      "exam_score_report_requested",
      "renewal_decision_requested",
    ]);
  });

  // SCL-191 C8.1. The post-exam payload carries the anchor and the occasion and NOTHING else —
  // no score, no amount, no price. `.strict()` is what refuses each of them, and this asserts the
  // refusal rather than trusting the modifier.
  it("the post-exam payload is anchor + occasion_key and nothing else (C8.1)", () => {
    expect(
      postExamNoticePayloadSchema.safeParse({
        anchor: "exam_date",
        occasion_key: "2026-09-12",
      }).success,
    ).toBe(true);
    expect(
      postExamNoticePayloadSchema.safeParse({
        anchor: "billing_cycle",
        occasion_key: "2026-10-14",
      }).success,
    ).toBe(true);
    // An anchor the CHECK does not enumerate.
    expect(
      postExamNoticePayloadSchema.safeParse({
        anchor: "whenever",
        occasion_key: "2026-09-12",
      }).success,
    ).toBe(false);
    // A score in a persisted, recipient-readable row.
    expect(
      postExamNoticePayloadSchema.safeParse({
        anchor: "exam_date",
        occasion_key: "2026-09-12",
        total_score: 1290,
      }).success,
    ).toBe(false);
    // An amount, which is Stripe's lane and not this one (contract §0).
    expect(
      postExamNoticePayloadSchema.safeParse({
        anchor: "billing_cycle",
        occasion_key: "2026-10-14",
        amount_due: 2999,
      }).success,
    ).toBe(false);
  });

  it("the practice-test payload is block_id + local_date and nothing else (C8.1)", () => {
    const ok = {
      block_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      local_date: "2026-10-17",
    };
    expect(fullLengthNoticePayloadSchema.safeParse(ok).success).toBe(true);
    // `form_id` names a specific exam paper. It is the key a well-meaning "the email could say
    // which test" edit would add, and `.strict()` is what refuses it.
    expect(
      fullLengthNoticePayloadSchema.safeParse({
        ...ok,
        form_id: "7c9e6679-7425-40de-944b-e07fc1f90ae8",
      }).success,
    ).toBe(false);
    // The date is a LOCAL date, not a timestamp: a template that re-parsed an instant against
    // the server's zone would render the day before for half the world.
    expect(
      fullLengthNoticePayloadSchema.safeParse({
        ...ok,
        local_date: "2026-10-17T00:00:00Z",
      }).success,
    ).toBe(false);
  });

  it("guardian_linked payload is link_id + student_display_name and nothing else (C8.1)", () => {
    expect(
      guardianLinkedPayloadSchema.safeParse({
        link_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        student_display_name: "Sam",
      }).success,
    ).toBe(true);
    expect(
      guardianLinkedPayloadSchema.safeParse({
        link_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        student_display_name: "Sam",
        email: "leak@example.test",
      }).success,
    ).toBe(false);
  });

  it("patch body requires at least one true flag", () => {
    expect(notificationPatchBodySchema.safeParse({}).success).toBe(false);
    expect(notificationPatchBodySchema.safeParse({ read: false }).success).toBe(
      false,
    );
    expect(notificationPatchBodySchema.safeParse({ read: true }).success).toBe(
      true,
    );
  });

  it("feed query clamps limit to the maximum", () => {
    expect(notificationFeedQuerySchema.parse({}).limit).toBe(20);
    expect(
      notificationFeedQuerySchema.safeParse({ limit: "500" }).success,
    ).toBe(false);
    expect(notificationFeedQuerySchema.parse({ limit: "50" }).limit).toBe(50);
  });

  it("maps only the four status-changing Resend events (C7.4)", () => {
    expect(isResendStatusEvent("email.delivered")).toBe(true);
    expect(isResendStatusEvent("email.bounced")).toBe(true);
    expect(isResendStatusEvent("email.complained")).toBe(true);
    expect(isResendStatusEvent("email.failed")).toBe(true);
    expect(isResendStatusEvent("email.opened")).toBe(false);
    expect(isResendStatusEvent("email.clicked")).toBe(false);
    expect(isResendStatusEvent("email.sent")).toBe(false);
    expect(isResendStatusEvent("constructor")).toBe(false);
  });

  it("webhook body needs type, created_at and data.email_id", () => {
    expect(
      resendWebhookEventSchema.safeParse({
        type: "email.delivered",
        created_at: "2026-09-03T00:00:00.000Z",
        data: { email_id: "re_1", to: ["x@y.z"] },
      }).success,
    ).toBe(true);
    expect(
      resendWebhookEventSchema.safeParse({ type: "email.delivered", data: {} })
        .success,
    ).toBe(false);
  });
});
