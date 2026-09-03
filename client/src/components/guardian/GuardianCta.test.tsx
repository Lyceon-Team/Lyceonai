// @vitest-environment jsdom
/**
 * The owner's 2026-09-03 acceptance list, tests 1, 3, 4, 5 and 6.
 *
 * @spec [Doc 01 V8 §20, §31.1–§31.4; SCL-029 `past_due` is ENTITLED;
 *        CLAUDE.md mastery invariant] | @implemented [2026-09-03]
 *
 * Test 2 — "the conferring link is the `active` one" — needs real
 * `guardian_links` and `entitlements` rows, so it lives in
 * `tests/ci/guardian-premium-fold.contract.test.ts`, which runs in the
 * PGHOST-bearing "Guardian schema-truth conversions → real PG proof" job.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutReturnPoller } from "./CheckoutReturnPoller";
import { GuardianTemplatePreview } from "./GuardianTemplatePreview";
import { PremiumUpgradePrompt } from "@/components/billing/PremiumUpgradePrompt";
import { resolveCtaDestination, resolveCtaCopy } from "@/lib/billing-cta";

const csrfFetchMock = vi.fn();
vi.mock("@/lib/csrf", () => ({
  csrfFetch: (...a: unknown[]) => csrfFetchMock(...a),
}));
vi.mock("@/lib/billing-client", () => ({ openBillingPortal: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const navigations: string[] = [];
vi.mock("wouter", () => ({
  useLocation: () => ["/guardian", (to: string) => navigations.push(to)],
}));

let authState = { isGuardian: false };
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => authState,
}));

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function withClient(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  navigations.length = 0;
  authState = { isGuardian: false };
});

/**
 * TEST 1 — the lockout. This is the one that matters.
 *
 * `GET /api/billing/status` reports `effectiveAccess: true` and
 * `needsPaymentUpdate: true` together for a `past_due` student, because
 * SCL-029 rules `past_due` ENTITLED so that "a student whose card is mid-retry
 * does not lose their tutor". The component now called `CheckoutReturnPoller` used to test the second and
 * ignore the first, returning a full-screen interstitial INSTEAD of its
 * children — so a guardian with full access lost the link panel, the purchase
 * card and every progress view at once.
 */
describe("guardian dashboard survives a payment-health signal (test 1)", () => {
  it("renders its children when effectiveAccess and needsPaymentUpdate are BOTH true", async () => {
    authState = { isGuardian: true };
    csrfFetchMock.mockResolvedValue(
      jsonResponse({
        effectiveAccess: true,
        needsPaymentUpdate: true,
        hasActiveLink: true,
        isPaid: true,
        stripeStatus: "past_due",
      }),
    );

    withClient(
      <CheckoutReturnPoller>
        <div data-testid="guardian-dashboard-body">
          <div data-testid="guardian-purchase-card" />
        </div>
      </CheckoutReturnPoller>,
    );

    expect(await screen.findByTestId("guardian-dashboard-body")).toBeTruthy();
    // The purchase card specifically: the lockout's worst consequence was that
    // the guardian could not buy for their OTHER student.
    expect(screen.getByTestId("guardian-purchase-card")).toBeTruthy();
    expect(screen.queryByText(/Payment Update Required/i)).toBeNull();
  });
});

/**
 * TESTS 3 and 4 — the preview, and the absence assertion that is its point.
 */
describe("guardian template preview (tests 3 and 4)", () => {
  it("renders the real dashboard shell for a guardian with no linked student", () => {
    withClient(<GuardianTemplatePreview />);

    expect(screen.getByTestId("guardian-template-preview")).toBeTruthy();
    expect(
      screen.getByText(/what you.ll see once you link a student/i),
    ).toBeTruthy();
    // The SAME tile component the real progress card renders, in its locked
    // variant — not a lookalike that could drift.
    expect(screen.getAllByTestId("guardian-metric-tile-locked").length).toBe(3);
  });

  /**
   * THE ASSERTION THAT MATTERS, AND IT IS AN ABSENCE.
   *
   * CLAUDE.md: "Mastery is earned from observed events only. Never infer,
   * estimate, or invent." The owner ruled out sample values precisely because a
   * plausible number inside the real dashboard chrome is one CSS regression
   * from reading as a real child's real progress. Absence is what can be broken
   * silently, so absence is what is asserted: plant a single numeral in the
   * preview and this goes red.
   */
  it("renders NO numeric mastery or KPI value anywhere", () => {
    const { container } = withClient(<GuardianTemplatePreview />);
    const preview = container.querySelector(
      '[data-testid="guardian-template-preview"]',
    );
    expect(preview).not.toBeNull();

    /**
     * SCOPED TO THE VALUE SLOTS, not to the whole card — and the distinction is
     * the invariant's, not a convenience. "Questions Attempted (7d)" is a
     * LABEL: it names a window, asserts nothing about a child, and is the same
     * string the real dashboard shows. What must never appear is a FIGURE in a
     * slot a reader would take for measured progress. So the assertion is on
     * the slots, and it is emptiness rather than "no digits": a lock glyph is
     * an SVG and contributes no text at all, so anything textual here is
     * something a value was rendered into.
     */
    const valueSlots = Array.from(
      preview?.querySelectorAll('[data-testid="guardian-metric-value"]') ?? [],
    );
    expect(valueSlots.length).toBe(3);
    for (const slot of valueSlots) {
      expect(slot.textContent?.trim() ?? "").toBe("");
    }

    // And no UNLOCKED tile smuggled in beside them.
    expect(
      preview?.querySelectorAll('[data-testid="guardian-metric-tile"]').length,
    ).toBe(0);

    // The mastery rows carry domain NAMES and a lock — no level, no percentage.
    const masteryText = Array.from(
      preview?.querySelectorAll("[class*='justify-between']") ?? [],
    )
      .map((el) => el.textContent ?? "")
      .join(" ");
    expect(masteryText).not.toMatch(/\d/);
  });
});

/**
 * TESTS 5 and 6 — the destination, from the role and nothing else.
 */
describe("billing CTA destination (tests 5 and 6)", () => {
  it("sends a guardian to /guardian, never to /upgrade", () => {
    expect(resolveCtaDestination({ isGuardian: true })).toBe("/guardian");
  });

  it("sends an unentitled student to /upgrade", () => {
    expect(resolveCtaDestination({ isGuardian: false })).toBe("/upgrade");
    expect(resolveCtaCopy({ kind: "student_unentitled" }).action).toEqual({
      kind: "navigate",
      to: "/upgrade",
    });
  });

  /**
   * Every guardian-facing state, checked as a set rather than one at a time —
   * a per-state assertion is exactly what let `/profile`'s "View Plans" ship
   * pointing at a route a guardian is bounced from.
   */
  it("names no guardian state whose destination is /upgrade", () => {
    const guardianStates = [
      { kind: "guardian_no_link" },
      { kind: "guardian_dashboard" },
      { kind: "guardian_student_unfunded", studentName: "Sam" },
      { kind: "guardian_student_lapsed", studentName: "Sam" },
    ] as const;

    for (const state of guardianStates) {
      const action = resolveCtaCopy(state).action;
      if (action.kind === "navigate") {
        expect(action.to, state.kind).toBe("/guardian");
      }
    }
  });

  /**
   * TEST 4's copy half: a guardian with two linked students, one funded and one
   * not, hits a boundary on ONE of them. Copy that says "upgrade to premium"
   * leaves them guessing which child they are being asked to pay for.
   */
  it("names the student in the guardian CTA", () => {
    authState = { isGuardian: true };
    withClient(
      <PremiumUpgradePrompt
        state={{ kind: "guardian_student_unfunded", studentName: "Ada Chen" }}
        featureBenefit="their domain mastery"
      />,
    );

    expect(screen.getByText(/Ada Chen needs a subscription/)).toBeTruthy();
    expect(screen.getByTestId("premium-upgrade-cta").textContent).toContain(
      "Ada Chen",
    );
  });

  /**
   * The fourth state reaches the PORTAL, not checkout. Selling a second
   * subscription to someone who can reactivate the first is the outcome this
   * exists to prevent, and `evaluateSubjectPurchaseEligibility` would permit it:
   * none of `canceled`, `unpaid`, `incomplete_expired` is in the platform
   * predicate.
   */
  it("offers the portal, not a purchase, for a lapsed subscription", () => {
    expect(
      resolveCtaCopy({ kind: "guardian_student_lapsed", studentName: "Sam" })
        .action,
    ).toEqual({ kind: "portal" });
    expect(resolveCtaCopy({ kind: "student_lapsed" }).action).toEqual({
      kind: "portal",
    });
  });
});
