/**
 * @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13) P0 item 1]
 *       | @implemented [2026-10-13]
 * plain English: the one full page reload the error boundaries perform (the automatic one after a
 * chunk-load failure, and the error screen's "Reload page"). Its own module so tests can replace
 * it: jsdom cannot reload, and a test must count how many reloads happened.
 */
export function reloadPage(): void {
  window.location.reload();
}
