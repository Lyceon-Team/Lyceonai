import type { Response } from "express";

export function setAuthCookies(res: Response | any, session: any, isProd: boolean) {
  if (!session) return;

  const baseOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProd,
    path: '/',
  };

  // Set access token cookie
  if (session.access_token) {
    const accessTokenMaxAge = session.expires_in ? session.expires_in * 1000 : 3600 * 1000; // default to 1 hour
    res.cookie('sb-access-token', session.access_token, {
      ...baseOptions,
      maxAge: accessTokenMaxAge,
    });
  }

  // Set refresh token cookie
  if (session.refresh_token) {
    const refreshTokenMaxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    res.cookie('sb-refresh-token', session.refresh_token, {
      ...baseOptions,
      maxAge: refreshTokenMaxAge,
    });
  }
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
