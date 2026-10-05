// @vitest-environment jsdom
/**
 * Plan Q6: the review prompt's options — neutral, side by side, always dismissible, Trustpilot
 * only for 18+ and only once its URL exists.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R28 ("One neutral review prompt ... no review
 *       gating. Options side by side ... Trustpilot (guardians + 18+)"), R30 ("always
 *       dismissible"), row Q6; Doctrine §0.8 (no review gating); owner answers 2026-10-05]
 *       | @implemented [2026-10-05]
 *
 * plain English: the real component with a real React Query client; only the network is
 * stubbed, answering GET /api/feedback/prompt with what the server would say. Proved: nothing
 * renders without a "show"; every option is offered BEFORE anything is asked (no sentiment
 * first, nothing hidden behind a rating); the Trustpilot option needs both the server's 18+ and
 * VITE_TRUSTPILOT_REVIEW_URL; the quote box starts unticked and is sent as chosen; "Not now"
 * records one dismissal and closes.
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

const net = vi.hoisted(() => ({
  prompt: { show: false } as Record<string, unknown>,
  log: [] as { method: string; url: string; body: unknown }[],
}));

vi.mock("@/lib/csrf", () => ({
  csrfFetch: async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    net.log.push({
      method,
      url,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (url.startsWith("/api/feedback/prompt?")) {
      return Response.json({ data: net.prompt });
    }
    if (url === "/api/feedback/reviews") {
      return Response.json({ data: { outcome: "created" } }, { status: 201 });
    }
    if (url === "/api/profile") {
      return Response.json({ authenticated: true, user: null });
    }
    return new Response(null, { status: 204 });
  },
}));

import { ReviewPrompt } from "./ReviewPrompt";

const TRUSTPILOT = "https://www.trustpilot.com/evaluate/example";

function mount(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ReviewPrompt query={{ moment: "study_week" }} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  net.log = [];
  vi.stubEnv("VITE_TRUSTPILOT_REVIEW_URL", TRUSTPILOT);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("ReviewPrompt", () => {
  it("renders nothing when the server says no", async () => {
    net.prompt = { show: false };
    mount();
    await waitFor(() => expect(net.log.length).toBeGreaterThan(0));
    expect(screen.queryByTestId("review-prompt")).toBeNull();
  });

  it("offers every option side by side before asking anything (no gating)", async () => {
    net.prompt = { show: true, trustpilot_eligible: true };
    mount();
    const options = await screen.findByTestId("review-prompt-options");
    expect(options.textContent).toContain("Leave a review");
    expect(options.textContent).toContain("Review on Trustpilot");
    expect(options.textContent).toContain("Send private feedback");
    expect(options.textContent).toContain("Not now");
    // Nothing about how the person feels is asked before the options.
    expect(screen.queryByTestId("review-rating")).toBeNull();
  });

  it("hides Trustpilot from an under-18 account even when the URL exists", async () => {
    net.prompt = { show: true, trustpilot_eligible: false };
    mount();
    await screen.findByTestId("review-prompt-options");
    expect(screen.queryByTestId("review-prompt-trustpilot")).toBeNull();
  });

  it("hides Trustpilot until VITE_TRUSTPILOT_REVIEW_URL is set, even for 18+", async () => {
    vi.stubEnv("VITE_TRUSTPILOT_REVIEW_URL", "");
    net.prompt = { show: true, trustpilot_eligible: true };
    mount();
    await screen.findByTestId("review-prompt-options");
    expect(screen.queryByTestId("review-prompt-trustpilot")).toBeNull();
  });

  it("the Trustpilot option opens the configured URL in a new tab and records the click", async () => {
    net.prompt = { show: true, trustpilot_eligible: true };
    mount();
    const link = await screen.findByTestId("review-prompt-trustpilot");
    expect(link.getAttribute("href")).toBe(TRUSTPILOT);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    fireEvent.click(link);
    await waitFor(() =>
      expect(net.log.map((c) => `${c.method} ${c.url}`)).toContain(
        "POST /api/feedback/prompt/trustpilot",
      ),
    );
  });

  it("'Not now' records one dismissal and closes", async () => {
    net.prompt = { show: true, trustpilot_eligible: false };
    mount();
    fireEvent.click(await screen.findByTestId("review-prompt-not-now"));
    await waitFor(() =>
      expect(screen.queryByTestId("review-prompt")).toBeNull(),
    );
    expect(
      net.log.filter((c) => c.url === "/api/feedback/prompt/dismiss"),
    ).toHaveLength(1);
  });

  it("the quote box starts unticked and the review is sent as chosen", async () => {
    net.prompt = { show: true, trustpilot_eligible: false };
    mount();
    fireEvent.click(await screen.findByTestId("review-prompt-leave-review"));
    const quote = screen.getByTestId("review-quote-permission");
    expect(quote.getAttribute("data-state")).toBe("unchecked");
    fireEvent.click(screen.getByTestId("review-rating-4"));
    fireEvent.change(screen.getByTestId("review-text"), {
      target: { value: "  Useful plan.  " },
    });
    fireEvent.click(screen.getByTestId("review-submit"));
    await screen.findByText("Thanks for your review");
    const sent = net.log.find((c) => c.url === "/api/feedback/reviews");
    expect(sent?.body).toEqual({
      rating: 4,
      body: "Useful plan.",
      quote_permission: false,
    });
  });
});
