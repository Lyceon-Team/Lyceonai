# Mastery Evidence Index (Sprint 3)

1. client/src/App.tsx:95 — Route defined with RequireRole allow=['student', 'admin'].【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L63-L67】
2. client/src/App.tsx:39 — Lazy loads MasteryPage component.【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L63-L65】
3. client/src/pages/mastery.tsx:63 — useQuery queryKey ['/api/me/mastery/skills'].【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L65-L67】
4. server/index.ts:64 — import { masteryRouter } from "../apps/api/src/routes/mastery".【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L75-L77】
5. server/index.ts:329 — app.use("/api/me/mastery", requireSupabaseAuth, requireStudentOrAdmin, masteryRouter).【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L76-L78】
6. apps/api/src/routes/mastery.ts:167 — router.get('/skills', async (req: AuthenticatedRequest, res: Response) => {.【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L77-L79】
7. apps/api/src/routes/mastery.ts:176 — Queries student_skill_mastery table.【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L78-L80】
8. client/src/pages/mastery.tsx:84-91 — Loading state (Skeleton components).【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L82-L87】
9. client/src/pages/mastery.tsx:93-101 — Error state (Alert with error message).【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L83-L86】
10. client/src/pages/mastery.tsx:103-118 — Empty state (no mastery rows yet).【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L84-L87】
11. client/src/pages/mastery.tsx:119-175 — Data display (renders mastery data from API).【F:docs/proofs/sprint2_pr4_closeout_proofs.md†L85-L88】
