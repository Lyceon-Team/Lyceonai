/**
 * Wave 6 close-out, row UI-64: the before/after captures of the configured-number copy.
 *
 * @spec [student-UI register §6 Wave 6: UI-64 (OQ-68 (d), owner ruling (Karl) 2026-10-08: "The
 *        '40 questions' copy reads the server quota value (the same source as the 402)");
 *        DESIGN.md §1 (tokens, 14px floor, light and dark)] | @implemented [2026-10-08]
 *
 * plain English: the pages that print the free daily limit or the diagnostic's length, at 1440,
 * 1024 and 390, light and dark: Home for the free student (the diagnostic card, "How Lyceon
 * works", today's quota), Help (the plan FAQ), Settings → Billing free and paid, and `/upgrade`.
 * The "after" run uses the `quota-config` seed, which sets `daily_quota_free` to 37 and the
 * diagnostic to 6 × 8 = 48 in the harness database, so the copy visibly comes from the config
 * rows and not from a literal 40.
 *
 * The runs write under `test-results/student-harness/wave6/` (git-ignored); the PNGs and index
 * are copied into `docs/plans/student-ui/evidence/wave6/UI-64/{before,after}/` by hand, because
 * a run replaces its whole output directory and would delete the other half of the pair.
 */
import { billingPlansResponseSchema } from "../../../../packages/shared/src/billing-schema";
import type { ExtraViewport, PageGroup } from "./types";

const W1024: readonly ExtraViewport[] = [
  { name: "w1024", width: 1024, height: 768, selectors: "desktop" },
];

const OUT_ROOT = "test-results/student-harness/wave6";

const NOT_PROTOTYPED =
  "Not compared with a prototype: a before/after pair for one row.";

/** Illustrative plan prices: `client/src/pages/upgrade.page.test.tsx`'s fixture amounts. */
const PLANS_BODY = billingPlansResponseSchema.parse({
  plans: [
    {
      plan: "monthly",
      label: "Monthly",
      amountCents: 9999,
      currency: "usd",
      intervalLabel: "per month",
      interval: "month",
      intervalCount: 1,
      stripePriceIdConfigured: true,
    },
    {
      plan: "quarterly",
      label: "Quarterly",
      amountCents: 19999,
      currency: "usd",
      intervalLabel: "per 3 months",
      interval: "month",
      intervalCount: 3,
      stripePriceIdConfigured: true,
    },
    {
      plan: "yearly",
      label: "Yearly",
      amountCents: 69999,
      currency: "usd",
      intervalLabel: "per year",
      interval: "year",
      intervalCount: 1,
      stripePriceIdConfigured: true,
    },
  ],
  requestId: "harness",
});

function wait(selector: string): { desktop: string; mobile: string } {
  return { desktop: selector, mobile: selector };
}

export const W6_UI_64: PageGroup = {
  id: "W6-UI-64",
  title:
    "W6 UI-64 the free daily limit and the diagnostic length from the server config (1440, 1024, 390; light and dark)",
  outRoot: OUT_ROOT,
  seed: "quota-config",
  shots: [
    {
      id: "home-free",
      title:
        "Home, free: the diagnostic card's length, How Lyceon works, today's quota",
      persona: "free",
      route: "/dashboard",
      waitFor: wait('[data-testid="home-diagnostic"]'),
      fullPage: true,
      extraViewports: W1024,
      prototype: { kind: "none", reason: NOT_PROTOTYPED },
    },
    {
      id: "help-paid",
      title: "Help, paid: the plan FAQ (the first question, open)",
      persona: "paid",
      route: "/help",
      waitFor: wait('[data-testid="help-page"]'),
      fullPage: true,
      extraViewports: W1024,
      prototype: { kind: "none", reason: NOT_PROTOTYPED },
    },
    {
      id: "help-free",
      title: "Help, free: the plan FAQ (the first question, open)",
      persona: "free",
      route: "/help",
      waitFor: wait('[data-testid="help-page"]'),
      fullPage: true,
      extraViewports: W1024,
      prototype: { kind: "none", reason: NOT_PROTOTYPED },
    },
    {
      id: "settings-billing-free",
      title: "Settings → Billing, free: the free plan box",
      persona: "free",
      route: "/profile?tab=billing",
      waitFor: wait('[data-testid="settings-billing-free"]'),
      fullPage: true,
      extraViewports: W1024,
      prototype: { kind: "none", reason: NOT_PROTOTYPED },
    },
    {
      id: "settings-billing-paid",
      title: "Settings → Billing, paid: the status (no plan copy on this plan)",
      persona: "paid",
      route: "/profile?tab=billing",
      waitFor: wait('[data-testid="settings-billing-self"]'),
      fullPage: true,
      extraViewports: W1024,
      prototype: { kind: "none", reason: NOT_PROTOTYPED },
    },
    {
      id: "upgrade",
      title: "The plans page /upgrade, free: the free/paid sentences",
      persona: "free",
      route: "/upgrade",
      waitFor: wait('[data-testid="upgrade-plan-yearly"]'),
      fulfillRequest: {
        method: "GET",
        path: "/api/billing/plans",
        body: PLANS_BODY,
        reason:
          "The real route reads prices from Stripe, which the harness never calls (no key). The body is built by the shared `billingPlansResponseSchema`; the prices are illustrative (upgrade.page.test.tsx's fixture amounts), not Lyceon's.",
      },
      fullPage: true,
      extraViewports: W1024,
      prototype: { kind: "none", reason: NOT_PROTOTYPED },
    },
  ],
};
