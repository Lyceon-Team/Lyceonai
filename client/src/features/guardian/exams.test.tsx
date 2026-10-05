// @vitest-environment jsdom
/**
 * G4-05 — the exam list and detail, inside the guardian shell, bars only.
 *
 * @spec [Guardian_Closure_Plan G4-05 named proof: "RTL: no correct/total text anywhere. The
 *       route walk covers both pages"; R4, SCL-189, SCL-192] | @implemented [2026-09-30]
 *
 * plain English: through the real routes, the list (`/guardian/:id/exams`) and the detail
 * (`/guardian/:id/exams/:sessionId`) render inside the ONE shell — no second header, no
 * "Practice tests" link — and nowhere on either page is there a per-domain count: no
 * "correct", no "N of M". Presence first: the list names the test and its date, and the
 * detail draws the total and a bar per domain.
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADA,
  EXAM_SESSION,
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
  net.handlers.push(serveDashboard(ADA));
});
afterEach(cleanup);

function expectNoCounts(): void {
  const text = document.body.textContent ?? "";
  expect(text).not.toMatch(/\bcorrect\b/i);
  expect(text).not.toMatch(/\b\d+\s+of\s+\d+\b/);
}

function expectOneShellHeader(): void {
  expect(screen.getAllByTestId("guardian-shell-header")).toHaveLength(1);
  expect(screen.queryByRole("link", { name: /practice tests/i })).toBeNull();
}

describe("G4-05 exam results inside the shell", () => {
  it("the list: one header, the test and the student's card word, no counts", async () => {
    mountApp(Router, `/guardian/${ADA}/exams`);
    const list = await screen.findByTestId("guardian-exam-list");
    expect(list.textContent).toContain("Practice Test 2");
    // G5-08: the student's own card (TestsHomePage) shows the state word, not a date.
    expect(screen.getByTestId("guardian-exam-state").textContent).toBe(
      "Scored",
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Full-length tests" }),
    ).toBeTruthy();
    expectOneShellHeader();
    expectNoCounts();
  });

  it("the detail: the total and seven segments per domain, no counts", async () => {
    mountApp(Router, `/guardian/${ADA}/exams/${EXAM_SESSION}`);
    expect(await screen.findByTestId("exam-total-score")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Score breakdown" }));
    const rows = screen.getAllByTestId("exam-domain-row");
    expect(rows.length).toBeGreaterThan(0);
    // G5-11 (SCL-210): the student's seven segments per domain.
    for (const row of rows) {
      expect(
        row.querySelectorAll('[data-testid="exam-domain-segment"]'),
      ).toHaveLength(7);
    }
    expectOneShellHeader();
    expectNoCounts();
    expect(screen.getByTestId("guardian-exam-back").getAttribute("href")).toBe(
      `/guardian/${ADA}/exams`,
    );
  });
});
