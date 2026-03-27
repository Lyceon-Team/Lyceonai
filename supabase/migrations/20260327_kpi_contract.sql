BEGIN;

-- =============================================================================
-- KPI persisted truth contract
-- Full rewrite to avoid nested dollar-quoted dynamic SQL parsing issues
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Constants
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 2) Current counters table
-- -----------------------------------------------------------------------------
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

-- explicit domain counters
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_alg_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_alg_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_alg_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_advm_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_advm_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_advm_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_craft_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_craft_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_craft_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_info_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_info_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_info_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_stdeng_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_stdeng_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_stdeng_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_expr_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_expr_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_expr_wrong_count INTEGER NOT NULL DEFAULT 0;

-- explicit skill counters
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_alg_leq_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_alg_leq_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_alg_leq_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_alg_linq_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_alg_linq_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_alg_linq_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_alg_lfn_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_alg_lfn_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_alg_lfn_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_alg_syseq_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_alg_syseq_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_alg_syseq_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_alg_absv_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_alg_absv_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_alg_absv_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_advm_quad_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_advm_quad_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_advm_quad_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_advm_poly_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_advm_poly_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_advm_poly_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_advm_expfn_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_advm_expfn_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_advm_expfn_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_advm_radexp_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_advm_radexp_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_advm_radexp_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_advm_ratexp_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_advm_ratexp_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_advm_ratexp_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_rrp_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_rrp_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_rrp_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_pct_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_pct_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_pct_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_unitc_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_unitc_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_unitc_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_lg_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_lg_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_lg_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_dint_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_dint_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_dint_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_prob_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_prob_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_prob_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_stat_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_stat_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_prob_stat_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_arvol_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_arvol_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_arvol_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_lang_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_lang_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_lang_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_tri_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_tri_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_tri_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_circ_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_circ_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_circ_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_trig_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_trig_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_trig_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_cgeo_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_cgeo_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS m_geo_cgeo_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_craft_wic_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_craft_wic_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_craft_wic_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_craft_txts_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_craft_txts_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_craft_txts_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_craft_ctxt_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_craft_ctxt_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_craft_ctxt_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_craft_purp_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_craft_purp_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_craft_purp_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_info_cidea_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_info_cidea_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_info_cidea_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_info_coet_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_info_coet_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_info_coet_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_info_coeq_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_info_coeq_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_info_coeq_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_info_inf_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_info_inf_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_info_inf_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_stdeng_bnd_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_stdeng_bnd_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_stdeng_bnd_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_stdeng_fss_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_stdeng_fss_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_stdeng_fss_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_stdeng_punc_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_stdeng_punc_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_stdeng_punc_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_stdeng_vten_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_stdeng_vten_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_stdeng_vten_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_stdeng_prag_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_stdeng_prag_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_stdeng_prag_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_expr_rsy_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_expr_rsy_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_expr_rsy_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_expr_tran_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_expr_tran_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_expr_tran_wrong_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_expr_spla_answered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_expr_spla_correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_counters_current ADD COLUMN IF NOT EXISTS rw_expr_spla_wrong_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_student_kpi_counters_current_last_recalculated
  ON public.student_kpi_counters_current(last_recalculated_at DESC NULLS LAST);

-- -----------------------------------------------------------------------------
-- 3) Snapshot history table
-- -----------------------------------------------------------------------------
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

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_alg_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_advm_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_prob_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_geo_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_craft_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_info_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_stdeng_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_expr_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;

ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_alg_leq_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_alg_linq_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_alg_lfn_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_alg_syseq_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_alg_absv_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_advm_quad_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_advm_poly_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_advm_expfn_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_advm_radexp_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_advm_ratexp_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_prob_rrp_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_prob_pct_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_prob_unitc_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_prob_lg_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_prob_dint_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_prob_prob_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_prob_stat_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_geo_arvol_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_geo_lang_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_geo_tri_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_geo_circ_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_geo_trig_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS m_geo_cgeo_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_craft_wic_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_craft_txts_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_craft_ctxt_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_craft_purp_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_info_cidea_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_info_coet_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_info_coeq_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_info_inf_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_stdeng_bnd_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_stdeng_fss_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_stdeng_punc_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_stdeng_vten_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_stdeng_prag_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_expr_rsy_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_expr_tran_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.student_kpi_snapshots ADD COLUMN IF NOT EXISTS rw_expr_spla_score_projection NUMERIC(6,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_student_kpi_snapshots_user_snapshot_at
  ON public.student_kpi_snapshots(user_id, snapshot_at DESC);

-- -----------------------------------------------------------------------------
-- 4) RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.kpi_constants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_kpi_counters_current ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_kpi_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'kpi_constants'
      AND policyname = 'kpi_constants_select_authenticated'
  ) THEN
    CREATE POLICY kpi_constants_select_authenticated
      ON public.kpi_constants
      FOR SELECT TO authenticated
      USING (TRUE);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'kpi_constants'
      AND policyname = 'kpi_constants_service_all'
  ) THEN
    CREATE POLICY kpi_constants_service_all
      ON public.kpi_constants
      FOR ALL
      USING ((auth.jwt() ->> 'role') = 'service_role')
      WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'student_kpi_counters_current'
      AND policyname = 'student_kpi_counters_current_select_own'
  ) THEN
    CREATE POLICY student_kpi_counters_current_select_own
      ON public.student_kpi_counters_current
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'student_kpi_counters_current'
      AND policyname = 'student_kpi_counters_current_service_all'
  ) THEN
    CREATE POLICY student_kpi_counters_current_service_all
      ON public.student_kpi_counters_current
      FOR ALL
      USING ((auth.jwt() ->> 'role') = 'service_role')
      WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'student_kpi_snapshots'
      AND policyname = 'student_kpi_snapshots_select_own'
  ) THEN
    CREATE POLICY student_kpi_snapshots_select_own
      ON public.student_kpi_snapshots
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'student_kpi_snapshots'
      AND policyname = 'student_kpi_snapshots_service_all'
  ) THEN
    CREATE POLICY student_kpi_snapshots_service_all
      ON public.student_kpi_snapshots
      FOR ALL
      USING ((auth.jwt() ->> 'role') = 'service_role')
      WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5) Updated-at triggers
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_kpi_constants_updated_at ON public.kpi_constants;
DROP TRIGGER IF EXISTS set_student_kpi_counters_current_updated_at ON public.student_kpi_counters_current;
DROP TRIGGER IF EXISTS set_student_kpi_snapshots_updated_at ON public.student_kpi_snapshots;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'set_updated_at'
  ) THEN
    CREATE TRIGGER set_kpi_constants_updated_at
      BEFORE UPDATE ON public.kpi_constants
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();

    CREATE TRIGGER set_student_kpi_counters_current_updated_at
      BEFORE UPDATE ON public.student_kpi_counters_current
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();

    CREATE TRIGGER set_student_kpi_snapshots_updated_at
      BEFORE UPDATE ON public.student_kpi_snapshots
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 6) Runtime upsert function
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_student_kpi_counters_current(
  p_user_id UUID,
  p_event_type TEXT,
  p_is_correct BOOLEAN,
  p_section TEXT,
  p_domain_prefix TEXT,
  p_skill_prefix TEXT,
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
  v_sql TEXT;
  v_row public.student_kpi_counters_current;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  IF v_section NOT IN ('math', 'rw') THEN
    RAISE EXCEPTION 'p_section must be math or rw';
  END IF;

  IF v_domain_prefix !~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Invalid domain prefix: %', p_domain_prefix;
  END IF;

  IF v_skill_prefix !~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Invalid skill prefix: %', p_skill_prefix;
  END IF;

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

  INSERT INTO public.student_kpi_counters_current (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  v_sql :=
    'UPDATE public.student_kpi_counters_current SET ' ||
    'total_answered_count = total_answered_count + 1, ' ||
    'total_correct_count = total_correct_count + CASE WHEN $2 THEN 1 ELSE 0 END, ' ||
    'total_wrong_count = total_wrong_count + CASE WHEN $2 THEN 0 ELSE 1 END, ' ||
    quote_ident(v_section || '_answered_count') || ' = ' || quote_ident(v_section || '_answered_count') || ' + 1, ' ||
    quote_ident(v_section || '_correct_count') || ' = ' || quote_ident(v_section || '_correct_count') || ' + CASE WHEN $2 THEN 1 ELSE 0 END, ' ||
    quote_ident(v_section || '_wrong_count') || ' = ' || quote_ident(v_section || '_wrong_count') || ' + CASE WHEN $2 THEN 0 ELSE 1 END, ' ||
    quote_ident(v_domain_prefix || '_answered_count') || ' = ' || quote_ident(v_domain_prefix || '_answered_count') || ' + 1, ' ||
    quote_ident(v_domain_prefix || '_correct_count') || ' = ' || quote_ident(v_domain_prefix || '_correct_count') || ' + CASE WHEN $2 THEN 1 ELSE 0 END, ' ||
    quote_ident(v_domain_prefix || '_wrong_count') || ' = ' || quote_ident(v_domain_prefix || '_wrong_count') || ' + CASE WHEN $2 THEN 0 ELSE 1 END, ' ||
    quote_ident(v_skill_prefix || '_answered_count') || ' = ' || quote_ident(v_skill_prefix || '_answered_count') || ' + 1, ' ||
    quote_ident(v_skill_prefix || '_correct_count') || ' = ' || quote_ident(v_skill_prefix || '_correct_count') || ' + CASE WHEN $2 THEN 1 ELSE 0 END, ' ||
    quote_ident(v_skill_prefix || '_wrong_count') || ' = ' || quote_ident(v_skill_prefix || '_wrong_count') || ' + CASE WHEN $2 THEN 0 ELSE 1 END';

  IF v_source_prefix IS NOT NULL THEN
    v_sql := v_sql || ', ' ||
      quote_ident(v_source_prefix || '_answered_count') || ' = ' || quote_ident(v_source_prefix || '_answered_count') || ' + 1, ' ||
      quote_ident(v_source_prefix || '_correct_count') || ' = ' || quote_ident(v_source_prefix || '_correct_count') || ' + CASE WHEN $2 THEN 1 ELSE 0 END, ' ||
      quote_ident(v_source_prefix || '_wrong_count') || ' = ' || quote_ident(v_source_prefix || '_wrong_count') || ' + CASE WHEN $2 THEN 0 ELSE 1 END';
  END IF;

  v_sql := v_sql || ', ' ||
    'last_event_type = $3, ' ||
    'last_event_id = COALESCE($4, last_event_id), ' ||
    'source_version = COALESCE($5, source_version), ' ||
    'last_recalculated_at = NOW(), ' ||
    'updated_at = NOW() ' ||
    'WHERE user_id = $1';

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

-- -----------------------------------------------------------------------------
-- 7) Backfill helpers
-- -----------------------------------------------------------------------------
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
  prefix TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_kpi_skill_map (skill, prefix)
VALUES
  ('linear_equations', 'm_alg_leq'),
  ('linear_inequalities', 'm_alg_linq'),
  ('linear_functions', 'm_alg_lfn'),
  ('systems_of_equations', 'm_alg_syseq'),
  ('absolute_value', 'm_alg_absv'),
  ('quadratics', 'm_advm_quad'),
  ('polynomials', 'm_advm_poly'),
  ('exponential_functions', 'm_advm_expfn'),
  ('radical_expressions', 'm_advm_radexp'),
  ('rational_expressions', 'm_advm_ratexp'),
  ('ratios_rates_proportions', 'm_prob_rrp'),
  ('percentages', 'm_prob_pct'),
  ('unit_conversions', 'm_prob_unitc'),
  ('linear_growth', 'm_prob_lg'),
  ('data_interpretation', 'm_prob_dint'),
  ('probability', 'm_prob_prob'),
  ('statistics', 'm_prob_stat'),
  ('area_volume', 'm_geo_arvol'),
  ('lines_angles', 'm_geo_lang'),
  ('triangles', 'm_geo_tri'),
  ('circles', 'm_geo_circ'),
  ('trigonometry', 'm_geo_trig'),
  ('coordinate_geometry', 'm_geo_cgeo'),
  ('words_in_context', 'rw_craft_wic'),
  ('text_structure', 'rw_craft_txts'),
  ('cross_text_connections', 'rw_craft_ctxt'),
  ('purpose', 'rw_craft_purp'),
  ('central_ideas', 'rw_info_cidea'),
  ('command_of_evidence_textual', 'rw_info_coet'),
  ('command_of_evidence_quantitative', 'rw_info_coeq'),
  ('inferences', 'rw_info_inf'),
  ('boundaries', 'rw_stdeng_bnd'),
  ('form_structure_sense', 'rw_stdeng_fss'),
  ('punctuation', 'rw_stdeng_punc'),
  ('verb_tense', 'rw_stdeng_vten'),
  ('pronoun_agreement', 'rw_stdeng_prag'),
  ('rhetorical_synthesis', 'rw_expr_rsy'),
  ('transitions', 'rw_expr_tran'),
  ('sentence_placement', 'rw_expr_spla');

DO $$
DECLARE
  v_source_expr text := '''unknown''';
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='student_question_attempts' AND column_name='event_type'
  ) THEN
    v_source_expr := 'LOWER(COALESCE(a.event_type, ''unknown''))';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='student_question_attempts' AND column_name='source_origin'
  ) THEN
    v_source_expr := 'LOWER(COALESCE(a.source_origin, ''unknown''))';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='student_question_attempts' AND column_name='attempt_source'
  ) THEN
    v_source_expr := 'LOWER(COALESCE(a.attempt_source, ''unknown''))';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='student_question_attempts' AND column_name='context'
  ) THEN
    v_source_expr := 'LOWER(COALESCE(a.context, ''unknown''))';
  END IF;

  EXECUTE '
    CREATE TEMP TABLE tmp_kpi_attempts_normalized ON COMMIT DROP AS
    SELECT
      a.user_id,
      a.is_correct,
      LOWER(COALESCE(a.section, '''')) AS section,
      LOWER(COALESCE(a.domain, '''')) AS domain,
      LOWER(COALESCE(a.skill, '''')) AS skill,
      ' || v_source_expr || ' AS source_kind
    FROM public.student_question_attempts a
  ';
END $$;

-- ensure required columns exist in live schema
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='student_question_attempts' AND column_name='user_id'
  ) THEN
    RAISE EXCEPTION 'student_question_attempts.user_id is required for KPI backfill';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='student_question_attempts' AND column_name='is_correct'
  ) THEN
    RAISE EXCEPTION 'student_question_attempts.is_correct is required for KPI backfill';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 8) Deterministic backfill into current counters
-- -----------------------------------------------------------------------------
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
  n.user_id,
  COUNT(*)::integer AS total_answered_count,
  SUM(CASE WHEN n.is_correct THEN 1 ELSE 0 END)::integer AS total_correct_count,
  SUM(CASE WHEN n.is_correct THEN 0 ELSE 1 END)::integer AS total_wrong_count,

  SUM(CASE WHEN n.source_kind IN ('practice_pass', 'practice_fail', 'practice') THEN 1 ELSE 0 END)::integer,
  SUM(CASE WHEN ((n.source_kind = 'practice_pass') OR (n.source_kind = 'practice' AND n.is_correct)) THEN 1 ELSE 0 END)::integer,
  SUM(CASE WHEN ((n.source_kind = 'practice_fail') OR (n.source_kind = 'practice' AND NOT n.is_correct)) THEN 1 ELSE 0 END)::integer,

  SUM(CASE WHEN n.source_kind IN ('review_pass', 'review_fail', 'review') THEN 1 ELSE 0 END)::integer,
  SUM(CASE WHEN ((n.source_kind = 'review_pass') OR (n.source_kind = 'review' AND n.is_correct)) THEN 1 ELSE 0 END)::integer,
  SUM(CASE WHEN ((n.source_kind = 'review_fail') OR (n.source_kind = 'review' AND NOT n.is_correct)) THEN 1 ELSE 0 END)::integer,

  SUM(CASE WHEN n.source_kind IN ('test_pass', 'test_fail', 'full_length', 'full_test') THEN 1 ELSE 0 END)::integer,
  SUM(CASE WHEN ((n.source_kind = 'test_pass') OR (n.source_kind IN ('full_length', 'full_test') AND n.is_correct)) THEN 1 ELSE 0 END)::integer,
  SUM(CASE WHEN ((n.source_kind = 'test_fail') OR (n.source_kind IN ('full_length', 'full_test') AND NOT n.is_correct)) THEN 1 ELSE 0 END)::integer,

  SUM(CASE WHEN n.source_kind IN ('tutor_helped', 'tutor_fail', 'flowcard', 'flow_card') THEN 1 ELSE 0 END)::integer,
  SUM(CASE WHEN ((n.source_kind = 'tutor_helped') OR (n.source_kind IN ('flowcard', 'flow_card') AND n.is_correct)) THEN 1 ELSE 0 END)::integer,
  SUM(CASE WHEN ((n.source_kind = 'tutor_fail') OR (n.source_kind IN ('flowcard', 'flow_card') AND NOT n.is_correct)) THEN 1 ELSE 0 END)::integer,

  SUM(CASE WHEN n.section = 'math' THEN 1 ELSE 0 END)::integer,
  SUM(CASE WHEN n.section = 'math' AND n.is_correct THEN 1 ELSE 0 END)::integer,
  SUM(CASE WHEN n.section = 'math' AND NOT n.is_correct THEN 1 ELSE 0 END)::integer,

  SUM(CASE WHEN n.section = 'rw' THEN 1 ELSE 0 END)::integer,
  SUM(CASE WHEN n.section = 'rw' AND n.is_correct THEN 1 ELSE 0 END)::integer,
  SUM(CASE WHEN n.section = 'rw' AND NOT n.is_correct THEN 1 ELSE 0 END)::integer,

  MAX(n.source_kind),
  'kpi_truth_v1',
  NOW(),
  NOW()
FROM tmp_kpi_attempts_normalized n
GROUP BY n.user_id
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

-- reset domain counters before deterministic rebuild
UPDATE public.student_kpi_counters_current
SET
  m_alg_answered_count = 0, m_alg_correct_count = 0, m_alg_wrong_count = 0,
  m_advm_answered_count = 0, m_advm_correct_count = 0, m_advm_wrong_count = 0,
  m_prob_answered_count = 0, m_prob_correct_count = 0, m_prob_wrong_count = 0,
  m_geo_answered_count = 0, m_geo_correct_count = 0, m_geo_wrong_count = 0,
  rw_craft_answered_count = 0, rw_craft_correct_count = 0, rw_craft_wrong_count = 0,
  rw_info_answered_count = 0, rw_info_correct_count = 0, rw_info_wrong_count = 0,
  rw_stdeng_answered_count = 0, rw_stdeng_correct_count = 0, rw_stdeng_wrong_count = 0,
  rw_expr_answered_count = 0, rw_expr_correct_count = 0, rw_expr_wrong_count = 0,

  m_alg_leq_answered_count = 0, m_alg_leq_correct_count = 0, m_alg_leq_wrong_count = 0,
  m_alg_linq_answered_count = 0, m_alg_linq_correct_count = 0, m_alg_linq_wrong_count = 0,
  m_alg_lfn_answered_count = 0, m_alg_lfn_correct_count = 0, m_alg_lfn_wrong_count = 0,
  m_alg_syseq_answered_count = 0, m_alg_syseq_correct_count = 0, m_alg_syseq_wrong_count = 0,
  m_alg_absv_answered_count = 0, m_alg_absv_correct_count = 0, m_alg_absv_wrong_count = 0,
  m_advm_quad_answered_count = 0, m_advm_quad_correct_count = 0, m_advm_quad_wrong_count = 0,
  m_advm_poly_answered_count = 0, m_advm_poly_correct_count = 0, m_advm_poly_wrong_count = 0,
  m_advm_expfn_answered_count = 0, m_advm_expfn_correct_count = 0, m_advm_expfn_wrong_count = 0,
  m_advm_radexp_answered_count = 0, m_advm_radexp_correct_count = 0, m_advm_radexp_wrong_count = 0,
  m_advm_ratexp_answered_count = 0, m_advm_ratexp_correct_count = 0, m_advm_ratexp_wrong_count = 0,
  m_prob_rrp_answered_count = 0, m_prob_rrp_correct_count = 0, m_prob_rrp_wrong_count = 0,
  m_prob_pct_answered_count = 0, m_prob_pct_correct_count = 0, m_prob_pct_wrong_count = 0,
  m_prob_unitc_answered_count = 0, m_prob_unitc_correct_count = 0, m_prob_unitc_wrong_count = 0,
  m_prob_lg_answered_count = 0, m_prob_lg_correct_count = 0, m_prob_lg_wrong_count = 0,
  m_prob_dint_answered_count = 0, m_prob_dint_correct_count = 0, m_prob_dint_wrong_count = 0,
  m_prob_prob_answered_count = 0, m_prob_prob_correct_count = 0, m_prob_prob_wrong_count = 0,
  m_prob_stat_answered_count = 0, m_prob_stat_correct_count = 0, m_prob_stat_wrong_count = 0,
  m_geo_arvol_answered_count = 0, m_geo_arvol_correct_count = 0, m_geo_arvol_wrong_count = 0,
  m_geo_lang_answered_count = 0, m_geo_lang_correct_count = 0, m_geo_lang_wrong_count = 0,
  m_geo_tri_answered_count = 0, m_geo_tri_correct_count = 0, m_geo_tri_wrong_count = 0,
  m_geo_circ_answered_count = 0, m_geo_circ_correct_count = 0, m_geo_circ_wrong_count = 0,
  m_geo_trig_answered_count = 0, m_geo_trig_correct_count = 0, m_geo_trig_wrong_count = 0,
  m_geo_cgeo_answered_count = 0, m_geo_cgeo_correct_count = 0, m_geo_cgeo_wrong_count = 0,
  rw_craft_wic_answered_count = 0, rw_craft_wic_correct_count = 0, rw_craft_wic_wrong_count = 0,
  rw_craft_txts_answered_count = 0, rw_craft_txts_correct_count = 0, rw_craft_txts_wrong_count = 0,
  rw_craft_ctxt_answered_count = 0, rw_craft_ctxt_correct_count = 0, rw_craft_ctxt_wrong_count = 0,
  rw_craft_purp_answered_count = 0, rw_craft_purp_correct_count = 0, rw_craft_purp_wrong_count = 0,
  rw_info_cidea_answered_count = 0, rw_info_cidea_correct_count = 0, rw_info_cidea_wrong_count = 0,
  rw_info_coet_answered_count = 0, rw_info_coet_correct_count = 0, rw_info_coet_wrong_count = 0,
  rw_info_coeq_answered_count = 0, rw_info_coeq_correct_count = 0, rw_info_coeq_wrong_count = 0,
  rw_info_inf_answered_count = 0, rw_info_inf_correct_count = 0, rw_info_inf_wrong_count = 0,
  rw_stdeng_bnd_answered_count = 0, rw_stdeng_bnd_correct_count = 0, rw_stdeng_bnd_wrong_count = 0,
  rw_stdeng_fss_answered_count = 0, rw_stdeng_fss_correct_count = 0, rw_stdeng_fss_wrong_count = 0,
  rw_stdeng_punc_answered_count = 0, rw_stdeng_punc_correct_count = 0, rw_stdeng_punc_wrong_count = 0,
  rw_stdeng_vten_answered_count = 0, rw_stdeng_vten_correct_count = 0, rw_stdeng_vten_wrong_count = 0,
  rw_stdeng_prag_answered_count = 0, rw_stdeng_prag_correct_count = 0, rw_stdeng_prag_wrong_count = 0,
  rw_expr_rsy_answered_count = 0, rw_expr_rsy_correct_count = 0, rw_expr_rsy_wrong_count = 0,
  rw_expr_tran_answered_count = 0, rw_expr_tran_correct_count = 0, rw_expr_tran_wrong_count = 0,
  rw_expr_spla_answered_count = 0, rw_expr_spla_correct_count = 0, rw_expr_spla_wrong_count = 0;

-- populate domain counters
UPDATE public.student_kpi_counters_current c
SET
  m_alg_answered_count = src.answered_count,
  m_alg_correct_count = src.correct_count,
  m_alg_wrong_count = src.wrong_count
FROM (
  SELECT n.user_id,
         COUNT(*)::integer AS answered_count,
         SUM(CASE WHEN n.is_correct THEN 1 ELSE 0 END)::integer AS correct_count,
         SUM(CASE WHEN n.is_correct THEN 0 ELSE 1 END)::integer AS wrong_count
  FROM tmp_kpi_attempts_normalized n
  WHERE n.section = 'math' AND n.domain = 'algebra'
  GROUP BY n.user_id
) src
WHERE c.user_id = src.user_id;

UPDATE public.student_kpi_counters_current c
SET
  m_advm_answered_count = src.answered_count,
  m_advm_correct_count = src.correct_count,
  m_advm_wrong_count = src.wrong_count
FROM (
  SELECT n.user_id, COUNT(*)::integer AS answered_count,
         SUM(CASE WHEN n.is_correct THEN 1 ELSE 0 END)::integer AS correct_count,
         SUM(CASE WHEN n.is_correct THEN 0 ELSE 1 END)::integer AS wrong_count
  FROM tmp_kpi_attempts_normalized n
  WHERE n.section = 'math' AND n.domain = 'advanced_math'
  GROUP BY n.user_id
) src
WHERE c.user_id = src.user_id;

UPDATE public.student_kpi_counters_current c
SET
  m_prob_answered_count = src.answered_count,
  m_prob_correct_count = src.correct_count,
  m_prob_wrong_count = src.wrong_count
FROM (
  SELECT n.user_id, COUNT(*)::integer AS answered_count,
         SUM(CASE WHEN n.is_correct THEN 1 ELSE 0 END)::integer AS correct_count,
         SUM(CASE WHEN n.is_correct THEN 0 ELSE 1 END)::integer AS wrong_count
  FROM tmp_kpi_attempts_normalized n
  WHERE n.section = 'math' AND n.domain = 'problem_solving'
  GROUP BY n.user_id
) src
WHERE c.user_id = src.user_id;

UPDATE public.student_kpi_counters_current c
SET
  m_geo_answered_count = src.answered_count,
  m_geo_correct_count = src.correct_count,
  m_geo_wrong_count = src.wrong_count
FROM (
  SELECT n.user_id, COUNT(*)::integer AS answered_count,
         SUM(CASE WHEN n.is_correct THEN 1 ELSE 0 END)::integer AS correct_count,
         SUM(CASE WHEN n.is_correct THEN 0 ELSE 1 END)::integer AS wrong_count
  FROM tmp_kpi_attempts_normalized n
  WHERE n.section = 'math' AND n.domain = 'geometry'
  GROUP BY n.user_id
) src
WHERE c.user_id = src.user_id;

UPDATE public.student_kpi_counters_current c
SET
  rw_craft_answered_count = src.answered_count,
  rw_craft_correct_count = src.correct_count,
  rw_craft_wrong_count = src.wrong_count
FROM (
  SELECT n.user_id, COUNT(*)::integer AS answered_count,
         SUM(CASE WHEN n.is_correct THEN 1 ELSE 0 END)::integer AS correct_count,
         SUM(CASE WHEN n.is_correct THEN 0 ELSE 1 END)::integer AS wrong_count
  FROM tmp_kpi_attempts_normalized n
  WHERE n.section = 'rw' AND n.domain = 'craft_structure'
  GROUP BY n.user_id
) src
WHERE c.user_id = src.user_id;

UPDATE public.student_kpi_counters_current c
SET
  rw_info_answered_count = src.answered_count,
  rw_info_correct_count = src.correct_count,
  rw_info_wrong_count = src.wrong_count
FROM (
  SELECT n.user_id, COUNT(*)::integer AS answered_count,
         SUM(CASE WHEN n.is_correct THEN 1 ELSE 0 END)::integer AS correct_count,
         SUM(CASE WHEN n.is_correct THEN 0 ELSE 1 END)::integer AS wrong_count
  FROM tmp_kpi_attempts_normalized n
  WHERE n.section = 'rw' AND n.domain = 'information_ideas'
  GROUP BY n.user_id
) src
WHERE c.user_id = src.user_id;

UPDATE public.student_kpi_counters_current c
SET
  rw_stdeng_answered_count = src.answered_count,
  rw_stdeng_correct_count = src.correct_count,
  rw_stdeng_wrong_count = src.wrong_count
FROM (
  SELECT n.user_id, COUNT(*)::integer AS answered_count,
         SUM(CASE WHEN n.is_correct THEN 1 ELSE 0 END)::integer AS correct_count,
         SUM(CASE WHEN n.is_correct THEN 0 ELSE 1 END)::integer AS wrong_count
  FROM tmp_kpi_attempts_normalized n
  WHERE n.section = 'rw' AND n.domain = 'standard_english'
  GROUP BY n.user_id
) src
WHERE c.user_id = src.user_id;

UPDATE public.student_kpi_counters_current c
SET
  rw_expr_answered_count = src.answered_count,
  rw_expr_correct_count = src.correct_count,
  rw_expr_wrong_count = src.wrong_count
FROM (
  SELECT n.user_id, COUNT(*)::integer AS answered_count,
         SUM(CASE WHEN n.is_correct THEN 1 ELSE 0 END)::integer AS correct_count,
         SUM(CASE WHEN n.is_correct THEN 0 ELSE 1 END)::integer AS wrong_count
  FROM tmp_kpi_attempts_normalized n
  WHERE n.section = 'rw' AND n.domain = 'expression_ideas'
  GROUP BY n.user_id
) src
WHERE c.user_id = src.user_id;

-- populate skill counters
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT skill, prefix FROM tmp_kpi_skill_map
  LOOP
    EXECUTE format(
      'UPDATE public.student_kpi_counters_current c
       SET %I = src.answered_count,
           %I = src.correct_count,
           %I = src.wrong_count
       FROM (
         SELECT n.user_id,
                COUNT(*)::integer AS answered_count,
                SUM(CASE WHEN n.is_correct THEN 1 ELSE 0 END)::integer AS correct_count,
                SUM(CASE WHEN n.is_correct THEN 0 ELSE 1 END)::integer AS wrong_count
         FROM tmp_kpi_attempts_normalized n
         WHERE n.skill = %L
         GROUP BY n.user_id
       ) src
       WHERE c.user_id = src.user_id',
      rec.prefix || '_answered_count',
      rec.prefix || '_correct_count',
      rec.prefix || '_wrong_count',
      rec.skill
    );
  END LOOP;
END $$;

-- recompute projections
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

-- -----------------------------------------------------------------------------
-- 9) Initial snapshot backfill
-- -----------------------------------------------------------------------------
INSERT INTO public.student_kpi_snapshots (
  user_id,
  snapshot_at,
  source_version,
  trigger_event_type,
  trigger_event_id,
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
  '20260327_kpi_contract_rewrite_v2',
  LEAST(c.total_answered_count, 200),
  CASE WHEN c.total_answered_count > 0 THEN ROUND((c.total_correct_count::numeric * 100) / c.total_answered_count, 2) ELSE 0 END,
  0,
  c.overall_score_projection,
  c.math_score_projection,
  c.rw_score_projection,
  c.readiness_metric,
  c.confidence_metric,
  c.consistency_metric,

  CASE WHEN c.m_alg_answered_count > 0 THEN ROUND((c.m_alg_correct_count::numeric * 100) / c.m_alg_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_advm_answered_count > 0 THEN ROUND((c.m_advm_correct_count::numeric * 100) / c.m_advm_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_prob_answered_count > 0 THEN ROUND((c.m_prob_correct_count::numeric * 100) / c.m_prob_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_geo_answered_count > 0 THEN ROUND((c.m_geo_correct_count::numeric * 100) / c.m_geo_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_craft_answered_count > 0 THEN ROUND((c.rw_craft_correct_count::numeric * 100) / c.rw_craft_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_info_answered_count > 0 THEN ROUND((c.rw_info_correct_count::numeric * 100) / c.rw_info_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_stdeng_answered_count > 0 THEN ROUND((c.rw_stdeng_correct_count::numeric * 100) / c.rw_stdeng_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_expr_answered_count > 0 THEN ROUND((c.rw_expr_correct_count::numeric * 100) / c.rw_expr_answered_count, 2) ELSE 0 END,

  CASE WHEN c.m_alg_leq_answered_count > 0 THEN ROUND((c.m_alg_leq_correct_count::numeric * 100) / c.m_alg_leq_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_alg_linq_answered_count > 0 THEN ROUND((c.m_alg_linq_correct_count::numeric * 100) / c.m_alg_linq_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_alg_lfn_answered_count > 0 THEN ROUND((c.m_alg_lfn_correct_count::numeric * 100) / c.m_alg_lfn_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_alg_syseq_answered_count > 0 THEN ROUND((c.m_alg_syseq_correct_count::numeric * 100) / c.m_alg_syseq_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_alg_absv_answered_count > 0 THEN ROUND((c.m_alg_absv_correct_count::numeric * 100) / c.m_alg_absv_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_advm_quad_answered_count > 0 THEN ROUND((c.m_advm_quad_correct_count::numeric * 100) / c.m_advm_quad_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_advm_poly_answered_count > 0 THEN ROUND((c.m_advm_poly_correct_count::numeric * 100) / c.m_advm_poly_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_advm_expfn_answered_count > 0 THEN ROUND((c.m_advm_expfn_correct_count::numeric * 100) / c.m_advm_expfn_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_advm_radexp_answered_count > 0 THEN ROUND((c.m_advm_radexp_correct_count::numeric * 100) / c.m_advm_radexp_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_advm_ratexp_answered_count > 0 THEN ROUND((c.m_advm_ratexp_correct_count::numeric * 100) / c.m_advm_ratexp_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_prob_rrp_answered_count > 0 THEN ROUND((c.m_prob_rrp_correct_count::numeric * 100) / c.m_prob_rrp_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_prob_pct_answered_count > 0 THEN ROUND((c.m_prob_pct_correct_count::numeric * 100) / c.m_prob_pct_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_prob_unitc_answered_count > 0 THEN ROUND((c.m_prob_unitc_correct_count::numeric * 100) / c.m_prob_unitc_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_prob_lg_answered_count > 0 THEN ROUND((c.m_prob_lg_correct_count::numeric * 100) / c.m_prob_lg_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_prob_dint_answered_count > 0 THEN ROUND((c.m_prob_dint_correct_count::numeric * 100) / c.m_prob_dint_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_prob_prob_answered_count > 0 THEN ROUND((c.m_prob_prob_correct_count::numeric * 100) / c.m_prob_prob_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_prob_stat_answered_count > 0 THEN ROUND((c.m_prob_stat_correct_count::numeric * 100) / c.m_prob_stat_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_geo_arvol_answered_count > 0 THEN ROUND((c.m_geo_arvol_correct_count::numeric * 100) / c.m_geo_arvol_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_geo_lang_answered_count > 0 THEN ROUND((c.m_geo_lang_correct_count::numeric * 100) / c.m_geo_lang_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_geo_tri_answered_count > 0 THEN ROUND((c.m_geo_tri_correct_count::numeric * 100) / c.m_geo_tri_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_geo_circ_answered_count > 0 THEN ROUND((c.m_geo_circ_correct_count::numeric * 100) / c.m_geo_circ_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_geo_trig_answered_count > 0 THEN ROUND((c.m_geo_trig_correct_count::numeric * 100) / c.m_geo_trig_answered_count, 2) ELSE 0 END,
  CASE WHEN c.m_geo_cgeo_answered_count > 0 THEN ROUND((c.m_geo_cgeo_correct_count::numeric * 100) / c.m_geo_cgeo_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_craft_wic_answered_count > 0 THEN ROUND((c.rw_craft_wic_correct_count::numeric * 100) / c.rw_craft_wic_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_craft_txts_answered_count > 0 THEN ROUND((c.rw_craft_txts_correct_count::numeric * 100) / c.rw_craft_txts_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_craft_ctxt_answered_count > 0 THEN ROUND((c.rw_craft_ctxt_correct_count::numeric * 100) / c.rw_craft_ctxt_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_craft_purp_answered_count > 0 THEN ROUND((c.rw_craft_purp_correct_count::numeric * 100) / c.rw_craft_purp_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_info_cidea_answered_count > 0 THEN ROUND((c.rw_info_cidea_correct_count::numeric * 100) / c.rw_info_cidea_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_info_coet_answered_count > 0 THEN ROUND((c.rw_info_coet_correct_count::numeric * 100) / c.rw_info_coet_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_info_coeq_answered_count > 0 THEN ROUND((c.rw_info_coeq_correct_count::numeric * 100) / c.rw_info_coeq_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_info_inf_answered_count > 0 THEN ROUND((c.rw_info_inf_correct_count::numeric * 100) / c.rw_info_inf_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_stdeng_bnd_answered_count > 0 THEN ROUND((c.rw_stdeng_bnd_correct_count::numeric * 100) / c.rw_stdeng_bnd_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_stdeng_fss_answered_count > 0 THEN ROUND((c.rw_stdeng_fss_correct_count::numeric * 100) / c.rw_stdeng_fss_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_stdeng_punc_answered_count > 0 THEN ROUND((c.rw_stdeng_punc_correct_count::numeric * 100) / c.rw_stdeng_punc_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_stdeng_vten_answered_count > 0 THEN ROUND((c.rw_stdeng_vten_correct_count::numeric * 100) / c.rw_stdeng_vten_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_stdeng_prag_answered_count > 0 THEN ROUND((c.rw_stdeng_prag_correct_count::numeric * 100) / c.rw_stdeng_prag_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_expr_rsy_answered_count > 0 THEN ROUND((c.rw_expr_rsy_correct_count::numeric * 100) / c.rw_expr_rsy_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_expr_tran_answered_count > 0 THEN ROUND((c.rw_expr_tran_correct_count::numeric * 100) / c.rw_expr_tran_answered_count, 2) ELSE 0 END,
  CASE WHEN c.rw_expr_spla_answered_count > 0 THEN ROUND((c.rw_expr_spla_correct_count::numeric * 100) / c.rw_expr_spla_answered_count, 2) ELSE 0 END,
  NOW(),
  NOW()
FROM public.student_kpi_counters_current c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.student_kpi_snapshots s
  WHERE s.user_id = c.user_id
);

COMMIT;
