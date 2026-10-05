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
 * Below Tailwind's `lg:` screen (min-width 1024px, the default in tailwind.config.ts): the
 * widths at which the student App shell shows the phone layout (top bar and tab bar) instead of
 * the rail. This is exactly Tailwind's `max-lg:` media query, so a component that must behave
 * differently on the phone layout, not just look different, switches where the shell does.
 * Written as the phone query (not "min-width 1024px") so that "no match" means desktop, the
 * same convention as `useIsMobile` and the test setup's default `matchMedia`.
 */
export const PHONE_LAYOUT_QUERY = "not all and (min-width: 1024px)"

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
