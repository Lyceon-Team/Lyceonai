import type { NextFunction, Request, RequestHandler, Response } from "express";

export type RuntimeContractDomain = "practice" | "full-length" | "review" | "diagnostic";

export const RUNTIME_CONTRACT_DISABLE_CODE: Record<RuntimeContractDomain, string> = {
  practice: "PRACTICE_RUNTIME_DISABLED_BY_CONTRACT",
  "full-length": "FULL_LENGTH_RUNTIME_DISABLED_BY_CONTRACT",
  review: "REVIEW_RUNTIME_DISABLED_BY_CONTRACT",
  diagnostic: "DIAGNOSTIC_RUNTIME_DISABLED_BY_CONTRACT",
};

export const RUNTIME_CONTRACT_DISABLE_MESSAGE =
  "This runtime surface is intentionally disabled by Lyceon Runtime Contract enforcement.";

function formatDomainError(domain: RuntimeContractDomain): string {
  if (domain === "full-length") return "Full-length runtime disabled by contract";
  if (domain === "practice") return "Practice runtime disabled by contract";
  if (domain === "diagnostic") return "Diagnostic runtime disabled by contract";
  return "Review runtime disabled by contract";
}

export function sendRuntimeContractDisabled(
  req: Request,
  res: Response,
  domain: RuntimeContractDomain,
): Response {
  return res.status(503).json({
    error: formatDomainError(domain),
    code: RUNTIME_CONTRACT_DISABLE_CODE[domain],
    message: RUNTIME_CONTRACT_DISABLE_MESSAGE,
    requestId: req.requestId,
  });
}

export function runtimeContractDisableMiddleware(domain: RuntimeContractDomain): RequestHandler {
  return (req: Request, res: Response, _next: NextFunction) => {
    return sendRuntimeContractDisabled(req, res, domain);
  };
}
