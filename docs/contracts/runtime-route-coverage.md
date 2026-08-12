# Runtime Route Coverage Matrix

This matrix proves contract-disable enforcement coverage for mounted runtime domains.

| route | domain guard | disable code |
|---|---|---|
| `app.use("/api/practice", requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection, practiceCanonicalRouter)` | `practice` | `unlocked` |
| `app.use("/api/full-length", requireSupabaseAuth, requireStudentOrAdmin, fullLengthExamRouter)` | `full-length` | `unlocked` |
| `GET /api/review-errors` | `review` | `unlocked` |
| `POST /api/review-errors/sessions` | `review` | `unlocked` |
| `GET /api/review-errors/sessions/:sessionId/state` | `review` | `unlocked` |
| `POST /api/review-errors/attempt` | `review` | `unlocked` |
| `app.use("/api/practice/diagnostic", requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection, diagnosticRouter)` | `diagnostic` | `unlocked` |

Direct `/api/practice*` routes mounted outside `/api/practice`:

| route | classification | enforcement decision |
|---|---|---|
| `GET /api/practice/topics` | bootstrap/reference setup surface | intentionally left enabled |
| `GET /api/practice/reference/questions` | bootstrap/reference setup surface | intentionally left enabled |

Mounted runtime endpoints in scope are unlocked and enforced by auth/middleware guards in `server/index.ts`.
