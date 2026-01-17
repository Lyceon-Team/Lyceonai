/**
 * Rate Limiting Middleware
 * Protects /ingest and /rag endpoints from abuse
 */

import rateLimit from 'express-rate-limit';
import { config } from '../config';

/**
 * Rate limiter for /ingest endpoint
 * More restrictive due to expensive operations
 */
export const ingestRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: {
    error: 'Too many ingest requests',
    message: 'Please wait before ingesting more Q&A items',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for /rag endpoint
 * Allows more requests but still protected
 */
export const ragRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: {
    error: 'Too many RAG requests',
    message: 'Please wait before making more queries',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * General API rate limiter
 * Applied to all routes as baseline protection
 */
export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: {
    error: 'Too many requests',
    message: 'Please slow down your requests',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health check
    return req.path === '/api/health' || req.path === '/healthz';
  },
});
