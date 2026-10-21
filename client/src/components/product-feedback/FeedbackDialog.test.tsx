// @vitest-environment jsdom
/**
 * The private feedback dialog: Bug · Idea · Something else, the message, "May we reply by
 * email?" and the context it attaches.
 *
 * @spec [final brief "Trustpilot card on the homepage + 'Feedback' across the site" (Karl,
 *       2026-10-20) §3: the type, the 2,000-character message, the reply checkbox (default off,
 *       hidden for under-13s), the route pattern only and the app version, no screenshots and no
 *       student work] | @implemented [2026-10-20]
 *
 * plain English: the real dialog with a real React Query client; only the network is stubbed,
 * and the profile is seeded as GET /api/profile sends it. What is asserted is the request body.
 */
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROFILE_QUERY_KEY } from "@/hooks/useProfileQuery";

const net = vi.hoisted(() => ({
  log: [] as { url: string; body: Record<string, unknown> | null }[],
}));

vi.mock("@/lib/csrf", () => ({
  csrfFetch: async (url: string, init?: RequestInit): Promise<Response> => {
    net.log.push({
      url,
      body: init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : null,
    });
    if (url === "/api/feedback/feedback") {
      return Response.json({ data: { outcome: "created" } }, { status: 201 });
    }
    return new Response(null, { status: 204 });
  },
}));

import { FeedbackDialog } from "./FeedbackDialog";

const SESSION = "5e5e5e5e-1111-4222-8333-444444444444";

function mount(user: { role: string; dateOfBirth: string | null }): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(PROFILE_QUERY_KEY, {
    authenticated: true,
    featureAccess: null,
    user: { id: "u1", email: null, ...user },
  });
  render(
    <QueryClientProvider client={client}>
      <FeedbackDialog open onOpenChange={() => undefined} source="menu" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  net.log = [];
  window.history.pushState({}, "", `/practice/session/${SESSION}?step=2#q4`);
});
afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("FeedbackDialog", () => {
  it("offers Bug · Idea · Something else as one control, Bug first", () => {
    mount({ role: "student", dateOfBirth: "2009-01-01" });
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual([
      "Bug",
      "Idea",
      "Something else",
    ]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
    ]);
  });

  it("sends the type, the text, the reply choice, the route pattern (no id, no query) and the version", async () => {
    mount({ role: "student", dateOfBirth: "2009-01-01" });
    fireEvent.click(screen.getByTestId("feedback-type-idea"));
    fireEvent.change(screen.getByTestId("feedback-text"), {
      target: { value: "  More practice on circles.  " },
    });
    const reply = screen.getByTestId("feedback-reply-ok");
    expect(reply.getAttribute("data-state")).toBe("unchecked");
    fireEvent.click(reply);
    expect(screen.getByTestId("feedback-context-note").textContent).toBe(
      "We'll include the page you're on and the app version.",
    );
    fireEvent.click(screen.getByTestId("feedback-send"));
    await waitFor(() =>
      expect(
        net.log.find((c) => c.url === "/api/feedback/feedback"),
      ).toBeTruthy(),
    );
    const sent = net.log.find((c) => c.url === "/api/feedback/feedback")?.body;
    expect(sent).toMatchObject({
      body: "More practice on circles.",
      source: "menu",
      type: "idea",
      reply_ok: true,
      route_pattern: "/practice/session/:sessionId",
    });
    expect(Object.keys(sent ?? {}).sort()).toEqual([
      "app_version",
      "body",
      "idempotency_key",
      "reply_ok",
      "route_pattern",
      "source",
      "type",
    ]);
    expect(JSON.stringify(sent)).not.toContain(SESSION);
    expect(JSON.stringify(sent)).not.toContain("step=");
  });

  it("an under-13 student never sees the reply checkbox, and never sends reply_ok true", async () => {
    mount({
      role: "student",
      dateOfBirth: `${new Date().getUTCFullYear() - 11}-01-01`,
    });
    expect(screen.getByTestId("feedback-text")).toBeTruthy(); // presence first
    expect(screen.queryByTestId("feedback-reply-ok")).toBeNull();
    fireEvent.change(screen.getByTestId("feedback-text"), {
      target: { value: "Hi" },
    });
    fireEvent.click(screen.getByTestId("feedback-send"));
    await waitFor(() =>
      expect(
        net.log.find((c) => c.url === "/api/feedback/feedback")?.body,
      ).toMatchObject({ reply_ok: false }),
    );
  });

  it("a guardian (no date of birth) sees the reply checkbox, off by default", () => {
    mount({ role: "guardian", dateOfBirth: null });
    expect(
      screen.getByTestId("feedback-reply-ok").getAttribute("data-state"),
    ).toBe("unchecked");
  });

  it("the message is required and capped at 2,000 characters", () => {
    mount({ role: "student", dateOfBirth: "2009-01-01" });
    expect(
      (screen.getByTestId("feedback-send") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId("feedback-text").getAttribute("maxlength")).toBe(
      "2000",
    );
  });
});
