# SEO Source of Truth

Updated 2026-10-03 (SEO Wave 1A: F1, F2, F3, F4, F12 — `docs/plans/seo/seo-marketing-vertical.md` §5).
The Express SSR path this document used to describe (`server/seo-content.ts`, `injectMeta`,
`injectJsonLd`) never ran on Vercel and has been deleted.

| What | Single source | Consumers |
|---|---|---|
| Which routes exist, and which are public / prerendered / in the sitemap | `infra/route-surface-classification.yaml` (Doc 06A §5.3.1) | `pnpm run route:validate` (App.tsx ↔ YAML ↔ `docs/route-registry.md`), the prerender, `vercel.json`, `sitemap.xml`, robots test |
| Per-page title, description, canonical, OG image, JSON-LD | `shared/seo/public-meta.ts` (+ `structured-data.ts`) | the prerender (`shared/seo/head.ts`) |
| FAQ copy | the `*_FAQS` arrays in `shared/seo/public-meta.ts` | the page renders them AND the FAQPage JSON-LD is built from them |
| Page body | the React pages themselves | rendered at build by `client/src/prerender/entry-server.tsx` |
| Legal document bodies | `legal/<slug>/<version>/en.md` | the legal pages, loaded at build through the same query the page runs |
| Sitemap | generated at build from the registry + content dates (blog `date`, legal `effective_date`, registry `last_modified`) | `dist/public/sitemap.xml` |
| robots.txt | `client/public/robots.txt` | held to the registry by `tests/seo.route-registry.test.ts` |

## How a public page is built

`pnpm run build` → client build → `pnpm run build:prerender` (Vite SSR build of
`client/src/prerender/entry-server.tsx`, then `scripts/build/prerender.mjs`) writes
`dist/public/<route>/index.html` for every prerendered row, `404.html` (noindex), `app.html` (the SPA
shell, noindex) and `sitemap.xml`.

`vercel.json` (derived from the registry, checked by `tests/seo.route-registry.test.ts`): 301s for
redirect rows → filesystem (prerendered pages, assets, legal files) → SPA shell for every
non-prerendered route → 404 for everything else.

## Adding a public page

1. Add the `<Route>` to `client/src/App.tsx`.
2. Add a row to `infra/route-surface-classification.yaml` (`prerender: true`, `indexable: true`, `last_modified`).
3. Add its metadata to `PUBLIC_META` in `shared/seo/public-meta.ts` (the build fails without it).
4. Add the row to `docs/route-registry.md`.
5. `pnpm run build && pnpm run gate:seo-output && pnpm test`.

Every public surface is governed by the Public Disclosure Doctrine (CLAUDE.md; plan §0).
