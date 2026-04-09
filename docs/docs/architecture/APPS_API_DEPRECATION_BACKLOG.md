# APPS API DEPRECATION BACKLOG

This document lists `apps/api/**` modules that are NOT imported by `server/index.ts` and must be deprecated/removed in future sprints.

## Deprecation Backlog

The following route files in `apps/api/src/routes/` are not imported by `server/index.ts` and should be removed:

- `apps/api/src/routes/admin-logs.ts`
- `apps/api/src/routes/admin-questions.ts`
- `apps/api/src/routes/healthz.ts`
- `apps/api/src/routes/question-feedback.ts`

## Deprecation Process

1. Verify no external dependencies on these routes
2. Remove the route files
3. Update any internal references within `apps/api/` if needed
4. Clean up related services, libs, or middleware that become unused</content>
<parameter name="filePath">C:\Users\14438\projects\Lyceonai\docs\docs\architecture\APPS_API_DEPRECATION_BACKLOG.md
