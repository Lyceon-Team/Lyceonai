/**
 * @spec [contracts/notifications.contract.md §3, §7.4, §9.4] | @implemented [2026-09-03]
 * plain English: the shared shapes reject what the routes must never accept.
 */
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_EVENT_TYPES,
  guardianLinkedPayloadSchema,
  isResendStatusEvent,
  notificationFeedQuerySchema,
  notificationPatchBodySchema,
  resendWebhookEventSchema,
} from "../notifications-schema";

describe("notifications schema", () => {
  it("names exactly the one launch event type (R7/R8)", () => {
    expect([...NOTIFICATION_EVENT_TYPES]).toEqual(["guardian_linked"]);
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
