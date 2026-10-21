/**
 * The public homepage hero (F-98) and the legal pages in the student token set (owner brief
 * "student cleanups", Karl, 2026-10-21, Parts F and G).
 *
 * @spec [owner brief 2026-10-21 Part F ("One student-facing sentence and ONE primary button,
 *        'Start free diagnostic'. 'Sign in' and 'I'm a parent or guardian' become secondary
 *        links."), Part G ("Render in dark mode with the student tokens; no text below 14px."),
 *        "screenshots for UI changes (light/dark, 1440/390)"] | @implemented [2026-10-21]
 *
 * plain English: signed out, banner answered. The hero is shot for both experiment variants
 * (owner rulings on #1277, Karl, 2026-10-21, ruling 4: Variant B keeps running, conformed to F-98):
 * Control A, and Variant B with analytics accepted and B stored as posthog-client.ts stores it. The homepage is light only by ruling (public pages
 * are light; its palette is `.home-palette`), so its dark rows record that the device theme is not
 * applied there. The legal hub and one legal document are shot in both themes.
 */
import {
  HERO_COPY,
  HERO_VARIANT_STORAGE_KEY,
} from "../../../../client/src/lib/analytics/hero-experiment";
import type { PageGroup } from "./types";

const NONE = {
  kind: "none",
  reason: "SEO-owned public pages; no student prototype covers them.",
} as const;

export const HOMEPAGE_HERO: PageGroup = {
  id: "HOMEPAGE-HERO",
  title:
    "F-98 homepage hero (one primary button, two text links) and Part G legal pages in the student tokens; light and dark, 1440 and 390",
  seed: "calendar-goal",
  shots: [
    {
      id: "home-hero",
      title:
        "Homepage hero: H1, one sentence, 'Start free diagnostic' (the one filled button), 'Sign in' and 'I'm a parent or guardian' as text links",
      persona: "signed-out",
      route: "/",
      waitFor: {
        desktop: '[data-testid="button-start-diagnostic"]',
        mobile: '[data-testid="button-start-diagnostic"]',
      },
      expectVisible: '[data-testid="hero-secondary-links"]',
      prototype: NONE,
    },
    {
      id: "home-hero-variant-b",
      title:
        "Homepage hero, experiment Variant B (analytics accepted, B stored): its own H1 and sentence over the same F-98 hero, one filled button, two text links, no label above the title (ruling 4, 2026-10-21)",
      persona: "signed-out",
      route: "/",
      analyticsConsentAccepted: true,
      localStorage: { [HERO_VARIANT_STORAGE_KEY]: "test" },
      waitFor: {
        desktop: '[data-testid="button-start-diagnostic"]',
        mobile: '[data-testid="button-start-diagnostic"]',
      },
      expectText: HERO_COPY.test.title,
      expectVisible: '[data-testid="hero-secondary-links"]',
      prototype: NONE,
    },
    {
      id: "legal-hub",
      title: "/legal in the student token set (dark follows the device)",
      persona: "signed-out",
      route: "/legal",
      waitFor: {
        desktop: '[data-testid="legal-hub"]',
        mobile: '[data-testid="legal-hub"]',
      },
      prototype: NONE,
    },
    {
      id: "legal-doc",
      title:
        "/legal/privacy-policy in the student token set; body text 16px, nothing below 14px",
      persona: "signed-out",
      route: "/legal/privacy-policy",
      waitFor: {
        desktop: '[data-testid="legal-document"]',
        mobile: '[data-testid="legal-document"]',
      },
      prototype: NONE,
    },
  ],
};
