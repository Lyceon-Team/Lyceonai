import { Link, useRoute } from "wouter";
import { getPostBySlug, getAllPosts } from "@/lib/blog";
import { ArrowLeft, Tag, ArrowRight } from "lucide-react";
import PublicLayout from "@/components/layout/PublicLayout";
import { ContentArticle } from "@/components/content/ContentArticle";
import {
  Container,
  Breadcrumb,
  Card,
  Section,
} from "@/components/layout/primitives";

export default function BlogPostPage() {
  const [, params] = useRoute("/blog/:slug");
  const slug = params?.slug;
  const post = slug ? getPostBySlug(slug) : undefined;

  if (!post) {
    return (
      <PublicLayout>
        <Container className="py-24 text-center">
          <h1 className="text-2xl font-bold mb-4">Post not found</h1>
          <Link href="/blog" className="underline">
            Back to blog
          </Link>
        </Container>
      </PublicLayout>
    );
  }

  const relatedPosts = getAllPosts()
    .filter((p) => p.slug !== post.slug)
    .filter(
      (p) =>
        p.tags.some((tag) => post.tags.includes(tag)) ||
        p.category === post.category,
    )
    .slice(0, 2);

  return (
    <PublicLayout>
      <Container size="narrow">
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Blog", href: "/blog" },
            {
              label:
                post.title.length > 40
                  ? post.title.slice(0, 40) + "..."
                  : post.title,
            },
          ]}
          className="pt-8"
        />

        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to all posts
        </Link>

        {/* C4 (2026-10-05): the post is a content page, drawn by the same article renderer
            and checked by the same publish gate; it ends with the standard CTA. */}
        <ContentArticle
          page={post.page}
          byline={`${post.author} · ${post.category}`}
        />

        <div className="flex flex-wrap gap-2 mb-8">
          {post.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 px-3 py-1 bg-secondary rounded-full text-sm"
            >
              <Tag className="w-3 h-3" />
              {tag}
            </span>
          ))}
        </div>

        {relatedPosts.length > 0 && (
          <Section title="Related Posts" className="border-t border-border">
            <div className="grid md:grid-cols-2 gap-6">
              {relatedPosts.map((related) => (
                <Card key={related.slug} hover>
                  <Link href={`/blog/${related.slug}`} className="block group">
                    <h3 className="font-semibold mb-2 group-hover:opacity-80 transition-opacity">
                      {related.title}
                    </h3>
                    <p className="text-sm text-muted-foreground mb-3">
                      {related.description}
                    </p>
                    <span className="flex items-center gap-1 text-sm font-medium">
                      Read more <ArrowRight className="w-4 h-4" />
                    </span>
                  </Link>
                </Card>
              ))}
            </div>
          </Section>
        )}

        <Section className="border-t border-border">
          <Card className="text-center">
            <h2 className="text-xl font-semibold mb-3">
              Explore SAT Prep Resources
            </h2>
            <p className="text-muted-foreground mb-4">
              Put these strategies into practice with our Digital SAT guides.
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Link
                href="/online-sat-prep"
                className="px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90"
              >
                Online SAT Prep
              </Link>
              <Link
                href="/sat-practice-questions/math"
                className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-secondary"
              >
                SAT Math
              </Link>
              <Link
                href="/sat-practice-questions/reading-and-writing"
                className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-secondary"
              >
                Reading & Writing
              </Link>
            </div>
          </Card>
        </Section>
      </Container>
    </PublicLayout>
  );
}
