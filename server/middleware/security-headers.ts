import type { RequestHandler } from 'express';
import helmet from 'helmet';

const SECURITY_HEADERS = {
  permissionsPolicy: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), interest-cohort=()',
  xPermittedCrossDomainPolicies: 'none',
};

/**
 * @spec [student-UI register §8 F-58, owner ruling (Karl) 2026-10-02: replace the blanket inline
 *        allowance with the sha256 of the one inline script; UI-47] | @implemented [2026-10-02]
 *
 * plain English: the only inline script the app ships is the theme boot in client/index.html
 * (`<script id="lyceon-theme-boot">`). In production `script-src` allows our own origin plus
 * exactly that script's hash, never `'unsafe-inline'`, so any other inline script (injected or
 * added later) does not run. tests/ci/csp-theme-hash.ci.test.ts recomputes the hash from
 * client/index.html and fails if it no longer matches this constant, and fails if any other
 * inline script appears.
 * trade-offs: outside production the Vite dev server injects its own inline preamble and needs
 * eval, so development keeps `'unsafe-inline'` and `'unsafe-eval'`.
 * edge cases: in production Vercel serves index.html from its CDN, not through Express, so today
 * this policy reaches only the /api responses and the HTML pages carry no CSP at all (register
 * §8 F-59, an owner question: setting it on the pages via vercel.json also needs the Desmos
 * calculator's origin). `serializeCsp` gives the value such a header would carry.
 */
export const THEME_BOOT_SCRIPT_HASH =
  "sha256-VwLEl5LYkYRmisEJhPIWmpxw7wjpR9ShDYgf9CXNsx8=";

export function buildCspDirectives(isProd: boolean) {
  const scriptSrc = isProd
    ? ["'self'", `'${THEME_BOOT_SCRIPT_HASH}'`]
    : ["'self'", "'unsafe-inline'", "'unsafe-eval'"];

  return {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    frameAncestors: ["'none'"],
    objectSrc: ["'none'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    fontSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'", 'https:', 'wss:'],
    scriptSrc,
    styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
    formAction: ["'self'"],
    upgradeInsecureRequests: isProd ? [] : null,
  };
}

export function securityHeadersMiddleware(): RequestHandler {
  const isProd = process.env.NODE_ENV === 'production';

  const middleware = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: buildCspDirectives(isProd),
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    frameguard: { action: 'deny' },
    hsts: isProd
      ? {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true,
        }
      : false,
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });

  return (req, res, next) => {
    middleware(req, res, (err?: unknown) => {
      if (err) return next(err as any);

      res.setHeader('Permissions-Policy', SECURITY_HEADERS.permissionsPolicy);
      res.setHeader('X-Permitted-Cross-Domain-Policies', SECURITY_HEADERS.xPermittedCrossDomainPolicies);

      return next();
    });
  };
}

/**
 * The policy as one header value, in helmet's serialization (`name value;name value`). Tests use
 * it to compare against the header Express actually sends.
 */
export function serializeCsp(
  directives: ReturnType<typeof buildCspDirectives>,
): string {
  return Object.entries(directives)
    .filter(([, value]) => value !== null)
    .map(([name, value]) => {
      const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      const list = value as string[];
      return list.length > 0 ? `${kebab} ${list.join(" ")}` : kebab;
    })
    .join(";");
}
