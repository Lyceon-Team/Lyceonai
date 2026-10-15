// @vitest-environment jsdom
/**
 * The guardian's "Daily summary email" switch: ON until turned off, the server's answer shown.
 *
 * @spec [owner brief "Guardian accountability loop" (Karl, 2026-10-13) "Delivery": "The guardian
 *        can turn the digest email off in their notification settings (default on)"]
 *        | @implemented [2026-10-13]
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

const URL = "/api/guardian/notification-preferences/daily-digest";
const net = vi.hoisted(() => ({
  enabled: true,
  fail: false,
  log: [] as { method: string; url: string; body: unknown }[],
}));
vi.mock("@/lib/csrf", () => ({
  csrfFetch: async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const method = init?.method ?? "GET";
    net.log.push({ method, url, body });
    if (net.fail) return Response.json({ error: "boom" }, { status: 500 });
    if (url === URL && method === "PUT") {
      net.enabled = (body as { enabled: boolean }).enabled;
    }
    if (url === URL) return Response.json({ data: { enabled: net.enabled } });
    return Response.json({ authenticated: true, user: null });
  },
}));

import { GuardianDigestEmailCard } from "./GuardianDigestEmailCard";

function mount(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <GuardianDigestEmailCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  net.enabled = true;
  net.fail = false;
  net.log = [];
});
afterEach(cleanup);

describe("GuardianDigestEmailCard", () => {
  it("shows the server's ON and turns it off with one PUT of { enabled: false }", async () => {
    mount();
    const box = await screen.findByTestId("guardian-digest-email-toggle");
    expect(box).toHaveAttribute("data-state", "checked");
    fireEvent.click(box);
    await waitFor(() =>
      expect(net.log).toContainEqual({
        method: "PUT",
        url: URL,
        body: { enabled: false },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("guardian-digest-email-toggle"),
      ).toHaveAttribute("data-state", "unchecked"),
    );
    // In-app is not switchable, and the card says so.
    expect(
      screen.getByText(/still appear in your notifications/),
    ).toBeInTheDocument();
  });

  it("says when the setting cannot be read, rather than showing a guess", async () => {
    net.fail = true;
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't load");
    expect(screen.queryByTestId("guardian-digest-email-toggle")).toBeNull();
  });
});
