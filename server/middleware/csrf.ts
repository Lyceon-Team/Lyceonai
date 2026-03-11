import type { Request, Response, NextFunction } from "express";
import { buildAllowedOrigins, normalizeOrigin } from "./origin-utils";

export function csrfGuard() {
  const { normalized, raw } = buildAllowedOrigins({
    nodeEnv: process.env.NODE_ENV,
    corsOriginsCsv: process.env.CORS_ORIGINS,
    csrfOriginsCsv: process.env.CSRF_ALLOWED_ORIGINS,
  });

  console.log("[CSRF] Allowed origins (raw):", raw);

  return function csrfMiddleware(req: Request, res: Response, next: NextFunction) {
    const method = (req.method || "").toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();

    const origin = req.headers.origin ? String(req.headers.origin) : "";
    const referer = req.headers.referer ? String(req.headers.referer) : "";
    const requestId = req.requestId;

    // If both Origin and Referer are missing, block state-changing requests.
    if (!origin && !referer) {
      console.warn("[CSRF] blocked", {
        method,
        reason: "missing_both_origin_and_referer",
        allowCount: normalized.size,
        allowPreview: Array.from(normalized).slice(0, 8),
        requestId,
      });
      return res.status(403).json({
        error: "csrf_blocked",
        message: "Cross-site request blocked by CSRF protection",
        requestId,
      });
    }

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
      requestId,
    });

    return res.status(403).json({
      error: "csrf_blocked",
      message: "Cross-site request blocked by CSRF protection",
      origin: origin || null,
      requestId,
    });
  };
}
