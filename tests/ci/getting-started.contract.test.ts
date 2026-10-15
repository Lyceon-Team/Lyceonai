/**
 * The "Getting started" checklist's rules, without a database.
 *
 * @spec [owner brief "Student dashboard — Getting started checklist + onboarding update" (final
 *       brief v2, Karl, 2026-10-13) §2, §3, §8] | @implemented [2026-10-13]
 *
 * plain English: the pure derivation (which steps a student sees, in what state, and whether the
 * card is complete), the plan rule the route reads from the one feature-access resolver, and that
 * every step's link is a real route (or Settings tab) in the app. The same rules over real rows
 * are tests/ci/getting-started.pg.ci.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  deriveGettingStarted,
  GETTING_STARTED_HREF,
  GETTING_STARTED_STEP_IDS,
  type GettingStartedObservation,
} from "../../packages/shared/src/getting-started-schema";
import { SETTINGS_SECTIONS } from "../../client/src/components/settings/settings-sections";
import type { FeatureAccessMap } from "../../packages/shared/src/feature-access";

const access = vi.hoisted(() => ({
  map: null as FeatureAccessMap | null,
}));
vi.mock("../../server/lib/feature-access", () => ({
  resolveFeatureAccess: async () => access.map,
}));
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: { rpc: async () => ({ data: null, error: null }) },
}));

const NOTHING: GettingStartedObservation = {
  email_eligible: true,
  test_date_done: false,
  qotd_done: false,
  email_done: false,
  email_skipped: false,
  blind_spots_done: false,
  review_done: false,
  calendar_done: false,
  lisa_done: false,
  guardian_done: false,
  dismissed: false,
};
const FREE = { plan: "free", lisaAvailable: true } as const;
const PRO = { plan: "pro", lisaAvailable: true } as const;

const ids = (o: GettingStartedObservation, a: typeof FREE | typeof PRO) =>
  deriveGettingStarted(o, a).steps.map((s) => s.id);

describe("which steps a student sees", () => {
  it("free: the first five, in the brief's order; Pro: all eight", () => {
    expect(ids(NOTHING, FREE)).toEqual([
      "test_date",
      "qotd",
      "email",
      "blind_spots",
      "review",
    ]);
    expect(ids(NOTHING, PRO)).toEqual([...GETTING_STARTED_STEP_IDS]);
  });

  it("free accounts never see steps 6–8, whatever the data says", () => {
    const all = {
      ...NOTHING,
      calendar_done: true,
      lisa_done: true,
      guardian_done: true,
    };
    for (const id of ["calendar", "lisa", "guardian"]) {
      expect(ids(all, FREE)).not.toContain(id);
    }
  });

  it("the email step is hidden for a student who cannot opt in; LISA for one who cannot use it", () => {
    expect(ids({ ...NOTHING, email_eligible: false }, FREE)).toHaveLength(4);
    expect(ids({ ...NOTHING, email_eligible: false }, FREE)).not.toContain(
      "email",
    );
    const young = { plan: "pro", lisaAvailable: false } as const;
    expect(ids({ ...NOTHING, email_eligible: false }, young)).toEqual([
      "test_date",
      "qotd",
      "blind_spots",
      "review",
      "calendar",
      "guardian",
    ]);
  });
});

describe("completion", () => {
  const allFree = {
    ...NOTHING,
    test_date_done: true,
    qotd_done: true,
    blind_spots_done: true,
    review_done: true,
  };

  it("is reached when every visible step is done or skipped; one open step holds it", () => {
    expect(deriveGettingStarted(allFree, FREE).complete).toBe(false);
    expect(
      deriveGettingStarted({ ...allFree, email_skipped: true }, FREE).complete,
    ).toBe(true);
    expect(
      deriveGettingStarted({ ...allFree, email_done: true }, FREE).complete,
    ).toBe(true);
    // The same facts on Pro: three more steps are still open.
    expect(
      deriveGettingStarted({ ...allFree, email_done: true }, PRO).complete,
    ).toBe(false);
  });

  it("an email step both opted in and skipped is done, not skipped", () => {
    const view = deriveGettingStarted(
      { ...NOTHING, email_done: true, email_skipped: true },
      FREE,
    );
    expect(view.steps.find((s) => s.id === "email")?.status).toBe("done");
  });
});

describe("every step links where it is completed", () => {
  const app = readFileSync(join(process.cwd(), "client/src/App.tsx"), "utf8");
  const tabs = new Set<string>(SETTINGS_SECTIONS.map((s) => s.id));

  it.each(GETTING_STARTED_STEP_IDS.map((id) => [id, GETTING_STARTED_HREF[id]]))(
    "%s → %s is a route in App.tsx (and a real Settings tab where it names one)",
    (_id, href) => {
      const url = new URL(href, "https://app.example");
      expect(app).toContain(`path="${url.pathname}"`);
      const tab = url.searchParams.get("tab");
      if (tab !== null) expect(tabs.has(tab)).toBe(true);
    },
  );

  it("today's question points at the card's own anchor on Home", () => {
    expect(GETTING_STARTED_HREF.qotd).toBe("/dashboard#qotd");
    const card = readFileSync(
      join(
        process.cwd(),
        "client/src/components/home/qotd/HomeQotdSection.tsx",
      ),
      "utf8",
    );
    expect(card).toContain('id="qotd"');
  });
});

describe("the plan the route reads (the dashboard's own rule)", () => {
  async function audience(map: FeatureAccessMap | null) {
    access.map = map;
    const { defaultAudience } =
      await import("../../server/routes/getting-started-routes");
    return defaultAudience({
      id: "s",
      email: "s@example.test",
      display_name: null,
      role: "student",
      isAdmin: false,
      isGuardian: false,
      is_under_13: false,
      profile_completed_at: null,
      actor_id: "s",
    });
  }
  const G = { access: "granted" } as const;
  const PLAN = { access: "locked", reason: "plan" } as const;
  const AGE = { access: "locked", reason: "age" } as const;

  it("Pro only when calendar AND mastery are granted", async () => {
    expect(
      (
        await audience({
          tutor_access: G,
          exam_full_length: G,
          calendar_access: G,
          mastery_detail: G,
        })
      ).plan,
    ).toBe("pro");
    expect(
      (
        await audience({
          tutor_access: G,
          exam_full_length: G,
          calendar_access: G,
          mastery_detail: PLAN,
        })
      ).plan,
    ).toBe("free");
  });

  it("LISA is unavailable only when its lock is the age lock", async () => {
    const pro = {
      exam_full_length: G,
      calendar_access: G,
      mastery_detail: G,
    } as const;
    expect((await audience({ ...pro, tutor_access: AGE })).lisaAvailable).toBe(
      false,
    );
    expect((await audience({ ...pro, tutor_access: PLAN })).lisaAvailable).toBe(
      true,
    );
    expect((await audience({ ...pro, tutor_access: G })).lisaAvailable).toBe(
      true,
    );
  });
});

describe("the mount (students only, final brief v2 §8)", () => {
  it.each([
    ["server/index.ts", "doubleCsrfProtection,\\s*"],
    ["tests/e2e/student-harness/server.ts", ""],
  ])(
    "%s mounts it behind auth and requireStudentAccount, so guardians and admins get 403",
    (file, csrf) => {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      const auth = file === "server/index.ts" ? "" : "auth\\.";
      expect(src).toMatch(
        new RegExp(
          `app\\.use\\(\\s*"/api/home/getting-started",\\s*${auth}requireSupabaseAuth,\\s*${csrf}${auth}requireStudentAccount,\\s*gettingStartedRoutes,\\s*\\)`,
        ),
      );
    },
  );
});
