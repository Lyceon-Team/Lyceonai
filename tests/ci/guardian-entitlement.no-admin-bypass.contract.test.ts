/**
 * @spec [guardian-rebuild-design-spec §1.5 R5 — "no admin bypass, and the non-goal that keeps it
 *        deleted"; owner ruling 2026-08-28 "R5 reaches all four bypasses"; Doc 01 V8 §16]
 *        | @implemented [2026-08-28]
 *
 * plain English: proves an admin gets NO special treatment at the guardian entitlement gate.
 *
 * THIS FILE USED TO ASSERT THE OPPOSITE, and that is worth stating plainly rather than losing in
 * a rename. It was `guardian-entitlement.admin-audit.contract.test.ts`, and its first case
 * asserted that an admin PASSES THROUGH and that the pass-through emits an
 * `admin_surface_access` audit row. The bypass it locked in cited "Doc 01 V6 §543" — a document
 * version no longer in the corpus. R5 deletes the bypass, so the case inverts: the same request
 * that had to call `next()` must now be denied, and the audit row it checked for must NOT exist,
 * because there is no admin access left here to record.
 *
 * WHY THE POSITIVE CONTROL IS NOT OPTIONAL.
 *   Three cases below are denials. A middleware that denied EVERY caller would satisfy all
 *   three and read as green — the same shape as the three `via`-cases in this vertical that
 *   asserted a 404 the resolver produced rather than the guard they named. So the last case
 *   drives a REAL guardian, with an active link and premium access, all the way to `next()`.
 *   Without it, "admin is denied" is indistinguishable from "everyone is denied".
 *
 * MUTATIONS OBSERVED RED, one per assertion layer (run 2026-08-28, baseline 4/4 green):
 *   1. Restore `if (userRole === 'admin') { ...; return next(); }` above the role check.
 *      → reds `expect(next).not.toHaveBeenCalled()` AND the 403 assertion in the admin case,
 *        and the `admin_surface_access` assertion. 1 of 4. This is the bypass itself.
 *   2. Change the role check to `if (userRole !== 'guardian' && userRole !== 'admin')`.
 *      → reds the admin case only — the subtler form of the same bypass, and the one a future
 *        edit is most likely to reintroduce, because it looks like a role list rather than a
 *        privilege grant. 1 of 4.
 *   3. Make the guardian path deny (`if (true)` on `!access.hasActiveLink`).
 *      → reds ONLY the positive control. 1 of 4, so that case is individually proven.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// Isolate the middleware: mock the logger (to assert what is and is not emitted) and the
// account lib (whose real module pulls in Supabase).
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/lib/account", () => ({
  resolveLinkedPairPremiumAccessForGuardian: vi.fn(),
}));

import { requireGuardianEntitlement } from "../../server/middleware/guardian-entitlement";
import { logger } from "../../server/logger";
import { resolveLinkedPairPremiumAccessForGuardian } from "../../server/lib/account";

function mockRes(): Response {
  const res = {} as Record<string, unknown>;
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res as unknown as Response;
}

function reqOf(over: Record<string, unknown>): Request {
  return {
    params: {},
    path: "/x",
    method: "GET",
    requestId: "r",
    ...over,
  } as unknown as Request;
}

describe("requireGuardianEntitlement — no admin bypass (R5)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("admin: DENIED 403, does not pass through, and emits no admin_surface_access record", async () => {
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

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);

    // The bypass's audit row went with the bypass. Asserting its ABSENCE is what catches a
    // restoration that keeps the logging and loses the denial — the shape a "let's keep the
    // audit trail" refactor would take.
    const adminAudits = vi
      .mocked(logger.info)
      .mock.calls.filter((c) => c[1] === "admin_surface_access");
    expect(
      adminAudits,
      "an admin_surface_access record was emitted — the bypass is back",
    ).toHaveLength(0);

    // The link/entitlement lookup must not even run: an admin is refused on role, before any
    // student is named. If this fires, the denial is happening for the wrong reason.
    expect(resolveLinkedPairPremiumAccessForGuardian).not.toHaveBeenCalled();
  });

  it("non-guardian non-admin: denied 403 (no pass-through)", async () => {
    const req = reqOf({ user: { id: "s-1", role: "student" } });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireGuardianEntitlement(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("unauthenticated: denied 401", async () => {
    const req = reqOf({});
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireGuardianEntitlement(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("POSITIVE CONTROL: a linked, entitled guardian still passes through", async () => {
    // Without this case, every assertion above is satisfied by a middleware that denies
    // everyone. See the header.
    vi.mocked(resolveLinkedPairPremiumAccessForGuardian).mockResolvedValueOnce({
      hasActiveLink: true,
      hasPremiumAccess: true,
      guardianUserId: "g-1",
      studentUserId: "stu-9",
      guardianAccountId: "ga-1",
      studentAccountId: "sa-1",
      premiumSource: "student",
      studentEntitlementStatus: "active",
      guardianEntitlementStatus: "active",
      studentEntitlementExpired: false,
    } as Awaited<ReturnType<typeof resolveLinkedPairPremiumAccessForGuardian>>);

    const req = reqOf({
      user: { id: "g-1", role: "guardian" },
      params: { studentId: "stu-9" },
    });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireGuardianEntitlement(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
