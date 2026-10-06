/**
 * @spec [contracts/auth-standard-flow.contract.md AS-3 (sign-out failures route through
 *        resolveAuthErrorMessage, the auth display chokepoint); lyceon-coding-standards
 *        §11.1 (components render UI; the sign-out behaviour lives in a hook, not in the
 *        component body — it calls the auth context's signOut, not the query layer), §11.3
 *        (UI hides by role, the server enforces); student-UI register §8 F-70 (the student
 *        avatar dropdown follows the page theme)] | @implemented [2026-09-11; F-70 2026-10-05]
 *
 * plain English: the signed-in user's header menu (name, email, Settings, Sign Out) and the
 * sign-out handler behind it, shared by every authenticated shell so the student header and
 * the guardian header cannot drift apart. Extracted from app-shell.tsx with the same test ids
 * and the same behaviour; the student shell's mobile sheet keeps using the same hook, so one
 * sign-out path exists, not two. A failed sign-out is surfaced to the user by the toast; it is
 * not swallowed and it is not logged to the console (Coding Standards §16).
 *
 * TONE (F-70). The menu portals onto <body>, outside the shell's `.lyc` root, so it used to take
 * the app-wide light tokens: a light panel over a dark student page. `tone="student"` (the App
 * shell) puts the open menu inside its own `.lyc` root carrying the shell's theme lock, the way
 * the student Modal and Sheet do since F-65, and draws it with the student `lyc-*` tokens: a
 * light page gets a light menu, a dark page a dark one, and a page pinned light a light one. The
 * guardian shell keeps the default `app` tone: its pages use the app-wide tokens.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { LogOut, Settings, ShieldAlert, UserCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { resolveAuthErrorMessage } from "@/lib/auth-error-messages";
import { useActiveThemeLock } from "./theme-lock";

export type HeaderSignOut = {
  signOut: () => Promise<void>;
  isSigningOut: boolean;
};

/** Which token set the open menu draws with (F-70). */
export type HeaderMenuTone = "app" | "student";

/**
 * A student menu item: the student ink and the student hover fill, not the app-wide accent.
 * Exported so a shell's own entries (the App shell's Help) match the menu's.
 */
export const STUDENT_MENU_ITEM_CLASS =
  "text-lyc-ink focus:bg-lyc-hover focus:text-lyc-ink-strong";

type ToneClasses = {
  readonly content: string;
  readonly item: string;
  readonly name: string;
  readonly email: string;
  readonly loading: string;
  readonly separator: string;
};

const TONE: Readonly<Record<HeaderMenuTone, ToneClasses>> = {
  app: {
    content: "w-56 bg-background border-border",
    item: "",
    name: "text-sm font-medium leading-none text-foreground",
    email: "text-xs leading-none text-muted-foreground",
    loading:
      "text-sm font-medium leading-none text-muted-foreground opacity-70",
    separator: "",
  },
  // DESIGN.md §1: student tokens only, and nothing below 14px (the email is text-lyc-meta).
  student: {
    content: "w-56 border-lyc-rule bg-lyc-sheet text-lyc-ink",
    item: STUDENT_MENU_ITEM_CLASS,
    name: "text-sm font-medium leading-none text-lyc-ink-strong",
    email: "text-lyc-meta leading-none text-lyc-muted",
    loading: "text-sm font-medium leading-none text-lyc-muted",
    separator: "bg-lyc-rule",
  },
};

/** Sign out through the auth context (Supabase session, backend cookies, query cache), then go to /login. */
export function useHeaderSignOut(): HeaderSignOut {
  const [, navigate] = useLocation();
  const { signOut } = useSupabaseAuth();
  const { toast } = useToast();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async (): Promise<void> => {
    setIsSigningOut(true);
    try {
      await signOut();
      toast({ title: "Signed out successfully" });
      navigate("/login");
    } catch (error) {
      toast({
        title: "Sign out failed",
        description: resolveAuthErrorMessage(error),
      });
    } finally {
      setIsSigningOut(false);
    }
  };

  return { signOut: handleSignOut, isSigningOut };
}

export function HeaderUserMenu({
  signOut,
  isSigningOut,
  fallbackName,
  items,
  tone = "app",
}: HeaderSignOut & {
  fallbackName: string;
  /**
   * Shell-specific entries, rendered after Settings (G4-10: the guardian shell's "Linked
   * students & billing"; the App shell's Help). The shell that owns the page owns its menu
   * entry; this menu stays one component for every shell.
   */
  items?: React.ReactNode;
  /** F-70: `student` draws the open menu in the student tokens, inside the page's theme. */
  tone?: HeaderMenuTone;
}) {
  const [, navigate] = useLocation();
  const { user, isLoading, isAdmin } = useSupabaseAuth();
  // F-65 / F-70: the portal takes the lock of the shell on screen (layout/theme-lock.tsx).
  const themeLock = useActiveThemeLock();
  if (!user) return null;

  const displayName =
    user.display_name || user.email?.split("@")[0] || fallbackName;
  const t = TONE[tone];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          data-testid="button-user-menu"
        >
          <UserCircle className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={t.content}
        data-testid="user-menu"
        {...(tone === "student"
          ? { portalClassName: "lyc contents", portalThemeLock: themeLock }
          : {})}
      >
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            {isLoading ? (
              <p className={t.loading}>Loading...</p>
            ) : (
              <>
                <p className={t.name} data-testid="text-user-name">
                  {displayName}
                </p>
                <p className={t.email}>{user.email}</p>
              </>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className={t.separator} />
        <DropdownMenuItem
          className={t.item}
          onClick={() => navigate("/profile")}
          data-testid="menu-profile"
        >
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        {items}
        {/* @spec [Doc-03_V3 §21.3, SCL-025; Coding Standards §11.3; closure plan W2-7]
            | @implemented [2026-09-24] | plain English: the in-app way into the crisis
            review queue. Before this, an admin needed the URL or a Slack alert. Shown by
            role only — the route is RequireRole admin and every API call behind it is
            requireSupabaseAdmin, so hiding it is presentation, not the control. This menu
            renders at every width and in every authenticated shell, so one entry covers
            desktop, mobile and the guardian shell. */}
        {isAdmin && (
          <DropdownMenuItem
            className={t.item}
            onClick={() => navigate("/admin/crisis-review")}
            data-testid="menu-crisis-review"
          >
            <ShieldAlert className="mr-2 h-4 w-4" />
            Crisis review
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator className={t.separator} />
        <DropdownMenuItem
          className={t.item}
          onClick={() => void signOut()}
          disabled={isSigningOut}
          data-testid="menu-logout"
        >
          <LogOut className="mr-2 h-4 w-4" />
          {isSigningOut ? "Signing out..." : "Sign Out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
