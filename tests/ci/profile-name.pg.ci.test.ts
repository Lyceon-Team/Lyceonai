/**
 * OQ-28 / F-54: `PATCH /api/profile/name` changes the display name and nothing else.
 *
 * @spec [student-UI register OQ-28 (owner ruling, Karl, 2026-10-02: a narrow name-only save that
 *        leaves `marketingOptIn` alone); F-54; UI-58; Coding Standards §8.1, §14 (denial tests)]
 *        | @implemented [2026-10-03]
 *
 * plain English: the REAL profile router runs over real Postgres (only the session identity and
 * the Supabase transport are injected, as in `profile-has-password.pg.ci.test.ts`). Each case
 * reads the row back with SQL, so "untouched" means the stored column, not the response.
 * Proved: a name save writes `display_name` and leaves `marketing_opt_in` and
 * `profile_completed_at` exactly as they were (the F-54 defect would have written false and a
 * new timestamp); the response is the shared response schema; a body carrying `marketingOptIn`
 * (or any extra key) is a 400 with nothing written; a blank name is a 400; a guardian is a 403
 * (`requireStudentAccount`) with nothing written; an under-13 student with no active guardian
 * link is a 403 GUARDIAN_LINK_REQUIRED with nothing written (the live link gate, G2-04: this
 * route is not in the approved allowed set); another student's row is never touched.
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
import { profileNameUpdateResponseSchema } from "../../packages/shared/src/profile-name-schema";

const DB_NAME = "profile_name_save_ci";
const STUDENT = {
  id: "f6100000-0000-4000-8000-000000000001",
  email: "name-save@example.test",
};
const OTHER = {
  id: "f6100000-0000-4000-8000-000000000002",
  email: "name-save-other@example.test",
};
const GUARDIAN = {
  id: "f6100000-0000-4000-8000-000000000003",
  email: "name-save-guardian@example.test",
};
const COMPLETED_AT = "2026-09-01T12:00:00.000Z";

let pg: Client;
let sessionAs: {
  id: string;
  email: string;
  role: "student" | "guardian";
  under13?: boolean;
} = {
  ...STUDENT,
  role: "student",
};

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
      (req as Request & { user?: unknown }).user = {
        id: sessionAs.id,
        email: sessionAs.email,
        display_name: null,
        role: sessionAs.role,
        isAdmin: false,
        isGuardian: sessionAs.role === "guardian",
        is_under_13: sessionAs.under13 === true,
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
    req.requestId = "req-profile-name";
    next();
  });
  app.use("/api/profile", requireSupabaseAuth, profileRoutes);
  return app;
}

type StoredRow = {
  display_name: string | null;
  marketing_opt_in: boolean | null;
  profile_completed_at: string | null;
  role: string;
};

async function row(id: string): Promise<StoredRow> {
  const res = await pg.query<{
    display_name: string | null;
    marketing_opt_in: boolean | null;
    profile_completed_at: Date | null;
    role: string;
  }>(
    `SELECT display_name, marketing_opt_in, profile_completed_at, role
       FROM public.profiles WHERE id = $1`,
    [id],
  );
  const r = res.rows[0];
  if (!r) throw new Error(`no profile row ${id}`);
  return {
    display_name: r.display_name,
    marketing_opt_in: r.marketing_opt_in,
    profile_completed_at: r.profile_completed_at?.toISOString() ?? null,
    role: r.role,
  };
}

describe.skipIf(!PG_AVAILABLE)(
  "OQ-28 PATCH /api/profile/name (real Postgres)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      for (const p of [STUDENT, OTHER, GUARDIAN]) {
        await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
          p.id,
          p.email,
        ]);
      }
    }, 120_000);

    beforeEach(async () => {
      sessionAs = { ...STUDENT, role: "student" };
      await pg.query(`DELETE FROM public.profiles WHERE id = ANY($1::uuid[])`, [
        [STUDENT.id, OTHER.id, GUARDIAN.id],
      ]);
      // Opted IN and complete: the two values F-54's defaults would have overwritten. Since
      // migration 20261027000000 every grant must name its source and wording (the consent log's
      // CHECK), so the fixture declares them as set_marketing_consent does.
      await pg.query(
        `SELECT set_config('lyceon.marketing_consent_source', 'signup', false),
                set_config('lyceon.marketing_consent_version', '1.0.0', false)`,
      );
      await pg.query(
        `INSERT INTO public.profiles
           (id, email, role, display_name, date_of_birth, marketing_opt_in, profile_completed_at)
         VALUES
           ($1, $2, 'student', 'Sam Rivera', '2008-01-01'::date, true, $7::timestamptz),
           ($3, $4, 'student', 'Other Student', '2008-01-01'::date, true, $7::timestamptz),
           ($5, $6, 'guardian', 'Gia Guardian', '1980-01-01'::date, true, $7::timestamptz)`,
        [
          STUDENT.id,
          STUDENT.email,
          OTHER.id,
          OTHER.email,
          GUARDIAN.id,
          GUARDIAN.email,
          COMPLETED_AT,
        ],
      );
    });

    afterAll(async () => {
      await pg?.end();
    });

    it("writes the name and leaves marketing_opt_in and profile_completed_at untouched", async () => {
      const before = await row(STUDENT.id);
      // Presence before absence: the two columns hold real values that a write could change.
      expect(before.marketing_opt_in).toBe(true);
      expect(before.profile_completed_at).toBe(COMPLETED_AT);

      const app = await loadApp();
      const res = await request(app)
        .patch("/api/profile/name")
        .send({ displayName: "  Samira Rivera  " });

      expect(res.status).toBe(200);
      expect(profileNameUpdateResponseSchema.parse(res.body)).toEqual({
        displayName: "Samira Rivera",
      });

      const after = await row(STUDENT.id);
      expect(after.display_name).toBe("Samira Rivera");
      expect(after.marketing_opt_in).toBe(true);
      expect(after.profile_completed_at).toBe(COMPLETED_AT);
      expect(after.role).toBe("student");
      // Another student's row is never the target.
      expect((await row(OTHER.id)).display_name).toBe("Other Student");
    });

    it("refuses a body that carries marketingOptIn (strict), writing nothing", async () => {
      const app = await loadApp();
      const res = await request(app)
        .patch("/api/profile/name")
        .send({ displayName: "New Name", marketingOptIn: false });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_NAME");
      const after = await row(STUDENT.id);
      expect(after.display_name).toBe("Sam Rivera");
      expect(after.marketing_opt_in).toBe(true);
    });

    it("refuses a blank name, writing nothing", async () => {
      const app = await loadApp();
      const res = await request(app)
        .patch("/api/profile/name")
        .send({ displayName: "   " });
      expect(res.status).toBe(400);
      expect((await row(STUDENT.id)).display_name).toBe("Sam Rivera");
    });

    it("refuses a guardian with 403 ROLE_NOT_PERMITTED, writing nothing", async () => {
      sessionAs = { ...GUARDIAN, role: "guardian" };
      const app = await loadApp();
      const res = await request(app)
        .patch("/api/profile/name")
        .send({ displayName: "Renamed Guardian" });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ROLE_NOT_PERMITTED");
      expect((await row(GUARDIAN.id)).display_name).toBe("Gia Guardian");
    });

    it("refuses an under-13 student with no active guardian link (G2-04), writing nothing", async () => {
      sessionAs = { ...STUDENT, role: "student", under13: true };
      const app = await loadApp();
      const res = await request(app)
        .patch("/api/profile/name")
        .send({ displayName: "Kid Rename" });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("GUARDIAN_LINK_REQUIRED");
      expect((await row(STUDENT.id)).display_name).toBe("Sam Rivera");
    });
  },
);
