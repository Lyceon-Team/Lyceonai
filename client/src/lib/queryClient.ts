import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { clearCsrfToken, csrfFetch } from "./csrf";
import { parseApiErrorFromResponse } from "./api-error";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    throw await parseApiErrorFromResponse(res, res.statusText || "Request failed");
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
    const isApiPath = parsed.pathname === "/api" || parsed.pathname.startsWith("/api/");

    // For app API calls, always use a same-origin path to avoid apex/www drift.
    if (isApiPath) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // Fall through to original value when URL parsing fails.
  }

  return url;
}

async function fetchWithSessionRefresh(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const requestUrl = normalizeApiRequestUrl(url);

  const doFetch = () => csrfFetch(requestUrl, {
    ...init,
    credentials: "include",
  });

  let res = await doFetch();

  const isAuthEndpoint = requestUrl.startsWith("/api/auth/");
  const shouldAttemptRefresh = !isAuthEndpoint && (res.status === 401 || res.status === 403);

  if (shouldAttemptRefresh) {
    const refreshRes = await csrfFetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    });

    if (refreshRes.ok) {
      // Refresh changes session identity cookies, so force a fresh CSRF token next mutation.
      clearCsrfToken();
      res = await doFetch();
    }
  }

  return res;
}

type ApiRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | FormData;
};

export async function apiRequestRaw(
  url: string,
  options?: ApiRequestOptions
): Promise<Response> {
  const { method = 'GET', headers = {}, body } = options || {};
  
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
  options?: ApiRequestOptions
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
    if (url.includes('/api/questions') && data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.questions)) {
      return data.questions;
    }
    
    return data;
  };

export const queryClient = new QueryClient({
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
