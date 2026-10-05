/**
 * Whether a signed-in surface is on screen — the one signal for "this is not a public page".
 *
 * @spec [SCL-213 IS 6 (owner ruling 2026-10-05: `mask_all_text` on signed-in surfaces only); owner
 *       ruling 2026-10-05 on cookie banner Version 2 (the banner, notice and dialog are light on
 *       public pages and follow the app's theme on signed-in pages)] | @implemented [2026-10-05]
 *
 * plain English: every page rendered through `RequireRole` registers here while it is mounted.
 * PostHog's text masking and the consent surfaces' theme both read this store, so the two can
 * never disagree about which pages are signed in. A counter, because a surface can hand over to
 * another (route change) before the first unmounts.
 */
let surfaces = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Called by RequireRole on mount; the returned function is its unmount. */
export function enterSignedInSurface(): () => void {
  surfaces += 1;
  notify();
  let left = false;
  return () => {
    if (left) return;
    left = true;
    surfaces -= 1;
    notify();
  };
}

export function onSignedInSurface(): boolean {
  return surfaces > 0;
}

export function subscribeSignedInSurface(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}
