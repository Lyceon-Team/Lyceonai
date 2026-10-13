/**
 * The homepage's navigation bar.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md F13; owner-approved homepage design
 *       2026-10-05, section 1 (How it works · Question of the Day · For parents · Pricing, 44px
 *       tap targets, "Sign in" outlined, "Get started" filled)] | @implemented [2026-10-05]
 *
 * plain English: the four links jump to the homepage's own sections, so this bar belongs to the
 * homepage; every other public page keeps PublicNavBar. Below the md breakpoint the four section
 * links are hidden (the hero's two buttons and the page itself carry them), so the bar stays one
 * row on a phone. A signed-in visitor sees "Dashboard" instead of the two account buttons.
 */
import { Link } from "wouter";
import { LyceonMark } from "@/components/common/LyceonMark";
import { SIGN_IN_HREF, SIGN_UP_HREF } from "@/lib/marketing-links";

const SECTION_LINKS = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Question of the Day", href: "#question-of-the-day" },
  { label: "For parents", href: "#for-parents" },
  { label: "Pricing", href: "#pricing" },
] as const;

const TAP = "inline-flex min-h-11 items-center no-underline";

export function HomeNav({
  isAuthenticated,
  homeHref,
}: {
  isAuthenticated: boolean;
  homeHref: string;
}): JSX.Element {
  return (
    <header className="border-b border-[var(--home-rule)] bg-background">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-4 py-3 sm:px-6"
      >
        <Link
          href="/"
          className={`${TAP} gap-2.5 text-[22px] font-bold text-foreground`}
        >
          <LyceonMark decorative className="h-6 w-6" />
          Lyceon
        </Link>
        <div className="flex items-center gap-3 sm:gap-6">
          <ul className="hidden items-center gap-6 text-[15px] font-medium lg:flex">
            {SECTION_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className={`${TAP} px-1 hover:underline underline-offset-4`}
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          {isAuthenticated ? (
            <Link
              href={homeHref}
              className={`${TAP} rounded-[10px] bg-foreground px-5 font-semibold text-background hover:opacity-90`}
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                href={SIGN_IN_HREF}
                className={`${TAP} rounded-[10px] border-[1.5px] border-foreground px-4 font-semibold hover:bg-card`}
              >
                Sign in
              </Link>
              <Link
                href={SIGN_UP_HREF}
                className={`${TAP} rounded-[10px] bg-foreground px-4 font-semibold text-background hover:opacity-90 sm:px-5`}
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
