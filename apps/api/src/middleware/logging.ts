/**
 * Privacy-safe request logging middleware.
 *
 * Centralizes request logs through server/logger.ts and avoids logging
 * full request bodies or auth material.
 */

import { Request, Response, NextFunction } from "express";
import { logger } from "../../../../server/logger.js";

export function reqLogger() {
  return (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();

    res.on("finish", () => {
      const duration = Date.now() - startedAt;
      const requestId = (req as any).requestId || logger.generateRequestId();
      const responseSize = Number(res.getHeader("Content-Length") || 0) || 0;

      logger.apiRequest(
        req.method,
        req.path,
        res.statusCode,
        duration,
        requestId,
        (req as any).user?.id,
        req.ip,
        undefined,
        responseSize,
      );
    });

    next();
  };
}
