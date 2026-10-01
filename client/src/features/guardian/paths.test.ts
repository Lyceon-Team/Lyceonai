/**
 * G4-01 — the new guardian routes survive the login return path (the `/guardian` allowlist
 * entry is a prefix), and the path builders encode the ids they are given.
 * @spec [Guardian_Closure_Plan G4-01; AS-5] | @implemented [2026-09-30]
 */
import { describe, expect, it } from "vitest";
import { sanitizeReturnPath } from "@lyceon/shared/return-path";
import { guardianPaths } from "./paths";

const S = "33333333-3333-4333-8333-333333333333";

describe("guardian return paths", () => {
  it.each([
    guardianPaths.home,
    guardianPaths.dashboard(S),
    guardianPaths.calendar(S),
    guardianPaths.exams(S),
    guardianPaths.exam(S, "5e551011-0000-4000-8000-000000000001"),
  ])("%s is kept by the return-path allowlist", (path) => {
    expect(sanitizeReturnPath(path)).toBe(path);
  });

  it("an off-origin look-alike is still refused", () => {
    expect(sanitizeReturnPath("//guardian.evil.example/guardian")).toBeNull();
  });

  it("encodes an id rather than trusting it", () => {
    expect(guardianPaths.dashboard("a/b")).toBe("/guardian/a%2Fb");
  });
});
