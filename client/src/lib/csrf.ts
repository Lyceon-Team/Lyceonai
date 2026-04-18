import { HttpApiError } from "./api-error";

let cachedToken: string | null = null;
let inflight: Promise<string> | null = null;
const MAX_CSRF_RECOVERY_RETRIES = 2;

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch("/api/csrf-token", { credentials: "include" });
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`Failed to fetch CSRF token: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { csrfToken?: string };
  if (!data?.csrfToken) {
    throw new Error("CSRF token missing in response");
  }
  return data.csrfToken;
}

export async function getCsrfToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  if (!inflight) {
    inflight = fetchCsrfToken()
      .then((token) => {
        cachedToken = token;
        return token;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function clearCsrfToken(): void {
  cachedToken = null;
  inflight = null;
}

function hasCsrfBlockedCode(payload: any): boolean {
  if (!payload || typeof payload !== "object") return false;

  const topError = typeof payload.error === "string" ? payload.error : "";
  const topCode = typeof payload.code === "string" ? payload.code : "";
  const nestedCode =
    payload.error && typeof payload.error === "object" && typeof payload.error.code === "string"
      ? payload.error.code
      : "";

  const normalized = [topError, topCode, nestedCode]
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  return normalized.includes("csrf_blocked");
}

async function getCsrfBlockedPayload(response: Response): Promise<unknown | null> {
  if (response.status !== 403) return null;
  try {
    const payload = await response.clone().json();
    return hasCsrfBlockedCode(payload) ? payload : null;
  } catch {
    return null;
  }
}

export async function csrfFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const method = (init?.method || "GET").toUpperCase();
  const shouldAttachToken = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";

  const makeAttempt = async (): Promise<Response> => {
    const headers = new Headers(init?.headers || {});
    if (shouldAttachToken) {
      const token = await getCsrfToken();
      headers.set("x-csrf-token", token);
    }

    // CSRF middleware rejects before route execution; bounded retries are safe.
    return fetch(input instanceof Request ? input.clone() : input, {
      ...init,
      headers,
      credentials: init?.credentials ?? "include",
    });
  };

  if (!shouldAttachToken) {
    return makeAttempt();
  }

  let attempts = 0;
  while (attempts <= MAX_CSRF_RECOVERY_RETRIES) {
    const response = await makeAttempt();
    const blockedPayload = await getCsrfBlockedPayload(response);
    if (!blockedPayload) {
      return response;
    }

    attempts += 1;
    if (attempts > MAX_CSRF_RECOVERY_RETRIES) {
      throw new HttpApiError({
        status: 403,
        code: "csrf_blocked",
        message: "Your session security token expired. Please refresh and try again.",
        retryable: false,
        details: blockedPayload,
      });
    }

    clearCsrfToken();
    await getCsrfToken();
  }

  throw new HttpApiError({
    status: 403,
    code: "csrf_blocked",
    message: "Your session security token expired. Please refresh and try again.",
    retryable: false,
  });
}
