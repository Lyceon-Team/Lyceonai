// @vitest-environment jsdom
/**
 * @spec [SCL-186 (strikes Doc 05 Parent §12.2 "your recency-weighted accuracy is Y%");
 *   owner ruling 6, 2026-09-29; Doc 05 AC#20] | @implemented [2026-09-29] |
 * plain English: the student dashboard renders no raw accuracy figure, even though the
 * `/api/progress/kpis` payload it reads still carries a non-null `week.accuracy`. Counts of
 * the student's own activity (questions solved, streak) still render.
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
      if (queryKey[0] === "/api/progress/kpis") {
        return { data: queryMock.kpis, isLoading: false, error: null };
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
vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
import {
  STUDENT_OVERALL_KPI_ROW,
  buildStudentKpiPayload,
} from "@/test-support/student-kpi.harness";

afterEach(() => {
  cleanup();
});

describe("student dashboard — no raw accuracy (SCL-186, ruling 6)", () => {
  it("renders the activity counts and no accuracy percentage when the KPI payload carries one", async () => {
    const payload = await buildStudentKpiPayload();
    queryMock.kpis = payload;

    // Presence of the thing the page must NOT show: the real payload carries a
    // non-null accuracy, so an absence below is not an empty-input pass.
    const week = (payload as { week: { accuracy: unknown } }).week;
    expect(week.accuracy).toBe(73);

    const { container } = render(<LyceonDashboard />);
    const text = container.textContent ?? "";

    // Presence before absence: the page rendered its KPI tiles.
    expect(screen.getByText("Questions Solved (7d)")).toBeTruthy();
    expect(text).toContain(String(STUDENT_OVERALL_KPI_ROW.events_last_7d));
    expect(text).toContain(
      `${STUDENT_OVERALL_KPI_ROW.events_last_7d} questions solved this week`,
    );
    // The tile that replaced accuracy: the streak, an own-activity count.
    expect(screen.getByText("Current Streak (days)")).toBeTruthy();
    expect(text).toContain(
      `Current Streak (days)${STUDENT_OVERALL_KPI_ROW.current_streak_days}`,
    );

    // Absence: no accuracy label, no accuracy figure, no percentage at all.
    expect(text).not.toMatch(/accuracy/i);
    expect(text).not.toContain("73");
    expect(text).not.toMatch(/\d\s*%/);
  });
});
