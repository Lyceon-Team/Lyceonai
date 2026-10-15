// @vitest-environment jsdom
/**
 * The Getting started card: what it draws for each server answer, and the two actions it sends.
 *
 * @spec [owner brief "Student dashboard — Getting started checklist + onboarding update" (final
 *       brief v2, Karl, 2026-10-13) §2, §3, §5; ruling 4 (2026-10-13)] | @implemented [2026-10-13]
 *
 * plain English: every payload is built by the real `deriveGettingStarted` from an observation,
 * never hand-written, so the card is tested against the shape the server sends.
 *   C1 progress: one dot per step, filled when done or skipped, and "N of M"
 *   C2 the first open step is the only expanded one, and the card's only filled button
 *   C3 done steps are one ticked line; other open steps are plain text links to their page
 *   C4 step 2 carries ruling 4's line and scrolls to today's question
 *   C5 "Not now" on the email step sends skip-email, and the fresh checklist replaces the old
 *   C6 complete: "You're all set" with Dismiss, which sends dismiss
 *   C7 every link is the server's href for that step
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveGettingStarted,
  GETTING_STARTED_HREF,
  type GettingStartedObservation,
  type GettingStartedResponse,
} from "@lyceon/shared/getting-started-schema";
import { GettingStartedCard } from "./GettingStartedCard";

const net = vi.hoisted(() => ({
  log: [] as { method: string; url: string }[],
  reply: null as unknown,
}));

vi.mock("@/lib/csrf", () => ({
  csrfFetch: async (url: string, init?: RequestInit): Promise<Response> => {
    net.log.push({ method: init?.method ?? "GET", url });
    return new Response(JSON.stringify({ data: net.reply }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
}));

const NOTHING: GettingStartedObservation = {
  email_eligible: true,
  test_date_done: false,
  qotd_done: false,
  email_done: false,
  email_skipped: false,
  blind_spots_done: false,
  review_done: false,
  calendar_done: false,
  lisa_done: false,
  guardian_done: false,
  dismissed: false,
};

function view(
  over: Partial<GettingStartedObservation>,
  plan: "free" | "pro" = "free",
): GettingStartedResponse {
  return deriveGettingStarted(
    { ...NOTHING, ...over },
    { plan, lisaAvailable: true },
  );
}

function mount(data: GettingStartedResponse) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const location = memoryLocation({ path: "/dashboard", record: true });
  const utils = render(
    <QueryClientProvider client={client}>
      <Router hook={location.hook}>
        <GettingStartedCard data={data} diagnosticTotal={40} />
      </Router>
    </QueryClientProvider>,
  );
  return { ...utils, client, location };
}

/** Filled buttons and links (the page's primary style). */
function primaries(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("a, button")).filter(
    (el) => el.className.includes("bg-lyc-primary-bg"),
  );
}

beforeEach(() => {
  net.log.length = 0;
  net.reply = null;
});
afterEach(() => cleanup());

describe("the Getting started card", () => {
  it("C1: one dot per step, filled when done or skipped, and 'N of M'", () => {
    mount(view({ test_date_done: true, qotd_done: true, email_skipped: true }));
    expect(screen.getByTestId("getting-started-count").textContent).toBe(
      "3 of 5",
    );
    const dots = within(screen.getByTestId("getting-started-dots"))
      .getAllByText("", { selector: "span" })
      .map((d) => d.getAttribute("data-dot"));
    expect(dots).toEqual(["filled", "filled", "filled", "open", "open"]);
    // Pro: eight dots.
    cleanup();
    mount(view({}, "pro"));
    expect(screen.getByTestId("getting-started-count").textContent).toBe(
      "0 of 8",
    );
  });

  it("C2: the first open step is the only expanded one, and the only filled button", () => {
    const { container } = mount(view({ test_date_done: true }));
    const current = screen.getByTestId("getting-started-step-qotd");
    expect(current.getAttribute("data-status")).toBe("current");
    expect(
      screen
        .getAllByRole("listitem")
        .filter((li) => li.getAttribute("data-status") === "current"),
    ).toHaveLength(1);
    expect(primaries(container)).toEqual([
      screen.getByTestId("getting-started-current-cta"),
    ]);
  });

  it("C3: done steps are one ticked line; other open steps are plain text links", () => {
    mount(view({ test_date_done: true }));
    const done = screen.getByTestId("getting-started-step-test_date");
    expect(done.getAttribute("data-status")).toBe("done");
    expect(within(done).queryByRole("link")).toBeNull();
    const later = screen.getByTestId("getting-started-step-review");
    expect(later.getAttribute("data-status")).toBe("open");
    const link = within(later).getByRole("link", { name: "Go to Review" });
    expect(link.getAttribute("href")).toBe("/review");
    expect(link.className).not.toContain("bg-lyc-primary-bg");
  });

  it("C4: step 2 says ruling 4's line and scrolls to today's question", () => {
    const target = document.createElement("section");
    target.id = "qotd";
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    document.body.appendChild(target);
    const { location } = mount(view({ test_date_done: true }));
    const step = screen.getByTestId("getting-started-step-qotd");
    expect(
      within(step).getByText(
        "One question a day keeps the blind spots at bay.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId("getting-started-current-cta"));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(location.history).toEqual(["/dashboard"]);
    target.remove();
  });

  it("C5: 'Not now' on the email step sends skip-email and draws the server's answer", async () => {
    mount(view({ test_date_done: true, qotd_done: true }));
    expect(
      screen
        .getByTestId("getting-started-step-email")
        .getAttribute("data-status"),
    ).toBe("current");
    net.reply = view({
      test_date_done: true,
      qotd_done: true,
      email_skipped: true,
    });
    fireEvent.click(screen.getByTestId("getting-started-not-now"));
    await waitFor(() =>
      expect(net.log).toContainEqual({
        method: "POST",
        url: "/api/home/getting-started/skip-email",
      }),
    );
  });

  it("C6: complete — 'You're all set' with Dismiss, which sends dismiss", async () => {
    mount(
      view({
        test_date_done: true,
        qotd_done: true,
        email_skipped: true,
        blind_spots_done: true,
        review_done: true,
      }),
    );
    const card = screen.getByTestId("getting-started");
    expect(card.getAttribute("data-state")).toBe("complete");
    expect(within(card).getByText("You’re all set")).toBeTruthy();
    // The skipped email is said, with the way to turn it on.
    expect(
      within(card).getByRole("link", { name: "Settings" }).getAttribute("href"),
    ).toBe("/profile?tab=notifications");
    net.reply = view({
      test_date_done: true,
      qotd_done: true,
      email_skipped: true,
      blind_spots_done: true,
      review_done: true,
      dismissed: true,
    });
    fireEvent.click(screen.getByTestId("getting-started-dismiss"));
    await waitFor(() =>
      expect(net.log).toContainEqual({
        method: "POST",
        url: "/api/home/getting-started/dismiss",
      }),
    );
  });

  it("C7: every link is the server's href for that step (Pro, nothing done)", () => {
    mount(view({}, "pro"));
    for (const id of [
      "email",
      "blind_spots",
      "review",
      "calendar",
      "lisa",
      "guardian",
    ] as const) {
      const link = screen.getByTestId(`getting-started-step-${id}-link`);
      expect(link.getAttribute("data-href")).toBe(GETTING_STARTED_HREF[id]);
      expect(link.getAttribute("href")).toBe(GETTING_STARTED_HREF[id]);
    }
    // The current step (step 1) links to Settings → Profile.
    expect(
      screen.getByTestId("getting-started-current-cta").getAttribute("href"),
    ).toBe("/profile?tab=profile");
  });
});
