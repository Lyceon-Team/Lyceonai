/**
 * @spec [Doc-05F_V1.0 §8.1 (full-length placement), §12.2 privacy on a minor's surface;
 *        contracts/notifications.contract.md §2.3, §8.1; Brief 14 Step 5]
 * | @implemented [2026-09-27]
 *
 * plain English: the two practice-test renderings — "you have one this week" and "you have one
 * tomorrow". Expected outcome: a student knows a full-length is coming without opening the
 * calendar, and the message says WHEN and nothing else.
 *
 * ONE RECIPIENT, so no `recipientIsSubject` branch. The student is always both the subject and
 * the recipient of these two events (contract §2.3): a practice test is the work, and Doc 01
 * §38.1 gives a guardian aggregates rather than the student's nudges. If that ever changes it
 * is a new branch here plus a new channel array in the emitting SQL — not a silent widening.
 *
 * trade-offs: the date is rendered as a weekday and a day-of-month ("Saturday 17 October")
 * rather than an ISO string, because the message is read in a bell or an inbox and "2026-10-17"
 * is not a sentence. The formatting is done here from the payload's own date string with no
 * locale lookup and no Date parsing, so it cannot drift with the server's timezone — the date
 * is ALREADY the student's local date, computed in their own zone by
 * `calendar_exam_notification_candidates`, and re-interpreting it against a server clock is
 * exactly how a Saturday becomes a Friday.
 *
 * edge cases: no link when `PUBLIC_SITE_URL` is unset, the same rule every other template
 * follows. No tracking pixel, no per-message tracking option (contract §12.3). Every
 * interpolated value is HTML-escaped even though both are server-derived — the escaper is not
 * there because the input is suspect, it is there so that the day it stops being server-derived
 * nothing has to be remembered.
 */
import type { FullLengthNoticePayload } from "../../../../packages/shared/src/notifications-schema";
import {
  escapeHtml,
  type EmailRender,
  type InAppRender,
  type RenderContext,
} from "./shared";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * "2026-10-17" -> "Saturday 17 October".
 *
 * Parsed as a plain calendar date, never as an instant: `new Date("2026-10-17")` is midnight
 * UTC, which is the day BEFORE in every western-hemisphere zone, and the whole point of this
 * string is that it is already the student's own local date. `Date.UTC` plus `getUTCDay` reads
 * the weekday of the date itself with no zone in the way.
 */
export function renderNoticeDate(localDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (match === null) return localDate;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const weekday =
    WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const monthName = MONTHS[month - 1];
  if (weekday === undefined || monthName === undefined) return localDate;
  return `${weekday} ${day} ${monthName}`;
}

const CALENDAR_HREF = "/calendar";

export function fullLengthWeekInApp(
  payload: FullLengthNoticePayload,
  _ctx: RenderContext,
): InAppRender {
  return {
    title: "You have a practice test this week",
    body: `It's on ${renderNoticeDate(payload.local_date)}. A full test takes about three hours, so it helps to know now.`,
    href: CALENDAR_HREF,
  };
}

export function fullLengthTomorrowInApp(
  payload: FullLengthNoticePayload,
  _ctx: RenderContext,
): InAppRender {
  return {
    title: "Your practice test is tomorrow",
    body: `${renderNoticeDate(payload.local_date)}. Set aside about three hours and start when you're ready.`,
    href: CALENDAR_HREF,
  };
}

function shell(lines: readonly string[]): string {
  return [
    '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">',
    ...lines,
    '<p style="color:#555;font-size:0.9em">This is a reminder about your own study calendar on Lyceon.</p>',
    "</body></html>",
  ].join("");
}

/**
 * The week notice is `in_app` only (the emitting SQL's channel array), so this render exists
 * for completeness of the registry rather than because a send uses it today. It is written
 * properly all the same: the day the owner adds `email` to that array, the template must
 * already be right rather than written in a hurry against a live change.
 */
export function fullLengthWeekEmail(
  payload: FullLengthNoticePayload,
  ctx: RenderContext,
): EmailRender {
  const when = renderNoticeDate(payload.local_date);
  const safeWhen = escapeHtml(when);
  const siteUrl = ctx.siteUrl ? escapeHtml(ctx.siteUrl) : null;
  return {
    subject: "You have a practice test this week",
    text: [
      `You have a full-length practice test this week, on ${when}.`,
      "",
      "A full test takes about three hours, so it helps to know now.",
      ctx.siteUrl ? `Open your calendar: ${ctx.siteUrl}${CALENDAR_HREF}` : "",
      "",
      "This is a reminder about your own study calendar on Lyceon.",
    ]
      .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
      .join("\n"),
    html: shell([
      `<p>You have a full-length practice test this week, on <strong>${safeWhen}</strong>.</p>`,
      "<p>A full test takes about three hours, so it helps to know now.</p>",
      siteUrl
        ? `<p><a href="${siteUrl}${CALENDAR_HREF}">Open your calendar</a></p>`
        : "",
    ]),
  };
}

export function fullLengthTomorrowEmail(
  payload: FullLengthNoticePayload,
  ctx: RenderContext,
): EmailRender {
  const when = renderNoticeDate(payload.local_date);
  const safeWhen = escapeHtml(when);
  const siteUrl = ctx.siteUrl ? escapeHtml(ctx.siteUrl) : null;
  return {
    subject: "Your practice test is tomorrow",
    text: [
      `Your full-length practice test is tomorrow, ${when}.`,
      "",
      "Set aside about three hours and start when you're ready.",
      ctx.siteUrl ? `Open your calendar: ${ctx.siteUrl}${CALENDAR_HREF}` : "",
      "",
      "This is a reminder about your own study calendar on Lyceon.",
    ]
      .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
      .join("\n"),
    html: shell([
      `<p>Your full-length practice test is tomorrow, <strong>${safeWhen}</strong>.</p>`,
      "<p>Set aside about three hours and start when you're ready.</p>",
      siteUrl
        ? `<p><a href="${siteUrl}${CALENDAR_HREF}">Open your calendar</a></p>`
        : "",
    ]),
  };
}
