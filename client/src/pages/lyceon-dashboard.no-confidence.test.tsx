// @vitest-environment jsdom
/**
 * @spec [Coding Standards §10, §17 (no "AI confidence" metrics); student-UI register §2 and
 *   §8 F-51; owner ruling (Karl) 2026-10-02: remove the "{band} estimate confidence" line from
 *   the live dashboard] | @implemented [2026-10-02] |
 * plain English: when `/api/progress/projection` answers `computed`, the dashboard shows the
 * projected range and the attempted-question count, and no confidence wording, even though
 * the payload still carries `confidenceBand` (the route's future is OQ-36).
 *
 * Presence before absence: the payload is asserted to carry a band, and the range is asserted
 * to render, before the absence checks run.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { EstimateResponse } from "@/lib/projectionApi";

const queryMock = vi.hoisted(() => ({
  projection: undefined as unknown,
}));
vi.mock("@tanstack/react-query", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === "/api/progress/projection") {
        return { data: queryMock.projection, isLoading: false, error: null };
      }
      return { data: undefined, isLoading: false, error: null };
    },
  };
});
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: { id: "11111111-1111-4111-8111-111111111111", display_name: "Sam" },
    isGuardian: false,
  }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/dashboard", vi.fn()],
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/hooks/useDiagnosticStart", () => ({
  useDiagnosticStart: () => ({
    startDiagnostic: vi.fn(),
    isStarting: false,
    error: null,
  }),
}));
vi.mock("@/components/diagnostic/DiagnosticPromptModal", () => ({
  DiagnosticPromptModal: () => null,
}));
vi.mock("@/components/diagnostic/DiagnosticCTAGate", () => ({
  DiagnosticCTAGate: () => null,
}));

import LyceonDashboard from "./lyceon-dashboard";

afterEach(() => {
  cleanup();
});

const COMPUTED: EstimateResponse = {
  estimateStatus: "computed",
  estimate: {
    composite: 1180,
    math: 600,
    rw: 580,
    range: { low: 1130, high: 1230 },
    confidenceBand: "Medium",
  },
  baseline: {
    composite: 1050,
    math: 530,
    rw: 520,
    range: { low: 990, high: 1110 },
    confidenceBand: "Low",
    capturedAt: "2026-09-20T12:00:00.000Z",
  },
  totalQuestionsAttempted: 214,
  lastUpdated: "2026-10-01T12:00:00.000Z",
  entitlement: {
    hasPaidAccess: true,
    plan: "paid",
    status: "active",
    reason: "active",
    currentPeriodEnd: null,
  },
};

describe("student dashboard: no confidence metric (F-51)", () => {
  it("renders the projected range and no confidence wording when the payload carries a band", () => {
    queryMock.projection = COMPUTED;
    expect(COMPUTED.estimate?.confidenceBand).toBe("Medium");

    const { container } = render(<LyceonDashboard />);
    const text = container.textContent ?? "";

    // Presence: the computed branch rendered.
    expect(text).toContain("1130-1230");
    expect(text).toContain("Based on 214 attempted");

    // Absence: neither the band nor the word.
    expect(text).not.toMatch(/confidence/i);
    expect(text).not.toMatch(/\bMedium\b/);
  });
});
