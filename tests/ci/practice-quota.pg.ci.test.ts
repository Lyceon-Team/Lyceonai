/**
 * OQ-21: GET /api/practice/quota reads the free daily practice quota without consuming it.
 *
 * @spec [student-UI register OQ-21, owner ruling (Karl) 2026-10-02: a read-only
 *        `GET /api/practice/quota`, computed by the same function as the 402
 *        (`checkAndReservePracticeQuota`, dry run), built with tests observed failing once;
 *        Doc 02B §12 Entitlement Matrix, §13 "Zero Quota Remaining"; Doc 01A §40 `getUsage`]
 *        | @implemented [2026-10-03]
 *
 * plain English: the REAL practice router behind the REAL mount gates (`requireSupabaseAuth`,
 * `requireStudentOrAdmin`, as `server/index.ts` mounts it) and the REAL
 * `check_and_reserve_practice_quota` over real Postgres (genesis + every migration). Only the
 * session is injected, and CSRF is left out (it ignores GET; the one POST here is the 402 site).
 * Questions are consumed through the real ledger call the serve route makes
 * (`checkAndReservePracticeQuota`, `dryRun: false`, one item per question served), so the read is
 * compared with the very decision that refuses the student:
 *   - a fresh free student: remaining = limit, resetAt = the next UTC midnight;
 *   - after N served: remaining = limit - N, equal to what the Nth reservation itself reported;
 *   - at the limit: remaining 0, the serve reservation is refused, and POST /sessions answers 402
 *     with the same limit, remaining and resetAt;
 *   - a paid student: unlimited, even after questions served;
 *   - reading twice writes no ledger row and moves nothing;
 *   - no session 401; a guardian 403 at the student gate;
 *   - an admin (admitted by the practice mount, like every practice route) gets unlimited: the
 *     ledger wrapper's admin bypass, under which the enforcement never caps an admin either.
 * The limit is read from `practice_runtime_config.daily_quota_free`, never written here.
 */
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import { practiceQuotaSchema } from "../../packages/shared/src/practice-quota";

const DB_NAME = "practice_quota_ci";
const FREE_FRESH = "f2100000-0000-4000-8000-000000000001";
const FREE_SOME = "f2100000-0000-4000-8000-000000000002";
const FREE_LIMIT = "f2100000-0000-4000-8000-000000000003";
const FREE_TWICE = "f2100000-0000-4000-8000-000000000004";
const PAID = "f2100000-0000-4000-8000-000000000005";
const GUARDIAN = "f2100000-0000-4000-8000-000000000006";
const ADMIN = "f2100000-0000-4000-8000-000000000007";

let pg: Client;
const session: { id: string | null; role: "student" | "guardian" | "admin" } = {
  id: null,
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

function injectSession(req: Request, _res: Response, next: NextFunction) {
  if (session.id) {
    req.user = {
      id: session.id,
      email: `${session.id}@example.test`,
      display_name: null,
      role: session.role,
      isAdmin: session.role === "admin",
      isGuardian: session.role === "guardian",
      is_under_13: false,
      profile_completed_at: "2026-09-01T00:00:00Z",
      actor_id: session.id,
    };
  }
  next();
}

async function app(): Promise<express.Express> {
  const { default: practiceRouter } =
    await import("../../server/routes/practice-canonical");
  const { requireSupabaseAuth, requireStudentOrAdmin } =
    await import("../../server/middleware/supabase-auth");
  const a = express();
  a.use(express.json());
  a.use(injectSession);
  a.use(
    "/api/practice",
    requireSupabaseAuth,
    requireStudentOrAdmin,
    practiceRouter,
  );
  return a;
}

async function quotaAs(
  id: string | null,
  role: typeof session.role = "student",
) {
  session.id = id;
  session.role = role;
  return request(await app()).get("/api/practice/quota");
}

/** One question served: the reservation `GET /sessions/:id/next` makes for the item it serves. */
async function serveOne(studentId: string) {
  const { checkAndReservePracticeQuota } =
    await import("../../apps/api/src/lib/rate-limit-ledger");
  return checkAndReservePracticeQuota({
    studentUserId: studentId,
    role: "student",
    sessionId: null,
    sessionItemId: randomUUID(),
    dryRun: false,
    requestId: null,
  });
}

async function ledgerRows(studentId: string): Promise<number> {
  const r = await pg.query(
    `SELECT count(*)::int AS n FROM public.usage_rate_limit_ledger WHERE student_user_id = $1`,
    [studentId],
  );
  return Number(r.rows[0]?.n);
}

function nextUtcMidnight(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

let dailyLimit = 0;

describe.skipIf(!PG_AVAILABLE)(
  "OQ-21 GET /api/practice/quota (real Postgres)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      for (const [id, role] of [
        [FREE_FRESH, "student"],
        [FREE_SOME, "student"],
        [FREE_LIMIT, "student"],
        [FREE_TWICE, "student"],
        [PAID, "student"],
        [GUARDIAN, "guardian"],
        [ADMIN, "admin"],
      ] as const) {
        await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
          id,
          `${id}@example.test`,
        ]);
        await pg.query(
          `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth)
         VALUES ($1, $2, $3, 'Someone', '2008-01-01'::date)`,
          [id, `${id}@example.test`, role],
        );
      }
      await pg.query(
        `INSERT INTO public.entitlements
         (profile_id, tier, status, stripe_subscription_id, stripe_subscription_item_id, current_period_end)
       VALUES ($1, 'premium', 'active', 'sub_oq21', 'si_oq21', now() + interval '20 days')`,
        [PAID],
      );
      const cfg = await pg.query(
        `SELECT value FROM public.practice_runtime_config WHERE key = 'daily_quota_free'`,
      );
      dailyLimit = Number.parseInt(String(cfg.rows[0]?.value), 10);
    }, 120_000);

    afterAll(async () => {
      await pg?.end();
    });

    it("a fresh free student: remaining = limit, reset at the next UTC midnight", async () => {
      // Presence before absence: the configured limit is a real number, or nothing below means much.
      expect(Number.isInteger(dailyLimit)).toBe(true);
      expect(dailyLimit).toBeGreaterThan(1);
      const res = await quotaAs(FREE_FRESH);
      expect(res.status).toBe(200);
      const quota = practiceQuotaSchema.parse(res.body);
      expect(quota.unlimited).toBe(false);
      expect(quota.limit).toBe(dailyLimit);
      expect(quota.remaining).toBe(dailyLimit);
      expect(Date.parse(String(quota.resetAt))).toBe(nextUtcMidnight());
    });

    it("after N questions served: remaining = limit - N, equal to the reservation's own count", async () => {
      const n = 3;
      let last = await serveOne(FREE_SOME);
      for (let i = 1; i < n; i += 1) last = await serveOne(FREE_SOME);
      expect(last.allowed).toBe(true);
      const res = await quotaAs(FREE_SOME);
      expect(res.status).toBe(200);
      const quota = practiceQuotaSchema.parse(res.body);
      expect(quota).toEqual({
        unlimited: false,
        limit: dailyLimit,
        remaining: dailyLimit - n,
        resetAt: last.resetAt,
      });
      expect(quota.remaining).toBe(last.remaining);
    });

    it("at the limit: remaining 0, the serve reservation is refused, and POST /sessions 402s with the same numbers", async () => {
      for (let i = 0; i < dailyLimit; i += 1) {
        const d = await serveOne(FREE_LIMIT);
        expect(d.allowed).toBe(true);
      }
      const res = await quotaAs(FREE_LIMIT);
      expect(res.status).toBe(200);
      const quota = practiceQuotaSchema.parse(res.body);
      expect(quota.unlimited).toBe(false);
      expect(quota.remaining).toBe(0);
      expect(quota.limit).toBe(dailyLimit);

      const refused = await serveOne(FREE_LIMIT);
      expect(refused.allowed).toBe(false);
      expect(refused.code).toBe("PRACTICE_FREE_DAILY_QUOTA_EXCEEDED");
      expect(refused.remaining).toBe(quota.remaining);
      expect(refused.limit).toBe(quota.limit);
      expect(refused.resetAt).toBe(quota.resetAt);

      session.id = FREE_LIMIT;
      session.role = "student";
      const start = await request(await app())
        .post("/api/practice/sessions")
        .send({ target_question_count: 5 });
      expect(start.status).toBe(402);
      expect(start.body).toMatchObject({
        code: "PRACTICE_FREE_DAILY_QUOTA_EXCEEDED",
        limit: quota.limit,
        remaining: quota.remaining,
        resetAt: quota.resetAt,
      });
    });

    it("a paid student: unlimited, also after questions served", async () => {
      await serveOne(PAID);
      await serveOne(PAID);
      const res = await quotaAs(PAID);
      expect(res.status).toBe(200);
      expect(practiceQuotaSchema.parse(res.body)).toEqual({
        unlimited: true,
        limit: null,
        remaining: null,
        resetAt: null,
      });
    });

    it("reading twice consumes nothing: no ledger row, remaining unchanged", async () => {
      await serveOne(FREE_TWICE);
      const before = await ledgerRows(FREE_TWICE);
      expect(before).toBe(1);
      const first = await quotaAs(FREE_TWICE);
      const second = await quotaAs(FREE_TWICE);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await ledgerRows(FREE_TWICE)).toBe(before);
      expect(first.body.remaining).toBe(dailyLimit - 1);
      expect(second.body).toEqual(first.body);
    });

    it("no session: 401, no quota body", async () => {
      const res = await quotaAs(null);
      expect(res.status).toBe(401);
      expect(res.body).not.toHaveProperty("remaining");
    });

    it("a guardian: 403 at the student gate, no quota body, no ledger row", async () => {
      const res = await quotaAs(GUARDIAN, "guardian");
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Student access required");
      expect(res.body).not.toHaveProperty("remaining");
      expect(await ledgerRows(GUARDIAN)).toBe(0);
    });

    it("an admin: unlimited (the enforcement's admin bypass), no ledger row", async () => {
      const res = await quotaAs(ADMIN, "admin");
      expect(res.status).toBe(200);
      expect(practiceQuotaSchema.parse(res.body)).toEqual({
        unlimited: true,
        limit: null,
        remaining: null,
        resetAt: null,
      });
      expect(await ledgerRows(ADMIN)).toBe(0);
    });
  },
);
