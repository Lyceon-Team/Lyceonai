-- ============================================================================
-- Layer 1 crisis pattern seed — v1
-- @spec [LISA_Layer1_Pattern_Set_v1 §7.5–§7.8]
-- @implemented 2026-09-17
--
-- plain English: seeds the tutor_injection_signatures table with all v1 crisis
-- and safeguarding patterns. Each row carries category, severity, action,
-- version='v1', source='LISA_Layer1_Pattern_Set_v1', enabled=true. Patterns
-- are stored as lowercase, post-normalization form (normalizeCrisisText is
-- applied at match-time to the student message, not to the stored pattern).
--
-- All patterns are substring-containment strings, NOT regex. The matching
-- contract (§7.4) normalizes then checks `normalized.includes(pattern)`.
--
-- DO NOT APPLY TO PROD — Karl applies after review.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see DOWN MIGRATION.
-- ============================================================================

-- ── §7.5 Suicide — intent, planning, attempt ────────────────────────────
-- category: suicide · severity: critical · action: stop_and_review

INSERT INTO public.tutor_injection_signatures
  (signature_pattern, signature_type, severity, action, category, version, source, enabled)
VALUES
  ('i am going to kill myself',       'crisis', 'critical', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i am about to kill myself',       'crisis', 'critical', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i plan to kill myself',           'crisis', 'critical', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i have a plan to kill myself',    'crisis', 'critical', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i know how i am going to kill myself', 'crisis', 'critical', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i am going to end my life',       'crisis', 'critical', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i plan to end my life',           'crisis', 'critical', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i am going to commit suicide',    'crisis', 'critical', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i just tried to kill myself',     'crisis', 'critical', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i tried to kill myself today',    'crisis', 'critical', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i tried to kill myself tonight',  'crisis', 'critical', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i wrote a suicide note',          'crisis', 'critical', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i am going to kms',               'crisis', 'critical', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i am gonna kms',                  'crisis', 'critical', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i am going to unalive myself',    'crisis', 'critical', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true);

-- ── §7.6 Suicide — ideation, death wish, history ────────────────────────
-- category: suicide · severity: high · action: stop_and_review

INSERT INTO public.tutor_injection_signatures
  (signature_pattern, signature_type, severity, action, category, version, source, enabled)
VALUES
  ('i want to kill myself',                      'crisis', 'high', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i am thinking about killing myself',         'crisis', 'high', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i have been thinking about killing myself',  'crisis', 'high', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i am suicidal',                              'crisis', 'high', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i am having suicidal thoughts',              'crisis', 'high', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i want to end my life',                      'crisis', 'high', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i wish i were dead',                         'crisis', 'high', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i wish i was dead',                          'crisis', 'high', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i wish i could go to sleep and not wake up', 'crisis', 'high', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i do not want to be alive anymore',          'crisis', 'high', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('everyone would be better off if i were dead','crisis', 'high', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('my family would be better off if i were dead','crisis','high', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i have tried to kill myself',                'crisis', 'high', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i attempted suicide',                        'crisis', 'high', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i want to kms',                              'crisis', 'high', 'stop_and_review', 'suicide', 'v1', 'LISA_Layer1_Pattern_Set_v1', true);

-- ── §7.7 Deliberate self-harm ───────────────────────────────────────────
-- category: self_harm · action: stop_and_review

-- severity: critical
INSERT INTO public.tutor_injection_signatures
  (signature_pattern, signature_type, severity, action, category, version, source, enabled)
VALUES
  ('i am hurting myself right now',  'crisis', 'critical', 'stop_and_review', 'self_harm', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i am cutting myself right now',  'crisis', 'critical', 'stop_and_review', 'self_harm', 'v1', 'LISA_Layer1_Pattern_Set_v1', true);

-- severity: high
INSERT INTO public.tutor_injection_signatures
  (signature_pattern, signature_type, severity, action, category, version, source, enabled)
VALUES
  ('i want to hurt myself',         'crisis', 'high', 'stop_and_review', 'self_harm', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i am going to hurt myself',     'crisis', 'high', 'stop_and_review', 'self_harm', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i want to cut myself',          'crisis', 'high', 'stop_and_review', 'self_harm', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i am going to cut myself',      'crisis', 'high', 'stop_and_review', 'self_harm', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i have been cutting myself',    'crisis', 'high', 'stop_and_review', 'self_harm', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i cut myself on purpose',       'crisis', 'high', 'stop_and_review', 'self_harm', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i hurt myself on purpose',      'crisis', 'high', 'stop_and_review', 'self_harm', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i have been self harming',      'crisis', 'high', 'stop_and_review', 'self_harm', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i am going to self harm',       'crisis', 'high', 'stop_and_review', 'self_harm', 'v1', 'LISA_Layer1_Pattern_Set_v1', true);

-- ── §7.8 Abuse and sexual assault ───────────────────────────────────────
-- category: abuse · action: stop_and_safeguarding_review

-- severity: critical
INSERT INTO public.tutor_injection_signatures
  (signature_pattern, signature_type, severity, action, category, version, source, enabled)
VALUES
  ('i am being raped',                  'crisis', 'critical', 'stop_and_safeguarding_review', 'abuse', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('someone is hurting me right now',   'crisis', 'critical', 'stop_and_safeguarding_review', 'abuse', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('someone is threatening to kill me', 'crisis', 'critical', 'stop_and_safeguarding_review', 'abuse', 'v1', 'LISA_Layer1_Pattern_Set_v1', true);

-- severity: high
INSERT INTO public.tutor_injection_signatures
  (signature_pattern, signature_type, severity, action, category, version, source, enabled)
VALUES
  ('i am being abused',              'crisis', 'high', 'stop_and_safeguarding_review', 'abuse', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('my mom is abusing me',           'crisis', 'high', 'stop_and_safeguarding_review', 'abuse', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('my dad is abusing me',           'crisis', 'high', 'stop_and_safeguarding_review', 'abuse', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('my parents are abusing me',      'crisis', 'high', 'stop_and_safeguarding_review', 'abuse', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i was raped',                    'crisis', 'high', 'stop_and_safeguarding_review', 'abuse', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('someone raped me',               'crisis', 'high', 'stop_and_safeguarding_review', 'abuse', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i was sexually assaulted',       'crisis', 'high', 'stop_and_safeguarding_review', 'abuse', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('someone sexually assaulted me',  'crisis', 'high', 'stop_and_safeguarding_review', 'abuse', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i was molested',                 'crisis', 'high', 'stop_and_safeguarding_review', 'abuse', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('someone molested me',            'crisis', 'high', 'stop_and_safeguarding_review', 'abuse', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('i was forced to have sex',       'crisis', 'high', 'stop_and_safeguarding_review', 'abuse', 'v1', 'LISA_Layer1_Pattern_Set_v1', true),
  ('someone forced me to have sex',  'crisis', 'high', 'stop_and_safeguarding_review', 'abuse', 'v1', 'LISA_Layer1_Pattern_Set_v1', true);

-- ============================================================================
-- DOWN MIGRATION (rollback)
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed.
-- ============================================================================
-- DELETE FROM public.tutor_injection_signatures
--   WHERE version = 'v1' AND source = 'LISA_Layer1_Pattern_Set_v1';
