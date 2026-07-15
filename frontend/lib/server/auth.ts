import 'server-only'
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { compare } from 'bcryptjs'
import { authConfig } from '@/lib/server/auth.config'
import { ensureUserDb, findUserByUsername } from '@/lib/server/auth-db'

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        username: { label: 'Username' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const username = String(credentials?.username ?? '')
          .trim()
          .toLowerCase()
        const password = String(credentials?.password ?? '')
        if (!username || !password) return null

        const user = await findUserByUsername(username)
        if (!user?.passwordHash) return null

        const valid = await compare(password, user.passwordHash)
        if (!valid) return null

        await ensureUserDb(user.dbName).catch((err) =>
          console.error(`ensureUserDb(${user.dbName}) failed:`, err),
        )

        return {
          id: user._key,
          name: user.displayName || user.username,
          username: user.username,
          dbName: user.dbName,
          role: user.role || 'user',
        }
      },
    }),
  ],
})
