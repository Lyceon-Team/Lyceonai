/**
 * "Diagnostic" → "Find your blind spots": in the app, and only in the app.
 *
 * @spec [owner brief "Student dashboard — Getting started checklist + onboarding update" (final
 *       brief v2, Karl, 2026-10-13) §7 ("'Diagnostic' becomes 'Find your blind spots', subtitle
 *       '40 questions · about 40 minutes' … in-app: Home, Practice, the checklist, the free Home
 *       header, 'How Lyceon works', the right-panel note, session labels, start/error/loading
 *       messages, the Resume page, the upgrade plan copy. The public homepage and articles are
 *       unchanged. Internal names, routes and events are unchanged.")] | @implemented [2026-10-13]
 *
 * plain English: each in-app surface takes the name from the one constant (so none can drift
 * back to "Diagnostic" alone), the public pages still say "free diagnostic", and the route the
 * public CTA points at is unchanged. Each surface's own test asserts the rendered words.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BLIND_SPOTS_NAME,
  blindSpotsSubtitle,
} from "../../client/src/lib/blind-spots-copy";
import { START_DIAGNOSTIC_HREF } from "../../client/src/lib/marketing-links";

const read = (p: string): string =>
  readFileSync(join(process.cwd(), p), "utf8");

const IN_APP = [
  "client/src/components/home/DiagnosticCard.tsx",
  "client/src/components/home/FreeHome.tsx",
  "client/src/components/home/GettingStartedCard.tsx",
  "client/src/components/home/HomePanel.tsx",
  "client/src/components/home/home-model.ts",
  "client/src/components/practice/BlindSpotsRow.tsx",
  "client/src/hooks/useDiagnosticStart.ts",
  "client/src/lib/plan-copy.ts",
  "client/src/lib/review-session-picker.ts",
  "client/src/pages/diagnostic-start.tsx",
  "client/src/pages/resume-practice.tsx",
] as const;

const PUBLIC = [
  "client/src/pages/home.tsx",
  "client/src/components/content/ContentArticle.tsx",
] as const;

describe("the new name", () => {
  it("is 'Find your blind spots', with '40 questions · about 40 minutes'", () => {
    expect(BLIND_SPOTS_NAME).toBe("Find your blind spots");
    expect(blindSpotsSubtitle(40)).toBe("40 questions · about 40 minutes");
  });

  it.each(IN_APP)("%s takes the name from the one constant", (file) => {
    expect(read(file)).toMatch(/\bBLIND_SPOTS_NAME\b/);
  });
});

describe("the public pages are unchanged", () => {
  it.each(PUBLIC)("%s still says 'Start the free diagnostic'", (file) => {
    const src = read(file);
    expect(src).toContain("Start the free diagnostic");
    expect(src).not.toContain("blind-spots-copy");
    expect(src).not.toContain("Find your blind spots");
  });

  it("the public CTA's route is unchanged", () => {
    const cta = new URL(START_DIAGNOSTIC_HREF, "https://app.example");
    expect(cta.searchParams.get("next")).toBe("/practice/diagnostic");
    expect(read("client/src/App.tsx")).toContain('path="/practice/diagnostic"');
  });
});
