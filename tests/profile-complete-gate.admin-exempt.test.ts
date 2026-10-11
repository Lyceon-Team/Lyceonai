/**
 * @spec [Doc-01_V8 §9 (server-side profile soft-gate); hotfix 2026-10-11 (admins are not subject
 *        to the student profile-completion gate; one shared rule, `isProfileGateSatisfied`)]
 * @implemented [2026-10-11]
 * plain English: `requireProfileComplete` on its own. The production loop's account — an admin
 * with a date of birth and `profile_completed_at` NULL — passes; a student without the timestamp
 * is refused with 403 PROFILE_INCOMPLETE whether or not a date of birth is known; a completed
 * student passes.
 */
import type { NextFunction, Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { requireProfileComplete } from "../server/middleware/supabase-auth";

function call(user: Record<string, unknown>): {
  passed: boolean;
  status: number;
  code: unknown;
} {
  let status = 200;
  let body: Record<string, unknown> = {};
  let passed = false;
  const res = {
    status(c: number) {
      status = c;
      return this;
    },
    json(b: Record<string, unknown>) {
      body = b;
      return this;
    },
    setHeader() {
      return this;
    },
  } as unknown as Response;
  requireProfileComplete(
    {
      user,
      path: "/api/practice/quota",
      requestId: "r",
      headers: {},
    } as unknown as Request,
    res,
    (() => {
      passed = true;
    }) as NextFunction,
  );
  return { passed, status, code: body.code };
}

describe("requireProfileComplete (hotfix 2026-10-11)", () => {
  it("an admin with profile_completed_at NULL passes (the looping account)", () => {
    expect(
      call({
        id: "a",
        role: "admin",
        isAdmin: true,
        profile_completed_at: null,
        is_under_13: false,
      }),
    ).toMatchObject({ passed: true });
  });
  it("a student with a date of birth but no completion timestamp is refused", () => {
    expect(
      call({
        id: "s",
        role: "student",
        isAdmin: false,
        profile_completed_at: null,
        is_under_13: false,
      }),
    ).toEqual({ passed: false, status: 403, code: "PROFILE_INCOMPLETE" });
  });
  it("a student with no date of birth is refused", () => {
    expect(
      call({
        id: "s",
        role: "student",
        isAdmin: false,
        profile_completed_at: null,
      }),
    ).toEqual({ passed: false, status: 403, code: "PROFILE_INCOMPLETE" });
  });
  it("a completed student passes", () => {
    expect(
      call({
        id: "s",
        role: "student",
        isAdmin: false,
        profile_completed_at: "2026-09-01T00:00:00Z",
        is_under_13: false,
      }),
    ).toMatchObject({ passed: true });
  });
});
