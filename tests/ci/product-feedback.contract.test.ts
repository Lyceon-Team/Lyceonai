/**
 * Plan Q6 and the review ask: the cadence and the /api/feedback routes.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R28 (no gating; Trustpilot guardians + 18+;
 *       in-app review 13+), R30 (as amended 2026-10-20), row Q6; owner brief "Review ask — in-app
 *       prompt + one email, industry standard" (Karl, 2026-10-20) acceptance ("eligibility and
 *       the trigger; the identical invitation regardless of sentiment; age rules; the snooze and
 *       2-ask cap"); Karl's Step 0 decisions 3, 4, 7, 8 (2026-10-20); Coding Standards §14
 *       (denial tests), §12.1 (never log content)] | @implemented [2026-10-05; review ask 2026-10-20]
 *
 * plain English: three layers, each over what really produces it.
 *   1. `decideReviewPrompt` — the one cadence rule, as a pure function of state, age, moment and
 *      clock — and its constants held equal to the SQL that backstops them.
 *   2. The real router (`createProductFeedbackRouter`) and the real service, over an in-memory
 *      stand-in for the SQL functions that keeps their contracts (the claim is compare-and-set
 *      and holds the cap, answered and snooze limits; one review per profile) and stand-in
 *      moment checks. The SQL itself is proved on Postgres by review-ask.pg.ci.test.ts.
 *   3. "Never during practice, review or a full-length exam" holds two ways: the server accepts
 *      only the three home moments (anything else is a 400), and the component is mounted only
 *      on the two home pages (a source scan, so a new mount anywhere else turns this red).
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideReviewPrompt,
  REVIEW_ASK_EMAIL_AFTER_DAYS,
  REVIEW_ASK_EMAIL_MIN_AGE,
  REVIEW_ASK_EMAIL_WINDOW_DAYS,
  REVIEW_ASK_MAX_ASKS,
  REVIEW_ASK_MIN_DAYS,
  REVIEW_ASK_MIN_SESSIONS,
  REVIEW_ASK_SNOOZE_DAYS,
  reviewPromptQuerySchema,
  trustpilotEligible,
  type ReviewPromptState,
} from "../../packages/shared/src/product-feedback-schema";

vi.mock("../../server/middleware/rate-limit", () => ({
  singleBucketRateLimit:
    () => (_req: Request, _res: Response, next: NextFunction) =>
      next(),
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

const NOW = new Date("2026-10-05T15:00:00Z");
const DAY = 86_400_000;
const AGE = (years: number): string => `${NOW.getUTCFullYear() - years}-01-01`;
const ago = (days: number): Date => new Date(NOW.getTime() - days * DAY);

const FRESH: ReviewPromptState = {
  last_shown_at: null,
  ask_count: 0,
  snoozed_until: null,
  last_response: null,
  reviewed_at: null,
  email_queued_at: null,
};

// ── 1. The cadence rule ─────────────────────────────────────────────────────

describe("decideReviewPrompt", () => {
  const student15 = {
    role: "student",
    dateOfBirth: AGE(15),
    moment: "home" as const,
    now: NOW,
  };

  it("asks an eligible person who was never asked, and the ask counts", () => {
    expect(decideReviewPrompt({ ...student15, state: null })).toEqual({
      show: true,
      trustpilotEligible: false,
      counts: true,
    });
  });

  it("at most two asks, ever", () => {
    const after = (askCount: number) =>
      decideReviewPrompt({
        ...student15,
        state: {
          ...FRESH,
          ask_count: askCount,
          last_shown_at: ago(400),
          last_response: "snoozed",
          snoozed_until: ago(370),
        },
      });
    expect(after(1).show).toBe(true);
    expect(after(REVIEW_ASK_MAX_ASKS)).toEqual({
      show: false,
      reason: "ask_limit",
    });
  });

  it("'Not now' and the close button snooze 30 days; an ignored ask waits as long", () => {
    for (const response of ["snoozed", "dismissed"] as const) {
      const snoozed = (daysAgo: number) =>
        decideReviewPrompt({
          ...student15,
          state: {
            ...FRESH,
            ask_count: 1,
            last_shown_at: ago(daysAgo),
            last_response: response,
            snoozed_until: new Date(
              ago(daysAgo).getTime() + REVIEW_ASK_SNOOZE_DAYS * DAY,
            ),
          },
        });
      expect(snoozed(REVIEW_ASK_SNOOZE_DAYS - 1)).toEqual({
        show: false,
        reason: "snoozed",
      });
      expect(snoozed(REVIEW_ASK_SNOOZE_DAYS).show).toBe(true);
    }
    const ignored = (daysAgo: number) =>
      decideReviewPrompt({
        ...student15,
        state: { ...FRESH, ask_count: 1, last_shown_at: ago(daysAgo) },
      });
    expect(ignored(REVIEW_ASK_SNOOZE_DAYS - 1)).toEqual({
      show: false,
      reason: "cooldown",
    });
    expect(ignored(REVIEW_ASK_SNOOZE_DAYS).show).toBe(true);
  });

  it("never again once answered: a review (either way), prompt feedback, or 'Stop review requests'", () => {
    for (const state of [
      {
        ...FRESH,
        ask_count: 1,
        reviewed_at: ago(400),
        last_shown_at: ago(400),
      },
      { ...FRESH, ask_count: 1, last_response: "reviewed" as const },
      { ...FRESH, ask_count: 1, last_response: "feedback" as const },
      { ...FRESH, last_response: "stopped" as const },
    ]) {
      expect(decideReviewPrompt({ ...student15, state })).toEqual({
        show: false,
        reason: "answered",
      });
    }
  });

  it("the email's return link shows the same card without counting an ask, and only after the email", () => {
    const back = (state: ReviewPromptState | null) =>
      decideReviewPrompt({ ...student15, moment: "email_return", state });
    expect(back(null)).toEqual({ show: false, reason: "no_email" });
    expect(back({ ...FRESH, ask_count: 1, last_shown_at: ago(4) })).toEqual({
      show: false,
      reason: "no_email",
    });
    expect(
      back({
        ...FRESH,
        ask_count: 1,
        last_shown_at: ago(4),
        email_queued_at: ago(1),
      }),
    ).toEqual({ show: true, trustpilotEligible: false, counts: false });
    expect(
      back({
        ...FRESH,
        ask_count: 1,
        last_response: "feedback",
        email_queued_at: ago(1),
      }),
    ).toEqual({ show: false, reason: "answered" });
  });

  it("never to an under-13 student, an unknown age, or an admin", () => {
    for (const input of [
      { role: "student", dateOfBirth: AGE(12) },
      { role: "student", dateOfBirth: null },
      { role: "guardian", dateOfBirth: null },
      { role: "admin", dateOfBirth: AGE(40) },
    ]) {
      expect(
        decideReviewPrompt({ ...input, moment: "home", state: null, now: NOW }),
      ).toEqual({ show: false, reason: "not_eligible" });
    }
  });

  it("Trustpilot: guardians and students 18+ only", () => {
    expect(trustpilotEligible("student", AGE(17), NOW)).toBe(false);
    expect(trustpilotEligible("student", AGE(18), NOW)).toBe(true);
    expect(trustpilotEligible("guardian", AGE(40), NOW)).toBe(true);
    expect(trustpilotEligible("guardian", null, NOW)).toBe(false);
  });

  it("no sentiment input exists: the rule's inputs carry no rating, review or feedback", () => {
    // The decision's whole input is role, date of birth, the cadence facts, the moment and the
    // clock. A stored state with a rating in it would be a gating door; there is no such field.
    expect(Object.keys(FRESH).sort()).toEqual([
      "ask_count",
      "email_queued_at",
      "last_response",
      "last_shown_at",
      "reviewed_at",
      "snoozed_until",
    ]);
    const src = readFileSync(
      "packages/shared/src/product-feedback-schema.ts",
      "utf8",
    );
    const rule = src.slice(src.indexOf("export function decideReviewPrompt"));
    expect(rule.length).toBeGreaterThan(100);
    expect(rule).not.toMatch(/rating|body|sentiment|happy|nps/i);
  });

  it("the constants are the SQL's: the claim's cap, the snooze, the trigger and the email window", () => {
    const sql = readFileSync(
      "supabase/migrations/20261107000000_review_ask.sql",
      "utf8",
    );
    expect(sql).toContain(`ask_count < ${REVIEW_ASK_MAX_ASKS}`);
    expect(sql).toContain(`now() + interval '${REVIEW_ASK_SNOOZE_DAYS} days'`);
    expect(sql).toContain(`p_now - interval '${REVIEW_ASK_MIN_DAYS} days'`);
    expect(sql).toContain(`>= ${REVIEW_ASK_MIN_SESSIONS}`);
    expect(sql).toContain(
      `s.last_shown_at <= p_now - interval '${REVIEW_ASK_EMAIL_AFTER_DAYS} days'`,
    );
    expect(sql).toContain(
      `s.last_shown_at >  p_now - interval '${REVIEW_ASK_EMAIL_WINDOW_DAYS} days'`,
    );
    expect(sql).toContain(`interval '${REVIEW_ASK_EMAIL_MIN_AGE} years'`);
  });
});

// ── 2. The routes over a stand-in for the SQL functions ─────────────────────

type Profile = { role: string; date_of_birth: string | null };
type State = {
  last_shown_at: string | null;
  ask_count: number;
  snoozed_until: string | null;
  last_response: string | null;
  reviewed_at: string | null;
  email_queued_at: string | null;
};

function harness(profile: Profile) {
  let state: State | null = null;
  let clock = NOW.getTime();
  const reviews = new Map<string, Record<string, unknown>>();
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const moment = {
    usageMet: vi.fn(async () => true),
    checklistActive: vi.fn(async () => false),
  };
  const iso = () => new Date(clock).toISOString();
  const blank = (): State => ({
    last_shown_at: null,
    ask_count: 0,
    snoozed_until: null,
    last_response: null,
    reviewed_at: null,
    email_queued_at: null,
  });

  const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    switch (fn) {
      case "product_review_prompt_state_for":
        return { data: state, error: null };
      case "product_review_prompt_claim": {
        // Compare-and-set plus the hard limits, as the SQL does.
        const s = state ?? blank();
        const open =
          s.last_response === null ||
          s.last_response === "snoozed" ||
          s.last_response === "dismissed";
        if (
          s.last_shown_at !== args.p_expected ||
          s.reviewed_at !== null ||
          s.ask_count >= 2 ||
          !open ||
          (s.snoozed_until !== null && Date.parse(s.snoozed_until) > clock)
        ) {
          return { data: false, error: null };
        }
        state = {
          ...s,
          last_shown_at: iso(),
          ask_count: s.ask_count + 1,
          last_response: null,
        };
        return { data: true, error: null };
      }
      case "product_review_prompt_respond": {
        if (!state || state.last_shown_at === null || state.last_response) {
          return { data: false, error: null };
        }
        state = {
          ...state,
          last_response: String(args.p_response),
          snoozed_until: new Date(clock + 30 * DAY).toISOString(),
        };
        return { data: true, error: null };
      }
      case "product_review_mark_external":
        state = {
          ...(state ?? blank()),
          reviewed_at: iso(),
          last_response: "reviewed",
        };
        return { data: null, error: null };
      case "product_review_submit": {
        const id = String(args.p_profile_id);
        const existing = reviews.get(id);
        if (existing) {
          return {
            data: {
              outcome:
                existing.p_rating === args.p_rating &&
                existing.p_body === args.p_body
                  ? "replayed"
                  : "conflict",
            },
            error: null,
          };
        }
        reviews.set(id, args);
        state = {
          ...(state ?? blank()),
          reviewed_at: iso(),
          last_response: "reviewed",
        };
        return { data: { outcome: "created" }, error: null };
      }
      case "product_feedback_submit":
        if (args.p_source === "prompt") {
          state = { ...(state ?? blank()), last_response: "feedback" };
        }
        return { data: { outcome: "created" }, error: null };
      default:
        return { data: null, error: { message: `unexpected rpc ${fn}` } };
    }
  };

  const db = {
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { ...profile, is_under_13: false },
            error: null,
          }),
        }),
      }),
    }),
  };

  return {
    calls,
    moment,
    advanceDays(days: number) {
      clock += days * DAY;
    },
    queueEmail() {
      state = { ...(state ?? blank()), email_queued_at: iso() };
    },
    get state() {
      return state;
    },
    async app() {
      const { createProductFeedbackRouter } =
        await import("../../server/routes/product-feedback-routes");
      const app = express();
      app.use(express.json());
      app.use((req: Request, _res: Response, next: NextFunction) => {
        (req as Request & { user?: unknown }).user = {
          id: "0f0f0f0f-1111-4222-8333-444444444444",
          role: profile.role,
        };
        req.requestId = "req-feedback";
        next();
      });
      app.use(
        "/api/feedback",
        createProductFeedbackRouter({
          db: () => db as never,
          moments: () => moment,
          now: () => new Date(clock),
        }),
      );
      return app;
    },
  };
}

const HOME = "/api/feedback/prompt?moment=home";
const GUARDIAN_HOME = "/api/feedback/prompt?moment=guardian_home";
const EMAIL_RETURN = "/api/feedback/prompt?moment=email_return";

describe("GET /api/feedback/prompt", () => {
  beforeEach(() => {
    logged.length = 0;
    emitted.length = 0;
  });

  it("accepts only the three home moments: practice, review, exam and the retired moments are a 400", async () => {
    for (const moment of [
      "practice",
      "review",
      "exam_module",
      "exam_break",
      "calendar",
      "exam_report",
      "study_week",
      "guardian_week",
    ]) {
      expect(reviewPromptQuerySchema.safeParse({ moment }).success).toBe(false);
    }
    const h = harness({ role: "student", date_of_birth: AGE(15) });
    const res = await request(await h.app()).get(
      "/api/feedback/prompt?moment=practice",
    );
    expect(res.status).toBe(400);
    expect(h.calls).toEqual([]);
  });

  it("asks once when the trigger is met, records the ask (compare-and-set) and counts it", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(15) });
    const app = await h.app();
    const first = await request(app).get(HOME);
    expect(first.status).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.body).toEqual({
      data: { show: true, trustpilot_eligible: false },
    });
    expect(h.moment.usageMet).toHaveBeenCalledWith(
      "0f0f0f0f-1111-4222-8333-444444444444",
    );
    expect(h.state?.ask_count).toBe(1);
    expect(emitted).toEqual([
      {
        name: "review_ask_shown",
        payload: { audience: "student", age_band: "13_17", ask_number: 1 },
      },
    ]);
    // A second tab, a refresh: no.
    expect((await request(app).get(HOME)).body).toEqual({
      data: { show: false },
    });
    expect(emitted).toHaveLength(1);
  });

  it("no ask before the trigger (7 days, 3 sessions), and none while the checklist is active", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(15) });
    h.moment.usageMet.mockResolvedValueOnce(false);
    const app = await h.app();
    expect((await request(app).get(HOME)).body).toEqual({
      data: { show: false },
    });
    h.moment.checklistActive.mockResolvedValueOnce(true);
    expect((await request(app).get(HOME)).body).toEqual({
      data: { show: false },
    });
    expect(h.calls.map((c) => c.fn)).not.toContain(
      "product_review_prompt_claim",
    );
    expect(h.state).toBeNull();
  });

  it("'Not now' snoozes 30 days; then the second and last ask; then never", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(15) });
    const app = await h.app();
    const ask = async () => (await request(app).get(HOME)).body.data.show;
    const notNow = () =>
      request(app)
        .post("/api/feedback/prompt/respond")
        .send({ response: "snoozed" });
    expect(await ask()).toBe(true);
    expect((await notNow()).status).toBe(204);
    h.advanceDays(REVIEW_ASK_SNOOZE_DAYS - 1);
    expect(await ask()).toBe(false);
    h.advanceDays(1);
    expect(await ask()).toBe(true);
    expect(
      (
        await request(app)
          .post("/api/feedback/prompt/respond")
          .send({ response: "dismissed" })
      ).status,
    ).toBe(204);
    h.advanceDays(1000);
    expect(await ask()).toBe(false);
    expect(h.state?.ask_count).toBe(REVIEW_ASK_MAX_ASKS);
    expect(
      emitted.map((e) => [e.name, e.payload.via ?? e.payload.ask_number]),
    ).toEqual([
      ["review_ask_shown", 1],
      ["review_ask_snoozed", "not_now"],
      ["review_ask_shown", 2],
      ["review_ask_snoozed", "close"],
    ]);
  });

  it("a response other than snoozed or dismissed is a 400", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(15) });
    const res = await request(await h.app())
      .post("/api/feedback/prompt/respond")
      .send({ response: "reviewed" });
    expect(res.status).toBe(400);
    expect(h.calls).toEqual([]);
  });

  it("none after a review, the Trustpilot button, or feedback sent from the ask; feedback from Settings changes nothing", async () => {
    const reviewer = harness({ role: "student", date_of_birth: AGE(15) });
    const r = await reviewer.app();
    expect((await request(r).get(HOME)).body.data.show).toBe(true);
    expect(
      (
        await request(r)
          .post("/api/feedback/reviews")
          .send({ rating: 4, body: "Helpful plan.", quote_permission: false })
      ).status,
    ).toBe(201);

    const tp = harness({ role: "guardian", date_of_birth: AGE(40) });
    const t = await tp.app();
    expect((await request(t).get(GUARDIAN_HOME)).body.data).toEqual({
      show: true,
      trustpilot_eligible: true,
    });
    expect(
      (await request(t).post("/api/feedback/prompt/trustpilot")).status,
    ).toBe(204);

    const fb = harness({ role: "student", date_of_birth: AGE(16) });
    const f = await fb.app();
    expect((await request(f).get(HOME)).body.data.show).toBe(true);
    await request(f).post("/api/feedback/feedback").send({
      body: "x",
      source: "prompt",
      idempotency_key: "7a7a7a7a-1111-4222-8333-444444444444",
    });

    const other = harness({ role: "student", date_of_birth: AGE(16) });
    const o = await other.app();
    expect((await request(o).get(HOME)).body.data.show).toBe(true);
    await request(o).post("/api/feedback/feedback").send({
      body: "x",
      source: "settings",
      idempotency_key: "7a7a7a7a-1111-4222-8333-444444444444",
    });

    for (const [h, app, path] of [
      [reviewer, r, HOME],
      [tp, t, GUARDIAN_HOME],
      [fb, f, HOME],
    ] as const) {
      h.advanceDays(1000);
      expect((await request(app).get(path)).body.data).toEqual({ show: false });
    }
    other.advanceDays(REVIEW_ASK_SNOOZE_DAYS);
    expect((await request(o).get(HOME)).body.data.show).toBe(true);
  });

  it("counts which option was chosen, never what was said", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(19) });
    const app = await h.app();
    await request(app).get(HOME);
    await request(app)
      .post("/api/feedback/reviews")
      .send({ rating: 1, body: "SECRET-REVIEW-TEXT", quote_permission: false });
    expect(emitted.at(-1)).toEqual({
      name: "review_ask_clicked",
      payload: {
        audience: "student",
        age_band: "18_plus",
        destination: "in_app_review",
      },
    });
    expect(JSON.stringify(emitted)).not.toMatch(/SECRET-REVIEW-TEXT|rating/);
    expect(JSON.stringify(logged)).not.toContain("SECRET-REVIEW-TEXT");
  });

  it("the email's return link shows the card without claiming, and only after the email was queued", async () => {
    const h = harness({ role: "guardian", date_of_birth: AGE(40) });
    const app = await h.app();
    expect((await request(app).get(EMAIL_RETURN)).body.data).toEqual({
      show: false,
    });
    expect((await request(app).get(GUARDIAN_HOME)).body.data.show).toBe(true);
    h.advanceDays(3);
    h.queueEmail();
    const before = h.calls.filter(
      (c) => c.fn === "product_review_prompt_claim",
    ).length;
    expect((await request(app).get(EMAIL_RETURN)).body.data).toEqual({
      show: true,
      trustpilot_eligible: true,
    });
    expect(
      h.calls.filter((c) => c.fn === "product_review_prompt_claim").length,
    ).toBe(before);
    expect(h.state?.ask_count).toBe(1);
    expect(emitted.filter((e) => e.name === "review_ask_shown")).toHaveLength(
      1,
    );
  });

  it("a student's moment never asks a guardian, and the guardian's never asks a student", async () => {
    const g = harness({ role: "guardian", date_of_birth: AGE(40) });
    expect((await request(await g.app()).get(HOME)).body).toEqual({
      data: { show: false },
    });
    expect(g.moment.usageMet).not.toHaveBeenCalled();

    const s = harness({ role: "student", date_of_birth: AGE(15) });
    expect((await request(await s.app()).get(GUARDIAN_HOME)).body).toEqual({
      data: { show: false },
    });
    expect(s.moment.usageMet).not.toHaveBeenCalled();
  });

  it("never to an under-13 student, and no learning data is read to decide it", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(12) });
    const res = await request(await h.app()).get(HOME);
    expect(res.body).toEqual({ data: { show: false } });
    expect(h.moment.usageMet).not.toHaveBeenCalled();
    expect(h.moment.checklistActive).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it("Trustpilot is offered to an 18+ student but not a 17-year-old, who gets the in-app review", async () => {
    const adult = harness({ role: "student", date_of_birth: AGE(18) });
    expect((await request(await adult.app()).get(HOME)).body.data).toEqual({
      show: true,
      trustpilot_eligible: true,
    });
    const minor = harness({ role: "student", date_of_birth: AGE(17) });
    expect((await request(await minor.app()).get(HOME)).body.data).toEqual({
      show: true,
      trustpilot_eligible: false,
    });
    // And the server refuses the Trustpilot record for the minor.
    expect(
      (await request(await minor.app()).post("/api/feedback/prompt/trustpilot"))
        .status,
    ).toBe(403);
  });
});

describe("POST /api/feedback/reviews and /feedback", () => {
  beforeEach(() => {
    logged.length = 0;
  });

  it("a review is bucketed by the account's role (never the client's), one per profile", async () => {
    const h = harness({ role: "guardian", date_of_birth: AGE(40) });
    const app = await h.app();
    const body = {
      rating: 5,
      body: "Clear weekly view.",
      quote_permission: true,
    };
    const first = await request(app).post("/api/feedback/reviews").send(body);
    expect(first.status).toBe(201);
    const submit = h.calls.find((c) => c.fn === "product_review_submit");
    expect(submit?.args).toMatchObject({
      p_audience: "guardian",
      p_rating: 5,
      p_body: "Clear weekly view.",
      p_quote_permission: true,
    });
    expect(
      (await request(app).post("/api/feedback/reviews").send(body)).status,
    ).toBe(200);
    const different = await request(app)
      .post("/api/feedback/reviews")
      .send({ ...body, rating: 1 });
    expect(different.status).toBe(409);
    expect(different.body.error.code).toBe("ALREADY_REVIEWED");
  });

  it("refuses a client-supplied audience and a missing quote choice", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(15) });
    const app = await h.app();
    expect(
      (
        await request(app)
          .post("/api/feedback/reviews")
          .send({ rating: 5, quote_permission: false, audience: "guardian" })
      ).status,
    ).toBe(400);
    expect(
      (await request(app).post("/api/feedback/reviews").send({ rating: 5 }))
        .status,
    ).toBe(400);
  });

  it("under-13: a review is refused with nothing stored; private feedback is still accepted (always available)", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(12) });
    const app = await h.app();
    expect(
      (
        await request(app)
          .post("/api/feedback/reviews")
          .send({ rating: 5, body: null, quote_permission: false })
      ).status,
    ).toBe(403);
    expect(h.calls.map((c) => c.fn)).toEqual([]);
    const feedback = await request(app).post("/api/feedback/feedback").send({
      body: "hi",
      source: "help",
      idempotency_key: "7a7a7a7a-1111-4222-8333-444444444444",
    });
    expect(feedback.status).toBe(201);
    expect(
      h.calls.find((c) => c.fn === "product_feedback_submit")?.args,
    ).toMatchObject({ p_audience: "student" });
  });

  it("an admin account has no feedback bucket: 403, nothing stored", async () => {
    const h = harness({ role: "admin", date_of_birth: AGE(40) });
    const res = await request(await h.app())
      .post("/api/feedback/feedback")
      .send({
        body: "hi",
        source: "help",
        idempotency_key: "7a7a7a7a-1111-4222-8333-444444444444",
      });
    expect(res.status).toBe(403);
    expect(h.calls).toEqual([]);
  });

  it("feedback forwards the idempotency key and never logs the text", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(16) });
    const res = await request(await h.app())
      .post("/api/feedback/feedback")
      .send({
        body: "SECRET-FEEDBACK-TEXT the calendar is confusing",
        source: "settings",
        idempotency_key: "7a7a7a7a-1111-4222-8333-444444444444",
      });
    expect(res.status).toBe(201);
    expect(
      h.calls.find((c) => c.fn === "product_feedback_submit")?.args,
    ).toMatchObject({
      p_audience: "student",
      p_source: "settings",
      p_idempotency_key: "7a7a7a7a-1111-4222-8333-444444444444",
    });
    expect(logged.length).toBeGreaterThan(0); // presence before absence
    expect(JSON.stringify(logged)).not.toContain("SECRET-FEEDBACK-TEXT");
  });
});

// ── 3. Mount sites ──────────────────────────────────────────────────────────

function gitGrep(pattern: string): string[] {
  const out = execFileSync(
    "git",
    ["grep", "--untracked", "-l", "-E", pattern, "--", "client/src"],
    { encoding: "utf8" },
  );
  return out
    .split("\n")
    .filter((f) => f !== "" && !/\.test\.tsx?$/.test(f))
    .sort();
}

describe("the ask is mounted only on the two home pages", () => {
  it("ReviewPrompt is rendered from exactly these files", () => {
    expect(gitGrep("<ReviewPrompt([[:space:]]|/|>|$)")).toEqual([
      "client/src/components/home/HomeReviewAsk.tsx",
      "client/src/features/guardian/GuardianDashboardTab.tsx",
    ]);
  });

  it("HomeReviewAsk is rendered only by the student's two Homes", () => {
    expect(gitGrep("<HomeReviewAsk([[:space:]]|/|>|$)")).toEqual([
      "client/src/components/home/FreeHome.tsx",
      "client/src/components/home/PaidHome.tsx",
    ]);
  });

  it("on Home it sits after today's question and waits while the checklist has an open step", () => {
    for (const file of [
      "client/src/components/home/FreeHome.tsx",
      "client/src/components/home/PaidHome.tsx",
    ]) {
      const src = readFileSync(file, "utf8");
      const qotd = src.indexOf("<HomeQotdSection");
      const ask = src.indexOf("<HomeReviewAsk");
      const checklist = src.indexOf("<GettingStartedCard");
      expect(checklist).toBeGreaterThan(0);
      expect(qotd).toBeGreaterThan(checklist);
      expect(ask).toBeGreaterThan(qotd);
    }
    const src = readFileSync(
      "client/src/components/home/HomeReviewAsk.tsx",
      "utf8",
    );
    expect(src).toContain(
      "const checklistActive = checklist !== null && !checklist.complete;",
    );
    expect(src).toContain(
      'enabled={moment === "email_return" || !checklistActive}',
    );
  });
});
