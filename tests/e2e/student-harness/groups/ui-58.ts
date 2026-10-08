/**
 * UI-58: Settings (`/profile`), Help, Notifications and the plans page (`/upgrade`), and the click
 * paths into them.
 *
 * @spec [student-UI register §6 Wave 5 UI-58; DESIGN.md §4 Settings, §4 Help, §4 "Not
 *        prototyped" (Notifications; the upgrade/plans page — build to the shell spec and send
 *        Karl screenshots before merge); OQ-4 (390px, light and dark); OQ-46 (Help from the
 *        rail); UI-S7 / F-40 (Billing's three states)] | @implemented [2026-10-03]
 *
 * plain English: Settings is shot section by section beside `Settings.dc.html` clicked to the same
 * section, for the paid student (a Stripe-less self-paid entitlement: Billing reads `self`), the
 * free student (no entitlement row) and the guardian-managed student (`managed`: a subscription id
 * and no Stripe customer, so Billing reads `guardian`). Help pairs with `Help.dc.html`.
 * Notifications and the plans page have no prototype and are marked NOT PROTOTYPED. The plans
 * page's `GET /api/billing/plans` reads prices from Stripe, which the harness never calls, so the
 * browser answers it itself with a body built by the shared schema (illustrative prices, the
 * client test's own fixture amounts) and the index says so. Manage billing is never clicked (it
 * would open the portal). Click paths: a Settings section switch, and Help from the rail (the
 * avatar menu's Help at 390, where the rail is the tab bar).
 */
import { billingPlansResponseSchema } from "../../../../packages/shared/src/billing-schema";
import type { PageGroup, PrototypePairing, Shot, Step } from "./types";

function both(selector: string): Step {
  return { click: { desktop: selector, mobile: selector } };
}

const PAGE = {
  desktop: '[data-testid="settings-page"]',
  mobile: '[data-testid="settings-page"]',
} as const;

function protoSection(
  label: string,
  plan: "paid" | "free" | "guardian-paid",
  note: string,
): PrototypePairing {
  return {
    kind: "screen",
    file: "Settings.dc.html",
    plan,
    ...(label === "Profile"
      ? {}
      : {
          steps: [
            `nav[aria-label="Settings sections"] button:has-text("${label}")`,
          ],
          state: label.toLowerCase(),
        }),
    note,
  };
}

function section(args: {
  id: string;
  title: string;
  persona: "paid" | "free" | "managed";
  tab: string;
  ready: string;
  proto: PrototypePairing;
}): Shot {
  return {
    id: args.id,
    title: args.title,
    persona: args.persona,
    route: args.tab === "profile" ? "/profile" : `/profile?tab=${args.tab}`,
    waitFor: { desktop: args.ready, mobile: args.ready },
    fullPage: true,
    prototype: args.proto,
  };
}

/** Illustrative plan prices: `client/src/pages/upgrade.page.test.tsx`'s fixture amounts. */
const PLANS_BODY = billingPlansResponseSchema.parse({
  plans: [
    {
      plan: "monthly",
      label: "Monthly",
      amountCents: 9999,
      currency: "usd",
      intervalLabel: "per month",
      interval: "month",
      intervalCount: 1,
      stripePriceIdConfigured: true,
    },
    {
      plan: "quarterly",
      label: "Quarterly",
      amountCents: 19999,
      currency: "usd",
      intervalLabel: "per 3 months",
      interval: "month",
      intervalCount: 3,
      stripePriceIdConfigured: true,
    },
    {
      plan: "yearly",
      label: "Yearly",
      amountCents: 69999,
      currency: "usd",
      intervalLabel: "per year",
      interval: "year",
      intervalCount: 1,
      stripePriceIdConfigured: true,
    },
  ],
  requestId: "harness",
});

const NOT_PROTOTYPED =
  "NOT PROTOTYPED (DESIGN.md §4): built to the shell spec; these screenshots go to Karl before merge.";

export const UI_58: PageGroup = {
  id: "UI-58",
  title:
    "UI-58 Settings (each section; paid self-billing, free, guardian-managed), Help, Notifications and the plans page (both NOT PROTOTYPED); light and dark, 1440 and 390",
  seed: "calendar-goal",
  shots: [
    section({
      id: "settings-profile-paid",
      title:
        "Settings → Profile, paid: name, test date and target (a calendar profile exists, OQ-20); no About you (UI-S8)",
      persona: "paid",
      tab: "profile",
      ready: '[data-testid="settings-test-date"]',
      proto: protoSection(
        "Profile",
        "paid",
        "Settings, plan = paid, Profile (the canvas also draws About you, held by UI-S8)",
      ),
    }),
    section({
      id: "settings-profile-free",
      title:
        "Settings → Profile, free: name, and 'Set up your study calendar' (no calendar profile, OQ-20)",
      persona: "free",
      tab: "profile",
      ready: '[data-testid="settings-goal-setup"]',
      proto: protoSection("Profile", "free", "Settings, plan = free, Profile"),
    }),
    section({
      id: "settings-account-paid",
      title:
        "Settings → Account: email, sign-in method, Change password (current password required), Delete account",
      persona: "paid",
      tab: "account",
      ready: '[data-testid="settings-account"]',
      proto: protoSection(
        "Account",
        "paid",
        "Settings, plan = paid, Account clicked",
      ),
    }),
    section({
      id: "settings-guardian-paid",
      title:
        "Settings → Guardian, paid: the linked guardian, the OQ-38 sentence, the code with Copy, Get a new code and email",
      persona: "paid",
      tab: "guardian",
      ready: '[data-testid="student-link-code-value"]',
      proto: protoSection(
        "Guardian",
        "paid",
        "Settings, plan = paid, Guardian clicked (the canvas shows no guardian linked)",
      ),
    }),
    section({
      id: "settings-guardian-free",
      title: "Settings → Guardian, free: no guardian linked, and the code",
      persona: "free",
      tab: "guardian",
      ready: '[data-testid="student-link-code-value"]',
      proto: protoSection(
        "Guardian",
        "free",
        "Settings, plan = free, Guardian clicked",
      ),
    }),
    section({
      id: "settings-billing-paid",
      title:
        "Settings → Billing, paid and self-managed: the status and Manage billing (not clicked: it opens Stripe)",
      persona: "paid",
      tab: "billing",
      ready: '[data-testid="settings-billing-self"]',
      proto: protoSection(
        "Billing",
        "paid",
        "Settings, plan = paid, Billing clicked",
      ),
    }),
    section({
      id: "settings-billing-free",
      title: "Settings → Billing, free: the free plan and See plans",
      persona: "free",
      tab: "billing",
      ready: '[data-testid="settings-billing-free"]',
      proto: protoSection(
        "Billing",
        "free",
        "Settings, plan = free, Billing clicked",
      ),
    }),
    section({
      id: "settings-billing-managed",
      title:
        "Settings → Billing, guardian-managed (F-40): 'Managed by your guardian', no button",
      persona: "managed",
      tab: "billing",
      ready: '[data-testid="settings-billing-guardian"]',
      proto: protoSection(
        "Billing",
        "guardian-paid",
        "Settings, plan = guardian-paid, Billing clicked",
      ),
    }),
    section({
      id: "settings-appearance",
      title:
        "Settings → Appearance: Match device, Light, Dark (saved on this device); no Notifications section (OQ-27)",
      persona: "paid",
      tab: "appearance",
      ready: '[data-testid="settings-appearance"]',
      proto: protoSection(
        "Appearance",
        "paid",
        "Settings, plan = paid, Appearance clicked",
      ),
    }),
    {
      id: "click-settings-section",
      title:
        "Click path: Settings → choosing Billing in the section list shows Billing (the URL carries ?tab=billing)",
      persona: "paid",
      route: "/profile",
      waitFor: PAGE,
      steps: [both('[data-testid="settings-section-billing"]')],
      expectPath: "^/profile$",
      expectVisible: '[data-testid="settings-billing-self"]',
      prototype: {
        kind: "none",
        reason:
          "A click path: the screenshot is where the click landed (Billing on /profile), proven by the section on screen.",
      },
    },
    {
      id: "settings-redirect",
      title:
        "QA2-E (production re-test 2026-10-08): /settings?tab=billing lands on Settings → Billing at /profile (a history replace; the query kept)",
      persona: "paid",
      route: "/settings?tab=billing",
      waitFor: PAGE,
      expectPath: "^/profile$",
      expectVisible: '[data-testid="settings-billing-self"]',
      prototype: {
        kind: "none",
        reason:
          "A redirect: the screenshot is where /settings landed (Billing on /profile), proven by its pathname and the section on screen.",
      },
    },
    {
      id: "help",
      title:
        "Help: the seven questions (the first open), Still need help? with Contact support, the Policies, the footer",
      persona: "paid",
      route: "/help",
      waitFor: {
        desktop: '[data-testid="help-page"]',
        mobile: '[data-testid="help-page"]',
      },
      fullPage: true,
      prototype: {
        kind: "screen",
        file: "Help.dc.html",
        plan: "paid",
        note: "Help, plan = paid (first question open)",
      },
    },
    {
      id: "click-help-from-rail",
      title:
        "Click path: Help from the rail (desktop) or the avatar menu (390) lands on /help",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="rail-help"]',
        mobile: '[data-testid="button-user-menu"]',
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="rail-help"]',
            mobile: '[data-testid="button-user-menu"]',
          },
        },
        { click: { desktop: null, mobile: '[data-testid="menu-help"]' } },
      ],
      expectPath: "^/help$",
      expectVisible: '[data-testid="help-page"]',
      prototype: {
        kind: "none",
        reason:
          "A click path: the screenshot is where the click landed (/help), proven by its pathname.",
      },
    },
    {
      id: "notifications",
      title: "Notifications (NOT PROTOTYPED): the inbox on the student tokens",
      persona: "paid",
      route: "/notifications",
      waitFor: {
        desktop: '[data-testid="notifications-heading"]',
        mobile: '[data-testid="notifications-heading"]',
      },
      fullPage: true,
      prototype: { kind: "none", reason: NOT_PROTOTYPED },
    },
    {
      id: "upgrade",
      title:
        "The plans page /upgrade (NOT PROTOTYPED): the Help FAQ's free/paid sentences (OQ-59 (h)), three plans, the best value filled; no in-body back link",
      persona: "free",
      route: "/upgrade",
      waitFor: {
        desktop: '[data-testid="upgrade-plan-yearly"]',
        mobile: '[data-testid="upgrade-plan-yearly"]',
      },
      fulfillRequest: {
        method: "GET",
        path: "/api/billing/plans",
        body: PLANS_BODY,
        reason:
          "The real route reads prices from Stripe, which the harness never calls (no key). The body is built by the shared `billingPlansResponseSchema`; the prices are illustrative (upgrade.page.test.tsx's fixture amounts), not Lyceon's.",
      },
      fullPage: true,
      prototype: { kind: "none", reason: NOT_PROTOTYPED },
    },
  ],
};
