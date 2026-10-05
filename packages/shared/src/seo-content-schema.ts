/**
 * The content schema for public SEO pages (SEO Wave 3, plan row C1).
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §0 (Public Disclosure Doctrine) rules 3, 4, 5;
 *       §5 C1 ("one content schema"), C3 (publish gate); owner decisions on Wave 3 Step 0,
 *       2026-10-05; Coding Standards §7.2 (schema first, types inferred)] | @implemented [2026-10-05]
 *
 * plain English: every public content page (the practice-question hub and its section and
 * domain pages, the score pages, the parent pages, the free-practice-test page, the online prep
 * page and the study guide) is one object of this shape. The page renderer, the head and
 * JSON-LD (shared/seo/public-meta.ts) and the publish gate (shared/seo/content-gate.ts) all read
 * the same object, so the words a visitor reads, the words a search engine quotes and the words
 * the gate checked cannot drift apart.
 *
 * Every block of text says what backs it: `sources` (external pages, Doctrine rule 3) and/or
 * `claims` (row IDs in docs/compliance/claim-inventory.md, rule 4). The schema allows a block
 * with neither, and a page without `approved`, so a draft can be written down; the gate is what
 * refuses to BUILD either one, with a message that names the block.
 *
 * Inline text may carry links as `[label](/path)` or `[label](https://…)`. Nothing else is
 * markup: the renderer escapes everything else.
 *
 * edge cases:
 *  - A table cell may be `{ livePrice: true }`: the Pro monthly price, read from Stripe at
 *    runtime exactly as the homepage pricing card reads it (owner ruling 2026-09-03; Wave 3
 *    decision 4). There is no way to write a price into page data.
 *  - `qotd` blocks name a section or a canonical domain; the page shows up to `limit` past
 *    Questions of the Day from it (R20a), never today's.
 */
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** An external source behind a general fact (Doctrine rule 3). Rendered as a link under the text. */
export const contentSourceSchema = z
  .object({
    label: z.string().min(1),
    url: z.string().url().startsWith("https://"),
  })
  .strict();
export type ContentSource = z.infer<typeof contentSourceSchema>;

/** A claim-inventory row ID, e.g. `W12` (docs/compliance/claim-inventory.md). */
export const claimIdSchema = z.string().regex(/^[A-Z]{1,2}\d+[a-z]?$/);

const basis = {
  sources: z.array(contentSourceSchema).optional(),
  claims: z.array(claimIdSchema).optional(),
};

const paragraphBlockSchema = z
  .object({ type: z.literal("p"), text: z.string().min(1), ...basis })
  .strict();

const listBlockSchema = z
  .object({
    type: z.literal("ul"),
    items: z.array(z.string().min(1)).min(1),
    ...basis,
  })
  .strict();

/** A table cell: text, or the live Pro price (never a number in the data). */
export const tableCellSchema = z.union([
  z.string(),
  z.object({ livePrice: z.literal(true) }).strict(),
]);
export type TableCell = z.infer<typeof tableCellSchema>;

const tableBlockSchema = z
  .object({
    type: z.literal("table"),
    caption: z.string().min(1),
    head: z.array(z.string().min(1)).min(2),
    rows: z.array(z.array(tableCellSchema).min(2)).min(1),
    /** Shown under the table, e.g. what the percentile groups mean and when a page was viewed. */
    note: z.string().min(1).optional(),
    ...basis,
  })
  .strict()
  .superRefine((table, ctx) => {
    table.rows.forEach((row, i) => {
      if (row.length !== table.head.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `table "${table.caption}" row ${i + 1} has ${row.length} cells for ${table.head.length} columns`,
        });
      }
    });
  });

/** Internal navigation: link labels name pages, they state nothing, so they carry no basis. */
const linksBlockSchema = z
  .object({
    type: z.literal("links"),
    items: z
      .array(
        z.object({ label: z.string().min(1), href: z.string().min(1) }).strict(),
      )
      .min(1),
  })
  .strict();

/** Up to `limit` past Questions of the Day from a section or one canonical domain (R20a). */
const qotdBlockSchema = z
  .object({
    type: z.literal("qotd"),
    filter: z.union([
      z.object({ section: z.enum(["M", "RW"]) }).strict(),
      z.object({ domain: z.string().min(1) }).strict(),
    ]),
    limit: z.number().int().min(1).max(2),
  })
  .strict();

/** The one standard call to action: "Start the free diagnostic" (claim inventory W40). */
const ctaBlockSchema = z.object({ type: z.literal("cta") }).strict();

export const contentBlockSchema = z.union([
  paragraphBlockSchema,
  listBlockSchema,
  tableBlockSchema,
  linksBlockSchema,
  qotdBlockSchema,
  ctaBlockSchema,
]);
export type ContentBlock = z.infer<typeof contentBlockSchema>;

export const contentSectionSchema = z
  .object({
    heading: z.string().min(1),
    /** 2 = <h2>, 3 = <h3>. The gate checks the order on the rendered page. */
    level: z.union([z.literal(2), z.literal(3)]),
    blocks: z.array(contentBlockSchema).min(1),
  })
  .strict();
export type ContentSection = z.infer<typeof contentSectionSchema>;

export const contentFaqItemSchema = z
  .object({
    question: z.string().min(1),
    /** Paragraphs separated by a blank line, as the existing FAQ copy is. */
    answer: z.string().min(1),
    ...basis,
  })
  .strict();
export type ContentFaqItem = z.infer<typeof contentFaqItemSchema>;

export const contentApprovalSchema = z
  .object({ by: z.literal("Karl"), date: isoDate })
  .strict();

export const contentPageSchema = z
  .object({
    /** The page's URL path, e.g. `/sat-tutor-cost`. */
    path: z.string().regex(/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/),
    /** <title>. The gate holds it to 60 characters. */
    title: z.string().min(1),
    /** <meta name="description">. The gate holds it to 120–160 characters. */
    description: z.string().min(1),
    h1: z.string().min(1),
    /** The breadcrumb label for this page. */
    crumb: z.string().min(1),
    /** The parent page's path, for the breadcrumb (Home is always first). */
    parent: z.string().optional(),
    intro: z.array(contentBlockSchema).default([]),
    sections: z.array(contentSectionSchema).min(1),
    faq: z.array(contentFaqItemSchema).default([]),
    /** First published (Article datePublished). */
    published: isoDate,
    /** Last content change (Article dateModified, sitemap lastmod via the registry). */
    lastModified: isoDate,
    /** Karl's written approval of this page's copy. Required to build; never on a draft. */
    approved: contentApprovalSchema.optional(),
  })
  .strict();
export type ContentPage = z.infer<typeof contentPageSchema>;
export type ContentPageInput = z.input<typeof contentPageSchema>;
