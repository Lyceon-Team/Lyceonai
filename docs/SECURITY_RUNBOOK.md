# 🔒 Lyceon Security Runbook
### Version: 1.0 — Production-Ready  
**Last updated:** October 2025  
**Maintainer:** Lead Architect / Security Officer  

## 1️⃣ Purpose
This document provides standard procedures for maintaining, verifying, and responding to security events in the **SAT Learning Copilot (Lyceon)** platform. It ensures ongoing compliance with **FERPA**, **OWASP**, and cloud-app security best practices.

## 2️⃣ Scope
Applies to:
- All backend services under `/apps/api`
- Auth + data services (Supabase / Firestore)
- Frontend apps (`/apps/web`)
- GCP infrastructure and GitHub Actions pipelines

## 3️⃣ Security Baseline Summary
| Layer | Mechanism | Status |
|---|---|---|
| **Auth** | Supabase Auth (JWT + RBAC) | ✅ Enforced |
| **Session Storage** | HttpOnly cookies only | ✅ |
| **CSRF Protection** | Exact-origin match via middleware | ✅ |
| **RLS (Row Level Security)** | Enabled on all user tables | ✅ |
| **Input Validation** | Zod schemas at all API routes | ✅ |
| **Secrets** | GCP Secret Manager & GitHub Secrets | ✅ |
| **Transport** | HTTPS only (enforced) | ✅ |
| **Logging** | Structured logs (no PII) | ✅ |
| **Monitoring** | Sentry + GCP Cloud Monitoring | ✅ |

## 4️⃣ Verification Procedures
### Daily (CI)
- `npm audit` and `snyk test`
- `npm run test:integration`
- Smoke test:
  ```bash
  ./scripts/smoke.sh https://staging.lyceon.app
  ```

Expect: 401 (unauth), 403 (forged origin), 200 (same-origin).

### Weekly
- Review GCP logs (status=403)
- Verify Supabase backup job success

### Monthly
- Rotate keys: `SUPABASE_SERVICE_ROLE_KEY`, `PINECONE_API_KEY`, `OPENAI_API_KEY`
- Update GitHub Secrets; rerun integration suite

### Quarterly
- Dependency upgrade audit
- Review `ALLOWED_ORIGINS`
- IAM review: remove stale service accounts
- Verify org-wide 2FA

## 5️⃣ Incident Response
| Step | Action |
|---|---|
| 1 Detect | Sentry alert or unusual logs |
| 2 Contain | Disable external write endpoints |
| 3 Eradicate | Rotate all API keys & invalidate sessions |
| 4 Recover | Redeploy from clean commit w/ verified secrets |
| 5 Review | Document RCA and patch in SECURITY.md |

## 6️⃣ Deployment Checklist
```bash
npm run lint && npm run test
npm run test:integration && ./scripts/smoke.sh https://staging.lyceon.app
```

Ensure:
- `ALLOWED_ORIGINS` set (no wildcards/commas)
- CSRF middleware active (`server/middleware/csrf.ts`)
- Role guards on protected routes
- GitHub Actions uses least-privilege SA

## 7️⃣ Key Files & Commands
| File | Purpose |
|---|---|
| `server/middleware/csrf.ts` | Origin validation guard |
| `server/middleware/supabase-auth.ts` | RBAC + session validation |
| `tests/auth.integration.test.ts` | Security regression coverage |
| `scripts/smoke.sh` | Deployment verification script |
| `docs/AUTH_SECURITY.md` | Technical deep dive |
| `scripts/migrate-users-to-supabase.ts` | User migration tool |

## 8️⃣ Reporting & Escalation
- **Internal:** open issue, label `security`, assign core dev
- **Critical:** notify CTO + disable external routes
- **External vulnerabilities:** email `security@lyceon.app` (72h response window)

## 9️⃣ Compliance Alignment
| Standard | Action |
|---|---|
| FERPA | Student data encrypted at rest |
| OWASP A5 (CSRF) | Exact origin + referer enforcement |
| OWASP A2 (Broken Auth) | Server-side session validation |
| OWASP A7 (XSS) | Escaped outputs + CSP headers |
| SOC2 / ISO27001 | Change logs + least privilege IAM |

## 🔚 Appendix

**Simulate CSRF attack (should 403):**
```bash
curl -X POST https://yourapp.com/api/secure-endpoint -H "Origin: https://evil.com" -v
```

**View origin logs:**
```bash
gcloud logging read 'textPayload:"CSRF"' --limit 10
```

**Re-run smoke suite:**
```bash
chmod +x scripts/smoke.sh && ./scripts/smoke.sh https://staging.lyceon.app
```

---

**Summary:** Verified CSRF + RBAC, monitoring, rotatable keys, reproducible builds, and a clear incident path. Keep this file updated whenever auth, hosting, or CI/CD changes.
