// @vitest-environment jsdom
/**
 * @spec [Doc-05C §7.4, Doc-01_V8 §20–24 diagnostic client wiring]
 * @implemented 2026-08-14
 *
 * Intent: a diagnostic session (mode='diagnostic', section: null) resumes
 * into the answer loop via CanonicalPracticePage — it does NOT hit the
 * "Unknown Section" fail-closed screen. Regular sessions with null section
 * still fail closed as before.
 *
 * This test WOULD FAIL if:
 * - ResumePracticePage resolved isDiagnostic AFTER the section guard
 *   (the bug: diagnostic sessions with section: null hit "Unknown Section")
 * - Diagnostic sessions were routed through the single-section resolver
 * - The fix accidentally removed the Unknown Section guard for regular sessions
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/* ── Capture CanonicalPracticePage props to verify wiring ── */
const canonicalProps = vi.hoisted(() => ({
  captured: null as Record<string, unknown> | null,
}));

vi.mock("@/components/practice/CanonicalPracticePage", () => ({
  default: (props: Record<string, unknown>) => {
    canonicalProps.captured = props;
    return <div data-testid="canonical-practice-page" />;
  },
}));

/* ── Mock useQuery to return controlled session state ── */
const queryMock = vi.hoisted(() => ({
  useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: queryMock.useQuery,
}));

/* ── Mock wouter route to provide sessionId ── */
vi.mock("wouter", () => ({
  useRoute: () => [true, { sessionId: "diag-session-001" }],
}));

/* ── Mock client instance ID ── */
vi.mock("@/lib/client-instance", () => ({
  getClientInstanceId: () => "test-client-instance",
}));

/* ── Mock api-error ── */
vi.mock("@/lib/api-error", () => ({
  isApiError: () => false,
}));

import ResumePracticePage from "./resume-practice";

describe("ResumePracticePage — diagnostic session resume", () => {
  /**
   * THE FIX: a diagnostic session (mode='diagnostic', section: null) must
   * bypass the single-section resolver and enter CanonicalPracticePage.
   * Before the fix, this hit "Unknown Section — cannot be resumed safely."
   */
  it("diagnostic session (mode='diagnostic', section: null) renders CanonicalPracticePage, not Unknown Section", () => {
    canonicalProps.captured = null;

    queryMock.useQuery.mockReturnValue({
      data: {
        sessionId: "diag-session-001",
        section: null,
        mode: "diagnostic",
        state: "active",
        currentOrdinal: 1,
        answeredCount: 0,
        targetQuestionCount: 40,
        readOnly: false,
      },
      isLoading: false,
      error: null,
    });

    render(<ResumePracticePage />);

    // Must NOT show the Unknown Section error
    expect(screen.queryByText("Unknown Section")).toBeNull();
    expect(screen.queryByText(/cannot be resumed safely/i)).toBeNull();

    // Must render CanonicalPracticePage
    expect(screen.getByTestId("canonical-practice-page")).not.toBeNull();

    // Verify diagnostic-specific props
    expect(canonicalProps.captured).not.toBeNull();
    expect(canonicalProps.captured!.isDiagnostic).toBe(true);
    expect(canonicalProps.captured!.title).toBe("Diagnostic Assessment");
    expect(canonicalProps.captured!.badgeLabel).toBe("Diagnostic");
    expect(canonicalProps.captured!.completionHref).toBe("/dashboard");
    expect(canonicalProps.captured!.sessionId).toBe("diag-session-001");
  });

  /**
   * Guard: a regular session with section: null must STILL fail closed.
   * The fix must not accidentally remove the Unknown Section guard.
   */
  it("regular session with section: null shows Unknown Section (fail-closed preserved)", () => {
    canonicalProps.captured = null;

    queryMock.useQuery.mockReturnValue({
      data: {
        sessionId: "regular-session-001",
        section: null,
        mode: "balanced",
        state: "active",
        currentOrdinal: 1,
        answeredCount: 0,
        targetQuestionCount: 20,
        readOnly: false,
      },
      isLoading: false,
      error: null,
    });

    render(<ResumePracticePage />);

    // Must show the Unknown Section error
    expect(screen.getByText("Unknown Section")).not.toBeNull();
    expect(screen.getByText(/cannot be resumed safely/i)).not.toBeNull();

    // Must NOT render CanonicalPracticePage
    expect(screen.queryByTestId("canonical-practice-page")).toBeNull();
    expect(canonicalProps.captured).toBeNull();
  });

  /**
   * Sanity: a regular math session resumes normally through the section resolver.
   */
  it("regular math session renders CanonicalPracticePage with section='M'", () => {
    canonicalProps.captured = null;

    queryMock.useQuery.mockReturnValue({
      data: {
        sessionId: "math-session-001",
        section: "M",
        mode: "balanced",
        state: "active",
        currentOrdinal: 3,
        answeredCount: 2,
        targetQuestionCount: 15,
        readOnly: false,
      },
      isLoading: false,
      error: null,
    });

    render(<ResumePracticePage />);

    expect(screen.queryByText("Unknown Section")).toBeNull();
    expect(screen.getByTestId("canonical-practice-page")).not.toBeNull();

    expect(canonicalProps.captured).not.toBeNull();
    expect(canonicalProps.captured!.section).toBe("M");
    expect(canonicalProps.captured!.isDiagnostic).toBeUndefined();
    expect(canonicalProps.captured!.completionHref).toBe("/practice");
  });
});
