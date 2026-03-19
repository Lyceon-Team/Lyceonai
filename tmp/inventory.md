# Mutation Inventory

## Practice
- `/api/practice/sessions` (POST) -> `createExamsession` or `startPracticeSession`
- `/api/practice/sessions/:sessionId/terminate` (POST)
- `/api/practice/sessions/:sessionId/calculator-state` (POST)
- `/api/practice/answer` (POST)
- `/api/practice/sessions/:sessionId/skip` (POST)

## Full-length
- `/api/full-length/sessions` (POST)
- `/api/full-length/sessions/:sessionId/start` (POST)
- `/api/full-length/sessions/:sessionId/answer` (POST)
- `/api/full-length/sessions/:sessionId/break/continue` (POST)
- `/api/full-length/sessions/:sessionId/module/submit` (POST)
- `/api/full-length/sessions/:sessionId/complete` (POST)
- `/api/full-length/sessions/:sessionId/calculator-state` (POST) (missing from earlier map?)

## Calendar
- `/api/calendar/generate` (POST)
- `/api/calendar/refresh/auto` (POST)
- `/api/calendar/regenerate` (POST)
- `/api/calendar/day/:dayDate/regenerate` (POST)
- `/api/calendar/day/:dayDate/reset-to-auto` (POST)
- `/api/calendar/profile` (PUT)
- `/api/calendar/day/:dayDate` (PUT)
- `/api/calendar/day/:dayDate/tasks/:taskId` (PATCH)

## Guardian
- `/api/guardian/link` (POST)

## Auth/session
- `/api/auth/signup` (POST)
- `/api/auth/signin` (POST)
- `/api/auth/signout` (POST)
- `/api/auth/consent` (POST)
- `/api/auth/refresh` (POST)

## Billing/webhooks
- `/api/billing/checkout` (POST)
- `/api/billing/portal` (POST)
- `/api/billing/webhook` (handled in index.ts)
