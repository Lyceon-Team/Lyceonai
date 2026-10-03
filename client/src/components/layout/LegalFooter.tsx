/**
 * @spec [DESIGN.md §2 App shell "Slim legal footer"; student-UI register §2 ("Marketing footer is
 *        removed from app pages; legal links move under Help"); UI-41] | @implemented [2026-10-03]
 *
 * plain English: the slim footer at the end of the content column on Home, Practice, Review,
 * Full-Length, Settings and Help (chosen per route in `lib/route-shells.ts`). 14px, muted,
 * underlined on hover, links to the existing public legal routes.
 *
 * Help: no Help page is routed yet (the prototype has one; no register row builds it). Until it
 * lands, "Help" and "Help and FAQs" go to the legal hub, which holds every link the footer would
 * otherwise carry. `HELP_PATH` is the one line to change. Listed as an owner question in the UI-41
 * report.
 */
import { Link } from "wouter";

export const HELP_PATH = "/legal";

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
