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
      "client/src/pages/UserProfile.tsx",
      "client/src/components/guardian/SubscriptionPaywall.tsx",
    ];

    for (const file of auditedFiles) {
      const source = read(file);
      expect(source).not.toContain('variant="destructive"');
      expect(source).not.toContain("variant: \"destructive\"");
      expect(source).not.toContain("variant: 'destructive'");
      expect(source).not.toContain("bg-red-");
      expect(source).not.toContain("text-red-");
      expect(source).not.toContain("border-red-");
    }
  });

  it("preserves structured API errors in guardian subscription paywall", () => {
    const guardianPaywall = read("client/src/components/guardian/SubscriptionPaywall.tsx");
    expect(guardianPaywall).toContain("parseApiErrorFromResponse");
    expect(guardianPaywall).not.toContain("throw new Error(data.error");
  });
});
