# MA-07 — Mastery Read/Serve Layer: Tier-Only Rebuild + 05C Section Projection Surface — Correctness Contract

**Workstream:** WS-3 mastery read-surface. Rebuilds the student/guardian **read/serve** layer to the locked Doc 05 model. The mastery **producer** side (05A skill, 05B domain, 05C projection, KPI) is already built (`20260610010000`, `20260613010000`, `20260613020000`); MA-07 builds the **read surface only** — it never re-computes mastery.
**Owner work-label:** `MA-07` (this session, CTO rulings 2026-06-23). **Registry:** distinct from the RE-DISPOSED `GAP-MA-07` (mastery_outbox); recorded as a new Zone-MA row (see §9). Closest prior: `GAP-MA-05` (write-side domain-rollup; this is its read-side analogue).
**Spec (LOCKED, source of truth):** Doc 05 Parent §4.7 (independent computation), §6.6 (NULL-evidence), §12.1/§12.2 (projection framing / no-AI-confidence), Acceptance Criteria **#19** (guardian no per-skill) + **#20** (no `mastery_score`/`mastery_pct` to student/guardian); Doc 05A §2.4/§7.2/§7.4 + **INV-05A-12**; Doc 05B §5.2/§5.4 + **INV-05B-13**; Doc 05C §6.5/§6.6 (range + 200 floor), §7.1/§7.3/§7.4/§7.5 (schema/visibility/RLS/grants), §10 (single-route + RLS read contract), **INV-05C-13/14/15/P3**.
**Owner rulings driving this cycle:**
1. **Tier-only.** Student/guardian mastery surfaces show ONLY the canonical 0–4 `mastery_level` rendered as a **tier name + bar**. Never `mastery_score`, never `mastery_pct`, never a percentage. `mastery_score`/`mastery_pct` are admin-only and do NOT unlock behind auth+entitlement — the tier IS the paid view. (AC#20, §12.2, INV-05A-12.)
2. **Carve-out RETIRED.** The earlier §2.4 `mastery_score`-to-student carve-out is reversed; the spec is already correct; **no WS-S spec edit is owed.**
3. **Repo has no authority.** The current read layer is wrong-generation logic (leaks `mastery_score`/percent; read-time skill→domain rollup; queries retired columns). Rebuild to spec; do not preserve repo behavior that contradicts the canonical rule.
4. **Wire 05C now.** Section level renders the Doc 05C SAT projection band (200–800), which §7.3/§7.5 make explicitly student- AND guardian-readable.

---

## 0. The canonical model this builds to (grounded, not from repo)

| Grain | Source table | Independently event-computed? | Client-readable columns (student & guardian) | Client display |
| --- | --- | --- | --- | --- |
| **Skill** | `student_skill_mastery` | Yes — `compute_mastery_for_entity(p_entity_type='skill')` | `student_id, section, domain, skill, mastery_level, computed_at` (Doc 05A §7.4 grant) | tier name + bar from `mastery_level` |
| **Domain** | `student_domain_mastery` | Yes — `compute_mastery_for_entity(p_entity_type='domain')`, **NOT a skill roll-up** (Parent §4.7, INV-05B-13) | `student_id, section, domain, mastery_level, computed_at` (Doc 05B §5.4 grant) | tier name + bar from `mastery_level` |
| **Section** | `student_section_projections` | n/a — derived (05C); **no section `mastery_level` exists** (Parent §4.7 L261: section = 05C SAT projection, out of scope for the mastery formula) | `student_id, section, projected_score_mid, projected_score_low, projected_score_high, range_width, relevant_question_count, computed_at` (Doc 05C §7.5 grant) | projection **band**: "≈ {mid} ({low}–{high}), based on {N} questions" — never "you will score X" (§12.1) |

**Status/tier vocabulary** (UI grouping of canonical levels; keep `mapMasteryStatusFromLevel`): `mastery_level` 0–1 → **weak**, 2 → **improving**, 3–4 → **proficient**, `NULL` (no/insufficient evidence, Parent §6.6) → **not_started**. The band is `NULL` until the **8-domain evidence gate** (INV-05C-14) passes → render "not enough evidence yet."

**Hard facts that overturn the repo:**
- Canonical `student_skill_mastery` **has no `attempts` / `correct` / `accuracy` columns** — those are retired old-gen columns. Querying them is why the current `/mastery/skills` surface returns `[]`. They are dropped, not re-mapped (owner: "those don't exist canonically").
- `mastery_score`/`mastery_pct`/`acc_*`/`event_count_total` are **not in the `authenticated` grant** for either table — Postgres rejects the column reference at the role-grant layer (Doc 05A §2.4 defence-in-depth). The TS read layer must also never select them on a client path.

---

## A — Shared schema (packages/shared, Zod-first; single source of truth)

- **A1** `masteryTierSchema` = `z.enum(["not_started","weak","improving","proficient"])`; `masteryLevelSchema` = `z.number().int().min(0).max(4).nullable()`. Types inferred, not hand-declared.
- **A2** `skillMasteryNodeSchema` = `{ skill, label, masteryLevel, tier, computedAt }`. **No** `mastery_score`, `accuracy`, `attempts`, `correct`.
- **A3** `domainMasteryNodeSchema` = `{ domain, label, masteryLevel, tier, computedAt, skills: skillMasteryNodeSchema[] }`. **No** `avgMastery`.
- **A4** `sectionNodeSchema` = `{ section, label, domains: domainMasteryNodeSchema[] }` — **no `avgMastery` / tier on the section** (it carries a band, not a level). The projection band is **NOT re-modeled here** (see A5).
- **A5 — CONSUME, DO NOT FORK (discovery 2026-06-23).** The 05C section-projection read surface already exists and is canonical: `server/services/canonical-runtime-views.ts::buildScoreEstimateFromCanonical` (served at `/api/progress/projection`, rewired to Doc-05 in `0cfe650`; client type `EstimateResponse`/`ScoreEstimate` in `client/src/lib/projectionApi.ts`). It reads ONLY the §7.5-granted columns, returns `uncomputed` unless BOTH section mids are present (honest-signal = INV-05C-14 + Parent §6.6), omits per-domain/`mastery_pct` (§10.5), and composes the total (§10.3). `confidence = relevant_question_count/120` is an **evidence ratio** (§12.1 evidence-confidence, derived from a granted column) — not a prediction/AI-confidence, so §12.2 is satisfied. **MA-07 consumes this surface; it does NOT add a `/projection/sections` route** (CLAUDE.md single-source rule). No new projection Zod schema.
- Proof: `STRUCT` (schema shape) + type-check (no duplicate hand types — §7.2 standards).

## B — Read services (apps/api/src/services)

- **B1** `mastery-read.ts` rebuilt: `fetchSkillMasteryRows` selects ONLY `section, domain, skill, mastery_level, computed_at` from `student_skill_mastery`. `fetchDomainMasteryRows` selects ONLY `section, domain, mastery_level, computed_at` from `student_domain_mastery` (keeps/realises C1's correct domain read). **Delete** `mastery_score`/`accuracy`/`attempts`/`correct` from every interface and select on the client path. **Delete** `buildMasterySkillTreeFromRows`'s `avgMastery`/`domainTotalMastery`/`sectionTotalMastery` rollup math entirely (the read-time skill→domain→section averaging is the forbidden model).
- **B2 — no new projection service (consume existing).** The section band is served by the already-canonical `buildScoreEstimateFromCanonical` (§A5). MA-07 adds NO projection read service. (Its granted-columns-only select + honest-uncomputed behavior is already covered by `tests/ci/score-estimate-honest-uncomputed.test.ts`; the anti-leak gate in §E adds a regression assertion over it.)
- **B3** Tree assembly = pure function `buildMasteryTree(skillRows, domainRows, sectionProjections, taxonomy)` → `SectionNode[]`: domain `tier` from domain `mastery_level`; skill `tier` from skill `mastery_level`; section `projection` from 05C rows; `not_started` when level NULL (Parent §6.6 — no synthesized evidence). Deterministic, no IO.
- Proof: `STRUCT` + `PARITY` (domain tier ≠ average of skill tiers — INV-05B-13 read-side analogue).

## C — Route handlers (thin: auth → entitlement → parse → domain → serialize)

- **C1** `/api/me/mastery/skills`, `/summary`, `/weakest` rebuilt tier-only. Response carries `masteryLevel`+`tier`+identity+`computedAt` only. No score/percent/accuracy/attempts. `/weakest` orders by `mastery_level` asc (nulls last), not by a leaked accuracy.
- **C2 — consume existing projection route, add none.** The student mastery page consumes the existing `/api/progress/projection` (`buildScoreEstimateFromCanonical`) for the section band, mapping `estimate.math → Math header`, `estimate.rw → RW header`, and rendering "not enough evidence yet" on `uncomputed`. No new route is added (Doc 05C §10's single-route + RLS contract is already satisfied by the existing surface). Guardian projection visibility rides the same RLS-gated table read.
- **C3** **Guardian mastery surfaces conform to AC#19/#20:** guardians get **domain-grain tier** + **section projection band** only. The existing per-skill `/guardian/weaknesses/:studentId` (returns per-skill rows + `accuracyPercent`) is a **spec violation** (AC#19: no per-skill to guardian; + percent + retired columns) → rebuilt to domain-grain tier (or the per-skill path removed from the guardian surface). Entitlement gate stays (active link AND active student entitlement; INV-05C-P3 / guardian-trust model).
- Proof: `CONTRACT` tests (payload shape) + `DENIAL` tests (guardian unlink/entitlement-loss → no rows; unrelated caller → 404).

## D — Client (client/src/pages/mastery.tsx) via TanStack Query

- **D1** Remove **every** `%` render (`{avgMastery}%`, `{skill.mastery_score}% mastery`, percent-width progress bars driven by score). Skill & domain render **tier name + bar** derived from the 0–4 level (bar = `level/4`, visual only, no numeric). Section renders the **projection band** ("≈ {mid} ({low}–{high}), based on {N} questions") or "not enough evidence yet" when null. Never "predicted"/"you will score" (§12.1).
- **D2** DTOs imported from `packages/shared` (no client-local shadow types). No `useEffect` for derived tier (derive inline, §11.4). Query layer only (§11.2).
- Proof: client contract test asserts tier label + absence of any `mastery_score`/percent in rendered mastery output.

## E — Anti-leak CI gate (committed hard gate — same class as the question anti-leak probe)

- **E1** `tests/ci/mastery.anti-leak.ci.test.ts`: for every student AND guardian mastery/projection read surface, assert the serialized payload contains **no** `mastery_score`, `mastery_pct`, `accuracy`, `acc_test/practice/review`, `event_count_total`, and no projection blend-anchor (`mastery_term`, `fl1_score`, `fl2_score`, `fl_count_used`, `blend_denominator`, `*_hash`, `mastery_model_version`, `refreshed_at_t_now`); assert presence of `tier`/`masteryLevel` (mastery) and the granted projection columns (projection). Mirrors `tests/ci/questions.anti-leak.ci.test.ts`.
- **E2** `GUARD` (grep): no client-path serializer/select references `mastery_score`/`mastery_pct`/`percent` on a `student_*`/projection read. Proven by a planted violation.
- Wired into the `pnpm` CI test set (no `npm`).

## F — Tests updated (not deleted to pass)

- Update `tests/ci/mastery.read.contract.test.ts`, `weakness.runtime.contract.test.ts`, planner/guardian contract fixtures: drop `mastery_score` assertions, assert `masteryLevel`+`tier`. Keep formula-level tests (`mastery.*.test.ts`) untouched — they test the producer, not the surface. Add `section-projection.read.contract.test.ts` (gate-not-passed → null band → "not enough evidence yet"; INV-05C-15 ordering; total composition §10.3; 404-not-403).

---

## G — Out of scope (carried, named — do not build here)
- 05C blend **States B/C** (04B full-length blend) — deferred WS-4 (producer is State-A only; the read surface shows whatever the producer wrote).
- Cluster mastery (`GAP-SP-24` owner-decision; no 05-family spec home).
- 05C 24h projection time-sweep + outbox consumer (05D / WS-4).
- Any change to the mastery **producer** (formula, refreshers, RPCs, migrations) — MA-07 is read-only over canonical tables.

## H — Invariants this cycle must not break
Anti-leak: no `mastery_score`/`mastery_pct`/percent on any student/guardian surface (AC#20, INV-05A-12). Guardian: no per-skill rows (AC#19), domain+projection only, view-only, entitlement-gated (INV-05C-P3). Determinism: read is a pure projection of canonical rows; no synthesized evidence (Parent §6.6). Projection framing: bounded current-state estimate, never a prediction (§12.1/§12.2). Single source of truth: Zod schemas in `packages/shared`; no shadow types; no ad-hoc SQL outside centralized read utilities.

## I — HALT resolutions recorded (step-1 audit)
1. **Domain independent-computation — CONFIRMED by spec** (Parent §4.7 L242–261; Doc 05A L1838; INV-05B-13). Repo's read-time skill→domain average is the wrong model and is deleted.
2. **Section tier does not exist canonically** (Parent §4.7 L261). Owner ruled **wire 05C now**; spec **backs** student+guardian readability of the projection band (Doc 05C §7.3/§7.5; Parent §12.1 forbids only *prediction* framing, not the bounded estimate). No spec wall; no HALT carried.
3. **Consume-don't-fork (discovery):** the 05C read surface already exists (`buildScoreEstimateFromCanonical` @ `/api/progress/projection`) and is anti-leak-clean. "Wire 05C now" = the mastery page consumes it, NOT a new route. Scope leaned: server adds **no** projection route/service; section work is client-side consumption + the anti-leak regression assertion.

## §9 — Registry note
Owner work-label `MA-07`. Registry `GAP-MA-07` is the RE-DISPOSED mastery_outbox (by-design-absent) — unrelated. This read-surface gap is recorded as a new Zone-MA row (next free `GAP-MA-12`) cross-referencing this contract and `GAP-MA-05` (its write-side analogue).
