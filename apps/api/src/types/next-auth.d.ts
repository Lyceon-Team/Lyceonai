import NextAuth from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string;
      image?: string;
      isAdmin?: boolean;
      username?: string;
    }
  }

  interface User {
    id: string;
    email: string;
    name?: string;
    image?: string;
    isAdmin?: boolean;
    username?: string;
    jwt?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    sub: string;
    isAdmin?: boolean;
    username?: string;
  }
}