/**
 * Settings → change password: the current password is checked on the server, and a Google-only
 * account is refused.
 *
 * @spec [Brief 8 ruling 4 (owner, 2026-10-01); F-38; contracts/auth-standard-flow AS-6 (native
 *        updateUser, no admin.updateUserById)] | @implemented [2026-10-01]
 *
 * plain English: drives the REAL `POST /api/auth/change-password` route and the REAL
 * `server/lib/password-credentials.ts`, with the REAL `@supabase/supabase-js` clients, against a
 * stand-in for GoTrue's four endpoints (password grant, update user, logout, admin get-user). Only
 * the transport is substituted (and the auth gate, which puts a signed-in user on the request), so
 * what is proved is what auth-js actually sends: that the new password is set on the freshly
 * verified session, that a wrong current password sets nothing, that a Google-only account is
 * refused before any sign-in is attempted, and that the throwaway session is ended without
 * touching the student's own.
 */
import express, {
  type NextFunction,
  type Request,
  type Response as ExpressResponse,
} from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoTrueStandIn } from "../helpers/gotrue-stand-in";

const STUDENT = {
  id: "5a3c2b10-1111-4222-8333-444455556666",
  email: "student-pw@example.test",
};
const CURRENT = "OldPassword123";
const NEXT = "NewPassword456";
const STUDENT_OWN_TOKEN = "student-browser-session-token";

const signedIn = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; role: string },
}));

vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../server/middleware/supabase-auth")
    >();
  return {
    ...actual,
    requireSupabaseAuth: (
      req: Request,
      res: ExpressResponse,
      next: NextFunction,
    ) => {
      if (!signedIn.user) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      (req as Request & { user?: unknown }).user = { ...signedIn.user };
      next();
    },
  };
});
vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (
    _req: Request,
    _res: ExpressResponse,
    next: NextFunction,
  ) => next(),
}));

// ── The GoTrue stand-in (shared with the OQ-26 profile test: one scenario) ─────────────────────
const harness = createGoTrueStandIn(STUDENT, CURRENT);
const gotrue = harness.state;

async function loadApp(): Promise<express.Express> {
  vi.resetModules();
  const credentials = await import("../../server/lib/password-credentials");
  credentials.setPasswordAuthClientsForTests(harness.clients());
  const { default: authRoutes } =
    await import("../../server/routes/supabase-auth-routes");
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: ExpressResponse, next: NextFunction) => {
    req.requestId = "req-password-change";
    next();
  });
  app.use("/api/auth", authRoutes);
  return app;
}

function post(app: express.Express, body: Record<string, unknown>) {
  return request(app).post("/api/auth/change-password").send(body);
}

beforeEach(() => {
  gotrue.password = CURRENT;
  gotrue.providers = ["email"];
  gotrue.sessions = new Map([[STUDENT_OWN_TOKEN, STUDENT.id]]);
  gotrue.calls = [];
  gotrue.updatedWithToken = null;
  gotrue.failTokenWith500 = false;
  gotrue.failAdminRead = false;
  signedIn.user = { ...STUDENT, role: "student" };
});

afterEach(async () => {
  const credentials = await import("../../server/lib/password-credentials");
  credentials.setPasswordAuthClientsForTests(null);
});

describe("POST /api/auth/change-password (Brief 8 ruling 4)", () => {
  it("the right current password changes it, on the freshly verified session, and ends only that session", async () => {
    const app = await loadApp();

    const res = await post(app, {
      current_password: CURRENT,
      new_password: NEXT,
    });

    expect(res.status).toBe(200);
    expect(gotrue.password).toBe(NEXT);
    // Set by the session the current password just opened, never by the student's own.
    expect(gotrue.updatedWithToken).toMatch(/^verification-token-/);
    expect(gotrue.calls).toEqual([
      `GET /admin/users/${STUDENT.id}`,
      "POST /token?grant_type=password",
      "PUT /user",
      "POST /logout?scope=local",
    ]);
    // The throwaway session is gone; the student's browser session is untouched.
    expect([...gotrue.sessions.keys()]).toEqual([STUDENT_OWN_TOKEN]);
  });

  it("a wrong current password is 400 CURRENT_PASSWORD_INCORRECT and sets nothing", async () => {
    const app = await loadApp();

    const res = await post(app, {
      current_password: "WrongPassword9",
      new_password: NEXT,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CURRENT_PASSWORD_INCORRECT");
    expect(gotrue.password).toBe(CURRENT);
    expect(gotrue.calls).not.toContain("PUT /user");
    expect(JSON.stringify(res.body)).not.toContain("WrongPassword9");
  });

  it("F-38: a Google-only account is 409 NO_PASSWORD_IDENTITY, before any sign-in is tried", async () => {
    gotrue.providers = ["google"];
    const app = await loadApp();

    const res = await post(app, {
      current_password: CURRENT,
      new_password: NEXT,
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NO_PASSWORD_IDENTITY");
    expect(gotrue.calls).toEqual([`GET /admin/users/${STUDENT.id}`]);
    expect(gotrue.password).toBe(CURRENT);
  });

  it("an account with both Google and a password may change it", async () => {
    gotrue.providers = ["google", "email"];
    const app = await loadApp();

    const res = await post(app, {
      current_password: CURRENT,
      new_password: NEXT,
    });

    expect(res.status).toBe(200);
    expect(gotrue.password).toBe(NEXT);
  });

  it("the same password again is 400 PASSWORD_UNCHANGED, and a weak one is refused by the shared policy", async () => {
    const app = await loadApp();

    const same = await post(app, {
      current_password: CURRENT,
      new_password: CURRENT,
    });
    const weak = await post(app, {
      current_password: CURRENT,
      new_password: "abcdefgh",
    });
    const missing = await post(app, { new_password: NEXT });
    const extra = await post(app, {
      current_password: CURRENT,
      new_password: NEXT,
      email: "x@y.z",
    });

    expect(same.status).toBe(400);
    expect(same.body.error.code).toBe("PASSWORD_UNCHANGED");
    for (const res of [weak, missing, extra]) expect(res.status).toBe(400);
    expect(gotrue.calls).not.toContain("PUT /user");
    expect(gotrue.password).toBe(CURRENT);
  });

  it("a GoTrue failure during the check is a 500, never 'your password is incorrect'", async () => {
    gotrue.failTokenWith500 = true;
    const app = await loadApp();

    const res = await post(app, {
      current_password: CURRENT,
      new_password: NEXT,
    });

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain(
      "CURRENT_PASSWORD_INCORRECT",
    );
    expect(gotrue.password).toBe(CURRENT);
  });

  it("a signed-out request never reaches the check", async () => {
    signedIn.user = null;
    const app = await loadApp();

    const res = await post(app, {
      current_password: CURRENT,
      new_password: NEXT,
    });

    expect(res.status).toBe(401);
    expect(gotrue.calls).toEqual([]);
  });
});
