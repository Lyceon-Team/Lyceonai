// @vitest-environment jsdom
/**
 * @spec [Doc-05C §7.4, Doc-01_V8 §20–24 diagnostic prompting]
 * @implemented 2026-08-14
 *
 * plain English: tests the DiagnosticPromptModal — verifying it shows when
 * shouldShow=true and sessionStorage dismiss key is unset, hides when dismissed
 * (sets sessionStorage key), hides when shouldShow=false (diagnostic done),
 * and calls useDiagnosticStart on action click.
 *
 * expected outcome: modal opens only for undiagnosed, undismissed students;
 * dismiss persists for the browser session; collapse-on-done gates correctly.
 *
 * trade-offs: mocks sessionStorage and useDiagnosticStart.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiagnosticPromptModal } from "./DiagnosticPromptModal";

/* ── Mock useDiagnosticStart ── */
const startDiagnosticMock = vi.fn().mockResolvedValue("diag-session-123");

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
  useLocation: () => ["/dashboard", setLocationMock],
}));

/* ── sessionStorage mock ── */
const sessionStorageMock = (() => {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      for (const k of Object.keys(store)) delete store[k];
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((_i: number) => null),
  };
})();

describe("DiagnosticPromptModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "sessionStorage", {
      value: sessionStorageMock,
      writable: true,
    });
    sessionStorageMock.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows modal when shouldShow=true and not dismissed", () => {
    render(<DiagnosticPromptModal shouldShow={true} />);

    expect(
      screen.getByText("Get your projected SAT score"),
    ).not.toBeNull();
    expect(screen.getByText("Work on Diagnostic")).not.toBeNull();
    expect(screen.getByText("Maybe later")).not.toBeNull();
  });

  it("does NOT show modal when shouldShow=false (diagnostic done)", () => {
    render(<DiagnosticPromptModal shouldShow={false} />);

    expect(
      screen.queryByText("Get your projected SAT score"),
    ).toBeNull();
  });

  it("does NOT show modal when sessionStorage dismiss key is set", () => {
    sessionStorageMock.setItem("lyceon:diagnostic_modal_dismissed", "1");

    render(<DiagnosticPromptModal shouldShow={true} />);

    expect(
      screen.queryByText("Get your projected SAT score"),
    ).toBeNull();
  });

  it("sets sessionStorage dismiss key on 'Maybe later' click", () => {
    render(<DiagnosticPromptModal shouldShow={true} />);

    const laterButton = screen.getByText("Maybe later");
    fireEvent.click(laterButton);

    expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
      "lyceon:diagnostic_modal_dismissed",
      "1",
    );
  });

  it("calls useDiagnosticStart and navigates on action click", async () => {
    render(<DiagnosticPromptModal shouldShow={true} />);

    const actionButton = screen.getByText("Work on Diagnostic");
    fireEvent.click(actionButton);

    // Wait for async startDiagnostic to resolve
    await vi.waitFor(() => {
      expect(startDiagnosticMock).toHaveBeenCalledTimes(1);
    });

    await vi.waitFor(() => {
      expect(setLocationMock).toHaveBeenCalledWith(
        "/practice/session/diag-session-123",
      );
    });
  });

  it("contains projected-score payoff copy", () => {
    render(<DiagnosticPromptModal shouldShow={true} />);

    expect(
      screen.getByText(/starting score projection/i),
    ).not.toBeNull();
  });
});
