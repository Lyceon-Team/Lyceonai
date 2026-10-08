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

// @spec [Production QA 2026-10-07 item 7: "a back link's label must match its destination"]
// | @implemented [2026-10-07] | plain English: besides the count, the in-app paths are kept as a
// stack (the current page last), so the back arrow can NAME the page it returns to. The count is
// the stack's length minus one, so the two can never disagree. A pop removes the top and then
// trusts the browser's own location for the new top (a forward step counted as a back step stays
// harmless: the label then names where the browser actually is behind us, or the section home).
let paths: string[] = [];

/** Starts counting. Mounted once, by the app's route switch. Restarting resets the count. */
export function useInAppHistoryTracking(): void {
  // Subscribing to an external event source (the History API): an effect is the right tool.
  useEffect(() => {
    paths = [window.location.pathname];
    const onPush = (): void => {
      paths.push(window.location.pathname);
    };
    const onPop = (): void => {
      if (paths.length > 1) paths.pop();
      paths[paths.length - 1] = window.location.pathname;
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
  return paths.length > 1;
}

/** The in-app page behind the current one (its pathname), or null when there is none. */
export function previousInAppPath(): string | null {
  return paths.length > 1 ? (paths[paths.length - 2] ?? null) : null;
}
