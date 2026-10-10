/**
 * @spec [owner brief "Entry-aware sign-in / sign-up" (Karl, 2026-10-10) rules 1-2; AS-5] |
 * @implemented [2026-10-10]
 *
 * plain English: the auth page's two entry parameters are allowlists. The exact allowed values
 * pass; everything else — case, whitespace, admin, script, a repeated key's later value, a
 * non-string — falls back (Sign In; no role). The URL builder never lets an unsafe `next` through.
 */
import { describe, expect, it } from "vitest";
import {
  AUTH_MODE_PARAM,
  AUTH_ROLE_PARAM,
  DIAGNOSTIC_START_PATH,
  authEntryFromSearch,
  authEntryPath,
  parseAuthEntryMode,
  parseSignupRoleIntent,
} from "../auth-entry";
import { returnPathForRole } from "../return-path";

describe("parseAuthEntryMode", () => {
  it("passes exactly the two modes", () => {
    expect(parseAuthEntryMode("signin")).toBe("signin");
    expect(parseAuthEntryMode("signup")).toBe("signup");
  });

  it.each([
    [undefined],
    [null],
    [""],
    ["reset"],
    ["SIGNUP"],
    ["signup "],
    [" signup"],
    ["sign-up"],
    ["signup<script>"],
    ["javascript:alert(1)"],
    [["signup"]],
    [{ mode: "signup" }],
    [1],
  ])("falls back to Sign In for %j", (raw) => {
    expect(parseAuthEntryMode(raw)).toBe("signin");
  });
});

describe("parseSignupRoleIntent", () => {
  it("passes exactly the two self-assignable roles", () => {
    expect(parseSignupRoleIntent("guardian")).toBe("guardian");
    expect(parseSignupRoleIntent("student")).toBe("student");
  });

  it.each([
    [undefined],
    [null],
    [""],
    ["admin"],
    ["Guardian"],
    ["guardian "],
    ["guardian\n"],
    ["parent"],
    [["guardian"]],
    [{ role: "guardian" }],
  ])("is no intent for %j", (raw) => {
    expect(parseSignupRoleIntent(raw)).toBeNull();
  });
});

describe("authEntryFromSearch", () => {
  it("reads both parameters", () => {
    expect(authEntryFromSearch("?mode=signup&role=guardian")).toEqual({
      mode: "signup",
      role: "guardian",
    });
  });

  it("an unknown or malicious query is Sign In with no role", () => {
    expect(
      authEntryFromSearch(
        "?mode=%3Cscript%3Ealert(1)%3C%2Fscript%3E&role=admin&next=https://evil.example",
      ),
    ).toEqual({ mode: "signin", role: null });
    expect(authEntryFromSearch("")).toEqual({ mode: "signin", role: null });
  });

  it("a repeated key is read once (the first value) and still allowlisted", () => {
    expect(authEntryFromSearch("?mode=admin&mode=signup")).toEqual({
      mode: "signin",
      role: null,
    });
  });
});

describe("authEntryPath", () => {
  it("builds the mode, role and sanitised next", () => {
    expect(
      authEntryPath({ mode: "signup", role: "guardian", next: "/guardian" }),
    ).toBe("/login?mode=signup&role=guardian&next=%2Fguardian");
    expect(authEntryPath({ mode: "signin" })).toBe("/login?mode=signin");
  });

  it.each([
    ["https://evil.example/x"],
    ["//evil.example"],
    ["/login"],
    ["/admin"],
  ])("drops a next the return-path sanitiser refuses (%s)", (next) => {
    expect(authEntryPath({ mode: "signup", next })).toBe("/login?mode=signup");
  });

  it("round-trips through the reader", () => {
    const url = new URL(
      authEntryPath({ mode: "signup", role: "guardian" }),
      "https://lyceon.invalid",
    );
    expect(url.searchParams.get(AUTH_MODE_PARAM)).toBe("signup");
    expect(url.searchParams.get(AUTH_ROLE_PARAM)).toBe("guardian");
    expect(authEntryFromSearch(url.search)).toEqual({
      mode: "signup",
      role: "guardian",
    });
  });
});

describe("DIAGNOSTIC_START_PATH", () => {
  it("is a return path a student may be landed on and a guardian may not", () => {
    expect(returnPathForRole(DIAGNOSTIC_START_PATH, "student")).toBe(
      DIAGNOSTIC_START_PATH,
    );
    expect(returnPathForRole(DIAGNOSTIC_START_PATH, "guardian")).toBeNull();
  });
});
