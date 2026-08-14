import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("Feedback UX hardening contract", () => {
  it("uses shared recovery/session notices on key customer surfaces", () => {
    const chat = read("client/src/pages/chat.tsx");
    const calendar = read("client/src/pages/calendar.tsx");
    const fullTest = read("client/src/pages/full-test.tsx");
    const userProfile = read("client/src/pages/UserProfile.tsx");
    const guardianPaywall = read(
      "client/src/components/guardian/SubscriptionPaywall.tsx",
    );

    expect(chat).toContain("RecoveryNotice");
    expect(chat).toContain("SessionNotice");
    expect(calendar).toContain("RecoveryNotice");
    expect(calendar).toContain("SessionNotice");
    expect(fullTest).toContain("RecoveryNotice");
    expect(fullTest).toContain("SessionNotice");
    expect(userProfile).toContain("RecoveryNotice");
    expect(userProfile).toContain("SessionNotice");
    expect(guardianPaywall).toContain("RecoveryNotice");
    expect(guardianPaywall).toContain("SessionNotice");
  });

  it("keeps premium denials routed through conversion UX", () => {
    const chat = read("client/src/pages/chat.tsx");
    const calendar = read("client/src/pages/calendar.tsx");
    const fullTest = read("client/src/pages/full-test.tsx");
    const dashboard = read("client/src/pages/lyceon-dashboard.tsx");
    const mastery = read("client/src/pages/mastery.tsx");

    expect(chat).toContain("PremiumUpgradePrompt");
    expect(calendar).toContain("PremiumUpgradePrompt");
    expect(fullTest).toContain("PremiumUpgradePrompt");
    expect(dashboard).toContain("EmptyStateCTA");
    expect(mastery).toContain("EmptyStateCTA");
  });

  /**
   * Intent: ban destructive/alarming red (error banners, alert borders) on
   * customer surfaces. Semantic difficulty colors (easy=green, medium=amber,
   * hard=red) are a universal convention and are NOT destructive — they are
   * allowed, but ONLY inside the Hard difficulty configuration object in
   * practice.tsx's DIFFICULTY_OPTIONS array. Red classes anywhere else in any
   * audited file — including the same class combination — must still fail.
   */
  it("removes destructive alert variants from audited customer surfaces", () => {
    const auditedFiles = [
      "client/src/pages/chat.tsx",
      "client/src/pages/calendar.tsx",
      "client/src/pages/full-test.tsx",
      "client/src/pages/lyceon-dashboard.tsx",
      "client/src/pages/mastery.tsx",
      "client/src/pages/practice.tsx",
      "client/src/pages/UserProfile.tsx",
      "client/src/components/guardian/SubscriptionPaywall.tsx",
    ];

    // Regex matching the Hard difficulty config object within DIFFICULTY_OPTIONS.
    // Scoped to the value:"hard" entry — NOT a global class-string strip.
    const HARD_DIFFICULTY_CONFIG =
      /\{\s*value:\s*"hard",\s*label:\s*"Hard",\s*color:\s*\n?\s*"border-red-300 text-red-700 bg-red-50 hover:bg-red-100",?\s*\}/;

    for (const file of auditedFiles) {
      const source = read(file);
      expect(source).not.toContain('variant="destructive"');
      expect(source).not.toContain('variant: "destructive"');
      expect(source).not.toContain("variant: 'destructive'");

      let sanitized = source;

      // Exemption scoped to practice.tsx ONLY — the Hard difficulty config
      // is a semantic color convention, not destructive UX. All other audited
      // files receive NO red exemption whatsoever.
      if (file === "client/src/pages/practice.tsx") {
        // Assert the Hard config exists (so removal is meaningful)
        expect(source).toMatch(HARD_DIFFICULTY_CONFIG);
        // Remove only the matched config object for red-class checking
        sanitized = sanitized.replace(
          HARD_DIFFICULTY_CONFIG,
          "/* HARD_STRIPPED */",
        );
      }

      expect(sanitized).not.toContain("bg-red-");
      expect(sanitized).not.toContain("text-red-");
      expect(sanitized).not.toContain("border-red-");
    }
  });

  /**
   * Intent: prove the Hard-difficulty exemption is scoped to the config
   * object, not the class values globally. The same red class combination
   * used outside DIFFICULTY_OPTIONS must still be caught.
   *
   * Mutation: inject a destructive element with the identical red classes
   * into practice.tsx, strip the legitimate Hard config, and assert the
   * injected red is still detected.
   */
  it("Hard-difficulty red exemption does not mask destructive red elsewhere", () => {
    const practice = read("client/src/pages/practice.tsx");

    const HARD_DIFFICULTY_CONFIG =
      /\{\s*value:\s*"hard",\s*label:\s*"Hard",\s*color:\s*\n?\s*"border-red-300 text-red-700 bg-red-50 hover:bg-red-100",?\s*\}/;

    // Inject a fake destructive element with the exact same red classes
    const mutated =
      practice +
      '\n<div className="border-red-300 text-red-700 bg-red-50">Error!</div>';

    // Strip the legitimate Hard config (same as the main test does)
    const sanitized = mutated.replace(
      HARD_DIFFICULTY_CONFIG,
      "/* HARD_STRIPPED */",
    );

    // The injected destructive red must still be detected — proving the
    // exemption is config-scoped, not a global class-string erasure
    expect(sanitized).toContain("bg-red-");
    expect(sanitized).toContain("text-red-");
    expect(sanitized).toContain("border-red-");
  });

  it("preserves structured API errors in guardian subscription paywall", () => {
    const guardianPaywall = read(
      "client/src/components/guardian/SubscriptionPaywall.tsx",
    );
    expect(guardianPaywall).toContain("parseApiErrorFromResponse");
    expect(guardianPaywall).not.toContain("throw new Error(data.error");
  });
});
