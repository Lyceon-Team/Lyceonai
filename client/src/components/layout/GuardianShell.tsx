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
import { Link, useLocation } from "wouter";
import { Users } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { guardianPaths } from "@/features/guardian/paths";
import { SkipLink } from "@/components/common/skip-link";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { HeaderUserMenu, useHeaderSignOut } from "./HeaderUserMenu";
import "@/features/guardian/guardian-surface.css";
import "@/features/guardian/guardian-type-floor.generated.css";

/**
 * G4-01 (Wave 4 layout, Karl 2026-09-28): ONE shell on every guardian page. The top bar is
 * logo left, `center` (the student switcher, G4-02) in the middle, and `actions` (Add
 * student, G4-02) beside the bell and the profile menu on the right. `subnav` is the tab row
 * (Dashboard / Calendar) centred under the bar on a student's pages. A page that is not about
 * one student (no students yet, the profile) passes none of them and gets the bar alone.
 */
export function GuardianShell({
  children,
  className = "",
  center,
  actions,
  subnav,
}: {
  children: React.ReactNode;
  className?: string;
  center?: React.ReactNode;
  actions?: React.ReactNode;
  subnav?: React.ReactNode;
}) {
  // G4-07 (R12): scope the type floor to the whole document while a guardian page is
  // mounted, so portaled content (the profile menu, the bell, dialogs) is floored as well.
  React.useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-guardian-surface", "");
    return () => root.removeAttribute("data-guardian-surface");
  }, []);
  return (
    <div
      className="min-h-screen bg-background text-foreground flex flex-col"
      data-testid="guardian-shell"
    >
      <GuardianHeader center={center} actions={actions} />
      {subnav}
      <main id="main" className={`flex-1 ${className}`}>
        {children}
      </main>
    </div>
  );
}

/**
 * G4-07 (R12): the real Lyceon logo, not a graduation-cap icon. The one logo asset,
 * `client/public/lyceon-logo.png`, is a 1024px square — the hexagon-and-book mark above the
 * LYCEON wordmark on the brand cream. At header size the wordmark would be unreadably small,
 * so this shows the asset's MARK through a 40px window (the asset itself is unchanged and no
 * second asset is made); the word "Lyceon" beside it is live text. The window's numbers are
 * the mark's bounds in the asset: centred at (512, 420) of 1024, about 404px tall, drawn at
 * 100px so the mark fills the 40px window.
 */
function LyceonMark(): JSX.Element {
  return (
    <span
      className="relative block h-10 w-10 shrink-0 overflow-hidden"
      data-testid="lyceon-logo"
    >
      <img
        src="/lyceon-logo.png"
        alt="Lyceon"
        width={100}
        height={100}
        className="absolute max-w-none"
        style={{ left: -30, top: -21 }}
      />
    </span>
  );
}

function GuardianHeader({
  center,
  actions,
}: {
  center?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const { user } = useSupabaseAuth();
  const signOut = useHeaderSignOut();
  const [, navigate] = useLocation();

  return (
    <header
      className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur"
      data-testid="guardian-shell-header"
    >
      <SkipLink />
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-2">
          {/* The guardian's way home is /guardian, not /dashboard — a different page, so
              the control is pointed at theirs rather than hidden from them. Same focus
              ring and title as the student shell: the two headers are meant to behave
              identically, and the shells test exists because they have drifted before. */}
          <Link
            href="/guardian"
            className="flex w-fit items-center gap-2 text-foreground no-underline hover:opacity-80 transition-opacity rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="logo-link"
            title="Lyceon home — your guardian dashboard"
          >
            <LyceonMark />
            <span className="font-bold text-lg hidden sm:inline">Lyceon</span>
            <span className="text-base font-semibold text-muted-foreground">
              Guardian
            </span>
          </Link>

          <div
            className="flex min-w-0 justify-center"
            data-testid="guardian-shell-center"
          >
            {center}
          </div>

          <div className="flex items-center justify-end gap-2">
            {actions}
            {/* Notifications Bell — the same mount as AppShell; the shells test enforces it. */}
            {user && <NotificationBell />}
            <HeaderUserMenu
              {...signOut}
              fallbackName="Guardian"
              items={
                <DropdownMenuItem
                  onClick={() => navigate(guardianPaths.students)}
                  data-testid="menu-linked-students"
                >
                  <Users className="mr-2 h-4 w-4" aria-hidden="true" />
                  Linked students &amp; billing
                </DropdownMenuItem>
              }
            />
          </div>
        </div>
      </div>
    </header>
  );
}

export default GuardianShell;
