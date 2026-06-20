// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseAuthForm } from "@/components/auth/SupabaseAuthForm";
import { authError, humanAuthError } from "@/lib/auth-error-messages";

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
    (globalThis as any).__tabsOnValueChange = onValueChange;
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
          const callback = (globalThis as any).__tabsOnValueChange as
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

    (globalThis as any).ResizeObserver = ResizeObserverMock;
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

  it("keeps signup submit disabled until legal consent is checked", async () => {
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
    expect(signupButton.disabled).toBe(true);

    fireEvent.click(screen.getByTestId("checkbox-signup-legal"));
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
    fireEvent.click(screen.getByTestId("checkbox-signup-legal"));
    fireEvent.click(screen.getByTestId("button-signup"));

    await screen.findByTestId("alert-verification-required");
    expect(setLocationMock).not.toHaveBeenCalled();
    expect(signUpMock).toHaveBeenCalledWith(
      "student@example.com",
      "Password123!",
      {
        studentTermsAccepted: true,
        privacyPolicyAccepted: true,
        consentSource: "email_signup_form",
      },
      "Student User",
    );
  });

  it("requires explicit Google legal consent and sends canonical consent payload", async () => {
    signInWithGoogleMock.mockResolvedValueOnce(undefined);

    render(React.createElement(SupabaseAuthForm));

    const googleButton = screen.getByTestId(
      "button-google-signin",
    ) as HTMLButtonElement;
    expect(googleButton.disabled).toBe(true);

    fireEvent.click(screen.getByTestId("checkbox-google-legal"));
    expect(googleButton.disabled).toBe(false);

    fireEvent.click(googleButton);

    await waitFor(() => {
      expect(signInWithGoogleMock).toHaveBeenCalledWith({
        studentTermsAccepted: true,
        privacyPolicyAccepted: true,
        consentSource: "google_continue_pre_oauth",
      });
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
    fireEvent.click(screen.getByTestId("checkbox-signup-legal"));
    fireEvent.click(screen.getByTestId("button-signup"));

    const alerts = await screen.findAllByTestId("alert-error");
    const expected = humanAuthError("signup_failed") ?? "";
    expect(alerts.some((a) => a.textContent?.includes(expected))).toBe(true);
  });
});
