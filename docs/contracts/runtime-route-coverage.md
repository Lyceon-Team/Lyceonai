# Runtime Route Coverage Matrix

This matrix proves contract-disable enforcement coverage for mounted runtime domains.

| route | domain guard | disable code |
|---|---|---|
| `app.use("/api/practice", requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection, practiceCanonicalRouter)` | `practice` | `unlocked` |
| `app.use("/api/full-length", requireSupabaseAuth, requireStudentOrAdmin, fullLengthExamRouter)` | `full-length` | `unlocked` |
| `app.use("/api/review", requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection, reviewCanonicalRouter)` | `review` | `unlocked` |
| `app.use("/api/practice/diagnostic", requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection, diagnosticRouter)` | `diagnostic` | `unlocked` |

Direct `/api/practice*` routes mounted outside `/api/practice`:

| route | classification | enforcement decision |
|---|---|---|
| `GET /api/practice/topics` | bootstrap/reference setup surface | intentionally left enabled |
| `GET /api/practice/reference/questions` | bootstrap/reference setup surface | intentionally left enabled |

Mounted runtime endpoints in scope are unlocked and enforced by auth/middleware guards in `server/index.ts`.

Updated 2026-09-21 (R3). The four `/api/review-errors/*` rows named a runtime deleted in
R1; review is now one mount, `/api/review`, with practice's middleware stack. The
`review` domain key in `runtime-contract-disable.ts` is retained: it is the shared
"this runtime is disabled by contract" copy used by all three engines, not the R1
hard-kill guard.
