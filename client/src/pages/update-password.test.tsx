// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PASSWORD_POLICY, passwordRules } from "@lyceon/shared/password-policy";
import UpdatePassword from "./update-password";

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-5 (set new password), AS-3; Coding Standards
 *   §7.2] | @implemented [2026-09-15]
 *
 * plain English: the recovery set-new-password page wires the shared policy: rules visible
 * before typing, submit disabled with the reason written beside it until every rule is met AND
 * the confirmation matches, `new-password` autocomplete on both fields, and the update call only
 * fires with a policy-valid password. Would FAIL if the page regressed to its old local
 * "at least 6 characters" check or lost the disabled-reason text.
 */
const updatePasswordMock = vi.hoisted(() => vi.fn());
const setLocationMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    updatePassword: updatePasswordMock,
    isLoading: false,
    isGuardian: false,
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/update-password", setLocationMock],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

describe("UpdatePassword page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the shared rules before typing and explains why submit is disabled", () => {
    render(<UpdatePassword />);

    const expected = passwordRules(PASSWORD_POLICY)
      .filter((r) => r.display === "always")
      .map((r) => r.label);
    const rendered = Array.from(
      screen
        .getByTestId("input-new-password-requirements")
        .querySelectorAll("li"),
    ).map((li) => li.querySelector("span")?.textContent ?? "");
    expect(rendered).toEqual(expected);

    const button = screen.getByTestId(
      "button-update-password",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(
      screen.getByTestId("update-password-submit-reason").textContent,
    ).toMatch(/meets every requirement/i);
  });

  it("uses autocomplete=new-password on both fields (password managers offer to generate)", () => {
    render(<UpdatePassword />);
    expect(
      screen.getByTestId("input-new-password").getAttribute("autocomplete"),
    ).toBe("new-password");
    expect(
      screen.getByTestId("input-confirm-password").getAttribute("autocomplete"),
    ).toBe("new-password");
  });

  it("stays disabled on a mismatch (with that reason) and enables once both match", () => {
    render(<UpdatePassword />);
    const button = screen.getByTestId(
      "button-update-password",
    ) as HTMLButtonElement;

    fireEvent.change(screen.getByTestId("input-new-password"), {
      target: { value: "correct-horse-1" },
    });
    expect(button.disabled).toBe(true);
    expect(
      screen.getByTestId("update-password-submit-reason").textContent,
    ).toMatch(/same password in both fields/i);

    fireEvent.change(screen.getByTestId("input-confirm-password"), {
      target: { value: "correct-horse-1" },
    });
    expect(button.disabled).toBe(false);
    expect(screen.queryByTestId("update-password-submit-reason")).toBeNull();
  });

  it("a 6-character password (the OLD minimum) is no longer enough", () => {
    render(<UpdatePassword />);
    fireEvent.change(screen.getByTestId("input-new-password"), {
      target: { value: "abc123" },
    });
    fireEvent.change(screen.getByTestId("input-confirm-password"), {
      target: { value: "abc123" },
    });
    expect(
      (screen.getByTestId("button-update-password") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(updatePasswordMock).not.toHaveBeenCalled();
  });

  it("submits a policy-valid, matching password and lands the student on /dashboard", async () => {
    updatePasswordMock.mockResolvedValueOnce(undefined);
    render(<UpdatePassword />);

    fireEvent.change(screen.getByTestId("input-new-password"), {
      target: { value: "correct-horse-1" },
    });
    fireEvent.change(screen.getByTestId("input-confirm-password"), {
      target: { value: "correct-horse-1" },
    });
    fireEvent.click(screen.getByTestId("button-update-password"));

    await waitFor(() =>
      expect(updatePasswordMock).toHaveBeenCalledWith("correct-horse-1"),
    );
    expect(setLocationMock).toHaveBeenCalledWith("/dashboard");
  });
});
