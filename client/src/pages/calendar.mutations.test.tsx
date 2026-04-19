// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CalendarPage, { getDateKeyInTimeZone } from "./calendar";

vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function asUrl(input: RequestInfo | URL): string {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  try {
    const parsed = new URL(raw);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return raw;
  }
}

function buildMonthPayload(dayDate: string, taskStatus: "planned" | "completed", isUserOverride: boolean) {
  return {
    days: [
      {
        day_date: dayDate,
        planned_minutes: 60,
        completed_minutes: taskStatus === "completed" ? 60 : 0,
        status: taskStatus === "completed" ? "complete" : "planned",
        focus: [{ section: "Math", weight: 0.6 }],
        tasks: [
          {
            id: "task-1",
            type: "practice",
            section: "Math",
            mode: "mixed",
            minutes: 60,
            status: taskStatus,
          },
        ],
        plan_version: 1,
        generated_at: "2026-03-24T10:00:00.000Z",
        created_at: "2026-03-24T10:00:00.000Z",
        updated_at: "2026-03-24T10:00:00.000Z",
        is_user_override: isUserOverride,
      },
    ],
    streak: { current: 0, longest: 0 },
  };
}

describe("Calendar mutation ownership", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("surfaces reset/regenerate/task-status mutations with read-after-write month rehydration", async () => {
    const dayDate = getDateKeyInTimeZone("America/Chicago", new Date());
    const resetUrl = `/api/calendar/day/${dayDate}/reset-to-auto`;
    const regenerateUrl = `/api/calendar/day/${dayDate}/regenerate`;
    const patchUrl = `/api/calendar/day/${dayDate}/tasks/task-1`;

    const monthPayloads = [
      buildMonthPayload(dayDate, "planned", true),
      buildMonthPayload(dayDate, "planned", false),
      buildMonthPayload(dayDate, "planned", false),
      buildMonthPayload(dayDate, "completed", false),
    ];
    let monthCallCount = 0;

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = asUrl(input);
      const method = init?.method ?? "GET";

      if (url === "/api/csrf-token" && method === "GET") {
        return jsonResponse({ csrfToken: "csrf-test-token" });
      }

      if (url === "/api/calendar/profile" && method === "GET") {
        return jsonResponse({
          profile: {
            user_id: "student-1",
            baseline_score: null,
            target_score: null,
            exam_date: null,
            daily_minutes: 60,
            timezone: "America/Chicago",
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
          },
        });
      }

      if (url.startsWith("/api/calendar/month?") && method === "GET") {
        const payload = monthPayloads[Math.min(monthCallCount, monthPayloads.length - 1)];
        monthCallCount += 1;
        return jsonResponse(payload);
      }

      if (url === resetUrl && method === "POST") {
        return jsonResponse({ day: { day_date: dayDate } });
      }

      if (url === regenerateUrl && method === "POST") {
        return jsonResponse({ day: { day_date: dayDate } });
      }

      if (url === patchUrl && method === "PATCH") {
        return jsonResponse({ day: { day_date: dayDate } });
      }

      return jsonResponse({ error: `Unexpected URL ${url}` }, 500);
    });

    render(<CalendarPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: `Open day ${dayDate}` })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: `Open day ${dayDate}` }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reset to Auto" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Regenerate Day" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Mark Complete" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset to Auto" }));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([input]) => asUrl(input));
      expect(urls).toContain(resetUrl);
      expect((screen.getByRole("button", { name: "Reset to Auto (already auto)" }) as HTMLButtonElement).disabled).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Regenerate Day" }));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([input]) => asUrl(input));
      expect(urls).toContain(regenerateUrl);
    });

    fireEvent.click(screen.getByRole("button", { name: "Mark Complete" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Mark Planned" })).toBeTruthy();
      const monthUrls = fetchMock.mock.calls
        .map(([input, requestInit]) => ({ url: asUrl(input), method: requestInit?.method ?? "GET" }))
        .filter((entry) => entry.url.startsWith("/api/calendar/month?") && entry.method === "GET");
      expect(monthUrls.length).toBeGreaterThanOrEqual(4);
    });

    const patchCall = fetchMock.mock.calls.find(([input, requestInit]) => {
      return asUrl(input) === patchUrl && (requestInit?.method ?? "GET") === "PATCH";
    });
    expect(patchCall).toBeDefined();
    const patchBody = JSON.parse((patchCall?.[1]?.body as string) || "{}");
    expect(patchBody).toEqual({ status: "completed" });
  }, 20_000);
});
