# 🧹 Production Cleanup Action Plan

> **HISTORICAL ARCHIVE (non-runtime):** Any ingestion references in this document describe removed systems and do not reflect current product scope.

## Lyceon AI - Pre-Launch Cleanup Tasks

**Created:** January 29, 2026  
**Target Completion:** Before Production Launch  
**Owner:** Development Team  

---

## 📋 Quick Reference

**Total Tasks:** 29  
**Critical:** 2 🔴  
**High Priority:** 8 🟠  
**Medium Priority:** 12 🟡  
**Low Priority:** 7 🟢  

**Estimated Effort:** 3-5 developer days  

---

## 🔴 CRITICAL - DO IMMEDIATELY

### Task 1: Remove Empty File
**File:** `/0`  
**Action:**
```bash
git rm 0
git commit -m "chore: remove empty file from repository root"
```
**Time:** 1 minute  
**Risk:** None  

---

### Task 2: Remove Build Artifacts and Update .gitignore
**Files:**
- `apps/api/tsconfig.tsbuildinfo`
- `apps/api/tsconfig.v4.tsbuildinfo`

**Actions:**
```bash
# Remove build artifacts
git rm apps/api/tsconfig.tsbuildinfo
git rm apps/api/tsconfig.v4.tsbuildinfo

# Update .gitignore
echo "*.tsbuildinfo" >> .gitignore

# Commit changes
git add .gitignore
git commit -m "chore: remove build artifacts and update gitignore"
```
**Time:** 2 minutes  
**Risk:** None  

---

## 🟠 HIGH PRIORITY - DO THIS WEEK

### Task 3: Organize Root-Level Test Files
**Files to Handle:**
- `test-api.js`
- `test-bulk-service-parsing.js`
- `test-database-consistency.js`
- `test-fixed-parser.js`
- `test-format-analysis.js`
- `test-integration.html`
- `test-pdf-direct.js`
- `test-sat-integration.js`
- `trigger-integration.js`
- `debug-sat-format.js`

**Decision Matrix:**

| File | Still Used? | Action |
|------|------------|--------|
| test-*.js | Check git history | Move to tests/legacy/ OR delete |
| debug-*.js | Development only | Move to scripts/dev/ OR delete |
| trigger-integration.js | Unknown | Review usage and decide |

**Actions:**
```bash
# Option A: Move to legacy tests
mkdir -p tests/legacy
git mv test-*.js debug-*.js trigger-integration.js tests/legacy/
git mv test-integration.html tests/legacy/
git commit -m "chore: organize legacy test files"

# Option B: Delete if obsolete (review each file first!)
# git rm test-*.js debug-*.js trigger-integration.js test-integration.html
# git commit -m "chore: remove obsolete test files"
```
**Time:** 30 minutes (includes review)  
**Risk:** Medium - ensure files aren't still used  

---

### Task 4: Audit and Remove CSV Files
**Files:**
- `exported_csv_sample.csv`
- `latest_export.csv`
- `test_export.csv`
- `attached_assets/*.csv`

**Actions:**
```bash
# Step 1: Review each CSV for sensitive data
# MANUAL REVIEW REQUIRED

# Step 2: Determine which to keep
# Keep: Sample data files (max 50 rows, anonymized)
# Remove: Actual data exports

# Step 3: Update .gitignore
cat >> .gitignore << EOF
# Data exports
*.csv
!docs/samples/*.csv
EOF

# Step 4: Remove files (example)
git rm exported_csv_sample.csv latest_export.csv test_export.csv
git rm attached_assets/*.csv

# Step 5: Commit
git add .gitignore
git commit -m "chore: remove data export files and update gitignore"
```
**Time:** 20 minutes  
**Risk:** Low (if reviewed properly)  

---

### Task 5: Organize Screenshots/Images
**Files:**
- `auth-prompt.png`
- `sign-in-prompt.png`
- `dashboard_loaded.png`

**Actions:**
```bash
# Create documentation screenshots directory
mkdir -p docs/screenshots

# Move images
git mv auth-prompt.png sign-in-prompt.png dashboard_loaded.png docs/screenshots/

# Update any references in documentation
grep -r "auth-prompt.png" docs/ README.md
# Update references manually

# Commit
git commit -m "chore: organize documentation screenshots"
```
**Time:** 10 minutes  
**Risk:** Low - update documentation links  

---

### Task 6: Reduce Console.log Statements
**Target:** Reduce from ~150 to <30 in production code paths  

**Strategy:**
1. **Keep console.log in:**
   - Test files
   - Development-only scripts
   - Error boundaries (critical errors)
   - Server startup validation

2. **Replace console.log with logger in:**
   - API routes
   - Services
   - Middleware
   - Client production code

**Example Replacements:**
```typescript
// Before
console.log('[ADMIN_QUESTIONS] Fetching questions');

// After
import { logger } from '../logger';
logger.info('[ADMIN_QUESTIONS] Fetching questions');

// Or remove entirely if not needed
```

**Files to Update:** (Priority order)
1. `apps/api/src/routes/*.ts` - API routes
2. `server/routes/*.ts` - Server routes
3. `server/services/*.ts` - Core services
4. `client/src/components/**/*.tsx` - Production components
5. `apps/api/src/services/*.ts` - Business logic

**Actions:**
```bash
# Find production console.logs (exclude tests)
grep -r "console\." apps/api/src server --include="*.ts" --exclude-dir=__tests__ | wc -l

# Create a cleanup script or do manually
# Focus on removing verbose logging in production paths
```
**Time:** 2-3 hours  
**Risk:** Medium - don't remove important error logging  

---

### Task 7: Complete or Remove Incomplete Features
**File:** `server/services/jobPersistenceSupabase.ts`  

**Current State:** All methods are TODOs  
**Options:**

**Option A: Complete Implementation**
```typescript
// Implement actual Supabase persistence
async saveJob(job: Job): Promise<void> {
  const { error } = await supabase
    .from('ingestion_jobs')
    .insert({ ...job });
  if (error) throw error;
}
```

**Option B: Remove and Use Alternative**
```bash
# If not needed, remove the file
git rm server/services/jobPersistenceSupabase.ts

# Update references to use in-memory storage
grep -r "jobPersistenceSupabase" server/
# Update imports manually
```

**Option C: Mark as Disabled**
```typescript
// Add feature flag
if (env.ENABLE_JOB_PERSISTENCE) {
  // Use persistence
} else {
  // Use in-memory
}
```

**Time:** 1-2 hours (depending on option)  
**Risk:** High - may affect ingestion jobs  

---

### Task 8: Review and Sanitize HTML Rendering
**Files with XSS Risk:**
- `client/src/components/ui/chart.tsx`
- `client/src/pages/blog-post.tsx`
- `client/src/pages/legal-doc.tsx`

**Actions:**
```bash
# Install DOMPurify if not already installed
npm install dompurify
npm install --save-dev @types/dompurify

# Update each file to sanitize HTML
```

**Example:**
```typescript
// Before
<div dangerouslySetInnerHTML={{ __html: content }} />

// After
import DOMPurify from 'dompurify';

<div dangerouslySetInnerHTML={{ 
  __html: DOMPurify.sanitize(content, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'a'],
    ALLOWED_ATTR: ['href', 'target']
  })
}} />
```

**Time:** 30 minutes  
**Risk:** Low - improves security  

---

### Task 9: Fix Python Script Configuration
**File:** `question_manager.py`  

**Changes:**
```python
import os

# Before
BASE_URL = "http://localhost:5000"

# After
BASE_URL = os.getenv("LYCEON_API_URL", "http://localhost:5000")

class QuestionManager:
    def __init__(self, api_url: Optional[str] = None, auth_token: Optional[str] = None):
        self.base_url = api_url or os.getenv("LYCEON_API_URL", "http://localhost:5000")
        self.auth_token = auth_token or os.getenv("LYCEON_API_TOKEN")
        self.headers = {}
        if self.auth_token:
            self.headers["Authorization"] = f"Bearer {self.auth_token}"
```

**Documentation:**
```bash
# Add to README or scripts documentation
echo "## Question Manager CLI

Environment variables:
- LYCEON_API_URL: API base URL (default: http://localhost:5000)
- LYCEON_API_TOKEN: API authentication token

Usage:
export LYCEON_API_URL=https://api.lyceon.ai
export LYCEON_API_TOKEN=your-token
python3 question_manager.py list
" >> scripts/README.md
```

**Time:** 15 minutes  
**Risk:** Low  

---

### Task 10: Add Security Scanning to CI/CD
**File:** `.github/workflows/ci.yml`  

**Changes:**
```yaml
# Add after "Install dependencies" step
- name: Security Audit
  run: |
    pnpm audit --audit-level=high || true
    echo "Security audit complete"

- name: Run Security Tests
  run: pnpm run test:security

# Optional: Add CodeQL
- name: Initialize CodeQL
  uses: github/codeql-action/init@v2
  with:
    languages: javascript, typescript

- name: Perform CodeQL Analysis
  uses: github/codeql-action/analyze@v2
```

**Time:** 20 minutes  
**Risk:** Low - may reveal issues to fix  

---

## 🟡 MEDIUM PRIORITY - DO THIS MONTH

### Task 11: Consolidate CORS Configuration
**Files:**
- `apps/api/src/middleware/cors.ts`
- `server/middleware/origin-utils.ts`
- Environment variables: `CORS_ORIGINS`, `CSRF_ALLOWED_ORIGINS`, `ALLOWED_ORIGINS`

**Action:** Create single source of truth
```typescript
// shared/config/origins.ts
export const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS || 
  process.env.CORS_ORIGINS || 
  process.env.CSRF_ALLOWED_ORIGINS || 
  'http://localhost:5000,http://localhost:3000'
).split(',').map(s => s.trim());
```

**Time:** 30 minutes  
**Risk:** Medium - test thoroughly  

---

### Task 12: Document Authentication Strategy
**Create:** `docs/AUTHENTICATION_ARCHITECTURE.md`

**Content:**
```markdown
# Authentication Architecture

## Current State (January 2026)

### Primary Authentication: Supabase Auth
- Used for all user-facing endpoints
- JWT-based with httpOnly cookies
- Supports Google OAuth and email/password

### Legacy/Admin Authentication: Bearer Tokens
- Used for admin-only API endpoints
- Planned for deprecation

### Migration Plan
1. All new features use Supabase Auth
2. Legacy Bearer endpoints to be migrated by Q2 2026
3. Remove NextAuth if not used

## Implementation Details
[Link to existing docs]
```

**Time:** 1 hour  
**Risk:** None - documentation only  

---

### Task 13-22: [Additional Medium Priority Tasks]
See main audit report for full details. These include:
- Consolidate documentation
- Update dependencies
- Add production build validation
- Clarify rate limiting strategy
- Review attached_assets usage
- Etc.

---

## 🟢 LOW PRIORITY - NICE TO HAVE

### Task 23: Establish File Naming Conventions
**Document:** `docs/CONTRIBUTING.md` or `docs/STYLE_GUIDE.md`

**Conventions:**
- TypeScript files: `camelCase.ts`
- React components: `PascalCase.tsx`
- Route handlers: `kebab-case-routes.ts`
- Test files: `*.test.ts` or `*.spec.ts`
- Scripts: `kebab-case.ts`
- Python: `snake_case.py`

**Time:** 30 minutes  
**Risk:** None  

---

### Task 24-29: [Additional Low Priority Tasks]
See main audit report for details.

---

## 🔄 CONTINUOUS MAINTENANCE

### Weekly
- [ ] Review new `console.log` in PRs
- [ ] Check for TODO comments
- [ ] Monitor dependency security alerts

### Monthly
- [ ] Run `npm audit` and fix issues
- [ ] Update dependencies
- [ ] Review documentation for accuracy

### Quarterly
- [ ] Full security audit
- [ ] Dependency major version updates
- [ ] Performance review

---

## 📊 PROGRESS TRACKING

Use this checklist to track completion:

### Critical (Complete ASAP)
- [ ] Task 1: Remove empty file `/0`
- [ ] Task 2: Remove build artifacts

### High Priority (This Week)
- [ ] Task 3: Organize test files
- [ ] Task 4: Audit CSV files
- [ ] Task 5: Organize screenshots
- [ ] Task 6: Reduce console.log statements
- [ ] Task 7: Complete/remove incomplete features
- [ ] Task 8: Sanitize HTML rendering
- [ ] Task 9: Fix Python script config
- [ ] Task 10: Add security scanning to CI

### Medium Priority (This Month)
- [ ] Task 11: Consolidate CORS config
- [ ] Task 12: Document auth strategy
- [ ] Task 13-22: See audit report

### Low Priority (As Time Permits)
- [ ] Task 23-29: See audit report

---

## 🎯 SUCCESS CRITERIA

Before marking cleanup as complete:

1. ✅ All critical and high-priority tasks complete
2. ✅ No build artifacts in repository
3. ✅ No scattered test files in root
4. ✅ Security scanning in CI/CD
5. ✅ Console.log count reduced by 80%+
6. ✅ All TODOs documented in issues
7. ✅ XSS risks mitigated
8. ✅ Production build validated in CI

---

## 📝 NOTES

- **Always test after cleanup** - Run `pnpm test` and `pnpm build`
- **Review impact** - Some cleanups may affect running systems
- **Document decisions** - Update this file as tasks complete
- **Coordinate with team** - Some tasks require coordination

---

## 🔗 RELATED DOCUMENTS

- [Production Audit Report](./PRODUCTION_AUDIT_REPORT.md)
- [Security Runbook](./docs/SECURITY_RUNBOOK.md)
- [Contributing Guide](./docs/CONTRIBUTING.md) (create if needed)

---

**Last Updated:** January 29, 2026  
**Next Review:** After high-priority tasks complete  
