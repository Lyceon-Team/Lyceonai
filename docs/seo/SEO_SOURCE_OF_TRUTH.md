# SEO Source of Truth

This document defines the canonical ownership for public metadata, structured data, crawlability artifacts, and request/logging correlation for Lyceon’s public surfaces.

## Canonical Metadata Owner

Shared metadata lives in `shared/seo/public-meta.ts`.

It owns:
- `title`
- `description`
- `canonical`
- `ogImage`
- public JSON-LD definitions per route

`server/seo-content.ts` resolves metadata from the shared module and keeps public `bodyHtml` content in place.

## Canonical JSON-LD Owner (SSR Only)

Server-side rendering injects JSON-LD for SSR routes in `server/index.ts` via `injectJsonLd()`.

Client JSON-LD must not be used for SSR-owned public routes. Client JSON-LD is only permitted for non-SSR routes.

## Crawlability Owners

Canonical crawlability sources:
- `client/public/robots.txt`
- `client/public/sitemap.xml`

Sitemap URLs must be covered by SSR metadata either in `PUBLIC_SSR_ROUTES` or by the legal metadata fallback in `LEGAL_META`.

## Client Fallback Metadata

Client SEO (`client/src/components/SEO.tsx`) is a fallback only for routes that are not SSR-owned. SSR routes must not rely on client meta injection.

## Request/Logging Ownership

The single request correlation owner is:
- `server/middleware/request-id.ts`

`logger.generateRequestId()` remains the fallback only inside the final error boundary when a request ID is missing.

## Naming Guidance

Public metadata uses “tutor” generically. The branded name “Lisa” appears only where explicitly required for brand surfaces.
