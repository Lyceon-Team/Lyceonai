import { Link } from "wouter";
import { GraduationCap } from "lucide-react";
import { openCookieSettings } from "@/lib/analytics/consent";

/**
 * `navy`: the homepage's footer band (F13, owner-approved design 2026-10-05). Same links, same
 * notice; only the colours change, so the link set stays one list for every public page.
 */
export type FooterTone = "default" | "navy";

export default function Footer({ tone = "default" }: { tone?: FooterTone }) {
  const currentYear = new Date().getFullYear();
  const navy = tone === "navy";
  const linkClass = navy
    ? "text-sm text-[var(--home-footer-text)] underline-offset-2 hover:underline"
    : "text-sm text-muted-foreground hover:text-foreground transition-colors";
  const mutedClass = navy
    ? "text-[var(--home-footer-muted)]"
    : "text-muted-foreground";

  const footerLinks = {
    // SEO Wave 3 (2026-10-05): the /digital-sat pages 301 to these; the footer links the pages
    // themselves, so no public link rides a redirect.
    product: [
      { label: "Online SAT Prep", href: "/online-sat-prep" },
      { label: "SAT Practice Questions", href: "/sat-practice-questions" },
      { label: "SAT Math", href: "/sat-practice-questions/math" },
      {
        label: "SAT Reading & Writing",
        href: "/sat-practice-questions/reading-and-writing",
      },
    ],
    resources: [
      { label: "What Is a Good SAT Score?", href: "/what-is-a-good-sat-score" },
      { label: "Free SAT Practice Tests", href: "/free-sat-practice-test" },
      { label: "How to Study for the SAT", href: "/how-to-study-for-the-sat" },
      { label: "SAT Tutor Cost", href: "/sat-tutor-cost" },
      { label: "Blog", href: "/blog" },
    ],
    legal: [
      { label: "Trust & Safety", href: "/trust" },
      { label: "Legal Hub", href: "/legal" },
      { label: "Privacy Policy", href: "/legal/privacy-policy" },
      { label: "Terms of Use", href: "/legal/student-terms" },
    ],
  };

  return (
    <footer
      className={
        navy
          ? "bg-foreground text-[var(--home-footer-text)]"
          : "border-t border-border bg-background"
      }
    >
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
          <div className="col-span-2 md:col-span-1">
            <Link
              href="/"
              className={`flex items-center gap-2 mb-4 ${navy ? "text-background no-underline" : "text-foreground"}`}
            >
              <GraduationCap className="h-5 w-5" />
              <span className="font-bold">Lyceon</span>
            </Link>
            {/* Slogan approved by Karl 2026-10-05 (F13; claim inventory X1). */}
            <p className={`text-sm ${mutedClass}`}>
              Study Smarter, Score Higher.
            </p>
          </div>

          <div>
            <h3
              className={`font-semibold text-sm mb-4 ${navy ? "text-background" : ""}`}
            >
              Product
            </h3>
            <ul className="space-y-2">
              {footerLinks.product.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={linkClass}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3
              className={`font-semibold text-sm mb-4 ${navy ? "text-background" : ""}`}
            >
              Resources
            </h3>
            <ul className="space-y-2">
              {footerLinks.resources.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={linkClass}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3
              className={`font-semibold text-sm mb-4 ${navy ? "text-background" : ""}`}
            >
              Legal
            </h3>
            <ul className="space-y-2">
              {footerLinks.legal.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={linkClass}>
                    {link.label}
                  </Link>
                </li>
              ))}
              {/* Doc 10 §9.11 withdrawal: "Cookie settings" (cookie-banner-text.md, Footer link). */}
              <li>
                <button
                  type="button"
                  onClick={openCookieSettings}
                  className={linkClass}
                >
                  Cookie settings
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div
          className={`pt-8 border-t text-center text-sm ${navy ? "border-white/20" : "border-border"} ${mutedClass}`}
        >
          <p>© {currentYear} Lyceon. All rights reserved.</p>
          {/* The standard trademark notice used across SAT-prep sites (owner answer 6,
              2026-10-03): on every public page, since every public page renders this footer. */}
          <p className="mt-2">
            SAT® is a trademark registered by the College Board, which is not
            affiliated with, and does not endorse, this product.
          </p>
        </div>
      </div>
    </footer>
  );
}
