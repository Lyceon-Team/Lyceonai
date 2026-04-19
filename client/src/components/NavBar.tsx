import { Link, useLocation } from "wouter";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { UserCircle, LogOut, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";

export default function NavBar() {
  const [location, navigate] = useLocation();
  const { user, isAuthenticated, signOut, signInWithGoogle } = useSupabaseAuth();
  const { toast } = useToast();

  const handleSignOut = async () => {
    try {
      await signOut();
      toast({ title: "Signed out successfully" });
      navigate('/');
    } catch (error) {
      toast({ 
        title: "Sign out failed", 
        description: "Please try again",
      });
    }
  };

  const navTabs = [
    { label: 'Practice', path: '/practice' },
    { label: 'Progress', path: '/dashboard' },
  ];

  return (
    <nav className="fixed top-0 w-full backdrop-blur-md bg-background/90 border-b border-border shadow-sm z-50 flex items-center justify-between px-6 h-14" data-testid="lyceon-navbar">
      <h1 className="text-lg font-poppins font-semibold text-foreground" data-testid="app-title">
        Lyceon
      </h1>
      
      <div className="flex space-x-8 text-foreground">
        {navTabs.map(tab => (
          <Link 
            key={tab.label} 
            href={tab.path}
            className={`hover:text-foreground transition-colors ${location === tab.path ? 'text-foreground font-medium' : ''}`}
            data-testid={`nav-${tab.label.toLowerCase()}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <div className="flex items-center space-x-2">
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center space-x-2 hover:opacity-80 transition-opacity" data-testid="user-menu-trigger">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-secondary text-foreground font-medium">
                    {user?.display_name?.charAt(0) || user?.email?.charAt(0) || 'U'}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm text-foreground" data-testid="user-id">
                  {user?.display_name || user?.email || 'Student'}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 bg-card border-border">
              <DropdownMenuItem onClick={() => navigate('/profile')} data-testid="menu-profile" className="hover:bg-secondary focus:bg-secondary">
                <UserCircle className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/profile')} data-testid="menu-settings" className="hover:bg-secondary focus:bg-secondary">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-muted" />
              <DropdownMenuItem onClick={handleSignOut} data-testid="menu-logout" className="hover:bg-secondary focus:bg-secondary">
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button 
            onClick={signInWithGoogle} 
            className="text-sm text-foreground hover:text-foreground transition-colors font-medium"
            data-testid="button-signin"
          >
            Sign In
          </button>
        )}
      </div>
    </nav>
  );
}
