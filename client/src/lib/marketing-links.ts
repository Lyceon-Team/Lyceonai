import {
  DIAGNOSTIC_START_PATH,
  authEntryPath,
} from "@lyceon/shared/auth-entry";

/**
 * Where the public site's calls to action land.
 *
 * @spec [owner rulings 2026-10-05, F13 Step 0 decision 4; SEO Wave 3 decision 5 (the standard
 *       "Start the free diagnostic" CTA)] | @implemented [2026-10-05]
 *
 * plain English: signup is the auth page (/login, on its Sign Up tab since 2026-10-10, below);
 * the return path rides the shared `next` channel, which
 * survives Google sign-in and onboarding. One copy for the homepage and every content page, so
 * the CTAs cannot point at different places.
 *
 * @spec [owner brief "Entry-aware sign-in / sign-up" (Karl, 2026-10-10) rules 1-3, 6] |
 * @implemented [2026-10-10] | plain English: each link now also names the tab it opens on and,
 * for the parent button, the role (`authEntryPath`, the shared allowlist):
 *   - "Sign in" → the Sign In tab; "Sign up" / "Get started" → the Sign Up tab.
 *   - "Start the free diagnostic" → Sign Up, returning to /practice/diagnostic, which starts the
 *     diagnostic (rule 3). It was /dashboard, where the diagnostic card waits (no auto-start).
 *   - "I'm a parent or guardian" → Sign Up with the guardian role, returning to /guardian. The
 *     role is applied when the account is created, by the email form and by Google alike; `next`
 *     still makes Guardian the onboarding default as before (F13).
 *   - The two practice CTAs that are not the diagnostic ("Try … more questions free", "Start
 *     practicing free →") open Sign Up and keep their destination, /dashboard (rule 3).
 * Only the targets changed; every label and style on the SEO-owned pages is untouched (rule 6).
 */
export const SIGN_IN_HREF = authEntryPath({ mode: "signin" });
export const SIGN_UP_HREF = authEntryPath({ mode: "signup" });
export const START_DIAGNOSTIC_HREF = authEntryPath({
  mode: "signup",
  next: DIAGNOSTIC_START_PATH,
});
export const START_PRACTICE_HREF = authEntryPath({
  mode: "signup",
  next: "/dashboard",
});
export const GUARDIAN_SIGNUP_HREF = authEntryPath({
  mode: "signup",
  role: "guardian",
  next: "/guardian",
});
