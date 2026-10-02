// @vitest-environment jsdom
/**
 * G5-08 — the guardian's exam surfaces mirror the student's own outcomes, real Postgres end to end.
 *
 * @spec [Guardian_Closure_Plan G5-08 (owner brief 2026-10-02: one state per real session, the
 *       guardian card, list and detail show the student's state, label and numbers); Doc-04C
 *       §2.6 rule 7 (strict subset), §12.2/§12.3; SCL-181 (route family, projection);
 *       SCL-199 (list scores); owner decisions 2026-10-02 (a partial score is compared section
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
 * The deliberate differences are not compared: the guardian sees bars without counts
 * (SCL-189), no skills and no answers, and no resume or review control (§12.3).
 *
 * Runs only where PGHOST is set; named by file in CI (.github/workflows/ci.yml).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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
      for (const x of CASES) {
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
        const card = await screen
          .findByTestId("latest-test-meta")
          .then(() => screen.getByTestId("latest-test-card"));
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
      await screen.findByTestId("latest-test-meta");
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
