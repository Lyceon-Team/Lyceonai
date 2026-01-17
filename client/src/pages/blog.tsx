import { Link } from 'wouter';
import { SEO, JsonLd, organizationJsonLd, websiteJsonLd, createBreadcrumbJsonLd } from '@/components/SEO';
import { getAllPosts, getAllCategories, formatDate } from '@/lib/blog';
import { Calendar, Tag, ArrowRight } from 'lucide-react';
import PublicLayout from '@/components/layout/PublicLayout';
import { Container, Hero, Card, Breadcrumb, Section } from '@/components/layout/primitives';

export default function BlogPage() {
  const posts = getAllPosts();
  const categories = getAllCategories();

  return (
    <PublicLayout>
      <SEO
        title="SAT Prep Blog - Tips, Strategies & Study Guides"
        description="Expert SAT prep tips, study strategies, and guides for the Digital SAT. Learn how to improve your score with actionable advice."
        canonical="https://lyceon.ai/blog"
      />
      <JsonLd data={organizationJsonLd} />
      <JsonLd data={websiteJsonLd} />
      <JsonLd data={createBreadcrumbJsonLd([
        { name: 'Home', url: 'https://lyceon.ai' },
        { name: 'Blog', url: 'https://lyceon.ai/blog' },
      ])} />

      <Container>
        <Breadcrumb items={[
          { label: 'Home', href: '/' },
          { label: 'Blog' },
        ]} className="pt-8" />

        <Hero
          title="SAT Prep Blog"
          subtitle="Tips, strategies, and insights to help you master the Digital SAT."
        />

        <div className="flex flex-wrap gap-2 mb-12">
          {categories.map((category) => (
            <span
              key={category}
              className="px-3 py-1 text-sm bg-secondary rounded-full text-foreground"
            >
              {category}
            </span>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {posts.map((post) => (
            <Card key={post.slug} as="article" hover>
              <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
                <span className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {formatDate(post.date)}
                </span>
                <span className="px-2 py-0.5 bg-secondary rounded text-xs">
                  {post.category}
                </span>
              </div>
              <Link href={`/blog/${post.slug}`}>
                <a className="block group">
                  <h2 className="text-xl font-semibold mb-2 group-hover:opacity-80 transition-opacity">
                    {post.title}
                  </h2>
                </a>
              </Link>
              <p className="text-muted-foreground mb-4">{post.description}</p>
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-2">
                  {post.tags.slice(0, 2).map((tag) => (
                    <span
                      key={tag}
                      className="flex items-center gap-1 text-xs text-muted-foreground"
                    >
                      <Tag className="w-3 h-3" />
                      {tag}
                    </span>
                  ))}
                </div>
                <Link href={`/blog/${post.slug}`}>
                  <a className="flex items-center gap-1 text-sm font-medium text-foreground hover:opacity-80">
                    Read more <ArrowRight className="w-4 h-4" />
                  </a>
                </Link>
              </div>
            </Card>
          ))}
        </div>

        <Section className="py-16">
          <Card className="text-center">
            <h2 className="text-2xl font-semibold mb-4">Ready to Start Practicing?</h2>
            <p className="text-muted-foreground mb-6">
              Put these tips into action with our AI-powered SAT practice.
            </p>
            <Link href="/digital-sat">
              <a className="inline-block px-6 py-3 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity">
                Explore SAT Prep
              </a>
            </Link>
          </Card>
        </Section>
      </Container>
    </PublicLayout>
  );
}
