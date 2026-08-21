// @vitest-environment jsdom
// @spec [Doc-05C §7.4, Doc-01_V8 §20 entitlement_features, Vertical-B Slice 2]
// @implemented [2026-08-12]
// plain English: proves the student-facing score surface renders correct tiered states:
//   - no_baseline: diagnostic not completed — shows prompt to complete diagnostic.
//   - baseline_only: diagnostic done, unpaid — shows frozen baseline + upgrade CTA.
//   - computed: paid — shows live estimate with real composite.
//   - honest uncomputed: computed status but null estimate (transient edge) — no crash.
//   LC-AM3-UI-001 honest-signal: never fabricates a score, never crashes on null estimate.
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const queryMock = vi.hoisted(() => ({ useQuery: vi.fn() }));
vi.mock("@tanstack/react-query", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-query")>();
  return { ...actual, useQuery: queryMock.useQuery };
});
vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));

import { ScoreProjectionCard } from "./ScoreProjectionCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ENTITLEMENT_FREE = {
  hasPaidAccess: false,
  plan: "free" as const,
  status: "inactive",
  reason: "no_subscription",
};

const ENTITLEMENT_PAID = {
  hasPaidAccess: true,
  plan: "paid" as const,
  status: "active",
  reason: "subscription_active",
  currentPeriodEnd: "2026-09-01T00:00:00Z",
};

const BASELINE = {
  composite: 1050,
  math: 530,
  rw: 520,
  range: { low: 980, high: 1120 },
  confidence: 0.65,
  capturedAt: "2026-07-15T12:00:00Z",
};

describe("ScoreProjectionCard — tiered estimate surface (Vertical-B Slice 2)", () => {
  it("renders no_baseline state — prompts to complete diagnostic", () => {
    queryMock.useQuery.mockReturnValue({
      data: {
        estimateStatus: "no_baseline",
        estimate: null,
        baseline: null,
        totalQuestionsAttempted: 0,
        lastUpdated: "2026-01-01T00:00:00Z",
        entitlement: ENTITLEMENT_FREE,
      },
      isLoading: false,
      error: null,
    });
    render(<ScoreProjectionCard />);
    // Prompts to complete diagnostic.
    expect(
      screen.getByText(
        /complete the diagnostic to establish your starting point/i,
      ),
    ).toBeTruthy();
    // No fabricated score.
    expect(screen.queryByText("1050")).toBeNull();
  });

  it("renders baseline_only state — shows frozen baseline + upgrade CTA", () => {
    queryMock.useQuery.mockReturnValue({
      data: {
        estimateStatus: "baseline_only",
        estimate: null,
        baseline: BASELINE,
        cta: true,
        totalQuestionsAttempted: 0,
        lastUpdated: "2026-07-15T12:00:00Z",
        entitlement: ENTITLEMENT_FREE,
      },
      isLoading: false,
      error: null,
    });
    render(<ScoreProjectionCard />);
    // Shows frozen baseline composite.
    expect(screen.getByText("1050")).toBeTruthy();
    // Shows section scores.
    expect(screen.getByText("530")).toBeTruthy();
    expect(screen.getByText("520")).toBeTruthy();
    // Shows upgrade CTA.
    expect(screen.getByText(/View Plans/i)).toBeTruthy();
    expect(
      screen.getByText(/Upgrade to see how your score improves/i),
    ).toBeTruthy();
    // No live estimate score present.
    expect(screen.queryByText("1180")).toBeNull();
  });

  it("renders computed state — shows live estimate with real composite", () => {
    queryMock.useQuery.mockReturnValue({
      data: {
        estimateStatus: "computed",
        estimate: {
          composite: 1180,
          math: 600,
          rw: 580,
          range: { low: 1100, high: 1260 },
          confidence: 0.5,
        },
        baseline: BASELINE,
        totalQuestionsAttempted: 60,
        lastUpdated: "2026-08-01T00:00:00Z",
        entitlement: ENTITLEMENT_PAID,
      },
      isLoading: false,
      error: null,
    });
    render(<ScoreProjectionCard />);
    // Shows live composite.
    expect(screen.getByText("1180")).toBeTruthy();
    // Shows baseline comparison.
    expect(screen.getByText("1050")).toBeTruthy();
    // Shows delta.
    expect(screen.getByText("+130")).toBeTruthy();
  });

  it("renders honest uncomputed (null estimate on computed status) — no crash, no fabricated number", () => {
    queryMock.useQuery.mockReturnValue({
      data: {
        estimateStatus: "computed",
        estimate: null,
        baseline: BASELINE,
        totalQuestionsAttempted: 25,
        lastUpdated: "2026-01-01T00:00:00Z",
        entitlement: ENTITLEMENT_PAID,
      },
      isLoading: false,
      error: null,
    });
    render(<ScoreProjectionCard />);
    // LC-AM3-UI-001 honest-signal: shows not-yet-available, not a crash.
    expect(screen.getByText(/isn.t available yet/i)).toBeTruthy();
    // No fabricated score.
    expect(screen.queryByText("400")).toBeNull();
    expect(screen.queryByText("200")).toBeNull();
  });
});
