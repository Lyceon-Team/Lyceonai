/**
 * The height of the app's fixed bottom chrome (the student shell's phone tab bar), as measured.
 *
 * @spec [student-UI register F-72 (the cookie banner covered the phone tab bar and the calendar
 *       bottom sheet's actions until answered); owner brief 2026-10-05 ("on signed-in pages, the
 *       banner sits above the tab bar, offset by the tab-bar height plus
 *       env(safe-area-inset-bottom) … Public pages are unchanged")] | @implemented [2026-10-05]
 *
 * plain English: the tab bar reports its own rendered height here while it is mounted; anything
 * else pinned to the bottom of the screen (the cookie banner) reads it and sits above it. The
 * height is MEASURED (ResizeObserver), not restated: the tab bar is hidden from the lg breakpoint
 * up, which measures 0, so a desktop layout and every public page (no tab bar at all) get no
 * offset without a second breakpoint to keep in step.
 *
 * @updated 2026-10-22 — owner brief "LISA chat dock" (Karl): LAYERS. The LISA bubble also has to
 * sit clear of the cookie banner (and of the runner's Submit/Next footer), so the same measured
 * mechanism now holds one height per layer instead of a second, forked one: `tab-bar` (the
 * phone tab bar, as before), `consent` (the cookie banner or the GPC notice, while shown) and
 * `runner-footer` (the question runner's Skip / Submit / Next bar). A reporter names its layer
 * (default `tab-bar`, so the tab bar's call is unchanged) and a reader names the layers it sums
 * (default `["tab-bar"]`, so the banner still reads exactly what it read before: it sits above the
 * tab bar, never above itself). Trade-off: the banner's own height is now published too, which
 * changes nothing for any reader that does not ask for `consent`.
 *
 * @updated 2026-10-23 — owner ruling 5 on #1300 (Karl: "the bubble must never cover the
 * calculator"): a fourth layer, `dock-bubble`, the collapsed LISA bubble itself, reported while it
 * is drawn. The runner's side-panel calculator reads it and keeps that much clear at its bottom,
 * so the bubble never sits over Desmos. Nothing else reads it.
 */
import { useEffect, useSyncExternalStore, type RefObject } from "react";

/** One piece of fixed bottom chrome that reports its height. */
export type BottomChromeLayer =
  | "tab-bar"
  | "consent"
  | "runner-footer"
  | "dock-bubble";

const heights: Record<BottomChromeLayer, number> = {
  "tab-bar": 0,
  consent: 0,
  "runner-footer": 0,
  "dock-bubble": 0,
};
const listeners = new Set<() => void>();

function publish(layer: BottomChromeLayer, next: number): void {
  // UP, never to nearest (F-72, owner brief 2026-10-21 Part E): the bar measures 65.296875px at
  // 390; Math.round published 65 and the banner's bottom edge sat 0.3px inside the bar.
  const rounded = Math.max(0, Math.ceil(next));
  if (rounded === heights[layer]) return;
  heights[layer] = rounded;
  for (const listener of listeners) listener();
}

const TAB_BAR_ONLY: readonly BottomChromeLayer[] = ["tab-bar"];

/** The summed height of `layers` (default: the tab bar alone, the F-72 reading). */
export function bottomChromeHeight(
  layers: readonly BottomChromeLayer[] = TAB_BAR_ONLY,
): number {
  let total = 0;
  for (const layer of layers) total += heights[layer];
  return total;
}

export function subscribeBottomChrome(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * The summed height in px of `layers` (0 when none is mounted, or all are hidden). Defaults to the
 * tab bar alone. Prerender reads 0. Pass a module-level constant array: the layers are read on
 * every snapshot, and a number is compared by value, so a new array per render is harmless but
 * pointless.
 */
export function useBottomChromeHeight(
  layers: readonly BottomChromeLayer[] = TAB_BAR_ONLY,
): number {
  return useSyncExternalStore(
    subscribeBottomChrome,
    () => bottomChromeHeight(layers),
    () => 0,
  );
}

/** Called by the element that IS a piece of bottom chrome: reports its height while mounted. */
export function useReportBottomChrome(
  ref: RefObject<HTMLElement>,
  layer: BottomChromeLayer = "tab-bar",
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    publish(layer, el.getBoundingClientRect().height);
    if (typeof ResizeObserver === "undefined") {
      return () => publish(layer, 0);
    }
    const observer = new ResizeObserver(() =>
      publish(layer, el.getBoundingClientRect().height),
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      publish(layer, 0);
    };
  }, [ref, layer]);
}
