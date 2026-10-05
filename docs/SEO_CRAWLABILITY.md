# SEO Crawlability Runbook

Updated 2026-10-03 (SEO Wave 1A). Sources of truth: `docs/seo/SEO_SOURCE_OF_TRUTH.md`.

Public pages are prerendered to static HTML at build, so a crawler that runs no JavaScript gets each
page's own title, self-canonical, Open Graph tags, JSON-LD and body text. Signed-in routes get the SPA
shell (`app.html`, noindex). Anything else is a real HTTP 404 (`404.html`, noindex).

## Check a deployment

```bash
node scripts/seo/crawl-check.mjs https://lyceon.ai
# a protected preview: VERCEL_AUTOMATION_BYPASS_SECRET=<secret> node scripts/seo/crawl-check.mjs https://<preview>
```

It fetches every `sitemap.xml` URL as Googlebot and as OAI-SearchBot (no JavaScript), and reports
status, title, whether the canonical is the page's own URL, JSON-LD types and body word count. Then it
checks that `/does-not-exist`, `/blog/not-a-post` and `/legal/not-a-document` are 404 and noindex,
`/privacy` and `/terms` are 301s, legal assets still serve, and `/dashboard` gets the noindex shell.
It exits 1 on any failure.

Single checks:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://lyceon.ai/does-not-exist     # 404
curl -s -A "Googlebot" https://lyceon.ai/digital-sat | grep -E "<title>|rel=\"canonical\""
curl -s https://lyceon.ai/sitemap.xml | head -20
curl -s https://lyceon.ai/robots.txt
```

## Check the build locally

```bash
pnpm -s run build && pnpm run gate:seo-output   # sitemap ↔ registry ↔ prerendered pages
pnpm run route:validate                          # App.tsx ↔ registry ↔ docs/route-registry.md
pnpm exec vitest run tests/seo.prerender-output.test.ts tests/seo.route-registry.test.ts
```
