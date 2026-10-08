/**
 * OQ-68 (a): the before/after captures of the retired topic browser.
 *
 * @spec [OQ-68 (a) (Karl, 2026-10-08): "/practice/topics is retired, with a redirect to
 *        /practice"] | @implemented [2026-10-08]
 *
 * plain English: the paid student opens `/practice/topics` at 1440, 1024 and 390, light and dark.
 * Before the change it drew the topic browser (pinned light, OQ-49); after it, the address
 * replaces itself with `/practice`. The path the page landed on is printed under each shot.
 *
 * The run writes under `test-results/student-harness/wave6/` (git-ignored); the PNGs and index are
 * copied into `docs/plans/student-ui/evidence/wave6/OQ-68a/{before,after}/` by hand, because a
 * run replaces its whole output directory and would delete the other half of the pair.
 */
import type { ExtraViewport, PageGroup } from "./types";

const W1024: readonly ExtraViewport[] = [
  { name: "w1024", width: 1024, height: 768, selectors: "desktop" },
];

export const W6_OQ_68A: PageGroup = {
  id: "W6-OQ-68a",
  title:
    "OQ-68 (a) /practice/topics, paid: the retired topic browser and its redirect to Practice (1440, 1024, 390; light and dark)",
  outRoot: "test-results/student-harness/wave6",
  shots: [
    {
      id: "practice-topics-paid",
      title:
        "/practice/topics, paid: before, the topic browser; after, Practice (history replace)",
      persona: "paid",
      route: "/practice/topics",
      waitFor: {
        desktop: '[data-testid="app-rail"]',
        mobile: '[data-testid="app-tab-bar"]',
      },
      // Either half of the pair: the browser before the change, Practice after it.
      expectPath: "^/practice(/topics)?$",
      extraViewports: W1024,
      prototype: {
        kind: "none",
        reason:
          "Not compared with a prototype: a before/after pair for one ruling.",
      },
    },
  ],
};
