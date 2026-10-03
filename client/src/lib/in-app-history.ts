/**
 * Does the browser's previous history entry belong to this app session?
 *
 * @spec [student-UI register §2 "Back arrow target is defined, never guessed: the previous in-app
 *        page if the student came from inside Lyceon, otherwise the section's home. No full-page
 *        reloads."; DESIGN.md §2 Focus shell; UI-41] | @implemented [2026-10-03]
 *
 * plain English: a count of in-app history entries behind the current one. wouter dispatches a
 * `pushState` event on every client-side navigation (wouter@3.9.0
 * src/use-browser-location.js:66-88); each one adds an entry behind the new page, so the count
 * goes up. A `popstate` (the browser's back or forward) is treated as a step back, so the count
 * goes down, never below zero. A `replaceState` (redirects) adds no entry and is ignored. A full
 * load starts at zero, because entries before the load cannot be told apart from another site's.
 *
 * trade-offs: popstate does not say whether it went back or forward, so a forward step is counted
 * as a back step. That error only ever lowers the count, and a low count sends the back arrow to
 * the section home: still inside the app, never out of it. The opposite error (calling
 * `history.back()` with nothing in-app behind) cannot happen, because only in-app pushes raise it.
 */
import { useEffect } from "react";

let depth = 0;

/** Starts counting. Mounted once, by the app's route switch. Restarting resets the count. */
export function useInAppHistoryTracking(): void {
  // Subscribing to an external event source (the History API): an effect is the right tool.
  useEffect(() => {
    depth = 0;
    const onPush = (): void => {
      depth += 1;
    };
    const onPop = (): void => {
      depth = Math.max(0, depth - 1);
    };
    window.addEventListener("pushState", onPush);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("pushState", onPush);
      window.removeEventListener("popstate", onPop);
    };
  }, []);
}

/** True when the entry behind the current one was reached by an in-app navigation. */
export function hasInAppHistory(): boolean {
  return depth > 0;
}
