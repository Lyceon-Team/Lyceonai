/**
 * @spec [contracts/auth-standard-flow.contract.md AS-5 (allowlisted `next`); Doc-05F §17.1 (the
 *        student's calendar at /calendar); Doc-04A §16 / Doc-04C §16.1 (full-length exams at
 *        /tests); contracts/notifications.contract.md (full-length emails link to /calendar);
 *        student-ui register UI-03] | @implemented [2026-09-29]
 *
 * plain English: a signed-out student who opens /calendar or /tests (or a /tests/<id> deep link, or
 * the path a full-length notification email links to) is returned there after sign-in — and still
 * returned there when first-time onboarding sits in between. The role map keeps a guardian from
 * being sent to a student page RequireRole would bounce them off, and a disallowed `next` is still
 * dropped for the role default.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RETURN_PATH_ALLOWLIST,
  RETURN_PATH_ROUTE_ROLES,
  loginPathWithReturn,
  onboardingPathWithReturn,
  postAuthDestination,
  returnPathForRole,
  returnPathFromSearch,
  sanitizeReturnPath,
} from "../return-path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const SESSION_ID = "3d06effb-fe0a-46f5-bcf3-28adccfa64f7";

/**
 * The paths the full-length notification emails actually link to, read from the template source
 * rather than restated — a new href in that file is picked up here without anyone remembering to.
 */
function fullLengthEmailPaths(): string[] {
  const source = readFileSync(
    join(REPO_ROOT, "server/lib/notifications/templates/full-length.ts"),
    "utf8",
  );
  const constants = [...source.matchAll(/const \w+_HREF = "(\/[^"]*)"/g)].map(
    (m) => m[1] ?? "",
  );
  const literals = [...source.matchAll(/href="\$\{siteUrl\}(\/[^"$]*)"/g)].map(
    (m) => m[1] ?? "",
  );
  return [...new Set([...constants, ...literals])].filter((p) => p.length > 0);
}

describe("UI-03 — student surfaces are return paths", () => {
  it("/calendar and /tests are allowlisted; /chat still is", () => {
    expect(RETURN_PATH_ALLOWLIST).toContain("/calendar");
    expect(RETURN_PATH_ALLOWLIST).toContain("/tests");
    expect(RETURN_PATH_ALLOWLIST).toContain("/chat");
  });

  it("sanitizeReturnPath honours /calendar, /tests and /tests deep links", () => {
    expect(sanitizeReturnPath("/calendar")).toBe("/calendar");
    expect(sanitizeReturnPath("/tests")).toBe("/tests");
    expect(sanitizeReturnPath(`/tests/${SESSION_ID}`)).toBe(
      `/tests/${SESSION_ID}`,
    );
    expect(sanitizeReturnPath(`/tests/${SESSION_ID}/report`)).toBe(
      `/tests/${SESSION_ID}/report`,
    );
    expect(sanitizeReturnPath(`/tests/${SESSION_ID}/rw/1`)).toBe(
      `/tests/${SESSION_ID}/rw/1`,
    );
  });

  it("every full-length email path survives the login round trip", () => {
    const paths = fullLengthEmailPaths();
    // Presence before absence: the extraction must have found something.
    expect(paths).toContain("/calendar");
    for (const path of paths) {
      const login = loginPathWithReturn(path);
      expect(login, path).toBe(`/login?next=${encodeURIComponent(path)}`);
      expect(returnPathFromSearch(login.slice(login.indexOf("?"))), path).toBe(
        path,
      );
    }
  });

  it("near-misses are still refused (the sanitiser is not loosened)", () => {
    for (const bad of [
      "/calendarx",
      "/testsx",
      "/tests-old",
      "/students/abc/tests", // the guardian route — not a /tests prefix
      "//evil.example.com/calendar",
      "https://evil.example.com/tests",
    ]) {
      expect(sanitizeReturnPath(bad), bad).toBeNull();
    }
  });
});

describe("UI-03 — role-aware destination", () => {
  it("every allowlist entry has a role list, and nothing else does", () => {
    expect(Object.keys(RETURN_PATH_ROUTE_ROLES).sort()).toEqual(
      [...RETURN_PATH_ALLOWLIST].sort(),
    );
  });

  it("a guardian is never returned to a student page", () => {
    expect(returnPathForRole("/calendar", "guardian")).toBeNull();
    expect(returnPathForRole(`/tests/${SESSION_ID}`, "guardian")).toBeNull();
    expect(returnPathForRole("/dashboard", "guardian")).toBeNull();
    expect(returnPathForRole("/guardian?code=ABC234", "guardian")).toBe(
      "/guardian?code=ABC234",
    );
    expect(returnPathForRole("/notifications", "guardian")).toBe(
      "/notifications",
    );
  });

  it("a student is never returned to a guardian or admin page", () => {
    expect(returnPathForRole("/calendar", "student")).toBe("/calendar");
    expect(returnPathForRole("/guardian?code=ABC234", "student")).toBeNull();
    expect(returnPathForRole("/admin/crisis-review", "student")).toBeNull();
  });

  it("postAuthDestination: next wins for the right role, else the role default", () => {
    expect(
      postAuthDestination({
        role: "student",
        needsOnboarding: false,
        next: "/calendar",
      }),
    ).toBe("/calendar");
    expect(
      postAuthDestination({
        role: "guardian",
        needsOnboarding: false,
        next: "/calendar",
      }),
    ).toBe("/guardian");
    expect(
      postAuthDestination({
        role: "student",
        needsOnboarding: false,
        next: "https://evil.example.com/calendar",
      }),
    ).toBe("/dashboard");
    expect(
      postAuthDestination({
        role: "admin",
        needsOnboarding: false,
        next: null,
      }),
    ).toBe("/dashboard");
  });

  it("postAuthDestination: onboarding still wins, and carries the sanitised next", () => {
    expect(
      postAuthDestination({
        role: "student",
        needsOnboarding: true,
        next: "/calendar",
      }),
    ).toBe("/profile/complete?next=%2Fcalendar");
    expect(
      postAuthDestination({
        role: "student",
        needsOnboarding: true,
        next: "https://evil.example.com/calendar",
      }),
    ).toBe("/profile/complete");
  });

  it("onboardingPathWithReturn drops a disallowed next and never nests /profile/complete", () => {
    expect(onboardingPathWithReturn(`/tests/${SESSION_ID}`)).toBe(
      `/profile/complete?next=${encodeURIComponent(`/tests/${SESSION_ID}`)}`,
    );
    expect(onboardingPathWithReturn("/not-a-route")).toBe("/profile/complete");
    expect(onboardingPathWithReturn(undefined)).toBe("/profile/complete");
    expect(onboardingPathWithReturn("/profile/complete?next=%2Fcalendar")).toBe(
      "/profile/complete",
    );
  });
});
