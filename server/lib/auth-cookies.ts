import type { Response } from "express";

type ClearCookieOptions = {
  httpOnly: boolean;
  sameSite: "lax";
  path: string;
  secure: boolean;
  domain?: string;
};

/**
 * @spec [AUTH-001 / G8 — single @supabase/ssr cookie session]
 * Clears the LEGACY `sb-access-token` / `sb-refresh-token` cookies on signout.
 *
 * Status: TRANSITIONAL HYGIENE — NOT session-load-bearing. After G8 the auth middleware no longer reads
 * or trusts these legacy cookies; the only session store is the native `sb-<ref>-auth-token` cookie,
 * which signout already clears via the SSR client. A stale legacy cookie is therefore INERT — it cannot
 * keep a user signed in. This cleanup exists only so a user who still holds a pre-G8 legacy cookie gets
 * it removed from their browser on signout rather than letting it linger until expiry (≤30 days). Safe
 * to delete once legacy cookies have aged out after the G8 deploy. The exhaustive path/secure/domain
 * matrix mirrors every option set the old writer could have used, so the clear actually matches them.
 *
 * (The legacy WRITER `setAuthCookies` was removed in Stage 2 — nothing writes these cookies anymore.)
 */
export function clearAuthCookies(res: Response, isProd: boolean): void {
  const names = ["sb-access-token", "sb-refresh-token"] as const;
  const paths = ["/", "/api"] as const;

  const baseCommon = {
    httpOnly: true,
    sameSite: "lax" as const,
  };

  const optionSets: ClearCookieOptions[] = [];

  for (const path of paths) {
    optionSets.push({ ...baseCommon, path, secure: false });
    optionSets.push({ ...baseCommon, path, secure: true });

    if (isProd) {
      optionSets.push({
        ...baseCommon,
        path,
        secure: true,
        domain: ".lyceon.ai",
      });
      optionSets.push({
        ...baseCommon,
        path,
        secure: true,
        domain: "lyceon.ai",
      });
      optionSets.push({
        ...baseCommon,
        path,
        secure: false,
        domain: ".lyceon.ai",
      });
      optionSets.push({
        ...baseCommon,
        path,
        secure: false,
        domain: "lyceon.ai",
      });
    }
  }

  for (const name of names) {
    for (const opts of optionSets) {
      res.clearCookie(name, opts);
    }
  }
}
