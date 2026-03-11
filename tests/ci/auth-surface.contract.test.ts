import { describe, expect, it, vi } from "vitest";
import {
  requireRequestAuthContext,
  requireRequestUser,
  requireStudentOrAdmin,
  requireSupabaseAuth,
  resolveTokenFromRequest,
} from "../../server/middleware/supabase-auth";

function createResponseRecorder() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status: vi.fn(function status(code: number) {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn(function json(payload: unknown) {
      res.body = payload;
      return res;
    }),
  };

  return res;
}

describe("Auth Surface Contract", () => {
  it("rejects bearer headers even when auth cookies are present", () => {
    const req = {
      headers: { authorization: "Bearer denied-token" },
      cookies: { "sb-access-token": "x".repeat(64) },
      get: (name: string) => (name.toLowerCase() === "authorization" ? "Bearer denied-token" : undefined),
    } as any;

    const result = resolveTokenFromRequest(req);

    expect(result.tokenSource).toBe("bearer");
    expect(result.bearerParsed).toBe(true);
    expect(result.token).toBeNull();
  });

  it("returns the canonical 401 contract when auth is missing", () => {
    const req: any = { requestId: "req-auth-1" };
    const res = createResponseRecorder();
    const next = vi.fn();

    requireSupabaseAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: "Authentication required",
      message: "You must be signed in to access this resource",
      requestId: "req-auth-1",
    });
  });

  it("fails closed when downstream code sees a malformed user object", () => {
    const req: any = { user: { role: "student" }, requestId: "req-auth-2" };
    const res = createResponseRecorder();

    const user = requireRequestUser(req, res);

    expect(user).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: "Authentication required",
      message: "You must be signed in to access this resource",
      requestId: "req-auth-2",
    });
  });

  it("fails closed when a route requires auth context but supabase client is missing", () => {
    const req: any = {
      user: { id: "student-1", role: "student", isGuardian: false, isAdmin: false },
      requestId: "req-auth-3",
    };
    const res = createResponseRecorder();

    const auth = requireRequestAuthContext(req, res);

    expect(auth).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: "Authentication required",
      message: "You must be signed in to access this resource",
      requestId: "req-auth-3",
    });
  });

  it("blocks guardians from student-only routes with the canonical 403 contract", () => {
    const req: any = {
      user: { id: "guardian-1", role: "guardian", isGuardian: true, isAdmin: false },
      requestId: "req-auth-4",
      path: "/api/practice/next",
    };
    const res = createResponseRecorder();
    const next = vi.fn();

    requireStudentOrAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: "Student access required",
      message: "Guardians cannot access student practice features",
      requestId: "req-auth-4",
    });
  });
});
