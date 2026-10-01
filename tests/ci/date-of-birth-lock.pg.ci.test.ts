/**
 * The date of birth is fixed once the profile is complete — on the route AND in the database.
 *
 * @spec [Guardian_Closure_Plan G2-03; audit G-AUD-02; owner ruling R10 (2026-09-27); Doc-01 V8
 *       §37.1 (under-13 gating derives from the date of birth)] | @implemented [2026-09-29]
 *
 * plain English: `is_under_13` is derived from `date_of_birth` (trigger `profiles_set_age`), and the
 * under-13 gate reads it. A completed student could PATCH an adult date of birth and walk through
 * the gate. Now, after `profile_completed_at` is set:
 *   - `PATCH /api/profile` refuses a different date of birth with 409 `DATE_OF_BIRTH_LOCKED` and
 *     writes neither `date_of_birth` nor `is_under_13`;
 *   - the one exception is the guardian fill (`POST /api/profile/date-of-birth`), allowed only while
 *     the stored value is NULL — once;
 *   - the database refuses (LY007) any UPDATE that changes a completed profile's date of birth, or
 *     that changes `is_under_13` without changing the date of birth it is derived from. The one
 *     named service path that may still clear it is account deletion: `deidentify_user` on a row
 *     whose deletion was requested (`deleted_at` set).
 *
 * MOCK BOUNDARY. Substituted: the DATABASE TRANSPORT (real SQL over genesis + every migration) and
 * the AUTH BOUNDARY (the session reads the caller's real role). The profile routes, the age
 * trigger, the lock trigger and `deidentify_user` all run for real.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { Client } from "pg";
import express from "express";
import request from "supertest";
import {
  makePgSupabase,
  bootstrapPgDatabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "date_of_birth_lock_ci";
const KID = "b1111111-1111-4111-8111-111111111111"; // completed, under 13
const TEEN = "b2222222-2222-4222-8222-222222222222"; // completed, adult-ish student
const GUARDIAN = "b3333333-3333-4333-8333-333333333333"; // completed, has a date of birth
const OLD_GUARDIAN = "b4444444-4444-4444-8444-444444444444"; // completed, no date of birth
const NEWCOMER = "b5555555-5555-4555-8555-555555555555"; // not yet completed

let pg: Client;
const session = { id: KID };

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

vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getSupabaseAdmin: () => makePgSupabase(pg),
    requireSupabaseAuth: async (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      const row = await pg.query(
        `SELECT role::text AS role FROM public.profiles WHERE id = $1`,
        [session.id],
      );
      const role = row.rows[0]?.role as string;
      (req as express.Request & { user?: unknown }).user = {
        id: session.id,
        email: "person@example.test",
        role,
        isAdmin: role === "admin",
        isGuardian: role === "guardian",
      };
      next();
    },
  };
});

vi.mock("../../server/middleware/csrf", () => ({
  doubleCsrfProtection: (_q: unknown, _s: unknown, next: () => void) => next(),
  generateToken: () => "test-csrf-token",
}));

async function buildApp(): Promise<express.Express> {
  const { requireSupabaseAuth } =
    await import("../../server/middleware/supabase-auth");
  const profileRoutes = (await import("../../server/routes/profile-routes"))
    .default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { requestId?: string }).requestId = "g2-03";
    next();
  });
  app.use("/api/profile", requireSupabaseAuth, profileRoutes);
  return app;
}

type AgeRow = {
  date_of_birth: string | null;
  is_under_13: boolean | null;
  age_years: number | null;
};

async function ageRow(id: string): Promise<AgeRow> {
  const r = await pg.query(
    `SELECT date_of_birth::text AS date_of_birth, is_under_13, age_years
       FROM public.profiles WHERE id = $1`,
    [id],
  );
  return r.rows[0] as AgeRow;
}

describe.skipIf(!PG_AVAILABLE)(
  "G2-03 date of birth is locked after completion — real Postgres",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
    });

    afterAll(async () => {
      if (pg) await pg.end();
    });

    beforeEach(async () => {
      session.id = KID;
      // Rebuilt per case so each starts from the same rows. Completion is stamped directly: the
      // subject here is what happens AFTER completion, however the profile got there.
      await pg.query(
        `DELETE FROM public.profiles WHERE id IN ($1,$2,$3,$4,$5)`,
        [KID, TEEN, GUARDIAN, OLD_GUARDIAN, NEWCOMER],
      );
      await pg.query(`DELETE FROM auth.users WHERE id IN ($1,$2,$3,$4,$5)`, [
        KID,
        TEEN,
        GUARDIAN,
        OLD_GUARDIAN,
        NEWCOMER,
      ]);
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES
         ($1,'k@example.test'),($2,'t@example.test'),($3,'g@example.test'),
         ($4,'og@example.test'),($5,'n@example.test')`,
        [KID, TEEN, GUARDIAN, OLD_GUARDIAN, NEWCOMER],
      );
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth, profile_completed_at) VALUES
         ($1,'k@example.test','student','Kid',  (current_date - interval '10 years')::date, now()),
         ($2,'t@example.test','student','Teen', (current_date - interval '16 years')::date, now()),
         ($3,'g@example.test','guardian','Gia', DATE '1980-01-01', now()),
         ($4,'og@example.test','guardian','Olu', NULL, now()),
         ($5,'n@example.test','student','New',  NULL, NULL)`,
        [KID, TEEN, GUARDIAN, OLD_GUARDIAN, NEWCOMER],
      );
    });

    describe("the route", () => {
      it("presence: a completed student may re-save the profile with the SAME date of birth", async () => {
        session.id = TEEN;
        const before = await ageRow(TEEN);
        const res = await request(await buildApp())
          .patch("/api/profile")
          .send({
            displayName: "Teen Renamed",
            role: "student",
            dateOfBirth: before.date_of_birth,
          });
        expect(res.status).toBe(200);
        expect(await ageRow(TEEN)).toEqual(before);
      });

      it("case 1: an under-13 student PATCHing an adult date of birth gets 409 and is_under_13 is unchanged", async () => {
        const before = await ageRow(KID);
        expect(before.is_under_13).toBe(true);
        const res = await request(await buildApp())
          .patch("/api/profile")
          .send({
            displayName: "Kid",
            role: "student",
            dateOfBirth: "1990-01-01",
            guardianEmail: "parent@example.test",
          });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("DATE_OF_BIRTH_LOCKED");
        expect(await ageRow(KID)).toEqual(before);
      });

      it("case 2: a completed guardian's date-of-birth change is refused", async () => {
        session.id = GUARDIAN;
        const before = await ageRow(GUARDIAN);
        const res = await request(await buildApp())
          .patch("/api/profile")
          .send({
            displayName: "Gia",
            role: "guardian",
            dateOfBirth: "1970-05-05",
          });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("DATE_OF_BIRTH_LOCKED");
        expect(await ageRow(GUARDIAN)).toEqual(before);
      });

      it("case 3: filling a NULL guardian date of birth works once; the PATCH cannot do it; a second fill is refused", async () => {
        session.id = OLD_GUARDIAN;
        const viaPatch = await request(await buildApp())
          .patch("/api/profile")
          .send({
            displayName: "Olu",
            role: "guardian",
            dateOfBirth: "1975-03-03",
          });
        expect(viaPatch.status).toBe(409);
        expect(viaPatch.body.error.code).toBe("DATE_OF_BIRTH_LOCKED");
        expect((await ageRow(OLD_GUARDIAN)).date_of_birth).toBeNull();

        const first = await request(await buildApp())
          .post("/api/profile/date-of-birth")
          .send({ dateOfBirth: "1975-03-03" });
        expect(first.status).toBe(200);
        expect((await ageRow(OLD_GUARDIAN)).date_of_birth).toBe("1975-03-03");

        const second = await request(await buildApp())
          .post("/api/profile/date-of-birth")
          .send({ dateOfBirth: "1960-01-01" });
        expect(second.status).toBe(409);
        expect((await ageRow(OLD_GUARDIAN)).date_of_birth).toBe("1975-03-03");
      });
    });

    describe("case 4: the database", () => {
      it("a direct service-role UPDATE of a completed profile's date of birth is refused (LY007)", async () => {
        const before = await ageRow(KID);
        await expect(
          pg.query(
            `UPDATE public.profiles SET date_of_birth = DATE '1990-01-01' WHERE id = $1`,
            [KID],
          ),
        ).rejects.toMatchObject({ code: "LY007" });
        expect(await ageRow(KID)).toEqual(before);
      });

      it("a direct UPDATE of is_under_13 alone is refused (LY007) — it is derived, never written", async () => {
        const before = await ageRow(KID);
        await expect(
          pg.query(
            `UPDATE public.profiles SET is_under_13 = false WHERE id = $1`,
            [KID],
          ),
        ).rejects.toMatchObject({ code: "LY007" });
        expect(await ageRow(KID)).toEqual(before);
      });

      it("clearing it on a completed profile is refused unless the account is being deleted", async () => {
        await expect(
          pg.query(
            `UPDATE public.profiles SET date_of_birth = NULL WHERE id = $1`,
            [TEEN],
          ),
        ).rejects.toMatchObject({ code: "LY007" });
      });

      it("the named path: deidentify_user on a deletion-requested row clears it, and the age fields follow", async () => {
        await pg.query(
          `UPDATE public.profiles SET deleted_at = now() WHERE id = $1`,
          [TEEN],
        );
        await pg.query(
          `SELECT public.deidentify_user($1::uuid, 'deleted-b2@example.invalid')`,
          [TEEN],
        );
        expect(await ageRow(TEEN)).toEqual({
          date_of_birth: null,
          is_under_13: null,
          age_years: null,
        });
      });

      it("before completion the date of birth is still writable (onboarding sets it)", async () => {
        await pg.query(
          `UPDATE public.profiles SET date_of_birth = (current_date - interval '15 years')::date WHERE id = $1`,
          [NEWCOMER],
        );
        const after = await ageRow(NEWCOMER);
        expect(after.date_of_birth).not.toBeNull();
        expect(after.is_under_13).toBe(false);
      });
    });

    /**
     * F-41 (Brief 8 ruling 6, 2026-10-01): at onboarding a date of birth is accepted only as a real,
     * past, plausible date; and an under-13 student is ACCEPTED, then held by the live link gate and
     * kept out of LISA — SCL-187 as live, per the owner's instruction of 2026-10-01.
     */
    describe("F-41: the date of birth at onboarding", () => {
      const tomorrow = new Date(Date.now() + 86_400_000)
        .toISOString()
        .slice(0, 10);
      it.each([
        ["a slash-separated date", "2010/01/01"],
        ["words", "not a date"],
        ["a date that does not exist", "2010-02-31"],
        ["a date in the future", tomorrow],
        ["a date more than 120 years ago", "1890-01-01"],
      ])(
        "refuses %s with 400 DATE_OF_BIRTH_REQUIRED and writes nothing",
        async (_label, dateOfBirth) => {
          session.id = NEWCOMER;
          const res = await request(await buildApp())
            .patch("/api/profile")
            .send({ displayName: "New", role: "student", dateOfBirth });
          expect(res.status).toBe(400);
          expect(res.body.error.code).toBe("DATE_OF_BIRTH_REQUIRED");
          const row = await pg.query(
            `SELECT date_of_birth, profile_completed_at FROM public.profiles WHERE id = $1`,
            [NEWCOMER],
          );
          expect(row.rows[0]).toEqual({
            date_of_birth: null,
            profile_completed_at: null,
          });
        },
      );

      it("accepts an under-13 student, who is then held by the link gate and kept out of LISA", async () => {
        session.id = NEWCOMER;
        const elevenYearsAgo = `${new Date().getUTCFullYear() - 11}-01-15`;
        const res = await request(await buildApp())
          .patch("/api/profile")
          .send({
            displayName: "New",
            role: "student",
            dateOfBirth: elevenYearsAgo,
          });
        expect(res.status).toBe(200);
        const after = await ageRow(NEWCOMER);
        expect(after.date_of_birth).toBe(elevenYearsAgo);
        expect(after.is_under_13).toBe(true);

        // The live gates, with the user built from the row exactly as the auth middleware would.
        const auth = await import("../../server/middleware/supabase-auth");
        const probe = express();
        probe.use((req, _res, next) => {
          (req as express.Request & { user?: unknown }).user = {
            id: NEWCOMER,
            email: "n@example.test",
            display_name: "New",
            role: "student",
            isAdmin: false,
            isGuardian: false,
            is_under_13: after.is_under_13,
            actor_id: NEWCOMER,
          };
          next();
        });
        probe.get("/learning", auth.requireGuardianLinkForUnder13, (_q, r) =>
          r.json({ ok: true }),
        );
        probe.get("/lisa", auth.requireStudentOnly, (_q, r) =>
          r.json({ ok: true }),
        );
        const learning = await request(probe).get("/learning");
        const lisa = await request(probe).get("/lisa");
        expect(learning.status).toBe(403);
        expect(learning.body.code).toBe("GUARDIAN_LINK_REQUIRED");
        expect(lisa.status).toBe(403);
        expect(lisa.body.code).toBe("AGE_RESTRICTION");
      });
    });
  },
);
