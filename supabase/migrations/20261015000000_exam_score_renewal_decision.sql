-- ===========================================================================
-- POST-EXAM SCORE REPORT AND RENEWAL DECISION
-- LYCEON-MIGRATION-REVIEWED
-- ===========================================================================
-- @spec [Doc-01_V8 §20–§24 (entitlements, student-scoped; the webhook is the writer),
--        §36.4 (a guardian who pays is the party asked "keep or cancel?"),
--        §955 table row "canceled (at period end) → access continues to end of paid period",
--        Appendix A.4 `entitlement_runtime_config` (the three keys below extend it — SCL-191);
--        Doc-05F_V1.0 §7.1 `student_study_profile.target_exam_date`, §7.10 `calendar_job_runs`,
--        §12.5 (the daily-job pattern), §18 (job outcomes);
--        Doc-05C_V1.0 §2.1 (projection is forward-looking), §7.2
--        `student_section_projection_snapshots`;
--        contracts/notifications.contract.md §1.1, §2.2, §2.3, §5.1, §5.2, §8.1;
--        owner rulings 2026-09-30 (eight, recorded inline where each lands)]
-- @implemented [2026-09-30]
--
-- plain English: a student's exam date passes; some days later their scores are out, so we ask
-- them what they got and whether they are retaking. Retaking, the subscription continues. Not
-- retaking, it ends at the end of the paid period. No answer at all, it ends at the end of the
-- paid period too — because silence cannot mean "renew forever", which is the case this whole
-- flow exists to prevent. Expected outcome: nobody is charged months after they stopped
-- studying, and every reported score is stored beside the projection that was live on the day
-- they sat the exam, which is the only form of that pair that can validate anything.
--
-- WHY THE PAIR HAS TO BE STORED AND NOT COMPUTED LATER. A projection moves every 40 mastery
-- events (Doc 05C §8.3). Comparing a reported score against whatever the projection says when
-- somebody finally runs the query compares the score to a number the student never had. So the
-- pairing is resolved and written IN THE SAME TRANSACTION as the report, and it stores the
-- snapshot's own identity (`snapshot_id`) and instant (`snapshot_at`) rather than only its
-- values — owner ruling 2026-09-30 #7. A student with no projection on that date records
-- `projection_status = 'none'` EXPLICITLY, because a NULL mid-score in a validation dataset
-- reads as a zero to the next person who averages the column.
--
-- WHY THIS CONSUMES `calendar_job_runs` RATHER THAN ADDING ITS OWN TABLE. Owner ruling
-- 2026-09-30 #5: "Consume the existing job shape. Do not fork a second scheduled-job pattern."
-- The table's name is the calendar's, and the anchor this job reads —
-- `student_study_profile.target_exam_date` — is a calendar column (Doc 05F §7.1), so the join
-- is not arbitrary. It is still a billing job writing to a table whose COMMENT cites Doc 05F
-- §7.10, and renaming that table is the owner's call, not this change's: recorded in
-- `docs/plans/Stripe_Vertical_Todos.md` T6, not taken.
--
-- NOT APPLIED BY THIS SESSION — the owner applies all SQL.
--
-- rollback:
--   DROP FUNCTION IF EXISTS public.exam_renewal_no_answer_candidates(integer, integer, timestamptz);
--   DROP FUNCTION IF EXISTS public.exam_score_renewal_candidates(integer, integer, integer, integer, timestamptz);
--   DROP FUNCTION IF EXISTS public.exam_score_renewal_emit(uuid, text, date, uuid, text);
--   DROP FUNCTION IF EXISTS public.record_exam_score_report(uuid, date, integer, integer, integer);
--   DROP FUNCTION IF EXISTS public.record_renewal_decision(uuid, date, text, uuid, text, text, text);
--   DROP TABLE IF EXISTS public.exam_score_report_projections;
--   DROP TABLE IF EXISTS public.exam_score_reports;
--   DROP TABLE IF EXISTS public.exam_renewal_decisions;
--   ALTER TABLE public.entitlements DROP COLUMN IF EXISTS payer_profile_id;
--   DELETE FROM public.entitlement_runtime_config
--     WHERE key IN ('score_prompt_offset_days','score_prompt_max_exam_age_days',
--                   'renewal_reminder_lead_days','renewal_no_answer_window_days');
--   ALTER TABLE public.notification_events DROP CONSTRAINT IF EXISTS notification_events_type_check;
--   ALTER TABLE public.notification_events ADD CONSTRAINT notification_events_type_check
--     CHECK (event_type IN ('guardian_linked','guardian_unlinked',
--                           'full_length_week','full_length_tomorrow'));
--   ALTER TABLE public.calendar_job_runs DROP CONSTRAINT IF EXISTS calendar_job_runs_job_check;
--   ALTER TABLE public.calendar_job_runs ADD CONSTRAINT calendar_job_runs_job_check
--     CHECK (job IN ('weekly_regen','exam_notify'));
--   ALTER TABLE public.calendar_job_runs DROP CONSTRAINT IF EXISTS calendar_job_runs_outcome_check;
--   ALTER TABLE public.calendar_job_runs ADD CONSTRAINT calendar_job_runs_outcome_check
--     CHECK (outcome IN ('ok','skipped_fresh','skipped_custom','skipped_no_entitlement',
--                        'skipped_complete','skipped_duplicate','failed'));
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The two event types (contract §1.1: a CHECK change plus a §2.3 row)
--
-- TWO, NOT ONE, and the reason is mechanical rather than aesthetic:
-- `notification_event_id(event_type, source_id)` puts the TYPE in the hash (contract §5.1), so
-- one source id yielding two notifications needs two types or the second is swallowed by the
-- ON CONFLICT that makes the first idempotent. Owner ruling 2026-09-26 established this for the
-- two practice-test notices; ruling 2026-09-30 #5 applies it here.
--
-- They are also two different questions asked of two different people:
--   exam_score_report_requested  the student: what did you get, and are you retaking?
--   renewal_decision_requested   the payer:   shall we keep charging you?
-- On a self-paid student those are the same person, and only the first is sent (see §6).
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_events
  DROP CONSTRAINT IF EXISTS notification_events_type_check;
ALTER TABLE public.notification_events
  ADD CONSTRAINT notification_events_type_check
  CHECK (event_type IN ('guardian_linked',
                        'guardian_unlinked',
                        'full_length_week',
                        'full_length_tomorrow',
                        'exam_score_report_requested',
                        'renewal_decision_requested'));

-- ---------------------------------------------------------------------------
-- 2. The job and its four new outcomes (Doc 05F §7.10, §18)
--
-- Every outcome here is a reason this job passed a due student over, and each is RECORDED
-- rather than filtered: §12.5's doctrine is that a student the job skipped silently is a
-- student nobody can explain afterwards.
--
--   skipped_cancel_pending   edge case 8 — `cancel_at_period_end` is already set; do not re-set
--   skipped_new_exam_date    edge case 6 — a future exam date IS the answer "retaking"
--   skipped_answered         a decision already exists for this occasion
--   canceled_no_answer       the window expired; `cancel_at_period_end` was set on Stripe
--
-- `period_key` is a date, and this job keys it on the OCCASION: the exam date on the exam
-- anchor, the period-end date on the billing-cycle anchor. One job row per student per
-- occasion per pass, reruns included, exactly as the two existing jobs do.
-- ---------------------------------------------------------------------------
ALTER TABLE public.calendar_job_runs
  DROP CONSTRAINT IF EXISTS calendar_job_runs_job_check;
ALTER TABLE public.calendar_job_runs
  ADD CONSTRAINT calendar_job_runs_job_check
  CHECK (job IN ('weekly_regen', 'exam_notify', 'exam_score_renewal'));

ALTER TABLE public.calendar_job_runs
  DROP CONSTRAINT IF EXISTS calendar_job_runs_outcome_check;
ALTER TABLE public.calendar_job_runs
  ADD CONSTRAINT calendar_job_runs_outcome_check
  CHECK (outcome IN ('ok',
                     'skipped_fresh',
                     'skipped_custom',
                     'skipped_no_entitlement',
                     'skipped_complete',
                     'skipped_duplicate',
                     'skipped_cancel_pending',
                     'skipped_new_exam_date',
                     'skipped_answered',
                     'canceled_no_answer',
                     'failed'));

-- ---------------------------------------------------------------------------
-- 3. `entitlements.payer_profile_id` — who is being charged, as a DB fact
--
-- WHY THIS COLUMN HAS TO EXIST. Doc 01 §36.4 asks the PAYER "keep or cancel?", and until now
-- the payer lived only in Stripe subscription metadata (`payer_profile_id`, set by the guardian
-- checkout route and read at `server/lib/stripe/webhook-handler.ts:1334`). A job that must
-- decide who to email cannot answer a question about our own entitlement by calling Stripe once
-- per due student, and deriving it from `legal_acceptances.actor_type = 'parent'` would be a
-- second derivation of a fact the webhook already holds.
--
-- NULL MEANS SELF-PAID, AND THAT IS THE SAFE READING FOR THE ROWS THAT PREDATE THIS COLUMN.
-- Every existing row reads NULL until its subscription's next webhook writes it, so a
-- guardian-funded student will be asked the renewal question themselves rather than their
-- guardian. The consequence of asking the wrong party here is a subscription that ends at the
-- end of a period the payer already paid for, reversible in the Customer Portal — whereas the
-- consequence of asking nobody is the charge this flow exists to prevent. Fail toward asking.
--
-- ON DELETE SET NULL, not CASCADE. This names ANOTHER identity's profile (a guardian), and the
-- `guardian_links.accepted_by_profile_id` precedent from 20260917130000 is exact: attribution on
-- a row that belongs to somebody else is SEVERED when that somebody is deleted, never used to
-- delete the row. `scripts/ci/fk-delete-action-guard.sql` enumerates from `pg_constraint` and
-- would redden on a NO ACTION edge here.
-- ---------------------------------------------------------------------------
ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS payer_profile_id uuid NULL
    REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.entitlements.payer_profile_id IS
  'Doc 01 V8 §36.4: the profile being charged, when it is not the student. NULL means self-paid — and also means "written before this column existed", which reads as self-paid on purpose (the renewal question then goes to the student rather than to nobody). Writer: the Stripe webhook handler, from subscription metadata.';

CREATE INDEX IF NOT EXISTS idx_entitlements_payer
  ON public.entitlements (payer_profile_id) WHERE payer_profile_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Config (Doc 01 V8 Appendix A.4 — four keys added; SCL-191)
--
-- THE OFFSET IS 18 DAYS, AND IT IS A CONFIG VALUE BECAUSE COLLEGE BOARD OWNS THE FACT.
-- Owner ruling 2026-09-30 #2: default 18, not the brief's 15.
--   College Board's own published guidance for SAT Weekend is "approximately 10 business days
--   after test day" (satsuite.collegeboard.org/scores/sat), which from a Saturday
--   administration lands on the Friday 13 CALENDAR days later — the 13-day pattern the brief
--   observed, and the reason it is almost always a Friday. 18 is that 13 plus five days, so a
--   student has had their score over a weekend before we ask for it.
--   RECORD THE EXCEPTION, so that the next reader who sees 18, thinks "13 plus a buffer" and
--   tightens it knows what they would break: the June 2027 administration releases 16 days
--   after test day, on a MONDAY (owner's figure, ruling #2). 13 is not a law, which is exactly
--   why this is a row in a config table and not a constant in a file.
--
-- `score_prompt_max_exam_age_days` bounds edge case 2: an exam date that has been sitting in
-- the profile for months must not produce a prompt about a sitting the student has forgotten.
-- 45 days gives four weeks of prompting room after the 18-day offset opens it.
--   AND IT DOES NOT CREATE AN EXEMPTION. A student whose exam date is older than this is not
--   dropped — they fall to the billing-cycle anchor below, which is the same predicate a
--   student with no exam date at all takes. §4 of the brief: "must not be silently exempt from
--   the protection this exists to give."
--
-- `renewal_reminder_lead_days` (21) and `renewal_no_answer_window_days` (14) are one decision
-- in two halves, and their RELATIONSHIP is the load-bearing part: the lead must exceed the
-- window, or the no-answer cancellation lands AFTER the invoice it exists to stop. 21 − 14
-- leaves seven days. The reader in `server/lib/entitlement-runtime-config.ts` fails closed if
-- that inequality is ever configured away.
-- ---------------------------------------------------------------------------
INSERT INTO public.entitlement_runtime_config
  (key, value, value_type, min_value, max_value, owner, description)
VALUES
  ('score_prompt_offset_days', '18'::jsonb, 'integer', '13'::jsonb, '45'::jsonb, 'Product',
   'Days after target_exam_date before the score prompt fires. 13 = College Board''s 10-business-day release from a Saturday sitting; +5 buffer. June 2027 releases at 16 days (a Monday), which is why this is config.'),
  ('score_prompt_max_exam_age_days', '45'::jsonb, 'integer', '18'::jsonb, '180'::jsonb, 'Product',
   'Oldest target_exam_date the score prompt will fire for. Beyond this the student takes the billing-cycle anchor instead; they are never exempt.'),
  ('renewal_reminder_lead_days', '21'::jsonb, 'integer', '14'::jsonb, '60'::jsonb, 'Product',
   'Days before current_period_end that the billing-cycle renewal reminder fires. MUST exceed renewal_no_answer_window_days or the no-answer cancellation lands after the invoice.'),
  ('renewal_no_answer_window_days', '14'::jsonb, 'integer', '3'::jsonb, '60'::jsonb, 'Product',
   'Days of silence after the prompt before cancel_at_period_end is set. Owner ruling 2026-09-30 #3: silence cannot mean renew forever.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Storage
--
-- APPEND-ONLY, LAST WRITE WINS (edge case 5; owner ruling 2026-09-30 #4). A student who
-- mistypes 1450 as 1540 must be able to correct it, and the correction must not erase what they
-- said first — a validation dataset in which a row can be silently rewritten is a validation
-- dataset nobody can audit. So both versions are retained and the latest `reported_at` is the
-- answer. There is deliberately no UNIQUE on (student, occasion).
--
-- RLS ENABLED, NO POLICIES, SERVICE ROLE ONLY — the same posture as `notification_events`.
-- A reported real-world SAT score is the student's own; no guardian reads it here (Doc 01
-- §38.1 gives a guardian aggregates), and no client reads any of these tables directly. The
-- surface goes through the server, which is where the authorisation is written down.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exam_score_reports (
  report_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The sitting this report is about: the `target_exam_date` that produced the prompt.
  occasion_key   date NOT NULL,
  total_score    integer NOT NULL,
  rw_score       integer NOT NULL,
  math_score     integer NOT NULL,
  reported_at    timestamptz NOT NULL DEFAULT now(),
  -- Edge case 7, in the database and not only in Zod. A dataset meant for model validation
  -- must not be able to hold a score the Digital SAT cannot produce: sections are 200–800 in
  -- ten-point steps, the total is their sum, and therefore 400–1600 in ten-point steps.
  CONSTRAINT exam_score_reports_rw_scale
    CHECK (rw_score BETWEEN 200 AND 800 AND rw_score % 10 = 0),
  CONSTRAINT exam_score_reports_math_scale
    CHECK (math_score BETWEEN 200 AND 800 AND math_score % 10 = 0),
  CONSTRAINT exam_score_reports_total_scale
    CHECK (total_score BETWEEN 400 AND 1600 AND total_score % 10 = 0),
  CONSTRAINT exam_score_reports_total_is_the_sum
    CHECK (total_score = rw_score + math_score)
);

COMMENT ON TABLE public.exam_score_reports IS
  'Student-reported REAL SAT scores, one row per report (append-only; latest reported_at wins). Not Doc 04C''s exam score report, which is Lyceon''s own modelled score for a practice full-length — this is what College Board sent the student. Service-role only.';

CREATE INDEX IF NOT EXISTS exam_score_reports_latest
  ON public.exam_score_reports (student_id, occasion_key, reported_at DESC);

CREATE TABLE IF NOT EXISTS public.exam_score_report_projections (
  report_id          uuid NOT NULL
                       REFERENCES public.exam_score_reports(report_id) ON DELETE CASCADE,
  section            text NOT NULL CHECK (section IN ('M', 'RW')),
  -- THREE VALUES, BECAUSE "NO PROJECTION" HAS TWO DIFFERENT CAUSES and a consumer that cannot
  -- tell them apart will average both as a zero (owner ruling 2026-09-30 #7: record "no
  -- projection" explicitly rather than a null that reads as zero).
  --   'snapshot'  a projection existed on that date; its values are here
  --   'gated'     a snapshot existed, and Doc 05C's whole-student 8-domain gate (§5.3) was
  --               holding the projection NULL — we know exactly which snapshot, and that it
  --               carried no numbers
  --   'none'      no snapshot existed at or before that date at all
  projection_status  text NOT NULL CHECK (projection_status IN ('snapshot', 'gated', 'none')),
  snapshot_id        bigint NULL
                       REFERENCES public.student_section_projection_snapshots(snapshot_id)
                       ON DELETE SET NULL,
  snapshot_at        timestamptz NULL,
  projected_score_mid   integer NULL CHECK (projected_score_mid  IS NULL OR projected_score_mid  BETWEEN 200 AND 800),
  projected_score_low   integer NULL CHECK (projected_score_low  IS NULL OR projected_score_low  BETWEEN 200 AND 800),
  projected_score_high  integer NULL CHECK (projected_score_high IS NULL OR projected_score_high BETWEEN 200 AND 800),
  PRIMARY KEY (report_id, section),
  -- The status, the identity and the values cannot disagree. Both halves are needed: the first
  -- makes 'none' the only status without a snapshot behind it, the second makes 'snapshot' the
  -- only status that carries numbers. Without the second, a 'gated' row could quietly hold a
  -- mid-score; without the first, a 'snapshot' row could name no snapshot.
  CONSTRAINT exam_score_report_projections_identity_coherent
    CHECK ((projection_status = 'none') = (snapshot_at IS NULL)),
  CONSTRAINT exam_score_report_projections_values_coherent
    CHECK ((projection_status = 'snapshot') = (projected_score_mid IS NOT NULL))
);

COMMENT ON TABLE public.exam_score_report_projections IS
  'The projection that was live on the exam date, paired with the reported score. Stores the snapshot''s own identity and instant (Doc 05C §7.2), not just its values, so the pair can be re-derived. projection_status = ''none'' records "there was no projection" explicitly.';

CREATE TABLE IF NOT EXISTS public.exam_renewal_decisions (
  decision_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  occasion_key          date NOT NULL,
  anchor                text NOT NULL CHECK (anchor IN ('exam_date', 'billing_cycle')),
  -- Another identity's profile on the guardian path: SET NULL, per §3's reasoning.
  decided_by_profile_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  decider_role          text NOT NULL CHECK (decider_role IN ('student', 'payer')),
  -- ONE VOCABULARY FOR ONE CONSEQUENCE. On the exam anchor this is literally the retake
  -- answer; on the billing-cycle anchor the question reads "are you still preparing?". Both
  -- have the same two consequences — the subscription continues, or it ends at period end —
  -- and two enums for one consequence would be a second source of truth about the same money.
  decision              text NOT NULL CHECK (decision IN ('retaking', 'not_retaking')),
  -- What we DID, recorded beside what was said, because the two can differ: a non-payer's
  -- 'not_retaking' is heard and acted on by nobody (§7).
  action                text NOT NULL
                          CHECK (action IN ('none', 'cancel_at_period_end', 'cancel_cleared')),
  decided_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.exam_renewal_decisions IS
  'Append-only; the latest decided_at for a (student, occasion) is the answer. `decision` is what was said and `action` is what was done to the subscription — only a payer''s not_retaking sets cancel_at_period_end. Silence is NOT recorded here: it has no decider and no decision, and it appears as calendar_job_runs.outcome = canceled_no_answer.';

CREATE INDEX IF NOT EXISTS exam_renewal_decisions_latest
  ON public.exam_renewal_decisions (student_id, occasion_key, decided_at DESC);

ALTER TABLE public.exam_score_reports            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_score_report_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_renewal_decisions        ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 6. exam_score_renewal_emit — the writer, and the chokepoint
--
-- Contract §2.2: the emit lives inside the SQL function that performs the mutation, in one
-- transaction. As with `calendar_emit_exam_notification`, there is no domain row to mutate —
-- the notification IS the mutation — so this function is that function.
--
-- It returns what happened ('emitted' | 'duplicate') because the job records it. Returning void
-- would make a replay indistinguishable from a write in `calendar_job_runs`, which is the one
-- thing §18's outcomes exist to prevent.
--
-- IDEMPOTENT PER (student, occasion, type) — §5 of the brief: "a job that runs twice must not
-- email twice". `notification_event_id(event_type, source_id)` with
-- `source_id = '<student_id>:<occasion_key>'` is what provides that (contract §5.1); the EXISTS
-- below is not the idempotency, it is what lets this function tell the job that nothing was
-- written. The two cannot disagree — both read the same event row.
--
-- WHO GETS WHAT (contract §2.3 rows; edge case 4, the one the brief was least sure about).
-- The brief's own framing is the answer: "the student reports the score; the guardian pays and
-- decides renewal." So the two questions are addressed separately, by the party who can answer
-- them:
--   exam_date anchor,  always            → the STUDENT: exam_score_report_requested.
--                                          They have the score, and on a self-paid subscription
--                                          they are also the payer, so this one notice carries
--                                          the retake question too.
--   exam_date anchor,  payer ≠ student   → ALSO the PAYER: renewal_decision_requested.
--                                          Two emails to two people, exactly as edge case 4
--                                          anticipated. A self-paid student gets ONE notice, not
--                                          two on the same morning about the same sitting.
--   billing_cycle anchor                 → the PAYER only (the student when self-paid):
--                                          renewal_decision_requested. Owner ruling 2026-09-30
--                                          #1: "renewal reminder anchored on current_period_end,
--                                          NO score prompt." There is no exam date, so there is
--                                          no sitting to ask about.
-- No guardian ever receives the score prompt: Doc 01 §38.1 gives a guardian aggregates, and a
-- real-world SAT score is the student's own to share.
--
-- BOTH CHANNELS ON BOTH TYPES (§5 of the brief: "Email and in-app both, since the pipeline does
-- both"). Unlike the week-ahead practice-test notice, neither of these is something the student
-- will stumble on by opening a page: one asks for information we do not have, and the other
-- precedes a charge. A bell nobody opens is not a notification.
--
-- PAYLOAD (contract §8.1): the anchor and the occasion date — the two rendering parameters a
-- template needs to say "your exam on the 5th" or "your subscription renews on the 12th", and
-- the two facts the no-answer sweep reads back out. No score, no amount, no price: this row is
-- persisted and recipient-readable.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exam_score_renewal_emit(
  p_student_id      uuid,
  p_anchor          text,
  p_occasion_key    date,
  p_payer_profile_id uuid,
  p_event_type      text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_event_id  uuid;
  v_source_id text;
  v_recipient uuid;
BEGIN
  IF p_anchor NOT IN ('exam_date', 'billing_cycle') THEN
    RAISE EXCEPTION 'exam_score_renewal_emit: unknown anchor %', p_anchor
      USING ERRCODE = '22023';
  END IF;

  IF p_event_type NOT IN ('exam_score_report_requested', 'renewal_decision_requested') THEN
    RAISE EXCEPTION 'exam_score_renewal_emit: unknown event type %', p_event_type
      USING ERRCODE = '22023';
  END IF;

  -- The score prompt has no meaning without a sitting to ask about. Refusing rather than
  -- silently degrading: a caller that asks for this pairing has a bug, and emitting a
  -- "how did your exam go" notice to a student who never named an exam date would be the
  -- defect arriving as a real email.
  IF p_event_type = 'exam_score_report_requested' AND p_anchor <> 'exam_date' THEN
    RAISE EXCEPTION 'exam_score_renewal_emit: the score prompt requires the exam_date anchor'
      USING ERRCODE = '22023';
  END IF;

  -- The recipient IS the event type's subject question. The score is the student's; the money
  -- is the payer's, who is the student unless a guardian is on the row (§3).
  v_recipient := CASE
    WHEN p_event_type = 'exam_score_report_requested' THEN p_student_id
    ELSE COALESCE(p_payer_profile_id, p_student_id)
  END;

  v_source_id := p_student_id::text || ':' || p_occasion_key::text;
  v_event_id  := public.notification_event_id(p_event_type, v_source_id);

  IF EXISTS (SELECT 1 FROM public.notification_events e WHERE e.event_id = v_event_id) THEN
    RETURN 'duplicate';
  END IF;

  PERFORM public.emit_notification_event(
    v_event_id,
    p_event_type,
    -- The SUBJECT is always the student, whoever the recipient is: the subject is who the
    -- notification is about, and `notification_events.subject_profile_id` is what the account
    -- deletion cascade follows.
    p_student_id,
    jsonb_build_array(
      jsonb_build_object('profile_id', v_recipient,
                         'channels', jsonb_build_array('in_app', 'email'))
    ),
    jsonb_build_object('anchor', p_anchor, 'occasion_key', p_occasion_key)
  );

  RETURN 'emitted';
END;
$fn$;

COMMENT ON FUNCTION public.exam_score_renewal_emit(uuid, text, date, uuid, text) IS
  'The one write path for the two post-exam notices. Returns emitted | duplicate. Idempotent per (student, occasion, event type) because the type is part of notification_event_id''s hash input. The score prompt goes to the student; the renewal decision goes to the payer (the student when payer_profile_id is NULL).';

-- ---------------------------------------------------------------------------
-- 7. record_exam_score_report — the report and its projection pairing, atomically
--
-- WHY THIS IS A SQL FUNCTION AND NOT TWO PostgREST CALLS. The pairing is the whole point of
-- the table (§1 of the brief: "a comparison computed later against a moved projection proves
-- nothing"). A report row that committed without its pairing, or a pairing resolved a second
-- after the report against a projection that refreshed in between, would be a row in a
-- validation dataset that means something slightly different from every other row.
--
-- "THE PROJECTION THAT WAS LIVE AT THAT DATE" is resolved as the newest snapshot strictly
-- before the END of the exam day in the STUDENT'S OWN ZONE — the same half-open local-day
-- discipline `calendar_full_length_complete` uses, and for the same reason: no instant belongs
-- to two local days. It is the projection as it stood when the student walked out.
--
-- BOTH SECTIONS, ALWAYS TWO ROWS. A student with no projection for one section and a projection
-- for the other is a real state (Doc 05C keys snapshots per (student, section)), and a missing
-- row would be indistinguishable from a pairing nobody attempted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_exam_score_report(
  p_student_id   uuid,
  p_occasion_key date,
  p_total_score  integer,
  p_rw_score     integer,
  p_math_score   integer
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_report_id uuid;
  v_timezone  text;
  v_cutoff    timestamptz;
  v_section   text;
  v_snap      public.student_section_projection_snapshots;
  v_status    text;
BEGIN
  SELECT COALESCE(sp.timezone, 'UTC') INTO v_timezone
    FROM public.student_study_profile sp
   WHERE sp.student_id = p_student_id;
  IF v_timezone IS NULL THEN
    -- No study profile at all. UTC is the only defensible zone for a student who has never
    -- told us one, and it is the same fallback the read path uses.
    v_timezone := 'UTC';
  END IF;

  -- Exclusive end of the exam day, in the student's zone.
  v_cutoff := (p_occasion_key + 1)::timestamp AT TIME ZONE v_timezone;

  -- The column CHECKs are the guard; this insert is what trips them, so an out-of-range score
  -- raises 23514 here rather than being stored.
  INSERT INTO public.exam_score_reports
    (student_id, occasion_key, total_score, rw_score, math_score)
  VALUES (p_student_id, p_occasion_key, p_total_score, p_rw_score, p_math_score)
  RETURNING report_id INTO v_report_id;

  FOREACH v_section IN ARRAY ARRAY['M', 'RW'] LOOP
    SELECT s.* INTO v_snap
      FROM public.student_section_projection_snapshots s
     WHERE s.student_id = p_student_id
       AND s.section    = v_section
       AND s.snapshot_at < v_cutoff
     ORDER BY s.snapshot_at DESC
     LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO public.exam_score_report_projections
        (report_id, section, projection_status)
      VALUES (v_report_id, v_section, 'none');
    ELSE
      v_status := CASE WHEN v_snap.projected_score_mid IS NULL THEN 'gated' ELSE 'snapshot' END;
      INSERT INTO public.exam_score_report_projections
        (report_id, section, projection_status, snapshot_id, snapshot_at,
         projected_score_mid, projected_score_low, projected_score_high)
      VALUES (v_report_id, v_section, v_status, v_snap.snapshot_id, v_snap.snapshot_at,
              v_snap.projected_score_mid, v_snap.projected_score_low, v_snap.projected_score_high);
    END IF;
  END LOOP;

  RETURN v_report_id;
END;
$fn$;

COMMENT ON FUNCTION public.record_exam_score_report(uuid, date, integer, integer, integer) IS
  'Writes one reported real-SAT score and its per-section projection pairing in one transaction. The pairing is the newest snapshot strictly before the end of the exam day in the student''s own zone. Append-only: a second report for the same occasion is a new row and the latest reported_at wins.';

-- ---------------------------------------------------------------------------
-- 8. exam_score_renewal_candidates — the population
--
-- IT RETURNS THE OUTCOME, NOT JUST THE CANDIDATES, exactly as the two existing candidate
-- functions do: every value in the `outcome` column is a `calendar_job_runs.outcome` verbatim,
-- so the job records the skip instead of filtering it away. `outcome IS NULL` means notify.
-- Population questions live here; write-time questions live in the emitter (§6).
--
-- WHY THE THRESHOLDS ARE PARAMETERS AND NOT READ HERE. `entitlement_runtime_config` has exactly
-- one reader in this system (`server/lib/entitlement-runtime-config.ts`, "the one owner of that
-- config read"), and a second reader inside this function would be a second source for the same
-- four numbers — the divergence CLAUDE.md's unified-code rule exists to prevent. The job reads
-- the config once and passes the values in. It also makes every threshold testable at any value,
-- which a config read would not.
--
-- WHY `p_now` IS A PARAMETER. The same reason `calendar_exam_notification_candidates` has one:
-- these predicates turn on date arithmetic against a per-student local today, and a predicate of
-- that shape tested against a wall clock is green on the days it happens to be true and
-- unexercised on the rest — the "fails green" pattern this vertical has produced repeatedly.
-- The job never passes it, so production has exactly one clock.
--
-- TIMEZONE IN THE PREDICATE (owner ruling 2026-09-30 #5). "A cron fires in one timezone and the
-- students are in all of them": today is `(p_now AT TIME ZONE sp.timezone)::date`, and the
-- billing period end is turned into a local date the same way. A student in Auckland and one in
-- Los Angeles are each 18 days past their own exam date on their own day.
--
-- TWO ANCHORS, AND NOBODY BETWEEN THEM.
--   exam_date      a target_exam_date between `today - max_age` and `today - offset`.
--   billing_cycle  no target_exam_date, OR one older than `today - max_age` (edge case 2: an
--                  exam date left in the profile for months must not produce a prompt about a
--                  sitting the student has forgotten). Owner ruling 2026-09-30 #1.
-- A student whose exam date is in the FUTURE, or within the offset, is on neither: they have a
-- live sitting ahead of them and are plainly still studying. That is the only exemption, and it
-- expires by itself.
--
-- WHO IS NOT IN THE POPULATION AT ALL. Anybody without an `entitlements` row — there is no
-- subscription to protect and no outcome value that would describe them. Anybody whose
-- entitlement or cancellation state rules them out IS in it, with the outcome that says why.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exam_score_renewal_candidates(
  p_offset_days        integer,
  p_max_exam_age_days  integer,
  p_lead_days          integer,
  p_limit              integer     DEFAULT 500,
  p_now                timestamptz DEFAULT now()
) RETURNS TABLE (
  student_id        uuid,
  payer_profile_id  uuid,
  timezone          text,
  anchor            text,
  occasion_key      date,
  outcome           text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH resolved AS (
    SELECT e.profile_id                          AS student_id,
           e.payer_profile_id,
           e.cancel_at_period_end,
           e.current_period_end,
           COALESCE(sp.timezone, 'UTC')          AS timezone,
           sp.target_exam_date,
           (p_now AT TIME ZONE COALESCE(sp.timezone, 'UTC'))::date AS today_local
      FROM public.entitlements e
      LEFT JOIN public.student_study_profile sp ON sp.student_id = e.profile_id
  ),
  due AS (
    SELECT r.student_id, r.payer_profile_id, r.timezone, r.cancel_at_period_end,
           'exam_date'::text  AS anchor,
           r.target_exam_date AS occasion_key
      FROM resolved r
     WHERE r.target_exam_date IS NOT NULL
       AND r.target_exam_date <= r.today_local - p_offset_days
       AND r.target_exam_date >= r.today_local - p_max_exam_age_days
    UNION ALL
    SELECT r.student_id, r.payer_profile_id, r.timezone, r.cancel_at_period_end,
           'billing_cycle'::text,
           (r.current_period_end AT TIME ZONE r.timezone)::date
      FROM resolved r
     WHERE r.current_period_end IS NOT NULL
       AND (r.target_exam_date IS NULL
            OR r.target_exam_date < r.today_local - p_max_exam_age_days)
       AND (r.current_period_end AT TIME ZONE r.timezone)::date >  r.today_local
       AND (r.current_period_end AT TIME ZONE r.timezone)::date - p_lead_days <= r.today_local
  )
  SELECT d.student_id, d.payer_profile_id, d.timezone, d.anchor, d.occasion_key,
         CASE
           WHEN NOT public.entitlement_active(d.student_id) THEN 'skipped_no_entitlement'
           -- Edge case 8: the subscription is already ending. Asking somebody to decide
           -- something they have already decided is worse than saying nothing.
           WHEN d.cancel_at_period_end IS TRUE             THEN 'skipped_cancel_pending'
           -- Edge case 6, at the prompt as well as at the sweep: a student who answered is not
           -- asked again.
           WHEN EXISTS (SELECT 1 FROM public.exam_renewal_decisions x
                         WHERE x.student_id   = d.student_id
                           AND x.occasion_key = d.occasion_key) THEN 'skipped_answered'
           ELSE NULL
         END AS outcome
    FROM due d
   ORDER BY d.student_id, d.anchor, d.occasion_key
   LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.exam_score_renewal_candidates(integer, integer, integer, integer, timestamptz) IS
  'One row per (student, anchor, occasion) due for a post-exam prompt today in the student''s own zone. outcome NULL means notify; every other value is a calendar_job_runs.outcome verbatim so every considered row gets a job row. Thresholds are parameters because entitlement_runtime_config has one reader, in TypeScript. p_now exists so the date arithmetic is testable on any day.';

-- ---------------------------------------------------------------------------
-- 9. exam_renewal_no_answer_candidates — the silence sweep
--
-- THE WINDOW RUNS FROM THE PROMPT, whichever type asked. On a self-paid student with an exam
-- date the only notice sent is `exam_score_report_requested`, and it is the notice that asked
-- the retake question — so a sweep keyed on `renewal_decision_requested` alone would never fire
-- for the majority case, which is the case the protection is for. Both types are the source, and
-- the EARLIEST of them starts the clock.
--
-- CANCEL IF, AND ONLY IF: we asked at least `p_window_days` ago, nobody has said they are
-- retaking, the entitlement is live, the subscription is not already ending, and the student has
-- not set a future exam date.
--
-- WHY 'retaking' FROM ANY PARTY BLOCKS THE CANCELLATION while only a payer's 'not_retaking'
-- causes one (§5 of the brief, and the split the guardian model requires). "Still studying" is a
-- fact about the student, and whoever knows it may tell us. "Stop charging me" is a fact about
-- money, and only the person being charged may say it. So a student on a guardian-funded
-- subscription can keep it alive by saying they are retaking, and cannot end it by saying they
-- are not — in that case the guardian's silence is what decides, and this sweep is where.
--
-- EDGE CASE 6 IS A PREDICATE, NOT A TRIGGER. "Student sets a new exam date without answering →
-- treat as retaking, cancel the pending prompt." A future `target_exam_date` IS that answer, read
-- at sweep time from the profile the student already wrote through the calendar's own writer.
-- Nothing listens for the change, so nothing can miss it — and it is RECORDED as
-- `skipped_new_exam_date` rather than filtered, so the student can be explained afterwards.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exam_renewal_no_answer_candidates(
  p_window_days integer,
  p_limit       integer     DEFAULT 500,
  p_now         timestamptz DEFAULT now()
) RETURNS TABLE (
  student_id             uuid,
  anchor                 text,
  occasion_key           date,
  stripe_subscription_id text,
  outcome                text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH prompts AS (
    SELECT ne.subject_profile_id                     AS student_id,
           ne.payload ->> 'anchor'                   AS anchor,
           (ne.payload ->> 'occasion_key')::date     AS occasion_key,
           MIN(ne.created_at)                        AS prompted_at
      FROM public.notification_events ne
     WHERE ne.event_type IN ('exam_score_report_requested', 'renewal_decision_requested')
     GROUP BY 1, 2, 3
  )
  SELECT p.student_id,
         p.anchor,
         p.occasion_key,
         e.stripe_subscription_id,
         CASE
           WHEN NOT public.entitlement_active(p.student_id) THEN 'skipped_no_entitlement'
           WHEN e.cancel_at_period_end IS TRUE             THEN 'skipped_cancel_pending'
           WHEN sp.target_exam_date IS NOT NULL
            AND sp.target_exam_date >
                (p_now AT TIME ZONE COALESCE(sp.timezone, 'UTC'))::date
                                                            THEN 'skipped_new_exam_date'
           WHEN EXISTS (SELECT 1 FROM public.exam_renewal_decisions x
                         WHERE x.student_id   = p.student_id
                           AND x.occasion_key = p.occasion_key
                           AND x.decision     = 'retaking')  THEN 'skipped_answered'
           ELSE NULL
         END AS outcome
    FROM prompts p
    JOIN public.entitlements e ON e.profile_id = p.student_id
    LEFT JOIN public.student_study_profile sp ON sp.student_id = p.student_id
   WHERE p.prompted_at <= p_now - make_interval(days => p_window_days)
   ORDER BY p.student_id, p.occasion_key
   LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.exam_renewal_no_answer_candidates(integer, integer, timestamptz) IS
  'One row per (student, occasion) prompted at least p_window_days ago. outcome NULL means set cancel_at_period_end on Stripe; every other value is a calendar_job_runs.outcome verbatim. A retaking answer from ANY party blocks the cancellation, and so does a future target_exam_date (edge case 6). Silence is the only thing that cancels here.';

-- ---------------------------------------------------------------------------
-- 10. Grants — nothing on any of these is reachable from a session token
--
-- The job and the two routes run as the service role, which is the only caller. A student
-- reaches `record_exam_score_report` through the route, which is where the authorisation for it
-- is written down; reaching the function directly would bypass that.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.exam_score_renewal_emit(uuid, text, date, uuid, text)
  FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.record_exam_score_report(uuid, date, integer, integer, integer)
  FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.exam_score_renewal_candidates(integer, integer, integer, integer, timestamptz)
  FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.exam_renewal_no_answer_candidates(integer, integer, timestamptz)
  FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION public.exam_score_renewal_emit(uuid, text, date, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_exam_score_report(uuid, date, integer, integer, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.exam_score_renewal_candidates(integer, integer, integer, integer, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.exam_renewal_no_answer_candidates(integer, integer, timestamptz)
  TO service_role;

COMMIT;
