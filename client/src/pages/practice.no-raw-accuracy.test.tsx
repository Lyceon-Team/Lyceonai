// @vitest-environment jsdom
/**
 * @spec [SCL-186 (strikes Doc 05 Parent §12.2 "your recency-weighted accuracy is Y%");
 *   owner ruling 6, 2026-09-29; Doc 05 AC#20] | @implemented [2026-09-29] |
 * plain English: the practice hub renders no raw accuracy figure, even though the
 * `/api/progress/kpis` payload it reads still carries a non-null `week.accuracy`. The
 * "Questions (7d)" count of the student's own activity still renders.
 *
 * The payload is the real KPI builder's output (student-kpi.harness.ts), so the absence
 * assertions run against a payload proven to carry the accuracy value first.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../../../apps/api/src/lib/supabase-server", async () => ({
  supabaseServer: (await import("@/test-support/student-kpi.harness"))
    .supabaseServerStub,
}));

const queryMock = vi.hoisted(() => ({
  kpis: undefined as unknown,
}));
vi.mock("@tanstack/react-query", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      const base = {
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      };
      if (queryKey[0] === "/api/progress/kpis") {
        return { ...base, data: queryMock.kpis };
      }
      return { ...base, data: undefined };
    },
  };
});
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: { id: "11111111-1111-4111-8111-111111111111" },
    authLoading: false,
  }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/practice", vi.fn()],
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useActiveSessions", () => ({
  useActiveSessions: () => ({
    sessions: [],
    maxConcurrentSessions: 5,
    terminateSession: vi.fn(),
    isTerminating: false,
  }),
}));
vi.mock("@/hooks/usePractice", () => ({
  usePractice: () => ({
    startSession: vi.fn(),
    quotaExhausted: false,
    error: null,
  }),
}));
vi.mock("@/features/calendar/api", () => ({
  useStreak: () => ({ data: undefined }),
}));
vi.mock("@/components/diagnostic/DiagnosticCTAGate", () => ({
  DiagnosticCTAGate: () => null,
}));

import Practice from "./practice";
import {
  STUDENT_OVERALL_KPI_ROW,
  buildStudentKpiPayload,
} from "@/test-support/student-kpi.harness";

afterEach(() => {
  cleanup();
});

describe("practice hub — no raw accuracy (SCL-186, ruling 6)", () => {
  it("renders the weekly question count and no accuracy percentage when the KPI payload carries one", async () => {
    const payload = await buildStudentKpiPayload();
    queryMock.kpis = payload;

    // The real payload carries a non-null accuracy, so the absence below is not an
    // empty-input pass.
    const week = (payload as { week: { accuracy: unknown } }).week;
    expect(week.accuracy).toBe(73);

    const { container } = render(<Practice />);
    const text = container.textContent ?? "";

    // Presence before absence: the KPI card rendered its activity count.
    expect(screen.getByText("Questions (7d)")).toBeTruthy();
    expect(text).toContain(
      `Questions (7d)${STUDENT_OVERALL_KPI_ROW.events_last_7d}`,
    );

    // Absence: no accuracy label, no accuracy figure, no percentage at all.
    expect(text).not.toMatch(/accuracy/i);
    expect(text).not.toContain("73");
    expect(text).not.toMatch(/\d\s*%/);
  });
});
