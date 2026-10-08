// @vitest-environment jsdom
/**
 * @spec [owner ruling OQ-66 (g), Karl, 2026-10-07: "US date format, \"Fri, Sep 25\", through the
 *        shared formatter. Re-check every date surface."] | @implemented [2026-10-07]
 *
 * plain English: the score-report page's heading date (the prompt's local `occasion_key`) is the
 * shared formatter's US long form — "Your SAT on September 12, 2026" — where it used to be the
 * page's own day-first numeric "12/9/2026". The prompt is parsed through the real shared schema,
 * so the fixture is a shape the server can send.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renewalPromptViewSchema } from "../../../packages/shared/src/exam-score-renewal-schema";
import { formatDate } from "@/lib/format-date";
import ScoreReportPage from "./score-report";

afterEach(() => {
  cleanup();
});

function mountWith(anchor: "exam_date" | "billing_cycle"): void {
  const prompt = renewalPromptViewSchema.parse({
    anchor,
    occasion_key: "2026-09-12",
    prompted_at: "2026-10-01T15:00:00.000Z",
    viewer_role: "payer",
    decision: null,
    report: null,
  });
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: async () => ({ data: prompt }) },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <ScoreReportPage />
    </QueryClientProvider>,
  );
}

describe("score report: the occasion date in US style (OQ-66 (g))", () => {
  it("an exam-date prompt: 'Your SAT on September 12, 2026'", async () => {
    mountWith("exam_date");
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading.textContent).toBe(
      `Your SAT on ${formatDate("2026-09-12", "month-day-year") ?? ""}`,
    );
    expect(heading.textContent).toBe("Your SAT on September 12, 2026");
  });

  it("a billing-cycle prompt: 'Your subscription renews on September 12, 2026'", async () => {
    mountWith("billing_cycle");
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading.textContent).toBe(
      "Your subscription renews on September 12, 2026",
    );
    expect(heading.textContent).not.toContain("12/9/2026");
  });
});
