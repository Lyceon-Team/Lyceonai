import { describe, expect, it, vi } from "vitest";
import {
  AuthenticatedRequest,
  requireProfileComplete,
  requireRequestAuthContext,
  requireRequestUser,
  requireStudentOrAdmin,
  requireSupabaseAuth,
  resolveTokenFromRequest,
} from "../../server/middleware/supabase-auth";
import type { Request } from "express";

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};

function createResponseRecorder(): MockResponse {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status: vi.fn(),
    json: vi.fn(),
  } as MockResponse;
  res.status = vi.fn(function (code: number) {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn(function (payload: unknown) {
    res.body = payload;
    return res;
  });
  return res;
}

describe("Auth Surface Contract", () => {
  it("rejects bearer headers even when auth cookies are present", () => {
    const req = {
      headers: { authorization: "Bearer denied-token" },
      cookies: { "sb-access-token": "x".repeat(64) },
      get: (name: string) =>
        name.toLowerCase() === "authorization"
          ? "Bearer denied-token"
          : undefined,
    } as unknown as Request;

    const result = resolveTokenFromRequest(req);

    expect(result.tokenSource).toBe("bearer");
    expect(result.bearerParsed).toBe(true);
    expect(result.token).toBeNull();
  });

  it("returns the canonical 401 contract when auth is missing", () => {
    const req = {
      requestId: "req-auth-1",
    } as unknown as AuthenticatedRequest;
    const res = createResponseRecorder();
    const next = vi.fn();

    requireSupabaseAuth(req, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: "Authentication required",
      message: "You must be signed in to access this resource",
      requestId: "req-auth-1",
    });
  });

  it("fails closed when downstream code sees a malformed user object", () => {
    const req = {
      user: { role: "student" },
      requestId: "req-auth-2",
    } as unknown as AuthenticatedRequest;
    const res = createResponseRecorder();

    const user = requireRequestUser(req, res as never);

    expect(user).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: "Authentication required",
      message: "You must be signed in to access this resource",
      requestId: "req-auth-2",
    });
  });

  it("fails closed when a route requires auth context but supabase client is missing", () => {
    const req = {
      user: {
        id: "student-1",
        role: "student",
        isGuardian: false,
        isAdmin: false,
      },
      requestId: "req-auth-3",
    } as unknown as AuthenticatedRequest;
    const res = createResponseRecorder();

    const auth = requireRequestAuthContext(req, res as never);

    expect(auth).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: "Authentication required",
      message: "You must be signed in to access this resource",
      requestId: "req-auth-3",
    });
  });

  it("blocks guardians from student-only routes with the canonical 403 contract", () => {
    const req = {
      user: {
        id: "guardian-1",
        role: "guardian",
        isGuardian: true,
        isAdmin: false,
      },
      requestId: "req-auth-4",
      path: "/api/practice/next",
    } as unknown as AuthenticatedRequest;
    const res = createResponseRecorder();
    const next = vi.fn();

    requireStudentOrAdmin(req, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: "Student access required",
      message: "Guardians cannot access student practice features",
      requestId: "req-auth-4",
    });
  });
});

// @spec [Doc-01_V6 §9.2 HALT-3] | @implemented [2026-06-17] | plain English: server-side DOB
// soft-gate — feature routes block until profile_completed_at is set (covers both "DOB not yet
// submitted" and "under-13 awaiting guardian consent"). Both signup paths (Google OAuth and
// email/password) produce profile_completed_at=null until /profile/complete is submitted.
describe("requireProfileComplete — HALT-3 server-side DOB soft-gate", () => {
  it("returns 401 when called without an authenticated user", () => {
    const req = { requestId: "halt3-1" } as unknown as AuthenticatedRequest;
    const res = createResponseRecorder();
    const next = vi.fn();

    requireProfileComplete(req, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 PROFILE_INCOMPLETE when profile_completed_at is null (DOB not yet set)", () => {
    const req = {
      user: {
        id: "student-new",
        role: "student",
        isGuardian: false,
        isAdmin: false,
        profile_completed_at: null,
      },
      requestId: "halt3-2",
      path: "/api/practice/sessions",
    } as unknown as AuthenticatedRequest;
    const res = createResponseRecorder();
    const next = vi.fn();

    requireProfileComplete(req, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      error: "Profile incomplete",
      code: "PROFILE_INCOMPLETE",
    });
  });

  it("returns 403 PROFILE_INCOMPLETE when profile_completed_at is undefined (under-13 consent pending)", () => {
    const req = {
      user: {
        id: "student-u13",
        role: "student",
        isGuardian: false,
        isAdmin: false,
        is_under_13: true,
        guardian_consent: false,
        profile_completed_at: undefined,
      },
      requestId: "halt3-3",
      path: "/api/practice/sessions",
    } as unknown as AuthenticatedRequest;
    const res = createResponseRecorder();
    const next = vi.fn();

    requireProfileComplete(req, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: "Profile incomplete" });
  });

  it("calls next() when profile_completed_at is set (profile complete)", () => {
    const req = {
      user: {
        id: "student-ok",
        role: "student",
        isGuardian: false,
        isAdmin: false,
        profile_completed_at: "2026-06-17T10:00:00Z",
      },
      requestId: "halt3-4",
      path: "/api/practice/sessions",
    } as unknown as AuthenticatedRequest;
    const res = createResponseRecorder();
    const next = vi.fn();

    requireProfileComplete(req, res as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it("calls next() for under-13 with guardian consent and profile_completed_at set", () => {
    const req = {
      user: {
        id: "student-u13-consented",
        role: "student",
        isGuardian: false,
        isAdmin: false,
        is_under_13: true,
        guardian_consent: true,
        profile_completed_at: "2026-06-17T11:00:00Z",
      },
      requestId: "halt3-5",
      path: "/api/practice/sessions",
    } as unknown as AuthenticatedRequest;
    const res = createResponseRecorder();
    const next = vi.fn();

    requireProfileComplete(req, res as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });
});
