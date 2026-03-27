# Review Live DB Verification Queries

Purpose: prove review tables exist, are policy-compatible, and store persisted session-owned snapshots.

Run after applying:
- `supabase/migrations/20260314_review_session_lifecycle.sql`
- `supabase/migrations/20260203_review_error_attempts.sql`

## 1) Table presence + RLS
```sql
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'review_sessions',
    'review_session_items',
    'review_session_events',
    'review_error_attempts'
  )
order by c.relname;
```

## 2) Policies present
```sql
select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'review_sessions',
    'review_session_items',
    'review_session_events',
    'review_error_attempts'
  )
order by tablename, policyname;
```

## 3) Review sessions lifecycle rows
```sql
select id, student_id, status, source_context, started_at, completed_at, created_at
from review_sessions
order by created_at desc
limit 20;
```

## 4) Review session items snapshot completeness
```sql
select
  id,
  review_session_id,
  ordinal,
  status,
  question_canonical_id,
  source_origin,
  option_order,
  option_token_map
from review_session_items
order by created_at desc
limit 20;
```

## 5) Ensure review session items reference only persisted snapshots
```sql
select
  count(*) as missing_snapshot_fields
from review_session_items
where question_canonical_id is null
   or question_section is null
   or question_stem is null
   or question_options is null
   or question_correct_answer is null;
```

## 6) Review error attempts write path
```sql
select id, student_id, question_id, is_correct, created_at
from review_error_attempts
order by created_at desc
limit 20;
```

## 7) Cross-check mode scoping (manual)
```sql
-- Replace with an active review session id
select
  r.id as review_session_id,
  i.source_origin,
  i.source_question_id,
  i.source_question_canonical_id,
  i.source_attempted_at
from review_sessions r
join review_session_items i on i.review_session_id = r.id
where r.id = '<review_session_id>'
order by i.ordinal;
```

## 8) Raw-bank guard (expected empty)
```sql
-- If you have statement logs, confirm no review runtime queries hit public.questions after materialization.
-- This check is environment-specific; consult your DB audit log location.
```
