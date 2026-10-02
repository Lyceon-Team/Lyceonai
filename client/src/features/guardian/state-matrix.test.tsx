// @vitest-environment jsdom
/**
 * G4-06 — the guardian state matrix: every surface, every state, named.
 *
 * @spec [Guardian_Closure_Plan G4-06 named proof: "a parametrised RTL state-matrix test
 *       covering every surface and state"; R7 / G3-04] | @implemented [2026-09-30]
 *
 * plain English: the REAL route switch, signed in as a guardian of Ada, at each of the four
 * per-student surfaces (Dashboard, Calendar, exam list, exam detail), driven into each state
 * by what the SERVER answers — a roster that never arrives, a 500, Ada lapsed in the roster, a
 * 402, Ada gone from the roster, a 404 that forgets her, a calendar not set up, no exams. Each
 * state must render its one state component and name Ada. The no-students state is the home
 * page's. A state that does not apply to a surface (no exams on the calendar) is not in its
 * row of the matrix.
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADA,
  BO,
  EXAM_SESSION,
  calendarSetupRequired,
  json,
  mountApp,
  net,
  noExams,
  pending,
  roster,
  serveDashboard,
} from "./test-harness";

vi.mock("@/contexts/SupabaseAuthContext", async () => {
  const { GUARDIAN_AUTH: auth } = await import("./test-harness");
  return {
    useSupabaseAuth: () => ({ ...auth, signOut: vi.fn(async () => undefined) }),
  };
});
vi.mock("@/lib/csrf", async () => {
  const { scriptedFetch: fetcher } = await import("./test-harness");
  return {
    getCsrfToken: vi.fn(async () => "t"),
    clearCsrfToken: vi.fn(),
    csrfFetch: vi.fn(fetcher),
  };
});

const { Router } = await import("@/App");

type Surface = "dashboard" | "calendar" | "exams" | "exam";
const SURFACES: Record<Surface, string> = {
  dashboard: `/guardian/${ADA}`,
  calendar: `/guardian/${ADA}/calendar`,
  exams: `/guardian/${ADA}/exams`,
  exam: `/guardian/${ADA}/exams/${EXAM_SESSION}`,
};

const PER_STUDENT = `/api/students/${ADA}/`;
const perStudentReads = (): string[] =>
  net.log.filter((l) => l.includes(PER_STUDENT));

/** Answer every per-student read for Ada with one response. */
function everyReadAnswers(status: number, body: unknown): void {
  net.handlers.push((url) =>
    url.startsWith(PER_STUDENT) ? json(body, status) : undefined,
  );
}

type State = {
  name: string;
  surfaces: readonly Surface[];
  arrange: () => void;
  testId: string;
  /** Text the state must show — the student's name, where the state has one. */
  names: RegExp | null;
  extra?: () => Promise<void> | void;
};

const ALL: readonly Surface[] = ["dashboard", "calendar", "exams", "exam"];

const STATES: readonly State[] = [
  {
    name: "loading",
    surfaces: ALL,
    arrange: () =>
      net.handlers.push((url) =>
        url === "/api/guardian/students" ? pending() : undefined,
      ),
    testId: "guardian-state-loading",
    names: null,
  },
  {
    name: "error (roster)",
    surfaces: ALL,
    arrange: () =>
      net.handlers.push((url) =>
        url === "/api/guardian/students"
          ? json({ error: "Internal server error" }, 500)
          : undefined,
      ),
    testId: "guardian-state-error",
    names: null,
  },
  {
    name: "error (the surface's read)",
    surfaces: ALL,
    arrange: () => everyReadAnswers(500, { error: "Internal server error" }),
    testId: "guardian-state-error",
    names: /Ada's/,
  },
  {
    name: "lapsed (roster)",
    surfaces: ALL,
    arrange: () => {
      net.roster = roster([{ id: ADA, name: "Ada", lapsed: true }]);
    },
    testId: "guardian-state-lapsed",
    names: /Ada's subscription has ended/,
    extra: () => {
      const cta = screen.getByTestId("guardian-state-lapsed-cta");
      expect(cta.textContent).toBe("Choose a plan for Ada");
      expect(cta.getAttribute("href")).toBe(`/guardian/students?choose=${ADA}`);
      // Decided before any read: nothing is asked that the server would refuse.
      expect(perStudentReads()).toEqual([]);
    },
  },
  {
    name: "lapsed (never subscribed)",
    surfaces: ["dashboard"],
    arrange: () => {
      net.roster = roster([{ id: ADA, name: "Ada", unpaid: true }]);
    },
    testId: "guardian-state-lapsed",
    names: /Ada doesn't have a subscription yet/,
  },
  {
    name: "lapsed (a 402 on the surface's read)",
    surfaces: ALL,
    arrange: () =>
      everyReadAnswers(402, {
        error: "Subscription required",
        code: "PAYMENT_REQUIRED",
        requestId: "r",
      }),
    testId: "guardian-state-lapsed",
    names: /Ada's subscription has ended/,
  },
  {
    name: "revoked (not in the roster)",
    surfaces: ALL,
    arrange: () => {
      net.roster = roster([{ id: BO, name: "Bo" }]);
    },
    testId: "guardian-state-revoked",
    names: /This student is no longer linked to your account/,
    extra: () => expect(perStudentReads()).toEqual([]),
  },
  {
    name: "revoked (a 404 on the surface's read)",
    surfaces: ALL,
    arrange: () => {
      net.handlers.push((url) => {
        if (!url.startsWith(PER_STUDENT)) return undefined;
        // The link is gone: the next roster read no longer lists Ada.
        net.roster = roster([{ id: BO, name: "Bo" }]);
        return json({ error: "Not found" }, 404);
      });
    },
    testId: "guardian-state-revoked",
    names: /Ada is no longer linked to your account/,
    // G3-04 (R7), on the Wave 4 surfaces: the 404 refetches the roster, and none of Ada's
    // panels survive it. (The single-page dashboard's PG proof of this was deleted with that
    // page on 2026-10-01; this is where the behaviour now lives.)
    extra: async () => {
      await waitFor(() =>
        expect(
          net.log.filter((l) => l === "GET /api/guardian/students").length,
        ).toBeGreaterThanOrEqual(2),
      );
      expect(screen.queryByTestId("domain-grid")).toBeNull();
      expect(screen.queryByTestId("latest-test-card")).toBeNull();
      expect(document.querySelector(".lyceon-calendar .week")).toBeNull();
    },
  },
  {
    name: "calendar not set up",
    surfaces: ["dashboard", "calendar"],
    arrange: () =>
      net.handlers.push((url) =>
        url.startsWith(`${PER_STUDENT}calendar?`)
          ? json(calendarSetupRequired())
          : undefined,
      ),
    testId: "guardian-state-not-set-up",
    names: /Ada hasn't set up a study plan yet/,
  },
  {
    name: "no exams yet",
    surfaces: ["dashboard", "exams"],
    arrange: () =>
      net.handlers.push((url) =>
        url === `${PER_STUDENT.slice(0, -1)}/tests`
          ? json(noExams())
          : undefined,
      ),
    testId: "guardian-state-no-exams",
    names: /Ada hasn't finished a full-length practice test yet/,
  },
];

const CASES = STATES.flatMap((state) =>
  state.surfaces.map((surface) => ({ state, surface })),
);

beforeEach(() => {
  net.reset();
  net.roster = roster([
    { id: ADA, name: "Ada" },
    { id: BO, name: "Bo" },
  ]);
});

afterEach(cleanup);

describe("guardian state matrix (G4-06)", () => {
  it.each(CASES.map((c) => [c.surface, c.state.name, c] as const))(
    "%s — %s",
    async (_surface, _name, { state, surface }) => {
      state.arrange();
      // Everything the state did not script answers as a healthy student would.
      net.handlers.push(serveDashboard(ADA));
      mountApp(Router, SURFACES[surface]);

      const found = await screen.findAllByTestId(
        state.testId,
        {},
        { timeout: 4000 },
      );
      expect(found.length).toBeGreaterThan(0);
      if (state.names !== null) {
        const text = found.map((n) => n.textContent ?? "").join(" | ");
        expect(text).toMatch(state.names);
      }
      // Never a student-facing upgrade card on a guardian screen.
      expect(screen.queryByTestId("calendar-premium-gate")).toBeNull();
      await state.extra?.();
    },
    10_000,
  );

  it("home — no students: the no-student state, with the one thing to do", async () => {
    net.roster = roster([]);
    mountApp(Router, "/guardian");
    expect(await screen.findByTestId("guardian-no-students")).toBeTruthy();
    expect(screen.getByTestId("guardian-no-students-add")).toBeTruthy();
  });

  it("the lapsed CTA lands on billing with that student's plan choice open", async () => {
    net.roster = roster([{ id: ADA, name: "Ada", lapsed: true }]);
    net.handlers.push((url) =>
      url === "/api/billing/plans"
        ? json({ plans: [], requestId: "r" })
        : undefined,
    );
    const { history } = mountApp(Router, `/guardian/students?choose=${ADA}`);
    const card = await screen.findByTestId("guardian-purchase-card");
    expect(
      (card.querySelector("[data-testid=student-select]") as HTMLSelectElement)
        .value,
    ).toBe(ADA);
    await waitFor(() => expect(history.length).toBeGreaterThan(0));
  });
});
