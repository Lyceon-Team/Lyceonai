/**
 * "Feedback" across the site: the context it carries, the route, the Slack line and where the
 * entry appears.
 *
 * @spec [final brief "Trustpilot card on the homepage + 'Feedback' across the site" (Karl,
 *       2026-10-20) §3 (type, 2,000-character message, reply-OK hidden and refused for
 *       under-13s, route pattern only, app version), §4 (server-side Zod, the existing rate
 *       limit, text never logged), §5 (Slack: always type, route, role, age band, reply-OK; text
 *       only for 18+, at most 300 characters; never names, emails or ids; a Slack failure never
 *       fails the submission), §6 (counts only), acceptance "Tests"; SCL-237]
 *       | @implemented [2026-10-20]
 *
 * plain English: the pure helpers over real inputs; then the real router and service over an
 * in-memory stand-in for `product_feedback_submit`, with the REAL Slack poster talking to a
 * stubbed `fetch` (so what reaches Slack is what the code builds); then source checks that the
 * account menu (the only place Send feedback lives) is absent from the focus layout that the
 * practice, review and test screens use. The SQL is proved on Postgres by
 * feedback-context.pg.ci.test.ts.
 */
import { readFileSync } from "node:fs";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FEEDBACK_MAX_LENGTH,
  feedbackAgeBand,
  feedbackReplyAllowed,
  feedbackSubmitSchema,
  toRoutePattern,
} from "../../packages/shared/src/product-feedback-schema";
import { STUDENT_ROUTE_SHELLS } from "../../client/src/lib/route-shells";
import { SlackCallError } from "../../shared/slack/client";
import { redactChannel } from "../../server/lib/feedback-slack";

const rateLimitBuckets: string[] = [];
vi.mock("../../server/middleware/rate-limit", () => ({
  singleBucketRateLimit: (bucket: string) => {
    rateLimitBuckets.push(bucket);
    return (_req: Request, _res: Response, next: NextFunction) => next();
  },
}));
const logged: unknown[] = [];
vi.mock("../../server/logger", () => {
  const record = (...args: unknown[]) => {
    logged.push(args);
  };
  return {
    logger: { info: record, warn: record, error: record, debug: record },
  };
});
const emitted: { name: string; payload: Record<string, unknown> }[] = [];
vi.mock("../../server/lib/analytics/emit-event", () => ({
  emitEvent: async (
    _id: string,
    name: string,
    payload: Record<string, unknown>,
  ) => {
    emitted.push({ name, payload });
    return { ok: true };
  },
}));

const NOW = new Date("2026-10-20T15:00:00Z");
const AGE = (years: number): string => `${NOW.getUTCFullYear() - years}-01-01`;
const KNOWN = Object.keys(STUDENT_ROUTE_SHELLS);
const SESSION = "5e5e5e5e-1111-4222-8333-444444444444";
const KEY = "7a7a7a7a-1111-4222-8333-444444444444";
const PROFILE_ID = "0f0f0f0f-1111-4222-8333-444444444444";
const SECRET = "SECRET-FEEDBACK-TEXT";

// ── 1. The context ──────────────────────────────────────────────────────────

describe("the route pattern: no real ids, no query string", () => {
  it("a known route reads as its pattern; ids, queries and fragments never survive", () => {
    expect(toRoutePattern(`/practice/session/${SESSION}?step=3#q`, KNOWN)).toBe(
      "/practice/session/:sessionId",
    );
    expect(toRoutePattern(`/tests/${SESSION}/RW/1`, KNOWN)).toBe(
      "/tests/:sessionId/:section/:module",
    );
    expect(toRoutePattern("/dashboard?review=email", KNOWN)).toBe("/dashboard");
    expect(toRoutePattern(`/guardian/${SESSION}/calendar`, KNOWN)).toBe(
      "/guardian/:id/calendar",
    );
    expect(toRoutePattern("/", KNOWN)).toBe("/");
  });

  it("the server refuses anything shaped like a URL with an id or a query", () => {
    const base = {
      body: "x",
      source: "menu",
      idempotency_key: KEY,
      type: "bug",
      reply_ok: false,
      app_version: "abc1234",
    };
    for (const bad of [
      `/practice/session/${SESSION}`,
      "/dashboard?x=1",
      "/dashboard#top",
      "/Dashboard",
      "https://lyceon.ai/dashboard",
      "/" + "a".repeat(130),
    ]) {
      expect([
        bad,
        feedbackSubmitSchema.safeParse({ ...base, route_pattern: bad }).success,
      ]).toEqual([bad, false]);
    }
    expect(
      feedbackSubmitSchema.safeParse({
        ...base,
        route_pattern: "/practice/session/:sessionId",
      }).success,
    ).toBe(true);
  });

  it("the app version is a short commit or dev, nothing else", () => {
    const base = {
      body: "x",
      source: "menu",
      idempotency_key: KEY,
      type: "idea",
      reply_ok: false,
      route_pattern: null,
    };
    expect(
      feedbackSubmitSchema.safeParse({ ...base, app_version: "abc1234" })
        .success,
    ).toBe(true);
    expect(
      feedbackSubmitSchema.safeParse({ ...base, app_version: "dev" }).success,
    ).toBe(true);
    expect(
      feedbackSubmitSchema.safeParse({ ...base, app_version: "1.0.0" }).success,
    ).toBe(false);
  });

  it("the type is Bug, Idea or Something else; the message is required and capped at 2,000", () => {
    const base = {
      source: "menu",
      idempotency_key: KEY,
      reply_ok: false,
      route_pattern: null,
      app_version: null,
    };
    expect(
      feedbackSubmitSchema.safeParse({ ...base, type: "rant", body: "x" })
        .success,
    ).toBe(false);
    expect(
      feedbackSubmitSchema.safeParse({ ...base, type: "other", body: "  " })
        .success,
    ).toBe(false);
    expect(
      feedbackSubmitSchema.safeParse({
        ...base,
        type: "other",
        body: "x".repeat(FEEDBACK_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      feedbackSubmitSchema.safeParse({
        ...base,
        type: "other",
        body: "x".repeat(FEEDBACK_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("a body from the previous bundle (no new fields) still parses, with no reply and no page", () => {
    const parsed = feedbackSubmitSchema.safeParse({
      body: "x",
      source: "settings",
      idempotency_key: KEY,
    });
    expect(parsed.success && parsed.data).toEqual({
      body: "x",
      source: "settings",
      idempotency_key: KEY,
      type: "other",
      reply_ok: false,
      route_pattern: null,
      app_version: null,
    });
  });

  it("age bands and who may ask for a reply", () => {
    expect(feedbackAgeBand(AGE(18), NOW)).toBe("18+");
    expect(feedbackAgeBand(AGE(17), NOW)).toBe("13–17");
    expect(feedbackAgeBand(AGE(12), NOW)).toBe("under 13");
    expect(feedbackAgeBand(null, NOW)).toBe("unknown");
    expect(feedbackReplyAllowed("student", AGE(12), NOW)).toBe(false);
    expect(feedbackReplyAllowed("student", null, NOW)).toBe(false);
    expect(feedbackReplyAllowed("student", AGE(13), NOW)).toBe(true);
    expect(feedbackReplyAllowed("guardian", null, NOW)).toBe(true);
  });
});

// ── 2. The route, the real Slack poster over a stubbed fetch ────────────────

type Profile = { role: string; date_of_birth: string | null };

const slackCalls: { url: string; body: Record<string, unknown> }[] = [];
let slackAnswer: () => Promise<Response> = async () =>
  Response.json({ ok: true, ts: "1.2" });

function harness(profile: Profile) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const keys = new Set<string>();
  const db = {
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args });
      if (fn === "product_feedback_submit") {
        const k = String(args.p_idempotency_key);
        const created = !keys.has(k);
        keys.add(k);
        return {
          data: { outcome: created ? "created" : "replayed" },
          error: null,
        };
      }
      return { data: null, error: { message: `unexpected ${fn}` } };
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              ...profile,
              is_under_13:
                profile.date_of_birth === null ||
                feedbackAgeBand(profile.date_of_birth, NOW) === "under 13",
            },
            error: null,
          }),
        }),
      }),
    }),
  };
  return {
    calls,
    async app() {
      const { createProductFeedbackRouter } =
        await import("../../server/routes/product-feedback-routes");
      const app = express();
      app.use(express.json());
      app.use((req: Request, _res: Response, next: NextFunction) => {
        (req as Request & { user?: unknown }).user = {
          id: PROFILE_ID,
          role: profile.role,
        };
        req.requestId = "req-feedback";
        next();
      });
      app.use(
        "/api/feedback",
        createProductFeedbackRouter({
          db: () => db as never,
          moments: () => ({
            usageMet: async () => false,
            checklistActive: async () => true,
          }),
          now: () => NOW,
        }),
      );
      return app;
    },
  };
}

const send = (over: Record<string, unknown> = {}) => ({
  body: `${SECRET} the timer kept going after I paused`,
  source: "menu",
  idempotency_key: KEY,
  type: "bug",
  reply_ok: false,
  route_pattern: "/practice/session/:sessionId",
  app_version: "abc1234",
  ...over,
});

function slackText(): string {
  const call = slackCalls.at(-1);
  if (call === undefined) throw new Error("no Slack call");
  return String(call.body.text);
}

describe("POST /api/feedback/feedback", () => {
  beforeEach(() => {
    logged.length = 0;
    emitted.length = 0;
    slackCalls.length = 0;
    slackAnswer = async () => Response.json({ ok: true, ts: "1.2" });
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test-token");
    vi.stubEnv("SOCIAL_SLACK_CHANNEL_ID", "C0123456789");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body?: string }) => {
        slackCalls.push({
          url,
          body: JSON.parse(init.body ?? "{}") as Record<string, unknown>,
        });
        return slackAnswer();
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("stores the type, reply choice, route pattern and app version, on the per-profile bucket", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(16) });
    const res = await request(await h.app())
      .post("/api/feedback/feedback")
      .send(send({ reply_ok: true }));
    expect(res.status).toBe(201);
    expect(
      h.calls.find((c) => c.fn === "product_feedback_submit")?.args,
    ).toMatchObject({
      p_audience: "student",
      p_type: "bug",
      p_reply_ok: true,
      p_route_pattern: "/practice/session/:sessionId",
      p_app_version: "abc1234",
    });
    expect(rateLimitBuckets).toContain("product_feedback");
  });

  it("guardians can send too", async () => {
    const h = harness({ role: "guardian", date_of_birth: AGE(40) });
    const res = await request(await h.app())
      .post("/api/feedback/feedback")
      .send(send({ route_pattern: "/guardian/:id" }));
    expect(res.status).toBe(201);
    expect(
      h.calls.find((c) => c.fn === "product_feedback_submit")?.args,
    ).toMatchObject({ p_audience: "guardian" });
  });

  it("an under-13 student cannot ask for a reply: 403, nothing stored, nothing posted", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(12) });
    const res = await request(await h.app())
      .post("/api/feedback/feedback")
      .send(send({ reply_ok: true }));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("REPLY_NOT_ALLOWED");
    expect(h.calls).toEqual([]);
    expect(slackCalls).toEqual([]);
    // Without the reply, the same student's feedback is accepted (always available).
    const ok = await request(await h.app())
      .post("/api/feedback/feedback")
      .send(send({ idempotency_key: "8b8b8b8b-1111-4222-8333-444444444444" }));
    expect(ok.status).toBe(201);
  });

  it("a real id or a query string in the page is a 400 and nothing is stored", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(16) });
    const res = await request(await h.app())
      .post("/api/feedback/feedback")
      .send(send({ route_pattern: `/practice/session/${SESSION}` }));
    expect(res.status).toBe(400);
    expect(h.calls).toEqual([]);
  });

  it("Slack, 18+: every fact, and the text cut at 300 characters with an ellipsis", async () => {
    const long = `${SECRET} ${"a".repeat(400)}`;
    const h = harness({ role: "student", date_of_birth: AGE(19) });
    await request(await h.app())
      .post("/api/feedback/feedback")
      .send(send({ body: long, reply_ok: true }));
    expect(slackCalls).toHaveLength(1);
    expect(slackCalls[0]?.url).toBe("https://slack.com/api/chat.postMessage");
    expect(slackCalls[0]?.body.channel).toBe("C0123456789");
    const [head, quote] = slackText().split("\n");
    expect(head).toBe(
      "New feedback · Bug · student · 18+ · /practice/session/:sessionId · reply OK",
    );
    expect(quote?.startsWith(`> ${SECRET} aaa`)).toBe(true);
    expect(quote?.endsWith("…")).toBe(true);
    expect([...(quote ?? "").slice(2)]).toHaveLength(300);
  });

  it("Slack, under 18 (13–17, under 13, unknown age): never the text", async () => {
    for (const [role, dob, band] of [
      ["student", AGE(17), "13–17"],
      ["student", AGE(12), "under 13"],
      ["guardian", null, "unknown"],
    ] as const) {
      slackCalls.length = 0;
      const h = harness({ role, date_of_birth: dob });
      const res = await request(await h.app())
        .post("/api/feedback/feedback")
        .send(send({ type: "idea" }));
      expect(res.status).toBe(201);
      expect(slackCalls).toHaveLength(1); // presence first
      const text = slackText();
      expect(text).toContain(`· ${band} ·`);
      expect(text).not.toContain(SECRET);
      expect(text.split("\n")).toHaveLength(1);
    }
  });

  it("Slack never carries a name, an email or an id", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(19) });
    await request(await h.app())
      .post("/api/feedback/feedback")
      .send(send({ body: "Short note" }));
    const text = slackText();
    expect(text).not.toContain(PROFILE_ID);
    expect(text).not.toContain(KEY);
    expect(text).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  // ── Owner brief "Feedback → Slack: log the real reason when it can't post" (Karl, 2026-10-21):
  //    one WARN per submission naming what is wrong; never the token, the text or an identifier;
  //    the submission stored and answered 201 exactly as before. ──

  const TOKEN = "xoxb-1111-2222-SUPERSECRETTOKENVALUE";
  const warnings = (op: string): Record<string, unknown>[] =>
    logged
      .filter((l): l is unknown[] => Array.isArray(l) && l[1] === op)
      .map((l) => (l[3] ?? {}) as Record<string, unknown>);

  async function submitUnder(): Promise<{
    status: number;
    stored: number;
    log: string;
  }> {
    logged.length = 0;
    slackCalls.length = 0;
    const h = harness({ role: "student", date_of_birth: AGE(19) });
    const res = await request(await h.app())
      .post("/api/feedback/feedback")
      .send(send());
    const stored = h.calls.filter(
      (c) =>
        c.fn === "product_feedback_submit" &&
        c.args.p_type === "bug" &&
        c.args.p_route_pattern === "/practice/session/:sessionId",
    ).length;
    return { status: res.status, stored, log: JSON.stringify(logged) };
  }

  function expectNothingSensitive(log: string): void {
    expect(log.length).toBeGreaterThan(2); // presence before absence
    for (const secret of [
      "SUPERSECRETTOKENVALUE",
      "xoxb-",
      "xoxp-",
      SECRET,
      PROFILE_ID,
      KEY,
    ]) {
      expect(log, secret).not.toContain(secret);
    }
  }

  it("Slack settings that are unusable: each logs its own reason, and the submission is unchanged", async () => {
    const cases: {
      name: string;
      token: string | undefined;
      channel: string | undefined;
      expected: Record<string, unknown>;
    }[] = [
      {
        name: "env_invalid (an empty value fails the env schema)",
        token: "",
        channel: "C0123456789",
        expected: { reason: "env_invalid", fields: ["SLACK_BOT_TOKEN"] },
      },
      {
        name: "token_missing",
        token: undefined,
        channel: "C0123456789",
        expected: { reason: "token_missing" },
      },
      {
        name: "token_not_bot",
        token: "xoxp-1111-2222-SUPERSECRETTOKENVALUE",
        channel: "C0123456789",
        expected: { reason: "token_not_bot" },
      },
      {
        name: "channel_invalid (a channel name, not its ID)",
        token: TOKEN,
        channel: "#social",
        expected: { reason: "channel_invalid", channel: "#…(7)" },
      },
      {
        name: "channel_invalid (unset)",
        token: TOKEN,
        channel: undefined,
        expected: { reason: "channel_invalid", channel: "unset" },
      },
    ];
    for (const c of cases) {
      vi.stubEnv("SLACK_BOT_TOKEN", c.token);
      vi.stubEnv("SOCIAL_SLACK_CHANNEL_ID", c.channel);
      const r = await submitUnder();
      expect(r.status, c.name).toBe(201);
      expect(r.stored, c.name).toBe(1);
      expect(slackCalls, c.name).toEqual([]);
      const w = warnings("feedback_slack_misconfigured");
      expect(w, c.name).toHaveLength(1);
      expect(w[0], c.name).toMatchObject(c.expected);
      expect(r.log, c.name).not.toContain("social");
      expect(r.log, c.name).not.toContain("1111-2222");
      expectNothingSensitive(r.log);
    }
  });

  it("a Slack API error logs Slack's own code; a network failure its class name; the submission is unchanged", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", TOKEN);
    const cases: {
      answer: () => Promise<Response>;
      expected: Record<string, unknown>;
    }[] = [
      {
        answer: async () =>
          Response.json({ ok: false, error: "not_in_channel" }),
        expected: { reason: "slack_error", slack_error: "not_in_channel" },
      },
      {
        answer: async () => Response.json({ ok: false, error: "invalid_auth" }),
        expected: { reason: "slack_error", slack_error: "invalid_auth" },
      },
      {
        answer: async () => new Response("down", { status: 500 }),
        expected: { reason: "slack_error", slack_error: "http_500" },
      },
      {
        answer: async () => {
          throw new TypeError(`network down near ${TOKEN}`);
        },
        expected: { reason: "request_failed", error_name: "TypeError" },
      },
    ];
    for (const c of cases) {
      slackAnswer = c.answer;
      const r = await submitUnder();
      expect(r.status).toBe(201);
      expect(r.stored).toBe(1);
      expect(slackCalls).toHaveLength(1); // the post was attempted
      const w = warnings("feedback_slack_failed");
      expect(w).toHaveLength(1);
      expect(w[0]).toMatchObject(c.expected);
      expect(r.log).not.toContain("network down");
      expectNothingSensitive(r.log);
    }
  });

  it("a successful post logs no Slack warning at all", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", TOKEN);
    const r = await submitUnder();
    expect(r.status).toBe(201);
    expect(slackCalls).toHaveLength(1);
    expect(warnings("feedback_slack_misconfigured")).toEqual([]);
    expect(warnings("feedback_slack_failed")).toEqual([]);
    expectNothingSensitive(r.log);
  });

  it("SlackCallError keeps only a code-shaped value, so a log can carry it", () => {
    expect(new SlackCallError("x", "not_in_channel").code).toBe(
      "not_in_channel",
    );
    expect(new SlackCallError("x", `bad ${TOKEN}`).code).toBe("unrecognised");
    expect(redactChannel("C0123456789")).toBe("C…(11)");
    expect(redactChannel("  ")).toBe("unset");
  });

  it("a replay posts nothing twice and counts nothing twice", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(19) });
    const app = await h.app();
    await request(app).post("/api/feedback/feedback").send(send());
    const again = await request(app)
      .post("/api/feedback/feedback")
      .send(send());
    expect(again.status).toBe(200);
    expect(slackCalls).toHaveLength(1);
    expect(emitted.filter((e) => e.name === "feedback_submitted")).toHaveLength(
      1,
    );
  });

  it("analytics: feedback_submitted with the type and role only", async () => {
    const h = harness({ role: "guardian", date_of_birth: AGE(40) });
    await request(await h.app())
      .post("/api/feedback/feedback")
      .send(send({ type: "idea" }));
    expect(emitted).toEqual([
      {
        name: "feedback_submitted",
        payload: { type: "idea", role: "guardian" },
      },
    ]);
  });

  it("feedback text is never logged", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(19) });
    await request(await h.app())
      .post("/api/feedback/feedback")
      .send(send());
    expect(logged.length).toBeGreaterThan(0); // presence first
    expect(JSON.stringify(logged)).not.toContain(SECRET);
  });
});

// ── 3. Where Send feedback lives ────────────────────────────────────────────

describe("Send feedback is in the account menu, which the practice, review and test screens do not have", () => {
  it("the practice runner, review runner, exam and report routes use the focus layout", () => {
    for (const route of [
      "/practice/session/:sessionId",
      "/practice/diagnostic",
      "/review/session/:sessionId",
      "/tests/:sessionId",
      "/tests/:sessionId/:section/:module",
      "/tests/:sessionId/report",
      "/score-report",
    ] as const) {
      expect([route, STUDENT_ROUTE_SHELLS[route].shell]).toEqual([
        route,
        "focus",
      ]);
    }
  });

  it("the focus layout carries no account menu and no feedback entry", () => {
    const focus = readFileSync(
      "client/src/components/layout/FocusShell.tsx",
      "utf8",
    );
    expect(focus.length).toBeGreaterThan(200);
    expect(focus).not.toMatch(
      /HeaderUserMenu|useFeedbackMenuEntry|FeedbackDialog/,
    );
  });

  it("the student app shell and the guardian shell both render the entry and its dialog", () => {
    for (const file of [
      "client/src/components/layout/app-shell.tsx",
      "client/src/components/layout/GuardianShell.tsx",
    ]) {
      const src = readFileSync(file, "utf8");
      expect([file, src.includes("useFeedbackMenuEntry()")]).toEqual([
        file,
        true,
      ]);
      expect([file, src.includes("{feedback.item}")]).toEqual([file, true]);
      expect([file, src.includes("feedback.dialog")]).toEqual([file, true]);
    }
  });
});
