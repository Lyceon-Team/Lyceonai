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
    const guardianPaywall = read("client/src/components/guardian/SubscriptionPaywall.tsx");

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

    // Semantic difficulty colors (easy=green, medium=amber, hard=red) are
    // allowed — the ban targets destructive/alarming red on errors and alerts,
    // not conventional difficulty-level semantics.
    const SEMANTIC_RED_ALLOWLIST = [
      // Difficulty pill config in practice.tsx
      "border-red-300 text-red-700 bg-red-50 hover:bg-red-100",
    ];

    for (const file of auditedFiles) {
      const source = read(file);
      expect(source).not.toContain('variant="destructive"');
      expect(source).not.toContain("variant: \"destructive\"");
      expect(source).not.toContain("variant: 'destructive'");

      // Strip allowlisted semantic patterns before checking for red classes,
      // so legitimate difficulty colors don't trip the destructive-red ban.
      let sanitized = source;
      for (const allowed of SEMANTIC_RED_ALLOWLIST) {
        sanitized = sanitized.replaceAll(allowed, "");
      }
      expect(sanitized).not.toContain("bg-red-");
      expect(sanitized).not.toContain("text-red-");
      expect(sanitized).not.toContain("border-red-");
    }
  });

  it("preserves structured API errors in guardian subscription paywall", () => {
    const guardianPaywall = read("client/src/components/guardian/SubscriptionPaywall.tsx");
    expect(guardianPaywall).toContain("parseApiErrorFromResponse");
    expect(guardianPaywall).not.toContain("throw new Error(data.error");
  });
});
