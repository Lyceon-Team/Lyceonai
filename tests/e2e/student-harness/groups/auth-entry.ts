/**
 * Entry-aware sign-in / sign-up: the auth page in each mode a link can open it in.
 *
 * @spec [owner brief "Entry-aware sign-in / sign-up" (Karl, 2026-10-10) rules 1, 3, 4;
 *        "Screenshots: each mode, light and dark, 1440 and 390"] | @implemented [2026-10-10]
 *
 * plain English: /login opened by each homepage link's real URL (the values
 * client/src/lib/marketing-links.ts builds), signed out, through the real client build: Sign In,
 * Sign Up, Sign Up as a parent or guardian, a failed email sign-in with "No account yet? Create
 * one", and that link pressed (Sign Up with the typed email kept). Then the diagnostic CTA's
 * landing: a free student with no diagnostic opening /practice/diagnostic lands in the diagnostic
 * runner, proven by its pathname. Not prototyped: the bare card is built to DESIGN.md §2.
 *
 * What the harness cannot reach: the harness mounts no `/api/auth` routes (they call Supabase),
 * so the failed sign-in's `POST /api/auth/signin` is answered in the browser with the real
 * route's 401 and body ("Invalid email or password"), and the index says so.
 */
import type { PageGroup, Shot } from "./types";

const NOT_PROTOTYPED =
  "NOT PROTOTYPED (DESIGN.md §4): the auth page is a bare card built to the shell spec (§2 Bare card).";

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

const FAILED_SIGNIN = {
  method: "POST",
  path: "/api/auth/signin",
  status: 401,
  body: { error: "Invalid email or password" },
  reason:
    "The harness mounts no /api/auth routes (they call Supabase); this is the real sign-in route's 401 and body for a wrong email or password.",
} as const;

const FAILED_SIGNIN_STEPS = [
  fill('[data-testid="input-signin-email"]', "typed@example.test"),
  fill('[data-testid="input-signin-password"]', "not-the-password-1"),
  click('[data-testid="button-signin"]'),
];

export const AUTH_ENTRY: PageGroup = {
  id: "AUTH-ENTRY",
  title:
    "Entry-aware sign-in / sign-up (Karl, 2026-10-10): Sign In, Sign Up, Sign Up as a guardian, a failed sign-in with Create one, Create one pressed, and the diagnostic landing; light and dark, 1440 and 390",
  seed: "bare-pages",
  shots: [
    bare({
      id: "entry-signin",
      title:
        '/login?mode=signin ("Sign in" anywhere): the Sign In tab, "Welcome back"',
      persona: "signed-out",
      route: "/login?mode=signin",
      ready: '[data-testid="button-signin"]',
    }),
    bare({
      id: "entry-signup",
      title:
        '/login?mode=signup ("Sign up", "Get started"): the Sign Up tab, "Create your Lyceon account"',
      persona: "signed-out",
      route: "/login?mode=signup",
      ready: '[data-testid="button-signup"]',
    }),
    bare({
      id: "entry-diagnostic",
      title:
        '/login?mode=signup&next=/practice/diagnostic ("Start the free diagnostic"): the Sign Up tab',
      persona: "signed-out",
      route: "/login?mode=signup&next=%2Fpractice%2Fdiagnostic",
      ready: '[data-testid="button-signup"]',
    }),
    bare({
      id: "entry-guardian",
      title:
        '/login?mode=signup&role=guardian&next=/guardian ("I\'m a parent or guardian"): Sign Up with the guardian line and "I\'m a student"',
      persona: "signed-out",
      route: "/login?mode=signup&role=guardian&next=%2Fguardian",
      ready: '[data-testid="signup-role-guardian"]',
    }),
    bare({
      id: "entry-signin-failed",
      title:
        '/login?mode=signin after a failed email sign-in: the generic error and "No account yet? Create one"',
      persona: "signed-out",
      route: "/login?mode=signin",
      ready: '[data-testid="button-signin"]',
      fulfillRequest: FAILED_SIGNIN,
      steps: FAILED_SIGNIN_STEPS,
      expectVisible: '[data-testid="signin-create-account"]',
    }),
    bare({
      id: "entry-create-one",
      title: '"Create one" pressed: the Sign Up tab with the typed email kept',
      persona: "signed-out",
      route: "/login?mode=signin",
      ready: '[data-testid="button-signin"]',
      fulfillRequest: FAILED_SIGNIN,
      steps: [
        ...FAILED_SIGNIN_STEPS,
        click('[data-testid="button-create-account"]'),
      ],
      expectVisible: '[data-testid="button-signup"]',
    }),
    {
      id: "diagnostic-landing",
      title:
        '/practice/diagnostic (where "Start the free diagnostic" returns after sign-up and onboarding), a free student with no diagnostic: lands in the diagnostic runner',
      persona: "free",
      route: "/practice/diagnostic",
      waitFor: { desktop: "main", mobile: "main" },
      expectPath: "^/practice/session/[0-9a-f-]{36}$",
      prototype: {
        kind: "none",
        reason:
          "A landing: the screenshot is where the page handed over (the diagnostic runner), proven by its pathname.",
      },
    },
  ],
};
