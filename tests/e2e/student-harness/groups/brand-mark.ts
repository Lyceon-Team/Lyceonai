/**
 * The Lyceon logo in place of the graduation-cap mark (owner request, Karl, 2026-10-09).
 *
 * @spec [owner request 2026-10-09: "replace the graduation-cap mark at the top of the rail (and
 *        anywhere else the app uses it as the brand mark, e.g. the mobile top bar and bare-card
 *        pages) with the Lyceon logo ... Same size and spacing; light and dark. Screenshots of
 *        rail, mobile top bar and one bare page."] | @implemented [2026-10-09]
 *
 * plain English: the App shell's brand mark is one element that is the rail's top on a desktop
 * and the top bar on a phone, so one /dashboard shot covers both at the two viewports. The bare
 * page is /login; the public home's nav is the other surface that drew the cap.
 */
import type { PageGroup } from "./types";

export const BRAND_MARK: PageGroup = {
  id: "BRAND",
  title:
    "Brand mark: the Lyceon logo on the rail, the mobile top bar, a bare page and the public nav",
  shots: [
    {
      id: "app-dashboard-paid",
      title:
        "App shell, /dashboard: the rail (desktop) and the top bar (phone)",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="app-rail"]',
        mobile: '[data-testid="app-tab-bar"]',
      },
      prototype: {
        kind: "none",
        reason: "Owner request; no prototype change.",
      },
    },
    {
      id: "bare-login",
      title: "Bare card, /login, signed out",
      persona: "signed-out",
      route: "/login",
      prototype: {
        kind: "none",
        reason: "Owner request; no prototype change.",
      },
    },
    {
      id: "public-home",
      title: "Public home, signed out: the nav and the footer",
      persona: "signed-out",
      route: "/",
      prototype: {
        kind: "none",
        reason: "Owner request; no prototype change.",
      },
    },
  ],
};
