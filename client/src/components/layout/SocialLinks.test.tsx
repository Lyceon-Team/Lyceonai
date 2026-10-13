// @vitest-environment jsdom
/**
 * @spec [owner brief 2026-10-10 (SEO vertical, social profile links)] | @implemented [2026-10-10]
 *
 * plain English: the public footer, in both of its tones, carries one link per official profile:
 * the URL from shared/seo/social-profiles.ts (pinned here to the brief's four, so a typo in the
 * constant fails), the label "Lyceon on <platform>", a new tab with rel="noopener noreferrer",
 * and an inline, hidden-from-screen-readers SVG. Nothing in the footer loads from elsewhere.
 */
import React from "react";
import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Footer from "./Footer";
import { SOCIAL_PROFILES } from "@shared/seo/social-profiles";

/** The owner brief's four profiles, in order. */
const BRIEF = [
  ["Instagram", "https://www.instagram.com/lyceon.ai"],
  ["TikTok", "https://www.tiktok.com/@lyceon.ai"],
  ["X", "https://x.com/lyceonai"],
  ["YouTube", "https://www.youtube.com/@lyceonai"],
];

describe("footer social links", () => {
  it("the config holds exactly the brief's four profiles, in order", () => {
    expect(SOCIAL_PROFILES.map((p) => [p.platform, p.url])).toEqual(BRIEF);
  });

  for (const tone of ["default", "navy"] as const) {
    it(`renders the four links with labels, a new tab and rel (${tone} tone)`, () => {
      const { container } = render(<Footer tone={tone} />);
      const footer = container.querySelector("footer");
      if (!footer) throw new Error("no <footer>");
      // Presence first: exactly the four profile links, in order.
      const links = Array.from(
        footer.querySelectorAll<HTMLAnchorElement>(
          'a[data-testid^="footer-social-"]',
        ),
      );
      expect(links.map((a) => a.getAttribute("href"))).toEqual(
        BRIEF.map(([, url]) => url),
      );
      links.forEach((a, i) => {
        const [platform] = BRIEF[i] ?? [];
        expect(a.getAttribute("aria-label")).toBe(`Lyceon on ${platform}`);
        expect(a.getAttribute("target")).toBe("_blank");
        expect(a.getAttribute("rel")).toBe("noopener noreferrer");
        const svg = a.querySelector("svg");
        expect(svg?.getAttribute("aria-hidden")).toBe("true");
        expect(
          svg?.querySelector("path")?.getAttribute("d")?.length,
        ).toBeGreaterThan(50);
      });
      // Each is reachable by its accessible name.
      for (const [platform] of BRIEF)
        expect(
          within(footer).getByRole("link", { name: `Lyceon on ${platform}` }),
        ).toBeTruthy();
      // Nothing loads from the platforms: no images, frames, scripts or external use/href refs.
      expect(
        footer.querySelectorAll("img, iframe, script, object, embed, use"),
      ).toHaveLength(0);
    });
  }
});
