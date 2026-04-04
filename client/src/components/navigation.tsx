import { useState } from "react";
import { UserCircle, Settings, LogOut, Zap, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useToast } from "@/hooks/use-toast";
import NotificationDropdown from "./NotificationDropdown";

export default function Navigation() {
  const [location, navigate] = useLocation();
  const { user, isAuthenticated, isAdmin, isGuardian, authLoading, signOut } = useSupabaseAuth();
  const { toast } = useToast();

  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleLogout = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      toast({ title: "Logged out successfully" });
      navigate('/login');
    } catch {
      toast({ 
        title: "Logout failed", 
        description: "Please try again",
        variant: "destructive"
      });
    } finally {
      setIsSigningOut(false);
    }
  };

  const isActive = (path: string) => location === path;

  if (authLoading) {
    return (
      <nav className="bg-background border-b border-border sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-8">
              <div className="flex-shrink-0">
                <span className="text-xl font-bold text-foreground">Lyceon</span>
              </div>
            </div>
          </div>
        </div>
      </nav>
    );
  }

  const homeHref = isGuardian ? "/guardian" : "/dashboard";
  
  return (
    <nav className="bg-background border-b border-border sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-8">
            <div className="flex-shrink-0">
              <Link href={homeHref} className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground" data-testid="app-title">
                  Lyceon
                </h1>
              </Link>
            </div>
            <nav className="hidden md:flex space-x-6">
              {isGuardian ? (
                <Link 
                  href="/guardian" 
                  className={`${isActive('/guardian') ? 'text-foreground font-medium border-b-2 border-foreground' : 'text-muted-foreground hover:text-foreground'} transition-colors pb-1 flex items-center gap-1`}
                  data-testid="nav-guardian-dashboard"
                >
                  <Users className="h-4 w-4" />
                  Guardian Dashboard
                </Link>
              ) : (
                <>
                  <Link 
                    href="/dashboard" 
                    className={`${isActive('/dashboard') ? 'text-foreground font-medium border-b-2 border-foreground' : 'text-muted-foreground hover:text-foreground'} transition-colors pb-1`}
                    data-testid="nav-dashboard"
                  >
                    Dashboard
                  </Link>
                  <Link 
                    href="/flow-cards" 
                    className={`${isActive('/flow-cards') ? 'text-foreground font-medium border-b-2 border-foreground' : 'text-muted-foreground hover:text-foreground'} transition-colors pb-1 flex items-center gap-1`}
                    data-testid="nav-flowcards"
                  >
                    <Zap className="h-4 w-4" />
                    FlowCards
                  </Link>
                  <Link 
                    href="/practice" 
                    className={`${isActive('/practice') ? 'text-foreground font-medium border-b-2 border-foreground' : 'text-muted-foreground hover:text-foreground'} transition-colors pb-1`}
                    data-testid="nav-practice-tests"
                  >
                    Practice
                  </Link>
                  <Link 
                    href="/chat" 
                    className={`${isActive('/chat') ? 'text-foreground font-medium border-b-2 border-foreground' : 'text-muted-foreground hover:text-foreground'} transition-colors pb-1`}
                    data-testid="nav-resources"
                  >
                    Lisa
                  </Link>
                </>
              )}
            </nav>
          </div>
          <div className="flex items-center space-x-4">
            {!isGuardian && <NotificationDropdown />}
            
            {isAuthenticated ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon"
                    data-testid="button-profile"
                    title="Profile & Settings"
                  >
                    <UserCircle className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-background border-border">
                  <div className="px-2 py-2">
                    <p className="text-sm font-medium text-foreground" data-testid="text-user-name">
                      {user?.display_name || user?.email?.split('@')[0] || 'User'}
                    </p>
                    <p className="text-xs text-muted-foreground" data-testid="text-user-email">
                      {user?.email}
                    </p>
                    {isAdmin && (
                      <p className="text-xs text-foreground font-medium mt-1" data-testid="text-admin-badge">
                        Administrator
                      </p>
                    )}
                    {isGuardian && (
                      <p className="text-xs text-foreground font-medium mt-1" data-testid="text-guardian-badge">
                        Guardian
                      </p>
                    )}
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/profile')} data-testid="menu-profile">
                    <Settings className="mr-2 h-4 w-4" />
                    Profile & Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={handleLogout}
                    disabled={isSigningOut}
                    data-testid="menu-logout"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    {isSigningOut ? 'Logging out...' : 'Logout'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button 
                variant="outline"
                onClick={() => navigate('/login')}
                data-testid="button-login"
              >
                Login
              </Button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
