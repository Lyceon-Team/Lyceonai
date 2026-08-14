// @vitest-environment jsdom
/**
 * @spec [Doc-05C §7.4, Doc-01_V8 §20–24 diagnostic session creation]
 * @implemented 2026-08-14
 *
 * plain English: tests the useDiagnosticStart hook — verifying 201 (fresh creation),
 * 409 (seamless resume via existingSessionId), 503 (curated error, never raw), and
 * generic error handling. Also confirms the hook sends client_instance_id and
 * idempotency_key in the POST body.
 *
 * expected outcome: all four server-side outcomes map correctly to return values
 * and error states without leaking raw server messages to the student.
 *
 * trade-offs: uses renderHook from @testing-library/react; mocks global fetch.
 */
import { renderHook, act } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useDiagnosticStart } from "./useDiagnosticStart";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function asUrl(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  try {
    const parsed = new URL(raw);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return raw;
  }
}

describe("useDiagnosticStart", () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetchForDiagnostic(diagnosticResponse: Response): void {
    fetchMock.mockImplementation(async (input) => {
      const url = asUrl(input);
      if (url === "/api/csrf-token") {
        return jsonResponse({ csrfToken: "csrf-test-token" });
      }
      if (url === "/api/practice/diagnostic/sessions") {
        return diagnosticResponse;
      }
      return jsonResponse({ error: "Unexpected URL" }, 500);
    });
  }

  it("returns sessionId on 201 (fresh diagnostic creation)", async () => {
    mockFetchForDiagnostic(
      jsonResponse({ sessionId: "diag-session-123" }, 201),
    );

    const { result } = renderHook(() => useDiagnosticStart());

    let sessionId: string | null = null;
    await act(async () => {
      sessionId = await result.current.startDiagnostic();
    });

    expect(sessionId).toBe("diag-session-123");
    expect(result.current.error).toBeNull();
    expect(result.current.isStarting).toBe(false);
  });

  it("returns existingSessionId on 409 (seamless resume)", async () => {
    mockFetchForDiagnostic(
      jsonResponse(
        {
          error: "diagnostic_session_active",
          existingSessionId: "existing-diag-456",
        },
        409,
      ),
    );

    const { result } = renderHook(() => useDiagnosticStart());

    let sessionId: string | null = null;
    await act(async () => {
      sessionId = await result.current.startDiagnostic();
    });

    expect(sessionId).toBe("existing-diag-456");
    expect(result.current.error).toBeNull();
  });

  it("shows curated error on 503 diagnostic_insufficient_coverage — never raw", async () => {
    mockFetchForDiagnostic(
      jsonResponse(
        {
          error: "diagnostic_insufficient_coverage",
          message: "Only 6 domains have sufficient question counts (need 8)",
        },
        503,
      ),
    );

    const { result } = renderHook(() => useDiagnosticStart());

    let sessionId: string | null = null;
    await act(async () => {
      sessionId = await result.current.startDiagnostic();
    });

    expect(sessionId).toBeNull();
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.code).toBe("diagnostic_insufficient_coverage");
    // Curated message — must NOT contain raw domain-count strings
    expect(result.current.error?.message).toBe(
      "The diagnostic isn't available right now — we're adding more questions. Please try again later.",
    );
    // Anti-leak: the raw server message must not appear
    expect(result.current.error?.message).not.toContain("6 domains");
    expect(result.current.error?.message).not.toContain("need 8");
  });

  it("shows FIXED generic error on unexpected server error — never raw body.message", async () => {
    mockFetchForDiagnostic(
      jsonResponse(
        { error: "internal_error", message: "Database timeout" },
        500,
      ),
    );

    const { result } = renderHook(() => useDiagnosticStart());

    let sessionId: string | null = null;
    await act(async () => {
      sessionId = await result.current.startDiagnostic();
    });

    expect(sessionId).toBeNull();
    expect(result.current.error).not.toBeNull();
    // Must show the fixed generic message — never the raw server message.
    expect(result.current.error?.message).toBe(
      "Something went wrong starting the diagnostic.",
    );
    // Anti-leak: raw server message must NOT reach the student.
    expect(result.current.error?.message).not.toContain("Database timeout");
    expect(result.current.error?.code).toBe("internal_error");
  });

  it("shows network error on fetch failure", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = asUrl(input);
      if (url === "/api/csrf-token") {
        return jsonResponse({ csrfToken: "csrf-test-token" });
      }
      throw new TypeError("Failed to fetch");
    });

    const { result } = renderHook(() => useDiagnosticStart());

    let sessionId: string | null = null;
    await act(async () => {
      sessionId = await result.current.startDiagnostic();
    });

    expect(sessionId).toBeNull();
    expect(result.current.error?.message).toBe(
      "Unable to connect right now. Please check your connection and try again.",
    );
  });

  it("sends client_instance_id and idempotency_key in the POST body", async () => {
    mockFetchForDiagnostic(
      jsonResponse({ sessionId: "diag-session-789" }, 201),
    );

    const { result } = renderHook(() => useDiagnosticStart());

    await act(async () => {
      await result.current.startDiagnostic();
    });

    const diagnosticCall = fetchMock.mock.calls.find(([input]) => {
      const url = asUrl(input);
      return url === "/api/practice/diagnostic/sessions";
    });

    expect(diagnosticCall).toBeDefined();
    const [, init] = diagnosticCall!;
    const body = JSON.parse(init?.body as string);
    expect(body.client_instance_id).toBeDefined();
    expect(typeof body.client_instance_id).toBe("string");
    expect(body.idempotency_key).toBeDefined();
    expect(typeof body.idempotency_key).toBe("string");
    // UUID v4 format check
    expect(body.idempotency_key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("clearError resets the error state", async () => {
    mockFetchForDiagnostic(
      jsonResponse({ error: "some_error", message: "Oops" }, 500),
    );

    const { result } = renderHook(() => useDiagnosticStart());

    await act(async () => {
      await result.current.startDiagnostic();
    });

    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });
});
