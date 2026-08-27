-- Genesis parity snapshot — the single query both sides run.
--
-- One row per catalog object, shaped `category|identity|detail`. The gate runs
-- this against a fresh genesis apply and diffs the result against the committed
-- production capture (scripts/ci/genesis-parity.prod.txt).
--
-- VERSION TOLERANCE (production is PG 17.6, CI pins 16 — a gate that produces
-- false failures gets disabled, which is worse than no gate):
--
--   * Function bodies use md5(prosrc), NOT pg_get_functiondef. prosrc is the
--     stored source text and is identical across majors; functiondef is
--     re-rendered by the server and its formatting moved between 16 and 17.
--   * Policy predicates use pg_get_expr on the raw parse tree via pg_policies'
--     already-rendered qual/with_check. These CAN re-render across majors; any
--     observed skew is recorded in the gate's VERSION_SKEW allowlist with the
--     exact before/after, never by dropping the column from comparison.
--   * Column defaults and constraint definitions are taken from the catalog
--     renderers for the same reason and carry the same treatment.
--   * Ordering is explicit everywhere. Catalog scan order is not stable and an
--     unordered diff is noise.
--
-- SCOPE: schema `public` only. The `stripe` schema (29 empty tables, SCL-050
-- drop queued) is deliberately out of scope and must not appear on either side.

WITH
tables AS (
  SELECT 'table' AS category, c.relname AS identity, '' AS detail
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
),
columns AS (
  SELECT 'column', a.attrelid::regclass::text || '.' || a.attname,
         format_type(a.atttypid, a.atttypmod)
           || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
           || COALESCE(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '')
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
),
constraints AS (
  SELECT 'constraint', con.conrelid::regclass::text || '.' || con.conname,
         con.contype::text || ' ' || pg_get_constraintdef(con.oid)
  FROM pg_constraint con
  JOIN pg_namespace n ON n.oid = con.connamespace
  WHERE n.nspname = 'public'
),
indexes AS (
  SELECT 'index', i.tablename || '.' || i.indexname, i.indexdef
  FROM pg_indexes i WHERE i.schemaname = 'public'
),
policies AS (
  SELECT 'policy', p.tablename || '.' || p.policyname,
         p.cmd || ' roles=' || array_to_string(p.roles, ',')
           || ' permissive=' || p.permissive
           || ' qual=' || COALESCE(p.qual, '-')
           || ' check=' || COALESCE(p.with_check, '-')
  FROM pg_policies p WHERE p.schemaname = 'public'
),
rls AS (
  SELECT 'rls', c.relname, CASE WHEN c.relrowsecurity THEN 'enabled' ELSE 'DISABLED' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
),
grants AS (
  SELECT 'grant', g.table_name || '.' || g.grantee, string_agg(g.privilege_type, ',' ORDER BY g.privilege_type)
  FROM information_schema.role_table_grants g
  WHERE g.table_schema = 'public' AND g.grantee IN ('anon', 'authenticated', 'service_role')
  GROUP BY g.table_name, g.grantee
),
functions AS (
  SELECT 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         md5(p.prosrc)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
),
triggers AS (
  SELECT 'trigger', t.tgrelid::regclass::text || '.' || t.tgname,
         pg_get_triggerdef(t.oid)
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
)
SELECT category || '|' || identity || '|' || detail AS line
FROM (
  SELECT * FROM tables      UNION ALL SELECT * FROM columns
  UNION ALL SELECT * FROM constraints UNION ALL SELECT * FROM indexes
  UNION ALL SELECT * FROM policies    UNION ALL SELECT * FROM rls
  UNION ALL SELECT * FROM grants      UNION ALL SELECT * FROM functions
  UNION ALL SELECT * FROM triggers
) all_objects
-- ACCEPTED-DRIFT ALLOWLIST — applied identically to BOTH sides.
--
-- FOUR objects exist in production and not in genesis. Each is excluded by
-- EXACT NAME. The comparison itself is NOT weakened: every other object in
-- every category is still compared in full, and a fifth drift fails on sight.
--
-- All four are created by migrations on `origin/cleanup`, so all four close
-- when PR #631 (cleanup -> main) lands. Verified 2026-08-27 by searching that
-- branch's migrations for each object's CREATE.
--
--   mastery_levels                 table     — expiry: PR #631. Also carries 6
--                                              rows, so its absence from genesis
--                                              is a data question too, not only
--                                              a schema one.
--   guardian_can_view_student_as   function  — expiry: PR #631
--   guardian_view_decision         function  — expiry: PR #631
--   canonical_skill_catalog        view      — expiry: PR #631. Found 2026-08-27
--                                              while reconciling grants: it was
--                                              the whole residual grant gap
--                                              (105 vs 106) and was NOT in the
--                                              original three-object drift
--                                              inventory. Owner ruled allowlist,
--                                              not add, since it lands on #631.
--
-- If any line is still here after #631 merges, the gate is hiding real drift
-- and has stopped doing its job. Delete each as it closes.
WHERE identity <> 'mastery_levels'
  AND identity NOT LIKE 'mastery_levels.%'
  AND identity NOT LIKE 'guardian_can_view_student_as(%'
  AND identity NOT LIKE 'guardian_view_decision(%'
  AND identity <> 'canonical_skill_catalog'
  AND identity NOT LIKE 'canonical_skill_catalog.%'
ORDER BY category, identity, detail;
