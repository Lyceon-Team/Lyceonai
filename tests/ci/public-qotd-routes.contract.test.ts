/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md R16-R19, Q2 acceptance ("CI: nulls pre-submit;
 *       future date -> 404; missing/invalid Turnstile rejected; 429 + Retry-After; stat hidden
 *       below 5 attempts; no quota rows written"); SCL-202; Coding Standards §5.2, §12.1, §14]
 *       | @implemented [2026-10-05]
 *
 * plain English: the real router over a fake Supabase. The fake answers exactly the calls the
 * route is allowed to make — the anonymous ledger, the bucket map, and the QOTD functions — with
 * the shared fixture rows (real SQL output) and the bucket limits read out of the migration that
 * seeds them, and RECORDS every call. So "no quota rows written" is asserted as "no call outside
 * that set was made", which a new quota call, a profile-keyed ledger call or a table write would
 * break. Turnstile's siteverify is stubbed at `fetch`.
 *
 * The clock is pinned (Date only) inside 2026-10-05 America/Chicago, the fixture's "today".
 */
import { readFileSync } from "node:fs";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express from "express";
import request from "supertest";
import {
  QOTD_ARCHIVE_ROWS,
  QOTD_FIXTURE_NOW,
  QOTD_FIXTURE_TODAY,
  qotdTodayRow,
} from "../lib/qotd-fixture";
import { TURNSTILE_SITEVERIFY_URL } from "../../server/lib/turnstile";
import { qotdOptionToken } from "../../server/services/qotd/option-tokens";

type Call = { fn: string; args: Record<string, unknown> };

const fake = vi.hoisted(() => {
  const state = {
    calls: [] as { fn: string; args: Record<string, unknown> }[],
    tables: [] as string[],
    ledger: new Map<string, number>(),
    stats: new Map<string, { attempts: number; correct: number }>(),
    buckets: {} as Record<string, unknown>,
    failRecordAttempt: false,
    rows: {
      today: null as Record<string, unknown> | null,
      archive: [] as Record<string, unknown>[],
    },
  };
  const client = {
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      state.calls.push({ fn, args });
      if (fn === "rate_limit_check_and_increment_anon") {
        const key = `${String(args.p_subject_hmac)}|${String(args.p_bucket_key)}|${String(args.p_window_start)}`;
        const used = state.ledger.get(key) ?? 0;
        const limit = Number(args.p_limit);
        const cost = Number(args.p_cost);
        if (used + cost <= limit) {
          state.ledger.set(key, used + cost);
          return {
            data: [
              {
                allowed: true,
                used: used + cost,
                remaining: limit - used - cost,
              },
            ],
            error: null,
          };
        }
        return {
          data: [
            { allowed: false, used, remaining: Math.max(limit - used, 0) },
          ],
          error: null,
        };
      }
      if (fn === "qotd_question_for") {
        const today = state.rows.today;
        const p = args.p_date as string | null;
        if (today && (p === null || p === today.qotd_date)) {
          const s = state.stats.get(String(today.qotd_date));
          return {
            data: [
              {
                ...today,
                attempts: s?.attempts ?? 0,
                correct: s?.correct ?? 0,
              },
            ],
            error: null,
          };
        }
        // Like the SQL: only days that have arrived (the archive holds strictly past ones).
        const past = state.rows.archive.find((r) => r.qotd_date === p);
        return {
          data: past ? [{ ...past, attempts: 0, correct: 0 }] : [],
          error: null,
        };
      }
      if (fn === "qotd_archive")
        return { data: state.rows.archive, error: null };
      if (fn === "qotd_record_attempt") {
        if (state.failRecordAttempt)
          return { data: null, error: { message: "simulated failure" } };
        const d = String(args.p_date);
        const s = state.stats.get(d) ?? { attempts: 0, correct: 0 };
        const next = {
          attempts: s.attempts + 1,
          correct: s.correct + (args.p_correct === true ? 1 : 0),
        };
        state.stats.set(d, next);
        return { data: [next], error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
    from: (table: string) => {
      state.tables.push(table);
      return {
        select: () => ({
          eq: (_col: string, key: unknown) => ({
            maybeSingle: async () =>
              table === "rate_limit_runtime_config" &&
              key === "bucket_definitions"
                ? { data: { value: state.buckets }, error: null }
                : { data: null, error: null },
          }),
        }),
      };
    },
  };
  return { state, client };
});

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: fake.client,
}));

/** The qotd_* bucket limits, read from the migration that seeds them (no second copy). */
function bucketsFromMigration(): Record<string, unknown> {
  const sql = readFileSync(
    "supabase/migrations/20261020010000_rate_limit_ledger_anon.sql",
    "utf8",
  );
  const out: Record<string, unknown> = {};
  for (const m of sql.matchAll(
    /'(qotd_[a-z_]+)',\s*jsonb_build_object\('limit',\s*(\d+),\s*'window_seconds',\s*(\d+)\)/g,
  )) {
    out[m[1] ?? ""] = { limit: Number(m[2]), window_seconds: Number(m[3]) };
  }
  return out;
}

const siteverify = vi.fn();
const realFetch = globalThis.fetch;

let app: express.Express;
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

const today = qotdTodayRow();
const PASS = "pass-token";

/** The fixture's option text for a canonical key. */
function optionText(key: string): string {
  const options = today.options as { key: string; text: string }[];
  const text = options.find((o) => o.key === key)?.text;
  if (text === undefined) throw new Error(`fixture has no option ${key}`);
  return text;
}

type ServedOption = { id: string; text: string };

/** GET /today from a fresh IP: the options exactly as a visitor receives them. */
async function served(): Promise<ServedOption[]> {
  const res = await request(app)
    .get("/api/public/qotd/today")
    .set("x-vercel-forwarded-for", nextIp());
  expect(res.status).toBe(200);
  return res.body.data.question.options as ServedOption[];
}

/** The token the API serves for a canonical key (found by its text, as a visitor would). */
async function tokenFor(key: string): Promise<string> {
  const token = (await served()).find((o) => o.text === optionText(key))?.id;
  if (!token) throw new Error(`no served option for ${key}`);
  return token;
}

const WRONG_KEY = () =>
  ["A", "B", "C", "D"].find((k) => k !== today.correct_answer) ?? "A";

function submit(ip: string, body: Record<string, unknown>) {
  return request(app)
    .post("/api/public/qotd/today/answer")
    .set("x-vercel-forwarded-for", ip)
    .send(body);
}

beforeAll(async () => {
  vi.useFakeTimers({ now: QOTD_FIXTURE_NOW, toFake: ["Date"] });
  process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET = "test-hmac-secret-not-real";
  process.env.TURNSTILE_SECRET_KEY = "test-turnstile-secret-not-real";
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    if (String(url) === TURNSTILE_SITEVERIFY_URL) return siteverify(init);
    return realFetch(url as string, init);
  });
  const router = (await import("../../server/routes/public-qotd-routes"))
    .default;
  app = express();
  app.use(express.json());
  app.use("/api/public/qotd", router);
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  fake.state.calls.length = 0;
  fake.state.tables.length = 0;
  fake.state.ledger.clear();
  fake.state.stats.clear();
  fake.state.failRecordAttempt = false;
  fake.state.buckets = bucketsFromMigration();
  fake.state.rows.today = { ...today };
  fake.state.rows.archive = QOTD_ARCHIVE_ROWS.map((r) => ({ ...r }));
  siteverify.mockReset();
  siteverify.mockImplementation(async (init?: RequestInit) => {
    const form = new URLSearchParams(String(init?.body ?? ""));
    const ok = form.get("response") === PASS;
    return new Response(
      JSON.stringify(
        ok
          ? { success: true }
          : { success: false, "error-codes": ["invalid-input-response"] },
      ),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
});

const ALLOWED_RPCS = new Set([
  "rate_limit_check_and_increment_anon",
  "qotd_question_for",
  "qotd_archive",
  "qotd_record_attempt",
]);

function assertOnlyAllowedCalls(): void {
  const fns = fake.state.calls.map((c) => c.fn);
  for (const fn of fns) expect(ALLOWED_RPCS.has(fn), fn).toBe(true);
  for (const t of fake.state.tables)
    expect(t).toBe("rate_limit_runtime_config");
}

describe("the fixture and the fake are non-trivial", () => {
  it("the bucket map was read from the migration and the fixture has a today row and archive days", () => {
    expect(Object.keys(fake.state.buckets).sort()).toEqual([
      "qotd_read_ip",
      "qotd_stat_ip",
      "qotd_submit_ip",
    ]);
    expect(today.qotd_date).toBe(QOTD_FIXTURE_TODAY);
    expect(today.correct_answer).toBeTruthy();
    expect(today.explanation).toBeTruthy();
    expect(QOTD_ARCHIVE_ROWS.length).toBeGreaterThan(0);
  });
});

describe("GET /today — pre-submit payload (§5.2)", () => {
  it("returns the question with correct_answer and explanation null, and nothing that names the answer", async () => {
    const res = await request(app)
      .get("/api/public/qotd/today")
      .set("x-vercel-forwarded-for", nextIp());
    expect(res.status).toBe(200);
    // Owner ruling 2026-10-05: each response carries its own shuffle, so nothing may cache it.
    expect(res.headers["cache-control"]).toBe("private, no-store");
    const q = res.body.data.question;
    // Presence before absence.
    expect(q.stem).toBe(today.stem);
    expect(q.options).toHaveLength(4);
    expect(q.correct_answer).toBeNull();
    expect(q.explanation).toBeNull();
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(String(today.explanation));
    expect(raw).not.toContain("correct_option_id");
    expect(raw).not.toContain("correct_variants");
    // No canonical question id anywhere, and no option carries a canonical letter.
    expect(raw).not.toContain(today.question_id);
    for (const o of q.options as ServedOption[]) {
      expect(o.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(["A", "B", "C", "D"]).not.toContain(o.id);
      expect(Object.keys(o).sort()).toEqual(["id", "text"]);
    }
    expect(Object.keys(q).sort()).toEqual(
      [
        "correct_answer",
        "domain",
        "explanation",
        "item_type",
        "options",
        "passage",
        "section_code",
        "stem",
      ].sort(),
    );
    assertOnlyAllowedCalls();
  });

  it("404 when no question is scheduled today", async () => {
    fake.state.rows.today = null;
    const res = await request(app)
      .get("/api/public/qotd/today")
      .set("x-vercel-forwarded-for", nextIp());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("qotd_not_scheduled");
  });

  it("fails closed (503) when the HMAC secret is missing — never limits on a raw IP", async () => {
    const saved = process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET;
    delete process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET;
    try {
      const res = await request(app)
        .get("/api/public/qotd/today")
        .set("x-vercel-forwarded-for", nextIp());
      expect(res.status).toBe(503);
      expect(fake.state.calls).toHaveLength(0);
    } finally {
      process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET = saved;
    }
  });
});

describe("GET /:date — the archive", () => {
  it("a past day returns its answer and explanation", async () => {
    const past = QOTD_ARCHIVE_ROWS[0];
    const res = await request(app)
      .get(`/api/public/qotd/${String(past?.qotd_date)}`)
      .set("x-vercel-forwarded-for", nextIp());
    expect(res.status).toBe(200);
    expect(res.body.data.question.explanation).toBe(past?.explanation);
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
  });

  it.each([
    ["today", QOTD_FIXTURE_TODAY],
    ["tomorrow", "2026-10-06"],
    ["far future", "2027-01-01"],
  ])("%s is 404 and reads nothing from the database", async (_label, date) => {
    const res = await request(app)
      .get(`/api/public/qotd/${date}`)
      .set("x-vercel-forwarded-for", nextIp());
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(String(today.explanation));
    expect(fake.state.calls.map((c) => c.fn)).not.toContain(
      "qotd_question_for",
    );
  });

  it("an invalid date is 400", async () => {
    const res = await request(app)
      .get("/api/public/qotd/2026-02-30")
      .set("x-vercel-forwarded-for", nextIp());
    expect(res.status).toBe(400);
  });

  it("GET /archive lists past days newest first, date/section/domain only", async () => {
    const res = await request(app)
      .get("/api/public/qotd/archive")
      .set("x-vercel-forwarded-for", nextIp());
    expect(res.status).toBe(200);
    const days = res.body.data.days as { qotd_date: string }[];
    expect(days.map((d) => d.qotd_date)).toEqual(
      QOTD_ARCHIVE_ROWS.map((r) => r.qotd_date)
        .sort()
        .reverse(),
    );
    expect(JSON.stringify(res.body)).not.toMatch(/explanation|correct|stem/);
  });
});

describe("POST /today/answer — Turnstile first (SCL-202 item 2)", () => {
  it("a missing token is 403 before any other work", async () => {
    const res = await submit(nextIp(), {
      qotd_date: QOTD_FIXTURE_TODAY,
      answer: "C",
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("turnstile_failed");
    expect(siteverify).not.toHaveBeenCalled();
    expect(fake.state.calls).toHaveLength(0);
  });

  it("an invalid token is 403 after siteverify, with no limiter or database call", async () => {
    const res = await submit(nextIp(), {
      qotd_date: QOTD_FIXTURE_TODAY,
      answer: "C",
      turnstile_token: "forged",
    });
    expect(res.status).toBe(403);
    expect(siteverify).toHaveBeenCalledTimes(1);
    expect(fake.state.calls).toHaveLength(0);
    expect(JSON.stringify(res.body)).not.toContain(String(today.explanation));
  });

  it("siteverify unreachable is 503, never a pass", async () => {
    siteverify.mockRejectedValueOnce(new TypeError("fetch failed"));
    const res = await submit(nextIp(), {
      qotd_date: QOTD_FIXTURE_TODAY,
      answer: "C",
      turnstile_token: PASS,
    });
    expect(res.status).toBe(503);
    expect(fake.state.calls).toHaveLength(0);
  });

  it("production with no TURNSTILE_SECRET_KEY: every submit is 503 and nothing else runs (INV-10A-09)", async () => {
    const saved = {
      secret: process.env.TURNSTILE_SECRET_KEY,
      vercel: process.env.VERCEL_ENV,
    };
    try {
      delete process.env.TURNSTILE_SECRET_KEY;
      process.env.VERCEL_ENV = "production";
      for (const token of [PASS, undefined]) {
        const res = await submit(nextIp(), {
          qotd_date: QOTD_FIXTURE_TODAY,
          answer: "C",
          ...(token ? { turnstile_token: token } : {}),
        });
        expect(res.status).toBe(503);
      }
      expect(siteverify).not.toHaveBeenCalled();
      expect(fake.state.calls).toHaveLength(0);
    } finally {
      if (saved.secret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
      else process.env.TURNSTILE_SECRET_KEY = saved.secret;
      if (saved.vercel === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = saved.vercel;
    }
  });

  it("siteverify receives the secret and the token, and NOT the caller's IP", async () => {
    await submit("198.51.100.77", {
      qotd_date: QOTD_FIXTURE_TODAY,
      answer: "C",
      turnstile_token: PASS,
    });
    const form = new URLSearchParams(
      String((siteverify.mock.calls[0]?.[0] as RequestInit | undefined)?.body),
    );
    expect(form.get("response")).toBe(PASS);
    expect(form.get("secret")).toBe("test-turnstile-secret-not-real");
    expect(form.has("remoteip")).toBe(false);
  });
});

describe("POST /today/answer — grading, reveal, stats, quota", () => {
  it("a correct answer reveals correctness, the correct choice and the explanation", async () => {
    const res = await submit(nextIp(), {
      qotd_date: QOTD_FIXTURE_TODAY,
      answer: await tokenFor(String(today.correct_answer)),
      turnstile_token: PASS,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      qotd_date: QOTD_FIXTURE_TODAY,
      is_correct: true,
      correct_option_id: await tokenFor(String(today.correct_answer)),
      explanation: today.explanation,
    });
    assertOnlyAllowedCalls();
  });

  it("the stat is hidden below 5 counted attempts, shown from the 5th, and a repeat from one IP counts once", async () => {
    const statuses: string[] = [];
    const right = await tokenFor(String(today.correct_answer));
    const wrong = await tokenFor(WRONG_KEY());
    for (let i = 0; i < 4; i += 1) {
      const res = await submit(nextIp(), {
        qotd_date: QOTD_FIXTURE_TODAY,
        answer: i === 0 ? wrong : right,
        turnstile_token: PASS,
      });
      expect(res.status).toBe(200);
      statuses.push(res.body.data.stats.status);
      expect(res.body.data.stats).not.toHaveProperty("percent_correct");
    }
    expect(statuses).toEqual(["hidden", "hidden", "hidden", "hidden"]);

    // Same IP again: graded, but not counted — still 4 attempts, still hidden.
    const repeatIp = `203.0.113.${ipCounter}`;
    const repeat = await submit(repeatIp, {
      qotd_date: QOTD_FIXTURE_TODAY,
      answer: right,
      turnstile_token: PASS,
    });
    expect(repeat.body.data.stats).toEqual({ status: "hidden" });
    expect(fake.state.stats.get(QOTD_FIXTURE_TODAY)?.attempts).toBe(4);

    const fifth = await submit(nextIp(), {
      qotd_date: QOTD_FIXTURE_TODAY,
      answer: right,
      turnstile_token: PASS,
    });
    // 5 attempts, 4 correct (the first was wrong).
    expect(fifth.body.data.stats).toEqual({
      status: "shown",
      percent_correct: 80,
    });
    assertOnlyAllowedCalls();
  });

  it("writes no quota or practice row: only the anonymous ledger, the QOTD functions and the bucket map are touched", async () => {
    await submit(nextIp(), {
      qotd_date: QOTD_FIXTURE_TODAY,
      answer: await tokenFor("B"),
      turnstile_token: PASS,
    });
    const fns = fake.state.calls.map((c) => c.fn);
    expect(fns).toContain("qotd_record_attempt");
    expect(fns).not.toContain("rate_limit_check_and_increment");
    assertOnlyAllowedCalls();
  });

  it("the ledger subject is the keyed HMAC of the IP, never the IP", async () => {
    const ip = "198.51.100.23";
    await submit(ip, {
      qotd_date: QOTD_FIXTURE_TODAY,
      answer: await tokenFor("B"),
      turnstile_token: PASS,
    });
    const ledgerCalls = fake.state.calls.filter(
      (c: Call) => c.fn === "rate_limit_check_and_increment_anon",
    );
    expect(ledgerCalls.length).toBeGreaterThanOrEqual(2);
    for (const c of ledgerCalls) {
      expect(String(c.args.p_subject_hmac)).toMatch(/^\\x[0-9a-f]{64}$/);
      expect(JSON.stringify(c.args)).not.toContain(ip);
    }
  });

  it("the 31st submit from one IP in an hour is 429 with Retry-After; another IP is unaffected", async () => {
    const ip = nextIp();
    const limit = (fake.state.buckets.qotd_submit_ip as { limit: number })
      .limit;
    expect(limit).toBe(30);
    for (let i = 0; i < limit; i += 1) {
      const ok = await submit(ip, {
        qotd_date: QOTD_FIXTURE_TODAY,
        answer: await tokenFor("B"),
        turnstile_token: PASS,
      });
      expect(ok.status, `submit ${i + 1}`).toBe(200);
    }
    const denied = await submit(ip, {
      qotd_date: QOTD_FIXTURE_TODAY,
      answer: await tokenFor("B"),
      turnstile_token: PASS,
    });
    expect(denied.status).toBe(429);
    const retryAfter = Number(denied.headers["retry-after"]);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(3600);
    expect(JSON.stringify(denied.body)).not.toContain(
      String(today.explanation),
    );

    const other = await submit(nextIp(), {
      qotd_date: QOTD_FIXTURE_TODAY,
      answer: await tokenFor("B"),
      turnstile_token: PASS,
    });
    expect(other.status).toBe(200);
  });

  it("an answer for a day that is not today is 409, with no reveal", async () => {
    const res = await submit(nextIp(), {
      qotd_date: "2026-10-04",
      answer: "B",
      turnstile_token: PASS,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("qotd_day_changed");
    expect(fake.state.calls.map((c) => c.fn)).not.toContain(
      "qotd_question_for",
    );
  });

  it("a failed counter write still returns the reveal, uncounted (the visitor never loses the answer)", async () => {
    fake.state.failRecordAttempt = true;
    const res = await submit(nextIp(), {
      qotd_date: QOTD_FIXTURE_TODAY,
      answer: await tokenFor(String(today.correct_answer)),
      turnstile_token: PASS,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.is_correct).toBe(true);
    expect(res.body.data.explanation).toBe(today.explanation);
    expect(res.body.data.stats).toEqual({ status: "hidden" });
    expect(fake.state.stats.get(QOTD_FIXTURE_TODAY)).toBeUndefined();
  });

  it("an unparseable body is 400", async () => {
    const res = await submit(nextIp(), {
      qotd_date: QOTD_FIXTURE_TODAY,
      turnstile_token: PASS,
    });
    expect(res.status).toBe(400);
  });
});

describe("owner ruling 2026-10-05: server-side shuffle with opaque tokens", () => {
  it("two requests (and more) return different option orders over the same four tokens", async () => {
    const orders = new Set<string>();
    let tokenSet: string | null = null;
    for (let i = 0; i < 30; i += 1) {
      const options = await served();
      orders.add(options.map((o) => o.text).join("|"));
      const tokens = options
        .map((o) => o.id)
        .sort()
        .join("|");
      // Stateless: every request carries the same four tokens, only the order changes.
      if (tokenSet === null) tokenSet = tokens;
      expect(tokens).toBe(tokenSet);
    }
    // Four options shuffled 30 times: the chance of a single order is 24^-29.
    expect(orders.size).toBeGreaterThan(1);
  });

  it("each token resolves to its own option: only the correct one grades correct, and the reveal names it by token", async () => {
    const options = await served();
    const correctText = optionText(String(today.correct_answer));
    const correctToken = options.find((o) => o.text === correctText)?.id;
    expect(correctToken).toBeDefined();
    for (const o of options) {
      const res = await submit(nextIp(), {
        qotd_date: QOTD_FIXTURE_TODAY,
        answer: o.id,
        turnstile_token: PASS,
      });
      expect(res.status, o.text).toBe(200);
      expect(res.body.data.is_correct, o.text).toBe(o.text === correctText);
      expect(res.body.data.correct_option_id).toBe(correctToken);
    }
  });

  it.each([
    [
      "a tampered token",
      (t: string) => `${t.slice(0, 21)}${t.endsWith("A") ? "B" : "A"}`,
    ],
    ["a bare canonical letter", () => String(today.correct_answer)],
    [
      "another day's token",
      () => qotdOptionToken("2026-10-04", String(today.correct_answer)),
    ],
  ])("%s is rejected (400) with no reveal", async (_label, make) => {
    const answer = make(await tokenFor(String(today.correct_answer)));
    const res = await submit(nextIp(), {
      qotd_date: QOTD_FIXTURE_TODAY,
      answer,
      turnstile_token: PASS,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_answer");
    expect(JSON.stringify(res.body)).not.toContain(String(today.explanation));
    expect(fake.state.calls.map((c) => c.fn)).not.toContain(
      "qotd_record_attempt",
    );
  });

  it("a day scheduled before the letter screen, whose explanation names a choice letter, is served in canonical order (letters match the explanation)", async () => {
    fake.state.rows.today = {
      ...today,
      explanation: "Choice C is correct: 8 times 3 is 24.",
    };
    const canonical = (today.options as { key: string; text: string }[]).map(
      (o) => o.text,
    );
    for (let i = 0; i < 10; i += 1) {
      const options = await served();
      expect(options.map((o) => o.text)).toEqual(canonical);
      for (const o of options) expect(o.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });

  it("no canonical question id in the archive payloads either (keyed by qotd_date)", async () => {
    const past = QOTD_ARCHIVE_ROWS[0];
    const day = await request(app)
      .get(`/api/public/qotd/${String(past?.qotd_date)}`)
      .set("x-vercel-forwarded-for", nextIp());
    expect(day.status).toBe(200);
    expect(day.body.data.question).not.toHaveProperty("id");
    expect(JSON.stringify(day.body)).not.toContain(String(past?.question_id));
    const index = await request(app)
      .get("/api/public/qotd/archive")
      .set("x-vercel-forwarded-for", nextIp());
    for (const row of QOTD_ARCHIVE_ROWS) {
      expect(JSON.stringify(index.body)).not.toContain(row.question_id);
    }
  });
});
