import type { NextAuthConfig } from 'next-auth'

// Edge-safe base config shared by middleware and the full server config.
// Must not import arangojs/bcryptjs (Node-only) so middleware can use it.
export const authConfig = {
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
  // Own cookie name: cookies are keyed by host WITHOUT the port, so on localhost the
  // original Learn Hub's session cookie (different AUTH_SECRET) would otherwise be sent
  // to this app too and fail decryption ("no matching decryption secret").
  cookies: { sessionToken: { name: 'learnhub-core.session-token' } },
  trustHost: true,
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id
        token.username = user.username
        token.dbName = user.dbName
        token.role = user.role
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = (token.uid as string) ?? ''
        session.user.username = (token.username as string) ?? ''
        session.user.dbName = (token.dbName as string) ?? ''
        session.user.role = (token.role as string) ?? 'user'
      }
      return session
    },
  },
} satisfies NextAuthConfig
