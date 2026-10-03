/**
 * OQ-41: which `hasPassword` values show Settings' Change password form.
 *
 * @spec [student-UI register OQ-26, OQ-41 (owner ruling, Karl, 2026-10-03: "`hasPassword: null`
 *        shows the password form; the server's F-38 refusal stays the authority"), F-38]
 *        | @implemented [2026-10-03]
 *
 * plain English: all three values the profile read can carry are tested. Only `false`
 * (Google-only) hides the form; `null` (identities unreadable) and `true` show it.
 */
import { describe, expect, it } from "vitest";
import { showsChangePassword } from "./useProfileQuery";

describe("OQ-41: Change password visibility from hasPassword", () => {
  it("true (a password account) shows the form", () => {
    expect(showsChangePassword(true)).toBe(true);
  });

  it("null (the server could not read the identities) shows the form", () => {
    expect(showsChangePassword(null)).toBe(true);
  });

  it("false (Google-only, F-38) hides the form", () => {
    expect(showsChangePassword(false)).toBe(false);
  });
});
