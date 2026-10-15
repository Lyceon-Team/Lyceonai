import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger';
import { loggableIp } from '../lib/client-ip';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      /**
       * @spec [owner brief 2026-10-13 "first-run activation fixes" item 2; Doc-01A_V1.0 §10]
       * | @implemented [2026-10-13] | plain English: `performance.now()` when this middleware
       * (the first) saw the request. Read by `server/lib/step-timer.ts` for `pre_handler_ms`;
       * monotonic, process-relative, and meaningless outside this process, so it is never
       * logged as a timestamp.
       */
      requestStartedAt?: number;
    }
  }
}

function parseContentLength(headerValue: string | number | string[] | undefined): number {
  if (typeof headerValue === 'number') return headerValue;
  if (typeof headerValue === 'string') {
    const parsed = Number(headerValue);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (Array.isArray(headerValue) && headerValue.length > 0) {
    const parsed = Number(headerValue[0]);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const existingId = req.headers['x-request-id'] as string;
  const requestId = existingId || uuidv4();

  req.requestId = requestId;
  req.requestStartedAt = performance.now();
  res.setHeader('X-Request-Id', requestId);

  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const responseSize = parseContentLength(res.getHeader('Content-Length'));

    logger.apiRequest(
      req.method,
      req.path,
      res.statusCode,
      duration,
      requestId,
      req.user?.id,
      // /api/public/* logs a keyed digest, never the raw IP (SCL-202; server/lib/client-ip.ts).
      loggableIp(req),
      undefined,
      responseSize,
    );
  });

  next();
}
