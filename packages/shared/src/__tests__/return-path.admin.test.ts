/**
 * @spec [Doc-03_V3 §21.3; closure plan W2-8] | @implemented 2026-09-24
 *
 * plain English: a signed-out admin who follows a Slack crisis alert
 * (/admin/crisis-review/<case id>) must land on that case after signing in,
 * not on /dashboard. Pins the allowlist entry, and that it is exactly the
 * crisis review surface — not a blanket "/admin" prefix.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RETURN_PATH_ALLOWLIST,
  loginPathWithReturn,
  returnPathFromSearch,
  sanitizeReturnPath,
} from "../return-path";

const CASE_URL = "/admin/crisis-review/3d06effb-fe0a-46f5-bcf3-28adccfa64f7";

describe("W2-8 — the crisis review surface survives sign-in", () => {
  it("a case link and the list are valid return paths", () => {
    expect(sanitizeReturnPath(CASE_URL)).toBe(CASE_URL);
    expect(sanitizeReturnPath("/admin/crisis-review")).toBe(
      "/admin/crisis-review",
    );
  });

  it("round-trips through /login?next=", () => {
    const login = loginPathWithReturn(CASE_URL);
    expect(login).toBe(`/login?next=${encodeURIComponent(CASE_URL)}`);
    expect(returnPathFromSearch(login.slice(login.indexOf("?")))).toBe(
      CASE_URL,
    );
  });

  it("is not a blanket /admin prefix", () => {
    expect(sanitizeReturnPath("/admin")).toBeNull();
    expect(sanitizeReturnPath("/admin/anything-else")).toBeNull();
    expect(sanitizeReturnPath("/admin/crisis-reviewer")).toBeNull();
    expect(RETURN_PATH_ALLOWLIST).not.toContain("/admin");
  });

  it("the entry is a route App.tsx mounts, behind the admin role", () => {
    const app = readFileSync(
      join(__dirname, "../../../../client/src/App.tsx"),
      "utf8",
    );
    expect(app).toMatch(
      /path="\/admin\/crisis-review"\s*\n\s*component=\{\(\) => \(\s*\n\s*<RequireRole allow=\{\["admin"\]\}>/,
    );
  });
});
