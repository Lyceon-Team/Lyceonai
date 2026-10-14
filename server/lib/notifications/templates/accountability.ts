/**
 * @spec [owner brief "Guardian accountability loop" (Karl, 2026-10-13) "Content": "the student's
 *        first name and plain-language lines, e.g. 'Amingwa reduced study days from 5 to 4',
 *        'Amingwa cleared Tuesday's plan (45 min)', 'Amingwa hasn't studied for 2 planned days',
 *        'Amingwa is back on track'. No other student data."; Doc-01_V8 §38.1 (activity trends);
 *        Doc-05F_V1.0 §14 (facts), §16; contracts/notifications.contract.md §2.3, §8]
 *        | @implemented [2026-10-13]
 *
 * plain English: the renderings of the four accountability types. One line builder per fact, so
 * the in-app item a guardian sees at the moment of a change and the line in that evening's digest
 * say the same thing in the same words. Every value interpolated into HTML is escaped. No
 * tracking, no link beyond the app's own pages, and nothing about the student beyond the first
 * name, the dates and the minute totals their calendar already shows.
 *
 * A guardian and the student can receive the same missed-plan or back-on-track event: the
 * message row names the recipient and the event names the subject, so `recipientIsSubject`
 * picks "You" for the student and the first name for a guardian. The student is never sent a
 * `study_plan_changed` (they made the change) or a digest.
 *
 * trade-offs: dates render as "Tuesday 14 October" from the payload's own local date with no
 * zone arithmetic (`renderNoticeDate`, the full-length notices' formatter) — the date is already
 * the student's calendar date, and re-reading it against a server clock is how a Tuesday becomes
 * a Monday. The first name is the first word of the display name only when it looks like a name
 * (letters, two or more); otherwise "Your student", never a username.
 */
import type {
  BackOnTrackPayload,
  DigestPlanChange,
  GuardianDailyDigestPayload,
  MissedPlanAlertPayload,
  StudyPlanChangedPayload,
} from "../../../../packages/shared/src/notifications-schema";
import { renderNoticeDate } from "./full-length";
import {
  emailRender,
  escapeHtml,
  type EmailRender,
  type InAppRender,
  type RenderContext,
} from "./shared";

const GUARDIAN_HOME = "/guardian";
const STUDENT_CALENDAR = "/calendar";
const GUARDIAN_SETTINGS = "/profile";

/** The stored first word when it is a usable first name, else "Your student". */
export function accountabilityFirstName(raw: string): string {
  const word = raw.trim();
  if (!/^\p{L}(?:[\p{L}'’-]*\p{L})?$/u.test(word)) return "Your student";
  if ([...word].filter((c) => /\p{L}/u.test(c)).length < 2)
    return "Your student";
  return word;
}

const WEEKDAY_PLURAL = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
] as const;

/** "every 2 weeks on Saturdays", "every week on Sundays", or "none" when practice tests are off. */
export function practiceTestCadence(
  weekday: number | null,
  intervalWeeks: number | null,
): string {
  if (intervalWeeks === null) return "none";
  const every =
    intervalWeeks === 1 ? "every week" : `every ${intervalWeeks} weeks`;
  const day = weekday === null ? undefined : WEEKDAY_PLURAL[weekday];
  return day === undefined ? every : `${every} on ${day}`;
}

function moreOrLess(before: number, after: number): "reduced" | "increased" {
  return after < before ? "reduced" : "increased";
}

/** One plan change as a sentence, the same in the bell and in the digest. */
export function planChangeLine(name: string, change: DigestPlanChange): string {
  switch (change.kind) {
    case "day_reduced": {
      const day = renderNoticeDate(change.plan_date);
      return change.after_minutes === 0
        ? `${name} cleared the plan for ${day} (${change.before_minutes} min)`
        : `${name} reduced the plan for ${day} from ${change.before_minutes} min to ${change.after_minutes} min`;
    }
    case "full_length_removed":
      return `${name} removed the practice test on ${renderNoticeDate(change.plan_date)}`;
    case "full_length_moved":
      return `${name} moved the practice test from ${renderNoticeDate(change.plan_date)} to ${renderNoticeDate(change.to_date)}`;
    // SCL-230 (approved by Karl 2026-10-13): the schedule itself, before → after.
    case "study_days":
      return change.after_days === change.before_days
        ? `${name} changed which days they study (${change.after_days} a week)`
        : `${name} ${moreOrLess(change.before_days, change.after_days)} study days from ${change.before_days} to ${change.after_days} a week`;
    case "daily_minutes":
      return `${name} ${moreOrLess(change.before_minutes, change.after_minutes)} daily study time from ${change.before_minutes} to ${change.after_minutes} minutes`;
    case "full_length_frequency":
      return `${name} changed practice tests from ${practiceTestCadence(change.before_weekday, change.before_interval_weeks)} to ${practiceTestCadence(change.after_weekday, change.after_interval_weeks)}`;
  }
}

export function missedLine(name: string, missedDays: number): string {
  return `${name} hasn't studied for ${missedDays} planned days`;
}

export function backOnTrackLine(name: string): string {
  return `${name} is back on track`;
}

export function completionLine(
  name: string,
  completion: { planned: number; completed: number },
): string {
  const noun = completion.planned === 1 ? "session" : "sessions";
  // Karl's ruling 6 on #1223 (2026-10-13): "today so far" — at 18:00 Chicago the day may still be
  // running (and is, for a student west of Chicago).
  return `${name} completed ${completion.completed} of ${completion.planned} planned ${noun} today so far`;
}

function toDigestChange(payload: StudyPlanChangedPayload): DigestPlanChange {
  switch (payload.kind) {
    case "day_reduced":
      return {
        kind: "day_reduced",
        plan_date: payload.plan_date,
        before_minutes: payload.before_minutes,
        after_minutes: payload.after_minutes,
      };
    case "full_length_removed":
      return { kind: "full_length_removed", plan_date: payload.plan_date };
    case "full_length_moved":
      return {
        kind: "full_length_moved",
        plan_date: payload.plan_date,
        to_date: payload.to_date,
      };
    case "study_days":
      return {
        kind: "study_days",
        before_days: payload.before_days,
        after_days: payload.after_days,
      };
    case "daily_minutes":
      return {
        kind: "daily_minutes",
        before_minutes: payload.before_minutes,
        after_minutes: payload.after_minutes,
      };
    case "full_length_frequency":
      return {
        kind: "full_length_frequency",
        before_weekday: payload.before_weekday,
        before_interval_weeks: payload.before_interval_weeks,
        after_weekday: payload.after_weekday,
        after_interval_weeks: payload.after_interval_weeks,
      };
  }
}

function shell(lines: readonly string[], footer: string): string {
  return [
    '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">',
    ...lines,
    `<p style="color:#555;font-size:0.9em">${footer}</p>`,
    "</body></html>",
  ].join("");
}

function link(ctx: RenderContext, path: string, label: string): string {
  return ctx.siteUrl
    ? `<p><a href="${escapeHtml(ctx.siteUrl + path)}">${escapeHtml(label)}</a></p>`
    : "";
}

function textLink(ctx: RenderContext, path: string, label: string): string {
  return ctx.siteUrl ? `${label}: ${ctx.siteUrl}${path}` : "";
}

const GUARDIAN_FOOTER =
  "You get this because you're linked to this student on Lyceon. You can turn off the daily summary email in your settings.";
const STUDENT_FOOTER = "This is about your own study plan on Lyceon.";

// ── study_plan_changed (guardian only) ──────────────────────────────────────

export function studyPlanChangedInApp(
  payload: StudyPlanChangedPayload,
  _ctx: RenderContext,
): InAppRender {
  const name = accountabilityFirstName(payload.student_first_name);
  return {
    title: `${name} changed their study plan`,
    body: `${planChangeLine(name, toDigestChange(payload))}.`,
    href: GUARDIAN_HOME,
  };
}

/** Delivered in-app only today (the digest is the email); kept so a channel is one line. */
export function studyPlanChangedEmail(
  payload: StudyPlanChangedPayload,
  ctx: RenderContext,
): EmailRender {
  const inApp = studyPlanChangedInApp(payload, ctx);
  const name = accountabilityFirstName(payload.student_first_name);
  // Karl, 2026-10-14: to a guardian ("Lyceon for Parents"), "SAT" in the subject; in-app unchanged.
  return emailRender({
    subject: `${name} changed their SAT study plan`,
    preview: inApp.body,
    fromCategory: "guardian",
    text: [inApp.body, "", textLink(ctx, GUARDIAN_HOME, "Open Lyceon")]
      .filter((l) => l !== "")
      .join("\n"),
    html: shell(
      [
        `<p>${escapeHtml(inApp.body)}</p>`,
        link(ctx, GUARDIAN_HOME, "Open Lyceon"),
      ],
      GUARDIAN_FOOTER,
    ),
  });
}

// ── missed_plan_alert (student + guardians) ─────────────────────────────────

export function missedPlanAlertInApp(
  payload: MissedPlanAlertPayload,
  ctx: RenderContext,
): InAppRender {
  if (ctx.recipientIsSubject) {
    return {
      title: `You haven't studied for ${payload.missed_days} planned days`,
      body: "Your plan is still there. Start with today's first session when you're ready.",
      href: STUDENT_CALENDAR,
    };
  }
  const name = accountabilityFirstName(payload.student_first_name);
  return {
    title: missedLine(name, payload.missed_days),
    body: `${name} had work planned on ${payload.missed_days} study days in a row and didn't do any of it.`,
    href: GUARDIAN_HOME,
  };
}

export function missedPlanAlertEmail(
  payload: MissedPlanAlertPayload,
  ctx: RenderContext,
): EmailRender {
  const inApp = missedPlanAlertInApp(payload, ctx);
  const path = ctx.recipientIsSubject ? STUDENT_CALENDAR : GUARDIAN_HOME;
  const label = ctx.recipientIsSubject ? "Open your calendar" : "Open Lyceon";
  const footer = ctx.recipientIsSubject ? STUDENT_FOOTER : GUARDIAN_FOOTER;
  // Karl, 2026-10-14: the student's copy names the plan and says what to do; it goes out as
  // "Lyceon Study Plan". A guardian's copy keeps its wording, as "Lyceon for Parents".
  return emailRender({
    subject: ctx.recipientIsSubject
      ? "Your SAT study plan is waiting"
      : inApp.title,
    preview: ctx.recipientIsSubject
      ? `${payload.missed_days} planned days missed. Start with today's first session when you're ready.`
      : inApp.body,
    fromCategory: ctx.recipientIsSubject ? "study_plan" : "guardian",
    text: [inApp.body, "", textLink(ctx, path, label), "", footer]
      .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
      .join("\n"),
    html: shell(
      [`<p>${escapeHtml(inApp.body)}</p>`, link(ctx, path, label)],
      footer,
    ),
  });
}

// ── back_on_track (student + guardians) ─────────────────────────────────────

export function backOnTrackInApp(
  payload: BackOnTrackPayload,
  ctx: RenderContext,
): InAppRender {
  if (ctx.recipientIsSubject) {
    return {
      title: "You're back on track",
      body: "You did planned work again. Keep it going tomorrow.",
      href: STUDENT_CALENDAR,
    };
  }
  const name = accountabilityFirstName(payload.student_first_name);
  return {
    title: backOnTrackLine(name),
    body: `${name} did planned work on ${renderNoticeDate(payload.back_on_date)}.`,
    href: GUARDIAN_HOME,
  };
}

export function backOnTrackEmail(
  payload: BackOnTrackPayload,
  ctx: RenderContext,
): EmailRender {
  const inApp = backOnTrackInApp(payload, ctx);
  const path = ctx.recipientIsSubject ? STUDENT_CALENDAR : GUARDIAN_HOME;
  const label = ctx.recipientIsSubject ? "Open your calendar" : "Open Lyceon";
  const footer = ctx.recipientIsSubject ? STUDENT_FOOTER : GUARDIAN_FOOTER;
  // Karl, 2026-10-14: as missed_plan_alert above; the preview is the body line.
  return emailRender({
    subject: ctx.recipientIsSubject
      ? "You're back on track with your SAT study plan"
      : inApp.title,
    preview: inApp.body,
    fromCategory: ctx.recipientIsSubject ? "study_plan" : "guardian",
    text: [inApp.body, "", textLink(ctx, path, label), "", footer]
      .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
      .join("\n"),
    html: shell(
      [`<p>${escapeHtml(inApp.body)}</p>`, link(ctx, path, label)],
      footer,
    ),
  });
}

// ── guardian_daily_digest (guardian email) ──────────────────────────────────

/** Every line of one student's section, in a fixed order: alert, back, completion, changes. */
export function digestLines(
  section: GuardianDailyDigestPayload["students"][number],
): string[] {
  const name = accountabilityFirstName(section.student_first_name);
  const lines: string[] = [];
  if (section.missed_plan_alert !== null)
    lines.push(missedLine(name, section.missed_plan_alert.missed_days));
  if (section.back_on_track) lines.push(backOnTrackLine(name));
  if (section.completion !== null)
    lines.push(completionLine(name, section.completion));
  for (const change of section.plan_changes)
    lines.push(planChangeLine(name, change));
  return lines;
}

function digestSubject(payload: GuardianDailyDigestPayload): string {
  const names = payload.students.map((s) =>
    accountabilityFirstName(s.student_first_name),
  );
  return names.length === 1
    ? `${names[0] ?? "Your student"}'s day on Lyceon`
    : "Your students' day on Lyceon";
}

/** The digest is email-only; this is what a feed would show if a channel were ever added. */
export function guardianDailyDigestInApp(
  payload: GuardianDailyDigestPayload,
  _ctx: RenderContext,
): InAppRender {
  return {
    title: digestSubject(payload),
    body: payload.students.flatMap(digestLines).join(". ") + ".",
    href: GUARDIAN_HOME,
  };
}

export function guardianDailyDigestEmail(
  payload: GuardianDailyDigestPayload,
  ctx: RenderContext,
): EmailRender {
  const sections = payload.students.map((s) => ({
    name: accountabilityFirstName(s.student_first_name),
    lines: digestLines(s),
  }));
  const multi = sections.length > 1;
  const unsubscribeUrl = ctx.guardianDigestEmail?.unsubscribeUrl ?? null;
  const text = [
    `Today, ${renderNoticeDate(payload.digest_date)}:`,
    "",
    ...sections.flatMap((s) => [
      ...(multi ? [s.name] : []),
      ...s.lines.map((l) => `- ${l}`),
      "",
    ]),
    textLink(ctx, GUARDIAN_HOME, "Open Lyceon"),
    "",
    GUARDIAN_FOOTER,
    textLink(ctx, GUARDIAN_SETTINGS, "Settings"),
    unsubscribeUrl === null
      ? ""
      : `Unsubscribe from this daily summary: ${unsubscribeUrl}`,
  ]
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n");
  const html = shell(
    [
      `<p>Today, <strong>${escapeHtml(renderNoticeDate(payload.digest_date))}</strong>:</p>`,
      ...sections.map(
        (s) =>
          (multi ? `<p><strong>${escapeHtml(s.name)}</strong></p>` : "") +
          `<ul>${s.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`,
      ),
      link(ctx, GUARDIAN_HOME, "Open Lyceon"),
    ],
    unsubscribeUrl === null
      ? GUARDIAN_FOOTER
      : `${GUARDIAN_FOOTER} <a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from this daily summary</a>.`,
  );
  // Karl's ruling 5 on #1223 (2026-10-13): RFC 8058 one-click, the QOTD email's pattern. The link
  // is built by the dispatcher at send time (guardian-digest-send-context.ts), never stored.
  const headers: Record<string, string> | undefined =
    unsubscribeUrl === null
      ? undefined
      : {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        };
  // Karl, 2026-10-14: "SAT prep today" in the subject and the first digest line as the preview
  // (it used to be "Today, <date>:"). Sent as "Lyceon for Parents". The in-app title is unchanged.
  const names = sections.map((sec) => sec.name);
  return emailRender({
    subject:
      names.length === 1
        ? `${names[0] ?? "Your student"}'s SAT prep today`
        : "Your students' SAT prep today",
    preview: sections.flatMap((sec) => sec.lines)[0] ?? digestSubject(payload),
    fromCategory: "guardian",
    text,
    html,
    ...(headers === undefined ? {} : { headers }),
  });
}
