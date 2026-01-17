import { Link, useRoute } from 'wouter';
import { SEO, JsonLd, createBreadcrumbJsonLd, createArticleJsonLd } from '@/components/SEO';
import { getPostBySlug, getAllPosts, formatDate } from '@/lib/blog';
import { Calendar, User, ArrowLeft, Tag, ArrowRight } from 'lucide-react';
import PublicLayout from '@/components/layout/PublicLayout';
import { Container, Breadcrumb, Card, Section } from '@/components/layout/primitives';

function parseMarkdown(content: string): string {
  let html = content
    .replace(/^## (.+)$/gm, '<h2 class="text-2xl font-semibold mt-10 mb-4">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 class="text-xl font-semibold mt-8 mb-3">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li class="ml-6 list-disc">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-6 list-decimal"><span class="font-semibold">$1.</span> $2</li>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="underline underline-offset-2 hover:opacity-80">$1</a>')
    .replace(/\n\n/g, '</p><p class="mb-4 leading-relaxed">')
    .replace(/<\/li>\n<li/g, '</li><li');
  
  html = '<p class="mb-4 leading-relaxed">' + html + '</p>';
  
  html = html.replace(/<p class="mb-4 leading-relaxed">(<h[23])/g, '$1');
  html = html.replace(/(<\/h[23]>)<\/p>/g, '$1');
  html = html.replace(/<p class="mb-4 leading-relaxed">(<li)/g, '<ul class="mb-4 space-y-2">$1');
  html = html.replace(/(<\/li>)<\/p>/g, '$1</ul>');
  
  return html;
}

export default function BlogPostPage() {
  const [, params] = useRoute('/blog/:slug');
  const slug = params?.slug;
  const post = slug ? getPostBySlug(slug) : undefined;

  if (!post) {
    return (
      <PublicLayout>
        <Container className="py-24 text-center">
          <h1 className="text-2xl font-bold mb-4">Post not found</h1>
          <Link href="/blog">
            <a className="underline">Back to blog</a>
          </Link>
        </Container>
      </PublicLayout>
    );
  }

  const relatedPosts = getAllPosts()
    .filter(p => p.slug !== post.slug)
    .filter(p => p.tags.some(tag => post.tags.includes(tag)) || p.category === post.category)
    .slice(0, 2);

  return (
    <PublicLayout>
      <SEO
        title={post.title}
        description={post.description}
        canonical={`https://lyceon.ai/blog/${post.slug}`}
        ogType="article"
        article={{
          publishedTime: post.date,
          author: post.author,
          tags: post.tags,
        }}
      />
      <JsonLd data={createBreadcrumbJsonLd([
        { name: 'Home', url: 'https://lyceon.ai' },
        { name: 'Blog', url: 'https://lyceon.ai/blog' },
        { name: post.title, url: `https://lyceon.ai/blog/${post.slug}` },
      ])} />
      <JsonLd data={createArticleJsonLd({
        title: post.title,
        description: post.description,
        url: `https://lyceon.ai/blog/${post.slug}`,
        image: 'https://lyceon.ai/og-image.jpg',
        datePublished: post.date,
        author: post.author,
      })} />

      <Container size="narrow">
        <Breadcrumb 
          items={[
            { label: 'Home', href: '/' },
            { label: 'Blog', href: '/blog' },
            { label: post.title.length > 40 ? post.title.slice(0, 40) + '...' : post.title },
          ]} 
          className="pt-8"
        />

        <Link href="/blog">
          <a className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft className="w-4 h-4" />
            Back to all posts
          </a>
        </Link>

        <article className="pb-12">
          <header className="mb-10">
            <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
              <span className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                {formatDate(post.date)}
              </span>
              <span className="flex items-center gap-1">
                <User className="w-4 h-4" />
                {post.author}
              </span>
              <span className="px-2 py-0.5 bg-secondary rounded text-xs">
                {post.category}
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold mb-4 leading-tight">
              {post.title}
            </h1>
            <p className="text-xl text-muted-foreground leading-relaxed">
              {post.description}
            </p>
          </header>

          <div
            className="text-foreground"
            dangerouslySetInnerHTML={{ __html: parseMarkdown(post.content) }}
          />

          {/* Inline CTA - positioned after main content */}
          <div className="my-8 p-6 bg-secondary border border-border rounded-xl">
            <p className="text-sm text-muted-foreground mb-2">Ready to put this into practice?</p>
            <p className="font-semibold mb-4">Start practicing SAT questions with AI-powered explanations.</p>
            <Link href="/practice">
              <a className="inline-block px-5 py-2.5 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
                Start Free Practice
              </a>
            </Link>
          </div>

          <div className="flex flex-wrap gap-2 mt-8 pt-8 border-t border-border">
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
        </article>

        {relatedPosts.length > 0 && (
          <Section title="Related Posts" className="border-t border-border">
            <div className="grid md:grid-cols-2 gap-6">
              {relatedPosts.map((related) => (
                <Card key={related.slug} hover>
                  <Link href={`/blog/${related.slug}`}>
                    <a className="block group">
                      <h3 className="font-semibold mb-2 group-hover:opacity-80 transition-opacity">
                        {related.title}
                      </h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        {related.description}
                      </p>
                      <span className="flex items-center gap-1 text-sm font-medium">
                        Read more <ArrowRight className="w-4 h-4" />
                      </span>
                    </a>
                  </Link>
                </Card>
              ))}
            </div>
          </Section>
        )}

        <Section className="border-t border-border">
          <Card className="text-center">
            <h2 className="text-xl font-semibold mb-3">Explore SAT Prep Resources</h2>
            <p className="text-muted-foreground mb-4">
              Put these strategies into practice with our comprehensive guides.
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Link href="/digital-sat">
                <a className="px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90">
                  Digital SAT Overview
                </a>
              </Link>
              <Link href="/digital-sat/math">
                <a className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-secondary">
                  SAT Math
                </a>
              </Link>
              <Link href="/digital-sat/reading-writing">
                <a className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-secondary">
                  Reading & Writing
                </a>
              </Link>
            </div>
          </Card>
        </Section>
      </Container>
    </PublicLayout>
  );
}
