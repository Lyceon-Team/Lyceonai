/**
 * Mastery emission — the spec property, proven through the real stack.
 *
 * @spec [Doc-05A_V1.0 §4.3 idempotency, §4.6 formula, §4.9 downstream chain,
 *        §11.4 no special source type, §12.1 B2/B3;
 *        Doc-05B_V1.0 §4.9 KPI fan-out; Doc-05C_V1.0 §8.4 the single 05A→05C seam]
 * @implemented [2026-09-02]
 *
 * plain English: an answered question produces an attributable mastery event, which
 * updates skill and domain mastery, refreshes KPI, and bumps the projection counter.
 * This file proves that property — not a bug's mechanism — against a real Express
 * route, a real supabase-js client, real PostgREST, and real Postgres, as a real
 * service_role JWT.
 *
 * WHY THIS FILE WAS WRITTEN FROM THE SPEC RATHER THAN PORTED. Its predecessor,
 * mastery-emission.transport.ci.test.ts, encoded the seven-week outage's MECHANISM as
 * its contract: it asserted that a legacy NULL-occurred_at row ABORTS the whole
 * student's mastery write with KPI_HISTORICAL_DATA_INVALID. That was true when it was
 * written, and it was the diagnosis, not the fix. When the KPI surface was corrected to
 * quarantine instead of abort, the test had to be inverted to permit a spec-correct
 * change — which means it was never a specification, only a snapshot of a bug. It was
 * deleted rather than adapted. Nothing here is ported from it.
 *
 * WHAT ONLY THIS FILE CAN SEE. tests/ci/diagnostic.handler-pg.ci.test.ts already drives
 * POST /api/practice/answer through the real handler against real Postgres, and it is a
 * good test — but it vi.mocks BOTH Supabase clients and substitutes a node-pg adapter
 * running as the `postgres` superuser. A shim over a superuser connection cannot see a
 * transport fault, a missing GRANT, or a role problem, because there is no wire, no JWT
 * and no role. Those are exactly what a 100%-failure production outage was made of, and
 * every mocked suite in the repo stayed green throughout it. So this file mocks NOTHING
 * in the data path:
 *
 *   real Express route
 *     -> real supabase-js (the app's own lazy singletons, pointed by env)
 *       -> real PostgREST, authenticated by a real HS256 service_role JWT
 *         -> real Postgres carrying genesis + every migration
 *
 * Only auth and CSRF are mocked. They must be: `requireSupabaseAuth` validates tokens
 * against Supabase's /auth/v1, which PostgREST does not serve, and CSRF is a browser
 * concern with no bearing on the mastery seam. Everything between the HTTP request and
 * the database row is the real thing.
 *
 * HOW THE CLIENTS GET POINTED WITHOUT A MOCK. apps/api/src/lib/supabase-server.ts is a
 * Proxy that builds its client on first PROPERTY ACCESS, and supabase-admin.ts builds on
 * first CALL. Both read SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY at that moment. Setting
 * those before the app boots is therefore sufficient, and is not a substitution: the
 * object the route uses is the same class production uses.
 *
 * A path-shim proxy sits between supabase-js and PostgREST because supabase-js appends
 * /rest/v1 and PostgREST serves at /. It rewrites the path and nothing else — the
 * request body, the JWT, the role and the response are untouched.
 *
 * WHY events_since_refresh IS THE WITNESS. Doc 05C §8.4 locks
 * bump_projection_refresh_counter as the single 05A->05C seam, and
 * 20260613000000_lane_c_mastery_seam.sql calls it from apply_mastery_event as the last
 * statement before RETURN, after refresh_domain_mastery. §4.3's idempotency check
 * returns BEFORE both. So one counter answers two different questions:
 *   - it incremented  => the whole function body ran to completion, refreshers included
 *   - it did NOT move => the replay took the dedupe path and never reached the refreshers
 * Asserting the audit row alone would only prove the function STARTED.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "pg";
import crypto from "node:crypto";
import http from "node:http";
import request from "supertest";
import type { AddressInfo } from "node:net";
import type { Express, Request, Response, NextFunction } from "express";
import { vi } from "vitest";

const PGRST_URL = process.env.MASTERY_PGRST_URL ?? "";
const JWT_SECRET = process.env.MASTERY_PGRST_JWT_SECRET ?? "";
const DB_NAME = process.env.MASTERY_PGRST_DB ?? "mastery_postgrest_ci";
const CAN_RUN = PGRST_URL.length > 0 && JWT_SECRET.length > 0;

// Canonical ids: ^SAT(M|RW)[12][A-Z0-9]{6}$ (questions_id_check).
//
// FIVE distinct M questions, not one answered five times. The threshold cases need
// MIN_EVENTS_FOR_MASTERY events on ONE SKILL, which is five different questions
// tagged to that skill — exactly what Doc 05A §12.1 B3 describes. Re-serving one
// question id is not just unrealistic: the route resolves a session item by
// (session_id, question_id), so the second lookup would find the item it already
// answered and refuse it as a replay with 409, reddening the mastery assertion for a
// reason that has nothing to do with mastery.
const M_QUESTIONS = [
  "SATM1PGR001",
  "SATM1PGR002",
  "SATM1PGR003",
  "SATM1PGR004",
  "SATM1PGR005",
] as const;
const M_QUESTION = M_QUESTIONS[0];
const RW_QUESTION = "SATRW1PGR010";

const STUDENT_ID = "7c7c7c7c-1111-4111-8111-111111111111";
const SESSION_ID = "7c7c7c7c-2222-4222-8222-222222222222";
const POISON_SESSION_ID = "7c7c7c7c-3333-4333-8333-333333333333";

// Doc 05A §11.2 canonical strings. 'Problem Solving and Data Analysis' is unhyphenated;
// these two are the ones this file uses.
const M_DOMAIN = "Algebra";
const M_SKILL = "Linear equations in one variable";
const RW_DOMAIN = "Craft and Structure";
const RW_SKILL = "Words in Context";

/** Doc 05A §12.1 B3: five MEDIUM practice events, all correct, is level 4 exactly. */
const MEDIUM = 2;
const MIN_EVENTS_FOR_MASTERY = 5;
const B3_LEVEL_AT_THRESHOLD = 4;

// ---------------------------------------------------------------------------
// HS256 JWT minting — the same shape a Supabase anon / service key carries.
// ---------------------------------------------------------------------------
function mintJwt(role: string, secret: string): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const header = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64({
    role,
    iss: "supabase",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${header}.${payload}.${sig}`;
}

/** Rewrites /rest/v1/* to /* and proxies verbatim. Nothing else is altered. */
function startRestShim(
  upstream: string,
): Promise<{ url: string; close: () => Promise<void> }> {
  const target = new URL(upstream);
  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").replace(/^\/rest\/v1/, "");
    const proxyReq = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: path === "" ? "/" : path,
        method: req.method,
        headers: { ...req.headers, host: target.host },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on("error", () => {
      res.writeHead(502);
      res.end('{"message":"shim upstream error"}');
    });
    req.pipe(proxyReq);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

// CSRF is a browser concern and has no bearing on the mastery seam.
vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  generateToken: () => "test-csrf-token",
}));

const describeIf = CAN_RUN ? describe : describe.skip;

if (!CAN_RUN) {
  // process.stdout.write, not console.log: no-console is a hard rule here, and
  // the gate greps stdout for these markers, so they must reach the stream.
  process.stdout.write(
    "MASTERY-POSTGREST-PROOF: SKIPPED — MASTERY_PGRST_URL / MASTERY_PGRST_JWT_SECRET unset\n",
  );
}

describeIf(
  "mastery emission — real PostgREST, real route, real service_role",
  () => {
    let pg: Client;
    let shim: { url: string; close: () => Promise<void> };
    let app: Express;
    let applyMasteryEvent: typeof import("../../apps/api/src/services/mastery-write").applyMasteryEvent;
    let actorId: string;

    beforeAll(async () => {
      shim = await startRestShim(PGRST_URL);

      // Set BEFORE the app or the bridge is imported. The clients are lazy, so this
      // points the real supabase-js at real PostgREST without substituting anything.
      process.env.SUPABASE_URL = shim.url;
      process.env.SUPABASE_SERVICE_ROLE_KEY = mintJwt(
        "service_role",
        JWT_SECRET,
      );
      process.env.SUPABASE_ANON_KEY = mintJwt("anon", JWT_SECRET);
      process.env.VITEST = "true";
      process.env.NODE_ENV = "test";

      pg = new Client({
        host: process.env.PGHOST ?? "localhost",
        port: Number(process.env.PGPORT ?? 5432),
        user: process.env.PGUSER ?? "postgres",
        password: process.env.PGPASSWORD ?? "postgres",
        database: DB_NAME,
      });
      await pg.connect();

      // Auth only. Token validation goes to Supabase's /auth/v1, which PostgREST does
      // not serve; the identity it would return is not what this file is proving.
      const authModule = await import("../../server/middleware/supabase-auth");
      vi.spyOn(authModule, "supabaseAuthMiddleware").mockImplementation(
        (req: Request, _res: Response, next: NextFunction) => {
          (req as Record<string, unknown>).user = {
            id: STUDENT_ID,
            email: "postgrest-proof@example.com",
            role: "student",
            isAdmin: false,
            isGuardian: false,
            display_name: "Transport Proof Student",
          };
          next();
        },
      );
      vi.spyOn(authModule, "requireSupabaseAuth").mockImplementation(
        (req: Request, res: Response, next: NextFunction) => {
          if (!(req as Record<string, unknown>).user) {
            return res.status(401).json({ error: "auth_required" });
          }
          next();
        },
      );
      for (const mw of [
        "requireStudentOrAdmin",
        "requireProfileComplete",
        "requireConsentCompliance",
      ] as const) {
        vi.spyOn(authModule, mw).mockImplementation(
          (_req: Request, _res: Response, next: NextFunction) => next(),
        );
      }

      ({ applyMasteryEvent } =
        await import("../../apps/api/src/services/mastery-write"));
      const serverModule = await import("../../server/index");
      app = serverModule.default;

      process.stdout.write(
        `MASTERY-POSTGREST-PROOF: EXECUTING against real PostgREST at ${PGRST_URL}\n`,
      );
    }, 120_000);

    afterAll(async () => {
      if (pg) await pg.end();
      if (shim) await shim.close();
      vi.restoreAllMocks();
      delete process.env.VITEST;
    });

    // -------------------------------------------------------------------------
    // Fixtures
    // -------------------------------------------------------------------------
    beforeEach(async () => {
      for (const sql of [
        `DELETE FROM public.mastery_event_audit_log WHERE student_id = $1`,
        `DELETE FROM public.mastery_domain_refresh_audit_log WHERE student_id = $1`,
        `DELETE FROM public.student_projection_refresh_state WHERE student_id = $1`,
        `DELETE FROM public.student_domain_mastery WHERE student_id = $1`,
        `DELETE FROM public.student_skill_mastery WHERE student_id = $1`,
        // The KPI tables carry no FK to profiles, so nothing below cascades them.
        `DELETE FROM public.student_overall_kpi WHERE student_id = $1`,
        `DELETE FROM public.student_section_kpi WHERE student_id = $1`,
        `DELETE FROM public.student_domain_kpi WHERE student_id = $1`,
        `DELETE FROM public.student_skill_kpi WHERE student_id = $1`,
        `DELETE FROM public.practice_session_items WHERE user_id = $1`,
        `DELETE FROM public.practice_sessions WHERE user_id = $1`,
        `DELETE FROM public.entitlements WHERE profile_id = $1`,
        `DELETE FROM public.profiles WHERE id = $1`,
      ]) {
        await pg.query(sql, [STUDENT_ID]);
      }
      await pg.query(`DELETE FROM auth.users WHERE id = $1`, [STUDENT_ID]);

      await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
        STUDENT_ID,
        "postgrest-proof@example.com",
      ]);
      const { rows } = await pg.query(
        `SELECT actor_id FROM public.profiles WHERE id = $1`,
        [STUDENT_ID],
      );
      actorId = rows[0].actor_id;

      const seedRows: ReadonlyArray<readonly [string, string, string, string]> =
        [
          ...M_QUESTIONS.map(
            (q) =>
              [q, "M", M_DOMAIN, M_SKILL] as readonly [
                string,
                string,
                string,
                string,
              ],
          ),
          [RW_QUESTION, "RW", RW_DOMAIN, RW_SKILL] as const,
        ];
      for (const [qid, section, domain, skill] of seedRows) {
        await pg.query(
          `INSERT INTO public.questions
           (id, section, source_type, domain, skill_codes, difficulty, stem, options,
            correct_answer, explanation, status)
         VALUES ($1,$2,1,$3,ARRAY[$4],$5,'Stem',
           '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
           'B','Explanation','published')
         ON CONFLICT (id) DO NOTHING`,
          [qid, section, domain, skill, MEDIUM],
        );
      }

      await pg.query(
        `INSERT INTO public.practice_sessions
         (id, user_id, actor_id, mode, filters, target_count, platform,
          client_instance_id, status)
       VALUES ($1,$2,$3,'flow','{"target_question_count": 10}',10,'web','inst-pgrst','active')`,
        [SESSION_ID, STUDENT_ID, actorId],
      );
    });

    /** Serves one MCQ item so the route has something in 'served' to answer. */
    async function serveItem(
      ordinal: number,
      questionId: string = M_QUESTIONS[ordinal - 1] ?? M_QUESTION,
    ): Promise<string> {
      const isM = questionId !== RW_QUESTION;
      const { rows } = await pg.query(
        `INSERT INTO public.practice_session_items
         (session_id, user_id, actor_id, ordinal, question_id, question_stem,
          question_options, question_correct_answer, question_explanation,
          question_option_metadata, question_domain, question_skill,
          question_difficulty, question_section, status, question_item_type,
          option_order, option_token_map)
       VALUES ($1,$2,$9,$3,$4,'Stem',
         '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
         'B','Explanation',
         '{"A":{"role":"distractor","error_taxonomy":"common-misconception"},"B":{"role":"correct","error_taxonomy":null},"C":{"role":"distractor","error_taxonomy":"common-misconception"},"D":{"role":"distractor","error_taxonomy":"common-misconception"}}'::jsonb,
         $5,$6,$7,$8,'served','mcq',
         ARRAY['A','B','C','D']::text[],
         '{"opt_tok_A":"A","opt_tok_B":"B","opt_tok_C":"C","opt_tok_D":"D"}'::jsonb)
       RETURNING id`,
        [
          SESSION_ID,
          STUDENT_ID,
          ordinal,
          questionId,
          isM ? M_DOMAIN : RW_DOMAIN,
          isM ? M_SKILL : RW_SKILL,
          MEDIUM,
          isM ? "M" : "RW",
          actorId,
        ],
      );
      return rows[0].id as string;
    }

    /** Answers a served item CORRECTLY through the real route. 'opt_tok_B' maps to 'B'. */
    async function answer(questionId: string = M_QUESTION) {
      return request(app).post("/api/practice/answer").send({
        sessionId: SESSION_ID,
        questionId,
        selectedAnswer: "opt_tok_B",
      });
    }

    /**
     * A legacy answered row with NULL occurred_at, in a DIFFERENT section. The CHECK
     * from 20260816000000 forbids this state, which is the point: such a row can only
     * exist because it predates the constraint. Dropped for the insert and restored,
     * so the fixture reproduces history rather than pretending the constraint is absent.
     */
    async function seedPoisonRow(): Promise<void> {
      await pg.query(
        `INSERT INTO public.practice_sessions
         (id, user_id, actor_id, mode, filters, target_count, platform,
          client_instance_id, status)
       VALUES ($1,$2,$3,'flow','{"target_question_count": 5}',5,'web','inst-legacy','completed')`,
        [POISON_SESSION_ID, STUDENT_ID, actorId],
      );
      await pg.query(
        `ALTER TABLE public.practice_session_items
         DROP CONSTRAINT IF EXISTS psi_resolved_requires_occurred_at`,
      );
      await pg.query(
        `INSERT INTO public.practice_session_items
         (session_id, user_id, actor_id, ordinal, question_id, question_stem,
          question_options, question_correct_answer, question_explanation,
          question_domain, question_skill, question_difficulty, question_section,
          status, selected_answer, is_correct, outcome, answered_at, occurred_at)
       VALUES ($1,$2,$7,1,$3,'Stem','[{"key":"A","text":"a"}]'::jsonb,'B','Explanation',
         $4,$5,$6,'RW','answered','B',true,'correct', now() - interval '10 days', NULL)`,
        [
          POISON_SESSION_ID,
          STUDENT_ID,
          RW_QUESTION,
          RW_DOMAIN,
          RW_SKILL,
          MEDIUM,
          actorId,
        ],
      );
      await pg.query(
        `ALTER TABLE public.practice_session_items
         ADD CONSTRAINT psi_resolved_requires_occurred_at
         CHECK (status NOT IN ('answered','skipped') OR occurred_at IS NOT NULL)
         NOT VALID`,
      );
    }

    const one = async (
      sql: string,
    ): Promise<Record<string, unknown> | null> => {
      const { rows } = await pg.query(sql, [STUDENT_ID]);
      return rows.length ? (rows[0] as Record<string, unknown>) : null;
    };
    const num = async (sql: string): Promise<number> =>
      Number((await pg.query(sql, [STUDENT_ID])).rows[0].n);

    const auditCount = () =>
      num(
        `SELECT count(*) AS n FROM public.mastery_event_audit_log WHERE student_id=$1`,
      );
    const refreshCount = () =>
      num(
        `SELECT coalesce(max(events_since_refresh),0) AS n
         FROM public.student_projection_refresh_state WHERE student_id=$1`,
      );

    // =========================================================================
    // 1. The property itself.
    // =========================================================================
    it("an answered question produces an attributable event, mastery, KPI and a counter bump", async () => {
      await serveItem(1);

      const res = await answer();
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      // ATTRIBUTABLE — Doc 05A §4.8. A NULL student_id is the shape that made the
      // outage invisible: rows existed but belonged to nobody.
      const audit = await one(
        `SELECT student_id, event_source_kind, question_id, section, domain, skill
         FROM public.mastery_event_audit_log WHERE student_id=$1`,
      );
      expect(audit).not.toBeNull();
      expect(audit?.student_id).toBe(STUDENT_ID);
      expect(audit?.question_id).toBe(M_QUESTION);
      expect(audit?.section).toBe("M");
      expect(audit?.domain).toBe(M_DOMAIN);

      // SKILL + DOMAIN mastery — §4.7 upsert, then §4.9's refresh_domain_mastery.
      expect(
        await num(
          `SELECT count(*) AS n FROM public.student_skill_mastery WHERE student_id=$1`,
        ),
      ).toBe(1);
      expect(
        await num(
          `SELECT count(*) AS n FROM public.student_domain_mastery WHERE student_id=$1`,
        ),
      ).toBe(1);

      // KPI — Doc 05B §4.9 fans out to all four refreshers.
      expect(
        await num(
          `SELECT count(*) AS n FROM public.student_overall_kpi WHERE student_id=$1`,
        ),
      ).toBe(1);
      expect(
        await num(
          `SELECT count(*) AS n FROM public.student_section_kpi WHERE student_id=$1`,
        ),
      ).toBe(1);
      expect(
        await num(
          `SELECT events_total AS n FROM public.student_overall_kpi WHERE student_id=$1`,
        ),
      ).toBe(1);

      // TERMINAL STATEMENT — Doc 05C §8.4. This table held 0 rows for the whole outage.
      expect(await refreshCount()).toBe(1);
    });

    // =========================================================================
    // 2. Below the threshold. Doc 05A §12.1 B2.
    // =========================================================================
    it("below MIN_EVENTS_FOR_MASTERY the level is NULL — unmeasured is not level 0", async () => {
      for (let i = 1; i < MIN_EVENTS_FOR_MASTERY; i++) {
        await serveItem(i);
        expect((await answer(M_QUESTIONS[i - 1])).status).toBe(200);
      }

      const row = await one(
        `SELECT event_count_total, mastery_level, mastery_score
         FROM public.student_skill_mastery WHERE student_id=$1`,
      );
      expect(Number(row?.event_count_total)).toBe(MIN_EVENTS_FOR_MASTERY - 1);
      // Both assertions matter. "NULL" is the spec; "not 0" is the misreading that
      // would render a new student as the worst possible student.
      expect(row?.mastery_level).toBeNull();
      expect(row?.mastery_level).not.toBe(0);
      expect(row?.mastery_score).toBeNull();
    });

    // =========================================================================
    // 3. At the threshold. Doc 05A §12.1 B3 — 5 medium practice correct is level 4.
    // =========================================================================
    it("at MIN_EVENTS_FOR_MASTERY the level appears, at B3's locked value", async () => {
      for (let i = 1; i <= MIN_EVENTS_FOR_MASTERY; i++) {
        await serveItem(i);
        expect((await answer(M_QUESTIONS[i - 1])).status).toBe(200);
      }

      const row = await one(
        `SELECT event_count_total, mastery_level, mastery_score
         FROM public.student_skill_mastery WHERE student_id=$1`,
      );
      expect(Number(row?.event_count_total)).toBe(MIN_EVENTS_FOR_MASTERY);
      expect(row?.mastery_level).not.toBeNull();
      expect(Number(row?.mastery_level)).toBe(B3_LEVEL_AT_THRESHOLD);
      expect(Number(row?.mastery_score)).toBeCloseTo(1.0, 4);
    });

    // =========================================================================
    // 4. Idempotency. Doc 05A §4.3.
    // =========================================================================
    it("a replayed event_id takes the dedupe path and never reaches the refreshers", async () => {
      const itemId = await serveItem(1);
      expect((await answer()).status).toBe(200);

      expect(await auditCount()).toBe(1);
      const refreshAfterFirst = await refreshCount();
      expect(refreshAfterFirst).toBe(1);

      // The event_id for a practice attempt IS the practice_session_items row id. The
      // replay is issued through the bridge rather than a second HTTP POST on purpose:
      // the route has its OWN replay guard (`sessionItem.status !== 'served'`), so a
      // repeated POST would be answered by that guard and never reach the RPC. This
      // asserts §4.3's dedupe, which is a different mechanism.
      const replay = await applyMasteryEvent({
        studentId: STUDENT_ID,
        section: "M",
        domain: M_DOMAIN,
        skill: M_SKILL,
        difficulty: MEDIUM,
        sourceFamily: "practice",
        eventSourceKind: "practice_attempt",
        correct: true,
        occurredAt: new Date().toISOString(),
        eventId: itemId,
        questionId: M_QUESTION,
      });
      expect(replay.error ?? null).toBeNull();
      expect(replay.ok).toBe(true);

      // A NOTE ON WHAT THE NEXT ASSERTION CAN AND CANNOT PROVE. The counter check

      // below is CORROBORATING, not independently falsifiable, and the mutation harness

      // says so rather than shipping a mutation that appears to isolate it. Any event

      // that actually reached the refreshers would also have written a second audit row,

      // so it would red the count above first; and an event_id that is not derivable from

      // canonical_mastery_events is refused earlier still by the LC-D1-001 seam guard with

      // MASTERY_EVENT_NOT_DERIVED, which reds the error assertion above that. Measured,

      // not assumed: a fresh-UUID mutation was tried and died at the seam guard.

      // Wrote nothing twice.
      expect(await auditCount()).toBe(1);
      // And never reached the refreshers: §4.3 returns before §4.9's PERFORMs, so the
      // counter is unmoved. This is the assertion that separates "deduped" from
      // "ran again and happened to be idempotent".
      expect(await refreshCount()).toBe(refreshAfterFirst);
    });

    // =========================================================================
    // 5. Quarantine. The outage's DATA SHAPE, asserted as a property.
    // =========================================================================
    it("a NULL occurred_at row in another section is excluded and counted, and the event still commits", async () => {
      await seedPoisonRow();
      await serveItem(1);

      const res = await answer();
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      // The truth anchor is intact — this is what the abort used to destroy.
      expect(await auditCount()).toBe(1);
      expect(await refreshCount()).toBe(1);

      const kpi = await one(
        `SELECT excluded_event_count, events_total, sections_active
         FROM public.student_overall_kpi WHERE student_id=$1`,
      );
      // COUNTED — the exclusion is visible per student, which is what separates this
      // from a silent NULL filter.
      expect(Number(kpi?.excluded_event_count)).toBe(1);
      // EXCLUDED — and genuinely out of the numbers, not merely tallied. Only the M
      // event aggregates; the RW row contributes to no section.
      expect(Number(kpi?.events_total)).toBe(1);
      expect(Number(kpi?.sections_active)).toBe(1);
    });

    // =========================================================================
    // 6. The GRANT. Doc 05A §4.1 / genesis: service_role only, no authenticated grant.
    // =========================================================================
    it("an anon token is refused by the GRANT with SQLSTATE 42501", async () => {
      const itemId = await serveItem(1);
      const anonKey = mintJwt("anon", JWT_SECRET);

      // Issued as a raw request rather than through the bridge because
      // getSupabaseAdmin() memoises its client in a module-level singleton, so
      // re-importing with different env returns the ALREADY-BUILT service_role client
      // and would silently test nothing. The property under test is the GRANT plus
      // PostgREST's JWT-role mapping, and this exercises both directly.
      const res = await fetch(`${shim.url}/rest/v1/rpc/apply_mastery_event`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          p_student_id: STUDENT_ID,
          p_section: "M",
          p_domain: M_DOMAIN,
          p_skill: M_SKILL,
          p_difficulty: MEDIUM,
          p_source_family: "practice",
          p_event_source_kind: "practice_attempt",
          p_correct: true,
          p_occurred_at: new Date().toISOString(),
          p_event_id: itemId,
          p_question_id: M_QUESTION,
          p_section_state: null,
        }),
      });

      const body = (await res.json()) as { code?: string; message?: string };
      // The SQLSTATE is the load-bearing assertion. PostgREST 12 maps 42501 onto HTTP
      // 401 rather than 403; the status is recorded so an upgrade that changes the
      // mapping surfaces as a deliberate review rather than a silent pass.
      expect(body.code).toBe("42501");
      expect(res.status).toBe(401);
      expect(body.message ?? "").toMatch(/permission denied/i);

      // and nothing was written
      expect(await auditCount()).toBe(0);
    });
  },
);
