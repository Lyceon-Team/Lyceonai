/**
 * The route for every public content page (SEO Wave 3).
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 C1, C2] | @implemented [2026-10-05]
 *
 * plain English: finds the page for the current path in shared/content/pages and draws it in the
 * public layout with its breadcrumb; the article itself is ContentArticle, shared with the blog.
 */
import { useLocation } from "wouter";
import PublicLayout from "@/components/layout/PublicLayout";
import { Breadcrumb, Container } from "@/components/layout/primitives";
import { ContentArticle } from "@/components/content/ContentArticle";
import NotFound from "@/pages/not-found";
import { contentPageAt, CONTENT_PAGES } from "@shared/content/pages";
import type { ContentPage } from "@lyceon/shared/seo-content-schema";

function breadcrumbItems(
  page: ContentPage,
): { label: string; href?: string }[] {
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
