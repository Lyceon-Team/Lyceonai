// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken, csrfFetch, getCsrfToken } from "./csrf";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("csrfFetch recovery", () => {
  beforeEach(() => {
    clearCsrfToken();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearCsrfToken();
  });

  it("retries csrf_blocked responses up to two times with fresh tokens", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "/api/csrf-token") {
        const token = `token-${fetchMock.mock.calls.filter(([callInput]) => {
          const callUrl = typeof callInput === "string" ? callInput : callInput instanceof URL ? callInput.toString() : callInput.url;
          return callUrl === "/api/csrf-token";
        }).length}`;
        return jsonResponse({ csrfToken: token }, 200);
      }

      if (url === "/api/test/mutate") {
        const mutationCalls = fetchMock.mock.calls.filter(([callInput]) => {
          const callUrl = typeof callInput === "string" ? callInput : callInput instanceof URL ? callInput.toString() : callInput.url;
          return callUrl === "/api/test/mutate";
        }).length;
        if (mutationCalls < 3) {
          return jsonResponse({ error: "csrf_blocked" }, 403);
        }
        return jsonResponse({ ok: true }, 200);
      }

      return jsonResponse({ error: "Unexpected URL" }, 500);
    });

    const response = await csrfFetch("/api/test/mutate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      credentials: "include",
    });

    expect(response.status).toBe(200);

    const mutationCalls = fetchMock.mock.calls.filter(([input]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return url === "/api/test/mutate";
    });
    const csrfHeaderValues = mutationCalls.map(([, init]) => new Headers((init as RequestInit).headers).get("x-csrf-token"));
    expect(csrfHeaderValues).toEqual(["token-1", "token-2", "token-3"]);
  });

  it("throws csrf_blocked after two recovery retries fail", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "/api/csrf-token") {
        return jsonResponse({ csrfToken: "token-blocked" }, 200);
      }
      if (url === "/api/test/fail") {
        return jsonResponse({ error: "csrf_blocked" }, 403);
      }
      return jsonResponse({ error: "Unexpected URL" }, 500);
    });

    await expect(
      csrfFetch("/api/test/fail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        credentials: "include",
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "csrf_blocked",
    });
  });

  it("clearCsrfToken invalidates cached token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url !== "/api/csrf-token") {
        return jsonResponse({ error: "Unexpected URL" }, 500);
      }
      const callCount = fetchMock.mock.calls.length;
      return jsonResponse({ csrfToken: `token-${callCount}` }, 200);
    });

    const first = await getCsrfToken();
    const second = await getCsrfToken();
    clearCsrfToken();
    const third = await getCsrfToken();

    expect(first).toBe(second);
    expect(third).not.toBe(first);
  });
});

