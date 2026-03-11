# Cloudflare Baseline Runbook

Last updated: 2026-03-11
Owner: Platform/Security

## Purpose
Define the minimum Cloudflare edge configuration for Lyceon production traffic.

## Scope
- Zone: `lyceon.ai`
- App: Express API and static frontend served by the same origin
- Goal: baseline transport, WAF, and observability hardening

## Baseline Settings
1. DNS proxy enabled (`orange cloud`) for public app records.
2. SSL/TLS mode set to `Full (strict)`.
3. Always Use HTTPS enabled.
4. Minimum TLS version set to `1.2`.
5. Automatic HTTPS Rewrites enabled.
6. Brotli enabled.
7. HTTP/2 and HTTP/3 enabled.
8. Web Application Firewall managed rules enabled for OWASP coverage.

## Edge Security Rules
1. Block or challenge requests with known malicious user agents.
2. Add rate limiting for auth and chat endpoints:
   - `/api/auth/*`
   - `/api/tutor/v2`
   - `/api/rag`
3. Exempt Stripe webhook endpoint from generic JS/browser challenge rules:
   - `/api/billing/webhook`

## Header Baseline Validation
Origin should return these headers for API and public pages:
- `Content-Security-Policy`
- `Strict-Transport-Security` (production HTTPS)
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`

## Logging and Monitoring
1. Keep Cloudflare Security Events enabled.
2. Alert on unusual spikes in 401/403/429/5xx rates.
3. Correlate edge incidents with application `X-Request-Id` values.
4. Route application error events to `ERROR_MONITOR_WEBHOOK_URL` (if configured).

## Change Procedure
1. Apply setting changes first in staging zone.
2. Validate login, protected routes, webhook delivery, and static asset loading.
3. Promote identical settings to production.
4. Record changes in deployment notes with timestamp and owner.

## Rollback
1. Revert most recent WAF/rate-limit/security rule changes.
2. Keep TLS `Full (strict)` and HTTPS enforcement in place.
3. Re-run auth, API, and webhook smoke checks.

## Verification Commands
```bash
curl -I https://lyceon.ai/
curl -I https://lyceon.ai/trust
curl -I https://lyceon.ai/api/health
```
