import { useQuery } from "@tanstack/react-query";

interface User {
  id: string;
  email: string | null;
  username: string | null;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  profileCompletedAt: Date | null;
  lastLoginAt: Date | null;
  isAdmin: boolean;
}

interface AuthResponse {
  authenticated: boolean;
  user: User | null;
}

interface UseAuthReturn {
  user: User | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Unified authentication hook that provides user state, authentication status,
 * and admin privileges throughout the application.
 */
export function useAuth(): UseAuthReturn {
  const { data, isLoading, error } = useQuery<AuthResponse>({
    queryKey: ['/api/auth/user'],
    staleTime: Infinity, // Keep user data fresh until explicitly invalidated
  });

  return {
    user: data?.user || null,
    isAuthenticated: data?.authenticated || false,
    isAdmin: data?.user?.isAdmin || false,
    isLoading,
    error: error as Error | null,
  };
}