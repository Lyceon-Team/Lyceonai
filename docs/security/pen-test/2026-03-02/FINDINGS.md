# Findings — 2026-03-02

## Summary
- Total findings: 0
- High: 0
- Medium: 0
- Low: 0

## Findings (details)
(Record each finding with: title, severity, repro steps, expected vs actual, impact, fix, verification.)

## FINDING 001 — CSRF bypass on signout (POST /api/auth/signout)
Severity: HIGH (state-changing endpoint succeeds without Origin/Referer)

Repro (PowerShell):
- iwr -Method POST http://localhost:5000/api/auth/signout -UseBasicParsing

Observed:
- HTTP 200

Expected:
- HTTP 403 when Origin and Referer are missing (CSRF protection)

Notes:
- This endpoint clears session cookies and should be CSRF-protected.


## FINDING 002 — CORS reflects arbitrary Origin
Severity: HIGH if present on credentialed endpoints; needs confirmation across /api/*

Repro (PowerShell):
-  = @{ Origin = "https://evil.com" }
-  = iwr http://localhost:5000/api/health -Headers  -UseBasicParsing
- .Headers["Access-Control-Allow-Origin"]

Observed:
- Access-Control-Allow-Origin: https://evil.com

Expected:
- No reflection; Origin should be validated against allowlist.

Notes:
- Prior responses include Access-Control-Allow-Credentials: true. If both apply on auth routes, this is a serious risk.


### Proof (captured)
- GET /api/profile with Origin:https://evil.com -> 401 + ACAO:https://evil.com + ACAC:true
- POST /api/auth/signout with Origin:https://evil.com -> 200 + ACAO:https://evil.com + ACAC:true
- POST /api/auth/signout with no Origin/Referer -> 200

