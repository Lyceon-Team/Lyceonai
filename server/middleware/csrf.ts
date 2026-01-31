import type { Request, Response, NextFunction } from "express";
import { buildAllowedOrigins, normalizeOrigin } from "./origin-utils";

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

    const method = (req.method || "").toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();

    const origin = req.headers.origin ? String(req.headers.origin) : "";
    const referer = req.headers.referer ? String(req.headers.referer) : "";

    const originNorm = origin ? normalizeOrigin(origin) : "";
    const refererNorm = referer ? normalizeOrigin(referer) : "";

    const ok =
      (originNorm && normalized.has(originNorm)) ||
      (refererNorm && normalized.has(refererNorm));

    if (ok) return next();

    console.warn("[CSRF] blocked", {
      method,
      origin,
      referer,
      originNorm,
      refererNorm,
      allowCount: normalized.size,
      allowPreview: Array.from(normalized).slice(0, 8),
    });

    return res.status(403).json({
      error: "csrf_blocked",
      message: origin || referer
        ? "Cross-site request blocked by CSRF protection"
        : "Cross-site request blocked: missing Origin/Referer headers",
      origin: origin || null,
    });
  };
}
