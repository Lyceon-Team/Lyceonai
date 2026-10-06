/**
 * The theme lock of the shell on screen, for what renders outside it (portalled modals).
 *
 * @spec [student-UI register §8 F-65 ("the upgrade modal ignores the shell's light lock"); OQ-49
 *        (every shell pinned light until its page is themed, ruled 2026-10-03); DESIGN.md §1
 *        (light and dark token sets), §2 (the timed module is light only)]
 *        | @implemented [2026-10-03]
 *
 * plain English: a shell pins the light token set with `data-theme-lock="light"` on its `.lyc`
 * root. A modal portals onto <body>, outside that root, and carries its own `.lyc`
 * root, so it took the device theme instead: a dark modal over a page pinned light (F-65). The
 * shell on screen now publishes its lock here, and the student Modal puts the same
 * `data-theme-lock` on its portal root, so an overlay always matches the page under it. The
 * upgrade modal is mounted at the app root, above every shell, which is why the lock is
 * published upward to a provider rather than read from a context the shell provides.
 *
 * trade-offs: one value for the app, because exactly one shell is on screen at a time (the
 * router renders one route). Without the provider (a component test, or the error screen above
 * every provider) publishing is a no-op and the lock reads null, the unlocked behaviour.
 *
 * edge cases: on a route change React runs the old shell's cleanup (null) before the new
 * shell's effect (its own lock), so the value never sticks to a shell that has gone.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ThemeLock } from "@/lib/route-shells";

type ThemeLockStore = {
  readonly lock: ThemeLock;
  readonly publish: (lock: ThemeLock) => void;
};

const NO_STORE: ThemeLockStore = { lock: null, publish: () => undefined };

const ThemeLockContext = createContext<ThemeLockStore>(NO_STORE);

export function ActiveThemeLockProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [lock, setLock] = useState<ThemeLock>(null);
  const store = useMemo<ThemeLockStore>(
    () => ({ lock, publish: setLock }),
    [lock],
  );
  return (
    <ThemeLockContext.Provider value={store}>
      {children}
    </ThemeLockContext.Provider>
  );
}

/** A shell announces its lock while it is mounted. */
export function usePublishThemeLock(lock: ThemeLock): void {
  const { publish } = useContext(ThemeLockContext);
  // Synchronising the shell's prop out to the app-root store: an effect is the tool for that.
  useEffect(() => {
    publish(lock);
    return () => publish(null);
  }, [publish, lock]);
}

/** The lock of the shell on screen, for a portalled overlay's own `.lyc` root. */
export function useActiveThemeLock(): ThemeLock {
  return useContext(ThemeLockContext).lock;
}
