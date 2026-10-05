/**
 * The app's final error boundary: the last middleware in `server/index.ts`.
 *
 * @spec [Coding Standards §12.1, §13; Guardian_Closure_Plan G-NEW-12] | @implemented [2026-09-30]
 *
 * plain English: a CSRF failure raised by `csrf-csrf` (`next(err)`) is answered 403
 * `csrf_blocked`, which `csrfFetch` recognises and recovers from by fetching a fresh token and
 * retrying once; every other uncaught error is logged and answered 500 (or passed on when the
 * headers are already sent).
 *
 * G-NEW-12: the 403 branch returned BEFORE anything was logged, so the one refusal a retry can
 * pass left no trace — production saw `PATCH /api/profile` 403 at 02:22:40Z with no reason. It
 * now logs its code first. The log carries the code, method and path only: never the token,
 * the cookie or the body.
 *
 * Extracted from `server/index.ts` unchanged apart from that log line, so it can be tested
 * without booting the whole app. `err` is `unknown` at this boundary and narrowed here.
 */
import type { NextFunction, Request, Response } from "express";
import { loggableIp } from "../lib/client-ip";
import { logger } from "../logger";

type ErrorFields = {
  code?: unknown;
  name?: unknown;
  message?: unknown;
  status?: unknown;
};

function fieldsOf(err: unknown): ErrorFields {
  return typeof err === "object" && err !== null ? (err as ErrorFields) : {};
}

export function isCsrfError(err: unknown): boolean {
  const { code, name, message } = fieldsOf(err);
  return (
    code === "EBADCSRFTOKEN" ||
    name === "CSRFError" ||
    (typeof message === "string" && message.toLowerCase().includes("csrf"))
  );
}

export const CSRF_BLOCKED = "csrf_blocked";

export function finalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = req.requestId || logger.generateRequestId();

  if (isCsrfError(err)) {
    logger.warn(
      "CSRF",
      "token_rejected",
      "Request blocked: CSRF token did not verify",
      { code: CSRF_BLOCKED, method: req.method, path: req.path },
      { requestId, userId: req.user?.id, ip: loggableIp(req) },
    );
    res.status(403).json({
      error: {
        code: CSRF_BLOCKED,
        message: "Request blocked by CSRF protection",
      },
      requestId,
    });
    return;
  }

  const status = fieldsOf(err).status;
  // As before (`err?.status || 500`): a missing or zero status is a 500.
  const statusCode = typeof status === "number" && status !== 0 ? status : 500;

  logger.error(
    "HTTP",
    "unhandled_error",
    `Unhandled error in ${req.method} ${req.path}`,
    err,
    {
      method: req.method,
      path: req.path,
      statusCode,
      hasBody: req.body !== undefined && req.body !== null,
      hasCookieHeader: !!req.headers.cookie,
      hasAuthorizationHeader: !!req.headers.authorization,
    },
    {
      requestId,
      userId: req.user?.id,
      ip: loggableIp(req),
    },
  );

  if (res.headersSent) {
    next(err);
    return;
  }

  res.status(statusCode).json({
    error: "Internal server error",
    requestId,
  });
}
