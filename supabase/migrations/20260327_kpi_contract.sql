-- KPI persisted truth contract
-- additive + backfill migration

BEGIN;

CREATE TABLE IF NOT EXISTS public.kpi_constants (
  version TEXT PRIMARY KEY,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  weights JSONB NOT NULL DEFAULT '{}'::jsonb,
  thresholds JSONB NOT NULL DEFAULT '{}'::jsonb,
  score_bands JSONB NOT NULL DEFAULT '{}'::jsonb,
  scaling_constants JSONB NOT NULL DEFAULT '{}'::jsonb,
  status_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.kpi_constants (
  version,
  effective_at,
  weights,
  thresholds,
  score_bands,
  scaling_constants,
  status_flags
)
VALUES (
  'kpi_truth_v1',
  NOW(),
  '{"practice": 1.0, "review": 1.0, "full_length": 1.25, "flowcard": 0.75}'::jsonb,
  '{"confidence_full": 200, "consistency_window": 60}'::jsonb,
  '{"baseline": {"math": 200, "rw": 200, "composite": 400}}'::jsonb,
  '{"projection_floor": 0, "projection_ceiling": 100}'::jsonb,
  '{"active": true}'::jsonb
)
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.student_kpi_counters_current (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  total_answered_count INTEGER NOT NULL DEFAULT 0,
  total_correct_count INTEGER NOT NULL DEFAULT 0,
  total_wrong_count INTEGER NOT NULL DEFAULT 0,
  practice_answered_count INTEGER NOT NULL DEFAULT 0,
  practice_correct_count INTEGER NOT NULL DEFAULT 0,
  practice_wrong_count INTEGER NOT NULL DEFAULT 0,
  review_answered_count INTEGER NOT NULL DEFAULT 0,
  review_correct_count INTEGER NOT NULL DEFAULT 0,
  review_wrong_count INTEGER NOT NULL DEFAULT 0,
  full_length_answered_count INTEGER NOT NULL DEFAULT 0,
  full_length_correct_count INTEGER NOT NULL DEFAULT 0,
  full_length_wrong_count INTEGER NOT NULL DEFAULT 0,
  flowcard_answered_count INTEGER NOT NULL DEFAULT 0,
  flowcard_correct_count INTEGER NOT NULL DEFAULT 0,
  flowcard_wrong_count INTEGER NOT NULL DEFAULT 0,
  math_answered_count INTEGER NOT NULL DEFAULT 0,
  math_correct_count INTEGER NOT NULL DEFAULT 0,
  math_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_alg_answered_count INTEGER NOT NULL DEFAULT 0,
  m_alg_correct_count INTEGER NOT NULL DEFAULT 0,
  m_alg_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_advm_answered_count INTEGER NOT NULL DEFAULT 0,
  m_advm_correct_count INTEGER NOT NULL DEFAULT 0,
  m_advm_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_prob_answered_count INTEGER NOT NULL DEFAULT 0,
  m_prob_correct_count INTEGER NOT NULL DEFAULT 0,
  m_prob_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_geo_answered_count INTEGER NOT NULL DEFAULT 0,
  m_geo_correct_count INTEGER NOT NULL DEFAULT 0,
  m_geo_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_craft_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_craft_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_craft_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_info_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_info_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_info_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_stdeng_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_stdeng_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_stdeng_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_expr_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_expr_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_expr_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_alg_leq_answered_count INTEGER NOT NULL DEFAULT 0,
  m_alg_leq_correct_count INTEGER NOT NULL DEFAULT 0,
  m_alg_leq_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_alg_linq_answered_count INTEGER NOT NULL DEFAULT 0,
  m_alg_linq_correct_count INTEGER NOT NULL DEFAULT 0,
  m_alg_linq_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_alg_lfn_answered_count INTEGER NOT NULL DEFAULT 0,
  m_alg_lfn_correct_count INTEGER NOT NULL DEFAULT 0,
  m_alg_lfn_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_alg_syseq_answered_count INTEGER NOT NULL DEFAULT 0,
  m_alg_syseq_correct_count INTEGER NOT NULL DEFAULT 0,
  m_alg_syseq_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_alg_absv_answered_count INTEGER NOT NULL DEFAULT 0,
  m_alg_absv_correct_count INTEGER NOT NULL DEFAULT 0,
  m_alg_absv_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_advm_quad_answered_count INTEGER NOT NULL DEFAULT 0,
  m_advm_quad_correct_count INTEGER NOT NULL DEFAULT 0,
  m_advm_quad_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_advm_poly_answered_count INTEGER NOT NULL DEFAULT 0,
  m_advm_poly_correct_count INTEGER NOT NULL DEFAULT 0,
  m_advm_poly_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_advm_expfn_answered_count INTEGER NOT NULL DEFAULT 0,
  m_advm_expfn_correct_count INTEGER NOT NULL DEFAULT 0,
  m_advm_expfn_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_advm_radexp_answered_count INTEGER NOT NULL DEFAULT 0,
  m_advm_radexp_correct_count INTEGER NOT NULL DEFAULT 0,
  m_advm_radexp_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_advm_ratexp_answered_count INTEGER NOT NULL DEFAULT 0,
  m_advm_ratexp_correct_count INTEGER NOT NULL DEFAULT 0,
  m_advm_ratexp_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_prob_rrp_answered_count INTEGER NOT NULL DEFAULT 0,
  m_prob_rrp_correct_count INTEGER NOT NULL DEFAULT 0,
  m_prob_rrp_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_prob_pct_answered_count INTEGER NOT NULL DEFAULT 0,
  m_prob_pct_correct_count INTEGER NOT NULL DEFAULT 0,
  m_prob_pct_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_prob_unitc_answered_count INTEGER NOT NULL DEFAULT 0,
  m_prob_unitc_correct_count INTEGER NOT NULL DEFAULT 0,
  m_prob_unitc_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_prob_lg_answered_count INTEGER NOT NULL DEFAULT 0,
  m_prob_lg_correct_count INTEGER NOT NULL DEFAULT 0,
  m_prob_lg_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_prob_dint_answered_count INTEGER NOT NULL DEFAULT 0,
  m_prob_dint_correct_count INTEGER NOT NULL DEFAULT 0,
  m_prob_dint_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_prob_prob_answered_count INTEGER NOT NULL DEFAULT 0,
  m_prob_prob_correct_count INTEGER NOT NULL DEFAULT 0,
  m_prob_prob_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_prob_stat_answered_count INTEGER NOT NULL DEFAULT 0,
  m_prob_stat_correct_count INTEGER NOT NULL DEFAULT 0,
  m_prob_stat_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_geo_arvol_answered_count INTEGER NOT NULL DEFAULT 0,
  m_geo_arvol_correct_count INTEGER NOT NULL DEFAULT 0,
  m_geo_arvol_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_geo_lang_answered_count INTEGER NOT NULL DEFAULT 0,
  m_geo_lang_correct_count INTEGER NOT NULL DEFAULT 0,
  m_geo_lang_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_geo_tri_answered_count INTEGER NOT NULL DEFAULT 0,
  m_geo_tri_correct_count INTEGER NOT NULL DEFAULT 0,
  m_geo_tri_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_geo_circ_answered_count INTEGER NOT NULL DEFAULT 0,
  m_geo_circ_correct_count INTEGER NOT NULL DEFAULT 0,
  m_geo_circ_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_geo_trig_answered_count INTEGER NOT NULL DEFAULT 0,
  m_geo_trig_correct_count INTEGER NOT NULL DEFAULT 0,
  m_geo_trig_wrong_count INTEGER NOT NULL DEFAULT 0,
  m_geo_cgeo_answered_count INTEGER NOT NULL DEFAULT 0,
  m_geo_cgeo_correct_count INTEGER NOT NULL DEFAULT 0,
  m_geo_cgeo_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_craft_wic_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_craft_wic_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_craft_wic_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_craft_txts_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_craft_txts_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_craft_txts_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_craft_ctxt_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_craft_ctxt_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_craft_ctxt_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_craft_purp_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_craft_purp_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_craft_purp_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_info_cidea_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_info_cidea_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_info_cidea_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_info_coet_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_info_coet_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_info_coet_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_info_coeq_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_info_coeq_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_info_coeq_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_info_inf_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_info_inf_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_info_inf_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_stdeng_bnd_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_stdeng_bnd_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_stdeng_bnd_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_stdeng_fss_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_stdeng_fss_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_stdeng_fss_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_stdeng_punc_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_stdeng_punc_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_stdeng_punc_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_stdeng_vten_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_stdeng_vten_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_stdeng_vten_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_stdeng_prag_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_stdeng_prag_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_stdeng_prag_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_expr_rsy_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_expr_rsy_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_expr_rsy_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_expr_tran_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_expr_tran_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_expr_tran_wrong_count INTEGER NOT NULL DEFAULT 0,
  rw_expr_spla_answered_count INTEGER NOT NULL DEFAULT 0,
  rw_expr_spla_correct_count INTEGER NOT NULL DEFAULT 0,
  rw_expr_spla_wrong_count INTEGER NOT NULL DEFAULT 0,
  overall_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  math_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  readiness_metric NUMERIC(6,2),
  confidence_metric NUMERIC(6,2),
  consistency_metric NUMERIC(6,2),
  last_recalculated_at TIMESTAMPTZ,
  last_event_type TEXT,
  last_event_id TEXT,
  source_version TEXT NOT NULL DEFAULT 'kpi_truth_v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_kpi_counters_current_last_recalculated
  ON public.student_kpi_counters_current(last_recalculated_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.student_kpi_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_version TEXT NOT NULL DEFAULT 'kpi_truth_v1',
  trigger_event_type TEXT,
  trigger_event_id TEXT,
  current_week_practice_sessions INTEGER NOT NULL DEFAULT 0,
  current_week_practice_minutes INTEGER NOT NULL DEFAULT 0,
  current_week_questions_solved INTEGER NOT NULL DEFAULT 0,
  current_week_accuracy_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
  current_week_avg_seconds_per_question NUMERIC(8,2) NOT NULL DEFAULT 0,
  previous_week_practice_sessions INTEGER NOT NULL DEFAULT 0,
  previous_week_practice_minutes INTEGER NOT NULL DEFAULT 0,
  previous_week_questions_solved INTEGER NOT NULL DEFAULT 0,
  previous_week_accuracy_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
  previous_week_avg_seconds_per_question NUMERIC(8,2) NOT NULL DEFAULT 0,
  recency_200_total_attempts INTEGER NOT NULL DEFAULT 0,
  recency_200_accuracy_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
  recency_200_avg_seconds_per_question NUMERIC(8,2) NOT NULL DEFAULT 0,
  overall_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  math_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  readiness_metric NUMERIC(6,2),
  confidence_metric NUMERIC(6,2),
  consistency_metric NUMERIC(6,2),
  m_alg_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_advm_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_prob_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_geo_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_craft_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_info_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_stdeng_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_expr_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_alg_leq_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_alg_linq_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_alg_lfn_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_alg_syseq_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_alg_absv_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_advm_quad_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_advm_poly_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_advm_expfn_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_advm_radexp_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_advm_ratexp_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_prob_rrp_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_prob_pct_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_prob_unitc_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_prob_lg_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_prob_dint_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_prob_prob_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_prob_stat_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_geo_arvol_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_geo_lang_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_geo_tri_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_geo_circ_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_geo_trig_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  m_geo_cgeo_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_craft_wic_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_craft_txts_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_craft_ctxt_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_craft_purp_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_info_cidea_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_info_coet_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_info_coeq_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_info_inf_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_stdeng_bnd_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_stdeng_fss_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_stdeng_punc_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_stdeng_vten_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_stdeng_prag_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_expr_rsy_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_expr_tran_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  rw_expr_spla_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_kpi_snapshots_user_snapshot_at
  ON public.student_kpi_snapshots(user_id, snapshot_at DESC);

ALTER TABLE public.kpi_constants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_kpi_counters_current ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_kpi_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'kpi_constants' AND policyname = 'kpi_constants_select_authenticated'
  ) THEN
    CREATE POLICY kpi_constants_select_authenticated
      ON public.kpi_constants
      FOR SELECT
      TO authenticated
      USING (TRUE);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'kpi_constants' AND policyname = 'kpi_constants_service_all'
  ) THEN
    CREATE POLICY kpi_constants_service_all
      ON public.kpi_constants
      FOR ALL
      USING ((auth.jwt() ->> 'role') = 'service_role')
      WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'student_kpi_counters_current' AND policyname = 'student_kpi_counters_current_select_own'
  ) THEN
    CREATE POLICY student_kpi_counters_current_select_own
      ON public.student_kpi_counters_current
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'student_kpi_counters_current' AND policyname = 'student_kpi_counters_current_service_all'
  ) THEN
    CREATE POLICY student_kpi_counters_current_service_all
      ON public.student_kpi_counters_current
      FOR ALL
      USING ((auth.jwt() ->> 'role') = 'service_role')
      WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'student_kpi_snapshots' AND policyname = 'student_kpi_snapshots_select_own'
  ) THEN
    CREATE POLICY student_kpi_snapshots_select_own
      ON public.student_kpi_snapshots
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'student_kpi_snapshots' AND policyname = 'student_kpi_snapshots_service_all'
  ) THEN
    CREATE POLICY student_kpi_snapshots_service_all
      ON public.student_kpi_snapshots
      FOR ALL
      USING ((auth.jwt() ->> 'role') = 'service_role')
      WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
  END IF;
END $$;

DROP TRIGGER IF EXISTS set_kpi_constants_updated_at ON public.kpi_constants;
CREATE TRIGGER set_kpi_constants_updated_at
  BEFORE UPDATE ON public.kpi_constants
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_student_kpi_counters_current_updated_at ON public.student_kpi_counters_current;
CREATE TRIGGER set_student_kpi_counters_current_updated_at
  BEFORE UPDATE ON public.student_kpi_counters_current
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_student_kpi_snapshots_updated_at ON public.student_kpi_snapshots;
CREATE TRIGGER set_student_kpi_snapshots_updated_at
  BEFORE UPDATE ON public.student_kpi_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.upsert_student_kpi_counters_current(
  p_user_id UUID,
  p_event_type TEXT,
  p_is_correct BOOLEAN,
  p_section TEXT,
  p_domain TEXT,
  p_skill TEXT,
  p_domain_prefix TEXT,
  p_skill_prefix TEXT,
  p_time_spent_ms INTEGER DEFAULT NULL,
  p_event_id TEXT DEFAULT NULL,
  p_source_version TEXT DEFAULT 'kpi_truth_v1'
)
RETURNS public.student_kpi_counters_current
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_section TEXT := LOWER(COALESCE(p_section, ''));
  v_source_prefix TEXT;
  v_domain_prefix TEXT := LOWER(COALESCE(p_domain_prefix, ''));
  v_skill_prefix TEXT := LOWER(COALESCE(p_skill_prefix, ''));
  v_section_answered_col TEXT;
  v_section_correct_col TEXT;
  v_section_wrong_col TEXT;
  v_domain_answered_col TEXT;
  v_domain_correct_col TEXT;
  v_domain_wrong_col TEXT;
  v_skill_answered_col TEXT;
  v_skill_correct_col TEXT;
  v_skill_wrong_col TEXT;
  v_source_answered_col TEXT;
  v_source_correct_col TEXT;
  v_source_wrong_col TEXT;
  v_col_name TEXT;
  v_set_clause TEXT;
  v_sql TEXT;
  v_row public.student_kpi_counters_current;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  IF v_section NOT IN ('math', 'rw') THEN
    RAISE EXCEPTION 'p_section must be math or rw';
  END IF;

  IF LOWER(COALESCE(p_domain, '')) = '' OR LOWER(COALESCE(p_skill, '')) = '' THEN
    RAISE EXCEPTION 'p_domain and p_skill are required';
  END IF;

  IF v_domain_prefix !~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Invalid domain prefix: %', p_domain_prefix;
  END IF;

  IF v_skill_prefix !~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Invalid skill prefix: %', p_skill_prefix;
  END IF;

  FOREACH v_col_name IN ARRAY ARRAY[v_domain_prefix || '_answered_count', v_skill_prefix || '_answered_count', v_domain_prefix || '_correct_count', v_skill_prefix || '_correct_count', v_domain_prefix || '_wrong_count', v_skill_prefix || '_wrong_count'] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'student_kpi_counters_current'
        AND column_name = v_col_name
    ) THEN
      RAISE EXCEPTION 'Missing KPI counter column: %', v_col_name;
    END IF;
  END LOOP;

  CASE LOWER(COALESCE(p_event_type, ''))
    WHEN 'practice_pass' THEN v_source_prefix := 'practice';
    WHEN 'practice_fail' THEN v_source_prefix := 'practice';
    WHEN 'review_pass' THEN v_source_prefix := 'review';
    WHEN 'review_fail' THEN v_source_prefix := 'review';
    WHEN 'test_pass' THEN v_source_prefix := 'full_length';
    WHEN 'test_fail' THEN v_source_prefix := 'full_length';
    WHEN 'tutor_helped' THEN v_source_prefix := 'flowcard';
    WHEN 'tutor_fail' THEN v_source_prefix := 'flowcard';
    ELSE v_source_prefix := NULL;
  END CASE;

  v_section_answered_col := quote_ident(v_section || '_answered_count');
  v_section_correct_col := quote_ident(v_section || '_correct_count');
  v_section_wrong_col := quote_ident(v_section || '_wrong_count');

  v_domain_answered_col := quote_ident(v_domain_prefix || '_answered_count');
  v_domain_correct_col := quote_ident(v_domain_prefix || '_correct_count');
  v_domain_wrong_col := quote_ident(v_domain_prefix || '_wrong_count');

  v_skill_answered_col := quote_ident(v_skill_prefix || '_answered_count');
  v_skill_correct_col := quote_ident(v_skill_prefix || '_correct_count');
  v_skill_wrong_col := quote_ident(v_skill_prefix || '_wrong_count');

  INSERT INTO public.student_kpi_counters_current (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  v_set_clause :=
    'total_answered_count = total_answered_count + 1, ' ||
    'total_correct_count = total_correct_count + CASE WHEN $2 THEN 1 ELSE 0 END, ' ||
    'total_wrong_count = total_wrong_count + CASE WHEN $2 THEN 0 ELSE 1 END, ' ||
    v_section_answered_col || ' = ' || v_section_answered_col || ' + 1, ' ||
    v_section_correct_col || ' = ' || v_section_correct_col || ' + CASE WHEN $2 THEN 1 ELSE 0 END, ' ||
    v_section_wrong_col || ' = ' || v_section_wrong_col || ' + CASE WHEN $2 THEN 0 ELSE 1 END, ' ||
    v_domain_answered_col || ' = ' || v_domain_answered_col || ' + 1, ' ||
    v_domain_correct_col || ' = ' || v_domain_correct_col || ' + CASE WHEN $2 THEN 1 ELSE 0 END, ' ||
    v_domain_wrong_col || ' = ' || v_domain_wrong_col || ' + CASE WHEN $2 THEN 0 ELSE 1 END, ' ||
    v_skill_answered_col || ' = ' || v_skill_answered_col || ' + 1, ' ||
    v_skill_correct_col || ' = ' || v_skill_correct_col || ' + CASE WHEN $2 THEN 1 ELSE 0 END, ' ||
    v_skill_wrong_col || ' = ' || v_skill_wrong_col || ' + CASE WHEN $2 THEN 0 ELSE 1 END';

  IF v_source_prefix IS NOT NULL THEN
    v_source_answered_col := quote_ident(v_source_prefix || '_answered_count');
    v_source_correct_col := quote_ident(v_source_prefix || '_correct_count');
    v_source_wrong_col := quote_ident(v_source_prefix || '_wrong_count');

    v_set_clause := v_set_clause || ', ' ||
      v_source_answered_col || ' = ' || v_source_answered_col || ' + 1, ' ||
      v_source_correct_col || ' = ' || v_source_correct_col || ' + CASE WHEN $2 THEN 1 ELSE 0 END, ' ||
      v_source_wrong_col || ' = ' || v_source_wrong_col || ' + CASE WHEN $2 THEN 0 ELSE 1 END';
  END IF;

  v_set_clause := v_set_clause ||
    ', last_event_type = $3, last_event_id = COALESCE($4, last_event_id), source_version = COALESCE($5, source_version), last_recalculated_at = NOW(), updated_at = NOW()';

  v_sql := 'UPDATE public.student_kpi_counters_current SET ' || v_set_clause || ' WHERE user_id = $1';
  EXECUTE v_sql USING p_user_id, p_is_correct, p_event_type, p_event_id, p_source_version;

  UPDATE public.student_kpi_counters_current
  SET
    overall_score_projection = CASE
      WHEN total_answered_count > 0 THEN ROUND((total_correct_count::numeric * 100) / total_answered_count, 2)
      ELSE 0
    END,
    math_score_projection = CASE
      WHEN math_answered_count > 0 THEN ROUND((math_correct_count::numeric * 100) / math_answered_count, 2)
      ELSE 0
    END,
    rw_score_projection = CASE
      WHEN rw_answered_count > 0 THEN ROUND((rw_correct_count::numeric * 100) / rw_answered_count, 2)
      ELSE 0
    END,
    readiness_metric = CASE
      WHEN total_answered_count > 0 THEN ROUND((total_correct_count::numeric * 100) / total_answered_count, 2)
      ELSE 0
    END,
    confidence_metric = ROUND((LEAST(total_answered_count, 200)::numeric / 200) * 100, 2),
    consistency_metric = COALESCE(consistency_metric, ROUND((LEAST(total_answered_count, 60)::numeric / 60) * 100, 2)),
    last_recalculated_at = NOW(),
    updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- Backfill current counters from historical attempts.
WITH base AS (
  SELECT
    a.user_id,
    COUNT(*)::integer AS total_answered_count,
    SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END)::integer AS total_correct_count,
    SUM(CASE WHEN a.is_correct THEN 0 ELSE 1 END)::integer AS total_wrong_count,
    SUM(CASE WHEN LOWER(COALESCE(a.section, '')) = 'math' THEN 1 ELSE 0 END)::integer AS math_answered_count,
    SUM(CASE WHEN LOWER(COALESCE(a.section, '')) = 'math' AND a.is_correct THEN 1 ELSE 0 END)::integer AS math_correct_count,
    SUM(CASE WHEN LOWER(COALESCE(a.section, '')) = 'math' AND NOT a.is_correct THEN 1 ELSE 0 END)::integer AS math_wrong_count,
    SUM(CASE WHEN LOWER(COALESCE(a.section, '')) = 'rw' THEN 1 ELSE 0 END)::integer AS rw_answered_count,
    SUM(CASE WHEN LOWER(COALESCE(a.section, '')) = 'rw' AND a.is_correct THEN 1 ELSE 0 END)::integer AS rw_correct_count,
    SUM(CASE WHEN LOWER(COALESCE(a.section, '')) = 'rw' AND NOT a.is_correct THEN 1 ELSE 0 END)::integer AS rw_wrong_count,
    SUM(CASE WHEN a.event_type IN ('practice_pass', 'practice_fail') THEN 1 ELSE 0 END)::integer AS practice_answered_count,
    SUM(CASE WHEN a.event_type = 'practice_pass' THEN 1 ELSE 0 END)::integer AS practice_correct_count,
    SUM(CASE WHEN a.event_type = 'practice_fail' THEN 1 ELSE 0 END)::integer AS practice_wrong_count,
    SUM(CASE WHEN a.event_type IN ('review_pass', 'review_fail') THEN 1 ELSE 0 END)::integer AS review_answered_count,
    SUM(CASE WHEN a.event_type = 'review_pass' THEN 1 ELSE 0 END)::integer AS review_correct_count,
    SUM(CASE WHEN a.event_type = 'review_fail' THEN 1 ELSE 0 END)::integer AS review_wrong_count,
    SUM(CASE WHEN a.event_type IN ('test_pass', 'test_fail') THEN 1 ELSE 0 END)::integer AS full_length_answered_count,
    SUM(CASE WHEN a.event_type = 'test_pass' THEN 1 ELSE 0 END)::integer AS full_length_correct_count,
    SUM(CASE WHEN a.event_type = 'test_fail' THEN 1 ELSE 0 END)::integer AS full_length_wrong_count,
    SUM(CASE WHEN a.event_type IN ('tutor_helped', 'tutor_fail') THEN 1 ELSE 0 END)::integer AS flowcard_answered_count,
    SUM(CASE WHEN a.event_type = 'tutor_helped' THEN 1 ELSE 0 END)::integer AS flowcard_correct_count,
    SUM(CASE WHEN a.event_type = 'tutor_fail' THEN 1 ELSE 0 END)::integer AS flowcard_wrong_count,
    MAX(a.event_type) FILTER (WHERE a.attempted_at IS NOT NULL) AS last_event_type
  FROM public.student_question_attempts a
  GROUP BY a.user_id
)
INSERT INTO public.student_kpi_counters_current (
  user_id,
  total_answered_count,
  total_correct_count,
  total_wrong_count,
  practice_answered_count,
  practice_correct_count,
  practice_wrong_count,
  review_answered_count,
  review_correct_count,
  review_wrong_count,
  full_length_answered_count,
  full_length_correct_count,
  full_length_wrong_count,
  flowcard_answered_count,
  flowcard_correct_count,
  flowcard_wrong_count,
  math_answered_count,
  math_correct_count,
  math_wrong_count,
  rw_answered_count,
  rw_correct_count,
  rw_wrong_count,
  last_event_type,
  source_version,
  last_recalculated_at,
  updated_at
)
SELECT
  b.user_id,
  b.total_answered_count,
  b.total_correct_count,
  b.total_wrong_count,
  b.practice_answered_count,
  b.practice_correct_count,
  b.practice_wrong_count,
  b.review_answered_count,
  b.review_correct_count,
  b.review_wrong_count,
  b.full_length_answered_count,
  b.full_length_correct_count,
  b.full_length_wrong_count,
  b.flowcard_answered_count,
  b.flowcard_correct_count,
  b.flowcard_wrong_count,
  b.math_answered_count,
  b.math_correct_count,
  b.math_wrong_count,
  b.rw_answered_count,
  b.rw_correct_count,
  b.rw_wrong_count,
  b.last_event_type,
  'kpi_truth_v1',
  NOW(),
  NOW()
FROM base b
ON CONFLICT (user_id) DO UPDATE
SET
  total_answered_count = EXCLUDED.total_answered_count,
  total_correct_count = EXCLUDED.total_correct_count,
  total_wrong_count = EXCLUDED.total_wrong_count,
  practice_answered_count = EXCLUDED.practice_answered_count,
  practice_correct_count = EXCLUDED.practice_correct_count,
  practice_wrong_count = EXCLUDED.practice_wrong_count,
  review_answered_count = EXCLUDED.review_answered_count,
  review_correct_count = EXCLUDED.review_correct_count,
  review_wrong_count = EXCLUDED.review_wrong_count,
  full_length_answered_count = EXCLUDED.full_length_answered_count,
  full_length_correct_count = EXCLUDED.full_length_correct_count,
  full_length_wrong_count = EXCLUDED.full_length_wrong_count,
  flowcard_answered_count = EXCLUDED.flowcard_answered_count,
  flowcard_correct_count = EXCLUDED.flowcard_correct_count,
  flowcard_wrong_count = EXCLUDED.flowcard_wrong_count,
  math_answered_count = EXCLUDED.math_answered_count,
  math_correct_count = EXCLUDED.math_correct_count,
  math_wrong_count = EXCLUDED.math_wrong_count,
  rw_answered_count = EXCLUDED.rw_answered_count,
  rw_correct_count = EXCLUDED.rw_correct_count,
  rw_wrong_count = EXCLUDED.rw_wrong_count,
  last_event_type = EXCLUDED.last_event_type,
  source_version = 'kpi_truth_v1',
  last_recalculated_at = NOW(),
  updated_at = NOW();

CREATE TEMP TABLE tmp_kpi_domain_map (
  section TEXT NOT NULL,
  domain TEXT NOT NULL,
  prefix TEXT NOT NULL,
  PRIMARY KEY (section, domain)
) ON COMMIT DROP;

INSERT INTO tmp_kpi_domain_map (section, domain, prefix)
VALUES
  ('math', 'algebra', 'm_alg'),
  ('math', 'advanced_math', 'm_advm'),
  ('math', 'problem_solving', 'm_prob'),
  ('math', 'geometry', 'm_geo'),
  ('rw', 'craft_structure', 'rw_craft'),
  ('rw', 'information_ideas', 'rw_info'),
  ('rw', 'standard_english', 'rw_stdeng'),
  ('rw', 'expression_ideas', 'rw_expr');

CREATE TEMP TABLE tmp_kpi_skill_map (
  skill TEXT PRIMARY KEY,
  suffix TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_kpi_skill_map (skill, suffix)
VALUES
  ('linear_equations', 'leq'),
  ('linear_inequalities', 'linq'),
  ('linear_functions', 'lfn'),
  ('systems_of_equations', 'syseq'),
  ('absolute_value', 'absv'),
  ('quadratics', 'quad'),
  ('polynomials', 'poly'),
  ('exponential_functions', 'expfn'),
  ('radical_expressions', 'radexp'),
  ('rational_expressions', 'ratexp'),
  ('ratios_rates_proportions', 'rrp'),
  ('percentages', 'pct'),
  ('unit_conversions', 'unitc'),
  ('linear_growth', 'lg'),
  ('data_interpretation', 'dint'),
  ('probability', 'prob'),
  ('statistics', 'stat'),
  ('area_volume', 'arvol'),
  ('lines_angles', 'lang'),
  ('triangles', 'tri'),
  ('circles', 'circ'),
  ('trigonometry', 'trig'),
  ('coordinate_geometry', 'cgeo'),
  ('words_in_context', 'wic'),
  ('text_structure', 'txts'),
  ('cross_text_connections', 'ctxt'),
  ('purpose', 'purp'),
  ('central_ideas', 'cidea'),
  ('command_of_evidence_textual', 'coet'),
  ('command_of_evidence_quantitative', 'coeq'),
  ('inferences', 'inf'),
  ('boundaries', 'bnd'),
  ('form_structure_sense', 'fss'),
  ('punctuation', 'punc'),
  ('verb_tense', 'vten'),
  ('pronoun_agreement', 'prag'),
  ('rhetorical_synthesis', 'rsy'),
  ('transitions', 'tran'),
  ('sentence_placement', 'spla');

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT
      a.user_id,
      dm.prefix AS domain_prefix,
      sm.suffix AS skill_suffix,
      COUNT(*)::integer AS answered_count,
      SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END)::integer AS correct_count,
      SUM(CASE WHEN a.is_correct THEN 0 ELSE 1 END)::integer AS wrong_count
    FROM public.student_question_attempts a
    JOIN tmp_kpi_domain_map dm
      ON dm.section = LOWER(COALESCE(a.section, ''))
     AND dm.domain = LOWER(COALESCE(a.domain, ''))
    JOIN tmp_kpi_skill_map sm
      ON sm.skill = LOWER(COALESCE(a.skill, ''))
    GROUP BY a.user_id, dm.prefix, sm.suffix
  LOOP
    EXECUTE format(
      'UPDATE public.student_kpi_counters_current
       SET %I = %I + $2,
           %I = %I + $3,
           %I = %I + $4,
           %I = %I + $2,
           %I = %I + $3,
           %I = %I + $4,
           updated_at = NOW(),
           last_recalculated_at = NOW()
       WHERE user_id = $1',
      rec.domain_prefix || '_answered_count', rec.domain_prefix || '_answered_count',
      rec.domain_prefix || '_correct_count', rec.domain_prefix || '_correct_count',
      rec.domain_prefix || '_wrong_count', rec.domain_prefix || '_wrong_count',
      rec.domain_prefix || '_' || rec.skill_suffix || '_answered_count', rec.domain_prefix || '_' || rec.skill_suffix || '_answered_count',
      rec.domain_prefix || '_' || rec.skill_suffix || '_correct_count', rec.domain_prefix || '_' || rec.skill_suffix || '_correct_count',
      rec.domain_prefix || '_' || rec.skill_suffix || '_wrong_count', rec.domain_prefix || '_' || rec.skill_suffix || '_wrong_count'
    )
    USING rec.user_id, rec.answered_count, rec.correct_count, rec.wrong_count;
  END LOOP;
END $$;

UPDATE public.student_kpi_counters_current
SET
  overall_score_projection = CASE
    WHEN total_answered_count > 0 THEN ROUND((total_correct_count::numeric * 100) / total_answered_count, 2)
    ELSE 0
  END,
  math_score_projection = CASE
    WHEN math_answered_count > 0 THEN ROUND((math_correct_count::numeric * 100) / math_answered_count, 2)
    ELSE 0
  END,
  rw_score_projection = CASE
    WHEN rw_answered_count > 0 THEN ROUND((rw_correct_count::numeric * 100) / rw_answered_count, 2)
    ELSE 0
  END,
  readiness_metric = CASE
    WHEN total_answered_count > 0 THEN ROUND((total_correct_count::numeric * 100) / total_answered_count, 2)
    ELSE 0
  END,
  confidence_metric = ROUND((LEAST(total_answered_count, 200)::numeric / 200) * 100, 2),
  consistency_metric = COALESCE(consistency_metric, ROUND((LEAST(total_answered_count, 60)::numeric / 60) * 100, 2)),
  source_version = 'kpi_truth_v1',
  last_recalculated_at = NOW(),
  updated_at = NOW();

INSERT INTO public.student_kpi_snapshots (
  user_id,
  snapshot_at,
  source_version,
  trigger_event_type,
  trigger_event_id,
  current_week_practice_sessions,
  current_week_practice_minutes,
  current_week_questions_solved,
  current_week_accuracy_percent,
  current_week_avg_seconds_per_question,
  previous_week_practice_sessions,
  previous_week_practice_minutes,
  previous_week_questions_solved,
  previous_week_accuracy_percent,
  previous_week_avg_seconds_per_question,
  recency_200_total_attempts,
  recency_200_accuracy_percent,
  recency_200_avg_seconds_per_question,
  overall_score_projection,
  math_score_projection,
  rw_score_projection,
  readiness_metric,
  confidence_metric,
  consistency_metric,
  m_alg_score_projection,
  m_advm_score_projection,
  m_prob_score_projection,
  m_geo_score_projection,
  rw_craft_score_projection,
  rw_info_score_projection,
  rw_stdeng_score_projection,
  rw_expr_score_projection,
  m_alg_leq_score_projection,
  m_alg_linq_score_projection,
  m_alg_lfn_score_projection,
  m_alg_syseq_score_projection,
  m_alg_absv_score_projection,
  m_advm_quad_score_projection,
  m_advm_poly_score_projection,
  m_advm_expfn_score_projection,
  m_advm_radexp_score_projection,
  m_advm_ratexp_score_projection,
  m_prob_rrp_score_projection,
  m_prob_pct_score_projection,
  m_prob_unitc_score_projection,
  m_prob_lg_score_projection,
  m_prob_dint_score_projection,
  m_prob_prob_score_projection,
  m_prob_stat_score_projection,
  m_geo_arvol_score_projection,
  m_geo_lang_score_projection,
  m_geo_tri_score_projection,
  m_geo_circ_score_projection,
  m_geo_trig_score_projection,
  m_geo_cgeo_score_projection,
  rw_craft_wic_score_projection,
  rw_craft_txts_score_projection,
  rw_craft_ctxt_score_projection,
  rw_craft_purp_score_projection,
  rw_info_cidea_score_projection,
  rw_info_coet_score_projection,
  rw_info_coeq_score_projection,
  rw_info_inf_score_projection,
  rw_stdeng_bnd_score_projection,
  rw_stdeng_fss_score_projection,
  rw_stdeng_punc_score_projection,
  rw_stdeng_vten_score_projection,
  rw_stdeng_prag_score_projection,
  rw_expr_rsy_score_projection,
  rw_expr_tran_score_projection,
  rw_expr_spla_score_projection,
  created_at,
  updated_at
)
SELECT
  c.user_id,
  NOW(),
  'kpi_truth_v1',
  'migration_backfill',
  '20260327_kpi_contract',
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  LEAST(c.total_answered_count, 200),
  CASE WHEN c.total_answered_count > 0 THEN ROUND((c.total_correct_count::numeric * 100) / c.total_answered_count, 2) ELSE 0 END,
  0,
  c.overall_score_projection,
  c.math_score_projection,
  c.rw_score_projection,
  c.readiness_metric,
  c.confidence_metric,
  c.consistency_metric,
  CASE WHEN c.m_alg_answered_count > 0 THEN ROUND((c.m_alg_correct_count::numeric * 100) / c.m_alg_answered_count, 2) ELSE 0 END AS m_alg_score_projection,
  CASE WHEN c.m_advm_answered_count > 0 THEN ROUND((c.m_advm_correct_count::numeric * 100) / c.m_advm_answered_count, 2) ELSE 0 END AS m_advm_score_projection,
  CASE WHEN c.m_prob_answered_count > 0 THEN ROUND((c.m_prob_correct_count::numeric * 100) / c.m_prob_answered_count, 2) ELSE 0 END AS m_prob_score_projection,
  CASE WHEN c.m_geo_answered_count > 0 THEN ROUND((c.m_geo_correct_count::numeric * 100) / c.m_geo_answered_count, 2) ELSE 0 END AS m_geo_score_projection,
  CASE WHEN c.rw_craft_answered_count > 0 THEN ROUND((c.rw_craft_correct_count::numeric * 100) / c.rw_craft_answered_count, 2) ELSE 0 END AS rw_craft_score_projection,
  CASE WHEN c.rw_info_answered_count > 0 THEN ROUND((c.rw_info_correct_count::numeric * 100) / c.rw_info_answered_count, 2) ELSE 0 END AS rw_info_score_projection,
  CASE WHEN c.rw_stdeng_answered_count > 0 THEN ROUND((c.rw_stdeng_correct_count::numeric * 100) / c.rw_stdeng_answered_count, 2) ELSE 0 END AS rw_stdeng_score_projection,
  CASE WHEN c.rw_expr_answered_count > 0 THEN ROUND((c.rw_expr_correct_count::numeric * 100) / c.rw_expr_answered_count, 2) ELSE 0 END AS rw_expr_score_projection,
  CASE WHEN c.m_alg_leq_answered_count > 0 THEN ROUND((c.m_alg_leq_correct_count::numeric * 100) / c.m_alg_leq_answered_count, 2) ELSE 0 END AS m_alg_leq_score_projection,
  CASE WHEN c.m_alg_linq_answered_count > 0 THEN ROUND((c.m_alg_linq_correct_count::numeric * 100) / c.m_alg_linq_answered_count, 2) ELSE 0 END AS m_alg_linq_score_projection,
  CASE WHEN c.m_alg_lfn_answered_count > 0 THEN ROUND((c.m_alg_lfn_correct_count::numeric * 100) / c.m_alg_lfn_answered_count, 2) ELSE 0 END AS m_alg_lfn_score_projection,
  CASE WHEN c.m_alg_syseq_answered_count > 0 THEN ROUND((c.m_alg_syseq_correct_count::numeric * 100) / c.m_alg_syseq_answered_count, 2) ELSE 0 END AS m_alg_syseq_score_projection,
  CASE WHEN c.m_alg_absv_answered_count > 0 THEN ROUND((c.m_alg_absv_correct_count::numeric * 100) / c.m_alg_absv_answered_count, 2) ELSE 0 END AS m_alg_absv_score_projection,
  CASE WHEN c.m_advm_quad_answered_count > 0 THEN ROUND((c.m_advm_quad_correct_count::numeric * 100) / c.m_advm_quad_answered_count, 2) ELSE 0 END AS m_advm_quad_score_projection,
  CASE WHEN c.m_advm_poly_answered_count > 0 THEN ROUND((c.m_advm_poly_correct_count::numeric * 100) / c.m_advm_poly_answered_count, 2) ELSE 0 END AS m_advm_poly_score_projection,
  CASE WHEN c.m_advm_expfn_answered_count > 0 THEN ROUND((c.m_advm_expfn_correct_count::numeric * 100) / c.m_advm_expfn_answered_count, 2) ELSE 0 END AS m_advm_expfn_score_projection,
  CASE WHEN c.m_advm_radexp_answered_count > 0 THEN ROUND((c.m_advm_radexp_correct_count::numeric * 100) / c.m_advm_radexp_answered_count, 2) ELSE 0 END AS m_advm_radexp_score_projection,
  CASE WHEN c.m_advm_ratexp_answered_count > 0 THEN ROUND((c.m_advm_ratexp_correct_count::numeric * 100) / c.m_advm_ratexp_answered_count, 2) ELSE 0 END AS m_advm_ratexp_score_projection,
  CASE WHEN c.m_prob_rrp_answered_count > 0 THEN ROUND((c.m_prob_rrp_correct_count::numeric * 100) / c.m_prob_rrp_answered_count, 2) ELSE 0 END AS m_prob_rrp_score_projection,
  CASE WHEN c.m_prob_pct_answered_count > 0 THEN ROUND((c.m_prob_pct_correct_count::numeric * 100) / c.m_prob_pct_answered_count, 2) ELSE 0 END AS m_prob_pct_score_projection,
  CASE WHEN c.m_prob_unitc_answered_count > 0 THEN ROUND((c.m_prob_unitc_correct_count::numeric * 100) / c.m_prob_unitc_answered_count, 2) ELSE 0 END AS m_prob_unitc_score_projection,
  CASE WHEN c.m_prob_lg_answered_count > 0 THEN ROUND((c.m_prob_lg_correct_count::numeric * 100) / c.m_prob_lg_answered_count, 2) ELSE 0 END AS m_prob_lg_score_projection,
  CASE WHEN c.m_prob_dint_answered_count > 0 THEN ROUND((c.m_prob_dint_correct_count::numeric * 100) / c.m_prob_dint_answered_count, 2) ELSE 0 END AS m_prob_dint_score_projection,
  CASE WHEN c.m_prob_prob_answered_count > 0 THEN ROUND((c.m_prob_prob_correct_count::numeric * 100) / c.m_prob_prob_answered_count, 2) ELSE 0 END AS m_prob_prob_score_projection,
  CASE WHEN c.m_prob_stat_answered_count > 0 THEN ROUND((c.m_prob_stat_correct_count::numeric * 100) / c.m_prob_stat_answered_count, 2) ELSE 0 END AS m_prob_stat_score_projection,
  CASE WHEN c.m_geo_arvol_answered_count > 0 THEN ROUND((c.m_geo_arvol_correct_count::numeric * 100) / c.m_geo_arvol_answered_count, 2) ELSE 0 END AS m_geo_arvol_score_projection,
  CASE WHEN c.m_geo_lang_answered_count > 0 THEN ROUND((c.m_geo_lang_correct_count::numeric * 100) / c.m_geo_lang_answered_count, 2) ELSE 0 END AS m_geo_lang_score_projection,
  CASE WHEN c.m_geo_tri_answered_count > 0 THEN ROUND((c.m_geo_tri_correct_count::numeric * 100) / c.m_geo_tri_answered_count, 2) ELSE 0 END AS m_geo_tri_score_projection,
  CASE WHEN c.m_geo_circ_answered_count > 0 THEN ROUND((c.m_geo_circ_correct_count::numeric * 100) / c.m_geo_circ_answered_count, 2) ELSE 0 END AS m_geo_circ_score_projection,
  CASE WHEN c.m_geo_trig_answered_count > 0 THEN ROUND((c.m_geo_trig_correct_count::numeric * 100) / c.m_geo_trig_answered_count, 2) ELSE 0 END AS m_geo_trig_score_projection,
  CASE WHEN c.m_geo_cgeo_answered_count > 0 THEN ROUND((c.m_geo_cgeo_correct_count::numeric * 100) / c.m_geo_cgeo_answered_count, 2) ELSE 0 END AS m_geo_cgeo_score_projection,
  CASE WHEN c.rw_craft_wic_answered_count > 0 THEN ROUND((c.rw_craft_wic_correct_count::numeric * 100) / c.rw_craft_wic_answered_count, 2) ELSE 0 END AS rw_craft_wic_score_projection,
  CASE WHEN c.rw_craft_txts_answered_count > 0 THEN ROUND((c.rw_craft_txts_correct_count::numeric * 100) / c.rw_craft_txts_answered_count, 2) ELSE 0 END AS rw_craft_txts_score_projection,
  CASE WHEN c.rw_craft_ctxt_answered_count > 0 THEN ROUND((c.rw_craft_ctxt_correct_count::numeric * 100) / c.rw_craft_ctxt_answered_count, 2) ELSE 0 END AS rw_craft_ctxt_score_projection,
  CASE WHEN c.rw_craft_purp_answered_count > 0 THEN ROUND((c.rw_craft_purp_correct_count::numeric * 100) / c.rw_craft_purp_answered_count, 2) ELSE 0 END AS rw_craft_purp_score_projection,
  CASE WHEN c.rw_info_cidea_answered_count > 0 THEN ROUND((c.rw_info_cidea_correct_count::numeric * 100) / c.rw_info_cidea_answered_count, 2) ELSE 0 END AS rw_info_cidea_score_projection,
  CASE WHEN c.rw_info_coet_answered_count > 0 THEN ROUND((c.rw_info_coet_correct_count::numeric * 100) / c.rw_info_coet_answered_count, 2) ELSE 0 END AS rw_info_coet_score_projection,
  CASE WHEN c.rw_info_coeq_answered_count > 0 THEN ROUND((c.rw_info_coeq_correct_count::numeric * 100) / c.rw_info_coeq_answered_count, 2) ELSE 0 END AS rw_info_coeq_score_projection,
  CASE WHEN c.rw_info_inf_answered_count > 0 THEN ROUND((c.rw_info_inf_correct_count::numeric * 100) / c.rw_info_inf_answered_count, 2) ELSE 0 END AS rw_info_inf_score_projection,
  CASE WHEN c.rw_stdeng_bnd_answered_count > 0 THEN ROUND((c.rw_stdeng_bnd_correct_count::numeric * 100) / c.rw_stdeng_bnd_answered_count, 2) ELSE 0 END AS rw_stdeng_bnd_score_projection,
  CASE WHEN c.rw_stdeng_fss_answered_count > 0 THEN ROUND((c.rw_stdeng_fss_correct_count::numeric * 100) / c.rw_stdeng_fss_answered_count, 2) ELSE 0 END AS rw_stdeng_fss_score_projection,
  CASE WHEN c.rw_stdeng_punc_answered_count > 0 THEN ROUND((c.rw_stdeng_punc_correct_count::numeric * 100) / c.rw_stdeng_punc_answered_count, 2) ELSE 0 END AS rw_stdeng_punc_score_projection,
  CASE WHEN c.rw_stdeng_vten_answered_count > 0 THEN ROUND((c.rw_stdeng_vten_correct_count::numeric * 100) / c.rw_stdeng_vten_answered_count, 2) ELSE 0 END AS rw_stdeng_vten_score_projection,
  CASE WHEN c.rw_stdeng_prag_answered_count > 0 THEN ROUND((c.rw_stdeng_prag_correct_count::numeric * 100) / c.rw_stdeng_prag_answered_count, 2) ELSE 0 END AS rw_stdeng_prag_score_projection,
  CASE WHEN c.rw_expr_rsy_answered_count > 0 THEN ROUND((c.rw_expr_rsy_correct_count::numeric * 100) / c.rw_expr_rsy_answered_count, 2) ELSE 0 END AS rw_expr_rsy_score_projection,
  CASE WHEN c.rw_expr_tran_answered_count > 0 THEN ROUND((c.rw_expr_tran_correct_count::numeric * 100) / c.rw_expr_tran_answered_count, 2) ELSE 0 END AS rw_expr_tran_score_projection,
  CASE WHEN c.rw_expr_spla_answered_count > 0 THEN ROUND((c.rw_expr_spla_correct_count::numeric * 100) / c.rw_expr_spla_answered_count, 2) ELSE 0 END AS rw_expr_spla_score_projection,
  NOW(),
  NOW()
FROM public.student_kpi_counters_current c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.student_kpi_snapshots s
  WHERE s.user_id = c.user_id
);

COMMIT;
