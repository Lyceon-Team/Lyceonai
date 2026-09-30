/**
 * G-NEW-12 — every 403 a request to `/api/profile` can receive logs its code.
 *
 * @spec [Guardian_Closure_Plan G-NEW-12; Coding Standards §12.1] | @implemented [2026-09-30]
 *
 * plain English: production answered `PATCH /api/profile` 403 at 02:22:40Z with no log line, and
 * nobody could say which refusal it was. This drives each 403 branch on the path — the global
 * deletion lock, the auth gate's unrecognised role, both CSRF refusals, and each refusal inside
 * the profile router — through the REAL middleware or router, and asserts, ONE-TO-ONE per
 * branch, that the response is 403 AND a warning was logged carrying that same code. A branch
 * that answers without logging fails here by name.
 *
 * The logs are also checked for what they must NOT carry: no cookie, token or request body.
 */
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    generateRequestId: () => "req-generated",
  },
}));

/** The profile row the router reads; each case sets it. */
const profileRow = vi.hoisted(() => ({
  value: null as Record<string, unknown> | null,
}));

vi.mock("../../server/middleware/supabase-auth", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/middleware/supabase-auth")
  >("../../server/middleware/supabase-auth");
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: profileRow.value, error: null }),
  };
  return { ...actual, getSupabaseAdmin: () => ({ from: () => chain }) };
});

import { logger } from "../../server/logger";
import {
  enforceDeletionLock,
  requireSupabaseAuth,
  setDeletionStatusResolverForTests,
} from "../../server/middleware/supabase-auth";
import { doubleCsrfProtection } from "../../server/middleware/csrf-double-submit";
import { finalErrorHandler } from "../../server/middleware/final-error-handler";
import profileRoutes from "../../server/routes/profile-routes";

type TestUser = { id: string; role: string };

function appWith(
  user: TestUser | null,
  opts: {
    roleUnrecognized?: boolean;
    deletionLock?: boolean;
    csrf?: boolean;
  } = {},
): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.requestId = "req-403";
    if (user) (req as unknown as { user: TestUser }).user = user;
    if (opts.roleUnrecognized) req.roleUnrecognized = true;
    next();
  });
  if (opts.deletionLock) app.use(enforceDeletionLock);
  app.use(
    "/api/profile",
    requireSupabaseAuth,
    ...(opts.csrf ? [doubleCsrfProtection] : []),
    profileRoutes,
  );
  app.use(finalErrorHandler);
  return app;
}

/** The codes logged as warnings, in order. */
function warnedCodes(): string[] {
  return vi
    .mocked(logger.warn)
    .mock.calls.map((c) => (c[3] as { code?: unknown } | undefined)?.code)
    .filter((code): code is string => typeof code === "string");
}

/** The body's code, wherever this branch puts it. */
function bodyCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const b = body as { code?: unknown; error?: unknown };
  if (typeof b.code === "string") return b.code;
  if (typeof b.error === "object" && b.error !== null) {
    const c = (b.error as { code?: unknown }).code;
    if (typeof c === "string") return c;
  }
  return undefined;
}

const STUDENT: TestUser = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "student",
};
const GUARDIAN: TestUser = {
  id: "22222222-2222-4222-8222-222222222222",
  role: "guardian",
};
const ADMIN: TestUser = {
  id: "33333333-3333-4333-8333-333333333333",
  role: "admin",
};

beforeEach(() => {
  vi.mocked(logger.warn).mockClear();
  profileRow.value = null;
});
afterEach(() => {
  setDeletionStatusResolverForTests(null);
  delete process.env.ACCOUNT_DELETION_LIFECYCLE_V2;
});

describe("G-NEW-12 every 403 on /api/profile logs its code", () => {
  it("deletion lock: ACCOUNT_DELETED", async () => {
    process.env.ACCOUNT_DELETION_LIFECYCLE_V2 = "true";
    setDeletionStatusResolverForTests(async () => ({ status: "deleted" }));
    const res = await request(appWith(STUDENT, { deletionLock: true }))
      .patch("/api/profile")
      .send({});
    expect(res.status).toBe(403);
    expect(bodyCode(res.body)).toBe("ACCOUNT_DELETED");
    expect(warnedCodes()).toEqual(["ACCOUNT_DELETED"]);
  });

  it("deletion lock: PENDING_DELETION", async () => {
    process.env.ACCOUNT_DELETION_LIFECYCLE_V2 = "true";
    setDeletionStatusResolverForTests(async () => ({
      status: "pending_deletion",
    }));
    const res = await request(appWith(STUDENT, { deletionLock: true }))
      .patch("/api/profile")
      .send({});
    expect(res.status).toBe(403);
    expect(bodyCode(res.body)).toBe("PENDING_DELETION");
    expect(warnedCodes()).toEqual(["PENDING_DELETION"]);
  });

  it("auth gate: ROLE_UNRECOGNIZED", async () => {
    const res = await request(appWith(null, { roleUnrecognized: true }))
      .patch("/api/profile")
      .send({});
    expect(res.status).toBe(403);
    expect(bodyCode(res.body)).toBe("ROLE_UNRECOGNIZED");
    expect(warnedCodes()).toEqual(["ROLE_UNRECOGNIZED"]);
  });

  it("CSRF origin refusal: csrf_blocked", async () => {
    const res = await request(appWith(STUDENT, { csrf: true }))
      .patch("/api/profile")
      .set("Origin", "https://evil.example")
      .send({});
    expect(res.status).toBe(403);
    expect(bodyCode(res.body)).toBe("csrf_blocked");
    expect(warnedCodes()).toEqual(["csrf_blocked"]);
  });

  it("CSRF token refusal (the final error handler): csrf_blocked", async () => {
    // No token at all: csrf-csrf raises its invalid-token error, which only the final
    // handler answers — the branch production hit at 02:22:40Z.
    const res = await request(appWith(STUDENT, { csrf: true }))
      .patch("/api/profile")
      .set("Cookie", "dev-csrf=forged")
      .set("x-csrf-token", "forged")
      .send({});
    expect(res.status).toBe(403);
    expect(bodyCode(res.body)).toBe("csrf_blocked");
    expect(warnedCodes()).toEqual(["csrf_blocked"]);
  });

  it("PATCH: a role no one may choose (ROLE_NOT_SELF_ASSIGNABLE)", async () => {
    const res = await request(appWith(STUDENT))
      .patch("/api/profile")
      .send({ role: "admin" });
    expect(res.status).toBe(403);
    expect(bodyCode(res.body)).toBe("ROLE_NOT_SELF_ASSIGNABLE");
    expect(warnedCodes()).toEqual(["ROLE_NOT_SELF_ASSIGNABLE"]);
  });

  it("PATCH: an admin profile (ADMIN_PROFILE_NOT_ONBOARDABLE)", async () => {
    profileRow.value = {
      id: ADMIN.id,
      role: "admin",
      profile_completed_at: null,
      guardian_email: null,
      date_of_birth: null,
    };
    const res = await request(appWith(ADMIN)).patch("/api/profile").send({});
    expect(res.status).toBe(403);
    // The body keeps its existing shape (no code on the wire); the log names the branch.
    expect(warnedCodes()).toEqual(["ADMIN_PROFILE_NOT_ONBOARDABLE"]);
  });

  it("PATCH: a role change after completion (ROLE_LOCKED)", async () => {
    profileRow.value = {
      id: STUDENT.id,
      role: "student",
      profile_completed_at: "2026-09-01T00:00:00.000Z",
      guardian_email: null,
      date_of_birth: "2008-01-01",
    };
    const res = await request(appWith(STUDENT))
      .patch("/api/profile")
      .send({ role: "guardian" });
    expect(res.status).toBe(403);
    expect(bodyCode(res.body)).toBe("ROLE_LOCKED");
    expect(warnedCodes()).toEqual(["ROLE_LOCKED"]);
  });

  it("POST /date-of-birth: a non-guardian (ROLE_NOT_SELF_ASSIGNABLE)", async () => {
    const res = await request(appWith(STUDENT))
      .post("/api/profile/date-of-birth")
      .send({ dateOfBirth: "1980-01-01" });
    expect(res.status).toBe(403);
    expect(bodyCode(res.body)).toBe("ROLE_NOT_SELF_ASSIGNABLE");
    expect(warnedCodes()).toEqual(["ROLE_NOT_SELF_ASSIGNABLE"]);
  });

  it("POST /date-of-birth: a guardian under 18 (GUARDIAN_UNDER_18)", async () => {
    const res = await request(appWith(GUARDIAN))
      .post("/api/profile/date-of-birth")
      .send({ dateOfBirth: "2015-01-01" });
    expect(res.status).toBe(403);
    expect(bodyCode(res.body)).toBe("GUARDIAN_UNDER_18");
    expect(warnedCodes()).toEqual(["GUARDIAN_UNDER_18"]);
  });

  it("no refusal log carries a cookie, a token or the request body", async () => {
    await request(appWith(STUDENT, { csrf: true }))
      .patch("/api/profile")
      .set("Cookie", "dev-csrf=forged-cookie-value")
      .set("x-csrf-token", "forged-token-value")
      .send({ role: "student", dateOfBirth: "2008-01-01" });
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls);
    expect(logged).toContain("csrf_blocked"); // presence first
    expect(logged).not.toContain("forged-cookie-value");
    expect(logged).not.toContain("forged-token-value");
    expect(logged).not.toContain("2008-01-01");
  });
});
