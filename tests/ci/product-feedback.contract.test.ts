/**
 * Plan Q6: the review prompt's cadence and the /api/feedback routes.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R28 (no gating; Trustpilot guardians + 18+;
 *       in-app review 13+), R30 (success moments only, never during practice or exams, max once
 *       per 120 days, stop after a review or 2 dismissals), row Q6 ("CI cadence tests"); owner
 *       Step 0 answers 3, 4, 6 (2026-10-05); Coding Standards §14 (denial tests), §12.1 (never
 *       log content)] | @implemented [2026-10-05]
 *
 * plain English: three layers, each over what really produces it.
 *   1. `decideReviewPrompt` — the one cadence rule, as a pure function of state, age and clock.
 *   2. The real router (`createProductFeedbackRouter`) and the real service, over an in-memory
 *      stand-in for the SQL functions that keeps their contracts (claim is compare-and-set;
 *      review is one per profile) and stand-in moment checks. The SQL itself is proved on
 *      Postgres by marketing-consent-reviews.pg.ci.test.ts.
 *   3. "Never during practice, review or a full-length exam" holds two ways: the server accepts
 *      only the three success moments (anything else is a 400), and the prompt component is
 *      mounted only on the three success-moment pages (a source scan, so a new mount anywhere
 *      else turns this red).
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
  REVIEW_PROMPT_COOLDOWN_DAYS,
  reviewPromptQuerySchema,
  trustpilotEligible,
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

const NOW = new Date("2026-10-05T15:00:00Z");
const DAY = 86_400_000;
const AGE = (years: number): string => `${NOW.getUTCFullYear() - years}-01-01`;

// ── 1. The cadence rule ─────────────────────────────────────────────────────

describe("decideReviewPrompt", () => {
  const student15 = { role: "student", dateOfBirth: AGE(15), now: NOW };

  it("shows to an eligible student who has never seen it", () => {
    expect(decideReviewPrompt({ ...student15, state: null })).toEqual({
      show: true,
      trustpilotEligible: false,
    });
  });

  it("never within 120 days of the last showing; again after", () => {
    const shown = (daysAgo: number) =>
      decideReviewPrompt({
        ...student15,
        state: {
          last_shown_at: new Date(NOW.getTime() - daysAgo * DAY),
          dismiss_count: 1,
          reviewed_at: null,
        },
      });
    expect(shown(1)).toEqual({ show: false, reason: "cooldown" });
    expect(shown(REVIEW_PROMPT_COOLDOWN_DAYS - 1)).toEqual({
      show: false,
      reason: "cooldown",
    });
    expect(shown(REVIEW_PROMPT_COOLDOWN_DAYS).show).toBe(true);
  });

  it("never again after a review (in-app or the Trustpilot button), however long ago", () => {
    expect(
      decideReviewPrompt({
        ...student15,
        state: {
          last_shown_at: new Date(NOW.getTime() - 400 * DAY),
          dismiss_count: 0,
          reviewed_at: new Date(NOW.getTime() - 400 * DAY),
        },
      }),
    ).toEqual({ show: false, reason: "reviewed" });
  });

  it("never again after 2 dismissals; once after 1", () => {
    const dismissed = (n: number) =>
      decideReviewPrompt({
        ...student15,
        state: {
          last_shown_at: new Date(NOW.getTime() - 400 * DAY),
          dismiss_count: n,
          reviewed_at: null,
        },
      });
    expect(dismissed(1).show).toBe(true);
    expect(dismissed(2)).toEqual({ show: false, reason: "dismissed_limit" });
  });

  it("never to an under-13 student, an unknown age, or an admin", () => {
    for (const input of [
      { role: "student", dateOfBirth: AGE(12) },
      { role: "student", dateOfBirth: null },
      { role: "guardian", dateOfBirth: null },
      { role: "admin", dateOfBirth: AGE(40) },
    ]) {
      expect(decideReviewPrompt({ ...input, state: null, now: NOW })).toEqual({
        show: false,
        reason: "not_eligible",
      });
    }
  });

  it("Trustpilot: guardians and students 18+ only", () => {
    expect(trustpilotEligible("student", AGE(17), NOW)).toBe(false);
    expect(trustpilotEligible("student", AGE(18), NOW)).toBe(true);
    expect(trustpilotEligible("guardian", AGE(40), NOW)).toBe(true);
    expect(trustpilotEligible("guardian", null, NOW)).toBe(false);
  });
});

// ── 2. The routes over a stand-in for the SQL functions ─────────────────────

type Profile = { role: string; date_of_birth: string | null };
type State = {
  last_shown_at: string | null;
  dismiss_count: number;
  reviewed_at: string | null;
};

function harness(profile: Profile) {
  let state: State | null = null;
  let clock = NOW.getTime();
  const reviews = new Map<string, Record<string, unknown>>();
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const moment = {
    examReportReady: vi.fn(async () => true),
    studyWeekCompleted: vi.fn(async () => true),
    guardianWeekProgress: vi.fn(async () => true),
  };

  const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    switch (fn) {
      case "product_review_prompt_state_for":
        return { data: state, error: null };
      case "product_review_prompt_claim": {
        // Compare-and-set, as the SQL does.
        const current = state?.last_shown_at ?? null;
        if (current !== args.p_expected || state?.reviewed_at) {
          return { data: false, error: null };
        }
        state = {
          last_shown_at: new Date(clock).toISOString(),
          dismiss_count: state?.dismiss_count ?? 0,
          reviewed_at: null,
        };
        return { data: true, error: null };
      }
      case "product_review_prompt_dismiss":
        if (state) state.dismiss_count += 1;
        return { data: true, error: null };
      case "product_review_mark_external":
        state = {
          last_shown_at: state?.last_shown_at ?? null,
          dismiss_count: state?.dismiss_count ?? 0,
          reviewed_at: new Date(clock).toISOString(),
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
          last_shown_at: state?.last_shown_at ?? null,
          dismiss_count: state?.dismiss_count ?? 0,
          reviewed_at: new Date(clock).toISOString(),
        };
        return { data: { outcome: "created" }, error: null };
      }
      case "product_feedback_submit":
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
          single: async () => ({ data: profile, error: null }),
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

const SESSION = "5e5e5e5e-1111-4222-8333-444444444444";
const STUDENT_ID = "6e6e6e6e-1111-4222-8333-444444444444";

describe("GET /api/feedback/prompt", () => {
  beforeEach(() => {
    logged.length = 0;
  });

  it("accepts only the three success moments: practice, review and exam screens are a 400", async () => {
    for (const moment of [
      "practice",
      "review",
      "exam_module",
      "exam_break",
      "calendar",
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

  it("shows once at a verified moment, and records the showing (compare-and-set)", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(15) });
    const app = await h.app();
    const first = await request(app).get(
      `/api/feedback/prompt?moment=exam_report&session_id=${SESSION}`,
    );
    expect(first.status).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.body).toEqual({
      data: { show: true, trustpilot_eligible: false },
    });
    expect(h.moment.examReportReady).toHaveBeenCalledWith(
      "0f0f0f0f-1111-4222-8333-444444444444",
      SESSION,
    );
    // A second tab, a refresh: inside the 120 days, so no.
    const second = await request(app).get(
      `/api/feedback/prompt?moment=exam_report&session_id=${SESSION}`,
    );
    expect(second.body).toEqual({ data: { show: false } });
  });

  it("no prompt when the moment did not happen (report still scoring, week not complete)", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(15) });
    h.moment.studyWeekCompleted.mockResolvedValueOnce(false);
    const res = await request(await h.app()).get(
      "/api/feedback/prompt?moment=study_week",
    );
    expect(res.body).toEqual({ data: { show: false } });
    expect(h.calls.map((c) => c.fn)).not.toContain(
      "product_review_prompt_claim",
    );
  });

  it("none within 120 days, then again after", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(15) });
    const app = await h.app();
    const ask = () =>
      request(app).get("/api/feedback/prompt?moment=study_week");
    expect((await ask()).body.data.show).toBe(true);
    h.advanceDays(REVIEW_PROMPT_COOLDOWN_DAYS - 1);
    expect((await ask()).body.data.show).toBe(false);
    h.advanceDays(1);
    expect((await ask()).body.data.show).toBe(true);
  });

  it("none after 2 dismissals", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(15) });
    const app = await h.app();
    const ask = () =>
      request(app).get("/api/feedback/prompt?moment=study_week");
    for (let i = 0; i < 2; i += 1) {
      expect((await ask()).body.data.show).toBe(true);
      expect(
        (await request(app).post("/api/feedback/prompt/dismiss")).status,
      ).toBe(204);
      h.advanceDays(REVIEW_PROMPT_COOLDOWN_DAYS);
    }
    expect((await ask()).body.data.show).toBe(false);
  });

  it("none after a review", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(15) });
    const app = await h.app();
    expect(
      (await request(app).get("/api/feedback/prompt?moment=study_week")).body
        .data.show,
    ).toBe(true);
    const review = await request(app)
      .post("/api/feedback/reviews")
      .send({ rating: 4, body: "Helpful plan.", quote_permission: false });
    expect(review.status).toBe(201);
    h.advanceDays(1000);
    expect(
      (await request(app).get("/api/feedback/prompt?moment=study_week")).body
        .data,
    ).toEqual({ show: false });
  });

  it("none after the Trustpilot button (counts as reviewed)", async () => {
    const h = harness({ role: "guardian", date_of_birth: AGE(40) });
    const app = await h.app();
    const ask = () =>
      request(app).get(
        `/api/feedback/prompt?moment=guardian_week&student_id=${STUDENT_ID}`,
      );
    expect((await ask()).body.data).toEqual({
      show: true,
      trustpilot_eligible: true,
    });
    expect(
      (await request(app).post("/api/feedback/prompt/trustpilot")).status,
    ).toBe(204);
    h.advanceDays(1000);
    expect((await ask()).body.data).toEqual({ show: false });
  });

  it("a student's moment never prompts a guardian, and the guardian's never prompts a student", async () => {
    const g = harness({ role: "guardian", date_of_birth: AGE(40) });
    const res = await request(await g.app()).get(
      `/api/feedback/prompt?moment=exam_report&session_id=${SESSION}`,
    );
    expect(res.body).toEqual({ data: { show: false } });
    expect(g.moment.examReportReady).not.toHaveBeenCalled();

    const s = harness({ role: "student", date_of_birth: AGE(15) });
    const res2 = await request(await s.app()).get(
      `/api/feedback/prompt?moment=guardian_week&student_id=${STUDENT_ID}`,
    );
    expect(res2.body).toEqual({ data: { show: false } });
    expect(s.moment.guardianWeekProgress).not.toHaveBeenCalled();
  });

  it("never to an under-13 student, and no learning data is read to decide it", async () => {
    const h = harness({ role: "student", date_of_birth: AGE(12) });
    const res = await request(await h.app()).get(
      "/api/feedback/prompt?moment=study_week",
    );
    expect(res.body).toEqual({ data: { show: false } });
    expect(h.moment.studyWeekCompleted).not.toHaveBeenCalled();
  });

  it("Trustpilot is offered to an 18+ student but not a 17-year-old", async () => {
    const adult = harness({ role: "student", date_of_birth: AGE(18) });
    expect(
      (
        await request(await adult.app()).get(
          "/api/feedback/prompt?moment=study_week",
        )
      ).body.data,
    ).toEqual({ show: true, trustpilot_eligible: true });
    const minor = harness({ role: "student", date_of_birth: AGE(17) });
    expect(
      (
        await request(await minor.app()).get(
          "/api/feedback/prompt?moment=study_week",
        )
      ).body.data,
    ).toEqual({ show: true, trustpilot_eligible: false });
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

describe("the prompt is mounted only on the three success-moment pages", () => {
  it("ReviewPrompt is rendered from exactly these files", () => {
    const out = execFileSync(
      "git",
      [
        "grep",
        "--untracked",
        "-l",
        "-E",
        "<ReviewPrompt([[:space:]]|/|>|$)",
        "--",
        "client/src",
      ],
      { encoding: "utf8" },
    );
    const files = out
      .split("\n")
      .filter((f) => f !== "" && !/\.test\.tsx?$/.test(f))
      .sort();
    expect(files).toEqual([
      "client/src/features/exam/pages/ExamReportPage.tsx",
      "client/src/features/guardian/GuardianDashboardTab.tsx",
      "client/src/pages/calendar.tsx",
    ]);
  });

  it("the exam report asks only once the report is scored", () => {
    const src = readFileSync(
      "client/src/features/exam/pages/ExamReportPage.tsx",
      "utf8",
    );
    expect(src).toMatch(
      /\{scored \? \(\s*<div className="mt-10">\s*<ReviewPrompt/,
    );
  });
});
