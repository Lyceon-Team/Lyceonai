/**
 * Onboarding events to Resend Automations — the real onboarding route over real Postgres.
 *
 * @spec [owner brief "Email lane — send onboarding events to Resend" + ruling (Karl, 2026-10-12)
 *       acceptance: "one event per first completion; none for under-13, deletion-pending or
 *       denylisted accounts"] | @implemented [2026-10-12]
 *
 * plain English: the REAL profile router, the REAL server/lib/lifecycle-email.ts and the REAL
 * transport, over real Postgres. Substituted: the session identity, the Supabase transport (real
 * SQL), the logger (captured) and the network — a fake Resend behind `fetch` that records every
 * call and answers like the API (404 on PATCH of an unknown contact, then POST creates it).
 *   O1  a first completion (student, 15) upserts the contact with first_name + role and sends
 *       exactly one `lyceon.onboarded` { role: "student" }, after the response
 *   O2  a second completion (a re-submitted form) sends nothing
 *   O3  a guardian's first completion sends { role: "guardian" }
 *   O4  an under-13 student: nothing reaches Resend
 *   O5  a pending deletion request: nothing reaches Resend
 *   O6  a denylisted domain, and a "test" local part: nothing reaches Resend
 *   O7  a username for a display name: the contact has no first_name
 *   L1  no address appears in any log line
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

const DB_NAME = "lifecycle_email_ci";
const USER = {
  id: "f8200000-0000-4000-8000-000000000001",
  email: "ana.lopez@school.example",
};

let pg: Client;
const identity = vi.hoisted(() => ({
  email: "ana.lopez@school.example",
  role: "student" as "student" | "guardian",
}));
const logged = vi.hoisted(() => [] as { level: string; args: unknown[] }[]);
const resend = vi.hoisted(() => ({
  calls: [] as {
    method: string;
    path: string;
    body: Record<string, unknown> | null;
  }[],
  contacts: new Set<string>(),
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
        id: USER.id,
        email: identity.email,
        display_name: null,
        role: identity.role,
        isAdmin: false,
        isGuardian: identity.role === "guardian",
        is_under_13: false,
        actor_id: USER.id,
      };
      next();
    },
  };
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

async function fakeResend(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<globalThis.Response> {
  const url = new URL(typeof input === "string" ? input : input.toString());
  if (url.hostname !== "api.resend.com") {
    throw new Error(`unexpected network call to ${url.hostname}`);
  }
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body
    ? (JSON.parse(String(init.body)) as Record<string, unknown>)
    : null;
  resend.calls.push({ method, path: decodeURIComponent(url.pathname), body });
  const one = /^\/contacts\/([^/]+)$/.exec(url.pathname);
  if (method === "PATCH" && one) {
    const email = decodeURIComponent(one[1]!);
    if (!resend.contacts.has(email)) {
      return json(
        { message: "not found" },
        404,
      ) as unknown as globalThis.Response;
    }
    return json({
      object: "contact",
      id: "c_1",
    }) as unknown as globalThis.Response;
  }
  if (method === "POST" && url.pathname === "/contacts") {
    resend.contacts.add(String(body?.email));
    return json({
      object: "contact",
      id: "c_1",
    }) as unknown as globalThis.Response;
  }
  if (method === "POST" && url.pathname === "/events/send") {
    return json(
      { object: "event", event: body?.event },
      202,
    ) as unknown as globalThis.Response;
  }
  return json({ message: "unexpected" }, 500) as unknown as globalThis.Response;
}

async function loadApp(): Promise<express.Express> {
  const { default: profileRoutes } =
    await import("../../server/routes/profile-routes");
  const { requireSupabaseAuth } =
    await import("../../server/middleware/supabase-auth");
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.requestId = "req-lifecycle";
    next();
  });
  app.use("/api/profile", requireSupabaseAuth, profileRoutes);
  return app;
}

function yearsAgo(n: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
}

const events = () => resend.calls.filter((c) => c.path === "/events/send");

/** The fire-and-forget skip is logged; wait for that line instead of a fixed sleep. */
async function waitForSkip(reason: string): Promise<void> {
  await vi.waitFor(() => {
    expect(
      logged.some(
        (l) =>
          l.args[1] === "skipped" &&
          JSON.stringify(l.args).includes(`"reason":"${reason}"`),
      ),
    ).toBe(true);
  });
}

async function seedAccount(email: string, role: "student" | "guardian") {
  identity.email = email;
  identity.role = role;
  await pg.query(
    `DELETE FROM public.account_deletion_requests WHERE profile_id = $1`,
    [USER.id],
  );
  await pg.query(`DELETE FROM public.profiles WHERE id = $1`, [USER.id]);
  await pg.query(`UPDATE auth.users SET email = $2 WHERE id = $1`, [
    USER.id,
    email,
  ]);
  await pg.query(
    `INSERT INTO public.profiles (id, email, role) VALUES ($1, $2, $3)`,
    [USER.id, email, role],
  );
}

describe.skipIf(!PG_AVAILABLE)(
  "onboarding events to Resend (real router, real lifecycle module, real Postgres)",
  () => {
    const saved: Record<string, string | undefined> = {};

    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
        USER.id,
        USER.email,
      ]);
      for (const k of ["RESEND_API_KEY", "LIFECYCLE_EMAIL_DENYLIST"]) {
        saved[k] = process.env[k];
      }
    }, 180_000);

    beforeEach(async () => {
      logged.length = 0;
      resend.calls.length = 0;
      resend.contacts.clear();
      process.env.RESEND_API_KEY = "re_test_lifecycle";
      process.env.LIFECYCLE_EMAIL_DENYLIST = "lyceon.ai, karl@founder.example";
      vi.stubGlobal("fetch", vi.fn(fakeResend));
      await seedAccount(USER.email, "student");
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });

    afterAll(async () => {
      await pg?.end();
    });

    it("O1 + O2: a first completion sends exactly one lyceon.onboarded with role and first name; a second completion sends nothing", async () => {
      const app = await loadApp();
      const res = await request(app)
        .patch("/api/profile")
        .send({
          displayName: "Ana Lopez",
          role: "student",
          dateOfBirth: yearsAgo(15),
        });
      expect(res.status).toBe(200);
      await vi.waitFor(() => expect(events()).toHaveLength(1));

      // Upsert first (PATCH 404 → POST create, in no segment), then the event.
      expect(resend.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
        `PATCH /contacts/${USER.email}`,
        "POST /contacts",
        "POST /events/send",
      ]);
      expect(resend.calls[1]?.body).toEqual({
        email: USER.email,
        unsubscribed: false,
        first_name: "Ana",
        properties: { role: "student" },
      });
      expect(resend.calls[2]?.body).toEqual({
        event: "lyceon.onboarded",
        email: USER.email,
        payload: { role: "student" },
      });

      // O2: the form re-submitted. Only the first completion counts.
      resend.calls.length = 0;
      const again = await request(app)
        .patch("/api/profile")
        .send({
          displayName: "Ana Lopez",
          role: "student",
          dateOfBirth: yearsAgo(15),
        });
      expect(again.status).toBe(200);
      await new Promise((r) => setTimeout(r, 300));
      expect(resend.calls).toEqual([]);

      // L1: no address in any log line.
      expect(JSON.stringify(logged)).not.toContain(USER.email);
    });

    it("O3: a guardian's first completion sends role guardian", async () => {
      await seedAccount("pat.parent@home.example", "guardian");
      const app = await loadApp();
      const res = await request(app)
        .patch("/api/profile")
        .send({
          displayName: "Pat Parent",
          role: "guardian",
          dateOfBirth: yearsAgo(45),
        });
      expect(res.status).toBe(200);
      await vi.waitFor(() => expect(events()).toHaveLength(1));
      expect(events()[0]?.body).toMatchObject({
        event: "lyceon.onboarded",
        payload: { role: "guardian" },
      });
    });

    it("O4: an under-13 student — nothing reaches Resend", async () => {
      const app = await loadApp();
      const res = await request(app)
        .patch("/api/profile")
        .send({
          displayName: "Kid Lopez",
          role: "student",
          dateOfBirth: yearsAgo(11),
        });
      expect(res.status).toBe(200);
      await waitForSkip("under_13");
      expect(resend.calls).toEqual([]);
    });

    it("O5: a pending deletion request — nothing reaches Resend", async () => {
      await pg.query(
        `INSERT INTO public.account_deletion_requests
           (profile_id, scheduled_hard_delete_at, actor_profile_id, status, requested_at)
         VALUES ($1, now() + interval '7 days', $1, 'pending', now())`,
        [USER.id],
      );
      const app = await loadApp();
      const res = await request(app)
        .patch("/api/profile")
        .send({
          displayName: "Ana Lopez",
          role: "student",
          dateOfBirth: yearsAgo(15),
        });
      expect(res.status).toBe(200);
      await waitForSkip("deletion_pending");
      expect(resend.calls).toEqual([]);
    });

    it("O6: a denylisted domain and a 'test' local part — nothing reaches Resend", async () => {
      for (const email of ["karl@lyceon.ai", "qa-test7@gmail.example"]) {
        logged.length = 0;
        await seedAccount(email, "student");
        const app = await loadApp();
        const res = await request(app)
          .patch("/api/profile")
          .send({
            displayName: "Karl",
            role: "student",
            dateOfBirth: yearsAgo(30),
          });
        expect(res.status).toBe(200);
        await waitForSkip("denylisted");
        expect(resend.calls).toEqual([]);
      }
    });

    it("O7: a username for a display name — the contact has no first_name, the event still goes", async () => {
      await seedAccount("ana99@school.example", "student");
      const app = await loadApp();
      const res = await request(app)
        .patch("/api/profile")
        .send({
          displayName: "ana99",
          role: "student",
          dateOfBirth: yearsAgo(16),
        });
      expect(res.status).toBe(200);
      await vi.waitFor(() => expect(events()).toHaveLength(1));
      const created = resend.calls.find(
        (c) => c.method === "POST" && c.path === "/contacts",
      );
      expect(created?.body).toEqual({
        email: "ana99@school.example",
        unsubscribed: false,
        properties: { role: "student" },
      });
    });
  },
);
