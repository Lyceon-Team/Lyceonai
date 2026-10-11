import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";
import { logger } from "../logger.js";
import { sanitizeReturnPath } from "../../packages/shared/src/return-path";
import {
  requireSupabaseAuth,
  getSupabaseAdmin,
} from "../middleware/supabase-auth.js";
import { doubleCsrfProtection } from "../middleware/csrf-double-submit.js";
import { clearAuthCookies } from "../lib/auth-cookies.js";
import { createSupabaseServerClient } from "../lib/supabase-ssr.js";
import { z } from "zod";
import {
  changePasswordRequestSchema,
  passwordSchema,
  resetPasswordRequestSchema,
  updatePasswordRequestSchema,
  type PasswordChangeErrorCode,
} from "../../packages/shared/src/password-policy";
import {
  changePasswordWithCurrent,
  consumePasswordRecovery,
  decidePasswordResetSend,
  hasLivePasswordRecovery,
  holdPasswordResetResponse,
  hasPasswordIdentity,
  revokeOtherSessionsAfterRecovery,
} from "../lib/password-credentials.js";
import { isAdminRoleRequest } from "../lib/auth-role.js";
import { parseSignupRoleIntent } from "../../packages/shared/src/auth-entry";
import { LEGAL_DOCS, type ConsentSource } from "../../shared/legal-consent.js";
import { captureLegalAcceptances } from "../lib/legal-acceptance.js";
import { resolveLegalVersion } from "../lib/legal-registry.js";
import { recordSignupSource } from "../lib/analytics/signup-source.js";
import { emitEvent } from "../lib/analytics/emit-event.js";
import type { ResolvedLegalVersion } from "../lib/legal-registry-types.js";

const router = Router();

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many authentication attempts. Please try again later.",
  },
});

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

// @spec [Coding Standards §7.2] the password rule is the shared policy — the same constant the
// signup form and the set-new-password page render. Never a local `.min(n)` that can drift.
const signupSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(120).optional(),
  // SCL-222 (owner ruling 2026-10-09): the sign-in notice under the buttons replaces the Terms
  // checkbox, and acceptance is recorded at account creation — here, on every successful signup.
  // The field is optional: it only labels the row's consent source, never decides whether one is
  // written. Older clients that still send the two `true` flags are accepted unchanged.
  legalConsent: z
    .object({
      studentTermsAccepted: z.literal(true).optional(),
      privacyPolicyAccepted: z.literal(true).optional(),
      consentSource: z
        .enum([
          "email_signup_form",
          "google_continue_pre_oauth",
          "google_continue_click",
        ])
        .optional(),
    })
    .optional(),
  role: z.unknown().optional(),
  // SCL-201 IS 6: the first-touch channel the browser derived in memory. Parsed by
  // recordSignupSource, never here — a bad value is dropped, it never refuses a signup.
  signupSource: z.unknown().optional(),
  // Owner brief 2026-10-10 (follow-up to #1188): the page the visitor signed up FROM (e.g.
  // `/upgrade?promo=…`). Re-sanitised below with the one return-path allowlist; an unsafe or
  // unknown value is dropped, never a refusal.
  next: z.unknown().optional(),
});

/**
 * Every coded password refusal has one shape, `{ error: { code, message } }` (Coding Standards
 * §8.2), so the Settings form can show the server's message for a known code (Brief 8 ruling 4).
 */
function sendPasswordRefusal(
  res: Response,
  status: number,
  code: PasswordChangeErrorCode,
  message: string,
): Response {
  return res.status(status).json({ error: { code, message } });
}

// Helper to detect when we're running in a CI/test environment with the
// placeholder Supabase host. In this situation we must avoid making any
// network requests because DNS lookups for test-placeholder.supabase.co will
// fail. The auth-rate-limit test only cares about repeated 401 responses and
// eventual 429 from the rate limiter, so returning a deterministic 401 here
// is sufficient.
function runningAgainstPlaceholder(): boolean {
  return (
    process.env.VITEST === "true" ||
    process.env.NODE_ENV === "test" ||
    supabaseUrl.includes("test-placeholder")
  );
}

/**
 * POST /api/auth/signup
 * @spec [contracts/auth-standard-flow.contract.md AS-1, AS1-OUTBOX-DROP-001 |
 *   contracts/auth-login-e2e.contract.md AL-2/AL-3 | Doc-01_V8 §9 | Coding Standards §6.1 | G7/G8]
 * @implemented [2026-06-20]
 * plain English: sign up with email + password, minting the session on the per-request @supabase/ssr
 * server client (G7/G8 — one session mechanism for both entry points). Under autoconfirm signUp returns
 * a session and the setAll adapter writes the native cookie eagerly → 201; on both-store consent failure
 * the eager cookie is cleared via signOut BEFORE the 503 (AS1-OUTBOX-DROP-001 — consent is a precondition,
 * never silently dropped); under confirm-email-ON no session exists so signOut is a no-op → 202. The
 * handle_new_user trigger owns profile creation; this handler never writes profiles.
 */
router.post(
  "/signup",
  authRateLimiter,
  doubleCsrfProtection,
  async (req: Request, res: Response) => {
    try {
      const requestedRole = (req.body as { role?: unknown } | undefined)?.role;

      // Signup must never create admins.
      if (isAdminRoleRequest(requestedRole)) {
        logger.warn(
          "AUTH",
          "admin_signup_blocked",
          "Blocked admin role request during signup",
          // @spec [Coding Standards §12.1; Doc 01A §14; register F-10, OQ-14 ruling 2026-09-29] |
          // @implemented [2026-09-29] | plain English: the submitted email never reaches the logger;
          // the event and its requestId are enough to trace a blocked admin-role signup.
          { requestId: req.requestId },
        );
        return res.status(403).json({
          error: "Admin signup is disabled",
        });
      }

      const validation = signupSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error:
            validation.error.errors[0]?.message || "Invalid signup payload",
        });
      }

      const { email, password, displayName, legalConsent } = validation.data;
      // @spec [owner brief "Entry-aware sign-in / sign-up" (Karl, 2026-10-10) rule 2] |
      // @implemented [2026-10-10] | plain English: a sign-up that came through "I'm a parent or
      // guardian" names `role: "guardian"`, and the account is created as a guardian (the
      // handle_new_user trigger reads this metadata and maps anything but 'guardian' to
      // 'student'). Before, every sign-up was created as a student and the guardian choice
      // depended on onboarding still seeing `next=/guardian`, which an email-confirmation link
      // does not carry. Both roles are self-assignable (server/lib/role-choice.ts), so this grants
      // nothing the onboarding form does not; admin was refused above. Unknown → student.
      const signupRole =
        parseSignupRoleIntent(validation.data.role) === "guardian"
          ? "guardian"
          : "student";
      const consentSource: ConsentSource =
        legalConsent?.consentSource ?? "email_signup_form";

      // In test env we skip making real Supabase calls; behave like signup
      // failed so that downstream logic doesn't try to set cookies.
      if (runningAgainstPlaceholder()) {
        return res
          .status(400)
          .json({ error: "Email and password are required" });
      }

      // G7/G8: mint the signup session on the per-request @supabase/ssr server client — exactly like
      // sign-in. Under autoconfirm signUp returns a session and the setAll adapter writes the native
      // sb-<ref>-auth-token cookie automatically; under confirm-email-ON it returns no session (202).
      // One session mechanism for both entry points — no ad-hoc anon client, no manual persistSession.
      const supabase = createSupabaseServerClient(req, res);

      // AL-3: when email confirmation is enabled, the confirmation link must land on our native
      // callback (/auth/callback), which completes it via verifyOtp/exchangeCodeForSession and
      // establishes the SAME @supabase/ssr session as every other entry method — no custom token
      // handling. Omitted (not set to undefined) when PUBLIC_SITE_URL is absent.
      const siteUrl = (process.env.PUBLIC_SITE_URL || "").replace(/\/$/, "");
      // THE RETURN LINK RIDES THE CONFIRMATION LINK (owner brief 2026-10-10). Without it a
      // visitor who signed up by email from `/upgrade?promo=…` confirmed and landed on the
      // default page: the link was dropped here. `sanitizeReturnPath` is the same allowlist
      // the callback re-applies (`parseSafeNext`), and the shape is the one password recovery
      // already sends (`/auth/callback?next=…`), so the redirect allowlist already admits it.
      const signupNext = sanitizeReturnPath(validation.data.next);
      const emailRedirectTo = siteUrl
        ? `${siteUrl}/auth/callback${
            signupNext ? `?next=${encodeURIComponent(signupNext)}` : ""
          }`
        : null;

      // Sign up user with Supabase Auth
      const { data: authData, error: signupError } = await supabase.auth.signUp(
        {
          email,
          password,
          options: {
            ...(emailRedirectTo ? { emailRedirectTo } : {}),
            data: {
              display_name: displayName || email.split("@")[0],
              // The sign-up's role intent (above): guardian or student. Onboarding can still
              // change it once, before completion (decideRoleChoice).
              role: signupRole,
            },
          },
        },
      );

      if (signupError) {
        // Generic, non-enumerable message (G5/AS-3): never reveal whether the email already exists or
        // any provider-specific reason; the real error is logged server-side only.
        logger.warn("AUTH", "signup_failed", "Supabase signup failed", {
          error: signupError.message,
          requestId: req.requestId,
        });
        return res.status(400).json({
          error:
            "We couldn't complete your sign-up. Please check your details and try again.",
        });
      }

      if (!authData.user) {
        return res.status(500).json({
          error: "Failed to create user account",
        });
      }

      // Profile creation is owned solely by the handle_new_user trigger (migration 20260619000000),
      // which inserts exactly one profiles row in the SAME transaction as the auth.users insert with
      // the server-authoritative clamped role. There is nothing to create or "fix up" here — the old
      // profiles.update was a phantom write that could 404/race against the trigger. We only need the
      // admin client for the durable consent capture below.
      const admin = getSupabaseAdmin();

      await recordSignupSource(
        authData.user.id,
        validation.data.signupSource,
        req.requestId,
      );

      // AS-1: durable + non-throwing. A SINGLE-store failure keeps the signup (outbox absorbs it).
      // Only when consent can't be captured ANYWHERE (both stores down) do we fail closed — consent is
      // a precondition, never silently dropped (AS1-OUTBOX-DROP-001). signUp on the SSR client already
      // wrote the session cookie eagerly, so the fail-closed branch below signs out to clear it: no
      // session may survive a consent-capture failure.
      // FAIL OPEN, BOTH WAYS. Owner ruling 2026-09-16: never refuse the user.
      //
      // A version lookup that fails here used to throw out of the handler and
      // 500 the signup — the same defect that took /api/profile down, one route
      // over. And a capture that could not be made durable used to sign the
      // person out and return 503, so an outbox outage cost us the account.
      //
      // Neither is worth an account. Record the consent when we can stamp it
      // with a real version and hash; otherwise record nothing and let the
      // re-consent prompt catch it at the next hydration. What we will NOT do is
      // write a row we cannot vouch for — a guessed version is a false record,
      // and a false record is worse than a missing one we know how to collect.
      let resolved: {
        studentTerms: ResolvedLegalVersion;
        privacyPolicy: ResolvedLegalVersion;
      } | null = null;
      try {
        resolved = {
          studentTerms: resolveLegalVersion(LEGAL_DOCS.studentTerms.slug),
          privacyPolicy: resolveLegalVersion(LEGAL_DOCS.privacyPolicy.slug),
        };
      } catch (resolveErr: unknown) {
        logger.error(
          "AUTH",
          "legal_resolution_failed",
          "Could not resolve signup documents; completing signup without a consent row. The prompt will ask again.",
          {
            userId: authData.user.id,
            error: resolveErr instanceof Error ? resolveErr.message : "unknown",
            requestId: req.requestId,
          },
        );
      }

      const capture =
        resolved === null
          ? { durable: false as const }
          : await captureLegalAcceptances(admin, {
              userId: authData.user.id,
              consentSource,
              userAgent: req.get("user-agent") ?? null,
              ipAddress: req.ip ?? null,
              acceptances: [
                {
                  docKey: LEGAL_DOCS.studentTerms.docKey,
                  docSlug: resolved.studentTerms.slug,
                  docVersion: resolved.studentTerms.version,
                  contentHash: resolved.studentTerms.contentHash,
                  actorType: "student",
                  minor: false,
                },
                {
                  docKey: LEGAL_DOCS.privacyPolicy.docKey,
                  docSlug: resolved.privacyPolicy.slug,
                  docVersion: resolved.privacyPolicy.version,
                  contentHash: resolved.privacyPolicy.contentHash,
                  actorType: "student",
                  minor: false,
                },
              ],
            });

      if (!capture.durable) {
        // WAS: signOut + 503, under AS1-OUTBOX-DROP-001 ("consent is a
        // precondition for a valid session"). Overruled 2026-09-16. The account
        // stands, the session stands, and the outstanding document is collected
        // by the prompt — which is exactly the mechanism that exists for it.
        // Logged at ERROR because an uncaptured consent is still a defect to
        // chase, just not one the user pays for.
        logger.error(
          "AUTH",
          "consent_capture_failed",
          "Could not durably capture consent during signup; the account stands and the prompt will ask again",
          { userId: authData.user.id, requestId: req.requestId },
        );
      }

      const hasCanonicalSession = !!authData.session;
      // No manual persistSession: signUp on the SSR client already wrote the cookie via the adapter.

      // @spec [Coding Standards §12.1; Doc 01A §14; register F-10, OQ-14 ruling 2026-09-29] | @implemented [2026-09-29] | plain English: no email in this log event; userId (digested by the logger) and requestId are enough to trace it.
      logger.info("AUTH", "signup_success", "User signed up successfully", {
        userId: authData.user.id,
        canonicalSessionEstablished: hasCanonicalSession,
        role: signupRole,
        requestId: req.requestId,
      });

      if (!authData.session) {
        return res.status(202).json({
          success: true,
          outcome: "verification_required",
          message: "Account created. Please verify your email to continue.",
          user: {
            id: authData.user.id,
            email: authData.user.email,
          },
        });
      }

      return res.status(201).json({
        success: true,
        outcome: "authenticated",
        message: "Account created successfully",
        nextPath: "/profile/complete",
        user: {
          id: authData.user.id,
          email: authData.user.email,
        },
        // SECURITY: Session tokens are stored in HTTP-only cookies, not returned in response
      });
    } catch (error) {
      logger.error("AUTH", "signup_error", "Signup endpoint error", error);
      res.status(500).json({ error: "Failed to create account" });
    }
  },
);

/**
 * POST /api/auth/signin
 * Sign in with email and password
 */
router.post(
  "/signin",
  authRateLimiter,
  doubleCsrfProtection,
  async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          error: "Email and password are required",
        });
      }

      // In CI/test with placeholder Supabase URL we can't reach the host. Return
      // the same 401 shape the normal handler would, but let rate limiter still
      // track the request. This keeps the auth-rate-limit.ci.test.ts happy.
      if (runningAgainstPlaceholder()) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // G7 / AL-2: mint the session on the per-request @supabase/ssr server client so the cookie
      // (sb-<ref>-auth-token) is written natively by the setAll adapter during signInWithPassword —
      // one session mechanism, no ad-hoc anon createClient + manual setSession hand-off.
      const supabase = createSupabaseServerClient(req, res);

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // @spec [Coding Standards §12.1; Doc 01A §14; register F-10, OQ-14 ruling 2026-09-29] | @implemented [2026-09-29] | plain English: no email in this log event; requestId is enough to trace it.
        logger.warn("AUTH", "signin_failed", "Sign in failed", {
          error: error.message,
          requestId: req.requestId,
        });
        return res.status(401).json({
          error: "Invalid email or password",
        });
      }

      if (!data.session) {
        return res.status(500).json({
          error: "Failed to create session",
        });
      }

      // @spec [Coding Standards §12.1; Doc 01A §14; register F-10, OQ-14 ruling 2026-09-29] | @implemented [2026-09-29] | plain English: no email in this log event; userId (digested by the logger) and requestId are enough to trace it.
      logger.info("AUTH", "signin_success", "User signed in successfully", {
        userId: data.user.id,
        requestId: req.requestId,
      });

      // Doc 07A §6.2 user_signed_in, after credential verification. The wrapper refuses an
      // under-13 or age-unknown account and any account that has not completed onboarding
      // (its first event is user_signed_up, at completion).
      await emitEvent(data.user.id, "user_signed_in", {});

      res.json({
        success: true,
        message: "Signed in successfully",
        user: {
          id: data.user.id,
          email: data.user.email,
        },
      });
    } catch (error) {
      logger.error("AUTH", "signin_error", "Sign in endpoint error", error);
      res.status(500).json({ error: "Failed to sign in" });
    }
  },
);

/**
 * POST /api/auth/signout
 * Sign out current user (no auth required - just clears cookies)
 */
router.post(
  "/signout",
  doubleCsrfProtection,
  async (req: Request, res: Response) => {
    try {
      // Clear the native @supabase/ssr session cookie via the cookie adapter...
      const ssrClient = createSupabaseServerClient(req, res);
      await ssrClient.auth.signOut({ scope: "local" }).catch(() => {
        // Best-effort: cookie clearing below is the source of truth for the response.
      });

      // ...and also clear any legacy sb-access-token / sb-refresh-token cookies (older sessions).
      const isProd = process.env.NODE_ENV === "production";
      clearAuthCookies(res, isProd);
      logger.info("AUTH", "signout_success", "User signed out", {
        userId: req.user?.id || null,
      });

      // Doc 07A §6.2 user_signed_out. Only an explicit sign-out reaches this route; expiry and
      // security logouts are never observed here, so `explicit` is the only value emitted.
      if (req.user?.id) {
        await emitEvent(req.user.id, "user_signed_out", {
          signout_trigger: "explicit",
        });
      }

      res.json({
        success: true,
        message: "Signed out successfully",
      });
    } catch (error) {
      logger.error("AUTH", "signout_error", "Sign out endpoint error", error);
      res.status(500).json({ error: "Failed to sign out" });
    }
  },
);

/**
 * POST /api/auth/refresh - REMOVED (AUTH-001)
 *
 * @spec [Doc-01_V8 Identity/Access; Coding Standards §6.1 | AUTH-001]
 * @implemented 2026-06-15
 * The custom refresh endpoint is gone. Session refresh is now native: the @supabase/ssr
 * `createServerClient` cookie adapter (server/lib/supabase-ssr.ts) auto-refreshes the session
 * during `supabaseAuthMiddleware`'s `getUser()` call and writes the rotated tokens straight back
 * to the response cookies. There is no longer a client-callable refresh path, which removes a
 * CSRF-bound mutation surface. Any POST to /api/auth/refresh now falls through to 404.
 */

/**
 * POST /api/auth/reset-password
 * Send password reset email
 *
 * @spec [Doc 01 §12.1 step 2; Brief 12 ruling 1 (owner, 2026-10-02); register F-46]
 * | @implemented [2026-10-02]
 * plain English: throttled per account on the RateLimitLedger (`password_reset_requests_hourly`,
 * 3 per hour), not by the old in-memory per-IP limiter, which counted per server instance and so
 * held nothing on serverless. Over the limit, no email is sent and the answer is unchanged, so the
 * limit cannot be used to learn whether an address has an account (AS3-AS5-RESET-ENUM-001).
 */
router.post(
  "/reset-password",
  doubleCsrfProtection,
  async (req: Request, res: Response) => {
    try {
      // F-37 (Brief 8 ruling 4): the body is parsed, not read. An unparseable body is a 400 that
      // names the rule and never echoes the address.
      const parsed = resetPasswordRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error:
            parsed.error.errors[0]?.message ?? "Enter a valid email address",
        });
      }
      const { email } = parsed.data;

      if (runningAgainstPlaceholder()) return res.json({ success: true });

      // Trusted origin only — never the request Host header (a spoofed Host would phish the recovery
      // redirect / Host-header injection). Missing config is a hard 500.
      const siteUrl = (process.env.PUBLIC_SITE_URL || "").replace(/\/$/, "");
      if (!siteUrl) {
        logger.error(
          "AUTH",
          "reset_password_config",
          "PUBLIC_SITE_URL is missing; cannot build a trusted recovery redirect",
          { requestId: req.requestId },
        );
        return res.status(500).json({ error: "Failed to send reset email" });
      }

      // AS-5 (G6): native password reset. Supabase sends the recovery email (PKCE token-hash template)
      // and we hand it our trusted callback as the redirect — the SERVER completes
      // verifyOtp(type=recovery) at /auth/callback, establishes the SSR session, then routes to the
      // safe-listed /update-password page. No admin.generateLink, no app-built email/template.
      // F-46: the per-account ledger decides whether to mail. Every branch below ends in the same
      // generic 200, held to the same minimum duration, so neither the limit nor an unknown address
      // is visible to the caller in the body or in the time it takes (SCL-197).
      const startedAt = Date.now();
      const decision = await decidePasswordResetSend(email, req.requestId);
      if (decision === "send") {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent("/update-password")}`,
        });

        // Non-enumeration (AS3-AS5-RESET-ENUM-001): identical generic response whether or not the
        // email maps to an account; any provider error is logged server-side ONLY, never returned.
        if (error) {
          logger.warn(
            "AUTH",
            "reset_password_provider_error",
            "resetPasswordForEmail failed; returning generic response (anti-enumeration)",
            { requestId: req.requestId, error: error.message },
          );
        }
      }

      await holdPasswordResetResponse(startedAt);
      res.json({
        success: true,
        message:
          "If an account exists for that email, we've sent password reset instructions.",
      });
    } catch (error: unknown) {
      logger.error(
        "AUTH",
        "reset_password_exception",
        "Failed to send reset email",
        error,
      );
      res.status(500).json({ error: "Failed to send reset email" });
    }
  },
);

/**
 * POST /api/auth/update-password
 * Update password (requires authentication)
 */
router.post(
  "/update-password",
  requireSupabaseAuth,
  doubleCsrfProtection,
  async (req: Request, res: Response) => {
    try {
      // @spec [Coding Standards §7.1, §7.2] boundary parse against the SHARED password policy —
      // the same rules the set-new-password page renders. A password the page would refuse is
      // refused here too (the server is the enforcement; the page is the courtesy). The 400 body
      // names the unmet rule, never the password.
      const parsed = updatePasswordRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error:
            parsed.error.errors[0]?.message ??
            "Password does not meet the requirements",
        });
      }
      const { password } = parsed.data;

      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      // Brief 8 ruling 4 (owner choice 2026-10-01): this path sets a password WITHOUT the current
      // one, so it is open only to a session that has just completed a recovery link. The grant is
      // written by /auth/callback after verifyOtp(type = recovery); an ordinary session has none and
      // is sent to Settings, where the current password is required.
      if (!(await hasLivePasswordRecovery(userId))) {
        logger.warn(
          "AUTH",
          "update_password_no_recovery",
          "update-password refused: no live recovery grant",
          { requestId: req.requestId },
        );
        return sendPasswordRefusal(
          res,
          403,
          "RECOVERY_REQUIRED",
          "To change your password, use Settings. If you've forgotten it, request a reset email.",
        );
      }
      // F-38: a Google-only account has no password; a recovery link must not quietly add one.
      if (!(await hasPasswordIdentity(userId))) {
        return sendPasswordRefusal(
          res,
          409,
          "NO_PASSWORD_IDENTITY",
          "This account signs in with Google, so it has no password to change.",
        );
      }

      if (runningAgainstPlaceholder()) {
        await consumePasswordRecovery(userId, req.requestId);
        return res.json({ success: true });
      }

      // AS-5/AS-6 (G6/G9): the recovery (or normal) session lives in the httpOnly @supabase/ssr
      // cookie. Update the password natively on the per-request server client — Supabase's updateUser
      // acts on the cookie-held session user. Documented adaptation: updateUser runs server-side
      // because our session is server-authoritative (httpOnly cookie), NOT a custom reimplementation.
      // No admin.updateUserById, no manual token resolution.
      const supabase = createSupabaseServerClient(req, res);
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        logger.warn(
          "AUTH",
          "update_password_error",
          "Supabase update password failed",
          { error: error.message, requestId: req.requestId },
        );
        return res.status(400).json({ error: "Failed to update password" });
      }

      // Single use: spent only once the password is set, so a provider refusal above does not
      // send the student back to their inbox.
      await consumePasswordRecovery(userId, req.requestId);
      // F-46 / Doc 01 §12.1 step 6: every OTHER session is signed out; this recovery session is
      // kept. Best-effort, like F-32: a failed revoke is logged and the update still stands.
      await revokeOtherSessionsAfterRecovery(supabase, req.requestId);
      res.json({ success: true, message: "Password updated successfully" });
    } catch (error: unknown) {
      logger.error(
        "AUTH",
        "update_password_exception",
        "Failed to update password",
        error,
      );
      res.status(500).json({ error: "Failed to update password" });
    }
  },
);

/**
 * POST /exchange-session - DEPRECATED & REMOVED

 * 
 * This endpoint has been deprecated in favor of server-only httpOnly cookie auth.
 * It is permanently removed and will return 404.
 * 
 * Historical context: This endpoint exchanged external tokens for httpOnly cookies,
 * but is no longer needed with the current auth architecture.
 * 
 * CI hardening: Tests must verify this endpoint returns 404 (not 400/401/403/500).
 */
// REMOVED: exchange-session endpoint - see comment above for rationale

/**
 * POST /api/auth/change-password — Settings: change a password you know.
 *
 * @spec [Brief 8 ruling 4 (owner, 2026-10-01); F-38; Coding Standards §8.1, §12.1]
 * | @implemented [2026-10-01]
 *
 * plain English: requires the current password, checked on the server by signing in with it
 * (`changePasswordWithCurrent`), and refuses a Google-only account with `NO_PASSWORD_IDENTITY`.
 * Supabase's "Secure password change" only reauthenticates sessions older than 24 hours, so this
 * check is what stops a borrowed, recently-opened session from changing the password.
 * Rate-limited like reset and sign-in, so the current password cannot be guessed here faster than
 * at the sign-in form. The student's own session is untouched.
 */
router.post(
  "/change-password",
  authRateLimiter,
  requireSupabaseAuth,
  doubleCsrfProtection,
  async (req: Request, res: Response) => {
    try {
      const parsed = changePasswordRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error:
            parsed.error.errors[0]?.message ??
            "Password does not meet the requirements",
        });
      }
      const { current_password, new_password } = parsed.data;

      const user = req.user;
      if (!user?.id || !user.email) {
        return res.status(401).json({ error: "Authentication required" });
      }

      if (!(await hasPasswordIdentity(user.id))) {
        return sendPasswordRefusal(
          res,
          409,
          "NO_PASSWORD_IDENTITY",
          "This account signs in with Google, so it has no password to change.",
        );
      }
      if (current_password === new_password) {
        return sendPasswordRefusal(
          res,
          400,
          "PASSWORD_UNCHANGED",
          "Choose a new password that is different from your current one.",
        );
      }

      const result = await changePasswordWithCurrent({
        email: user.email,
        currentPassword: current_password,
        newPassword: new_password,
        requestId: req.requestId,
      });
      if (!result.ok) {
        if (result.error.kind === "current_incorrect") {
          return sendPasswordRefusal(
            res,
            400,
            "CURRENT_PASSWORD_INCORRECT",
            "Your current password is incorrect.",
          );
        }
        return res.status(500).json({ error: "Failed to update password" });
      }

      logger.info(
        "AUTH",
        "change_password_ok",
        "Password changed from Settings",
        {
          requestId: req.requestId,
        },
      );
      return res.json({
        success: true,
        message: "Password updated successfully",
      });
    } catch (error: unknown) {
      logger.error(
        "AUTH",
        "change_password_exception",
        "Failed to change password",
        {
          requestId: req.requestId,
          reason: error instanceof Error ? error.message : "unknown",
        },
      );
      return res.status(500).json({ error: "Failed to update password" });
    }
  },
);

export default router;
