import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// Isolate the middleware: mock the logger (to assert the audit emission) and the
// account lib (whose real module pulls in Supabase; not needed for the admin/denial paths).
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/lib/account", () => ({
  resolveLinkedPairPremiumAccessForGuardian: vi.fn(),
}));

import { requireGuardianEntitlement } from "../../server/middleware/guardian-entitlement";
import { logger } from "../../server/logger";

function mockRes(): Response {
  const res = {} as Record<string, unknown>;
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res as unknown as Response;
}

function reqOf(over: Record<string, unknown>): Request {
  return { params: {}, path: "/x", method: "GET", requestId: "r", ...over } as unknown as Request;
}

describe("requireGuardianEntitlement — admin audit (Doc 01 V6 §543 / §1229 / §561)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("admin: passes through and emits an audit log carrying no student content", async () => {
    const req = reqOf({
      user: { id: "admin-1", role: "admin" },
      params: { studentId: "stu-9" },
      path: "/api/guardian/summary",
      method: "GET",
      requestId: "req-1",
    });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireGuardianEntitlement(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "GUARDIAN",
      "admin_surface_access",
      expect.any(String),
      expect.any(Object),
      expect.any(Object)
    );

    // Locks the audit emission contract per §1229/§272/§561 + §12.1.
    //
    // PAYLOAD (logger data argument): access-metadata only; no student
    // content. Locked exact-equality on { method, path, studentId }.
    //
    // CONTEXT (logger structured-metadata argument): operator identity +
    // request id. Locked exact-equality on { userId, requestId }.
    //
    // Both surfaces are locked because both surfaces emit; adding a field
    // to either surface in a future change must update this test, by
    // design.
    const dataArg = vi.mocked(logger.info).mock.calls[0][3] as Record<string, unknown>;
    expect(Object.keys(dataArg).sort()).toEqual(["method", "path", "studentId"]);
    expect(dataArg).toEqual({
      method: "GET",
      path: "/api/guardian/summary",
      studentId: "stu-9",
    });

    const contextArg = vi.mocked(logger.info).mock.calls[0][4] as Record<string, unknown>;
    expect(Object.keys(contextArg).sort()).toEqual(["requestId", "userId"]);
    expect(contextArg).toMatchObject({
      userId: "admin-1",
      requestId: expect.stringMatching(/^[a-zA-Z0-9-]+$/),
    });
  });

  it("non-guardian non-admin: denied 403 (no pass-through)", async () => {
    const req = reqOf({ user: { id: "s-1", role: "student" } });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireGuardianEntitlement(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("unauthenticated: denied 401", async () => {
    const req = reqOf({});
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireGuardianEntitlement(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
