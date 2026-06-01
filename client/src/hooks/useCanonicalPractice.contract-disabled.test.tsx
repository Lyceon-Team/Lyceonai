// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCanonicalPractice } from "./useCanonicalPractice";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function asUrl(input: RequestInfo | URL): string {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  try {
    const parsed = new URL(raw);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return raw;
  }
}

function Harness() {
  const state = useCanonicalPractice("math");
  return (
    <div>
      <div data-testid="runtime-disabled-code">{state.runtimeDisabled?.code ?? ""}</div>
      <div data-testid="is-loading">{state.isLoading ? "yes" : "no"}</div>
      <div data-testid="error">{state.error ?? ""}</div>
    </div>
  );
}

describe("useCanonicalPractice contract-disable behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("enters terminal-disabled state on contract 503 and does not continue runtime fetch loops", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = asUrl(input);
      if (url === "/api/csrf-token") {
        return jsonResponse({ csrfToken: "csrf-test-token" });
      }
      if (url === "/api/practice/sessions") {
        return jsonResponse(
          {
            code: "PRACTICE_RUNTIME_DISABLED_BY_CONTRACT",
            message: "This runtime surface is intentionally disabled by Lyceon Runtime Contract enforcement.",
            requestId: "req-practice-1",
          },
          503,
        );
      }
      return jsonResponse({ error: `Unexpected URL ${url}` }, 500);
    });

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("runtime-disabled-code").textContent).toBe("PRACTICE_RUNTIME_DISABLED_BY_CONTRACT");
      expect(screen.getByTestId("is-loading").textContent).toBe("no");
    });

    const calledUrls = fetchMock.mock.calls.map(([input]) => asUrl(input));
    const nonCsrfUrls = calledUrls.filter((url) => url !== "/api/csrf-token");
    expect(calledUrls).toContain("/api/practice/sessions");
    expect(nonCsrfUrls.some((url) => url.includes("/api/practice/sessions/") && url.includes("/next"))).toBe(false);
    expect(nonCsrfUrls.length).toBe(1);
  });
});
