import type { NextFunction, Request, Response } from "express";

export type WorkerBoundaryAuthMode = "none" | "require_bearer" | "shared_secret";

type BoundaryAuthConfig = {
  mode: WorkerBoundaryAuthMode;
  sharedSecret: string | null;
  configError: string | null;
};

const MODE_ENV_KEY = "TUTOR_ORCHESTRATOR_WORKER_AUTH_MODE";
const SECRET_ENV_KEY = "TUTOR_ORCHESTRATOR_WORKER_SHARED_SECRET";
const CONFIG_ERROR_CODE = "ORCHESTRATOR_AUTH_CONFIG_ERROR";
const REQUIRED_ERROR_CODE = "ORCHESTRATOR_AUTH_REQUIRED";
const INVALID_ERROR_CODE = "ORCHESTRATOR_AUTH_INVALID";

function resolveBoundaryAuthMode(raw: string | undefined): WorkerBoundaryAuthMode | null {
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "none" || normalized === "local") return "none";
  if (normalized === "require_bearer") return "require_bearer";
  if (normalized === "shared_secret") return "shared_secret";
  return null;
}

function isProductionEnv(env: NodeJS.ProcessEnv): boolean {
  return String(env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

function resolveBoundaryAuthConfig(env: NodeJS.ProcessEnv): BoundaryAuthConfig {
  const rawMode = String(env[MODE_ENV_KEY] ?? "").trim();
  const parsedMode = resolveBoundaryAuthMode(rawMode);
  const production = isProductionEnv(env);

  if (!rawMode) {
    if (production) {
      return {
        mode: "none",
        sharedSecret: null,
        configError: `${MODE_ENV_KEY} must be configured in production`,
      };
    }
    return {
      mode: "none",
      sharedSecret: null,
      configError: null,
    };
  }

  if (!parsedMode) {
    return {
      mode: "none",
      sharedSecret: null,
      configError: `Unsupported ${MODE_ENV_KEY}: ${rawMode}`,
    };
  }

  if (parsedMode !== "shared_secret") {
    return {
      mode: parsedMode,
      sharedSecret: null,
      configError: null,
    };
  }

  const secret = String(env[SECRET_ENV_KEY] ?? "").trim();
  if (!secret) {
    return {
      mode: parsedMode,
      sharedSecret: null,
      configError: `${SECRET_ENV_KEY} is required when ${MODE_ENV_KEY}=shared_secret`,
    };
  }

  return {
    mode: parsedMode,
    sharedSecret: secret,
    configError: null,
  };
}

function readBearerToken(req: Request): string | null {
  const authHeader = req.get("authorization");
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1]?.trim() ?? "";
  return token.length > 0 ? token : null;
}

function sendConfigError(res: Response, message: string) {
  return res.status(503).json({
    error: {
      code: CONFIG_ERROR_CODE,
      message,
    },
  });
}

function sendRequiredError(res: Response) {
  return res.status(401).json({
    error: {
      code: REQUIRED_ERROR_CODE,
      message: "Missing or invalid bearer authorization.",
    },
  });
}

function sendInvalidError(res: Response) {
  return res.status(401).json({
    error: {
      code: INVALID_ERROR_CODE,
      message: "Invalid internal service authorization token.",
    },
  });
}

export function createWorkerBoundaryAuthMiddleware(env: NodeJS.ProcessEnv = process.env) {
  const config = resolveBoundaryAuthConfig(env);
  return (req: Request, res: Response, next: NextFunction) => {
    if (config.configError) {
      return sendConfigError(res, config.configError);
    }

    if (config.mode === "none") {
      return next();
    }

    const token = readBearerToken(req);
    if (!token) {
      return sendRequiredError(res);
    }

    if (config.mode === "shared_secret" && token !== config.sharedSecret) {
      return sendInvalidError(res);
    }

    return next();
  };
}
