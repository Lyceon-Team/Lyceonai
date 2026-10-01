// @vitest-environment jsdom
/**
 * U7 (practice half) — an abandoned practice session is never playable.
 *
 * @spec [ruling 17; brief R4 §2.5, U7] | @implemented [2026-09-22]
 *
 * WHY THIS TEST EXISTS. `GET /api/practice/sessions/:id/state` applies no status
 * predicate — ownership only (`practice-canonical.ts:2653-2662`) — and the stale-session
 * sweeper flips idle sessions to `abandoned` (`stale-session-sweep.ts:70-71`). The page
 * DECLARED `state` and `readOnly` on its DTO (`resume-practice.tsx:41`, `:45`) and read
 * neither, so a bookmark or a back button rendered the full loop on a dead session and
 * the student only found out at `/next` (`practice-canonical.ts:1897-1907`). The server
 * already ships the answer at `practice-canonical.ts:2703`.
 *
 * This is the one abandoned-session exposure pre-build check 3 found, and it is closed
 * client-side — no server change, so R4 stayed within scope.
 *
 * PLANT: remove the `if (session.readOnly)` guard from `resume-practice.tsx` and both
 * assertions below go red (the loop renders for an abandoned session).
 *
 * The existing `resume-practice.test.tsx` covers only `state: "active"` (`:73`, `:113`,
 * `:145`), which is exactly why the gap survived; this file adds the missing cases
 * rather than changing that one.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const canonicalProps = vi.hoisted(() => ({
  captured: null as Record<string, unknown> | null,
}));
vi.mock("@/components/practice/CanonicalPracticePage", () => ({
  default: (props: Record<string, unknown>) => {
    canonicalProps.captured = props;
    return <div data-testid="canonical-practice-page" />;
  },
}));

const queryMock = vi.hoisted(() => ({ useQuery: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: queryMock.useQuery }));
vi.mock("wouter", () => ({
  useRoute: () => [true, { sessionId: "swept-session-001" }],
}));
vi.mock("@/lib/client-instance", () => ({
  getClientInstanceId: () => "test-client-instance",
}));
vi.mock("@/lib/api-error", () => ({ isApiError: () => false }));

import ResumePracticePage from "./resume-practice";

function stateBody(over: Record<string, unknown>): Record<string, unknown> {
  return {
    sessionId: "swept-session-001",
    section: "M",
    mode: "balanced",
    state: "active",
    currentOrdinal: 1,
    answeredCount: 0,
    targetQuestionCount: 10,
    readOnly: false,
    ...over,
  };
}

describe("resume-practice — closed sessions are not playable (ruling 17)", () => {
  beforeEach(() => {
    canonicalProps.captured = null;
  });

  it("U7: an abandoned session shows the closed screen, not the loop", () => {
    queryMock.useQuery.mockReturnValue({
      data: stateBody({ state: "abandoned", readOnly: true }),
      isLoading: false,
      error: null,
    });

    render(<ResumePracticePage />);

    expect(screen.getByTestId("practice-session-closed")).not.toBeNull();
    expect(screen.getByText("This session has ended")).not.toBeNull();
    expect(screen.queryByTestId("canonical-practice-page")).toBeNull();
    expect(canonicalProps.captured).toBeNull();
  });

  it("U7: an abandoned DIAGNOSTIC session is equally unplayable", () => {
    // The guard sits before the diagnostic branch for exactly this case.
    queryMock.useQuery.mockReturnValue({
      data: stateBody({
        mode: "diagnostic",
        section: null,
        state: "abandoned",
        readOnly: true,
      }),
      isLoading: false,
      error: null,
    });

    render(<ResumePracticePage />);

    expect(screen.getByTestId("practice-session-closed")).not.toBeNull();
    expect(screen.queryByTestId("canonical-practice-page")).toBeNull();
  });

  it("a completed session is closed too, with its own copy — finished, not broken", () => {
    queryMock.useQuery.mockReturnValue({
      data: stateBody({ state: "completed", readOnly: true }),
      isLoading: false,
      error: null,
    });

    render(<ResumePracticePage />);

    expect(screen.getByText("Session complete")).not.toBeNull();
    expect(screen.queryByText("This session has ended")).toBeNull();
    expect(screen.queryByTestId("canonical-practice-page")).toBeNull();
  });

  it("an ACTIVE session still renders the loop — the guard is not over-broad", () => {
    queryMock.useQuery.mockReturnValue({
      data: stateBody({}),
      isLoading: false,
      error: null,
    });

    render(<ResumePracticePage />);

    expect(screen.getByTestId("canonical-practice-page")).not.toBeNull();
    expect(screen.queryByTestId("practice-session-closed")).toBeNull();
  });
});
