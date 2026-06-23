# Contract — MA-06 mastery status from canonical level (C1)

> Pure-code (no migration). Closes GAP-MA-06's residual app-code literals on the mastery
> **status** surface. Grounds: Doc 05B (level boundaries live in `mastery_constants`;
> `mastery_level` 0–4 is the canonical, student+guardian-readable signal, §6.5); Doc 07C
> (the weak/improving/proficient **status** vocabulary). Owner rulings 2026-06-23: (1) drop
> the score fallback — derive status only from canonical `mastery_level`; (2) for the domain
> rollup, use the **same level→status logic driven by the domain's own canonical rollup
> level** (`student_domain_mastery.mastery_level`), same constants/boundaries.

## 0. The defect (residual MA-06)

Two status mappers bucket a 0–100 `mastery_score` with **app-invented literals** `40`/`70`
as a fallback when `mastery_level` is absent:

- `apps/api/src/services/mastery-read.ts:91` `mapMasteryStatusFromLevel(level, attempts, score?)`
- `apps/api/src/routes/mastery.ts:109` `mapWeakestStatus(level, attempts, score)`
- the dead `MASTERY_STATUS_THRESHOLDS {WEAK:40, IMPROVING:70}` in `mastery-constants.ts:150`.

`70` diverges from the canonical level grouping (level-3 floor `0.60`), so the fallback can
label a row differently from its DB-computed `mastery_level`. The level boundaries
`0.19/0.39/0.59/0.79` are **already DB-only** (not in app TS) and are unaffected here.

## 1. Canonical status rule (single definition)

Status derives ONLY from the canonical `mastery_level` (DB-computed from the
`mastery_constants` level boundaries). `mastery_score` is **not** consulted for status:

```
attempts < 0.01            → "not_started"
mastery_level ∈ {3,4}      → "proficient"
mastery_level == 2         → "improving"
mastery_level ∈ {0,1}      → "weak"
mastery_level absent/other → "not_started"   (honest: no canonical level yet)
```

- **Skill** status: from `student_skill_mastery.mastery_level` (existing fetch).
- **Domain** status: from `student_domain_mastery.mastery_level` — the domain rollup's own
  canonical level, fetched alongside the skill rows and threaded into
  `buildMasterySkillTreeFromRows`. (Previously synthesized from an averaged skill score +
  the `40`/`70` fallback — removed.)
- `mapMasteryStatusFromLevel` / `mapWeakestStatus` lose the `masteryScore` parameter.

## 2. Dead-constant removal (`apps/api/src/services/mastery-constants.ts`)

Delete the superseded Doc-02C formula remnants (no importers; verified by grep):
`ALPHA, BASE_DELTA, M_INIT, M_MIN, M_MAX, HALF_LIFE_WEEKS, DIAGNOSTIC_TOTAL_QUESTIONS,
DIAGNOSTIC_LOOKBACK_DAYS, DIAGNOSTIC_BLUEPRINT_VERSION, MASTERY_STATUS_THRESHOLDS,
DEFAULT_QUESTION_WEIGHT`. **Keep** the event taxonomy (`MasteryEventType`, `EVENT_WEIGHTS`,
`REVIEW_OUTCOME_EVENTS`, `TUTOR_EFFECT_EVENTS`, `KPI_CALENDAR_COUNTED_EVENTS`) — it is the
event vocabulary (`MasteryEventType` + `KPI_CALENDAR_COUNTED_EVENTS` are imported).

## 3. Proof obligations

1. **grep-clean:** no `< 40` / `< 70` / `MASTERY_STATUS_THRESHOLDS` on the status path.
2. **canonical-only:** status resolves from `mastery_level` (DB-derived from `mastery_constants`
   boundaries); domain status reads `student_domain_mastery.mastery_level`. C-9 boundaries
   (0.19/0.39/0.59/0.79) remain DB-only and unchanged.
3. **No regression:** domain badge reflects the domain's canonical level (not always
   `not_started`).
4. **Build + tests green;** status-mapping unit tests cover level→status + not_started-when-absent.
