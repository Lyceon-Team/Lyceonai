import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryFunction,
} from "@tanstack/react-query";
import { csrfFetch } from "./csrf";
import { onboardingRedirectFor, parseApiErrorFromResponse } from "./api-error";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    throw await parseApiErrorFromResponse(
      res,
      res.statusText || "Request failed",
    );
  }
}

function normalizeApiRequestUrl(rawUrl: string): string {
  const url = String(rawUrl || "").trim();
  if (!url) return rawUrl;

  // Keep relative paths as-is.
  if (url.startsWith("/")) return url;

  if (typeof window === "undefined") {
    return url;
  }

  try {
    const parsed = new URL(url, window.location.origin);
    const isApiPath =
      parsed.pathname === "/api" || parsed.pathname.startsWith("/api/");

    // For app API calls, always use a same-origin path to avoid apex/www drift.
    if (isApiPath) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // Fall through to original value when URL parsing fails.
  }

  return url;
}

// AUTH-001: session refresh is now native. The server's @supabase/ssr middleware transparently
// refreshes the Supabase session (rotating the httpOnly session cookie) on every authenticated
// request, so there is no client-callable /api/auth/refresh endpoint and no retry-on-401 dance.
// A persistent 401/403 means the session is genuinely invalid and the caller should treat the user
// as signed out. The function name/signature is preserved so existing call sites stay unchanged.
async function fetchWithSessionRefresh(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const requestUrl = normalizeApiRequestUrl(url);

  return csrfFetch(requestUrl, {
    ...init,
    credentials: "include",
  });
}

type ApiRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | FormData;
};

export async function apiRequestRaw(
  url: string,
  options?: ApiRequestOptions,
): Promise<Response> {
  const { method = "GET", headers = {}, body } = options || {};

  // For FormData, let the browser set Content-Type automatically with boundary
  const isFormData = body instanceof FormData;

  const res = await fetchWithSessionRefresh(url, {
    method,
    headers: {
      ...(!isFormData && body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body,
  });

  return res;
}

export async function apiRequest(
  url: string,
  options?: ApiRequestOptions,
): Promise<Response> {
  const res = await apiRequestRaw(url, options);
  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey.join("/") as string;
    const res = await fetchWithSessionRefresh(url);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    const data = await res.json();

    // Handle wrapped question responses: { questions: [], meta: {} }
    // Extract the array for question endpoints
    if (
      url.includes("/api/questions") &&
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      Array.isArray(data.questions)
    ) {
      return data.questions;
    }

    return data;
  };

/**
 * The full-page navigation the onboarding redirect uses. A full load (not a client route
 * change) so `RequireRole`'s cached `/api/profile` — staleTime Infinity — is read afresh and
 * agrees with the page it lands on. An object so a test can observe it; jsdom cannot navigate.
 */
export const navigation = {
  assign(path: string): void {
    window.location.assign(path);
  },
};

/**
 * G2-06: any query or mutation refused with 403 PROFILE_INCOMPLETE sends the student to profile
 * completion; G-NEW-10: 403 GUARDIAN_LINK_REQUIRED (an under-13 student whose last active
 * guardian link was just revoked) sends them to /guardian-required at once, instead of leaving
 * them on a page of refused requests until the next reload. One place, so no page has to know
 * the codes. A no-op when already there (no loop).
 */
export function redirectForOnboarding(
  error: unknown,
  navigate: (path: string) => void = (path) => navigation.assign(path),
): void {
  const path = onboardingRedirectFor(error);
  if (!path || typeof window === "undefined") return;
  if (window.location.pathname === path) return;
  navigate(path);
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => redirectForOnboarding(error),
  }),
  mutationCache: new MutationCache({
    onError: (error) => redirectForOnboarding(error),
  }),
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
