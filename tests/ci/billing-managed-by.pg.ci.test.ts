/**
 * F-40: `GET /api/billing/status` says who manages a student's plan — real PostgreSQL proof.
 *
 * @spec [Brief 8 ruling 5 (owner, 2026-10-01): `managedBy` is `self` | `guardian`, derived from
 *        whether the student is the Stripe customer; no new payer column] | @implemented [2026-10-01]
 *
 * plain English: the REAL billing router and the REAL entitlement and account reads, over real
 * entitlement and profile rows on a throwaway Postgres. Substituted: the database transport, the
 * signed-in user, CSRF and the Stripe client (which the student branch never calls — asserted).
 *
 * The three cases the UI needs: a guardian-paid student (a subscription, no Stripe customer of
 * their own) reads `guardian`, so the Manage button is hidden; a self-paid student reads `self`;
 * and a student with no plan reads `self`.
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

const DB_NAME = "billing_managed_by_ci";
const SELF_PAID = "f4000000-0000-4000-8000-000000000001";
const GUARDIAN_PAID = "f4000000-0000-4000-8000-000000000002";
const NO_PLAN = "f4000000-0000-4000-8000-000000000003";
const GUARDIAN = "f4000000-0000-4000-8000-000000000004";

let pg: Client;
const session = { id: SELF_PAID, role: "student" };
const stripeCalls = vi.hoisted(() => ({ count: 0 }));

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
    requireSupabaseAuth: (req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user?: unknown }).user = {
        id: session.id,
        email: `${session.id}@example.test`,
        display_name: null,
        role: session.role,
        isAdmin: false,
        isGuardian: session.role === "guardian",
        is_under_13: false,
        actor_id: session.id,
      };
      next();
    },
  };
});
vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_q: Request, _s: Response, next: NextFunction) =>
    next(),
}));
vi.mock("../../server/lib/stripe/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../server/lib/stripe/client")>();
  return {
    ...actual,
    getStripeClient: () =>
      new Proxy(
        {},
        {
          get() {
            stripeCalls.count += 1;
            throw new Error("the student status branch must not call Stripe");
          },
        },
      ),
  };
});

async function buildApp(): Promise<express.Express> {
  const { default: billingRoutes } =
    await import("../../server/routes/billing-routes");
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.requestId = "f-40";
    next();
  });
  app.use("/api/billing", billingRoutes);
  return app;
}

async function statusAs(id: string, role = "student") {
  session.id = id;
  session.role = role;
  return request(await buildApp()).get("/api/billing/status");
}

describe.skipIf(!PG_AVAILABLE)(
  "F-40 billing status managedBy (real Postgres)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      for (const [id, role, customer] of [
        [SELF_PAID, "student", "cus_self_paid"],
        [GUARDIAN_PAID, "student", null],
        [NO_PLAN, "student", null],
        [GUARDIAN, "guardian", "cus_guardian"],
      ] as const) {
        await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
          id,
          `${id}@example.test`,
        ]);
        await pg.query(
          `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth, stripe_customer_id)
         VALUES ($1, $2, $3, 'Someone', DATE '2008-01-01', $4)`,
          [id, `${id}@example.test`, role, customer],
        );
      }
      // The guardian pays for GUARDIAN_PAID: the subscription is on the guardian's customer, and the
      // student's own row carries it (the webhook's per-item write).
      await pg.query(
        `INSERT INTO public.entitlements
         (profile_id, tier, status, stripe_subscription_id, stripe_subscription_item_id, current_period_end)
       VALUES ($1, 'premium', 'active', 'sub_self', 'si_self', now() + interval '20 days'),
              ($2, 'premium', 'active', 'sub_guardian', 'si_guardian', now() + interval '20 days')`,
        [SELF_PAID, GUARDIAN_PAID],
      );
    }, 120_000);

    afterAll(async () => {
      await pg?.end();
    });

    it("a guardian-paid student reads managedBy: guardian, with the plan still active", async () => {
      const res = await statusAs(GUARDIAN_PAID);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        plan: "premium",
        effectiveAccess: true,
        hasBillingAccount: false,
        managedBy: "guardian",
      });
    });

    it("a self-paid student reads managedBy: self", async () => {
      const res = await statusAs(SELF_PAID);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        plan: "premium",
        hasBillingAccount: true,
        managedBy: "self",
      });
    });

    it("a student with no plan reads managedBy: self", async () => {
      const res = await statusAs(NO_PLAN);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        effectiveAccess: false,
        managedBy: "self",
      });
    });

    it("the student branch answers without a single Stripe call", () => {
      expect(stripeCalls.count).toBe(0);
    });
  },
);
