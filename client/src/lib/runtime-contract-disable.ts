export type RuntimeContractDomain = "practice" | "full-length" | "review";

export const RUNTIME_CONTRACT_DISABLE_CODES = {
  practice: "PRACTICE_RUNTIME_DISABLED_BY_CONTRACT",
  "full-length": "FULL_LENGTH_RUNTIME_DISABLED_BY_CONTRACT",
  review: "REVIEW_RUNTIME_DISABLED_BY_CONTRACT",
} as const;

const KNOWN_CODES = new Set<string>(Object.values(RUNTIME_CONTRACT_DISABLE_CODES));

export type RuntimeContractDisabledState = {
  domain: RuntimeContractDomain;
  code: string;
  message: string;
};

export function getRuntimeContractDisabledCopy(domain: RuntimeContractDomain): {
  title: string;
  description: string;
} {
  const label = domain === "full-length" ? "Full-Length" : domain === "practice" ? "Practice" : "Review";
  return {
    title: `${label} Temporarily Disabled`,
    description: "This runtime surface is intentionally disabled by Lyceon Runtime Contract enforcement.",
  };
}

export function isRuntimeContractDisabledCode(code: unknown): code is string {
  return typeof code === "string" && KNOWN_CODES.has(code);
}

function extractCodeFromErrorMessage(message: string): string | null {
  for (const code of KNOWN_CODES) {
    if (message.includes(code)) return code;
  }
  return null;
}

export function parseRuntimeContractDisabledFromPayload(
  domain: RuntimeContractDomain,
  status: number,
  payload: any,
): RuntimeContractDisabledState | null {
  const code = payload?.code;
  if (status !== 503 || !isRuntimeContractDisabledCode(code)) return null;
  if (code !== RUNTIME_CONTRACT_DISABLE_CODES[domain]) return null;

  const message = typeof payload?.message === "string" && payload.message.trim().length > 0
    ? payload.message
    : getRuntimeContractDisabledCopy(domain).description;

  return { domain, code, message };
}

export function parseRuntimeContractDisabledFromError(
  domain: RuntimeContractDomain,
  error: unknown,
): RuntimeContractDisabledState | null {
  if (!(error instanceof Error)) return null;
  const code = extractCodeFromErrorMessage(error.message);
  if (!code) return null;
  if (code !== RUNTIME_CONTRACT_DISABLE_CODES[domain]) return null;
  return {
    domain,
    code,
    message: getRuntimeContractDisabledCopy(domain).description,
  };
}
