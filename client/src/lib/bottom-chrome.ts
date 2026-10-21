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
 */
import { useEffect, useSyncExternalStore, type RefObject } from "react";

let height = 0;
const listeners = new Set<() => void>();

function publish(next: number): void {
  // UP, never to nearest (F-72, owner brief 2026-10-21 Part E): the bar measures 65.296875px at
  // 390; Math.round published 65 and the banner's bottom edge sat 0.3px inside the bar.
  const rounded = Math.max(0, Math.ceil(next));
  if (rounded === height) return;
  height = rounded;
  for (const listener of listeners) listener();
}

export function bottomChromeHeight(): number {
  return height;
}

export function subscribeBottomChrome(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** The bottom chrome's height in px (0 when there is none, or it is hidden). Prerender reads 0. */
export function useBottomChromeHeight(): number {
  return useSyncExternalStore(
    subscribeBottomChrome,
    bottomChromeHeight,
    () => 0,
  );
}

/** Called by the element that IS the bottom chrome: reports its height while mounted. */
export function useReportBottomChrome(ref: RefObject<HTMLElement>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    publish(el.getBoundingClientRect().height);
    if (typeof ResizeObserver === "undefined") {
      return () => publish(0);
    }
    const observer = new ResizeObserver(() =>
      publish(el.getBoundingClientRect().height),
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      publish(0);
    };
  }, [ref]);
}
