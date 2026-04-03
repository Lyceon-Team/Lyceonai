import { BLOG_POSTS, type BlogPost } from "@shared/content/blog";

export type { BlogPost } from "@shared/content/blog";

const posts: BlogPost[] = BLOG_POSTS;

export function getAllPosts(): BlogPost[] {
  return posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
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

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}
