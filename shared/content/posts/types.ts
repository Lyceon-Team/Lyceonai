/**
 * The shape of a pipeline blog post (Doc 10B §4 stage 3, "Draft complete in the repo content
 * model").
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §4, §8.2, §8.3; Doc 10A §8.2 ("One content model feeds every
 *       page and blog post")] | @implemented [2026-10-11]
 *
 * plain English: one module per post, `shared/content/posts/<slug>.ts`, default-exporting this
 * object. The post is a content page like every other (same schema, same gate, same renderer);
 * the extra fields say which cycle approved it (`batch`), when it goes public (`publishAt`,
 * America/Chicago) and the search term it owns (`targetKeyword`). `published` is the publish
 * date and `lastModified` the publish date or a later correction (`updated`); `approved` is
 * never written here: it comes from the cycle's stamp in content/batches/approvals.json.
 */
import type { ContentPageInput } from "../../../packages/shared/src/seo-content-schema";

export type ScheduledPostSpec = {
  /** The URL slug: `/blog/<slug>`. Must equal the module's file name. */
  slug: string;
  category: string;
  tags: string[];
  /** The cycle whose batch pull request carries this post, e.g. `2026-W43`. */
  batch: string;
  /** When the post goes public, America/Chicago wall time, `YYYY-MM-DDTHH:mm`. */
  publishAt: string;
  /** The one search term this post owns (Doc 10B §5 gate 11). */
  targetKeyword: string;
  /** A correction after publication (Doc 10B §10), YYYY-MM-DD; needs a new cycle's approval. */
  updated?: string;
  page: Omit<
    ContentPageInput,
    | "path"
    | "published"
    | "lastModified"
    | "approved"
    | "crumb"
    | "publishAt"
    | "targetKeyword"
  >;
};
