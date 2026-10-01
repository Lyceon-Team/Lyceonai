/**
 * @spec [Doc-01_V8 §31.3 (guardian access derives from a linked student's entitlement),
 *        §38.1/§38.2 (a guardian sees identity and progress, nothing more); CLAUDE.md guardian
 *        model (view-only, zero LISA access); contracts/notifications.contract.md §3 (the bell
 *        is the in-app surface for every recipient, guardian included); lyceon-coding-standards
 *        §11.3] | @implemented [2026-09-11]
 *
 * plain English: the guardian portal's chrome. Until 2026-09-11 the guardian dashboard had no
 * layout component at all: it painted its own title block and nothing else, so a guardian had
 * no notification bell, no user menu and no sign-out on the only page they use. This shell is
 * the guardian counterpart of `AppShell`, deliberately without the student navigation: a
 * guardian has no practice, calendar, exams or tutor to navigate to, and hiding those links
 * here is a UI courtesy — every one of those routes is `RequireRole allow={["student",
 * "admin"]}` on the server side of the client and the API enforces the role again. The bell
 * mounts here exactly as it does in `AppShell`, and `shells.notification-bell.test.tsx`
 * refuses any shell file in this directory that does not mount it.
 */
import * as React from "react";
import { Link } from "wouter";
import { GraduationCap } from "lucide-react";
import { SkipLink } from "@/components/common/skip-link";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { HeaderUserMenu, useHeaderSignOut } from "./HeaderUserMenu";

export function GuardianShell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <GuardianHeader />
      <main id="main" className={`flex-1 ${className}`}>
        {children}
      </main>
    </div>
  );
}

function GuardianHeader() {
  const { user } = useSupabaseAuth();
  const signOut = useHeaderSignOut();

  return (
    <header
      className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur"
      data-testid="guardian-shell-header"
    >
      <SkipLink />
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* The guardian's way home is /guardian, not /dashboard — a different page, so
              the control is pointed at theirs rather than hidden from them. Same focus
              ring and title as the student shell: the two headers are meant to behave
              identically, and the shells test exists because they have drifted before. */}
          <Link
            href="/guardian"
            className="flex items-center gap-2 text-foreground hover:opacity-80 transition-opacity rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="logo-link"
            title="Lyceon home — your guardian dashboard"
          >
            <GraduationCap className="h-6 w-6 text-foreground" />
            <span className="font-bold text-lg hidden sm:inline">Lyceon</span>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Guardian
            </span>
          </Link>

          <div className="flex items-center gap-2">
            {/* Notifications Bell — the same mount as AppShell; the shells test enforces it. */}
            {user && <NotificationBell />}
            <HeaderUserMenu {...signOut} fallbackName="Guardian" />
          </div>
        </div>
      </div>
    </header>
  );
}

export default GuardianShell;
