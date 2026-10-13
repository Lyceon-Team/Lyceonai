/**
 * The configured numbers the student copy prints come from the server config (OQ-68 (d), UI-64).
 *
 * @spec [student-UI register UI-64, owner ruling OQ-68 (d) (Karl, 2026-10-08): "The '40
 *        questions' copy reads the server quota value (the same source as the 402)". Row proof:
 *        "Changing the config value in a test changes the rendered copy"; Doc 05P §10.1 (the
 *        diagnostic is 8 domains × `diagnostic_per_domain`); Doc 02B §12, §41]
 *        | @implemented [2026-10-08]
 *
 * plain English: the REAL practice and diagnostic routers behind the REAL mount gates, over real
 * Postgres (genesis + every migration), with `practice_runtime_config` set to values that are
 * NOT the seeded ones before the first request (the practice config is cached per process, so
 * this file sets them up front rather than mid-run): `daily_quota_free` 37, the diagnostic 6 per
 * domain and 48 in all. Then:
 *   - `GET /api/practice/quota` carries `freeDailyLimit: 37` for a free and for a paid student
 *     (Help and Billing are shown to both);
 *   - `GET /api/practice/sessions/open` carries `diagnosticTotalQuestions: 48` and
 *     `diagnosticPerDomain: 6`, and a round trip proves they are the numbers the diagnostic is
 *     really built with: the real `POST /diagnostic/sessions` then shows up on the same read as a
 *     diagnostic row whose `target_question_count` is that total.
 * Nothing here is student data; the payloads are parsed with the shared schemas the client uses.
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
import { practiceOpenSessionsResponseSchema } from "../../packages/shared/src/practice-response-schema";

const DB_NAME = "practice_config_copy_ci";
const FREE = "f6400000-0000-4000-8000-000000000001";
const PAID = "f6400000-0000-4000-8000-000000000002";
const CLIENT = "config-copy-ci";

/** Not the seeded 40 / 5 / 40, so a literal cannot pass. */
const DAILY_QUOTA_FREE = 37;
const DIAGNOSTIC_PER_DOMAIN = 6;
const DIAGNOSTIC_TOTAL = 48;

/** The eight canonical domains, as the diagnostic draws them (8 × per-domain). */
const DOMAINS: ReadonlyArray<readonly [string, string, string]> = [
  ["M", "Algebra", "ALG.D01"],
  ["M", "Advanced Math", "ADV.D01"],
  ["M", "Problem Solving and Data Analysis", "PSD.D01"],
  ["M", "Geometry and Trigonometry", "GEO.D01"],
  ["RW", "Information and Ideas", "INI.D01"],
  ["RW", "Craft and Structure", "CAS.D01"],
  ["RW", "Expression of Ideas", "EOI.D01"],
  ["RW", "Standard English Conventions", "SEC.D01"],
];

let pg: Client;
const session: { id: string | null } = { id: null };

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
      role: "student",
      isAdmin: false,
      isGuardian: false,
      is_under_13: false,
      profile_completed_at: "2026-09-01T00:00:00Z",
      actor_id: session.id,
    };
  }
  next();
}

let cachedApp: express.Express | null = null;
async function app(): Promise<express.Express> {
  if (cachedApp) return cachedApp;
  const { default: practiceRouter } =
    await import("../../server/routes/practice-canonical");
  const { default: diagnosticRouter } =
    await import("../../server/routes/diagnostic-routes");
  const { requireSupabaseAuth, requireStudentOrAdmin } =
    await import("../../server/middleware/supabase-auth");
  const a = express();
  a.use(express.json());
  a.use(injectSession);
  // As server/index.ts mounts it: the diagnostic before the practice router (CSRF left out).
  a.use(
    "/api/practice/diagnostic",
    requireSupabaseAuth,
    requireStudentOrAdmin,
    diagnosticRouter,
  );
  a.use(
    "/api/practice",
    requireSupabaseAuth,
    requireStudentOrAdmin,
    practiceRouter,
  );
  cachedApp = a;
  return a;
}

async function getAs(studentId: string, path: string) {
  session.id = studentId;
  return request(await app()).get(path);
}

async function setConfig(key: string, value: number): Promise<void> {
  const r = await pg.query(
    `UPDATE public.practice_runtime_config SET value = $2::jsonb WHERE key = $1`,
    [key, String(value)],
  );
  expect(r.rowCount).toBe(1);
}

describe.skipIf(!PG_AVAILABLE)(
  "OQ-68 (d) / UI-64: the copy's configured numbers are the server config — real Postgres",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      for (const id of [FREE, PAID]) {
        await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
          id,
          `${id}@example.test`,
        ]);
        await pg.query(
          `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth)
           VALUES ($1, $2, 'student', 'Someone', '2008-01-01'::date)`,
          [id, `${id}@example.test`],
        );
      }
      await pg.query(
        `INSERT INTO public.entitlements
           (profile_id, tier, status, stripe_subscription_id, stripe_subscription_item_id, current_period_end)
         VALUES ($1, 'premium', 'active', 'sub_oq68', 'si_oq68', now() + interval '20 days')`,
        [PAID],
      );
      // Six published questions in each canonical domain: the diagnostic's 8 × 6.
      for (const [d, [section, domain, skill]] of DOMAINS.entries()) {
        for (let i = 1; i <= DIAGNOSTIC_PER_DOMAIN; i += 1) {
          const id = `SAT${section}1C${d}${String(i).padStart(4, "0")}`;
          await pg.query(
            `INSERT INTO public.questions
               (id, section, source_type, domain, skill_codes, difficulty, stem, options,
                correct_answer, explanation, option_metadata, status, item_type, published_at)
             VALUES ($1,$2,1,$3,$4,$5,$6,
               '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
               'B',$7,
               '{"A":{"role":"distractor"},"B":{"role":"correct"},"C":{"role":"distractor"},"D":{"role":"distractor"}}'::jsonb,
               'published','mcq', now())`,
            [
              id,
              section,
              domain,
              [skill],
              (i % 3) + 1,
              `Stem ${id}`,
              `Expl ${id}`,
            ],
          );
        }
      }
      // Before the first request: the practice config is cached per process once read.
      await setConfig("daily_quota_free", DAILY_QUOTA_FREE);
      await setConfig("diagnostic_per_domain", DIAGNOSTIC_PER_DOMAIN);
      await setConfig("diagnostic_total_questions", DIAGNOSTIC_TOTAL);
    }, 120_000);

    afterAll(async () => {
      await pg?.end();
    });

    it("the quota read carries the configured free daily limit for a free and a paid student", async () => {
      const free = await getAs(FREE, "/api/practice/quota");
      expect(free.status).toBe(200);
      expect(practiceQuotaSchema.parse(free.body)).toMatchObject({
        unlimited: false,
        limit: DAILY_QUOTA_FREE,
        remaining: DAILY_QUOTA_FREE,
        freeDailyLimit: DAILY_QUOTA_FREE,
      });
      const paid = await getAs(PAID, "/api/practice/quota");
      expect(paid.status).toBe(200);
      expect(practiceQuotaSchema.parse(paid.body)).toEqual({
        unlimited: true,
        limit: null,
        remaining: null,
        resetAt: null,
        freeDailyLimit: DAILY_QUOTA_FREE,
      });
    });

    it("the open-sessions read carries the diagnostic's configured length, the one the real diagnostic is built with", async () => {
      const before = await getAs(FREE, "/api/practice/sessions/open");
      expect(before.status).toBe(200);
      const parsed = practiceOpenSessionsResponseSchema.parse(before.body);
      expect(parsed.diagnosticTotalQuestions).toBe(DIAGNOSTIC_TOTAL);
      expect(parsed.diagnosticPerDomain).toBe(DIAGNOSTIC_PER_DOMAIN);
      expect(parsed.sessions).toEqual([]);

      // Round trip: the real diagnostic start, then the same read shows it at that length.
      session.id = FREE;
      const started = await request(await app())
        .post("/api/practice/diagnostic/sessions")
        .send({ client_instance_id: CLIENT, idempotency_key: randomUUID() });
      expect(started.status).toBe(201);
      const after = practiceOpenSessionsResponseSchema.parse(
        (await getAs(FREE, "/api/practice/sessions/open")).body,
      );
      const diagnostic = after.sessions.find((s) => s.mode === "diagnostic");
      expect(diagnostic?.id).toBe(String(started.body.sessionId));
      expect(diagnostic?.target_question_count).toBe(
        after.diagnosticTotalQuestions,
      );
      const items = await pg.query(
        `SELECT count(*)::int AS n FROM public.practice_session_items WHERE session_id = $1`,
        [started.body.sessionId],
      );
      expect(Number(items.rows[0]?.n)).toBe(after.diagnosticTotalQuestions);
    });
  },
);
