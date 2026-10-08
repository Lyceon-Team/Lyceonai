// @vitest-environment jsdom
/**
 * @spec [production QA 2026-10-08 item B (Karl: "Desmos: invertedColors when the app theme is
 *       dark (Graphing and Scientific)"); DESIGN.md §1 (light and dark), §2 (the timed module is
 *       light only)] | @implemented [2026-10-08]
 *
 * plain English: Desmos cannot load in a test (no network, no key), so a fake `window.Desmos`
 * records what the component asks of it: the options each calculator is constructed with, and
 * every `updateSettings` call. The page's theme is the one the student tokens paint: <html
 * data-theme> on a `.lyc` root that is not pinned light. Presence first: each case proves a
 * calculator was constructed before reading its options.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import DesmosCalculator from "./DesmosCalculator";

type Made = {
  kind: "graphing" | "scientific";
  options: Record<string, unknown>;
  updates: Array<Record<string, unknown>>;
  destroyed: boolean;
};

let made: Made[] = [];

function fakeCalculator(kind: Made["kind"]) {
  return function FakeCalculator(
    this: unknown,
    _el: HTMLElement,
    options?: Record<string, unknown>,
  ): DesmosCalculatorInstance {
    const record: Made = {
      kind,
      options: options ?? {},
      updates: [],
      destroyed: false,
    };
    made.push(record);
    return {
      setState: () => undefined,
      getState: () => ({ kind }),
      resize: () => undefined,
      destroy: () => {
        record.destroyed = true;
      },
      observeEvent: () => undefined,
      unobserveEvent: () => undefined,
      updateSettings: (settings: Record<string, unknown>) => {
        record.updates.push(settings);
      },
    };
  } as unknown as new (
    element: HTMLElement,
    options?: Record<string, unknown>,
  ) => DesmosCalculatorInstance;
}

beforeEach(() => {
  made = [];
  global.ResizeObserver = class {
    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
  } as unknown as typeof ResizeObserver;
  window.Desmos = {
    GraphingCalculator: fakeCalculator("graphing"),
    ScientificCalculator: fakeCalculator("scientific"),
  };
});

afterEach(() => {
  cleanup();
  delete window.Desmos;
  document.documentElement.removeAttribute("data-theme");
});

/** Lets the script promise and the MutationObserver callbacks run. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mount(rootAttrs: Record<string, string> = {}): void {
  render(
    <div className="lyc" {...rootAttrs}>
      <DesmosCalculator expanded />
    </div>,
  );
}

function current(): Made {
  const last = made[made.length - 1];
  if (!last) throw new Error("no calculator was constructed");
  return last;
}

describe("QA2-B: Desmos follows the page's dark theme", () => {
  it("dark page: the Graphing calculator is constructed with invertedColors true", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    mount();
    await flush();
    expect(made).toHaveLength(1);
    expect(current().kind).toBe("graphing");
    expect(current().options.invertedColors).toBe(true);
  });

  it("light page: constructed with invertedColors false", async () => {
    document.documentElement.setAttribute("data-theme", "light");
    mount();
    await flush();
    expect(made).toHaveLength(1);
    expect(current().options.invertedColors).toBe(false);
  });

  it("dark page, Scientific: the scientific calculator is constructed inverted too", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    mount();
    await flush();
    fireEvent.click(screen.getByTestId("desmos-mode-scientific"));
    await flush();
    expect(current().kind).toBe("scientific");
    expect(current().options.invertedColors).toBe(true);
  });

  it("a theme change is applied live with updateSettings, without recreating the calculator", async () => {
    document.documentElement.setAttribute("data-theme", "light");
    mount();
    await flush();
    expect(made).toHaveLength(1);
    const calc = current();

    await act(async () => {
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await flush();
    expect(made).toHaveLength(1);
    expect(calc.destroyed).toBe(false);
    expect(calc.updates).toContainEqual({ invertedColors: true });

    await act(async () => {
      document.documentElement.setAttribute("data-theme", "light");
    });
    await flush();
    expect(made).toHaveLength(1);
    expect(calc.updates[calc.updates.length - 1]).toEqual({
      invertedColors: false,
    });
  });

  it("Scientific follows a live theme change too", async () => {
    document.documentElement.setAttribute("data-theme", "light");
    mount();
    await flush();
    fireEvent.click(screen.getByTestId("desmos-mode-scientific"));
    await flush();
    const sci = current();
    expect(sci.kind).toBe("scientific");
    expect(sci.options.invertedColors).toBe(false);
    await act(async () => {
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await flush();
    expect(current()).toBe(sci);
    expect(sci.updates).toContainEqual({ invertedColors: true });
  });

  it("a root pinned light (the timed module) keeps Desmos light whatever the setting", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    mount({ "data-theme-lock": "light" });
    await flush();
    expect(made).toHaveLength(1);
    expect(current().options.invertedColors).toBe(false);
  });
});
