/**
 * @spec [SCL-222 (owner ruling 2026-10-09: acceptance is recorded at account creation; a
 *       returning user's sign-in records nothing)] | @implemented [2026-10-09]
 *
 * plain English: `isNewlyCreatedAccount` is the server's only test of "this Google callback created
 * the account". It is true for an auth user created within the window and false for anything
 * older, missing or unparseable — the failure mode is a missing acceptance row (which the
 * re-acceptance prompt then collects), never a row recorded for a returning user.
 */
import { describe, expect, it } from "vitest";
import {
  isNewlyCreatedAccount,
  NEW_ACCOUNT_WINDOW_MS,
} from "../../server/lib/new-auth-account";

const NOW = new Date("2026-10-09T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("isNewlyCreatedAccount (SCL-222)", () => {
  it("an account created seconds ago is new", () => {
    expect(isNewlyCreatedAccount(ago(5_000), NOW)).toBe(true);
  });

  it("the window edge is inclusive, one millisecond past it is not new", () => {
    expect(isNewlyCreatedAccount(ago(NEW_ACCOUNT_WINDOW_MS), NOW)).toBe(true);
    expect(isNewlyCreatedAccount(ago(NEW_ACCOUNT_WINDOW_MS + 1), NOW)).toBe(
      false,
    );
  });

  it("a returning account (created months ago) is not new", () => {
    expect(isNewlyCreatedAccount("2026-03-01T12:00:00.000Z", NOW)).toBe(false);
  });

  it("missing or unparseable created_at is not new (fail towards no row)", () => {
    expect(isNewlyCreatedAccount(undefined, NOW)).toBe(false);
    expect(isNewlyCreatedAccount(null, NOW)).toBe(false);
    expect(isNewlyCreatedAccount("", NOW)).toBe(false);
    expect(isNewlyCreatedAccount("not-a-date", NOW)).toBe(false);
  });

  it("small clock skew (created_at slightly ahead) is still new; far future is not", () => {
    expect(isNewlyCreatedAccount(ago(-30_000), NOW)).toBe(true);
    expect(isNewlyCreatedAccount(ago(-5 * 60_000), NOW)).toBe(false);
  });
});
