/**
 * The student App shell: the left rail, the content column and the right margin panel.
 *
 * @spec [student-UI register UI-41; DESIGN.md §2 "App shell", "Free plan", "Mobile (OQ-4)"; §1
 *        "Focus and motion" (3px --focus ring, no motion), 14px minimum, tokens only; register §2
 *        Free versus paid (rail locks; ruling 3 calendar exception; no call to the gated
 *        endpoint); OQ-4 (five-tab bar; its contents superseded 2026-10-05, below); OQ-29
 *        (locks from the feature-access map, reason plan | age); issue #829 (one anchor per nav
 *        item); contracts/notifications.contract.md §3 (the bell); OQ-47 (bell in the rail
 *        above Help, ruled 2026-10-03); OQ-48 (avatar menu, ruled 2026-10-03); owner ruling
 *        (Karl, 2026-10-05; supersedes OQ-4, OQ-48 and the Full-Length part of OQ-62): desktop
 *        rail unchanged; phone tabs Home, Review, Practice, Calendar, LISA; avatar menu Settings,
 *        Help, Sign out (admins keep Crisis review); Full-Length on a phone only from a
 *        scheduled calendar block or the Home card; register §8 F-70 (the avatar dropdown
 *        follows the page theme)] | @implemented [2026-10-03; tab bar and menu 2026-10-05]
 *
 * plain English: replaces the old top-nav student header. Desktop (lg, 1024px and up): a 96px
 * --rail column (logo and wordmark; Home, Practice, Review, Full-Length, Calendar, LISA, icon
 * above label; then the bell, Help and the account avatar), the content column (the only part
 * that scrolls; 800px max, 56px 72px padding) and, when the route has one, the right panel
 * (360 / 340 / 320px, --margin, hairline left rule, scrolling on its own). Below lg the same
 * <header> is a top bar (logo, bell, avatar menu), a five-tab bar sits at the bottom (Home,
 * Review, Practice, Calendar, LISA; Full-Length is on neither phone surface), and the right panel
 * stacks under the content.
 *
 * WHY lg (1024px). Tailwind's default screens are unchanged in tailwind.config.ts. At the rail
 * (96) plus the panel (360) plus the content padding (2 × 72) the fixed chrome is 600px, which
 * leaves 168px of content at md (768px) and 424px at lg. md cannot hold the desktop layout; lg can.
 *
 * LOCKS. A rail item's lock comes ONLY from `useFeatureAccess()` (the OQ-29 map on
 * GET /api/profile). Full-Length and LISA, when locked, render as a <button> that opens the
 * upgrade modal with the map's reason (`age` shows the age message): there is no href, so there
 * is nothing to navigate to and no gated request is made. Calendar, when locked, keeps its link
 * and shows the lock as a hint (ruling 3: the calendar page does its own upsell). With no map
 * (loading, a non-student, a parse failure) nothing is locked and the link navigates; the server
 * refuses a gated request regardless and the modal opens from that refusal (UI-44).
 *
 * THE BELL. OQ-47 (Karl, 2026-10-03, ruled): the bell sits in the left rail, directly above
 * Help, in the App shell only. On desktop the <header> IS the rail, so the bell is a rail entry
 * between the spacer and Help; below lg the same element sits in the top bar, so it stays
 * reachable on mobile. The Focus shell and the Bare card carry no bell; their exemptions and
 * reasons are recorded in shells.notification-bell.test.tsx, which holds the "every shell" rule
 * (the notification contract §3 names the in-app surface, not every layout).
 *
 * THE TAB BAR AND THE AVATAR MENU. Owner ruling (Karl, 2026-10-05; supersedes OQ-4, OQ-48 and
 * the Full-Length part of OQ-62, and the earlier same-day ruling that put Full-Length in the
 * menu): the phone tab bar is Home, Review, Practice (the middle), Calendar, LISA, and the avatar
 * menu is Settings, Help, Sign out. Full-Length is on neither: on a phone it is reached only from
 * a scheduled calendar block or Home's "Start a full-length test" card (the official SAT,
 * Bluebook, cannot be taken on a phone). The tab bar's order is its own (`TAB_BAR_KEYS`), not the
 * rail's, so the two can differ; each tab is the rail item itself, so its lock behaviour cannot
 * drift (Calendar: hint and navigate; LISA: the modal). The desktop rail is unchanged. The admin
 * exception (OQ-48) stands: an admin keeps the menu at every width, with Crisis review before
 * Sign out.
 *
 * F-70: the avatar menu is drawn with the student tokens inside the page's theme (and its theme
 * lock), like the student Modal (`HeaderUserMenu`'s `tone="student"`).
 */
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "wouter";
import {
  CalendarDays,
  CircleHelp,
  ClipboardCheck,
  GraduationCap,
  House,
  Lock,
  MessageSquare,
  PenLine,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import type {
  FeatureAccessMap,
  FeatureLockReason,
  LockableFeatureKey,
} from "@lyceon/shared/feature-access";
import { SkipLink } from "@/components/common/skip-link";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { useUpgradeModal } from "@/components/billing/UpgradeModal";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { LYC_FOCUS } from "@/components/ui/button";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useReportBottomChrome } from "@/lib/bottom-chrome";
import type {
  AppContentLayout,
  RightPanelWidth,
  ThemeLock,
} from "@/lib/route-shells";
import {
  HeaderUserMenu,
  STUDENT_MENU_ITEM_CLASS,
  useHeaderSignOut,
} from "./HeaderUserMenu";
import { HELP_PATH, LegalFooter } from "./LegalFooter";
import { usePublishThemeLock } from "./theme-lock";

/** What a locked rail item does: open the upgrade modal in place, or navigate (ruling 3). */
type LockBehaviour = "modal" | "navigate";

export type RailItem = {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly lock: {
    readonly feature: LockableFeatureKey;
    readonly behaviour: LockBehaviour;
  } | null;
};

/**
 * The rail, as data (DESIGN.md §2 order). Exported so the tests iterate the config rather than a
 * copy of it (#829): a seventh item is covered the moment it is added here.
 */
export const RAIL_ITEMS: readonly RailItem[] = [
  {
    key: "home",
    label: "Home",
    href: "/dashboard",
    icon: House,
    lock: null,
  },
  {
    key: "practice",
    label: "Practice",
    href: "/practice",
    icon: PenLine,
    lock: null,
  },
  {
    key: "review",
    label: "Review",
    href: "/review",
    icon: RotateCcw,
    lock: null,
  },
  {
    key: "full-length",
    label: "Full-Length",
    href: "/tests",
    icon: ClipboardCheck,
    lock: { feature: "exam_full_length", behaviour: "modal" },
  },
  {
    key: "calendar",
    label: "Calendar",
    href: "/calendar",
    icon: CalendarDays,
    lock: { feature: "calendar_access", behaviour: "navigate" },
  },
  {
    key: "lisa",
    label: "LISA",
    href: "/chat",
    icon: MessageSquare,
    lock: { feature: "tutor_access", behaviour: "modal" },
  },
];

/**
 * The phone tab bar, in its own order (owner ruling, Karl, 2026-10-05): Home, Review, Practice
 * (the middle), Calendar, LISA. Full-Length is not on it. Keys into `RAIL_ITEMS`, so each tab is
 * the rail item itself (label, href, lock) and only the order and membership are the bar's own.
 */
export const TAB_BAR_KEYS = [
  "home",
  "review",
  "practice",
  "calendar",
  "lisa",
] as const;

function railItem(key: string): RailItem {
  const item = RAIL_ITEMS.find((i) => i.key === key);
  // A tab key with no rail item is a programming error in this file, not a runtime state.
  if (item === undefined)
    throw new Error(`tab bar key "${key}" is not a rail item`);
  return item;
}

export const TAB_BAR_ITEMS: readonly RailItem[] = TAB_BAR_KEYS.map(railItem);

const SETTINGS_PATH = "/profile";

/** Accessible names for a locked item (prototype: "<label>, included with a paid plan"). */
export const LOCK_SUFFIX: Readonly<Record<FeatureLockReason, string>> = {
  plan: "included with a paid plan",
  age: "not available on your account",
};

function isActive(location: string, href: string): boolean {
  return location === href || location.startsWith(`${href}/`);
}

/**
 * Why `feature` is locked for this student, or null (granted, or no map). The ONE reading of the
 * OQ-29 map for a lock: the rail, the tab bar and Home's full-length card all use it.
 */
export function featureLockReason(
  feature: LockableFeatureKey,
  access: FeatureAccessMap | null,
): FeatureLockReason | null {
  if (access === null) return null;
  const entry = access[feature];
  return entry.access === "locked" ? entry.reason : null;
}

function lockReasonFor(
  item: RailItem,
  access: FeatureAccessMap | null,
): FeatureLockReason | null {
  return item.lock === null
    ? null
    : featureLockReason(item.lock.feature, access);
}

const RAIL_ITEM_CLASS =
  "relative flex w-full flex-col items-center gap-1.5 rounded-lg px-1 py-2.5 text-lyc-meta font-medium no-underline hover:brightness-110";
const TAB_ITEM_CLASS =
  "relative flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2 text-lyc-meta font-medium no-underline";
const ON_CLASS = "bg-lyc-rail-on-bg text-lyc-rail-on-ink";
const OFF_CLASS = "bg-transparent text-lyc-rail-ink";

function RailEntry({
  item,
  variant,
  access,
  location,
}: {
  item: RailItem;
  variant: "rail" | "tab";
  access: FeatureAccessMap | null;
  location: string;
}): JSX.Element {
  const { open } = useUpgradeModal();
  const reason = lockReasonFor(item, access);
  const active = isActive(location, item.href);
  const Icon = item.icon;
  const className = [
    LYC_FOCUS,
    variant === "rail" ? RAIL_ITEM_CLASS : TAB_ITEM_CLASS,
    active ? ON_CLASS : OFF_CLASS,
  ].join(" ");
  const testId = `${variant}-${item.key}`;
  const label =
    reason === null ? item.label : `${item.label}, ${LOCK_SUFFIX[reason]}`;
  const body = (
    <>
      <Icon aria-hidden="true" className="h-6 w-6" strokeWidth={1.75} />
      <span>{item.label}</span>
      {reason !== null ? (
        <Lock
          aria-hidden="true"
          data-testid={`${testId}-lock`}
          className="absolute right-3.5 top-1.5 h-3.5 w-3.5 text-lyc-lock"
          strokeWidth={2.25}
        />
      ) : null}
    </>
  );

  if (reason !== null && item.lock?.behaviour === "modal") {
    const feature = item.lock.feature;
    return (
      <button
        type="button"
        className={`${className} cursor-pointer border-0`}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        data-testid={testId}
        onClick={() => open(feature, reason)}
      >
        {body}
      </button>
    );
  }
  return (
    <Link
      href={item.href}
      className={className}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      data-testid={testId}
    >
      {body}
    </Link>
  );
}

/** The avatar's letter: the first character of the name, else of the email. */
function initialOf(name: string | null | undefined, email: string): string {
  const source = name?.trim() || email;
  return source.charAt(0).toUpperCase() || "?";
}

const PanelSlot = createContext<HTMLElement | null>(null);

/**
 * A page's right-panel content (DESIGN.md §2: "Its content depends on the page"). The router
 * applies the shell, so a page cannot pass the panel as a prop; it renders this anywhere in its
 * body and the content is portalled into the panel. Renders nothing on a route with no panel.
 */
export function AppShellPanel({
  children,
}: {
  children: ReactNode;
}): JSX.Element | null {
  const slot = useContext(PanelSlot);
  return slot === null ? null : createPortal(children, slot);
}

export type AppShellProps = {
  children: ReactNode;
  /** The right panel's width, or null for none (route-shells.ts). */
  panel?: RightPanelWidth | null;
  /** The slim legal footer at the end of the content column. */
  footer?: boolean;
  /** The padded 800px reading column, or the page edge to edge (route-shells.ts). */
  content?: AppContentLayout;
  themeLock?: ThemeLock;
};

export function AppShell({
  children,
  panel = null,
  footer = false,
  content = "column",
  themeLock = null,
}: AppShellProps): JSX.Element {
  const [location] = useLocation();
  const { user, isAdmin } = useSupabaseAuth();
  const access = useFeatureAccess();
  const { signOut, isSigningOut } = useHeaderSignOut();
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null);
  // F-65: portalled overlays (the upgrade modal) take this shell's lock.
  usePublishThemeLock(themeLock);
  // F-72: the phone tab bar reports its height, so the cookie banner sits above it (0 from lg up,
  // where the bar is hidden).
  const tabBarRef = useRef<HTMLElement>(null);
  useReportBottomChrome(tabBarRef);

  const accountMenu = (
    <HeaderUserMenu
      signOut={signOut}
      isSigningOut={isSigningOut}
      fallbackName="Student"
      // F-70: the student tokens, inside the page's theme and theme lock.
      tone="student"
      // Owner ruling (Karl, 2026-10-05; supersedes OQ-48): Settings, Help, Sign out. Settings
      // and Sign out are the shared menu's own; an admin's Crisis review sits between Help and
      // Sign out. No rail item is in the menu.
      items={<MenuLink href={HELP_PATH} label="Help" testId="menu-help" />}
    />
  );
  const helpActive = isActive(location, HELP_PATH);
  const settingsActive = isActive(location, SETTINGS_PATH);

  return (
    <div
      className="lyc flex min-h-[100dvh] flex-col pb-[76px] lg:h-[100dvh] lg:flex-row lg:overflow-hidden lg:pb-0"
      data-shell="app"
      data-theme-lock={themeLock ?? undefined}
    >
      <SkipLink />
      <header
        data-testid="app-shell-header"
        className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-2 bg-lyc-rail px-4 lg:static lg:h-full lg:w-[96px] lg:flex-col lg:items-stretch lg:gap-1 lg:px-2 lg:py-5"
      >
        <Link
          href="/dashboard"
          data-testid="logo-link"
          title="Lyceon home: your dashboard"
          className={`${LYC_FOCUS} flex items-center gap-2 rounded-md text-lyc-rail-on-bg no-underline lg:flex-col lg:gap-1.5 lg:pb-[22px] lg:pt-1`}
        >
          <GraduationCap
            aria-hidden="true"
            className="h-7 w-7 lg:h-[34px] lg:w-[34px]"
            strokeWidth={1.5}
          />
          <span className="font-lyc-serif text-[18px] font-semibold tracking-[0.01em]">
            Lyceon
          </span>
        </Link>

        <nav
          aria-label="Main"
          data-testid="app-rail"
          className="hidden lg:flex lg:flex-col lg:gap-1"
        >
          {RAIL_ITEMS.map((item) => (
            <RailEntry
              key={item.key}
              item={item}
              variant="rail"
              access={access}
              location={location}
            />
          ))}
        </nav>

        <div aria-hidden="true" className="flex-1" />

        {user ? (
          <div
            data-testid="rail-bell"
            className="flex justify-center [&_button]:text-lyc-rail-ink [&_button:hover]:bg-transparent"
          >
            <NotificationBell />
          </div>
        ) : null}

        <Link
          href={HELP_PATH}
          data-testid="rail-help"
          aria-current={helpActive ? "page" : undefined}
          className={`${LYC_FOCUS} ${RAIL_ITEM_CLASS} hidden lg:flex ${helpActive ? ON_CLASS : OFF_CLASS}`}
        >
          <CircleHelp
            aria-hidden="true"
            className="h-6 w-6"
            strokeWidth={1.75}
          />
          <span>Help</span>
        </Link>

        {user && isAdmin ? (
          // An admin keeps the menu at every width: it carries the crisis-review entry (W2-7).
          <div className="flex justify-center [&_button]:text-lyc-rail-ink">
            {accountMenu}
          </div>
        ) : user ? (
          <>
            <Link
              href={SETTINGS_PATH}
              data-testid="rail-account"
              aria-label="Account and settings"
              aria-current={settingsActive ? "page" : undefined}
              className={`${LYC_FOCUS} hidden justify-center rounded-full pb-1 pt-2.5 no-underline lg:flex`}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-lyc-rail-on-bg font-lyc-serif text-[18px] font-semibold text-lyc-rail-on-ink">
                {initialOf(user.display_name, user.email)}
              </span>
            </Link>
            <div className="flex justify-center lg:hidden [&_button]:text-lyc-rail-ink">
              {accountMenu}
            </div>
          </>
        ) : null}
      </header>

      <PanelSlot.Provider value={panelEl}>
        <div className="flex min-w-0 flex-1 flex-col lg:flex-row lg:overflow-hidden">
          {content === "column" ? (
            <main
              id="main"
              data-content="column"
              className="min-w-0 flex-1 px-4 pb-10 pt-6 lg:overflow-y-auto lg:px-[72px] lg:pb-[72px] lg:pt-14"
            >
              <div className="max-w-[800px]">{children}</div>
              {footer ? <LegalFooter /> : null}
            </main>
          ) : (
            <main
              id="main"
              data-content="full"
              className="flex min-w-0 flex-1 flex-col lg:overflow-hidden"
            >
              {children}
            </main>
          )}
          {panel !== null ? (
            <aside
              ref={setPanelEl}
              aria-label="Side panel"
              data-testid="app-shell-panel"
              data-panel-width={panel}
              style={{ "--lyc-panel-width": `${panel}px` } as CSSProperties}
              className="border-t border-lyc-rule bg-lyc-margin px-4 py-8 max-lg:empty:hidden lg:w-[var(--lyc-panel-width)] lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-t-0 lg:px-8 lg:py-12"
            />
          ) : null}
        </div>
      </PanelSlot.Provider>

      <nav
        ref={tabBarRef}
        aria-label="Main"
        data-testid="app-tab-bar"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-lyc-rule bg-lyc-rail px-1 lg:hidden"
      >
        {TAB_BAR_ITEMS.map((item) => (
          <RailEntry
            key={item.key}
            item={item}
            variant="tab"
            access={access}
            location={location}
          />
        ))}
      </nav>
    </div>
  );
}

function MenuLink({
  href,
  label,
  testId,
}: {
  href: string;
  label: string;
  testId: string;
}): JSX.Element {
  const [, navigate] = useLocation();
  return (
    <DropdownMenuItem
      className={STUDENT_MENU_ITEM_CLASS}
      onClick={() => navigate(href)}
      data-testid={testId}
    >
      {label}
    </DropdownMenuItem>
  );
}
