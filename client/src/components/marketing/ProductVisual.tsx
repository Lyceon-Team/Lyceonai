/**
 * The "See how it works" product visual: three real product screens in one 16:9 frame.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md F13; owner ruling 2026-10-05: until the
 *       walkthrough video exists, real product screenshots captured from the built app with test
 *       fixtures, never a placeholder] | @implemented [2026-10-05]
 *
 * plain English: the screens are produced by scripts/marketing/capture-product-shots.mjs from
 * fixture data (fixture questions only, never question-bank content) and served from
 * /images/home/. One screen shows at a time; the buttons switch it. Every image is lazy and
 * carries its size, so it costs nothing above the fold and cannot shift the layout.
 */
import { useState } from "react";

const SCREENS = [
  {
    key: "practice",
    label: "Practice",
    src: "/images/home/product-practice.jpg",
    alt: "A Lyceon practice question with four answer choices.",
  },
  {
    key: "review",
    label: "Review",
    src: "/images/home/product-review.jpg",
    alt: "A Lyceon practice question after answering, with the correct answer and a worked explanation.",
  },
  {
    key: "parent",
    label: "Parent view",
    src: "/images/home/product-parent.jpg",
    alt: "The read-only parent and guardian view: this week's plan and progress in each topic of both SAT sections.",
  },
] as const;

type ScreenKey = (typeof SCREENS)[number]["key"];

export function ProductVisual(): JSX.Element {
  const [active, setActive] = useState<ScreenKey>("practice");
  const screen = SCREENS.find((s) => s.key === active) ?? SCREENS[0];
  return (
    <figure className="mx-auto flex w-full max-w-[960px] flex-col gap-3">
      <div
        role="group"
        aria-label="Product screens"
        className="flex flex-wrap justify-center gap-2"
      >
        {SCREENS.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={s.key === active}
            onClick={() => setActive(s.key)}
            className={`min-h-11 rounded-full border-[1.5px] px-4 text-sm font-semibold transition-colors ${
              s.key === active
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-foreground hover:border-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="aspect-video w-full overflow-hidden rounded-[20px] border border-border bg-card">
        <img
          key={screen.key}
          src={screen.src}
          alt={screen.alt}
          width={1280}
          height={720}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover object-top"
        />
      </div>
      <figcaption className="text-center text-[13px] text-[var(--home-caption)]">
        Screens from the product, with example data.
      </figcaption>
    </figure>
  );
}
