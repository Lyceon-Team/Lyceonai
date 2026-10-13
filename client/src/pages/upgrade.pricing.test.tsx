// @vitest-environment jsdom
/**
 * @spec [Doc 09 §1.4, §5.1 Stripe canonical for pricing magnitudes;
 *        owner directive 2026-09-27 "derive every price figure from Stripe";
 *        Coding Standards §14]
 * @implemented 2026-09-27
 *
 * plain English: the claims the price-derivation fix rests on, each written so
 * the obvious way to break it turns this file red. Every one proved by a plant.
 *
 *   P1  the equivalent and the discount both move when the Stripe amount moves
 *   P2  a missing price renders no number — no NaN, no remembered constant
 *   P3  no hardcoded currency amount survives in any billing surface (sweep)
 *   P4  the quarterly discount is exactly 1 − (quarterly ÷ 3) ÷ monthly
 *
 * P1 IS THE POINT. The defect was not a wrong constant, it was a SECOND SOURCE:
 * the headline came from Stripe and the two figures beneath it came from a table,
 * so they could disagree — and did, by $40 and by 16 percentage points. A test
 * that pinned the expected strings would have passed against the broken build,
 * because the broken build rendered self-consistent nonsense. So P1 changes the
 * fixture amount and asserts BOTH derived figures follow: nothing but a real
 * derivation can satisfy that.
 */
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UpgradePage from "./upgrade";
import {
  bestValuePlan,
  deriveBillingPlanPricing,
  monthlyAmountFrom,
} from "../../../packages/shared/src/billing-pricing";

const getBillingPlansMock = vi.fn();
const startSubscriptionCheckoutMock = vi.fn();

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
// OQ-68 (d): the page reads the quota's free daily limit for its free sentence. No signed-in
// student here, so that read stays off; these tests are about prices only.
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({ user: null, authLoading: false }),
}));
vi.mock("@/lib/billing-client", () => ({
  getBillingPlans: (...args: unknown[]) => getBillingPlansMock(...args),
  startSubscriptionCheckout: (...args: unknown[]) =>
    startSubscriptionCheckoutMock(...args),
}));

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

/** The contract shape, with the amounts a caller wants to vary. */
function plans(monthlyCents: number, quarterlyCents: number) {
  return [
    {
      plan: "monthly" as const,
      label: "Monthly",
      amountCents: monthlyCents,
      currency: "usd",
      intervalLabel: "per month",
      interval: "month" as const,
      intervalCount: 1,
      stripePriceIdConfigured: true,
    },
    {
      plan: "quarterly" as const,
      label: "Quarterly",
      amountCents: quarterlyCents,
      currency: "usd",
      intervalLabel: "per 3 months",
      interval: "month" as const,
      intervalCount: 3,
      stripePriceIdConfigured: true,
    },
  ];
}

const REPO_ROOT = path.resolve(__dirname, "../../..");

function readCode(relative: string): string {
  return fs
    .readFileSync(path.join(REPO_ROOT, relative), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── P1 ──────────────────────────────────────────────────────────────────

describe("P1 — equivalent and discount both follow the live amount", () => {
  it("renders figures derived from the fixture, not from a table", async () => {
    // The real live prices at the time of the report.
    getBillingPlansMock.mockResolvedValueOnce(plans(5999, 14999));
    render(<UpgradePage />, { wrapper: wrapper() });

    // $14999/3 = $49.996 -> $50.00 ; 1 - 4999.67/5999 = 16.7%
    await waitFor(() => {
      expect(
        screen.getByTestId("upgrade-equivalent-quarterly").textContent,
      ).toContain("$50.00");
    });
    expect(
      screen.getByTestId("upgrade-savings-quarterly").textContent,
    ).toContain("16.7% off");
    // The headline is the live amount, and the equivalent agrees with it.
    expect(screen.getByTestId("upgrade-price-quarterly").textContent).toContain(
      "$149.99",
    );
  });

  it("moves BOTH figures when the Stripe amount changes", async () => {
    // Halve the quarterly. A hardcoded table cannot follow this; a derivation
    // must. This is the assertion the old build could not have passed.
    getBillingPlansMock.mockResolvedValueOnce(plans(5999, 7499));
    render(<UpgradePage />, { wrapper: wrapper() });

    await waitFor(() => {
      expect(
        screen.getByTestId("upgrade-equivalent-quarterly").textContent,
      ).toContain("$25.00");
    });
    // 1 - 2499.67/5999 = 58.3%
    expect(
      screen.getByTestId("upgrade-savings-quarterly").textContent,
    ).toContain("58.3% off");
  });

  it("never prints an equivalent for the monthly plan", () => {
    // Its equivalent IS its headline; printing both is the shape that made the
    // contradiction visible in the first place.
    const { equivalentMonthlyCents, savingsPercent } = deriveBillingPlanPricing(
      { amountCents: 5999, interval: "month", intervalCount: 1 },
      5999,
    );
    expect(equivalentMonthlyCents).toBeNull();
    expect(savingsPercent).toBeNull();
  });
});

// ── P2 ──────────────────────────────────────────────────────────────────

describe("P2 — a missing price renders no number", () => {
  it("shows an unavailable line and no NaN when the amount is null", async () => {
    getBillingPlansMock.mockResolvedValueOnce([
      {
        plan: "monthly" as const,
        label: "Monthly",
        amountCents: null,
        currency: null,
        intervalLabel: null,
        interval: null,
        intervalCount: null,
        stripePriceIdConfigured: false,
      },
    ]);
    render(<UpgradePage />, { wrapper: wrapper() });

    await waitFor(() => {
      expect(
        screen.getByTestId("upgrade-price-unavailable-monthly"),
      ).toBeTruthy();
    });
    expect(screen.queryByTestId("upgrade-price-monthly")).toBeNull();
    expect(screen.queryByTestId("upgrade-equivalent-monthly")).toBeNull();
    expect(screen.queryByTestId("upgrade-savings-monthly")).toBeNull();
    // The two failure signatures this replaces, neither of which may return.
    expect(document.body.textContent).not.toContain("NaN");
    expect(document.body.textContent).not.toContain("$99.99");
  });

  it("renders no cards at all when the API returns nothing", async () => {
    // There is no fallback list, so there is nothing to render a price for.
    getBillingPlansMock.mockResolvedValueOnce([]);
    render(<UpgradePage />, { wrapper: wrapper() });

    await waitFor(() => {
      expect(screen.queryByTestId("upgrade-plan-monthly")).toBeNull();
    });
    expect(document.body.textContent).not.toContain("$");
  });

  it("derives nothing from a null amount or an unusable interval", () => {
    expect(
      deriveBillingPlanPricing(
        { amountCents: null, interval: "month", intervalCount: 3 },
        5999,
      ),
    ).toEqual({ equivalentMonthlyCents: null, savingsPercent: null });
    // A week has no whole number of months — an approximation would be a guess.
    expect(
      deriveBillingPlanPricing(
        { amountCents: 1999, interval: "week", intervalCount: 2 },
        5999,
      ),
    ).toEqual({ equivalentMonthlyCents: null, savingsPercent: null });
    // No monthly basis means no percentage, but the equivalent still stands.
    expect(
      deriveBillingPlanPricing(
        { amountCents: 14999, interval: "month", intervalCount: 3 },
        null,
      ),
    ).toEqual({ equivalentMonthlyCents: 5000, savingsPercent: null });
  });
});

// ── P3 ──────────────────────────────────────────────────────────────────

describe("P3 — no hardcoded currency amount in any billing surface", () => {
  const SURFACES = [
    "client/src/pages/upgrade.tsx",
    "client/src/components/guardian/GuardianPurchaseCard.tsx",
    "client/src/lib/billing-client.ts",
    "client/src/lib/public-pricing.ts",
    "packages/shared/src/billing-pricing.ts",
  ] as const;

  it.each(SURFACES)("%s carries no amount literal", (relative) => {
    const code = readCode(relative);
    // A cents literal is four or more digits; the formatter's own `100` and the
    // months-in-a-year `12` are arithmetic, not prices, so the floor is 1000.
    const literals = code.match(/\b\d{4,}\b/g) ?? [];
    expect(literals, `${relative} hardcodes ${literals.join(", ")}`).toEqual(
      [],
    );
    // And no currency-shaped string.
    expect(code, `${relative} carries a "$n.nn" literal`).not.toMatch(
      /["'`]\s*\$\d/,
    );
  });

  it("keeps no fallback plan table anywhere", () => {
    const code = readCode("client/src/pages/upgrade.tsx");
    expect(code).not.toContain("fallbackPlans");
  });

  it("keeps the derived figures OFF the wire", () => {
    // The first draft of this test forbade the identifier anywhere, and failed
    // on `billing-pricing.ts` — which returns a field by that name and should.
    // The claim is not about the word; it is that neither figure is
    // TRANSMITTED, because a transmitted derivation is a second copy of a fact.
    const schema = readCode("packages/shared/src/billing-schema.ts");
    const planShape = schema.slice(
      schema.indexOf("export const billingPlanMetadataSchema"),
      schema.indexOf("export type BillingPlanMetadata"),
    );
    expect(planShape).not.toContain("equivalentMonthlyCents");
    expect(planShape).not.toContain("savingsPercent");

    // And no consumer reads either figure off an API row.
    for (const surface of [
      "client/src/pages/upgrade.tsx",
      "client/src/components/guardian/GuardianPurchaseCard.tsx",
    ]) {
      const code = readCode(surface);
      // ANY property access, not just one off a named identifier. The first
      // draft matched `price.savingsPercent` and the plant slipped past it as
      // `(price as { savingsPercent?: number }).savingsPercent` — a cast, which
      // is exactly the shape this codebase has been bitten by before. In these
      // files both figures may only ever arrive by destructuring
      // `deriveBillingPlanPricing`, so a dot before either name is the defect.
      expect(code, `${surface} reads a derivation off an object`).not.toMatch(
        /\.\s*(equivalentMonthlyCents|savingsPercent)\b/,
      );
      expect(code, `${surface} does not derive`).toContain(
        "deriveBillingPlanPricing(",
      );
    }
  });
});

// ── P4 ──────────────────────────────────────────────────────────────────

describe("P4 — the discount is exactly 1 − (quarterly ÷ 3) ÷ monthly", () => {
  it.each([
    [5999, 14999],
    [9999, 19999],
    [1000, 3000],
    [5000, 12000],
  ])("monthly %i, quarterly %i", (monthlyCents, quarterlyCents) => {
    const expected = (1 - quarterlyCents / 3 / monthlyCents) * 100;
    const { savingsPercent } = deriveBillingPlanPricing(
      { amountCents: quarterlyCents, interval: "month", intervalCount: 3 },
      monthlyCents,
    );
    expect(savingsPercent).toBeCloseTo(expected, 10);
  });

  it("measures a yearly plan over twelve months", () => {
    const { equivalentMonthlyCents, savingsPercent } = deriveBillingPlanPricing(
      { amountCents: 59988, interval: "year", intervalCount: 1 },
      5999,
    );
    expect(equivalentMonthlyCents).toBe(4999);
    expect(savingsPercent).toBeCloseTo((1 - 59988 / 12 / 5999) * 100, 10);
  });

  it("reports an inverted price as negative rather than hiding it", () => {
    // A quarterly costing more per month than the monthly is a
    // misconfiguration. Clamping it to zero would conceal that.
    const { savingsPercent } = deriveBillingPlanPricing(
      { amountCents: 24000, interval: "month", intervalCount: 3 },
      5999,
    );
    expect(savingsPercent).toBeLessThan(0);
  });

  it("takes the monthly basis from the response, not from a constant", () => {
    expect(monthlyAmountFrom(plans(5999, 14999))).toBe(5999);
    expect(monthlyAmountFrom(plans(1234, 3000))).toBe(1234);
    expect(monthlyAmountFrom([])).toBeNull();
  });
});

// ── P5 ──────────────────────────────────────────────────────────────────

describe('P5 — "Best value" is read from the prices, not asserted', () => {
  it("names the genuinely cheapest per month", () => {
    // Quarterly at $74.99 is $25.00/mo; yearly at $599.88 is $49.99/mo. The
    // badge must follow the arithmetic, not the plan name.
    expect(
      bestValuePlan([
        ...plans(5999, 7499),
        {
          plan: "yearly" as const,
          label: "Yearly",
          amountCents: 59988,
          currency: "usd",
          intervalLabel: "per year",
          interval: "year" as const,
          intervalCount: 1,
          stripePriceIdConfigured: true,
        },
      ]),
    ).toBe("quarterly");
  });

  it("names yearly when yearly really is cheapest per month", () => {
    expect(
      bestValuePlan([
        ...plans(5999, 14999),
        {
          plan: "yearly" as const,
          label: "Yearly",
          amountCents: 47988,
          currency: "usd",
          intervalLabel: "per year",
          interval: "year" as const,
          intervalCount: 1,
          stripePriceIdConfigured: true,
        },
      ]),
    ).toBe("yearly");
  });

  it("claims nothing on a tie or with too little to compare", () => {
    // 5999/mo and 17997/3mo are the same rate: no best, so no badge.
    expect(bestValuePlan(plans(5999, 17997))).toBeNull();
    expect(bestValuePlan([])).toBeNull();
    expect(bestValuePlan(plans(5999, 14999).slice(0, 1))).toBeNull();
  });

  it("badges the cheaper plan even when that is not the yearly one", async () => {
    // THE CASE THAT SEPARATES THE TWO ANSWERS. A fixture without a yearly plan
    // cannot tell a derivation from `plan === "yearly"` — both render no badge,
    // and the plant sailed through. Here yearly EXISTS and is the worse deal:
    // quarterly $74.99 is $25.00/mo, yearly $599.88 is $49.99/mo.
    getBillingPlansMock.mockResolvedValueOnce([
      ...plans(5999, 7499),
      {
        plan: "yearly" as const,
        label: "Yearly",
        amountCents: 59988,
        currency: "usd",
        intervalLabel: "per year",
        interval: "year" as const,
        intervalCount: 1,
        stripePriceIdConfigured: true,
      },
    ]);
    render(<UpgradePage />, { wrapper: wrapper() });

    await waitFor(() => {
      expect(screen.getByTestId("upgrade-plan-yearly")).toBeTruthy();
    });
    const quarterly = screen.getByTestId("upgrade-plan-quarterly");
    const yearly = screen.getByTestId("upgrade-plan-yearly");
    expect(quarterly.textContent).toContain("Best value");
    expect(yearly.textContent).not.toContain("Best value");
  });

  it("puts no badge on the page when nothing can be ranked", async () => {
    getBillingPlansMock.mockResolvedValueOnce(plans(5999, 17997));
    render(<UpgradePage />, { wrapper: wrapper() });
    await waitFor(() => {
      expect(screen.getByTestId("upgrade-price-monthly")).toBeTruthy();
    });
    expect(document.body.textContent).not.toContain("Best value");
  });
});
