/**
 * Owner report 2026-10-05: a production signup emitted no `user_signed_up` and left
 * `profiles.analytics_user_id` NULL. This proves the onboarding PATCH -> emitEvent path end to end.
 *
 * @spec [Doc 07A V1.0 §6.2 (user_signed_up), §7.1 (analytics_user_id written once), §9.2 (the
 *       wrapper's steps); SCL-201 IS 6 (signup_source); SCL-213 IS 5 (refusal reasons); owner
 *       Step 0 decision 2 (2026-10-05: user_signed_up fires at onboarding completion)]
 *       | @implemented [2026-10-05]
 *
 * plain English: the REAL profile router and the REAL `emitEvent` (its production dependencies:
 * the profile read, the set-once write, the posthog-node send) over real Postgres. Only three
 * things are injected: the session identity, the Supabase transport (real SQL), and the PostHog
 * SDK class, whose `captureImmediate` records what would have gone out. Proved:
 *   - configured: a first completion writes analytics_user_id and sends exactly one
 *     user_signed_up carrying the stored signup_source and that id; consent_captured follows a
 *     marketing grant, after it; a second completion sends nothing more;
 *   - NOT configured (the production failure): nothing is sent, analytics_user_id stays NULL, and
 *     the logs say so at ERROR — `emit_not_configured` naming the variable (never its value) and
 *     `signup_event_missed` at the call site. Before this change both were silent.
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
  afterEach,
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

const DB_NAME = "signup_analytics_ci";
const STUDENT = {
  id: "f8100000-0000-4000-8000-000000000001",
  email: "signup-analytics@example.test",
};
const SALT = "s".repeat(40);

let pg: Client;
const captured: {
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
}[] = [];
const logged = vi.hoisted(() => [] as { level: string; args: unknown[] }[]);

vi.mock("posthog-node", () => ({
  PostHog: class {
    async captureImmediate(message: {
      event: string;
      distinctId: string;
      properties: Record<string, unknown>;
    }): Promise<void> {
      captured.push(message);
    }
  },
}));
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
vi.mock("../../server/logger", async (importOriginal) => {
  const actual = await importOriginal<{ logger: Record<string, unknown> }>();
  const record =
    (level: string) =>
    (...args: unknown[]): void => {
      logged.push({ level, args });
    };
  return {
    ...actual,
    logger: {
      ...actual.logger,
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
      debug: record("debug"),
    },
  };
});
vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getSupabaseAdmin: () => makePgSupabase(pg),
    requireSupabaseAuth: (req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user?: unknown }).user = {
        id: STUDENT.id,
        email: STUDENT.email,
        display_name: null,
        role: "student",
        isAdmin: false,
        isGuardian: false,
        is_under_13: false,
        actor_id: STUDENT.id,
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
    req.requestId = "req-signup-analytics";
    next();
  });
  app.use("/api/profile", requireSupabaseAuth, profileRoutes);
  return app;
}

function dob15(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 15);
  return d.toISOString().slice(0, 10);
}

async function analyticsId(): Promise<string | null> {
  const r = await pg.query<{ analytics_user_id: string | null }>(
    `SELECT analytics_user_id FROM public.profiles WHERE id = $1`,
    [STUDENT.id],
  );
  return r.rows[0]?.analytics_user_id ?? null;
}

const ENV_KEYS = ["POSTHOG_API_KEY", "POSTHOG_HOST", "ANALYTICS_SALT"] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {};

describe.skipIf(!PG_AVAILABLE)(
  "user_signed_up at onboarding completion (real router, real emitEvent, real Postgres)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
        STUDENT.id,
        STUDENT.email,
      ]);
      for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    }, 180_000);

    beforeEach(async () => {
      captured.length = 0;
      logged.length = 0;
      await pg.query(`DELETE FROM public.profiles WHERE id = $1`, [STUDENT.id]);
      // A brand-new account as handle_new_user leaves it.
      await pg.query(
        `INSERT INTO public.profiles (id, email, role) VALUES ($1, $2, 'student')`,
        [STUDENT.id, STUDENT.email],
      );
    });

    afterEach(() => {
      for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
      }
    });

    afterAll(async () => {
      await pg?.end();
    });

    it("configured: writes analytics_user_id and sends one user_signed_up with the stored source, then consent_captured", async () => {
      process.env.POSTHOG_API_KEY = "phc_test";
      process.env.POSTHOG_HOST = "https://us.i.posthog.com";
      process.env.ANALYTICS_SALT = SALT;
      expect(await analyticsId()).toBeNull(); // presence before absence

      // What POST /api/auth/signup does with the body the browser sent (the first-touch
      // channel; tests/e2e/first-touch-attribution.spec.ts proves the browser sends `paid_ad`
      // after a UTM landing and a full page load).
      const { recordSignupSource } =
        await import("../../server/lib/analytics/signup-source");
      await recordSignupSource(STUDENT.id, "paid_ad", "req-signup");
      const stored = await pg.query<{ signup_source: string | null }>(
        `SELECT signup_source FROM public.profiles WHERE id = $1`,
        [STUDENT.id],
      );
      expect(stored.rows[0]?.signup_source).toBe("paid_ad");

      const app = await loadApp();
      const res = await request(app).patch("/api/profile").send({
        displayName: "Sam",
        role: "student",
        dateOfBirth: dob15(),
        marketingOptIn: true,
      });
      expect(res.status).toBe(200);

      const id = await analyticsId();
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(captured.map((c) => c.event)).toEqual([
        "user_signed_up",
        "consent_captured",
      ]);
      expect(captured[0]).toMatchObject({
        distinctId: id,
        properties: { signup_source: "paid_ad", analytics_user_id: id },
      });

      // A second completion (a re-submitted form) sends nothing more.
      captured.length = 0;
      const again = await request(app).patch("/api/profile").send({
        displayName: "Sam",
        role: "student",
        dateOfBirth: dob15(),
      });
      expect(again.status).toBe(200);
      expect(captured).toEqual([]);
    });

    it("NOT configured: nothing is sent, the id stays NULL, and both the wrapper and the call site log at ERROR, naming the variable only", async () => {
      process.env.POSTHOG_API_KEY = "phc_test";
      process.env.ANALYTICS_SALT = "too-short-salt"; // under the 32-character minimum
      process.env.POSTHOG_HOST = "us.i.posthog.com"; // no scheme: not a URL
      const app = await loadApp();
      const res = await request(app).patch("/api/profile").send({
        displayName: "Sam",
        role: "student",
        dateOfBirth: dob15(),
      });
      expect(res.status).toBe(200); // analytics failing never fails the request
      expect(captured).toEqual([]);
      expect(await analyticsId()).toBeNull();

      const errors = logged.filter((l) => l.level === "error");
      const operations = errors.map((l) => l.args[1]);
      expect(operations).toContain("emit_not_configured");
      expect(operations).toContain("signup_event_missed");
      const notConfigured = errors.find(
        (l) => l.args[1] === "emit_not_configured",
      );
      const text = JSON.stringify(notConfigured?.args);
      expect(text).toContain("ANALYTICS_SALT:too_small");
      expect(text).toContain("POSTHOG_HOST:invalid_string");
      // Never the values.
      expect(text).not.toContain("too-short-salt");
      expect(text).not.toContain("us.i.posthog.com");
      expect(text).not.toContain("phc_test");
    });
  },
);
