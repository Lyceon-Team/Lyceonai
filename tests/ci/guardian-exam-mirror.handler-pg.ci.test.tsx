// @vitest-environment jsdom
/**
 * G5-08 — the guardian's exam surfaces mirror the student's own outcomes, real Postgres end to end.
 *
 * @spec [Guardian_Closure_Plan G5-08 (owner brief 2026-10-02: one state per real session, the
 *       guardian card, list and detail show the student's state, label and numbers); Doc-04C
 *       §2.6 rule 7 (strict subset), §12.2/§12.3; SCL-181 (route family, projection);
 *       G5-09 (owner brief 2026-10-03: scores only through the report route; the list carries
 *       none; the card reads at most two report calls); owner decisions 2026-10-02 (a partial score is compared section
 *       to section; the failed state shows its title only; "you/your" names the student)]
 *       | @implemented [2026-10-02]
 *
 * plain English: a throwaway database built from this repo's migrations. Each state is a real
 * session made by the real exam functions (`exam_create_session`, `exam_start_module`,
 * `exam_submit_module`, the abandonment sweep, the scoring consumer): scored, partial-scored,
 * scoring-pending, scoring-failed, abandoned with nothing scored, and in progress. For each,
 * the STUDENT's truth is read the way the student reads it — their report from the real
 * `/api/tests/sessions/:id/report` route, rendered by the student's own `ReportBody`, and
 * their card word from the real forms listing through the student's own `formCardStateLabel`.
 * The GUARDIAN's view is read from the real `/api/students/:id/tests[...]` routes and rendered
 * by the real app at the guardian list, the detail and the Dashboard card. The test then holds
 * them to one another: the same state word, the same panel title (with the student's name for
 * "your"), no sentence the student's report does not have, and the same numbers.
 *
 * The partial-score student also has an earlier scored test on a second form, so the card's
 * change chip is proven on real numbers: the partial's scored section minus that section of
 * the previous scored outcome.
 *
 * G5-11 (SCL-210): for each scored state, and for a real session answered so that one domain
 * is 3 of 14 (a whole percent cannot give the student's fill), the guardian detail's Score
 * breakdown and the student's own draw the same domains, in the same order, with the same
 * seven segments and the same number filled.
 *
 * G5-09: every number on the card is the guardian REPORT route's — the real list, which carries
 * no score field in any state (asserted on the raw wire), only chooses the sessions; the card's
 * report calls are logged and are exactly the latest's (and, for the chip, the previous's).
 *
 * The deliberate differences are not compared: the guardian sees bars without counts
 * (SCL-189), no skills and no answers, and no resume or review control (§12.3).
 *
 * Runs only where PGHOST is set; named by file in CI (.github/workflows/ci.yml).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactElement } from "react";
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
} from "../../packages/shared/src/exam-guardian-report-schema";
import {
  examStudentReportPayloadSchema,
  type ExamStudentReportPayload,
} from "../../packages/shared/src/exam-student-report-schema";

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
vi.mock("@/contexts/SupabaseAuthContext", async () => {
  const { GUARDIAN_AUTH: auth } =
    await import("../../client/src/features/guardian/test-harness");
  return {
    useSupabaseAuth: () => ({ ...auth, signOut: vi.fn(async () => undefined) }),
  };
});
vi.mock("@/lib/csrf", async () => {
  const { scriptedFetch: fetcher } =
    await import("../../client/src/features/guardian/test-harness");
  return {
    getCsrfToken: vi.fn(async () => "t"),
    clearCsrfToken: vi.fn(),
    csrfFetch: vi.fn(fetcher),
  };
});

const harness = await import("../../client/src/features/guardian/test-harness");
const { net, json, roster, mountApp, calendarWeek, masteryDomains } = harness;
const { Router } = await import("@/App");
const { ReportBody } =
  await import("../../client/src/features/exam/pages/ExamReportPage");
const { formCardStateLabel } =
  await import("../../client/src/features/exam/lib/labels");
const { listExamForms } =
  await import("../../server/services/exam-runtime-service");

const DB_NAME = "guardian_exam_mirror_handler_ci";
const FORM = "61f00000-0000-4000-8000-0000000000b1";
const FORM2 = "61f00000-0000-4000-8000-0000000000b2";
const GUARDIAN = "00000000-0000-4000-8000-0000000062a1";

type Case = {
  key:
    | "scored"
    | "partial"
    | "pending"
    | "failed"
    | "abandoned"
    | "in_progress";
  student: string;
  name: string;
  sid: string;
};

const CASES: Case[] = [
  {
    key: "scored",
    name: "Sam",
    student: "00000000-0000-4000-8000-0000000062b1",
  },
  {
    key: "partial",
    name: "Pia",
    student: "00000000-0000-4000-8000-0000000062b2",
  },
  {
    key: "pending",
    name: "Pat",
    student: "00000000-0000-4000-8000-0000000062b3",
  },
  {
    key: "failed",
    name: "Fay",
    student: "00000000-0000-4000-8000-0000000062b4",
  },
  {
    key: "abandoned",
    name: "Abe",
    student: "00000000-0000-4000-8000-0000000062b5",
  },
  {
    key: "in_progress",
    name: "Liv",
    student: "00000000-0000-4000-8000-0000000062b6",
  },
].map((c) => ({ ...c, sid: "" }) as Case);

/** The partial-score student's earlier scored test, on FORM2. */
let partialPreviousSid = "";

/**
 * G5-11: a scored session whose Information and Ideas count is 3 of 14 (21%: a whole percent
 * would fill 1 segment; the student's rule fills 2). Not one of the six state cases.
 */
const AMBIGUOUS = { student: "00000000-0000-4000-8000-0000000062b7", sid: "" };

const text = (el: Element | null | undefined): string =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** The student's second person, said of the student by name (owner decision 2026-10-02). */
function namedFor(name: string, sentence: string): string {
  return sentence
    .replace(/\bYour\b/g, `${name}'s`)
    .replace(/\byour\b/g, `${name}'s`);
}

const sentences = (s: string): string[] =>
  s
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

/** What the student's own report shows, read from the student's own components. */
type StudentView = {
  state: string;
  line: string;
  panelTitle: string | null;
  panelBody: string | null;
  total: string | null;
  sections: string[];
  partialSummary: string | null;
};

function studentView(payload: ExamStudentReportPayload): StudentView {
  const { container } = render(<ReportBody payload={payload} />);
  const panel = container.querySelector("section h2");
  const view: StudentView = {
    state: payload.report_state,
    line: text(container.querySelector("p")),
    panelTitle: panel === null ? null : text(panel),
    panelBody:
      panel === null ? null : text(panel.parentElement?.querySelector("p")),
    total:
      text(container.querySelector('[data-testid="exam-total-score"]')) || null,
    sections: Array.from(
      container.querySelectorAll('[data-testid="exam-section-score"]'),
    ).map((e) => text(e).replace(/\s*200–800$/, "")),
    partialSummary:
      text(container.querySelector('[data-testid="exam-partial-summary"]')) ||
      null,
  };
  cleanup();
  return view;
}

describe.skipIf(!PG_AVAILABLE)(
  "G5-08 the guardian mirrors the student's exam outcomes → real PG",
  () => {
    let app: Express;
    const student = new Map<string, ExamStudentReportPayload>();
    const cardWord = new Map<string, string>();
    const guardianList = new Map<string, unknown>();
    const guardianReport = new Map<string, unknown>();

    const get = (principal: string, url: string) =>
      request(app).get(url).set("x-test-user", principal);

    async function q<T = Record<string, unknown>>(
      sql: string,
      args: unknown[] = [],
    ): Promise<T[]> {
      return (await testPg!.query(sql, args)).rows as T[];
    }
    async function walk(
      who: string,
      form: string,
      sections: string,
    ): Promise<string> {
      const [r] = await q<{ sid: string }>(
        `SELECT pg_temp.walk($1, $2, 'strict', $3::text[]) AS sid`,
        [who, form, sections],
      );
      return String(r!.sid);
    }
    async function drain(): Promise<void> {
      const [r] = await q<{ n: number }>(`SELECT pg_temp.drain() AS n`);
      expect(Number(r!.n)).toBeGreaterThanOrEqual(0);
    }
    async function expire(sid: string): Promise<void> {
      await q(
        `UPDATE public.test_sessions SET grace_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`,
        [sid],
      );
      await q(`SELECT public.exam_abandonment_sweep()`);
    }
    const c = (key: Case["key"]): Case => {
      const found = CASES.find((x) => x.key === key);
      if (found === undefined) throw new Error(key);
      return found;
    };

    beforeAll(async () => {
      testPg = await bootstrapPgDatabase(DB_NAME);
      for (const f of [
        "exam-form-fixture.sql",
        "exam-walk-fixture.sql",
        "exam-seams-walk.sql",
      ]) {
        await testPg.query(
          fs.readFileSync(
            path.resolve(__dirname, "../../scripts/ci/lib", f),
            "utf-8",
          ),
        );
      }
      for (const [form, tag, name] of [
        [FORM, "G8", "Full-Length Practice Test 2"],
        [FORM2, "G9", "Full-Length Practice Test 1"],
      ] as const) {
        await q(`SELECT pg_temp.exam_fixture_make_form($1, $2, 20, 15)`, [
          form,
          tag,
        ]);
        await q(
          `UPDATE public.test_forms SET status = 'published', published_at = now(), name = $2 WHERE id = $1`,
          [form, name],
        );
      }
      for (const [id, role] of [
        [GUARDIAN, "guardian"],
        ...CASES.map((x) => [x.student, "student"]),
        [AMBIGUOUS.student, "student"],
      ] as const) {
        await q(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
          id,
          `${id}@example.test`,
        ]);
        await q(
          `INSERT INTO public.profiles (id, email, role) VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
          [id, `${id}@example.test`, role],
        );
      }
      for (const x of [...CASES, AMBIGUOUS]) {
        await q(
          `INSERT INTO public.entitlements (profile_id, tier, status) VALUES ($1, 'premium', 'active')`,
          [x.student],
        );
        await q(
          `INSERT INTO public.guardian_links
             (guardian_profile_id, student_profile_id, status, initiated_by,
              initiated_at, accepted_at, accepted_by_profile_id, created_at)
           VALUES ($1, $2, 'active', 'guardian', now(), now(), $2, now())`,
          [GUARDIAN, x.student],
        );
      }

      // SCORED: both sections, scored by the real consumer.
      c("scored").sid = await walk(c("scored").student, FORM, "{RW,M}");
      // PARTIAL: an earlier scored test on FORM2, then RW walked, Math Module 1 answered,
      // grace expired -> partial_scored_abandoned, scored by the real consumer.
      partialPreviousSid = await walk(c("partial").student, FORM2, "{RW,M}");
      // G5-11: Reading and Writing answered so Information and Ideas is 3 of 14 — its three
      // Module 1 items at ordinals 0-2 right, everything else in the section wrong (the
      // fixture form has 7 of them in Module 1 and 7 in either Module 2). Math as usual.
      await q(`
        CREATE FUNCTION pg_temp.answer_only(p_student uuid, p_session uuid, p_section text,
                                            p_module text, p_right int[])
        RETURNS void LANGUAGE plpgsql AS $f$
        DECLARE it record; v jsonb; v_phys text;
        BEGIN
          v_phys := public.exam_physical_module(p_session, p_section, p_module);
          v := public.exam_record_item_options(p_student, p_session, p_section, p_module, (
                 SELECT jsonb_agg(jsonb_build_object(
                          'ordinal', fi.ordinal, 'question_id', fi.question_id,
                          'option_order', CASE WHEN q.item_type = 'mcq' THEN '["A","B","C","D"]'::jsonb END,
                          'option_token_map', CASE WHEN q.item_type = 'mcq' THEN jsonb_build_object(
                              'opt_' || fi.ordinal || 'a', 'A', 'opt_' || fi.ordinal || 'b', 'B',
                              'opt_' || fi.ordinal || 'c', 'C', 'opt_' || fi.ordinal || 'd', 'D') END))
                   FROM public.test_sessions s
                   JOIN public.test_form_items fi ON fi.test_form_id = s.test_form_id
                   JOIN public.questions q ON q.id = fi.question_id
                  WHERE s.id = p_session AND fi.section = p_section AND fi.module = v_phys));
          IF (v->>'status')::int <> 200 THEN RAISE EXCEPTION 'G5-11 fixture: options %', v; END IF;
          FOR it IN
            SELECT fi.ordinal, fi.question_id, q.item_type
              FROM public.test_sessions s
              JOIN public.test_form_items fi ON fi.test_form_id = s.test_form_id
              JOIN public.questions q ON q.id = fi.question_id
             WHERE s.id = p_session AND fi.section = p_section AND fi.module = v_phys
             ORDER BY fi.ordinal
          LOOP
            v := public.exam_submit_answer(p_student, p_session, p_section, p_module, it.ordinal,
                   it.question_id,
                   CASE WHEN it.ordinal = ANY(p_right)
                        THEN CASE WHEN it.item_type = 'grid_in' THEN '1' ELSE 'A' END
                        ELSE CASE WHEN it.item_type = 'grid_in' THEN '2' ELSE 'B' END END,
                   'display', 1000, 'g511:' || p_session::text || ':' || v_phys || ':' || it.ordinal);
            IF (v->>'status')::int <> 200 THEN RAISE EXCEPTION 'G5-11 fixture: answer %', v; END IF;
          END LOOP;
        END $f$`);
      {
        const [made] = await q<{ v: { body: { session_id: string } } }>(
          `SELECT public.exam_create_session($1, $2, 'strict') AS v`,
          [AMBIGUOUS.student, FORM2],
        );
        AMBIGUOUS.sid = String(made!.v.body.session_id);
        for (const [section, module, right] of [
          ["RW", "1", "{0,1,2}"],
          ["RW", "2", "{}"],
        ] as const) {
          await q(
            `SELECT pg_temp.expect_status('fx', public.exam_start_module($1, $2, $3, $4), 200)`,
            [AMBIGUOUS.student, AMBIGUOUS.sid, section, module],
          );
          await q(`SELECT pg_temp.answer_only($1, $2, $3, $4, $5::int[])`, [
            AMBIGUOUS.student,
            AMBIGUOUS.sid,
            section,
            module,
            right,
          ]);
          await q(
            `SELECT pg_temp.expect_status('fx', public.exam_submit_module($1, $2, $3, $4), 200)`,
            [AMBIGUOUS.student, AMBIGUOUS.sid, section, module],
          );
        }
        for (const module of ["1", "2"]) {
          await q(
            `SELECT pg_temp.expect_status('fx', public.exam_start_module($1, $2, 'M', $3), 200)`,
            [AMBIGUOUS.student, AMBIGUOUS.sid, module],
          );
          await q(`SELECT pg_temp.answer_mixed($1, $2, 'M', $3)`, [
            AMBIGUOUS.student,
            AMBIGUOUS.sid,
            module,
          ]);
          await q(
            `SELECT pg_temp.expect_status('fx', public.exam_submit_module($1, $2, 'M', $3), 200)`,
            [AMBIGUOUS.student, AMBIGUOUS.sid, module],
          );
        }
      }
      await drain();
      const partial = c("partial");
      partial.sid = await walk(partial.student, FORM, "{RW}");
      await q(
        `SELECT pg_temp.expect_status('fx', public.exam_start_module($1, $2, 'M', '1'), 200)`,
        [partial.student, partial.sid],
      );
      await q(`SELECT pg_temp.answer_mixed($1, $2, 'M', '1')`, [
        partial.student,
        partial.sid,
      ]);
      await expire(partial.sid);
      await drain();
      // ABANDONED: started, nothing submitted, grace expired -> abandoned_final.
      const abandoned = c("abandoned");
      const [made] = await q<{ v: { body: { session_id: string } } }>(
        `SELECT public.exam_create_session($1, $2, 'strict') AS v`,
        [abandoned.student, FORM],
      );
      abandoned.sid = String(made!.v.body.session_id);
      await q(
        `SELECT pg_temp.expect_status('fx', public.exam_start_module($1, $2, 'RW', '1'), 200)`,
        [abandoned.student, abandoned.sid],
      );
      await expire(abandoned.sid);
      // The sweep above retries any pending scoring event, so the two states that need an
      // unconsumed (or dead-lettered) event are made after it.
      // FAILED: completed, its scoring event dead-lettered before the consumer ran.
      c("failed").sid = await walk(c("failed").student, FORM, "{RW,M}");
      await q(
        `UPDATE public.exam_runtime_outbox SET status = 'failed', attempts = 5, last_attempt_at = now() WHERE aggregate_id = $1`,
        [c("failed").sid],
      );
      // PENDING: completed, its scoring event not yet consumed.
      c("pending").sid = await walk(c("pending").student, FORM, "{RW,M}");
      // IN PROGRESS: started and still open.
      const live = c("in_progress");
      const [made2] = await q<{ v: { body: { session_id: string } } }>(
        `SELECT public.exam_create_session($1, $2, 'strict') AS v`,
        [live.student, FORM],
      );
      live.sid = String(made2!.v.body.session_id);
      await q(
        `SELECT pg_temp.expect_status('fx', public.exam_start_module($1, $2, 'RW', '1'), 200)`,
        [live.student, live.sid],
      );

      const { default: studentResources } =
        await import("../../server/routes/student-resources");
      const { default: reportRouter } =
        await import("../../server/routes/exam-report-routes");
      app = express();
      app.use(express.json());
      app.use((req: Request, _res: Response, next: NextFunction) => {
        const user = req.header("x-test-user");
        if (user) {
          (req as unknown as { user: unknown }).user = {
            id: user,
            actor_id: user,
            role: user === GUARDIAN ? "guardian" : "student",
          };
        }
        (req as unknown as { requestId: string }).requestId = "g5-08";
        next();
      });
      app.use("/api/students", studentResources);
      app.use("/api/tests", reportRouter);

      // Read every truth once: the student's own, then the guardian's wire.
      for (const x of CASES) {
        const own = await get(x.student, `/api/tests/sessions/${x.sid}/report`);
        expect(own.status, `${x.key} student report`).toBe(200);
        student.set(x.sid, examStudentReportPayloadSchema.parse(own.body.data));
        const forms = await listExamForms(x.student);
        if (!forms.ok) throw new Error(`${x.key}: forms ${forms.error.status}`);
        const latest = forms.value.forms.find(
          (f) => f.test_form_id === FORM,
        )?.latest_session;
        if (latest === undefined || latest === null) {
          throw new Error(`${x.key}: no latest session`);
        }
        cardWord.set(x.sid, formCardStateLabel(latest));

        const list = await get(GUARDIAN, `/api/students/${x.student}/tests`);
        expect(list.status, `${x.key} guardian list`).toBe(200);
        guardianExamListEnvelopeSchema.parse(list.body);
        guardianList.set(x.student, list.body);
        for (const t of list.body.tests as { session_id: string }[]) {
          const rep = await get(
            GUARDIAN,
            `/api/students/${x.student}/tests/${t.session_id}/report`,
          );
          expect(rep.status, `${x.key} guardian report`).toBe(200);
          guardianExamReportEnvelopeSchema.parse(rep.body);
          guardianReport.set(t.session_id, rep.body);
        }
      }
      // The partial student's earlier scored test, as the student sees it.
      const prev = await get(
        c("partial").student,
        `/api/tests/sessions/${partialPreviousSid}/report`,
      );
      student.set(
        partialPreviousSid,
        examStudentReportPayloadSchema.parse(prev.body.data),
      );
    }, 300_000);

    afterAll(async () => {
      cleanup();
      await testPg?.end();
    });

    /** Serve the guardian app exactly what the real routes answered. */
    function serve(x: Case): void {
      net.reset();
      net.roster = roster(CASES.map((y) => ({ id: y.student, name: y.name })));
      net.handlers.push((url) => {
        const base = `/api/students/${x.student}`;
        if (url.startsWith(`${base}/calendar?`)) return json(calendarWeek());
        if (url === `${base}/mastery/domains`) return json(masteryDomains());
        if (url === `${base}/tests`) return json(guardianList.get(x.student));
        const m = /^\/api\/students\/[^/]+\/tests\/([^/]+)\/report$/.exec(url);
        if (m !== null && url.startsWith(base)) {
          return json(guardianReport.get(m[1]!));
        }
        return undefined;
      });
    }

    it("G5-09: no guardian list item, in any real state, carries a score field", () => {
      const items = CASES.flatMap(
        (x) =>
          (guardianList.get(x.student) as { tests: Record<string, unknown>[] })
            .tests,
      );
      // Presence first: every case's session is listed, and the scored one has its scores on
      // its report.
      for (const x of CASES) {
        expect(
          items.some((t) => t.session_id === x.sid),
          x.key,
        ).toBe(true);
      }
      const scored = guardianReport.get(c("scored").sid) as {
        report: { score: { total_scaled: number } };
      };
      expect(scored.report.score.total_scaled).toBeGreaterThanOrEqual(400);
      for (const t of items) {
        expect(
          Object.keys(t).filter((k) => /scaled|score/i.test(k)),
          String(t.session_id),
        ).toEqual([]);
      }
    });

    /** The report calls the guardian app made, by session id. */
    const reportReads = (): string[] =>
      net.log.flatMap((l) => {
        const m = /\/tests\/([^/?]+)\/report/.exec(l);
        return m === null ? [] : [m[1]!];
      });

    async function settledCard(): Promise<HTMLElement> {
      await screen.findByTestId("latest-test-meta");
      const card = screen.getByTestId("latest-test-card");
      await waitFor(() =>
        expect(card.getAttribute("data-change-settled")).toBe("true"),
      );
      return card;
    }

    it("every state is real: the producer made exactly the six", () => {
      expect(
        CASES.map((x) => [x.key, student.get(x.sid)?.report_state]),
      ).toEqual([
        ["scored", "scored"],
        ["partial", "partial_scored"],
        ["pending", "scoring_pending"],
        ["failed", "failed_requires_review"],
        ["abandoned", "not_completed"],
        ["in_progress", "not_completed"],
      ]);
      const abandoned = student.get(c("abandoned").sid);
      const live = student.get(c("in_progress").sid);
      expect(
        abandoned?.report_state === "not_completed" && abandoned.resumable,
      ).toBe(false);
      expect(live?.report_state === "not_completed" && live.resumable).toBe(
        true,
      );
    });

    it.each(CASES.map((x) => [x.key, x] as const))(
      "%s: the guardian list says the student's own card word",
      async (_key, x) => {
        serve(x);
        mountApp(Router, `/guardian/${x.student}/exams`);
        const list = await screen.findByTestId("guardian-exam-list");
        const row = within(list).getByTestId(`guardian-exam-row-${x.sid}`);
        expect(text(within(row).getByTestId("guardian-exam-state"))).toBe(
          cardWord.get(x.sid),
        );
        cleanup();
      },
    );

    it.each(CASES.map((x) => [x.key, x] as const))(
      "%s: the guardian detail says what the student's report says",
      async (_key, x) => {
        const own = studentView(student.get(x.sid)!);
        serve(x);
        mountApp(Router, `/guardian/${x.student}/exams/${x.sid}`);
        const root = await screen.findByTestId("guardian-exam-report");
        const guardian = {
          line: text(root.querySelector("p")),
          panelTitle: text(root.querySelector("section h2")) || null,
          panelBody:
            text(
              root
                .querySelector("section h2")
                ?.parentElement?.querySelector("p"),
            ) || null,
          total:
            text(root.querySelector('[data-testid="exam-total-score"]')) ||
            null,
          sections: Array.from(
            root.querySelectorAll('[data-testid="exam-section-score"]'),
          ).map((e) => text(e).replace(/\s*200–800$/, "")),
          partialSummary:
            text(root.querySelector('[data-testid="exam-partial-summary"]')) ||
            null,
        };
        expect(guardian.line).toBe(own.line);
        expect(guardian.panelTitle).toBe(
          own.panelTitle === null ? null : namedFor(x.name, own.panelTitle),
        );
        // No sentence the student's report does not have (adapted to name the student).
        const allowed = sentences(namedFor(x.name, own.panelBody ?? ""));
        for (const s of sentences(guardian.panelBody ?? "")) {
          expect(allowed, `${x.key}: "${s}"`).toContain(s);
        }
        expect(guardian.total).toBe(own.total);
        expect(guardian.sections).toEqual(own.sections);
        expect(guardian.partialSummary).toBe(own.partialSummary);
        cleanup();
      },
    );

    it.each(CASES.map((x) => [x.key, x] as const))(
      "%s: the Dashboard card shows the same state and numbers",
      async (_key, x) => {
        const own = studentView(student.get(x.sid)!);
        serve(x);
        mountApp(Router, `/guardian/${x.student}`);
        const card = await settledCard();
        // G5-09: the card's numbers came through the report route — its own report was read,
        // and the only other report read is the previous scored test's (at most two).
        const reads = new Set(reportReads());
        expect(reads.has(x.sid), `${x.key}: own report read`).toBe(true);
        expect(reads.size, `${x.key}: report reads`).toBeLessThanOrEqual(2);
        expect(text(within(card).getByTestId("latest-test-meta"))).toContain(
          student.get(x.sid)!.test_form_name,
        );
        if (own.total !== null) {
          expect(text(within(card).getByTestId("latest-test-total"))).toBe(
            own.total,
          );
        }
        if (own.sections.length > 0) {
          expect(
            within(card)
              .getAllByTestId(/^latest-test-section-/)
              .map((e) => text(e)),
          ).toEqual(own.sections);
        }
        if (own.partialSummary !== null) {
          expect(
            text(within(card).getByTestId("latest-test-state-title")),
          ).toBe("Partial score");
        }
        if (own.panelTitle !== null && own.partialSummary === null) {
          expect(
            text(within(card).getByTestId("latest-test-state-title")),
          ).toBe(namedFor(x.name, own.panelTitle));
          expect(within(card).queryByTestId("latest-test-total")).toBeNull();
        }
        cleanup();
      },
    );

    type Drawn = { domain: string; segments: number; filled: number };

    /** Renders `node`, opens Score breakdown, and reads each domain row in page order. */
    function breakdownOf(node: ReactElement): Drawn[] {
      const { unmount } = render(node);
      fireEvent.click(screen.getByRole("tab", { name: "Score breakdown" }));
      const rows = within(screen.getByTestId("exam-domain-breakdown"))
        .getAllByTestId("exam-domain-row")
        .map((row) => {
          const segs = within(row).queryAllByTestId("exam-domain-segment");
          return {
            domain: text(row.querySelector("span")),
            segments: segs.length,
            filled: segs.filter((x) => x.dataset.filled === "true").length,
          };
        });
      unmount();
      return rows;
    }

    /** The guardian detail's Score breakdown, from what the real guardian route answered. */
    async function guardianBreakdown(
      who: string,
      sid: string,
    ): Promise<Drawn[]> {
      net.reset();
      net.roster = roster([
        ...CASES.map((y) => ({ id: y.student, name: y.name })),
        { id: AMBIGUOUS.student, name: "Ana" },
      ]);
      const body = (
        await get(GUARDIAN, `/api/students/${who}/tests/${sid}/report`)
      ).body as unknown;
      guardianExamReportEnvelopeSchema.parse(body);
      net.handlers.push((url) =>
        url === `/api/students/${who}/tests/${sid}/report`
          ? json(body)
          : undefined,
      );
      mountApp(Router, `/guardian/${who}/exams/${sid}`);
      await screen.findByTestId("guardian-exam-report");
      fireEvent.click(screen.getByRole("tab", { name: "Score breakdown" }));
      const rows = within(screen.getByTestId("exam-domain-breakdown"))
        .getAllByTestId("exam-domain-row")
        .map((row) => {
          const segs = within(row).queryAllByTestId("exam-domain-segment");
          return {
            domain: text(row.querySelector("span")),
            segments: segs.length,
            filled: segs.filter((x) => x.dataset.filled === "true").length,
          };
        });
      cleanup();
      return rows;
    }

    /** The student's own Score breakdown, from the real student route. */
    async function studentBreakdown(
      who: string,
      sid: string,
    ): Promise<Drawn[]> {
      const own = await get(who, `/api/tests/sessions/${sid}/report`);
      expect(own.status).toBe(200);
      return breakdownOf(
        <ReportBody
          payload={examStudentReportPayloadSchema.parse(own.body.data)}
        />,
      );
    }

    it.each([
      ["scored", () => c("scored")],
      ["partial", () => c("partial")],
      ["3 of 14 in one domain", () => ({ ...AMBIGUOUS, key: "ambiguous" })],
    ] as const)(
      "G5-11 %s: the guardian breakdown is the student's — domains, order, segments, filled",
      async (_name, pick) => {
        const x = pick();
        const own = await studentBreakdown(x.student, x.sid);
        // Presence first: rows, seven segments each, some filled.
        expect(own.length).toBeGreaterThan(0);
        expect(own.every((r) => r.segments === 7)).toBe(true);
        expect(own.some((r) => r.filled > 0)).toBe(true);
        expect(await guardianBreakdown(x.student, x.sid)).toEqual(own);
      },
    );

    it("G5-12 partial: the guardian breakdown says the student's note for the section with no score", async () => {
      const x = c("partial");
      // The student's own note, from the real student route through the student's ReportBody.
      const own = await get(x.student, `/api/tests/sessions/${x.sid}/report`);
      expect(own.status).toBe(200);
      const payload = examStudentReportPayloadSchema.parse(own.body.data);
      if (payload.report_state !== "partial_scored") {
        throw new Error(payload.report_state);
      }
      render(<ReportBody payload={payload} />);
      fireEvent.click(screen.getByRole("tab", { name: "Score breakdown" }));
      const studentNotes = screen
        .queryAllByTestId("exam-domain-omitted")
        .map((n) => text(n));
      cleanup();
      // Presence first: the student has a note, naming the section with no score.
      expect(payload.incomplete_sections.length).toBeGreaterThan(0);
      expect(studentNotes.length).toBeGreaterThan(0);
      // The guardian's, from the real guardian route through the guardian detail.
      net.reset();
      net.roster = roster(CASES.map((y) => ({ id: y.student, name: y.name })));
      const body = (
        await get(GUARDIAN, `/api/students/${x.student}/tests/${x.sid}/report`)
      ).body as unknown;
      guardianExamReportEnvelopeSchema.parse(body);
      net.handlers.push((url) =>
        url === `/api/students/${x.student}/tests/${x.sid}/report`
          ? json(body)
          : undefined,
      );
      mountApp(Router, `/guardian/${x.student}/exams/${x.sid}`);
      await screen.findByTestId("guardian-exam-report");
      fireEvent.click(screen.getByRole("tab", { name: "Score breakdown" }));
      const guardianNotes = screen
        .queryAllByTestId("exam-domain-omitted")
        .map((n) => text(n));
      cleanup();
      expect(guardianNotes).toEqual(studentNotes);
    });

    it("G5-11: the real 3-of-14 domain fills 2 on both sides, where a whole percent (21%) would fill 1", async () => {
      const [row] = await q<{
        d: Array<{ domain: string; correct: number; total: number }>;
      }>(
        `SELECT public.exam_domain_breakdown($1, $2) -> 'body' -> 'domains' AS d`,
        [AMBIGUOUS.student, AMBIGUOUS.sid],
      );
      const ii = row!.d.find((r) => r.domain === "Information and Ideas");
      expect(ii).toMatchObject({ correct: 3, total: 14 });
      // A whole percent would round to 21, and 21 × 7 / 100 = 1.47 rounds to 1.
      expect(Math.round((100 * 3) / 14)).toBe(21);
      const guardian = await guardianBreakdown(
        AMBIGUOUS.student,
        AMBIGUOUS.sid,
      );
      const own = await studentBreakdown(AMBIGUOUS.student, AMBIGUOUS.sid);
      const filledOf = (rows: Drawn[]) =>
        rows.find((r) => r.domain === "Information and Ideas")?.filled;
      expect(filledOf(own)).toBe(2);
      expect(filledOf(guardian)).toBe(2);
    });

    it("partial: the chip compares the scored section with that section of the previous scored test", async () => {
      const x = c("partial");
      const now = student.get(x.sid)!;
      const before = student.get(partialPreviousSid)!;
      if (
        now.report_state !== "partial_scored" ||
        before.report_state !== "scored"
      ) {
        throw new Error("fixture drift");
      }
      const done = now.completed_sections;
      expect(done).toHaveLength(1);
      const section = done[0]!;
      const key = section === "RW" ? "rw_scaled" : "math_scaled";
      const delta = now.score[key]! - before.score[key];
      serve(x);
      mountApp(Router, `/guardian/${x.student}`);
      await settledCard();
      // G5-09: both sides of the chip came from the report route: exactly these two reads.
      expect(new Set(reportReads())).toEqual(
        new Set([x.sid, partialPreviousSid]),
      );
      const chip = screen.getByTestId("latest-test-change");
      const label = section === "RW" ? "Reading and Writing" : "Math";
      expect(text(chip)).toBe(
        delta === 0
          ? `No change in ${label} since last test`
          : `${delta < 0 ? "▼" : "▲"} ${Math.abs(delta)} in ${label} since last test`,
      );
      cleanup();
    });
  },
);
