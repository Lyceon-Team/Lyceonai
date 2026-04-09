# DB Reconciliation Audit (Practice-First)

## Practice (Implemented)
| Chain Step | Runtime Owner | Canonical DB Surface | Status |
| --- | --- | --- | --- |
| Session creation | `server/routes/practice-canonical.ts` | `practice_sessions` | Implemented (table-native, no orchestration RPC) |
| Item materialization | `server/routes/practice-canonical.ts` | `practice_session_items` | Implemented (deterministic pool + copied metadata snapshot) |
| Finalized outcome write | `server/routes/practice-canonical.ts` | `practice_session_items` (`selected_answer`, `is_correct`, `outcome`, `time_spent_ms`, `client_attempt_id`, `answered_at`, `status`) | Implemented |
| Mastery trigger | `server/routes/practice-canonical.ts` | `apply_learning_event_to_mastery(...)` via `applyLearningEventToMastery` | Implemented (strict difficulty bucket fail-closed) |
| Runtime truth reads | `server/routes/practice-canonical.ts` | `practice_session_items` | Implemented |

## Review (Implemented)
| Chain Step | Runtime Anchor | Canonical DB Surface | Status |
| --- | --- | --- | --- |
| Session lifecycle | `server/routes/review-session-routes.ts` | `review_sessions` | Locked |
| Question-state reads | `server/routes/review-session-routes.ts` | `review_session_items` | Locked |
| Correctness write | `server/routes/review-session-routes.ts` | `review_error_attempts` | Locked |
| Mastery trigger | `server/routes/review-session-routes.ts` | `apply_learning_event_to_mastery(...)` | Locked (`question_difficulty_bucket` only, strict `1/2/3`) |
| Competing paths | `server/routes/tutor-v2.ts` | N/A | Locked (tutor telemetry only) |

## Full-Length (Implemented)
| Chain Step | Runtime Anchor | Canonical DB Surface | Status |
| --- | --- | --- | --- |
| Session lifecycle | `apps/api/src/services/fullLengthExam.ts` | `full_length_exam_sessions` | Locked |
| Question materialization | `apps/api/src/services/fullLengthExam.ts` | `full_length_exam_questions` | Locked |
| Correctness write | `apps/api/src/services/fullLengthExam.ts` | `full_length_exam_responses` | Locked |
| Mastery trigger | `apps/api/src/services/fullLengthExam.ts` | `apply_learning_event_to_mastery(...)` | Locked (module finalization, strict `1/2/3`) |
| Review unlock boundary | `server/routes/full-length-exam-routes.ts` | Completion-only review/report | Locked (423 until completion) |
| Scoring/read fallback policy | `apps/api/src/services/fullLengthExam.ts` | Materialized full-length tables only | Locked (fail-closed when materialized rows are missing/incomplete; no legacy `exam_*` fallback) |

## KPI / Mastery / Projection Read Migration
- Preserve route-level builder boundaries expected by CI.
- Keep `kpi-truth-layer` as the route-facing seam.
- Move builder internals to canonical read owners:
  - `student_kpi_rollups_current`
  - `student_skill_mastery`
  - `student_domain_mastery`
  - `student_section_projections`
- Treat `student_kpi_counters_current` and `student_kpi_snapshots` as compatibility-only (not current owner).
