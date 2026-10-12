// @vitest-environment jsdom
/**
 * The calculator's lifecycle: Scientific + DEG by default, one calculator per tab for the life of
 * the component, and its own saved state never re-applied under the student.
 *
 * @spec [Doc-02B_v4 §28; owner brief 2026-10-11 ("default to Scientific + DEG, and fix the
 *       keypad"; "switching tabs keeps each calculator's state, no re-creation on switch")]
 * @implemented [2026-10-11]
 *
 * plain English: a fake Desmos records every construction, every setState and every change
 * handler. The component is mounted the way the exam and practice pages mount it — the parent
 * keeps the emitted state and passes it straight back as `initialState` — and then:
 *   - it opens on Scientific, and both calculators are constructed with `degreeMode: true`;
 *   - tab switches construct each kind once, never again, and destroy nothing;
 *   - after a change is saved (past the debounce) and comes back as `initialState`, nothing
 *     calls `setState` on the live calculator (the reset that closed the keypad, 2026-10-11);
 *   - a genuinely different `initialState` (a resume) is still applied.
 * The browser proof against the real Desmos runtime is tests/e2e/desmos-calculator.spec.ts.
 */
import React, { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DesmosCalculator from "./DesmosCalculator";

type Made = {
  kind: "graphing" | "scientific";
  options: Record<string, unknown>;
  setStates: unknown[];
  destroyed: boolean;
  fireChange: () => void;
  state: unknown;
};

let made: Made[] = [];

function fakeCalculator(kind: Made["kind"]) {
  return function FakeCalculator(
    this: unknown,
    _el: HTMLElement,
    options?: Record<string, unknown>,
  ): DesmosCalculatorInstance {
    const handlers: Array<() => void> = [];
    const record: Made = {
      kind,
      options: options ?? {},
      setStates: [],
      destroyed: false,
      fireChange: () => handlers.forEach((h) => h()),
      state: { kind, n: 0 },
    };
    made.push(record);
    return {
      setState: (s: unknown) => {
        record.setStates.push(s);
        record.state = s;
      },
      getState: () => record.state,
      resize: () => undefined,
      destroy: () => {
        record.destroyed = true;
      },
      observeEvent: (_e: string, cb: () => void) => handlers.push(cb),
      unobserveEvent: () => undefined,
      updateSettings: () => undefined,
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
  vi.useRealTimers();
  delete window.Desmos;
});

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** The exam/practice wiring: emitted state is stored and fed straight back as initialState. */
let setFromOutside: (s: unknown) => void = () => undefined;
function EchoingParent(): JSX.Element {
  const [state, setState] = useState<unknown>(null);
  setFromOutside = setState;
  return (
    <DesmosCalculator
      expanded
      initialState={state}
      onStateChange={setState}
      debounceMs={10}
    />
  );
}

const of = (kind: Made["kind"]) => made.filter((m) => m.kind === kind);

describe("DesmosCalculator lifecycle (owner brief 2026-10-11)", () => {
  it("opens on Scientific; both calculators are constructed in degrees", async () => {
    render(<EchoingParent />);
    await flush();
    expect(
      screen.getByTestId("desmos-mode-scientific").getAttribute("aria-checked"),
    ).toBe("true");
    expect(made.map((m) => m.kind)).toEqual(["scientific"]);
    fireEvent.click(screen.getByTestId("desmos-mode-graphing"));
    await flush();
    expect(made.map((m) => m.kind)).toEqual(["scientific", "graphing"]);
    expect(made.map((m) => m.options.degreeMode)).toEqual([true, true]);
  });

  it("switching tabs constructs each calculator once and destroys none", async () => {
    render(<EchoingParent />);
    await flush();
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(screen.getByTestId("desmos-mode-graphing"));
      await flush();
      fireEvent.click(screen.getByTestId("desmos-mode-scientific"));
      await flush();
    }
    expect(of("scientific")).toHaveLength(1);
    expect(of("graphing")).toHaveLength(1);
    expect(made.some((m) => m.destroyed)).toBe(false);
  });

  it("its own saved state coming back as initialState is never re-applied (Graphing and Scientific)", async () => {
    render(<EchoingParent />);
    await flush();
    fireEvent.click(screen.getByTestId("desmos-mode-graphing"));
    await flush();
    for (const calc of made) {
      calc.state = { kind: calc.kind, n: 1 };
      calc.fireChange();
      await flush(30); // past the debounce: emitted, stored by the parent, passed back in
      calc.state = { kind: calc.kind, n: 2 };
      calc.fireChange();
      await flush(30);
    }
    expect(made.map((m) => m.setStates)).toEqual([[], []]);
  });

  it("a genuinely different initialState (a resume) is applied to both calculators", async () => {
    render(<EchoingParent />);
    await flush();
    fireEvent.click(screen.getByTestId("desmos-mode-graphing"));
    await flush();
    const resumed = {
      graphing: { g: "resumed" },
      scientific: { s: "resumed" },
    };
    act(() => setFromOutside(resumed));
    await flush();
    expect(of("graphing")[0]?.setStates).toEqual([{ g: "resumed" }]);
    expect(of("scientific")[0]?.setStates).toEqual([{ s: "resumed" }]);
  });

  it("unmount destroys both calculators", async () => {
    const { unmount } = render(<EchoingParent />);
    await flush();
    fireEvent.click(screen.getByTestId("desmos-mode-graphing"));
    await flush();
    unmount();
    expect(made.map((m) => m.destroyed)).toEqual([true, true]);
  });
});
