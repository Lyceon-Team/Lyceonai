/**
 * The CTA is counted once per activation, on all three navigating paths.
 *
 * @spec [issue #829; owner ruling 2026-09-22 — shim the analytics, do not accept the loss]
 * | @implemented [2026-09-22]
 *
 * WHAT THIS IS DEFENDING. After the anchor fix, `wouter`'s `Link` hands a modified click to
 * the browser and returns BEFORE calling the caller's `onClick`. Counting only `onClick`
 * would therefore stop counting exactly the clicks that now work — a funnel that quietly
 * drops a subset of conversions, with no error and no obvious cause.
 *
 * Each case asserts the call COUNT, not merely that the handler is reachable. "Fires" and
 * "fires once" are different claims, and the one worth making is the second: the failure
 * this guards against in the other direction is a middle-click counted twice, which would
 * inflate the same number it was added to protect.
 */
import { describe, expect, it, vi } from "vitest";
import type { MouseEvent as ReactMouseEvent } from "react";
import { ctaClickHandlers } from "./cta-click";

/** The fields these handlers read. Cast once here rather than at every call. */
function mouse(init: Partial<ReactMouseEvent>): ReactMouseEvent {
  return {
    button: 0,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  } as ReactMouseEvent;
}

describe("ctaClickHandlers", () => {
  it("counts a plain left click exactly once", () => {
    const track = vi.fn();
    const h = ctaClickHandlers(track);

    // The browser order for an unmodified primary click. wouter calls onClick on this path.
    h.onMouseDown(mouse({ button: 0 }));
    h.onClick(mouse({ button: 0 }));

    expect(track).toHaveBeenCalledTimes(1);
  });

  it("counts a ⌘/ctrl-click exactly once, on mousedown", () => {
    for (const modifier of [
      "metaKey",
      "ctrlKey",
      "shiftKey",
      "altKey",
    ] as const) {
      const track = vi.fn();
      const h = ctaClickHandlers(track);

      // mousedown fires; then `click` fires too, but wouter returns before onClick —
      // so the click half is NOT delivered. That asymmetry is the whole point.
      h.onMouseDown(mouse({ button: 0, [modifier]: true }));

      expect(track, `${modifier}+click`).toHaveBeenCalledTimes(1);
    }
  });

  it("counts a middle click exactly once, on auxclick", () => {
    const track = vi.fn();
    const h = ctaClickHandlers(track);

    // A middle click fires mousedown(button 1) and auxclick(button 1). It does NOT fire
    // `click` — the UI Events spec dispatches click only for the primary button — so the
    // mousedown half must decline it or the count doubles.
    h.onMouseDown(mouse({ button: 1 }));
    h.onAuxClick(mouse({ button: 1 }));

    expect(track).toHaveBeenCalledTimes(1);
  });

  it("counts a ⌘+middle click exactly once, not twice", () => {
    const track = vi.fn();
    const h = ctaClickHandlers(track);

    // THE DOUBLE-FIRE TRAP. Both a modifier AND a non-primary button are present, so a
    // mousedown handler that checked only "is a modifier held" would fire here as well as
    // auxclick. It checks the button too.
    h.onMouseDown(mouse({ button: 1, metaKey: true }));
    h.onAuxClick(mouse({ button: 1, metaKey: true }));

    expect(track).toHaveBeenCalledTimes(1);
  });

  it("does not count a right click", () => {
    const track = vi.fn();
    const h = ctaClickHandlers(track);

    // Right-click opens a context menu. Whether the student then picks "open in new tab"
    // is not observable here, and counting the menu itself would count intent as action.
    h.onMouseDown(mouse({ button: 2 }));
    h.onAuxClick(mouse({ button: 2 }));

    expect(track).not.toHaveBeenCalled();
  });

  it("does not count a bare mousedown with no modifier — the click half owns that", () => {
    const track = vi.fn();
    const h = ctaClickHandlers(track);

    h.onMouseDown(mouse({ button: 0 }));

    // Zero, not one: on this path wouter WILL call onClick, and if mousedown also counted
    // every ordinary click on the page's main CTA would be worth two.
    expect(track).not.toHaveBeenCalled();
  });
});
