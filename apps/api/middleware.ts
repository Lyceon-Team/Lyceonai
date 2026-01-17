import { withAuth } from 'next-auth/middleware';

export default withAuth(
  function middleware(req) {
    // Add any custom middleware logic here
    console.log('NextAuth middleware executed for:', req.nextUrl.pathname);
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        // Allow access to auth routes
        if (req.nextUrl.pathname.startsWith('/api/auth')) {
          return true;
        }
        
        // Allow access to health check
        if (req.nextUrl.pathname === '/api/health') {
          return true;
        }
        
        // Require authentication for admin routes
        if (req.nextUrl.pathname.startsWith('/api/admin')) {
          return token?.isAdmin === true;
        }
        
        // Allow other API routes for now
        return true;
      },
    },
  }
);

export const config = {
  matcher: [
    '/api/admin/:path*',
    '/api/protected/:path*',
  ],
};