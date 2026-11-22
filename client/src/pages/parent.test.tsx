// @vitest-environment jsdom
/**
 * /parent: every control reads its source, prices come from the API, and no price is baked in.
 *
 * @spec [owner brief "Build: /parent page + card-first parent onboarding" (Karl, 2026-11-22),
 *       Part 1 "Wiring" table and "Proof → Tests"; Doc 09 §1.4, §5.1] | @implemented [2026-11-22]
 *
 * plain English: renders the real page as a logged-out visitor and proves, one assertion per
 * site: each Sign up / Sign in / Book a call resolves to its constant; the price tiles show
 * exactly what `GET /api/public/pricing/plans` returned (and the saving computed from it); the
 * sample card's test day is the shared module's next SAT date; the server render (what the
 * prerender emits) carries no price; and a failed price load hides the tiles but keeps the
 * section. Presence is proved before absence throughout.
 */
import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ParentPage, {
  PARENT_PLAN_PRICES_QUERY_KEY,
  sampleTestDay,
} from "./parent";
import { GUARDIAN_SIGNUP_HREF, SIGN_IN_HREF } from "@/lib/marketing-links";
import {
  PARENT_CALL_HERO_LABEL,
  PARENT_CALL_LABEL,
  PARENT_CALL_URL,
} from "@lyceon/shared/external-links";
import {
  chicagoToday,
  formatSatTestDate,
  offeredSatTestDates,
} from "@shared/sat-test-dates";
import { PARENT_FAQS } from "@shared/seo/faqs";
import { yearlySavings } from "@/lib/public-pricing";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    isAuthenticated: false,
    isGuardian: false,
    signOut: vi.fn(),
  }),
}));

// The double renders an anchor and keeps every prop, as the real `Link` does (see
// home.trustpilot.test.tsx for why a fragment double is unfaithful).
vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useLocation: () => ["/parent", vi.fn()],
}));

const fetchMock = vi.fn();

/** Deliberately odd amounts, so a match can only come from this fixture. */
const PLANS = [
  {
    plan: "monthly",
    amountCents: 5717,
    currency: "usd",
    interval: "month",
    intervalCount: 1,
  },
  {
    plan: "quarterly",
    amountCents: 14321,
    currency: "usd",
    interval: "month",
    intervalCount: 3,
  },
  {
    plan: "yearly",
    amountCents: 47003,
    currency: "usd",
    interval: "year",
    intervalCount: 1,
  },
] as const;

function okPlans(): Response {
  return new Response(JSON.stringify({ data: { plans: PLANS } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function withClient(node: React.ReactNode) {
  return render(
    <QueryClientProvider client={client()}>{node}</QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/parent CTAs resolve to their constants", () => {
  it("header, hero and final Sign up go to GUARDIAN_SIGNUP_HREF; Sign in to SIGN_IN_HREF", () => {
    fetchMock.mockResolvedValue(okPlans());
    withClient(<ParentPage />);
    for (const id of [
      "nav-sign-up",
      "parent-hero-sign-up",
      "parent-final-sign-up",
    ]) {
      const el = screen.getByTestId(id);
      expect(el.textContent, id).toBe("Sign up");
      expect(el.getAttribute("href"), id).toBe(GUARDIAN_SIGNUP_HREF);
    }
    const signIn = screen.getByRole("link", { name: "Sign in" });
    expect(signIn.getAttribute("href")).toBe(SIGN_IN_HREF);
  });

  it("both call links are PARENT_CALL_URL, plain new-tab links, with their labels", () => {
    fetchMock.mockResolvedValue(okPlans());
    withClient(<ParentPage />);
    const pairs: ReadonlyArray<[string, string]> = [
      ["parent-hero-call", PARENT_CALL_HERO_LABEL],
      ["parent-band-call", PARENT_CALL_LABEL],
    ];
    for (const [id, label] of pairs) {
      const el = screen.getByTestId(id);
      expect(el.textContent, id).toBe(label);
      expect(el.getAttribute("href"), id).toBe(PARENT_CALL_URL);
      expect(el.getAttribute("target"), id).toBe("_blank");
      expect(el.getAttribute("rel"), id).toBe("noopener noreferrer");
    }
  });
});

describe("/parent prices come from the API", () => {
  it("fetches the plan list and renders exactly its amounts, with the computed saving", async () => {
    fetchMock.mockResolvedValue(okPlans());
    withClient(<ParentPage />);
    expect(PARENT_PLAN_PRICES_QUERY_KEY).toEqual(["/api/public/pricing/plans"]);
    const tiles = await screen.findByTestId("parent-prices");
    expect(fetchMock).toHaveBeenCalledWith("/api/public/pricing/plans");
    const text = tiles.textContent ?? "";
    expect(text).toContain("$57.17");
    expect(text).toContain("per month");
    expect(text).toContain("$143.21");
    expect(text).toContain("every 3 months");
    const yearly = within(tiles).getByTestId("parent-price-yearly");
    // 47003 / (5717 × 12) = 0.6851… → save 31% (rounded down); 47003 / 12 = 3916.9 → $39.17.
    const savings = yearlySavings(PLANS);
    expect(savings).toEqual({ savePercent: 31, aboutPerMonth: "$39.17" });
    expect(yearly.textContent).toContain("Best value · save 31%");
    expect(yearly.textContent).toContain("$470.03");
    expect(yearly.textContent).toContain("per year (about $39.17 a month)");
  });

  it("rounds the saving down, never up", () => {
    // 49999 / (5999 × 12) = 0.69454… → 30.5% saved → "save 30%", not 31%.
    const s = yearlySavings([
      {
        plan: "monthly",
        amountCents: 5999,
        currency: "usd",
        interval: "month",
        intervalCount: 1,
      },
      {
        plan: "yearly",
        amountCents: 49999,
        currency: "usd",
        interval: "year",
        intervalCount: 1,
      },
    ]);
    expect(s?.savePercent).toBe(30);
  });

  it("shows a skeleton while loading, then hides the tiles (and keeps the section) on failure", async () => {
    let fail: (r: Response) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => (fail = resolve)),
    );
    withClient(<ParentPage />);
    expect(screen.getByTestId("parent-prices-skeleton")).toBeTruthy();
    fail(new Response("{}", { status: 502 }));
    await waitFor(
      () => expect(screen.queryByTestId("parent-prices-skeleton")).toBeNull(),
      { timeout: 4000 },
    );
    expect(screen.queryByTestId("parent-prices")).toBeNull();
    expect(
      screen.getByText("Free to start. Pro when you want the full picture."),
    ).toBeTruthy();
    expect(screen.getByText("The parent view")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/\$\d/);
  });
});

describe("/parent sample card test day comes from the shared module", () => {
  it("is formatSatTestDate(offeredSatTestDates(chicagoToday())[0].date)", () => {
    fetchMock.mockResolvedValue(okPlans());
    const first = offeredSatTestDates(chicagoToday())[0];
    expect(first).toBeDefined();
    const expected = formatSatTestDate(first?.date ?? "");
    expect(sampleTestDay()).toBe(expected);
    withClient(<ParentPage />);
    expect(screen.getByTestId("parent-sample-test-day").textContent).toBe(
      `Test day: ${expected}`,
    );
  });

  it("follows the module, not a fixed date: a later 'today' gives the next date", () => {
    const first = offeredSatTestDates(chicagoToday())[0];
    const later = offeredSatTestDates(first?.date ?? "")[0];
    expect(later).toBeDefined();
    expect(sampleTestDay(first?.date)).toBe(
      formatSatTestDate(later?.date ?? ""),
    );
  });
});

describe("/parent server render (what the prerender emits)", () => {
  it("carries the page and its FAQ but no price", () => {
    const html = renderToString(
      <QueryClientProvider client={client()}>
        <ParentPage />
      </QueryClientProvider>,
    );
    // Presence first: the page, the pricing section and every FAQ answer are in the HTML.
    expect(html).toContain("See real progress before test day.");
    expect(html).toContain(
      "Free to start. Pro when you want the full picture.",
    );
    expect(html).toContain('data-testid="parent-prices-skeleton"');
    for (const faq of PARENT_FAQS) expect(html).toContain(faq.question);
    // Absence: no currency amount anywhere, and the API was not called during the render.
    expect(html).not.toMatch(/\$\s?\d/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
