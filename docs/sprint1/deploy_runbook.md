# Sprint 1 Deploy Runbook
**Date**: 2026-02-01  
**Sprint**: 1  
**Repository**: Lyceon-Team/Lyceonai

---

## Deployment Overview

**Application**: Lyceonai SAT Prep Platform  
**Stack**: Node.js 20.x, Express, React (Vite), PostgreSQL (Supabase/Neon)  
**Runtime**: Production Express server  
**Port**: 5000 (configurable via `API_PORT`)

---

## 1. Prerequisites

### System Requirements

- **OS**: Linux (Ubuntu 20.04+ recommended)
- **Node.js**: v20.x
- **pnpm**: v9.x
- **PostgreSQL**: 14+ (via Supabase or Neon)
- **RAM**: Minimum 2GB (recommended 4GB)
- **Disk**: Minimum 10GB free space

### Installation

```bash
# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
npm install -g pnpm@9

# Verify versions
node -v  # Should output v20.x.x
pnpm -v  # Should output 9.x.x
```

---

## 2. Environment Variables

### Required Variables (Production)

**Authentication & Database**:
```bash
# Supabase Configuration
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# PostgreSQL Database (optional if using Supabase)
DATABASE_URL=postgresql://user:password@host:5432/database

# Gemini API (for embeddings and LLM)
GEMINI_API_KEY=AIzaSy...

# Application Configuration
PUBLIC_SITE_URL=https://lyceon.ai
NODE_ENV=production
```

**How to Get Values**:
- **SUPABASE_URL**: Supabase Dashboard → Settings → API → Project URL
- **SUPABASE_ANON_KEY**: Supabase Dashboard → Settings → API → Project API keys → anon/public
- **SUPABASE_SERVICE_ROLE_KEY**: Supabase Dashboard → Settings → API → Project API keys → service_role (⚠️ Secret)
- **GEMINI_API_KEY**: Google AI Studio → https://aistudio.google.com/app/apikey
- **PUBLIC_SITE_URL**: Your production domain (e.g., `https://lyceon.ai`)

### Optional Variables (Billing)

**Stripe Configuration**:
```bash
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
```

**How to Get Values**:
- **STRIPE_SECRET_KEY**: Stripe Dashboard → Developers → API keys → Secret key
- **STRIPE_WEBHOOK_SECRET**: Stripe Dashboard → Developers → Webhooks → Add endpoint → Signing secret
- **STRIPE_PUBLISHABLE_KEY**: Stripe Dashboard → Developers → API keys → Publishable key

### Optional Variables (Advanced)

**Feature Flags**:
```bash
VECTORS_ENABLED=true          # Enable vector search (requires GEMINI_API_KEY)
QA_LLM_ENABLED=true           # Enable Q&A LLM (requires GEMINI_API_KEY)
ENABLE_UNDER_13_GATE=true     # COPPA compliance gate
```

**Security**:
```bash
CORS_ORIGINS=https://lyceon.ai,https://www.lyceon.ai
CSRF_ALLOWED_ORIGINS=https://lyceon.ai,https://www.lyceon.ai
```

**OAuth (Optional)**:
```bash
GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET
```

**OCR Configuration (Optional)**:
```bash
OCR_PROVIDER=auto                               # auto | docai | nougat | tesseract
DOC_AI_PROCESSOR=projects/.../processors/...    # Document AI processor ID
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account",...}  # GCP credentials
GCP_LOCATION=us                                 # GCP region
MATHPIX_API_ID=YOUR_MATHPIX_ID                  # Mathpix OCR
MATHPIX_API_KEY_ONLY=YOUR_MATHPIX_KEY           # Mathpix API key
```

### Environment File Setup

**Create `.env` file**:
```bash
# Copy example and edit
cp .env.example .env
nano .env  # Or use your preferred editor
```

**Validate Environment**:
```bash
# Check required variables are set
if [ -z "$SUPABASE_URL" ]; then echo "❌ SUPABASE_URL not set"; exit 1; fi
if [ -z "$SUPABASE_ANON_KEY" ]; then echo "❌ SUPABASE_ANON_KEY not set"; exit 1; fi
if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then echo "❌ SUPABASE_SERVICE_ROLE_KEY not set"; exit 1; fi
if [ -z "$GEMINI_API_KEY" ]; then echo "❌ GEMINI_API_KEY not set"; exit 1; fi
if [ -z "$PUBLIC_SITE_URL" ]; then echo "❌ PUBLIC_SITE_URL not set"; exit 1; fi
echo "✅ All required environment variables are set"
```

---

## 3. Build & Deploy

### Initial Deployment

```bash
# 1. Clone repository
git clone https://github.com/Lyceon-Team/Lyceonai.git
cd Lyceonai

# 2. Checkout release tag (or main branch)
git checkout v1.0.0  # Replace with your release tag

# 3. Install dependencies
pnpm install --frozen-lockfile

# 4. Build production bundle
pnpm run build

# Expected output:
# vite v7.x.x building for production...
# ✓ XX modules transformed
# dist/index.js  XXX.XX kB
# ✓ Client built successfully
# ✓ Server built successfully
# ✓ No CDN KaTeX references found
```

### Update Deployment

```bash
# 1. Pull latest code
git fetch origin
git checkout <new-release-tag>

# 2. Install dependencies (if package.json changed)
pnpm install --frozen-lockfile

# 3. Rebuild
pnpm run build

# 4. Restart server (see section 4)
```

---

## 4. Startup Commands

### Production Server

**Start Server**:
```bash
# Set environment variables (if not in .env)
export NODE_ENV=production
export PUBLIC_SITE_URL=https://lyceon.ai

# Start server
pnpm start

# Expected output:
# 🔧 [ENV] Environment validation starting...
# ✅ [ENV] Core: NODE_ENV=production, API_PORT=5000
# ✅ [ENV] SUPABASE_URL configured
# ✅ [ENV] SUPABASE_SERVICE_ROLE_KEY configured
# ✅ [ENV] SUPABASE_ANON_KEY configured
# ✅ [ENV] GEMINI_API_KEY configured
# ✅ [ENV] Environment validation complete
# 🚀 Production server running on http://localhost:5000
```

**Background Server (systemd)**:

Create `/etc/systemd/system/lyceon.service`:
```ini
[Unit]
Description=Lyceon SAT Prep Platform
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/Lyceonai
EnvironmentFile=/var/www/Lyceonai/.env
ExecStart=/usr/bin/pnpm start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Enable and start service**:
```bash
sudo systemctl daemon-reload
sudo systemctl enable lyceon
sudo systemctl start lyceon

# Check status
sudo systemctl status lyceon

# View logs
sudo journalctl -u lyceon -f
```

**Background Server (PM2)**:

```bash
# Install PM2
pnpm add -g pm2

# Start server
pm2 start dist/index.js --name lyceon

# Auto-restart on reboot
pm2 startup
pm2 save

# View logs
pm2 logs lyceon

# Restart
pm2 restart lyceon

# Stop
pm2 stop lyceon
```

### Development Server (Optional)

```bash
# Start development server with hot reload
pnpm dev

# Expected output:
# 🔧 [ENV] Environment validation starting...
# ✅ [ENV] Core: NODE_ENV=development, API_PORT=5000
# 🚀 Server running on http://localhost:5000
```

---

## 5. Smoke Test Checklist

### Basic Health Checks

#### 1. Server Health
```bash
curl https://lyceon.ai/healthz

# Expected Status: 200 OK
# Expected Response: {"status":"ok"}
```

#### 2. API Health
```bash
curl https://lyceon.ai/api/health

# Expected Status: 200 OK
# Expected Response: {"status":"ok","timestamp":"2026-02-01T00:00:00.000Z"}
```

#### 3. Homepage (SSR)
```bash
curl https://lyceon.ai/

# Expected Status: 200 OK
# Expected Response: HTML with <title>Lyceon - SAT Prep Platform</title>
```

### Authentication Endpoints

#### 4. Auth User (Unauthenticated)
```bash
curl https://lyceon.ai/api/auth/user

# Expected Status: 200 OK
# Expected Response: {"user":null}
```

#### 5. Auth Debug (Development Only)
```bash
curl https://lyceon.ai/api/auth/debug

# Expected Status: 200 OK (development)
# Expected Status: 404 or 403 (production)
```

### Protected Endpoints (Require Auth)

#### 6. Questions Recent (Anonymous Access)
```bash
curl https://lyceon.ai/api/questions/recent

# Expected Status: 200 OK
# Expected Response: {"questions":[...]}
```

#### 7. Questions Random (Authenticated)
```bash
curl https://lyceon.ai/api/questions/random \
  -H "Cookie: sb-access-token=YOUR_TOKEN"

# Expected Status: 200 OK (authenticated)
# Expected Status: 401 Unauthorized (unauthenticated)
```

### CORS & CSRF Protection

#### 8. CORS (Valid Origin)
```bash
curl https://lyceon.ai/api/questions/recent \
  -H "Origin: https://lyceon.ai" \
  -v

# Expected Status: 200 OK
# Expected Header: Access-Control-Allow-Origin: https://lyceon.ai
```

#### 9. CSRF Protection (Invalid Origin)
```bash
curl -X POST https://lyceon.ai/api/rag \
  -H "Origin: https://evil.com" \
  -H "Content-Type: application/json" \
  -d '{"query":"test"}'

# Expected Status: 403 Forbidden
# Expected Response: {"error":"csrf_blocked"}
```

### Billing Endpoints (If Enabled)

#### 10. Stripe Publishable Key
```bash
curl https://lyceon.ai/api/billing/publishable-key

# Expected Status: 200 OK
# Expected Response: {"publishableKey":"pk_live_..."}
```

#### 11. Billing Products (Authenticated)
```bash
curl https://lyceon.ai/api/billing/products \
  -H "Cookie: sb-access-token=YOUR_GUARDIAN_TOKEN"

# Expected Status: 200 OK
# Expected Response: {"products":[...]}
```

### Database Connectivity

#### 12. Database Health (Admin Only)
```bash
curl https://lyceon.ai/api/admin/db-health \
  -H "Cookie: sb-access-token=YOUR_ADMIN_TOKEN"

# Expected Status: 200 OK
# Expected Response: {"status":"ok","tables":[...]}
```

---

## 6. Monitoring & Logs

### Application Logs

**systemd**:
```bash
# View real-time logs
sudo journalctl -u lyceon -f

# View last 100 lines
sudo journalctl -u lyceon -n 100

# View errors only
sudo journalctl -u lyceon -p err
```

**PM2**:
```bash
# View real-time logs
pm2 logs lyceon

# View error logs only
pm2 logs lyceon --err

# Clear logs
pm2 flush lyceon
```

### Key Log Messages

**Startup Success**:
```
✅ [ENV] Environment validation complete
🚀 Production server running on http://localhost:5000
```

**Startup Failure (Missing Env Var)**:
```
❌ [ENV] CRITICAL: Missing SUPABASE_URL
❌ FATAL: Critical environment variables missing in production. Server cannot start.
```

**Runtime Errors**:
```
❌ [AUTH] Supabase client creation failed: Invalid JWT
❌ [DB] Database connection failed: Connection timeout
❌ [STRIPE] Webhook signature verification failed
```

### Performance Metrics

**Server Status**:
```bash
# CPU and memory usage (PM2)
pm2 monit

# System resources
htop
```

**Response Times**:
```bash
# Test endpoint response time
curl -w "@-" -o /dev/null -s https://lyceon.ai/healthz <<'EOF'
time_namelookup:  %{time_namelookup}s\n
time_connect:     %{time_connect}s\n
time_appconnect:  %{time_appconnect}s\n
time_pretransfer: %{time_pretransfer}s\n
time_starttransfer: %{time_starttransfer}s\n
time_total:       %{time_total}s\n
EOF

# Expected: time_total < 1s for health checks
```

---

## 7. Troubleshooting

### Server Won't Start

**Symptom**: Server exits immediately after start

**Diagnosis**:
```bash
# Check environment variables
node -e "console.log(process.env)" | grep SUPABASE

# Check Node.js version
node -v  # Should be 20.x

# Check port availability
sudo netstat -tulpn | grep :5000

# Check server logs
sudo journalctl -u lyceon -n 50
```

**Solutions**:
- Missing env vars → Set required variables in `.env`
- Port in use → Kill process on port 5000: `sudo lsof -ti:5000 | xargs kill -9`
- Node version mismatch → Install Node.js 20.x
- Build artifacts missing → Run `pnpm run build`

### Database Connection Issues

**Symptom**: "Database connection failed" in logs

**Diagnosis**:
```bash
# Test database connection
psql $DATABASE_URL -c "SELECT 1"

# Check Supabase connectivity
curl https://YOUR_PROJECT.supabase.co/rest/v1/

# Verify credentials
echo $SUPABASE_URL
echo $SUPABASE_ANON_KEY | head -c 20
```

**Solutions**:
- Invalid URL → Check `SUPABASE_URL` format
- Network issues → Verify firewall rules, check internet connectivity
- Invalid credentials → Regenerate keys in Supabase Dashboard
- Connection timeout → Increase timeout, check database region

### Authentication Failures

**Symptom**: "401 Unauthorized" on protected endpoints

**Diagnosis**:
```bash
# Check auth user endpoint
curl https://lyceon.ai/api/auth/user \
  -H "Cookie: sb-access-token=YOUR_TOKEN"

# Check Supabase JWT
curl https://YOUR_PROJECT.supabase.co/auth/v1/user \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Solutions**:
- Token expired → Refresh token or re-login
- Invalid token → Check token format, verify `SUPABASE_ANON_KEY`
- Cookie not set → Check browser cookies, verify `httpOnly` flag
- CSRF blocking → Add origin to `CSRF_ALLOWED_ORIGINS`

### Billing Integration Issues

**Symptom**: Stripe webhook failures in logs

**Diagnosis**:
```bash
# Check webhook secret
echo $STRIPE_WEBHOOK_SECRET | head -c 10

# Test webhook endpoint
curl -X POST https://lyceon.ai/api/billing/webhook \
  -H "Content-Type: application/json" \
  -d '{"id":"evt_test"}'

# Check Stripe webhook logs
# Visit: https://dashboard.stripe.com/webhooks
```

**Solutions**:
- Missing webhook secret → Set `STRIPE_WEBHOOK_SECRET`
- Signature verification failure → Re-create webhook endpoint, get new secret
- Webhook not configured → Add endpoint in Stripe Dashboard
- Network issues → Check firewall, verify HTTPS certificate

### High CPU/Memory Usage

**Symptom**: Server slow or unresponsive

**Diagnosis**:
```bash
# Check system resources
top
htop

# Check Node.js process
pm2 monit

# Check request rate
sudo tail -f /var/log/nginx/access.log | grep -c "GET"
```

**Solutions**:
- High request rate → Add rate limiting, enable caching
- Memory leak → Restart server, investigate code
- CPU spike → Check for infinite loops, optimize queries
- Too many connections → Increase connection pool size

---

## 8. Rollback Procedure

### Emergency Rollback

**If deployment causes critical issues**:

```bash
# 1. Stop current server
pm2 stop lyceon
# OR
sudo systemctl stop lyceon

# 2. Switch to previous version
git fetch --tags
git checkout <previous-version-tag>

# 3. Reinstall dependencies (if needed)
pnpm install --frozen-lockfile

# 4. Rebuild
pnpm run build

# 5. Restart server
pm2 start lyceon
# OR
sudo systemctl start lyceon

# 6. Verify
curl https://lyceon.ai/healthz
```

### Database Rollback

**If database migration causes issues**:

```bash
# 1. Restore from backup
pg_restore -d $DATABASE_URL backup.dump

# 2. Verify schema
psql $DATABASE_URL -c "\dt"

# 3. Restart server
pm2 restart lyceon
```

---

## 9. Backup & Disaster Recovery

### Database Backup

**Manual Backup**:
```bash
# Backup to file
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# Compress
gzip backup_$(date +%Y%m%d_%H%M%S).sql
```

**Automated Backup (cron)**:
```bash
# Add to crontab (daily at 2 AM)
0 2 * * * pg_dump $DATABASE_URL | gzip > /backups/lyceon_$(date +\%Y\%m\%d).sql.gz
```

### Application Backup

**Configuration Files**:
```bash
# Backup .env file
cp .env .env.backup_$(date +%Y%m%d)

# Backup nginx config (if applicable)
sudo cp /etc/nginx/sites-available/lyceon /etc/nginx/sites-available/lyceon.backup
```

### Recovery

**Restore from Backup**:
```bash
# Database
gunzip backup_20260201.sql.gz
psql $DATABASE_URL < backup_20260201.sql

# Verify
psql $DATABASE_URL -c "SELECT COUNT(*) FROM users"
```

---

## 10. Security Checklist

### Pre-Deployment Security

- [ ] All environment variables stored securely (not in source control)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` kept secret (never exposed to client)
- [ ] `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` kept secret
- [ ] `NODE_ENV=production` set
- [ ] HTTPS enabled (not using HTTP)
- [ ] CORS origins configured (`CORS_ORIGINS`)
- [ ] CSRF protection enabled (`CSRF_ALLOWED_ORIGINS`)
- [ ] Rate limiting configured for auth endpoints
- [ ] Database connection uses SSL/TLS
- [ ] No debug endpoints exposed in production

### Post-Deployment Security Verification

```bash
# 1. Verify HTTPS
curl -I https://lyceon.ai | grep "HTTP/2 200"

# 2. Test CSRF protection
curl -X POST https://lyceon.ai/api/rag \
  -H "Origin: https://evil.com" \
  -d '{"query":"test"}' \
  # Should return 403

# 3. Test auth protection
curl https://lyceon.ai/api/admin/stats
  # Should return 401 (unauthenticated)

# 4. Verify cookie security
curl -I https://lyceon.ai/api/auth/signin | grep "Set-Cookie"
  # Should include "HttpOnly", "Secure", "SameSite"
```

---

**End of Deploy Runbook**
