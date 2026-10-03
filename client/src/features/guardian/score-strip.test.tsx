// @vitest-environment jsdom
/**
 * G5-01 — the Dashboard's score strip (ruling R13: the guardian Dashboard follows the design).
 *
 * @spec [Guardian_Closure_Plan G5-01, R13 (Karl, 2026-10-02); the canvas boards "Wave 5 — BUILD
 *       TARGET" desktop 1440 / phone 390] | @implemented [2026-10-02]
 *
 * plain English: mounts the real app at `/guardian/:id`, served the shared scenario's REAL
 * calendar week (`buildCalendarRange` through the server's guardian projection), and reads the
 * strip: the projected band from the calendar's `projection` with the per-section ranges, the
 * target "Set by <student>", the test date and its countdown, the streak with "Longest: N".
 * A `null` streak shows "—"; an absent target or date shows the calendar's guardian absence
 * copy, never a zero. The phone strip (projected full width, three compact tiles) carries the
 * same numbers.
 */
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserLocalToday, daysBetween } from "@/features/calendar/lib/dates";
import {
  ADA,
  calendarWeek,
  json,
  mountApp,
  net,
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

beforeEach(() => {
  net.reset();
  net.roster = roster([{ id: ADA, name: "Ada" }]);
});
afterEach(cleanup);

/** Serves the Dashboard, with the calendar week replaced by `calendar` when given. */
function serve(calendar?: Record<string, unknown>): void {
  if (calendar !== undefined) {
    net.handlers.push((url) =>
      url.startsWith(`/api/students/${ADA}/calendar?`)
        ? json(calendar)
        : undefined,
    );
  }
  net.handlers.push(serveDashboard(ADA));
}

async function strips(): Promise<{ desk: HTMLElement; phone: HTMLElement }> {
  mountApp(Router, `/guardian/${ADA}`);
  const desk = await screen.findByTestId("score-strip");
  const phone = screen.getByTestId("score-strip-phone");
  return { desk, phone };
}

const tile = (root: HTMLElement, name: string): HTMLElement =>
  within(root).getByTestId(`score-tile-${name}`);

describe("G5-01 the score strip reads the calendar payload", () => {
  it("desktop: projected band with per-section ranges, target, test date, streak", async () => {
    serve();
    const { desk } = await strips();
    // The scenario's projection: RW 590–650, Math 590–630, so the composite is 1180–1280.
    const projected = tile(desk, "projected");
    expect(projected).toHaveTextContent("Projected SAT score");
    expect(within(projected).getByTestId("score-value")).toHaveTextContent(
      /^1180–1280$/,
    );
    expect(projected).toHaveTextContent(
      "Reading & Writing 590–650 · Math 590–630",
    );

    const target = tile(desk, "target");
    expect(within(target).getByTestId("score-value")).toHaveTextContent(
      /^1350$/,
    );
    expect(target).toHaveTextContent("Set by Ada");

    const days = daysBetween(browserLocalToday(), "2026-12-06");
    const date = tile(desk, "test-date");
    expect(date).toHaveTextContent("SAT test date");
    expect(within(date).getByTestId("score-value")).toHaveTextContent(
      /^Dec 6$/,
    );
    expect(date).toHaveTextContent(`${days} days away`);

    const streak = tile(desk, "streak");
    expect(streak).toHaveTextContent("Study streak");
    expect(within(streak).getByTestId("score-value")).toHaveTextContent(
      /^4 days$/,
    );
    expect(streak).toHaveTextContent("Longest: 11");
  });

  it("phone: the projected tile with abbreviated sections, then three compact tiles", async () => {
    serve();
    const { phone } = await strips();
    expect(
      within(tile(phone, "projected")).getByTestId("score-value"),
    ).toHaveTextContent(/^1180–1280$/);
    expect(tile(phone, "projected")).toHaveTextContent(
      "R&W 590–650 · Math 590–630",
    );
    const days = daysBetween(browserLocalToday(), "2026-12-06");
    expect(tile(phone, "target")).toHaveTextContent(/^Target1350$/);
    expect(tile(phone, "test-date")).toHaveTextContent(
      new RegExp(`^Test${days} days$`),
    );
    expect(tile(phone, "streak")).toHaveTextContent(/^Streak4 days$/);
  });

  it("a null streak shows — and never a zero", async () => {
    serve(calendarWeek({ streak: null }));
    const { desk, phone } = await strips();
    expect(
      within(tile(desk, "streak")).getByTestId("score-value"),
    ).toHaveTextContent(/^—$/);
    expect(tile(phone, "streak")).toHaveTextContent(/^Streak—$/);
    expect(tile(desk, "streak")).not.toHaveTextContent(/\b0 days\b/);
  });

  it("no target and no test date: the guardian absence copy, no number", async () => {
    serve(calendarWeek({ targetScore: null, testDate: null }));
    const { desk } = await strips();
    expect(
      within(tile(desk, "target")).getByTestId("score-value"),
    ).toHaveTextContent(/^—$/);
    expect(tile(desk, "target")).toHaveTextContent("No target set");
    expect(tile(desk, "target")).not.toHaveTextContent("Set by");
    expect(
      within(tile(desk, "test-date")).getByTestId("score-value"),
    ).toHaveTextContent(/^—$/);
    expect(tile(desk, "test-date")).toHaveTextContent("No test date");
  });
});
