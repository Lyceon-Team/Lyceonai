import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

/**
 * Tailwind's `lg:` screen (min-width 1024px, the default in tailwind.config.ts): the width at
 * which the student App shell switches from the phone layout (top bar and tab bar) to the rail.
 * A component that must behave differently on the phone layout, not just look different, reads
 * this query so its breakpoint is the shell's own.
 */
export const DESKTOP_LAYOUT_QUERY = "(min-width: 1024px)"

/**
 * @spec [owner ruling (Karl, 2026-10-05): the Full-Length phone notice shows "on phone widths";
 *       DESIGN.md §2 Mobile] | @implemented [2026-10-05]
 *
 * plain English: whether a CSS media query matches, kept in step with the viewport through
 * `matchMedia`'s change event (useSyncExternalStore, so the first render already has the answer
 * and there is no flash of the wrong layout). Where `matchMedia` does not exist (a test DOM, a
 * non-browser render) it answers `fallback`, which the caller chooses as the safe default.
 */
export function useMediaQuery(query: string, fallback: boolean): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void): (() => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => undefined
      }
      const mql = window.matchMedia(query)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    [query]
  )
  const getSnapshot = (): boolean =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : fallback
  return React.useSyncExternalStore(subscribe, getSnapshot, () => fallback)
}
