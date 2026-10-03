/**
 * OQ-26: GET /api/profile carries `user.hasPassword`, from the predicate the password routes use.
 *
 * @spec [student-UI register §9 OQ-26, owner ruling (Karl) 2026-10-02: `hasPassword` on
 *        GET /api/profile; register F-38 (a Google-only account has no password to change)]
 *        | @implemented [2026-10-03]
 *
 * plain English: the REAL profile route runs over real Postgres, and the REAL
 * `hasPasswordIdentity` reads identities through the REAL supabase-js admin client against the
 * shared GoTrue stand-in (`tests/helpers/gotrue-stand-in.ts`) — the same transport the
 * change-password test drives. Only identity on the request and the transport are injected.
 * Proved: an email/password account is `true`; a Google-only one is `false`; one with both is
 * `true`; a failed identity read is `null` and still a 200 (the profile is the sign-in path);
 * and, over every identity mix, `hasPassword` is `false` exactly when the REAL
 * `POST /api/auth/change-password` refuses with `NO_PASSWORD_IDENTITY`.
 */
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { Client } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import { createGoTrueStandIn } from "../helpers/gotrue-stand-in";

const DB_NAME = "profile_has_password_ci";
const STUDENT = {
  id: "f6000000-0000-4000-8000-000000000001",
  email: "has-password@example.test",
};
const CURRENT = "OldPassword123";

let pg: Client;
const gotrue = createGoTrueStandIn(STUDENT, CURRENT);

function sessionUser(): Record<string, unknown> {
  return {
    id: STUDENT.id,
    email: STUDENT.email,
    display_name: null,
    role: "student",
    isAdmin: false,
    isGuardian: false,
    is_under_13: false,
    actor_id: STUDENT.id,
  };
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
vi.mock("../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => makePgSupabase(pg),
}));
vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getSupabaseAdmin: () => makePgSupabase(pg),
    requireSupabaseAuth: (req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user?: unknown }).user = sessionUser();
      next();
    },
  };
});
vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: Request, _res: Response, next: NextFunction) =>
    next(),
}));

async function loadApp(): Promise<express.Express> {
  const credentials = await import("../../server/lib/password-credentials");
  credentials.setPasswordAuthClientsForTests(gotrue.clients());
  const { default: profileRoutes } =
    await import("../../server/routes/profile-routes");
  const { default: authRoutes } =
    await import("../../server/routes/supabase-auth-routes");
  const { requireSupabaseAuth } =
    await import("../../server/middleware/supabase-auth");
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.requestId = "req-has-password";
    next();
  });
  app.use("/api/profile", requireSupabaseAuth, profileRoutes);
  app.use("/api/auth", authRoutes);
  return app;
}

async function hasPasswordFor(providers: string[]): Promise<unknown> {
  gotrue.state.providers = providers;
  const app = await loadApp();
  const res = await request(app).get("/api/profile");
  expect(res.status).toBe(200);
  // Presence before value: the field is there, on the user this route serves.
  expect(res.body.user.id).toBe(STUDENT.id);
  expect(res.body.user).toHaveProperty("hasPassword");
  return res.body.user.hasPassword;
}

describe.skipIf(!PG_AVAILABLE)(
  "OQ-26 hasPassword on GET /api/profile (real Postgres)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
        STUDENT.id,
        STUDENT.email,
      ]);
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth)
       VALUES ($1, $2, 'student', 'Someone', '2008-01-01'::date)`,
        [STUDENT.id, STUDENT.email],
      );
    }, 120_000);

    beforeEach(() => {
      gotrue.state.password = CURRENT;
      gotrue.state.providers = ["email"];
      gotrue.state.sessions = new Map();
      gotrue.state.calls = [];
      gotrue.state.updatedWithToken = null;
      gotrue.state.failTokenWith500 = false;
      gotrue.state.failAdminRead = false;
    });

    afterEach(async () => {
      const credentials = await import("../../server/lib/password-credentials");
      credentials.setPasswordAuthClientsForTests(null);
    });

    afterAll(async () => {
      await pg?.end();
    });

    it("an email/password account: hasPassword is true", async () => {
      expect(await hasPasswordFor(["email"])).toBe(true);
      // Read through the admin identity endpoint, once.
      expect(
        gotrue.state.calls.filter(
          (c) => c === `GET /admin/users/${STUDENT.id}`,
        ),
      ).toHaveLength(1);
    });

    it("a Google-only account: hasPassword is false", async () => {
      expect(await hasPasswordFor(["google"])).toBe(false);
    });

    it("an account with both Google and a password: hasPassword is true", async () => {
      expect(await hasPasswordFor(["google", "email"])).toBe(true);
    });

    it("a failed identity read: hasPassword is null and the profile still loads", async () => {
      gotrue.state.failAdminRead = true;
      expect(await hasPasswordFor(["email"])).toBeNull();
    });

    it("agrees with POST /api/auth/change-password: false exactly when it refuses NO_PASSWORD_IDENTITY", async () => {
      for (const providers of [["email"], ["google"], ["google", "email"]]) {
        const hasPassword = await hasPasswordFor(providers);
        const app = await loadApp();
        // A wrong current password: an account the route lets past the identity check answers
        // CURRENT_PASSWORD_INCORRECT; nothing is changed either way.
        const change = await request(app)
          .post("/api/auth/change-password")
          .send({
            current_password: "WrongPassword9",
            new_password: "NewPassword456",
          });
        // The route reached one of exactly two answers; anything else is not a comparison.
        expect([
          "409 NO_PASSWORD_IDENTITY",
          "400 CURRENT_PASSWORD_INCORRECT",
        ]).toContain(`${change.status} ${change.body.error.code}`);
        const refusedForNoPassword = change.status === 409;
        expect(hasPassword).toBe(!refusedForNoPassword);
        expect(gotrue.state.password).toBe(CURRENT);
      }
    });
  },
);
