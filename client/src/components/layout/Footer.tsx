import { Link } from "wouter";
import { GraduationCap } from "lucide-react";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  const footerLinks = {
    product: [
      { label: "Digital SAT Prep", href: "/digital-sat" },
      { label: "SAT Math", href: "/digital-sat/math" },
      { label: "SAT Reading & Writing", href: "/digital-sat/reading-writing" },
    ],
    resources: [
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
    <footer className="border-t border-border bg-background">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
          <div className="col-span-2 md:col-span-1">
            <Link href="/">
              <a className="flex items-center gap-2 text-foreground mb-4">
                <GraduationCap className="h-5 w-5" />
                <span className="font-bold">Lyceon</span>
              </a>
            </Link>
            <p className="text-sm text-muted-foreground">
              AI-powered SAT tutoring for the digital age.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-4">Product</h3>
            <ul className="space-y-2">
              {footerLinks.product.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>
                    <a className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      {link.label}
                    </a>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-4">Resources</h3>
            <ul className="space-y-2">
              {footerLinks.resources.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>
                    <a className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      {link.label}
                    </a>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-4">Legal</h3>
            <ul className="space-y-2">
              {footerLinks.legal.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>
                    <a className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      {link.label}
                    </a>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-border text-center text-sm text-muted-foreground">
          {currentYear} Lyceon. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
