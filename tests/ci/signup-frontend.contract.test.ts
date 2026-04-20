// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseAuthForm } from "@/components/auth/SupabaseAuthForm";

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
  TabsList: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  TabsTrigger: ({
    children,
    value,
    onClick,
    ...props
  }: { children: React.ReactNode; value?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement(
      "button",
      {
        ...props,
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(event);
          const callback = (globalThis as any).__tabsOnValueChange as ((value: string) => void) | undefined;
          if (value && callback) {
            callback(value);
          }
        },
      },
      children,
    ),
  TabsContent: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
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

    fireEvent.change(screen.getByTestId("input-signup-name"), { target: { value: "Student User" } });
    fireEvent.change(screen.getByTestId("input-signup-email"), { target: { value: "student@example.com" } });
    fireEvent.change(screen.getByTestId("input-signup-password"), { target: { value: "Password123!" } });

    const signupButton = screen.getByTestId("button-signup") as HTMLButtonElement;
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

    fireEvent.change(screen.getByTestId("input-signup-name"), { target: { value: "Student User" } });
    fireEvent.change(screen.getByTestId("input-signup-email"), { target: { value: "student@example.com" } });
    fireEvent.change(screen.getByTestId("input-signup-password"), { target: { value: "Password123!" } });
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

    const googleButton = screen.getByTestId("button-google-signin") as HTMLButtonElement;
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
});
