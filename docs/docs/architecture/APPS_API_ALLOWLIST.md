# APPS API ALLOWLIST

This document defines the frozen allowlist of `apps/api/**` modules that may remain in the codebase. Only modules explicitly imported and mounted by `server/index.ts` are permitted.

## Allowlisted Modules

### `../apps/api/src/routes/rag`
- **Import**: [server/index.ts](server/index.ts#L22)
- **Symbols**: `rag`
- **Mount**: `app.post("/api/rag", ragLimiter, csrfProtection, requireSupabaseAuth, requireStudentOrAdmin, rag)`
- **Transitive deps in apps/api**: `../lib/embeddings`, `../lib/vector`

### `../apps/api/src/routes/rag-v2`
- **Import**: [server/index.ts](server/index.ts#L23)
- **Symbols**: `ragV2Router`
- **Mount**: `app.use("/api/rag/v2", ragLimiter, csrfProtection, requireSupabaseAuth, requireStudentOrAdmin, ragV2Router)`
- **Transitive deps in apps/api**: `../lib/rag-types`, `../lib/rag-service`

### `../apps/api/src/routes/questions`
- **Import**: [server/index.ts](server/index.ts#L26-L34)
- **Symbols**: `getQuestions`, `getRandomQuestions`, `getQuestionCount`, `getQuestionStats`, `getQuestionsFeed`, `getRecentQuestions`, `getQuestionById`, `getReviewErrors`, `submitQuestionFeedback`
- **Mounts**:
  - `app.get("/api/questions", requireSupabaseAuth, requireStudentOrAdmin, getQuestions)`
  - `app.get("/api/questions/recent", requireSupabaseAuth, requireStudentOrAdmin, getRecentQuestions)`
  - `app.get("/api/questions/random", requireSupabaseAuth, requireStudentOrAdmin, getRandomQuestions)`
  - `app.get("/api/questions/count", requireSupabaseAuth, requireStudentOrAdmin, getQuestionCount)`
  - `app.get("/api/questions/stats", requireSupabaseAuth, requireStudentOrAdmin, getQuestionStats)`
  - `app.get("/api/questions/feed", requireSupabaseAuth, requireStudentOrAdmin, getQuestionsFeed)`
  - `app.get("/api/questions/:id", requireSupabaseAuth, requireStudentOrAdmin, getQuestionById)`
  - `app.get("/api/review-errors", requireSupabaseAuth, requireStudentOrAdmin, getReviewErrors)`
  - `app.post("/api/review-errors/attempt", requireSupabaseAuth, requireStudentOrAdmin, csrfProtection, submitReviewSessionAnswer)` (owner import: `server/routes/review-session-routes.ts`)
  - `app.post("/api/questions/feedback", csrfProtection, requireSupabaseAuth, requireStudentOrAdmin, submitQuestionFeedback)`
- **Transitive deps in apps/api**: `../lib/supabase-server`, `../middleware/auth`

### Content/Review Runtime Truth Notes
- `POST /api/questions/validate` is intentionally unmounted (404 runtime contract).
- Canonical mounted owner for `POST /api/review-errors/attempt` is `submitReviewSessionAnswer` in `server/routes/review-session-routes.ts`.

### `../apps/api/src/routes/weakness`
- **Import**: [server/index.ts](server/index.ts#L65)
- **Symbols**: `weaknessRouter`
- **Mount**: `app.use("/api/me/weakness", requireSupabaseAuth, requireStudentOrAdmin, weaknessRouter)`
- **Transitive deps in apps/api**: `../middleware/auth`, `../services/studentMastery`

### `../apps/api/src/routes/mastery`
- **Import**: [server/index.ts](server/index.ts#L66)
- **Symbols**: `masteryRouter`
- **Mount**: `app.use("/api/me/mastery", requireSupabaseAuth, requireStudentOrAdmin, masteryRouter)`
- **Transitive deps in apps/api**: `../middleware/auth`, `../services/studentMastery`, `../lib/supabase-admin`, `../services/mastery-projection`

### `../apps/api/src/routes/calendar`
- **Import**: [server/index.ts](server/index.ts#L68)
- **Symbols**: `calendarRouter`
- **Mount**: `app.use("/api/calendar", requireSupabaseAuth, requireStudentOrAdmin, calendarRouter)`
- **Transitive deps in apps/api**: `../lib/supabase-server`, `../services/studentMastery`

### `../apps/api/src/routes/progress`
- **Import**: [server/index.ts](server/index.ts#L69)
- **Symbols**: `getScoreProjection`, `getRecencyKpis`
- **Mounts**:
  - `app.get("/api/progress/projection", requireSupabaseAuth, requireStudentOrAdmin, getScoreProjection)`
  - `app.get("/api/progress/kpis", requireSupabaseAuth, requireStudentOrAdmin, getRecencyKpis)`
- **Transitive deps in apps/api**: `../lib/supabase-server`, `../middleware/auth`</content>
<parameter name="filePath">C:\Users\14438\projects\Lyceonai\docs\docs\architecture\APPS_API_ALLOWLIST.md
