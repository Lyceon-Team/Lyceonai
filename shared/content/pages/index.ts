/**
 * Every public content page (SEO Wave 3), parsed against the one content schema.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 C1, C2] | @implemented [2026-10-05]
 *
 * plain English: the single list the router (client/src/App.tsx), the head and JSON-LD
 * (shared/seo/public-meta.ts), the route validator (scripts/validate-route-registry.mjs), the
 * prerender and the publish gate all read. Each page is parsed here, at import, so a page that
 * does not fit the schema fails the build before anything renders.
 */
import {
  contentPageSchema,
  type ContentPage,
} from "../../../packages/shared/src/seo-content-schema";
import { GUIDE_PAGES } from "./guides";
import { CONTENT_PAGE_PATHS } from "./paths";
import { PARENT_PAGES } from "./parents";
import { PRACTICE_QUESTION_PAGES } from "./practice-questions";
import { SCORE_PAGES } from "./scores";

function parseAll(): readonly ContentPage[] {
  const pages = [
    ...PRACTICE_QUESTION_PAGES,
    ...SCORE_PAGES,
    ...GUIDE_PAGES,
    ...PARENT_PAGES,
  ].map((input) => {
    const parsed = contentPageSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(
        `content page ${input.path} does not fit the content schema: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
    }
    return parsed.data;
  });
  const seen = new Set<string>();
  for (const page of pages) {
    if (seen.has(page.path))
      throw new Error(`content page ${page.path} is declared twice`);
    seen.add(page.path);
  }
  const declared = [...CONTENT_PAGE_PATHS].sort().join("\n");
  const actual = pages.map((p) => p.path).sort().join("\n");
  if (declared !== actual) {
    throw new Error(
      "shared/content/pages/paths.ts does not list exactly the content pages' paths",
    );
  }
  return pages;
}

export const CONTENT_PAGES: readonly ContentPage[] = parseAll();

/** The content page at `path`, or undefined. */
export function contentPageAt(path: string): ContentPage | undefined {
  return CONTENT_PAGES.find((page) => page.path === path);
}
