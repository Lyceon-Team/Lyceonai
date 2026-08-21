> **SUPERSEDED (2026-08-21) — read this first.**
> MA-07's *invariants* still hold (no score, no percent, no accuracy, no attempts on any
> student or guardian surface; domain grain for guardians). Its *vocabulary and routes* do
> not. The four-tier `weak`/`improving`/`proficient`/`not_started` grouping was replaced by
> the six owner-ruled level names (2026-08-20 RULE 1), and the per-skill mastery route and
> the domain summary route were both retired in favour of the domain-then-skill drill-down.
> `scripts/ci/retired-endpoints-gate.mjs` holds the retired paths and names what replaced
> each — this document deliberately does not repeat them, because a document that spells a
> retired path is indistinguishable from a caller to a text search. Where this document and
> the rulings disagree, the rulings win. Kept for the reasoning, not as an implementation
> target.

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
| **Section** | — (none) | n/a — **no section `mastery_level` exists** (Parent §4.7 L261: section = 05C SAT projection, out of scope for the mastery formula) | none on this page | **container only** — no tier, no band. The 05C projection (a 200–800 *score*, not a 0–4 tier) stays on its own existing surface (`/api/progress/projection` → dashboard `ScoreProjectionCard`); MA-07 does not mix it into the tier page. (Owner ruling 2026-06-23.) |

**Status/tier vocabulary** (UI grouping of canonical levels; keep `mapMasteryStatusFromLevel`): `mastery_level` 0–1 → **weak**, 2 → **improving**, 3–4 → **proficient**, `NULL` (no/insufficient evidence, Parent §6.6) → **not_started**. The band is `NULL` until the **8-domain evidence gate** (INV-05C-14) passes → render "not enough evidence yet."

**Hard facts that overturn the repo:**
- Canonical `student_skill_mastery` **has no `attempts` / `correct` / `accuracy` columns** — those are retired old-gen columns. Querying them is why the then-current per-skill mastery surface returned `[]`. They are dropped, not re-mapped (owner: "those don't exist canonically").
- `mastery_score`/`mastery_pct`/`acc_*`/`event_count_total` are **not in the `authenticated` grant** for either table — Postgres rejects the column reference at the role-grant layer (Doc 05A §2.4 defence-in-depth). The TS read layer must also never select them on a client path.

---

## A — Shared schema (packages/shared, Zod-first; single source of truth)

- **A1** `masteryTierSchema` = `z.enum(["not_started","weak","improving","proficient"])`; `masteryLevelSchema` = `z.number().int().min(0).max(4).nullable()`. Types inferred, not hand-declared.
- **A2** `skillMasteryNodeSchema` = `{ skill, label, masteryLevel, tier, computedAt }`. **No** `mastery_score`, `accuracy`, `attempts`, `correct`.
- **A3** `domainMasteryNodeSchema` = `{ domain, label, masteryLevel, tier, computedAt, skills: skillMasteryNodeSchema[] }`. **No** `avgMastery`.
- **A4** `sectionNodeSchema` = `{ section, label, domains: domainMasteryNodeSchema[] }` — **no `avgMastery`, no tier, no projection band on the section** (owner ruling: container only). It is a pure grouping container for its domains.
- **A5 — section projection is OUT OF MA-07 SCOPE (owner ruling 2026-06-23).** Mixing a 200–800 *score* band into a page of 0–4 *tier* rows conflates two scales. The 05C projection already has its own canonical, anti-leak-clean surface — `server/services/canonical-runtime-views.ts::buildScoreEstimateFromCanonical` @ `/api/progress/projection` (client `EstimateResponse`/`ScoreEstimate`), rendered on the dashboard `ScoreProjectionCard` — which MA-07 **leaves untouched**. No projection rendering is added to the mastery page; no new projection route or Zod schema. (Verified clean: granted columns only; honest-`uncomputed` per INV-05C-14/§6.6; `confidence` = `relevant_question_count/120` evidence ratio per §12.1, not AI-confidence.)
- Proof: `STRUCT` (schema shape) + type-check (no duplicate hand types — §7.2 standards).

## B — Read services (apps/api/src/services)

- **B1** `mastery-read.ts` rebuilt: `fetchSkillMasteryRows` selects ONLY `section, domain, skill, mastery_level, computed_at` from `student_skill_mastery`. `fetchDomainMasteryRows` selects ONLY `section, domain, mastery_level, computed_at` from `student_domain_mastery` (keeps/realises C1's correct domain read). **Delete** `mastery_score`/`accuracy`/`attempts`/`correct` from every interface and select on the client path. **Delete** `buildMasterySkillTreeFromRows`'s `avgMastery`/`domainTotalMastery`/`sectionTotalMastery` rollup math entirely (the read-time skill→domain→section averaging is the forbidden model).
- **B2 — no new projection service (consume existing).** The section band is served by the already-canonical `buildScoreEstimateFromCanonical` (§A5). MA-07 adds NO projection read service. (Its granted-columns-only select + honest-uncomputed behavior is already covered by `tests/ci/score-estimate-honest-uncomputed.test.ts`; the anti-leak gate in §E adds a regression assertion over it.)
- **B3** Tree assembly = pure function `buildMasteryTree(skillRows, domainRows, sectionProjections, taxonomy)` → `SectionNode[]`: domain `tier` from domain `mastery_level`; skill `tier` from skill `mastery_level`; section `projection` from 05C rows; `not_started` when level NULL (Parent §6.6 — no synthesized evidence). Deterministic, no IO.
- Proof: `STRUCT` + `PARITY` (domain tier ≠ average of skill tiers — INV-05B-13 read-side analogue).

## C — Route handlers (thin: auth → entitlement → parse → domain → serialize)

- **C1** the per-skill mastery route, the domain summary route and `/weakest` rebuilt tier-only. (SUPERSEDED: the first two are retired; see the banner.) Response carries `masteryLevel`+`tier`+identity+`computedAt` only. No score/percent/accuracy/attempts. `/weakest` orders by `mastery_level` asc (nulls last), not by a leaked accuracy.
- **C2 — no projection on the mastery page (container only).** MA-07 adds no projection route and renders no band on the mastery page; `SectionNode` is a pure container. The existing `/api/progress/projection` surface (dashboard `ScoreProjectionCard`) is unchanged and out of MA-07 scope.
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

## J — Entanglement map (implementation guardrails, discovered 2026-06-23)

The repo's `mastery-read.ts` is consumed beyond the client read surface; the rebuild must not break these. **The anti-leak boundary is route serialization, not the service fetch** — services use service-role and legitimately read admin columns for internal logic.

- **`fetchWeakestSkills` is dual-use:** the client `/mastery/weakest` route (must serialize tier-only) AND `apps/api/src/services/adaptiveSelector.ts` (practice-engine selection — legitimately uses `mastery_score` server-side for deterministic ordering; NEVER sent to a client). **Do NOT strip `mastery_score`/`accuracy` from the service fetch** — fix the leak at the `/weakest` route's response `.map()`. Stripping the fetch would break deterministic selection (a core invariant).
- **`buildMasterySkillTreeFromRows`** is consumed only by `mastery.ts` `/skills` (+ the contract-test mock) → safe to rebuild tier-only.
- **`buildMasterySummaryFromRows` / `/mastery/summary`** is built on the non-existent `attempts`/`correct`/`accuracy` columns (already broken) and is re-exported via `studentMastery.getMasterySummary`; the current client calls only `/skills`. Re-derive `/summary` as section→domain tiers (or retire) in the same pass; verify no non-test caller depends on the old shape before changing it.
- **`calendar-planner-reprioritization.ts`** declares its OWN local `SkillMasteryRow` and reads `mastery_score` via service-role for planner weighting — internal, not a client surface; out of scope, leave intact.
- **`mapMasteryStatusFromLevel`** (consumed by `server/routes/guardian-routes.ts:898`) is superseded by the shared `masteryTierFromLevel`; update the guardian surface to domain-grain (AC#19) and migrate the mapper together.

Net: route-serialization-bounded; service-role internals (selection, planner) keep their reads. A careful pass with practice-engine regression checks, not a blind column strip.

## G — Out of scope (carried, named — do not build here)
- 05C blend **States B/C** (04B full-length blend) — deferred WS-4 (producer is State-A only; the read surface shows whatever the producer wrote).
- Cluster mastery (`GAP-SP-24` owner-decision; no 05-family spec home).
- 05C 24h projection time-sweep + outbox consumer (05D / WS-4).
- Any change to the mastery **producer** (formula, refreshers, RPCs, migrations) — MA-07 is read-only over canonical tables.

## H — Invariants this cycle must not break
Anti-leak: no `mastery_score`/`mastery_pct`/percent on any student/guardian surface (AC#20, INV-05A-12). Guardian: no per-skill rows (AC#19), domain+projection only, view-only, entitlement-gated (INV-05C-P3). Determinism: read is a pure projection of canonical rows; no synthesized evidence (Parent §6.6). Projection framing: bounded current-state estimate, never a prediction (§12.1/§12.2). Single source of truth: Zod schemas in `packages/shared`; no shadow types; no ad-hoc SQL outside centralized read utilities.

## I — HALT resolutions recorded (step-1 audit)
1. **Domain independent-computation — CONFIRMED by spec** (Parent §4.7 L242–261; Doc 05A L1838; INV-05B-13). Repo's read-time skill→domain average is the wrong model and is deleted.
2. **Section tier does not exist canonically** (Parent §4.7 L261). **Final owner ruling (2026-06-23): section is a container only** on the mastery page. After I surfaced that the 05C projection is a 200–800 *score* (not a 0–4 tier) and is already student-readable + already served, the cleaner call is to keep the tier page pure and leave the projection on its own surface. (Supersedes the earlier "wire 05C now" steer — same spec basis, no scale-mixing.)
3. **05C surface exists and is clean, and stays put.** `buildScoreEstimateFromCanonical` @ `/api/progress/projection` reads granted columns only, is honest-`uncomputed`, and frames evidence (not prediction). Per the container-only ruling it is **untouched** by MA-07 (dashboard keeps it). Section work drops out entirely; MA-07 server scope = the skill/domain tier rebuild + guardian AC#19 conformance + the anti-leak CI gate.

## §9 — Registry note
Owner work-label `MA-07`. Registry `GAP-MA-07` is the RE-DISPOSED mastery_outbox (by-design-absent) — unrelated. This read-surface gap is recorded as a new Zone-MA row (next free `GAP-MA-12`) cross-referencing this contract and `GAP-MA-05` (its write-side analogue).
