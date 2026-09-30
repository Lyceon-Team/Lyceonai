/**
 * An unknown role fails closed, and is never written back to the profile.
 *
 * @spec [Guardian_Closure_Plan G2-02; audit G-AUD-23; Coding Standards §6.1 (server-authoritative
 *       roles), §4.3] | @implemented [2026-09-29]
 *
 * plain English: `profiles.role` is the enum ('student','guardian','admin','tutor','teacher'). The
 * app knows three of those. A `tutor` or `teacher` row was normalised to 'student' at every sign-in
 * AND written back to the row, so an account the app does not understand silently became a student
 * with student access. Now the session is refused with 403 `ROLE_UNRECOGNIZED` on every route that
 * requires a signed-in user, public routes keep working (so the account can still sign out), and the
 * row is left exactly as it was.
 *
 * MOCK BOUNDARY. Substituted: the Auth server (`createSupabaseServerClient().auth.getUser()` names the
 * signed-in user) and the admin client's TRANSPORT (`createClient` → real SQL over genesis + every
 * migration). The REAL `supabaseAuthMiddleware`, `ensureProfileForAuthUser`, `requireSupabaseAuth` and
 * `requireStudentOrAdmin` run — the middleware reads the row, decides, and (before this row) wrote it.
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
import rateLimit from "express-rate-limit";
import request from "supertest";
import {
  makePgSupabase,
  bootstrapPgDatabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "role_fail_closed_ci";
const STUDENT = "f1111111-1111-4111-8111-111111111111";
const TUTOR = "f2222222-2222-4222-8222-222222222222";
const TEACHER = "f3333333-3333-4333-8333-333333333333";

let pg: Client;
/** The user the Auth server reports as signed in. */
const session = { id: STUDENT, email: "s@example.test" };

vi.mock("@supabase/supabase-js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createClient: () => makePgSupabase(pg),
  };
});

vi.mock("../../server/lib/supabase-ssr", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createSupabaseServerClient: () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: session.id, email: session.email } },
          error: null,
        }),
      },
    }),
  };
});

const auth = await import("../../server/middleware/supabase-auth");

function buildApp(): express.Express {
  const app = express();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(express.json());
  app.use(limiter);
  app.use((req, _res, next) => {
    (req as express.Request & { requestId?: string }).requestId = "g2-02";
    next();
  });
  app.use(auth.supabaseAuthMiddleware);
  app.get(
    "/api/learning-probe",
    auth.requireSupabaseAuth,
    auth.requireStudentOrAdmin,
    (req, res) => {
      res.json({ role: req.user?.role });
    },
  );
  app.get("/api/profile-probe", auth.requireSupabaseAuth, (req, res) => {
    res.json({ role: req.user?.role });
  });
  // A route that needs no signed-in user (sign-out, CSRF, health): must keep working.
  app.post("/api/public-probe", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

async function roleRow(
  id: string,
): Promise<{ role: string; updated_at: string }> {
  const r = await pg.query(
    `SELECT role::text AS role, updated_at::text AS updated_at FROM public.profiles WHERE id = $1`,
    [id],
  );
  return r.rows[0] as { role: string; updated_at: string };
}

describe.skipIf(!PG_AVAILABLE)(
  "G2-02 an unknown role fails closed — real Postgres",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4),($5,$6)`,
        [
          STUDENT,
          "s@example.test",
          TUTOR,
          "t@example.test",
          TEACHER,
          "te@example.test",
        ],
      );
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, date_of_birth, updated_at) VALUES
         ($1,$2,'student', DATE '2008-01-01', TIMESTAMPTZ '2026-01-01T00:00:00Z'),
         ($3,$4,'tutor',   NULL, TIMESTAMPTZ '2026-01-01T00:00:00Z'),
         ($5,$6,'teacher', NULL, TIMESTAMPTZ '2026-01-01T00:00:00Z')`,
        [
          STUDENT,
          "s@example.test",
          TUTOR,
          "t@example.test",
          TEACHER,
          "te@example.test",
        ],
      );
    });

    afterAll(async () => {
      if (pg) await pg.end();
    });

    beforeEach(() => {
      session.id = STUDENT;
      session.email = "s@example.test";
    });

    it("presence: a student session reaches a learning route as a student", async () => {
      const res = await request(buildApp()).get("/api/learning-probe");
      expect(res.status).toBe(200);
      expect(res.body.role).toBe("student");
    });

    it.each([
      ["tutor", TUTOR, "t@example.test"],
      ["teacher", TEACHER, "te@example.test"],
    ])(
      "a %s session gets 403 ROLE_UNRECOGNIZED and the profile row is unchanged",
      async (role, id, email) => {
        session.id = id;
        session.email = email;
        const before = await roleRow(id);

        for (const path of ["/api/learning-probe", "/api/profile-probe"]) {
          const res = await request(buildApp()).get(path);
          expect(res.status, path).toBe(403);
          expect(res.body.code, path).toBe("ROLE_UNRECOGNIZED");
        }

        const after = await roleRow(id);
        expect(after.role).toBe(role);
        expect(after).toEqual(before);
      },
    );

    it("a route that needs no signed-in user still answers an unknown-role session", async () => {
      session.id = TUTOR;
      session.email = "t@example.test";
      const res = await request(buildApp()).post("/api/public-probe");
      expect(res.status).toBe(200);
    });

    it("requireStudentOrAdmin admits student and admin only, even if a user object carries another role", () => {
      const run = (user: Record<string, unknown>): number => {
        let status = 0;
        const res = {
          status(code: number) {
            status = code;
            return this;
          },
          json() {
            return this;
          },
        } as unknown as express.Response;
        let passed = false;
        auth.requireStudentOrAdmin(
          { user, requestId: "g2-02" } as unknown as express.Request,
          res,
          () => {
            passed = true;
          },
        );
        return passed ? 200 : status;
      };
      expect(
        run({
          id: STUDENT,
          role: "student",
          isGuardian: false,
          isAdmin: false,
          is_under_13: false,
        }),
      ).toBe(200);
      expect(
        run({ id: TUTOR, role: "tutor", isGuardian: false, isAdmin: false }),
      ).toBe(403);
      expect(run({ id: TUTOR, isGuardian: false, isAdmin: false })).toBe(403);
    });
  },
);
