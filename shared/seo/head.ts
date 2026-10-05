/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 F1, F2] | @implemented [2026-10-03]
 *
 * plain English: turns a page's metadata from `public-meta.ts` into the `<head>` tags the
 * prerendered HTML carries — title, description, self-canonical, Open Graph, Twitter card and
 * JSON-LD — or, for the 404 page, a title, description and `noindex` with no canonical.
 *
 * trade-offs:
 *  - Every value is escaped here, at the one sink. Metadata is our own copy today, but a title
 *    with an ampersand or a quote must not produce broken HTML, and JSON-LD must not be able to
 *    close its <script> (`<` is written as <).
 *
 * edge cases:
 *  - A page with no jsonLd gets no JSON-LD script at all.
 */
import { DEFAULT_OG_IMAGE } from "./structured-data";
import { NOT_FOUND_META, type PublicMeta } from "./public-meta";

/** Marker comments in client/index.html between which the per-page head is written. */
export const HEAD_START_MARKER = "<!-- seo:head:start -->";
export const HEAD_END_MARKER = "<!-- seo:head:end -->";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jsonLdScript(data: Record<string, unknown>): string {
  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  return `<script type="application/ld+json">${json}</script>`;
}

export function renderPageHead(meta: PublicMeta): string {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const canonical = escapeHtml(meta.canonical);
  const image = escapeHtml(meta.ogImage ?? DEFAULT_OG_IMAGE);
  const tags = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${canonical}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Lyceon" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${title}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    ...(meta.jsonLd ?? []).map(jsonLdScript),
  ];
  return tags.join("\n    ");
}

export function renderNotFoundHead(): string {
  return [
    `<title>${escapeHtml(NOT_FOUND_META.title)}</title>`,
    `<meta name="description" content="${escapeHtml(NOT_FOUND_META.description)}" />`,
    `<meta name="robots" content="noindex" />`,
  ].join("\n    ");
}

/** Replaces the marked head block of the built index.html. Throws if the markers are missing. */
export function withHead(template: string, head: string): string {
  const start = template.indexOf(HEAD_START_MARKER);
  const end = template.indexOf(HEAD_END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      "index.html has no seo:head markers — the prerender cannot place the page head",
    );
  }
  return `${template.slice(0, start + HEAD_START_MARKER.length)}\n    ${head}\n    ${template.slice(end)}`;
}

/** Puts the rendered page markup inside the empty root div. Throws if it is not there exactly once. */
export function withBody(template: string, bodyHtml: string): string {
  const root = '<div id="root"></div>';
  const first = template.indexOf(root);
  if (first === -1 || template.indexOf(root, first + 1) !== -1) {
    throw new Error(
      'index.html must contain exactly one empty <div id="root"></div>',
    );
  }
  return `${template.slice(0, first)}<div id="root">${bodyHtml}</div>${template.slice(first + root.length)}`;
}
