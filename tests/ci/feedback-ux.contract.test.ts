import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("Feedback UX hardening contract", () => {
  it("uses shared recovery/session notices on key customer surfaces", () => {
    // E1 exam deletion ruling, 2026-09-23: pre-baseline full-length runtime removed
    // pending Doc 04 rebuild. client/src/pages/full-test.tsx is deleted, so its two
    // RecoveryNotice/SessionNotice assertions go; UserProfile's are unchanged.
    const userProfile = read("client/src/pages/UserProfile.tsx");

    // chat.tsx: behavioral render test in
    // client/src/pages/chat.error-rendering.contract.test.tsx proves the
    // property directly (errors render through structured notice, raw
    // server text never surfaces). No static name-matching needed.
    expect(userProfile).toContain("RecoveryNotice");
    expect(userProfile).toContain("SessionNotice");
    /**
     * NOT the paywall any more. `SubscriptionPaywall` (renamed
     * `CheckoutReturnPoller` on 2026-09-03) was rescoped on
     * 2026-09-02 to a pure access gate: it renders a spinner, a failed-payment
     * card, or its children, and surfaces no billing error of its own — so
     * asserting a notice component there would pin an import that nothing
     * renders. The guardian surface that CAN fail in front of a user is the
     * purchase card's checkout call, and that is where the structured notice
     * now has to be.
     */
    const purchaseCard = read(
      "client/src/components/guardian/GuardianPurchaseCard.tsx",
    );
    expect(purchaseCard).toContain("AppNotice");
    expect(purchaseCard).not.toMatch(/\{\s*checkoutError\s*\}\s*<\//);
  });

  /**
   * ONE CTA COMPONENT, every paid boundary — owner ruling 2026-09-03 §3.
   *
   * This used to accept `EmptyStateCTA` on two of the five surfaces, which is
   * how two shapes for one message survived: `EmptyStateCTA` takes an
   * `onAction` callback, so each caller hardcoded its own destination, and one
   * of those destinations (`/upgrade`) is a route a guardian's role is bounced
   * from. The component is deleted; the assertion now names one component
   * everywhere, and the practice surface — whose quota block was a fourth
   * inline shape — is in the list.
   */
  it("routes every premium denial through the one CTA component", () => {
    // UI-56 (2026-10-03): chat leaves this list, as Home did under UI-50. Its one paid
    // boundary is the locked state, whose "Unlock LISA" opens the app's one upgrade modal
    // (UI-44; DESIGN.md §3) in place; a server refusal draws the same state. The in-review
    // panel still draws `LisaUpgradeCard`, which is the one CTA component with LISA's pitch.
    const chat = read("client/src/pages/chat.tsx");
    expect(chat).toMatch(/upgrade\.open\("tutor_access", "plan"\)/);
    expect(chat).toMatch(/if \(denied\) return <LisaLocked reason="plan" \/>;/);
    expect(chat).not.toContain("<LisaUpgradeCard");
    expect(read("client/src/components/tutor/ScopedTutorPanel.tsx")).toContain(
      "<LisaUpgradeCard />",
    );
    const surfaces = [
      "client/src/components/tutor/LisaUpgradeCard.tsx",
      // E1 exam deletion ruling, 2026-09-23: pre-baseline full-length runtime removed
      // pending Doc 04 rebuild. client/src/pages/full-test.tsx is deleted, so it leaves
      // this list; every remaining surface keeps the same assertion.
      // UI-50 (2026-10-03): Home leaves this list. Its one paid boundary is the locked mastery
      // card, which opens the app's one upgrade modal (UI-44; DESIGN.md §3) in place.
      // UI-57 (2026-10-03): Mastery leaves it too, for the same reason (asserted below).
      "client/src/pages/practice.tsx",
    ];
    for (const surface of surfaces) {
      expect(read(surface), surface).toContain("PremiumUpgradePrompt");
    }
    const home = read("client/src/components/home/FreeHome.tsx");
    expect(home).toContain("<LockedMasteryCard");
    expect(home).toMatch(/upgrade\.open\("mastery_detail", masteryLock\)/);
    // Comments stripped: the page's header names the component it replaced.
    const mastery = read("client/src/pages/mastery.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(mastery).toContain("<LockedMasteryCard");
    expect(mastery).toMatch(/upgrade\.open\("mastery_detail", lockReason\)/);
    expect(mastery).not.toContain("PremiumUpgradePrompt");
  });

  /**
   * The destination is a pure function of the role, in ONE place.
   *
   * A surface that writes `/upgrade` itself is the defect this closes:
   * `App.tsx` registers `/upgrade` as `RequireRole allow={["student","admin"]}`,
   * so a guardian pressing such a control is bounced by `RequireRole` and
   * nothing happens. `resolveCtaDestination` is the only sanctioned source of
   * that string outside the route registry and the resolver's own tests.
   */
  it("lets no surface name a billing route for itself", () => {
    const surfaces = [
      "client/src/pages/chat.tsx",
      "client/src/components/tutor/LisaUpgradeCard.tsx",
      "client/src/components/tutor/ScopedTutorPanel.tsx",
      // E1 exam deletion ruling, 2026-09-23: pre-baseline full-length runtime removed
      // pending Doc 04 rebuild. client/src/pages/full-test.tsx is deleted, so it leaves
      // this list; every remaining surface keeps the same assertion.
      "client/src/pages/lyceon-dashboard.tsx",
      "client/src/pages/mastery.tsx",
      "client/src/pages/practice.tsx",
      "client/src/pages/UserProfile.tsx",
      "client/src/components/billing/PremiumUpgradePrompt.tsx",
    ];
    for (const surface of surfaces) {
      /**
       * COMMENTS ARE STRIPPED FIRST, and that is load-bearing rather than
       * fussy. Every file below EXPLAINS why it no longer names the route, and
       * a scanner that cannot tell prose from code would have forced those
       * explanations to be deleted to go green — trading the record of a defect
       * for a passing grep.
       */
      const code = read(surface)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(code, `${surface} hardcodes /upgrade`).not.toMatch(
        /["'`]\/upgrade["'`]/,
      );
    }
  });

  /**
   * Intent: ban destructive/alarming red (error banners, alert borders) on
   * customer surfaces. Until UI-51 the one exemption was the Hard difficulty
   * pill colours in practice.tsx's DIFFICULTY_OPTIONS. UI-51 (2026-10-03)
   * rebuilt Practice on the shared filter bar, which draws difficulty with the
   * student tokens and no colour per level, so the exemption is gone and every
   * audited file, practice.tsx included, gets none.
   */
  const RED_CLASSES = ["bg-red-", "text-red-", "border-red-"] as const;

  function destructiveFindings(source: string): string[] {
    const findings: string[] = [];
    for (const variant of [
      'variant="destructive"',
      'variant: "destructive"',
      "variant: 'destructive'",
    ]) {
      if (source.includes(variant)) findings.push(variant);
    }
    for (const red of RED_CLASSES) {
      if (source.includes(red)) findings.push(red);
    }
    return findings;
  }

  it("removes destructive alert variants from audited customer surfaces", () => {
    const auditedFiles = [
      "client/src/pages/chat.tsx",
      // E1 exam deletion ruling, 2026-09-23: pre-baseline full-length runtime removed
      // pending Doc 04 rebuild. client/src/pages/full-test.tsx is deleted, so it leaves
      // this list; every remaining surface keeps the same assertion.
      "client/src/pages/lyceon-dashboard.tsx",
      "client/src/pages/mastery.tsx",
      "client/src/pages/practice.tsx",
      "client/src/pages/UserProfile.tsx",
      "client/src/components/guardian/CheckoutReturnPoller.tsx",
    ];
    for (const file of auditedFiles) {
      expect(destructiveFindings(read(file)), file).toEqual([]);
    }
  });

  /**
   * Mutation: the same check on practice.tsx with a destructive element added
   * back (the exact red classes the old Hard pill used) must report each class,
   * so the check above passing on practice.tsx is the absence of red, not a
   * check that cannot see it.
   */
  it("finds destructive red injected into practice.tsx", () => {
    const practice = read("client/src/pages/practice.tsx");
    expect(destructiveFindings(practice)).toEqual([]);
    const mutated =
      practice +
      '\n<div className="border-red-300 text-red-700 bg-red-50">Error!</div>';
    expect(destructiveFindings(mutated)).toEqual([...RED_CLASSES]);
  });

  it("preserves structured API errors in guardian subscription paywall", () => {
    // G4-09: the poller reads billing status through the one shared reader, which is where
    // the structured parse now lives.
    const guardianPaywall = read(
      "client/src/components/guardian/CheckoutReturnPoller.tsx",
    );
    // UI-14 (2026-09-29): the poller reads billing status through the one
    // shared hook, and the structured-error parse moved there with the fetch.
    const billingStatusHook = read("client/src/hooks/useBillingStatusQuery.ts");
    expect(guardianPaywall).toContain("useBillingStatusQuery");
    expect(billingStatusHook).toContain("parseApiErrorFromResponse");
    expect(guardianPaywall).not.toContain("throw new Error(data.error");
    expect(billingStatusHook).not.toContain("throw new Error(data.error");
  });
});
