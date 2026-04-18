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

  it('routes premium lock surfaces through shared checkout helper', () => {
    const dashboard = read('client/src/pages/lyceon-dashboard.tsx');
    const mastery = read('client/src/pages/mastery.tsx');
    const projection = read('client/src/components/progress/ScoreProjectionCard.tsx');

    expect(dashboard).toContain("startSubscriptionCheckout('monthly')");
    expect(mastery).toContain("startSubscriptionCheckout('monthly')");
    expect(projection).toContain('startSubscriptionCheckout("monthly")');
  });

  it('wires UserProfile billing tab to canonical billing status + portal/checkout actions', () => {
    const userProfile = read('client/src/pages/UserProfile.tsx');

    expect(userProfile).toContain("queryKey: ['/api/billing/status']");
    expect(userProfile).toContain('openBillingPortal');
    expect(userProfile).toContain('startSubscriptionCheckout');
    expect(userProfile).toContain('Manage Subscription');
    expect(userProfile).toContain('Upgrade');
  });
});
