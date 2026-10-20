/**
 * Home's projection panel after SCL-235 / SCL-236: the free student's stored diagnostic result,
 * and the paid student's live projection, unchanged.
 *
 * @spec [SCL-235 (owner ruling, Karl, 2026-10-16: free sees only the diagnostic projection, the
 *       ongoing projection is Premium-only; paid sees only the live one); SCL-236 (the stored
 *       diagnostic projection); DESIGN.md §5 (one filled primary per screen: the upgrade is a text
 *       link)] | @implemented [2026-10-17]
 *
 * plain English: both shots run over the real routes and the real SQL in the harness database,
 * light and dark, at 1440 and 390. The free student takes the whole diagnostic through the real
 * routes first, so the number on the panel is the one complete_diagnostic_session stored.
 */
import type { PageGroup } from "./types";

const NO_PROTOTYPE = {
  kind: "none" as const,
  reason:
    "NOT PROTOTYPED: 'Your diagnostic result' is new with SCL-235 (owner ruling, Karl, 2026-10-16); it reuses the panel's existing heading, band and muted line, and the panel link style for the upgrade.",
};

function both(selector: string): { desktop: string; mobile: string } {
  return { desktop: selector, mobile: selector };
}

export const DIAGNOSTIC_PROJECTION: PageGroup = {
  id: "DIAGNOSTIC-PROJECTION",
  title:
    "Home projection panel: free = 'Your diagnostic result', paid = live 'Projected score' (light and dark, 1440 and 390)",
  shots: [
    {
      id: "home-free-diagnostic-result",
      title:
        "Home, free, after the diagnostic: the panel says 'Your diagnostic result', the stored band, 'From your diagnostic answers. This result doesn't change.' and the upgrade link for the live projection",
      persona: "free",
      route: "/dashboard",
      completedDiagnostic: true,
      waitFor: both('[data-testid="home-projection-range"]'),
      fullPage: true,
      prototype: NO_PROTOTYPE,
    },
    {
      id: "home-paid-live-projection",
      title:
        "Home, paid: the panel is unchanged — 'Projected score', the live band, no diagnostic label and no upgrade link",
      persona: "paid",
      route: "/dashboard",
      waitFor: both('[data-testid="home-projection"]'),
      fullPage: true,
      prototype: NO_PROTOTYPE,
    },
  ],
};
