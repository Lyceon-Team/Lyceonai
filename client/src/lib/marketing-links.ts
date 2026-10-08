import { loginPathWithReturn } from "@lyceon/shared/return-path";

/**
 * Where the public site's calls to action land.
 *
 * @spec [owner rulings 2026-10-05, F13 Step 0 decision 4; SEO Wave 3 decision 5 (the standard
 *       "Start the free diagnostic" CTA)] | @implemented [2026-10-05]
 *
 * plain English: signup is /login; the return path rides the shared `next` channel, which
 * survives Google sign-in and onboarding. The diagnostic button returns to /dashboard, where the
 * free diagnostic starts (no auto-start). The parent button returns to /guardian, which also makes
 * Guardian the DEFAULT role on the onboarding form (profile-complete.tsx) — a default only; the
 * server validates the chosen role exactly as before. One copy for the homepage and every content
 * page, so the two CTAs cannot point at different places.
 */
export const START_DIAGNOSTIC_HREF = loginPathWithReturn("/dashboard");
export const GUARDIAN_SIGNUP_HREF = loginPathWithReturn("/guardian");
