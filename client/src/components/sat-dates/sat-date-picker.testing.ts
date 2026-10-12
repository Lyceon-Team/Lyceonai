/**
 * @spec [owner brief "SAT date picker and UI control standards" (Karl, 2026-10-11) §1] |
 * @implemented [2026-10-11] | plain English: test-only: drive the one SAT-date picker the way a person does — from the keyboard, through
 * the real Radix menu (owner brief 2026-10-11 §1). Every suite that sets a test date uses these,
 * so no suite reaches into the menu its own way.
 */
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, screen, within } from "@testing-library/react";
import type { ProfileReadResponse } from "@lyceon/shared/calendar";
import { calendarKeys } from "@/features/calendar/api/keys";

/**
 * The served bound, as `GET /api/calendar/profile` carries it (owner ruling 2026-10-11, Karl on
 * #1204, ruling 2), for a component rendered outside a page. Seeds the SAME query the picker
 * reads (`calendarKeys.profile()`), so the picker takes its bound exactly as in the product.
 * Pages that read the profile through their own fetch mock serve `latest_test_date` there.
 */
export function satDateBoundWrapper(
  latestTestDate: string,
): (props: { children: ReactNode }) => JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const served: ProfileReadResponse = {
    profile: null,
    latest_test_date: latestTestDate,
  };
  client.setQueryData(calendarKeys.profile(), served);
  return function SatDateBound({
    children,
  }: {
    children: ReactNode;
  }): JSX.Element {
    return createElement(QueryClientProvider, { client }, children);
  };
}

/** Opens the picker's menu (Enter on the focused trigger) and returns it. */
export function openSatDates(testId: string): HTMLElement {
  const open = screen.queryByTestId(`${testId}-menu`);
  if (open !== null) return open;
  const trigger = screen.getByTestId(`${testId}-trigger`);
  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.getByTestId(`${testId}-menu`);
}

/** Toggles one date in the open (or opened) menu; the menu stays open, as in the product. */
export function toggleSatDate(testId: string, date: string): void {
  const menu = openSatDates(testId);
  fireEvent.click(within(menu).getByTestId(`${testId}-date-${date}`));
}

/** Chooses "Not sure yet", which clears every date. */
export function chooseNotSure(testId: string): void {
  const menu = openSatDates(testId);
  fireEvent.click(within(menu).getByTestId(`${testId}-not-sure`));
}

/** Closes the menu with Esc, as a person does after choosing. */
export function closeSatDates(testId: string): void {
  const menu = screen.queryByTestId(`${testId}-menu`);
  if (menu !== null) fireEvent.keyDown(menu, { key: "Escape" });
}

/**
 * The dates the open (or opened) menu offers, ascending as rendered. Owner ruling 2026-10-11:
 * every surface's suite asserts none is past the served `latest_test_date`.
 */
export function offeredSatDates(testId: string): string[] {
  const menu = openSatDates(testId);
  return within(menu)
    .queryAllByRole("menuitemcheckbox")
    .map((el) => el.getAttribute("data-testid") ?? "")
    .filter((id) => id.startsWith(`${testId}-date-`))
    .map((id) => id.slice(`${testId}-date-`.length));
}

/** The closed trigger's text ("Not sure yet", one date, or "… + N more"). */
export function satDatesSummary(testId: string): string {
  return screen.getByTestId(`${testId}-summary`).textContent ?? "";
}
