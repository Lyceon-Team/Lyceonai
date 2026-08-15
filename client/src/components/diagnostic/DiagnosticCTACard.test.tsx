// @vitest-environment jsdom
/**
 * @spec [Doc-05C §7.4, Doc-01_V8 §20–24 diagnostic prompting]
 * @implemented 2026-08-14
 *
 * plain English: tests the DiagnosticCTACard — verifying it renders the
 * action-neutral "Work on Diagnostic" copy with projected-score payoff,
 * calls useDiagnosticStart on click, and navigates on success.
 *
 * expected outcome: card renders warm-gold CTA, fires the shared diagnostic
 * start hook, and navigates to the practice session.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiagnosticCTACard } from "./DiagnosticCTACard";

/* ── Mock useDiagnosticStart ── */
const startDiagnosticMock = vi.fn().mockResolvedValue("diag-cta-789");

vi.mock("@/hooks/useDiagnosticStart", () => ({
  useDiagnosticStart: () => ({
    startDiagnostic: startDiagnosticMock,
    isStarting: false,
    error: null,
    clearError: vi.fn(),
  }),
}));

/* ── Mock wouter ── */
const setLocationMock = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/practice", setLocationMock],
}));

describe("DiagnosticCTACard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the action-neutral CTA with projected-score payoff copy", () => {
    render(<DiagnosticCTACard />);

    expect(screen.getByText("Work on Diagnostic")).not.toBeNull();
    expect(
      screen.getByText("Get your projected SAT score"),
    ).not.toBeNull();
    expect(
      screen.getByText(/starting score projection/i),
    ).not.toBeNull();
  });

  it("uses warm-gold premium styling (not destructive red)", () => {
    const { container } = render(<DiagnosticCTACard />);

    const card = container.querySelector("[class*='bg-[#FFFAEF]']");
    expect(card).not.toBeNull();
  });

  it("calls useDiagnosticStart and navigates on click", async () => {
    render(<DiagnosticCTACard />);

    const button = screen.getByText("Work on Diagnostic");
    fireEvent.click(button);

    await vi.waitFor(() => {
      expect(startDiagnosticMock).toHaveBeenCalledTimes(1);
    });

    await vi.waitFor(() => {
      expect(setLocationMock).toHaveBeenCalledWith(
        "/practice/session/diag-cta-789",
      );
    });
  });

  it("applies custom className when provided", () => {
    const { container } = render(<DiagnosticCTACard className="mb-6" />);

    const card = container.querySelector("[class*='mb-6']");
    expect(card).not.toBeNull();
  });
});
