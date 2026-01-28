import { Request, Response, NextFunction } from "express";

export function requireBearer(envName: "INGEST_ADMIN_TOKEN" | "API_USER_TOKEN") {
  const secret = process.env[envName];
  const isProduction = process.env.NODE_ENV === "production";

  if (!secret) {
    const msg = `Missing ${envName} in environment`;
    if (isProduction) {
      // Fail fast: throw error at middleware creation
      throw new Error(`❌ SECURITY: ${msg} (production)`);
    } else {
      // Warn in development, but do NOT allow a fallback!
      console.warn(`⚠️  ${msg} (development)`);
    }
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token !== secret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  };
}