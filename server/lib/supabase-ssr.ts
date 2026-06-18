/**
 * @spec [Doc-01_V8 Identity/Access; Coding Standards §6.1 server-authoritative auth | AUTH-001]
 * @implemented 2026-06-15
 * plain English: Single source of truth for request-scoped `@supabase/ssr` server clients.
 * Builds a `createServerClient` whose cookie adapter reads the incoming request cookies and
 * writes refreshed/cleared session cookies back onto the Express response. This replaces the
 * hand-rolled raw-cookie token extraction + the custom `/api/auth/refresh` endpoint: the SSR
 * client validates the session server-side via `getUser()` AND auto-refreshes through cookies.
 *
 * expected outcome: every authenticated request gets an RLS-bound Supabase client carrying the
 * validated user identity, and any token refresh that happens during the request is persisted to
 * the response cookies automatically (no custom refresh path).
 * trade-offs: the SSR client owns its own cookie names (`sb-<ref>-auth-token[.N]`); cookie writes
 * are buffered and flushed onto the Express response via `res.cookie`/`res.clearCookie`.
 * edge cases: in test/placeholder environments the SUPABASE_URL/key may be placeholders — callers
 * are responsible for short-circuiting network calls; this factory only wires cookie transport.
 */
import type { Request, Response } from "express";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Cookie options applied to every auth cookie the SSR client writes.
 * httpOnly, lax, path '/'. The apex domain is applied ONLY when actually served under lyceon.ai so
 * cookies are shared across www/apex in prod — but NEVER on other hosts (Vercel preview
 * *.vercel.app, localhost), where a `Domain=.lyceon.ai` cookie is rejected by the browser and the
 * session silently fails to persist. On those hosts the cookie is host-scoped (no domain) so it is
 * accepted and the SSR session round-trips correctly.
 */
export function cookieDomainForHost(
  host: string | undefined,
): string | undefined {
  if (!host) return undefined;
  const hostname = host.split(":")[0].toLowerCase();
  if (hostname === "lyceon.ai" || hostname.endsWith(".lyceon.ai")) {
    return ".lyceon.ai";
  }
  return undefined;
}

function baseCookieOptions(req: Request): CookieOptions {
  const domain = isProduction
    ? cookieDomainForHost(req.headers.host)
    : undefined;
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    ...(domain ? { domain } : {}),
  };
}

function resolveSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) {
    throw new Error("SUPABASE_URL must be set in production/development");
  }
  return url;
}

function resolveSupabaseAnonKey(): string {
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("SUPABASE_ANON_KEY must be set in production/development");
  }
  return key;
}

/**
 * Build a request-scoped SSR server client. The cookie adapter:
 *  - getAll(): reads all cookies parsed by cookie-parser off the request.
 *  - setAll(): writes each cookie back onto the Express response (used by token refresh,
 *    setSession, and signOut), merging in the canonical security options.
 *
 * NEVER share the returned client across requests — it is bound to this req/res pair.
 */
export function createSupabaseServerClient(
  req: Request,
  res: Response,
): SupabaseClient {
  return createServerClient(resolveSupabaseUrl(), resolveSupabaseAnonKey(), {
    cookies: {
      getAll() {
        const cookies = (req.cookies ?? {}) as Record<string, string>;
        return Object.entries(cookies).map(([name, value]) => ({
          name,
          value,
        }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          const merged = { ...baseCookieOptions(req), ...options };
          if (value === "") {
            res.clearCookie(name, merged);
          } else {
            res.cookie(name, value, merged);
          }
        }
        // Auth-cookie writes must never be cached by CDNs / proxies.
        res.setHeader(
          "Cache-Control",
          "private, no-cache, no-store, must-revalidate, max-age=0",
        );
      },
    },
  });
}
