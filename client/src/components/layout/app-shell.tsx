import * as React from "react";
import { useState } from "react";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Link, useLocation } from "wouter";
import {
  Menu,
  GraduationCap,
  LayoutDashboard,
  BookOpen,
  RotateCcw,
  MessageSquare,
  CreditCard,
  Settings,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { SkipLink } from "@/components/common/skip-link";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import Footer from "./Footer";
import { HeaderUserMenu, useHeaderSignOut } from "./HeaderUserMenu";

/**
 * The primary navigation, as data.
 *
 * @spec [issue #829 — one anchor per nav item] | @implemented [2026-09-22]
 *
 * EXPORTED SO THE TEST IS DRIVEN BY THE CONFIG, NOT BY A COPY OF IT. `app-shell.nav-anchors`
 * iterates this array, so a sixth nav item is covered the moment it is added here — rather
 * than needing someone to remember to write it a test. A test that lists the routes itself
 * is a second source of truth, and the one that drifts is always the copy.
 *
 * It closes over nothing, so module scope is where it always belonged; it lived inside
 * `AppHeader` only because that is where it was first written.
 */
export const navItems: readonly {
  href: string;
  label: string;
  icon: LucideIcon;
}[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/practice", label: "Practice", icon: BookOpen },
  { href: "/review", label: "Review", icon: RotateCcw },
  { href: "/full-test", label: "Full Tests", icon: CreditCard },
  { href: "/chat", label: "Lisa", icon: MessageSquare },
];

/** The testid a nav item carries, derived from its label in one place. */
export function navTestId(label: string): string {
  return `nav-${label.toLowerCase().replace(/\s+/g, "-")}`;
}

export function AppShell({
  children,
  className = "",
  hideNav = false,
  showFooter = false,
}: {
  children: React.ReactNode;
  className?: string;
  hideNav?: boolean;
  showFooter?: boolean;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {!hideNav && <AppHeader />}
      <main id="main" className={`flex-1 ${className}`}>
        {children}
      </main>
      {showFooter && <Footer />}
    </div>
  );
}

function AppHeader() {
  const [location, navigate] = useLocation();
  const { user } = useSupabaseAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // @spec [contracts/auth-standard-flow.contract.md AS-3] | @implemented 2026-06-20, shared 2026-09-11
  // plain English: one sign-out path for the mobile sheet and the desktop menu, shared with the
  // guardian shell through ./HeaderUserMenu so the two headers cannot drift.
  const { signOut: handleSignOut, isSigningOut } = useHeaderSignOut();

  const NavLink = ({
    href,
    label,
    icon: Icon,
    mobile = false,
  }: {
    href: string;
    label: string;
    icon: LucideIcon;
    mobile?: boolean;
  }) => {
    const isActive =
      location === href || (href !== "/dashboard" && location.startsWith(href));
    const baseClasses = mobile
      ? "flex items-center gap-3 px-4 py-3 rounded-lg transition-colors w-full"
      : "px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2";
    const activeClasses = isActive
      ? "bg-secondary text-foreground font-semibold border-b-2 border-foreground"
      : mobile
        ? "text-foreground/70 hover:bg-secondary"
        : "text-foreground/70 hover:text-foreground hover:bg-secondary";

    // ONE anchor, carrying the href, the testid, the label and the class (#829). The
    // wouter v2 idiom this replaced — a bare anchor child inside Link — renders a NESTED anchor
    // under wouter 3, and the inner one, the one with the testid, had no `href` at all:
    // middle-click, ⌘-click, open-in-new-tab, copy-link and screen-reader link
    // announcement were all broken on every tab in the product. Clicking worked, which is
    // why it survived. `Link` spreads every other prop onto the anchor it renders
    // (wouter@3.9.0 src/index.js:310-318), so nothing needs a wrapper to hold them.
    //
    // `onClick` closes the mobile sheet and is DELIBERATELY not shimmed for modified
    // clicks: wouter skips it on a ⌘-click, and a sheet that stays open in this tab while
    // the link opens in another is the correct outcome, not an oversight.
    return (
      <Link
        href={href}
        className={`${baseClasses} ${activeClasses}`}
        data-testid={navTestId(label)}
        onClick={() => mobile && setMobileMenuOpen(false)}
      >
        <Icon className={mobile ? "h-5 w-5" : "h-4 w-4"} />
        {label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur">
      <SkipLink />
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          {/* The wordmark is the way home. It was already a Link to /dashboard — but with
              the href on the outer anchor and the testid on an inner one that had none, so
              it was unusable by every means except a plain left click (#829). The focus
              ring and the title are new: a link a keyboard user cannot see they have
              reached is not reachable. */}
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-foreground hover:opacity-80 transition-opacity rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="logo-link"
            title="Lyceon home — your dashboard"
          >
            <GraduationCap className="h-6 w-6 text-foreground" />
            <span className="font-bold text-lg hidden sm:inline">Lyceon</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
          </nav>

          {/* User Menu */}
          <div className="flex items-center gap-2">
            {/* Notifications Bell */}
            {user && <NotificationBell />}

            {/* Mobile Menu Button */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild className="md:hidden">
                <Button
                  variant="ghost"
                  size="icon"
                  data-testid="button-mobile-menu"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-64 bg-background border-border"
              >
                <div className="flex flex-col gap-4 mt-8">
                  {navItems.map((item) => (
                    <NavLink key={item.href} {...item} mobile />
                  ))}
                  <Separator />
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-3"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      navigate("/profile");
                    }}
                    data-testid="button-profile-mobile"
                  >
                    <Settings className="h-5 w-5" />
                    Settings
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-3"
                    disabled={isSigningOut}
                    onClick={async () => {
                      setMobileMenuOpen(false);
                      await handleSignOut();
                    }}
                    data-testid="button-signout-mobile"
                  >
                    <LogOut className="h-5 w-5" />
                    {isSigningOut ? "Signing out..." : "Sign Out"}
                  </Button>
                </div>
              </SheetContent>
            </Sheet>

            {/* Desktop User Dropdown — shared with the guardian shell */}
            <HeaderUserMenu
              signOut={handleSignOut}
              isSigningOut={isSigningOut}
              fallbackName="Student"
            />
          </div>
        </div>
      </div>
    </header>
  );
}
