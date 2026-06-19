/**
 * @spec [Doc-01_V8 Identity/Access; Coding Standards §6.1, §6.2 | OAUTH-001 / AUTH-001]
 * @implemented 2026-06-15
 * plain English: Native Supabase Google OAuth landing route. The browser starts the flow with
 * `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: <PUBLIC_SITE_URL>/auth/callback } })`.
 * Supabase owns the Google OAuth callback at `<ref>.supabase.co/auth/v1/callback`; Google then redirects
 * the browser back here with a PKCE `code`. This handler exchanges that code for a session using an
 * `@supabase/ssr` server client — which reads the PKCE code-verifier cookie set by the browser client and
 * writes the resulting session cookie back through the cookie adapter. There is NO app-held Google client
 * secret and NO direct call to Google's token endpoint (both lived in the removed custom flow).
 *
 * expected outcome: on success the user has a native Supabase session cookie and is redirected to their
 * landing path. trade-offs: the PKCE verifier cookie must be present (set during signInWithOAuth) for the
 * exchange to succeed. edge cases: provider error / missing code / failed exchange all redirect to /login
 * with an error code; never logs tokens, codes, or PII.
 */
import { Router, Request, Response } from "express";
import { logger } from "../logger.js";
import { createSupabaseServerClient } from "../lib/supabase-ssr.js";
import { getSupabaseAdmin } from "../middleware/supabase-auth.js";
import {
  ensureProfileForAuthUser,
  AccountEmailConflictError,
} from "../lib/profile-bootstrap.js";
import { LEGAL_DOCS, type ConsentSource } from "../../shared/legal-consent.js";
import { captureLegalAcceptances } from "../lib/legal-acceptance.js";

const router = Router();

function getSiteUrl(): string {
  return (process.env.PUBLIC_SITE_URL || "").replace(/\/$/, "");
}

function parseConsentSource(req: Request): ConsentSource | null {
  const source = String(req.query.consentSource ?? "").toLowerCase();
  if (source === "google_continue_click") return "google_continue_click";
  if (source === "google_continue_pre_oauth")
    return "google_continue_pre_oauth";
  return null;
}

// AL-3: the native email-confirmation / recovery handoff arrives as `token_hash` + `type` (the OTP
// variant of the same SSR session establishment as the OAuth `code` path). Narrow `type` at the
// boundary to Supabase's EmailOtpType set — never trust the raw query value.
const EMAIL_OTP_TYPES = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
] as const;
type EmailOtpType = (typeof EMAIL_OTP_TYPES)[number];
function isEmailOtpType(value: unknown): value is EmailOtpType {
  return (
    typeof value === "string" &&
    (EMAIL_OTP_TYPES as readonly string[]).includes(value)
  );
}

// AS-5: post-auth `next` is an ALLOWLIST, not a free relative path — closes any open-redirect. The
// only producer is the native password-recovery link (→ the set-new-password page).
const SAFE_NEXT_PATHS = new Set<string>(["/update-password"]);
function parseSafeNext(req: Request): string | null {
  const next = req.query.next;
  return typeof next === "string" && SAFE_NEXT_PATHS.has(next) ? next : null;
}

/**
 * GET /auth/callback?code=...
 * Native Supabase PKCE landing route.
 */
export async function nativeOAuthCallbackHandler(req: Request, res: Response) {
  const siteUrl = getSiteUrl();

  if (!siteUrl) {
    logger.error("OAUTH", "config_missing", "PUBLIC_SITE_URL is missing");
    return res
      .status(500)
      .send("Server configuration error: PUBLIC_SITE_URL is missing");
  }

  const { code, token_hash: tokenHash, type, error: providerError } = req.query;
  const safeNext = parseSafeNext(req);

  if (providerError) {
    logger.warn("OAUTH", "provider_error", "OAuth provider returned an error", {
      error: providerError,
    });
    return res.redirect(`${siteUrl}/login?error=google_oauth_failed`);
  }

  const hasCode = typeof code === "string" && code.length > 0;
  // AL-3: the native email-confirmation / recovery handoff arrives as token_hash + type. Narrowed
  // here at the boundary so the verifyOtp params are typed without casts.
  const otp =
    typeof tokenHash === "string" &&
    tokenHash.length > 0 &&
    isEmailOtpType(type)
      ? { token_hash: tokenHash, type }
      : null;

  if (!hasCode && otp === null) {
    logger.warn(
      "OAUTH",
      "no_credential",
      "No authorization code or email-confirmation token on callback",
    );
    return res.redirect(`${siteUrl}/login?error=google_oauth_failed`);
  }

  try {
    // The SSR server client writes the native session cookie back through the cookie adapter on
    // success. PKCE OAuth uses exchangeCodeForSession (reads the code-verifier cookie); the native
    // email-confirmation / recovery handoff uses verifyOtp(token_hash,type). Both yield the SAME
    // @supabase/ssr session — one session model, no custom token parsing.
    const supabase = createSupabaseServerClient(req, res);
    const result =
      otp !== null
        ? await supabase.auth.verifyOtp(otp)
        : typeof code === "string"
          ? await supabase.auth.exchangeCodeForSession(code)
          : null;

    if (
      result === null ||
      result.error ||
      !result.data.session ||
      !result.data.user
    ) {
      logger.error(
        "OAUTH",
        "exchange_failed",
        "Failed to establish a session from the callback",
        { error: result?.error?.message },
      );
      return res.redirect(`${siteUrl}/login?error=supabase_exchange`);
    }

    const user = result.data.user;

    let redirectPath: string;
    try {
      const admin = getSupabaseAdmin();
      const profile = await ensureProfileForAuthUser(admin, user, {
        source: "google_oauth_callback",
        requestId: req.requestId,
      });

      const consentSource = parseConsentSource(req);
      if (consentSource) {
        const minor = !!profile.is_under_13;
        // AS-1: durable + non-throwing. A SINGLE-store recording failure keeps the session (the
        // outbox absorbs it, drained later). Only when consent can't be captured ANYWHERE (both the
        // direct write AND the durable outbox fail — a rare infra outage) do we fail closed: consent
        // is a precondition for a valid session, so we sign out and surface a recoverable error
        // rather than silently dropping it (AS1-OUTBOX-DROP-001).
        const capture = await captureLegalAcceptances(admin, {
          userId: user.id,
          consentSource,
          userAgent: req.get("user-agent") ?? null,
          ipAddress: req.ip ?? null,
          acceptances: [
            {
              docKey: LEGAL_DOCS.studentTerms.docKey,
              docVersion: LEGAL_DOCS.studentTerms.docVersion,
              actorType: "student",
              minor,
            },
            {
              docKey: LEGAL_DOCS.privacyPolicy.docKey,
              docVersion: LEGAL_DOCS.privacyPolicy.docVersion,
              actorType: "student",
              minor,
            },
          ],
        });

        if (!capture.durable) {
          logger.error(
            "OAUTH",
            "consent_capture_failed",
            "Could not durably capture consent (both stores failed); failing closed",
            { userId: user.id, requestId: req.requestId },
          );
          await supabase.auth.signOut({ scope: "local" }).catch((signOutErr) =>
            logger.warn(
              "OAUTH",
              "signout_cleanup_failed",
              "Best-effort signOut after consent-capture failure failed",
              {
                requestId: req.requestId,
                error:
                  signOutErr instanceof Error
                    ? signOutErr.message
                    : String(signOutErr),
              },
            ),
          );
          return res.redirect(`${siteUrl}/login?error=consent_capture_failed`);
        }
      }

      const profileNeedsCompletion =
        !profile.profile_completed_at ||
        (profile.is_under_13 && !profile.guardian_consent);

      if (profileNeedsCompletion) {
        redirectPath = "/profile/complete";
      } else if (safeNext) {
        // AS-5: password-recovery (and any future allow-listed handoff) routes here AFTER the
        // onboarding gate — e.g. recovery → /update-password to set a new password.
        redirectPath = safeNext;
      } else if (profile.role === "guardian") {
        redirectPath = "/guardian";
      } else {
        redirectPath = "/dashboard";
      }
    } catch (finalizeErr) {
      // AL-7 (profile-per-human): same email already owned by another identity (a second provider
      // not merged by Supabase identity-linking). Deliberate conflict — do not fork the human.
      if (finalizeErr instanceof AccountEmailConflictError) {
        logger.warn(
          "OAUTH",
          "account_email_conflict",
          "Blocked second-provider sign-in for an email owned by another identity",
          { requestId: req.requestId },
        );
        await supabase.auth.signOut({ scope: "local" }).catch((signOutErr) =>
          logger.warn(
            "OAUTH",
            "signout_cleanup_failed",
            "Best-effort local signOut during callback cleanup failed",
            {
              requestId: req.requestId,
              error:
                signOutErr instanceof Error
                  ? signOutErr.message
                  : String(signOutErr),
            },
          ),
        );
        return res.redirect(`${siteUrl}/login?error=account_exists`);
      }
      logger.error(
        "OAUTH",
        "post_auth_finalize_failed",
        "Failed to finalize profile/legal acceptance after native OAuth",
        {
          userId: user.id,
          error:
            finalizeErr instanceof Error
              ? finalizeErr.message
              : String(finalizeErr),
          requestId: req.requestId,
        },
      );
      // DO NOT sign out here. The session from exchangeCodeForSession/verifyOtp is a LEGITIMATE
      // first-identity login; a finalize-time side-effect failure (transient profile read, role
      // normalize, etc.) must NEVER tear it down — that coupling is the exact outage this rebuild
      // removed. The session is preserved; we surface a human, recoverable error and the auth
      // middleware re-reconciles the profile on the next request. (A refused DUPLICATE identity is a
      // different branch above — that one IS signed out, deliberately.) @spec auth-standard-flow AS-1.
      return res.redirect(`${siteUrl}/login?error=post_auth_finalize`);
    }

    logger.info("OAUTH", "success", "Native Google OAuth successful", {
      userId: user.id,
      redirectPath,
    });

    return res.redirect(`${siteUrl}${redirectPath}`);
  } catch (err) {
    logger.error(
      "OAUTH",
      "callback_exception",
      "Exception in native OAuth callback",
      err,
    );
    return res.redirect(`${siteUrl}/login?error=google_oauth_failed`);
  }
}

router.get("/callback", nativeOAuthCallbackHandler);

export default router;
