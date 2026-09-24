/**
 * D1 — flagging a conversation for crisis review is one transaction.
 *
 * @spec [Doc-03_V3 §21.2 step 5, §21.3; CR-03C-V3-01 §3.4; SCL-025;
 *        WS-L8 Item 4b; owner ruling 2026-09-22 D1]
 * @implemented 2026-09-22
 *
 * plain English: the flag and the review case used to be two writes in
 * sequence. Between them sat a state the system must never be in — a
 * conversation MARKED as a crisis with NOTHING in the review queue. The turn
 * failed and the student saw an error, correctly, but the flag stayed set.
 * Nothing sweeps for a flagged conversation without a case, and the 48h SLA
 * never starts because the SLA lives on the case that was never created.
 *
 * D1.3 is the test the ruling asked for: force a failure AFTER the flag write
 * and require that nothing survives. It forces it the way production would —
 * a foreign key violation on `student_id`, which is the case INSERT's second
 * write and the failure the old code could not roll back.
 *
 * trade-offs:
 *  - Real Postgres, bootstrapped from supabase/migrations. A mock cannot
 *    demonstrate a rollback; the whole claim is about transaction boundaries,
 *    which only a database has.
 *  - D1.6 drops the newer CHECK constraint to simulate production schema drift
 *    (WS-L8 Item 4b) rather than trusting the fallback function's existence.
 *
 * edge cases:
 *  - D1.4: a second signal on the same conversation returns the FIRST case and
 *    leaves its SLA deadline alone. Restarting the clock on a duplicate signal
 *    would extend the review window every time the classifier fired again.
 *  - D1.7: a conversation id that does not exist fails. PostgREST reports no
 *    error when a filtered UPDATE matches zero rows, which is why the old code
 *    reported success and then failed confusingly on the case INSERT's FK.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { bootstrapPgDatabase, PG_AVAILABLE } from "../helpers/pg-supabase";

const DB_NAME = "crisis_flag_atomic_ci";

const STUDENT = "0c1c1c1c-0000-4000-8000-00000000000a";
const OTHER_STUDENT = "0c1c1c1c-0000-4000-8000-00000000000b";
const CONVERSATION = "0c1c1c1c-0000-4000-8000-00000000000c";
const MISSING_CONVERSATION = "0c1c1c1c-0000-4000-8000-0000000000ff";
/** Not in profiles — the FK violation D1.3 uses to force a post-flag failure. */
const GHOST_STUDENT = "0c1c1c1c-0000-4000-8000-0000000000fe";

let pg: Client;

async function flag(
  opts: {
    conversationId?: string;
    studentId?: string;
    source?: string;
    signatureId?: string | null;
    modelConfidence?: number | null;
    category?: string;
  } = {},
): Promise<Record<string, unknown>> {
  const r = await pg.query(
    `SELECT public.flag_conversation_for_crisis_review($1, $2, $3, $4, $5, $6) AS result`,
    [
      opts.conversationId ?? CONVERSATION,
      opts.studentId ?? STUDENT,
      opts.source ?? "signature",
      opts.signatureId ?? null,
      opts.modelConfidence ?? null,
      opts.category ?? "crisis",
    ],
  );
  return r.rows[0].result as Record<string, unknown>;
}

async function state(): Promise<{ flagged: boolean; cases: number }> {
  const f = await pg.query(
    `SELECT crisis_flagged FROM public.tutor_conversations WHERE id = $1`,
    [CONVERSATION],
  );
  const c = await pg.query(
    `SELECT count(*)::int AS n FROM public.crisis_review_cases WHERE conversation_id = $1`,
    [CONVERSATION],
  );
  return {
    flagged: f.rows[0]?.crisis_flagged === true,
    cases: c.rows[0].n as number,
  };
}

describe.skipIf(!PG_AVAILABLE)(
  "Crisis flag atomicity (Doc 03 §21.3 / D1)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);

      for (const [id, email] of [
        [STUDENT, "d1-student@example.test"],
        [OTHER_STUDENT, "d1-other@example.test"],
      ] as const) {
        await pg.query(
          `INSERT INTO auth.users (id, email) VALUES ($1, $2)
             ON CONFLICT (id) DO NOTHING`,
          [id, email],
        );
        await pg.query(
          `INSERT INTO public.profiles (id, email, role)
           VALUES ($1, $2, 'student') ON CONFLICT (id) DO NOTHING`,
          [id, email],
        );
      }
    }, 240_000);

    afterAll(async () => {
      await pg?.end();
    });

    beforeEach(async () => {
      await pg.query(`DELETE FROM public.crisis_review_cases`);
      await pg.query(`DELETE FROM public.tutor_conversations`);
      await pg.query(
        `INSERT INTO public.tutor_conversations
           (id, student_id, entry_mode, source_surface, crisis_flagged)
         VALUES ($1, $2, 'general', 'dashboard', false)`,
        [CONVERSATION, STUDENT],
      );
    });

    it("D1.1 — the SLA window is defined once, in SQL, and is 48 hours", async () => {
      // Doc 03 §21.3 publishes 48h at launch. If this changes it changes HERE
      // and the function follows; a TypeScript copy is what this asserts does
      // not decide the deadline any more.
      const r = await pg.query(`SELECT public.crisis_review_sla_hours() AS h`);
      expect(r.rows[0].h).toBe(48);
    });

    it("D1.2 — the happy path flags the conversation AND creates the case", async () => {
      const before = await state();
      expect(before).toEqual({ flagged: false, cases: 0 });

      const result = await flag();
      expect(result.already_existed).toBe(false);
      expect(result.persisted_source).toBe("signature");
      expect(result.case_status).toBe("open");
      expect(typeof result.case_id).toBe("string");

      expect(await state()).toEqual({ flagged: true, cases: 1 });

      // The deadline is the database's, 48h out, not the caller's.
      const c = await pg.query(
        `SELECT sla_deadline, created_at FROM public.crisis_review_cases
          WHERE id = $1`,
        [result.case_id],
      );
      const gapHours =
        (new Date(c.rows[0].sla_deadline as string).getTime() -
          new Date(c.rows[0].created_at as string).getTime()) /
        3_600_000;
      expect(Math.round(gapHours)).toBe(48);
    });

    it("D1.3 — a failure AFTER the flag write leaves NOTHING (the ruling's test)", async () => {
      // GHOST_STUDENT is absent from profiles, so the case INSERT violates
      // crisis_review_cases_student_id_fkey. That INSERT is the SECOND write:
      // the UPDATE that sets crisis_flagged has already succeeded when it
      // fails. Before D1 this left the conversation flagged with no case.
      await expect(flag({ studentId: GHOST_STUDENT })).rejects.toThrow(
        /foreign key|violates/i,
      );

      expect(await state()).toEqual({ flagged: false, cases: 0 });
    });

    it("D1.4 — a second signal returns the FIRST case and does not move its deadline", async () => {
      const first = await flag({ source: "signature" });
      const firstRow = await pg.query(
        `SELECT sla_deadline FROM public.crisis_review_cases WHERE id = $1`,
        [first.case_id],
      );

      const second = await flag({ source: "model" });

      expect(second.case_id).toBe(first.case_id);
      expect(second.already_existed).toBe(true);
      // The source belongs to the earlier signal, so this call reports none.
      expect(second.persisted_source).toBeNull();

      // Exactly one case, and its clock did not restart. Restarting it on
      // every duplicate signal would extend the review window indefinitely
      // during one sustained event — the opposite of what an SLA is for.
      expect(await state()).toEqual({ flagged: true, cases: 1 });
      expect(new Date(second.sla_deadline as string).toISOString()).toBe(
        new Date(firstRow.rows[0].sla_deadline as string).toISOString(),
      );
    });

    it("D1.12 — case_status is read back from the row, not assumed", async () => {
      // `evaluateNotificationPolicy` throttles on this value: an in_review
      // case means a human has claimed it and a second signal of the same
      // severity must NOT page again. Returning a hardcoded 'open' would
      // re-page every time during exactly the event someone is working.
      const first = await flag();
      expect(first.case_status).toBe("open");

      await pg.query(
        `UPDATE public.crisis_review_cases SET status = 'in_review' WHERE id = $1`,
        [first.case_id],
      );

      const second = await flag({ source: "model" });
      expect(second.already_existed).toBe(true);
      expect(second.case_id).toBe(first.case_id);
      expect(second.case_status).toBe("in_review");
    });

    it("D1.5 — a RESOLVED case does not block a new one (the index is partial)", async () => {
      const first = await flag();
      await pg.query(
        `UPDATE public.crisis_review_cases SET status = 'resolved' WHERE id = $1`,
        [first.case_id],
      );

      const second = await flag();
      expect(second.already_existed).toBe(false);
      expect(second.case_id).not.toBe(first.case_id);
      expect((await state()).cases).toBe(2);
    });

    it("D1.6 — a source newer than the CHECK constraint degrades, it does not fail (WS-L8 4b)", async () => {
      // Simulate production running the pre-20260819 constraint. The live
      // definition is saved and restored verbatim: a hard-coded restore here
      // silently dropped every value a later migration adds (found by W3-5's
      // 'model_armor_dangerous').
      const saved = await pg.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'public.crisis_review_cases'::regclass
            AND conname = 'crisis_review_cases_source_check'`,
      );
      const liveDef = saved.rows[0].def as string;
      await pg.query(
        `ALTER TABLE public.crisis_review_cases
           DROP CONSTRAINT IF EXISTS crisis_review_cases_source_check`,
      );
      await pg.query(
        `ALTER TABLE public.crisis_review_cases
           ADD CONSTRAINT crisis_review_cases_source_check
           CHECK (source IN ('signature', 'model', 'both', 'classifier_degraded'))`,
      );
      try {
        const result = await flag({ source: "infrastructure_failure" });

        // The case persists; only its precision degrades.
        expect(result.already_existed).toBe(false);
        expect(result.persisted_source).toBe("classifier_degraded");
        expect(await state()).toEqual({ flagged: true, cases: 1 });
      } finally {
        await pg.query(
          `ALTER TABLE public.crisis_review_cases
             DROP CONSTRAINT IF EXISTS crisis_review_cases_source_check`,
        );
        await pg.query(
          `ALTER TABLE public.crisis_review_cases
             ADD CONSTRAINT crisis_review_cases_source_check ${liveDef}`,
        );
      }
    });

    it("D1.7 — a CHECK violation with no fallback still fails, and rolls the flag back", async () => {
      // The tolerance is narrow by design: only the two source values added
      // after the original constraint have a fallback. Anything else is a real
      // violation and must block the turn (B1.1d).
      await expect(flag({ category: "not-a-category" })).rejects.toThrow(
        /violates check constraint/i,
      );
      expect(await state()).toEqual({ flagged: false, cases: 0 });
    });

    it("D1.8 — a conversation that does not exist fails instead of reporting success", async () => {
      // PostgREST reports no error when a filtered UPDATE matches zero rows,
      // so the old code returned success here and then failed on the case
      // INSERT's foreign key — a confusing FK error for a bad conversation id.
      await expect(
        flag({ conversationId: MISSING_CONVERSATION }),
      ).rejects.toThrow(/does not exist/i);

      const c = await pg.query(
        `SELECT count(*)::int AS n FROM public.crisis_review_cases`,
      );
      expect(c.rows[0].n).toBe(0);
    });

    it("D1.9 — the fallback map has exactly the two values WS-L8 4b names", async () => {
      // A third entry would silently widen the tolerance the ruling kept
      // narrow: every other CHECK violation must block the turn.
      const r = await pg.query(
        `SELECT s AS src, public.crisis_source_fallback(s) AS fb
           FROM unnest(ARRAY['signature','model','both','classifier_degraded',
                             'classifier_degraded_no_floor','infrastructure_failure',
                             'model_armor_dangerous']) AS s`,
      );
      const map = Object.fromEntries(
        (r.rows as { src: string; fb: string | null }[]).map((x) => [
          x.src,
          x.fb,
        ]),
      );
      expect(map).toEqual({
        signature: null,
        model: null,
        both: null,
        classifier_degraded: null,
        classifier_degraded_no_floor: "classifier_degraded",
        infrastructure_failure: "classifier_degraded",
        // W3-5: deliberately NO fallback — it is not a classifier signal.
        model_armor_dangerous: null,
      });
    });

    it("D1.13 — W3-5: source model_armor_dangerous persists as itself (migration 20261003000000)", async () => {
      const result = await flag({ source: "model_armor_dangerous" });
      expect(result.already_existed).toBe(false);
      expect(result.persisted_source).toBe("model_armor_dangerous");
      expect(await state()).toEqual({ flagged: true, cases: 1 });
    });

    it("D1.10 — the function is not callable by anon or authenticated", async () => {
      for (const role of ["anon", "authenticated"]) {
        const r = await pg.query(
          `SELECT has_function_privilege($1,
             'public.flag_conversation_for_crisis_review(uuid,uuid,text,uuid,numeric,text)',
             'EXECUTE') AS can`,
          [role],
        );
        expect(`${role}:${r.rows[0].can}`).toBe(`${role}:false`);
      }
      const svc = await pg.query(
        `SELECT has_function_privilege('service_role',
           'public.flag_conversation_for_crisis_review(uuid,uuid,text,uuid,numeric,text)',
           'EXECUTE') AS can`,
      );
      expect(svc.rows[0].can).toBe(true);
    });

    it("D1.11 — no TypeScript copy of the SLA or the fallback map survives", async () => {
      // The constants moved into SQL. A leftover copy in the service layer is
      // a second definition that drifts the first time either changes.
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const src = readFileSync(
        resolve(__dirname, "../../server/services/crisis-review-queue.ts"),
        "utf-8",
      );
      expect(src).not.toMatch(/const\s+SLA_HOURS\s*=/);
      expect(src).not.toMatch(/const\s+SOURCE_FALLBACK\s*(:|=)/);
      expect(src).not.toMatch(
        /export\s+async\s+function\s+createCrisisReviewCase/,
      );
    });
  },
);
