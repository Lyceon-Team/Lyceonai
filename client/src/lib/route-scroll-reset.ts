/**
 * Scroll to the top on every route change.
 *
 * @spec [production re-test 2026-10-08 item I (Karl: "Reset scroll to top on every route
 *        change"); DESIGN.md §2 (App shell: the middle column is the only part that scrolls; the
 *        right panel scrolls on its own; Focus shell: `<main>` scrolls inside itself, F-69)]
 *        | @implemented [2026-10-08]
 *
 * plain English: wouter keeps the scroll position of whatever element scrolls when the route
 * changes, so a student who scrolled down Practice and then opened Review landed half-way down
 * Review. The scrolling element differs by layout: on a phone, and on the public pages, it is the
 * window; from `lg` up the App shell scrolls its middle column (`<main id="main">`) and its right
 * panel, and the Focus shell scrolls its `<main>`. This hook, mounted once by the route switch,
 * scrolls the window and every element marked `data-route-scroll` back to the top whenever the
 * PATHNAME changes.
 *
 * expected outcome: every new page opens at its top, at every width, in every shell.
 *
 * edge cases and trade-offs:
 *  - Query-only changes do not reset: wouter's location is the pathname alone, so a page that
 *    keeps in-page state in its query (a filter, `/profile?tab=`) keeps its scroll.
 *  - The first render does not reset: a reload keeps whatever the browser restored.
 *  - A hash on the new URL (`/help#contact`) scrolls its target into view instead, when the
 *    target is already on the page; otherwise the page opens at its top.
 *  - A page that scrolls itself after it loads (`/mastery?domain=` opens and scrolls to that
 *    domain once its grid has drawn) still does: this runs as a layout effect, before any page's
 *    own (passive) effect in the same commit, and a later commit is later still.
 *  - Back and Forward reset too (Karl: "every route change"); the browser's own restoration cannot
 *    be relied on here anyway, because the page it would restore into loads lazily.
 *  - On the server (the prerender) there is no window and no layout: the effect is a no-op there.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation } from "wouter";

/** The attribute a shell puts on each element that scrolls a page's content. */
export const ROUTE_SCROLL_ATTR = "data-route-scroll";

// useLayoutEffect warns when rendered on the server (the prerender); useEffect is the no-op there.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Scrolls the window and every `[data-route-scroll]` element to the top (or to the hash). */
function resetRouteScroll(): void {
  // The window's scroll is the document's scrolling element (`<html>` in standards mode).
  const page = document.scrollingElement ?? document.documentElement;
  for (const el of [
    page,
    ...Array.from(
      document.querySelectorAll<HTMLElement>(`[${ROUTE_SCROLL_ATTR}]`),
    ),
  ]) {
    el.scrollTop = 0;
    el.scrollLeft = 0;
  }
  // The raw fragment, not decoded: a malformed escape must not throw inside a layout effect.
  const hash = window.location.hash;
  if (hash.length > 1) {
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }
}

/** Mounted once, by the app's route switch. */
export function useRouteScrollReset(): void {
  const [pathname] = useLocation();
  const previous = useRef<string | null>(null);
  useIsomorphicLayoutEffect(() => {
    const was = previous.current;
    previous.current = pathname;
    if (was === null || was === pathname) return;
    resetRouteScroll();
  }, [pathname]);
}
