# Findings — 2026-03-02

## Summary
- Total findings: 0
- High: 0
- Medium: 0
- Low: 0

## Closure

### FINDING 001 — CSRF bypass on signout (POST /api/auth/signout)
Status: FIXED
Fix commit: e653484
Verification:
- POST /api/auth/signout with no Origin/Referer -> 403
- POST /api/auth/signout with Origin:https://evil.com -> 403 and no ACAO/ACAC headers
- pnpm -s run test -> 281/281 passing

### FINDING 002 — CORS reflects arbitrary Origin
Status: FIXED
Fix commit: e653484
Verification:
- GET /api/health with Origin:https://evil.com -> no Access-Control-Allow-Origin
- GET/POST protected endpoints with Origin:https://evil.com -> no ACAO/ACAC headers
- pnpm -s run test -> 281/281 passing

