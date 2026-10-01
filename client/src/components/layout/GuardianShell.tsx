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
import { GuardianPaymentBanner } from "@/features/guardian/GuardianPaymentBanner";
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
  const { user } = useSupabaseAuth();
  return (
    <div
      className="min-h-screen bg-background text-foreground flex flex-col"
      data-testid="guardian-shell"
    >
      <GuardianHeader center={center} actions={actions} />
      {/* A payment problem is a notice above every guardian page, never a gate in front of
          one (owner ruling 2026-09-03; moved here from the retired dashboard 2026-10-01). */}
      <GuardianPaymentBanner enabled={user !== null && user !== undefined} />
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
 * LYCEON wordmark, on an OPAQUE cream (rgb 250 244 232). At header size the wordmark would be
 * unreadably small, so the viewBox shows only the MARK (centred at 512, 420 of 1024, about
 * 404px tall); the word "Lyceon" beside it is live text. No second asset is made.
 *
 * NO SQUARE BEHIND THE MARK (owner decision 2026-10-01, item 9). Drawn as a plain image, the
 * asset's cream showed as a square on the header's own, lighter cream background, and as a bright
 * one in dark mode. So the mark is drawn through an SVG filter instead: the asset's luminance
 * becomes its alpha (cream → transparent, the navy mark → opaque, the anti-aliased edge in
 * between) and the mark is painted in `currentColor` — the header's text colour, so it is
 * navy on cream and cream on navy. The browser check in `tests/e2e/guardian-surfaces.spec.ts`
 * reads the pixels at the mark's corners and requires them to be the header's.
 */
function LyceonMark(): JSX.Element {
  const filterId = `lyceon-mark-${React.useId().replace(/:/g, "")}`;
  // alpha = 1.6 − 2 × luminance (Rec. 709 weights): anything at or above L 0.8 — the cream and
  // its slightly darker grain (L ≈ 0.9–0.96) — is fully transparent; the navy mark
  // (L ≈ 0.18) is fully opaque.
  const ALPHA_FROM_LUMINANCE =
    "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.4252 -1.4304 -0.1444 0 1.6";
  return (
    <svg
      className="block h-10 w-10 shrink-0 text-foreground"
      viewBox="310 218 404 404"
      role="img"
      aria-label="Lyceon"
      data-testid="lyceon-logo"
    >
      <defs>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values={ALPHA_FROM_LUMINANCE}
            result="ink"
          />
          <feFlood floodColor="currentColor" />
          <feComposite in2="ink" operator="in" />
        </filter>
      </defs>
      <image
        href="/lyceon-logo.png"
        x="0"
        y="0"
        width="1024"
        height="1024"
        filter={`url(#${filterId})`}
      />
    </svg>
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
        {/* Phone: logo and actions on one row, the centre (the student switcher) on its own
            row below, so it is never squeezed to nothing. From `sm` up: one row, centre centred. */}
        <div className="grid min-h-16 grid-cols-[1fr_auto] items-center gap-x-2 gap-y-2 py-2 sm:grid-cols-[1fr_auto_1fr] sm:py-0">
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
            {/* On a phone the brand stays and the role label goes (owner decision
                2026-10-01, item 7); from `sm` up, both. */}
            <span className="font-bold text-lg">Lyceon</span>
            <span className="hidden text-base font-semibold text-muted-foreground sm:inline">
              Guardian
            </span>
          </Link>

          <div
            className={`min-w-0 justify-center ${center ? "flex" : "hidden sm:flex"} col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto`}
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
