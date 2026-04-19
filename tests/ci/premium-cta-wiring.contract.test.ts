import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function read(filePath: string): string {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

describe('Premium CTA wiring contract', () => {
  it('removes dead "/" upgrade links from known premium lock surfaces', () => {
    const dashboard = read('client/src/pages/lyceon-dashboard.tsx');
    const mastery = read('client/src/pages/mastery.tsx');
    const projection = read('client/src/components/progress/ScoreProjectionCard.tsx');

    expect(dashboard).not.toContain('Link href="/"');
    expect(mastery).not.toContain('href="/"');
    expect(projection).not.toContain('href="/"');
  });

  it('routes premium lock surfaces to canonical /upgrade flow', () => {
    const dashboard = read('client/src/pages/lyceon-dashboard.tsx');
    const mastery = read('client/src/pages/mastery.tsx');
    const projection = read('client/src/components/progress/ScoreProjectionCard.tsx');

    expect(dashboard).toContain('setLocation("/upgrade")');
    expect(mastery).toContain('navigate("/upgrade")');
    expect(projection).toContain('navigate("/upgrade")');
    expect(dashboard).not.toContain("startSubscriptionCheckout('monthly')");
    expect(mastery).not.toContain("startSubscriptionCheckout('monthly')");
    expect(projection).not.toContain('startSubscriptionCheckout("monthly")');
  });

  it('wires UserProfile billing tab to canonical billing status + portal/upgrade actions', () => {
    const userProfile = read('client/src/pages/UserProfile.tsx');

    expect(userProfile).toContain("queryKey: ['/api/billing/status']");
    expect(userProfile).toContain('openBillingPortal');
    expect(userProfile).toContain("navigate('/upgrade')");
    expect(userProfile).toContain('Manage Subscription');
    expect(userProfile).toContain('View Plans');
  });

  it('registers the canonical /upgrade route', () => {
    const appRouter = read('client/src/App.tsx');
    const upgradePage = read('client/src/pages/upgrade.tsx');

    expect(appRouter).toContain('path="/upgrade"');
    expect(upgradePage).toContain('upgrade-plan-monthly');
    expect(upgradePage).toContain('upgrade-plan-quarterly');
    expect(upgradePage).toContain('upgrade-plan-yearly');
  });

  it('routes entitlement denials through premium prompt UX on key premium surfaces', () => {
    const chat = read('client/src/pages/chat.tsx');
    const calendar = read('client/src/pages/calendar.tsx');
    const fullTest = read('client/src/pages/full-test.tsx');

    expect(chat).toContain('PremiumUpgradePrompt');
    expect(chat).toContain('mapTutorErrorToPremiumReason');
    expect(calendar).toContain('PremiumUpgradePrompt');
    expect(calendar).toContain('getPremiumDenialReason');
    expect(fullTest).toContain('PremiumUpgradePrompt');
    expect(fullTest).toContain('getPremiumDenialReason');
  });

  it('keeps guardian selector parity-safe on shared plans/checkout and existing portal path', () => {
    const guardianPaywall = read('client/src/components/guardian/SubscriptionPaywall.tsx');

    expect(guardianPaywall).toContain('getBillingPlans');
    expect(guardianPaywall).toContain('startSubscriptionCheckout(plan)');
    expect(guardianPaywall).toContain("'/api/billing/portal'");
    expect(guardianPaywall).toContain('needsPaymentUpdate');
    expect(guardianPaywall).toContain('TODO(billing): Guardian selector is legacy');
  });
});
