CREATE TABLE IF NOT EXISTS public.tutor_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  mode text NOT NULL,
  canonical_ids_used text[] NOT NULL DEFAULT '{}',
  primary_style text,
  secondary_style text,
  explanation_level integer,
  message text NOT NULL,
  answer text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tutor_interactions ENABLE ROW LEVEL SECURITY;
