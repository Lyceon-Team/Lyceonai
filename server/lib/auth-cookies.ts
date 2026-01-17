import type { Response } from "express";

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
