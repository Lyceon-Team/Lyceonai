// @vitest-environment jsdom
/**
 * @spec [owner request 2026-10-05 (QOTD perf follow-up)] | @implemented [2026-10-05]
 *
 * plain English: the homepage slot shows only the loading line, and does not import the widget
 * chunk, until it comes near the viewport; then the widget mounts. IntersectionObserver is
 * driven by hand.
 */
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const widgetImported = vi.hoisted(() => ({ count: 0 }));
vi.mock("./QotdWidget", () => {
  widgetImported.count += 1;
  return { QotdWidget: () => <div data-testid="qotd-widget-mounted" /> };
});

type Callback = (entries: { isIntersecting: boolean }[]) => void;
let observed: {
  cb: Callback;
  options: IntersectionObserverInit | undefined;
}[] = [];

beforeEach(() => {
  observed = [];
  widgetImported.count = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: Callback, options?: IntersectionObserverInit) {
        observed.push({ cb, options });
      }
      observe(): void {}
      disconnect(): void {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("LazyQotdWidget", () => {
  it("shows only the loading line and does not load the widget until near the viewport", async () => {
    const { LazyQotdWidget } = await import("./LazyQotdWidget");
    render(<LazyQotdWidget />);
    expect(screen.getByTestId("qotd-loading")).toBeTruthy();
    expect(screen.queryByTestId("qotd-widget-mounted")).toBeNull();
    expect(observed).toHaveLength(1);
    expect(observed[0]?.options?.rootMargin).toBe("400px 0px");
    // Not yet near: nothing changes.
    act(() => observed[0]?.cb([{ isIntersecting: false }]));
    expect(screen.queryByTestId("qotd-widget-mounted")).toBeNull();
    expect(widgetImported.count).toBe(0);

    act(() => observed[0]?.cb([{ isIntersecting: true }]));
    await screen.findByTestId("qotd-widget-mounted");
    expect(widgetImported.count).toBe(1);
  });
});
