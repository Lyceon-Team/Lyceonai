// @vitest-environment jsdom
/**
 * UI-58: Settings (`/profile`) for a student, rendered in the real App shell.
 *
 * @spec [student-UI register UI-58, OQ-27 (no Notifications section), OQ-20 (test date and target
 *        only once a calendar profile exists), OQ-28 / F-54 (narrow name save, never
 *        `marketingOptIn`), OQ-26 / OQ-41 (`hasPassword`: true and null show Change password,
 *        false hides it), UI-S4 (the current password is required), UI-S7 / F-40 (Billing's three
 *        states from `managedBy`; the free box in the approved Help FAQ wording, OQ-61 (e)), UI-S8 (About you hidden), OQ-38 (the guardian sentence), UI-44
 *        (`?tab=billing` lands on Billing, also from /profile itself), UI-47 (Appearance per
 *        device; the timed module stays light); DESIGN.md §4 Settings; Coding Standards §14]
 *        | @implemented [2026-10-03]
 *
 * plain English: the page is mounted with the real query layer, the real App shell and the real
 * upgrade modal, with a scripted network standing in for `csrfFetch`. Every request and its body
 * is logged, so "this control calls that route with exactly this body" is asserted from the log.
 *
 * FIXTURES FROM REAL PRODUCERS. The billing status bodies are parsed by the shared
 * `billingStatusResponseSchema`, with `managedBy` from the real `deriveBillingManagedBy`; the
 * calendar profile body by the shared `profileReadResponseSchema`; the name-save answer by the
 * shared response schema; the link-code and links bodies by their shared view schemas; the
 * feature-access map is `resolveFeatureAccess`'s output; the password refusal is the shape and
 * words `POST /api/auth/change-password` sends.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  billingStatusResponseSchema,
  deriveBillingManagedBy,
  type BillingStatus,
} from "@lyceon/shared/billing-schema";
import {
  profileReadResponseSchema,
  profileUpsertResponseSchema,
} from "@lyceon/shared/calendar/api";
import type { FeatureAccessMap } from "@lyceon/shared/feature-access";
import { profileNameUpdateResponseSchema } from "@lyceon/shared/profile-name-schema";
import { studentGuardianLinksViewSchema } from "@lyceon/shared/student-resources";
import { studentLinkCodeViewSchema } from "@lyceon/shared/student-link-code-schema";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { UPGRADE_PLANS_DESTINATION } from "@/components/billing/upgrade-modal";
import { AppShell } from "@/components/layout/app-shell";
import { StudentRouteFrame } from "@/components/layout/StudentRouteFrame";
import { GUARDIAN_VISIBILITY_SENTENCE } from "@/components/settings/LinkSection";
import {
  PROFILE_QUERY_KEY,
  type ProfileHydration,
} from "@/hooks/useProfileQuery";
import { practiceQuotaSchema } from "@lyceon/shared/practice-quota";
import { PLAN_PAID_ADDS, planFreeIncludes } from "@/lib/plan-copy";
import { getQueryFn } from "@/lib/queryClient";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { resolveFeatureAccess } from "../../../server/lib/feature-access";
import SettingsPage from "./settings";

// ── The network ────────────────────────────────────────────────────────────────────────────

type Call = { method: string; url: string; body: unknown };

const net = vi.hoisted(() => ({
  log: [] as { method: string; url: string; body: unknown }[],
  answer: (
    _method: string,
    _url: string,
    _body: unknown,
  ): Response | undefined => undefined,
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

vi.mock("@/lib/csrf", () => ({
  csrfFetch: async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    const body: unknown =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    net.log.push({ method, url, body });
    const answer = net.answer(method, url, body);
    if (answer !== undefined) return answer;
    if (url.startsWith("/api/notifications")) {
      return json({ data: { unread: 0 }, requestId: "r" });
    }
    if (url === "/api/account/email-suppression") {
      return json({
        ok: true,
        suppressed: false,
        origin: null,
        clearable: false,
      });
    }
    return json({ error: "Not found" }, 404);
  },
}));

const STUDENT = "00000000-0000-4000-8000-000000000058";

const auth = vi.hoisted(() => ({
  role: "student" as "student" | "admin",
}));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: {
      id: "00000000-0000-4000-8000-000000000058",
      email: "sam@example.test",
      display_name: "Sam Rivera",
      role: auth.role,
      accountDeletionLifecycleV2: true,
    },
    isLoading: false,
    authLoading: false,
    isAuthenticated: true,
    isAdmin: auth.role === "admin",
    isGuardian: false,
    signOut: async () => undefined,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => undefined }),
  toast: () => undefined,
}));
const entitlement = vi.hoisted(() => ({ paid: false }));
vi.mock("../../../server/services/entitlement-service", () => ({
  EntitlementService: {
    canAccessFeature: async () => entitlement.paid,
    isEntitlementActiveForProfile: async () => entitlement.paid,
  },
}));
vi.mock("../../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    rpc: () => {
      throw new Error("no database in this test");
    },
    from: () => {
      throw new Error("no database in this test");
    },
  },
}));

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────

async function accessMap(paid: boolean): Promise<FeatureAccessMap> {
  entitlement.paid = paid;
  const map = await resolveFeatureAccess({
    id: STUDENT,
    role: "student",
    is_under_13: false,
  });
  if (map === null) throw new Error("a student always gets a map");
  return map;
}

function profileBody(
  map: FeatureAccessMap,
  hasPassword: boolean | null,
): ProfileHydration {
  return {
    authenticated: true,
    featureFlags: { accountDeletionLifecycleV2: true },
    pendingDeletion: null,
    featureAccess: map,
    user: {
      id: STUDENT,
      email: "sam@example.test",
      display_name: "Sam Rivera",
      name: "Sam Rivera",
      username: "sam",
      role: "student",
      isAdmin: false,
      isGuardian: false,
      is_under_13: false,
      dateOfBirth: "2008-01-01",
      marketingOptIn: true,
      profileCompletedAt: "2026-09-01T12:00:00.000Z",
      requiredProfileComplete: true,
      guardianConsentRequired: false,
      outstandingLegal: [],
      hasPassword,
    },
  };
}

/** GET /api/billing/status as the student branch writes it (billing-routes.ts). */
function billingBody(args: {
  paid: boolean;
  subscription: boolean;
  customer: boolean;
}): BillingStatus {
  return billingStatusResponseSchema.parse({
    plan: args.paid ? "premium" : "free",
    stripeStatus: args.paid ? "active" : "missing",
    currentPeriodEnd: args.paid ? "2026-10-28T00:00:00.000Z" : null,
    stripeSubscriptionId: args.subscription ? "sub_test_58" : null,
    effectiveAccess: args.paid,
    needsPaymentUpdate: false,
    lapsed: false,
    hasBillingAccount: args.customer,
    isPaid: args.paid,
    managedBy: deriveBillingManagedBy({
      hasSubscription: args.subscription,
      isStripeCustomer: args.customer,
    }),
    requestId: "r",
  });
}

const STUDY_PROFILE = {
  timezone: "America/Chicago",
  target_exam_date: "2026-12-05",
  target_exam_dates: ["2026-12-05"],
  target_score: 1400,
  study_days_mask: 62,
  daily_minutes: 30,
  full_length_weekday: null,
  full_length_interval_weeks: null,
  planner_mode: "auto",
  setup_completed_at: "2026-09-02T00:00:00.000Z",
} as const;

function calendarProfileBody(exists: boolean): unknown {
  return {
    ...profileReadResponseSchema.parse({
      profile: exists ? STUDY_PROFILE : null,
    }),
    requestId: "r",
  };
}

const LINK_CODE_URL = `/api/students/${STUDENT}/link-code`;
const LINKS_URL = `/api/students/${STUDENT}/links`;

/**
 * `GET /api/practice/quota` for a free student, with a config value that is not the seeded 40
 * (OQ-68 (d), UI-64: the plan copy's daily number is the server's `freeDailyLimit`).
 */
const FREE_DAILY_LIMIT = 37;
const FREE_QUOTA = practiceQuotaSchema.parse({
  unlimited: false,
  limit: FREE_DAILY_LIMIT,
  remaining: 30,
  resetAt: "2026-10-09T05:00:00.000Z",
  freeDailyLimit: FREE_DAILY_LIMIT,
});

type Serve = {
  billing?: BillingStatus;
  calendarProfile?: boolean;
  links?: {
    link_id: string;
    guardian_display_name: string;
    linked_at: string;
  }[];
};

function serve(opts: Serve): void {
  net.answer = (method, url, body) => {
    const path = url.split("?")[0];
    if (path === "/api/billing/status" && opts.billing) {
      return json(opts.billing);
    }
    if (path === "/api/calendar/profile" && method === "GET") {
      return json(calendarProfileBody(opts.calendarProfile ?? false));
    }
    if (path === "/api/calendar/profile" && method === "PUT") {
      const change = body as { target_score?: number | null };
      return json({
        ...profileUpsertResponseSchema.parse({
          profile: {
            ...STUDY_PROFILE,
            ...("target_score" in change
              ? { target_score: change.target_score }
              : {}),
          },
        }),
        requestId: "r",
      });
    }
    if (path === "/api/profile/name" && method === "PATCH") {
      const name = (body as { displayName: string }).displayName;
      return json(profileNameUpdateResponseSchema.parse({ displayName: name }));
    }
    if (path === LINK_CODE_URL) {
      return json({
        data: studentLinkCodeViewSchema.parse({
          code: "ABC234",
          expiresAt: new Date(Date.now() + 12 * 3_600_000).toISOString(),
        }),
      });
    }
    if (path === `${LINK_CODE_URL}/regenerate`) {
      return json({
        data: studentLinkCodeViewSchema.parse({
          code: "XYZ789",
          expiresAt: new Date(Date.now() + 12 * 3_600_000).toISOString(),
        }),
      });
    }
    if (path === `${LINK_CODE_URL}/invite`) {
      return json({ ok: true }, 202);
    }
    if (path === LINKS_URL) {
      return json({
        data: studentGuardianLinksViewSchema.parse({ links: opts.links ?? [] }),
      });
    }
    if (path?.startsWith(`${LINKS_URL}/`) && method === "DELETE") {
      return json({ ok: true });
    }
    if (path === "/api/billing/portal") {
      return json({ error: { code: "TEST_STOP", message: "stop" } }, 409);
    }
    if (path === "/api/practice/quota") {
      return json(FREE_QUOTA);
    }
    return undefined;
  };
}

// ── Mount ──────────────────────────────────────────────────────────────────────────────────

type Mounted = { navigate: (to: string) => void; history: string[] };

async function mount(args: {
  path?: string;
  paid?: boolean;
  hasPassword?: boolean | null;
}): Promise<Mounted> {
  const map = await accessMap(args.paid ?? true);
  const location = memoryLocation({
    path: args.path ?? "/profile",
    record: true,
  });
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: getQueryFn({ on401: "throw" }),
        retry: false,
        staleTime: Infinity,
      },
      mutations: { retry: false },
    },
  });
  client.setQueryData(
    PROFILE_QUERY_KEY,
    profileBody(map, args.hasPassword === undefined ? true : args.hasPassword),
  );
  render(
    <QueryClientProvider client={client}>
      <Router hook={location.hook}>
        <UpgradeModalProvider autoOpenOnDenial>
          <AppShell panel={null} footer>
            <SettingsPage />
          </AppShell>
        </UpgradeModalProvider>
      </Router>
    </QueryClientProvider>,
  );
  await screen.findByTestId("settings-page");
  return { navigate: location.navigate, history: location.history ?? [] };
}

function calls(method: string, path: string): Call[] {
  return net.log.filter(
    (c) => c.method === method && c.url.split("?")[0] === path,
  );
}

function sectionLabels(): string[] {
  return within(screen.getByTestId("settings-sections"))
    .getAllByRole("button")
    .map((b) => b.textContent ?? "");
}

beforeEach(() => {
  net.log = [];
  auth.role = "student";
  serve({
    billing: billingBody({ paid: true, subscription: true, customer: true }),
  });
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});
afterEach(cleanup);

// ── The section list and the URL ───────────────────────────────────────────────────────────

describe("the section list (DESIGN.md §4; OQ-27)", () => {
  it("lists Profile, Account, Guardian, Billing and Appearance, and no Notifications section", async () => {
    await mount({});
    // Presence first: the five sections are on screen.
    expect(sectionLabels()).toEqual([
      "Profile",
      "Account",
      "Guardian",
      "Billing",
      "Appearance",
    ]);
    expect(
      within(screen.getByTestId("settings-sections")).queryByText(
        "Notifications",
      ),
    ).toBeNull();
    expect(screen.queryByText("Email notifications")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("an admin sees Account and Appearance only", async () => {
    auth.role = "admin";
    await mount({});
    expect(sectionLabels()).toEqual(["Account", "Appearance"]);
    expect(screen.getByTestId("settings-account")).toBeTruthy();
  });
});

describe("the section lives in the URL (?tab=)", () => {
  it("?tab=billing lands on Billing", async () => {
    await mount({ path: "/profile?tab=billing" });
    expect(await screen.findByTestId("settings-billing")).toBeTruthy();
    expect(
      screen
        .getByTestId("settings-section-billing")
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.queryByTestId("settings-profile")).toBeNull();
  });

  it("already on /profile, the upgrade modal's destination switches to Billing (UI-44 limitation closed)", async () => {
    const { navigate } = await mount({ path: "/profile" });
    expect(await screen.findByTestId("settings-profile")).toBeTruthy();
    expect(UPGRADE_PLANS_DESTINATION).toBe("/profile?tab=billing");
    act(() => navigate(UPGRADE_PLANS_DESTINATION));
    expect(await screen.findByTestId("settings-billing")).toBeTruthy();
    expect(screen.queryByTestId("settings-profile")).toBeNull();
  });

  it("choosing a section navigates to its URL", async () => {
    const { history } = await mount({});
    fireEvent.click(screen.getByTestId("settings-section-account"));
    expect(await screen.findByTestId("settings-account")).toBeTruthy();
    expect(history[history.length - 1]).toBe("/profile?tab=account");
  });

  it("an unknown or legacy tab falls back to Profile", async () => {
    await mount({ path: "/profile?tab=progress" });
    expect(await screen.findByTestId("settings-profile")).toBeTruthy();
  });
});

// ── Profile ────────────────────────────────────────────────────────────────────────────────

describe("Profile (OQ-20, OQ-28, UI-S8)", () => {
  it("with no calendar profile: 'Set up your study calendar' links to the calendar, no goal fields", async () => {
    serve({ calendarProfile: false });
    await mount({});
    const setup = await screen.findByTestId("settings-goal-setup");
    const link = within(setup).getByRole("link", {
      name: "Set up your study calendar",
    });
    expect(link.getAttribute("href")).toBe("/calendar");
    expect(screen.queryByTestId("settings-test-date")).toBeNull();
    expect(screen.queryByTestId("settings-target")).toBeNull();
    expect(calls("GET", "/api/calendar/profile")).toHaveLength(1);
  });

  it("with a calendar profile: the test date and target show and save through PUT /api/calendar/profile", async () => {
    serve({ calendarProfile: true });
    await mount({});
    // SCL-223: the saved date is a ticked option in the shared SAT-date picker.
    const date = await screen.findByTestId(
      "settings-test-dates-date-2026-12-05",
    );
    const target = screen.getByTestId("settings-target") as HTMLInputElement;
    expect(date.getAttribute("aria-checked")).toBe("true");
    expect(target.value).toBe("1400");
    expect(screen.queryByTestId("settings-goal-setup")).toBeNull();

    fireEvent.change(target, { target: { value: "1450" } });
    fireEvent.click(screen.getByTestId("settings-profile-save"));
    await screen.findByTestId("settings-profile-saved");
    const puts = calls("PUT", "/api/calendar/profile");
    expect(puts).toHaveLength(1);
    const body = puts[0]?.body as Record<string, unknown>;
    // Only what changed, plus the idempotency key.
    expect(Object.keys(body).sort()).toEqual([
      "idempotency_key",
      "target_score",
    ]);
    expect(body.target_score).toBe(1450);
    expect(typeof body.idempotency_key).toBe("string");
    // The name did not change, so the name route was not called.
    expect(calls("PATCH", "/api/profile/name")).toHaveLength(0);
  });

  it("the name saves through PATCH /api/profile/name with { displayName } only, never marketingOptIn", async () => {
    serve({ calendarProfile: false });
    await mount({});
    const name = (await screen.findByTestId(
      "settings-name",
    )) as HTMLInputElement;
    expect(name.value).toBe("Sam Rivera");
    fireEvent.change(name, { target: { value: "Samira Rivera" } });
    fireEvent.click(screen.getByTestId("settings-profile-save"));
    await screen.findByTestId("settings-profile-saved");
    const patches = calls("PATCH", "/api/profile/name");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.body).toEqual({ displayName: "Samira Rivera" });
    // The onboarding route (F-54) is never used for a name change.
    expect(calls("PATCH", "/api/profile")).toHaveLength(0);
    expect(JSON.stringify(net.log)).not.toContain("marketingOptIn");
  });

  it("SCL-223: with no calendar profile the SAT dates still show and save alone, through PUT /api/calendar/profile", async () => {
    serve({ calendarProfile: false });
    await mount({});
    const option = await screen.findByTestId(
      "settings-test-dates-date-2026-12-05",
    );
    // The target score waits for calendar setup (OQ-20); the link to set it up stays.
    expect(screen.queryByTestId("settings-target")).toBeNull();
    expect(screen.getByTestId("settings-goal-setup")).toBeTruthy();
    fireEvent.click(option);
    fireEvent.click(screen.getByTestId("settings-profile-save"));
    await screen.findByTestId("settings-profile-saved");
    const puts = calls("PUT", "/api/calendar/profile");
    expect(puts).toHaveLength(1);
    const body = puts[0]?.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "idempotency_key",
      "target_exam_dates",
    ]);
    expect(body.target_exam_dates).toEqual(["2026-12-05"]);
  });

  it("an unchanged form has nothing to save", async () => {
    serve({ calendarProfile: true });
    await mount({});
    await screen.findByTestId("settings-test-dates");
    expect(
      (screen.getByTestId("settings-profile-save") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("'About you' is absent while UI-S8 holds, and its routes are never called", async () => {
    serve({ calendarProfile: true });
    await mount({});
    // Presence first: the Profile section rendered its fields.
    expect(await screen.findByTestId("settings-name")).toBeTruthy();
    await screen.findByTestId("settings-test-dates");
    const section = screen.getByTestId("settings-profile");
    for (const text of [
      "About you",
      "Graduation year",
      "GPA",
      "High school",
      "Dream schools",
    ]) {
      expect(within(section).queryByText(text), text).toBeNull();
    }
    expect(
      net.log.filter(
        (c) =>
          c.url.startsWith("/api/profile/background") ||
          c.url.startsWith("/api/reference"),
      ),
    ).toEqual([]);
  });
});

// ── Account ────────────────────────────────────────────────────────────────────────────────

describe("Account (OQ-26, OQ-41, UI-S4, F-38)", () => {
  it.each([
    [true, "Email and password"],
    [null, null],
  ] as const)(
    "hasPassword %s shows Change password",
    async (hasPassword, method) => {
      await mount({ path: "/profile?tab=account", hasPassword });
      expect(
        await screen.findByTestId("settings-change-password"),
      ).toBeTruthy();
      expect(screen.getByTestId("settings-email").textContent).toBe(
        "sam@example.test",
      );
      if (method === null) {
        expect(screen.queryByTestId("settings-sign-in-method")).toBeNull();
      } else {
        expect(screen.getByTestId("settings-sign-in-method").textContent).toBe(
          method,
        );
      }
    },
  );

  it("hasPassword false (Google-only) hides Change password", async () => {
    await mount({ path: "/profile?tab=account", hasPassword: false });
    // Presence first: the Account section and its email are on screen.
    expect(await screen.findByTestId("settings-account")).toBeTruthy();
    expect(screen.getByTestId("settings-sign-in-method").textContent).toBe(
      "Google",
    );
    expect(screen.queryByTestId("settings-change-password")).toBeNull();
    expect(screen.queryByTestId("settings-current-password")).toBeNull();
  });

  it("the change requires the current password and sends exactly it and the new one", async () => {
    await mount({ path: "/profile?tab=account" });
    const submit = (await screen.findByTestId(
      "settings-update-password",
    )) as HTMLButtonElement;
    fireEvent.change(screen.getByTestId("settings-new-password"), {
      target: { value: "NewPassword456" },
    });
    fireEvent.change(screen.getByTestId("settings-confirm-password"), {
      target: { value: "NewPassword456" },
    });
    // No current password: the form cannot be sent.
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(calls("POST", "/api/auth/change-password")).toHaveLength(0);

    net.answer = (method, url) =>
      method === "POST" && url === "/api/auth/change-password"
        ? json({ success: true, message: "Password updated successfully" })
        : undefined;
    fireEvent.change(screen.getByTestId("settings-current-password"), {
      target: { value: "OldPassword123" },
    });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await screen.findByTestId("settings-password-updated");
    const posts = calls("POST", "/api/auth/change-password");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({
      current_password: "OldPassword123",
      new_password: "NewPassword456",
    });
  });

  it("shows the server's words for a wrong current password", async () => {
    await mount({ path: "/profile?tab=account" });
    net.answer = (method, url) =>
      method === "POST" && url === "/api/auth/change-password"
        ? json(
            {
              error: {
                code: "CURRENT_PASSWORD_INCORRECT",
                message: "Your current password is incorrect.",
              },
            },
            400,
          )
        : undefined;
    fireEvent.change(await screen.findByTestId("settings-current-password"), {
      target: { value: "WrongPassword9" },
    });
    fireEvent.change(screen.getByTestId("settings-new-password"), {
      target: { value: "NewPassword456" },
    });
    fireEvent.change(screen.getByTestId("settings-confirm-password"), {
      target: { value: "NewPassword456" },
    });
    fireEvent.click(screen.getByTestId("settings-update-password"));
    expect(
      (await screen.findByTestId("settings-password-error")).textContent,
    ).toBe("Your current password is incorrect.");
  });

  it("a mismatched confirmation is refused before anything is sent", async () => {
    await mount({ path: "/profile?tab=account" });
    fireEvent.change(await screen.findByTestId("settings-current-password"), {
      target: { value: "OldPassword123" },
    });
    fireEvent.change(screen.getByTestId("settings-new-password"), {
      target: { value: "NewPassword456" },
    });
    fireEvent.change(screen.getByTestId("settings-confirm-password"), {
      target: { value: "NewPassword457" },
    });
    fireEvent.click(screen.getByTestId("settings-update-password"));
    expect(
      (await screen.findByTestId("settings-password-error")).textContent,
    ).toBe("Passwords do not match");
    expect(calls("POST", "/api/auth/change-password")).toHaveLength(0);
  });

  it("the Delete account box opens the type-to-confirm step for the existing route", async () => {
    await mount({ path: "/profile?tab=account" });
    fireEvent.click(await screen.findByTestId("delete-account-trigger"));
    const modal = await screen.findByTestId("delete-account-modal");
    const confirm = within(modal).getByTestId(
      "delete-account-confirm",
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(
      within(modal).getByTestId("delete-account-confirm-input"),
      {
        target: { value: "DELETE" },
      },
    );
    expect(confirm.disabled).toBe(false);
  });
});

// ── Guardian ───────────────────────────────────────────────────────────────────────────────

describe("Guardian (OQ-38; the existing link routes)", () => {
  it("no guardian: the status, the OQ-38 sentence and the code", async () => {
    serve({ links: [] });
    await mount({ path: "/profile?tab=guardian" });
    const panel = await screen.findByTestId("student-guardians-panel");
    expect(await within(panel).findByText("No guardian linked")).toBeTruthy();
    expect(within(panel).getByText(GUARDIAN_VISIBILITY_SENTENCE)).toBeTruthy();
    expect(GUARDIAN_VISIBILITY_SENTENCE).toBe(
      "A guardian can see your progress: mastery, test scores, your study plan and your projected score. They never see your answers or your conversations with LISA.",
    );
    expect(
      (await screen.findByTestId("student-link-code-value")).textContent,
    ).toBe("ABC234");
    expect(calls("GET", LINKS_URL)).toHaveLength(1);
    expect(calls("GET", LINK_CODE_URL)).toHaveLength(1);
  });

  it("Copy code, Email it to my guardian and Get a new code call their routes", async () => {
    serve({ links: [] });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await mount({ path: "/profile?tab=guardian" });
    await screen.findByTestId("student-link-code-value");

    fireEvent.click(screen.getByTestId("student-link-code-copy"));
    expect(writeText).toHaveBeenCalledWith("ABC234");

    fireEvent.change(screen.getByTestId("student-link-invite-email"), {
      target: { value: "parent@example.test" },
    });
    fireEvent.click(screen.getByTestId("student-link-invite-submit"));
    await screen.findByTestId("student-link-invite-sent");
    expect(calls("POST", `${LINK_CODE_URL}/invite`)[0]?.body).toEqual({
      email: "parent@example.test",
    });

    fireEvent.click(screen.getByTestId("student-link-code-regenerate"));
    await waitFor(() =>
      expect(screen.getByTestId("student-link-code-value").textContent).toBe(
        "XYZ789",
      ),
    );
    expect(calls("POST", `${LINK_CODE_URL}/regenerate`)).toHaveLength(1);
  });

  it("a linked guardian is listed and removed through DELETE …/links/:id after confirming", async () => {
    serve({
      links: [
        {
          link_id: "11111111-1111-4111-8111-111111111111",
          guardian_display_name: "Gia Guardian",
          linked_at: "2026-09-20T00:00:00.000Z",
        },
      ],
    });
    await mount({ path: "/profile?tab=guardian" });
    const panel = await screen.findByTestId("student-guardians-panel");
    expect(await within(panel).findByText("Gia Guardian")).toBeTruthy();
    expect(within(panel).getByText("Your guardians")).toBeTruthy();
    fireEvent.click(
      screen.getByTestId(
        "student-guardian-remove-11111111-1111-4111-8111-111111111111",
      ),
    );
    fireEvent.click(
      await screen.findByTestId("student-guardian-remove-confirm"),
    );
    await screen.findByTestId("student-guardians-removed");
    expect(
      calls("DELETE", `${LINKS_URL}/11111111-1111-4111-8111-111111111111`),
    ).toHaveLength(1);
  });
});

// ── Billing ────────────────────────────────────────────────────────────────────────────────

describe("Billing: three states from managedBy and the plan (UI-S7 / F-40)", () => {
  it("self-paid: the status and Manage billing, which asks the portal route", async () => {
    serve({
      billing: billingBody({ paid: true, subscription: true, customer: true }),
    });
    await mount({ path: "/profile?tab=billing" });
    const box = await screen.findByTestId("settings-billing-self");
    expect(within(box).getByTestId("settings-billing-status").textContent).toBe(
      "Active",
    );
    fireEvent.click(within(box).getByTestId("button-manage-billing"));
    await waitFor(() =>
      expect(calls("POST", "/api/billing/portal")).toHaveLength(1),
    );
    expect(screen.queryByTestId("button-see-plans")).toBeNull();
  });

  it("guardian-managed: 'Managed by your guardian' and no button at all", async () => {
    const body = billingBody({
      paid: true,
      subscription: true,
      customer: false,
    });
    expect(body.managedBy).toBe("guardian");
    serve({ billing: body });
    await mount({ path: "/profile?tab=billing" });
    const box = await screen.findByTestId("settings-billing-guardian");
    expect(box.textContent).toContain("Managed by your guardian");
    expect(within(box).queryAllByRole("button")).toEqual([]);
    expect(screen.queryByTestId("button-manage-billing")).toBeNull();
  });

  it("free: the free plan and See plans, which goes to the plans page", async () => {
    serve({
      billing: billingBody({
        paid: false,
        subscription: false,
        customer: false,
      }),
    });
    const { history } = await mount({
      path: "/profile?tab=billing",
      paid: false,
    });
    const box = await screen.findByTestId("settings-billing-free");
    expect(box.textContent).toContain("Free plan");
    // OQ-61 (e): the approved Help FAQ wording, the same sentences `/help` and `/upgrade` show,
    // each a whole paragraph — not the Settings prototype's variant ("a study calendar",
    // "full-length tests and LISA.").
    // OQ-68 (d), UI-64: the daily number is the quota read's `freeDailyLimit` (37 here).
    const freeLine = await within(box).findByText(
      planFreeIncludes(FREE_DAILY_LIMIT),
    );
    expect(freeLine.tagName).toBe("P");
    expect(freeLine.textContent).toContain("37 practice questions a day");
    expect(box.textContent).not.toMatch(/\b40\b|forty/i);
    expect(within(box).getByText(PLAN_PAID_ADDS).tagName).toBe("P");
    expect(box.textContent).not.toContain("a study calendar");
    expect(screen.queryByTestId("button-manage-billing")).toBeNull();
    fireEvent.click(within(box).getByTestId("button-see-plans"));
    expect(history[history.length - 1]).toBe("/upgrade");
    expect(calls("POST", "/api/billing/portal")).toHaveLength(0);
  });
});

// ── Appearance ─────────────────────────────────────────────────────────────────────────────

describe("Appearance (UI-47: per device; the timed module stays light)", () => {
  it("Dark is saved on this device and applied at once; Match device saves 'system'", async () => {
    await mount({ path: "/profile?tab=appearance" });
    const system = await screen.findByTestId("theme-option-system");
    // Nothing stored: Match device is the choice.
    expect(system.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByTestId("theme-option-dark"));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(
      screen.getByTestId("theme-option-dark").getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByTestId("theme-option-light"));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    fireEvent.click(system);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    // Nothing went to the server.
    expect(net.log.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("with Dark chosen, the timed exam module's shell still pins the light set", async () => {
    await mount({ path: "/profile?tab=appearance" });
    fireEvent.click(await screen.findByTestId("theme-option-dark"));
    cleanup();
    render(
      <StudentRouteFrame route="/tests/:sessionId/:section/:module">
        <p data-testid="module-body">module</p>
      </StudentRouteFrame>,
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    const shell = screen
      .getByTestId("module-body")
      .closest("[data-shell]") as HTMLElement;
    expect(shell.getAttribute("data-theme-lock")).toBe("light");
  });
});
