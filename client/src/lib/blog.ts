import { BLOG_POSTS, type BlogPost } from "@shared/content/blog";

export type { BlogPost } from "@shared/content/blog";

const posts: readonly BlogPost[] = BLOG_POSTS;

/** Newest first; a copy, so the shared list is never reordered in place. */
export function getAllPosts(): BlogPost[] {
  return [...posts].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return posts.find(post => post.slug === slug);
}

export function getPostsByTag(tag: string): BlogPost[] {
  return posts.filter(post => post.tags.includes(tag));
}

export function getPostsByCategory(category: string): BlogPost[] {
  return posts.filter(post => post.category === category);
}

export function getAllTags(): string[] {
  const tags = new Set<string>();
  posts.forEach(post => post.tags.forEach(tag => tags.add(tag)));
  return Array.from(tags).sort();
}

export function getAllCategories(): string[] {
  const categories = new Set<string>();
  posts.forEach(post => categories.add(post.category));
  return Array.from(categories).sort();
}

/**
 * "2026-10-05" -> "October 5, 2026". Read in UTC: a bare date parses as UTC midnight, so formatting
 * it in a US time zone showed the day before (the rewrite date is now shown, decision 6).
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}
