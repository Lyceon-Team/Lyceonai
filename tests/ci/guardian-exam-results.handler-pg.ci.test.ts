/**
 * G1 — a guardian reads a linked student's exam results, HTTP handlers against real Postgres.
 *
 * @spec [Doc-04C §2.6 (link AND entitlement; strict subset), §12.2 (projection), §12.3
 *        (view-only, no review), §15.1 (disclosure with every score)]
 *       [Doc 04 Parent Q9 as amended by SCL-180; SCL-181 (route family, 404/402)]
 * @implemented [2026-09-27]
 *
 * plain English: mounts the REAL /api/students router (with the real resolver) and the
 * real student report router over a throwaway database built from this repo's
 * migrations. Nothing on the access path is mocked: `guardian_view_decision`,
 * `entitlement_active`, `entitlement_features`, the link revoke function and the account
 * anonymisation cascade are the migrations' own. Substituted: the database transport
 * (supabaseServer -> node-pg), and the auth boundary (the caller is a header).
 *
 * THE EVIDENCE the G1 brief asks for is printed with the prefix `G1 EVIDENCE`: the
 * allowed payload; the same request after the link is revoked and after the entitlement
 * lapses; the recursive forbidden-field scan; the anonymised student.
 *
 * Runs only where PGHOST is set; named by file in CI (.github/workflows/ci.yml).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { Client } from "pg";
import fs from "fs";
import path from "path";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import {
  guardianExamListEnvelopeSchema,
  guardianExamReportEnvelopeSchema,
  toGuardianDomainBars,
} from "../../packages/shared/src/exam-guardian-report-schema";
import { examReportPayloadSchema } from "../../packages/shared/src/exam-report-schema";

const DB_NAME = "guardian_exam_results_handler_ci";
const FORM = "61f00000-0000-4000-8000-0000000000a1";
const GUARDIAN = "00000000-0000-4000-8000-0000000061a1";
const OTHER_GUARDIAN = "00000000-0000-4000-8000-0000000061a2";
const STUDENT = "00000000-0000-4000-8000-0000000061b1";
const OTHER_STUDENT = "00000000-0000-4000-8000-0000000061b2";
const PART_STUDENT = "00000000-0000-4000-8000-0000000061b3";
const ANON_STUDENT = "00000000-0000-4000-8000-0000000061b4";
const NEVER = "00000000-0000-4000-8000-0000000061ff";

let testPg: Client | null = null;

function pgProxy() {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (!testPg) throw new Error("PG client not initialised");
        const sb = makePgSupabase(testPg);
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
vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const pass = (_q: Request, _s: Response, next: NextFunction) => next();
  return {
    ...actual,
    requireSupabaseAuth: pass,
    requireStudentOrAdmin: pass,
    requireProfileComplete: pass,
    requireGuardianLinkForUnder13: pass,
  };
});

/**
 * THE FORBIDDEN-FIELD SCAN (the E7a report-contract pattern, applied to a live body).
 * Keys: answers, explanations, anything skill-level, any Module 2 / routing signal, raw
 * counts, pacing or timing, anything from the review surface, internal identities.
 * Values: a module-path token or a question id anywhere in a string.
 */
const FORBIDDEN_KEY =
  /answer|explanation|skill|module|path|routing|threshold|raw|_correct$|wrong|ceiling|pacing|elapsed|time_used|duration|_ms$|review|resumable|question|ordinal|difficulty|score_run_id|scoring_model_version|scored_at|incident|failure|outbox|internal|student_id|actor_id|estimated_ready_at|incompleteness/i;
const FORBIDDEN_VALUE = /\b2[AB]\b|\bSAT[A-Z0-9]*Q\d|\bINC-/;

function scan(node: unknown, at = "$", hits: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((v, i) => scan(v, `${at}[${i}]`, hits));
  } else if (node !== null && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (FORBIDDEN_KEY.test(k)) hits.push(`${at}.${k}`);
      scan(v, `${at}.${k}`, hits);
    }
  } else if (typeof node === "string" && FORBIDDEN_VALUE.test(node)) {
    hits.push(`${at} = ${node}`);
  }
  return hits;
}

function evidence(label: string, value: unknown): void {
  process.stdout.write(`G1 EVIDENCE ${label} ${JSON.stringify(value)}\n`);
}

describe.skipIf(!PG_AVAILABLE)("G1 guardian exam results → real PG", () => {
  let app: Express;
  let sid = "";
  let partSid = "";
  let liveSid = "";
  let pendingSid = "";
  let otherSid = "";
  let anonSid = "";

  const get = (principal: string, url: string) =>
    request(app).get(url).set("x-test-user", principal);
  const reportUrl = (student: string, session: string) =>
    `/api/students/${student}/tests/${session}/report`;

  async function walk(student: string, sections: string): Promise<string> {
    const r = await testPg!.query(
      `SELECT pg_temp.walk($1, $2, 'strict', $3::text[]) AS sid`,
      [student, FORM, sections],
    );
    return String(r.rows[0].sid);
  }
  async function drain(): Promise<void> {
    const r = await testPg!.query(`SELECT pg_temp.drain() AS n`);
    expect(Number(r.rows[0].n)).toBeGreaterThanOrEqual(0);
  }

  beforeAll(async () => {
    testPg = await bootstrapPgDatabase(DB_NAME);
    const pg = testPg;
    for (const f of [
      "exam-form-fixture.sql",
      "exam-walk-fixture.sql",
      "exam-seams-walk.sql",
    ]) {
      await pg.query(
        fs.readFileSync(
          path.resolve(__dirname, "../../scripts/ci/lib", f),
          "utf-8",
        ),
      );
    }
    await pg.query(`SELECT pg_temp.exam_fixture_make_form($1, 'G2', 20, 15)`, [
      FORM,
    ]);
    await pg.query(
      `UPDATE public.test_forms SET status = 'published', published_at = now(), name = 'Practice Test 1' WHERE id = $1`,
      [FORM],
    );
    // The migrations alone leave the feature ENABLED: genesis seeds the row without an
    // `enabled` value and the column defaults to TRUE (the positional FALSE in that seed
    // is `blocked_during_live_exam`). Production reads the same (read-only, 2026-09-27).
    // Asserted, not set, so a fresh environment that would bring the exam up dark fails
    // here instead of being papered over (G2 decision log, correcting G1's reading).
    const feature = await pg.query(
      `SELECT enabled FROM public.entitlement_features WHERE feature_key = 'exam_full_length'`,
    );
    expect(feature.rows).toEqual([{ enabled: true }]);
    const people: Array<[string, string]> = [
      [GUARDIAN, "guardian"],
      [OTHER_GUARDIAN, "guardian"],
      [STUDENT, "student"],
      [OTHER_STUDENT, "student"],
      [PART_STUDENT, "student"],
      [ANON_STUDENT, "student"],
    ];
    for (const [id, role] of people) {
      await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
        id,
        `${id}@example.test`,
      ]);
      await pg.query(
        `INSERT INTO public.profiles (id, email, role) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
        [id, `${id}@example.test`, role],
      );
    }
    for (const s of [STUDENT, OTHER_STUDENT, PART_STUDENT, ANON_STUDENT]) {
      await pg.query(
        `INSERT INTO public.entitlements (profile_id, tier, status) VALUES ($1, 'premium', 'active')`,
        [s],
      );
    }
    const links: Array<[string, string]> = [
      [GUARDIAN, STUDENT],
      [GUARDIAN, PART_STUDENT],
      [GUARDIAN, ANON_STUDENT],
      [OTHER_GUARDIAN, OTHER_STUDENT],
    ];
    for (const [g, s] of links) {
      await pg.query(
        `INSERT INTO public.guardian_links
           (guardian_profile_id, student_profile_id, status, initiated_by,
            initiated_at, accepted_at, accepted_by_profile_id, created_at)
         VALUES ($1, $2, 'active', 'guardian', now(), now(), $2, now())`,
        [g, s],
      );
    }

    // STUDENT: one scored exam. OTHER_STUDENT: one scored exam (the foreign session).
    sid = await walk(STUDENT, "{RW,M}");
    otherSid = await walk(OTHER_STUDENT, "{RW,M}");
    anonSid = await walk(ANON_STUDENT, "{RW,M}");
    await drain();
    // PART_STUDENT: RW walked, Math Module 1 answered, grace expired -> partial_scored.
    partSid = await walk(PART_STUDENT, "{RW}");
    await pg.query(
      `SELECT pg_temp.expect_status('fx', public.exam_start_module($1, $2, 'M', '1'), 200)`,
      [PART_STUDENT, partSid],
    );
    await pg.query(`SELECT pg_temp.answer_mixed($1, $2, 'M', '1')`, [
      PART_STUDENT,
      partSid,
    ]);
    await pg.query(
      `UPDATE public.test_sessions SET grace_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`,
      [partSid],
    );
    await pg.query(`SELECT public.exam_abandonment_sweep()`);
    await drain();

    const { default: studentResources } =
      await import("../../server/routes/student-resources");
    const { default: reportRouter } =
      await import("../../server/routes/exam-report-routes");
    app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const user = req.header("x-test-user");
      if (user) {
        const role =
          user === GUARDIAN || user === OTHER_GUARDIAN ? "guardian" : "student";
        (req as unknown as { user: unknown }).user = {
          id: user,
          actor_id: user,
          role,
        };
      }
      (req as unknown as { requestId: string }).requestId = "g1-pg";
      next();
    });
    app.use("/api/students", studentResources);
    app.use("/api/tests", reportRouter);
  }, 240_000);

  afterAll(async () => {
    await testPg?.end();
  });

  it("allowed: the list and one scored exam through the real guardian route", async () => {
    const list = await get(GUARDIAN, `/api/students/${STUDENT}/tests`);
    expect(list.status).toBe(200);
    const tests = guardianExamListEnvelopeSchema.parse(list.body).tests;
    expect(tests.map((t) => [t.session_id, t.report_state])).toEqual([
      [sid, "scored"],
    ]);

    const res = await get(GUARDIAN, reportUrl(STUDENT, sid));
    expect(res.status).toBe(200);
    evidence("allowed payload", res.body);
    const report = guardianExamReportEnvelopeSchema.parse(res.body).report;
    if (report.report_state !== "scored") throw new Error(report.report_state);
    expect(report.score.total_scaled).toBe(
      report.score.rw_scaled + report.score.math_scaled,
    );
    expect(report.domain_breakdown).toHaveLength(8);
    expect(report.disclosure.disclosure_version.length).toBeGreaterThan(0);

    // G3-02 (R4, SCL-189): the same eight domains the student sees, each as the BAR the
    // student sees — derived from the student's own rows — and no counts.
    const own = await get(STUDENT, `/api/tests/sessions/${sid}/report`);
    expect(own.status).toBe(200);
    const student = examReportPayloadSchema.parse(own.body.data);
    if (student.report_state !== "scored")
      throw new Error(student.report_state);
    expect(report.domain_breakdown).toEqual(
      toGuardianDomainBars(student.domain_breakdown),
    );
    for (const row of res.body.report.domain_breakdown as Record<
      string,
      unknown
    >[]) {
      expect(Object.keys(row).sort()).toEqual(["bar_pct", "domain", "section"]);
    }
    expect(report.score.total_scaled).toBe(student.score.total_scaled);
    // Strict subset (04C §2.6): every guardian top-level key is a student key.
    for (const k of Object.keys(report)) expect(student).toHaveProperty(k);

    // Tied to scoring: per section, the rows sum to score_runs' module counts.
    const run = (
      await testPg!.query(
        `SELECT rw_module1_correct + rw_module2_correct AS rw, math_module1_correct + math_module2_correct AS m
           FROM public.score_runs WHERE test_session_id = $1`,
        [sid],
      )
    ).rows[0] as { rw: number; m: number };
    // The bars' source rows (the student's) are tied to scoring: per section they sum to
    // score_runs' module counts, so a guardian bar is the scored fraction, not a guess.
    const sum = (s: string) =>
      student.domain_breakdown
        .filter((r) => r.section === s)
        .reduce((a, r) => a + r.correct, 0);
    expect([sum("RW"), sum("M")]).toEqual([run.rw, run.m]);
  });

  it("forbidden-field scan: no answer, explanation, skill, routing, raw score, pacing or review field at any depth", async () => {
    const bodies = [
      (await get(GUARDIAN, reportUrl(STUDENT, sid))).body,
      (await get(GUARDIAN, reportUrl(PART_STUDENT, partSid))).body,
      (await get(GUARDIAN, `/api/students/${STUDENT}/tests`)).body,
    ];
    const hits = bodies.flatMap((b) => scan(b));
    evidence("forbidden-field scan", {
      bodies_scanned: bodies.length,
      keys_seen: [...new Set(bodies.flatMap((b) => keysDeep(b)))].sort(),
      hits,
    });
    expect(hits).toEqual([]);
    // The scan can see a leak (self-check), at depth and in a value.
    expect(
      scan({ report: { domain_breakdown: [{ skill_code: "x", note: "2A" }] } }),
    ).toEqual([
      "$.report.domain_breakdown[0].skill_code",
      "$.report.domain_breakdown[0].note = 2A",
    ]);
  });

  it("partial: no total, only the scored section broken down, no phantom score", async () => {
    const res = await get(GUARDIAN, reportUrl(PART_STUDENT, partSid));
    expect(res.status).toBe(200);
    evidence("partial payload", res.body);
    const report = guardianExamReportEnvelopeSchema.parse(res.body).report;
    if (report.report_state !== "partial_scored")
      throw new Error(report.report_state);
    expect(report.score).not.toHaveProperty("total_scaled");
    expect(report.score.math_scaled).toBeNull();
    expect(new Set(report.domain_breakdown.map((r) => r.section))).toEqual(
      new Set(["RW"]),
    );
  });

  it("pending and in-progress: a state, never a number", async () => {
    // A completed walk with its scoring event not yet consumed is scoring_pending.
    pendingSid = await walk(PART_STUDENT, "{RW,M}");
    const pending = await get(GUARDIAN, reportUrl(PART_STUDENT, pendingSid));
    expect(pending.status).toBe(200);
    evidence("pending payload", pending.body);
    expect(pending.body.report.report_state).toBe("scoring_pending");
    expect(pending.body.report).not.toHaveProperty("score");
    expect(pending.body.report).not.toHaveProperty("domain_breakdown");
    expect(pending.body.report).not.toHaveProperty("disclosure");
    await drain();

    const r = await testPg!.query(
      `SELECT public.exam_create_session($1, $2, 'strict') AS v`,
      [OTHER_STUDENT, FORM],
    );
    liveSid = String(r.rows[0].v.body.session_id);
    const live = await get(OTHER_GUARDIAN, reportUrl(OTHER_STUDENT, liveSid));
    expect(live.status).toBe(200);
    expect(live.body.report).toEqual({
      report_state: "not_completed",
      session_id: liveSid,
      test_form_id: FORM,
      test_form_name: "Practice Test 1",
      session_state: "created",
    });
  });

  it("denials: another guardian's student, a foreign session, and a missing one are the resolver's identical 404", async () => {
    const notMine = await get(GUARDIAN, reportUrl(OTHER_STUDENT, otherSid));
    const foreign = await get(GUARDIAN, reportUrl(STUDENT, otherSid));
    const missing = await get(GUARDIAN, reportUrl(STUDENT, NEVER));
    const neverLinked = await get(GUARDIAN, `/api/students/${NEVER}/tests`);
    for (const r of [notMine, foreign, missing, neverLinked]) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual(notMine.body);
    }
    evidence("another guardian's student", {
      status: notMine.status,
      body: notMine.body,
    });
  });

  it("no guardian write path: only GET is routed under /tests", async () => {
    for (const method of ["post", "put", "patch", "delete"] as const) {
      for (const url of [
        `/api/students/${STUDENT}/tests`,
        reportUrl(STUDENT, sid),
      ]) {
        const agent = request(app);
        const res = await agent[method](url).set("x-test-user", GUARDIAN);
        expect(res.status).toBe(404);
      }
    }
    const { default: router } =
      await import("../../server/routes/student-resources");
    const layers = (
      router as unknown as {
        stack: Array<{
          route?: { path: string; methods: Record<string, boolean> };
        }>;
      }
    ).stack
      .filter((l) => l.route?.path.includes("/tests"))
      .map((l) => [l.route!.path, Object.keys(l.route!.methods)]);
    expect(layers).toEqual([
      ["/:studentId/tests", ["get"]],
      ["/:studentId/tests/:sessionId/report", ["get"]],
    ]);
  });

  it("entitled student without the full-length feature: 402 from the feature gate", async () => {
    await testPg!.query(
      `UPDATE public.entitlement_features SET enabled = false WHERE feature_key = 'exam_full_length'`,
    );
    try {
      const res = await get(GUARDIAN, reportUrl(STUDENT, sid));
      expect(res.status).toBe(402);
      expect(res.body.code).toBe("PAYMENT_REQUIRED");
      expect(JSON.stringify(res.body)).not.toMatch(/scaled|domain/);
    } finally {
      await testPg!.query(
        `UPDATE public.entitlement_features SET enabled = true WHERE feature_key = 'exam_full_length'`,
      );
    }
  });

  it("after the student's entitlement lapses: 402, and nothing about the exam", async () => {
    await testPg!.query(
      `UPDATE public.entitlements SET status = 'canceled' WHERE profile_id = $1`,
      [PART_STUDENT],
    );
    const res = await get(GUARDIAN, reportUrl(PART_STUDENT, partSid));
    evidence("after entitlement lapse", { status: res.status, body: res.body });
    expect(res.status).toBe(402);
    expect(JSON.stringify(res.body)).not.toMatch(/scaled|domain|Practice Test/);
    const list = await get(GUARDIAN, `/api/students/${PART_STUDENT}/tests`);
    expect(list.status).toBe(402);
  });

  it("after the link is revoked: the same 404 as never linked", async () => {
    const before = await get(GUARDIAN, reportUrl(STUDENT, sid));
    expect(before.status).toBe(200);
    await testPg!.query(
      `SELECT public.revoke_guardian_link_audited($1, $2, $2, 'g1 evidence', 'g1-pg')`,
      [GUARDIAN, STUDENT],
    );
    const res = await get(GUARDIAN, reportUrl(STUDENT, sid));
    evidence("after link revoked", { status: res.status, body: res.body });
    expect(res.status).toBe(404);
    const never = await get(GUARDIAN, `/api/students/${NEVER}/tests`);
    expect(res.body).toEqual(never.body);
    // The student still reads their own report: revoking a guardian touches no exam row.
    expect(
      (await get(STUDENT, `/api/tests/sessions/${sid}/report`)).status,
    ).toBe(200);
  });

  it("anonymised student: the path ends at the resolver (links pre-cleared by the deletion executor) — 404", async () => {
    const before = await get(GUARDIAN, reportUrl(ANON_STUDENT, anonSid));
    expect(before.status).toBe(200);
    const req = await testPg!.query(
      `INSERT INTO public.account_deletion_requests
         (profile_id, scheduled_hard_delete_at, actor_profile_id, status)
       VALUES ($1, now() - interval '1 day', $1, 'pending') RETURNING id`,
      [ANON_STUDENT],
    );
    // The executor's order (evidence invariant rule 3): links are pre-cleared in their own
    // transaction, THEN the profile is anonymised. The pre-clear is where a guardian's
    // path to this student ends.
    const preclear = (
      await testPg!.query(
        `SELECT public.preclear_account_deletion_links($1) AS r`,
        [ANON_STUDENT],
      )
    ).rows[0].r as unknown;
    const afterPreclear = await get(GUARDIAN, reportUrl(ANON_STUDENT, anonSid));
    expect(afterPreclear.status).toBe(404);
    const result = (
      await testPg!.query(
        `SELECT public.complete_and_anonymize_account($1, $2) AS r`,
        [req.rows[0].id, ANON_STUDENT],
      )
    ).rows[0].r as { status: string };
    expect(result.status).toBe("completed");
    const links = await testPg!.query(
      `SELECT count(*)::int AS n FROM public.guardian_links WHERE student_profile_id = $1`,
      [ANON_STUDENT],
    );
    const decision = await testPg!.query(
      `SELECT public.guardian_view_decision($1, $2) AS d`,
      [GUARDIAN, ANON_STUDENT],
    );
    const res = await get(GUARDIAN, reportUrl(ANON_STUDENT, anonSid));
    evidence("anonymised student", {
      preclear,
      status_after_preclear: afterPreclear.status,
      cascade: result.status,
      links_left: links.rows[0].n,
      decision: decision.rows[0].d,
      status: res.status,
      body: res.body,
    });
    expect(links.rows[0].n).toBe(0);
    expect(decision.rows[0].d).toBe("not_linked");
    expect(res.status).toBe(404);
    // The retained exam is no longer this id's: the session row names no student.
    const sess = await testPg!.query(
      `SELECT student_id FROM public.test_sessions WHERE id = $1`,
      [anonSid],
    );
    expect(sess.rows[0].student_id).toBeNull();
  });
});

function keysDeep(node: unknown, acc: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((v) => keysDeep(v, acc));
  else if (node !== null && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      acc.push(k);
      keysDeep(v, acc);
    }
  }
  return acc;
}
