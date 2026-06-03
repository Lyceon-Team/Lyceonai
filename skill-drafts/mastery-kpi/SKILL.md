---
name: mastery-kpi
description: Mastery computation, KPI rollups, score projections, and read-surface rules. Use whenever code computes or reads mastery, aggregates KPIs, projects a score, or builds a student/guardian progress surface. Covers observed-events-only, the locked formula, MIN_EVENTS gating, and the mastery_level-only read rule.
---

# Mastery & KPI (Coding Standards §10 · canonical: docs/Spec Doc 05 family)

Mastery is **earned from observed events only** — never inferred, estimated, predicted, or assigned an "AI confidence." Doc 05 is the canonical owner of every formula, constant, and threshold below. **Name the rule, cite the section, read the value from the canonical source — never restate a numeric value here** (restated numbers drift from the spec; that is decision 5).

## Hard rules (cite the owning section; do not restate values)

- Only **verified retry counts and scored events** affect mastery. Tutor interaction alone does not.
- **No** "predicted score," "confidence," or vanity metrics — anywhere, ever (§17 hard stop).
- Mastery updates follow the locked event taxonomy and stabilization rules (Doc 05). Do not invent new event kinds.
- A minimum event count gates mastery (the `MIN_EVENTS_FOR_MASTERY` constant in Doc 05 Parent). Below it, or cold → mastery is `NULL`, not zero, not a guess. Read the value from the canonical constant, never hardcode it.
- Skill mastery and domain mastery are computed **independently from events** (NOT a rollup of one from the other) — Doc 05 Parent / 05B INV-05B-13.
- Read surfaces for students and guardians are locked to the mastery **level** only (not the raw underlying score) — Doc 05 Parent.
- Weighting is **position-based only, no calendar/time decay** — the position half-life weight is defined in Doc 05 Parent (cite the section; do not transcribe the formula). Don't add recency decay.
- **No constants-change recompute** (INV-05D-13): a constants change affects future computes only; existing rows keep their vintage. Don't build a recompute-on-constants-change trigger.

## Recompute discipline (Doc 05A/05D)

The only recompute is `backfill_recompute_student`, for never-computed/incomplete-derived students only. It calls the locked `recompute_skill_mastery` RPC — never the pure inner compute function and never the event-time path. Don't wire a new recompute entrypoint.

## Self-check before done

- [ ] Mastery changes only from verified scored/retry events.
- [ ] No predicted/confidence/vanity metric introduced.
- [ ] `< MIN_EVENTS` or cold → NULL, surfaced as such (value read from canonical constant).
- [ ] Read surface exposes `mastery_level` only.
- [ ] No time-decay, no constants-change recompute added.

## Proving mechanism

Test: tutor-only interaction yields no mastery change; an entity just below `MIN_EVENTS_FOR_MASTERY` reads NULL and one more event flips it to a level; read surface returns only the mastery level. (§14.)
