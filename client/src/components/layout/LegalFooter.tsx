/**
 * @spec [DESIGN.md §2 App shell "Slim legal footer"; student-UI register §2 ("Marketing footer is
 *        removed from app pages; legal links move under Help"); UI-41] | @implemented [2026-10-03]
 *
 * plain English: the slim footer at the end of the content column on Home, Practice, Review,
 * Full-Length, Settings and Help (chosen per route in `lib/route-shells.ts`). 14px, muted,
 * underlined on hover, links to the existing public legal routes.
 *
 * Help: `HELP_PATH` is the one target of the rail's Help item, the avatar menu's Help and this
 * footer's "Help and FAQs". OQ-46 (owner ruling, Karl, 2026-10-03) kept it on the legal hub
 * "until the Help page lands in Wave 5"; the Help page landed with UI-58 (2026-10-03), so it now
 * points there.
 */
import { Link } from "wouter";

export const HELP_PATH = "/help";

const LINK_CLASS =
  "text-lyc-muted no-underline hover:text-lyc-ink-strong hover:underline";

const LINKS: readonly { readonly label: string; readonly href: string }[] = [
  { label: "Privacy Policy", href: "/legal/privacy-policy" },
  { label: "Terms", href: "/legal/student-terms" },
  { label: "Trust and Safety", href: "/legal/trust-and-safety" },
  { label: "Help and FAQs", href: HELP_PATH },
];

export function LegalFooter(): JSX.Element {
  return (
    <footer
      aria-label="Legal and help"
      data-testid="legal-footer"
      className="mt-[72px] flex max-w-[800px] flex-wrap items-center gap-x-[22px] gap-y-2 border-t border-lyc-rule-soft pt-[18px] text-lyc-meta text-lyc-muted"
    >
      <span>© 2026 Lyceon</span>
      {LINKS.map((link) => (
        <Link key={link.label} href={link.href} className={LINK_CLASS}>
          {link.label}
        </Link>
      ))}
    </footer>
  );
}
