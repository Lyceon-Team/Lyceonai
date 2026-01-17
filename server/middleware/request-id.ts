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

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const existingId = req.headers['x-request-id'] as string;
  const requestId = existingId || uuidv4();
  
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logData = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: duration,
      request_id: requestId,
      user_id: req.user?.id || null,
    };
    
    if (res.statusCode >= 500) {
      logger.error('HTTP', 'request', `${req.method} ${req.path} ${res.statusCode}`, logData);
    } else if (res.statusCode >= 400) {
      logger.warn('HTTP', 'request', `${req.method} ${req.path} ${res.statusCode}`, logData);
    } else {
      logger.info('HTTP', 'request', `${req.method} ${req.path} ${res.statusCode}`, logData);
    }
  });
  
  next();
}
