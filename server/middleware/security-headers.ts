import type { RequestHandler } from 'express';
import helmet from 'helmet';

const SECURITY_HEADERS = {
  permissionsPolicy: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), interest-cohort=()',
  xPermittedCrossDomainPolicies: 'none',
};

function buildCspDirectives(isProd: boolean) {
  const scriptSrc = ["'self'", "'unsafe-inline'"];
  if (!isProd) {
    // Vite dev server and source maps require relaxed eval in non-production.
    scriptSrc.push("'unsafe-eval'");
  }

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


