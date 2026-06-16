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
import { ensureProfileForAuthUser } from "../lib/profile-bootstrap.js";
import { LEGAL_DOCS, type ConsentSource } from "../../shared/legal-consent.js";
import { recordLegalAcceptances } from "../lib/legal-acceptance.js";

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

  const { code, error: providerError } = req.query;

  if (providerError) {
    logger.warn("OAUTH", "provider_error", "OAuth provider returned an error", {
      error: providerError,
    });
    return res.redirect(`${siteUrl}/login?error=google_oauth_failed`);
  }

  if (!code || typeof code !== "string") {
    logger.warn("OAUTH", "no_code", "No authorization code on native callback");
    return res.redirect(`${siteUrl}/login?error=google_oauth_failed`);
  }

  try {
    // The SSR server client reads the PKCE code-verifier cookie and, on success, writes the
    // session cookie back onto the response through the cookie adapter.
    const supabase = createSupabaseServerClient(req, res);
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error || !data.session || !data.user) {
      logger.error(
        "OAUTH",
        "exchange_failed",
        "Failed to exchange code for session",
        { error: error?.message },
      );
      return res.redirect(`${siteUrl}/login?error=supabase_exchange`);
    }

    const user = data.user;

    let redirectPath = "/profile/complete";
    try {
      const admin = getSupabaseAdmin();
      const profile = await ensureProfileForAuthUser(admin, user, {
        source: "google_oauth_callback",
        requestId: req.requestId,
      });

      const consentSource = parseConsentSource(req);
      if (consentSource) {
        const minor = !!profile.is_under_13;
        await recordLegalAcceptances(admin, {
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
      }

      const profileNeedsCompletion =
        !profile.profile_completed_at ||
        (profile.is_under_13 && !profile.guardian_consent);

      if (profileNeedsCompletion) {
        redirectPath = "/profile/complete";
      } else if (profile.role === "guardian") {
        redirectPath = "/guardian";
      } else {
        redirectPath = "/dashboard";
      }
    } catch (finalizeErr) {
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
      // Sign the half-finished session out so we never strand a partially-bootstrapped user.
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
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
