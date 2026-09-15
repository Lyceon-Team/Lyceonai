// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * @spec [Coding Standards §7.2 — ONE shared password policy] | @implemented [2026-09-15]
 *
 * plain English: the brief's proof obligation — "the rule list is derived from the shared
 * constant, asserted by CHANGING the constant and observing the rendered rules change". This
 * file swaps `PASSWORD_POLICY` in `@lyceon/shared/password-policy` for a different policy (min 12, no letter
 * rule, cap 100) before the component loads and asserts the rendered list follows it: the
 * "at least 8" rule is gone, "at least 12" is present, and the letter rule is absent. Would
 * FAIL if the component (or anything it imports) hard-coded a number or a rule. The sibling
 * PasswordField.test.tsx proves the same component against the real constant.
 */
vi.mock("@lyceon/shared/password-policy", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@lyceon/shared/password-policy")>();
  return {
    ...actual,
    PASSWORD_POLICY: {
      minLength: 12,
      maxLength: 100,
      requireLetter: false,
      requireDigit: true,
    },
  };
});

import { PasswordField } from "./PasswordField";

describe("PasswordField follows a changed shared policy", () => {
  it("renders rules for the mocked constant, not the production numbers", () => {
    render(
      <PasswordField
        id="pw"
        testId="pw"
        label="Password"
        value=""
        onChange={() => undefined}
        autoComplete="new-password"
        showRequirements
      />,
    );
    const labels = Array.from(
      screen.getByTestId("pw-requirements").querySelectorAll("li"),
    ).map((li) => li.querySelector("span")?.textContent ?? "");

    expect(labels).toEqual([
      "At least 12 characters",
      "At least one number (0–9)",
    ]);
    expect(labels.some((l) => l.includes("8"))).toBe(false);
    expect(labels.some((l) => /letter/i.test(l))).toBe(false);
    expect(screen.queryByTestId("password-rule-letter")).toBeNull();
  });
});
