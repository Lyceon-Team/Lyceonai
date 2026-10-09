/**
 * @spec [contracts/notifications.contract.md §2.3, §8] | @implemented [2026-09-03]
 *
 * plain English: one template per event type, selected here. Payloads arrive as `unknown`
 * (they were read back from jsonb) and are parsed against the event's strict schema before a
 * template sees them — an event whose payload carries an unexpected key does not render,
 * which is the payload rule enforced at read time as well as at write time. A payload that
 * does not parse is an expected failure, returned as a Result, never thrown. The
 * deletion-scheduled email is a direct send (ruling R8) and lives in ./deletion-scheduled.ts,
 * outside this switch. (The guardian consent-request email was removed with the email-consent
 * flow, G2-05.)
 */
import {
  fullLengthNoticePayloadSchema,
  guardianLinkedPayloadSchema,
  guardianUnlinkedPayloadSchema,
  postExamNoticePayloadSchema,
  qotdDailyPayloadSchema,
  type NotificationEventType,
} from "../../../../packages/shared/src/notifications-schema";
import { err, ok, type Result } from "../../../../packages/shared/src/result";
import { guardianLinkedEmail, guardianLinkedInApp } from "./guardian-linked";
import {
  guardianUnlinkedEmail,
  guardianUnlinkedInApp,
} from "./guardian-unlinked";
import {
  fullLengthTomorrowEmail,
  fullLengthTomorrowInApp,
  fullLengthWeekEmail,
  fullLengthWeekInApp,
} from "./full-length";
import {
  examScoreReportRequestedEmail,
  examScoreReportRequestedInApp,
  renewalDecisionRequestedEmail,
  renewalDecisionRequestedInApp,
} from "./post-exam";
import { qotdDailyInApp, qotdDailyNotificationEmail } from "./qotd-daily";
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
    case "guardian_unlinked": {
      const parsed = guardianUnlinkedPayloadSchema.safeParse(payload);
      if (!parsed.success)
        return err("guardian_unlinked payload does not match its schema");
      return ok(guardianUnlinkedInApp(parsed.data, ctx));
    }
    // Brief 14 Step 5. Two cases, not one with a kind in the payload — see the event-type
    // list's own note for why the id derivation makes that the only workable shape.
    case "full_length_week": {
      const parsed = fullLengthNoticePayloadSchema.safeParse(payload);
      if (!parsed.success)
        return err("full_length_week payload does not match its schema");
      return ok(fullLengthWeekInApp(parsed.data, ctx));
    }
    case "full_length_tomorrow": {
      const parsed = fullLengthNoticePayloadSchema.safeParse(payload);
      if (!parsed.success)
        return err("full_length_tomorrow payload does not match its schema");
      return ok(fullLengthTomorrowInApp(parsed.data, ctx));
    }
    // SCL-191. Two cases again, and for the same id-derivation reason as the pair above — plus a
    // second one here: they address two different people, so they could not share a template even
    // if they could share an id.
    case "exam_score_report_requested": {
      const parsed = postExamNoticePayloadSchema.safeParse(payload);
      if (!parsed.success)
        return err(
          "exam_score_report_requested payload does not match its schema",
        );
      return ok(examScoreReportRequestedInApp(parsed.data, ctx));
    }
    case "renewal_decision_requested": {
      const parsed = postExamNoticePayloadSchema.safeParse(payload);
      if (!parsed.success)
        return err(
          "renewal_decision_requested payload does not match its schema",
        );
      return ok(renewalDecisionRequestedInApp(parsed.data, ctx));
    }
    case "qotd_daily": {
      const parsed = qotdDailyPayloadSchema.safeParse(payload);
      if (!parsed.success)
        return err("qotd_daily payload does not match its schema");
      return ok(qotdDailyInApp(parsed.data));
    }
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
    case "guardian_unlinked": {
      const parsed = guardianUnlinkedPayloadSchema.safeParse(payload);
      if (!parsed.success)
        return err("guardian_unlinked payload does not match its schema");
      return ok(guardianUnlinkedEmail(parsed.data, ctx));
    }
    case "full_length_week": {
      const parsed = fullLengthNoticePayloadSchema.safeParse(payload);
      if (!parsed.success)
        return err("full_length_week payload does not match its schema");
      return ok(fullLengthWeekEmail(parsed.data, ctx));
    }
    case "full_length_tomorrow": {
      const parsed = fullLengthNoticePayloadSchema.safeParse(payload);
      if (!parsed.success)
        return err("full_length_tomorrow payload does not match its schema");
      return ok(fullLengthTomorrowEmail(parsed.data, ctx));
    }
    case "exam_score_report_requested": {
      const parsed = postExamNoticePayloadSchema.safeParse(payload);
      if (!parsed.success)
        return err(
          "exam_score_report_requested payload does not match its schema",
        );
      return ok(examScoreReportRequestedEmail(parsed.data, ctx));
    }
    case "renewal_decision_requested": {
      const parsed = postExamNoticePayloadSchema.safeParse(payload);
      if (!parsed.success)
        return err(
          "renewal_decision_requested payload does not match its schema",
        );
      return ok(renewalDecisionRequestedEmail(parsed.data, ctx));
    }
    case "qotd_daily": {
      const parsed = qotdDailyPayloadSchema.safeParse(payload);
      if (!parsed.success)
        return err("qotd_daily payload does not match its schema");
      return qotdDailyNotificationEmail(parsed.data, ctx);
    }
  }
}

export function siteUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return (env.PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
}
