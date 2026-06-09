-- Extend de-identification procedure with deterministic deleted email and full scrub scope
-- Safe to re-run (CREATE OR REPLACE)

DROP FUNCTION IF EXISTS deidentify_user(UUID);

CREATE OR REPLACE FUNCTION deidentify_user(target_user_id UUID, deleted_email TEXT)
RETURNS void AS $$
DECLARE
    v_deleted_email TEXT := deleted_email;
    v_guardian_email TEXT;
    v_account_ids UUID[];
BEGIN
    -- Capture pre-scrub email for guardian consent cleanup
    SELECT email INTO v_guardian_email
    FROM public.profiles
    WHERE id = target_user_id;

    IF v_deleted_email IS NULL OR v_deleted_email = '' THEN
        v_deleted_email := CONCAT('deleted_', gen_random_uuid(), '@deleted.lyceon.ai');
    END IF;

    -- Revoke guardian links (without affecting student entitlement)
    IF to_regclass('public.guardian_links') IS NOT NULL THEN
        UPDATE public.guardian_links
        SET status = 'revoked', revoked_at = NOW()
        WHERE status = 'active'
          AND (guardian_profile_id = target_user_id OR student_user_id = target_user_id);
    END IF;

    -- Scrub direct PII from profile
    UPDATE public.profiles
    SET
        first_name = NULL,
        last_name = NULL,
        phone_number = NULL,
        date_of_birth = NULL,
        address = NULL,
        display_name = 'De-identified User',
        email = v_deleted_email,
        student_link_code = NULL,
        guardian_profile_id = NULL
    WHERE id = target_user_id;

    -- Retain legal acceptances but remove IP/User-Agent
    UPDATE public.legal_acceptances
    SET ip_address = NULL,
        user_agent = NULL
    WHERE user_id = target_user_id;

    -- Collect account ids for account-scoped deletions
    SELECT array_agg(account_id) INTO v_account_ids
    FROM public.lyceon_account_members
    WHERE user_id = target_user_id;

    -- Learning + tutor telemetry (hard delete)
    IF to_regclass('public.practice_session_items') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.practice_session_items WHERE user_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.practice_sessions') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.practice_sessions WHERE user_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.answer_attempts') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.answer_attempts WHERE user_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.student_question_attempts') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.student_question_attempts WHERE user_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.student_skill_mastery') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.student_skill_mastery WHERE user_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.student_cluster_mastery') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.student_cluster_mastery WHERE user_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.review_session_items') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.review_session_items WHERE student_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.review_session_events') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.review_session_events WHERE student_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.review_sessions') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.review_sessions WHERE student_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.review_error_attempts') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.review_error_attempts WHERE student_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.user_competencies') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.user_competencies WHERE user_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.competency_events') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.competency_events WHERE user_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.full_length_exam_score_rollups') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.full_length_exam_score_rollups WHERE user_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.full_length_exam_sessions') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.full_length_exam_sessions WHERE user_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.student_study_plan_tasks') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.student_study_plan_tasks WHERE user_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.student_study_plan_days') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.student_study_plan_days WHERE user_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.student_study_profile') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.student_study_profile WHERE user_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.student_kpi_counters_current') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.student_kpi_counters_current WHERE user_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.student_kpi_snapshots') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.student_kpi_snapshots WHERE user_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.tutor_interactions') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.tutor_interactions WHERE user_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.notifications') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.notifications WHERE user_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.user_notification_preferences') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.user_notification_preferences WHERE user_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.guardian_preferences') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.guardian_preferences WHERE user_id = $1' USING target_user_id;
    END IF;
    IF to_regclass('public.guardian_consent_requests') IS NOT NULL THEN
        EXECUTE '
            DELETE FROM public.guardian_consent_requests
            WHERE child_id = $1 OR ($2 IS NOT NULL AND guardian_email = $2)
        ' USING target_user_id, v_guardian_email;
    END IF;
    IF to_regclass('public.usage_daily') IS NOT NULL AND v_account_ids IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.usage_daily WHERE account_id = ANY($1)' USING v_account_ids;
    END IF;

    -- Retain entitlements but scrub billing identifiers + premium state
    IF to_regclass('public.entitlements') IS NOT NULL AND v_account_ids IS NOT NULL THEN
        EXECUTE '
            UPDATE public.entitlements
            SET stripe_customer_id = NULL,
                stripe_subscription_id = NULL,
                current_period_end = NULL,
                plan = ''free'',
                status = ''inactive''
            WHERE account_id = ANY($1)
        ' USING v_account_ids;
    END IF;
END;
$$ LANGUAGE plpgsql;
