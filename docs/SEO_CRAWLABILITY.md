# SEO Crawlability Verification

This document contains the exact curl commands to verify that all public pages are crawlable by search engines.

## What Makes a Page Crawlable

For each public route, the initial HTML response must contain:
- `<title>` with page-specific content in `<head>`
- `<meta name="description">` in `<head>`
- `<h1>` visible in `<body>` WITHOUT requiring JavaScript
- NOT just `<div id="root"></div>`

## Public Routes

The following routes have server-side rendered content:

| Route | Title |
|-------|-------|
| `/` | Lyceon – AI SAT Tutor with Real Practice Questions |
| `/digital-sat` | Digital SAT Practice – Free AI-Powered Prep |
| `/digital-sat/math` | Digital SAT Math Practice – AI Tutor |
| `/digital-sat/reading-writing` | Digital SAT Reading & Writing Practice – AI Tutor |
| `/blog` | SAT Prep Blog – Tips, Strategies & Insights |
| `/blog/is-digital-sat-harder` | Is the Digital SAT Harder Than the Paper SAT? |
| `/blog/digital-sat-scoring-explained` | Digital SAT Scoring Explained |
| `/blog/quick-sat-study-routine` | A Quick SAT Study Routine That Works |
| `/blog/sat-question-bank-practice` | How to Use a Question Bank for SAT Practice |
| `/blog/common-sat-math-algebra-mistakes` | Common SAT Math Algebra Mistakes to Avoid |
| `/legal` | Legal & Trust |
| `/legal/privacy-policy` | Privacy Policy |
| `/legal/student-terms` | Terms of Use |

## Verification Commands

### Check All Public Routes Have SSR Content

```bash
# Homepage
curl -s https://lyceon.ai/ | grep -E "<h1|<title>"

# Digital SAT section
curl -s https://lyceon.ai/digital-sat | grep -E "<h1|<title>"
curl -s https://lyceon.ai/digital-sat/math | grep -E "<h1|<title>"
curl -s https://lyceon.ai/digital-sat/reading-writing | grep -E "<h1|<title>"

# Blog
curl -s https://lyceon.ai/blog | grep -E "<h1|<title>"
curl -s https://lyceon.ai/blog/is-digital-sat-harder | grep -E "<h1|<title>"

# Legal
curl -s https://lyceon.ai/legal | grep -E "<h1|<title>"
curl -s https://lyceon.ai/legal/privacy-policy | grep -E "<h1|<title>"
curl -s https://lyceon.ai/legal/student-terms | grep -E "<h1|<title>"
```

### Verify SPA Routes Do NOT Have SSR Content

```bash
# Dashboard should return empty root div (SPA)
curl -s https://lyceon.ai/dashboard | grep '<div id="root">'
# Expected: <div id="root"></div>
```

### Check robots.txt

```bash
curl -s https://lyceon.ai/robots.txt
```

Expected output:
```
User-agent: *
Allow: /

# SEO-important pages
Allow: /digital-sat
Allow: /digital-sat/math
Allow: /digital-sat/reading-writing
Allow: /blog
Allow: /legal

# Disallow private routes
Disallow: /admin
Disallow: /auth/
Disallow: /api/
Disallow: /dashboard
Disallow: /profile

Sitemap: https://lyceon.ai/sitemap.xml
```

### Check sitemap.xml

```bash
# Verify sitemap is accessible
curl -sI https://lyceon.ai/sitemap.xml | head -5

# Check for private routes (should return nothing)
curl -s https://lyceon.ai/sitemap.xml | grep -E "/dashboard|/api|/app|/practice"
# Expected: no output (private routes not in sitemap)

# View sitemap contents
curl -s https://lyceon.ai/sitemap.xml | head -80
```

### Full SEO Element Check

```bash
# Check all meta tags for a specific page
curl -s https://lyceon.ai/ | grep -E "<title>|name=\"description\"|property=\"og:|<h1|<main"
```

## Architecture

SSR content is defined in `server/seo-content.ts` using the `PUBLIC_SSR_ROUTES` map. Each entry contains:
- `title`: Page-specific title
- `description`: Meta description
- `canonical`: Canonical URL
- `bodyHtml`: Full HTML content visible to crawlers

The server uses `servePublicSsr()` function in `server/index.ts` to:
1. Look up the route in `PUBLIC_SSR_ROUTES`
2. Inject meta tags via `injectMeta()`
3. Inject body content via `injectBodyContent()`
4. Return the fully rendered HTML

Private routes (dashboard, practice, etc.) fall through to the SPA handler and receive the standard React shell.

## Adding New Public Pages

To add a new crawlable page:

1. Add an entry to `PUBLIC_SSR_ROUTES` in `server/seo-content.ts`
2. Rebuild: `npm run build`
3. Add the route to `client/public/sitemap.xml`
4. Test with curl

Example:
```typescript
"/new-page": {
  title: "Page Title | Lyceon",
  description: "Description for search engines",
  canonical: "https://lyceon.ai/new-page",
  bodyHtml: `<main>...</main>`
}
```
