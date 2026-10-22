/**
 * Private feedback's new context on real Postgres: what is stored, what the table refuses, the
 * under-13 reply rule, the rate-limit bucket, the cascade and the grants as service_role.
 *
 * @spec [final brief "Trustpilot card on the homepage + 'Feedback' across the site" (Karl,
 *       2026-10-20) §3 (reply-OK refused by the server for under-13s; the route pattern only;
 *       the app version), §4 (the existing store: server-only writes, the 2,000-character cap,
 *       10 a day, deleted with the account; grants checked as service_role — the #1248 lesson;
 *       deletion cascade classified), acceptance "storage persists; grants as service_role;
 *       deletion cascade"; supabase/migrations/20261108000000_feedback_context.sql]
 *       | @implemented [2026-10-20]
 *
 * plain English: the whole migration pipeline, then direct calls. The grants are exercised, not
 * read: the writer is CALLED as a role holding exactly service_role's grants plus BYPASSRLS (as
 * Supabase's service_role has), the review-ask suite's probe pattern. Runs only where PGHOST is
 * set; named by file in CI.
 */
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapPgDatabase, PG_AVAILABLE } from "../helpers/pg-supabase";

const DB_NAME = "feedback_context_ci";
const P = (n: number): string =>
  `9f000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADULT = P(1);
const TEEN = P(2);
const CHILD = P(3);
const NO_DOB_STUDENT = P(4);
const GUARDIAN = P(5);
const PROBE = P(6);

let pg: Client;

const yearsAgo = (years: number): string => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};

async function person(
  id: string,
  role: "student" | "guardian",
  dob: string | null,
): Promise<void> {
  await pg.query(
    `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [id, `${id}@example.test`],
  );
  await pg.query(
    `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth, profile_completed_at)
     VALUES ($1, $2, $3, 'CI', $4::date, now())`,
    [id, `${id}@example.test`, role, dob],
  );
}

let keyN = 0;
const key = (): string =>
  `7a7a7a7a-1111-4222-8333-${String((keyN += 1)).padStart(12, "0")}`;

async function submit(
  id: string,
  over: {
    audience?: string;
    type?: string;
    reply?: boolean;
    route?: string | null;
    version?: string | null;
    source?: string;
  } = {},
): Promise<string> {
  const r = await pg.query<{ r: { outcome: string } }>(
    `SELECT public.product_feedback_submit($1, $2, 'A note', $3, $4::uuid, $5, $6, $7, $8) AS r`,
    [
      id,
      over.audience ?? "student",
      over.source ?? "menu",
      key(),
      over.type ?? "bug",
      over.reply ?? false,
      over.route === undefined ? "/practice/session/:sessionId" : over.route,
      over.version === undefined ? "abc1234" : over.version,
    ],
  );
  return r.rows[0]?.r.outcome ?? "none";
}

async function refused(sql: string, params: unknown[]): Promise<string> {
  await pg.query("SAVEPOINT probe");
  let message = "";
  try {
    await pg.query(sql, params);
  } catch (err: unknown) {
    message = err instanceof Error ? err.message : String(err);
  }
  await pg.query("ROLLBACK TO SAVEPOINT probe");
  return message;
}

describe.skipIf(!PG_AVAILABLE)("feedback context → real PG", () => {
  beforeAll(async () => {
    pg = await bootstrapPgDatabase(DB_NAME);
    await person(ADULT, "student", yearsAgo(19));
    await person(TEEN, "student", yearsAgo(15));
    await person(CHILD, "student", yearsAgo(11));
    await person(NO_DOB_STUDENT, "student", null);
    await person(GUARDIAN, "guardian", null);
    await person(PROBE, "student", yearsAgo(16));
    await pg.query("BEGIN");
  }, 300_000);

  afterAll(async () => {
    await pg?.query("ROLLBACK").catch(() => undefined);
    await pg?.end();
  });

  it("stores the type, reply choice, route pattern and app version, and they read back as written", async () => {
    expect(await submit(TEEN, { type: "idea", reply: true })).toBe("created");
    const rows = await pg.query(
      `SELECT type, reply_ok, route_pattern, app_version, source FROM public.product_feedback
        WHERE profile_id = $1`,
      [TEEN],
    );
    expect(rows.rows).toEqual([
      {
        type: "idea",
        reply_ok: true,
        route_pattern: "/practice/session/:sessionId",
        app_version: "abc1234",
        source: "menu",
      },
    ]);
  });

  it("the table refuses a real id, a query string, a bad version or an unknown type", async () => {
    for (const [route, version, type] of [
      [
        "/practice/session/5e5e5e5e-1111-4222-8333-444444444444",
        "abc1234",
        "bug",
      ],
      ["/dashboard?x=1", "abc1234", "bug"],
      ["/dashboard", "1.0.0", "bug"],
      ["/dashboard", "abc1234", "rant"],
    ] as const) {
      expect(
        await refused(
          `SELECT public.product_feedback_submit($1, 'student', 'x', 'menu', $2::uuid, $3, false, $4, $5)`,
          [ADULT, key(), type, route, version],
        ),
      ).toMatch(/violates check constraint/);
    }
  });

  it("the 2,000-character cap holds", async () => {
    expect(
      await refused(
        `SELECT public.product_feedback_submit($1, 'student', $2, 'menu', $3::uuid)`,
        [ADULT, "x".repeat(2001), key()],
      ),
    ).toMatch(/violates check constraint/);
  });

  it("reply-OK is refused for an under-13 or unknown-age student; allowed for 13+ and a guardian", async () => {
    for (const id of [CHILD, NO_DOB_STUDENT]) {
      expect(
        await refused(
          `SELECT public.product_feedback_submit($1, 'student', 'x', 'menu', $2::uuid, 'bug', true)`,
          [id, key()],
        ),
      ).toMatch(/reply_ok is not allowed/);
    }
    // Without the reply, a child's feedback is stored (always available).
    expect(await submit(CHILD, { reply: false })).toBe("created");
    expect(await submit(ADULT, { reply: true })).toBe("created");
    expect(
      await submit(GUARDIAN, {
        audience: "guardian",
        reply: true,
        route: "/guardian/:id",
      }),
    ).toBe("created");
  });

  it("the old five-argument call still works (the review ask's prompt feedback) and still ends the asks", async () => {
    const r = await pg.query<{ r: { outcome: string } }>(
      `SELECT public.product_feedback_submit($1, 'student', 'From the ask', 'prompt', $2::uuid) AS r`,
      [ADULT, key()],
    );
    expect(r.rows[0]?.r.outcome).toBe("created");
    const s = await pg.query(
      `SELECT last_response FROM public.product_review_prompt_state WHERE profile_id = $1`,
      [ADULT],
    );
    expect(s.rows).toEqual([{ last_response: "feedback" }]);
  });

  it("the per-profile rate-limit bucket is still 10 a day", async () => {
    const r = await pg.query(
      `SELECT value -> 'product_feedback' AS b FROM public.rate_limit_runtime_config WHERE key = 'bucket_definitions'`,
    );
    expect(r.rows[0]?.b).toEqual({ limit: 10, window_seconds: 86400 });
  });

  it("grants: anon and authenticated execute nothing; service_role writes through both functions", async () => {
    const fns = [
      "product_feedback_submit(uuid, text, text, text, uuid, text, boolean, text, text)",
      "product_feedback_reply_allowed(uuid)",
    ];
    const rows = await pg.query<{
      anon: boolean;
      authd: boolean;
      svc: boolean;
    }>(
      `SELECT has_function_privilege('anon', ('public.' || f)::regprocedure, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'EXECUTE') AS authd,
              has_function_privilege('service_role', ('public.' || f)::regprocedure, 'EXECUTE') AS svc
         FROM unnest($1::text[]) AS f`,
      [fns],
    );
    expect(rows.rows).toEqual([
      { anon: false, authd: false, svc: true },
      { anon: false, authd: false, svc: true },
    ]);
    await pg.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fb_service_role_probe') THEN
          CREATE ROLE fb_service_role_probe NOLOGIN BYPASSRLS INHERIT;
        END IF;
      END $$;
      GRANT service_role TO fb_service_role_probe;
    `);
    await pg.query("SAVEPOINT probe_role");
    await pg.query("SET LOCAL ROLE fb_service_role_probe");
    const outcome = await submit(PROBE, { reply: true, type: "other" });
    const allowed = await pg.query<{ ok: boolean }>(
      `SELECT public.product_feedback_reply_allowed($1) AS ok`,
      [CHILD],
    );
    await pg.query("RELEASE SAVEPOINT probe_role");
    await pg.query("RESET ROLE");
    expect(outcome).toBe("created");
    expect(allowed.rows[0]?.ok).toBe(false);
  });

  it("deletion cascades from profiles", async () => {
    const fk = await pg.query(
      `SELECT confdeltype FROM pg_constraint
        WHERE conrelid = 'public.product_feedback'::regclass AND contype = 'f'`,
    );
    expect(fk.rows).toEqual([{ confdeltype: "c" }]);
    const before = await pg.query(
      `SELECT count(*)::int AS n FROM public.product_feedback WHERE profile_id = $1`,
      [TEEN],
    );
    expect(before.rows[0]?.n).toBeGreaterThan(0);
    await pg.query(`DELETE FROM public.profiles WHERE id = $1`, [TEEN]);
    const after = await pg.query(
      `SELECT count(*)::int AS n FROM public.product_feedback WHERE profile_id = $1`,
      [TEEN],
    );
    expect(after.rows[0]?.n).toBe(0);
  });
});
