/**
 * The email-consent flow is gone; an under-13 student completes the profile, and whether a
 * guardian is connected is DERIVED from an active link.
 *
 * @spec [Guardian_Closure_Plan G2-05; audit G-AUD-03; owner ruling R6 (2026-09-27): a redeemed
 *       link replaces the email-consent flow] | @implemented [2026-09-29]
 *
 * plain English: completing an under-13 profile queried `guardian_consent_requests.child_id`, a
 * column the table never had (KNOWN-GAPS CONSENT-FLOW-SCHEMA-MISMATCH), so it failed with 500 —
 * and even without that, the route withheld `profile_completed_at` from every under-13 student.
 * No under-13 student could finish onboarding. The flow (consent rows, the email to a page that
 * does not exist, the stored `guardian_consent` flag) is removed. The profile completes; nothing is
 * written to `guardian_consent_requests`; and `guardian_consent` as the session sees it is true
 * exactly while the student has an ACTIVE guardian link.
 *
 * INTERIM, BY DESIGN. Reading the link once per sign-in is a step inside this PR only: G2-04
 * (the next commit) replaces it with a gate that reads the link on every request.
 *
 * MOCK BOUNDARY. Substituted: the DATABASE TRANSPORT (real SQL over genesis + every migration)
 * and the AUTH BOUNDARY (the session reads the caller's real role). The profile route and the
 * session loader run for real.
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
import type { User } from "@supabase/supabase-js";
import {
  makePgSupabase,
  bootstrapPgDatabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "consent_flow_removed_ci";
const KID = "c1111111-1111-4111-8111-111111111111";
const GUARDIAN = "c2222222-2222-4222-8222-222222222222";

let pg: Client;

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
        [KID],
      );
      const role = row.rows[0]?.role as string;
      (req as express.Request & { user?: unknown }).user = {
        id: KID,
        email: "k@example.test",
        role,
        isAdmin: false,
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
    (req as express.Request & { requestId?: string }).requestId = "g2-05";
    next();
  });
  app.use("/api/profile", requireSupabaseAuth, profileRoutes);
  return app;
}

function yearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

async function consentRows(): Promise<number> {
  const r = await pg.query(
    `SELECT count(*)::int AS c FROM public.guardian_consent_requests`,
  );
  return r.rows[0].c as number;
}

describe.skipIf(!PG_AVAILABLE)(
  "G2-05 the consent-token flow is removed — real Postgres",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,'k@example.test'),($2,'g@example.test')`,
        [KID, GUARDIAN],
      );
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, date_of_birth) VALUES
         ($1,'g@example.test','guardian',DATE '1980-01-01')`,
        [GUARDIAN],
      );
    });

    afterAll(async () => {
      if (pg) await pg.end();
    });

    beforeEach(async () => {
      await pg.query(`DELETE FROM public.guardian_links`);
      await pg.query(`DELETE FROM public.notification_events`);
      await pg.query(`DELETE FROM public.profiles WHERE id = $1`, [KID]);
      await pg.query(
        `INSERT INTO public.profiles (id, email, role) VALUES ($1,'k@example.test','student')
       ON CONFLICT DO NOTHING`,
        [KID],
      );
    });

    it("an under-13 student completes the profile; no consent row is written", async () => {
      const res = await request(await buildApp())
        .patch("/api/profile")
        .send({
          displayName: "Kid",
          role: "student",
          dateOfBirth: yearsAgo(10),
          guardianEmail: "parent@example.test",
        });
      expect(res.status).toBe(200);
      const row = await pg.query(
        `SELECT profile_completed_at, is_under_13 FROM public.profiles WHERE id = $1`,
        [KID],
      );
      expect(row.rows[0].is_under_13).toBe(true);
      expect(row.rows[0].profile_completed_at).not.toBeNull();
      expect(await consentRows()).toBe(0);
      // Still needs a guardian: nothing is linked yet.
      expect(res.body.guardianConsentRequired).toBe(true);
      expect(res.body).not.toHaveProperty("guardianConsentRequestId");
    });

    it("the guardian email is no longer required: it only ever addressed the consent email", async () => {
      const res = await request(await buildApp())
        .patch("/api/profile")
        .send({
          displayName: "Kid",
          role: "student",
          dateOfBirth: yearsAgo(10),
        });
      expect(res.status).toBe(200);
    });

    it("guardian_consent as the session sees it follows the ACTIVE link: absent, linked, revoked", async () => {
      const { ensureProfileForAuthUser } =
        await import("../../server/lib/profile-bootstrap");
      const user = { id: KID, email: "k@example.test" } as unknown as User;
      const load = () =>
        ensureProfileForAuthUser(makePgSupabase(pg) as never, user, {
          source: "supabase_auth_middleware",
        });

      expect((await load()).guardian_consent).toBe(false);

      const link = await pg.query(
        `SELECT id FROM public.create_active_guardian_link_audited($1::uuid, $2::uuid, 'g2-05')`,
        [GUARDIAN, KID],
      );
      expect((await load()).guardian_consent).toBe(true);

      await pg.query(
        `UPDATE public.guardian_links SET status = 'revoked', revoked_at = now() WHERE id = $1`,
        [link.rows[0].id],
      );
      expect((await load()).guardian_consent).toBe(false);
    });
  },
);
