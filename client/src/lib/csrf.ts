import { HttpApiError } from "./api-error";

let cachedToken: string | null = null;
let inflight: Promise<string> | null = null;
const MAX_CSRF_RECOVERY_RETRIES = 2;

async function fetchCsrfToken(): Promise<string> {
  console.log("[CSRF] Fetching fresh token from server...");
  const res = await fetch("/api/csrf-token", { credentials: "include" });
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    console.error("[CSRF] Failed to fetch token:", res.status, text);
    throw new Error(`Failed to fetch CSRF token: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { csrfToken?: string };
  if (!data?.csrfToken) {
    console.error("[CSRF] Token missing in server response body");
    throw new Error("CSRF token missing in response");
  }
  console.log("[CSRF] Successfully received token");
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
      .catch((err) => {
        console.error("[CSRF] Inflight token fetch failed:", err);
        throw err;
      })
      .finally(() => {
        inflight = null;
      });
  } else {
    console.log("[CSRF] Awaiting existing inflight token request...");
  }
  return inflight;
}

export function clearCsrfToken(): void {
  console.log("[CSRF] Clearing cached token");
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
  const url = typeof input === "string" ? input : (input instanceof URL ? input.href : input.url);

  const makeAttempt = async (): Promise<Response> => {
    const headers = new Headers(init?.headers || {});
    if (shouldAttachToken) {
      const token = await getCsrfToken();
      headers.set("x-csrf-token", token);
    }

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
    if (attempts > 0) {
      console.log(`[CSRF] Retrying request to ${url} (attempt ${attempts + 1}/${MAX_CSRF_RECOVERY_RETRIES + 1})...`);
    }

    const response = await makeAttempt();
    const blockedPayload = await getCsrfBlockedPayload(response);
    
    if (!blockedPayload) {
      return response;
    }

    attempts += 1;
    if (attempts > MAX_CSRF_RECOVERY_RETRIES) {
      console.error(`[CSRF] Max retries reached for ${url}. Throwing recovery error.`);
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
