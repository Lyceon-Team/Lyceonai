-- Persist opaque per-served-item option shuffles for canonical practice runtime.
-- This keeps pre-submit payloads anti-leak while making refresh/resume stable.

ALTER TABLE public.practice_session_items
  ADD COLUMN IF NOT EXISTS question_canonical_id text;

ALTER TABLE public.practice_session_items
  ADD COLUMN IF NOT EXISTS option_order text[];

ALTER TABLE public.practice_session_items
  ADD COLUMN IF NOT EXISTS option_token_map jsonb;
