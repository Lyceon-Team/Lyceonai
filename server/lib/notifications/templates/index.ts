/**
 * @spec [contracts/notifications.contract.md §2.3, §8] | @implemented [2026-09-03]
 *
 * plain English: one template per event type, selected here. Payloads arrive as `unknown`
 * (they were read back from jsonb) and are parsed against the event's strict schema before a
 * template sees them — an event whose payload carries an unexpected key does not render,
 * which is the payload rule enforced at read time as well as at write time. The two reserved
 * event types have no emitter and therefore no template; asking for one is an expected
 * failure, returned as a Result, never thrown.
 */
import {
  guardianLinkedPayloadSchema,
  type NotificationEventType,
} from "../../../../packages/shared/src/notifications-schema";
import { err, ok, type Result } from "../../../../packages/shared/src/result";
import { guardianLinkedEmail, guardianLinkedInApp } from "./guardian-linked";
import type { EmailRender, InAppRender, RenderContext } from "./shared";

export type { EmailRender, InAppRender, RenderContext } from "./shared";

export function renderInApp(
  eventType: NotificationEventType,
  payload: unknown,
  ctx: RenderContext,
): Result<InAppRender, string> {
  switch (eventType) {
    case "guardian_linked": {
      const parsed = guardianLinkedPayloadSchema.safeParse(payload);
      if (!parsed.success)
        return err("guardian_linked payload does not match its schema");
      return ok(guardianLinkedInApp(parsed.data, ctx));
    }
    case "guardian_consent_requested":
    case "account_deletion_scheduled":
      return err(`no template for reserved event type ${eventType}`);
  }
}

export function renderEmail(
  eventType: NotificationEventType,
  payload: unknown,
  ctx: RenderContext,
): Result<EmailRender, string> {
  switch (eventType) {
    case "guardian_linked": {
      const parsed = guardianLinkedPayloadSchema.safeParse(payload);
      if (!parsed.success)
        return err("guardian_linked payload does not match its schema");
      return ok(guardianLinkedEmail(parsed.data, ctx));
    }
    case "guardian_consent_requested":
    case "account_deletion_scheduled":
      return err(`no template for reserved event type ${eventType}`);
  }
}

export function siteUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return (env.PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
}
