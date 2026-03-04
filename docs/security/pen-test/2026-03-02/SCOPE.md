# Scope — 2026-03-02

## Target environment
- Local: http://localhost:5000

## In scope (Tier A)
- Auth: cookies, CSRF, rate limits
- Authorization: role enforcement, anti-leak
- Admin routes (auth required)
- RAG/Tutor endpoints (auth + CSRF required)

## Out of scope
- Production systems
- Third-party services outside your control
