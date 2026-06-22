# Contract — `/api/progress/*` genesis read surface (WS-3 / Doc 05)

> Phase-1 read contract for the two live `/api/progress/*` endpoints, rewired off the
> retired old-generation columns onto the **genesis** Doc-05 vocabulary. Implementation-
> independent; Codex-auditable. Grounds: Doc 05B (Domain Mastery & KPI Rollups)
> §6.5/§6.7 visibility + §10.5 column-projection; Doc 05C (Score Projections).
>
> **Owner rulings (2026-06-22):** (1) reshape `/api/progress/kpis` to the 05B
> **event vocabulary** — drop fields the event-based model doesn't track
> (`practiceSessions`, `practiceMinutes`, `avgSecondsPerQuestion`); (2) **drop the
> per-domain breakdown** from `/api/progress/projection` (it derived from admin-only
> `mastery_pct`, violating §10.5).

## 0. Root cause (post-teardown CODE debris)

`server/services/canonical-runtime-views.ts` read flat old-gen columns that the genesis
tables no longer expose:

| old-gen read                                                                                                                    | genesis reality                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `student_kpi_rollups_current.{source_family,total_questions,correct_questions,incorrect_questions,accuracy_pct,avg_latency_ms}` | table is `(student_id, scope, scope_key, payload jsonb, computed_at)` — an **unpopulated shell with no writer**; canonical KPIs live in the dedicated `student_*_kpi` tables |
| `student_domain_mastery.questions_total`                                                                                        | column is `event_count_total`; and `mastery_pct` is **admin-only** (§10.5)                                                                                                   |

The PostgREST `.select()` on absent columns errors → the handler `catch` → **500**.

## 1. Canonical sources (what to read)

| Endpoint                       | Read from                                                                                         | Columns (student-granted per §6.5 only)                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/progress/kpis`       | `student_overall_kpi`                                                                             | `events_total, events_last_7d, events_last_30d, accuracy_overall, accuracy_last_7d, accuracy_last_30d, current_streak_days, longest_streak_days, sections_active, last_active_at` |
| `GET /api/progress/projection` | `student_section_projections` (per section M/RW) + `student_overall_kpi` (for the evidence count) | projections: `section, projected_score_mid, projected_score_low, projected_score_high, relevant_question_count`; overall: `events_total`                                          |

**Never select** `kpi_refresh_version`, `refreshed_at`, `refreshed_at_t_now`,
`mastery_score`, `mastery_pct`, `mastery_level`, `last_event_*` on these surfaces
(§6.5 audit columns + §10.5 mastery-score non-exposure). Reads use the service-role
client; column-projection is enforced **in code**, never by GRANT alone (§10.5).

## 2. `GET /api/progress/kpis` — response contract (event vocabulary)

```
{
  modelVersion: "kpi_truth_v1",
  timezone: string,
  week: {                       // current 7-day window
    questionsSolved: number,    // = events_last_7d  (a scored event == an answered question)
    accuracy: number | null,    // = round(accuracy_last_7d * 100); null when events_last_7d == 0
    explanations: Record<id, KpiExplanation>,
  },
  recency: null | {             // 30-day trend; gated to paid (historical trends)
    window: 30,
    totalAttempts: number,      // = events_last_30d
    accuracy: number | null,    // = round(accuracy_last_30d * 100); null when 0 events
    explanations: Record<id, KpiExplanation>,
  },
  metrics: ExplainedKpiMetric[],   // event-based: week_questions, week_accuracy,
                                   // current_streak (+ recency_accuracy when paid)
  gating: { historicalTrends: { allowed, requiredPlan: "paid", reason } },
  measurementModel: { official: [], weighted: [], diagnostic: [<metric ids>] },
}
```

- **Dropped** (no event-based source): `week.practiceSessions`, `week.practiceMinutes`,
  `recency.avgSecondsPerQuestion`, and the `week_sessions`/`week_minutes`/`recency_pace`
  metrics. Accuracy in genesis is a 0–1 fraction → presented as an integer percent.
- **Honest signal:** `accuracy` is `null` (not `0`) when the window has zero events, so
  the UI shows "no data," never a false 0%.

## 3. `GET /api/progress/projection` — response contract (breakdown removed)

```
estimate (when computed): {
  composite, math, rw,
  range: { low, high },
  confidence,                    // clamp(relevant_question_count_total / 120, 0, 1)
  // NO `breakdown` field
}
```

- `totalQuestionsAttempted` = `student_overall_kpi.events_total` (0 when no row).
- The honest-signal discriminated union is preserved: `status:"uncomputed"` (estimate
  `null`) unless **both** section projections (M and RW) have a real `projected_score_mid`.
- `student_domain_mastery` is **no longer read** by this endpoint (it was only the
  breakdown's source).

## 4. Proof obligations

1. **200 against genesis:** the exact `.select()` column lists in §1 execute with no
   "column does not exist" error on the live genesis schema (equivalent SQL run green).
2. **No old-gen refs:** grep of `server/services/canonical-runtime-views.ts` (and the
   progress route) shows none of `source_family`, `questions_total`, `total_questions`,
   `correct_questions`, `incorrect_questions`, `accuracy_pct`, `avg_latency_ms`,
   `mastery_pct` on these read paths.
3. **No mastery-score leak:** `/api/progress/projection` response carries no
   `breakdown`/`mastery_pct`/`mastery_score`/`mastery_level` (§10.5).
4. **Build + tests green;** client consumers compile against the new shapes.
