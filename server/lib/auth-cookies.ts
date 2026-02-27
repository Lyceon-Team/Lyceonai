import type { Response } from "express";

export function setAuthCookies(
  res: Response,
  session: { access_token: string; refresh_token: string; expires_in?: number },
  isProd: boolean
): void {
  clearAuthCookies(res, isProd);
  
  // Use actual token lifetime for access token (default 1 hour if not provided)
  const accessMaxAgeMs = typeof session.expires_in === 'number'
    ? session.expires_in * 1000
    : 60 * 60 * 1000; // 1 hour fallback
  
  const base = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/', // CRITICAL - ensures cookies sent to all routes
    ...(isProd && { domain: '.lyceon.ai' })
  };

  res.cookie('sb-access-token', session.access_token, {
    ...base,
    maxAge: accessMaxAgeMs
  });

  res.cookie('sb-refresh-token', session.refresh_token, {
    ...base,
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  });
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
