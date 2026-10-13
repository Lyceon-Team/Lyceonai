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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  chooseNotSure,
  closeSatDates,
  offeredSatDates,
  openSatDates,
  satDateBoundWrapper,
  satDatesSummary,
  toggleSatDate,
} from "./sat-date-picker.testing";

afterEach(cleanup);

const TODAY = "2026-10-11";
const ID = "picker";
/** A served bound past every official date, for the tests that are not about the bound. */
const FAR = "2030-12-31";

function Picker({
  initial = [],
  onChange,
}: {
  initial?: string[];
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
      data-testid={ID}
    />
  );
}

/** The picker under a served bound (`latest_test_date` on the profile read). */
function Harness({
  latest = FAR,
  ...props
}: {
  initial?: string[];
  latest?: string;
  onChange?: (next: SatDateChoice) => void;
}): JSX.Element {
  const Bound = satDateBoundWrapper(latest);
  return (
    <Bound>
      <Picker {...props} />
    </Bound>
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

  it("offers nothing past the served bound, and the bound itself is offered", () => {
    render(<Harness latest="2027-03-06" />);
    const offered = offeredSatDates(ID);
    expect(offered).toContain("2026-11-07");
    expect(offered).toContain("2027-03-06");
    expect(offered.every((d) => d <= "2027-03-06")).toBe(true);
    expect(offered).not.toContain("2027-05-01");
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

describe("the served bound (owner rulings 2026-10-11, 2026-10-12): fail closed until it is known", () => {
  // The role-agnostic read's body (`GET /api/sat-dates/bound`), as the route sends it.
  const SERVED = { latest_test_date: "2027-03-06", requestId: "r" };

  function renderUnseeded(): void {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <Picker initial={["2026-12-05"]} />
      </QueryClientProvider>,
    );
  }

  afterEach(() => vi.unstubAllGlobals());

  it("reads the bound from GET /api/sat-dates/bound and offers no date while it loads", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    renderUnseeded();
    // Rendering alone requests nothing (a guardian's first load on onboarding, G-NEW-03).
    expect(fetchMock).not.toHaveBeenCalled();
    const menu = openSatDates(ID);
    expect(within(menu).getByTestId(`${ID}-dates-loading`).textContent).toBe(
      "Loading test dates…",
    );
    expect(offeredSatDates(ID)).toEqual([]);
    // "Not sure yet" stays available, and the closed answer still reads the saved date.
    expect(within(menu).getByTestId(`${ID}-not-sure`)).toBeInTheDocument();
    // The role-agnostic read, never the student-only calendar profile (ruling on #1211).
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining("/api/sat-dates/bound"),
    ]);
    closeSatDates(ID);
    expect(satDatesSummary(ID)).toBe("Sat, Dec 5, 2026");
  });

  it("when the read fails, offers no date and Try again loads the bound", async () => {
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fail
          ? new Response(JSON.stringify({ error: "boom" }), { status: 500 })
          : new Response(JSON.stringify(SERVED), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
      ),
    );
    renderUnseeded();
    openSatDates(ID);
    // `useSatDateBound` retries once (about a second) before it reports the failure.
    const error = await screen.findByTestId(
      `${ID}-dates-error`,
      {},
      { timeout: 5000 },
    );
    expect(offeredSatDates(ID)).toEqual([]);
    fail = false;
    fireEvent.click(within(error).getByRole("button", { name: "Try again" }));
    // Every official date up to the bound, the bound included, and nothing after it.
    await waitFor(() =>
      expect(offeredSatDates(ID)).toEqual([
        "2026-11-07",
        "2026-12-05",
        "2027-03-06",
      ]),
    );
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

  it("no surface passes its own bound: the picker takes only the served one", () => {
    const users = files.filter((f) =>
      /<SatDatePicker\b/.test(fs.readFileSync(f, "utf8")),
    );
    expect(users.length).toBe(6);
    for (const f of users) {
      const text = fs.readFileSync(f, "utf8");
      for (const m of text.matchAll(/<SatDatePicker\b[^>]*?\/>/gs)) {
        expect(m[0], path.relative(root, f)).not.toMatch(/\blatest\b/);
      }
    }
    const picker = fs.readFileSync(
      path.join(root, "components", "sat-dates", "SatDatePicker.tsx"),
      "utf8",
    );
    expect(picker).toContain("useSatDateBound({ enabled: opened })");
    expect(picker).not.toContain("useStudyProfile");
    expect(picker).toContain("bound.data?.latest_test_date");
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
