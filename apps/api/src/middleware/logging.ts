/**
 * Request Logging Middleware
 * 
 * Logs HTTP requests with method, path, status code, and response time.
 */

import { Request, Response, NextFunction } from "express";

export function reqLogger() {
  return (req: Request, res: Response, next: NextFunction) => {
    const t0 = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - t0;
      console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    });
    next();
  };
}
