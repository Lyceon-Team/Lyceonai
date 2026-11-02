/**
 * The email send gate's code-level contract: every governed sender asks the gate, the five
 * emails carry Karl's copy word for word, and the transport sends governed and milestone email
 * from the tracked sender.
 *
 * @spec [owner brief "Email send gate" (Karl, 2026-10-30) "Acceptance" ("every governed sender
 *       calls the gate"); owner rulings 2026-11-02 rounds 1 and 2 (the copy; tracked sender);
 *       contracts/notifications.contract.md C15.3, C15.5; SCL-263] | @implemented [2026-11-02]
 *
 * plain English: the behaviour is proved on real Postgres (tests/ci/email-gate.pg.ci.test.ts
 * D1, L1). This file closes the other door: a NEW sender. It lists every server file that can
 * reach Resend's send call or a Resend automation event, and requires each to be either the
 * dispatcher or lifecycle rule (which ask the gate before sending) or a sender of `always` or
 * ops mail only. A new file that sends must be added here with its reason.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emailSenderTrackingOf,
  EMAIL_KINDS,
} from "../../packages/shared/src/email-gate";
import { createResendTransport } from "../../server/lib/notifications/transport";
import {
  guardianPausedEmail,
  pausedNoticeEmail,
  satDayAfterEmail,
  satScoresReleasedEmail,
  satWeekBeforeEmail,
} from "../../server/lib/notifications/templates/email-gate";

const ROOT = join(__dirname, "../..");

function serverFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...serverFiles(p));
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** Files that call the email transport or a Resend automation event, and why each is allowed. */
const SENDERS: Record<string, string> = {
  "server/lib/notifications/dispatch.ts":
    "asks the gate (emailGate) before every send",
  "server/lib/lifecycle-email.ts":
    "the rule asks deps.gate; onboarded/entitled are always",
  "server/lib/notifications/direct-sends.ts": "account deletion emails: always",
  "server/services/qotd/qotd-health.ts":
    "the owner's ops alerts: not student or guardian mail",
};

describe("email send gate — contract", () => {
  it("G1: every sender is known; the dispatcher and the lifecycle rule ask the gate before sending", () => {
    const found = serverFiles(join(ROOT, "server"))
      .filter((p) => !p.endsWith("notifications/transport.ts"))
      .filter((p) =>
        /defaultEmailTransport\(|createResendTransport\(|\.sendEvent\(/.test(
          readFileSync(p, "utf8"),
        ),
      )
      .map((p) => relative(ROOT, p))
      .sort();
    expect(found).toEqual(Object.keys(SENDERS).sort());

    const dispatch = readFileSync(
      join(ROOT, "server/lib/notifications/dispatch.ts"),
      "utf8",
    );
    const gateAt = dispatch.indexOf("const gate = await emailGate(");
    const refuseAt = dispatch.indexOf("if (!gate.value.allow)");
    const sendAt = dispatch.indexOf("const sent = await transport(");
    expect(gateAt).toBeGreaterThan(0);
    expect(refuseAt).toBeGreaterThan(gateAt);
    expect(sendAt).toBeGreaterThan(refuseAt);

    const lifecycle = readFileSync(
      join(ROOT, "server/lib/lifecycle-email.ts"),
      "utf8",
    );
    const rule = lifecycle.slice(
      lifecycle.indexOf("export async function runLifecycleRule("),
    );
    const ruleGate = rule.indexOf("await deps.gate(");
    const ruleSend = rule.indexOf("deps.contacts.sendEvent(");
    expect(ruleGate).toBeGreaterThan(0);
    expect(ruleSend).toBeGreaterThan(ruleGate);
    expect(rule.slice(ruleGate, ruleSend)).toContain("!gate.value.allow");
  });

  it("G2: governed and milestone kinds go out tracked; always and notice kinds untracked", () => {
    const tracked = EMAIL_KINDS.filter(
      (k) => emailSenderTrackingOf(k) === "tracked",
    );
    expect(tracked).toContain("qotd_daily");
    expect(tracked).toContain("sat_scores_released");
    expect(tracked).not.toContain("guardian_linked");
    expect(tracked).not.toContain("email_gate_paused_notice");
    expect(tracked).not.toContain("renewal_decision_requested");
  });

  it("G3: the transport sends `tracked` from NOTIFICATION_TRACKED_FROM_EMAIL, else the untracked address", async () => {
    const froms: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      froms.push((JSON.parse(String(init.body)) as { from: string }).from);
      return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const base = {
      idempotencyKey: "k",
      to: "someone@example.test",
      recipientProfileId: null,
      subject: "s",
      html: "<p>h</p>",
      text: "t",
      fromCategory: "general" as const,
      audience: "user_triggered" as const,
    };
    const both = createResendTransport({
      fetchImpl,
      env: {
        RESEND_API_KEY: "re_test",
        NOTIFICATION_FROM_EMAIL: "notifications@send.lyceon.test",
        NOTIFICATION_TRACKED_FROM_EMAIL: "notifications@lyceon.test",
      } as NodeJS.ProcessEnv,
    });
    await both({ ...base, sender: "tracked" });
    await both({ ...base, sender: "untracked" });
    await both(base);
    const untrackedOnly = createResendTransport({
      fetchImpl,
      env: {
        RESEND_API_KEY: "re_test",
        NOTIFICATION_FROM_EMAIL: "notifications@send.lyceon.test",
      } as NodeJS.ProcessEnv,
    });
    await untrackedOnly({ ...base, sender: "tracked" });
    expect(froms).toEqual([
      "Lyceon <notifications@lyceon.test>",
      "Lyceon <notifications@send.lyceon.test>",
      "Lyceon <notifications@send.lyceon.test>",
      "Lyceon <notifications@send.lyceon.test>",
    ]);
  });

  const ctx = {
    recipientIsSubject: true,
    siteUrl: "https://lyceon.test",
    emailGate: {
      keepPostedUrl: "https://lyceon.test/api/public/email/keep-posted?t=abc",
    },
  };

  it("T1: the student pause note is Karl's copy, the test-date line only with a date", () => {
    const withDate = pausedNoticeEmail(
      { first_name: "Maya", episode: 1, test_date: "2026-12-05" },
      ctx,
    );
    expect(withDate.subject).toBe("Pausing your SAT reminders");
    for (const line of [
      "Hi Maya,",
      "It's been a little while since your last study session, so we're pausing your study reminders. We'd rather send nothing than fill your inbox with emails you're not using.",
      "Your account, your progress and your study plan are all still here, exactly where you left them. When you're ready to pick it back up:",
      "* Log in and answer even one question. Your reminders switch back on automatically.",
      "* Or tap Keep me posted (https://lyceon.test/api/public/email/keep-posted?t=abc) to turn them back on now.",
      "Your SAT is on December 5. We'll send one short note about a week before, just in case.",
      "Whenever you're ready, we're here.",
      "Karl, Founder, Lyceon",
    ]) {
      expect(withDate.text).toContain(line);
    }
    expect(withDate.fromCategory).toBe("general");
    const noDate = pausedNoticeEmail(
      { first_name: "Maya", episode: 1, test_date: null },
      ctx,
    );
    expect(noDate.text).not.toContain("Your SAT is on");
  });

  it("T2: the parent pause email is Karl's copy", () => {
    const e = guardianPausedEmail(
      {
        student_first_name: "Maya",
        guardian_first_name: "Jo",
        test_date: "2026-12-05",
        episode: 1,
      },
      ctx,
    );
    expect(e.subject).toBe("Pausing Maya's daily SAT updates");
    expect(e.fromCategory).toBe("guardian");
    for (const line of [
      "Hi Jo,",
      "Maya hasn't studied on Lyceon in the past week, so we're pausing your daily updates. We'd rather respect your inbox than keep sending summaries with nothing new in them.",
      "A quiet week isn't unusual: school, sports and life get busy. With Maya's SAT on December 5, a quick check-in from home is sometimes all it takes to restart the habit.",
      "Updates switch back on automatically the moment Maya studies again. If you'd like them back sooner, tap Keep me posted (https://lyceon.test/api/public/email/keep-posted?t=abc).",
      "Thanks for being part of Maya's SAT prep,",
      "Karl, Founder, Lyceon",
    ]) {
      expect(e.text).toContain(line);
    }
  });

  it("T3: the three milestones are Karl's copy", () => {
    const week = satWeekBeforeEmail(
      { first_name: "Maya", test_date: "2026-12-05" },
      ctx,
    );
    expect(week.subject).toBe("SAT: one week to go");
    for (const line of [
      "Your SAT is next Saturday, December 5. If you're still taking it, this week is about sharpening, not cramming.",
      "One good plan for the week: one timed practice set to warm up, a quick review of your recent mistakes, and an early night before the test.",
      "Practice for 10 minutes: https://lyceon.test/practice",
      "If your test date has changed, update it in Settings and we'll adjust everything to match.",
      "You've got this.",
    ]) {
      expect(week.text).toContain(line);
    }
    const after = satDayAfterEmail({
      first_name: "Maya",
      test_date: "2026-12-05",
      release_date: "2026-12-18",
    });
    expect(after.subject).toBe("SAT: you did it");
    for (const line of [
      "Yesterday was a big day, and getting through it is an accomplishment in itself. Take a breath.",
      "College Board releases scores on December 18. We'll send you a short reminder that day.",
      "If you're planning to take it again, everything you've worked on is still saved in Lyceon, and your next plan can pick up right where this one left off.",
      "Proud of you for putting in the work,",
    ]) {
      expect(after.text).toContain(line);
    }
    expect(
      satDayAfterEmail({
        first_name: "Maya",
        test_date: "2026-12-05",
        release_date: null,
      }).text,
    ).not.toContain("College Board releases scores");
    const scores = satScoresReleasedEmail(
      {
        first_name: "Maya",
        test_date: "2026-12-05",
        release_date: "2026-12-18",
      },
      ctx,
    );
    expect(scores.subject).toBe("SAT scores are out: how did you do?");
    for (const line of [
      "College Board has released scores for the December 5 SAT. Whatever your result, we'd love to hear it. It takes 30 seconds.",
      "Enter my score: https://lyceon.test/score-report?date=2026-12-05",
      "Your score helps us make Lyceon better for you and, if you're retaking, plan your next step around exactly where you are now.",
    ]) {
      expect(scores.text).toContain(line);
    }
  });
});
