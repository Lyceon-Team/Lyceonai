/**
 * Mastery emission — REAL TRANSPORT proof.
 *
 * @spec [Doc-05A_V1.0 §4.1 seam, §4.9 downstream chain; Doc-05B_V1.0 §4.9 KPI fan-out]
 * @implemented [2026-08-16]
 *
 * plain English: this is the only test in the repo that issues a REAL PostgREST RPC
 * as a REAL service_role. Nothing is vi.mocked. The handler's own Supabase clients
 * are used, pointed by environment variable at a PostgREST instance in front of a
 * database carrying genesis + every migration. Driven by
 * scripts/ci/mastery-transport-gate.sh, which stands the stack up.
 *
 * WHY IT EXISTS: every pre-existing mastery test mocks the client.
 * diagnostic.handler-pg.ci.test.ts substitutes a node-pg adapter running as the
 * `postgres` superuser, so it cannot see a transport fault, a missing GRANT, or a
 * role problem — and it runs on a fresh database, so it cannot see a data-state
 * fault either. Every one of those tests was green throughout a seven-week,
 * 100%-failure production outage.
 *
 * THE POISON SEED IS THE POINT. Before the clean answer is submitted, the test
 * seeds a legacy answered row with NULL occurred_at for the SAME student in a
 * DIFFERENT SECTION. That is the exact shape production was in. It matters because
 * refresh_domain_mastery §4.9 fans out to refresh_overall_kpi, which validates
 * EVERY answered item for the student with no section or domain filter and raises
 * KPI_HISTORICAL_DATA_INVALID. One bad row anywhere in a student's history disables
 * that student's entire mastery pipeline. A test seeded with a clean student passes
 * while production stays broken — which is precisely what happened.
 *
 * The seed must be status='answered'. Skipped rows are excluded from every KPI scan
 * by the `status = 'answered'` predicate, so a skipped poison row would prove nothing.
 *
 * expected outcome: with migration 20260816000000 applied, one answer through the
 * real handler produces one audit row, one domain-mastery row, and one
 * projection-refresh-state row — the last being proof that apply_mastery_event ran
 * to completion, since bump_projection_refresh_counter is its final statement.
 *
 * trade-offs: a path-shim proxy sits between supabase-js and PostgREST because
 * supabase-js appends /rest/v1 and PostgREST serves at /. The proxy rewrites the
 * path and nothing else — the request, the JWT, the role, and the response are the
 * real thing.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "pg";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

const PGRST_URL = process.env.MASTERY_TRANSPORT_PGRST_URL ?? "";
const JWT_SECRET = process.env.MASTERY_TRANSPORT_JWT_SECRET ?? "";
const DB_NAME = process.env.MASTERY_TRANSPORT_DB ?? "mastery_transport_ci";
const CAN_RUN = PGRST_URL.length > 0 && JWT_SECRET.length > 0;

const STUDENT_ID = "9a9a9a9a-1111-4111-8111-111111111111";
const CLEAN_SESSION_ID = "9a9a9a9a-2222-4222-8222-222222222222";
const POISON_SESSION_ID = "9a9a9a9a-3333-4333-8333-333333333333";
const M_QUESTION = "SATM1T00001";
const RW_QUESTION = "SATRW1T00001";

// ---------------------------------------------------------------------------
// HS256 JWT minting — the same shape a Supabase anon/service key carries.
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

/**
 * Path shim: supabase-js issues `${SUPABASE_URL}/rest/v1/rpc/<fn>`; PostgREST
 * serves `/rpc/<fn>`. This strips the prefix and forwards verbatim — headers,
 * body, method, and the Authorization JWT all pass through untouched.
 */
function startRestShim(
  upstream: string,
): Promise<{ url: string; close: () => Promise<void> }> {
  const target = new URL(upstream);
  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").replace(/^\/rest\/v1/, "") || "/";
    const proxyReq = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path,
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

const describeIf = CAN_RUN ? describe : describe.skip;

describeIf("mastery emission — real PostgREST transport", () => {
  let pg: Client;
  let shim: { url: string; close: () => Promise<void> };
  let applyMasteryEvent: typeof import("../../apps/api/src/services/mastery-write").applyMasteryEvent;
  let actorId: string;

  beforeAll(async () => {
    shim = await startRestShim(PGRST_URL);

    // The handler's own clients read these at module load. Setting them — rather
    // than mocking the module — is what makes this a transport test.
    process.env.SUPABASE_URL = shim.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = mintJwt("service_role", JWT_SECRET);
    process.env.SUPABASE_ANON_KEY = mintJwt("anon", JWT_SECRET);

    ({ applyMasteryEvent } =
      await import("../../apps/api/src/services/mastery-write"));

    pg = new Client({
      host: process.env.PGHOST ?? "localhost",
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER ?? "postgres",
      password: process.env.PGPASSWORD ?? "postgres",
      database: DB_NAME,
    });
    await pg.connect();
  }, 60_000);

  afterAll(async () => {
    if (pg) await pg.end();
    if (shim) await shim.close();
  });

  beforeEach(async () => {
    // Full reset so each test defines its own data state exactly.
    await pg.query(
      `DELETE FROM public.mastery_event_audit_log WHERE student_id = $1`,
      [STUDENT_ID],
    );
    await pg.query(
      `DELETE FROM public.mastery_domain_refresh_audit_log WHERE student_id = $1`,
      [STUDENT_ID],
    );
    await pg.query(
      `DELETE FROM public.student_projection_refresh_state WHERE student_id = $1`,
      [STUDENT_ID],
    );
    await pg.query(
      `DELETE FROM public.student_domain_mastery WHERE student_id = $1`,
      [STUDENT_ID],
    );
    await pg.query(
      `DELETE FROM public.student_skill_mastery WHERE student_id = $1`,
      [STUDENT_ID],
    );
    await pg.query(
      `DELETE FROM public.practice_session_items WHERE user_id = $1`,
      [STUDENT_ID],
    );
    await pg.query(`DELETE FROM public.practice_sessions WHERE user_id = $1`, [
      STUDENT_ID,
    ]);
    await pg.query(`DELETE FROM public.entitlements WHERE profile_id = $1`, [
      STUDENT_ID,
    ]);
    await pg.query(`DELETE FROM public.profiles WHERE id = $1`, [STUDENT_ID]);
    await pg.query(`DELETE FROM auth.users WHERE id = $1`, [STUDENT_ID]);

    await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
      STUDENT_ID,
      "transport@example.com",
    ]);
    const { rows } = await pg.query(
      `SELECT actor_id FROM public.profiles WHERE id = $1`,
      [STUDENT_ID],
    );
    actorId = rows[0].actor_id;

    for (const [qid, section, domain, skill] of [
      [M_QUESTION, "M", "Algebra", "ALG.01"],
      [RW_QUESTION, "RW", "Craft and Structure", "CAS.01"],
    ] as const) {
      await pg.query(
        `INSERT INTO public.questions
           (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation)
         VALUES ($1,$2,1,$3,ARRAY[$4],2,'Stem',
           '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
           'A','E')
         ON CONFLICT (id) DO NOTHING`,
        [qid, section, domain, skill],
      );
    }

    await pg.query(
      `INSERT INTO public.practice_sessions
         (id, user_id, mode, target_count, platform, client_instance_id, status, actor_id)
       VALUES ($1,$2,'diagnostic',40,'web','inst-transport','active',$3)`,
      [CLEAN_SESSION_ID, STUDENT_ID, actorId],
    );
  });

  /** Seeds the legacy NULL-occurred_at row in a DIFFERENT section. */
  async function seedPoisonRow(): Promise<void> {
    await pg.query(
      `INSERT INTO public.practice_sessions
         (id, user_id, mode, target_count, platform, client_instance_id, status, actor_id)
       VALUES ($1,$2,'flow',10,'web','inst-legacy','completed',$3)`,
      [POISON_SESSION_ID, STUDENT_ID, actorId],
    );
    // The CHECK from 20260816000000 forbids this state, which is the whole point:
    // the row could only exist because it predates the constraint. Drop the
    // constraint for the insert, then restore it, so the test reproduces history
    // rather than pretending the constraint was never added.
    await pg.query(
      `ALTER TABLE public.practice_session_items
         DROP CONSTRAINT IF EXISTS psi_resolved_requires_occurred_at`,
    );
    await pg.query(
      `INSERT INTO public.practice_session_items
         (session_id, user_id, ordinal, question_id, question_stem, question_options,
          question_correct_answer, question_explanation, question_domain, question_skill,
          question_difficulty, question_section, status, selected_answer, is_correct,
          outcome, answered_at, occurred_at, actor_id)
       VALUES ($1,$2,1,$3,'Stem','[{"key":"A","text":"a"}]'::jsonb,'A','E',
               'Craft and Structure','CAS.01',2,'RW','answered','A',true,'correct',
               now() - interval '10 days', NULL, $4)`,
      [POISON_SESSION_ID, STUDENT_ID, RW_QUESTION, actorId],
    );
    await pg.query(
      `ALTER TABLE public.practice_session_items
         ADD CONSTRAINT psi_resolved_requires_occurred_at
         CHECK (status NOT IN ('answered','skipped') OR occurred_at IS NOT NULL)
         NOT VALID`,
    );
  }

  /** Inserts a clean answered item in section M and returns its id. */
  async function seedCleanAnsweredItem(): Promise<string> {
    const { rows } = await pg.query(
      `INSERT INTO public.practice_session_items
         (session_id, user_id, ordinal, question_id, question_stem, question_options,
          question_correct_answer, question_explanation, question_domain, question_skill,
          question_difficulty, question_section, status, selected_answer, is_correct,
          outcome, answered_at, occurred_at, actor_id)
       VALUES ($1,$2,1,$3,'Stem','[{"key":"A","text":"a"}]'::jsonb,'A','E',
               'Algebra','ALG.01',2,'M','answered','A',true,'correct', now(), now(), $4)
       RETURNING id`,
      [CLEAN_SESSION_ID, STUDENT_ID, M_QUESTION, actorId],
    );
    return rows[0].id as string;
  }

  async function emit(eventId: string) {
    return applyMasteryEvent({
      studentId: STUDENT_ID,
      section: "M",
      domain: "Algebra",
      skill: "ALG.01",
      difficulty: 2,
      sourceFamily: "practice",
      eventSourceKind: "diagnostic_attempt",
      correct: true,
      occurredAt: new Date().toISOString(),
      eventId,
      questionId: M_QUESTION,
    });
  }

  async function counts() {
    const q = async (sql: string) =>
      Number((await pg.query(sql, [STUDENT_ID])).rows[0].count);
    return {
      audit: await q(
        `SELECT count(*) FROM public.mastery_event_audit_log WHERE student_id = $1`,
      ),
      domain: await q(
        `SELECT count(*) FROM public.student_domain_mastery WHERE student_id = $1`,
      ),
      refresh: await q(
        `SELECT count(*) FROM public.student_projection_refresh_state WHERE student_id = $1`,
      ),
    };
  }

  // -------------------------------------------------------------------------
  it("writes audit, domain mastery and projection refresh state through real PostgREST", async () => {
    const eventId = await seedCleanAnsweredItem();

    const result = await emit(eventId);
    expect(result.error ?? null).toBeNull();
    expect(result.ok).toBe(true);

    const c = await counts();
    expect(c.audit).toBe(1);
    expect(c.domain).toBe(1);
    // bump_projection_refresh_counter is the FINAL statement of apply_mastery_event.
    // A row here is the only direct evidence the function ran to completion — this
    // table had 0 rows for the entire outage.
    expect(c.refresh).toBe(1);

    const { rows } = await pg.query(
      `SELECT event_source_kind, question_id FROM public.mastery_event_audit_log WHERE student_id = $1`,
      [STUDENT_ID],
    );
    expect(rows[0].event_source_kind).toBe("diagnostic_attempt");
    expect(rows[0].question_id).toBe(M_QUESTION);
  });

  // -------------------------------------------------------------------------
  it("RED-FIRST: a legacy NULL occurred_at row in another section blocks the whole student", async () => {
    // Reproduces production exactly. The poison row is in RW; the event is in M.
    // A domain-scoped reading of the defect predicts success here. It fails,
    // because refresh_overall_kpi validates the student's entire history.
    await seedPoisonRow();
    const eventId = await seedCleanAnsweredItem();

    const result = await emit(eventId);

    expect(result.ok).toBe(false);
    expect(result.error ?? "").toMatch(/KPI_HISTORICAL_DATA_INVALID/);

    // Whole transaction rolled back — this is the "nothing anywhere" signature.
    const c = await counts();
    expect(c.audit).toBe(0);
    expect(c.domain).toBe(0);
    expect(c.refresh).toBe(0);
  });

  // -------------------------------------------------------------------------
  it("GREEN-AFTER: repairing occurred_at unblocks the same event", async () => {
    await seedPoisonRow();
    const eventId = await seedCleanAnsweredItem();

    expect((await emit(eventId)).ok).toBe(false);

    // Exactly what migration 20260816000000 statement (1) does.
    await pg.query(
      `UPDATE public.practice_session_items
          SET occurred_at = answered_at
        WHERE status IN ('answered','skipped')
          AND occurred_at IS NULL
          AND answered_at IS NOT NULL`,
    );

    const result = await emit(eventId);
    expect(result.error ?? null).toBeNull();
    expect(result.ok).toBe(true);

    const c = await counts();
    expect(c.audit).toBe(1);
    expect(c.refresh).toBe(1);
  });

  // -------------------------------------------------------------------------
  // MUTATION PROOFS — each must turn this suite red.
  // -------------------------------------------------------------------------
  it("MUTATION (i): the anon role is refused by the GRANT (42501)", async () => {
    // apply_mastery_event is granted to service_role ONLY — genesis declares
    // REVOKE ALL FROM PUBLIC then GRANT ALL TO service_role, with no authenticated
    // or anon grant. This asserts the transport actually enforces that.
    //
    // Issued as a raw request rather than through applyMasteryEvent() because
    // getSupabaseAdmin() memoises its client in a module-level singleton
    // (apps/api/src/lib/supabase-admin.ts), so re-importing the bridge with a
    // different env var returns the ALREADY-BUILT service_role client and would
    // silently test nothing. The property under test is the GRANT plus PostgREST's
    // JWT-role mapping, and this exercises both directly.
    const eventId = await seedCleanAnsweredItem();
    const anonKey = mintJwt("anon", JWT_SECRET);

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
        p_domain: "Algebra",
        p_skill: "ALG.01",
        p_difficulty: 2,
        p_source_family: "practice",
        p_event_source_kind: "diagnostic_attempt",
        p_correct: true,
        p_occurred_at: new Date().toISOString(),
        p_event_id: eventId,
        p_question_id: M_QUESTION,
        p_section_state: null,
      }),
    });

    const body = (await res.json()) as { code?: string; message?: string };
    // PostgREST 12 maps SQLSTATE 42501 onto HTTP 401 (not 403). The SQLSTATE is the
    // load-bearing assertion; the HTTP status is recorded so a PostgREST upgrade
    // that changes the mapping shows up as a deliberate review rather than a
    // silent pass.
    expect(res.status).toBe(401);
    expect(body.code).toBe("42501");
    expect(body.message ?? "").toMatch(/permission denied/i);

    // and nothing was written
    expect((await counts()).audit).toBe(0);
  });

  it("MUTATION (ii): an altered RPC name is refused by PostgREST (PGRST202)", async () => {
    const res = await fetch(
      `${shim.url}/rest/v1/rpc/apply_mastery_event_TYPO`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ p_student_id: STUDENT_ID }),
      },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("PGRST202");
  });

  it("MUTATION (iii): without the poison seed the RED case would pass — proving the seed is load-bearing", async () => {
    // If this passes AND the RED-FIRST test above also passed, the suite would be
    // testing nothing: it would go green on a clean student while production
    // stayed broken. That is exactly how four existing suites earned green for
    // seven weeks. Keeping this assertion adjacent to the RED case is what makes
    // the poison seed provably load-bearing rather than decorative.
    const eventId = await seedCleanAnsweredItem();
    const result = await emit(eventId);
    expect(result.ok).toBe(true);
    expect((await counts()).audit).toBe(1);
  });
});
