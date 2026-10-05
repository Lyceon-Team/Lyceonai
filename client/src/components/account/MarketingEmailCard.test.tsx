// @vitest-environment jsdom
/**
 * Plan Q5: the Settings toggle — shown to guardians and students 13+, hidden for under-13,
 * writes `{ granted }` to its own endpoint.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R26 ("Settings toggle"); owner Step 0 answer 2
 *       (2026-10-05): PUT /api/profile/marketing-consent] | @implemented [2026-10-05]
 */
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROFILE_QUERY_KEY } from "@/hooks/useProfileQuery";

const net = vi.hoisted(() => ({
  log: [] as { method: string; url: string; body: unknown }[],
}));
vi.mock("@/lib/csrf", () => ({
  csrfFetch: async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    net.log.push({ method: init?.method ?? "GET", url, body });
    if (url === "/api/profile/marketing-consent") {
      return Response.json({
        marketingOptIn: (body as { granted: boolean }).granted,
      });
    }
    return Response.json({ authenticated: true, user: null });
  },
}));

import { MarketingEmailCard } from "./MarketingEmailCard";

function yearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function mount(user: {
  role: "student" | "guardian";
  dateOfBirth: string | null;
  marketingOptIn: boolean;
}): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(PROFILE_QUERY_KEY, { authenticated: true, user });
  render(
    <QueryClientProvider client={client}>
      <MarketingEmailCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  net.log = [];
});
afterEach(cleanup);

describe("MarketingEmailCard", () => {
  it("is hidden for an under-13 student", () => {
    mount({
      role: "student",
      dateOfBirth: yearsAgo(11),
      marketingOptIn: false,
    });
    expect(screen.queryByTestId("marketing-email-card")).toBeNull();
  });

  it("is hidden for a guardian with no date of birth (unknown age)", () => {
    mount({ role: "guardian", dateOfBirth: null, marketingOptIn: false });
    expect(screen.queryByTestId("marketing-email-card")).toBeNull();
  });

  it("shows the stored choice to a 15-year-old and writes { granted } to its own endpoint", async () => {
    mount({
      role: "student",
      dateOfBirth: yearsAgo(15),
      marketingOptIn: false,
    });
    const box = screen.getByTestId("settings-marketing-opt-in");
    expect(box.getAttribute("data-state")).toBe("unchecked");
    fireEvent.click(box);
    await waitFor(() =>
      expect(net.log).toContainEqual({
        method: "PUT",
        url: "/api/profile/marketing-consent",
        body: { granted: true },
      }),
    );
  });

  it("a guardian who opted in can turn it off", async () => {
    mount({
      role: "guardian",
      dateOfBirth: yearsAgo(40),
      marketingOptIn: true,
    });
    const box = screen.getByTestId("settings-marketing-opt-in");
    expect(box.getAttribute("data-state")).toBe("checked");
    fireEvent.click(box);
    await waitFor(() =>
      expect(net.log).toContainEqual({
        method: "PUT",
        url: "/api/profile/marketing-consent",
        body: { granted: false },
      }),
    );
  });
});
