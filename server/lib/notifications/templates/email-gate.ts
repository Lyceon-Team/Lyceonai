/**
 * The email send gate's five emails: the student pause note, the parent pause email, and the
 * three SAT milestones (a week before, the day after, score release day).
 *
 * @spec [owner brief "Email send gate" (Karl, 2026-10-30): the sunset note and the parent pause
 *       email; owner rulings 2026-11-02 round 1 ("use Karl's longer copy drafts") and round 2
 *       (the three milestone drafts; "Got your scores?" on College Board's release day);
 *       contracts/notifications.contract.md C15] | @implemented [2026-11-02]
 *
 * plain English: Karl's copy, word for word, signed "Karl, Founder, Lyceon". The {if test date}
 * and {if release date} lines appear only when the payload carries that date. The Keep me
 * posted link is signed and single-purpose (qotd-email-links.ts, `email_keep_posted`), built by
 * the dispatcher at send time and never stored. No score, answer or address in any payload.
 *
 * Senders: the two pause emails are notices and go out untracked (send.lyceon.ai); the
 * milestones are tracked (lyceon.ai), per the shared category map.
 */
import type {
  EmailGateGuardianPausedPayload,
  EmailGatePausedNoticePayload,
  SatDayAfterPayload,
  SatScoresReleasedPayload,
  SatWeekBeforePayload,
} from "../../../../packages/shared/src/notifications-schema";
import { LYCEON_POSTAL_ADDRESS } from "../../../../packages/shared/src/support-contact";
import {
  emailRender,
  escapeHtml,
  type EmailRender,
  type InAppRender,
  type RenderContext,
} from "./shared";

export const SIGN_OFF = "Karl, Founder, Lyceon";
const FOOTER = "You're getting this because you have a Lyceon account.";

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
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function dateParts(iso: string): { weekday: string; date: string } {
  const d = new Date(`${iso}T00:00:00Z`);
  return {
    weekday: WEEKDAYS[d.getUTCDay()] ?? "",
    date: `${MONTHS[d.getUTCMonth()] ?? ""} ${d.getUTCDate()}`,
  };
}

/** "November 7" from "2026-11-07". */
export function formatTestDate(iso: string): string {
  return dateParts(iso).date;
}

function hi(name: string): string {
  const n = name.trim();
  return n.length > 0 ? `Hi ${n},` : "Hi,";
}

/** A line of copy; `[Label]` in `text` becomes the link when one is given, plain text if not. */
type Line = { text: string; link?: { label: string; url: string } };

type Block =
  | ({ kind: "p" } & Line)
  | { kind: "list"; items: Line[] }
  | { kind: "button"; label: string; url: string };

function lineText(line: Line): string {
  if (!line.link) return line.text.replace(/\[([^\]]+)\]/g, "$1");
  const [before, after] = line.text.split(`[${line.link.label}]`);
  return `${before ?? ""}${line.link.label} (${line.link.url})${after ?? ""}`;
}

function lineHtml(line: Line): string {
  if (!line.link) return escapeHtml(line.text.replace(/\[([^\]]+)\]/g, "$1"));
  const [before, after] = line.text.split(`[${line.link.label}]`);
  return `${escapeHtml(before ?? "")}<a href="${escapeHtml(line.link.url)}">${escapeHtml(line.link.label)}</a>${escapeHtml(after ?? "")}`;
}

const BUTTON_STYLE =
  "display:inline-block;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;background:#111;color:#fff";

function compose(blocks: Block[]): { html: string; text: string } {
  const text: string[] = [];
  const html: string[] = [
    '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">',
  ];
  for (const b of blocks) {
    if (b.kind === "p") {
      text.push(lineText(b), "");
      html.push(`<p>${lineHtml(b)}</p>`);
    } else if (b.kind === "button") {
      text.push(`${b.label}: ${b.url}`, "");
      html.push(
        `<p><a href="${escapeHtml(b.url)}" style="${BUTTON_STYLE}">${escapeHtml(b.label)}</a></p>`,
      );
    } else {
      const lis: string[] = [];
      for (const item of b.items) {
        text.push(`* ${lineText(item)}`);
        lis.push(`<li>${lineHtml(item)}</li>`);
      }
      text.push("");
      html.push(`<ul>${lis.join("")}</ul>`);
    }
  }
  text.push(SIGN_OFF, "", FOOTER, LYCEON_POSTAL_ADDRESS);
  html.push(
    `<p>${escapeHtml(SIGN_OFF)}</p>`,
    `<p style="color:#555;font-size:13px">${escapeHtml(FOOTER)}<br>${escapeHtml(LYCEON_POSTAL_ADDRESS)}</p>`,
    "</body></html>",
  );
  return { html: html.join(""), text: text.join("\n") };
}

function keepPostedUrl(ctx: RenderContext): string | null {
  return ctx.emailGate?.keepPostedUrl ?? null;
}

// ── The student pause note ──────────────────────────────────────────────────────────────────
export const PAUSED_NOTICE_SUBJECT = "Pausing your SAT reminders";

export function pausedNoticeEmail(
  payload: EmailGatePausedNoticePayload,
  ctx: RenderContext,
): EmailRender {
  const url = keepPostedUrl(ctx);
  const blocks: Block[] = [
    { kind: "p", text: hi(payload.first_name) },
    {
      kind: "p",
      text: "It's been a little while since your last study session, so we're pausing your study reminders. We'd rather send nothing than fill your inbox with emails you're not using.",
    },
    {
      kind: "p",
      text: "Your account, your progress and your study plan are all still here, exactly where you left them. When you're ready to pick it back up:",
    },
    {
      kind: "list",
      items: [
        {
          text: "Log in and answer even one question. Your reminders switch back on automatically.",
        },
        {
          text: "Or tap [Keep me posted] to turn them back on now.",
          ...(url === null ? {} : { link: { label: "Keep me posted", url } }),
        },
      ],
    },
    ...(payload.test_date === null
      ? []
      : [
          {
            kind: "p" as const,
            text: `Your SAT is on ${formatTestDate(payload.test_date)}. We'll send one short note about a week before, just in case.`,
          },
        ]),
    { kind: "p", text: "Whenever you're ready, we're here." },
  ];
  const body = compose(blocks);
  return emailRender({
    subject: PAUSED_NOTICE_SUBJECT,
    preview: "Your account and progress are still here.",
    fromCategory: "general",
    html: body.html,
    text: body.text,
  });
}

// ── The parent pause email ──────────────────────────────────────────────────────────────────
export function guardianPausedSubject(student: string): string {
  const s = student.trim();
  return s.length > 0
    ? `Pausing ${s}'s daily SAT updates`
    : "Pausing your daily SAT updates";
}

export function guardianPausedEmail(
  payload: EmailGateGuardianPausedPayload,
  ctx: RenderContext,
): EmailRender {
  const url = keepPostedUrl(ctx);
  const student =
    payload.student_first_name.trim().length > 0
      ? payload.student_first_name.trim()
      : "Your student";
  const quietWeek =
    "A quiet week isn't unusual: school, sports and life get busy." +
    (payload.test_date === null
      ? ""
      : ` With ${student}'s SAT on ${formatTestDate(payload.test_date)}, a quick check-in from home is sometimes all it takes to restart the habit.`);
  const blocks: Block[] = [
    { kind: "p", text: hi(payload.guardian_first_name) },
    {
      kind: "p",
      text: `${student} hasn't studied on Lyceon in the past week, so we're pausing your daily updates. We'd rather respect your inbox than keep sending summaries with nothing new in them.`,
    },
    { kind: "p", text: quietWeek },
    {
      kind: "p",
      text: `Updates switch back on automatically the moment ${student} studies again. If you'd like them back sooner, tap [Keep me posted].`,
      ...(url === null ? {} : { link: { label: "Keep me posted", url } }),
    },
    { kind: "p", text: `Thanks for being part of ${student}'s SAT prep,` },
  ];
  const body = compose(blocks);
  return emailRender({
    subject: guardianPausedSubject(payload.student_first_name),
    preview: "Updates switch back on the moment they study again.",
    fromCategory: "guardian",
    html: body.html,
    text: body.text,
  });
}

// ── 1. A week before the test ───────────────────────────────────────────────────────────────
/** "Your SAT is next Saturday, November 7." at 7 days; "Your SAT is in 8 days, on …" otherwise. */
export function weekBeforeWhen(
  daysUntil: number | undefined,
  weekday: string,
  date: string,
): string {
  if (daysUntil === undefined || daysUntil === 7) {
    return `Your SAT is next ${weekday}, ${date}.`;
  }
  return `Your SAT is in ${daysUntil} days, on ${weekday}, ${date}.`;
}

export const SAT_WEEK_BEFORE_SUBJECT = "SAT: one week to go";

export function satWeekBeforeEmail(
  payload: SatWeekBeforePayload,
  ctx: RenderContext,
): EmailRender {
  const { weekday, date } = dateParts(payload.test_date);
  const practiceUrl = ctx.siteUrl ? `${ctx.siteUrl}/practice` : null;
  const blocks: Block[] = [
    { kind: "p", text: hi(payload.first_name) },
    {
      kind: "p",
      // Karl's copy at 7 days; anywhere else in the ±1-day window (Karl, 2026-11-02), the day
      // count from the day it was sent, so the line is never untrue.
      text: `${weekBeforeWhen(payload.days_until, weekday, date)} If you're still taking it, this week is about sharpening, not cramming.`,
    },
    {
      kind: "p",
      text: "One good plan for the week: one timed practice set to warm up, a quick review of your recent mistakes, and an early night before the test.",
    },
    ...(practiceUrl === null
      ? []
      : [
          {
            kind: "button" as const,
            label: "Practice for 10 minutes",
            url: practiceUrl,
          },
        ]),
    {
      kind: "p",
      text: "If your test date has changed, update it in Settings and we'll adjust everything to match.",
    },
    { kind: "p", text: "You've got this." },
  ];
  const body = compose(blocks);
  return emailRender({
    subject: SAT_WEEK_BEFORE_SUBJECT,
    preview: "This week is about sharpening, not cramming.",
    fromCategory: "general",
    html: body.html,
    text: body.text,
  });
}

// ── 2. The day after the test ───────────────────────────────────────────────────────────────
export const SAT_DAY_AFTER_SUBJECT = "SAT: you did it";

export function satDayAfterEmail(payload: SatDayAfterPayload): EmailRender {
  const blocks: Block[] = [
    { kind: "p", text: hi(payload.first_name) },
    {
      kind: "p",
      text: "Yesterday was a big day, and getting through it is an accomplishment in itself. Take a breath.",
    },
    ...(payload.release_date === null
      ? []
      : [
          {
            kind: "p" as const,
            text: `College Board releases scores on ${formatTestDate(payload.release_date)}. We'll send you a short reminder that day.`,
          },
        ]),
    {
      kind: "p",
      text: "If you're planning to take it again, everything you've worked on is still saved in Lyceon, and your next plan can pick up right where this one left off.",
    },
    { kind: "p", text: "Proud of you for putting in the work," },
  ];
  const body = compose(blocks);
  return emailRender({
    subject: SAT_DAY_AFTER_SUBJECT,
    preview: "Getting through it is an accomplishment in itself.",
    fromCategory: "general",
    html: body.html,
    text: body.text,
  });
}

// ── 3. Score release day ────────────────────────────────────────────────────────────────────
export const SAT_SCORES_RELEASED_SUBJECT =
  "SAT scores are out: how did you do?";

export function satScoresReleasedEmail(
  payload: SatScoresReleasedPayload,
  ctx: RenderContext,
): EmailRender {
  const formUrl = ctx.siteUrl
    ? `${ctx.siteUrl}/score-report?date=${encodeURIComponent(payload.test_date)}`
    : null;
  const blocks: Block[] = [
    { kind: "p", text: hi(payload.first_name) },
    {
      kind: "p",
      text: `College Board has released scores for the ${formatTestDate(payload.test_date)} SAT. Whatever your result, we'd love to hear it. It takes 30 seconds.`,
    },
    ...(formUrl === null
      ? []
      : [{ kind: "button" as const, label: "Enter my score", url: formUrl }]),
    {
      kind: "p",
      text: "Your score helps us make Lyceon better for you and, if you're retaking, plan your next step around exactly where you are now.",
    },
  ];
  const body = compose(blocks);
  return emailRender({
    subject: SAT_SCORES_RELEASED_SUBJECT,
    preview: "Whatever your result, we'd love to hear it.",
    fromCategory: "general",
    html: body.html,
    text: body.text,
  });
}

/** Email only (the emitters name no in_app channel); rendered for completeness of the switch. */
export function emailGateInApp(title: string): InAppRender {
  return { title, body: "", href: "/dashboard" };
}
