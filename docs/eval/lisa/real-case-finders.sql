-- Real-case import: find each case's conversation and cut-off message. READ-ONLY.
-- Owner-run in the Supabase SQL editor (Karl, brief 2026-11-08). Nothing here writes.
-- Prints ids, times and counts only; no student text. To read a candidate before choosing it,
-- use the per-conversation listing at the end, which stays in the SQL editor.
-- Times are UTC. The window is the analysis team's review: 2026-11-03 to 2026-11-05 inclusive.

BEGIN READ ONLY;

-- ── G0-2-01, G0-2-02: the Desmos seeds (student A, 18 Oct; student B, 19 Oct) ──────────────
-- By student and day; the display name stays in the editor (G0-2_Owner_Run_Steps.md step 2).
SELECT c.id AS conversation_id, c.created_at, c.entry_mode, c.source_surface,
       c.source_question_canonical_id
FROM public.tutor_conversations c
JOIN public.profiles p ON p.id = c.student_id
WHERE p.display_name = '<student display name>'
  AND c.created_at >= '<YYYY-MM-DD>' AND c.created_at < '<YYYY-MM-DD +1 day>'
ORDER BY c.created_at;

-- ── G0-2-03: Karl's own test on SATM2UYVX9I (27 Oct, 04:07-04:10 UTC) ──────────────────────
SELECT DISTINCT m.conversation_id
FROM public.tutor_messages m
WHERE m.source_question_canonical_id = 'SATM2UYVX9I'
  AND m.created_at BETWEEN '2026-10-27 04:07:00+00' AND '2026-10-27 04:10:59+00';

-- For 01-03 the cut-off is the student message that asks for Desmos:
SELECT m.id AS cutoff_message_id, m.created_at
FROM public.tutor_messages m
WHERE m.conversation_id = '<conversation_id>' AND m.role = 'student'
  AND (m.intent = 'desmos_walkthrough' OR m.message ~* '\mdesmos\M')
ORDER BY m.created_at
LIMIT 1;

-- ── G0-2-04: the "Got it" loop ──────────────────────────────────────────────────────────────
-- Runs of consecutive "Got it, next step" taps (intent step_understood) on one problem. The
-- cut-off is the THIRD tap of the run: the rubric asks for the worked step by tap 3.
-- Expect the 21-tap run of Nov 4 near the top.
WITH s AS (
  SELECT m.conversation_id, m.id, m.created_at,
         (m.intent IS NOT DISTINCT FROM 'step_understood') AS tap,
         row_number() OVER (PARTITION BY m.conversation_id ORDER BY m.created_at, m.id)
       - row_number() OVER (PARTITION BY m.conversation_id,
                                         (m.intent IS NOT DISTINCT FROM 'step_understood')
                            ORDER BY m.created_at, m.id) AS grp
  FROM public.tutor_messages m
  WHERE m.role = 'student'
    AND m.created_at >= '2026-11-03 00:00:00+00' AND m.created_at < '2026-11-06 00:00:00+00'
)
SELECT conversation_id,
       count(*)                                        AS taps_in_a_row,
       min(created_at)                                 AS run_started,
       (array_agg(id ORDER BY created_at, id))[3]      AS cutoff_message_id
FROM s
WHERE tap
GROUP BY conversation_id, grp
HAVING count(*) >= 3
ORDER BY taps_in_a_row DESC, run_started
LIMIT 10;

-- ── G0-2-05: the "idk" escalation ──────────────────────────────────────────────────────────
-- Two "stuck" student messages in a row: the "I'm stuck" tap (step_stuck), or typed "idk",
-- "i don't know", "i'm stuck", "no idea". The cut-off is the SECOND of the two.
WITH s AS (
  SELECT m.conversation_id, m.id, m.created_at,
         (m.intent IS NOT DISTINCT FROM 'step_stuck'
          OR m.message ~* '(^|[^a-z])(idk|i dont know|i don''t know|i do not know|i''m stuck|im stuck|no idea)([^a-z]|$)') AS stuck
  FROM public.tutor_messages m
  WHERE m.role = 'student'
    AND m.created_at >= '2026-11-03 00:00:00+00' AND m.created_at < '2026-11-06 00:00:00+00'
), w AS (
  SELECT s.*, lag(stuck) OVER (PARTITION BY conversation_id ORDER BY created_at, id) AS prev_stuck
  FROM s
)
SELECT conversation_id, id AS cutoff_message_id, created_at
FROM w
WHERE stuck AND prev_stuck
ORDER BY created_at
LIMIT 10;

-- ── G0-2-06: a Desmos request in the review window ─────────────────────────────────────────
-- The first student message per conversation that asks for Desmos help (the Desmos
-- walkthrough choice, or typed). The "Desmos video" tap (video_desmos) is a video request, not
-- this case, and is left out.
SELECT DISTINCT ON (m.conversation_id)
       m.conversation_id, m.id AS cutoff_message_id, m.created_at, m.intent
FROM public.tutor_messages m
WHERE m.role = 'student'
  AND m.created_at >= '2026-11-03 00:00:00+00' AND m.created_at < '2026-11-06 00:00:00+00'
  AND (m.intent = 'desmos_walkthrough'
       OR (m.intent IS NULL AND m.message ~* '\mdesmos\M'))
ORDER BY m.conversation_id, m.created_at;

-- ── G0-2-07: frustration ────────────────────────────────────────────────────────────────────
-- The first student message per conversation that the friction detector calls
-- self-deprecating. The pattern is detectsSelfDeprecatingLanguage's
-- (server/services/tutor-context.ts SELF_DEPRECATING_PATTERNS), joined, case-insensitive.
SELECT DISTINCT ON (m.conversation_id)
       m.conversation_id, m.id AS cutoff_message_id, m.created_at
FROM public.tutor_messages m
WHERE m.role = 'student'
  AND m.created_at >= '2026-11-03 00:00:00+00' AND m.created_at < '2026-11-06 00:00:00+00'
  AND m.message ~* (
        'i''?m\s+(so\s+)?(stupid|dumb|bad\s+at\s+this|terrible|hopeless)'
     || '|i\s+(can''?t|cannot)\s+do\s+(this|anything|math)'
     || '|i''?ll\s+never\s+(get|understand|learn)\s+this'
     || '|i\s+(hate|suck\s+at)\s+(this|math|reading)'
     || '|i\s+give\s+up'
     || '|what''?s\s+the\s+point'
     || '|too\s+(stupid|dumb)\s+for')
ORDER BY m.conversation_id, m.created_at;

-- ── G0-2-08: the RW turn that said "Let's look at Option B" (2026-11-22) ────────────────────
-- The production case: SATRW23GOZ2P (key A), student ed97def1…. The cut-off is the student
-- message just before that reply. RE-SCOPED 2026-11-22: this item was ANSWERED before the
-- conversation began (review_session_items answered 23:10:08, conversation 23:11:05), so
-- G0-2-08 is a POST-submit control. The before-submission rule is G0-2-09, backed by the
-- synthetic replay until a real before-submission case is found.
-- item_answered_at is set against the reply's own time: post_submit_at_reply is the import's rule
-- (an answered or skipped item whose answered_at is at or before the turn is post-submit). The
-- import refuses a case whose rubric is scoped to the other state.
SELECT c.id AS conversation_id, s.id AS cutoff_message_id, s.created_at AS cutoff_at,
       t.created_at AS reply_at, s.intent,
       it.status AS item_status, it.answered_at AS item_answered_at,
       (it.status IN ('answered', 'skipped') AND it.answered_at IS NOT NULL
        AND it.answered_at <= s.created_at) AS post_submit_at_reply,
       tm.help_level, tm.help_worked_step
FROM public.tutor_conversations c
JOIN public.tutor_messages t
  ON t.conversation_id = c.id AND t.role = 'tutor' AND t.message ~* '\moption\s+b\M'
JOIN LATERAL (
  SELECT m.id, m.created_at, m.intent
  FROM public.tutor_messages m
  WHERE m.conversation_id = c.id AND m.role = 'student' AND m.created_at < t.created_at
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT 1
) s ON true
LEFT JOIN LATERAL (
  SELECT r.status, r.answered_at
  FROM public.review_session_items r
  WHERE c.source_surface = 'review' AND r.id = c.source_session_item_id
  UNION ALL
  SELECT p.status, p.answered_at
  FROM public.practice_session_items p
  WHERE c.source_surface = 'practice' AND p.id = c.source_session_item_id
) it ON true
LEFT JOIN LATERAL (
  SELECT x.help_level, x.help_worked_step
  FROM public.tutor_turn_metrics x
  WHERE x.conversation_id = c.id AND x.recorded_at >= s.created_at
  ORDER BY x.recorded_at
  LIMIT 1
) tm ON true
WHERE c.student_id::text LIKE 'ed97def1%'
  AND c.source_question_canonical_id = 'SATRW23GOZ2P'
ORDER BY t.created_at;

-- ── Before choosing: read a candidate (stays in the SQL editor) ────────────────────────────
-- Confirms the candidate is the conversation the analysis team reviewed, and that the cut-off
-- is a STUDENT message with a tutor reply after it (the import refuses otherwise).
SELECT m.id, m.role, m.intent, m.created_at, left(m.message, 80) AS starts
FROM public.tutor_messages m
WHERE m.conversation_id = '<conversation_id>'
ORDER BY m.created_at;

-- Does this student have memory the replay can carry (written before the cut-off)? W4-16 is
-- evaluated only on cases where the answer is yes.
SELECT s.summary_type, s.source_window_end, s.content_json->>'conversation_id' AS compacts
FROM public.tutor_memory_summaries s
JOIN public.tutor_conversations c ON c.student_id = s.student_id
WHERE c.id = '<conversation_id>';

ROLLBACK;
