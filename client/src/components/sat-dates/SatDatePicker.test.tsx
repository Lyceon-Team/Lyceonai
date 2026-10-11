// @vitest-environment jsdom
/**
 * The one SAT-date picker: a dropdown multi-select, everywhere the test date appears.
 *
 * @spec [owner brief "SAT date picker and UI control standards" (Karl, 2026-10-11) §1; DESIGN.md
 *       "UI standards"] | @implemented [2026-10-11]
 *
 * plain English: the real component on the real Radix menu, driven from the keyboard. The closed
 * trigger reads "Not sure yet", one date, or "first + N more"; open, "Not sure yet" is the first
 * item and sits outside the scrolling date list; each choice clears the other; the menu stays open
 * while choosing; the served horizon bounds the offer; a saved date off the official list is kept.
 * Then the source itself: no other component renders the date list or a native date input for
 * the SAT date (the grep proof the brief asks for, as a test that fails if one comes back).
 */
import { useState } from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SatDatePicker,
  satDateSummary,
  type SatDateChoice,
} from "./SatDatePicker";
import {
  chooseNotSure,
  closeSatDates,
  openSatDates,
  satDatesSummary,
  toggleSatDate,
} from "./sat-date-picker.testing";

afterEach(cleanup);

const TODAY = "2026-10-11";
const ID = "picker";

function Harness({
  initial = [],
  latest,
  onChange,
}: {
  initial?: string[];
  latest?: string;
  onChange?: (next: SatDateChoice) => void;
}): JSX.Element {
  const [value, setValue] = useState<SatDateChoice>({ dates: initial });
  return (
    <SatDatePicker
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      today={TODAY}
      {...(latest === undefined ? {} : { latest })}
      data-testid={ID}
    />
  );
}

describe("closed: what the trigger reads", () => {
  it.each([
    [[], "Not sure yet"],
    [["2026-12-05"], "Sat, Dec 5, 2026"],
    [["2027-03-06", "2026-12-05"], "Sat, Dec 5, 2026 + 1 more"],
    [["2027-05-01", "2026-12-05", "2027-03-06"], "Sat, Dec 5, 2026 + 2 more"],
  ])("%j → %s", (dates, label) => {
    expect(satDateSummary(dates)).toBe(label);
    render(<Harness initial={dates} />);
    expect(satDatesSummary(ID)).toBe(label);
    cleanup();
  });

  it("the trigger is named by the question and the current answer", () => {
    render(<Harness initial={["2026-12-05"]} />);
    expect(
      screen.getByRole("button", {
        name: "When's your SAT? Sat, Dec 5, 2026",
      }),
    ).toBeInTheDocument();
  });

  it("renders no option list until it is opened (never a long list inline)", () => {
    render(<Harness />);
    expect(screen.queryAllByRole("menuitemcheckbox")).toHaveLength(0);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("open", () => {
  it('"Not sure yet" is first and pinned outside the scrolling list of future dates', () => {
    render(<Harness />);
    const menu = openSatDates(ID);
    const items = within(menu).getAllByRole("menuitemcheckbox");
    expect(items[0]?.textContent).toBe("Not sure yet");
    const list = within(menu).getByTestId(`${ID}-dates`);
    expect(list.contains(items[0] as Node)).toBe(false);
    expect(list.className).toContain("overflow-y-auto");
    // Every date in the list is after today, ascending.
    const dates = within(list)
      .getAllByRole("menuitemcheckbox")
      .map((el) => el.getAttribute("data-testid")?.replace(`${ID}-date-`, ""));
    expect(dates.length).toBeGreaterThan(3);
    expect(dates.every((d) => (d ?? "") > TODAY)).toBe(true);
    expect([...dates].sort()).toEqual(dates);
  });

  it("every row shows a checkbox, drawn from the row's own checked state", () => {
    render(<Harness initial={["2026-12-05"]} />);
    const menu = openSatDates(ID);
    const items = within(menu).getAllByRole("menuitemcheckbox");
    expect(items.length).toBeGreaterThan(3);
    for (const item of items) {
      expect(item.querySelector('[data-indicator="box"]')).not.toBeNull();
      expect(item.getAttribute("data-state")).toBe(
        item.getAttribute("aria-checked") === "true" ? "checked" : "unchecked",
      );
    }
    expect(
      within(menu)
        .getByTestId(`${ID}-date-2026-12-05`)
        .getAttribute("data-state"),
    ).toBe("checked");
  });

  it("each choice clears the other, and the menu stays open while choosing", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    toggleSatDate(ID, "2026-12-05");
    toggleSatDate(ID, "2027-03-06");
    expect(onChange).toHaveBeenLastCalledWith({
      dates: ["2026-12-05", "2027-03-06"],
    });
    const menu = screen.getByTestId(`${ID}-menu`);
    expect(
      within(menu).getByTestId(`${ID}-not-sure`).getAttribute("aria-checked"),
    ).toBe("false");
    chooseNotSure(ID);
    expect(onChange).toHaveBeenLastCalledWith({ dates: [] });
    expect(screen.getByTestId(`${ID}-menu`)).toBeInTheDocument();
    expect(
      within(menu)
        .getByTestId(`${ID}-date-2026-12-05`)
        .getAttribute("aria-checked"),
    ).toBe("false");
    closeSatDates(ID);
    expect(satDatesSummary(ID)).toBe("Not sure yet");
  });

  it("is keyboard operable: Enter opens, arrows move, Space toggles, Esc closes", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByTestId(`${ID}-trigger`);
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: "Enter" });
    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitemcheckbox");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(items[0] as HTMLElement, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(items[1]));
    fireEvent.keyDown(items[1] as HTMLElement, { key: " " });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("offers nothing past the served horizon", () => {
    render(<Harness latest="2027-04-01" />);
    const menu = openSatDates(ID);
    expect(within(menu).queryByTestId(`${ID}-date-2027-03-06`)).not.toBeNull();
    expect(within(menu).queryByTestId(`${ID}-date-2027-05-01`)).toBeNull();
  });

  it("keeps a saved future date that is not on the official list, so a save never drops it", () => {
    render(<Harness initial={["2026-11-14"]} />);
    const menu = openSatDates(ID);
    expect(
      within(menu)
        .getByTestId(`${ID}-date-2026-11-14`)
        .getAttribute("aria-checked"),
    ).toBe("true");
  });
});

describe("one picker: no other component renders the SAT date list (grep proof)", () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  function sources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return sources(p);
      return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
    });
  }
  const files = sources(root);

  it("scans the client (presence before absence)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith("sat-dates/SatDatePicker.tsx"))).toBe(
      true,
    );
  });

  it("only the picker builds the date options", () => {
    const users = files.filter((f) =>
      /\bsatDateOptions\(/.test(fs.readFileSync(f, "utf8")),
    );
    expect(users.map((f) => path.relative(root, f))).toEqual([
      path.join("components", "sat-dates", "SatDatePicker.tsx"),
    ]);
  });

  it("no native date input asks for the SAT or test date", () => {
    const offenders = files.filter((f) => {
      const text = fs.readFileSync(f, "utf8");
      return [...text.matchAll(/type="date"/g)].some((m) => {
        const around = text.slice(Math.max(0, m.index - 600), m.index + 400);
        return /SAT|[Tt]est date|exam/.test(around);
      });
    });
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });

  it("every surface that sets the test date uses the picker", () => {
    const users = files
      .filter((f) => /<SatDatePicker\b/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f))
      .sort();
    expect(users).toEqual(
      [
        path.join("components", "home", "qotd", "HomeQotdSection.tsx"),
        path.join("components", "settings", "ProfileSection.tsx"),
        path.join("features", "calendar", "components", "FreeCalendar.tsx"),
        path.join("features", "calendar", "components", "SettingsSheet.tsx"),
        path.join("features", "calendar", "components", "SetupPopup.tsx"),
        path.join("pages", "profile-complete.tsx"),
      ].sort(),
    );
  });
});
