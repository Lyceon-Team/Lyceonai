/**
 * OQ-29: GET /api/profile carries the student's feature-access map.
 *
 * @spec [student-UI register OQ-29, owner ruling (Karl) 2026-10-02: a feature-access map on
 *        GET /api/profile, produced by the same predicates each route enforces (LISA's own for
 *        LISA), with a reason per locked feature (plan | age)] | @implemented [2026-10-02]
 *
 * plain English: the REAL profile route and the REAL entitlement predicates run over real
 * Postgres; only identity is injected. A paid student sees every surface granted; a free one
 * sees each locked for `plan`; a paid student under 13 sees LISA locked for `age` and the rest
 * granted; a guardian gets no map. Then the map is checked against the gates themselves: the
 * LISA age gate (`requireStudentOnly`) refuses exactly the student the map marks `age`, and the
 * map's keys are the routes' own feature constants.
 */
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import { featureAccessMapSchema } from "../../packages/shared/src/feature-access";

const DB_NAME = "feature_access_map_ci";
const PAID = "f5000000-0000-4000-8000-000000000001";
const FREE = "f5000000-0000-4000-8000-000000000002";
const PAID_UNDER_13 = "f5000000-0000-4000-8000-000000000003";
const GUARDIAN = "f5000000-0000-4000-8000-000000000004";

let pg: Client;
const session = { id: PAID, role: "student", under13: false };

function sessionUser(): Record<string, unknown> {
  return {
    id: session.id,
    email: `${session.id}@example.test`,
    display_name: null,
    role: session.role,
    isAdmin: false,
    isGuardian: session.role === "guardian",
    is_under_13: session.under13,
    actor_id: session.id,
  };
}

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pg);
  },
  supabaseAdmin: {
    get from() {
      return makePgSupabase(pg).from;
    },
  },
}));
vi.mock("../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => makePgSupabase(pg),
}));
vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getSupabaseAdmin: () => makePgSupabase(pg),
    requireSupabaseAuth: (req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user?: unknown }).user = sessionUser();
      next();
    },
  };
});

async function profileAs(id: string, role: string, under13: boolean) {
  session.id = id;
  session.role = role;
  session.under13 = under13;
  const { default: profileRoutes } =
    await import("../../server/routes/profile-routes");
  const { requireSupabaseAuth } =
    await import("../../server/middleware/supabase-auth");
  const app = express();
  app.use(express.json());
  app.use("/api/profile", requireSupabaseAuth, profileRoutes);
  return request(app).get("/api/profile");
}

describe.skipIf(!PG_AVAILABLE)(
  "OQ-29 feature-access map (real Postgres)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      for (const [id, role, dob] of [
        [PAID, "student", "2008-01-01"],
        [FREE, "student", "2008-01-01"],
        [PAID_UNDER_13, "student", "2016-01-01"],
        [GUARDIAN, "guardian", "1980-01-01"],
      ] as const) {
        await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
          id,
          `${id}@example.test`,
        ]);
        await pg.query(
          `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth)
         VALUES ($1, $2, $3, 'Someone', $4::date)`,
          [id, `${id}@example.test`, role, dob],
        );
      }
      await pg.query(
        `INSERT INTO public.entitlements
         (profile_id, tier, status, stripe_subscription_id, stripe_subscription_item_id, current_period_end)
       VALUES ($1, 'premium', 'active', 'sub_paid', 'si_paid', now() + interval '20 days'),
              ($2, 'premium', 'active', 'sub_kid', 'si_kid', now() + interval '20 days')`,
        [PAID, PAID_UNDER_13],
      );
    }, 120_000);

    afterAll(async () => {
      await pg?.end();
    });

    it("a paid student: every surface granted", async () => {
      const res = await profileAs(PAID, "student", false);
      expect(res.status).toBe(200);
      const map = featureAccessMapSchema.parse(res.body.featureAccess);
      expect(map).toEqual({
        tutor_access: { access: "granted" },
        exam_full_length: { access: "granted" },
        calendar_access: { access: "granted" },
        mastery_detail: { access: "granted" },
      });
    });

    it("a free student: every surface locked for plan", async () => {
      const res = await profileAs(FREE, "student", false);
      expect(res.status).toBe(200);
      const map = featureAccessMapSchema.parse(res.body.featureAccess);
      for (const entry of Object.values(map)) {
        expect(entry).toEqual({ access: "locked", reason: "plan" });
      }
    });

    it("a paid student under 13: LISA locked for age, the rest granted", async () => {
      const res = await profileAs(PAID_UNDER_13, "student", true);
      expect(res.status).toBe(200);
      const map = featureAccessMapSchema.parse(res.body.featureAccess);
      expect(map.tutor_access).toEqual({ access: "locked", reason: "age" });
      expect(map.exam_full_length).toEqual({ access: "granted" });
      expect(map.calendar_access).toEqual({ access: "granted" });
      expect(map.mastery_detail).toEqual({ access: "granted" });
    });

    it("a guardian gets no map", async () => {
      const res = await profileAs(GUARDIAN, "guardian", false);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("featureAccess", null);
    });

    it("agrees with the LISA age gate: requireStudentOnly refuses exactly the student marked age", async () => {
      const { requireStudentOnly } =
        await import("../../server/middleware/supabase-auth");
      for (const [id, under13] of [
        [PAID, false],
        [PAID_UNDER_13, true],
      ] as const) {
        const profile = await profileAs(id, "student", under13);
        const marked = profile.body.featureAccess.tutor_access;
        const app = express();
        app.use((req: Request, _res: Response, next: NextFunction) => {
          (req as Request & { user?: unknown }).user = sessionUser();
          next();
        });
        app.get("/t", requireStudentOnly, (_q, r) => r.json({ ok: true }));
        const gate = await request(app).get("/t");
        expect(gate.status === 403).toBe(
          marked.access === "locked" && marked.reason === "age",
        );
      }
    });

    it("uses the routes' own feature keys", async () => {
      const { EXAM_FEATURE_KEY } =
        await import("../../server/services/exam-runtime-service");
      const { CALENDAR_FEATURE_KEY } =
        await import("../../server/routes/calendar-routes");
      const res = await profileAs(FREE, "student", false);
      const keys = Object.keys(res.body.featureAccess);
      expect(keys).toContain(EXAM_FEATURE_KEY);
      expect(keys).toContain(CALENDAR_FEATURE_KEY);
      expect(keys).toEqual(
        expect.arrayContaining(["tutor_access", "mastery_detail"]),
      );
    });
  },
);
