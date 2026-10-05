/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 F1, F4] | @implemented [2026-10-03]
 *
 * plain English: the ONE prerendered-site fixture for tests. It runs the real build-time renderer
 * (`prerenderSite` in client/src/prerender/entry-server.tsx) over the real registry, content and
 * `client/index.html`, once per test process (the Question of the Day archive comes from
 * tests/lib/qotd-fixture.ts, itself real SQL output), so every SEO test asserts on what the build emits —
 * never on a hand-written page (CLAUDE.md, "derive the fixture from real output").
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  prerenderSite,
  type PrerenderedSite,
} from "../../client/src/prerender/entry-server";
import {
  parseRouteRegistry,
  type RouteRegistryRow,
} from "../../shared/seo/route-registry";
import { toArchiveResponse } from "../../shared/qotd/projection";
import {
  QOTD_FIXTURE_NOW,
  qotdArchiveDays,
  qotdTodayRow,
} from "./qotd-fixture";

export const REPO_ROOT = resolve(__dirname, "../..");

let site: Promise<PrerenderedSite> | undefined;

export function getPrerenderedSite(): Promise<PrerenderedSite> {
  site ??= prerenderSite({
    repoRoot: REPO_ROOT,
    template: readFileSync(resolve(REPO_ROOT, "client/index.html"), "utf8"),
    // The Question of the Day archive from the shared fixture (real SQL output), plus TODAY's
    // row projected as if it were an archive day: the prerender must drop it, which
    // tests/seo.qotd-pages.test.ts asserts.
    qotdArchive: [...qotdArchiveDays(), toArchiveResponse(qotdTodayRow())],
    now: QOTD_FIXTURE_NOW,
  });
  return site;
}

export function loadRouteRegistry(): RouteRegistryRow[] {
  return parseRouteRegistry(
    readFileSync(
      resolve(REPO_ROOT, "infra/route-surface-classification.yaml"),
      "utf8",
    ),
  );
}

/** Text a crawler reads in the page body: markup, scripts and styles removed, entities decoded. */
export function bodyText(html: string): string {
  const start = html.indexOf('<div id="root">');
  const body = start === -1 ? html : html.slice(start);
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every JSON-LD block in the page, parsed. */
export function jsonLdBlocks(html: string): Record<string, unknown>[] {
  return [
    ...html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    ),
  ].map((m) => JSON.parse(m[1] ?? "null") as Record<string, unknown>);
}
