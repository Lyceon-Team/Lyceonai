/**
 * @spec [contracts/auth-standard-flow.contract.md AS-3 (sign-out failures route through
 *        resolveAuthErrorMessage, the auth display chokepoint); lyceon-coding-standards
 *        §11.1 (components render UI; the sign-out behaviour lives in a hook, not in the
 *        component body — it calls the auth context's signOut, not the query layer), §11.3
 *        (UI hides by role, the server enforces)] | @implemented [2026-09-11]
 *
 * plain English: the signed-in user's header menu (name, email, Settings, Sign Out) and the
 * sign-out handler behind it, shared by every authenticated shell so the student header and
 * the guardian header cannot drift apart. Extracted from app-shell.tsx with the same test ids
 * and the same behaviour; the student shell's mobile sheet keeps using the same hook, so one
 * sign-out path exists, not two. A failed sign-out is surfaced to the user by the toast; it is
 * not swallowed and it is not logged to the console (Coding Standards §16).
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { LogOut, Settings, UserCircle } from "lucide-react";
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

export type HeaderSignOut = {
  signOut: () => Promise<void>;
  isSigningOut: boolean;
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
}: HeaderSignOut & { fallbackName: string }) {
  const [, navigate] = useLocation();
  const { user, isLoading } = useSupabaseAuth();
  if (!user) return null;

  const displayName =
    user.display_name || user.email?.split("@")[0] || fallbackName;

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
        className="w-56 bg-background border-border"
      >
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            {isLoading ? (
              <p className="text-sm font-medium leading-none text-muted-foreground opacity-70">
                Loading...
              </p>
            ) : (
              <>
                <p
                  className="text-sm font-medium leading-none text-foreground"
                  data-testid="text-user-name"
                >
                  {displayName}
                </p>
                <p className="text-xs leading-none text-muted-foreground">
                  {user.email}
                </p>
              </>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => navigate("/profile")}
          data-testid="menu-profile"
        >
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
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
