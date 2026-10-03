/**
 * UI-59: the bare-card pages (register UI-3A's list) and the 404's way home.
 *
 * @spec [student-UI register §6 Wave 5 UI-59, UI-3A; DESIGN.md §2 "Bare card", §4 "Not
 *        prototyped" (the bare-card pages; the pending-deletion screen — build to the shell spec
 *        and send Karl screenshots before merge); OQ-4 (390px, light and dark)]
 *        | @implemented [2026-10-03]
 *
 * plain English: every bare page as the browser reaches it through the real routes and the real
 * server: sign in, sign up and reset (signed out), the sign-in page carrying a real OAuth
 * callback error code, profile completion (a student with no completed profile), update password
 * and its refusal, the recovery page answering a token the real route does not know,
 * /guardian-required (an unlinked under-13 student), the 404 and its way home, the
 * pending-deletion screen (a student on whom the real `request_account_deletion` has run) and the
 * error screen (a page whose code chunk fails to load, the way production reaches it). None is
 * prototyped; every shot is marked NOT PROTOTYPED.
 *
 * What the harness cannot reach, and why (no screenshot stands in for these):
 *   - a live recovery grant on /update-password: the grant is written only by the auth callback
 *     after Supabase verifies the emailed token, and the harness never calls Supabase. The page
 *     reads no grant itself (the server's POST does), so the form shown is what a granted student
 *     sees. The refusal shot shows the page after a refused submit: any non-OK answer is the
 *     same `update_password_failed` error (`SupabaseAuthContext.updatePassword`), but no message
 *     reaches the screen (a pre-existing defect, reported in UI-59, not changed here).
 *   - the recovery page's success state: it needs a real single-use token from the deletion email.
 */
import type { PageGroup, Shot } from "./types";

const NOT_PROTOTYPED =
  "NOT PROTOTYPED (DESIGN.md §4): the bare-card pages and the pending-deletion screen are built to the shell spec (§2 Bare card); these screenshots go to Karl before merge.";

function bare(
  shot: Omit<Shot, "prototype" | "waitFor"> & { ready: string },
): Shot {
  const { ready, ...rest } = shot;
  return {
    ...rest,
    waitFor: { desktop: ready, mobile: ready },
    fullPage: true,
    prototype: { kind: "none", reason: NOT_PROTOTYPED },
  };
}

function click(selector: string): {
  click: Record<"desktop" | "mobile", string>;
} {
  return { click: { desktop: selector, mobile: selector } };
}

function fill(
  selector: string,
  value: string,
): { fill: Record<"desktop" | "mobile", string>; value: string } {
  return { fill: { desktop: selector, mobile: selector }, value };
}

export const UI_59: PageGroup = {
  id: "UI-59",
  title:
    "UI-59 Bare-card pages (sign in, sign up, reset, profile completion, update password, account recovery, guardian required, 404, pending deletion, error screen), all NOT PROTOTYPED; light and dark, 1440 and 390",
  seed: "bare-pages",
  shots: [
    bare({
      id: "login-signin",
      title: "/login, signed out: Sign In tab",
      persona: "signed-out",
      route: "/login",
      ready: '[data-testid="button-signin"]',
    }),
    bare({
      id: "login-redirect-error",
      title:
        "/login?error=google_oauth_failed (a code the real OAuth callback redirects with): the human message as an alert",
      persona: "signed-out",
      route: "/login?error=google_oauth_failed",
      ready: '[data-testid="login-redirect-error"]',
    }),
    bare({
      id: "login-signup",
      title: "/login → Sign Up tab (the student sign-up form)",
      persona: "signed-out",
      route: "/login",
      ready: '[data-testid="tab-signup"]',
      steps: [click('[data-testid="tab-signup"]')],
      expectVisible: '[data-testid="button-signup"]',
    }),
    bare({
      id: "login-reset",
      title: "/login → Forgot password? (reset mode)",
      persona: "signed-out",
      route: "/login",
      ready: '[data-testid="button-signin"]',
      steps: [click('button:has-text("Forgot password?")')],
      expectVisible: '[data-testid="button-reset"]',
    }),
    bare({
      id: "profile-complete",
      title:
        "/profile/complete: a student with no completed profile (the onboarding persona)",
      persona: "onboarding",
      route: "/profile/complete",
      ready: '[data-testid="button-complete-profile"]',
    }),
    bare({
      id: "update-password",
      title:
        "/update-password: the form a recovery-granted student sees (the page reads no grant; the server's POST does)",
      persona: "paid",
      route: "/update-password",
      ready: '[data-testid="input-new-password"]',
    }),
    bare({
      id: "update-password-refused",
      title:
        "/update-password, submitted with no recovery grant: the page after the refusal. FINDING (unchanged, pre-existing): no message shows, because RequireRole swaps the page for its loader while the request runs (authLoading) and the remounted form has lost its error",
      persona: "paid",
      route: "/update-password",
      ready: '[data-testid="input-new-password"]',
      steps: [
        fill('[data-testid="input-new-password"]', "Harness-pass-59"),
        fill('[data-testid="input-confirm-password"]', "Harness-pass-59"),
        click('[data-testid="button-update-password"]'),
      ],
      // The form back on screen after the request (the loader replaced it while it ran).
      expectVisible: '[data-testid="input-new-password"]',
      expectGone: '[data-testid="full-page-loader"]',
    }),
    bare({
      id: "account-recover-invalid",
      title:
        "/account/recover?token=… a token the real recovery route does not know: invalid or expired",
      persona: "signed-out",
      route: "/account/recover?token=student-harness-unknown-token",
      ready: '[data-state="invalid"]',
    }),
    bare({
      id: "guardian-required",
      title:
        "/guardian-required: an under-13 student with no guardian link (link-code panel, guardians panel, sign out)",
      persona: "under13",
      route: "/guardian-required",
      ready: '[data-testid="guardian-required"]',
    }),
    bare({
      id: "not-found",
      title:
        "404 (/no-such-page), signed in: the shipped heading and the way home",
      persona: "paid",
      route: "/no-such-page",
      ready: '[data-testid="not-found-home"]',
    }),
    {
      id: "not-found-home",
      title: "Click path: 404 → Back to dashboard lands on /dashboard",
      persona: "paid",
      route: "/no-such-page",
      waitFor: {
        desktop: '[data-testid="not-found-home"]',
        mobile: '[data-testid="not-found-home"]',
      },
      steps: [click('[data-testid="not-found-home"]')],
      expectPath: "^/dashboard$",
      prototype: { kind: "none", reason: NOT_PROTOTYPED },
    },
    bare({
      id: "pending-deletion",
      title:
        "The pending-deletion screen: a student on whom the real request_account_deletion has run, opening /dashboard",
      persona: "deleting",
      route: "/dashboard",
      ready: '[data-testid="pending-deletion"]',
    }),
    bare({
      id: "error-screen",
      title:
        "The error screen: /update-password whose code chunk fails to load (App's ErrorBoundary)",
      persona: "paid",
      route: "/update-password",
      ready: '[data-testid="error-screen"]',
      failRequest: {
        pathPattern: "^/assets/update-password-[^/]+\\.js$",
        reason:
          "The page's lazy code chunk fails to load, as it does in production when the network drops or a deploy replaces the chunk; React.lazy throws into App's ErrorBoundary.",
      },
    }),
  ],
};
