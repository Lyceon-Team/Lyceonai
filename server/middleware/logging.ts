/**
 * EXPRESS LOGGING MIDDLEWARE
 * 
 * Integrates operational logging with Express.js for comprehensive
 * request/response tracking and performance monitoring.
 */

import { Request, Response, NextFunction } from 'express';
import { logger, createLoggingContext } from '../logger.js';

// Extend Express Request type to include logging context
declare global {
  namespace Express {
    interface Request {
      requestId: string;
      startTime: number;
      logContext: {
        userId?: string;
        requestId: string;
        ip: string;
      };
    }
  }
}

/**
 * Request tracking middleware
 * Adds request ID and timing to all requests
 */
export function requestTracking(req: Request, res: Response, next: NextFunction) {
  // Generate unique request ID
  req.requestId = logger.generateRequestId();
  req.startTime = Date.now();
  
  // Create logging context
  req.logContext = {
    requestId: req.requestId,
    ip: req.ip || req.connection?.remoteAddress || 'unknown',
    userId: undefined // Will be set by auth middleware
  };
  
  // Add request ID to response headers for debugging
  res.setHeader('X-Request-ID', req.requestId);
  
  next();
}

/**
 * Request/Response logging middleware
 * Logs all API requests with performance metrics
 */
export function requestLogging(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  
  // Log incoming request
  logger.debug(
    'HTTP',
    'request_start',
    `${req.method} ${req.path}`,
    {
      method: req.method,
      path: req.path,
      query: req.query,
      userAgent: req.get('User-Agent'),
      contentLength: req.get('Content-Length')
    },
    req.logContext
  );

  // Capture original res.end to log response
  const originalEnd = res.end;
  let responseBody = '';
  
  // Override res.end to capture response
  res.end = function(chunk?: any, encoding?: any, cb?: any) {
    const duration = Date.now() - startTime;
    
    // Log API request metrics
    logger.apiRequest(
      req.method,
      req.path,
      res.statusCode,
      duration,
      req.requestId,
      req.logContext.userId,
      req.logContext.ip,
      req.body,
      chunk ? (typeof chunk === 'string' ? chunk.length : Buffer.byteLength(chunk)) : 0
    );
    
    // Call original end method and return result
    return originalEnd.call(this, chunk, encoding, cb);
  };
  
  next();
}

/**
 * Error logging middleware
 * Captures and logs all errors with full context
 */
export function errorLogging(err: any, req: Request, res: Response, next: NextFunction) {
  const duration = Date.now() - req.startTime;
  
  // Log the error with full context
  logger.error(
    'HTTP',
    'request_error',
    `${req.method} ${req.path} failed`,
    err,
    {
      method: req.method,
      path: req.path,
      query: req.query,
      body: req.body,
      statusCode: res.statusCode || 500,
      duration,
      userAgent: req.get('User-Agent')
    },
    req.logContext
  );
  
  // Pass error to default error handler
  next(err);
}

/**
 * Authentication context middleware
 * Updates logging context with user information
 */
export function authContextLogging(req: Request, res: Response, next: NextFunction) {
  // Update logging context with user info if available
  if (req.user?.id) {
    req.logContext.userId = req.user.id;
  }
  
  next();
}

/**
 * Admin action logging middleware
 * Logs admin actions for audit trail
 */
export function adminActionLogging(action: string, resource: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Store original res.json to capture response
    const originalJson = res.json;
    
    res.json = function(body: any) {
      const success = res.statusCode < 400;
      
      // Log admin action
      logger.adminAction(
        action,
        resource,
        req.logContext.userId || 'unknown',
        req.requestId,
        req.logContext.ip,
        {
          request: {
            method: req.method,
            path: req.path,
            body: req.body,
            query: req.query
          },
          response: {
            statusCode: res.statusCode,
            success
          }
        },
        success
      );
      
      return originalJson.call(this, body);
    };
    
    next();
  };
}

/**
 * Performance monitoring middleware
 * Tracks slow operations and system performance
 */
export function performanceMonitoring(req: Request, res: Response, next: NextFunction) {
  const timer = logger.startTimer(`${req.method} ${req.path}`, {
    method: req.method,
    path: req.path,
    userAgent: req.get('User-Agent')
  });
  
  // Store timer in request for later use
  (req as any).performanceTimer = timer;
  
  // Override res.end to complete timing
  const originalEnd = res.end;
  res.end = function(chunk?: any, encoding?: any, cb?: any) {
    const success = res.statusCode < 400;
    
    // Complete the timing (timer function handles its own parameters)
    timer();
    
    return originalEnd.call(this, chunk, encoding, cb);
  };
  
  next();
}

/**
 * Health monitoring middleware
 * Periodically logs system health metrics
 */
let lastHealthLog = 0;
export function healthMonitoring(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  
  // Log health metrics every 5 minutes
  if (now - lastHealthLog > 5 * 60 * 1000) {
    const health = logger.getHealthMetrics();
    
    logger.info(
      'HEALTH',
      'system_metrics',
      'System health check',
      health
    );
    
    // Log warnings for concerning metrics
    if (health.errors.lastHour > 10) {
      logger.warn(
        'HEALTH',
        'high_error_rate',
        `High error rate detected: ${health.errors.lastHour} errors in last hour`
      );
    }
    
    if (health.performance.avgResponseTime > 2000) {
      logger.warn(
        'HEALTH',
        'slow_performance',
        `Slow average response time: ${health.performance.avgResponseTime}ms`
      );
    }
    
    if (health.memory.used > 500) { // 500MB threshold
      logger.warn(
        'HEALTH',
        'high_memory_usage',
        `High memory usage: ${health.memory.used}MB`
      );
    }
    
    lastHealthLog = now;
  }
  
  next();
}

/**
 * Security logging middleware
 * Logs security-related events
 */
export function securityLogging(req: Request, res: Response, next: NextFunction) {
  // Log failed authentication attempts
  const originalStatus = res.status;
  res.status = function(code: number) {
    if (code === 401 || code === 403) {
      logger.warn(
        'SECURITY',
        'auth_failure',
        `Authentication failed for ${req.method} ${req.path}`,
        {
          method: req.method,
          path: req.path,
          statusCode: code,
          userAgent: req.get('User-Agent'),
          authorization: req.get('Authorization') ? 'present' : 'missing'
        },
        req.logContext
      );
    }
    
    return originalStatus.call(this as any, code);
  };
  
  // Log suspicious activities
  if (req.path.includes('..') || req.path.includes('<script>')) {
    logger.warn(
      'SECURITY',
      'suspicious_request',
      'Potentially malicious request detected',
      {
        method: req.method,
        path: req.path,
        query: req.query,
        userAgent: req.get('User-Agent')
      },
      req.logContext
    );
  }
  
  next();
}