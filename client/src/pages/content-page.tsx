/**
 * The one renderer for every public content page (SEO Wave 3).
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 C1, C2, C3; owner decisions on Wave 3 Step 0,
 *       2026-10-05 (decision 4: the live Stripe price; decision 5: the standard "Start the free
 *       diagnostic" CTA)] | @implemented [2026-10-05]
 *
 * plain English: draws a page from its content object (shared/content/pages): breadcrumb, one
 * <h1>, the intro, each section under its own <h2>/<h3>, sources under the text they back, the
 * FAQ (the same items the FAQPage JSON-LD is built from), and the update date. Inline links are
 * the only markup in the copy; everything else is React text, so it is escaped.
 *
 * The publish gate reads the rendered <article data-content-page>: exactly one <h1>, no skipped
 * heading level, every internal link resolving. Keep every heading of the page inside it.
 *
 * edge cases:
 *  - The live price cell renders the Stripe price as the homepage pricing card does, or "Monthly
 *    subscription" with no number when there is none (the prerendered HTML always shows the
 *    latter: nothing is fetched at build time).
 *  - Past Questions of the Day load in their own chunk (KaTeX), so a page without them never
 *    downloads it.
 */
import { lazy, Suspense, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import PublicLayout from "@/components/layout/PublicLayout";
import { Breadcrumb, Container } from "@/components/layout/primitives";
import { SourceLinks } from "@/components/common/source-links";
import NotFound from "@/pages/not-found";
import { START_DIAGNOSTIC_HREF } from "@/lib/marketing-links";
import {
  formatMonthlyPrice,
  getPublicMonthlyPrice,
} from "@/lib/public-pricing";
import { contentPageAt, CONTENT_PAGES } from "@shared/content/pages";
import { faqParagraphs } from "@shared/seo/faqs";
import type {
  ContentBlock,
  ContentPage,
  ContentSource,
  TableCell,
} from "@lyceon/shared/seo-content-schema";

const QotdSamples = lazy(() => import("@/components/content/QotdSamples"));

const LINK_CLASS = "underline underline-offset-2 hover:opacity-80";

/** Text with `[label](href)` links: internal links route in-app, external ones open a new tab. */
function InlineText({ text }: { text: string }): JSX.Element {
  const parts: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const index = m.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    const label = m[1] ?? "";
    const href = m[2] ?? "";
    parts.push(
      href.startsWith("/") ? (
        <Link key={index} href={href} className={LINK_CLASS}>
          {label}
        </Link>
      ) : (
        <a
          key={index}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_CLASS}
        >
          {label}
        </a>
      ),
    );
    last = index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** The Pro monthly price from Stripe, read exactly as the homepage pricing card reads it. */
function LivePrice(): JSX.Element {
  const { data } = useQuery({
    queryKey: ["/api/public/pricing"],
    queryFn: getPublicMonthlyPrice,
    retry: 1,
  });
  const price = formatMonthlyPrice(data ?? null);
  return (
    <span data-testid="live-price">
      {price === null
        ? "Monthly subscription for Pro"
        : `${price} a month for Pro`}
      , with a free plan. <InlineText text="[See the price](/#pricing)" />
    </span>
  );
}

function Cell({ cell }: { cell: TableCell }): JSX.Element {
  return typeof cell === "string" ? <InlineText text={cell} /> : <LivePrice />;
}

function Sources({
  sources,
}: {
  sources: readonly ContentSource[] | undefined;
}): JSX.Element | null {
  return <SourceLinks sources={sources} />;
}

function Block({ block }: { block: ContentBlock }): JSX.Element {
  switch (block.type) {
    case "p":
      return (
        <div>
          <p className="leading-relaxed">
            <InlineText text={block.text} />
          </p>
          <Sources sources={block.sources} />
        </div>
      );
    case "ul":
      return (
        <div>
          <ul className="list-disc space-y-2 pl-6 leading-relaxed">
            {block.items.map((item) => (
              <li key={item}>
                <InlineText text={item} />
              </li>
            ))}
          </ul>
          <Sources sources={block.sources} />
        </div>
      );
    case "table":
      return (
        <div>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="px-4 pt-3 text-left font-semibold">
                {block.caption}
              </caption>
              <thead>
                <tr>
                  {block.head.map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="border-b border-border px-4 py-2 font-semibold"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r} className="align-top">
                    {row.map((cell, c) =>
                      c === 0 ? (
                        <th
                          key={c}
                          scope="row"
                          className="border-b border-border px-4 py-2 font-medium"
                        >
                          <Cell cell={cell} />
                        </th>
                      ) : (
                        <td key={c} className="border-b border-border px-4 py-2">
                          <Cell cell={cell} />
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.note ? (
            <p className="mt-2 text-xs text-muted-foreground">{block.note}</p>
          ) : null}
          <Sources sources={block.sources} />
        </div>
      );
    case "links":
      return (
        <ul className="space-y-2">
          {block.items.map((item) => (
            <li key={item.href}>
              <InlineText text={`[${item.label}](${item.href})`} />
            </li>
          ))}
        </ul>
      );
    case "qotd":
      return (
        <Suspense fallback={null}>
          <QotdSamples filter={block.filter} limit={block.limit} />
        </Suspense>
      );
    case "cta":
      return (
        <div className="rounded-2xl border border-border bg-secondary p-6 text-center">
          <p className="mb-4 text-muted-foreground">
            Start with the free diagnostic. No credit card required.
          </p>
          <Link
            href={START_DIAGNOSTIC_HREF}
            className="inline-block rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90"
            data-testid="button-content-start-diagnostic"
          >
            Start the free diagnostic
          </Link>
        </div>
      );
  }
}

function Blocks({
  blocks,
}: {
  blocks: readonly ContentBlock[];
}): JSX.Element {
  return (
    <div className="space-y-5">
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}

/** "2026-10-05" -> "October 5, 2026", in UTC so the build machine's zone never shifts it. */
function formatDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function breadcrumbItems(page: ContentPage): { label: string; href?: string }[] {
  const trail: { label: string; href?: string }[] = [{ label: page.crumb }];
  let parentPath = page.parent;
  while (parentPath !== undefined) {
    const parent = CONTENT_PAGES.find((p) => p.path === parentPath);
    if (!parent) break;
    trail.unshift({ label: parent.crumb, href: parent.path });
    parentPath = parent.parent;
  }
  return [{ label: "Home", href: "/" }, ...trail];
}

function ContentArticle({ page }: { page: ContentPage }): JSX.Element {
  return (
    <article data-content-page={page.path} className="space-y-8 pb-16">
      <header className="space-y-4">
        <h1 className="text-3xl font-bold leading-tight md:text-4xl">
          {page.h1}
        </h1>
        <p className="text-sm text-muted-foreground">
          Updated {formatDay(page.lastModified)}
        </p>
        {page.intro.length > 0 ? <Blocks blocks={page.intro} /> : null}
      </header>
      {page.sections.map((section, i) => (
        <section key={i} className="space-y-4">
          {section.level === 2 ? (
            <h2 className="text-2xl font-semibold">{section.heading}</h2>
          ) : (
            <h3 className="text-xl font-semibold">{section.heading}</h3>
          )}
          <Blocks blocks={section.blocks} />
        </section>
      ))}
      {page.faq.length > 0 ? (
        <section className="space-y-4" aria-labelledby="content-faq">
          <h2 id="content-faq" className="text-2xl font-semibold">
            Frequently asked questions
          </h2>
          {page.faq.map((item) => (
            <div
              key={item.question}
              className="rounded-2xl border border-border bg-card p-5"
            >
              <h3 className="mb-2 font-semibold">{item.question}</h3>
              <div className="space-y-2 text-muted-foreground">
                {faqParagraphs(item.answer).map((paragraph) => (
                  <p key={paragraph}>
                    <InlineText text={paragraph} />
                  </p>
                ))}
              </div>
              <Sources sources={item.sources} />
            </div>
          ))}
        </section>
      ) : null}
    </article>
  );
}

export default function ContentPageRoute(): JSX.Element {
  const [location] = useLocation();
  const path =
    location.length > 1 && location.endsWith("/")
      ? location.slice(0, -1)
      : location;
  const page = contentPageAt(path);
  if (!page) return <NotFound />;
  return (
    <PublicLayout>
      <Container size="narrow">
        <Breadcrumb items={breadcrumbItems(page)} className="pt-8" />
        <ContentArticle page={page} />
      </Container>
    </PublicLayout>
  );
}
