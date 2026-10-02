// @vitest-environment jsdom
/**
 * G4-03 — the Dashboard tab: the endpoint map, and what is deliberately absent.
 *
 * @spec [Guardian_Closure_Plan G4-03 named proofs: "an endpoint-map test: each widget calls
 *       exactly its mapped route and parses the response with its schema. RTL: no 7-day tiles,
 *       no skills, no x/y counts"; endpoint map as updated by the owner 2026-09-30]
 *       | @implemented [2026-09-30]
 *
 * plain English: mounts the real app routes at `/guardian/:id` and serves each widget's route.
 * (1) The per-student reads are EXACTLY the map's — the calendar week, mastery/domains, the
 * exam list and the latest report — and there is no `kpi/overall`, no skills and no
 * `/api/progress/*` call. (2) Each route's answer is parsed: a malformed answer on one route
 * breaks that widget alone, into its own error, while the others still render. (3) Presence
 * first, then absence: the widgets render real content, and none of it is a 7-day tile, a
 * Skills control or an "N of M correct" count.
 */
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADA,
  calendarWeek,
  EXAM_SESSION,
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

async function renderedDashboard(): Promise<void> {
  mountApp(Router, `/guardian/${ADA}`);
  await screen.findByTestId("dashboard-header");
  await screen.findByTestId("mastery-card");
  await screen.findByTestId("latest-test-meta");
}

const studentReads = (): string[] =>
  net.log
    .filter((l) => l.startsWith("GET /api/students/"))
    .map((l) => l.replace(/\?.*$/, "?…"));

describe("G4-03 each widget calls exactly its mapped route", () => {
  it("the per-student reads are the endpoint map's, and nothing else", async () => {
    net.handlers.push(serveDashboard(ADA));
    await renderedDashboard();
    expect([...new Set(studentReads())].sort()).toEqual(
      [
        `GET /api/students/${ADA}/calendar?…`,
        `GET /api/students/${ADA}/mastery/domains`,
        `GET /api/students/${ADA}/tests`,
        `GET /api/students/${ADA}/tests/${EXAM_SESSION}/report`,
      ].sort(),
    );
    // One streak source (owner, 2026-09-30): the calendar week. No KPI, skills or legacy read.
    expect(net.log.some((l) => l.includes("/kpi/"))).toBe(false);
    expect(net.log.some((l) => l.includes("/mastery/skills"))).toBe(false);
    expect(net.log.some((l) => l.includes("/api/progress/"))).toBe(false);
  });

  it.each([
    [
      "calendar",
      (url: string) => url.includes("/calendar?"),
      "dashboard-header-strip",
    ],
    [
      "mastery/domains",
      (url: string) => url.endsWith("/mastery/domains"),
      "dashboard-mastery",
    ],
    [
      "tests",
      (url: string) => url.endsWith(`/${ADA}/tests`),
      "dashboard-latest-exam",
    ],
    [
      "the report",
      (url: string) => url.endsWith("/report"),
      "dashboard-latest-exam",
    ],
  ])(
    "a malformed %s answer is refused by its schema, breaking only that widget",
    async (_name, matches, widgetId) => {
      net.handlers.push((url) =>
        matches(url) ? json({ ok: true, unexpected: "shape" }) : undefined,
      );
      net.handlers.push(serveDashboard(ADA));
      mountApp(Router, `/guardian/${ADA}`);
      // G4-06: the widget's error is the guardian surface's one error state, inside that
      // widget. The calendar hook retries a non-404 failure once (queries.ts), so allow for
      // its delay.
      const widget = await screen.findByTestId(widgetId);
      expect(
        await within(widget).findByTestId("guardian-state-error", undefined, {
          timeout: 5000,
        }),
      ).toBeTruthy();
      // Only that widget: exactly one error on the page.
      expect(screen.getAllByTestId("guardian-state-error")).toHaveLength(1);
    },
  );
});

describe("G4-03 what the Dashboard does not show", () => {
  it("renders the widgets — and no 7-day tile, no skills, no x/y counts", async () => {
    net.handlers.push(serveDashboard(ADA));
    await renderedDashboard();
    // Presence first: the served values are on the page.
    // The served week's own facts (the real read model's), not a typed-in pair.
    const facts = (
      calendarWeek() as {
        facts: { blocks_completed: number; blocks_total: number };
      }
    ).facts;
    expect(facts.blocks_total).toBeGreaterThan(0);
    expect(screen.getByTestId("week-plan").textContent).toContain(
      `${facts.blocks_completed} of ${facts.blocks_total}`,
    );
    expect(
      within(screen.getByTestId("score-strip")).getByTestId("score-tile-target")
        .textContent,
    ).toContain("1350");
    expect(document.body.textContent).toContain("Proficient");
    expect(screen.getByTestId("latest-test-total")).toBeTruthy();
    // Absence.
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/7d|7-day|Questions Attempted|Accuracy/i);
    expect(screen.queryByTestId("domain-open")).toBeNull();
    expect(screen.queryByRole("button", { name: /skills/i })).toBeNull();
    expect(text).not.toMatch(/\d+ of \d+ correct/);
  });
});

describe("G5-08 the card's test: the newest to end, else one in progress", () => {
  it("ends by completed_at or abandoned_at; an attempt in progress only when none has ended", async () => {
    const { pickCardExam } = await import("./GuardianLatestTestCard");
    const { guardianExamListItemSchema } =
      await import("@lyceon/shared/exam-guardian-report-schema");
    const item = (
      id: string,
      over: Record<string, unknown>,
    ): ReturnType<typeof guardianExamListItemSchema.parse> =>
      guardianExamListItemSchema.parse({
        session_id: `5e551011-0000-4000-8000-0000000002${id}`,
        test_form_id: "f0f00000-0000-4000-8000-000000000001",
        test_form_name: id,
        mode: "strict",
        attempt_number_for_form: 1,
        report_state: "scored",
        session_state: "completed",
        completed_at: null,
        abandoned_at: null,
        total_scaled: 1300,
        rw_scaled: 650,
        math_scaled: 650,
        ...over,
      });
    const none = { total_scaled: null, rw_scaled: null, math_scaled: null };
    const live = item("01", {
      report_state: "not_completed",
      session_state: "active",
      ...none,
    });
    const a = item("02", { completed_at: "2026-09-10T10:00:00.000Z" });
    const partial = item("03", {
      report_state: "partial_scored",
      session_state: "partial_scored_abandoned",
      abandoned_at: "2026-09-20T10:00:00.000Z",
      total_scaled: null,
      math_scaled: null,
    });
    const d = item("04", { completed_at: "2026-09-15T10:00:00.000Z" });
    // A partial score is abandoned, never completed: it is still the newest outcome.
    expect(pickCardExam([a, live, partial, d])?.test_form_name).toBe("03");
    expect(pickCardExam([live])?.test_form_name).toBe("01");
    expect(pickCardExam([])).toBeNull();
  });
});
