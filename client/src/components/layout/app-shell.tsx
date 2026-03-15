import * as React from "react";
import { useState } from "react";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Link, useLocation } from "wouter";
import { Crown, UserCircle, Menu, GraduationCap, LayoutDashboard, BookOpen, MessageSquare, CreditCard, Settings, LogOut, Zap, Upload, Star, Calendar } from "lucide-react";
import { SkipLink } from "@/components/common/skip-link";
import NotificationDropdown from "@/components/NotificationDropdown";
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
import Footer from "./Footer";

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
  const { user, isLoading: authLoading, signOut } = useSupabaseAuth();
  const isAdmin = user?.role === "admin";
  const { toast } = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  
  // Get display name with fallbacks
  const displayName = user?.display_name || user?.email?.split('@')[0] || 'Student';
  const isLoadingAuth = authLoading;

  // Use the context signOut which clears Supabase session, backend cookies, and React Query cache
  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      toast({ title: "Signed out successfully" });
      navigate('/login');
    } catch (error: any) {
      console.error('[NAV] Sign out failed:', error);
      toast({
        title: "Sign out failed",
        description: error.message || "Please try again",
        variant: "destructive"
      });
    } finally {
      setIsSigningOut(false);
    }
  };

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/calendar', label: 'Calendar', icon: Calendar },
    { href: '/flow-cards', label: 'FlowCards', icon: Zap },
    { href: '/practice', label: 'Practice', icon: BookOpen },
    { href: '/full-test', label: 'Full Tests', icon: CreditCard },
    { href: '/chat', label: 'Lisa', icon: MessageSquare },
  ];

  const NavLink = ({ href, label, icon: Icon, mobile = false }: { href: string; label: string; icon: any; mobile?: boolean }) => {
    const isActive = location === href || (href !== '/dashboard' && location.startsWith(href));
    const baseClasses = mobile
      ? "flex items-center gap-3 px-4 py-3 rounded-lg transition-colors w-full"
      : "px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2";
    const activeClasses = isActive
      ? "bg-secondary text-foreground font-semibold border-b-2 border-foreground"
      : mobile
        ? "text-foreground/70 hover:bg-secondary"
        : "text-foreground/70 hover:text-foreground hover:bg-secondary";

    return (
      <Link href={href}>
        <a 
          className={`${baseClasses} ${activeClasses}`}
          data-testid={`nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
          onClick={() => mobile && setMobileMenuOpen(false)}
        >
          <Icon className={mobile ? "h-5 w-5" : "h-4 w-4"} />
          {label}
        </a>
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur">
      <SkipLink />
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/dashboard">
            <a className="flex items-center gap-2 text-foreground hover:opacity-80 transition-opacity" data-testid="logo-link">
              <GraduationCap className="h-6 w-6 text-foreground" />
              <span className="font-bold text-lg hidden sm:inline">Lyceon</span>
            </a>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
          </nav>

          {/* User Menu */}
          <div className="flex items-center gap-2">
            {/* Admin Star Icon - Visible to all users, active for admins only */}
            {user && (
              isAdmin ? (
                <Link href="/admin">
                  <a 
                    className="p-2 rounded-lg text-foreground hover:bg-secondary transition-colors"
                    data-testid="button-admin-star"
                    title="Admin Portal"
                  >
                    <Star className="h-5 w-5 fill-foreground" />
                  </a>
                </Link>
              ) : (
                <span 
                  className="p-2 rounded-lg text-muted-foreground cursor-not-allowed opacity-50"
                  data-testid="button-admin-star-disabled"
                  title="Admin access required"
                >
                  <Star className="h-5 w-5" />
                </span>
              )
            )}
            
            {/* Notifications Bell */}
            {user && <NotificationDropdown />}
            
            {/* Admin Upload Button */}
            {isAdmin && (
              <Link href="/admin?tab=pdf">
                <a 
                  className="p-2 rounded-lg text-foreground hover:bg-secondary transition-colors"
                  data-testid="button-admin-upload"
                  title="Upload SAT PDFs"
                >
                  <Upload className="h-5 w-5" />
                </a>
              </Link>
            )}
            
            {/* Mobile Menu Button */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild className="md:hidden">
                <Button variant="ghost" size="icon" data-testid="button-mobile-menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 bg-background border-border">
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
                      navigate('/profile');
                    }}
                    data-testid="button-profile-mobile"
                  >
                    <Settings className="h-5 w-5" />
                    Settings
                  </Button>
                  <Button 
                    variant="outline" 
                    className="w-full justify-start gap-3 text-destructive"
                    disabled={isSigningOut}
                    onClick={async () => {
                      setMobileMenuOpen(false);
                      await handleSignOut();
                    }}
                    data-testid="button-signout-mobile"
                  >
                    <LogOut className="h-5 w-5" />
                    {isSigningOut ? 'Signing out...' : 'Sign Out'}
                  </Button>
                </div>
              </SheetContent>
            </Sheet>

            {/* Desktop User Dropdown */}
            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full" data-testid="button-user-menu">
                    <UserCircle className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-background border-border">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      {isLoadingAuth ? (
                        <p className="text-sm font-medium leading-none text-muted-foreground opacity-70">Loading...</p>
                      ) : (
                        <>
                          <p className="text-sm font-medium leading-none text-foreground" data-testid="text-user-name">{displayName}</p>
                          <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
                        </>
                      )}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/profile')} data-testid="menu-profile">
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={handleSignOut} 
                    disabled={isSigningOut}
                    className="text-destructive"
                    data-testid="menu-logout"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    {isSigningOut ? 'Signing out...' : 'Sign Out'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

