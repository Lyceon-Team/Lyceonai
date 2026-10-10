/**
 * Lyceon's official social profiles: the single source of truth for every place the site names them.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §0 rule 1 ("Industry standard only"); owner
 *       brief 2026-10-10 (SEO vertical, social profile links: "one config constant, the single
 *       source of truth")] | @implemented [2026-10-10]
 *
 * plain English: the public footer's icon row (client/src/components/layout/SocialLinks.tsx) and
 * the Organization JSON-LD's `sameAs` (shared/seo/structured-data.ts) both read this list, so a
 * profile added or changed here changes both, in the same order. Links only: nothing on the site
 * loads from these platforms (no embeds, scripts or pixels), so the page CSP is unchanged.
 */
export type SocialProfile = {
  /** Stable key; the footer picks the icon by it. */
  readonly id: "instagram" | "tiktok" | "x" | "youtube";
  /** The platform's own name, as it brands itself. */
  readonly platform: string;
  readonly url: string;
};

export const SOCIAL_PROFILES: readonly SocialProfile[] = [
  {
    id: "instagram",
    platform: "Instagram",
    url: "https://www.instagram.com/lyceon.ai",
  },
  {
    id: "tiktok",
    platform: "TikTok",
    url: "https://www.tiktok.com/@lyceon.ai",
  },
  { id: "x", platform: "X", url: "https://x.com/lyceonai" },
  {
    id: "youtube",
    platform: "YouTube",
    url: "https://www.youtube.com/@lyceonai",
  },
];

/** The profile URLs in list order: the Organization's `sameAs`. */
export const SOCIAL_PROFILE_URLS: readonly string[] = SOCIAL_PROFILES.map(
  (p) => p.url,
);
