import cors from "cors";
import type { Request } from "express";
import { buildAllowedOrigins, normalizeOrigin } from "../../../../server/middleware/origin-utils";

export function corsMiddleware() {
  const { isDev, raw, normalized } = buildAllowedOrigins({
    nodeEnv: process.env.NODE_ENV,
    corsOriginsCsv: process.env.CORS_ORIGINS,
    csrfOriginsCsv: process.env.CSRF_ALLOWED_ORIGINS,
  });

  console.log("[CORS] Allowed origins (raw):", raw);

  return cors({
    credentials: true,
    origin: (origin, cb) => {
      // Non-browser requests (curl without Origin) should be allowed
      if (!origin) return cb(null, true);

      // Allow all origins in dev or test environment
      if (isDev || process.env.NODE_ENV === 'test') return cb(null, true);

      const o = normalizeOrigin(origin);
      const ok = o ? normalized.has(o) : false;

      if (!ok) {
        console.warn("[CORS] blocked", {
          origin,
          normalized: o,
          allowPreview: Array.from(normalized).slice(0, 8),
        });
        // Return false without error to avoid 500 - let CSRF middleware handle rejection
        return cb(null, false);
      }

      return cb(null, true);
    },
  });
}

export const createCorsMiddleware = corsMiddleware;
export const corsAllowlist = corsMiddleware;
