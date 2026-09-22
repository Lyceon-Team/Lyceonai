// @vitest-environment jsdom
/**
 * A guardian can reach EACH linked student's calendar from the dashboard.
 *
 * @spec [Doc_05F_Study_Calendar, §16 guardian view (derived from link AND the STUDENT's
 *        entitlement), formula sheet item 14 — GET /api/students/:studentId/calendar]
 *       [lyceon-coding-standards §11.3, §6.2 — the server always enforces]
 * | @implemented [2026-09-22]
 *
 * WHY PER STUDENT. The route is scoped to a student id and a guardian may have several
 * linked, so one global "Calendar" link could not say whose. The link belongs on the row.
 *
 * WHY IT IS NEVER HIDDEN. `has_active_entitlement` is on the wire and the tempting thing is
 * to hide the link when it is false. That would be the client deciding access, which §7.12
 * forbids, and it would strand a guardian whose student paid a minute ago until this
 * component happened to refetch. §16 is derived SERVER-side and the route answers 402 on its
 * own. The unfunded case is asserted below precisely so a future "tidy-up" that hides the
 * link turns this file red.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type TestStudent = {
  id: string;
  email: string;
  display_name: string | null;
  has_active_entitlement: boolean;
  entitlement_lapsed: boolean;
};

let students: TestStudent[];

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: {
      id: "guardian-1",
      email: "guardian@example.test",
      display_name: "Pat",
      role: "guardian",
    },
    isLoading: false,
    authLoading: false,
    isAuthenticated: true,
    isGuardian: true,
    signOut: vi.fn(async () => {}),
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useGuardianStudents", async () => {
  const actual = await vi.importActual<
    typeof import("@/hooks/useGuardianStudents")
  >("@/hooks/useGuardianStudents");
  return {
    ...actual,
    useGuardianStudents: () => ({
      data: { students },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});
// Every other call this page makes on mount answers with its empty shape. None of them is
// what this file is about; they only have to not throw.
vi.mock("@/lib/csrf", () => ({
  csrfFetch: vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: {}, requestId: "test" }),
  })),
}));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { unread: 0 }, requestId: "test" }),
  })),
}));

const { default: GuardianDashboard } = await import("./guardian-dashboard");

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GuardianDashboard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  students = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      email: "ada@example.test",
      display_name: "Ada",
      has_active_entitlement: true,
      entitlement_lapsed: false,
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      email: "bo@example.test",
      display_name: "Bo",
      has_active_entitlement: false,
      entitlement_lapsed: true,
    },
  ];
});

describe("guardian dashboard — a calendar link per linked student (§16)", () => {
  it("renders one link per student, each to that student's calendar route", async () => {
    renderDashboard();

    for (const student of students) {
      const link = await screen.findByTestId(
        `guardian-calendar-link-${student.id}`,
      );
      // The anchor that carries the destination is the wouter <Link> wrapping the button.
      const anchor = link.closest("a");
      expect(anchor).not.toBeNull();
      expect(anchor?.getAttribute("href")).toBe(
        `/students/${student.id}/calendar`,
      );
    }
  });

  it("names the student, so two linked students are told apart", async () => {
    renderDashboard();
    const link = await screen.findByTestId(
      "guardian-calendar-link-11111111-1111-1111-1111-111111111111",
    );
    expect(link.getAttribute("title")).toBe("View Ada's calendar");
  });

  it("still renders for a student whose entitlement LAPSED — the route answers 402, not the client", async () => {
    renderDashboard();
    // Bo is unfunded and lapsed. Hiding the link here would be the client gating access;
    // §16 is derived server-side and the page has its own 402 state.
    const link = await screen.findByTestId(
      "guardian-calendar-link-22222222-2222-2222-2222-222222222222",
    );
    expect(link.closest("a")?.getAttribute("href")).toBe(
      "/students/22222222-2222-2222-2222-222222222222/calendar",
    );
  });

  it("negative control: with no linked students there are no calendar links", async () => {
    students = [];
    renderDashboard();
    await waitFor(() => {
      expect(screen.queryAllByTestId(/^guardian-calendar-link-/)).toHaveLength(
        0,
      );
    });
  });
});
