// @vitest-environment jsdom
/**
 * The homepage paid card quotes a real price, or none at all.
 *
 * @spec [Doc 09 §1.4, §5.1 Stripe canonical for pricing magnitudes at runtime;
 *        owner ruling 2026-09-03 "publish the monthly price"]
 * @implemented [2026-09-03]
 *
 * plain English: renders the page as a logged-out visitor sees it and checks
 * what the browser would actually show. Expected outcome: the amount Stripe
 * returned, and on any failure no amount whatsoever.
 *
 * THE SECOND TEST IS THE ONE THAT MATTERS. A price that renders is visible the
 * moment anyone looks at the page; a price that renders as `$NaN`, or as a
 * stale constant nobody can be charged, ships quietly. `upgrade.tsx:92` already
 * carries that shape — it spreads the API row over a fallback row, so a null
 * amount overwrites the fallback and reaches the formatter. This asserts the
 * absence, because absence is what breaks silently.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import HomePage from "./home";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    isAuthenticated: false,
    isGuardian: false,
    signOut: vi.fn(),
  }),
}));

vi.mock("wouter", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useLocation: () => ["/", vi.fn()],
}));

const fetchMock = vi.fn();

function withClient(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("homepage paid card price", () => {
  it("renders the monthly amount the endpoint returned, to a logged-out visitor", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: { amountCents: 9999, currency: "usd", interval: "month" },
      }),
    });

    withClient(<HomePage />);

    expect(await screen.findByText("$99.99")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/public/pricing");
  });

  /**
   * Both failure modes, and the assertion is on the whole rendered page rather
   * than on one element: a fallback constant reintroduced anywhere on the card
   * fails this, not just one reintroduced in the slot the price used to
   * occupy.
   */
  it.each([
    [
      "the endpoint fails",
      { ok: false, status: 502, json: async () => ({ error: {} }) },
    ],
    [
      "the price has no amount",
      {
        ok: true,
        status: 200,
        json: async () => ({
          data: { amountCents: null, currency: "usd", interval: "month" },
        }),
      },
    ],
  ])("renders no number at all when %s", async (_label, response) => {
    fetchMock.mockResolvedValue(response);

    const { container } = withClient(<HomePage />);

    // The card must still be there — only the price line goes.
    expect(await screen.findByTestId("button-get-started-paid")).toBeTruthy();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const text = container.textContent ?? "";
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("$99.99");
    expect(text).not.toContain("undefined");
    // "TBD" was the placeholder this replaces; a placeholder is a fallback
    // constant wearing a different hat.
    expect(text).not.toContain("TBD");
    // No currency-shaped string anywhere on the page except the free card's $0.
    const currencyMatches = text.match(/\$[\d,]+(\.\d{2})?/g) ?? [];
    expect(currencyMatches.filter((m) => m !== "$0")).toEqual([]);
  });
});
