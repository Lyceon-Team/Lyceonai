// @vitest-environment jsdom
/**
 * G4-04 — the Calendar tab: the student's read-only calendar, full width, inside the shell.
 *
 * @spec [Guardian_Closure_Plan G4-04 named proof: "RTL: calendar inside the shell, with no act
 *       controls"; owner 2026-09-30 (hide "← Dashboard" by a prop)] | @implemented [2026-09-30]
 *
 * plain English: mounts the real routes at `/guardian/:id/calendar` with a week that holds a
 * real block (presence first), and asserts the calendar is inside the ONE guardian shell with
 * the Calendar tab current, that the calendar's own "← Dashboard" link is hidden, and that no
 * control that would act on the plan is rendered — no start, resume, do-it-now, move, remove,
 * edit-schedule or refresh.
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADA, calendarWeek, json, mountApp, net, roster } from "./test-harness";
import { browserLocalToday } from "@/features/calendar/lib/dates";

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

const BLOCK_ID = "b10c0000-0000-4000-8000-000000000001";

/** The week with one practice block today — the guardian projection's shape, schema-parsed. */
function weekWithBlock(): Record<string, unknown> {
  const today = browserLocalToday();
  const base = calendarWeek();
  return {
    ...base,
    days: [
      {
        local_date: today,
        is_study_day: true,
        status: "today",
        blocks: [
          {
            block: {
              block_id: BLOCK_ID,
              scheduled_date: today,
              display_ordinal: 1,
              block_type: "practice",
              section: "M",
              scope: {
                level: "domain",
                mix: [{ domain: "Algebra", count: 15 }],
              },
              target_count: 15,
            },
            actual: 0,
            progress: 0,
            status: "scheduled",
          },
        ],
        extra_work: [],
        planned_count: 15,
        actual_count: 0,
        extra_count: 0,
      },
    ],
  };
}

beforeEach(() => {
  net.reset();
  net.roster = roster([{ id: ADA, name: "Ada" }]);
});
afterEach(cleanup);

describe("G4-04 the Calendar tab", () => {
  it("renders the calendar inside the shell, with no act controls and no back link", async () => {
    net.handlers.push((url) =>
      url.startsWith(`/api/students/${ADA}/calendar?`)
        ? json(weekWithBlock())
        : undefined,
    );
    mountApp(Router, `/guardian/${ADA}/calendar`);

    // Presence first: the shell, the current tab, and the block from the payload.
    expect(await screen.findByTestId("guardian-shell")).toBeTruthy();
    expect(
      screen.getByTestId("guardian-tab-calendar").getAttribute("aria-current"),
    ).toBe("page");
    expect(await screen.findAllByText(/Algebra/)).not.toHaveLength(0);
    expect(document.querySelector(".lyceon-calendar")).not.toBeNull();

    // Absence: the calendar's own exit, and every control that would act on the plan.
    expect(screen.queryByTestId("calendar-back-link")).toBeNull();
    for (const name of [
      /^start/i,
      /resume/i,
      /do it now/i,
      /^move/i,
      /remove/i,
      /edit schedule/i,
      /refresh plan/i,
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByTestId("topbar-edit-schedule")).toBeNull();
  });
});
