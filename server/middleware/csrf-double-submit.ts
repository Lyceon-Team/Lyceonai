import type { NextFunction, Request, Response } from "express";
import { resolveTokenFromRequest } from "./supabase-auth";
import { doubleCsrf } from "csrf-csrf";
import { logger } from "../logger";
import { buildCsrfAllowedOrigins, normalizeOrigin } from "./origin-utils";

const isProduction = process.env.NODE_ENV === "production";
const csrfSecret = process.env.CSRF_SECRET;

if (!csrfSecret && isProduction) {
  throw new Error("CSRF_SECRET is required in production");
}

const resolvedSecret = csrfSecret || "dev-csrf-secret";
const csrfCookieName = process.env.CSRF_COOKIE_NAME || (isProduction ? "__Host-csrf" : "dev-csrf");
const cookieSecureOverride = process.env.CSRF_COOKIE_SECURE;
const resolvedCookieSecure =
  cookieSecureOverride === "false"
    ? false
    : cookieSecureOverride === "true"
      ? true
      : isProduction || csrfCookieName.startsWith("__Host-");
const { normalized: allowedOrigins } = buildCsrfAllowedOrigins({
  nodeEnv: process.env.NODE_ENV,
  csrfOriginsCsv: process.env.CSRF_ALLOWED_ORIGINS,
});

const { doubleCsrfProtection: doubleCsrfBaseProtection, generateCsrfToken } = doubleCsrf({
  getSecret: () => resolvedSecret,
  getSessionIdentifier: (req: Request) => {
    const tokenResult = resolveTokenFromRequest(req);
    if (tokenResult?.token) return tokenResult.token;
    const forwarded = req.headers["x-forwarded-for"];
    if (Array.isArray(forwarded)) return forwarded[0] || "anonymous";
    if (typeof forwarded === "string" && forwarded) return forwarded;
    return req.ip || "anonymous";
  },
  cookieName: csrfCookieName,
  cookieOptions: {
    secure: resolvedCookieSecure,
    sameSite: "lax",
    path: "/",
    httpOnly: false,
  },
  getCsrfTokenFromRequest: (req: Request) => {
    const token = req.headers["x-csrf-token"];
    if (Array.isArray(token)) return token[0] || "";
    return token || "";
  },
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
});

function generateToken(req: Request, res: Response) {
  const token = generateCsrfToken(req, res);
  logger.info("CSRF", "token_generated", "Issued new CSRF token and cookie", {
    requestId: req.requestId,
    ip: req.ip,
  });
  return token;
}

function sendCsrfBlocked(
  req: Request,
  res: Response,
  reason: "missing_origin" | "disallowed_origin" | "disallowed_referer",
  origin: string | null,
) {
  logger.warn(
    "CSRF",
    "origin_blocked",
    "Request blocked by CSRF origin validation",
    {
      method: req.method,
      path: req.path,
      reason,
      origin,
    },
    {
      requestId: req.requestId,
      userId: req.user?.id,
      ip: req.ip,
    },
  );

  return res.status(403).json({
    error: {
      code: "csrf_blocked",
      message: "Request blocked by CSRF protection",
    },
    reason,
    requestId: req.requestId,
  });
}

function isSafeMethod(method: string): boolean {
  const normalizedMethod = method.toUpperCase();
  return normalizedMethod === "GET" || normalizedMethod === "HEAD" || normalizedMethod === "OPTIONS";
}

function readHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? "";
  }
  return typeof value === "string" ? value.trim() : "";
}

function readRefererOrigin(referer: string): string {
  if (!referer) return "";
  try {
    return normalizeOrigin(new URL(referer).origin);
  } catch {
    return normalizeOrigin(referer);
  }
}

function originValidationMiddleware(req: Request, res: Response, next: NextFunction) {
  if (isSafeMethod(req.method || "")) {
    return next();
  }

  const originHeader = readHeaderValue(req.headers.origin as string | string[] | undefined);
  const refererHeader = readHeaderValue(req.headers.referer as string | string[] | undefined);
  const originNormalized = originHeader ? normalizeOrigin(originHeader) : "";

  if (originNormalized) {
    if (allowedOrigins.has(originNormalized)) {
      return next();
    }
    return sendCsrfBlocked(req, res, "disallowed_origin", originHeader);
  }

  if (isProduction) {
    return sendCsrfBlocked(req, res, "missing_origin", null);
  }

  const refererOrigin = readRefererOrigin(refererHeader);
  if (!refererOrigin) {
    // Non-production requests (test scripts/supertest) can omit Origin.
    return next();
  }

  if (allowedOrigins.has(refererOrigin)) {
    return next();
  }

  return sendCsrfBlocked(req, res, "disallowed_referer", refererHeader || null);
}

function doubleCsrfProtection(req: Request, res: Response, next: NextFunction) {
  originValidationMiddleware(req, res, (originError?: unknown) => {
    if (originError) {
      return next(originError);
    }
    return doubleCsrfBaseProtection(req, res, next);
  });
}

export { doubleCsrfProtection, generateToken, csrfCookieName };
