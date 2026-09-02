import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function read(filePath: string): string {
  return fs.readFileSync(path.join(repoRoot, filePath), "utf8");
}

describe("Premium CTA wiring contract", () => {
  it('removes dead "/" upgrade links from known premium lock surfaces', () => {
    const dashboard = read("client/src/pages/lyceon-dashboard.tsx");
    const mastery = read("client/src/pages/mastery.tsx");
    const projection = read(
      "client/src/components/progress/ScoreProjectionCard.tsx",
    );

    expect(dashboard).not.toContain('Link href="/"');
    expect(mastery).not.toContain('href="/"');
    expect(projection).not.toContain('href="/"');
  });

  it("routes premium lock surfaces to canonical /upgrade flow", () => {
    const dashboard = read("client/src/pages/lyceon-dashboard.tsx");
    const mastery = read("client/src/pages/mastery.tsx");
    const projection = read(
      "client/src/components/progress/ScoreProjectionCard.tsx",
    );

    expect(dashboard).toContain('setLocation("/upgrade")');
    expect(mastery).toContain('navigate("/upgrade")');
    expect(projection).toContain('navigate("/upgrade")');
    expect(dashboard).not.toContain("startSubscriptionCheckout('monthly')");
    expect(mastery).not.toContain("startSubscriptionCheckout('monthly')");
    expect(projection).not.toContain('startSubscriptionCheckout("monthly")');
  });

  it("wires UserProfile billing tab to canonical billing status + portal/upgrade actions", () => {
    const userProfile = read("client/src/pages/UserProfile.tsx");

    expect(userProfile).toContain("queryKey: ['/api/billing/status']");
    expect(userProfile).toContain("openBillingPortal");
    expect(userProfile).toContain("navigate('/upgrade')");
    expect(userProfile).toContain("Manage Subscription");
    expect(userProfile).toContain("View Plans");
  });

  it("registers the canonical /upgrade route", () => {
    const appRouter = read("client/src/App.tsx");
    const upgradePage = read("client/src/pages/upgrade.tsx");

    expect(appRouter).toContain('path="/upgrade"');
    expect(upgradePage).toContain("upgrade-plan-monthly");
    expect(upgradePage).toContain("upgrade-plan-quarterly");
    expect(upgradePage).toContain("upgrade-plan-yearly");
  });

  it("routes entitlement denials through premium prompt UX on key premium surfaces", () => {
    const chat = read("client/src/pages/chat.tsx");
    const calendar = read("client/src/pages/calendar.tsx");
    const fullTest = read("client/src/pages/full-test.tsx");

    expect(chat).toContain("PremiumUpgradePrompt");
    expect(chat).toContain("mapTutorErrorToPremiumReason");
    expect(calendar).toContain("PremiumUpgradePrompt");
    expect(calendar).toContain("getPremiumDenialReason");
    expect(fullTest).toContain("PremiumUpgradePrompt");
    expect(fullTest).toContain("getPremiumDenialReason");
  });

  it("keeps the guardian purchase surface wired, and OUT of the access gate", () => {
    const purchaseCard = read(
      "client/src/components/guardian/GuardianPurchaseCard.tsx",
    );
    const guardianPaywall = read(
      "client/src/components/guardian/SubscriptionPaywall.tsx",
    );

    // The surface exists, on the card, with the shared plans helper.
    expect(purchaseCard).toContain("getBillingPlans");
    expect(purchaseCard).toContain('data-testid="student-picker"');
    expect(purchaseCard).toContain('data-testid="student-select"');

    /**
     * Still the SHARED checkout helper, and the selected subject must travel
     * IN THAT CALL. `[^;]*` cannot cross a statement boundary, so both
     * fragments must occur within the same statement — the call itself. Two
     * independent `toContain`s would pass just as happily with the helper
     * called bare in one place and `studentProfileId` sitting in a comment
     * elsewhere, which reads as a co-location check and is not one.
     */
    expect(purchaseCard).toMatch(
      /startSubscriptionCheckout\([^;]*studentProfileId:\s*selectedStudentId/,
    );

    /**
     * AND THE PART THAT IS A REGRESSION TEST, NOT A WIRING TEST.
     *
     * The picker used to live in `SubscriptionPaywall`, which renders only
     * while the guardian LACKS access. §31.3's fold grants access as soon as
     * any one linked student is premium, so paying for the first child deleted
     * the only way to pay for the second. Asserting the paywall no longer
     * carries a picker is what stops it being put back there.
     */
    expect(guardianPaywall).not.toContain('data-testid="student-select"');
    expect(guardianPaywall).not.toContain("startSubscriptionCheckout");

    // The portal path stays where it belongs, and keeps its failed-payment
    // branch. Asserted without the surrounding quotes: prettier owns quote
    // style, and pinning it here would make a formatter run look like a
    // behaviour change.
    expect(guardianPaywall).toContain("/api/billing/portal");
    expect(guardianPaywall).toContain("needsPaymentUpdate");
  });

  /**
   * A GUARDIAN MUST LAND SOMEWHERE THEIR ROLE CAN LOAD.
   *
   * `/dashboard` is `RequireRole allow={["student","admin"]}`, so an
   * unconditional `success_url` of `/dashboard` sent a guardian who had just
   * paid to a role denial — money moved, entitlement landed, payer shown a
   * wall — and left the `?checkout=success` polling in `SubscriptionPaywall`
   * unreachable, since that component only ever wraps `/guardian`.
   *
   * Asserted on the source rather than by driving Stripe: the branch is one
   * expression, and what can regress is someone flattening it back to a
   * literal.
   */
  it("returns a paying guardian to /guardian, not the student dashboard", () => {
    const billingRoutes = read("server/routes/billing-routes.ts");
    const appRoutes = read("client/src/App.tsx");

    // The premise: /dashboard really is closed to guardians.
    expect(appRoutes).toMatch(
      /path="\/dashboard"[\s\S]{0,200}allow=\{\["student", "admin"\]\}/,
    );

    /**
     * So the redirect must branch on who paid — and the bound is `[^,]`, not
     * `[^;]`. These are OBJECT PROPERTIES, comma-separated, so `[^;]*` runs
     * straight past `success_url` into `cancel_url`: with the guardian branch
     * removed from success_url alone, a `[^;]` form still matched through the
     * neighbouring property and reported green. Observed, not theorised — the
     * first version of this assertion survived exactly that plant.
     */
    expect(billingRoutes).toMatch(/success_url:[^,]*isGuardian[^,]*guardian/);
    expect(billingRoutes).toMatch(/cancel_url:[^,]*isGuardian[^,]*guardian/);
  });
});
