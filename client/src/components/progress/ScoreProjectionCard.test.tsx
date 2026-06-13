// @vitest-environment jsdom
// @spec [Lane-C contract LC-AM3-UI-001; Doc-05A_V1 §10.1 mastery-from-observed-events-only]
// @implemented [2026-06-13]
// plain English: proves the student-facing score surface renders an honest "not yet available"
//   state (no fabricated number, no crash) when the estimate is uncomputed (05C projections
//   deferred), and renders the real composite only when the estimate is computed.
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

describe("ScoreProjectionCard — honest uncomputed (LC-AM3-UI-001)", () => {
  it("renders not-yet-available (no fabricated number, no crash) when the estimate is uncomputed", () => {
    queryMock.useQuery.mockReturnValue({
      data: {
        estimateStatus: "not_yet_available",
        estimate: null,
        totalQuestionsAttempted: 25,
        lastUpdated: "2026-01-01T00:00:00Z",
      },
      isLoading: false,
      error: null,
    });
    render(<ScoreProjectionCard />);
    // honest message present...
    expect(screen.getByText(/isn.t available yet/i)).toBeTruthy();
    // ...and NO fabricated baseline score (the old 200/400 bug) anywhere.
    expect(screen.queryByText("400")).toBeNull();
    expect(screen.queryByText("200")).toBeNull();
  });

  it("renders the real composite when the estimate is computed", () => {
    queryMock.useQuery.mockReturnValue({
      data: {
        estimateStatus: "computed",
        estimate: {
          composite: 1180,
          math: 600,
          rw: 580,
          range: { low: 1100, high: 1260 },
          confidence: 0.5,
          breakdown: { math: [], rw: [] },
        },
        totalQuestionsAttempted: 60,
        lastUpdated: "2026-01-01T00:00:00Z",
      },
      isLoading: false,
      error: null,
    });
    render(<ScoreProjectionCard />);
    expect(screen.getByText("1180")).toBeTruthy();
  });
});
