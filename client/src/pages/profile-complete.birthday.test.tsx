// @vitest-environment jsdom
/**
 * The birthday a student enters is the birthday that is saved.
 *
 * @spec [owner brief "birthday input" (Karl, 2026-11-04): "the interaction that caused the bug
 *       now saves the entered year"; "a valid date saves exactly as entered"; "on a 375px
 *       viewport emulating iPhone Safari, submitting the form without editing the fields saves
 *       nothing and shows the required-field errors"] | @implemented [2026-11-04]
 *
 * plain English: the REAL onboarding page, with only the network stubbed, so what these tests
 * assert is the actual PATCH body the server would receive. The bug was that the body carried the
 * current year; the proof that it is fixed is the body, not the screen.
 *
 * The iPhone block is the live bug's own shape: a 375px viewport with an iOS Safari user agent
 * and touch points, where `<input type="date">` used to be a wheel opened on today. Three fields
 * have no such hidden state, so a submit that touches nothing sends nothing — which is what the
 * old field could not say.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  bodies: [] as Array<{ url: string; body: unknown }>,
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/profile/complete", vi.fn()],
  Redirect: ({ to }: { to: string }) => (
    <div data-testid="redirect" data-to={to} />
  ),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({ refreshUser: vi.fn(async () => undefined) }),
}));
vi.mock("@/lib/csrf", () => ({
  csrfFetch: vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          authenticated: true,
          user: {
            id: "a1111111-1111-4111-8111-111111111114",
            role: "student",
            display_name: null,
            requiredProfileComplete: false,
            profileCompletedAt: null,
            guardianConsentRequired: false,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  ),
}));
vi.mock("@/lib/queryClient", async () => {
  const { QueryClient: QC } = await import("@tanstack/react-query");
  const qc = new QC({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient: qc,
    apiRequest: vi.fn(async (url: string, init?: RequestInit) => {
      calls.bodies.push({
        url,
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : null,
      });
      if (url === "/api/profile" && init?.method === "PATCH") {
        return new Response(
          JSON.stringify({ success: true, requiredProfileComplete: true }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ latest_test_date: "2027-06-05" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  };
});

import ProfileComplete from "./profile-complete";
import { queryClient as moduleClient } from "@/lib/queryClient";
import {
  birthdayFields,
  enterBirthday,
} from "@/components/profile/__tests__/enter-birthday";

function mount(): void {
  render(
    <QueryClientProvider client={moduleClient as QueryClient}>
      <ProfileComplete />
    </QueryClientProvider>,
  );
}

async function asStudent(): Promise<void> {
  mount();
  await screen.findByTestId("button-complete-profile");
  fireEvent.change(screen.getByTestId("input-display-name"), {
    target: { value: "Sam" },
  });
}

/** The PATCH body, or null if no profile write happened. */
function profilePatch(): Record<string, unknown> | null {
  const hit = calls.bodies.find((c) => c.url === "/api/profile");
  return hit ? (hit.body as Record<string, unknown>) : null;
}

beforeEach(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => undefined;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
  calls.bodies = [];
  moduleClient.clear();
});

describe("the entered year is the saved year", () => {
  it("saves 2006 when the student enters 2006 — the reported bug", async () => {
    await asStudent();
    enterBirthday("2006-04-04");
    // Read back in words before submit, so a wrong year is visible.
    expect(
      (await screen.findByTestId("text-birthday-confirmation")).textContent,
    ).toBe("Born April 4, 2006.");

    fireEvent.click(screen.getByTestId("button-complete-profile"));
    await waitFor(() => expect(profilePatch()).not.toBeNull());
    // The body, not the screen: this is what the server receives.
    expect(profilePatch()?.dateOfBirth).toBe("2006-04-04");
  });

  it.each([
    ["2006-04-04", "Born April 4, 2006."],
    ["1999-12-25", "Born December 25, 1999."],
    ["2004-02-29", "Born February 29, 2004."],
    ["2010-01-01", "Born January 1, 2010."],
  ])("saves %s exactly as entered", async (iso, confirmation) => {
    await asStudent();
    enterBirthday(iso);
    expect(
      (await screen.findByTestId("text-birthday-confirmation")).textContent,
    ).toBe(confirmation);
    fireEvent.click(screen.getByTestId("button-complete-profile"));
    await waitFor(() => expect(profilePatch()).not.toBeNull());
    expect(profilePatch()?.dateOfBirth).toBe(iso);
  });

  it("sends nothing when the year is left empty but month and day are set", async () => {
    // The iOS wheel's exact shape: month and day moved, the year never touched.
    await asStudent();
    fireEvent.change(screen.getByTestId("select-birth-month"), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByTestId("input-birth-day"), {
      target: { value: "4" },
    });
    expect(screen.queryByTestId("text-birthday-confirmation")).toBeNull();

    fireEvent.click(screen.getByTestId("button-complete-profile"));
    expect(
      await screen.findByText("Please check your date of birth to continue."),
    ).toBeTruthy();
    expect(screen.getByTestId("error-birth-year").textContent).toBe(
      "Enter your birth year.",
    );
    expect(profilePatch()).toBeNull();
  });

  it("refuses the current year rather than storing it", async () => {
    await asStudent();
    enterBirthday("2026-04-04");
    expect(screen.queryByTestId("text-birthday-confirmation")).toBeNull();
    fireEvent.click(screen.getByTestId("button-complete-profile"));
    expect(
      await screen.findByText("Please check your date of birth to continue."),
    ).toBeTruthy();
    expect(screen.getByTestId("error-birth-year").textContent).toBe(
      "Check the year — that's less than 5 years ago.",
    );
    expect(profilePatch()).toBeNull();
  });
});

describe("inline validation on the client", () => {
  it.each([
    [
      "a 2-digit year",
      "4",
      "4",
      "06",
      "year",
      "Enter the full 4-digit year, like 2006.",
    ],
    [
      "February 30",
      "2",
      "30",
      "2006",
      "day",
      "That day doesn't exist in February.",
    ],
    ["April 31", "4", "31", "2006", "day", "That day doesn't exist in April."],
    ["day 0", "4", "0", "2006", "day", "Enter a day from 1 to 31."],
    ["day 32", "4", "32", "2006", "day", "Enter a day from 1 to 31."],
  ])(
    "refuses %s and sends nothing",
    async (_label, month, day, year, field, message) => {
      await asStudent();
      fireEvent.change(screen.getByTestId("select-birth-month"), {
        target: { value: month },
      });
      fireEvent.change(screen.getByTestId("input-birth-day"), {
        target: { value: day },
      });
      fireEvent.change(screen.getByTestId("input-birth-year"), {
        target: { value: year },
      });
      fireEvent.click(screen.getByTestId("button-complete-profile"));
      expect(
        await screen.findByText("Please check your date of birth to continue."),
      ).toBeTruthy();
      expect(screen.getByTestId(`error-birth-${field}`).textContent).toBe(
        message,
      );
      expect(profilePatch()).toBeNull();
    },
  );

  it("the Day and Year boxes take digits only, so a paste cannot carry letters", async () => {
    await asStudent();
    const fields = birthdayFields();
    fireEvent.change(fields.day, { target: { value: "4th" } });
    expect(fields.day.value).toBe("4");
    fireEvent.change(fields.year, { target: { value: "20o6" } });
    expect(fields.year.value).toBe("206");
  });

  it("carries inputmode and the bday autocomplete tokens", async () => {
    await asStudent();
    const fields = birthdayFields();
    expect(fields.day.getAttribute("inputmode")).toBe("numeric");
    expect(fields.year.getAttribute("inputmode")).toBe("numeric");
    expect(fields.month.getAttribute("autocomplete")).toBe("bday-month");
    expect(fields.day.getAttribute("autocomplete")).toBe("bday-day");
    expect(fields.year.getAttribute("autocomplete")).toBe("bday-year");
  });
});

describe("iPhone Safari at 375px — the viewport the bug was reported from", () => {
  beforeEach(() => {
    // Karl reproduced it on an iPhone 17 Pro, Safari. jsdom cannot run WebKit, but it can
    // hold the viewport, the user agent and the touch points that make a browser serve the
    // mobile date wheel — which is what we are proving is no longer on the page.
    Object.defineProperty(window, "innerWidth", {
      value: 375,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 812,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      configurable: true,
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      value: 5,
      configurable: true,
    });
    window.dispatchEvent(new Event("resize"));
  });

  it("submitting without editing the fields saves nothing and shows all three required errors", async () => {
    await asStudent();
    expect(window.innerWidth).toBe(375);
    expect(window.navigator.userAgent).toContain("iPhone");

    // Nothing touched — the fields are empty, not pre-filled with today.
    const fields = birthdayFields();
    expect(fields.month.value).toBe("");
    expect(fields.day.value).toBe("");
    expect(fields.year.value).toBe("");

    fireEvent.click(screen.getByTestId("button-complete-profile"));

    expect(
      await screen.findByText("Please check your date of birth to continue."),
    ).toBeTruthy();
    expect(screen.getByTestId("error-birth-month").textContent).toBe(
      "Choose your birth month.",
    );
    expect(screen.getByTestId("error-birth-day").textContent).toBe(
      "Enter your birth day.",
    );
    expect(screen.getByTestId("error-birth-year").textContent).toBe(
      "Enter your birth year.",
    );
    expect(screen.queryByTestId("text-birthday-confirmation")).toBeNull();
    // The whole point: no write at all, so no current-year row can be created.
    expect(profilePatch()).toBeNull();
  });

  it("there is no native date input left on the page to open a wheel", async () => {
    await asStudent();
    expect(document.querySelectorAll('input[type="date"]').length).toBe(0);
    expect(screen.queryByTestId("input-date-of-birth")).toBeNull();
  });

  it("the Year placeholder is a hint and is never submitted", async () => {
    await asStudent();
    const fields = birthdayFields();
    const placeholder = fields.year.getAttribute("placeholder");
    // today − 13, per the brief.
    expect(placeholder).toBe(String(new Date().getUTCFullYear() - 13));
    expect(fields.year.value).toBe("");
    expect(fields.month.getAttribute("placeholder")).toBeNull();
    expect(fields.day.getAttribute("placeholder")).toBe("Day");

    // A submit still refuses: the placeholder is not a value.
    fireEvent.click(screen.getByTestId("button-complete-profile"));
    expect(
      await screen.findByText("Please check your date of birth to continue."),
    ).toBeTruthy();
    expect(profilePatch()).toBeNull();
  });
});
