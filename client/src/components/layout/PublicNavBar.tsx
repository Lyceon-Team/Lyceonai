import { Link, useLocation } from "wouter";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { GraduationCap } from "lucide-react";

export default function PublicNavBar() {
  const [location] = useLocation();
  const { user, isAuthenticated } = useSupabaseAuth();

  const navLinks = [
    { label: "Home", href: "/" },
    { label: "Digital SAT", href: "/digital-sat" },
    { label: "Blog", href: "/blog" },
  ];

  return (
    <nav className="sticky top-0 w-full bg-background/95 backdrop-blur-sm border-b border-border z-50">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/">
          <a className="flex items-center gap-2 text-foreground hover:opacity-80 transition-opacity">
            <GraduationCap className="h-6 w-6" />
            <span className="font-bold text-lg">Lyceon</span>
          </a>
        </Link>

        <div className="flex items-center gap-8">
          <div className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href}>
                <a
                  className={`text-sm font-medium transition-opacity ${
                    location === link.href || location.startsWith(link.href + "/")
                      ? "text-foreground underline underline-offset-4 font-semibold"
                      : "text-foreground/70 hover:text-foreground"
                  }`}
                >
                  {link.label}
                </a>
              </Link>
            ))}
          </div>

          {isAuthenticated ? (
            <Link href="/dashboard">
              <a className="px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
                Dashboard
              </a>
            </Link>
          ) : (
            <div className="flex items-center gap-3">
              <Link href="/login">
                <a className="text-sm font-medium text-foreground/70 hover:text-foreground transition-opacity">
                  Sign In
                </a>
              </Link>
              <Link href="/login">
                <a className="px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
                  Get Started
                </a>
              </Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
