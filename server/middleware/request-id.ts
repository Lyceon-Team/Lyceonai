import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
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
  res.setHeader('X-Request-Id', requestId);

  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const responseSize = parseContentLength(res.getHeader('Content-Length') as any);

    logger.apiRequest(
      req.method,
      req.path,
      res.statusCode,
      duration,
      requestId,
      req.user?.id,
      req.ip || req.socket?.remoteAddress,
      undefined,
      responseSize,
    );
  });

  next();
}
