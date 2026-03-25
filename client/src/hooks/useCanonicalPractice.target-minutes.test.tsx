// @vitest-environment jsdom
import React from "react";
import { render, waitFor } from "@testing-library/react";
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
  useCanonicalPractice("math", { targetMinutes: 30 });
  return null;
}

describe("useCanonicalPractice target_minutes contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends target_minutes in canonical session creation payload", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = asUrl(input);
      const method = init?.method ?? "GET";

      if (url === "/api/practice/sessions" && method === "POST") {
        return jsonResponse({ sessionId: "session-1" });
      }

      if (url.startsWith("/api/practice/sessions/session-1/next?client_instance_id=") && method === "GET") {
        return jsonResponse({
          sessionId: "session-1",
          sessionItemId: "item-1",
          ordinal: 1,
          state: "active",
          question: {
            sessionItemId: "item-1",
            questionType: "multiple_choice",
            stem: "What is 2 + 2?",
            section: "Math",
            options: [
              { id: "A", text: "4" },
              { id: "B", text: "5" },
            ],
          },
          stats: {
            correct: 0,
            incorrect: 0,
            skipped: 0,
            total: 0,
            streak: 0,
          },
        });
      }

      return jsonResponse({ error: `Unexpected URL ${url}` }, 500);
    });

    render(<Harness />);

    await waitFor(() => {
      const startCall = fetchMock.mock.calls.find(([input, requestInit]) => {
        return asUrl(input) === "/api/practice/sessions" && (requestInit?.method ?? "GET") === "POST";
      });
      expect(startCall).toBeDefined();
    });

    const startCall = fetchMock.mock.calls.find(([input, requestInit]) => {
      return asUrl(input) === "/api/practice/sessions" && (requestInit?.method ?? "GET") === "POST";
    });
    const payload = JSON.parse((startCall?.[1]?.body as string) || "{}");

    expect(payload.section).toBe("math");
    expect(payload.target_minutes).toBe(30);
  });
});
