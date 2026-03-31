let cachedToken: string | null = null;
let inflight: Promise<string> | null = null;

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

export async function csrfFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const method = (init?.method || "GET").toUpperCase();
  const shouldAttachToken = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  const headers = new Headers(init?.headers || {});

  if (shouldAttachToken) {
    const token = await getCsrfToken();
    headers.set("x-csrf-token", token);
  }

  return fetch(input, {
    ...init,
    headers,
    credentials: init?.credentials ?? "include",
  });
}
