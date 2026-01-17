/**
 * Bearer Token Authentication Middleware
 * Simple token validation for MVP endpoints
 */

import { Request, Response, NextFunction } from "express";

export function requireBearer(envName: "INGEST_ADMIN_TOKEN" | "API_USER_TOKEN") {
  return (req: Request, res: Response, next: NextFunction) => {
    const secret = process.env[envName];
    const isProduction = process.env.NODE_ENV === "production";
    
    if (!secret) {
      if (isProduction) {
        // FAIL FAST in production if token is not set
        console.error(`❌ SECURITY: Missing ${envName} in production environment`);
        return res.status(500).json({ 
          error: "Server misconfiguration",
          message: "Authentication tokens not configured" 
        });
      }
      console.warn(`⚠️  Missing ${envName} in environment - using fallback "changeme" (dev only)`);
    }
    
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const expectedToken = secret || "changeme"; // Fallback only for dev
    
    if (token !== expectedToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    next();
  };
}
