/**
 * @spec [owner brief "SAT date picker and UI control standards" (Karl, 2026-10-11) §1] |
 * @implemented [2026-10-11] | plain English: test-only: drive the one SAT-date picker the way a person does — from the keyboard, through
 * the real Radix menu (owner brief 2026-10-11 §1). Every suite that sets a test date uses these,
 * so no suite reaches into the menu its own way.
 */
import { act, fireEvent, screen, within } from "@testing-library/react";

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

/** The closed trigger's text ("Not sure yet", one date, or "… + N more"). */
export function satDatesSummary(testId: string): string {
  return screen.getByTestId(`${testId}-summary`).textContent ?? "";
}
