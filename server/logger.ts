/**
 * OPERATIONAL LOGGING SYSTEM
 * 
 * Provides structured logging for monitoring, debugging, and operational insights
 * for the SAT Learning Copilot application.
 */

export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  component: string;
  operation: string;
  message: string;
  data?: any;
  error?: any;
  duration?: number;
  userId?: string;
  requestId?: string;
  ip?: string;
}

export interface PerformanceMetrics {
  operation: string;
  duration: number;
  startTime: number;
  endTime: number;
  success: boolean;
  errorType?: string;
  metadata?: any;
}

class OperationalLogger {
  private requestCounter = 0;
  private performanceMetrics: PerformanceMetrics[] = [];
  private errorCount = { last24h: 0, lastHour: 0 };
  private lastErrorReset = Date.now();

  /**
   * Generate unique request ID for tracking
   */
  generateRequestId(): string {
    this.requestCounter++;
    return `req_${Date.now()}_${this.requestCounter.toString().padStart(4, '0')}`;
  }

  /**
   * Create structured log entry
   */
  private createLogEntry(
    level: LogEntry['level'],
    component: string,
    operation: string,
    message: string,
    data?: any,
    error?: any,
    duration?: number,
    context?: { userId?: string; requestId?: string; ip?: string }
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      component,
      operation,
      message,
      data: data ? (typeof data === 'object' ? data : { value: data }) : undefined,
      error: error ? this.serializeError(error) : undefined,
      duration,
      userId: context?.userId,
      requestId: context?.requestId,
      ip: context?.ip
    };
  }

  /**
   * Serialize error objects for logging
   */
  private serializeError(error: any) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        ...(error as any) // Capture additional properties
      };
    }
    return error;
  }

  /**
   * Format log entry for console output
   */
  private formatForConsole(entry: LogEntry): string {
    const level = entry.level.toUpperCase().padEnd(5);
    const component = `[${entry.component}]`.padEnd(12);
    const timestamp = entry.timestamp.split('T')[1].split('.')[0]; // HH:MM:SS format
    
    let output = `${timestamp} ${level} ${component} ${entry.operation}: ${entry.message}`;
    
    if (entry.duration !== undefined) {
      output += ` (${entry.duration}ms)`;
    }
    
    if (entry.requestId) {
      output += ` [${entry.requestId}]`;
    }
    
    if (entry.userId) {
      output += ` [user:${entry.userId}]`;
    }

    return output;
  }

  /**
   * Output log entry
   */
  private output(entry: LogEntry) {
    const formatted = this.formatForConsole(entry);
    
    switch (entry.level) {
      case 'error':
        console.error(`🚨 ${formatted}`);
        if (entry.error) {
          console.error('   Error details:', entry.error);
        }
        if (entry.data) {
          console.error('   Context:', entry.data);
        }
        this.trackError();
        break;
      
      case 'warn':
        console.warn(`⚠️  ${formatted}`);
        if (entry.data) {
          console.warn('   Data:', entry.data);
        }
        break;
      
      case 'info':
        console.log(`ℹ️  ${formatted}`);
        if (entry.data && Object.keys(entry.data).length > 0) {
          console.log('   Data:', entry.data);
        }
        break;
      
      case 'debug':
        if (process.env.NODE_ENV === 'development') {
          console.log(`🐛 ${formatted}`);
          if (entry.data && Object.keys(entry.data).length > 0) {
            console.log('   Debug data:', entry.data);
          }
        }
        break;
    }
  }

  /**
   * Track error metrics
   */
  private trackError() {
    const now = Date.now();
    
    // Reset counters if needed
    if (now - this.lastErrorReset > 60 * 60 * 1000) { // 1 hour
      this.errorCount.lastHour = 0;
      this.lastErrorReset = now;
    }
    
    if (now - this.lastErrorReset > 24 * 60 * 60 * 1000) { // 24 hours
      this.errorCount.last24h = 0;
    }
    
    this.errorCount.lastHour++;
    this.errorCount.last24h++;
  }

  /**
   * Debug level logging
   */
  debug(component: string, operation: string, message: string, data?: any, context?: { userId?: string; requestId?: string; ip?: string }) {
    const entry = this.createLogEntry('debug', component, operation, message, data, undefined, undefined, context);
    this.output(entry);
  }

  /**
   * Info level logging
   */
  info(component: string, operation: string, message: string, data?: any, context?: { userId?: string; requestId?: string; ip?: string }) {
    const entry = this.createLogEntry('info', component, operation, message, data, undefined, undefined, context);
    this.output(entry);
  }

  /**
   * Warning level logging
   */
  warn(component: string, operation: string, message: string, data?: any, context?: { userId?: string; requestId?: string; ip?: string }) {
    const entry = this.createLogEntry('warn', component, operation, message, data, undefined, undefined, context);
    this.output(entry);
  }

  /**
   * Error level logging
   */
  error(component: string, operation: string, message: string, error?: any, data?: any, context?: { userId?: string; requestId?: string; ip?: string }) {
    const entry = this.createLogEntry('error', component, operation, message, data, error, undefined, context);
    this.output(entry);
  }

  /**
   * Performance monitoring
   */
  startTimer(operation: string, metadata?: any): () => PerformanceMetrics {
    const startTime = Date.now();
    
    return (success: boolean = true, errorType?: string): PerformanceMetrics => {
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      const metrics: PerformanceMetrics = {
        operation,
        duration,
        startTime,
        endTime,
        success,
        errorType,
        metadata
      };
      
      // Store metrics for analysis
      this.performanceMetrics.push(metrics);
      
      // Keep only last 1000 metrics to prevent memory issues
      if (this.performanceMetrics.length > 1000) {
        this.performanceMetrics = this.performanceMetrics.slice(-1000);
      }
      
      // Log performance if operation took too long
      if (duration > 1000) { // 1 second threshold
        this.warn('PERFORMANCE', operation, `Slow operation detected`, { duration, metadata });
      }
      
      return metrics;
    };
  }

  /**
   * Log API request/response
   */
  apiRequest(
    method: string, 
    path: string, 
    statusCode: number, 
    duration: number, 
    requestId: string,
    userId?: string,
    ip?: string,
    requestBody?: any,
    responseSize?: number
  ) {
    const success = statusCode < 400;
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    
    const data = {
      method,
      path,
      statusCode,
      duration,
      responseSize,
      requestBodySize: requestBody ? JSON.stringify(requestBody).length : 0
    };
    
    this.createLogEntry(
      level,
      'API',
      'request',
      `${method} ${path} ${statusCode}`,
      data,
      undefined,
      duration,
      { userId, requestId, ip }
    );
    
    this.output(this.createLogEntry(
      level,
      'API',
      'request',
      `${method} ${path} ${statusCode}`,
      data,
      undefined,
      duration,
      { userId, requestId, ip }
    ));
  }

  /**
   * Log admin actions for audit trail
   */
  adminAction(
    action: string,
    resource: string,
    userId: string,
    requestId: string,
    ip: string,
    changes?: any,
    success: boolean = true
  ) {
    const level = success ? 'info' : 'warn';
    const message = `Admin ${action} on ${resource}`;
    
    const data = {
      action,
      resource,
      changes,
      success,
      timestamp: new Date().toISOString()
    };
    
    this.createLogEntry(
      level,
      'AUDIT',
      'admin_action',
      message,
      data,
      undefined,
      undefined,
      { userId, requestId, ip }
    );
    
    this.output(this.createLogEntry(
      level,
      'AUDIT',
      'admin_action',
      message,
      data,
      undefined,
      undefined,
      { userId, requestId, ip }
    ));
  }

  /**
   * Get system health metrics
   */
  getHealthMetrics() {
    const now = Date.now();
    const recentMetrics = this.performanceMetrics.filter(m => m.endTime > now - 60000); // Last minute
    
    const avgDuration = recentMetrics.length > 0 
      ? recentMetrics.reduce((sum, m) => sum + m.duration, 0) / recentMetrics.length 
      : 0;
    
    const errorRate = recentMetrics.length > 0
      ? recentMetrics.filter(m => !m.success).length / recentMetrics.length
      : 0;
    
    return {
      timestamp: new Date().toISOString(),
      performance: {
        avgResponseTime: Math.round(avgDuration),
        requestsLastMinute: recentMetrics.length,
        errorRateLastMinute: Math.round(errorRate * 100)
      },
      errors: {
        lastHour: this.errorCount.lastHour,
        last24h: this.errorCount.last24h
      },
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
      },
      uptime: Math.round(process.uptime())
    };
  }

  /**
   * Log system startup
   */
  systemStartup(component: string, details?: any) {
    this.info('SYSTEM', 'startup', `${component} started`, details);
  }

  /**
   * Log system shutdown
   */
  systemShutdown(component: string, reason?: string) {
    this.info('SYSTEM', 'shutdown', `${component} shutting down`, { reason });
  }
}

// Export singleton instance
export const logger = new OperationalLogger();

// Export middleware type for Express
export interface LogContext {
  userId?: string;
  requestId?: string;
  ip?: string;
}

// Helper for creating logging middleware
export function createLoggingContext(req: any): LogContext {
  return {
    userId: req.user?.id || req.userId,
    requestId: req.requestId || logger.generateRequestId(),
    ip: req.ip || req.connection?.remoteAddress
  };
}