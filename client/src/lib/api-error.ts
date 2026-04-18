export type ApiError = {
  status: number;
  code?: string;
  message: string;
  reason?: string;
  retryable?: boolean;
  details?: unknown;
};

export type PremiumDenialReason =
  | "premium_required"
  | "payment_required"
  | "payment_past_due"
  | "subscription_canceled"
  | "subscription_expired";

export class HttpApiError extends Error implements ApiError {
  status: number;
  code?: string;
  reason?: string;
  retryable?: boolean;
  details?: unknown;

  constructor(input: ApiError) {
    super(input.message);
    this.name = "HttpApiError";
    this.status = input.status;
    this.code = input.code;
    this.reason = input.reason;
    this.retryable = input.retryable;
    this.details = input.details;
  }
}

function readNestedErrorPayload(payload: any): Partial<ApiError> {
  if (!payload || typeof payload !== "object") return {};
  const nested = payload.error;
  if (!nested || typeof nested !== "object") return {};

  return {
    code: typeof nested.code === "string" ? nested.code : undefined,
    message: typeof nested.message === "string" ? nested.message : undefined,
    retryable: typeof nested.retryable === "boolean" ? nested.retryable : undefined,
  };
}

export async function parseApiErrorFromResponse(
  response: Response,
  fallbackMessage = "Request failed",
): Promise<HttpApiError> {
  let payload: any = null;
  try {
    payload = await response.clone().json();
  } catch {
    payload = null;
  }

  const nested = readNestedErrorPayload(payload);
  const message =
    nested.message ||
    (payload && typeof payload.message === "string" ? payload.message : undefined) ||
    (payload && typeof payload.error === "string" ? payload.error : undefined) ||
    fallbackMessage;

  const code =
    nested.code ||
    (payload && typeof payload.code === "string" ? payload.code : undefined) ||
    undefined;

  const reason =
    payload && typeof payload.reason === "string"
      ? payload.reason
      : payload && payload.entitlement && typeof payload.entitlement.reason === "string"
        ? payload.entitlement.reason
        : undefined;

  const retryable =
    typeof nested.retryable === "boolean"
      ? nested.retryable
      : payload && typeof payload.retryable === "boolean"
        ? payload.retryable
        : response.status >= 500;

  return new HttpApiError({
    status: response.status,
    code,
    message,
    reason,
    retryable,
    details: payload,
  });
}

export function isApiError(error: unknown): error is ApiError {
  return Boolean(
    error &&
      typeof error === "object" &&
      "status" in (error as any) &&
      typeof (error as any).status === "number" &&
      "message" in (error as any) &&
      typeof (error as any).message === "string",
  );
}

function normalizeCode(value: string | undefined): string | undefined {
  return value ? value.trim().toUpperCase() : undefined;
}

function normalizeReason(value: string | undefined): string | undefined {
  return value ? value.trim().toLowerCase() : undefined;
}

const entitlementCodes = new Set([
  "PREMIUM_REQUIRED",
  "PAYMENT_REQUIRED",
  "SUBSCRIPTION_REQUIRED",
]);

export function getPremiumDenialReason(error: unknown): PremiumDenialReason | null {
  if (!isApiError(error)) return null;
  if (error.status !== 402 && error.status !== 403) return null;

  const code = normalizeCode(error.code);
  const reason = normalizeReason(error.reason);

  if (reason === "payment_past_due") return "payment_past_due";
  if (reason === "subscription_canceled") return "subscription_canceled";
  if (reason === "subscription_expired") return "subscription_expired";

  if (code === "PAYMENT_REQUIRED") return "payment_required";
  if (code === "PREMIUM_REQUIRED" || code === "SUBSCRIPTION_REQUIRED") return "premium_required";
  if (entitlementCodes.has(code || "")) return "premium_required";

  return null;
}

export function isEntitlementDenialError(error: unknown): boolean {
  return getPremiumDenialReason(error) !== null;
}

export function isTransportError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (isApiError(error)) {
    return error.status >= 500 || error.status === 0;
  }
  return false;
}

