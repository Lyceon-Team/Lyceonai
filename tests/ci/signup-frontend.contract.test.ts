// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseAuthForm } from "@/components/auth/SupabaseAuthForm";
import { authError, humanAuthError } from "@/lib/auth-error-messages";
import { PASSWORD_POLICY, passwordRules } from "@lyceon/shared/password-policy";

const GENERIC_AUTH_ERROR =
  "Something went wrong while signing you in. Please try again.";

const signInMock = vi.hoisted(() => vi.fn());
const signUpMock = vi.hoisted(() => vi.fn());
const signInWithGoogleMock = vi.hoisted(() => vi.fn());
const resetPasswordMock = vi.hoisted(() => vi.fn());
const setLocationMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const csrfFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    signIn: signInMock,
    signUp: signUpMock,
    signInWithGoogle: signInWithGoogleMock,
    resetPassword: resetPasswordMock,
    isLoading: false,
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/login", setLocationMock],
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({
    children,
    onValueChange,
  }: {
    children: React.ReactNode;
    onValueChange?: (value: string) => void;
  }) => {
    Reflect.set(globalThis, "__tabsOnValueChange", onValueChange);
    return React.createElement("div", null, children);
  },
  TabsList: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  TabsTrigger: ({
    children,
    value,
    onClick,
    ...props
  }: {
    children: React.ReactNode;
    value?: string;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement(
      "button",
      {
        ...props,
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(event);
          const callback = Reflect.get(globalThis, "__tabsOnValueChange") as
            | ((value: string) => void)
            | undefined;
          if (value && callback) {
            callback(value);
          }
        },
      },
      children,
    ),
  TabsContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/lib/csrf", () => ({
  csrfFetch: csrfFetchMock,
}));

describe("Signup Frontend Contract", () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    Reflect.set(globalThis, "ResizeObserver", ResizeObserverMock);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    csrfFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        user: {
          role: "student",
          requiredProfileComplete: true,
          requiredConsentsComplete: true,
          guardianConsentRequired: false,
          profileCompletedAt: "2026-04-19T00:00:00.000Z",
        },
      }),
    });
  });

  // @spec [SCL-222 (owner ruling 2026-10-09)] | @implemented [2026-10-09] | plain English: no
  // checkbox at sign-in. Google comes first, filled and never disabled; the email form comes
  // after the "or" divider; the standard notice sits under the buttons, linked to the current
  // Terms of Use and Privacy Policy.
  it("SCL-222: Google is first and never disabled, no consent checkbox, the notice is linked", () => {
    render(React.createElement(SupabaseAuthForm));

    const googleButton = screen.getByTestId(
      "button-google-signin",
    ) as HTMLButtonElement;
    expect(googleButton.disabled).toBe(false);
    // First action on the page: it precedes the email tabs in document order.
    expect(
      googleButton.compareDocumentPosition(screen.getByTestId("tab-signin")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(screen.queryByTestId("checkbox-google-legal")).toBeNull();
    fireEvent.click(screen.getByTestId("tab-signup"));
    expect(screen.queryByTestId("checkbox-signup-legal")).toBeNull();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);

    const notice = screen.getByTestId("signin-legal-notice");
    expect(notice.textContent).toBe(
      "By continuing, you agree to Lyceon's Terms of Use and Privacy Policy.",
    );
    const links = Array.from(notice.querySelectorAll("a")).map((a) => [
      a.textContent,
      a.getAttribute("href"),
    ]);
    expect(links).toEqual([
      ["Terms of Use", "/legal/student-terms"],
      ["Privacy Policy", "/legal/privacy-policy"],
    ]);
  });

  it("signup submit is enabled by a valid email and password alone (no consent step)", async () => {
    render(React.createElement(SupabaseAuthForm));
    fireEvent.click(screen.getByTestId("tab-signup"));

    fireEvent.change(screen.getByTestId("input-signup-name"), {
      target: { value: "Student User" },
    });
    fireEvent.change(screen.getByTestId("input-signup-email"), {
      target: { value: "student@example.com" },
    });
    fireEvent.change(screen.getByTestId("input-signup-password"), {
      target: { value: "Password123!" },
    });

    const signupButton = screen.getByTestId(
      "button-signup",
    ) as HTMLButtonElement;
    expect(signupButton.disabled).toBe(false);
  });

  it("shows verification-required state without redirecting", async () => {
    signUpMock.mockResolvedValueOnce({
      outcome: "verification_required",
      message: "Please verify your email to continue.",
      user: { id: "user-1", email: "student@example.com" },
    });

    render(React.createElement(SupabaseAuthForm));
    fireEvent.click(screen.getByTestId("tab-signup"));

    fireEvent.change(screen.getByTestId("input-signup-name"), {
      target: { value: "Student User" },
    });
    fireEvent.change(screen.getByTestId("input-signup-email"), {
      target: { value: "student@example.com" },
    });
    fireEvent.change(screen.getByTestId("input-signup-password"), {
      target: { value: "Password123!" },
    });
    fireEvent.click(screen.getByTestId("button-signup"));

    await screen.findByTestId("alert-verification-required");
    expect(setLocationMock).not.toHaveBeenCalled();
    expect(signUpMock).toHaveBeenCalledWith(
      "student@example.com",
      "Password123!",
      { consentSource: "email_signup_form" },
      "Student User",
      // No role intent on a plain /login (entry-aware auth brief 2026-10-10).
      null,
    );
  });

  it("Continue with Google starts the redirect at once with the canonical consent source", async () => {
    signInWithGoogleMock.mockResolvedValueOnce(undefined);

    render(React.createElement(SupabaseAuthForm));
    fireEvent.click(screen.getByTestId("button-google-signin"));

    await waitFor(() => {
      expect(signInWithGoogleMock).toHaveBeenCalledWith(
        { consentSource: "google_continue_click" },
        null,
      );
    });
  });

  it("AS-3: sign-in errors render the human mapped message, not the raw error", async () => {
    signInMock.mockRejectedValueOnce(authError("signin_failed"));

    render(React.createElement(SupabaseAuthForm));
    fireEvent.change(screen.getByTestId("input-signin-email"), {
      target: { value: "student@example.com" },
    });
    fireEvent.change(screen.getByTestId("input-signin-password"), {
      target: { value: "whatever" },
    });
    fireEvent.click(screen.getByTestId("button-signin"));

    // The mocked Tabs renders both panes, so there can be multiple alert-error nodes carrying the same
    // shared error string. Assert the mapped human message is shown (never a raw string).
    const alerts = await screen.findAllByTestId("alert-error");
    const expected = humanAuthError("signin_failed") ?? "";
    expect(alerts.some((a) => a.textContent?.includes(expected))).toBe(true);
  });

  it("AS-3: a raw/leaky server error never reaches the UI — falls back to the generic message", async () => {
    // The server (or network) throws a raw, potentially-enumerable string; the form must NOT show it.
    signInMock.mockRejectedValueOnce(new Error("User already registered"));

    render(React.createElement(SupabaseAuthForm));
    fireEvent.change(screen.getByTestId("input-signin-email"), {
      target: { value: "student@example.com" },
    });
    fireEvent.change(screen.getByTestId("input-signin-password"), {
      target: { value: "whatever" },
    });
    fireEvent.click(screen.getByTestId("button-signin"));

    const alerts = await screen.findAllByTestId("alert-error");
    expect(
      alerts.some((a) => a.textContent?.includes(GENERIC_AUTH_ERROR)),
    ).toBe(true);
    expect(alerts.every((a) => !a.textContent?.includes("registered"))).toBe(
      true,
    );
  });

  it("AS-3: signup errors render the human mapped message (non-enumerable)", async () => {
    signUpMock.mockRejectedValueOnce(authError("signup_failed"));

    render(React.createElement(SupabaseAuthForm));
    fireEvent.click(screen.getByTestId("tab-signup"));
    fireEvent.change(screen.getByTestId("input-signup-name"), {
      target: { value: "Student User" },
    });
    fireEvent.change(screen.getByTestId("input-signup-email"), {
      target: { value: "student@example.com" },
    });
    fireEvent.change(screen.getByTestId("input-signup-password"), {
      target: { value: "Password123!" },
    });
    fireEvent.click(screen.getByTestId("button-signup"));

    const alerts = await screen.findAllByTestId("alert-error");
    const expected = humanAuthError("signup_failed") ?? "";
    expect(alerts.some((a) => a.textContent?.includes(expected))).toBe(true);
  });

  /**
   * @spec [contracts/auth-standard-flow.contract.md AS-1; Coding Standards §7.2] | @implemented [2026-09-15]
   * Signup surface wiring of the shared password policy: rules visible before typing, submit gated
   * on the policy with the reason written next to the button, `new-password` on signup and
   * `current-password` on sign-in (password managers generate vs fill), and sign-in NOT gated on
   * the policy (older 6-char accounts must still sign in).
   */
  it("signup lists the shared password rules before typing and names why submit is disabled", () => {
    render(React.createElement(SupabaseAuthForm));
    fireEvent.click(screen.getByTestId("tab-signup"));

    const expectedLabels = passwordRules(PASSWORD_POLICY)
      .filter((r) => r.display === "always")
      .map((r) => r.label);
    const rendered = Array.from(
      screen
        .getByTestId("input-signup-password-requirements")
        .querySelectorAll("li"),
    ).map((li) => li.querySelector("span")?.textContent);
    expect(rendered).toEqual(expectedLabels);

    fireEvent.change(screen.getByTestId("input-signup-email"), {
      target: { value: "student@example.com" },
    });
    fireEvent.change(screen.getByTestId("input-signup-password"), {
      target: { value: "short1" },
    });

    const button = screen.getByTestId("button-signup") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByTestId("signup-submit-reason").textContent).toMatch(
      /password that meets every requirement/i,
    );

    fireEvent.change(screen.getByTestId("input-signup-password"), {
      target: { value: "longenough1" },
    });
    expect(button.disabled).toBe(false);
    expect(screen.queryByTestId("signup-submit-reason")).toBeNull();
  });

  it("signup uses autocomplete=new-password; sign-in uses current-password and shows no rule list", () => {
    render(React.createElement(SupabaseAuthForm));

    const signin = screen.getByTestId(
      "input-signin-password",
    ) as HTMLInputElement;
    expect(signin.getAttribute("autocomplete")).toBe("current-password");
    expect(
      screen.queryByTestId("input-signin-password-requirements"),
    ).toBeNull();

    fireEvent.click(screen.getByTestId("tab-signup"));
    const signup = screen.getByTestId(
      "input-signup-password",
    ) as HTMLInputElement;
    expect(signup.getAttribute("autocomplete")).toBe("new-password");
  });

  it("sign-in is NOT gated on the password policy (legacy 6-char accounts still sign in)", async () => {
    signInMock.mockResolvedValueOnce(undefined);
    render(React.createElement(SupabaseAuthForm));

    fireEvent.change(screen.getByTestId("input-signin-email"), {
      target: { value: "student@example.com" },
    });
    fireEvent.change(screen.getByTestId("input-signin-password"), {
      target: { value: "abc123" },
    });
    fireEvent.click(screen.getByTestId("button-signin"));

    await waitFor(() =>
      expect(signInMock).toHaveBeenCalledWith("student@example.com", "abc123"),
    );
  });
});
