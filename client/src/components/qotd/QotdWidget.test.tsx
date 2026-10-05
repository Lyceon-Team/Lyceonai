// @vitest-environment jsdom
/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md R16, R17, Q3; owner ruling (the question and
 *       answer area carries ph-no-capture); SCL-202 item 2] | @implemented [2026-10-05]
 *
 * plain English: the homepage / hub widget, rendered against payloads produced by the SERVER's
 * own projections over the shared fixture (real SQL output), so the widget is tested against
 * what the API emits rather than a hand-written shape. Turnstile is replaced by a stub that
 * hands over a token, since its script is a third-party load.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QotdWidget } from "./QotdWidget";
import {
  gradeQotd,
  qotdCorrectOptionId,
  toTodayResponse,
} from "../../../../server/services/qotd/qotd-service";
import {
  qotdStat,
  qotdSubmitResponseSchema,
  type QotdSubmitResponse,
} from "../../../../packages/shared/src/qotd-schema";
import { qotdTodayRow } from "../../../../tests/lib/qotd-fixture";

vi.mock("./turnstile", () => ({
  TurnstileWidget: ({ onToken }: { onToken: (t: string | null) => void }) => {
    React.useEffect(() => onToken("stub-turnstile-token"), [onToken]);
    return <div data-testid="qotd-turnstile" />;
  },
}));

const row = qotdTodayRow();
const todayPayload = toTodayResponse(row);

function revealFor(
  answer: string,
  attempts: number,
  correct: number,
): QotdSubmitResponse {
  const graded = gradeQotd(row, answer);
  if (!graded.ok) throw new Error("fixture answer did not grade");
  return qotdSubmitResponseSchema.parse({
    qotd_date: row.qotd_date,
    is_correct: graded.isCorrect,
    correct_option_id: qotdCorrectOptionId(row),
    correct_answer: null,
    explanation: row.explanation ?? "",
    stats: qotdStat(attempts, correct),
  });
}

const fetchMock = vi.fn();

function renderWidget() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <QotdWidget />
    </QueryClientProvider>,
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("QotdWidget", () => {
  it("renders today's question inside ph-no-capture, with no answer or explanation before submit", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: todayPayload }));
    renderWidget();
    const area = await screen.findByTestId("qotd-question-area");
    expect(area.className).toContain("ph-no-capture");
    // Presence before absence: the question is there.
    expect(area.textContent).toContain("rectangle");
    expect(area.textContent).not.toContain(row.explanation ?? "\u0000");
    expect(screen.queryByText("Explanation")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/public/qotd/today", {
      credentials: "omit",
    });
  });

  it("submits the choice with the Turnstile token, then shows the reveal; no browser storage is touched", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { data: todayPayload }))
      .mockResolvedValueOnce(jsonResponse(200, { data: revealFor("C", 7, 3) }));
    renderWidget();
    await screen.findByTestId("qotd-question-area");
    const submit = screen.getByTestId("qotd-submit");
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("24"));
    await waitFor(() =>
      expect((submit as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(submit);

    await screen.findByText("Correct");
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/public/qotd/today/answer");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(JSON.parse(String(init.body))).toEqual({
      qotd_date: row.qotd_date,
      answer: "C",
      turnstile_token: "stub-turnstile-token",
    });
    expect(screen.getByTestId("qotd-question-area").textContent).toContain(
      "length times width",
    );
    expect(screen.getByTestId("qotd-stat").textContent).toBe(
      "43% of students got this right.",
    );
    expect(setItem).not.toHaveBeenCalled();
  });

  it("shows no stat line when the server hides it (fewer than 5 attempts)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { data: todayPayload }))
      .mockResolvedValueOnce(jsonResponse(200, { data: revealFor("A", 4, 4) }));
    renderWidget();
    await screen.findByTestId("qotd-question-area");
    fireEvent.click(screen.getByText("11"));
    await waitFor(() =>
      expect(
        (screen.getByTestId("qotd-submit") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByTestId("qotd-submit"));
    await screen.findByText("Incorrect");
    expect(screen.queryByTestId("qotd-stat")).toBeNull();
  });

  it("a rejected Turnstile token shows the retry message and does not reveal", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { data: todayPayload }))
      .mockResolvedValueOnce(
        jsonResponse(403, {
          error: { code: "turnstile_failed", message: "x" },
        }),
      );
    renderWidget();
    await screen.findByTestId("qotd-question-area");
    fireEvent.click(screen.getByText("24"));
    await waitFor(() =>
      expect(
        (screen.getByTestId("qotd-submit") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByTestId("qotd-submit"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The check did not go through");
    expect(screen.queryByText("Explanation")).toBeNull();
  });

  it("a day with no question yet says so", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, {
        error: { code: "qotd_not_scheduled", message: "x" },
      }),
    );
    renderWidget();
    const msg = await screen.findByTestId("qotd-unavailable");
    expect(msg.textContent).toContain("not up yet");
  });
});
