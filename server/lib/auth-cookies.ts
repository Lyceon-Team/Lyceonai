import type { Response } from "express";
import type { Session } from "@supabase/supabase-js";

function getCookieOptions(isProd: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: !!isProd,
    path: "/",
  };
}

export function clearAuthCookies(res: Response | any, isProd: boolean) {
  const names = ['sb-access-token', 'sb-refresh-token'] as const;
  const paths = ['/', '/api'] as const;

  const baseCommon = {
    httpOnly: true,
    sameSite: 'lax' as const,
  };

  const optionSets: any[] = [];

  for (const path of paths) {
    optionSets.push({ ...baseCommon, path, secure: false });
    optionSets.push({ ...baseCommon, path, secure: true });

    if (isProd) {
      optionSets.push({ ...baseCommon, path, secure: true, domain: '.lyceon.ai' });
      optionSets.push({ ...baseCommon, path, secure: true, domain: 'lyceon.ai' });
      optionSets.push({ ...baseCommon, path, secure: false, domain: '.lyceon.ai' });
      optionSets.push({ ...baseCommon, path, secure: false, domain: 'lyceon.ai' });
    }
  }

  for (const name of names) {
    for (const opts of optionSets) {
      res.clearCookie(name, opts);
    }
  }
}

export function setAuthCookies(res: Response | any, session: Pick<Session, "access_token" | "refresh_token" | "expires_in">, isProd: boolean) {
  const base = getCookieOptions(isProd);
  const maxAgeMs = Math.max(0, Number(session.expires_in || 0)) * 1000 || 60 * 60 * 1000;

  res.cookie("sb-access-token", session.access_token, { ...base, maxAge: maxAgeMs });

  if (session.refresh_token) {
    res.cookie("sb-refresh-token", session.refresh_token, { ...base, maxAge: 7 * 24 * 60 * 60 * 1000 });
  }
}
