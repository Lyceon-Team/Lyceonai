// @vitest-environment jsdom
import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PASSWORD_POLICY, passwordRules } from "@lyceon/shared/password-policy";
import { PasswordField } from "./PasswordField";

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-1, AS-5; Coding Standards §7.2 (one shared
 *   policy), §11.1] | @implemented [2026-09-15]
 *
 * plain English: the password input's contract, rule by rule. Expected outcome: the rendered
 * rule list is exactly the shared policy's always-visible rules (so the constant, not the
 * component, owns the rules); each rule flips met/unmet live inside an aria-live="polite"
 * region; the show/hide toggle works and is labelled; paste is not blocked and there is no
 * maxLength attribute, so a 100-character password arrives intact and the over-length rule
 * APPEARS instead of the value being cut; `autocomplete` is whatever the surface passes;
 * sign-in mode renders no rule list at all. Would FAIL if a rule were hard-coded in the
 * component, if the live region lost its aria-live, or if a maxLength/paste block crept in.
 */
function Harness(props: {
  autoComplete: "new-password" | "current-password";
  showRequirements: boolean;
  initial?: string;
}) {
  const [value, setValue] = useState(props.initial ?? "");
  return (
    <PasswordField
      id="pw"
      testId="pw"
      label="Password"
      value={value}
      onChange={setValue}
      autoComplete={props.autoComplete}
      showRequirements={props.showRequirements}
    />
  );
}

function renderedRuleLabels(): string[] {
  return Array.from(
    screen.getByTestId("pw-requirements").querySelectorAll("li"),
  ).map((li) => li.querySelector("span")?.textContent ?? "");
}

describe("PasswordField", () => {
  it("lists the shared policy's always-visible rules BEFORE the user types", () => {
    render(<Harness autoComplete="new-password" showRequirements />);
    const expected = passwordRules(PASSWORD_POLICY)
      .filter((r) => r.display === "always")
      .map((r) => r.label);
    expect(expected.length).toBeGreaterThan(0);
    expect(renderedRuleLabels()).toEqual(expected);
    for (const li of screen
      .getByTestId("pw-requirements")
      .querySelectorAll("li")) {
      expect(li.getAttribute("data-met")).toBe("false");
    }
  });

  it("flips each rule met/unmet live inside an aria-live=polite region", () => {
    render(<Harness autoComplete="new-password" showRequirements />);
    const region = screen.getByTestId("pw-requirements");
    expect(region.getAttribute("aria-live")).toBe("polite");

    fireEvent.change(screen.getByTestId("pw"), { target: { value: "abc" } });
    expect(
      screen.getByTestId("password-rule-letter").getAttribute("data-met"),
    ).toBe("true");
    expect(
      screen.getByTestId("password-rule-digit").getAttribute("data-met"),
    ).toBe("false");
    expect(
      screen.getByTestId("password-rule-min_length").getAttribute("data-met"),
    ).toBe("false");

    fireEvent.change(screen.getByTestId("pw"), {
      target: { value: "abcdefg1" },
    });
    for (const li of region.querySelectorAll("li")) {
      expect(li.getAttribute("data-met")).toBe("true");
    }
  });

  it("show/hide toggle switches the input type and is labelled for assistive tech", () => {
    render(<Harness autoComplete="new-password" showRequirements />);
    const input = screen.getByTestId("pw") as HTMLInputElement;
    const toggle = screen.getByTestId("pw-toggle");

    expect(input.type).toBe("password");
    expect(toggle.getAttribute("aria-label")).toBe("Show password");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.getAttribute("type")).toBe("button"); // never submits the form

    fireEvent.click(toggle);
    expect(input.type).toBe("text");
    expect(toggle.getAttribute("aria-label")).toBe("Hide password");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("accepts 64+ characters intact — no maxLength attribute, no truncation, paste not blocked", () => {
    render(<Harness autoComplete="new-password" showRequirements />);
    const input = screen.getByTestId("pw") as HTMLInputElement;
    expect(input.hasAttribute("maxlength")).toBe(false);

    // A paste event must not be cancelled by the component.
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    input.dispatchEvent(pasteEvent);
    expect(pasteEvent.defaultPrevented).toBe(false);

    const hundred = "a1".repeat(50);
    fireEvent.change(input, { target: { value: hundred } });
    expect(input.value).toBe(hundred);
    expect(input.value.length).toBe(100);

    // Over the GoTrue cap the max rule APPEARS as unmet — shown, never silently cut.
    const max = screen.getByTestId("password-rule-max_length");
    expect(max.getAttribute("data-met")).toBe("false");
    expect(max.textContent).toContain(`${PASSWORD_POLICY.maxLength}`);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("hides the max rule while it is satisfied (an empty field shows no 'met' tick for it)", () => {
    render(<Harness autoComplete="new-password" showRequirements />);
    expect(screen.queryByTestId("password-rule-max_length")).toBeNull();
  });

  it("passes the surface's autocomplete token through unchanged", () => {
    const { unmount } = render(
      <Harness autoComplete="new-password" showRequirements />,
    );
    expect(
      (screen.getByTestId("pw") as HTMLInputElement).getAttribute(
        "autocomplete",
      ),
    ).toBe("new-password");
    unmount();

    render(
      <Harness autoComplete="current-password" showRequirements={false} />,
    );
    expect(
      (screen.getByTestId("pw") as HTMLInputElement).getAttribute(
        "autocomplete",
      ),
    ).toBe("current-password");
  });

  it("renders no rule list and no strength meter on a sign-in surface", () => {
    const { container } = render(
      <Harness autoComplete="current-password" showRequirements={false} />,
    );
    expect(screen.queryByTestId("pw-requirements")).toBeNull();
    expect(container.querySelector("meter, progress")).toBeNull();
    expect(container.textContent?.toLowerCase()).not.toContain("strength");
  });

  it("never renders a strength meter on a create surface either", () => {
    const { container } = render(
      <Harness autoComplete="new-password" showRequirements />,
    );
    expect(container.querySelector("meter, progress")).toBeNull();
    expect(container.textContent?.toLowerCase()).not.toContain("strength");
  });
});
