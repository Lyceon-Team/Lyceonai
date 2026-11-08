/**
 * @spec [owner brief "Crisis classifier: record the failure reason, and look at the timeout",
 *       Karl 2026-11-08 (tests: "each failure type records its reason; the fail-closed path is
 *       unchanged"); CR-03C-V3-01 §3.4; SCL-023; SCL-276] | @implemented [2026-11-08]
 *
 * plain English: drives the real classifier with the SDK and the credential mocked (as the H4
 * test does), and the real case write with the database mocked.
 *  - Each failure type records its reason and attempt count: two timeouts, two 429s, a 5xx, an
 *    unreadable answer, a model not found, and a missing env var (no attempt). A failure then a
 *    success records no reason and two attempts.
 *  - The classification and the sentinel are unchanged: `classifyCrisis` still returns
 *    `{isCrisis: false, confidence: 0}` on every failure.
 *  - The case write is guarded (degraded sources only, first reason kept), never blocking (an
 *    error or a throw is logged and swallowed), and a no-op when there is nothing to record.
 *  - The migration's CHECK lists equal the shared enum.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loggerWarn = vi.fn();
const loggerError = vi.fn();
vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: (...a: unknown[]) => loggerWarn(...a),
    error: (...a: unknown[]) => loggerError(...a),
  },
}));

type Update = {
  table: string;
  values: Record<string, unknown>;
  filters: Array<[string, string, unknown]>;
};
const db = vi.hoisted(() => ({
  updates: [] as Update[],
  updateResult: { error: null } as { error: unknown },
  updateThrows: false,
}));
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => {
        const u: Update = { table, values, filters: [] };
        db.updates.push(u);
        const chain = {
          eq: (c: string, v: unknown) => (u.filters.push([c, "eq", v]), chain),
          in: (c: string, v: unknown) => (u.filters.push([c, "in", v]), chain),
          is: (c: string, v: unknown) => (u.filters.push([c, "is", v]), chain),
          then: (ok: (r: unknown) => unknown, bad: (e: unknown) => unknown) =>
            db.updateThrows
              ? Promise.reject(new Error("socket hang up")).then(ok, bad)
              : Promise.resolve(db.updateResult).then(ok, bad),
        };
        return chain;
      },
    }),
  },
}));

vi.mock("../../server/lib/gcp-credentials", () => ({
  getGcpCredentials: () => ({
    type: "service_account",
    project_id: "test-project",
    private_key_id: "fake",
    private_key: "-----BEGIN FAKE-----\nnotreal\n-----END FAKE-----\n",
    client_email: "test@test.iam.gserviceaccount.com",
    client_id: "000",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
  }),
}));

const generateContent = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: (p: unknown) => generateContent(p) };
  },
}));

/** What the SDK throws: an Error carrying the HTTP status (ApiError). */
function apiError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}
const NO_CRISIS = {
  text: JSON.stringify({ isCrisis: false, confidence: 0.9 }),
};
const SENTINEL = { isCrisis: false, confidence: 0 };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  db.updates.length = 0;
  db.updateResult = { error: null };
  db.updateThrows = false;
  process.env.VERTEX_CLASSIFIER_CLASS_MODEL = "test-classifier-model";
  process.env.VERTEX_CLASSIFIER_LOCATION = "global";
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.VERTEX_CLASSIFIER_CLASS_MODEL;
  delete process.env.VERTEX_CLASSIFIER_LOCATION;
});

async function crisis(): Promise<
  typeof import("../../server/services/tutor-crisis")
> {
  return import("../../server/services/tutor-crisis");
}

describe("classifyClassifierFailure", () => {
  it("maps each failure to its reason", async () => {
    const { classifyClassifierFailure, CrisisClassifierTimeoutError } =
      await crisis();
    expect(classifyClassifierFailure(new CrisisClassifierTimeoutError())).toBe(
      "timeout",
    );
    expect(
      classifyClassifierFailure(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      ),
    ).toBe("timeout");
    expect(classifyClassifierFailure(apiError(429, "Too Many Requests"))).toBe(
      "rate_limited",
    );
    expect(
      classifyClassifierFailure(new Error("[429] RESOURCE_EXHAUSTED quota")),
    ).toBe("rate_limited");
    expect(
      classifyClassifierFailure(apiError(503, "Service Unavailable")),
    ).toBe("upstream_error");
    expect(classifyClassifierFailure(apiError(500, "Internal"))).toBe(
      "upstream_error",
    );
    expect(classifyClassifierFailure(new Error("fetch failed"))).toBe(
      "upstream_error",
    );
    expect(classifyClassifierFailure(new SyntaxError("Unexpected token"))).toBe(
      "upstream_error",
    );
    expect(
      classifyClassifierFailure(apiError(404, "models/x is not found")),
    ).toBe("config_error");
    expect(classifyClassifierFailure(apiError(403, "PERMISSION_DENIED"))).toBe(
      "config_error",
    );
    expect(classifyClassifierFailure(new Error("UNAUTHENTICATED"))).toBe(
      "config_error",
    );
  });
});

describe("each failure type records its reason and attempts; the sentinel is unchanged", () => {
  it("two timeouts: timeout, 2 attempts, about 6 s (the 2026-11-05 shape)", async () => {
    vi.useFakeTimers();
    generateContent.mockImplementation(() => new Promise(() => undefined));
    const { classifyCrisisDetailed, CRISIS_CLASSIFIER_TIMEOUT_MS } =
      await crisis();
    const pending = classifyCrisisDetailed("answer");
    await vi.advanceTimersByTimeAsync(CRISIS_CLASSIFIER_TIMEOUT_MS * 2);
    const { result, layer2 } = await pending;
    expect(result).toEqual(SENTINEL);
    expect(layer2).toMatchObject({ attempts: 2, degradedReason: "timeout" });
    expect(layer2.ms).toBeGreaterThanOrEqual(CRISIS_CLASSIFIER_TIMEOUT_MS * 2);
  });

  const cases: Array<[string, () => Promise<never>, string]> = [
    [
      "two 429s",
      () => Promise.reject(apiError(429, "Too Many Requests")),
      "rate_limited",
    ],
    [
      "two 503s",
      () => Promise.reject(apiError(503, "Service Unavailable")),
      "upstream_error",
    ],
    [
      "a model not found",
      () => Promise.reject(apiError(404, "NOT_FOUND")),
      "config_error",
    ],
  ];
  for (const [name, fail, reason] of cases) {
    it(`${name}: ${reason}, 2 attempts`, async () => {
      generateContent.mockImplementation(fail);
      const { classifyCrisisDetailed, classifyCrisis } = await crisis();
      const { result, layer2 } = await classifyCrisisDetailed("answer");
      expect(result).toEqual(SENTINEL);
      expect(layer2).toMatchObject({ attempts: 2, degradedReason: reason });
      expect(await classifyCrisis("answer")).toEqual(SENTINEL);
    });
  }

  it("an answer the parser cannot read: upstream_error, 2 attempts", async () => {
    generateContent.mockResolvedValue({ text: "I think this is fine" });
    const { classifyCrisisDetailed } = await crisis();
    const { result, layer2 } = await classifyCrisisDetailed("answer");
    expect(result).toEqual(SENTINEL);
    expect(layer2).toMatchObject({
      attempts: 2,
      degradedReason: "upstream_error",
    });
  });

  it("a missing model env var: config_error, no model attempt", async () => {
    delete process.env.VERTEX_CLASSIFIER_CLASS_MODEL;
    const { classifyCrisisDetailed } = await crisis();
    const { result, layer2 } = await classifyCrisisDetailed("answer");
    expect(result).toEqual(SENTINEL);
    expect(layer2).toMatchObject({
      attempts: 0,
      degradedReason: "config_error",
    });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("a failure, then an answer: no reason, 2 attempts", async () => {
    generateContent
      .mockRejectedValueOnce(apiError(503, "Service Unavailable"))
      .mockResolvedValueOnce(NO_CRISIS);
    const { classifyCrisisDetailed } = await crisis();
    const { result, layer2 } = await classifyCrisisDetailed("hello");
    expect(result).toEqual({ isCrisis: false, confidence: 0.9 });
    expect(layer2).toMatchObject({ attempts: 2, degradedReason: null });
  });

  it("an answer first time: no reason, 1 attempt", async () => {
    generateContent.mockResolvedValue(NO_CRISIS);
    const { classifyCrisisDetailed } = await crisis();
    expect((await classifyCrisisDetailed("hello")).layer2).toMatchObject({
      attempts: 1,
      degradedReason: null,
    });
  });
});

describe("recordDegradedReason: guarded, never blocking", () => {
  const CASE = "cccccccc-0000-4000-8000-00000000000c";
  const crisis = (): Promise<
    typeof import("../../server/services/crisis-degraded-reason")
  > => import("../../server/services/crisis-degraded-reason");

  it("writes the reason and attempts to that degraded case only, first reason kept", async () => {
    const { recordDegradedReason } = await crisis();
    await recordDegradedReason(CASE, {
      ms: 6010,
      attempts: 2,
      degradedReason: "timeout",
    });
    expect(db.updates).toEqual([
      {
        table: "crisis_review_cases",
        values: { degraded_reason: "timeout", classifier_attempts: 2 },
        filters: [
          ["id", "eq", CASE],
          [
            "source",
            "in",
            ["classifier_degraded", "classifier_degraded_no_floor"],
          ],
          ["degraded_reason", "is", null],
        ],
      },
    ]);
  });

  it("nothing to record (Layer 2 answered, or was not measured): no write", async () => {
    const { recordDegradedReason } = await crisis();
    await recordDegradedReason(CASE, {
      ms: 400,
      attempts: 1,
      degradedReason: null,
    });
    await recordDegradedReason(CASE, undefined);
    expect(db.updates).toEqual([]);
  });

  it("an error or a throw is logged with ids and codes, and never escapes", async () => {
    const { recordDegradedReason } = await crisis();
    db.updateResult = { error: { message: "column does not exist" } };
    await expect(
      recordDegradedReason(CASE, {
        ms: 10,
        attempts: 0,
        degradedReason: "config_error",
      }),
    ).resolves.toBeUndefined();
    db.updateThrows = true;
    await expect(
      recordDegradedReason(CASE, {
        ms: 10,
        attempts: 2,
        degradedReason: "rate_limited",
      }),
    ).resolves.toBeUndefined();
    const logged = loggerError.mock.calls.filter(
      (c) => c[1] === "crisis_degraded_reason_write_failed",
    );
    expect(logged).toHaveLength(2);
    expect(logged.map((c) => c[4])).toEqual([
      { caseId: CASE, degradedReason: "config_error", attempts: 0 },
      { caseId: CASE, degradedReason: "rate_limited", attempts: 2 },
    ]);
  });
});

describe("the migration agrees with the shared enum", () => {
  it("both CHECKs list exactly crisisDegradedReasonSchema's values, and attempts 0..max", async () => {
    const { crisisDegradedReasonSchema, CRISIS_CLASSIFIER_MAX_ATTEMPTS } =
      await import("../../packages/shared/src/crisis-flag-schema");
    const sql = readFileSync(
      join(
        __dirname,
        "../../supabase/migrations/20261202000000_crisis_degraded_reason.sql",
      ),
      "utf8",
    );
    const lists = [...sql.matchAll(/degraded_reason IN \(([^)]*)\)/g)].map(
      (m) => (m[1]!.match(/'([a-z_]+)'/g) ?? []).map((v) => v.slice(1, -1)),
    );
    expect(lists).toHaveLength(2);
    for (const l of lists)
      expect(l).toEqual([...crisisDegradedReasonSchema.options]);
    expect(
      sql.match(
        new RegExp(`BETWEEN 0 AND ${CRISIS_CLASSIFIER_MAX_ATTEMPTS}`, "g"),
      ),
    ).toHaveLength(2);
  });
});
