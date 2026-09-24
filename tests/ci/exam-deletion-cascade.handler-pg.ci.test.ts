/**
 * Exam tables in the account-deletion cascade — full lifecycle against real PostgreSQL.
 *
 * @spec [Doc-05E, §1, §3 Rule 4, §5.1, §6 INV-05E-07; Doc-05D §10, §10.5;
 *        Doc-04A_V2.2, §7-§13; Doc-04B_V4.3, §9.4; SCL-143]
 * @implemented [2026-09-24]
 *
 * plain English: two students each take one whole exam through the real /api/tests
 * handlers (create -> 4 modules -> scored inline), then leave through the two deletion
 * entry points production uses:
 *   - ANON: complete_and_anonymize_account(request, profile) — the executor's T2 call,
 *     which marks the request completed and runs the cascade in 'anonymize' mode;
 *   - HARD: execute_account_deletion_cascade(profile, 'hard_delete') — the
 *     service_role-only internal path (Doc 05E §1).
 * Row counts for every exam table are read before and after and printed with the
 * cascade's result JSON (the evidence record), and a re-run of each is a no-op.
 *
 * What it proves (and what would turn it red):
 *   - anonymize keeps the session, its four children, the score run, the ledger row
 *     and the outbox row, with student_id NULL and actor_id = the student's former
 *     profiles.actor_id (CASCADE on the identity FK would delete them; NO ACTION would
 *     make the profile delete raise);
 *   - the score run is unchanged except student_id (the trigger admitted only that);
 *   - hard_delete removes every one of those rows, children included, and its result
 *     JSON counts each table exactly;
 *   - a re-run on the deleted profile returns no_op and changes nothing (§10.5).
 *
 * SCOPE AND LIMITS: as tests/ci/exam-runtime.handler-pg.ci.test.ts — both Supabase
 * clients are tests/helpers/pg-supabase over a SUPERUSER connection. Runs only where
 * PGHOST is set; named by file in CI. scripts/ci/exam-deletion-cascade-gates.sh covers
 * the sentinel, the trigger refusals and the pending-score cases.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import type { Client } from "pg";
import fs from "fs";
import path from "path";
import {
  makePgSupabase,
  bootstrapPgDatabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "exam_deletion_cascade_handler_ci";
const FORM = "e6bf0000-0000-4000-8000-0000000000b1";
const ANON = "00000000-0000-0000-0000-000000e6b101";
const HARD = "00000000-0000-0000-0000-000000e6b102";

const EXAM_TABLES = [
  "test_sessions",
  "test_session_sections",
  "test_session_items",
  "test_answer_submissions",
  "test_session_answers",
  "score_runs",
  "score_run_event_ledger",
  "exam_runtime_outbox",
] as const;
type Footprint = Record<(typeof EXAM_TABLES)[number], number>;

let testPg: Client | null = null;

/** PostgREST sends rpc arguments as JSON; encode arrays/objects the same way. */
function jsonArgs(
  args?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!args) return args;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = v !== null && typeof v === "object" ? JSON.stringify(v) : v;
  }
  return out;
}

function pgProxy() {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (!testPg) throw new Error("PG client not initialised");
        const sb = makePgSupabase(testPg);
        if (prop === "rpc") {
          return (fn: string, args?: Record<string, unknown>) =>
            sb.rpc(fn, jsonArgs(args));
        }
        return (sb as Record<string, unknown>)[prop as string];
      },
    },
  );
}

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: pgProxy(),
}));
vi.mock("../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => {
    if (!testPg) throw new Error("PG client not initialised");
    return makePgSupabase(testPg);
  },
}));

function authStub() {
  const pass = (_q: Request, _s: Response, next: NextFunction) => next();
  return {
    requireSupabaseAuth: pass,
    requireStudentOrAdmin: pass,
    requireProfileComplete: pass,
    requireConsentCompliance: pass,
  };
}
vi.mock("../../server/middleware/supabase-auth.js", () => authStub());
vi.mock("../../server/middleware/supabase-auth", () => authStub());

vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: {
    canAccessFeature: vi.fn(
      async (_profileId: string, featureKey: string) =>
        featureKey === "exam_full_length",
    ),
  },
}));

/** Row counts per exam table for a set of sessions (outbox by aggregate_id). */
async function footprint(pg: Client, sessions: string[]): Promise<Footprint> {
  const r = await pg.query(
    `SELECT (SELECT count(*) FROM public.test_sessions WHERE id = ANY ($1::uuid[]))::int AS test_sessions,
            (SELECT count(*) FROM public.test_session_sections WHERE test_session_id = ANY ($1::uuid[]))::int AS test_session_sections,
            (SELECT count(*) FROM public.test_session_items WHERE test_session_id = ANY ($1::uuid[]))::int AS test_session_items,
            (SELECT count(*) FROM public.test_answer_submissions WHERE test_session_id = ANY ($1::uuid[]))::int AS test_answer_submissions,
            (SELECT count(*) FROM public.test_session_answers WHERE test_session_id = ANY ($1::uuid[]))::int AS test_session_answers,
            (SELECT count(*) FROM public.score_runs WHERE test_session_id = ANY ($1::uuid[]))::int AS score_runs,
            (SELECT count(*) FROM public.score_run_event_ledger WHERE test_session_id = ANY ($1::uuid[]))::int AS score_run_event_ledger,
            (SELECT count(*) FROM public.exam_runtime_outbox WHERE aggregate_id = ANY ($1::uuid[]))::int AS exam_runtime_outbox`,
    [sessions],
  );
  return r.rows[0] as Footprint;
}

function table(label: string, before: Footprint, after: Footprint): string {
  const lines = EXAM_TABLES.map(
    (t) => `  ${t.padEnd(24)} ${String(before[t]).padStart(4)} -> ${after[t]}`,
  );
  return `[${label}] rows before -> after\n${lines.join("\n")}\n`;
}

describe.skipIf(!PG_AVAILABLE)(
  "Exam deletion cascade — full lifecycle → real PG",
  () => {
    let app: Express;

    beforeAll(async () => {
      testPg = await bootstrapPgDatabase(DB_NAME);
      const fixture = fs.readFileSync(
        path.resolve(__dirname, "../../scripts/ci/lib/exam-form-fixture.sql"),
        "utf-8",
      );
      await testPg.query(fixture);
      await testPg.query(
        `SELECT pg_temp.exam_fixture_make_form($1, 'H2', 20, 15)`,
        [FORM],
      );
      // Real-shaped options (the fixture's are placeholders), as the E6 handler test.
      await testPg.query(
        `
      UPDATE public.questions q
         SET options = jsonb_build_array(
               jsonb_build_object('key','A','text','Choice A of ' || q.id),
               jsonb_build_object('key','B','text','Choice B of ' || q.id),
               jsonb_build_object('key','C','text','Choice C of ' || q.id),
               jsonb_build_object('key','D','text','Choice D of ' || q.id))
        FROM public.test_form_items fi
       WHERE fi.question_id = q.id AND fi.test_form_id = $1 AND q.item_type = 'mcq'`,
        [FORM],
      );
      await testPg.query(
        `UPDATE public.test_forms SET status = 'published', published_at = now() WHERE id = $1`,
        [FORM],
      );
      for (const id of [ANON, HARD]) {
        await testPg.query(
          `INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`,
          [id, `${id}@example.test`],
        );
        await testPg.query(
          `INSERT INTO public.profiles (id, email, role) VALUES ($1::uuid, $2, 'student')`,
          [id, `${id}@example.test`],
        );
      }

      const { default: examRuntimeRouter } =
        await import("../../server/routes/exam-runtime-routes");
      app = express();
      app.use(express.json());
      app.use((req: Request, _res: Response, next: NextFunction) => {
        const user = req.header("x-test-user");
        if (user) {
          (req as unknown as { user: unknown }).user = {
            id: user,
            actor_id: user,
            role: "student",
          };
        }
        (req as unknown as { requestId: string }).requestId =
          "exam-deletion-pg";
        next();
      });
      app.use("/api/tests", examRuntimeRouter);
    }, 180_000);

    afterAll(async () => {
      await testPg?.end();
    });

    /** One whole exam through the HTTP handlers, answered by served token. */
    async function takeExam(student: string): Promise<string> {
      const pg = testPg!;
      const as = (r: request.Test) => r.set("x-test-user", student);
      const created = await as(request(app).post("/api/tests/sessions")).send({
        test_form_id: FORM,
        mode: "lenient",
      });
      expect(created.status).toBe(201);
      const sid: string = created.body.session_id;
      for (const section of ["RW", "M"] as const) {
        for (const module of ["1", "2"] as const) {
          const base = `/api/tests/sessions/${sid}/sections/${section}/modules/${module}`;
          expect((await as(request(app).post(`${base}/start`))).status).toBe(
            200,
          );
          const items = await as(request(app).get(`${base}/items`));
          expect(items.status).toBe(200);
          const oracle = await pg.query(
            `SELECT si.ordinal, q.item_type, q.correct_answer, si.option_token_map
               FROM public.test_session_items si JOIN public.questions q ON q.id = si.question_id
              WHERE si.test_session_id = $1 AND si.section = $2 AND left(si.module, 1) = $3`,
            [sid, section, module],
          );
          const byOrdinal = new Map(
            oracle.rows.map((r) => [r.ordinal as number, r]),
          );
          for (const item of items.body.items as Array<
            Record<string, unknown>
          >) {
            const o = byOrdinal.get(item.ordinal as number)!;
            const answer =
              o.item_type === "grid_in"
                ? "1"
                : Object.entries(
                    o.option_token_map as Record<string, string>,
                  ).find(([, key]) => key === o.correct_answer)![0];
            const res = await as(request(app).post("/api/tests/answer")).send({
              test_session_id: sid,
              section,
              module,
              question_id: item.question_id,
              ordinal: item.ordinal,
              answer,
              idempotency_key: `${sid}:${section}:${module}:${item.ordinal}`,
            });
            expect(res.status).toBe(200);
          }
          expect((await as(request(app).post(`${base}/submit`))).status).toBe(
            200,
          );
        }
      }
      return sid;
    }

    it("anonymize (the executor's T2 call) retains the exam under actor_id and severs the student", async () => {
      const pg = testPg!;
      const sid = await takeExam(ANON);
      const actor = (
        await pg.query(`SELECT actor_id FROM public.profiles WHERE id = $1`, [
          ANON,
        ])
      ).rows[0].actor_id as string;
      const scoreBefore = (
        await pg.query(
          `SELECT to_jsonb(r) - 'student_id' AS row, r.total_scaled FROM public.score_runs r WHERE test_session_id = $1`,
          [sid],
        )
      ).rows[0];
      expect(scoreBefore.total_scaled).toBe(1600); // scored inline, all correct
      const before = await footprint(pg, [sid]);
      for (const t of EXAM_TABLES) expect(before[t]).toBeGreaterThan(0);

      const req = await pg.query(
        `INSERT INTO public.account_deletion_requests
           (profile_id, scheduled_hard_delete_at, actor_profile_id, status)
         VALUES ($1, now() - interval '1 day', $1, 'pending') RETURNING id`,
        [ANON],
      );
      const result = (
        await pg.query(
          `SELECT public.complete_and_anonymize_account($1, $2) AS r`,
          [req.rows[0].id, ANON],
        )
      ).rows[0].r as {
        status: string;
        rows_affected: Record<string, number>;
      };
      const after = await footprint(pg, [sid]);
      process.stdout.write(table("anonymize", before, after));
      process.stdout.write(
        `[anonymize] result JSON ${JSON.stringify(result)}\n`,
      );

      expect(result.status).toBe("completed");
      expect(result.rows_affected.test_sessions).toBe(1);
      expect(result.rows_affected.score_runs).toBe(1);
      expect(after).toEqual(before);
      const sess = await pg.query(
        `SELECT student_id, actor_id FROM public.test_sessions WHERE id = $1`,
        [sid],
      );
      expect(sess.rows[0]).toEqual({ student_id: null, actor_id: actor });
      const scoreAfter = await pg.query(
        `SELECT to_jsonb(r) - 'student_id' AS row, r.student_id, r.actor_id FROM public.score_runs r WHERE test_session_id = $1`,
        [sid],
      );
      expect(scoreAfter.rows[0].student_id).toBeNull();
      expect(scoreAfter.rows[0].actor_id).toBe(actor);
      expect(scoreAfter.rows[0].row).toEqual(scoreBefore.row);
      const named = await pg.query(
        `SELECT (SELECT count(*) FROM public.test_sessions WHERE student_id = $1)
              + (SELECT count(*) FROM public.score_runs WHERE student_id = $1) AS n,
                (SELECT count(*) FROM public.profiles WHERE id = $1) AS profiles`,
        [ANON],
      );
      expect(Number(named.rows[0].n)).toBe(0);
      expect(Number(named.rows[0].profiles)).toBe(0);

      // §10.5: a re-run on the gone profile is a no-op
      const again = (
        await pg.query(
          `SELECT public.execute_account_deletion_cascade($1, 'anonymize') AS r`,
          [ANON],
        )
      ).rows[0].r as { status: string };
      expect(again.status).toBe("no_op");
      expect(await footprint(pg, [sid])).toEqual(before);
    }, 180_000);

    it("hard_delete removes every exam row, children included, and counts each table", async () => {
      const pg = testPg!;
      const sid = await takeExam(HARD);
      const before = await footprint(pg, [sid]);
      for (const t of EXAM_TABLES) expect(before[t]).toBeGreaterThan(0);

      await pg.query(
        `INSERT INTO public.account_deletion_requests
           (profile_id, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status, completion_at)
         VALUES ($1, now() - interval '1 day', $1, 'completed', 'completed', now())`,
        [HARD],
      );
      const result = (
        await pg.query(
          `SELECT public.execute_account_deletion_cascade($1, 'hard_delete') AS r`,
          [HARD],
        )
      ).rows[0].r as {
        status: string;
        rows_affected: Record<string, number>;
      };
      const after = await footprint(pg, [sid]);
      process.stdout.write(table("hard_delete", before, after));
      process.stdout.write(
        `[hard_delete] result JSON ${JSON.stringify(result)}\n`,
      );

      expect(result.status).toBe("completed");
      for (const t of EXAM_TABLES) {
        expect(after[t]).toBe(0);
        expect(result.rows_affected[t]).toBe(before[t]);
      }

      const again = (
        await pg.query(
          `SELECT public.execute_account_deletion_cascade($1, 'hard_delete') AS r`,
          [HARD],
        )
      ).rows[0].r as { status: string };
      expect(again.status).toBe("no_op");
    }, 180_000);
  },
);
