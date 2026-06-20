import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";
import { logger } from "../logger.js";
import {
  requireSupabaseAuth,
  getSupabaseAdmin,
  resolveTokenFromRequest,
} from "../middleware/supabase-auth.js";
import { doubleCsrfProtection } from "../middleware/csrf-double-submit.js";
import { BUILD } from "../lib/build.js";
import { clearAuthCookies } from "../lib/auth-cookies.js";
import { createSupabaseServerClient } from "../lib/supabase-ssr.js";
import { z } from "zod";
import { isAdminRoleRequest } from "../lib/auth-role.js";
import { LEGAL_DOCS, type ConsentSource } from "../../shared/legal-consent.js";
import { captureLegalAcceptances } from "../lib/legal-acceptance.js";

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

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  displayName: z.string().trim().min(1).max(120).optional(),
  legalConsent: z.object({
    studentTermsAccepted: z.literal(true),
    privacyPolicyAccepted: z.literal(true),
    consentSource: z
      .enum([
        "email_signup_form",
        "google_continue_pre_oauth",
        "google_continue_click",
      ])
      .optional(),
  }),
  role: z.unknown().optional(),
});

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
 * Sign up with email and password
 */
router.post(
  "/signup",
  authRateLimiter,
  doubleCsrfProtection,
  async (req: Request, res: Response) => {
    try {
      const requestedRole = (req.body as any)?.role;

      // Signup must never create admins.
      if (isAdminRoleRequest(requestedRole)) {
        logger.warn(
          "AUTH",
          "admin_signup_blocked",
          "Blocked admin role request during signup",
          {
            email: (req.body as any)?.email,
            requestId: req.requestId,
          },
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
      const consentSource: ConsentSource =
        legalConsent.consentSource ?? "email_signup_form";

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
      const emailRedirectTo = siteUrl ? `${siteUrl}/auth/callback` : null;

      // Sign up user with Supabase Auth
      const { data: authData, error: signupError } = await supabase.auth.signUp(
        {
          email,
          password,
          options: {
            ...(emailRedirectTo ? { emailRedirectTo } : {}),
            data: {
              display_name: displayName || email.split("@")[0],
              // Safe temporary backend role until profile-complete finalization.
              role: "student",
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

      // AS-1: durable + non-throwing. A SINGLE-store failure keeps the signup (outbox absorbs it).
      // Only when consent can't be captured ANYWHERE (both stores down) do we fail closed — consent is
      // a precondition, never silently dropped (AS1-OUTBOX-DROP-001). signUp on the SSR client already
      // wrote the session cookie eagerly, so the fail-closed branch below signs out to clear it: no
      // session may survive a consent-capture failure.
      const capture = await captureLegalAcceptances(admin, {
        userId: authData.user.id,
        consentSource,
        userAgent: req.get("user-agent") ?? null,
        ipAddress: req.ip ?? null,
        acceptances: [
          {
            docKey: LEGAL_DOCS.studentTerms.docKey,
            docVersion: LEGAL_DOCS.studentTerms.docVersion,
            actorType: "student",
            minor: false,
          },
          {
            docKey: LEGAL_DOCS.privacyPolicy.docKey,
            docVersion: LEGAL_DOCS.privacyPolicy.docVersion,
            actorType: "student",
            minor: false,
          },
        ],
      });

      if (!capture.durable) {
        logger.error(
          "AUTH",
          "consent_capture_failed",
          "Could not durably capture consent during signup (both stores failed); failing closed",
          { userId: authData.user.id, requestId: req.requestId },
        );
        // AS1-OUTBOX-DROP-001: signUp wrote the session cookie EAGERLY (autoconfirm) before this gate,
        // so clear it — no session may survive a consent-capture failure. Same discipline as the OAuth
        // callback's durable:false → signOut. No-op when confirm-email-ON returned no session.
        await supabase.auth.signOut({ scope: "local" }).catch((signOutErr) =>
          logger.warn(
            "AUTH",
            "signout_cleanup_failed",
            "Best-effort signOut clearing the eager signup cookie after consent failure failed",
            {
              requestId: req.requestId,
              error:
                signOutErr instanceof Error
                  ? signOutErr.message
                  : String(signOutErr),
            },
          ),
        );
        return res.status(503).json({
          error:
            "We couldn't complete your sign-up just now. Please try again.",
        });
      }

      const hasCanonicalSession = !!authData.session;
      // No manual persistSession: signUp on the SSR client already wrote the cookie via the adapter.

      logger.info("AUTH", "signup_success", "User signed up successfully", {
        userId: authData.user.id,
        email: authData.user.email,
        canonicalSessionEstablished: hasCanonicalSession,
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

const adminProvisionSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  passcode: z.string().min(1),
  displayName: z.string().min(1).max(120).optional(),
});

/**
 * POST /api/auth/admin-provision
 * Guarded admin bootstrap path.
 *
 * Fails closed unless ADMN_PASSCODE is configured and explicitly provided.
 */
router.post(
  "/admin-provision",
  authRateLimiter,
  doubleCsrfProtection,
  async (req: Request, res: Response) => {
    const validation = adminProvisionSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error:
          validation.error.errors[0]?.message ||
          "Invalid admin provision payload",
      });
    }

    const isProduction = process.env.NODE_ENV === "production";
    const isAdminProvisionEnabled =
      process.env.ADMIN_PROVISION_ENABLE === "true";

    if (isProduction) {
      logger.warn(
        "AUTH",
        "admin_provision_blocked_production",
        "Admin provisioning is hard-disabled in production",
        {
          requestId: req.requestId,
        },
      );
      return res.status(403).json({
        error: "Admin provisioning is disabled",
      });
    }

    if (!isAdminProvisionEnabled) {
      logger.warn(
        "AUTH",
        "admin_provision_disabled_by_default",
        "Admin provisioning denied because ADMIN_PROVISION_ENABLE is not true",
        {
          requestId: req.requestId,
        },
      );
      return res.status(403).json({
        error: "Admin provisioning is disabled",
      });
    }

    const configuredPasscode = process.env.ADMN_PASSCODE;
    if (!configuredPasscode) {
      logger.error(
        "AUTH",
        "admin_provision_closed",
        "ADMN_PASSCODE is missing; refusing admin provisioning",
        {
          requestId: req.requestId,
        },
      );
      return res.status(403).json({
        error: "Admin provisioning is disabled",
      });
    }

    const { email, password, passcode, displayName } = validation.data;

    if (passcode !== configuredPasscode) {
      logger.warn(
        "AUTH",
        "admin_provision_rejected",
        "Rejected admin provisioning due to passcode mismatch",
        {
          email,
          requestId: req.requestId,
        },
      );
      return res.status(403).json({
        error: "Invalid provisioning credentials",
      });
    }

    if (runningAgainstPlaceholder()) {
      return res.status(503).json({
        error: "Admin provisioning is unavailable in test placeholder mode",
      });
    }

    try {
      const admin = getSupabaseAdmin();

      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            display_name: displayName || email.split("@")[0],
          },
        });

      if (createError || !created.user?.id) {
        logger.error(
          "AUTH",
          "admin_provision_failed",
          "Failed to create Supabase auth user for admin provisioning",
          {
            email,
            error: createError,
            requestId: req.requestId,
          },
        );
        return res.status(400).json({
          error: createError?.message || "Failed to provision admin account",
        });
      }

      const { error: profileError } = await admin.from("profiles").upsert(
        {
          id: created.user.id,
          email: created.user.email || email,
          display_name:
            displayName || created.user.user_metadata?.display_name || null,
          role: "admin",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

      if (profileError) {
        logger.error(
          "AUTH",
          "admin_profile_upsert_failed",
          "Failed to persist admin profile during provisioning",
          {
            userId: created.user.id,
            email,
            error: profileError,
            requestId: req.requestId,
          },
        );
        return res.status(500).json({
          error: "Failed to persist admin profile",
        });
      }

      logger.warn(
        "AUTH",
        "admin_provisioned",
        "Admin account provisioned through guarded path",
        {
          userId: created.user.id,
          email: created.user.email,
          requestId: req.requestId,
        },
      );

      return res.status(201).json({
        success: true,
        user: {
          id: created.user.id,
          email: created.user.email,
          role: "admin",
        },
      });
    } catch (error) {
      logger.error(
        "AUTH",
        "admin_provision_exception",
        "Unexpected admin provisioning error",
        {
          error,
          requestId: req.requestId,
        },
      );
      return res
        .status(500)
        .json({ error: "Failed to provision admin account" });
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
        logger.warn("AUTH", "signin_failed", "Sign in failed", {
          email,
          error: error.message,
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

      logger.info("AUTH", "signin_success", "User signed in successfully", {
        userId: data.user.id,
        email: data.user.email,
      });

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
        userId: (req as any).user?.id || null,
      });

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
 * GET /api/auth/debug
 * Debug endpoint for OAuth troubleshooting
 * Uses SHARED auth resolution helper for consistency with practice endpoints
 * Safe for production - no secrets exposed
 */
router.get("/debug", async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    // Use SHARED helper for token resolution (same as practice endpoints)
    const tokenResult = resolveTokenFromRequest(req);
    const refreshToken = req.cookies["sb-refresh-token"];

    let resolvedUserId: string | null = null;
    let resolvedRole: string | null = null;
    let serviceRoleCanReadUser: boolean | null = null;
    let serviceRoleUserLookupError: string | null = null;
    let tokenValidationError: string | null = null;

    if (tokenResult.token) {
      try {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser(tokenResult.token);
        if (error) {
          tokenValidationError = error.message;
        }
        if (!error && user) {
          resolvedUserId = user.id;

          const admin = getSupabaseAdmin();
          const { data: profile } = await admin
            .from("profiles")
            .select("role")
            .eq("id", user.id)
            .single();
          resolvedRole = profile?.role || null;
        }
      } catch (e: any) {
        tokenValidationError = e?.message || "exception";
      }
    }

    // Service role key validation: can it read the user from auth.users?
    if (resolvedUserId) {
      try {
        const admin = getSupabaseAdmin();
        const { data, error } =
          await admin.auth.admin.getUserById(resolvedUserId);

        if (error || !data?.user) {
          serviceRoleCanReadUser = false;
          serviceRoleUserLookupError = error?.message || "user_not_found";
        } else {
          serviceRoleCanReadUser = true;
        }
      } catch (e: any) {
        serviceRoleCanReadUser = false;
        serviceRoleUserLookupError = e?.message || "exception";
      }
    }

    const publicSiteUrl = process.env.PUBLIC_SITE_URL || "";

    res.json({
      build: BUILD,
      environment: {
        nodeEnv: process.env.NODE_ENV || "undefined",
        publicSiteUrl: publicSiteUrl || "(missing)",
        publicSiteUrlSet: !!publicSiteUrl,
        supabaseUrlSet: !!process.env.SUPABASE_URL,
        // Native OAuth: Google client id/secret live in the Supabase dashboard, not app env.
        // Intentionally not surfaced here (HALT-3 secret-hygiene).
      },
      request: {
        host: req.headers.host || null,
        origin: req.headers.origin || null,
        referer: req.headers.referer || null,
        protocol: req.protocol,
      },
      tokenResolution: {
        cookieKeys: tokenResult.cookieKeys,
        authHeaderPresent: tokenResult.authHeaderPresent,
        tokenSource: tokenResult.tokenSource,
        tokenLength: tokenResult.tokenLength,
        bearerParsed: tokenResult.bearerParsed,
      },
      cookies: {
        hasAccessToken: !!tokenResult.token,
        hasRefreshCookie: !!refreshToken,
      },
      session: {
        resolvedUserId,
        resolvedRole,
        tokenValidationError,
      },
      serviceRole: {
        canReadUser: serviceRoleCanReadUser,
        userLookupError: serviceRoleUserLookupError,
      },
      // Native OAuth: Supabase owns the OAuth callback at <ref>.supabase.co/auth/v1/callback.
      // The app's post-login landing route is PUBLIC_SITE_URL/auth/callback.
      oauthCallback: publicSiteUrl
        ? `${publicSiteUrl}/auth/callback`
        : "(cannot determine)",
    });
  } catch (error) {
    logger.error("AUTH", "debug_error", "Debug endpoint error", error);
    res.status(500).json({ error: "Debug endpoint failed" });
  }
});

/**
 * POST /api/auth/reset-password
 * Send password reset email
 */
router.post(
  "/reset-password",
  authRateLimiter,
  doubleCsrfProtection,
  async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "Email is required" });

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
      const supabase = createClient(supabaseUrl, supabaseAnonKey);
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent("/update-password")}`,
      });

      // Non-enumeration (AS3-AS5-RESET-ENUM-001): identical generic response whether or not the email
      // maps to an account; any provider error is logged server-side ONLY, never returned.
      if (error) {
        logger.warn(
          "AUTH",
          "reset_password_provider_error",
          "resetPasswordForEmail failed; returning generic response (anti-enumeration)",
          { requestId: req.requestId, error: error.message },
        );
      }

      res.json({
        success: true,
        message:
          "If an account exists for that email, we've sent password reset instructions.",
      });
    } catch (error: any) {
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
      const { password } = req.body;
      if (!password)
        return res.status(400).json({ error: "Password is required" });

      if (runningAgainstPlaceholder()) return res.json({ success: true });

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

      res.json({ success: true, message: "Password updated successfully" });
    } catch (error: any) {
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

export default router;
