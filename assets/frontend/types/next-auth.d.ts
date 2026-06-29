import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      username: string
      dbName: string
      role: string
    } & DefaultSession['user']
  }

  interface User {
    username?: string
    dbName?: string
    role?: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    uid?: string
    username?: string
    dbName?: string
    role?: string
  }
}
