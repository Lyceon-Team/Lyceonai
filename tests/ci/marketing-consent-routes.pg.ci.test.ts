/**
 * Plan Q5: the marketing opt-in through the REAL profile router over real Postgres.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R26, row Q5 ("CI: PATCH omitting field preserves
 *       value; under-13 cannot set true; `consent_captured` emitted; DB check"); Doc 10 §9.21;
 *       owner Step 0 answers 1, 2, 5 (2026-10-05); Coding Standards §14 (denial tests)]
 *       | @implemented [2026-10-05]
 *
 * plain English: the session identity, the Supabase transport and the analytics wrapper are
 * injected (as in profile-name.pg.ci.test.ts); every route, rule, SQL function and trigger is
 * the production one. Each case reads the stored row and the consent log back with SQL:
 *   - a PATCH that omits `marketingOptIn` leaves a stored TRUE alone (the reset bug);
 *   - an under-13 account cannot be set true — through the onboarding PATCH or the Settings PUT —
 *     and nothing is written; a guardian with no date of birth cannot either;
 *   - a grant records its source (`signup` at onboarding, `settings` from the toggle), the
 *     wording version and a timestamp; a withdrawal is logged; turning it off always works;
 *   - `consent_captured` is emitted for a grant only, once, and AFTER `user_signed_up`.
 * Runs only where PGHOST is set; named by file in CI.
 */
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { Client } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "marketing_consent_routes_ci";
const TEEN = {
  id: "f7100000-0000-4000-8000-000000000001",
  email: "teen@x.test",
};
const CHILD = {
  id: "f7100000-0000-4000-8000-000000000002",
  email: "child@x.test",
};
const NEWBIE = {
  id: "f7100000-0000-4000-8000-000000000003",
  email: "new@x.test",
};
const GUARDIAN = {
  id: "f7100000-0000-4000-8000-000000000004",
  email: "g@x.test",
};

function yearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}
const TEEN_DOB = yearsAgo(15);
const CHILD_DOB = yearsAgo(10);

let pg: Client;
let sessionAs: { id: string; email: string; role: "student" | "guardian" } = {
  ...TEEN,
  role: "student",
};
const emitted: string[] = [];

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
vi.mock("../../server/lib/analytics/emit-event", () => ({
  emitEvent: vi.fn(async (_id: string, name: string) => {
    emitted.push(name);
    return { ok: true };
  }),
}));
vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getSupabaseAdmin: () => makePgSupabase(pg),
    requireSupabaseAuth: (req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user?: unknown }).user = {
        id: sessionAs.id,
        email: sessionAs.email,
        display_name: null,
        role: sessionAs.role,
        isAdmin: false,
        isGuardian: sessionAs.role === "guardian",
        is_under_13: false,
        actor_id: sessionAs.id,
      };
      next();
    },
  };
});

async function loadApp(): Promise<express.Express> {
  const { default: profileRoutes } =
    await import("../../server/routes/profile-routes");
  const { requireSupabaseAuth } =
    await import("../../server/middleware/supabase-auth");
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.requestId = "req-marketing-consent";
    next();
  });
  app.use("/api/profile", requireSupabaseAuth, profileRoutes);
  return app;
}

async function optIn(id: string): Promise<boolean> {
  const r = await pg.query<{ marketing_opt_in: boolean }>(
    `SELECT marketing_opt_in FROM public.profiles WHERE id = $1`,
    [id],
  );
  const row = r.rows[0];
  if (!row) throw new Error(`no profile ${id}`);
  return row.marketing_opt_in;
}

async function completedAt(id: string): Promise<Date | null> {
  const r = await pg.query<{ profile_completed_at: Date | null }>(
    `SELECT profile_completed_at FROM public.profiles WHERE id = $1`,
    [id],
  );
  return r.rows[0]?.profile_completed_at ?? null;
}

async function log(id: string): Promise<
  {
    granted: boolean;
    source: string;
    consent_version: string | null;
    captured_at: Date;
  }[]
> {
  const r = await pg.query(
    `SELECT granted, source, consent_version, captured_at
       FROM public.marketing_consent_log WHERE profile_id = $1 ORDER BY id`,
    [id],
  );
  return r.rows;
}

describe.skipIf(!PG_AVAILABLE)(
  "Q5 marketing opt-in through the profile routes (real Postgres)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      for (const p of [TEEN, CHILD, NEWBIE, GUARDIAN]) {
        await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
          p.id,
          p.email,
        ]);
      }
    }, 180_000);

    beforeEach(async () => {
      emitted.length = 0;
      sessionAs = { ...TEEN, role: "student" };
      await pg.query(`DELETE FROM public.profiles WHERE id = ANY($1::uuid[])`, [
        [TEEN.id, CHILD.id, NEWBIE.id, GUARDIAN.id],
      ]);
      // TEEN: complete and opted IN (a grant needs its source and wording declared, as
      // set_marketing_consent does). CHILD: complete, under 13. NEWBIE: not yet onboarded.
      // GUARDIAN: complete, created before dates of birth were collected.
      await pg.query(
        `SELECT set_config('lyceon.marketing_consent_source', 'signup', false),
                set_config('lyceon.marketing_consent_version', '1.0.0', false)`,
      );
      await pg.query(
        `INSERT INTO public.profiles
           (id, email, role, display_name, date_of_birth, marketing_opt_in, profile_completed_at)
         VALUES
           ($1, $2, 'student', 'Teen', $3::date, true, now()),
           ($4, $5, 'student', 'Child', $6::date, false, now()),
           ($7, $8, 'student', NULL, NULL, false, NULL),
           ($9, $10, 'guardian', 'Guardian', NULL, false, now())`,
        [
          TEEN.id,
          TEEN.email,
          TEEN_DOB,
          CHILD.id,
          CHILD.email,
          CHILD_DOB,
          NEWBIE.id,
          NEWBIE.email,
          GUARDIAN.id,
          GUARDIAN.email,
        ],
      );
      await pg.query(
        `SELECT set_config('lyceon.marketing_consent_source', '', false),
                set_config('lyceon.marketing_consent_version', '', false)`,
      );
    });

    afterAll(async () => {
      await pg?.end();
    });

    describe("PATCH /api/profile (onboarding)", () => {
      it("a PATCH that omits marketingOptIn leaves a stored TRUE alone (the reset bug)", async () => {
        expect(await optIn(TEEN.id)).toBe(true); // presence before absence
        const before = (await log(TEEN.id)).length;
        const res = await request(await loadApp())
          .patch("/api/profile")
          .send({
            displayName: "Teen",
            role: "student",
            dateOfBirth: TEEN_DOB,
          });
        expect(res.status).toBe(200);
        expect(res.body.profile.marketingOptIn).toBe(true);
        expect(await optIn(TEEN.id)).toBe(true);
        expect(await log(TEEN.id)).toHaveLength(before);
      });

      it("an under-13 student cannot be set true: 400, nothing written, not even the profile", async () => {
        sessionAs = { ...NEWBIE, role: "student" };
        const res = await request(await loadApp())
          .patch("/api/profile")
          .send({
            displayName: "Kid",
            role: "student",
            dateOfBirth: CHILD_DOB,
            marketingOptIn: true,
          });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("MARKETING_OPT_IN_INELIGIBLE");
        expect(await optIn(NEWBIE.id)).toBe(false);
        expect(await completedAt(NEWBIE.id)).toBeNull();
        expect(await log(NEWBIE.id)).toEqual([]);
        expect(emitted).toEqual([]);
      });

      it("a 13+ grant at onboarding records source signup, the wording version and a time, and emits consent_captured after user_signed_up", async () => {
        sessionAs = { ...NEWBIE, role: "student" };
        const before = Date.now();
        const res = await request(await loadApp())
          .patch("/api/profile")
          .send({
            displayName: "New",
            role: "student",
            dateOfBirth: TEEN_DOB,
            marketingOptIn: true,
          });
        expect(res.status).toBe(200);
        expect(res.body.profile.marketingOptIn).toBe(true);
        const rows = await log(NEWBIE.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          granted: true,
          source: "signup",
          consent_version: "1.0.0",
        });
        expect(rows[0]!.captured_at.getTime()).toBeGreaterThanOrEqual(
          before - 5_000,
        );
        expect(emitted).toEqual(["user_signed_up", "consent_captured"]);
      });

      it("declining at onboarding writes no log row and emits no consent event", async () => {
        sessionAs = { ...NEWBIE, role: "student" };
        const res = await request(await loadApp())
          .patch("/api/profile")
          .send({
            displayName: "New",
            role: "student",
            dateOfBirth: TEEN_DOB,
            marketingOptIn: false,
          });
        expect(res.status).toBe(200);
        expect(await optIn(NEWBIE.id)).toBe(false);
        expect(await log(NEWBIE.id)).toEqual([]);
        expect(emitted).toEqual(["user_signed_up"]);
      });
    });

    describe("PUT /api/profile/marketing-consent (Settings)", () => {
      it("an under-13 student cannot turn it on: 400, nothing written", async () => {
        sessionAs = { ...CHILD, role: "student" };
        const res = await request(await loadApp())
          .put("/api/profile/marketing-consent")
          .send({ granted: true });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("MARKETING_OPT_IN_INELIGIBLE");
        expect(await optIn(CHILD.id)).toBe(false);
        expect(await log(CHILD.id)).toEqual([]);
        expect(emitted).toEqual([]);
      });

      it("a guardian with no date of birth cannot turn it on (unknown age fails closed)", async () => {
        sessionAs = { ...GUARDIAN, role: "guardian" };
        const res = await request(await loadApp())
          .put("/api/profile/marketing-consent")
          .send({ granted: true });
        expect(res.status).toBe(400);
        expect(await optIn(GUARDIAN.id)).toBe(false);
      });

      it("turning it off always works, and is logged with source settings", async () => {
        const res = await request(await loadApp())
          .put("/api/profile/marketing-consent")
          .send({ granted: false });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ marketingOptIn: false });
        expect(await optIn(TEEN.id)).toBe(false);
        expect((await log(TEEN.id)).at(-1)).toMatchObject({
          granted: false,
          source: "settings",
          consent_version: null,
        });
        expect(emitted).toEqual([]);
      });

      it("turning it on records source settings and emits consent_captured once; repeating changes nothing", async () => {
        const app = await loadApp();
        await request(app)
          .put("/api/profile/marketing-consent")
          .send({ granted: false });
        emitted.length = 0;
        const on = await request(app)
          .put("/api/profile/marketing-consent")
          .send({ granted: true });
        expect(on.status).toBe(200);
        expect(on.body).toEqual({ marketingOptIn: true });
        const afterOn = await log(TEEN.id);
        expect(afterOn.at(-1)).toMatchObject({
          granted: true,
          source: "settings",
          consent_version: "1.0.0",
        });
        expect(emitted).toEqual(["consent_captured"]);

        const again = await request(app)
          .put("/api/profile/marketing-consent")
          .send({ granted: true });
        expect(again.status).toBe(200);
        expect(await log(TEEN.id)).toHaveLength(afterOn.length);
        expect(emitted).toEqual(["consent_captured"]);
      });

      it("refuses a body with anything but `granted`", async () => {
        const res = await request(await loadApp())
          .put("/api/profile/marketing-consent")
          .send({ granted: true, source: "signup" });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("INVALID_REQUEST");
      });
    });
  },
);
