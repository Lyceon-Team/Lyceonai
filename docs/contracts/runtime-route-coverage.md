# Runtime Route Coverage Matrix

This matrix proves contract-disable enforcement coverage for mounted runtime domains.

| route | domain guard | disable code |
|---|---|---|
| `app.use("/api/practice", requireSupabaseAuth, requireStudentOrAdmin, practiceCanonicalRouter)` | `practice` | `unlocked` |
| `app.use("/api/full-length", runtimeContractDisableMiddleware("full-length"), ...)` | `full-length` | `FULL_LENGTH_RUNTIME_DISABLED_BY_CONTRACT` |
| `app.use("/api/me/mastery/diagnostic", runtimeContractDisableMiddleware("diagnostic"), ...)` | `diagnostic` | `DIAGNOSTIC_RUNTIME_DISABLED_BY_CONTRACT` |
| `GET /api/review-errors` | `runtimeContractDisableMiddleware("review")` | `REVIEW_RUNTIME_DISABLED_BY_CONTRACT` |
| `POST /api/review-errors/sessions` | `runtimeContractDisableMiddleware("review")` | `REVIEW_RUNTIME_DISABLED_BY_CONTRACT` |
| `GET /api/review-errors/sessions/:sessionId/state` | `runtimeContractDisableMiddleware("review")` | `REVIEW_RUNTIME_DISABLED_BY_CONTRACT` |
| `POST /api/review-errors/attempt` | `runtimeContractDisableMiddleware("review")` | `REVIEW_RUNTIME_DISABLED_BY_CONTRACT` |

Direct `/api/practice*` routes mounted outside `/api/practice`:

| route | classification | enforcement decision |
|---|---|---|
| `GET /api/practice/topics` | bootstrap/reference setup surface | intentionally left enabled |
| `GET /api/practice/reference/questions` | bootstrap/reference setup surface | intentionally left enabled |

Mounted runtime endpoints in scope are fully covered by contract-disable guards in `server/index.ts`.
