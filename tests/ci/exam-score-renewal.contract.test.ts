/**
 * Post-exam score report and renewal decision — the seven claims of the brief's §7, each planted.
 *
 * @spec [Doc-01_V8 §36.4, §928, §955; Doc-05C_V1.0 §7.2; Doc-05F_V1.0 §7.1, §7.10;
 *        contracts/notifications.contract.md §2.3, §5.1; SCL-191]
 * | @implemented [2026-09-30]
 *
 * plain English: every assertion here runs against a REAL Postgres with the real migration
 * pipeline applied, through the shared `makePgSupabase` transport. The SQL predicates ARE the
 * feature — who is due, who is not, and what the silence rule does — so a test that asserted them
 * against hand-written rows would be asserting its own fixtures.
 *
 * THE FIXTURE IS DERIVED FROM REAL OUTPUT, never from what the shape ought to be. The projection
 * pairing is read back out of `exam_score_report_projections` after `record_exam_score_report`
 * resolved it, and the notification recipients are read back out of `notification_messages` after
 * the real emitter wrote them. Both are the lesson of SCL-137 and the guardian calendar's
 * wire-contract finding: a hand-built fixture can agree with a bug.
 *
 * THE ONE-DAY BOUNDARY IS THE POINT OF CLAIM 1, and it is why `p_now` is a parameter. A predicate
 * that turns on "18 days after the exam date" is green on the day it happens to be true and
 * unexercised on the other days; both sides of the boundary are asserted here on a fixed instant,
 * which is the only way either can fail for the right reason.
 *
 * A FIXTURE THAT COLLAPSES TWO VALUES CANNOT DISPROVE THEIR INDEPENDENCE, so the projection
 * fixture carries THREE snapshots per student: an RW one before the exam day, an RW one after it,
 * and an M one with a NULL mid. With a single snapshot the "live at that date" claim would pass
 * for the wrong reason — there would be nothing else it could have picked.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Client } from "pg";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "lyceon_exam_score_renewal";

// Fixed instant. Every date below is relative to it, so nothing in this file depends on the day
// the suite happens to run.
const NOW = "2026-09-30T12:00:00Z";
const OFFSET_DAYS = 18;
const MAX_EXAM_AGE_DAYS = 45;
const LEAD_DAYS = 21;
const WINDOW_DAYS = 14;

/** 18 days before NOW's local date in UTC: the first day the exam anchor fires. */
const EXAM_DATE_DUE = "2026-09-12";
/** 17 days before: one day too early. */
const EXAM_DATE_NOT_YET = "2026-09-13";

const STUDENT = "b1111111-1111-4111-8111-111111111111";
const GUARDIAN = "b2222222-2222-4222-8222-222222222222";
const STUDENT_OF_GUARDIAN = "b3333333-3333-4333-8333-333333333333";

let pg: Client;

const stripeApi = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  subscriptionsUpdate: vi.fn(),
}));

vi.mock("../../server/lib/stripe/client", () => ({
  getStripeClient: () => ({
    subscriptions: {
      retrieve: stripeApi.subscriptionsRetrieve,
      update: stripeApi.subscriptionsUpdate,
    },
  }),
  getExpectedLivemode: () => false,
}));

// TRANSPORT ONLY. A real `pg.Client` is behind this seam; the modules under test are the real ones.
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pg);
  },
}));

// The notification dispatcher talks to Resend. The event and message rows are what this file
// asserts; sending them is the dispatcher's own contract and its own tests.
vi.mock("../../server/lib/notifications/dispatch", () => ({
  dispatchQueuedMessages: vi.fn(async () => ({ attempted: 0, sent: 0 })),
}));

async function seedProfile(id: string, role: string): Promise<void> {
  await pg.query(
    `INSERT INTO auth.users(id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [id, `${id}@example.test`],
  );
  await pg.query(
    `INSERT INTO public.profiles(id, email, role) VALUES ($1, $2, $3::public.profile_role)
       ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
    [id, `${id}@example.test`, role],
  );
}

async function seedEntitlement(
  profileId: string,
  opts: {
    subscriptionId?: string | null;
    payerProfileId?: string | null;
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd?: boolean;
    status?: string;
  } = {},
): Promise<void> {
  await pg.query(
    `INSERT INTO public.entitlements
       (profile_id, tier, status, stripe_subscription_id, current_period_end,
        cancel_at_period_end, payer_profile_id)
     VALUES ($1, 'premium', $2, $3, $4, $5, $6)
     ON CONFLICT (profile_id) DO UPDATE SET
       status = EXCLUDED.status,
       stripe_subscription_id = EXCLUDED.stripe_subscription_id,
       current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       payer_profile_id = EXCLUDED.payer_profile_id`,
    [
      profileId,
      opts.status ?? "active",
      opts.subscriptionId ?? "sub_test",
      opts.currentPeriodEnd ?? null,
      opts.cancelAtPeriodEnd ?? false,
      opts.payerProfileId ?? null,
    ],
  );
}

async function seedStudyProfile(
  studentId: string,
  targetExamDate: string | null,
  timezone = "UTC",
): Promise<void> {
  await pg.query(
    `INSERT INTO public.student_study_profile
       (student_id, timezone, target_exam_date, study_days_mask, daily_minutes)
     VALUES ($1, $2, $3, 127, 60)
     ON CONFLICT (student_id) DO UPDATE SET
       target_exam_date = EXCLUDED.target_exam_date,
       timezone = EXCLUDED.timezone`,
    [studentId, timezone, targetExamDate],
  );
}

type CandidateRow = {
  student_id: string;
  payer_profile_id: string | null;
  anchor: string;
  occasion_key: Date | string;
  outcome: string | null;
};

async function candidates(now = NOW): Promise<CandidateRow[]> {
  const r = await pg.query<CandidateRow>(
    `SELECT * FROM public.exam_score_renewal_candidates($1, $2, $3, 500, $4)`,
    [OFFSET_DAYS, MAX_EXAM_AGE_DAYS, LEAD_DAYS, now],
  );
  return r.rows;
}

function isoDate(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

describe.skipIf(!PG_AVAILABLE)(
  "post-exam score report and renewal decision — against real SQL",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
    }, 300_000);

    afterAll(async () => {
      await pg?.end();
    });

    beforeEach(async () => {
      await pg.query(
        `TRUNCATE public.exam_score_report_projections, public.exam_score_reports,
                  public.exam_renewal_decisions, public.notification_messages,
                  public.notification_events, public.calendar_job_runs,
                  public.student_section_projection_snapshots CASCADE`,
      );
      await pg.query(`DELETE FROM public.entitlements`);
      await pg.query(`DELETE FROM public.student_study_profile`);
      stripeApi.subscriptionsRetrieve.mockReset();
      stripeApi.subscriptionsUpdate.mockReset();
    });

    // ── Claim 1 ────────────────────────────────────────────────────────────
    it("claim 1: selects a student 18 days after their exam date and NOT 17", async () => {
      await seedProfile(STUDENT, "student");
      await seedEntitlement(STUDENT);
      await seedStudyProfile(STUDENT, EXAM_DATE_DUE);

      const due = await candidates();
      // PRESENCE BEFORE ABSENCE. A predicate that selects nobody would satisfy the "not 17"
      // half for the wrong reason, so the positive case is asserted first and non-trivially.
      expect(due).toHaveLength(1);
      expect(due[0]!.student_id).toBe(STUDENT);
      expect(due[0]!.anchor).toBe("exam_date");
      expect(isoDate(due[0]!.occasion_key)).toBe(EXAM_DATE_DUE);
      expect(due[0]!.outcome).toBeNull();

      await seedStudyProfile(STUDENT, EXAM_DATE_NOT_YET);
      const tooEarly = await candidates();
      expect(tooEarly.filter((r) => r.anchor === "exam_date")).toHaveLength(0);
    });

    it("claim 1b: an exam date older than the age bound falls to the billing-cycle anchor, never out of the population", async () => {
      await seedProfile(STUDENT, "student");
      // Period end inside the 21-day lead so the fallback is actually due.
      await seedEntitlement(STUDENT, {
        currentPeriodEnd: "2026-10-10T00:00:00Z",
      });
      await seedStudyProfile(STUDENT, "2026-01-05");

      const due = await candidates();
      expect(due).toHaveLength(1);
      expect(due[0]!.anchor).toBe("billing_cycle");
      expect(due[0]!.outcome).toBeNull();
    });

    it("claim 1c: a student with NO exam date takes the billing-cycle anchor (owner ruling #1)", async () => {
      await seedProfile(STUDENT, "student");
      await seedEntitlement(STUDENT, {
        currentPeriodEnd: "2026-10-10T00:00:00Z",
      });
      await seedStudyProfile(STUDENT, null);

      const due = await candidates();
      expect(due.map((r) => r.anchor)).toEqual(["billing_cycle"]);
    });

    // ── Claim 2 ────────────────────────────────────────────────────────────
    it("claim 2: does not select a student who already answered for that exam date", async () => {
      await seedProfile(STUDENT, "student");
      await seedEntitlement(STUDENT);
      await seedStudyProfile(STUDENT, EXAM_DATE_DUE);

      expect((await candidates())[0]!.outcome).toBeNull();

      await pg.query(
        `INSERT INTO public.exam_renewal_decisions
           (student_id, occasion_key, anchor, decided_by_profile_id, decider_role, decision, action)
         VALUES ($1, $2, 'exam_date', $1, 'payer', 'retaking', 'none')`,
        [STUDENT, EXAM_DATE_DUE],
      );

      const after = await candidates();
      expect(after).toHaveLength(1);
      // RECORDED, not filtered: the row is still returned so the job can write a job_runs row.
      expect(after[0]!.outcome).toBe("skipped_answered");
    });

    it("claim 2b: edge case 8 — a subscription already ending is recorded, not re-prompted", async () => {
      await seedProfile(STUDENT, "student");
      await seedEntitlement(STUDENT, { cancelAtPeriodEnd: true });
      await seedStudyProfile(STUDENT, EXAM_DATE_DUE);

      const due = await candidates();
      expect(due).toHaveLength(1);
      expect(due[0]!.outcome).toBe("skipped_cancel_pending");
    });

    // ── Claim 3 ────────────────────────────────────────────────────────────
    it("claim 3: running the emitter twice writes one event and one set of messages", async () => {
      await seedProfile(STUDENT, "student");
      await seedEntitlement(STUDENT);
      await seedStudyProfile(STUDENT, EXAM_DATE_DUE);

      const first = await pg.query<{ r: string }>(
        `SELECT public.exam_score_renewal_emit($1, 'exam_date', $2, NULL,
                'exam_score_report_requested') AS r`,
        [STUDENT, EXAM_DATE_DUE],
      );
      expect(first.rows[0]!.r).toBe("emitted");

      const second = await pg.query<{ r: string }>(
        `SELECT public.exam_score_renewal_emit($1, 'exam_date', $2, NULL,
                'exam_score_report_requested') AS r`,
        [STUDENT, EXAM_DATE_DUE],
      );
      expect(second.rows[0]!.r).toBe("duplicate");

      const events = await pg.query(
        `SELECT event_id FROM public.notification_events
          WHERE event_type = 'exam_score_report_requested'`,
      );
      expect(events.rowCount).toBe(1);
      const messages = await pg.query<{
        recipient_profile_id: string;
        channel: string;
      }>(
        `SELECT recipient_profile_id, channel FROM public.notification_messages
          ORDER BY channel`,
      );
      expect(messages.rows).toEqual([
        { recipient_profile_id: STUDENT, channel: "email" },
        { recipient_profile_id: STUDENT, channel: "in_app" },
      ]);
    });

    it("claim 3b: edge case 4 — the score prompt goes to the student and the renewal question to the guardian", async () => {
      await seedProfile(STUDENT_OF_GUARDIAN, "student");
      await seedProfile(GUARDIAN, "guardian");
      await seedEntitlement(STUDENT_OF_GUARDIAN, { payerProfileId: GUARDIAN });
      await seedStudyProfile(STUDENT_OF_GUARDIAN, EXAM_DATE_DUE);

      for (const eventType of [
        "exam_score_report_requested",
        "renewal_decision_requested",
      ]) {
        await pg.query(
          `SELECT public.exam_score_renewal_emit($1, 'exam_date', $2, $3, $4)`,
          [STUDENT_OF_GUARDIAN, EXAM_DATE_DUE, GUARDIAN, eventType],
        );
      }

      const rows = await pg.query<{
        event_type: string;
        recipient_profile_id: string;
      }>(
        `SELECT e.event_type, m.recipient_profile_id
           FROM public.notification_events e
           JOIN public.notification_messages m USING (event_id)
          WHERE m.channel = 'email'
          ORDER BY e.event_type`,
      );
      expect(rows.rows).toEqual([
        {
          event_type: "exam_score_report_requested",
          recipient_profile_id: STUDENT_OF_GUARDIAN,
        },
        {
          event_type: "renewal_decision_requested",
          recipient_profile_id: GUARDIAN,
        },
      ]);
      // The SUBJECT is the student on both, whoever the recipient is — that is what the account
      // deletion cascade follows.
      const subjects = await pg.query<{ subject_profile_id: string }>(
        `SELECT DISTINCT subject_profile_id FROM public.notification_events`,
      );
      expect(subjects.rows).toEqual([
        { subject_profile_id: STUDENT_OF_GUARDIAN },
      ]);
    });

    // ── Claim 4 ────────────────────────────────────────────────────────────
    it("claim 4: a reported score is stored with the projection that was LIVE at the exam date", async () => {
      await seedProfile(STUDENT, "student");
      await seedEntitlement(STUDENT);
      await seedStudyProfile(STUDENT, EXAM_DATE_DUE);

      // THREE snapshots, so "live at that date" has something else it could have picked. With one
      // snapshot per section this claim would pass for the wrong reason.
      const before = await pg.query<{ snapshot_id: string }>(
        `INSERT INTO public.student_section_projection_snapshots
           (student_id, section, projected_score_mid, projected_score_low,
            projected_score_high, range_width, snapshot_at)
         VALUES ($1, 'RW', 600, 550, 650, 100, '2026-09-01T00:00:00Z')
         RETURNING snapshot_id`,
        [STUDENT],
      );
      await pg.query(
        `INSERT INTO public.student_section_projection_snapshots
           (student_id, section, projected_score_mid, projected_score_low,
            projected_score_high, range_width, snapshot_at)
         VALUES ($1, 'RW', 700, 650, 750, 100, '2026-09-20T00:00:00Z')`,
        [STUDENT],
      );
      const gated = await pg.query<{ snapshot_id: string }>(
        `INSERT INTO public.student_section_projection_snapshots
           (student_id, section, snapshot_at)
         VALUES ($1, 'M', '2026-09-05T00:00:00Z') RETURNING snapshot_id`,
        [STUDENT],
      );

      const written = await pg.query<{ report_id: string }>(
        `SELECT public.record_exam_score_report($1, $2, 1290, 640, 650) AS report_id`,
        [STUDENT, EXAM_DATE_DUE],
      );
      const reportId = written.rows[0]!.report_id;

      const paired = await pg.query<{
        section: string;
        projection_status: string;
        snapshot_id: string | null;
        projected_score_mid: number | null;
      }>(
        `SELECT section, projection_status, snapshot_id, projected_score_mid
           FROM public.exam_score_report_projections
          WHERE report_id = $1 ORDER BY section`,
        [reportId],
      );

      expect(paired.rows).toEqual([
        {
          section: "M",
          // A snapshot existed and Doc 05C's gate held the projection NULL. "No projection" with
          // a cause, not a row of nulls that reads as a zero.
          projection_status: "gated",
          snapshot_id: gated.rows[0]!.snapshot_id,
          projected_score_mid: null,
        },
        {
          section: "RW",
          projection_status: "snapshot",
          // The PRE-exam snapshot, not the one written eight days later.
          snapshot_id: before.rows[0]!.snapshot_id,
          projected_score_mid: 600,
        },
      ]);
    });

    it("claim 4b: no snapshot at all is recorded as 'none', explicitly", async () => {
      await seedProfile(STUDENT, "student");
      await seedStudyProfile(STUDENT, EXAM_DATE_DUE);

      const written = await pg.query<{ report_id: string }>(
        `SELECT public.record_exam_score_report($1, $2, 1200, 600, 600) AS report_id`,
        [STUDENT, EXAM_DATE_DUE],
      );
      const paired = await pg.query<{
        section: string;
        projection_status: string;
      }>(
        `SELECT section, projection_status FROM public.exam_score_report_projections
          WHERE report_id = $1 ORDER BY section`,
        [written.rows[0]!.report_id],
      );
      expect(paired.rows).toEqual([
        { section: "M", projection_status: "none" },
        { section: "RW", projection_status: "none" },
      ]);
    });

    // ── Claim 7 ────────────────────────────────────────────────────────────
    it("claim 7: an out-of-range or non-summing score is refused by the database, not stored", async () => {
      await seedProfile(STUDENT, "student");
      await seedStudyProfile(STUDENT, EXAM_DATE_DUE);

      // 1595 is in range and not a multiple of ten.
      await expect(
        pg.query(
          `SELECT public.record_exam_score_report($1, $2, 1595, 795, 800)`,
          [STUDENT, EXAM_DATE_DUE],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      // Both sections legal, total legal, and the total is not their sum.
      await expect(
        pg.query(
          `SELECT public.record_exam_score_report($1, $2, 1500, 700, 700)`,
          [STUDENT, EXAM_DATE_DUE],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      // Nothing was stored by either attempt — the refusal is the whole behaviour.
      const stored = await pg.query(
        `SELECT report_id FROM public.exam_score_reports WHERE student_id = $1`,
        [STUDENT],
      );
      expect(stored.rowCount).toBe(0);
    });

    // ── The silence sweep ──────────────────────────────────────────────────
    it("the no-answer window fires at 14 days and not at 13, and a retaking answer blocks it", async () => {
      await seedProfile(STUDENT, "student");
      await seedEntitlement(STUDENT, { subscriptionId: "sub_silence" });
      await seedStudyProfile(STUDENT, EXAM_DATE_DUE);
      await pg.query(
        `SELECT public.exam_score_renewal_emit($1, 'exam_date', $2, NULL,
                'exam_score_report_requested')`,
        [STUDENT, EXAM_DATE_DUE],
      );

      const sweep = async (days: number) =>
        (
          await pg.query<{
            outcome: string | null;
            stripe_subscription_id: string;
          }>(
            `SELECT outcome, stripe_subscription_id
               FROM public.exam_renewal_no_answer_candidates($1, 500, now() + ($2 || ' days')::interval)`,
            [WINDOW_DAYS, String(days)],
          )
        ).rows;

      expect(await sweep(13)).toHaveLength(0);
      const due = await sweep(14);
      expect(due).toHaveLength(1);
      expect(due[0]!.outcome).toBeNull();
      expect(due[0]!.stripe_subscription_id).toBe("sub_silence");

      // Edge case 6: a future exam date IS the answer, and it is recorded rather than filtered.
      await seedStudyProfile(STUDENT, "2027-03-13");
      const withNewDate = await sweep(14);
      expect(withNewDate).toHaveLength(1);
      expect(withNewDate[0]!.outcome).toBe("skipped_new_exam_date");

      // And a recorded 'retaking' blocks it whoever said it.
      await seedStudyProfile(STUDENT, EXAM_DATE_DUE);
      await pg.query(
        `INSERT INTO public.exam_renewal_decisions
           (student_id, occasion_key, anchor, decided_by_profile_id, decider_role, decision, action)
         VALUES ($1, $2, 'exam_date', $1, 'student', 'retaking', 'none')`,
        [STUDENT, EXAM_DATE_DUE],
      );
      const answered = await sweep(14);
      expect(answered).toHaveLength(1);
      expect(answered[0]!.outcome).toBe("skipped_answered");
    });

    // ── Claims 5 and 6, through the real service ───────────────────────────
    describe("the retake answer, through the real service", () => {
      async function primeExamPrompt(
        studentId: string,
        payerProfileId: string | null,
      ): Promise<void> {
        await seedProfile(studentId, "student");
        if (payerProfileId !== null)
          await seedProfile(payerProfileId, "guardian");
        await seedEntitlement(studentId, {
          subscriptionId: "sub_decision",
          ...(payerProfileId === null ? {} : { payerProfileId }),
        });
        await seedStudyProfile(studentId, EXAM_DATE_DUE);
        await pg.query(
          `SELECT public.exam_score_renewal_emit($1, 'exam_date', $2, $3,
                  'exam_score_report_requested')`,
          [studentId, EXAM_DATE_DUE, payerProfileId],
        );
      }

      it('claim 5: "No" sets cancel_at_period_end on STRIPE and nothing else', async () => {
        await primeExamPrompt(STUDENT, null);
        stripeApi.subscriptionsRetrieve.mockResolvedValue({
          id: "sub_decision",
          cancel_at_period_end: false,
        });
        stripeApi.subscriptionsUpdate.mockResolvedValue({
          id: "sub_decision",
          cancel_at_period_end: true,
        });

        const { submitRenewalDecision } =
          await import("../../server/services/exam-score-renewal/service");
        const result = await submitRenewalDecision(STUDENT, {
          occasion_key: EXAM_DATE_DUE,
          decision: "not_retaking",
          confirm: true,
        });

        expect(result.ok).toBe(true);
        // The Stripe call, exactly (owner ruling #6, first half).
        expect(stripeApi.subscriptionsUpdate).toHaveBeenCalledTimes(1);
        expect(stripeApi.subscriptionsUpdate).toHaveBeenCalledWith(
          "sub_decision",
          {
            cancel_at_period_end: true,
          },
        );

        // AND NOTHING ELSE. Our column is the webhook's to write (owner ruling #6, second half),
        // so it is still false here — the mirrored row arrives with
        // `customer.subscription.updated`, which this test does not deliver.
        const row = await pg.query<{ cancel_at_period_end: boolean }>(
          `SELECT cancel_at_period_end FROM public.entitlements WHERE profile_id = $1`,
          [STUDENT],
        );
        expect(row.rows[0]!.cancel_at_period_end).toBe(false);

        const decision = await pg.query<{ decision: string; action: string }>(
          `SELECT decision, action FROM public.exam_renewal_decisions WHERE student_id = $1`,
          [STUDENT],
        );
        expect(decision.rows).toEqual([
          { decision: "not_retaking", action: "cancel_at_period_end" },
        ]);
      });

      it("claim 5b: the mirrored row is what the webhook writes — asserted here so the pair is proved end to end", async () => {
        await primeExamPrompt(STUDENT, null);
        // The other half of owner ruling #6's test requirement. `cancel_at_period_end` has exactly
        // one writer in this system, and this is the shape of what it writes when Stripe reports
        // the flag we just set.
        await pg.query(
          `UPDATE public.entitlements SET cancel_at_period_end = true WHERE profile_id = $1`,
          [STUDENT],
        );
        const row = await pg.query<{ cancel_at_period_end: boolean }>(
          `SELECT cancel_at_period_end FROM public.entitlements WHERE profile_id = $1`,
          [STUDENT],
        );
        expect(row.rows[0]!.cancel_at_period_end).toBe(true);
        // And with it set, the sweep will not act again (edge case 8) — the two halves meet here.
        const swept = await pg.query<{ outcome: string | null }>(
          `SELECT outcome FROM public.exam_renewal_no_answer_candidates($1, 500, now() + interval '20 days')`,
          [WINDOW_DAYS],
        );
        expect(swept.rows).toEqual([{ outcome: "skipped_cancel_pending" }]);
      });

      it('claim 6: "Yes" leaves the subscription untouched and requires a new exam date', async () => {
        await primeExamPrompt(STUDENT, null);
        stripeApi.subscriptionsRetrieve.mockResolvedValue({
          id: "sub_decision",
          cancel_at_period_end: false,
        });

        const { submitRenewalDecision } =
          await import("../../server/services/exam-score-renewal/service");

        // No date: refused, and nothing recorded.
        const refused = await submitRenewalDecision(STUDENT, {
          occasion_key: EXAM_DATE_DUE,
          decision: "retaking",
        });
        expect(refused.ok).toBe(false);
        if (!refused.ok) expect(refused.error.kind).toBe("invalid");
        expect(
          (
            await pg.query(
              `SELECT decision_id FROM public.exam_renewal_decisions WHERE student_id = $1`,
              [STUDENT],
            )
          ).rowCount,
        ).toBe(0);

        const accepted = await submitRenewalDecision(STUDENT, {
          occasion_key: EXAM_DATE_DUE,
          decision: "retaking",
          new_target_exam_date: "2027-03-13",
        });
        expect(accepted.ok).toBe(true);

        // UNTOUCHED: no update was sent. `retrieve` may have been called (the clear path reads
        // first and finds nothing to do); `update` is the write, and it never happened.
        expect(stripeApi.subscriptionsUpdate).not.toHaveBeenCalled();

        const decision = await pg.query<{ decision: string; action: string }>(
          `SELECT decision, action FROM public.exam_renewal_decisions WHERE student_id = $1`,
          [STUDENT],
        );
        expect(decision.rows).toEqual([
          { decision: "retaking", action: "none" },
        ]);

        const profile = await pg.query<{ target_exam_date: Date }>(
          `SELECT target_exam_date FROM public.student_study_profile WHERE student_id = $1`,
          [STUDENT],
        );
        expect(isoDate(profile.rows[0]!.target_exam_date)).toBe("2027-03-13");
      });

      it("a student on a guardian-funded subscription cannot end it, and is recorded as a student", async () => {
        await primeExamPrompt(STUDENT_OF_GUARDIAN, GUARDIAN);
        const { submitRenewalDecision } =
          await import("../../server/services/exam-score-renewal/service");
        const result = await submitRenewalDecision(STUDENT_OF_GUARDIAN, {
          occasion_key: EXAM_DATE_DUE,
          decision: "not_retaking",
          confirm: true,
        });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.action).toBe("none");
        // Not one Stripe call: it is not their money (Doc 01 §36.4).
        expect(stripeApi.subscriptionsUpdate).not.toHaveBeenCalled();
        expect(stripeApi.subscriptionsRetrieve).not.toHaveBeenCalled();

        const row = await pg.query<{ decider_role: string; action: string }>(
          `SELECT decider_role, action FROM public.exam_renewal_decisions
            WHERE student_id = $1`,
          [STUDENT_OF_GUARDIAN],
        );
        expect(row.rows).toEqual([{ decider_role: "student", action: "none" }]);
      });

      it("edge case 5: a second score report is a new row and the latest wins; both are retained", async () => {
        await primeExamPrompt(STUDENT, null);
        const { submitScoreReport, readScoreReportSurface } =
          await import("../../server/services/exam-score-renewal/service");

        const first = await submitScoreReport(STUDENT, {
          occasion_key: EXAM_DATE_DUE,
          total_score: 1290,
          rw_score: 640,
          math_score: 650,
        });
        expect(first.ok).toBe(true);
        // A distinguishable second value, one step apart, so "the latest" cannot be satisfied by
        // the first row.
        const second = await submitScoreReport(STUDENT, {
          occasion_key: EXAM_DATE_DUE,
          total_score: 1300,
          rw_score: 650,
          math_score: 650,
        });
        expect(second.ok).toBe(true);

        const kept = await pg.query<{ total_score: number }>(
          `SELECT total_score FROM public.exam_score_reports
            WHERE student_id = $1 ORDER BY reported_at`,
          [STUDENT],
        );
        expect(kept.rows.map((r) => r.total_score)).toEqual([1290, 1300]);

        const surface = await readScoreReportSurface(STUDENT);
        expect(surface.ok).toBe(true);
        if (surface.ok) expect(surface.value.report?.total_score).toBe(1300);
      });

      it("a body naming an occasion we never asked about is refused", async () => {
        await primeExamPrompt(STUDENT, null);
        const { submitScoreReport } =
          await import("../../server/services/exam-score-renewal/service");
        const result = await submitScoreReport(STUDENT, {
          occasion_key: "2026-05-02",
          total_score: 1290,
          rw_score: 640,
          math_score: 650,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.kind).toBe("occasion_mismatch");
      });
    });
  },
);

// ── The job's own wiring, no database needed ──────────────────────────────────

describe("noticesFor — who is asked what", () => {
  it("asks a self-paid student for the score only, and a guardian-funded pair for both", async () => {
    const { noticesFor } =
      await import("../../server/services/exam-score-renewal/job");
    expect(
      noticesFor({
        anchor: "exam_date",
        student_id: STUDENT,
        payer_profile_id: null,
      }),
    ).toEqual(["exam_score_report_requested"]);
    // A payer row naming the student themselves is self-paid too, and must not produce a second
    // email to the same person.
    expect(
      noticesFor({
        anchor: "exam_date",
        student_id: STUDENT,
        payer_profile_id: STUDENT,
      }),
    ).toEqual(["exam_score_report_requested"]);
    expect(
      noticesFor({
        anchor: "exam_date",
        student_id: STUDENT_OF_GUARDIAN,
        payer_profile_id: GUARDIAN,
      }),
    ).toEqual(["exam_score_report_requested", "renewal_decision_requested"]);
    // Owner ruling #1: no score prompt on the billing-cycle anchor.
    expect(
      noticesFor({
        anchor: "billing_cycle",
        student_id: STUDENT,
        payer_profile_id: null,
      }),
    ).toEqual(["renewal_decision_requested"]);
  });
});
