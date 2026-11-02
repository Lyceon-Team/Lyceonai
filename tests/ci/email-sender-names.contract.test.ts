/**
 * Notification emails: a sender name per email type, and a Question of the Day subject and
 * preview line that say what is inside without giving anything away.
 *
 * @spec [owner brief "Notification emails — sender name per email type + subject/preview that
 *       earns the open" (Karl, 2026-10-14), acceptance evidence; Karl's Step 0 rulings 1-4 and
 *       the accepted push-back (category chosen per email, by recipient)] | @implemented [2026-10-14]
 *
 * plain English: one block per acceptance rule.
 *   S1  every email goes out under its category's sender name — each template, by recipient, and
 *       through the real transport's `from` header
 *   S2  an unknown category falls back to "Lyceon"
 *   S3  an unsafe name is cleaned before it reaches a header
 *   S4  the QOTD subject always starts with "SAT Question of the Day"
 *   S5  it switches between the domain and streak versions at exactly 2 days
 *   S6  every email's preview line is present, correct, and the first text in its HTML
 *   S7  no QOTD subject or preview contains the answer — run over every real authored question
 *   S8  a missing NOTIFICATION_FROM_EMAIL still refuses to send
 *
 * Fixtures are real: payloads are parsed by the real strict schemas inside the real registry,
 * and the S7 questions are the bank's own authored records (content/canonical), passed through
 * the real row schema and the real row-to-email projection the dispatcher uses.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  EMAIL_SENDER_NAMES,
  emailSenderName,
  formatFromHeader,
  sanitizeSenderName,
} from "../../packages/shared/src/email-sender";
import { qotdEmailSubject } from "../../packages/shared/src/home-qotd-schema";
import { questionDifficultyLabel } from "../../packages/shared/src/question-difficulty";
import { qotdRowSchema } from "../../shared/qotd/projection";
import { sectionDisplayLabel } from "../../shared/section-display";
import { qotdEmailQuestionFields } from "../../server/lib/notifications/qotd-daily-send-context";
import {
  renderEmail,
  type EmailRender,
  type RenderContext,
} from "../../server/lib/notifications/templates";
import { deletionCompletedEmail } from "../../server/lib/notifications/templates/deletion-completed";
import { deletionScheduledEmail } from "../../server/lib/notifications/templates/deletion-scheduled";
import { guardianLinkInviteEmail } from "../../server/lib/notifications/templates/guardian-link-invite";
import {
  QOTD_PAUSED_PREVIEW,
  qotdDailyEmail,
  qotdPreviewLine,
  qotdPreviewQuestion,
} from "../../server/lib/notifications/templates/qotd-daily";
import { createResendTransport } from "../../server/lib/notifications/transport";

const SITE = "https://lyceon.example";
const FROM = "notifications@send.example.test";
const student: RenderContext = { recipientIsSubject: true, siteUrl: SITE };
const guardian: RenderContext = { recipientIsSubject: false, siteUrl: SITE };
const UUID = "6f1c1f0e-5d2a-4b1e-9a43-2c7d8e9f0a1b";
const QOTD_CTX: RenderContext = {
  ...student,
  qotdEmail: {
    stem: "If $3x + 11 = 47$, what is the value of $x$?",
    meta: { section: "M", domain: "Algebra", difficulty: 2 },
    unsubscribeUrl: `${SITE}/api/public/qotd-email/unsubscribe?t=x`,
    resumeUrl: `${SITE}/api/public/qotd-email/resume?t=x`,
  },
};

function rendered(
  type: Parameters<typeof renderEmail>[0],
  payload: unknown,
  ctx: RenderContext,
): EmailRender {
  const r = renderEmail(type, payload, ctx);
  if (!r.ok) throw new Error(`${type} did not render: ${r.error}`);
  return r.value;
}

/** Every email the system sends, by recipient, with the sender category Karl set. */
const CASES: Array<{
  name: string;
  email: () => EmailRender;
  category: keyof typeof EMAIL_SENDER_NAMES;
  subject: string;
  preview: string;
}> = [
  {
    name: "QOTD daily (no streak)",
    email: () =>
      rendered(
        "qotd_daily",
        { qotd_date: "2026-10-14", current_streak: 0, email_variant: "daily" },
        QOTD_CTX,
      ),
    category: "qotd",
    subject: "SAT Question of the Day: one Algebra question",
    preview:
      "Math · Algebra · Medium: If 3x + 11 = 47, what is the value of x? Answer it today.",
  },
  {
    name: "QOTD daily (5-day streak)",
    email: () =>
      rendered(
        "qotd_daily",
        { qotd_date: "2026-10-14", current_streak: 5, email_variant: "daily" },
        QOTD_CTX,
      ),
    category: "qotd",
    subject: "SAT Question of the Day: keep your 5-day streak",
    preview:
      "Math · Algebra · Medium: If 3x + 11 = 47, what is the value of x? Answer it today.",
  },
  {
    name: "QOTD paused",
    email: () =>
      rendered(
        "qotd_daily",
        {
          qotd_date: "2026-10-14",
          current_streak: 0,
          email_variant: "paused_notice",
        },
        {
          ...QOTD_CTX,
          qotdEmail: { ...QOTD_CTX.qotdEmail!, stem: null, meta: null },
        },
      ),
    category: "qotd",
    subject: "SAT Question of the Day is paused",
    preview: "You haven't opened it in a while. Turn it back on in Settings.",
  },
  {
    name: "full-length tomorrow",
    email: () =>
      rendered(
        "full_length_tomorrow",
        { block_id: UUID, local_date: "2026-10-17" },
        student,
      ),
    category: "study_plan",
    subject: "SAT full-length test tomorrow, Saturday 17 October",
    preview: "Set aside about three hours. It's on your study plan.",
  },
  {
    name: "full-length this week",
    email: () =>
      rendered(
        "full_length_week",
        { block_id: UUID, local_date: "2026-10-17" },
        student,
      ),
    category: "study_plan",
    subject: "SAT full-length test this week: Saturday 17 October",
    preview: "It takes about three hours, so plan ahead.",
  },
  {
    name: "missed plan (student)",
    email: () =>
      rendered(
        "missed_plan_alert",
        {
          student_first_name: "Maya",
          missed_days: 3,
          last_missed_date: "2026-10-13",
          digest_date: "2026-10-13",
        },
        student,
      ),
    category: "study_plan",
    subject: "Your SAT study plan is waiting",
    preview:
      "3 planned days missed. Start with today's first session when you're ready.",
  },
  {
    name: "missed plan (guardian)",
    email: () =>
      rendered(
        "missed_plan_alert",
        {
          student_first_name: "Maya",
          missed_days: 3,
          last_missed_date: "2026-10-13",
          digest_date: "2026-10-13",
        },
        guardian,
      ),
    category: "guardian",
    subject: "Maya hasn't studied for 3 planned days",
    preview:
      "Maya had work planned on 3 study days in a row and didn't do any of it.",
  },
  {
    name: "back on track (student)",
    email: () =>
      rendered(
        "back_on_track",
        {
          student_first_name: "Maya",
          back_on_date: "2026-10-14",
          digest_date: "2026-10-14",
        },
        student,
      ),
    category: "study_plan",
    subject: "You're back on track with your SAT study plan",
    preview: "You did planned work again. Keep it going tomorrow.",
  },
  {
    name: "study plan changed (guardian)",
    email: () =>
      rendered(
        "study_plan_changed",
        {
          kind: "day_reduced",
          student_first_name: "Maya",
          plan_date: "2026-10-15",
          before_minutes: 45,
          after_minutes: 15,
          digest_date: "2026-10-14",
        },
        guardian,
      ),
    category: "guardian",
    subject: "Maya changed their SAT study plan",
    preview:
      "Maya reduced the plan for Thursday 15 October from 45 min to 15 min.",
  },
  {
    name: "guardian daily digest",
    email: () =>
      rendered(
        "guardian_daily_digest",
        {
          digest_date: "2026-10-13",
          students: [
            {
              student_first_name: "Maya",
              completion: { planned: 3, completed: 2 },
              plan_changes: [],
              missed_plan_alert: null,
              back_on_track: false,
            },
          ],
        },
        guardian,
      ),
    category: "guardian",
    subject: "Maya's SAT prep today",
    preview: "Maya completed 2 of 3 planned sessions today so far",
  },
  {
    name: "guardian linked (guardian)",
    email: () =>
      rendered(
        "guardian_linked",
        { link_id: UUID, student_display_name: "Maya" },
        guardian,
      ),
    category: "guardian",
    subject: "You're now linked to Maya on Lyceon",
    preview: "Maya's SAT progress summary is now on your dashboard.",
  },
  {
    name: "guardian unlinked (student)",
    email: () =>
      rendered(
        "guardian_unlinked",
        {
          link_id: UUID,
          student_display_name: "Maya",
          guardian_display_name: "Alex",
        },
        student,
      ),
    category: "general",
    subject: "Alex is no longer linked to your Lyceon account",
    preview:
      "They can't see your progress anymore. You can share a new code anytime.",
  },
  {
    name: "guardian unlinked (guardian)",
    email: () =>
      rendered(
        "guardian_unlinked",
        {
          link_id: UUID,
          student_display_name: "Maya",
          guardian_display_name: "Alex",
        },
        guardian,
      ),
    category: "guardian",
    subject: "Your link to Maya on Lyceon was removed",
    preview:
      "You no longer see Maya's progress. Ask them for a new code to reconnect.",
  },
  {
    name: "score report request",
    email: () =>
      rendered(
        "exam_score_report_requested",
        { anchor: "exam_date", occasion_key: "2026-10-04" },
        student,
      ),
    category: "general",
    subject: "How did your SAT go? Two quick questions",
    preview:
      "Your scores should be out. Tell us your score and whether you're retaking it.",
  },
  {
    name: "renewal decision (guardian payer)",
    email: () =>
      rendered(
        "renewal_decision_requested",
        { anchor: "billing_cycle", occasion_key: "2026-11-01" },
        guardian,
      ),
    category: "general",
    subject: "Keep your student's Lyceon subscription?",
    preview:
      "Tell us to keep going or stop. With no reply, it ends when your paid period ends.",
  },
  {
    name: "guardian invite (direct send)",
    email: () =>
      guardianLinkInviteEmail({
        studentDisplayName: "Maya",
        code: "ABCD1234",
        redeemUrl: `${SITE}/guardian?code=ABCD1234`,
        expiresAt: "2026-10-21T00:00:00Z",
      }),
    category: "guardian",
    subject: "Maya invited you to follow their SAT prep on Lyceon",
    preview:
      "Use the code to see their progress summary. It expires Wed, 21 Oct 2026 00:00:00 GMT.",
  },
  {
    name: "deletion scheduled (direct send)",
    email: () =>
      deletionScheduledEmail({
        recoverUrl: `${SITE}/account/restore?t=x`,
        scheduledHardDeleteAt: "2026-10-21T00:00:00Z",
      }),
    category: "general",
    subject: "Your Lyceon account is scheduled for deletion",
    preview:
      "It will be deleted on Wed, 21 Oct 2026 00:00:00 GMT. Restore it before then if you didn't ask for this.",
  },
  {
    name: "deletion completed (direct send)",
    email: () =>
      deletionCompletedEmail({ completedAt: "2026-10-14T00:00:00Z" }),
    category: "general",
    subject: "Your Lyceon account has been deleted",
    preview:
      "Your account and its data were deleted on Wed, 14 Oct 2026 00:00:00 GMT.",
  },
];

/** The visible text of the first element inside <body>: what an inbox reads as the preview. */
function firstBodyText(html: string): string {
  const afterBody = html.replace(/^[\s\S]*?<body[^>]*>/i, "");
  const firstText = /^\s*<div[^>]*>([^<]*)/.exec(afterBody)?.[1] ?? "";
  return firstText
    .replace(/(&#847;|&zwnj;|&nbsp;)+$/g, "")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** A transport that records the request and never reaches the network. */
function capturingTransport(env: NodeJS.ProcessEnv) {
  const bodies: Array<Record<string, unknown>> = [];
  const transport = createResendTransport({
    env,
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
    },
  });
  return { transport, bodies };
}

const ENV = { RESEND_API_KEY: "re_test", NOTIFICATION_FROM_EMAIL: FROM };

describe("S1: every email goes out under its category's sender name", () => {
  it("the map holds exactly Karl's four names", () => {
    expect(EMAIL_SENDER_NAMES).toEqual({
      qotd: "Lyceon Question of the Day",
      study_plan: "Lyceon Study Plan",
      guardian: "Lyceon for Parents",
      general: "Lyceon",
    });
  });

  it.each(CASES.map((c) => [c.name, c] as const))(
    "%s: the template picks its category and the transport writes the From header",
    async (_name, c) => {
      const email = c.email();
      expect(email.fromCategory).toBe(c.category);
      const { transport, bodies } = capturingTransport(ENV);
      const sent = await transport({
        idempotencyKey: "k",
        to: "someone@example.test",
        recipientProfileId: null,
        subject: email.subject,
        html: email.html,
        text: email.text,
        fromCategory: email.fromCategory,
        audience: "ops",
      });
      expect(sent.ok).toBe(true);
      expect(bodies).toHaveLength(1);
      expect(bodies[0]!.from).toBe(
        `${EMAIL_SENDER_NAMES[c.category]} <${FROM}>`,
      );
    },
  );
});

describe("S2: an unknown or missing category falls back to Lyceon", () => {
  it.each([["bogus"], [undefined], [null], [""], [42]])("%s", async (cat) => {
    expect(emailSenderName(cat)).toBe("Lyceon");
    expect(formatFromHeader(cat, FROM)).toBe(`Lyceon <${FROM}>`);
    const { transport, bodies } = capturingTransport(ENV);
    const input = {
      idempotencyKey: "k",
      to: "someone@example.test",
      recipientProfileId: null,
      subject: "s",
      html: "<p>h</p>",
      text: "t",
      audience: "ops" as const,
    };
    // A value from outside the type system (a stale caller), passed as the transport sees it.
    await transport(
      JSON.parse(JSON.stringify({ ...input, fromCategory: cat })),
    );
    expect(bodies[0]!.from).toBe(`Lyceon <${FROM}>`);
  });
});

describe("S3: an unsafe name is sanitized", () => {
  it("strips <, >, quotes and line breaks, and never comes back empty", () => {
    const evil = 'Lyceon "Team" <x@evil.test>\r\nBcc: victim@example.test';
    const clean = sanitizeSenderName(evil);
    expect(clean).not.toMatch(/[<>"\r\n]/);
    expect(clean).toBe("Lyceon Team x@evil.test Bcc: victim@example.test");
    expect(sanitizeSenderName('<>"\r\n')).toBe("Lyceon");
  });

  it("a bad entry in the map is cleaned on the way into the From header", () => {
    const dirty = {
      ...EMAIL_SENDER_NAMES,
      study_plan: 'Plan"\r\nBcc: x@y.test',
    };
    const name = emailSenderName("study_plan", dirty);
    expect(name).toBe("Plan Bcc: x@y.test");
    expect(name).not.toMatch(/[<>"\r\n]/);
  });
});

const DOMAINS = [
  "Algebra",
  "Advanced Math",
  "Problem-Solving and Data Analysis",
  "Geometry and Trigonometry",
  "Information and Ideas",
  "Craft and Structure",
  "Expression of Ideas",
  "Standard English Conventions",
];

describe("S4: the QOTD subject always starts with 'SAT Question of the Day'", () => {
  it("for every domain and every streak from 0 to 400", () => {
    for (const domain of [...DOMAINS, "", "  "]) {
      for (let streak = 0; streak <= 400; streak++) {
        const subject = qotdEmailSubject({ currentStreak: streak, domain });
        expect(subject.startsWith("SAT Question of the Day: ")).toBe(true);
        expect(subject).not.toMatch(/\p{Extended_Pictographic}|\bDay \d+:/u);
      }
    }
  });
});

describe("S5: the streak version starts at exactly 2 days", () => {
  it.each([
    [0, "SAT Question of the Day: one Algebra question"],
    [1, "SAT Question of the Day: one Algebra question"],
    [2, "SAT Question of the Day: keep your 2-day streak"],
    [3, "SAT Question of the Day: keep your 3-day streak"],
    [365, "SAT Question of the Day: keep your 365-day streak"],
  ])("streak %i", (streak, subject) => {
    expect(qotdEmailSubject({ currentStreak: streak, domain: "Algebra" })).toBe(
      subject,
    );
  });

  it("a blank domain still reads as a sentence", () => {
    expect(qotdEmailSubject({ currentStreak: 0, domain: " " })).toBe(
      "SAT Question of the Day: one question",
    );
  });
});

describe("S6: every email's preview line is present, correct, and first in its HTML", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const email = c.email();
    // Presence before content: the subject and preview are non-trivial.
    expect(email.subject).toBe(c.subject);
    expect(email.preview).toBe(c.preview);
    expect(firstBodyText(email.html)).toBe(c.preview);
    // Hidden: the preheader is not displayed in the body.
    expect(email.html).toMatch(/<body[^>]*><div style="display:none;/);
  });

  it("the QOTD preview cuts a long question at a word, never mid-word, with an ellipsis", () => {
    const q = qotdPreviewQuestion(
      "A marine biologist recorded the number of fish observed at each of twelve reef sites over three seasons. Which choice best describes the data?",
    );
    expect(q).toBe(
      "A marine biologist recorded the number of fish observed at…",
    );
    expect((q ?? "").length).toBeLessThanOrEqual(61);
  });

  it("maths the reader cannot say leaves the question out, never raw LaTeX", () => {
    const preview = qotdPreviewLine({
      section: "M",
      domain: "Advanced Math",
      difficulty: 3,
      stem: "Evaluate $\\int_0^1 x\\,dx$.",
    });
    expect(preview).toBe("Math · Advanced Math · Hard. Answer it today.");
  });

  it("the paused notice keeps Karl's condition: Settings, not 'one click'", () => {
    expect(QOTD_PAUSED_PREVIEW).not.toMatch(/one click/i);
  });
});

describe("S7: no QOTD subject or preview contains the answer (every authored question)", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const dir = path.join(ROOT, "content/canonical");
  const records = fs
    .readdirSync(dir)
    .filter((d) => d.endsWith("_parts"))
    .flatMap((d) =>
      fs
        .readdirSync(path.join(dir, d))
        .filter((f) => f.endsWith(".ndjson"))
        .flatMap((f) =>
          fs
            .readFileSync(path.join(dir, d, f), "utf-8")
            .split("\n")
            .filter((l) => l.trim().length > 0)
            .map((l) => JSON.parse(l) as Record<string, unknown>),
        ),
    );

  it("reads a real, non-trivial bank (presence before absence)", () => {
    expect(records.length).toBeGreaterThan(3000);
  });

  it("subject and preview come from metadata and the stem only, for every question", () => {
    let checked = 0;
    for (const [i, rec] of records.entries()) {
      const options = Array.isArray(rec.options)
        ? (rec.options as Array<{ key: string; text: string }>)
        : [];
      const correctText =
        rec.item_type === "mcq"
          ? (options.find((o) => o.key === rec.correct_option)?.text ?? "")
          : String(rec.correct_answer ?? "");
      // The row exactly as qotd_question_for returns it: answer, options and explanation on it.
      const row = qotdRowSchema.parse({
        qotd_date: "2026-10-14",
        question_id: `Q${i}`,
        section: rec.section,
        domain: rec.domain,
        skill_codes: null,
        difficulty: rec.difficulty,
        item_type: rec.item_type,
        stem: rec.stem,
        passage: rec.passage ?? null,
        options: rec.options ?? null,
        correct_answer:
          rec.item_type === "mcq" ? String(rec.correct_option) : correctText,
        correct_variants: null,
        explanation: rec.explanation,
        // SCL-258 columns; the email reads neither (asserted below: metadata and stem only).
        option_order: rec.item_type === "mcq" ? options.map((o) => o.key) : [],
        correct_display_letter:
          rec.item_type === "mcq"
            ? (["A", "B", "C", "D"][
                options.findIndex((o) => o.key === rec.correct_option)
              ] ?? null)
            : null,
      });
      const fields = qotdEmailQuestionFields(row);
      expect(Object.keys(fields).sort()).toEqual(["meta", "stem"]);
      expect(Object.keys(fields.meta ?? {}).sort()).toEqual([
        "difficulty",
        "domain",
        "section",
      ]);
      for (const streak of [0, 4]) {
        const email = qotdDailyEmail({
          currentStreak: streak,
          stem: fields.stem ?? "",
          meta: fields.meta!,
          siteUrl: SITE,
          unsubscribeUrl: null,
        });
        // Structure: the subject names only the domain (or the streak) ...
        expect([
          `SAT Question of the Day: one ${row.domain} question`,
          `SAT Question of the Day: keep your ${streak}-day streak`,
        ]).toContain(email.subject);
        // ... and the preview is the metadata lead, then the start of the stem, then the closer.
        const lead = [
          sectionDisplayLabel(row.section),
          row.domain,
          questionDifficultyLabel(row.difficulty),
        ]
          .filter((p) => p !== null)
          .join(" · ");
        expect(email.preview.startsWith(lead)).toBe(true);
        expect(email.preview.endsWith("Answer it today.")).toBe(true);
        const question = qotdPreviewQuestion(row.stem);
        if (question !== null) {
          expect(email.preview).toBe(`${lead}: ${question} Answer it today.`);
        }
        // Content: never the explanation, and never the keyed answer unless the stem itself
        // already shows those words (a grid-in "2" in "2x" cannot be told apart).
        for (const part of [email.subject, email.preview]) {
          expect(part).not.toContain(row.explanation ?? "\u0000");
          const answer = correctText.replace(/\$/g, "").trim();
          if (answer.length >= 3 && !row.stem.includes(answer)) {
            expect(part, `${String(rec.domain)} #${i}`).not.toContain(answer);
          }
        }
      }
      checked++;
    }
    expect(checked).toBe(records.length);
  });
});

describe("S8: a missing NOTIFICATION_FROM_EMAIL still refuses to send", () => {
  it("returns config_missing and makes no request", async () => {
    const { transport, bodies } = capturingTransport({
      RESEND_API_KEY: "re_test",
    });
    const sent = await transport({
      idempotencyKey: "k",
      to: "someone@example.test",
      recipientProfileId: null,
      subject: "s",
      html: "<p>h</p>",
      text: "t",
      fromCategory: "qotd",
      audience: "ops",
    });
    expect(sent.ok).toBe(false);
    if (!sent.ok) expect(sent.error.kind).toBe("config_missing");
    expect(bodies).toHaveLength(0);
  });
});
