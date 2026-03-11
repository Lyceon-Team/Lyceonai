# Supabase RLS Audit (Code/Policy-Derived)

Date: 2026-03-11
Auditor: Codex (repository evidence only)
Scope: `supabase/migrations/*.sql` currently in repo

## Method
1. Reviewed migration SQL for `ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` statements.
2. Verified policy intent against current server auth design (cookie auth + server middleware).
3. Documented high-confidence controls only when explicit SQL exists in migrations.

## Verified RLS Coverage

| Domain | Evidence | Result |
|---|---|---|
| Practice core (`practice_sessions`, `answer_attempts`, `practice_events`) | `supabase/migrations/20260110_practice_canonical_plus_events.sql:155-260` | PASS: RLS enabled + own-row policies + explicit service-role policy |
| Legal acceptance audit log (`legal_acceptances`) | `supabase/migrations/20251223_legal_acceptances.sql:21-31` | PASS: RLS enabled + self-read + self-insert |
| Review error attempts (`review_error_attempts`) | `supabase/migrations/20260203_review_error_attempts.sql:45-79` | PASS: RLS enabled + student own-row + admin read + service-role |
| Full-length exam tables (`sessions/modules/questions/responses`) | `supabase/migrations/20260213_full_length_exam_hardening.sql:153-298` and `supabase/migrations/20260216_full_length_exam_uuid_types.sql:393-532` | PASS: RLS enabled + ownership policies across all exam tables |
| Full-length exam score rollups | `supabase/migrations/20260218_full_length_exam_score_rollups.sql:84-92` | PASS: RLS enabled + own-row policies |
| Guardian links canonical table | `supabase/migrations/20260309_guardian_links_canonical.sql:109-122` | PASS: RLS enabled + guardian/student scoped read + service-role |
| Mastery tables | `supabase/migrations/20251222_student_mastery_tables.sql:96-130`, `supabase/migrations/20260210_mastery_v1.sql:78-108`, `supabase/migrations/20260211_mastery_constants.sql:59-67` | PASS: RLS enabled with own-row or authenticated read policy plus service-role policy |

## Policy Pattern Summary
- User-owned tables consistently use `auth.uid()` ownership checks for select/insert/update.
- Privileged server workflows use explicit service-role policies.
- Guardian-student relationship table (`guardian_links`) includes relationship-specific read policies for both sides.

## Risk Notes
1. Service-role policies are intentionally broad (`FOR ALL`) in several tables; this is expected, but server key handling remains critical.
2. RLS guarantees depend on requests carrying correct Supabase auth context (`auth.uid()`), which is enforced in server auth middleware.
3. Migrations show policy intent, but this audit does not prove deployment state of an external Supabase environment.

## Conclusion
RLS policy coverage is present for the primary student-data tables and legal/compliance tracking tables in current migrations. The repository-level posture is consistent with row-level isolation by authenticated user identity plus explicit service-role escape hatches for server operations.
