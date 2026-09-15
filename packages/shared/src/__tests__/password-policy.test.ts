/**
 * @spec [contracts/auth-standard-flow.contract.md AS-1, AS-5; Coding Standards §7.2]
 * @implemented [2026-09-15]
 *
 * plain English: pins the password policy as the ONE source the client rules and the server
 * parse both derive from. Expected outcome: the live constant mirrors GoTrue (8 / letter / digit /
 * 72 cap); the rule list is a pure function of the policy, so a different policy yields a
 * different list; the Zod schema and the rule evaluator never disagree on a password. Trade-off:
 * the GoTrue-mirroring assertions are the deliberate coupling — change GoTrue, change this.
 * Edge case: a 72-character password passes and a 73-character one fails (rejected, never
 * truncated); non-ASCII letters do not satisfy the letter rule, exactly as in GoTrue.
 */
import { describe, expect, it } from "vitest";
import {
  PASSWORD_POLICY,
  evaluatePassword,
  passwordRules,
  passwordSchema,
  passwordSchemaFor,
  type PasswordPolicy,
} from "../password-policy.js";

describe("PASSWORD_POLICY mirrors the live GoTrue config (2026-09-15)", () => {
  it("min 8, letter + digit required, 72-char bcrypt cap (≥64 per NIST 800-63B-4)", () => {
    expect(PASSWORD_POLICY.minLength).toBe(8);
    expect(PASSWORD_POLICY.requireLetter).toBe(true);
    expect(PASSWORD_POLICY.requireDigit).toBe(true);
    expect(PASSWORD_POLICY.maxLength).toBe(72);
    expect(PASSWORD_POLICY.maxLength).toBeGreaterThanOrEqual(64);
  });
});

describe("passwordRules is derived from the policy", () => {
  it("lists min length, letter, digit up front and the max only on violation", () => {
    const rules = passwordRules(PASSWORD_POLICY);
    expect(rules.map((r) => r.id)).toEqual([
      "min_length",
      "letter",
      "digit",
      "max_length",
    ]);
    expect(rules.map((r) => r.display)).toEqual([
      "always",
      "always",
      "always",
      "on_violation",
    ]);
    expect(rules[0]?.label).toBe("At least 8 characters");
  });

  it("changing the policy changes the rule list (no hard-coded rules anywhere)", () => {
    const changed: PasswordPolicy = {
      minLength: 12,
      maxLength: 100,
      requireLetter: false,
      requireDigit: true,
    };
    const rules = passwordRules(changed);
    expect(rules.map((r) => r.id)).toEqual([
      "min_length",
      "digit",
      "max_length",
    ]);
    expect(rules[0]?.label).toBe("At least 12 characters");
    expect(rules.at(-1)?.label).toBe("No more than 100 characters");
  });
});

describe("evaluatePassword and passwordSchema agree", () => {
  const cases: ReadonlyArray<readonly [string, boolean]> = [
    ["", false],
    ["abc123", false], // too short
    ["abcdefgh", false], // no digit
    ["12345678", false], // no letter
    ["abcdefg1", true],
    ["Password123!", true],
    ["ééééééé1", false], // non-ASCII letters do not count (GoTrue parity)
    ["a1".repeat(36), true], // exactly 72
    ["a1".repeat(36) + "x", false], // 73 → rejected, not truncated
    ["a1" + " ".repeat(20) + "zz", true], // spaces and length beyond 20 are fine
  ];

  it.each(cases)("%j → valid=%s", (password, valid) => {
    expect(evaluatePassword(password, PASSWORD_POLICY).valid).toBe(valid);
    expect(passwordSchema.safeParse(password).success).toBe(valid);
  });

  it("reports per-rule met/unmet for live feedback", () => {
    const { rules } = evaluatePassword("abc", PASSWORD_POLICY);
    const byId = Object.fromEntries(rules.map((r) => [r.id, r.met]));
    expect(byId).toEqual({
      min_length: false,
      letter: true,
      digit: false,
      max_length: true,
    });
  });

  it("passwordSchemaFor follows a changed policy too", () => {
    const relaxed = passwordSchemaFor({
      minLength: 4,
      maxLength: 8,
      requireLetter: false,
      requireDigit: false,
    });
    expect(relaxed.safeParse("....").success).toBe(true);
    expect(relaxed.safeParse("123456789").success).toBe(false);
  });
});
