# FINDING: practice question selection is unseeded `ORDER BY random()`, even when mastery data exists

**Status: OPEN, unrouted. For a practice-vertical investigation. No code changed.**
Found 2026-10-26 during Smart landing Step 0. Karl's ruling the same day: out of scope for that
work ("Write it up as a separate one-paragraph finding ... Don't change it here").

Every practice session is filled at creation by `select_practice_pool_random`, which ends
`ORDER BY random()` (`supabase/migrations/20260724000000_content_pipeline_columns.sql:101`, the
function's only and last definition), called once per draw from `startOrReplaySession`
(`server/routes/practice-canonical.ts:1921`). The route's own comment states the model:
"filter-driven native random selection ... Determinism satisfied by storage"
(`server/routes/practice-canonical.ts:1770-1771`), and each item's options are shuffled the same
unseeded way (`server/routes/practice-canonical.ts:1207`). Nothing in selection reads the
student's mastery: a student with months of answers gets the same uniform random draw as a new
one. This conflicts with the locked Coding Standards §4.1 ("No Randomness Once Mastery Exists:
Selection must be stable and explainable. Randomness is only permitted for cold-start, and must
be deterministic-per-session if used") and the CLAUDE.md invariant "no randomness in question
selection once mastery data exists". Storing the drawn rows makes a session resumable, but it
does not make selection deterministic or explainable: the same student, filters and mastery state
produce a different set on every start. The smart landing's easy/medium lead (2026-10-26) uses the
same RPC for each of its draws, so it inherits this and neither fixes nor worsens it.
