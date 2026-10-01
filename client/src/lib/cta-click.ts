/**
 * Click tracking that survives the anchor fix.
 *
 * @spec [issue #829 — nav anchors; owner ruling 2026-09-22]
 * | @implemented [2026-09-22]
 *
 * plain English: a CTA that is middle-clicked or ⌘-clicked is a CONVERSION, not a lost
 * click, and these handlers make sure it is counted exactly once however it was opened.
 *
 * WHY THIS EXISTS AT ALL. Before the anchor fix, a nav/CTA link rendered
 * `<a href><a onClick>` and the inner anchor had no `href`. A ⌘-click did not navigate,
 * but React's `onClick` still fired, so the CTA was counted. After the fix there is one
 * real anchor, and `wouter`'s `Link` handler (wouter@3.9.0 src/index.js:283-300) returns
 * BEFORE calling the caller's `onClick`:
 *
 *     if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
 *         event.button !== 0) return;
 *     _onClick?.(event);
 *
 * That early return is exactly what lets the browser open a new tab — and it is also why
 * `onClick` alone would silently stop counting the clicks that now WORK. A metric that
 * quietly drops a subset of conversions is worse than either the old state or the new one,
 * so the gap is closed rather than accepted (owner ruling).
 *
 * THE RULE: track on precisely the events wouter declines, plus the plain click it takes.
 *
 *   plain primary click   `click` fires  → wouter calls onClick   → tracked here
 *   ⌘/ctrl/alt/shift+left `click` fires  → wouter returns early   → tracked on mousedown
 *   middle click          `auxclick`     → no `click` at all      → tracked on auxclick
 *   right click           `auxclick`     → opens a context menu   → NOT tracked
 *
 * expected outcome: exactly one call per CTA activation, on all three navigating paths.
 *
 * WHY IT CANNOT DOUBLE-FIRE. The three paths are disjoint by construction:
 *   - `onMouseDown` fires only for `button === 0` WITH a modifier, and on that path wouter
 *     suppresses `onClick`, so the click half never runs.
 *   - `onAuxClick` fires only for `button === 1`, and the UI Events spec does not dispatch
 *     `click` for a non-primary button, so the click half never runs there either. A
 *     ⌘+middle-click is `button === 1`, so the mousedown half declines it.
 *   - A plain click has no modifier and `button === 0`, so neither other handler fires.
 * The test asserts one call on each of the three paths, not merely that each is reachable.
 *
 * trade-offs: these handlers are written for a `wouter` `<Link>`, which is the only place
 * the early return exists. On a bare `<a>` the `onClick` half would double with the
 * mousedown half on a modified click, so this is not a general-purpose tracker — hence one
 * exported factory rather than three loose handlers a caller could mix onto anything.
 */
import type { MouseEvent as ReactMouseEvent } from "react";

/** The middle mouse button, as `MouseEvent.button` numbers it. */
const MIDDLE_BUTTON = 1;
/** The primary (usually left) button. */
const PRIMARY_BUTTON = 0;

/** True when a modifier is held — the same set wouter's Link checks. */
function hasModifier(event: ReactMouseEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
}

export type CtaClickHandlers = {
  onClick: (event: ReactMouseEvent) => void;
  onAuxClick: (event: ReactMouseEvent) => void;
  onMouseDown: (event: ReactMouseEvent) => void;
};

/**
 * Handlers to spread onto a `wouter` `<Link>` so `track` runs once per activation.
 *
 * `track` takes no arguments on purpose: the caller closes over whatever it wants to
 * record, and nothing here can accidentally log an event object (§12.1 — a DOM event
 * carries the target's text and attributes, which is not ours to emit).
 */
export function ctaClickHandlers(track: () => void): CtaClickHandlers {
  return {
    // Reached only for an unmodified primary click: wouter filters the rest out.
    onClick: () => track(),
    // Middle click. `click` is not dispatched for a non-primary button, so this is the
    // only signal that a new tab was opened this way.
    onAuxClick: (event) => {
      if (event.button === MIDDLE_BUTTON) track();
    },
    // A modified primary click — the one wouter hands to the browser. `mousedown` is
    // used rather than `click` because the click half is suppressed on this path.
    onMouseDown: (event) => {
      if (event.button === PRIMARY_BUTTON && hasModifier(event)) track();
    },
  };
}
