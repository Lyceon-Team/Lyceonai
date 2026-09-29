/**
 * POST /api/guardian/link/redeem answers on EVERY error branch.
 *
 * @spec [Guardian_Closure_Plan G1-05 named proof; audit G-AUD-08; Coding Standards §13
 *        (no swallowed failure), §8.3 (409 for a state conflict)] | @implemented [2026-09-29]
 *
 * plain English: the handler is `async` under Express 4, which does not catch a rejected
 * handler promise. Its error branch ended in `throw err`, so any failure other than a
 * recognised "already linked" left the request with NO response — it hung until the client
 * gave up. And "recognised" was `err instanceof GuardianLinkError`, which is false whenever
 * the thrower's copy of the class is not the importer's (a bundler duplicate, a test module
 * mock), so a genuine 409 hung too.
 *
 * MOCK BOUNDARY. Only the collaborators whose FAILURE is under test are substituted: the
 * code spend, the link write, the TTL read, the rate limiter, and the auth session. The
 * route itself is real. The response must arrive within a hard timeout, so a hang is a red
 * test, not a slow one.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const GUARDIAN = "d1111111-1111-4111-8111-111111111111";
const STUDENT = "d2222222-2222-4222-8222-222222222222";
const RESPONSE_DEADLINE_MS = 2000;

const mocks = vi.hoisted(() => ({
  createActiveGuardianLink: vi.fn(),
  redeemStudentLinkCode: vi.fn(),
  getStudentLinkCodeTtlSeconds: vi.fn(),
}));

vi.mock("../../server/lib/account", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createActiveGuardianLink: mocks.createActiveGuardianLink,
  };
});
vi.mock("../../server/lib/student-link-code", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, redeemStudentLinkCode: mocks.redeemStudentLinkCode };
});
vi.mock("../../server/lib/auth-runtime-config", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getStudentLinkCodeTtlSeconds: mocks.getStudentLinkCodeTtlSeconds,
  };
});
vi.mock(
  "../../server/middleware/guardian-link-rate-limit",
  async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
      ...actual,
      guardianLinkCodeEntryRateLimit: (
        _q: express.Request,
        _s: express.Response,
        next: express.NextFunction,
      ) => next(),
    };
  },
);
vi.mock("../../server/lib/legal-acceptance", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, recordLegalAcceptances: vi.fn(async () => undefined) };
});
vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    requireSupabaseAuth: (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      (req as express.Request & { user?: unknown }).user = {
        id: GUARDIAN,
        email: "g@example.test",
        role: "guardian",
        isGuardian: true,
        isAdmin: false,
      };
      next();
    },
  };
});

/** A class that is NOT the imported GuardianLinkError but carries its contract. */
class ForeignLinkError extends Error {
  readonly code: string;
  constructor(code: string) {
    super("already linked (thrown by another module instance)");
    this.code = code;
  }
}

async function buildApp(): Promise<express.Express> {
  const router = (await import("../../server/routes/guardian-routes")).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { requestId?: string }).requestId = "g1-05";
    next();
  });
  app.use("/api/guardian", router);
  return app;
}

async function redeem(): Promise<request.Response> {
  return request(await buildApp())
    .post("/api/guardian/link/redeem")
    .send({ code: "ABCDEF", acceptParentGuardianTerms: true })
    .timeout({ response: RESPONSE_DEADLINE_MS });
}

describe("G1-05 redeem always answers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStudentLinkCodeTtlSeconds.mockResolvedValue(86_400);
    mocks.redeemStudentLinkCode.mockResolvedValue({
      ok: true,
      studentProfileId: STUDENT,
    });
  });

  it("a non-contract error from the link write returns 500 within the deadline", async () => {
    mocks.createActiveGuardianLink.mockRejectedValue(
      new Error("connection reset"),
    );
    const res = await redeem();
    expect(res.status).toBe(500);
    // The internal message never reaches the client.
    expect(JSON.stringify(res.body)).not.toContain("connection reset");
  });

  it("a foreign-instance ALREADY_EXISTS error returns 409 (matched on its code, not its class)", async () => {
    const { GUARDIAN_LINK_ERROR } =
      await import("../../packages/shared/src/guardian-link-schema");
    mocks.createActiveGuardianLink.mockRejectedValue(
      new ForeignLinkError(GUARDIAN_LINK_ERROR.ALREADY_EXISTS),
    );
    const res = await redeem();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(GUARDIAN_LINK_ERROR.ALREADY_EXISTS);
  });

  it("a throw while spending the code returns 500 within the deadline", async () => {
    mocks.redeemStudentLinkCode.mockRejectedValue(new Error("socket hang up"));
    const res = await redeem();
    expect(res.status).toBe(500);
  });

  it("a throw while reading the code TTL returns 500 within the deadline", async () => {
    mocks.getStudentLinkCodeTtlSeconds.mockRejectedValue(
      new Error("config read failed"),
    );
    const res = await redeem();
    expect(res.status).toBe(500);
  });
});
