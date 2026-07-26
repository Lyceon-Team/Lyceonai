// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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

function clearDesmosScripts() {
  document
    .querySelectorAll('script[data-desmos="graphing-calculator"]')
    .forEach((node) => node.remove());
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
    const resizeSpy = vi.fn();
    (window as Record<string, unknown>).Desmos = {
      GraphingCalculator: function (_el: HTMLElement) {
        return {
          setState: vi.fn(),
          getState: vi.fn().mockReturnValue({}),
          resize: resizeSpy,
          destroy: vi.fn(),
          observeEvent: vi.fn(),
          unobserveEvent: vi.fn(),
        };
      },
      ScientificCalculator: vi.fn(),
    };

    const { default: DesmosCalculator } = await import("./DesmosCalculator");
    render(<DesmosCalculator expanded />);

    const script = document.querySelector<HTMLScriptElement>(
      'script[data-desmos="graphing-calculator"]',
    );
    if (script) script.onload?.(new Event("load"));

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
