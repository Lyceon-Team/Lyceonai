/**
 * Guardian invite by email — real PostgreSQL proof.
 *
 * @spec [Doc-01_V8 §36.2 (10/day per student, 3/day per address via RateLimitLedger), §38.1
 *        (no progress data before the link exists); contracts/notifications.contract.md §0.4
 *        (direct send), §5.3, §12.3; SCL-080 (the code is the credential, redeem unchanged);
 *        owner brief 2026-09-15 Part B, tests B4.1–B4.5] | @implemented [2026-09-15]
 *
 * plain English: drives the REAL invite route against the REAL ledger function and the REAL
 * link-code lifecycle on a throwaway Postgres; the network is a fake Resend that records every
 * request. What is proved: a repeated submit carries the same idempotency key; the fourth
 * invite to one address in a day is a 429 and the daily bucket is rolled back for it; the
 * email carries the code and the prefilled redeem link and nothing about progress; redeeming
 * without a session is refused by the REAL auth middleware and creates no link; and the
 * response is byte-identical for an address that has an account and one that does not.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Client } from "pg";
import express from "express";
import request from "supertest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import { guardianLinkInviteIdempotencyKey } from "../../server/lib/notifications/direct-sends";

const DB_NAME = "guardian_invite_ci";
const GUARDIAN = "11111111-1111-4111-8111-111111111111";
const STUDENT = "22222222-2222-4222-8222-222222222222";
const GUARDIAN_EMAIL = "guardian@example.test";
const STUDENT_EMAIL = "student@example.test";
const FROM_EMAIL = "notifications@send.example.test";
const SITE = "https://app.example.test";

let pg: Client;
const session = { id: STUDENT, role: "student" as string };
/** Captured so the "redeem without auth" case can mount the REAL middleware. */
let realRequireSupabaseAuth: express.RequestHandler;

type CapturedRequest = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};
const fakeResend = { requests: [] as CapturedRequest[], nextId: 1 };

async function fakeFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  fakeResend.requests.push({
    url: typeof input === "string" ? input : input.toString(),
    headers: Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    ),
    body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
  });
  return new Response(JSON.stringify({ id: `re_${fakeResend.nextId++}` }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

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

vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  realRequireSupabaseAuth =
    actual.requireSupabaseAuth as express.RequestHandler;
  return {
    ...actual,
    requireSupabaseAuth: (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      (req as express.Request & { user?: unknown }).user = {
        id: session.id,
        email: "party@example.test",
        role: session.role,
      };
      next();
    },
  };
});

vi.mock("../../server/middleware/csrf", () => ({
  doubleCsrfProtection: (_q: unknown, _s: unknown, next: () => void) => next(),
  generateToken: () => "test-csrf-token",
}));

async function buildApp(): Promise<express.Express> {
  const studentRouter = (await import("../../server/routes/student-resources"))
    .default;
  const { requireSupabaseAuth } =
    await import("../../server/middleware/supabase-auth");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { requestId?: string }).requestId = "invite-ci";
    next();
  });
  app.use("/api/students", requireSupabaseAuth, studentRouter);
  app.use(
    (
      err: Error,
      _rq: express.Request,
      rs: express.Response,
      _n: express.NextFunction,
    ) => {
      rs.status(500).json({ error: String(err?.message ?? err) });
    },
  );
  return app;
}

/** The guardian router behind the REAL auth middleware, as server/index.ts mounts it. */
async function buildUnauthenticatedGuardianApp(): Promise<express.Express> {
  const guardianRouter = (await import("../../server/routes/guardian-routes"))
    .default;
  const app = express();
  app.use(express.json());
  app.use("/api/guardian", realRequireSupabaseAuth, guardianRouter);
  return app;
}

function invite(app: express.Express, email: string) {
  return request(app)
    .post(`/api/students/${STUDENT}/link-code/invite`)
    .send({ email });
}

async function studentCodeRow(): Promise<{
  code: string | null;
  issuedAt: Date | null;
}> {
  const r = await pg.query(
    `SELECT student_link_code AS code, student_link_code_issued_at AS issued FROM public.profiles WHERE id = $1`,
    [STUDENT],
  );
  return {
    code: (r.rows[0]?.code as string | null) ?? null,
    issuedAt: (r.rows[0]?.issued as Date | null) ?? null,
  };
}

describe.skipIf(!PG_AVAILABLE)(
  "guardian invite by email — real Postgres",
  () => {
    beforeAll(async () => {
      process.env.RESEND_API_KEY = "re_test_key";
      process.env.NOTIFICATION_FROM_EMAIL = FROM_EMAIL;
      process.env.PUBLIC_SITE_URL = SITE;
      vi.stubGlobal("fetch", fakeFetch);

      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4)`,
        [GUARDIAN, GUARDIAN_EMAIL, STUDENT, STUDENT_EMAIL],
      );
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, display_name) VALUES
         ($1,$2,'guardian','Gia Guardian'),($3,$4,'student','Sam <Student>')`,
        [GUARDIAN, GUARDIAN_EMAIL, STUDENT, STUDENT_EMAIL],
      );
    });

    afterAll(async () => {
      vi.unstubAllGlobals();
      if (pg) await pg.end();
    });

    beforeEach(async () => {
      session.id = STUDENT;
      session.role = "student";
      fakeResend.requests = [];
      fakeResend.nextId = 1;
      await pg.query(`DELETE FROM public.guardian_links`);
      await pg.query(`DELETE FROM public.notification_events`);
      await pg.query(`DELETE FROM public.rate_limit_ledger`);
      await pg.query(
        `UPDATE public.profiles SET student_link_code = NULL, student_link_code_issued_at = NULL`,
      );
    });

    it("B4.1 a repeated submit for the same live code and address carries ONE idempotency key (no address in it)", async () => {
      const app = await buildApp();
      const first = await invite(app, "Parent@Example.test ");
      const second = await invite(app, "parent@example.test");
      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(fakeResend.requests).toHaveLength(2);

      const row = await studentCodeRow();
      const expectedKey = guardianLinkInviteIdempotencyKey({
        studentProfileId: STUDENT,
        codeIssuedAt: row.issuedAt!.toISOString(),
        guardianEmail: "parent@example.test",
      });
      const keys = fakeResend.requests.map((r) => r.headers["Idempotency-Key"]);
      expect(keys[0]).toBe(expectedKey);
      expect(keys[1]).toBe(expectedKey);
      expect(expectedKey).not.toContain("parent");
      expect(expectedKey).not.toContain("@");
    });

    it("B4.2 the fourth invite to one address in a day is denied (3/day per address) and the daily bucket is rolled back for it", async () => {
      const app = await buildApp();
      for (let i = 0; i < 3; i += 1) {
        expect((await invite(app, "a@example.test")).status).toBe(202);
      }
      const denied = await invite(app, "a@example.test");
      expect(denied.status).toBe(429);
      expect(JSON.stringify(denied.body)).toContain(
        "guardian_link_email_attempts",
      );
      expect(fakeResend.requests).toHaveLength(3);

      // §45 rollback: the denied attempt did not consume daily quota. 3 used so far; the daily
      // cap is 10, so SEVEN more to other addresses must still pass — the eighth is the daily 429.
      const more = ["b", "b", "b", "c", "c", "c", "d"];
      for (const who of more) {
        expect((await invite(app, `${who}@example.test`)).status).toBe(202);
      }
      const dailyDenied = await invite(app, "e@example.test");
      expect(dailyDenied.status).toBe(429);
      expect(JSON.stringify(dailyDenied.body)).toContain(
        "guardian_link_attempts_daily",
      );
      expect(fakeResend.requests).toHaveLength(10);
    });

    it("B4.3 the email carries the code and the prefilled redeem link, names the student, says how to ignore it, and carries no progress data", async () => {
      const app = await buildApp();
      expect((await invite(app, "parent@example.test")).status).toBe(202);
      const row = await studentCodeRow();
      expect(row.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);

      expect(fakeResend.requests).toHaveLength(1);
      const req = fakeResend.requests[0]!;
      expect(req.url).toBe("https://api.resend.com/emails");
      expect(req.body.from).toBe(FROM_EMAIL);
      expect(req.body.to).toEqual(["parent@example.test"]);
      expect(Object.keys(req.body).sort()).toEqual([
        "from",
        "html",
        "subject",
        "text",
        "to",
      ]); // no tags, no tracking option (C12.3)

      const text = String(req.body.text);
      const html = String(req.body.html);
      // The code STANDALONE (its own line / its own element), not merely inside the URL.
      expect(text).toContain(`\n    ${row.code}\n`);
      expect(html).toContain(`>${row.code}</p>`);
      expect(text).toContain(`${SITE}/guardian?code=${row.code}`);
      expect(html).toContain(`${SITE}/guardian?code=${row.code}`);
      expect(String(req.body.subject)).toContain("Sam <Student>");
      expect(html).toContain("Sam &lt;Student&gt;"); // escaped
      expect(text).toMatch(/sign in/i);
      expect(text).toMatch(/ignore this email/i);
      expect(text).toMatch(/cannot see individual questions/i);

      // §38.1 before the link exists: nothing that reads as progress.
      for (const banned of ["%", "score", "streak", "accuracy", "correct"]) {
        expect(text.toLowerCase()).not.toContain(banned);
      }
    });

    it("B4.4 the link does not auto-link: redeeming without a session is refused by the real auth middleware and creates no row", async () => {
      const app = await buildApp();
      expect((await invite(app, "parent@example.test")).status).toBe(202);
      const { code } = await studentCodeRow();

      const anon = await buildUnauthenticatedGuardianApp();
      const res = await request(anon)
        .post("/api/guardian/link/redeem")
        .send({ code });
      expect(res.status).toBe(401);
      const links = await pg.query(
        `SELECT count(*)::int AS c FROM public.guardian_links`,
      );
      expect(links.rows[0].c).toBe(0);
      // And the code is still live — an unauthenticated attempt did not spend it.
      expect((await studentCodeRow()).code).toBe(code);
    });

    it("B4.5 the response is byte-identical for an address with an account and one without", async () => {
      const app = await buildApp();
      const known = await invite(app, GUARDIAN_EMAIL); // has a profile row
      const unknown = await invite(app, "nobody-here@example.test");
      expect(known.status).toBe(202);
      expect(unknown.status).toBe(known.status);
      expect(unknown.text).toBe(known.text);
      expect(Object.keys(known.body.data).sort()).toEqual([
        "accepted",
        "expiresAt",
      ]);
    });

    it("an expired code is re-issued before it is emailed; a malformed address is 400; a guardian on the route is 404", async () => {
      const app = await buildApp();
      await pg.query(
        `UPDATE public.profiles SET student_link_code = 'ABC234',
         student_link_code_issued_at = now() - interval '2 days' WHERE id = $1`,
        [STUDENT],
      );
      expect((await invite(app, "parent@example.test")).status).toBe(202);
      const fresh = await studentCodeRow();
      expect(fresh.code).not.toBe("ABC234");
      expect(String(fakeResend.requests[0]!.body.text)).toContain(fresh.code!);
      expect(String(fakeResend.requests[0]!.body.text)).not.toContain("ABC234");

      expect((await invite(app, "not-an-email")).status).toBe(400);

      session.id = GUARDIAN;
      session.role = "guardian";
      const asGuardian = await invite(app, "parent@example.test");
      expect(asGuardian.status).toBe(404);
      expect(fakeResend.requests).toHaveLength(1);
    });
  },
);
