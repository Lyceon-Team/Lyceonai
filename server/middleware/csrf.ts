import type { Request, Response, NextFunction } from "express";
import { buildAllowedOrigins, isAllowedRequestOrigin } from "./origin-utils";

export function csrfGuard() {
  const { isDev, normalized, raw } = buildAllowedOrigins({
    nodeEnv: process.env.NODE_ENV,
    corsOriginsCsv: process.env.CORS_ORIGINS,
    csrfOriginsCsv: process.env.CSRF_ALLOWED_ORIGINS,
  });

  console.log("[CSRF] Allowed origins (raw):", raw);

  return function csrfMiddleware(req: Request, res: Response, next: NextFunction) {
    // Skip CSRF in development mode only, NOT test mode
    // Tests need to verify CSRF behavior works correctly
    if (isDev) return next();

    if (isAllowedRequestOrigin(req, normalized)) return next();

    const origin = (req.headers.origin as string) || "";
    const referer = (req.headers.referer as string) || "";

    console.warn("[CSRF] blocked", {
      method: req.method,
      origin,
      referer,
      originNorm: origin,
      refererNorm: referer,
      allowCount: normalized.size,
      allowPreview: Array.from(normalized).slice(0, 8),
    });

    return res.status(403).json({
      error: "csrf_blocked",
    });
  };
}
