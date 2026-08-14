// @vitest-environment jsdom
/**
 * @spec [Doc-05C §7.4, Doc-01_V8 §20–24 diagnostic prompting]
 * @implemented 2026-08-14
 *
 * Intent: the diagnostic CTA card appears exactly when
 * estimateStatus === "no_baseline" and is completely absent for
 * baseline_only, computed, and undefined (loading/error).
 *
 * This test WOULD FAIL if:
 * - DiagnosticCTAGate rendered the card unconditionally
 * - The gate used a broad check (e.g. !== "computed") instead of === "no_baseline"
 * - The gate rendered for undefined/loading state
 *
 * expected outcome: card present for no_baseline; absent for all other states.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiagnosticCTAGate } from "./DiagnosticCTAGate";

/* ── Mock dependencies of DiagnosticCTACard ── */
vi.mock("@/hooks/useDiagnosticStart", () => ({
  useDiagnosticStart: () => ({
    startDiagnostic: vi.fn().mockResolvedValue("gate-test-id"),
    isStarting: false,
    error: null,
    clearError: vi.fn(),
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

describe("DiagnosticCTAGate — behavioral show/hide", () => {
  it("renders DiagnosticCTACard when estimateStatus is 'no_baseline'", () => {
    render(<DiagnosticCTAGate estimateStatus="no_baseline" />);

    expect(screen.getByText("Work on Diagnostic")).not.toBeNull();
    expect(screen.getByText("Get your projected SAT score")).not.toBeNull();
  });

  it("does NOT render when estimateStatus is 'baseline_only'", () => {
    render(<DiagnosticCTAGate estimateStatus="baseline_only" />);

    expect(screen.queryByText("Work on Diagnostic")).toBeNull();
    expect(screen.queryByText("Get your projected SAT score")).toBeNull();
  });

  it("does NOT render when estimateStatus is 'computed'", () => {
    render(<DiagnosticCTAGate estimateStatus="computed" />);

    expect(screen.queryByText("Work on Diagnostic")).toBeNull();
    expect(screen.queryByText("Get your projected SAT score")).toBeNull();
  });

  it("does NOT render when estimateStatus is undefined (loading/error)", () => {
    render(<DiagnosticCTAGate estimateStatus={undefined} />);

    expect(screen.queryByText("Work on Diagnostic")).toBeNull();
    expect(screen.queryByText("Get your projected SAT score")).toBeNull();
  });

  it("passes className through to DiagnosticCTACard", () => {
    const { container } = render(
      <DiagnosticCTAGate estimateStatus="no_baseline" className="mb-6" />,
    );

    const card = container.querySelector("[class*='mb-6']");
    expect(card).not.toBeNull();
  });
});
