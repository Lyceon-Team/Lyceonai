# Mastery Audit Summary (Sprint 3)

## Provenance
- Repo root: Not stated in the provided log.【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L1-L4】
- Branch: Not stated in the provided log.【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L1-L4】
- Commit: Not stated in the provided log.【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L1-L4】
- Node version: Not stated in the provided log.【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L1-L4】
- pnpm version: Not stated in the provided log.【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L1-L4】

## Mastery Terms Found

| term | file path | line numbers | snippet (<= 1 line) | category |
| --- | --- | --- | --- | --- |
| /mastery | client/src/App.tsx | 95 | Route defined with RequireRole allow=['student', 'admin'].【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L63-L67】 | route |
| MasteryPage | client/src/App.tsx | 39 | Lazy loads MasteryPage component.【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L63-L65】 | client |
| /api/me/mastery/skills | client/src/pages/mastery.tsx | 63 | Uses useQuery&lt;MasteryResponse&gt;({ queryKey: ['/api/me/mastery/skills'] }).【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L65-L67】 | client |
| masteryRouter | server/index.ts | 64 | import { masteryRouter } from "../apps/api/src/routes/mastery".【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L75-L77】 | route |
| /api/me/mastery | server/index.ts | 329 | app.use("/api/me/mastery", requireSupabaseAuth, requireStudentOrAdmin, masteryRouter).【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L76-L78】 | route |
| /skills | apps/api/src/routes/mastery.ts | 167 | router.get('/skills', async (req: AuthenticatedRequest, res: Response) => {.【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L77-L79】 | route |
| student_skill_mastery | apps/api/src/routes/mastery.ts | 176 | Queries student_skill_mastery table.【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L78-L80】 | schema |

## Write Paths
- None documented in the provided log (no UPDATE/UPSERT/INSERT mastery/progress paths appear in the log evidence).【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L75-L80】

## Read Paths
- client/src/pages/mastery.tsx:63 — queryKey uses /api/me/mastery/skills.【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L63-L66】
- server/index.ts:329 — app.use("/api/me/mastery", requireSupabaseAuth, requireStudentOrAdmin, masteryRouter).【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L76-L78】
- apps/api/src/routes/mastery.ts:167 — router.get('/skills', ...).【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L77-L79】
- apps/api/src/routes/mastery.ts:176 — Queries student_skill_mastery table.【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L78-L80】

## Ambiguities/Gaps
- Repo root, branch, commit, and Node/pnpm versions are not present in the provided log; missing proof needed: PowerShell output for `pwd`, `git rev-parse --abbrev-ref HEAD`, `git rev-parse HEAD`, `node -v`, and `pnpm -v` captured in the audit log.【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L1-L4】
- Mastery/progress write paths are not documented in the provided log; missing proof needed: log evidence of UPDATE/UPSERT/INSERT operations (or their absence) for mastery/progress state in relevant files with line numbers.【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L75-L80】
