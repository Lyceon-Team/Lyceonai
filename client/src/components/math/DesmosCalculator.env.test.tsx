// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

let resizeCallback: (() => void) | null = null;

class MockResizeObserver {
  constructor(cb: () => void) {
    resizeCallback = cb;
  }
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

beforeEach(() => {
  global.ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver;
});

function clearDesmosScripts(): void {
  document
    .querySelectorAll('script[data-desmos="graphing-calculator"]')
    .forEach((node) => node.remove());
}

/** Stub window.Desmos with spied constructor + instance methods. */
function stubDesmos(): {
  resizeSpy: ReturnType<typeof vi.fn>;
  constructorSpy: ReturnType<typeof vi.fn>;
  lastOptions: Record<string, unknown> | undefined;
} {
  const resizeSpy = vi.fn();
  let lastOptions: Record<string, unknown> | undefined;
  const constructorSpy = vi.fn(function (
    this: unknown,
    _el: HTMLElement,
    opts?: Record<string, unknown>,
  ) {
    lastOptions = opts;
    return {
      setState: vi.fn(),
      getState: vi.fn().mockReturnValue({}),
      resize: resizeSpy,
      destroy: vi.fn(),
      observeEvent: vi.fn(),
      unobserveEvent: vi.fn(),
    };
  });

  (window as Record<string, unknown>).Desmos = {
    GraphingCalculator: constructorSpy,
    ScientificCalculator: constructorSpy,
  };

  return {
    resizeSpy,
    constructorSpy,
    get lastOptions() {
      return lastOptions;
    },
  };
}

/** Trigger the Desmos script onload so the constructor fires. */
function triggerScriptLoad(): void {
  const script = document.querySelector<HTMLScriptElement>(
    'script[data-desmos="graphing-calculator"]',
  );
  if (script) script.onload?.(new Event("load"));
}

describe("DesmosCalculator ResizeObserver", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    clearDesmosScripts();
    delete (window as Record<string, unknown>).Desmos;
    resizeCallback = null;
  });

  afterEach(() => {
    clearDesmosScripts();
    delete (window as Record<string, unknown>).Desmos;
    vi.unstubAllEnvs();
  });

  it("calls calculator.resize() via ResizeObserver when container resizes", async () => {
    vi.stubEnv("VITE_DESMOS_API_KEY", "test-key");
    const { resizeSpy } = stubDesmos();

    const { default: DesmosCalculator } = await import("./DesmosCalculator");
    render(<DesmosCalculator expanded />);

    triggerScriptLoad();

    await waitFor(() => {
      expect(resizeSpy).toHaveBeenCalled();
    });

    resizeSpy.mockClear();

    if (resizeCallback) {
      resizeCallback();
      await new Promise((r) => requestAnimationFrame(r));
    }

    expect(resizeSpy).toHaveBeenCalled();
  });

  it("calls calculator.resize() on show/hide toggle", async () => {
    vi.stubEnv("VITE_DESMOS_API_KEY", "test-key");
    const { resizeSpy } = stubDesmos();

    const { default: DesmosCalculator } = await import("./DesmosCalculator");
    const { rerender } = render(<DesmosCalculator expanded />);

    triggerScriptLoad();

    await waitFor(() => {
      expect(resizeSpy).toHaveBeenCalled();
    });

    resizeSpy.mockClear();

    // Collapse → expand cycle should trigger resize
    rerender(<DesmosCalculator expanded={false} />);
    rerender(<DesmosCalculator expanded />);

    await waitFor(() => {
      expect(resizeSpy).toHaveBeenCalled();
    });
  });

  it("calls calculator.resize() on mode switch", async () => {
    vi.stubEnv("VITE_DESMOS_API_KEY", "test-key");
    const { resizeSpy } = stubDesmos();

    const { default: DesmosCalculator } = await import("./DesmosCalculator");
    render(<DesmosCalculator expanded />);

    triggerScriptLoad();

    await waitFor(() => {
      expect(resizeSpy).toHaveBeenCalled();
    });

    resizeSpy.mockClear();

    // Click the Scientific mode button to switch modes
    const scientificBtn = screen.getByTestId("desmos-mode-scientific");
    fireEvent.click(scientificBtn);

    // Mode switch destroys old calculator and creates new one.
    // The new constructor call triggers an initial resize() via setTimeout(0).
    triggerScriptLoad();

    await waitFor(() => {
      expect(resizeSpy).toHaveBeenCalled();
    });
  });
});

/* ── FIX 2: Constructor options ── */
describe("DesmosCalculator constructor options", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    clearDesmosScripts();
    delete (window as Record<string, unknown>).Desmos;
    resizeCallback = null;
  });

  afterEach(() => {
    clearDesmosScripts();
    delete (window as Record<string, unknown>).Desmos;
    vi.unstubAllEnvs();
  });

  it("passes autosize: true to the Desmos constructor", async () => {
    vi.stubEnv("VITE_DESMOS_API_KEY", "test-key");
    const desmos = stubDesmos();

    const { default: DesmosCalculator } = await import("./DesmosCalculator");
    render(<DesmosCalculator expanded />);

    triggerScriptLoad();

    await waitFor(() => {
      expect(desmos.constructorSpy).toHaveBeenCalled();
    });

    expect(desmos.lastOptions).toBeDefined();
    expect(desmos.lastOptions?.autosize).toBe(true);
  });
});

describe("DesmosCalculator env wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    clearDesmosScripts();
    delete (window as Record<string, unknown>).Desmos;
  });

  afterEach(() => {
    clearDesmosScripts();
    delete (window as Record<string, unknown>).Desmos;
    vi.unstubAllEnvs();
  });

  it("fails closed with clear error when VITE_DESMOS_API_KEY is missing", async () => {
    vi.stubEnv("VITE_DESMOS_API_KEY", "");
    const { default: DesmosCalculator } = await import("./DesmosCalculator");

    render(<DesmosCalculator expanded />);

    await waitFor(() => {
      const error = screen.getByTestId("desmos-calculator-error");
      expect(error.textContent).toContain("VITE_DESMOS_API_KEY");
    });
    expect(
      document.querySelector('script[data-desmos="graphing-calculator"]'),
    ).toBeNull();
  });

  it("loads script with encoded VITE_DESMOS_API_KEY in v1.11 URL", async () => {
    const apiKey = "demo key+/=?&";
    vi.stubEnv("VITE_DESMOS_API_KEY", apiKey);
    const { default: DesmosCalculator } = await import("./DesmosCalculator");

    render(<DesmosCalculator expanded />);

    const script = document.querySelector<HTMLScriptElement>(
      'script[data-desmos="graphing-calculator"]',
    );
    expect(script).not.toBeNull();
    expect(script?.src).toContain(
      "https://www.desmos.com/api/v1.11/calculator.js?apiKey=",
    );
    expect(script?.src).toContain(encodeURIComponent(apiKey));
  });
});
