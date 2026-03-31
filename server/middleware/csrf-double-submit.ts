import type { Request } from "express";
import { resolveTokenFromRequest } from "./supabase-auth";
import { doubleCsrf } from "csrf-csrf";

const isProduction = process.env.NODE_ENV === "production";
const csrfSecret = process.env.CSRF_SECRET;

if (!csrfSecret && isProduction) {
  throw new Error("CSRF_SECRET is required in production");
}

const resolvedSecret = csrfSecret || "dev-csrf-secret";
const csrfCookieName = process.env.CSRF_COOKIE_NAME || "__Host-csrf";

const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
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
    secure: isProduction,
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

const generateToken = generateCsrfToken;

export { doubleCsrfProtection, generateToken, csrfCookieName };
