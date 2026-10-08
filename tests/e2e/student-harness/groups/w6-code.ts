/**
 * Wave 6 close-out, rows UI-65 and UI-66: the before/after captures.
 *
 * @spec [student-UI register §6 Wave 6: UI-65 (OQ-52 (c), owner ruling 2026-10-05: the
 *        Practice daily-limit card onto student tokens), UI-66 (OQ-53 (e), owner ruling
 *        2026-10-05: print the canonical session criteria on Practice and Home recent rows);
 *        DESIGN.md §1 (tokens, 14px floor, light and dark)] | @implemented [2026-10-08]
 *
 * plain English: two groups, one per row, at 1440, 1024 and 390, light and dark.
 *   - W6-UI-65: Practice for the free student at 0 questions left today, where the billing card
 *     (`PremiumUpgradePrompt`) is drawn.
 *   - W6-UI-66: the paid student's Home and Practice with the "review-history" seed, whose
 *     sessions were each started with a section and a domain, so the recent rows have criteria.
 *
 * The runs write under `test-results/student-harness/wave6/` (git-ignored); the PNGs and index
 * are copied into `docs/plans/student-ui/evidence/wave6/<row>/{before,after}/` by hand, because a
 * run replaces its whole output directory and would delete the other half of the pair.
 */
import { practiceQuotaSchema } from "@lyceon/shared/practice-quota";
import type { ExtraViewport, PageGroup } from "./types";

const W1024: readonly ExtraViewport[] = [
  { name: "w1024", width: 1024, height: 768, selectors: "desktop" },
];

const OUT_ROOT = "test-results/student-harness/wave6";

const NOT_PROTOTYPED =
  "Not compared with a prototype: a before/after pair for one row.";

/** The free quota at zero, built by the shared schema the page parses with. */
const QUOTA_OUT = practiceQuotaSchema.parse({
  unlimited: false,
  limit: 40,
  remaining: 0,
  resetAt: "2026-10-09T05:00:00.000Z",
});

export const W6_UI_65: PageGroup = {
  id: "W6-UI-65",
  title:
    "W6 UI-65 Practice, free, 0 questions left today: the daily-limit billing card (1440, 1024, 390; light and dark)",
  outRoot: OUT_ROOT,
  shots: [
    {
      id: "practice-free-quota-out",
      title:
        "Practice, free, 0 left today: Start disabled, the daily-limit card under it",
      persona: "free",
      route: "/practice",
      waitFor: {
        desktop: '[data-testid="premium-upgrade-prompt"]',
        mobile: '[data-testid="premium-upgrade-prompt"]',
      },
      fulfillRequest: {
        method: "GET",
        path: "/api/practice/quota",
        body: QUOTA_OUT,
        reason:
          "The free persona's real quota has questions left after the base seed; answering the rest through the real routes before every capture would spend them across shots. The body is built by the shared `practiceQuotaSchema` with `remaining: 0`, the value the real route returns exactly when the serve route answers 402.",
      },
      // The card sits under the fold on a phone; the whole document shows it.
      fullPage: true,
      extraViewports: W1024,
      prototype: { kind: "none", reason: NOT_PROTOTYPED },
    },
  ],
};

export const W6_UI_66: PageGroup = {
  id: "W6-UI-66",
  title:
    "W6 UI-66 Home and Practice, paid: recent-session rows named by their criteria (1440, 1024, 390; light and dark)",
  outRoot: OUT_ROOT,
  seed: "review-history",
  shots: [
    {
      id: "home-paid-recent",
      title: "Home, paid: Recent sessions in the right panel",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="home-recent-row"]',
        mobile: '[data-testid="home-recent-row"]',
      },
      fullPage: true,
      extraViewports: W1024,
      prototype: { kind: "none", reason: NOT_PROTOTYPED },
    },
    {
      id: "practice-paid-recent",
      title: "Practice, paid: Recent practice",
      persona: "paid",
      route: "/practice",
      waitFor: {
        desktop: '[data-testid="practice-recent-row"]',
        mobile: '[data-testid="practice-recent-row"]',
      },
      fullPage: true,
      extraViewports: W1024,
      prototype: { kind: "none", reason: NOT_PROTOTYPED },
    },
  ],
};
