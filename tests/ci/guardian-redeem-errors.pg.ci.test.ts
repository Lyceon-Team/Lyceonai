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
 * MOCK BOUNDARY. Substituted: the DATABASE TRANSPORT (`supabaseServer` → real SQL via
 * tests/helpers/pg-supabase, genesis + every migration) and the AUTH BOUNDARY (the guardian
 * is a real `profiles` row, read back per request). The code spend, the link write and the
 * TTL read run FOR REAL against that database by default; each case replaces exactly one of
 * them, once, with the failure under test — a thrown connection error, a foreign-instance
 * LY004 — because those are failures Postgres cannot be made to produce on demand. The
 * rate limiter, the legal-acceptance write and the route itself are never substituted. The
 * response must arrive within a hard timeout, so a hang is a red test, not a slow one.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { Client } from "pg";
import express from "express";
import request from "supertest";
import {
  makePgSupabase,
  bootstrapPgDatabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "guardian_redeem_errors_ci";
const GUARDIAN = "d1111111-1111-4111-8111-111111111111";
const STUDENT = "d2222222-2222-4222-8222-222222222222";
const RESPONSE_DEADLINE_MS = 2000;

let pg: Client;

const mocks = vi.hoisted(() => ({
  createActiveGuardianLink: vi.fn(),
  redeemStudentLinkCode: vi.fn(),
  getStudentLinkCodeTtlSeconds: vi.fn(),
}));

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pg);
  },
  supabaseAdmin: {
    get from() {
      return makePgSupabase(pg).from;
    },
  },
}));

// Each of these delegates to the REAL implementation unless a case injects a failure.
vi.mock("../../server/lib/account", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../server/lib/account")>();
  mocks.createActiveGuardianLink.mockImplementation(
    actual.createActiveGuardianLink,
  );
  return {
    ...actual,
    createActiveGuardianLink: mocks.createActiveGuardianLink,
  };
});
vi.mock("../../server/lib/student-link-code", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../server/lib/student-link-code")>();
  mocks.redeemStudentLinkCode.mockImplementation(actual.redeemStudentLinkCode);
  return { ...actual, redeemStudentLinkCode: mocks.redeemStudentLinkCode };
});
vi.mock("../../server/lib/auth-runtime-config", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../server/lib/auth-runtime-config")
    >();
  mocks.getStudentLinkCodeTtlSeconds.mockImplementation(
    actual.getStudentLinkCodeTtlSeconds,
  );
  return {
    ...actual,
    getStudentLinkCodeTtlSeconds: mocks.getStudentLinkCodeTtlSeconds,
  };
});
vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    requireSupabaseAuth: async (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      try {
        const r = await pg.query(
          `SELECT id, email, role::text AS role FROM public.profiles WHERE id = $1`,
          [GUARDIAN],
        );
        const p = r.rows[0];
        if (p) {
          (req as express.Request & { user?: unknown }).user = {
            id: p.id,
            email: p.email,
            role: p.role,
            isGuardian: p.role === "guardian",
            isAdmin: p.role === "admin",
          };
        }
        next();
      } catch (err) {
        next(err);
      }
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

/** A live code, issued by the real domain module and stored on the student's real row. */
async function liveCode(): Promise<string> {
  const { issueStudentLinkCode } =
    await import("../../server/lib/student-link-code");
  const issued = await issueStudentLinkCode(STUDENT);
  expect(issued).not.toBeNull();
  return issued!.code;
}

async function redeem(code: string): Promise<request.Response> {
  return request(await buildApp())
    .post("/api/guardian/link/redeem")
    .send({ code, acceptParentGuardianTerms: true })
    .timeout({ response: RESPONSE_DEADLINE_MS });
}

describe.skipIf(!PG_AVAILABLE)(
  "G1-05 redeem always answers — real Postgres",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4)`,
        [GUARDIAN, "g@example.test", STUDENT, "s@example.test"],
      );
      // G1-02: redeem refuses a guardian with no date of birth or under 18, so the guardian
      // under test is an adult. Fixture only; no case below depends on the age rule.
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, date_of_birth) VALUES
         ($1,$2,'guardian',DATE '1980-01-01'),($3,$4,'student',NULL)`,
        [GUARDIAN, "g@example.test", STUDENT, "s@example.test"],
      );
    });

    afterAll(async () => {
      if (pg) await pg.end();
    });

    beforeEach(async () => {
      await pg.query(`DELETE FROM public.guardian_links`);
      await pg.query(`DELETE FROM public.notification_events`);
      await pg.query(`DELETE FROM public.rate_limit_ledger`);
      await pg.query(
        `UPDATE public.profiles SET student_link_code = NULL, student_link_code_issued_at = NULL`,
      );
    });

    it("presence: with nothing injected, the real path links and answers 201", async () => {
      const res = await redeem(await liveCode());
      expect(res.status).toBe(201);
      const links = await pg.query(
        `SELECT count(*)::int AS c FROM public.guardian_links WHERE status='active'`,
      );
      expect(links.rows[0].c).toBe(1);
    });

    it("a non-contract error from the link write returns 500 within the deadline", async () => {
      mocks.createActiveGuardianLink.mockRejectedValueOnce(
        new Error("connection reset"),
      );
      const res = await redeem(await liveCode());
      expect(res.status).toBe(500);
      // The internal message never reaches the client.
      expect(JSON.stringify(res.body)).not.toContain("connection reset");
    });

    it("a foreign-instance ALREADY_EXISTS error returns 409 (matched on its code, not its class)", async () => {
      const { GUARDIAN_LINK_ERROR } =
        await import("../../packages/shared/src/guardian-link-schema");
      mocks.createActiveGuardianLink.mockRejectedValueOnce(
        new ForeignLinkError(GUARDIAN_LINK_ERROR.ALREADY_EXISTS),
      );
      const res = await redeem(await liveCode());
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(GUARDIAN_LINK_ERROR.ALREADY_EXISTS);
    });

    it("a throw while spending the code returns 500 within the deadline", async () => {
      mocks.redeemStudentLinkCode.mockRejectedValueOnce(
        new Error("socket hang up"),
      );
      const res = await redeem(await liveCode());
      expect(res.status).toBe(500);
    });

    it("a throw while reading the code TTL returns 500 within the deadline", async () => {
      mocks.getStudentLinkCodeTtlSeconds.mockRejectedValueOnce(
        new Error("config read failed"),
      );
      const res = await redeem(await liveCode());
      expect(res.status).toBe(500);
    });
  },
);
