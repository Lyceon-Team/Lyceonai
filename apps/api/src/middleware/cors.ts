import cors from "cors";
import type { Request } from "express";
import { buildAllowedOrigins, normalizeOrigin } from "../../../../server/middleware/origin-utils";

export function corsMiddleware() {
  const { raw, normalized } = buildAllowedOrigins({
    nodeEnv: process.env.NODE_ENV,
    corsOriginsCsv: process.env.CORS_ORIGINS,
    csrfOriginsCsv: process.env.CSRF_ALLOWED_ORIGINS,
  });

  console.log("[CORS] Allowed origins (raw):", raw);

  return cors({
    credentials: true,
    origin: (origin, cb) => {
<<<<<<< HEAD
      // If no origin header, don't set CORS headers (server-to-server communication)
      if (!origin) return cb(null, false);
=======
      // Non-browser requests (curl without Origin) should be allowed
      if (!origin) return cb(null, true);

      if (isDev) return cb(null, true);
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b

      const o = normalizeOrigin(origin);
      const ok = normalized.has(o);

      if (!ok) {
        console.warn("[CORS] blocked", {
          origin,
          normalized: o,
          allowPreview: Array.from(normalized).slice(0, 8),
        });
<<<<<<< HEAD
        // Return false to deny CORS
        return cb(null, false);
=======
        return cb(new Error("CORS blocked"), false);
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
      }

      // Origin is allowlisted: echo back exactly that origin with credentials
      return cb(null, origin);
    },
  });
}

export const createCorsMiddleware = corsMiddleware;
export const corsAllowlist = corsMiddleware;
