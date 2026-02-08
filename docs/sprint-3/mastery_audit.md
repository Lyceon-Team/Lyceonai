# Sprint 3 Mastery Audit

## 1) Provenance [P01]
```
$ pwd
/workspace/Lyceonai

$ git rev-parse --show-toplevel
/workspace/Lyceonai

$ git rev-parse --abbrev-ref HEAD
sprint-2

$ git rev-parse HEAD
cb9f45deabdc0387feca09f70378ee3eb4b1bd23

$ git status --porcelain
?? docs/sprint-3/

$ git log -1 --oneline
cb9f45d Merge pull request #61 from Lyceon-Team/copilot/standardize-on-pnpm-only

$ node -v
v22.21.1

$ pnpm -v
10.13.1
```

## 2) Current Mastery Surface Area (routes/pages/tables) [P03][P04][P06][P07][P10]
- Client route `/mastery` renders the mastery UI page in the app shell. [P07][P10]
- Client mastery page queries `/api/me/mastery/skills` via React Query. [P07][P10]
- Server mounts the mastery router at `/api/me/mastery` behind student/admin auth. [P04][P10]
- Mastery router exposes read endpoints for summary, skills, and weakest skills. [P04][P10]
- Progress score projection reads `student_skill_mastery` for mastery-based scoring. [P03][P10]
- Database schema includes `student_skill_mastery` and RPCs like `upsert_skill_mastery` to roll up mastery. [P06][P10]

## 3) Read Paths (every mastery read endpoint and handler) [P04][P10]
- `GET /api/me/mastery/summary` calls `getMasterySummary`, which reads `student_skill_mastery`. [P04][P10]
- `GET /api/me/mastery/skills` reads `student_skill_mastery` directly from Supabase. [P04][P10]
- `GET /api/me/mastery/weakest` calls `getWeakestSkills`, which reads `student_skill_mastery`. [P04][P10]
- `GET /api/progress/projection` reads `student_skill_mastery` to compute projections. [P10]
- Client reads mastery data from `/api/me/mastery/skills`. [P07][P10]

## 4) Write Paths (every place mastery/progress is written) [P05][P10]
- Practice submission flow calls `logAttemptAndUpdateMastery`, which inserts `student_question_attempts` and triggers rollup RPCs for mastery (`upsert_skill_mastery`, `upsert_cluster_mastery`). [P10]
- No other mastery/progress write paths are provable beyond the insert + RPC rollups above. UNKNOWN if additional mastery writes exist outside `logAttemptAndUpdateMastery`. [P05][P10]

## 5) DB Objects (tables/views/functions/rpcs; only what is provable) [P06][P10]
- Table: `public.student_skill_mastery`. [P06][P10]
- Function/RPC: `public.upsert_skill_mastery` (used for mastery rollups). [P06][P10]

## 6) Algorithm (ONLY what is provable; else UNKNOWN) [P10]
- The `upsert_skill_mastery` RPC updates `mastery_score` as correct/attempts (ratio of correct to total attempts). [P10]
- Other mastery scoring, weighting, decay, or adaptive logic is UNKNOWN from the inspected proofs. [P10]

## 7) Gaps (explicit unknowns + next commands/files to inspect)
- UNKNOWN whether any other mastery write paths exist beyond `logAttemptAndUpdateMastery`/RPCs; inspect for additional `student_skill_mastery` writes or RPC calls in server/app code. Suggested next step: `rg -n "student_skill_mastery|upsert_skill_mastery|upsert_cluster_mastery" apps/api server`. [P05][P10]
- UNKNOWN whether mastery calculations incorporate decay or other weighting beyond the SQL ratio update; inspect score/algorithm services for mastery-specific logic. Suggested next step: inspect `server/services/score-projection.ts` and any mastery-related service files found by `rg -n "mastery_score"`. [P03][P10]
- UNKNOWN whether other DB objects (views, additional functions) contribute to mastery; inspect remaining SQL migrations for mastery/progress-related objects. Suggested next step: `rg -n "mastery|progress|attempt" -g "*.sql" supabase/migrations`. [P06]

## 8) Sprint 3 Deterministic Next Steps (5–10 tasks, each tied to a Gap and a Proof ID)
1) Enumerate all usages of `student_skill_mastery` and mastery RPCs in application code to confirm the full write surface area. [P05][P10]
2) Review `server/services/score-projection.ts` and any related mastery scoring services to determine whether decay or weighting affects mastery interpretation. [P03][P10]
3) Scan SQL migrations for any additional mastery/progress tables or functions beyond `student_skill_mastery` and `upsert_skill_mastery`. [P06]
4) Trace the `/api/me/mastery/summary` handler through `getMasterySummary` to verify all read paths and confirm no hidden joins or views. [P04][P10]
5) Trace the `/api/me/mastery/weakest` handler through `getWeakestSkills` to confirm read path inputs (limits/minAttempts) and any filtering constraints. [P04][P10]
6) Validate the client’s `/api/me/mastery/skills` query response shape against the mastery router output to confirm UI expectations. [P07][P10]
